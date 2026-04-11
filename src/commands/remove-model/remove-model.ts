import type { LocalCommandCall } from '../../types/command.js'
import { saveGlobalConfig, getGlobalConfig } from '../../utils/config.js'
import { readCustomApiStorage, writeCustomApiStorage, getCurrentProfile } from '../../utils/customApiStorage.js'

export const call: LocalCommandCall = async (args, _context) => {
  const targetModel = args.trim()
  if (!targetModel) {
    return {
      type: 'text',
      value: 'Usage: /remove-model <model-name>',
    }
  }

  const storage = readCustomApiStorage()
  const currentProfileName = storage.currentProfile || 'default'
  const currentProfile = getCurrentProfile()

  const savedModels = currentProfile.savedModels ?? []
  if (!savedModels.includes(targetModel)) {
    return {
      type: 'text',
      value: `Model not found in saved list for profile '${currentProfileName}': ${targetModel}`,
    }
  }

  const remainingModels = savedModels.filter(model => model !== targetModel)
  const currentModel = currentProfile.model
  const nextCurrentModel =
    currentModel === targetModel ? (remainingModels[0] ?? undefined) : currentModel

  // 更新当前 profile
  const updatedProfile = {
    ...currentProfile,
    model: nextCurrentModel,
    savedModels: remainingModels,
  }

  saveGlobalConfig(current => ({
    ...current,
    customApiEndpoint: {
      ...current.customApiEndpoint,
      model: nextCurrentModel,
      savedModels: remainingModels,
    },
  }))

  writeCustomApiStorage({
    ...storage,
    profiles: {
      ...storage.profiles,
      [currentProfileName]: updatedProfile,
    },
  })

  if (currentModel === targetModel) {
    if (nextCurrentModel) {
      process.env.ANTHROPIC_MODEL = nextCurrentModel
    } else {
      delete process.env.ANTHROPIC_MODEL
    }
  }

  return {
    type: 'text',
    value: `Removed custom model from profile '${currentProfileName}': ${targetModel}`,
  }
}
