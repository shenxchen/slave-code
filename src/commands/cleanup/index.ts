/**
 * Cleanup command - minimal metadata only.
 * Implementation is lazy-loaded from cleanup.ts to reduce startup time.
 */
import type { Command } from '../../commands.js'

const cleanup = {
  type: 'local',
  name: 'cleanup',
  description:
    'Clean up user data (history, cache, project memory) while keeping API and skill config',
  supportsNonInteractive: true,
  load: () => import('./cleanup.js'),
} satisfies Command

export default cleanup
