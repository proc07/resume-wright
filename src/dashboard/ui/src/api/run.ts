// ── API: 执行控制 ──────────────────────────────────────────────

export interface RunStreamParams {
  cases: string[]
  headed: boolean
  trace: boolean
  screenshotOnAssert: boolean
  apiCache: boolean
  cacheGet: boolean
  concurrency: number
  readCache: boolean
}

export interface RunningStatus {
  running: boolean
  cases: string[]
  settings: RunStreamParams | null
}

export async function fetchRunningStatus(): Promise<RunningStatus> {
  const res = await fetch('/api/running-status')
  return res.json()
}

export function createRunStream(params: RunStreamParams): EventSource {
  const qs = new URLSearchParams({
    cases: params.cases.join(','),
    headed: String(params.headed),
    trace: String(params.trace),
    screenshotOnAssert: String(params.screenshotOnAssert),
    apiCache: String(params.apiCache),
    cacheGet: String(params.cacheGet),
    concurrency: String(params.concurrency),
    readCache: String(params.readCache),
  })
  return new EventSource(`/api/run-stream?${qs}`)
}

export async function stopExecution(): Promise<{ success: boolean; message: string }> {
  const res = await fetch('/api/stop', { method: 'POST' })
  return res.json()
}

export async function resetCase(caseName: string, keepCache = false): Promise<{ success: boolean }> {
  const res = await fetch('/api/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caseName, keepCache }),
  })
  return res.json()
}

export async function resetAll(): Promise<{ success: boolean }> {
  const res = await fetch('/api/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ all: true }),
  })
  return res.json()
}

export async function playTrace(caseName: string, traceFile: string): Promise<{ success: boolean; error?: string }> {
  const res = await fetch('/api/play-trace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caseName, traceFile }),
  })
  return res.json()
}
