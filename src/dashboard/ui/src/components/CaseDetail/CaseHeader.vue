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

async function runCase(fromStart = false) {
  if (!currentCase.value) return

  if (fromStart) {
    await resetCase(true)
  }

  try {
    const settings = await fetchSettings()
    const safeName = runnerStore.getSafeCaseName(currentCase.value.name)
    
    // Set status to running
    casesStore.updateCaseStatus(currentCase.value.name, 'running')
    runnerStore.clearLog(safeName)

    await runnerStore.run(
      [currentCase.value.filePath],
      settings,
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

async function resetCase(silent = false) {
  if (!currentCase.value) return

  try {
    const data = await runnerStore.reset(currentCase.value.name)
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
    title: '⟲ 重新运行',
    message: `确认要从头重新运行用例「${currentCase.value.name}」吗？`,
    subMessage: '此操作将先清除全部断点记录和接口缓存，然后从第 1 步重新开始执行。',
    confirmText: '确认重新运行',
    type: 'warning',
    onConfirm: () => runCase(true),
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
</script>

<template>
  <header v-if="currentCase" class="case-header">
    <div class="case-title-row">
      <span class="badge" :class="currentCase.status">{{ statusLabel }}</span>
      <h2>{{ currentCase.name }}</h2>
    </div>
    <p class="case-desc">{{ currentCase.description || '无用例描述' }}</p>
    <p class="case-meta">文件路径: <code>{{ currentCase.filePath }}</code></p>
    
    <div class="case-actions mt-4">
      <button
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
</style>
