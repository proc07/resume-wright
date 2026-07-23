<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useCasesStore } from '@/stores/cases'
import { useTerminalStore } from '@/stores/terminal'
import CaseHeader from './CaseHeader.vue'
import StepsTimeline from './StepsTimeline.vue'
import SubStepsPanel from './SubStepsPanel.vue'
import TerminalPanel from '@/components/Terminal/TerminalPanel.vue'

const casesStore = useCasesStore()
const terminalStore = useTerminalStore()

const currentCase = computed(() => casesStore.currentCase)
const selectedStepId = ref<string | null>(null)
const activeTab = ref<'baseline' | 'cache-rerun'>('baseline')

// 判断是否有首次运行数据（全局，不依赖选中步骤）
const hasBaselineData = computed(() => {
  if (!currentCase.value) return false
  const hasSubDetail = Object.keys(currentCase.value.subStepsDetail || {}).length > 0
  const hasShared = (currentCase.value.sharedBootstrapCache || []).length > 0
  const hasRole = Object.keys(currentCase.value.roleCaches || {}).some(
    r => (currentCase.value!.roleCaches?.[r]?.length || 0) > 0
  )
  const hasScreenshots = terminalStore.screenshots.length > 0
  const hasCompleted = currentCase.value.steps.some(s => s.completed)
  const hasBaselineErr = Boolean(currentCase.value.baselineError)
  const isNotNeverRun = currentCase.value.status !== 'never_run'
  return hasSubDetail || hasShared || hasRole || hasScreenshots || hasCompleted || hasBaselineErr || isNotNeverRun
})

// 判断是否有缓存重新运行数据（全局）
const hasCacheRerunData = computed(() => {
  if (!currentCase.value) return false
  const hasSubDetail = Object.keys(currentCase.value.cacheRerunSubStepsDetail || {}).length > 0
  const hasShared = (currentCase.value.cacheRerunSharedBootstrapCache || []).length > 0
  const hasRole = Object.keys(currentCase.value.cacheRerunRoleCaches || {}).some(
    r => (currentCase.value!.cacheRerunRoleCaches?.[r]?.length || 0) > 0
  )
  const hasScreenshots = terminalStore.cacheRerunScreenshots.length > 0
  const hasCacheRerunErr = Boolean(currentCase.value.cacheRerunError)
  const hasDurations = Boolean(currentCase.value.cacheRerunDuration) || Object.keys(currentCase.value.cacheRerunStepDurations || {}).length > 0
  return hasSubDetail || hasShared || hasRole || hasScreenshots || hasCacheRerunErr || hasDurations
})

// Tab 自动切换：有新生成的 cache-rerun 数据时自动切到 cache-rerun，若 rerun 数据清空则切回 baseline
watch([hasBaselineData, hasCacheRerunData], ([baselineAvail, rerunAvail], oldVals) => {
  const oldRerunAvail = oldVals?.[1] ?? false
  if (rerunAvail && !oldRerunAvail) {
    activeTab.value = 'cache-rerun'
  } else if (activeTab.value === 'cache-rerun' && !rerunAvail && baselineAvail) {
    activeTab.value = 'baseline'
  }
}, { immediate: true })

// When currentCase changes, select the first uncompleted step or the first step
watch(
  () => currentCase.value?.name,
  (newName) => {
    if (newName && currentCase.value) {
      const c = currentCase.value
      const firstActive = c.steps.find(s => !s.completed) || c.steps[0]
      selectedStepId.value = firstActive ? firstActive.id : null
    } else {
      selectedStepId.value = null
    }
  },
  { immediate: true }
)

function handleSelectStep(stepId: string) {
  selectedStepId.value = stepId
}
</script>

<template>
  <div id="welcome-view" v-if="!currentCase" class="welcome-container">
    <div class="welcome-card">
      <span class="welcome-icon">⚡</span>
      <h2>欢迎使用 ResumeWright 可视化控制台</h2>
      <p>在左侧选择测试用例，即可查看详细断点完成进度、重跑用例、进行断点续跑并实时观看终端流式执行日志。</p>
    </div>
  </div>

  <div id="details-view" v-else class="details-container">
    <div class="details-scroll-area">
      <CaseHeader v-model:active-tab="activeTab" />

      <!-- 详细卡片网格 -->
      <div class="details-grid">
        <!-- 步骤进度列表 -->
        <div class="card card-steps">
          <div class="steps-tree-header">
            <h3>用例步骤树</h3>
            <div v-if="hasBaselineData || hasCacheRerunData" class="mode-switch-tabs">
              <button
                v-if="hasBaselineData"
                class="mode-tab-btn"
                :class="{ active: activeTab === 'baseline' }"
                title="切换查看首次运行日志与截图"
                @click="activeTab = 'baseline'"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                首次
              </button>
              <button
                v-if="hasCacheRerunData"
                class="mode-tab-btn"
                :class="{ active: activeTab === 'cache-rerun' }"
                title="切换查看缓存重新运行日志与 Diff 接口对比"
                @click="activeTab = 'cache-rerun'"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
                缓存
              </button>
            </div>
          </div>
          <StepsTimeline
            :case-data="currentCase"
            :selected-step-id="selectedStepId"
            :active-tab="activeTab"
            @select-step="handleSelectStep"
          />
        </div>

        <!-- 子步骤详情 -->
        <SubStepsPanel
          :case-data="currentCase"
          :selected-step-id="selectedStepId"
          :active-tab="activeTab"
          :has-baseline-data="hasBaselineData"
          :has-cache-rerun-data="hasCacheRerunData"
        />
      </div>
    </div>
    
    <!-- 虚拟控制台终端 -->
    <TerminalPanel />
  </div>
</template>

<style scoped>
.steps-tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.steps-tree-header h3 {
  margin: 0;
}

.mode-switch-tabs {
  display: inline-flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.05);
  padding: 2px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  gap: 2px;
}

.mode-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 500;
  color: #94a3b8;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1.2;
}

.mode-tab-btn:hover {
  color: #f1f5f9;
  background: rgba(255, 255, 255, 0.08);
}

.mode-tab-btn.active {
  color: #ffffff;
  background: var(--color-brand, #6366f1);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
</style>
