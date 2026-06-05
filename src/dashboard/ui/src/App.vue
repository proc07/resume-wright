<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useCasesStore } from '@/stores/cases'
import AppSidebar from '@/components/Sidebar/AppSidebar.vue'
import CaseDetailView from '@/components/CaseDetail/CaseDetailView.vue'
import SettingsModal from '@/components/Modals/SettingsModal.vue'
import LightboxModal from '@/components/Modals/LightboxModal.vue'

const casesStore = useCasesStore()
const showSettings = ref(false)

onMounted(() => {
  casesStore.loadCases()
})
</script>

<template>
  <div class="dashboard-layout">
    <!-- 左侧栏：全局配置与用例列表 -->
    <AppSidebar @open-settings="showSettings = true" />

    <!-- 右侧主面板：详细信息与终端日志 -->
    <main class="main-content">
      <CaseDetailView />
    </main>

    <!-- 设置与大图预览弹窗 -->
    <SettingsModal
      v-if="showSettings"
      @close="showSettings = false"
    />
    <LightboxModal />
  </div>
</template>
