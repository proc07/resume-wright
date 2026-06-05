import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createRunStream, stopExecution, resetCase, resetAll as apiResetAll } from '@/api/run'
import { useCasesStore } from './cases'

export const useRunnerStore = defineStore('runner', () => {
  const caseLogs = ref<Record<string, string>>({})
  const isRunning = ref(false)
  let eventSource: EventSource | null = null

  function getSafeCaseName(name: string) {
    return encodeURIComponent(name.replace(/[/?<>\\:*|"]/g, '_'))
  }

  function appendLog(safeCase: string, text: string) {
    if (!caseLogs.value[safeCase]) caseLogs.value[safeCase] = ''
    caseLogs.value[safeCase] += text
  }

  function clearLog(safeCase: string) {
    caseLogs.value[safeCase] = ''
  }

  function getLog(safeCase: string): string {
    return caseLogs.value[safeCase] || ''
  }

  function handleLogEvent(data: { case?: string; text: string }, onAppend: (text: string) => void) {
    const casesStore = useCasesStore()
    const cleanedText = data.text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
    if (data.case) {
      appendLog(data.case, cleanedText)
      const currentSafe = casesStore.currentCase
        ? getSafeCaseName(casesStore.currentCase.name)
        : null
      if (currentSafe === data.case) {
        onAppend(cleanedText)
      }
    } else {
      const runningCases = casesStore.casesData.filter(c => c.status === 'running')
      if (runningCases.length > 0) {
        runningCases.forEach(c => appendLog(getSafeCaseName(c.name), cleanedText))
      } else if (casesStore.currentCase) {
        appendLog(getSafeCaseName(casesStore.currentCase.name), cleanedText)
      }
      if (casesStore.currentCase) {
        onAppend(cleanedText)
      }
    }
  }

  async function run(
    caseFiles: string[],
    settings: { headed: boolean; trace: boolean; screenshotOnAssert: boolean },
    onAppend: (text: string) => void,
    onFinish: () => void
  ) {
    if (isRunning.value) return
    if (eventSource) { eventSource.close(); eventSource = null }
    isRunning.value = true

    eventSource = createRunStream({ cases: caseFiles, ...settings })

    eventSource.addEventListener('log', (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      handleLogEvent(data, onAppend)
    })

    eventSource.addEventListener('finish', (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      const finishText = `\n\n[system] Process exited with code: ${data.exitCode}\n`
      const casesStore = useCasesStore()
      casesStore.casesData.filter(c => c.status === 'running').forEach(c => {
        appendLog(getSafeCaseName(c.name), finishText)
      })
      if (casesStore.currentCase) onAppend(finishText)
      eventSource?.close()
      eventSource = null
      isRunning.value = false
      onFinish()
    })

    eventSource.onerror = () => {
      const errorText = `\n\n[system] EventSource 遇到错误连接断开。\n`
      const casesStore = useCasesStore()
      if (casesStore.currentCase) {
        appendLog(getSafeCaseName(casesStore.currentCase.name), errorText)
        onAppend(errorText)
      }
      eventSource?.close()
      eventSource = null
      isRunning.value = false
      onFinish()
    }
  }

  async function stop(onAppend: (text: string) => void) {
    try {
      const data = await stopExecution()
      onAppend(`\n[system] Stop signal sent: ${data.message}\n`)
    } catch (err) {
      console.error('停止进程失败:', err)
    }
  }

  async function reset(caseName: string) {
    return resetCase(caseName)
  }

  async function resetAllCases() {
    return apiResetAll()
  }

  return {
    caseLogs,
    isRunning,
    appendLog,
    clearLog,
    getLog,
    getSafeCaseName,
    run,
    stop,
    reset,
    resetAllCases,
  }
})
