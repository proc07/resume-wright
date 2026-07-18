// ── API: 用例相关 ──────────────────────────────────────────────

export interface CaseStep {
  id: string
  role: string
  completed: boolean
  duration?: number
  subStepsCount: number
  isUseStep?: boolean
}

export interface CaseData {
  name: string
  description: string
  filePath: string
  steps: CaseStep[]
  status: 'passed' | 'failed' | 'never_run' | 'running'
  completedCount: number
  totalSteps: number
  subStepsDetail?: Record<string, Record<string, SubStepState>>
  sharedBootstrapCache?: ApiCacheEntry[]
  roleCaches?: Record<string, ApiCacheEntry[]>
  traces?: string[]
  error?: string
  variables?: Record<string, any>
  safeCaseName?: string
  duration?: number
  startTime?: string
}

export interface SubStepState {
  status: 'completed' | 'failed' | 'pending' | 'running'
  retryCount?: number
  error?: string
  apiCache?: ApiCacheEntry[]
}

export interface ApiCacheEntry {
  method: string
  url: string
  status: number
  body?: string
  bodyEncoding?: 'utf8' | 'base64'
  requestBody?: string
  occurrence?: number
  sequence?: number
  attemptId?: string
  captureRunId?: string
  cachedAt?: string
  isActiveSnapshot?: boolean
  fromCache?: boolean
  cacheAvailable?: boolean
  roleName?: string
}

export interface CaseDetails {
  caseName: string
  screenshots: string[]
  cacheRerunScreenshots: string[]
  sharedBootstrapCache: ApiCacheEntry[]
  roleCaches: Record<string, ApiCacheEntry[]>
  subSteps: Record<string, Record<string, SubStepState>>
  traces: string[]
  error?: string
  variables?: Record<string, any>
  stepDurations?: Record<string, number>
  duration?: number
  startTime?: string
}

export async function fetchCases(): Promise<CaseData[]> {
  const res = await fetch('/api/cases')
  const data = await res.json()
  return data.cases || []
}

export async function fetchCaseDetails(caseName: string): Promise<CaseDetails> {
  const res = await fetch(`/api/case/${encodeURIComponent(caseName)}/details`)
  return res.json()
}
