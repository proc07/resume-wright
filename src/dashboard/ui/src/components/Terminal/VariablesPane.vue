<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCasesStore } from '@/stores/cases'

const casesStore = useCasesStore()
const currentCase = computed(() => casesStore.currentCase)
const variables = computed(() => currentCase.value?.variables || {})
const variableKeys = computed(() => Object.keys(variables.value).sort())

const searchQuery = ref('')

// 根据搜索关键词过滤变量名或变量值
const filteredKeys = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return variableKeys.value

  return variableKeys.value.filter(key => {
    // 匹配变量名
    if (key.toLowerCase().includes(query)) return true

    // 匹配变量值
    const val = variables.value[key]
    if (val === null || val === undefined) return false

    if (typeof val === 'object') {
      try {
        return JSON.stringify(val).toLowerCase().includes(query)
      } catch {
        return false
      }
    }
    return String(val).toLowerCase().includes(query)
  })
})

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
    <!-- 暂无变量数据状态 -->
    <div v-if="variableKeys.length === 0" class="empty-msg" style="display: flex; height: 100%; min-height: 120px; align-items: center; justify-content: center; color: #64748b; font-size: 12px; text-align: center; line-height: 1.6; width: 100%;">
      当前用例暂无保存的变量数据。<br/>
      (运行带变量捕获的用例后，变量将在此处显示)
    </div>

    <div v-else style="display: flex; flex-direction: column; width: 100%;">
      <!-- 搜索框 -->
      <div class="variables-search-container">
        <div class="variables-search-wrapper">
          <span class="variables-search-icon">🔍</span>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索变量名或值..."
            class="variables-search-input"
          />
          <button
            v-if="searchQuery"
            class="variables-search-clear"
            @click="searchQuery = ''"
          >
            ×
          </button>
        </div>
      </div>

      <!-- 搜索结果为空状态 -->
      <div v-if="filteredKeys.length === 0" class="empty-msg" style="display: flex; height: 100%; min-height: 100px; align-items: center; justify-content: center; color: #64748b; font-size: 12px; text-align: center; width: 100%;">
        未找到匹配的变量。
      </div>

      <!-- 变量列表展示 -->
      <div v-else class="variables-grid">
        <div
          v-for="key in filteredKeys"
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
  </div>
</template>
