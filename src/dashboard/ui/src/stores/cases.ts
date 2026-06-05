import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { fetchCases, fetchCaseDetails, type CaseData } from '@/api/cases'
import { useTerminalStore } from './terminal'

export const useCasesStore = defineStore('cases', () => {
  const casesData = ref<CaseData[]>([])
  const currentCase = ref<CaseData | null>(null)
  const selectedCasePaths = ref<Set<string>>(new Set())
  const currentStatusFilter = ref<string>('all')
  const searchKeyword = ref<string>('')
  const collapsedFolders = ref<Set<string>>(new Set())

  const filteredCases = computed(() => {
    let result = casesData.value
    if (currentStatusFilter.value !== 'all') {
      if (currentStatusFilter.value === 'never_run') {
        result = result.filter(c => c.status === 'never_run' || c.status === 'running')
      } else {
        result = result.filter(c => c.status === currentStatusFilter.value)
      }
    }
    const kw = searchKeyword.value.toLowerCase().trim()
    if (kw) {
      result = result.filter(c =>
        c.name.toLowerCase().includes(kw) || c.filePath.toLowerCase().includes(kw)
      )
    }
    return result
  })

  const statusCounts = computed(() => ({
    all: casesData.value.length,
    passed: casesData.value.filter(c => c.status === 'passed').length,
    failed: casesData.value.filter(c => c.status === 'failed').length,
    never_run: casesData.value.filter(c => c.status === 'never_run' || c.status === 'running').length,
  }))

  const isAllSelected = computed(() =>
    casesData.value.length > 0 && casesData.value.every(c => selectedCasePaths.value.has(c.filePath))
  )

  function getSafeCaseName(name: string) {
    return name.replace(/[/?<>\\:*|"]/g, '_')
  }

  async function loadCases() {
    try {
      const cases = await fetchCases()
      casesData.value = cases
      // restore previously selected case
      if (!currentCase.value) {
        const savedName = localStorage.getItem('selectedCaseName')
        if (savedName) {
          const found = cases.find(c => c.name === savedName)
          if (found) {
            await selectCase(found)
          }
        }
      } else {
        const updated = cases.find(c => c.name === currentCase.value!.name)
        if (updated) {
          // preserve subStepsDetail, traces and variables which come from separate API
          updated.subStepsDetail = currentCase.value.subStepsDetail
          updated.traces = currentCase.value.traces
          updated.variables = currentCase.value.variables
          currentCase.value = updated
          await refreshCaseDetails(updated.name)
        }
      }
    } catch (err) {
      console.error('加载用例失败:', err)
    }
  }

  async function selectCase(c: CaseData) {
    currentCase.value = c
    localStorage.setItem('selectedCaseName', c.name)
    try {
      const details = await fetchCaseDetails(c.name)
      const target = casesData.value.find(item => item.name === c.name)
      if (target) {
        target.subStepsDetail = details.subSteps
        target.traces = details.traces
        target.error = details.error
        target.variables = details.variables
        currentCase.value = { ...target }
      }
      useTerminalStore().setScreenshots(details.screenshots)
      return details
    } catch (err) {
      console.error('获取用例详情失败:', err)
      return null
    }
  }

  async function refreshCaseDetails(caseName: string) {
    try {
      const details = await fetchCaseDetails(caseName)
      const target = casesData.value.find(item => item.name === caseName)
      if (target) {
        target.subStepsDetail = details.subSteps
        target.traces = details.traces
        target.error = details.error
        target.variables = details.variables
        if (currentCase.value?.name === caseName) {
          currentCase.value = { ...target }
        }
      }
      useTerminalStore().setScreenshots(details.screenshots)
      return details
    } catch (err) {
      console.error('刷新用例详情失败:', err)
      return null
    }
  }

  function toggleCaseSelection(filePath: string, checked: boolean) {
    if (checked) {
      selectedCasePaths.value.add(filePath)
    } else {
      selectedCasePaths.value.delete(filePath)
    }
  }

  function toggleFolderSelection(folderPath: string, checked: boolean) {
    const prefix = folderPath + '/'
    casesData.value.forEach(c => {
      if (c.filePath.startsWith(prefix)) {
        if (checked) {
          selectedCasePaths.value.add(c.filePath)
        } else {
          selectedCasePaths.value.delete(c.filePath)
        }
      }
    })
  }

  function toggleSelectAll(checked: boolean) {
    if (checked) {
      casesData.value.forEach(c => selectedCasePaths.value.add(c.filePath))
    } else {
      selectedCasePaths.value.clear()
    }
  }

  function toggleFolderCollapse(folderPath: string) {
    if (collapsedFolders.value.has(folderPath)) {
      collapsedFolders.value.delete(folderPath)
    } else {
      collapsedFolders.value.add(folderPath)
    }
  }

  function setStatusFilter(status: string) {
    currentStatusFilter.value = status
  }

  function updateCaseStatus(caseName: string, status: CaseData['status']) {
    const c = casesData.value.find(item => item.name === caseName)
    if (c) c.status = status
    if (currentCase.value?.name === caseName) {
      currentCase.value = { ...currentCase.value, status }
    }
  }

  function getFolderSelectedState(folderPath: string): 'all' | 'none' | 'partial' {
    const prefix = folderPath + '/'
    const descendants = casesData.value.filter(c => c.filePath.startsWith(prefix))
    const checkedCount = descendants.filter(c => selectedCasePaths.value.has(c.filePath)).length
    if (checkedCount === 0) return 'none'
    if (checkedCount === descendants.length) return 'all'
    return 'partial'
  }

  return {
    casesData,
    currentCase,
    selectedCasePaths,
    currentStatusFilter,
    searchKeyword,
    collapsedFolders,
    filteredCases,
    statusCounts,
    isAllSelected,
    getSafeCaseName,
    loadCases,
    selectCase,
    refreshCaseDetails,
    toggleCaseSelection,
    toggleFolderSelection,
    toggleSelectAll,
    toggleFolderCollapse,
    setStatusFilter,
    updateCaseStatus,
    getFolderSelectedState,
  }
})
