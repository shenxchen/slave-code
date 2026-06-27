import { readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import type { LocalCommandCall } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getProjectsDir } from '../../utils/sessionStorage.js'
import { sanitizePath } from '../../utils/sessionStoragePortable.js'

// ─── helpers ───────────────────────────────────────────────────────────

async function getDirSize(dirPath: string): Promise<number> {
  let total = 0
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dirPath, entry.name)
      try {
        if (entry.isDirectory()) {
          total += await getDirSize(full)
        } else if (entry.isFile()) {
          total += (await stat(full)).size
        }
      } catch {
        // skip inaccessible
      }
    }
  } catch {
    // dir doesn't exist
  }
  return total
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    await stat(dirPath)
    return true
  } catch {
    return false
  }
}

async function countFiles(dirPath: string): Promise<number> {
  let count = 0
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      try {
        if (entry.isDirectory()) {
          count += await countFiles(join(dirPath, entry.name))
        } else if (entry.isFile()) {
          count++
        }
      } catch {
        // skip
      }
    }
  } catch {
    // dir doesn't exist
  }
  return count
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`
}

async function safeRm(path: string): Promise<boolean> {
  try {
    if (await dirExists(path)) {
      await rm(path, { recursive: true, force: true })
      return true
    }
  } catch {
    // permission denied or doesn't exist
  }
  return false
}

async function safeUnlink(path: string): Promise<boolean> {
  try {
    await rm(path, { force: true })
    return true
  } catch {
    return false
  }
}

async function rmIfOlder(path: string, cutoffMs: number): Promise<boolean> {
  try {
    const s = await stat(path)
    if (s.mtimeMs < cutoffMs) {
      await rm(path, { recursive: true, force: true })
      return true
    }
  } catch {
    // doesn't exist
  }
  return false
}

// ─── path builders ─────────────────────────────────────────────────────

function shellSnapshotsDir(): string {
  return join(getClaudeConfigHomeDir(), 'shell-snapshots')
}
function sessionsDir(): string {
  return join(getClaudeConfigHomeDir(), 'sessions')
}
function fileHistoryDir(): string {
  return join(getClaudeConfigHomeDir(), 'file-history')
}
function plansDir(): string {
  return join(getClaudeConfigHomeDir(), 'plans')
}
function debugDir(): string {
  return join(getClaudeConfigHomeDir(), 'debug')
}
function sessionEnvDir(): string {
  return join(getClaudeConfigHomeDir(), 'session-env')
}
function tasksRootDir(): string {
  return join(getClaudeConfigHomeDir(), 'tasks')
}
function imageCacheDir(): string {
  return join(getClaudeConfigHomeDir(), 'image-cache')
}
function pasteCacheDir(): string {
  return join(getClaudeConfigHomeDir(), 'paste-cache')
}
function statsCacheFile(): string {
  return join(getClaudeConfigHomeDir(), 'stats-cache.json')
}
function historyFile(): string {
  return join(getClaudeConfigHomeDir(), 'history.jsonl')
}
function cacheDir(): string {
  return join(getClaudeConfigHomeDir(), 'cache')
}

// ─── argument parsing ──────────────────────────────────────────────────

type CleanupArgs = {
  list: boolean
  project: string | null
  allProjects: boolean
  memoryOnly: boolean
  transcriptsOnly: boolean
  tasks: boolean
  shellSnapshots: boolean
  sessions: boolean
  fileHistory: boolean
  plans: boolean
  debugLogs: boolean
  sessionEnv: boolean
  configOrphans: boolean
  all: boolean
  keepDays: number | null
  yes: boolean
}

function parseArgs(raw: string): CleanupArgs {
  const args: CleanupArgs = {
    list: false,
    project: null,
    allProjects: false,
    memoryOnly: false,
    transcriptsOnly: false,
    tasks: false,
    shellSnapshots: false,
    sessions: false,
    fileHistory: false,
    plans: false,
    debugLogs: false,
    sessionEnv: false,
    configOrphans: false,
    all: false,
    keepDays: null,
    yes: false,
  }
  let i = 0
  const tokens = raw
    .split(/\s+/)
    .map(t => t.trim())
    .filter(Boolean)
  while (i < tokens.length) {
    const t = tokens[i]!
    switch (t) {
      case '--list':
        args.list = true
        break
      case '--project':
        args.project = tokens[++i] ?? null
        break
      case '--all-projects':
        args.allProjects = true
        break
      case '--memory-only':
        args.memoryOnly = true
        break
      case '--transcripts-only':
        args.transcriptsOnly = true
        break
      case '--tasks':
        args.tasks = true
        break
      case '--shell-snapshots':
        args.shellSnapshots = true
        break
      case '--sessions':
        args.sessions = true
        break
      case '--file-history':
        args.fileHistory = true
        break
      case '--plans':
        args.plans = true
        break
      case '--debug-logs':
        args.debugLogs = true
        break
      case '--session-env':
        args.sessionEnv = true
        break
      case '--config-orphans':
        args.configOrphans = true
        break
      case '--all':
        args.all = true
        break
      case '--keep-days':
        args.keepDays = parseInt(tokens[++i] ?? '0', 10) || null
        break
      case '-y':
      case '--yes':
        args.yes = true
        break
    }
    i++
  }
  return args
}

// ─── listing ───────────────────────────────────────────────────────────

async function listProjects(): Promise<
  { name: string; path: string; transcripts: number; sessions: number; memory: number; totalFiles: number }[]
> {
  const projectsDir = getProjectsDir()
  const result: {
    name: string
    path: string
    transcripts: number
    sessions: number
    memory: number
    totalFiles: number
  }[] = []

  let entries
  try {
    entries = await readdir(projectsDir, { withFileTypes: true })
  } catch {
    return result
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const projectPath = join(projectsDir, entry.name)
    const memPath = join(projectPath, 'memory')
    const transcripts = await countFiles(projectPath)
    const memFiles = await countFiles(memPath)
    result.push({
      name: entry.name,
      path: projectPath,
      transcripts,
      sessions: 0,
      memory: memFiles,
      totalFiles: transcripts + memFiles,
    })
  }
  return result
}

// ─── listing output ────────────────────────────────────────────────────

async function doList(): Promise<string> {
  const lines: string[] = ['Cleanable data in ~/.slave/', '='.repeat(60), '']

  // Projects
  lines.push('── Projects ──')
  const projects = await listProjects()
  if (projects.length === 0) {
    lines.push('  (no project data)')
  } else {
    for (const p of projects) {
      const size = await getDirSize(p.path)
      lines.push(`  ${p.name}`)
      lines.push(`    Files: ${p.totalFiles} | Size: ${formatBytes(size)}`)
    }
  }
  lines.push('')

  // Single directories
  const categories: [string, string][] = [
    ['tasks', tasksRootDir()],
    ['shell-snapshots', shellSnapshotsDir()],
    ['sessions', sessionsDir()],
    ['file-history', fileHistoryDir()],
    ['plans', plansDir()],
    ['debug-logs', debugDir()],
    ['session-env', sessionEnvDir()],
    ['image-cache', imageCacheDir()],
    ['paste-cache', pasteCacheDir()],
    ['cache', cacheDir()],
  ]

  lines.push('── Other caches ──')
  for (const [label, dir] of categories) {
    const files = await countFiles(dir)
    const size = await getDirSize(dir)
    if (files > 0) {
      lines.push(`  ${label}: ${files} files, ${formatBytes(size)}`)
    }
  }

  // stats-cache.json
  const statsPath = statsCacheFile()
  if (await dirExists(statsPath)) {
    const s = await stat(statsPath)
    lines.push(`  stats-cache.json: ${formatBytes(s.size)}`)
  }

  // history.jsonl
  const histPath = historyFile()
  if (await dirExists(histPath)) {
    const hs = await stat(histPath)
    const content = await readFile(histPath, 'utf-8')
    const lineCount = content.split('\n').filter(l => l.trim()).length
    lines.push(`  history.jsonl: ${formatBytes(hs.size)}, ~${lineCount} entries`)
  }

  // .claude.json project config entries
  lines.push('')
  lines.push('── .claude.json project entries ──')
  const config = getGlobalConfig()
  if (config.projects && Object.keys(config.projects).length > 0) {
    let orphans = 0
    let active = 0
    for (const key of Object.keys(config.projects)) {
      if (await dirExists(key)) {
        active++
      } else {
        orphans++
        lines.push(`  [ORPHAN] ${key}`)
      }
    }
    lines.push(`  ${active} active, ${orphans} orphaned`)
    if (orphans > 0) {
      lines.push('  Use --config-orphans --yes to clean orphaned entries')
    }
  } else {
    lines.push('  (no project entries)')
  }

  // githubRepoPaths entries
  if (config.githubRepoPaths && Object.keys(config.githubRepoPaths).length > 0) {
    lines.push('')
    lines.push('── .claude.json githubRepoPaths ──')
    let totalPaths = 0
    let orphanPaths = 0
    for (const [repo, paths] of Object.entries(config.githubRepoPaths)) {
      const existing: string[] = []
      const missing: string[] = []
      for (const p of paths) {
        if (await dirExists(p)) {
          existing.push(p)
        } else {
          missing.push(p)
        }
      }
      totalPaths += paths.length
      orphanPaths += missing.length
      if (missing.length > 0) {
        lines.push(`  ${repo}: ${missing.length}/${paths.length} orphaned`)
        for (const p of missing) lines.push(`    [ORPHAN] ${p}`)
      }
    }
    lines.push(`  ${totalPaths} total paths, ${orphanPaths} orphaned`)
    if (orphanPaths > 0) {
      lines.push('  Use --config-orphans --yes to clean orphaned entries')
    }
  }

  lines.push('')
  lines.push('Use --all to clean everything, or specific flags to target items.')
  return lines.join('\n')
}

// ─── cleanup ───────────────────────────────────────────────────────────

async function doCleanup(args: CleanupArgs): Promise<string> {
  const lines: string[] = []
  const cutoffMs = args.keepDays ? Date.now() - args.keepDays * 86400000 : 0  // 0 = delete all
  const deleted: string[] = []
  const skipped: string[] = []

  const cleanDir = async (label: string, dirPath: string) => {
    if (cutoffMs) {
      let count = 0
      try {
        const entries = await readdir(dirPath, { withFileTypes: true })
        for (const e of entries) {
          const full = join(dirPath, e.name)
          if (await rmIfOlder(full, cutoffMs)) count++
        }
      } catch {
        // doesn't exist
      }
      if (count > 0) {
        deleted.push(`${label}: ${count} items older than ${args.keepDays} days removed`)
      } else {
        skipped.push(`${label}: nothing to clean (within ${args.keepDays}d retention)`)
      }
    } else {
      if (await safeRm(dirPath)) {
        deleted.push(label)
      } else {
        skipped.push(`${label}: not found or empty`)
      }
    }
  }

  const cleanFile = async (label: string, filePath: string) => {
    if (cutoffMs) {
      if (await rmIfOlder(filePath, cutoffMs)) {
        deleted.push(label)
      } else {
        skipped.push(`${label}: within retention period`)
      }
    } else {
      if (await safeUnlink(filePath)) {
        deleted.push(label)
      } else {
        skipped.push(`${label}: not found`)
      }
    }
  }

  const all = args.all

  // Global cache dirs — only clean the ones specifically requested
  if (all || args.tasks) await cleanDir('tasks', tasksRootDir())
  if (all || args.shellSnapshots) await cleanDir('shell-snapshots', shellSnapshotsDir())
  if (all || args.sessions) await cleanDir('sessions', sessionsDir())
  if (all || args.fileHistory) await cleanDir('file-history', fileHistoryDir())
  if (all || args.plans) await cleanDir('plans', plansDir())
  if (all || args.debugLogs) await cleanDir('debug-logs', debugDir())
  if (all || args.sessionEnv) await cleanDir('session-env', sessionEnvDir())
  // These are always cleaned with --all only (no individual flags)
  if (all) {
    await cleanDir('image-cache', imageCacheDir())
    await cleanDir('paste-cache', pasteCacheDir())
    await cleanDir('cache', cacheDir())
    await cleanFile('stats-cache.json', statsCacheFile())

    // history.jsonl: with --keep-days, filter out old entries; otherwise delete entirely
    const hPath = historyFile()
    if (await dirExists(hPath)) {
      if (cutoffMs) {
        try {
          const content = await readFile(hPath, 'utf-8')
          const allLines = content.split('\n').filter(l => l.trim())
          const recent: string[] = []
          let removed = 0
          for (const line of allLines) {
            try {
              const entry = JSON.parse(line)
              if (entry.timestamp && entry.timestamp >= cutoffMs) {
                recent.push(line)
              } else {
                removed++
              }
            } catch {
              // Keep malformed lines (edge case: corrupted entries)
              recent.push(line)
            }
          }
          if (removed > 0) {
            await writeFile(hPath, recent.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 })
            deleted.push(
              `history.jsonl: ${removed} entries older than ${args.keepDays} days removed`,
            )
          } else {
            skipped.push(`history.jsonl: all entries within ${args.keepDays}d retention`)
          }
        } catch {
          skipped.push('history.jsonl: error filtering by date')
        }
      } else {
        await cleanFile('history.jsonl', hPath)
      }
    }
  }

  // Project data
  const wantProjectClean =
    all ||
    args.allProjects ||
    args.project !== null ||
    args.memoryOnly ||
    args.transcriptsOnly
  if (wantProjectClean) {
    const projectsDir = getProjectsDir()
    let projectNames: string[] = []

    if (args.project) {
      projectNames = [args.project]
    } else if (args.all || args.allProjects) {
      try {
        const entries = await readdir(projectsDir, { withFileTypes: true })
        projectNames = entries.filter(e => e.isDirectory()).map(e => e.name)
      } catch {
        // no projects dir
      }
    }

    for (const name of projectNames) {
      const projectPath = join(projectsDir, name)
      if (!(await dirExists(projectPath))) {
        skipped.push(`project "${name}": not found`)
        continue
      }

      if (args.memoryOnly) {
        const memPath = join(projectPath, 'memory')
        await cleanDir(`project "${name}" memory`, memPath)
      } else if (args.transcriptsOnly) {
        try {
          const entries = await readdir(projectPath, { withFileTypes: true })
          let tc = 0
          for (const e of entries) {
            if (e.name === 'memory') continue
            const full = join(projectPath, e.name)
            if (await safeRm(full)) tc++
          }
          if (tc > 0) {
            deleted.push(`project "${name}" transcripts: ${tc} items removed`)
          } else {
            skipped.push(`project "${name}" transcripts: nothing to clean`)
          }
        } catch {
          skipped.push(`project "${name}" transcripts: error reading`)
        }
      } else {
        await cleanDir(`project "${name}"`, projectPath)
      }
    }

    // Also clean matching entries in .claude.json projects field
    if (projectNames.length > 0) {
      const config = getGlobalConfig()
      if (config.projects) {
        const sanitizedNamesToRemove = new Set(projectNames)
        const configKeysToRemove: string[] = []
        for (const key of Object.keys(config.projects)) {
          if (sanitizedNamesToRemove.has(sanitizePath(key))) {
            configKeysToRemove.push(key)
          }
        }
        if (configKeysToRemove.length > 0) {
          saveGlobalConfig(current => ({
            ...current,
            projects: Object.fromEntries(
              Object.entries(current.projects ?? {}).filter(
                ([key]) => !configKeysToRemove.includes(key),
              ),
            ),
          }))
          deleted.push(
            `.claude.json: ${configKeysToRemove.length} project config(s) removed`,
          )
        }
      }
    }
  }

  // Config orphans: clean .claude.json entries for directories that no longer exist
  if (all || args.configOrphans) {
    const config = getGlobalConfig()

    // Clean orphaned projects
    if (config.projects) {
      const orphanKeys: string[] = []
      for (const key of Object.keys(config.projects)) {
        if (!(await dirExists(key))) {
          orphanKeys.push(key)
        }
      }
      if (orphanKeys.length > 0) {
        saveGlobalConfig(current => ({
          ...current,
          projects: Object.fromEntries(
            Object.entries(current.projects ?? {}).filter(
              ([key]) => !orphanKeys.includes(key),
            ),
          ),
        }))
        deleted.push(
          `.claude.json: ${orphanKeys.length} orphaned project config(s) removed`,
        )
      } else {
        skipped.push('.claude.json: no orphaned project configs found')
      }
    }

    // Clean orphaned githubRepoPaths
    if (config.githubRepoPaths) {
      const cleaned: Record<string, string[]> = {}
      let removedCount = 0
      for (const [repo, paths] of Object.entries(config.githubRepoPaths)) {
        const existing: string[] = []
        for (const p of paths) {
          if (await dirExists(p)) {
            existing.push(p)
          } else {
            removedCount++
          }
        }
        if (existing.length > 0) {
          cleaned[repo] = existing
        }
        // if existing empty, drop the repo key entirely
      }
      if (removedCount > 0) {
        saveGlobalConfig(current => ({
          ...current,
          githubRepoPaths: Object.keys(cleaned).length > 0 ? cleaned : undefined,
        }))
        deleted.push(
          `.claude.json: ${removedCount} orphaned repo path(s) removed`,
        )
      } else {
        skipped.push('.claude.json: no orphaned repo paths found')
      }
    }
  }

  // Clean githubRepoPaths for removed project directories
  if (wantProjectClean && projectNames.length > 0) {
    const config = getGlobalConfig()
    if (config.githubRepoPaths && config.projects) {
      // Map project names back to absolute paths via config.projects keys
      const sanitizedNames = new Set(projectNames)
      const removedAbsPaths = new Set(
        Object.keys(config.projects).filter(k => sanitizedNames.has(sanitizePath(k))),
      )
      if (removedAbsPaths.size > 0) {
        let cleaned = false
        const updated: Record<string, string[]> = {}
        for (const [repo, paths] of Object.entries(config.githubRepoPaths)) {
          const remaining = paths.filter(p => !removedAbsPaths.has(p))
          if (remaining.length !== paths.length) cleaned = true
          if (remaining.length > 0) {
            updated[repo] = remaining
          }
        }
        if (cleaned) {
          saveGlobalConfig(current => ({
            ...current,
            githubRepoPaths: Object.keys(updated).length > 0 ? updated : undefined,
          }))
          deleted.push('.claude.json: repo path mapping(s) removed for cleaned projects')
        }
      }
    }
  }

  // Build output
  lines.push('Cleanup complete.')
  lines.push('')
  if (deleted.length > 0) {
    lines.push('Removed:')
    for (const d of deleted) lines.push(`  - ${d}`)
  }
  if (skipped.length > 0) {
    lines.push('Skipped:')
    for (const s of skipped) lines.push(`  - ${s}`)
  }
  return lines.join('\n')
}

// ─── usage ──────────────────────────────────────────────────────────────

const USAGE = `Usage: /cleanup [flags]

  --list              List all cleanable data and their sizes (no deletion)

Project data:
  --project <name>    Clean a specific project (use --list to see names)
  --all-projects      Clean all project data (transcripts, tool outputs, memory)
  --memory-only       Only clean project memory (keep transcripts)
  --transcripts-only  Only clean transcripts (keep memory)

Global caches:
  --tasks             Clean task status cache
  --shell-snapshots   Clean shell environment snapshots
  --sessions          Clean stale session PID files
  --file-history      Clean file checkpoint backups
  --plans             Clean plan files
  --debug-logs        Clean debug log files
  --session-env       Clean session environment directories

Config cleanup:
  --config-orphans    Remove .claude.json entries for directories that no longer exist

Options:
  --all               Clean everything (all of the above)
  --keep-days <n>     Keep entries from the last n days (default: delete all)
  -y, --yes           Skip confirmation prompt

Examples:
  /cleanup --list
  /cleanup --all --yes
  /cleanup --project D--slave-code --yes
  /cleanup --all --keep-days 7 --yes`

// ─── entry point ───────────────────────────────────────────────────────

export const call: LocalCommandCall = async (argsStr, _context) => {
  const args = parseArgs(argsStr)

  // Confirmation gate for destructive operations (unless --yes or --list)
  if (!args.yes && !args.list) {
    const hasTarget =
      args.all ||
      args.allProjects ||
      args.project !== null ||
      args.memoryOnly ||
      args.transcriptsOnly ||
      args.tasks ||
      args.shellSnapshots ||
      args.sessions ||
      args.fileHistory ||
      args.plans ||
      args.debugLogs ||
      args.sessionEnv ||
      args.configOrphans
    if (!hasTarget) {
      return { type: 'text', value: USAGE }
    }
    return {
      type: 'text',
      value:
        'This is a destructive operation. Add --yes to confirm.\n\n' +
        USAGE,
    }
  }

  if (args.list) {
    return { type: 'text', value: await doList() }
  }

  const result = await doCleanup(args)
  return { type: 'text', value: result }
}
