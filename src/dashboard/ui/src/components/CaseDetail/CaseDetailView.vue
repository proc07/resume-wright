<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useCasesStore } from '@/stores/cases'
import CaseHeader from './CaseHeader.vue'
import StepsTimeline from './StepsTimeline.vue'
import SubStepsPanel from './SubStepsPanel.vue'
import TerminalPanel from '@/components/Terminal/TerminalPanel.vue'

const casesStore = useCasesStore()

const currentCase = computed(() => casesStore.currentCase)
const selectedStepId = ref<string | null>(null)

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
            @select-step="handleSelectStep"
          />
        </div>

        <!-- 子步骤详情 -->
        <SubStepsPanel
          :case-data="currentCase"
          :selected-step-id="selectedStepId"
        />
      </div>
    </div>
    
    <!-- 虚拟控制台终端 -->
    <TerminalPanel />
  </div>
</template>
