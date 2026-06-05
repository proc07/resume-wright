<script setup lang="ts">
import { computed } from 'vue'
import { useCasesStore } from '@/stores/cases'
import type { CaseData } from '@/api/cases'
import FolderNode, { type TreeNode } from './FolderNode.vue'
import CaseItem from './CaseItem.vue'

const casesStore = useCasesStore()

const treeNodes = computed(() => {
  const cases = casesStore.filteredCases
  return buildAndSortTree(cases)
})

function buildAndSortTree(cases: CaseData[]): TreeNode[] {
  const root: TreeNode = { name: 'Root', type: 'folder', path: 'cases', children: [] }

  for (const c of cases) {
    const relativePath = c.filePath.replace(/^cases\//, '')
    const parts = relativePath.split('/')
    
    let currentNode = root
    let currentPath = 'cases'

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      currentPath = currentPath + '/' + part
      const isLast = (i === parts.length - 1)

      if (isLast) {
        currentNode.children = currentNode.children || []
        currentNode.children.push({
          name: c.name,
          type: 'case',
          path: c.filePath,
          caseData: c
        })
      } else {
        currentNode.children = currentNode.children || []
        let folder = currentNode.children.find(
          child => child.type === 'folder' && child.name === part
        )
        if (!folder) {
          folder = {
            name: part,
            type: 'folder',
            path: currentPath,
            children: []
          }
          currentNode.children.push(folder)
        }
        currentNode = folder
      }
    }
  }

  const nodes = root.children || []
  sortTree(nodes)
  return nodes
}

function sortTree(nodes: TreeNode[]) {
  nodes.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'folder' ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
  
  for (const node of nodes) {
    if (node.type === 'folder' && node.children) {
      sortTree(node.children)
    }
  }
}
</script>

<template>
  <div class="case-list">
    <div v-if="treeNodes.length === 0" class="empty-msg">
      未找到匹配的用例
    </div>
    <template v-else>
      <template v-for="node in treeNodes" :key="node.path">
        <FolderNode
          v-if="node.type === 'folder'"
          :node="node"
          :depth="0"
        />
        <CaseItem
          v-else-if="node.type === 'case' && node.caseData"
          :case-data="node.caseData"
          :depth="0"
        />
      </template>
    </template>
  </div>
</template>
