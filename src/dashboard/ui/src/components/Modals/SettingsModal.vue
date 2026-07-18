<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { fetchSettings, saveSettings } from '@/api/settings'

const emit = defineEmits(['close'])

const headed = ref(true)
const trace = ref(true)
const screenshotOnAssert = ref(true)
const apiCache = ref(true)
const cacheGet = ref(true)
const concurrency = ref(3)

async function load() {
  try {
    const settings = await fetchSettings()
    if (settings) {
      headed.value = !!settings.headed
      trace.value = !!settings.trace
      screenshotOnAssert.value = !!settings.screenshotOnAssert
      apiCache.value = settings.apiCache !== false
      cacheGet.value = settings.cacheGet !== false
      concurrency.value = typeof settings.concurrency === 'number' ? settings.concurrency : 3
    }
  } catch (err) {
    console.error('加载设置失败:', err)
  }
}

async function save() {
  // 强行纠正非合理并发数（必须在 1 ~ 10 之间）
  let val = Number(concurrency.value);
  if (isNaN(val) || val < 1) val = 1;
  if (val > 10) val = 10;
  concurrency.value = val;

  try {
    await saveSettings({
      headed: headed.value,
      trace: trace.value,
      screenshotOnAssert: screenshotOnAssert.value,
      apiCache: apiCache.value,
      cacheGet: cacheGet.value,
      concurrency: val
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
              <span class="switch-title">启用 API 顺序缓存</span>
              <span class="switch-subtitle">按请求发起顺序记录写接口响应，缓存跑时逐条回放，避免重复副作用</span>
            </div>
            <div class="switch-control">
              <input type="checkbox" v-model="apiCache" @change="save">
              <span class="slider"></span>
            </div>
          </label>
          <label class="modal-switch-row">
            <div class="switch-desc">
              <span class="switch-title">包含 GET 请求</span>
              <span class="switch-subtitle">同时按顺序记录 GET 响应；需先启用 API 顺序缓存</span>
            </div>
            <div class="switch-control">
              <input type="checkbox" v-model="cacheGet" :disabled="!apiCache" @change="save">
              <span class="slider"></span>
            </div>
          </label>
          <div class="modal-switch-row" style="cursor: default;">
            <div class="switch-desc">
              <span class="switch-title">并发执行数量 (--concurrency)</span>
              <span class="switch-subtitle">并行运行多个用例时，允许同时执行的最大并发 Case 数量</span>
            </div>
            <div class="concurrency-control">
              <input 
                type="number" 
                v-model.number="concurrency" 
                min="1" 
                max="10" 
                @change="save"
                style="width: 80px; text-align: center; background-color: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 12px; font-size: 13px; color: var(--text-primary); outline: none; transition: var(--transition);"
              >
            </div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" @click="close">确认并关闭</button>
      </div>
    </div>
  </div>
</template>
