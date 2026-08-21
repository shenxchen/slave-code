import { getClientType } from '../bootstrap/state.js'
import {
  getRemoteSessionUrl,
  isRemoteSessionLocal,
} from '../constants/product.js'
import type { AppState } from '../state/AppState.js'
import { getInitialSettings } from './settings/settings.js'
import { isUndercover } from './undercover.js'

export type AttributionTexts = {
  commit: string
  pr: string
}

/**
 * Returns attribution text for commits and PRs based on user settings.
 * Slave Code: 默认不生成署名（commit 无 Co-Authored-By，PR 无 "Generated with Claude Code"），
 * 仅保留用户显式配置的 settings.attribution.commit/pr。
 */
export function getAttributionTexts(): AttributionTexts {
  if (process.env.USER_TYPE === 'ant' && isUndercover()) {
    return { commit: '', pr: '' }
  }

  if (getClientType() === 'remote') {
    const remoteSessionId = process.env.CLAUDE_CODE_REMOTE_SESSION_ID
    if (remoteSessionId) {
      const ingressUrl = process.env.SESSION_INGRESS_URL
      // Skip for local dev - URLs won't persist
      if (!isRemoteSessionLocal(remoteSessionId, ingressUrl)) {
        const sessionUrl = getRemoteSessionUrl(remoteSessionId, ingressUrl)
        return { commit: sessionUrl, pr: sessionUrl }
      }
    }
    return { commit: '', pr: '' }
  }

  const settings = getInitialSettings()

  // New attribution setting takes precedence over deprecated includeCoAuthoredBy
  if (settings.attribution) {
    return {
      commit: settings.attribution.commit ?? '',
      pr: settings.attribution.pr ?? '',
    }
  }

  // Backward compatibility: deprecated includeCoAuthoredBy setting
  if (settings.includeCoAuthoredBy === false) {
    return { commit: '', pr: '' }
  }

  return { commit: '', pr: '' }
}

/**
 * Get PR attribution text for the PR description.
 * Slave Code: 默认返回空（不署名），仅保留用户显式配置的 settings.attribution.pr。
 */
export async function getEnhancedPRAttribution(
  getAppState: () => AppState,
): Promise<string> {
  if (process.env.USER_TYPE === 'ant' && isUndercover()) {
    return ''
  }

  if (getClientType() === 'remote') {
    const remoteSessionId = process.env.CLAUDE_CODE_REMOTE_SESSION_ID
    if (remoteSessionId) {
      const ingressUrl = process.env.SESSION_INGRESS_URL
      // Skip for local dev - URLs won't persist
      if (!isRemoteSessionLocal(remoteSessionId, ingressUrl)) {
        return getRemoteSessionUrl(remoteSessionId, ingressUrl)
      }
    }
    return ''
  }

  const settings = getInitialSettings()

  // If user has custom PR attribution, use that
  if (settings.attribution?.pr) {
    return settings.attribution.pr
  }

  // Backward compatibility: deprecated includeCoAuthoredBy setting
  if (settings.includeCoAuthoredBy === false) {
    return ''
  }

  return ''
}
