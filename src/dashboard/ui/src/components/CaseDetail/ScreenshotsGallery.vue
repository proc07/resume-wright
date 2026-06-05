<script setup lang="ts">
import { computed } from 'vue'
import { useTerminalStore } from '@/stores/terminal'

const props = defineProps<{
  stepId: string
}>()

const terminalStore = useTerminalStore()

const stepScreenshots = computed(() => {
  const allScreenshots = terminalStore.screenshots
  return allScreenshots.map((src, index) => ({ src, originalIndex: index }))
    .filter(({ src }) => {
      const parts = src.split('/')
      const filename = decodeURIComponent(parts[parts.length - 1] || '')
      return (
        filename.startsWith(props.stepId + '-') ||
        filename.includes('-' + props.stepId + '-') ||
        filename.endsWith('-' + props.stepId + '.png')
      )
    })
})

function getFileName(src: string) {
  const parts = src.split('/')
  return decodeURIComponent(parts[parts.length - 1] || '')
}

function openLightbox(originalIndex: number) {
  terminalStore.openLightbox(originalIndex)
}
</script>

<template>
  <div v-if="stepScreenshots.length > 0" class="step-screenshots-section mt-4">
    <div class="api-cache-title" style="margin-bottom: 8px;">
      📸 步骤运行快照 ({{ stepScreenshots.length }})
    </div>
    <div class="screenshots-gallery">
      <div
        v-for="ss in stepScreenshots"
        :key="ss.src"
        class="screenshot-card-wrapper"
        :data-tooltip="getFileName(ss.src)"
      >
        <div
          class="screenshot-card"
          @click="openLightbox(ss.originalIndex)"
        >
          <img :src="ss.src" alt="Snapshot" loading="lazy">
          <div class="screenshot-name">
            {{ getFileName(ss.src) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
