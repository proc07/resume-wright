<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import type { CaseData } from '@/api/cases'
import ScreenshotsGallery from './ScreenshotsGallery.vue'

const props = defineProps<{
  caseData: CaseData
  selectedStepId: string | null
}>()

const step = computed(() => {
  if (!props.selectedStepId) return null
  return props.caseData.steps.find(s => s.id === props.selectedStepId) || null
})

const subStepsDetail = computed(() => {
  if (!props.selectedStepId || !props.caseData.subStepsDetail) return null
  return props.caseData.subStepsDetail[props.selectedStepId] || null
})

const stepIndex = computed(() => {
  if (!props.selectedStepId) return -1
  return props.caseData.steps.findIndex(s => s.id === props.selectedStepId)
})

const isStepFailed = computed(() => {
  if (!step.value || stepIndex.value === -1) return false
  const detail = props.caseData.subStepsDetail?.[step.value.id]
  const hasFailedSubStep = detail && Object.values(detail).some((sub: any) => sub.status === 'failed')
  return !!(hasFailedSubStep || (props.caseData.status === 'failed' && props.caseData.completedCount === stepIndex.value))
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
      <h3>{{ step ? step.id : '子步骤 (SubStep) 与 API 缓存' }}</h3>
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
              v-if="isStepFailed && props.caseData.error"
              style="font-size: 11px; color: var(--color-error); word-break: break-all; white-space: pre-wrap; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); padding: 8px 12px; border-radius: 6px; margin-top: 8px; font-family: monospace; line-height: 1.5;"
            >
              {{ formatError(props.caseData.error) }}
            </pre>
          </div>
        </template>
        <template v-else-if="!subStepsDetail || Object.keys(subStepsDetail).length === 0">
          <div class="empty-msg">
            该步骤包含 {{ step.subStepsCount }} 个子步骤，但目前尚无历史执行记录。
          </div>
        </template>
        <template v-else>
          <div
            v-for="[subId, state] in Object.entries(subStepsDetail)"
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
                <div class="api-cache-title">接口缓存命中 (API Response Cache)</div>
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
                    <div class="api-cache-item">
                      <div style="display: flex; gap: 4px; min-width: 0; flex: 1; margin-right: 8px; align-items: center;">
                        <span class="api-cache-method" :class="c.method.toLowerCase()" style="flex-shrink: 0;">{{ c.method }}</span>
                        <div class="api-cache-url-container" :data-tooltip="c.url" style="flex-grow: 1; min-width: 0;">
                          <span class="api-cache-url">{{ c.url }}</span>
                        </div>
                      </div>
                      
                      <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0; margin-left: 8px;">
                        <!-- 响应状态状态码 -->
                        <span class="api-cache-badge" style="margin-right: 2px;">{{ c.status }}</span>

                        <!-- Request parameters Tag (req) -->
                        <div class="api-tag-container">
                          <span
                            class="api-action-tag req-tag"
                            @mouseenter="handleMouseEnter($event, 'Request Body (JSON):', c.requestBody || '无请求体数据 (No request body)')"
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
        <ScreenshotsGallery :step-id="selectedStepId" />
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
