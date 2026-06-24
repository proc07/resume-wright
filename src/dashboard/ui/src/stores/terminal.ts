import { defineStore } from 'pinia'
import { ref } from 'vue'

export type TerminalTab = 'stream' | 'history' | 'variables'

export const useTerminalStore = defineStore('terminal', () => {
  const activeTab = ref<TerminalTab>('stream')
  const terminalHeight = ref<number>(320)
  const screenshots = ref<string[]>([])
  const lightboxImages = ref<string[]>([])
  const lightboxIndex = ref<number>(-1)
  const lightboxVisible = ref<boolean>(false)
  const activeHistoryRunId = ref<string | null>(null)

  function setTab(tab: TerminalTab) {
    activeTab.value = tab
  }

  function setTerminalHeight(h: number) {
    terminalHeight.value = h
    localStorage.setItem('terminalHeightPreference', String(h))
  }

  function loadSavedHeight() {
    const saved = localStorage.getItem('terminalHeightPreference')
    if (saved) terminalHeight.value = Number(saved)
  }

  function setScreenshots(list: string[]) {
    screenshots.value = list
  }

  function openLightbox(index: number, customImages?: string[]) {
    const list = customImages || screenshots.value
    if (index < 0 || index >= list.length) return
    lightboxImages.value = list
    lightboxIndex.value = index
    lightboxVisible.value = true
  }

  function closeLightbox() {
    lightboxVisible.value = false
  }

  function navigateLightbox(direction: number) {
    if (lightboxImages.value.length <= 1) return
    let next = lightboxIndex.value + direction
    if (next < 0) next = lightboxImages.value.length - 1
    else if (next >= lightboxImages.value.length) next = 0
    lightboxIndex.value = next
  }

  function setActiveHistoryRunId(runId: string | null) {
    activeHistoryRunId.value = runId
  }

  return {
    activeTab,
    terminalHeight,
    screenshots,
    lightboxImages,
    lightboxIndex,
    lightboxVisible,
    activeHistoryRunId,
    setTab,
    setTerminalHeight,
    loadSavedHeight,
    setScreenshots,
    openLightbox,
    closeLightbox,
    navigateLightbox,
    setActiveHistoryRunId,
  }
})
