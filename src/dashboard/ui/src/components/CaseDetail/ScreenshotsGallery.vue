<script setup lang="ts">
import { computed } from 'vue'
import { useTerminalStore } from '@/stores/terminal'

const props = defineProps<{
  stepId: string
  relatedStepIds?: string[]
  source?: 'baseline' | 'cache-rerun'
  title: string
}>()

const terminalStore = useTerminalStore()

function matchesStepId(filename: string, stepId: string): boolean {
  return (
    filename.startsWith(stepId + '-') ||
    filename.includes('-' + stepId + '-') ||
    filename.endsWith('-' + stepId + '.png')
  )
}

const stepScreenshots = computed(() => {
  const allScreenshots = props.source === 'cache-rerun'
    ? terminalStore.cacheRerunScreenshots
    : terminalStore.screenshots
  const stepIds = new Set([props.stepId, ...(props.relatedStepIds || [])])
  return allScreenshots.filter((src) => {
    const parts = src.split('/')
    const filename = decodeURIComponent(parts[parts.length - 1] || '')
    return [...stepIds].some(stepId => matchesStepId(filename, stepId))
  })
})

function getFileName(src: string) {
  const parts = src.split('/')
  return decodeURIComponent(parts[parts.length - 1] || '')
}

function openLightbox(localIndex: number) {
  terminalStore.openLightbox(localIndex, stepScreenshots.value)
}
</script>

<template>
  <div v-if="stepScreenshots.length > 0" class="step-screenshots-section mt-4">
    <div class="api-cache-title" style="margin-bottom: 8px;">
      {{ props.title || '步骤运行快照' }} ({{ stepScreenshots.length }})
    </div>
    <div class="screenshots-gallery">
      <div
        v-for="(src, index) in stepScreenshots"
        :key="src"
        class="screenshot-card-wrapper"
        :data-tooltip="getFileName(src)"
      >
        <div
          class="screenshot-card"
          @click="openLightbox(index)"
        >
          <img :src="src" alt="Snapshot" loading="lazy">
          <div class="screenshot-name">
            {{ getFileName(src) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
