<script setup lang="ts">
import { ref, computed } from 'vue'
import { useTerminalStore } from '@/stores/terminal'
import { useTerminalResizer } from '@/composables/useTerminalResizer'
import TerminalResizer from './TerminalResizer.vue'
import StreamPane from './StreamPane.vue'
import HistoryPane from './HistoryPane.vue'
import VariablesPane from './VariablesPane.vue'

const terminalStore = useTerminalStore()
const containerRef = ref<HTMLElement | null>(null)
const streamPaneRef = ref<InstanceType<typeof StreamPane> | null>(null)

const { onMouseDown } = useTerminalResizer(containerRef)

const activeTab = computed(() => terminalStore.activeTab)

function switchTab(tab: 'stream' | 'history' | 'variables') {
  terminalStore.setTab(tab)
}

function handleClearTerminal() {
  if (streamPaneRef.value) {
    streamPaneRef.value.clear()
  }
}
</script>

<template>
  <div>
    <!-- 终端上下拖拽条 -->
    <TerminalResizer @mousedown="onMouseDown" />
    
    <!-- 虚拟终端日志 -->
    <div
      ref="containerRef"
      class="terminal-container"
      id="terminal-container"
    >
      <div class="terminal-header">
        <div class="terminal-tabs">
          <button
            class="terminal-tab-btn"
            :class="{ active: activeTab === 'stream' }"
            id="tab-btn-stream"
            @click="switchTab('stream')"
          >
            📟 实时控制台输出 (Stream Logs)
          </button>
          <button
            class="terminal-tab-btn"
            :class="{ active: activeTab === 'history' }"
            id="tab-btn-history"
            @click="switchTab('history')"
          >
            ⏳ 运行历史记录 (Run History)
          </button>
          <button
            class="terminal-tab-btn"
            :class="{ active: activeTab === 'variables' }"
            id="tab-btn-variables"
            @click="switchTab('variables')"
          >
            📦 变量可视化 (Variables Inspector)
          </button>
        </div>
        <div class="terminal-actions">
          <button
            v-if="activeTab === 'stream'"
            class="btn-clear-terminal"
            id="btn-clear-terminal"
            @click="handleClearTerminal"
          >
            清空屏幕
          </button>
        </div>
      </div>
      <div class="terminal-body-wrapper">
        <StreamPane
          v-show="activeTab === 'stream'"
          ref="streamPaneRef"
        />
        <HistoryPane
          v-show="activeTab === 'history'"
        />
        <VariablesPane
          v-show="activeTab === 'variables'"
        />
      </div>
    </div>
  </div>
</template>
