import { onMounted, onUnmounted, type Ref } from 'vue'
import { useTerminalStore } from '@/stores/terminal'

// ── 终端拖拽调整高度 ──────────────────────────────────────────

export function useTerminalResizer(containerRef: Ref<HTMLElement | null>) {
  const terminalStore = useTerminalStore()
  let startY = 0
  let startHeight = 0

  function onMouseMove(e: MouseEvent) {
    const el = containerRef.value
    if (!el) return
    const deltaY = startY - e.clientY
    let newHeight = startHeight + deltaY
    const minH = 100
    const maxH = window.innerHeight * 0.85
    newHeight = Math.max(minH, Math.min(maxH, newHeight))
    el.style.height = `${newHeight}px`
    terminalStore.setTerminalHeight(newHeight)
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.userSelect = ''
  }

  function onMouseDown(e: MouseEvent) {
    const el = containerRef.value
    if (!el) return
    startY = e.clientY
    startHeight = parseInt(getComputedStyle(el).height, 10)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.userSelect = 'none'
  }

  onMounted(() => {
    terminalStore.loadSavedHeight()
    if (containerRef.value) {
      containerRef.value.style.height = `${terminalStore.terminalHeight}px`
    }
  })

  onUnmounted(() => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  })

  return { onMouseDown }
}
