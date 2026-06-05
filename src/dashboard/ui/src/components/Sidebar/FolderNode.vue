<script setup lang="ts">
import { computed } from 'vue'
import { useCasesStore } from '@/stores/cases'
import CaseItem from './CaseItem.vue'

// Define the TreeNode type locally to avoid circular dependencies
export interface TreeNode {
  name: string
  type: 'folder' | 'case'
  path: string
  children?: TreeNode[]
  caseData?: any // CaseData
}

const props = defineProps<{
  node: TreeNode
  depth: number
}>()

const casesStore = useCasesStore()

const isCollapsed = computed(() => casesStore.collapsedFolders.has(props.node.path))
const indentStyle = computed(() => ({ paddingLeft: `${props.depth * 12}px` }))

const folderState = computed(() => casesStore.getFolderSelectedState(props.node.path))
const isChecked = computed(() => folderState.value === 'all')
const isIndeterminate = computed(() => folderState.value === 'partial')

function toggleCollapse(event: Event) {
  event.stopPropagation()
  casesStore.toggleFolderCollapse(props.node.path)
}

function handleCheckboxChange(event: Event) {
  event.stopPropagation()
  const target = event.target as HTMLInputElement
  casesStore.toggleFolderSelection(props.node.path, target.checked)
}
</script>

<template>
  <div class="folder-node" :class="{ collapsed: isCollapsed }">
    <div
      class="folder-header"
      :style="indentStyle"
      @click="toggleCollapse"
    >
      <span class="folder-toggle-icon">{{ isCollapsed ? '▶' : '▼' }}</span>
      <input
        type="checkbox"
        class="folder-select-checkbox"
        :checked="isChecked"
        :indeterminate="isIndeterminate"
        @change="handleCheckboxChange"
        @click.stop
      >
      <span class="folder-icon">📁</span>
      <div class="folder-name-container" :data-tooltip="node.name">
        <span class="folder-name-text">{{ node.name }}</span>
      </div>
    </div>
    
    <div v-show="!isCollapsed" class="folder-children">
      <template v-for="child in node.children" :key="child.path">
        <FolderNode
          v-if="child.type === 'folder'"
          :node="child"
          :depth="depth + 1"
        />
        <CaseItem
          v-else-if="child.type === 'case' && child.caseData"
          :case-data="child.caseData"
          :depth="depth + 1"
        />
      </template>
    </div>
  </div>
</template>
