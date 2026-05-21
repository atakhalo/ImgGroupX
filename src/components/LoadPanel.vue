<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { state, getLoadStats, releaseBase64 } from '../stores/imageStore'

const emit = defineEmits<{
  releaseAll: []
}>()

const stats = ref(getLoadStats())
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  timer = setInterval(() => {
    stats.value = getLoadStats()
  }, 2000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

function formatMemory(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const memoryFormatted = computed(() => formatMemory(stats.value.memoryBytes))

function handleRelease() {
  // 释放所有非可见图片的 base64
  const keepPaths = new Set<string>()
  releaseBase64(keepPaths)
  stats.value = getLoadStats()
  emit('releaseAll')
}
</script>

<template>
  <div class="load-panel">
    <span v-if="state.loading" class="lp-loading">
      <span class="loading-spinner-sm"></span>
      <span class="lp-scanning">{{ $t('load.scanning') }}</span>
    </span>
    <div class="lp-row">
      <span class="lp-label">{{ $t('load.total') }}</span>
      <span class="lp-value">{{ stats.total }}</span>
    </div>
    <div class="lp-row">
      <span class="lp-label">{{ $t('load.loaded') }}</span>
      <span class="lp-value">{{ stats.loaded }}</span>
    </div>
    <div class="lp-row">
      <span class="lp-label">{{ $t('load.memory') }}</span>
      <span class="lp-value">{{ memoryFormatted }}</span>
    </div>
    <button
      class="lp-release-btn"
      :disabled="stats.loaded === 0"
      :title="$t('load.release_hint')"
      @click="handleRelease"
    >
      {{ $t('load.release') }}
    </button>
  </div>
</template>

<style scoped>
.load-panel {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 12px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  font-size: 12px;
  user-select: none;
}

.lp-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.lp-label {
  color: rgba(255, 255, 255, 0.4);
}

.lp-value {
  color: rgba(255, 255, 255, 0.75);
  font-variant-numeric: tabular-nums;
}

.lp-release-btn {
  padding: 3px 10px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.6);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.lp-release-btn:hover:not(:disabled) {
  background: rgba(255, 80, 80, 0.15);
  border-color: rgba(255, 80, 80, 0.3);
  color: #ff6b6b;
}

.lp-release-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.lp-loading {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-right: 4px;
}

.lp-scanning {
  color: #aab0ff;
  font-size: 12px;
  white-space: nowrap;
}

.loading-spinner-sm {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-top-color: #646cff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
