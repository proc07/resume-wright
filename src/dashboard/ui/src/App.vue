<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useCasesStore } from '@/stores/cases'
import { useRunnerStore } from '@/stores/runner'
import { fetchRunningStatus } from '@/api/run'
import AppSidebar from '@/components/Sidebar/AppSidebar.vue'
import CaseDetailView from '@/components/CaseDetail/CaseDetailView.vue'
import SettingsModal from '@/components/Modals/SettingsModal.vue'
import LightboxModal from '@/components/Modals/LightboxModal.vue'

const casesStore = useCasesStore()
const runnerStore = useRunnerStore()
const showSettings = ref(false)

onMounted(async () => {
  await casesStore.loadCases()
  try {
    const status = await fetchRunningStatus()
    if (status.running && status.cases && status.settings) {
      runnerStore.run(
        status.cases,
        status.settings,
        () => {},
        async () => {
          await casesStore.loadCases()
          if (casesStore.currentCase?.name) {
            await casesStore.refreshCaseDetails(casesStore.currentCase.name)
          }
        }
      )
    }
  } catch (err) {
    console.error('获取运行状态失败:', err)
  }
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
