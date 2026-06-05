<script setup lang="ts">
import { computed, watch, onUnmounted } from 'vue'
import { useTerminalStore } from '@/stores/terminal'

const terminalStore = useTerminalStore()

const visible = computed(() => terminalStore.lightboxVisible)
const currentIndex = computed(() => terminalStore.lightboxIndex)
const screenshots = computed(() => terminalStore.screenshots)

const currentImageSrc = computed(() => {
  if (currentIndex.value >= 0 && currentIndex.value < screenshots.value.length) {
    return screenshots.value[currentIndex.value]
  }
  return ''
})

const currentImageName = computed(() => {
  const src = currentImageSrc.value
  if (!src) return ''
  const parts = src.split('/')
  return decodeURIComponent(parts[parts.length - 1])
})

function close() {
  terminalStore.closeLightbox()
}

function handleOutsideClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (
    !target.closest('#lightbox-img') &&
    !target.closest('.lightbox-nav-btn')
  ) {
    close()
  }
}

function navigate(direction: number) {
  terminalStore.navigateLightbox(direction)
}

function handleKeydown(e: KeyboardEvent) {
  if (!visible.value) return
  if (e.key === 'ArrowRight') {
    navigate(1)
  } else if (e.key === 'ArrowLeft') {
    navigate(-1)
  } else if (e.key === 'Escape') {
    close()
  }
}

watch(visible, (newVal) => {
  if (newVal) {
    document.addEventListener('keydown', handleKeydown)
  } else {
    document.removeEventListener('keydown', handleKeydown)
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div
    v-if="visible"
    id="lightbox-modal"
    class="lightbox-overlay"
    @click="handleOutsideClick"
  >
    <button class="lightbox-close-btn" @click="close">&times;</button>
    <button
      v-if="screenshots.length > 1"
      class="lightbox-nav-btn prev-btn"
      @click="navigate(-1)"
    >
      &lsquo;
    </button>
    <div class="lightbox-content">
      <img id="lightbox-img" :src="currentImageSrc" alt="Lightbox Preview">
      <div id="lightbox-caption" class="lightbox-caption">{{ currentImageName }}</div>
    </div>
    <button
      v-if="screenshots.length > 1"
      class="lightbox-nav-btn next-btn"
      @click="navigate(1)"
    >
      &rsquo;
    </button>
  </div>
</template>
