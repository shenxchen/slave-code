import { getSecureStorage } from './secureStorage/index.js'

export type OpenAICompatMode = 'chat_completions' | 'responses'

export type CustomApiProvider = 'anthropic' | 'openai' | 'gemini'

// 单个 API Profile 配置
export type ApiProfile = {
  provider?: CustomApiProvider
  openaiCompatMode?: OpenAICompatMode
  baseURL?: string
  apiKey?: string
  model?: string
  savedModels?: string[]
}

// 新的存储结构：支持多个 profile
export type CustomApiStorageData = {
  currentProfile?: string
  profiles: Record<string, ApiProfile>
}

const CUSTOM_API_STORAGE_KEY = 'customApiEndpoint'

// 默认 profile 名称
const DEFAULT_PROFILE = 'default'

// 从旧格式迁移到新格式
function migrateFromLegacyFormat(value: Record<string, unknown>): CustomApiStorageData {
  // 检查是否已经是新格式
  if (value.profiles && typeof value.profiles === 'object') {
    return {
      currentProfile: typeof value.currentProfile === 'string' ? value.currentProfile : DEFAULT_PROFILE,
      profiles: value.profiles as Record<string, ApiProfile>,
    }
  }

  // 迁移旧格式到新格式
  const provider =
    value.provider === 'openai' || value.provider === 'anthropic' || value.provider === 'gemini'
      ? value.provider
      : undefined
  const openaiCompatMode =
    value.openaiCompatMode === 'chat_completions' || value.openaiCompatMode === 'responses'
      ? value.openaiCompatMode
      : provider === 'openai'
        ? 'chat_completions'
        : undefined

  const legacyProfile: ApiProfile = {
    provider,
    openaiCompatMode,
    baseURL: typeof value.baseURL === 'string' ? value.baseURL : undefined,
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : undefined,
    model: typeof value.model === 'string' ? value.model : undefined,
    savedModels: Array.isArray(value.savedModels)
      ? value.savedModels.filter((item): item is string => typeof item === 'string')
      : [],
  }

  return {
    currentProfile: DEFAULT_PROFILE,
    profiles: { [DEFAULT_PROFILE]: legacyProfile },
  }
}

export function readCustomApiStorage(): CustomApiStorageData {
  const storage = getSecureStorage() as {
    read?: () => Record<string, unknown> | null
    update?: (data: Record<string, unknown>) => { success: boolean }
  }
  const data = storage.read?.() ?? {}
  const raw = data[CUSTOM_API_STORAGE_KEY]
  if (!raw || typeof raw !== 'object') {
    return {
      currentProfile: DEFAULT_PROFILE,
      profiles: {},
    }
  }
  return migrateFromLegacyFormat(raw as Record<string, unknown>)
}

// 获取当前激活的 profile
export function getCurrentProfile(): ApiProfile {
  const storage = readCustomApiStorage()
  const profileName = storage.currentProfile || DEFAULT_PROFILE
  return storage.profiles[profileName] || {}
}

export function writeCustomApiStorage(next: CustomApiStorageData): void {
  const storage = getSecureStorage() as {
    read?: () => Record<string, unknown> | null
    update?: (data: Record<string, unknown>) => { success: boolean }
  }
  const current = storage.read?.() ?? {}
  storage.update?.({
    ...current,
    customApiEndpoint: next,
  })
}

// 保存单个 profile（不影响其他 profile）
export function saveProfile(name: string, profile: ApiProfile): void {
  const storage = readCustomApiStorage()
  writeCustomApiStorage({
    ...storage,
    profiles: {
      ...storage.profiles,
      [name]: profile,
    },
  })
}

// 切换当前 profile
export function switchProfile(name: string): boolean {
  const storage = readCustomApiStorage()
  if (!storage.profiles[name]) {
    return false
  }
  writeCustomApiStorage({
    ...storage,
    currentProfile: name,
  })
  return true
}

// 删除 profile
export function deleteProfile(name: string): boolean {
  const storage = readCustomApiStorage()
  if (!storage.profiles[name] || name === DEFAULT_PROFILE) {
    return false // 不能删除默认 profile
  }
  const { [name]: _, ...remainingProfiles } = storage.profiles
  const newCurrentProfile = storage.currentProfile === name ? DEFAULT_PROFILE : storage.currentProfile
  writeCustomApiStorage({
    currentProfile: newCurrentProfile,
    profiles: remainingProfiles,
  })
  return true
}

// 重命名 profile
export function renameProfile(oldName: string, newName: string): boolean {
  const storage = readCustomApiStorage()
  if (!storage.profiles[oldName] || storage.profiles[newName] || newName === DEFAULT_PROFILE) {
    return false
  }
  const { [oldName]: profile, ...remainingProfiles } = storage.profiles
  const newCurrentProfile = storage.currentProfile === oldName ? newName : storage.currentProfile
  writeCustomApiStorage({
    currentProfile: newCurrentProfile,
    profiles: {
      ...remainingProfiles,
      [newName]: profile,
    },
  })
  return true
}

// 列出所有 profile 名称
export function listProfiles(): string[] {
  const storage = readCustomApiStorage()
  return Object.keys(storage.profiles)
}

// 为了保持向后兼容，保留原来的函数但使其操作当前 profile
export function clearCustomApiStorage(): void {
  const storage = getSecureStorage() as {
    read?: () => Record<string, unknown> | null
    update?: (data: Record<string, unknown>) => { success: boolean }
  }
  const current = storage.read?.() ?? {}
  const { customApiEndpoint: _, ...rest } = current
  storage.update?.(rest)
}
