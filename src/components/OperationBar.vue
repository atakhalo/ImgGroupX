<script setup lang="ts">
import type { ImageItem } from '../types'
import { state } from '../stores/imageStore'
import { ref, onMounted, onUnmounted } from 'vue'

defineProps<{
  item?: ImageItem
  scale: number
  isFullscreen: boolean
  panMode: boolean
}>()

const emit = defineEmits<{
  close: []
  zoomIn: []
  zoomOut: []
  fitToWindow: []
  toggleFullscreen: []
  togglePan: []
  openExplorer: []
  openDefault: []
  openWith: [program: string]
  deleteImage: []
}>()

const showOpenMenu = ref(false)
const openMenuRef = ref<HTMLElement | null>(null)

function onClickOutside(e: MouseEvent) {
  if (showOpenMenu.value && openMenuRef.value && !openMenuRef.value.contains(e.target as Node)) {
    showOpenMenu.value = false
  }
}
onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))

function toggleInfo() {
  state.showImageInfo = !state.showImageInfo
}
</script>

<template>
  <div class="operation-bar">
    <!-- 左侧：适应窗口 / 放大 / 缩小 / 平移 -->
    <div class="op-left">
      <button class="op-btn" :title="$t('image.fit_window')" @click="emit('fitToWindow')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"/>
        </svg>
      </button>
      <button class="op-btn" :title="$t('image.zoom_in')" @click="emit('zoomIn')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
      </button>
      <span class="zoom-text">{{ Math.round(scale * 100) }}%</span>
      <button class="op-btn" :title="$t('image.zoom_out')" @click="emit('zoomOut')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          <line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
      </button>
      <button class="op-btn" :class="{ active: panMode }" :title="$t('image.pan')" @click="emit('togglePan')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2v20M2 12h20M5 5l14 14M19 5l-14 14"/>
        </svg>
      </button>
    </div>

    <!-- 右侧：全屏 / 信息显隐 / 打开菜单 / 关闭 -->
    <div class="op-right">
      <button class="op-btn" :title="isFullscreen ? $t('viewer.exit_fullscreen') : $t('viewer.fullscreen')" @click="emit('toggleFullscreen')">
        <svg v-if="!isFullscreen" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
        </svg>
        <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
        </svg>
      </button>
      <button class="op-btn" :title="state.showImageInfo ? $t('viewer.hide_info') : $t('viewer.show_info')" @click="toggleInfo">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
        </svg>
      </button>

      <!-- 打开菜单 -->
      <div class="open-btn-group" ref="openMenuRef">
        <button class="op-btn" :title="$t('viewer.open')" @click="showOpenMenu = !showOpenMenu">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </button>
        <div v-if="showOpenMenu" class="open-dropdown">
          <button @click="emit('openExplorer'); showOpenMenu = false">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            {{ $t('viewer.explorer') }}
          </button>
          <button @click="emit('openDefault'); showOpenMenu = false">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            {{ $t('viewer.default') }}
          </button>
          <div v-if="state.settings.openWithPrograms.length" class="open-separator"></div>
          <button
            v-for="(prog, i) in state.settings.openWithPrograms"
            :key="'owp' + i"
            :title="prog"
            @click="emit('openWith', prog); showOpenMenu = false"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            {{ prog.split(/[/\\]/).pop()?.replace(/\.exe$/i, '') || prog }}
          </button>
        </div>
      </div>

      <button class="op-btn delete-btn" :title="$t('control.delete_title')" @click="emit('deleteImage')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
      <button class="op-btn close-btn" :title="$t('viewer.close')" @click="emit('close')">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.operation-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(30, 30, 50, 0.85);
  backdrop-filter: blur(8px);
  border-radius: 12px;
  padding: 6px 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.op-left,
.op-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.zoom-text {
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  padding: 0 4px;
}

.op-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  padding: 6px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}

.op-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: white;
}

.op-btn.active {
  background: rgba(100, 108, 255, 0.25);
  color: #aab0ff;
}

.close-btn:hover {
  background: rgba(255, 60, 60, 0.3);
  color: #ff6b6b;
}

.delete-btn:hover {
  background: rgba(255, 60, 60, 0.3);
  color: #ff6b6b;
}

/* 打开按钮下拉菜单 */
.open-btn-group {
  position: relative;
}

.open-dropdown {
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 6px;
  background: #252545;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  overflow: hidden;
  min-width: 150px;
  z-index: 20;
}

.open-dropdown button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 14px;
  background: transparent;
  border: none;
  color: rgba(255,255,255,0.7);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  text-align: left;
}

.open-dropdown button:hover {
  background: rgba(255,255,255,0.08);
  color: white;
}

.open-separator {
  height: 1px;
  background: rgba(255,255,255,0.08);
  margin: 4px 8px;
}
</style>
