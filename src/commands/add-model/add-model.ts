import type { LocalCommandCall } from '../../types/command.js'
import { saveGlobalConfig } from '../../utils/config.js'
import { readCustomApiStorage, writeCustomApiStorage, getCurrentProfile } from '../../utils/customApiStorage.js'

export const call: LocalCommandCall = async (args, _context) => {
  const nextModel = args.trim()
  if (!nextModel) {
    return {
      type: 'text',
      value: 'Usage: /add-model <model-name>',
    }
  }

  const storage = readCustomApiStorage()
  const currentProfileName = storage.currentProfile || 'default'
  const currentProfile = getCurrentProfile()

  // 更新当前 profile
  const updatedProfile = {
    ...currentProfile,
    model: nextModel,
    savedModels: [...new Set([...(currentProfile.savedModels ?? []), nextModel])],
  }

  saveGlobalConfig(current => ({
    ...current,
    customApiEndpoint: {
      ...current.customApiEndpoint,
      model: nextModel,
      savedModels: [...new Set([...(current.customApiEndpoint?.savedModels ?? []), nextModel])],
    },
  }))

  writeCustomApiStorage({
    ...storage,
    profiles: {
      ...storage.profiles,
      [currentProfileName]: updatedProfile,
    },
  })

  process.env.ANTHROPIC_MODEL = nextModel

  return {
    type: 'text',
    value: `Added custom model to profile '${currentProfileName}': ${nextModel}`,
  }
}
