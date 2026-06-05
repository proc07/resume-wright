<script setup lang="ts">
import { computed } from 'vue'
import { useCasesStore } from '@/stores/cases'
import { useRunnerStore } from '@/stores/runner'
import { fetchSettings } from '@/api/settings'
import StatusFilters from './StatusFilters.vue'
import CaseTree from './CaseTree.vue'

const emit = defineEmits(['open-settings'])

const casesStore = useCasesStore()
const runnerStore = useRunnerStore()

const caseCount = computed(() => casesStore.casesData.length)
const isAllSelected = computed({
  get: () => casesStore.isAllSelected,
  set: (val) => casesStore.toggleSelectAll(val)
})

async function handleRunAllSelected() {
  const files = Array.from(casesStore.selectedCasePaths)
  if (files.length === 0) {
    alert('请先勾选需要运行的测试用例！')
    return
  }

  try {
    const settings = await fetchSettings()
    
    // Set status of selected cases to running in local state first
    casesStore.casesData.forEach(c => {
      if (casesStore.selectedCasePaths.has(c.filePath)) {
        casesStore.updateCaseStatus(c.name, 'running')
      }
    })

    // Clear logs for selected cases
    files.forEach(filePath => {
      const c = casesStore.casesData.find(item => item.filePath === filePath)
      if (c) {
        runnerStore.clearLog(runnerStore.getSafeCaseName(c.name))
      }
    })

    await runnerStore.run(
      files,
      settings,
      () => {}, // Let terminal watch runnerStore.caseLogs reactively
      () => {
        casesStore.loadCases()
      }
    )
  } catch (err) {
    console.error('运行已选用例失败:', err)
  }
}

async function handleResetAll() {
  if (!confirm('警告：确认要重置全部用例的断点数据吗？此操作会物理清除所有 Checkpoint 存档文件。')) {
    return
  }
  try {
    const success = await runnerStore.resetAllCases()
    if (success) {
      casesStore.loadCases()
      alert('所有用例断点已重置')
    }
  } catch (err) {
    console.error('重置所有断点失败:', err)
  }
}
</script>

<template>
  <aside class="sidebar">
    <div class="brand-container">
      <div class="brand">
        <span class="brand-logo">⚓</span>
        <div>
          <h1>ResumeWright</h1>
          <p>可恢复工作流自动化</p>
        </div>
      </div>
      <button
        id="btn-settings"
        class="btn-settings-icon"
        title="执行设置"
        @click="emit('open-settings')"
      >
        ⚙
      </button>
    </div>
    
    <!-- 全局快速操作 -->
    <div class="sidebar-section">
      <h2>全局控制</h2>
      <div class="global-actions">
        <button
          id="btn-run-all"
          class="btn btn-primary"
          :disabled="runnerStore.isRunning"
          @click="handleRunAllSelected"
        >
          ▶ 运行已选
        </button>
        <button
          id="btn-reset-all"
          class="btn btn-outline-danger"
          :disabled="runnerStore.isRunning"
          @click="handleResetAll"
        >
          ⟲ 重置所有
        </button>
      </div>
    </div>

    <!-- 用例列表 -->
    <div class="sidebar-section list-section">
      <div class="section-header">
        <h2>测试用例</h2>
        <div class="checkbox-container">
          <input
            type="checkbox"
            id="select-all-checkbox"
            class="case-select-checkbox"
            v-model="isAllSelected"
            title="全选 / 取消全选"
          >
          <label for="select-all-checkbox" class="select-all-label">全选</label>
          <span class="case-count-badge" id="case-count">{{ caseCount }}</span>
        </div>
      </div>
      <div class="case-search">
        <input
          type="text"
          id="case-search-input"
          placeholder="搜索用例名称..."
          v-model="casesStore.searchKeyword"
        >
      </div>
      
      <!-- 用例分类过滤 -->
      <StatusFilters />
      
      <CaseTree />
    </div>
  </aside>
</template>

<style scoped>
.checkbox-container {
  display: flex;
  align-items: center;
  gap: 8px;
}
.select-all-label {
  font-size: 11.5px;
  color: var(--text-secondary);
  cursor: pointer;
}
</style>
