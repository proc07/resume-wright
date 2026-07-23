<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCasesStore } from '@/stores/cases'
import { useRunnerStore } from '@/stores/runner'
import { useTerminalStore } from '@/stores/terminal'
import { fetchSettings } from '@/api/settings'
import ConfirmModal from '@/components/Common/ConfirmModal.vue'

const casesStore = useCasesStore()
const runnerStore = useRunnerStore()
const terminalStore = useTerminalStore()

const currentCase = computed(() => casesStore.currentCase)

const props = withDefaults(
  defineProps<{
    activeTab?: 'baseline' | 'cache-rerun'
  }>(),
  {
    activeTab: 'baseline',
  }
)

const emit = defineEmits<{
  (e: 'update:activeTab', tab: 'baseline' | 'cache-rerun'): void
}>()
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

const isCurrentTabFailedOrIncomplete = computed(() => {
  if (!currentCase.value) return false

  if (props.activeTab === 'cache-rerun') {
    const rerunDetails = currentCase.value.cacheRerunSubStepsDetail || {}
    const hasFailedSub = Object.values(rerunDetails).some(
      (detail: any) => Object.values(detail).some((sub: any) => sub.status === 'failed')
    )
    return Boolean(currentCase.value.cacheRerunError) || hasFailedSub
  }

  // ── Baseline (首次运行 Tab) ──────────────────────────────
  if (currentCase.value.baselineError) return true
  const baseDetails = currentCase.value.subStepsDetail || {}
  const hasFailedBaseSub = Object.values(baseDetails).some(
    (detail: any) => Object.values(detail).some((sub: any) => sub.status === 'failed')
  )
  if (hasFailedBaseSub) return true

  // 若 Baseline 首次运行所有步骤均已成功完成，则不属于失败/未完成
  const isBaselineAllCompleted = currentCase.value.steps.length > 0 && currentCase.value.steps.every(s => s.completed)
  if (isBaselineAllCompleted) return false

  return false
})

const showPrimaryRunBtn = computed(() => {
  if (!currentCase.value) return false
  if (currentCase.value.status === 'never_run' && !hasBaselineData.value) return true
  return isCurrentTabFailedOrIncomplete.value
})

const runButtonText = computed(() => {
  if (!currentCase.value) return '▶ 开始执行'
  if (currentCase.value.status === 'never_run' && !hasBaselineData.value) return '▶ 开始执行'
  return '▶ 继续执行'
})

async function runCase(fromStart = false, keepCache = false) {
  if (!currentCase.value) return

  if (fromStart) {
    await resetCase(true, keepCache)
  }

  try {
    const settings = await fetchSettings()
    const safeName = runnerStore.getSafeCaseName(currentCase.value.name, currentCase.value.filePath)
    const isCacheMode = fromStart ? keepCache : props.activeTab === 'cache-rerun'
    
    // Set status to running
    casesStore.updateCaseStatus(currentCase.value.name, 'running')
    if (isCacheMode) {
      runnerStore.appendLog(safeName, '\n\n[system] —— 使用缓存运行 ——\n')
    } else {
      runnerStore.clearLog(safeName)
    }

    await runnerStore.run(
      [currentCase.value.filePath],
      { ...settings, readCache: isCacheMode },
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
      lastLiveDuration.value = 0
      liveDuration.value = 0
      if (!keepCache) {
        casesStore.clearCaseUiState(currentCase.value.name)
        emit('update:activeTab', 'baseline')
      }
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
    onConfirm: () => {
      emit('update:activeTab', 'cache-rerun')
      runCase(true, true)
    },
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
    if (status === 'never_run') {
      lastLiveDuration.value = 0
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
  if (!currentCase.value || (!hasBaselineData.value && currentCase.value.status === 'never_run')) {
    return null
  }
  if (currentCase.value.status === 'running' && liveDuration.value > 0) {
    return formatDuration(liveDuration.value)
  }
  const isCacheTab = props.activeTab === 'cache-rerun'
  let dur = isCacheTab
    ? currentCase.value.cacheRerunDuration
    : currentCase.value.duration

  if (dur === undefined || dur === null || dur <= 0) {
    if (isCacheTab) {
      const rerunStepDurs = currentCase.value.cacheRerunStepDurations || {}
      const sum = Object.values(rerunStepDurs).reduce((a, b) => a + b, 0)
      if (sum > 0) dur = sum
    } else {
      const sum = currentCase.value.steps.reduce((a, s) => a + (s.duration || 0), 0)
      if (sum > 0) dur = sum
    }
  }

  if (dur !== undefined && dur !== null && dur > 0) {
    return formatDuration(dur)
  }
  if (lastLiveDuration.value > 0) {
    return formatDuration(lastLiveDuration.value)
  }
  return null
})

const hasCacheRerunData = computed(() => {
  if (!currentCase.value) return false
  const hasSubDetail = Object.keys(currentCase.value.cacheRerunSubStepsDetail || {}).length > 0
  const hasShared = (currentCase.value.cacheRerunSharedBootstrapCache || []).length > 0
  const hasRole = Object.keys(currentCase.value.cacheRerunRoleCaches || {}).some(
    r => (currentCase.value!.cacheRerunRoleCaches?.[r]?.length || 0) > 0
  )
  const hasScreenshots = (terminalStore.cacheRerunScreenshots || []).length > 0
  const hasCacheRerunErr = Boolean(currentCase.value.cacheRerunError)
  const hasDurations = Boolean(currentCase.value.cacheRerunDuration) || Object.keys(currentCase.value.cacheRerunStepDurations || {}).length > 0
  return hasSubDetail || hasShared || hasRole || hasScreenshots || hasCacheRerunErr || hasDurations
})

const activeTabStatus = computed(() => {
  if (!currentCase.value) return 'never_run'
  if (currentCase.value.status === 'running') return 'running'

  if (props.activeTab === 'cache-rerun') {
    if (currentCase.value.cacheRerunError) return 'failed'

    const rerunDetails = currentCase.value.cacheRerunSubStepsDetail || {}
    const hasFailedSub = Object.values(rerunDetails).some(
      (detail: any) => Object.values(detail).some((sub: any) => sub.status === 'failed' || (sub.error && sub.status !== 'completed'))
    )
    if (hasFailedSub) return 'failed'

    if (hasCacheRerunData.value) return 'passed'
    return 'never_run'
  }

  // ── Baseline (首次运行 Tab) ──────────────────────────────
  if (currentCase.value.baselineError) return 'failed'

  const baseDetails = currentCase.value.subStepsDetail || {}
  const hasFailedSub = Object.values(baseDetails).some(
    (detail: any) => Object.values(detail).some((sub: any) => sub.status === 'failed' || (sub.error && sub.status !== 'completed'))
  )
  if (hasFailedSub) return 'failed'

  if (currentCase.value.steps.length > 0 && currentCase.value.steps.every(s => s.completed)) {
    return 'passed'
  }

  if (hasBaselineData.value) {
    if (currentCase.value.steps.some(s => s.completed)) return 'passed'
    return 'failed'
  }

  return 'never_run'
})

const statusLabel = computed(() => {
  const status = activeTabStatus.value
  return {
    passed: '执行通过',
    failed: '执行失败',
    never_run: '未运行',
    running: '正在执行...'
  }[status] || status
})

const durationBadgeClass = computed(() => {
  const status = activeTabStatus.value
  if (status === 'running') return 'duration-badge running'
  if (status === 'passed') return 'duration-badge passed'
  if (status === 'failed') return 'duration-badge failed'
  return 'duration-badge'
})

const hasBaselineData = computed(() => {
  if (!currentCase.value) return false
  const hasSubDetail = Object.keys(currentCase.value.subStepsDetail || {}).length > 0
  const hasShared = (currentCase.value.sharedBootstrapCache || []).length > 0
  const hasRole = Object.keys(currentCase.value.roleCaches || {}).some(
    r => (currentCase.value!.roleCaches?.[r]?.length || 0) > 0
  )
  const hasCompleted = currentCase.value.steps.some(s => s.completed)
  const hasBaselineErr = Boolean(currentCase.value.baselineError)
  return hasSubDetail || hasShared || hasRole || hasCompleted || hasBaselineErr
})
</script>

<template>
  <header v-if="currentCase" class="case-header">
    <div class="case-title-row">
      <span class="badge" :class="activeTabStatus">{{ statusLabel }}</span>
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
      <template v-if="currentCase.status !== 'running' && !runnerStore.isRunning">
        <button
          v-if="showPrimaryRunBtn"
          id="btn-run-case"
          class="btn btn-primary"
          @click="runCase(false)"
        >
          {{ runButtonText }}
        </button>
        <button
          id="btn-restart-case"
          class="btn btn-outline"
          @click="confirmRestart"
        >
          ⟲ 重新运行
        </button>
        <button
          v-if="hasBaselineData"
          id="btn-restart-with-cache"
          class="btn btn-outline"
          @click="confirmRestartWithCache"
        >
          ⟲ 使用缓存重新运行
        </button>
        <button
          id="btn-reset-case"
          class="btn btn-outline-danger"
          @click="confirmClear"
        >
          清除
        </button>
      </template>

      <button
        v-if="currentCase.status === 'running' || runnerStore.isRunning"
        id="btn-stop-case"
        class="btn btn-danger"
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
