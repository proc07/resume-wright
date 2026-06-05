<script setup lang="ts">
import { computed } from 'vue'
import { playTrace } from '@/api/run'

const props = defineProps<{
  caseName: string
  step: {
    id: string
    role: string
    completed: boolean
    subStepsCount: number
  }
  index: number
  isFailed: boolean
  isRunning: boolean
  isActive: boolean
  hasTrace: boolean
}>()

const emit = defineEmits(['select'])

const stepClass = computed(() => {
  const classes = []
  if (props.isFailed) classes.push('failed')
  else if (props.step.completed) classes.push('completed')
  else if (props.isRunning) classes.push('running')
  
  if (props.isActive) classes.push('active-step')
  return classes
})

const indicatorText = computed(() => {
  if (props.isFailed) return '✗'
  if (props.step.completed) return '✓'
  return String(props.index + 1)
})

async function handlePlayTrace(event: Event) {
  event.stopPropagation()
  try {
    const data = await playTrace(props.caseName, `${props.step.id}-trace.zip`)
    if (!data.success) {
      alert(`无法播放录像: ${data.error || '未知错误'}`)
    }
  } catch (err) {
    console.error('播放录像失败:', err)
    alert('请求出错，请确保后端服务正常运行。')
  }
}
</script>

<template>
  <div
    class="step-node"
    :class="stepClass"
    :id="`step-node-${step.id}`"
    @click="emit('select', step.id)"
  >
    <div class="step-indicator">
      {{ indicatorText }}
    </div>
    <div class="step-info">
      <div class="step-header-row">
        <div class="step-id-container" :data-tooltip="step.id">
          <div class="step-id">{{ step.id }}</div>
        </div>
        <button
          v-if="hasTrace"
          class="btn-step-play-trace"
          title="播放该步骤录像"
          @click="handlePlayTrace"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 10px; height: 10px;">
            <polygon points="6 3 20 12 6 21 6 3" fill="currentColor"></polygon>
          </svg>
        </button>
      </div>
      <div class="step-role">角色: {{ step.role }}</div>
    </div>
  </div>
</template>
