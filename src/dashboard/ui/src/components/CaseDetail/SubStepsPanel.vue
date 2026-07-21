<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import type { ApiCacheEntry, CaseData, SubStepState } from '@/api/cases'
import ScreenshotsGallery from './ScreenshotsGallery.vue'

const props = defineProps<{
  caseData: CaseData
  selectedStepId: string | null
  activeTab: 'baseline' | 'cache-rerun'
  hasBaselineData: boolean
  hasCacheRerunData: boolean
}>()

const emit = defineEmits<{
  (e: 'update:activeTab', value: 'baseline' | 'cache-rerun'): void
}>()


const step = computed(() => {
  if (!props.selectedStepId) return null
  return props.caseData.steps.find(s => s.id === props.selectedStepId) || null
})

const subStepsDetail = computed(() => {
  if (!props.selectedStepId || !props.caseData.subStepsDetail) return null
  return props.caseData.subStepsDetail[props.selectedStepId] || null
})

const cacheRerunSubStepsDetail = computed(() => {
  if (!props.selectedStepId || !props.caseData.cacheRerunSubStepsDetail) return null
  return props.caseData.cacheRerunSubStepsDetail[props.selectedStepId] || null
})

// ── API Diff 对比算法 ──────────────────────────────────────────────
function computeDiffApiCache(
  baseList: ApiCacheEntry[] = [],
  rerunList: ApiCacheEntry[] = []
): ApiCacheEntry[] {
  if (props.activeTab !== 'cache-rerun') {
    return baseList
  }

  // 若重跑完全没有该作用域的日志，直接展示 baseline (不打 diff 标记)
  if (!rerunList || rerunList.length === 0) {
    return baseList
  }

  const getEntryKey = (entry: ApiCacheEntry, idx: number) => {
    const occ = entry.occurrence || (idx + 1)
    return `${entry.method.toUpperCase()}:${entry.url}:${occ}`
  }

  const baseKeyCounts = new Map<string, ApiCacheEntry[]>()
  baseList.forEach((b, idx) => {
    const key = getEntryKey(b, idx)
    if (!baseKeyCounts.has(key)) baseKeyCounts.set(key, [])
    baseKeyCounts.get(key)!.push(b)
  })

  const result: ApiCacheEntry[] = []
  const consumedBaseSet = new Set<ApiCacheEntry>()

  // 1. 遍历 rerunList：存在于 baseline 则为正常，不存在为 added (淡绿色)
  rerunList.forEach((rItem, rIdx) => {
    const key = getEntryKey(rItem, rIdx)
    const availableBaseItems = baseKeyCounts.get(key) || []
    const unconsumedBase = availableBaseItems.find(b => !consumedBaseSet.has(b))

    if (unconsumedBase) {
      consumedBaseSet.add(unconsumedBase)
      result.push(rItem)
    } else {
      result.push({
        ...rItem,
        diffStatus: 'added'
      })
    }
  })

  // 2. 遍历 baseList 中未在重跑中触发的请求，标记为 removed (淡红+中划线)
  baseList.forEach((bItem) => {
    if (!consumedBaseSet.has(bItem)) {
      result.push({
        ...bItem,
        diffStatus: 'removed'
      })
    }
  })

  return result
}

const currentSubStepsDetail = computed(() => {
  if (!props.selectedStepId) return null
  const baseDetail = subStepsDetail.value
  const rerunDetail = cacheRerunSubStepsDetail.value

  if (props.activeTab === 'cache-rerun') {
    if (!rerunDetail && !baseDetail) return null
    if (!rerunDetail) return baseDetail

    const allSubIds = new Set([
      ...Object.keys(baseDetail || {}),
      ...Object.keys(rerunDetail || {})
    ])

    const merged: Record<string, SubStepState> = {}
    for (const subId of allSubIds) {
      const baseSub = baseDetail?.[subId]
      const rerunSub = rerunDetail?.[subId]

      const baseCache = baseSub?.apiCache || []
      const rerunCache = rerunSub?.apiCache || []

      const diffCache = computeDiffApiCache(baseCache, rerunCache)

      merged[subId] = {
        ...(rerunSub || baseSub || { status: 'completed' }),
        apiCache: diffCache
      }
    }
    return merged
  }

  return baseDetail
})

const screenshotStepIds = computed(() => {
  if (!props.selectedStepId) return []
  const currentDetail = currentSubStepsDetail.value || subStepsDetail.value || {}
  const subStepIds = Object.keys(currentDetail).filter(id => id !== '$step')
  return [props.selectedStepId, ...subStepIds]
})

const currentMainStepCache = computed(() => {
  if (props.activeTab === 'cache-rerun') {
    const baseCache = subStepsDetail.value?.['$step']?.apiCache || []
    const rerunCache = cacheRerunSubStepsDetail.value?.['$step']?.apiCache || []
    return computeDiffApiCache(baseCache, rerunCache)
  }
  return currentSubStepsDetail.value?.['$step']?.apiCache || []
})

const currentSharedBootstrapCache = computed(() => {
  const base = props.caseData.sharedBootstrapCache || []
  const rerun = props.caseData.cacheRerunSharedBootstrapCache || []
  return computeDiffApiCache(base, rerun)
})

const currentRoleBootstrapCache = computed(() => {
  if (!step.value) return []
  const role = step.value.role
  const base = props.caseData.roleCaches?.[role] || []
  const rerun = props.caseData.cacheRerunRoleCaches?.[role] || []
  return computeDiffApiCache(base, rerun)
})

const stepIndex = computed(() => {
  if (!props.selectedStepId) return -1
  return props.caseData.steps.findIndex(s => s.id === props.selectedStepId)
})

const isStepFailed = computed(() => {
  if (!step.value || stepIndex.value === -1) return false

  if (props.activeTab === 'cache-rerun') {
    const rerunDetail = cacheRerunSubStepsDetail.value
    const hasFailedRerunSub = rerunDetail && Object.values(rerunDetail).some((sub: any) => sub.status === 'failed')
    if (hasFailedRerunSub) return true
    return Boolean(props.caseData.cacheRerunError && props.caseData.completedCount === stepIndex.value)
  }

  const detail = subStepsDetail.value
  const hasFailedBaseSub = detail && Object.values(detail).some((sub: any) => sub.status === 'failed')
  if (hasFailedBaseSub) return true

  // 缓存重跑引起的 status=failed 不应影响 baseline tab 的步骤失败判断
  const isCacheRerunCausedFailure = Boolean(props.caseData.cacheRerunError) && !props.caseData.baselineError
  if (isCacheRerunCausedFailure) return false

  return props.caseData.status === 'failed' && props.caseData.completedCount === stepIndex.value
})

const currentMainStepError = computed(() => {
  if (props.activeTab === 'cache-rerun') {
    if (cacheRerunSubStepsDetail.value?.['$step']?.error) {
      return cacheRerunSubStepsDetail.value['$step'].error
    }
    return props.caseData.cacheRerunError || null
  }

  if (subStepsDetail.value?.['$step']?.error) {
    return subStepsDetail.value['$step'].error
  }
  return props.caseData.baselineError || null
})

const isStepRunning = computed(() => {
  if (!step.value || stepIndex.value === -1) return false
  return props.caseData.status === 'running' && props.caseData.completedCount === stepIndex.value
})

const elapsedMs = ref(0)
// 保留 isRunning 结束时的最后计时值，用于在 store 刷新 duration 前的过渡展示
const lastElapsedMs = ref(0)
let timerId: any = null

function startTimer() {
  stopTimer()
  const start = Date.now()
  elapsedMs.value = 0
  lastElapsedMs.value = 0
  timerId = setInterval(() => {
    elapsedMs.value = Date.now() - start
  }, 100)
}

function stopTimer() {
  if (timerId) {
    clearInterval(timerId)
    timerId = null
    // 保留最后的实时计时值，作为 store duration 刷新前的 fallback
    lastElapsedMs.value = elapsedMs.value
  }
}

watch(
  () => isStepRunning.value,
  (running) => {
    if (running) {
      startTimer()
    } else {
      stopTimer()
      elapsedMs.value = 0
    }
  },
  { immediate: true }
)

// 切换选中步骤时重置计时状态，避免旧步骤时间残留
watch(
  () => props.selectedStepId,
  () => {
    stopTimer()
    elapsedMs.value = 0
    lastElapsedMs.value = 0
  }
)

onUnmounted(() => {
  stopTimer()
})

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms === null || ms <= 0) return '0.0s'
  if (ms < 1000) return `${ms}ms`
  const secs = (ms / 1000).toFixed(1)
  const secsInt = Math.floor(ms / 1000)
  const mins = Math.floor(secsInt / 60)
  const remainSecs = secsInt % 60
  if (mins === 0) return `${secs}s`
  return `${mins}分 ${remainSecs}秒`
}

const displayDuration = computed(() => {
  if (!step.value) return null
  if (isStepRunning.value) {
    return formatDuration(elapsedMs.value)
  }
  // 优先展示从 store 刷新来的持久化 duration
  if (step.value.duration !== undefined && step.value.duration !== null && step.value.duration > 0) {
    return formatDuration(step.value.duration)
  }
  // 步骤已完成但 store 的 duration 尚未刷新到，用 lastElapsedMs 过渡展示
  if ((step.value.completed || isStepFailed.value) && lastElapsedMs.value > 0) {
    return formatDuration(lastElapsedMs.value)
  }
  // duration === 0 且 completed，显示 0.0s
  if (step.value.completed && step.value.duration !== undefined && step.value.duration !== null) {
    return formatDuration(step.value.duration)
  }
  return null
})

function statusLabel(s: string) {
  return {
    completed: '通过',
    failed: '失败',
    pending: '等待中',
    running: '运行中'
  }[s] || s
}

function formatError(err: string | undefined): string {
  if (!err) return ''
  let cleaned = err.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
  cleaned = cleaned.replace(/\[\d{1,2}m/g, '')
  cleaned = cleaned.replace(/Call log:/g, '\n\nCall log:')
  return cleaned.trim()
}

function formatJson(bodyStr: string | undefined): string {
  if (!bodyStr) return ''
  try {
    const parsed = JSON.parse(bodyStr)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return bodyStr
  }
}

function displayApiUrl(entry: ApiCacheEntry): string {
  if (entry.method.toUpperCase() !== 'GET') return entry.url
  return entry.url.replace(/\/?[\?#]*/, '')
}

function formatRequestDetails(entry: ApiCacheEntry): string {
  const details: Record<string, unknown> = {}

  try {
    const url = new URL(entry.url, window.location.origin)
    const query: Record<string, string | string[]> = {}
    for (const [key, value] of url.searchParams.entries()) {
      const current = query[key]
      if (current === undefined) query[key] = value
      else if (Array.isArray(current)) current.push(value)
      else query[key] = [current, value]
    }
    if (Object.keys(query).length > 0) details.query = query
  } catch {
    // 无效 URL 不影响原始请求体展示
  }

  if (entry.requestBody) {
    try {
      details.body = JSON.parse(entry.requestBody)
    } catch {
      details.body = entry.requestBody
    }
  }

  return Object.keys(details).length > 0
    ? JSON.stringify(details)
    : '无请求参数或请求体数据 (No request parameters or body)'
}

// ── 全局 Teleport 悬浮窗逻辑 ──
const activeTooltip = ref<{
  title: string
  content: string
  top: number
  left: number
} | null>(null)

let hideTimeout: number | null = null

function handleMouseEnter(e: MouseEvent, title: string, content: string) {
  if (hideTimeout) {
    clearTimeout(hideTimeout)
    hideTimeout = null
  }
  
  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  
  const popoverWidth = 420
  // 避免超出屏幕左边界，并随页面滚动正确定位
  const left = Math.max(10, rect.right - popoverWidth + window.scrollX)
  const top = rect.bottom + 6 + window.scrollY
  
  activeTooltip.value = {
    title,
    content: formatJson(content),
    top,
    left
  }
}

function handleMouseLeave() {
  hideTimeout = window.setTimeout(() => {
    activeTooltip.value = null
  }, 150)
}

function handlePopoverMouseEnter() {
  if (hideTimeout) {
    clearTimeout(hideTimeout)
    hideTimeout = null
  }
}

function handlePopoverMouseLeave() {
  activeTooltip.value = null
}
</script>

<template>
  <div class="card card-substeps">
    <div class="card-header-row">
      <div class="header-left">
        <h3>{{ step ? step.id : '子步骤 (SubStep) 与 API 缓存' }}</h3>
        <div v-if="step && (hasBaselineData || hasCacheRerunData)" class="substep-tabs">
          <button
            v-if="hasBaselineData"
            class="tab-btn"
            :class="{ active: activeTab === 'baseline' }"
            @click="emit('update:activeTab', 'baseline')"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            首次运行
          </button>
          <button
            v-if="hasCacheRerunData"
            class="tab-btn"
            :class="{ active: activeTab === 'cache-rerun' }"
            @click="emit('update:activeTab', 'cache-rerun')"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            缓存重新运行
          </button>
        </div>
      </div>
      <div v-if="step && displayDuration" class="step-header-duration">
        <span class="duration-label">耗时:</span>
        <span class="duration-value">{{ displayDuration }}</span>
      </div>
    </div>
    <div id="substeps-panel" class="substeps-panel">
      <div v-if="!selectedStepId" class="empty-msg">
        请选择上面的步骤，或在有子步骤的步骤运行后在此处查看缓存与快照状态。
      </div>
      <div v-else-if="step">
        <!-- 共享自动缓存 -->
        <div v-if="currentSharedBootstrapCache.length > 0" class="substep-card">
          <div class="substep-header">
            <span class="substep-title">共享自动缓存</span>
            <span class="substep-status completed">Case 内所有角色共享</span>
          </div>
          <div class="substep-body">
            <div class="api-cache-list mt-2">
              <div class="api-cache-title">静态应用资源 (Shared Bootstrap Cache)</div>
              <div
                v-for="c in currentSharedBootstrapCache"
                :key="`${c.method}:${c.url}`"
                class="api-cache-item-wrapper"
              >
                <div class="api-cache-item" :class="c.diffStatus ? `diff-${c.diffStatus}` : ''">
                  <div style="display: flex; gap: 4px; min-width: 0; flex: 1; margin-right: 8px; align-items: center;">
                    <span class="api-cache-method" :class="c.method.toLowerCase()" style="flex-shrink: 0;">{{ c.method }}</span>
                    <div class="api-cache-url-container" :title="c.url">
                      <span class="api-cache-url" :class="c.diffStatus">{{ displayApiUrl(c) }}</span>
                    </div>
                  </div>
                  
                  <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0; margin-left: 8px;">
                    <span v-if="c.diffStatus === 'added'" class="api-diff-badge added">+ 新增</span>
                    <span v-if="c.diffStatus === 'removed'" class="api-diff-badge removed">- 未请求</span>
                    <span v-if="c.cacheAvailable" class="api-cache-badge" :title="c.url">cache</span>
                    <span class="api-cache-badge" style="margin-right: 2px;">{{ c.status }}</span>
                    
                    <div class="api-tag-container">
                      <span
                        class="api-action-tag req-tag"
                        @mouseenter="handleMouseEnter($event, 'Request Details (JSON):', formatRequestDetails(c))"
                        @mouseleave="handleMouseLeave"
                      >req</span>
                    </div>

                    <div class="api-tag-container">
                      <span
                        class="api-action-tag res-tag"
                        @mouseenter="handleMouseEnter($event, 'Response Body (JSON):', c.body || '无响应体数据 (No response body)')"
                        @mouseleave="handleMouseLeave"
                      >res</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 角色自动缓存 -->
        <div v-if="currentRoleBootstrapCache.length > 0" class="substep-card">
          <div class="substep-header">
            <span class="substep-title">角色自动缓存: <code>{{ step.role }}</code></span>
            <span class="substep-status completed">角色内共享</span>
          </div>
          <div class="substep-body">
            <div class="api-cache-list mt-2">
              <div class="api-cache-title">应用初始化缓存 (Role Bootstrap Cache)</div>
              <div
                v-for="(c, cIdx) in currentRoleBootstrapCache"
                :key="cIdx"
                class="api-cache-item-wrapper"
              >
                <div class="api-cache-item" :class="c.diffStatus ? `diff-${c.diffStatus}` : ''">
                  <div style="display: flex; gap: 4px; min-width: 0; flex: 1; margin-right: 8px; align-items: center;">
                    <span class="api-cache-method" :class="c.method.toLowerCase()" style="flex-shrink: 0;">{{ c.method }}</span>
                    <div class="api-cache-url-container" :title="c.url">
                      <span class="api-cache-url" :class="c.diffStatus">{{ displayApiUrl(c) }}</span>
                    </div>
                  </div>

                  <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0; margin-left: 8px;">
                    <span v-if="c.diffStatus === 'added'" class="api-diff-badge added">+ 新增</span>
                    <span v-if="c.diffStatus === 'removed'" class="api-diff-badge removed">- 未请求</span>
                    <span class="api-cache-badge">#{{ c.occurrence || cIdx + 1 }}</span>
                    <span v-if="c.cacheAvailable" class="api-cache-origin-badge">cache</span>
                    <span class="api-cache-badge" style="margin-right: 2px;">{{ c.status }}</span>
                    
                    <div class="api-tag-container">
                      <span
                        class="api-action-tag req-tag"
                        @mouseenter="handleMouseEnter($event, 'Request Details (JSON):', formatRequestDetails(c))"
                        @mouseleave="handleMouseLeave"
                      >req</span>
                    </div>

                    <div class="api-tag-container">
                      <span
                        class="api-action-tag res-tag"
                        @mouseenter="handleMouseEnter($event, 'Response Body (JSON):', c.body || '无响应体数据 (No response body)')"
                        @mouseleave="handleMouseLeave"
                      >res</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <template v-if="step.subStepsCount === 0">
          <div class="substep-card">
            <div class="substep-header">
              <span class="substep-title">主步骤脚本执行</span>
              <span
                class="substep-status"
                :class="step.completed ? 'completed' : (isStepFailed ? 'failed' : (isStepRunning ? 'running' : 'pending'))"
              >
                {{ step.completed ? '已完成' : (isStepFailed ? '失败' : (isStepRunning ? '运行中' : '未运行')) }}
              </span>
            </div>
            <pre
              v-if="isStepFailed && currentMainStepError"
              style="font-size: 11px; color: var(--color-error); word-break: break-all; white-space: pre-wrap; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); padding: 8px 12px; border-radius: 6px; margin-top: 8px; font-family: monospace; line-height: 1.5;"
            >
              {{ formatError(currentMainStepError) }}
            </pre>

            <div v-if="currentMainStepCache.length > 0" class="api-cache-list mt-2">
              <div class="api-cache-title">接口有序缓存 (API Ordered Cache)</div>
              <div>
                <div
                  v-for="(c, cIdx) in currentMainStepCache"
                  :key="cIdx"
                  class="api-cache-item-wrapper"
                >
                  <div class="api-cache-item" :class="c.diffStatus ? `diff-${c.diffStatus}` : ''">
                    <div style="display: flex; gap: 4px; min-width: 0; flex: 1; margin-right: 8px; align-items: center;">
                      <span class="api-cache-method" :class="c.method.toLowerCase()" style="flex-shrink: 0;">{{ c.method }}</span>
                      <div class="api-cache-url-container" :title="c.url">
                        <span class="api-cache-url" :class="c.diffStatus">{{ displayApiUrl(c) }}</span>
                      </div>
                    </div>

                    <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0; margin-left: 8px;">
                      <span v-if="c.diffStatus === 'added'" class="api-diff-badge added">+ 新增</span>
                      <span v-if="c.diffStatus === 'removed'" class="api-diff-badge removed">- 未请求</span>
                      <span class="api-cache-badge">#{{ c.occurrence || cIdx + 1 }}</span>
                      <span v-if="c.cacheAvailable" class="api-cache-origin-badge">cache</span>
                      <span class="api-cache-badge" style="margin-right: 2px;">{{ c.status }}</span>
                      
                      <div class="api-tag-container">
                        <span
                          class="api-action-tag req-tag"
                          @mouseenter="handleMouseEnter($event, 'Request Details (JSON):', formatRequestDetails(c))"
                          @mouseleave="handleMouseLeave"
                        >req</span>
                      </div>

                      <div class="api-tag-container">
                        <span
                          class="api-action-tag res-tag"
                          @mouseenter="handleMouseEnter($event, 'Response Body (JSON):', c.body || '无响应体数据 (No response body)')"
                          @mouseleave="handleMouseLeave"
                        >res</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
        <template v-else-if="!currentSubStepsDetail || Object.keys(currentSubStepsDetail).length === 0">
          <div class="empty-msg">
            该步骤包含 {{ step.subStepsCount }} 个子步骤，目前尚无{{ activeTab === 'cache-rerun' ? '缓存重跑' : '首次运行' }}记录。
          </div>
        </template>
        <template v-else>
          <div
            v-for="[subId, state] in (Object.entries(currentSubStepsDetail) as [string, SubStepState][])"
            :key="subId"
            class="substep-card"
          >
            <div class="substep-header">
              <span class="substep-title">子步骤: <code>{{ subId }}</code></span>
              <span class="substep-status" :class="state.status">
                {{ statusLabel(state.status) }}
              </span>
            </div>
            <div class="substep-body">
              <div
                v-if="state.retryCount"
                style="font-size: 11px; color: var(--color-warning)"
              >
                重试次数: {{ state.retryCount }}
              </div>
              <pre
                v-if="state.error"
                style="font-size: 11px; color: var(--color-error); word-break: break-all; white-space: pre-wrap; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); padding: 8px 12px; border-radius: 6px; margin-top: 8px; font-family: monospace; line-height: 1.5;"
              >
                {{ formatError(state.error) }}
              </pre>
              
              <!-- API 响应缓存列表 -->
              <div class="api-cache-list mt-2">
                <div class="api-cache-title">接口有序缓存 (API Ordered Cache)</div>
                <div
                  v-if="!state.apiCache || state.apiCache.length === 0"
                  style="font-size: 11px; color: #cbd5e1"
                >
                  暂无 API 缓存
                </div>
                <div v-else>
                  <div
                    v-for="(c, cIdx) in state.apiCache"
                    :key="cIdx"
                    class="api-cache-item-wrapper"
                  >
                    <div class="api-cache-item" :class="c.diffStatus ? `diff-${c.diffStatus}` : ''">
                      <div style="display: flex; gap: 4px; min-width: 0; flex: 1; margin-right: 8px; align-items: center;">
                        <span class="api-cache-method" :class="c.method.toLowerCase()" style="flex-shrink: 0;">{{ c.method }}</span>
                        <div class="api-cache-url-container" :title="c.url">
                          <span class="api-cache-url" :class="c.diffStatus">{{ displayApiUrl(c) }}</span>
                        </div>
                      </div>
                      
                      <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0; margin-left: 8px;">
                        <span v-if="c.diffStatus === 'added'" class="api-diff-badge added">+ 新增</span>
                        <span v-if="c.diffStatus === 'removed'" class="api-diff-badge removed">- 未请求</span>
                        <!-- 响应状态状态码 -->
                        <span class="api-cache-badge">#{{ c.occurrence || cIdx + 1 }}</span>
                        <span v-if="c.cacheAvailable" class="api-cache-origin-badge">cache</span>
                        <span class="api-cache-badge" style="margin-right: 2px;">{{ c.status }}</span>

                        <!-- Request parameters Tag (req) -->
                        <div class="api-tag-container">
                          <span
                            class="api-action-tag req-tag"
                            @mouseenter="handleMouseEnter($event, 'Request Details (JSON):', formatRequestDetails(c))"
                            @mouseleave="handleMouseLeave"
                          >req</span>
                        </div>

                        <!-- Response Body Tag (res) -->
                        <div class="api-tag-container">
                          <span
                            class="api-action-tag res-tag"
                            @mouseenter="handleMouseEnter($event, 'Response Body (JSON):', c.body || '无响应体数据 (No response body)')"
                            @mouseleave="handleMouseLeave"
                          >res</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- 步骤运行快照 -->
        <ScreenshotsGallery
          v-if="activeTab === 'cache-rerun'"
          :step-id="selectedStepId"
          :related-step-ids="screenshotStepIds"
          source="cache-rerun"
          title="🔄 缓存步骤运行快照"
        />
        <ScreenshotsGallery
          v-if="activeTab === 'baseline'"
          :step-id="selectedStepId"
          :related-step-ids="screenshotStepIds"
          source="baseline"
          title="📸 步骤运行快照"
        />
      </div>
    </div>

    <!-- Global Teleported Popover -->
    <Teleport to="body">
      <div
        v-if="activeTooltip"
        class="api-cache-details-popover global-popover"
        :style="{
          position: 'absolute',
          top: activeTooltip.top + 'px',
          left: activeTooltip.left + 'px'
        }"
        @mouseenter="handlePopoverMouseEnter"
        @mouseleave="handlePopoverMouseLeave"
      >
        <div class="api-cache-popover-title">{{ activeTooltip.title }}</div>
        <pre class="api-cache-popover-content">{{ activeTooltip.content }}</pre>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* API Diff 变动对比样式 */
.api-cache-item.diff-added {
  background: rgba(16, 185, 129, 0.06);
  border: 1px dashed rgba(16, 185, 129, 0.35);
}

.api-cache-item.diff-removed {
  background: rgba(239, 68, 68, 0.06);
  border: 1px dashed rgba(239, 68, 68, 0.35);
}

.api-cache-url.added {
  color: #34d399 !important;
  font-weight: 600;
}

.api-cache-url.removed {
  color: #f87171 !important;
  text-decoration: line-through;
  opacity: 0.85;
}

.api-diff-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  font-family: monospace;
  letter-spacing: 0.02em;
}

.api-diff-badge.added {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.4);
}

.api-diff-badge.removed {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.4);
}
</style>

