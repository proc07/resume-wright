<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useCasesStore } from '@/stores/cases'
import { useTerminalStore } from '@/stores/terminal'
import { fetchHistory, fetchHistoryLog, type HistoryRun } from '@/api/history'
import { useLogColorizer } from '@/composables/useLogColorizer'

const casesStore = useCasesStore()
const terminalStore = useTerminalStore()
const { colorizeLogs } = useLogColorizer()

const historyRuns = ref<HistoryRun[]>([])
const historyLog = ref<string>('')
const loadingLog = ref<boolean>(false)

const currentCaseName = computed(() => casesStore.currentCase?.name)
const activeRunId = computed(() => terminalStore.activeHistoryRunId)

const historyLogHtml = computed(() => {
  if (loadingLog.value) return '加载日志中...'
  if (!historyLog.value) return '选择左侧运行记录以查看日志...'
  return colorizeLogs(historyLog.value)
})

async function loadHistory() {
  const caseName = currentCaseName.value
  if (!caseName) {
    historyRuns.value = []
    historyLog.value = ''
    terminalStore.setActiveHistoryRunId(null)
    return
  }

  try {
    const list = await fetchHistory(caseName)
    historyRuns.value = list
    
    if (list.length === 0) {
      historyLog.value = ''
      terminalStore.setActiveHistoryRunId(null)
      return
    }

    // Try to restore active run or default to the first one
    const currentId = activeRunId.value
    if (currentId && list.some(r => r.runId === currentId)) {
      selectRun(currentId)
    } else if (list[0]) {
      selectRun(list[0].runId)
    }
  } catch (err) {
    console.error('加载历史记录失败:', err)
  }
}

async function selectRun(runId: string) {
  terminalStore.setActiveHistoryRunId(runId)
  const caseName = currentCaseName.value
  if (!caseName) return

  loadingLog.value = true
  try {
    const logText = await fetchHistoryLog(caseName, runId)
    historyLog.value = logText
  } catch (err) {
    console.error('加载历史日志失败:', err)
    historyLog.value = '加载运行日志失败。'
  } finally {
    loadingLog.value = false
  }
}

function formatFriendlyDateTime(isoString: string) {
  if (!isoString) return '--'
  try {
    const date = new Date(isoString)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  } catch {
    return isoString
  }
}

function runStatusLabel(status: string) {
  if (status === 'passed') return '通过'
  if (status === 'failed') return '失败'
  if (status === 'running') return '运行中'
  return '未知'
}

watch(currentCaseName, () => {
  loadHistory()
}, { immediate: true })

// Reload history when active tab changes to history
watch(() => terminalStore.activeTab, (newTab) => {
  if (newTab === 'history') {
    loadHistory()
  }
})
</script>

<template>
  <div id="pane-history" class="terminal-pane">
    <div class="history-split-layout">
      <!-- 左栏：运行历史列表 -->
      <div class="history-sidebar" id="history-sidebar">
        <div v-if="historyRuns.length === 0" class="empty-msg">
          暂无运行历史
        </div>
        <div
          v-else
          v-for="run in historyRuns"
          :key="run.runId"
          class="history-run-item"
          :class="{ active: activeRunId === run.runId }"
          @click="selectRun(run.runId)"
        >
          <div class="run-header">
            <span class="run-status-badge" :class="run.status">
              {{ runStatusLabel(run.status) }}
            </span>
            <span class="run-time">{{ formatFriendlyDateTime(run.timestamp) }}</span>
          </div>
          <div class="run-meta">
            <span>耗时: {{ run.duration ? `${(run.duration / 1000).toFixed(1)}s` : '--' }}</span>
            <span
              v-if="run.error"
              class="run-error-indicator"
              :title="run.error"
            >
              ⚠️ 异常
            </span>
          </div>
        </div>
      </div>
      <!-- 右栏：选中的历史日志 -->
      <div class="history-content">
        <pre
          id="history-log-body"
          class="terminal-body history-log-body"
          v-html="historyLogHtml"
        ></pre>
      </div>
    </div>
  </div>
</template>
