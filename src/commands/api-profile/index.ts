import type { Command } from '../../commands.js'

export default {
  type: 'local',
  name: 'api-profile',
  description: 'Manage API profiles (list, use, add, remove, rename)',
  supportsNonInteractive: false,
  load: () => import('./api-profile'),
} satisfies Command
