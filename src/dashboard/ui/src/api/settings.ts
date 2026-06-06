// ── API: 设置相关 ──────────────────────────────────────────────

export interface DashboardSettings {
  headed: boolean
  trace: boolean
  screenshotOnAssert: boolean
  apiCache: boolean
  cacheGet: boolean
}

export async function fetchSettings(): Promise<DashboardSettings> {
  const res = await fetch('/api/settings')
  return res.json()
}

export async function saveSettings(settings: DashboardSettings): Promise<void> {
  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
}
