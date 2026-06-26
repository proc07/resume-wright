<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useCasesStore } from '@/stores/cases'
import { useRunnerStore } from '@/stores/runner'
import { useLogColorizer } from '@/composables/useLogColorizer'

const casesStore = useCasesStore()
const runnerStore = useRunnerStore()
const { colorizeLogs } = useLogColorizer()

const preRef = ref<HTMLElement | null>(null)
const shouldAutoScroll = ref(true)
const hasScrollableContent = ref(false)

const logsHtml = computed(() => {
  if (!casesStore.currentCase) return '等待指令...'
  const safeName = runnerStore.getSafeCaseName(casesStore.currentCase.name, casesStore.currentCase.filePath)
  return colorizeLogs(runnerStore.getLog(safeName)) || '等待指令...'
})

function updateScrollState() {
  if (preRef.value) {
    const { scrollTop, scrollHeight, clientHeight } = preRef.value
    hasScrollableContent.value = scrollHeight > clientHeight
    // 判断当前是否非常接近最底部（保留 15px 的触发缓冲区）
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 15
    shouldAutoScroll.value = isAtBottom
  }
}

function handleScroll() {
  updateScrollState()
}

function scrollToBottom() {
  if (preRef.value) {
    preRef.value.scrollTop = preRef.value.scrollHeight
    shouldAutoScroll.value = true
  }
}

watch(logsHtml, () => {
  nextTick(() => {
    if (preRef.value) {
      hasScrollableContent.value = preRef.value.scrollHeight > preRef.value.clientHeight
    }
    if (shouldAutoScroll.value) {
      scrollToBottom()
    }
  })
})

onMounted(() => {
  scrollToBottom()
  nextTick(() => {
    updateScrollState()
  })
})

defineExpose({
  clear() {
    if (casesStore.currentCase) {
      const safeName = runnerStore.getSafeCaseName(casesStore.currentCase.name, casesStore.currentCase.filePath)
      runnerStore.clearLog(safeName)
    }
  }
})
</script>

<template>
  <div id="pane-stream" class="terminal-pane">
    <pre
      ref="preRef"
      id="terminal-body"
      class="terminal-body"
      v-html="logsHtml"
      @scroll="handleScroll"
    ></pre>

    <!-- 悬浮回到最底部按钮 -->
    <transition name="fade">
      <button
        v-if="!shouldAutoScroll && hasScrollableContent"
        class="scroll-bottom-btn"
        @click="scrollToBottom"
        title="滚动到底部"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <polyline points="19 12 12 19 5 12"></polyline>
        </svg>
      </button>
    </transition>
  </div>
</template>

<style scoped>
.terminal-pane {
  position: relative;
  width: 100%;
  height: 100%;
}

.scroll-bottom-btn {
  position: absolute;
  bottom: 20px;
  right: 24px;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: rgba(45, 212, 191, 0.85); /* cyan-400 */
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border: 1px solid rgba(45, 212, 191, 0.2);
  color: #04060a;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(45, 212, 191, 0.3), 0 2px 4px rgba(0, 0, 0, 0.15);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  outline: none;
  z-index: 10;
}

.scroll-bottom-btn:hover {
  background: rgba(45, 212, 191, 1);
  transform: translateY(-2px) scale(1.06);
  box-shadow: 0 6px 16px rgba(45, 212, 191, 0.45), 0 4px 6px rgba(0, 0, 0, 0.15);
}

.scroll-bottom-btn:active {
  transform: translateY(0) scale(0.96);
}

/* 渐显渐隐过渡动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.9);
}
</style>
