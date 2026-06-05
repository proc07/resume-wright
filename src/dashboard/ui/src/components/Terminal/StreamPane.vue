<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useCasesStore } from '@/stores/cases'
import { useRunnerStore } from '@/stores/runner'
import { useLogColorizer } from '@/composables/useLogColorizer'

const casesStore = useCasesStore()
const runnerStore = useRunnerStore()
const { colorizeLogs } = useLogColorizer()

const preRef = ref<HTMLElement | null>(null)

const logsHtml = computed(() => {
  if (!casesStore.currentCase) return '等待指令...'
  const safeName = runnerStore.getSafeCaseName(casesStore.currentCase.name)
  return colorizeLogs(runnerStore.getLog(safeName)) || '等待指令...'
})

function scrollToBottom() {
  if (preRef.value) {
    preRef.value.scrollTop = preRef.value.scrollHeight
  }
}

watch(logsHtml, () => {
  nextTick(scrollToBottom)
})

onMounted(() => {
  scrollToBottom()
})

defineExpose({
  clear() {
    if (casesStore.currentCase) {
      const safeName = runnerStore.getSafeCaseName(casesStore.currentCase.name)
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
    ></pre>
  </div>
</template>
