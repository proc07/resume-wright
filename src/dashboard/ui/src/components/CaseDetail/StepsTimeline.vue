<script setup lang="ts">
import type { CaseData } from '@/api/cases'
import StepNode from './StepNode.vue'

const props = defineProps<{
  caseData: CaseData
  selectedStepId: string | null
}>()

const emit = defineEmits(['select-step'])

function isFailedStep(stepId: string, index: number) {
  const detail = props.caseData.subStepsDetail?.[stepId]
  const hasFailedSubStep = detail && Object.values(detail).some((sub: any) => sub.status === 'failed')
  return !!(hasFailedSubStep || (props.caseData.status === 'failed' && props.caseData.completedCount === index))
}

function isRunningStep(index: number) {
  return props.caseData.status === 'running' && props.caseData.completedCount === index
}

function hasStepTrace(stepId: string) {
  return !!(props.caseData.traces && props.caseData.traces.includes(`${stepId}-trace.zip`))
}
</script>

<template>
  <div class="steps-timeline">
    <StepNode
      v-for="(step, index) in caseData.steps"
      :key="step.id"
      :case-name="caseData.name"
      :step="step"
      :index="index"
      :is-failed="isFailedStep(step.id, index)"
      :is-running="isRunningStep(index)"
      :is-active="selectedStepId === step.id"
      :has-trace="hasStepTrace(step.id)"
      @select="(id) => emit('select-step', id)"
    />
  </div>
</template>
