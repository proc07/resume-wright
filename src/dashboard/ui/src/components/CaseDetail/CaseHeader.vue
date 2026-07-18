<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCasesStore } from '@/stores/cases'
import { useRunnerStore } from '@/stores/runner'
import { fetchSettings } from '@/api/settings'
import ConfirmModal from '@/components/Common/ConfirmModal.vue'

const casesStore = useCasesStore()
const runnerStore = useRunnerStore()

const currentCase = computed(() => casesStore.currentCase)

// Modal state
const modalVisible = ref(false)
const modalConfig = ref({
  title: '',
  message: '',
  subMessage: '',
  confirmText: '确认',
  type: 'danger' as 'danger' | 'warning' | 'info',
  onConfirm: () => {},
})

function showModal(config: typeof modalConfig.value) {
  modalConfig.value = config
  modalVisible.value = true
}

function onModalConfirm() {
  modalVisible.value = false
  modalConfig.value.onConfirm()
}

function onModalCancel() {
  modalVisible.value = false
}

const statusLabel = computed(() => {
  if (!currentCase.value) return ''
  const status = currentCase.value.status
  return {
    passed: '执行通过',
    failed: '执行失败',
    never_run: '未运行',
    running: '正在执行...'
  }[status] || status
})

const runButtonText = computed(() => {
  if (!currentCase.value) return '▶ 开始执行'
  const status = currentCase.value.status
  if (status === 'passed') return '▶ 重新执行'
  if (status === 'failed') return '▶ 继续执行'
  return '▶ 开始执行'
})

async function runCase(fromStart = false, keepCache = false) {
  if (!currentCase.value) return

  if (fromStart) {
    await resetCase(true, keepCache)
  }

  try {
    const settings = await fetchSettings()
    const safeName = runnerStore.getSafeCaseName(currentCase.value.name, currentCase.value.filePath)
    
    // Set status to running
    casesStore.updateCaseStatus(currentCase.value.name, 'running')
    if (fromStart && keepCache) {
      runnerStore.appendLog(safeName, '\n\n[system] —— 使用缓存重新运行 ——\n')
    } else {
      runnerStore.clearLog(safeName)
    }

    await runnerStore.run(
      [currentCase.value.filePath],
      { ...settings, readCache: fromStart && keepCache },
      () => {}, // reactively updated
      async () => {
        // refresh list and details
        await casesStore.loadCases()
        if (casesStore.currentCase?.name) {
          await casesStore.refreshCaseDetails(casesStore.currentCase.name)
        }
      }
    )
  } catch (err) {
    console.error('开始执行用例失败:', err)
  }
}

async function stopCase() {
  try {
    await runnerStore.stop(() => {})
  } catch (err) {
    console.error('停止用例失败:', err)
  }
}

async function resetCase(silent = false, keepCache = false) {
  if (!currentCase.value) return

  try {
    const data = await runnerStore.reset(currentCase.value.name, keepCache)
    if (data.success) {
      if (!silent) {
        await casesStore.loadCases()
        if (casesStore.currentCase?.name) {
          await casesStore.refreshCaseDetails(casesStore.currentCase.name)
        }
      }
    }
  } catch (err) {
    console.error('重置用例失败:', err)
  }
}

function confirmRestart() {
  if (!currentCase.value) return
  showModal({
    title: '⟲ 重新运行（清空缓存）',
    message: `确认要从头重新运行用例「${currentCase.value.name}」吗？`,
    subMessage: '此操作将清除全部断点记录和接口缓存，然后从第 1 步重新开始执行。',
    confirmText: '确认清空并重新运行',
    type: 'warning',
    onConfirm: () => runCase(true, false),
  })
}

function confirmRestartWithCache() {
  if (!currentCase.value) return
  showModal({
    title: '⟲ 使用缓存重新运行',
    message: `确认要使用缓存重新运行用例「${currentCase.value.name}」吗？`,
    subMessage: '此操作将清除断点记录，但保留已缓存的 API 响应。重复的非幂等请求将直接使用缓存数据，加速执行。',
    confirmText: '确认使用缓存重新运行',
    type: 'info',
    onConfirm: () => runCase(true, true),
  })
}

function confirmClear() {
  if (!currentCase.value) return
  showModal({
    title: '清除断点',
    message: `确认要清除用例「${currentCase.value.name}」的所有断点数据吗？`,
    subMessage: '将删除 checkpoint.json、sub-steps 快照及接口缓存，下次执行时从第 1 步重新开始。',
    confirmText: '确认清除',
    type: 'danger',
    onConfirm: () => resetCase(false),
  })
}

// ── 耗时统计与实时计时器 ──────────────────────────────────────────
import { onUnmounted, watch } from 'vue'

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

const liveDuration = ref(0)
// 保留计时器停止时的最后值，用于 store 刷新前的过渡展示
const lastLiveDuration = ref(0)
let headerTimerId: any = null

function startHeaderTimer(startTimeStr: string) {
  stopHeaderTimer()
  const start = new Date(startTimeStr).getTime()
  liveDuration.value = Date.now() - start
  lastLiveDuration.value = 0
  headerTimerId = setInterval(() => {
    liveDuration.value = Date.now() - start
  }, 100)
}

function stopHeaderTimer() {
  if (headerTimerId) {
    clearInterval(headerTimerId)
    headerTimerId = null
    // 保留最后计时值作为 store duration 刷新前的 fallback
    lastLiveDuration.value = liveDuration.value
  }
}

watch(
  () => currentCase.value?.startTime,
  (newStartTime) => {
    if (newStartTime && currentCase.value?.status === 'running') {
      startHeaderTimer(newStartTime)
    } else {
      stopHeaderTimer()
      liveDuration.value = 0
    }
  },
  { immediate: true }
)

watch(
  () => currentCase.value?.status,
  (status) => {
    if (status !== 'running') {
      stopHeaderTimer()
      liveDuration.value = 0
    }
  }
)

watch(
  () => currentCase.value?.name,
  () => {
    // 切换 case 时清空过渡值
    lastLiveDuration.value = 0
    liveDuration.value = 0
  }
)

onUnmounted(() => {
  stopHeaderTimer()
})

const displayTotalDuration = computed(() => {
  if (currentCase.value?.status === 'running' && liveDuration.value > 0) {
    return formatDuration(liveDuration.value)
  }
  // 优先展示 store 中持久化的总耗时
  if (currentCase.value?.duration !== undefined && currentCase.value?.duration !== null && currentCase.value.duration > 0) {
    return formatDuration(currentCase.value.duration)
  }
  // 如果已完成/失败且 duration 为 0，展示 0.0s
  if ((currentCase.value?.status === 'passed' || currentCase.value?.status === 'failed') &&
      currentCase.value?.duration !== undefined && currentCase.value?.duration !== null) {
    return formatDuration(currentCase.value.duration)
  }
  // store 还未刷新时用 lastLiveDuration 过渡
  if (lastLiveDuration.value > 0) {
    return formatDuration(lastLiveDuration.value)
  }
  return null
})

// 总耗时 badge 样式：running 时橙色脉冲，passed 绿色，failed 红色
const durationBadgeClass = computed(() => {
  const status = currentCase.value?.status
  if (status === 'running') return 'duration-badge running'
  if (status === 'passed') return 'duration-badge passed'
  if (status === 'failed') return 'duration-badge failed'
  return 'duration-badge'
})
</script>

<template>
  <header v-if="currentCase" class="case-header">
    <div class="case-title-row">
      <span class="badge" :class="currentCase.status">{{ statusLabel }}</span>
      <h2>{{ currentCase.name }}</h2>
      <span v-if="displayTotalDuration" :class="durationBadgeClass">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;flex-shrink:0">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        {{ displayTotalDuration }}
      </span>
    </div>
    <p class="case-desc">{{ currentCase.description || '无用例描述' }}</p>
    <p class="case-meta">
      文件路径: <code>{{ currentCase.filePath }}</code>
    </p>
    
    <div class="case-actions mt-4">
      <button
        v-if="currentCase.status !== 'passed'"
        id="btn-run-case"
        class="btn btn-primary"
        :disabled="currentCase.status === 'running' || runnerStore.isRunning"
        @click="runCase(false)"
      >
        {{ runButtonText }}
      </button>
      <button
        id="btn-restart-case"
        class="btn btn-outline"
        :disabled="currentCase.status === 'running' || runnerStore.isRunning"
        @click="confirmRestart"
      >
        ⟲ 重新运行
      </button>
      <button
        id="btn-restart-with-cache"
        class="btn btn-outline"
        :disabled="currentCase.status === 'running' || runnerStore.isRunning"
        @click="confirmRestartWithCache"
      >
        ⟲ 使用缓存重新运行
      </button>
      <button
        id="btn-reset-case"
        class="btn btn-outline-danger"
        :disabled="currentCase.status === 'running' || runnerStore.isRunning"
        @click="confirmClear"
      >
        清除
      </button>
      
      <button
        id="btn-stop-case"
        class="btn btn-danger"
        v-if="currentCase.status === 'running'"
        @click="stopCase"
      >
        ■ 终止
      </button>
    </div>

    <!-- Confirm Modal -->
    <ConfirmModal
      :visible="modalVisible"
      :title="modalConfig.title"
      :message="modalConfig.message"
      :sub-message="modalConfig.subMessage"
      :confirm-text="modalConfig.confirmText"
      :type="modalConfig.type"
      @confirm="onModalConfirm"
      @cancel="onModalCancel"
    />
  </header>
</template>

<style scoped>
.gap-2 {
  gap: 8px;
}

/* 总耗时 pill 标签 */
.duration-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 99px;
  font-size: 12px;
  font-family: monospace;
  font-weight: 600;
  letter-spacing: 0.02em;
  border: 1px solid;
  transition: all 0.3s ease;
  white-space: nowrap;
  flex-shrink: 0;
}

.duration-badge.running {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.35);
  animation: pulse-badge 1.5s ease-in-out infinite;
}

.duration-badge.passed {
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.3);
}

.duration-badge.failed {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
}

@keyframes pulse-badge {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.65; }
}
</style>
