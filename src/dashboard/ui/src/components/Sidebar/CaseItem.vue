<script setup lang="ts">
import { computed } from 'vue'
import { useCasesStore } from '@/stores/cases'
import type { CaseData } from '@/api/cases'

const props = defineProps<{
  caseData: CaseData
  depth: number
}>()

const casesStore = useCasesStore()

const isActive = computed(() => casesStore.currentCase?.name === props.caseData.name)
const isChecked = computed(() => casesStore.selectedCasePaths.has(props.caseData.filePath))
const indentStyle = computed(() => ({ marginLeft: `${props.depth * 12}px` }))
const progressText = computed(() => `${props.caseData.completedCount}/${props.caseData.totalSteps} 步骤`)
const fileName = computed(() => props.caseData.filePath.split('/').pop() || props.caseData.filePath)

function handleSelect(event: MouseEvent) {
  // Check if click was on the checkbox, if so, do nothing since change is handled by handleCheckboxChange
  const target = event.target as HTMLElement
  if (target.tagName.toLowerCase() === 'input') {
    return
  }
  casesStore.selectCase(props.caseData)
}

function handleCheckboxChange(event: Event) {
  event.stopPropagation()
  const target = event.target as HTMLInputElement
  casesStore.toggleCaseSelection(props.caseData.filePath, target.checked)
}
</script>

<template>
  <div
    class="case-item"
    :class="{ active: isActive }"
    :style="indentStyle"
    @click="handleSelect"
  >
    <div class="case-item-title">
      <div class="case-title-left">
        <input
          type="checkbox"
          class="case-select-checkbox"
          :checked="isChecked"
          @change="handleCheckboxChange"
          @click.stop
        >
        <span class="case-item-name-text" :title="caseData.name">{{ caseData.name }}</span>
      </div>
      <span class="status-dot" :class="caseData.status"></span>
    </div>
    <div class="case-item-meta">
      <span class="case-meta-left">{{ progressText }}</span>
      <span class="case-meta-right" :title="caseData.filePath"><code>{{ fileName }}</code></span>
    </div>
  </div>
</template>
