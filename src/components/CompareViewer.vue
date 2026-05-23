<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { ImageItem } from '../types'
import { loadImageBase64 } from '../stores/imageStore'

const props = defineProps<{
  left: ImageItem
  right: ImageItem
}>()

const emit = defineEmits<{
  close: []
}>()

const leftSrc = ref('')
const rightSrc = ref('')
const splitRatio = ref(0.5)
const isDragging = ref(false)
const containerRef = ref<HTMLElement | null>(null)
const scale = ref(1)
const showBar = ref(false)
const panMode = ref(false)
const offset = ref({ x: 0, y: 0 })
const panStart = ref({ x: 0, y: 0 })
const isPanDragging = ref(false)

/** 可渲染为图片的支持格式 */
const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif',
  'tif', 'tiff', 'jxl', 'avif', 'svg', 'pcx', 'ico',
])
const isLeftImage = computed(() => IMAGE_EXTENSIONS.has(props.left.ext))
const isRightImage = computed(() => IMAGE_EXTENSIONS.has(props.right.ext))

onMounted(async () => {
  document.addEventListener('keydown', handleKeydown)
  if (isLeftImage.value) {
    try { leftSrc.value = await loadImageBase64(props.left) } catch { /* */ }
  }
  if (isRightImage.value) {
    try { rightSrc.value = await loadImageBase64(props.right) } catch { /* */ }
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
  document.removeEventListener('mousemove', onPanMove)
  document.removeEventListener('mouseup', onPanUp)
})

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
  else if (e.key === '+' || e.key === '=') zoomIn()
  else if (e.key === '-') zoomOut()
}

function zoomIn() { scale.value = Math.min(5, scale.value + 0.25) }
function zoomOut() { scale.value = Math.max(0.1, scale.value - 0.25) }

function onMouseDown(_e: MouseEvent) {
  isDragging.value = true
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value || !containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  splitRatio.value = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width))
}

function onMouseUp() {
  isDragging.value = false
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
}

function onPanDown(e: MouseEvent) {
  if (!panMode.value) return
  isPanDragging.value = true
  panStart.value = { x: e.clientX - offset.value.x, y: e.clientY - offset.value.y }
  document.addEventListener('mousemove', onPanMove)
  document.addEventListener('mouseup', onPanUp)
}

function onPanMove(e: MouseEvent) {
  if (!isPanDragging.value) return
  offset.value = { x: e.clientX - panStart.value.x, y: e.clientY - panStart.value.y }
}

function onPanUp() {
  isPanDragging.value = false
  document.removeEventListener('mousemove', onPanMove)
  document.removeEventListener('mouseup', onPanUp)
}

function fitToWindow() { scale.value = 1; offset.value = { x: 0, y: 0 } }

function handleWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    scale.value = Math.max(0.1, Math.min(10, scale.value + (e.deltaY > 0 ? -0.25 : 0.25)))
  }
}
</script>

<template>
  <div class="compare-viewer" ref="containerRef" :class="{ 'pan-active': panMode }" @mousedown="onPanDown" @wheel="handleWheel">
    <div class="compare-backdrop"></div>

    <!-- 底层图（右侧可见） -->
    <div class="compare-layer compare-bottom">
      <img v-if="rightSrc" :src="rightSrc" class="compare-img" :style="{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }" />
      <div v-else-if="!isRightImage" class="compare-file-info">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span class="compare-file-name">{{ right.name }}</span>
      </div>
      <div v-else class="compare-loading"><span class="loading-spinner"></span></div>
    </div>

    <!-- 顶层图（左侧可见，clip裁剪） -->
    <div class="compare-layer compare-top" :style="{ clipPath: `inset(0 ${(1 - splitRatio) * 100}% 0 0)` }">
      <img v-if="leftSrc" :src="leftSrc" class="compare-img" :style="{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }" />
      <div v-else-if="!isLeftImage" class="compare-file-info">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span class="compare-file-name">{{ left.name }}</span>
      </div>
      <div v-else class="compare-loading"><span class="loading-spinner"></span></div>
    </div>

    <!-- 分割线 -->
    <div
      class="compare-divider"
      :style="{ left: splitRatio * 100 + '%' }"
      @mousedown.stop="onMouseDown"
    ></div>

    <!-- 标签 -->
    <div class="compare-label compare-label-left" :style="{ opacity: splitRatio > 0.1 ? 1 : 0 }">{{ left.name }}</div>
    <div class="compare-label compare-label-right" :style="{ opacity: splitRatio < 0.9 ? 1 : 0 }">{{ right.name }}</div>

    <!-- 底部悬浮操作栏 -->
    <div class="compare-bar-hotarea" @mouseenter="showBar = true" @mouseleave="showBar = false">
      <div class="compare-bar" :class="{ visible: showBar }">
        <button class="op-btn" :title="$t('image.fit_window')" @click="fitToWindow">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"/>
          </svg>
        </button>
        <button class="op-btn" :title="$t('image.zoom_in')" @click="zoomIn">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
        <button class="op-btn" :title="$t('image.zoom_out')" @click="zoomOut">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
        <button class="op-btn" :class="{ active: panMode }" :title="$t('image.pan')" @click="panMode = !panMode">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v20M2 12h20M5 5l14 14M19 5l-14 14"/>
          </svg>
        </button>
        <span class="zoom-text">{{ Math.round(scale * 100) }}%</span>
        <button class="op-btn close-btn" :title="$t('viewer.close') + ' (Esc)'" @click="emit('close')">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.compare-viewer {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 1000;
  overflow: hidden;
  cursor: default;
}

.compare-viewer.pan-active {
  cursor: grab;
}

.compare-backdrop {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.92);
}

.compare-layer {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.compare-bottom { z-index: 1; }
.compare-top { z-index: 2; }

.compare-img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
}

.compare-loading { padding: 40px; }

.compare-file-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px;
}

.compare-file-name {
  font-size: 14px;
  color: rgba(255,255,255,0.4);
  text-align: center;
  word-break: break-all;
}

.loading-spinner {
  display: block;
  width: 40px; height: 40px;
  border: 3px solid rgba(255,255,255,0.2);
  border-top-color: #646cff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.compare-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 3px;
  background: rgba(255, 255, 255, 0.5);
  z-index: 10;
  transform: translateX(-50%);
  cursor: ew-resize;
  transition: background 0.15s;
}

.compare-divider:hover {
  background: rgba(255, 255, 255, 0.85);
  width: 5px;
}

.compare-label {
  position: absolute;
  top: 16px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  background: rgba(0, 0, 0, 0.5);
  padding: 4px 10px;
  border-radius: 4px;
  z-index: 3;
  transition: opacity 0.2s;
  pointer-events: none;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compare-label-left { left: 16px; }
.compare-label-right { right: 16px; }

/* 底部悬浮操作栏 */
.compare-bar-hotarea {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 100px;
  z-index: 10;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 16px;
}

.compare-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(30, 30, 50, 0.85);
  backdrop-filter: blur(8px);
  border-radius: 12px;
  padding: 6px 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  opacity: 0;
  transition: opacity 0.2s ease;
}

.compare-bar.visible { opacity: 1; }

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

.zoom-text {
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  padding: 0 4px;
}
</style>
