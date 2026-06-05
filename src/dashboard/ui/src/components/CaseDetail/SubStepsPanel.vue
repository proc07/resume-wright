<script setup lang="ts">
import { computed } from 'vue'
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
</script>

<template>
  <div class="card card-substeps">
    <h3>子步骤 (SubStep) 与 API 缓存</h3>
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
                      <div style="display: flex; gap: 4px; min-width: 0; flex: 1; margin-right: 8px;">
                        <span class="api-cache-method" style="flex-shrink: 0;">{{ c.method }}</span>
                        <div class="api-cache-url-container" :data-tooltip="c.url" style="flex-grow: 1; min-width: 0;">
                          <span class="api-cache-url">{{ c.url }}</span>
                        </div>
                      </div>
                      <span class="api-cache-badge" style="flex-shrink: 0;">{{ c.status }}</span>
                    </div>
                    
                    <!-- 接口 Response 悬浮框 -->
                    <div v-if="c.body" class="api-cache-details-popover">
                      <div class="api-cache-popover-title">Response Body (JSON):</div>
                      <pre class="api-cache-popover-content">{{ formatJson(c.body) }}</pre>
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
  </div>
</template>
