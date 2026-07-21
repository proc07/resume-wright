<script setup lang="ts">
import type { CaseData, CaseStep } from '@/api/cases'
import StepNode from './StepNode.vue'

const props = defineProps<{
  caseData: CaseData
  selectedStepId: string | null
  activeTab: 'baseline' | 'cache-rerun'
}>()

const emit = defineEmits(['select-step'])

function isFailedStep(step: CaseStep, index: number): boolean {
  const stepId = step.id

  if (props.activeTab === 'cache-rerun') {
    const rerunDetail = props.caseData.cacheRerunSubStepsDetail?.[stepId]
    if (rerunDetail) {
      const hasFailed = Object.values(rerunDetail).some(
        (sub: any) => sub.status === 'failed' || (sub.error && sub.status !== 'completed')
      )
      if (hasFailed) return true
    }

    if (props.caseData.cacheRerunError) {
      // 若存在整体 cacheRerunError，尝试在 rerunDetail 或索引中找到对应的失败步骤
      const rerunStepIds = Object.keys(props.caseData.cacheRerunSubStepsDetail || {})
      if (rerunStepIds.length > 0) {
        const lastRerunStepId = rerunStepIds[rerunStepIds.length - 1]
        if (lastRerunStepId === stepId) return true
      } else if (index === 0) {
        return true
      }
    }
    return false
  }

  // ── Baseline (首次运行 Tab) ──────────────────────────────
  const baseDetail = props.caseData.subStepsDetail?.[stepId]
  if (baseDetail) {
    const hasFailed = Object.values(baseDetail).some(
      (sub: any) => sub.status === 'failed' || (sub.error && sub.status !== 'completed')
    )
    if (hasFailed) return true
  }

  // 仅当 baseline 自身有报错，且该步骤是未完成步骤时才判定为 baseline 失败
  if (props.caseData.baselineError && !step.completed) {
    const firstUncompleted = props.caseData.steps.find(s => !s.completed)
    if (firstUncompleted && firstUncompleted.id === stepId) {
      return true
    }
  }

  return false
}

function isCompletedStep(step: CaseStep, _index: number): boolean {
  const stepId = step.id

  if (props.activeTab === 'cache-rerun') {
    const rerunDetail = props.caseData.cacheRerunSubStepsDetail?.[stepId]
    if (rerunDetail && Object.keys(rerunDetail).length > 0) {
      const allCompleted = Object.values(rerunDetail).every((sub: any) => sub.status === 'completed')
      const noFailed = !Object.values(rerunDetail).some((sub: any) => sub.status === 'failed')
      if (allCompleted && noFailed) return true
    }
    // 缓存重跑正常完成（无 cacheRerunError 且存在 rerunDetail 步骤记录）
    if (!props.caseData.cacheRerunError && rerunDetail && Object.keys(rerunDetail).length > 0) {
      return true
    }
    return false
  }

  // ── Baseline (首次运行 Tab) ──────────────────────────────
  // 权威完成标记：step.completed (来自 Checkpoint)
  if (step.completed) return true

  const baseDetail = props.caseData.subStepsDetail?.[stepId]
  if (baseDetail && Object.keys(baseDetail).length > 0) {
    const allCompleted = Object.values(baseDetail).every((sub: any) => sub.status === 'completed')
    const noFailed = !Object.values(baseDetail).some((sub: any) => sub.status === 'failed')
    if (allCompleted && noFailed) return true
  }

  return false
}

function isRunningStep(index: number): boolean {
  return props.caseData.status === 'running' && props.caseData.completedCount === index
}

function hasStepTrace(stepId: string): boolean {
  return !!(props.caseData.traces && props.caseData.traces.includes(`${stepId}-trace.zip`))
}
</script>

<template>
  <div class="steps-timeline">
    <StepNode
      v-for="(step, index) in caseData.steps"
      :key="step.id"
      :case-name="caseData.name"
      :step="{ ...step, completed: isCompletedStep(step, index) }"
      :index="index"
      :is-failed="isFailedStep(step, index)"
      :is-running="isRunningStep(index)"
      :is-active="selectedStepId === step.id"
      :has-trace="hasStepTrace(step.id)"
      @select="(id) => emit('select-step', id)"
    />
  </div>
</template>
