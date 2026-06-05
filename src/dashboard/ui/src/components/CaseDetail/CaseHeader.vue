<script setup lang="ts">
import { computed } from 'vue'
import { useCasesStore } from '@/stores/cases'
import { useRunnerStore } from '@/stores/runner'
import { fetchSettings } from '@/api/settings'

const casesStore = useCasesStore()
const runnerStore = useRunnerStore()

const currentCase = computed(() => casesStore.currentCase)

const statusLabel = computed(() => {
  if (!currentCase.value) return ''
  const status = currentCase.value.status
  return {
    passed: '执行通过',
    failed: '执行失败',
    paused: '断点暂停',
    never_run: '未运行',
    running: '正在执行...'
  }[status] || status
})

const runButtonText = computed(() => {
  if (!currentCase.value) return '▶ 开始执行'
  const status = currentCase.value.status
  if (status === 'passed') return '▶ 重新执行'
  if (status === 'paused' || status === 'failed') return '▶ 继续执行'
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
  if (!silent && !confirm(`确认要重置用例 "${currentCase.value.name}" 的断点数据吗？重置后将清除全部已完成的步骤记录，下次执行时会从第 1 步重新开始。`)) {
    return
  }

  try {
    const data = await runnerStore.reset(currentCase.value.name)
    if (data.success) {
      if (!silent) {
        await casesStore.loadCases()
        if (casesStore.currentCase?.name) {
          await casesStore.refreshCaseDetails(casesStore.currentCase.name)
        }
        alert('用例断点已重置')
      }
    }
  } catch (err) {
    console.error('重置用例失败:', err)
  }
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
        @click="runCase(true)"
      >
        ⟲ 重新跑 (清断点)
      </button>
      <button
        id="btn-reset-case"
        class="btn btn-outline-danger"
        :disabled="currentCase.status === 'running' || runnerStore.isRunning"
        @click="resetCase(false)"
      >
        清除断点
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
  </header>
</template>

<style scoped>
.gap-2 {
  gap: 8px;
}
</style>
