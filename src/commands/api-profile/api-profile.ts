import type { LocalCommandCall } from '../../types/command.js'
import {
  readCustomApiStorage,
  writeCustomApiStorage,
  listProfiles,
  switchProfile,
  deleteProfile,
  renameProfile,
  getCurrentProfile,
} from '../../utils/customApiStorage.js'

export const call: LocalCommandCall = async (args, _context) => {
  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0]?.toLowerCase()
  const restArgs = parts.slice(1).join(' ')

  switch (subcommand) {
    case 'list':
    case 'ls':
      return handleList()
    case 'use':
      return handleUse(restArgs)
    case 'add':
      return handleAdd(restArgs)
    case 'remove':
    case 'rm':
    case 'delete':
      return handleRemove(restArgs)
    case 'rename':
      return handleRename(restArgs)
    case 'current':
    case 'show':
      return handleShow()
    default:
      return {
        type: 'text',
        value: `Usage:
  /api-profile list              - List all profiles
  /api-profile use <name>        - Switch to a profile
  /api-profile add <name>        - Create a new profile
  /api-profile remove <name>     - Delete a profile
  /api-profile rename <old> <new> - Rename a profile
  /api-profile current           - Show current profile`,
      }
  }
}

function handleList() {
  const storage = readCustomApiStorage()
  const profiles = listProfiles()
  const current = storage.currentProfile || 'default'

  if (profiles.length === 0) {
    return {
      type: 'text',
      value: 'No profiles found. Use /api-profile add <name> to create one.',
    }
  }

  const list = profiles
    .map(name => {
      const profile = storage.profiles[name] || {}
      const marker = name === current ? ' * ' : '   '
      const model = profile.model ? ` [model: ${profile.model}]` : ''
      const provider = profile.provider ? ` [provider: ${profile.provider}]` : ''
      return `${marker}${name}${model}${provider}`
    })
    .join('\n')

  return {
    type: 'text',
    value: `Available profiles:\n${list}\n\n* = current profile`,
  }
}

function handleUse(name: string) {
  const profileName = name.trim()
  if (!profileName) {
    return {
      type: 'text',
      value: 'Usage: /api-profile use <profile-name>',
    }
  }

  const success = switchProfile(profileName)
  if (!success) {
    return {
      type: 'text',
      value: `Profile '${profileName}' not found. Use /api-profile list to see available profiles.`,
    }
  }

  // 更新环境变量
  const profile = getCurrentProfile()
  if (profile.baseURL) {
    process.env.ANTHROPIC_BASE_URL = profile.baseURL
  } else {
    delete process.env.ANTHROPIC_BASE_URL
  }
  if (profile.apiKey) {
    process.env.SLAVE_API_KEY = profile.apiKey
  } else {
    delete process.env.SLAVE_API_KEY
  }
  if (profile.model) {
    process.env.ANTHROPIC_MODEL = profile.model
  } else {
    delete process.env.ANTHROPIC_MODEL
  }

  return {
    type: 'text',
    value: `Switched to profile '${profileName}'.`,
  }
}

function handleAdd(name: string) {
  const profileName = name.trim()
  if (!profileName) {
    return {
      type: 'text',
      value: 'Usage: /api-profile add <profile-name>',
    }
  }

  const storage = readCustomApiStorage()
  if (storage.profiles[profileName]) {
    return {
      type: 'text',
      value: `Profile '${profileName}' already exists.`,
    }
  }

  writeCustomApiStorage({
    ...storage,
    profiles: {
      ...storage.profiles,
      [profileName]: {},
    },
  })

  return {
    type: 'text',
    value: `Profile '${profileName}' created. Use /api-profile use ${profileName} to switch to it, then configure it via /login.`,
  }
}

function handleRemove(name: string) {
  const profileName = name.trim()
  if (!profileName) {
    return {
      type: 'text',
      value: 'Usage: /api-profile remove <profile-name>',
    }
  }

  const success = deleteProfile(profileName)
  if (!success) {
    return {
      type: 'text',
      value: `Cannot delete profile '${profileName}'. It may be the default profile or doesn't exist.`,
    }
  }

  return {
    type: 'text',
    value: `Profile '${profileName}' deleted.`,
  }
}

function handleRename(args: string) {
  const [oldName, newName] = args.trim().split(/\s+/)
  if (!oldName || !newName) {
    return {
      type: 'text',
      value: 'Usage: /api-profile rename <old-name> <new-name>',
    }
  }

  const success = renameProfile(oldName, newName)
  if (!success) {
    return {
      type: 'text',
      value: `Cannot rename '${oldName}' to '${newName}'. Check that the old profile exists and the new name is available.`,
    }
  }

  return {
    type: 'text',
    value: `Renamed profile '${oldName}' to '${newName}'.`,
  }
}

function handleShow() {
  const storage = readCustomApiStorage()
  const current = storage.currentProfile || 'default'
  const profile = getCurrentProfile()

  return {
    type: 'text',
    value: `Current profile: ${current}
  Provider: ${profile.provider || 'not set'}
  Base URL: ${profile.baseURL || 'not set'}
  Model: ${profile.model || 'not set'}
  Saved models: ${(profile.savedModels || []).join(', ') || 'none'}`,
  }
}
