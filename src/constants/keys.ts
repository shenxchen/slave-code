// GrowthBook is disabled in Slave Code to avoid pulling feature flags
// from Anthropic's infrastructure. All feature gates fall back to defaults.
export function getGrowthBookClientKey(): string {
  return ''
}
