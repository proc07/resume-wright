<script setup lang="ts">
import { computed } from 'vue'
import { useCasesStore } from '@/stores/cases'

const casesStore = useCasesStore()

const currentFilter = computed(() => casesStore.currentStatusFilter)
const counts = computed(() => casesStore.statusCounts)

function setFilter(status: string) {
  casesStore.setStatusFilter(status)
}
</script>

<template>
  <div class="status-filters">
    <span
      class="filter-pill"
      :class="{ active: currentFilter === 'all' }"
      @click="setFilter('all')"
    >
      全部 (<span>{{ counts.all }}</span>)
    </span>
    <span
      class="filter-pill"
      :class="{ active: currentFilter === 'passed' }"
      @click="setFilter('passed')"
    >
      通过 (<span>{{ counts.passed }}</span>)
    </span>
    <span
      class="filter-pill"
      :class="{ active: currentFilter === 'failed' }"
      @click="setFilter('failed')"
    >
      失败 (<span>{{ counts.failed }}</span>)
    </span>

    <span
      class="filter-pill"
      :class="{ active: currentFilter === 'never_run' }"
      @click="setFilter('never_run')"
    >
      未运行 (<span>{{ counts.never_run }}</span>)
    </span>
  </div>
</template>
