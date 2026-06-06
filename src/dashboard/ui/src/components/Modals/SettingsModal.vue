<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { fetchSettings, saveSettings } from '@/api/settings'

const emit = defineEmits(['close'])

const headed = ref(true)
const trace = ref(true)
const screenshotOnAssert = ref(true)
const apiCache = ref(true)
const cacheGet = ref(true)

async function load() {
  try {
    const settings = await fetchSettings()
    if (settings) {
      headed.value = !!settings.headed
      trace.value = !!settings.trace
      screenshotOnAssert.value = !!settings.screenshotOnAssert
      apiCache.value = settings.apiCache !== false
      cacheGet.value = settings.cacheGet !== false
    }
  } catch (err) {
    console.error('加载设置失败:', err)
  }
}

async function save() {
  try {
    await saveSettings({
      headed: headed.value,
      trace: trace.value,
      screenshotOnAssert: screenshotOnAssert.value,
      apiCache: apiCache.value,
      cacheGet: cacheGet.value
    })
  } catch (err) {
    console.error('保存设置失败:', err)
  }
}

function close() {
  save()
  emit('close')
}

function handleOutsideClick(event: MouseEvent) {
  if (event.target === event.currentTarget) {
    close()
  }
}

onMounted(() => {
  load()
})
</script>

<template>
  <div id="settings-modal" class="modal-overlay" @click="handleOutsideClick">
    <div class="modal-content">
      <div class="modal-header">
        <h3>⚙ 执行配置选项</h3>
        <button class="modal-close-btn" @click="close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="modal-run-options">
          <label class="modal-switch-row">
            <div class="switch-desc">
              <span class="switch-title">显示浏览器 (--headed)</span>
              <span class="switch-subtitle">在测试运行时打开 Playwright 浏览器窗口以便观察步骤</span>
            </div>
            <div class="switch-control">
              <input type="checkbox" v-model="headed" @change="save">
              <span class="slider"></span>
            </div>
          </label>
          <label class="modal-switch-row">
            <div class="switch-desc">
              <span class="switch-title">收集执行录像 (--trace)</span>
              <span class="switch-subtitle">录制完整执行过程，并生成可在 Trace Viewer 中查看的 .zip 文件</span>
            </div>
            <div class="switch-control">
              <input type="checkbox" v-model="trace" @change="save">
              <span class="slider"></span>
            </div>
          </label>
          <label class="modal-switch-row">
            <div class="switch-desc">
              <span class="switch-title">断言成功时自动截图 (--screenshot-on-assert)</span>
              <span class="switch-subtitle">在每一个 assert_exists 成功执行后自动保存页面快照</span>
            </div>
            <div class="switch-control">
              <input type="checkbox" v-model="screenshotOnAssert" @change="save">
              <span class="slider"></span>
            </div>
          </label>
          <label class="modal-switch-row">
            <div class="switch-desc">
              <span class="switch-title">缓存写操作 (POST/PUT/DELETE/PATCH)</span>
              <span class="switch-subtitle">拦截非幂等请求并缓存响应，断点续跑时复用以避免重复调用</span>
            </div>
            <div class="switch-control">
              <input type="checkbox" v-model="apiCache" @change="save">
              <span class="slider"></span>
            </div>
          </label>
          <label class="modal-switch-row">
            <div class="switch-desc">
              <span class="switch-title">缓存读操作 (GET)</span>
              <span class="switch-subtitle">拦截并缓存 GET 请求，适用于纯前端测试需要固定数据的场景</span>
            </div>
            <div class="switch-control">
              <input type="checkbox" v-model="cacheGet" @change="save">
              <span class="slider"></span>
            </div>
          </label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" @click="close">确认并关闭</button>
      </div>
    </div>
  </div>
</template>
