<script setup lang="ts">
import { computed } from 'vue'
import { useCasesStore } from '@/stores/cases'

const casesStore = useCasesStore()
const currentCase = computed(() => casesStore.currentCase)
const variables = computed(() => currentCase.value?.variables || {})
const variableKeys = computed(() => Object.keys(variables.value).sort())

function isObject(val: any): boolean {
  return val !== null && typeof val === 'object'
}

function formatValue(val: any): string {
  if (val === null || val === undefined) return 'null'
  if (typeof val === 'object') {
    return JSON.stringify(val, null, 2)
  }
  return String(val)
}
</script>

<template>
  <div id="pane-variables" class="variables-list-pane">
    <div v-if="variableKeys.length === 0" class="empty-msg" style="display: flex; height: 100%; min-height: 120px; align-items: center; justify-content: center; color: #64748b; font-size: 12px; text-align: center; line-height: 1.6; width: 100%;">
      当前用例暂无保存的变量数据。<br/>
      (运行带变量捕获的用例后，变量将在此处显示)
    </div>
    <div v-else class="variables-grid">
      <div
        v-for="key in variableKeys"
        :key="key"
        class="variable-card"
      >
        <div class="variable-card-header">
          <span class="variable-card-name">${{ key }}</span>
          <span class="variable-card-equal">=</span>
          <span v-if="!isObject(variables[key])" class="variable-card-value">
            {{ variables[key] }}
          </span>
          <span v-else class="variable-card-value" style="color: #818cf8; font-weight: 600;">
            Object
          </span>
        </div>
        <!-- Render formatted JSON for objects -->
        <pre v-if="isObject(variables[key])" class="variable-card-object-value"><code>{{ formatValue(variables[key]) }}</code></pre>
      </div>
    </div>
  </div>
</template>
