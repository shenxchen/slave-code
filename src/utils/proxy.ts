// @aws-sdk/credential-provider-node and @smithy/node-http-handler are imported
// dynamically in getAWSClientProxyConfig() to defer ~929KB of AWS SDK.
// undici is lazy-required inside getProxyAgent/configureGlobalAgents to defer
// ~1.5MB when no HTTPS_PROXY/mTLS env vars are set (the common case).
import axios, { type AxiosInstance } from 'axios'
import { execFileSync } from 'child_process'
import type { LookupOptions } from 'dns'
import type { Agent } from 'http'
import { HttpsProxyAgent, type HttpsProxyAgentOptions } from 'https-proxy-agent'
import memoize from 'lodash-es/memoize.js'
import type * as undici from 'undici'
import { getCACertificates } from './caCerts.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import {
  getMTLSAgent,
  getMTLSConfig,
  getTLSFetchOptions,
  type TLSConfig,
} from './mtls.js'

// Disable fetch keep-alive after a stale-pool ECONNRESET so retries open a
// fresh TCP connection instead of reusing the dead pooled socket. Sticky for
// the process lifetime — once the pool is known-bad, don't trust it again.
// Works under Bun (native fetch respects keepalive:false for pooling).
// Under Node/undici, keepalive is a no-op for pooling, but undici
// naturally evicts dead sockets from the pool on ECONNRESET.
let keepAliveDisabled = false

export function disableKeepAlive(): void {
  keepAliveDisabled = true
}

export function _resetKeepAliveForTesting(): void {
  keepAliveDisabled = false
}

/**
 * Convert dns.LookupOptions.family to a numeric address family value
 * Handles: 0 | 4 | 6 | 'IPv4' | 'IPv6' | undefined
 */
export function getAddressFamily(options: LookupOptions): 0 | 4 | 6 {
  switch (options.family) {
    case 0:
    case 4:
    case 6:
      return options.family
    case 'IPv6':
      return 6
    case 'IPv4':
    case undefined:
      return 4
    default:
      throw new Error(`Unsupported address family: ${options.family}`)
  }
}

type EnvLike = Record<string, string | undefined>

/**
 * Windows system proxy (WinINET registry) values.
 * Windows stores its "system proxy" toggle in HKCU Internet Settings rather
 * than exporting it as HTTP_PROXY/HTTPS_PROXY env vars, so env-only readers
 * never see it. This type carries the values read from the registry.
 */
type WindowsSystemProxy = {
  proxy: string
  noProxy?: string
}

const WINDOWS_INTERNET_SETTINGS_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

// Module-level cache — read the registry at most once per process (spawning
// reg.exe is not free, and the WinINET proxy rarely changes mid-session).
let cachedWindowsSystemProxy: WindowsSystemProxy | undefined
let windowsSystemProxyRead = false

/**
 * Parse the registry ProxyServer value into a single proxy URL.
 * Registry format is either:
 *   - plain "host:port" (e.g. "127.0.0.1:7892")
 *   - protocol-specific "http=host:port;https=host:port" (prefer the https entry)
 *   - an already-complete URL (contains "://", rare)
 * Returns http://<host>:<port> so HttpsProxyAgent / undici can CONNECT through it.
 */
export function parseWindowsProxyServer(value: string): string | undefined {
  const v = value.trim()
  if (!v) return undefined
  // Already a full URL (explicit scheme, credentials, etc.)
  if (v.includes('://')) return v

  let host = v
  const segmented = v
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
  if (segmented.some(s => s.includes('='))) {
    let httpsEntry: string | undefined
    let fallback: string | undefined
    for (const entry of segmented) {
      const idx = entry.indexOf('=')
      if (idx >= 0) {
        const proto = entry.slice(0, idx).toLowerCase()
        const val = entry.slice(idx + 1)
        if (proto === 'https') httpsEntry = val
        if (fallback === undefined) fallback = val
      } else if (fallback === undefined) {
        fallback = entry
      }
    }
    host = httpsEntry ?? fallback ?? v
  }

  if (!host) return undefined
  if (host.includes('://')) return host
  return `http://${host}`
}

/**
 * Convert a Windows ProxyOverride value (semicolon-separated) into a
 * comma-separated NO_PROXY-style list compatible with shouldBypassProxy.
 * Windows syntax quirks handled here:
 *   - "<local>" means "all local addresses" → expanded to localhost/127.0.0.1/.local
 *   - "*domain" / "*.domain" means "domain and subdomains" → ".domain"
 *   - "127.*", "172.2*" etc. are IP prefix wildcards → kept as-is; the
 *     trailing-* branch in shouldBypassProxy handles those
 */
export function convertWindowsProxyOverride(value: string): string {
  return value
    .split(';')
    .map(e => e.trim())
    .filter(Boolean)
    .flatMap(e => {
      if (e === '<local>') return ['localhost', '127.0.0.1', '.local']
      if (e === '*') return ['*']
      if (e.startsWith('*.')) return [e.slice(1)]
      if (e.startsWith('*')) return [`.${e.slice(1)}`]
      return [e]
    })
    .join(',')
}

/**
 * Read the Windows system proxy from the WinINET registry (one-time cached).
 * Returns undefined when disabled/unset, on non-win32, or when the registry
 * read fails (reg.exe missing, restricted, etc.) — failures never break the
 * env-var path.
 */
export function readWindowsSystemProxy(): WindowsSystemProxy | undefined {
  if (process.platform !== 'win32') return undefined
  if (windowsSystemProxyRead) return cachedWindowsSystemProxy
  windowsSystemProxyRead = true

  try {
    // execFileSync avoids shell interpretation; args are entirely static.
    // Single invocation dumps all values under the key.
    const stdout = execFileSync('reg', ['query', WINDOWS_INTERNET_SETTINGS_KEY], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    })

    const enableMatch = stdout.match(/^[ \t]*ProxyEnable[ \t]+REG_DWORD[ \t]+(\S+)/im)
    const serverMatch = stdout.match(/^[ \t]*ProxyServer[ \t]+REG_SZ[ \t]+(.*)$/im)
    const overrideMatch = stdout.match(/^[ \t]*ProxyOverride[ \t]+REG_SZ[ \t]+(.*)$/im)

    // The registry keeps ProxyServer around even when the toggle is off — only
    // honor it when ProxyEnable is non-zero (reg.exe shows REG_DWORD as hex by
    // default, but may print decimal on some systems).
    if (!enableMatch || parseInt(enableMatch[1], 16) === 0) {
      return undefined
    }
    if (!serverMatch) return undefined

    const proxy = parseWindowsProxyServer(serverMatch[1])
    if (!proxy) return undefined

    cachedWindowsSystemProxy = {
      proxy,
      noProxy: overrideMatch
        ? convertWindowsProxyOverride(overrideMatch[1])
        : undefined,
    }
    return cachedWindowsSystemProxy
  } catch {
    return undefined
  }
}

/**
 * Get the active proxy URL if one is configured
 * Prefers lowercase variants over uppercase (https_proxy > HTTPS_PROXY > http_proxy > HTTP_PROXY)
 * Falls back to the Windows system proxy (WinINET registry) when no env var is
 * set and process.platform === 'win32'.
 * @param env Environment variables to check (defaults to process.env for
 *   production use). When explicitly passed, the registry fallback is skipped
 *   so callers (e.g. tests) get deterministic behavior.
 */
export function getProxyUrl(env?: EnvLike): string | undefined {
  const e = env ?? process.env
  const fromEnv = e.https_proxy || e.HTTPS_PROXY || e.http_proxy || e.HTTP_PROXY
  if (fromEnv) return fromEnv
  if (env !== undefined) return undefined
  return readWindowsSystemProxy()?.proxy
}

/**
 * Get the NO_PROXY environment variable value
 * Prefers lowercase over uppercase (no_proxy > NO_PROXY)
 * Falls back to the Windows system proxy bypass list (ProxyOverride) on win32.
 * @param env Environment variables to check (defaults to process.env for production use)
 */
export function getNoProxy(env?: EnvLike): string | undefined {
  const e = env ?? process.env
  const fromEnv = e.no_proxy || e.NO_PROXY
  if (fromEnv) return fromEnv
  if (env !== undefined) return undefined
  return readWindowsSystemProxy()?.noProxy
}

/**
 * Check if a URL should bypass the proxy based on NO_PROXY environment variable
 * Supports:
 * - Exact hostname matches (e.g., "localhost")
 * - Domain suffix matches with leading dot (e.g., ".example.com")
 * - Wildcard "*" to bypass all
 * - Port-specific matches (e.g., "example.com:8080")
 * - IP addresses (e.g., "127.0.0.1")
 * @param urlString URL to check
 * @param noProxy NO_PROXY value (defaults to getNoProxy() for production use)
 */
export function shouldBypassProxy(
  urlString: string,
  noProxy: string | undefined = getNoProxy(),
): boolean {
  if (!noProxy) return false

  // Handle wildcard
  if (noProxy === '*') return true

  try {
    const url = new URL(urlString)
    const hostname = url.hostname.toLowerCase()
    const port = url.port || (url.protocol === 'https:' ? '443' : '80')
    const hostWithPort = `${hostname}:${port}`

    // Split by comma or space and trim each entry
    const noProxyList = noProxy.split(/[,\s]+/).filter(Boolean)

    return noProxyList.some(pattern => {
      pattern = pattern.toLowerCase().trim()

      // Check for port-specific match
      if (pattern.includes(':')) {
        return hostWithPort === pattern
      }

      // Check for domain suffix match (with or without leading dot)
      if (pattern.startsWith('.')) {
        // Pattern ".example.com" should match "sub.example.com" and "example.com"
        // but NOT "notexample.com"
        const suffix = pattern
        return hostname === pattern.substring(1) || hostname.endsWith(suffix)
      }

      // Windows ProxyOverride IP-prefix wildcards: "127.*", "172.2*", "10.*"
      // (a trailing "*" after an IP prefix matches any host starting with it)
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1)
        return prefix.length > 0 && hostname.startsWith(prefix)
      }

      // Check for exact hostname match or IP address
      return hostname === pattern
    })
  } catch {
    // If URL parsing fails, don't bypass proxy
    return false
  }
}

/**
 * Create an HttpsProxyAgent with optional mTLS configuration
 * Skips local DNS resolution to let the proxy handle it
 */
function createHttpsProxyAgent(
  proxyUrl: string,
  extra: HttpsProxyAgentOptions<string> = {},
): HttpsProxyAgent<string> {
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  const agentOptions: HttpsProxyAgentOptions<string> = {
    ...(mtlsConfig && {
      cert: mtlsConfig.cert,
      key: mtlsConfig.key,
      passphrase: mtlsConfig.passphrase,
    }),
    ...(caCerts && { ca: caCerts }),
  }

  if (isEnvTruthy(process.env.CLAUDE_CODE_PROXY_RESOLVES_HOSTS)) {
    // Skip local DNS resolution - let the proxy resolve hostnames
    // This is needed for environments where DNS is not configured locally
    // and instead handled by the proxy (as in sandboxes)
    agentOptions.lookup = (hostname, options, callback) => {
      callback(null, hostname, getAddressFamily(options))
    }
  }

  return new HttpsProxyAgent(proxyUrl, { ...agentOptions, ...extra })
}

/**
 * Axios instance with its own proxy agent. Same NO_PROXY/mTLS/CA
 * resolution as the global interceptor, but agent options stay
 * scoped to this instance.
 */
export function createAxiosInstance(
  extra: HttpsProxyAgentOptions<string> = {},
): AxiosInstance {
  const proxyUrl = getProxyUrl()
  const mtlsAgent = getMTLSAgent()
  const instance = axios.create({ proxy: false })

  if (!proxyUrl) {
    if (mtlsAgent) instance.defaults.httpsAgent = mtlsAgent
    return instance
  }

  const proxyAgent = createHttpsProxyAgent(proxyUrl, extra)
  instance.interceptors.request.use(config => {
    if (config.url && shouldBypassProxy(config.url)) {
      config.httpsAgent = mtlsAgent
      config.httpAgent = mtlsAgent
    } else {
      config.httpsAgent = proxyAgent
      config.httpAgent = proxyAgent
    }
    return config
  })
  return instance
}

/**
 * Get or create a memoized proxy agent for the given URI
 * Now respects NO_PROXY environment variable
 */
export const getProxyAgent = memoize((uri: string): undici.Dispatcher => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const undiciMod = require('undici') as typeof undici
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  // Use EnvHttpProxyAgent to respect NO_PROXY
  // This agent automatically checks NO_PROXY for each request
  const proxyOptions: undici.EnvHttpProxyAgent.Options & {
    requestTls?: {
      cert?: string | Buffer
      key?: string | Buffer
      passphrase?: string
      ca?: string | string[] | Buffer
    }
  } = {
    // Override both HTTP and HTTPS proxy with the provided URI
    httpProxy: uri,
    httpsProxy: uri,
    noProxy: getNoProxy(),
  }

  // Set both connect and requestTls so TLS options apply to both paths:
  // - requestTls: used by ProxyAgent for the TLS connection through CONNECT tunnels
  // - connect: used by Agent for direct (no-proxy) connections
  if (mtlsConfig || caCerts) {
    const tlsOpts = {
      ...(mtlsConfig && {
        cert: mtlsConfig.cert,
        key: mtlsConfig.key,
        passphrase: mtlsConfig.passphrase,
      }),
      ...(caCerts && { ca: caCerts }),
    }
    proxyOptions.connect = tlsOpts
    proxyOptions.requestTls = tlsOpts
  }

  return new undiciMod.EnvHttpProxyAgent(proxyOptions)
})

/**
 * Get an HTTP agent configured for WebSocket proxy support
 * Returns undefined if no proxy is configured or URL should bypass proxy
 */
export function getWebSocketProxyAgent(url: string): Agent | undefined {
  const proxyUrl = getProxyUrl()

  if (!proxyUrl) {
    return undefined
  }

  // Check if URL should bypass proxy
  if (shouldBypassProxy(url)) {
    return undefined
  }

  return createHttpsProxyAgent(proxyUrl)
}

/**
 * Get the proxy URL for WebSocket connections under Bun.
 * Bun's native WebSocket supports a `proxy` string option instead of Node's `agent`.
 * Returns undefined if no proxy is configured or URL should bypass proxy.
 */
export function getWebSocketProxyUrl(url: string): string | undefined {
  const proxyUrl = getProxyUrl()

  if (!proxyUrl) {
    return undefined
  }

  if (shouldBypassProxy(url)) {
    return undefined
  }

  return proxyUrl
}

/**
 * Get fetch options for the Anthropic SDK with proxy and mTLS configuration
 * Returns fetch options with appropriate dispatcher for proxy and/or mTLS
 *
 * @param opts.forAnthropicAPI - Enables ANTHROPIC_UNIX_SOCKET tunneling. This
 *   env var is set by `claude ssh` on the remote CLI to route API calls through
 *   an ssh -R forwarded unix socket to a local auth proxy. It MUST NOT leak
 *   into non-Anthropic-API fetch paths (MCP HTTP/SSE transports, etc.) or those
 *   requests get misrouted to api.anthropic.com. Only the Anthropic SDK client
 *   should pass `true` here.
 */
export function getProxyFetchOptions(opts?: { forAnthropicAPI?: boolean }): {
  tls?: TLSConfig
  dispatcher?: undici.Dispatcher
  proxy?: string
  unix?: string
  keepalive?: false
} {
  const base = keepAliveDisabled ? ({ keepalive: false } as const) : {}

  // ANTHROPIC_UNIX_SOCKET tunnels through the `claude ssh` auth proxy, which
  // hardcodes the upstream to the Anthropic API. Scope to the Anthropic API
  // client so MCP/SSE/other callers don't get their requests misrouted.
  if (opts?.forAnthropicAPI) {
    const unixSocket = process.env.ANTHROPIC_UNIX_SOCKET
    if (unixSocket && typeof Bun !== 'undefined') {
      return { ...base, unix: unixSocket }
    }
  }

  const proxyUrl = getProxyUrl()

  // If we have a proxy, use the proxy agent (which includes mTLS config)
  if (proxyUrl) {
    if (typeof Bun !== 'undefined') {
      return { ...base, proxy: proxyUrl, ...getTLSFetchOptions() }
    }
    return { ...base, dispatcher: getProxyAgent(proxyUrl) }
  }

  // Otherwise, use TLS options directly if available
  return { ...base, ...getTLSFetchOptions() }
}

/**
 * Configure global HTTP agents for both axios and undici
 * This ensures all HTTP requests use the proxy and/or mTLS if configured
 */
let proxyInterceptorId: number | undefined

export function configureGlobalAgents(): void {
  const proxyUrl = getProxyUrl()
  const mtlsAgent = getMTLSAgent()

  // Eject previous interceptor to avoid stacking on repeated calls
  if (proxyInterceptorId !== undefined) {
    axios.interceptors.request.eject(proxyInterceptorId)
    proxyInterceptorId = undefined
  }

  // Reset proxy-related defaults so reconfiguration is clean
  axios.defaults.proxy = undefined
  axios.defaults.httpAgent = undefined
  axios.defaults.httpsAgent = undefined

  if (proxyUrl) {
    // workaround for https://github.com/axios/axios/issues/4531
    axios.defaults.proxy = false

    // Create proxy agent with mTLS options if available
    const proxyAgent = createHttpsProxyAgent(proxyUrl)

    // Add axios request interceptor to handle NO_PROXY
    proxyInterceptorId = axios.interceptors.request.use(config => {
      // Check if URL should bypass proxy based on NO_PROXY
      if (config.url && shouldBypassProxy(config.url)) {
        // Bypass proxy - use mTLS agent if configured, otherwise undefined
        if (mtlsAgent) {
          config.httpsAgent = mtlsAgent
          config.httpAgent = mtlsAgent
        } else {
          // Remove any proxy agents to use direct connection
          delete config.httpsAgent
          delete config.httpAgent
        }
      } else {
        // Use proxy agent
        config.httpsAgent = proxyAgent
        config.httpAgent = proxyAgent
      }
      return config
    })

    // Set global dispatcher that now respects NO_PROXY via EnvHttpProxyAgent
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ;(require('undici') as typeof undici).setGlobalDispatcher(
      getProxyAgent(proxyUrl),
    )
  } else if (mtlsAgent) {
    // No proxy but mTLS is configured
    axios.defaults.httpsAgent = mtlsAgent

    // Set undici global dispatcher with mTLS
    const mtlsOptions = getTLSFetchOptions()
    if (mtlsOptions.dispatcher) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ;(require('undici') as typeof undici).setGlobalDispatcher(
        mtlsOptions.dispatcher,
      )
    }
  }
}

/**
 * Get AWS SDK client configuration with proxy support
 * Returns configuration object that can be spread into AWS service client constructors
 */
export async function getAWSClientProxyConfig(): Promise<object> {
  const proxyUrl = getProxyUrl()

  if (!proxyUrl) {
    return {}
  }

  const [{ NodeHttpHandler }, { defaultProvider }] = await Promise.all([
    import('@smithy/node-http-handler'),
    import('@aws-sdk/credential-provider-node'),
  ])

  const agent = createHttpsProxyAgent(proxyUrl)
  const requestHandler = new NodeHttpHandler({
    httpAgent: agent,
    httpsAgent: agent,
  })

  return {
    requestHandler,
    credentials: defaultProvider({
      clientConfig: { requestHandler },
    }),
  }
}

/**
 * Clear proxy agent cache.
 */
export function clearProxyCache(): void {
  getProxyAgent.cache.clear?.()
  logForDebugging('Cleared proxy agent cache')
}
