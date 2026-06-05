// ── API: 运行历史 ──────────────────────────────────────────────

export interface HistoryRun {
  runId: string
  timestamp: string
  status: 'passed' | 'failed' | 'running'
  duration?: number
  error?: string
}

export async function fetchHistory(caseName: string): Promise<HistoryRun[]> {
  const res = await fetch(`/api/case/${encodeURIComponent(caseName)}/history`)
  if (!res.ok) return []
  return res.json()
}

export async function fetchHistoryLog(caseName: string, runId: string): Promise<string> {
  const res = await fetch(`/api/case/${encodeURIComponent(caseName)}/history/${runId}/log`)
  if (res.status === 404) return '日志文件已被清理或不存在。'
  return res.text()
}
