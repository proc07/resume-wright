<script setup lang="ts">
import { ref, watch } from 'vue'

interface Props {
  visible: boolean
  title?: string
  message: string
  subMessage?: string
  confirmText?: string
  cancelText?: string
  type?: 'danger' | 'warning' | 'info'
}

const props = withDefaults(defineProps<Props>(), {
  title: '请确认',
  confirmText: '确认',
  cancelText: '取消',
  type: 'danger',
})

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const isVisible = ref(props.visible)

watch(() => props.visible, (val) => {
  isVisible.value = val
})

function onConfirm() {
  emit('confirm')
}

function onCancel() {
  emit('cancel')
}

function onBackdropClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('modal-backdrop')) {
    onCancel()
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="isVisible"
        class="modal-backdrop"
        @click="onBackdropClick"
      >
        <div class="modal-dialog" :class="`modal-${type}`">
          <!-- Icon -->
          <div class="modal-icon">
            <span v-if="type === 'danger'">⚠</span>
            <span v-else-if="type === 'warning'">⚡</span>
            <span v-else>ℹ</span>
          </div>

          <!-- Content -->
          <div class="modal-content">
            <h3 class="modal-title">{{ title }}</h3>
            <p class="modal-message">{{ message }}</p>
            <p v-if="subMessage" class="modal-sub-message">{{ subMessage }}</p>
          </div>

          <!-- Actions -->
          <div class="modal-actions">
            <button class="modal-btn modal-btn-cancel" @click="onCancel">
              {{ cancelText }}
            </button>
            <button class="modal-btn" :class="`modal-btn-${type}`" @click="onConfirm">
              {{ confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.modal-dialog {
  background: var(--bg-secondary, #1e2030);
  border: 1px solid var(--border-color, #2d3148);
  border-radius: 16px;
  padding: 32px 28px 24px;
  width: 100%;
  max-width: 420px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.04);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  text-align: center;
}

/* Danger border glow */
.modal-danger {
  border-color: rgba(239, 68, 68, 0.35);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(239,68,68,0.1), 0 0 24px rgba(239,68,68,0.06);
}

.modal-warning {
  border-color: rgba(245, 158, 11, 0.35);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(245,158,11,0.1), 0 0 24px rgba(245,158,11,0.06);
}

.modal-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  flex-shrink: 0;
}

.modal-danger .modal-icon {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.25);
}

.modal-warning .modal-icon {
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.25);
}

.modal-info .modal-icon {
  background: rgba(99, 102, 241, 0.12);
  color: #6366f1;
  border: 1px solid rgba(99, 102, 241, 0.25);
}

.modal-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.modal-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary, #e2e8f0);
  margin: 0;
  letter-spacing: -0.01em;
}

.modal-message {
  font-size: 14px;
  color: var(--text-secondary, #94a3b8);
  margin: 0;
  line-height: 1.6;
}

.modal-sub-message {
  font-size: 12.5px;
  color: var(--text-tertiary, #64748b);
  margin: 0;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border: 1px solid var(--border-color, #2d3148);
  line-height: 1.5;
}

.modal-actions {
  display: flex;
  gap: 10px;
  width: 100%;
  margin-top: 4px;
}

.modal-btn {
  flex: 1;
  padding: 10px 16px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
  letter-spacing: 0.01em;
}

.modal-btn-cancel {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-secondary, #94a3b8);
  border: 1px solid var(--border-color, #2d3148);
}

.modal-btn-cancel:hover {
  background: rgba(255, 255, 255, 0.09);
  color: var(--text-primary, #e2e8f0);
}

.modal-btn-danger {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  color: white;
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.35);
}

.modal-btn-danger:hover {
  background: linear-gradient(135deg, #f87171, #ef4444);
  box-shadow: 0 6px 16px rgba(239, 68, 68, 0.45);
  transform: translateY(-1px);
}

.modal-btn-warning {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: white;
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.35);
}

.modal-btn-warning:hover {
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  box-shadow: 0 6px 16px rgba(245, 158, 11, 0.45);
  transform: translateY(-1px);
}

.modal-btn-info {
  background: linear-gradient(135deg, #6366f1, #4f46e5);
  color: white;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
}

.modal-btn-info:hover {
  background: linear-gradient(135deg, #818cf8, #6366f1);
  box-shadow: 0 6px 16px rgba(99, 102, 241, 0.45);
  transform: translateY(-1px);
}

/* Transition animations */
.modal-enter-active {
  animation: modal-in 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.modal-leave-active {
  animation: modal-in 0.15s ease reverse;
}

@keyframes modal-in {
  from {
    opacity: 0;
    transform: scale(0.88) translateY(12px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
</style>
