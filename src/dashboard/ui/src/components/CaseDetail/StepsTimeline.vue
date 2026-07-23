<script setup lang="ts">
import type { CaseData, CaseStep } from '@/api/cases'
import StepNode from './StepNode.vue'

const props = defineProps<{
  caseData: CaseData
  selectedStepId: string | null
  activeTab: 'baseline' | 'cache-rerun'
}>()

const emit = defineEmits(['select-step'])

function getFailedStepIndex(caseData: CaseData): number {
  const rerunDetails = caseData.cacheRerunSubStepsDetail || {}
  
  // 1. 优先在子步骤明细中定位显式失败的 step
  for (let i = 0; i < caseData.steps.length; i++) {
    const stepId = caseData.steps[i].id
    const detail = rerunDetails[stepId]
    if (detail) {
      const hasFailed = Object.values(detail).some(
        (sub: any) => sub.status === 'failed' || (sub.error && sub.status !== 'completed')
      )
      if (hasFailed) return i
    }
  }

  // 2. 若存在 cacheRerunError 但子步骤未判定到失败，定位到最后触发的子步骤
  if (caseData.cacheRerunError) {
    const rerunStepIds = Object.keys(rerunDetails)
    if (rerunStepIds.length > 0) {
      const lastRerunStepId = rerunStepIds[rerunStepIds.length - 1]
      const idx = caseData.steps.findIndex(s => s.id === lastRerunStepId)
      if (idx !== -1) return idx
    }
    return 0
  }

  return -1
}

function isFailedStep(step: CaseStep, index: number): boolean {
  const stepId = step.id

  if (props.activeTab === 'cache-rerun') {
    const failedIdx = getFailedStepIndex(props.caseData)
    if (failedIdx !== -1) {
      return index === failedIdx
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

  if (props.caseData.baselineError && !step.completed) {
    const firstUncompleted = props.caseData.steps.find(s => !s.completed)
    if (firstUncompleted && firstUncompleted.id === stepId) {
      return true
    }
  }

  return false
}

function isCompletedStep(step: CaseStep, index: number): boolean {
  const stepId = step.id

  if (props.activeTab === 'cache-rerun') {
    const hasRerunData = Object.keys(props.caseData.cacheRerunSubStepsDetail || {}).length > 0 ||
      Boolean(props.caseData.cacheRerunError) ||
      Boolean(props.caseData.cacheRerunDuration)
    if (!hasRerunData) return false

    const failedIdx = getFailedStepIndex(props.caseData)
    if (failedIdx !== -1) {
      // 存在失败步骤时，只有 index < failedIdx 的步骤才是真正缓存重跑完成的步骤
      return index < failedIdx
    }

    // 缓存重跑成功通过：全量步骤均为 completed
    return true
  }

  // ── Baseline (首次运行 Tab) ──────────────────────────────
  if (step.completed) return true

  const baseDetail = props.caseData.subStepsDetail?.[stepId]
  if (baseDetail && Object.keys(baseDetail).length > 0) {
    const allCompleted = Object.values(baseDetail).every((sub: any) => sub.status === 'completed')
    const noFailed = !Object.values(baseDetail).some((sub: any) => sub.status === 'failed')
    if (allCompleted && noFailed) return true
  }

  return false
}

function isSkippedStep(step: CaseStep, _index: number): boolean {
  if (!step.skipped) return false

  if (props.activeTab === 'baseline') {
    // 首次运行 Tab：如果 baseline 运行无报错且该步骤在 baseline 已完成，说明首次运行时并未跳过
    if (!props.caseData.baselineError && step.completed) {
      return false
    }
  }

  return true
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
      :step="{
        ...step,
        completed: isCompletedStep(step, index),
        skipped: isSkippedStep(step, index),
        duration: activeTab === 'cache-rerun'
          ? (caseData.cacheRerunStepDurations?.[step.id] ?? step.duration)
          : step.duration
      }"
      :index="index"
      :is-failed="isFailedStep(step, index)"
      :is-running="isRunningStep(index)"
      :is-active="selectedStepId === step.id"
      :has-trace="hasStepTrace(step.id)"
      @select="(id) => emit('select-step', id)"
    />
  </div>
</template>
