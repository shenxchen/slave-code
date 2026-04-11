export const AGENT_PATHS = {
  project: '.slave/agents',
  user: '~/.slave/agents',
} as const

export type ModeState = string
