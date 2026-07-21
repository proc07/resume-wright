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
  return hasSubDetail || hasShared || hasRole || hasScreenshots || hasCompleted || hasBaselineErr
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
  return hasSubDetail || hasShared || hasRole || hasScreenshots || hasCacheRerunErr
})

// Tab 自动回退：若当前 Tab 的数据消失则切换到另一个
watch([hasBaselineData, hasCacheRerunData], ([baselineAvail, rerunAvail]) => {
  if (activeTab.value === 'cache-rerun' && !rerunAvail && baselineAvail) {
    activeTab.value = 'baseline'
  } else if (activeTab.value === 'baseline' && !baselineAvail && rerunAvail) {
    activeTab.value = 'cache-rerun'
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
      <CaseHeader />

      <!-- 详细卡片网格 -->
      <div class="details-grid">
        <!-- 步骤进度列表 -->
        <div class="card card-steps">
          <h3>用例步骤树</h3>
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
          @update:active-tab="activeTab = $event"
        />
      </div>
    </div>
    
    <!-- 虚拟控制台终端 -->
    <TerminalPanel />
  </div>
</template>
