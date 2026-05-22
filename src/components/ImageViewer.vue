<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import type { ImageItem } from '../types'
import { state, loadImageBase64 } from '../stores/imageStore'
import { invoke } from '@tauri-apps/api/core'
import OperationBar from './OperationBar.vue'
import { revealItemInDir } from '@tauri-apps/plugin-opener'

const props = defineProps<{
  images: ImageItem[]
  initialIndex: number
}>()

const emit = defineEmits<{
  close: []
  deleteImage: [path: string, index: number]
}>()

const currentIndex = ref(props.initialIndex)
const imgSrc = ref('')
const isLoaded = ref(false)
const scale = ref(1)
const isFullscreen = ref(false)
const containerRef = ref<HTMLElement | null>(null)
const showBar = ref(false)
const panMode = ref(false)
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const offset = ref({ x: 0, y: 0 })

const prevImageSize = ref({ width: 0, height: 0 })
const currentItem = computed(() => props.images[currentIndex.value])

const backdropStyle = computed(() => {
  if (state.settings.viewerBgMode === 'color') {
    return { background: state.settings.viewerBgColor }
  }
  // overlay 模式保持原有蒙灰效果
  return { background: 'rgba(0, 0, 0, 0.85)' }
})

function formatSize(bytes?: number): string {
  if (bytes == null) return ''
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
}

async function loadCurrentImage() {
  const item = currentItem.value
  if (!item) return
  isLoaded.value = false
  // 同尺寸图片切换时保持缩放比和平移偏移
  if (item.width !== prevImageSize.value.width || item.height !== prevImageSize.value.height) {
    scale.value = 1
    offset.value = { x: 0, y: 0 }
  }
  prevImageSize.value = { width: item.width, height: item.height }
  try {
    const b64 = await loadImageBase64(item)
    imgSrc.value = b64
  } catch {
    imgSrc.value = ''
  }
}

watch(currentIndex, () => { loadCurrentImage() })

onMounted(() => {
  loadCurrentImage()
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (isFullscreen.value) exitFullscreen()
    else emit('close')
  } else if (e.key === 'ArrowLeft') prevImage()
  else if (e.key === 'ArrowRight') nextImage()
  else if (e.key === '+' || e.key === '=') zoomIn()
  else if (e.key === '-') zoomOut()
  else if (e.key === 'Delete') handleDeleteImage()
}

function prevImage() { if (currentIndex.value > 0) currentIndex.value-- }
function nextImage() { if (currentIndex.value < props.images.length - 1) currentIndex.value++ }
function zoomIn() { scale.value = Math.min(5, scale.value + 0.1) }
function zoomOut() { scale.value = Math.max(0.1, scale.value - 0.1) }
function fitToWindow() { scale.value = 1; offset.value = { x: 0, y: 0 } }

function toggleFullscreen() {
  isFullscreen.value ? exitFullscreen() : enterFullscreen()
}
function enterFullscreen() {
  containerRef.value?.requestFullscreen().catch(() => {})
  isFullscreen.value = true
}
function exitFullscreen() {
  document.exitFullscreen().catch(() => {})
  isFullscreen.value = false
}

function handleWheel(e: WheelEvent) {
  e.preventDefault()
  scale.value = Math.max(0.1, Math.min(10, scale.value + (e.deltaY > 0 ? -0.1 : 0.1)))
}

function togglePanMode() { panMode.value = !panMode.value }

function onMouseDown(e: MouseEvent) {
  if (!panMode.value) return
  isDragging.value = true
  dragStart.value = { x: e.clientX - offset.value.x, y: e.clientY - offset.value.y }
}
function onMouseMove(e: MouseEvent) {
  if (isDragging.value) {
    offset.value = { x: e.clientX - dragStart.value.x, y: e.clientY - dragStart.value.y }
  }
}
function onMouseUp() { isDragging.value = false }

async function handleOpenExplorer() {
  const item = currentItem.value
  if (item) {
    try { await revealItemInDir(item.path) }
    catch (e) { console.error('在资源管理器中打开失败:', e) }
  }
}

async function handleOpenDefault() {
  const item = currentItem.value
  if (!item) return
  try { await invoke('open_in_explorer', { path: item.path }) }
  catch (e) { console.error('默认方式打开失败:', e) }
}

async function handleOpenWith(program: string) {
  const item = currentItem.value
  if (!item) return
  try { await invoke('open_with_program', { path: item.path, program }) }
  catch (e) { console.error('外部程序打开失败:', e) }
}

function handleDeleteImage() {
  const item = currentItem.value
  if (item) emit('deleteImage', item.path, currentIndex.value)
}
</script>

<template>
  <div
    ref="containerRef"
    class="image-viewer"
    :class="{ fullscreen: isFullscreen }"
    @wheel="handleWheel"
  >
    <div class="viewer-backdrop" :style="backdropStyle"></div>

    <div class="viewer-content">
      <div
        class="image-wrapper"
        :class="{ 'pan-active': panMode }"
        :style="{ cursor: panMode ? (isDragging ? 'grabbing' : 'grab') : 'default' }"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseUp"
      >
        <img
          v-if="imgSrc"
          ref="imgRef"
          :src="imgSrc"
          :alt="currentItem?.name"
          class="viewer-image"
          :style="{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }"
          @load="isLoaded = true"
          :draggable="!panMode"
        />
        <div v-if="!isLoaded" class="viewer-loading">
          <span class="loading-spinner"></span>
        </div>
      </div>

      <button v-if="currentIndex > 0" class="nav-btn prev-btn" @click.stop="prevImage">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="white"><path d="M15 18l-6-6 6-6" stroke="white" stroke-width="2" fill="none"/></svg>
      </button>
      <button v-if="currentIndex < images.length - 1" class="nav-btn next-btn" @click.stop="nextImage">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="white"><path d="M9 18l6-6-6-6" stroke="white" stroke-width="2" fill="none"/></svg>
      </button>

      <div v-if="state.showImageInfo" class="viewer-info">
        <span>{{ currentItem?.name }}</span><span class="info-sep">|</span>
        <span>{{ Math.round(scale * 100) }}%</span><span class="info-sep">|</span>
        <span>{{ currentIndex + 1 }}/{{ images.length }}</span><span class="info-sep">|</span>
        <span>{{ formatSize(currentItem?.size_bytes) }}</span><span class="info-sep">|</span>
        <span>{{ currentItem?.width }}×{{ currentItem?.height }}</span>
      </div>
    </div>

    <!-- 操作栏热区 -->
    <div class="op-bar-hotarea" @mouseenter="showBar = true" @mouseleave="showBar = false">
      <div class="op-bar-container" :class="{ visible: showBar }">
        <OperationBar
          :item="currentItem"
          :scale="scale"
          :isFullscreen="isFullscreen"
          :panMode="panMode"
          @close="emit('close')"
          @zoomIn="zoomIn"
          @zoomOut="zoomOut"
          @fitToWindow="fitToWindow"
          @toggleFullscreen="toggleFullscreen"
          @togglePan="togglePanMode"
          @openExplorer="handleOpenExplorer"
          @openDefault="handleOpenDefault"
          @openWith="handleOpenWith"
          @deleteImage="handleDeleteImage"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-viewer {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.image-viewer.fullscreen { z-index: 1001; }

.viewer-backdrop {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.85);
}

.viewer-content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 20px 50px;
}

.image-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}
.image-wrapper.pan-active { cursor: grab; }

.viewer-image {
  display: block;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
  flex-shrink: 0;
}

.viewer-loading { padding: 40px; }
.loading-spinner {
  display: block;
  width: 40px; height: 40px;
  border: 3px solid rgba(255,255,255,0.2);
  border-top-color: #646cff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.nav-btn {
  position: absolute;
  top: 50%; transform: translateY(-50%);
  background: rgba(255,255,255,0.1);
  border: none; border-radius: 50%;
  width: 48px; height: 48px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.2s; z-index: 2;
}
.nav-btn:hover { background: rgba(255,255,255,0.2); }
.prev-btn { left: 10px; }
.next-btn { right: 10px; }

.viewer-info {
  position: absolute;
  bottom: 70px; left: 50%; transform: translateX(-50%);
  color: rgba(255,255,255,0.7);
  font-size: 13px;
  background: rgba(0,0,0,0.5);
  padding: 4px 12px; border-radius: 4px;
  white-space: nowrap;
}
.info-sep { margin: 0 8px; opacity: 0.4; }

/* 操作栏热区 */
.op-bar-hotarea {
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

.op-bar-container {
  opacity: 0;
  transition: opacity 0.2s ease;
}
.op-bar-container.visible {
  opacity: 1;
}
</style>

<style scoped>
.image-viewer {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.image-viewer.fullscreen {
  z-index: 1001;
}

.viewer-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
}

.viewer-content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 20px 50px;
}

.image-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}

.viewer-image {
  display: block;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
  flex-shrink: 0;
}

.viewer-loading {
  padding: 40px;
}

.loading-spinner {
  display: block;
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-top-color: #646cff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 50%;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.2s;
  z-index: 2;
}

.nav-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.prev-btn { left: 10px; }
.next-btn { right: 10px; }

.viewer-info {
  position: absolute;
  bottom: 70px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  background: rgba(0, 0, 0, 0.5);
  padding: 4px 12px;
  border-radius: 4px;
  white-space: nowrap;
}

.info-sep {
  margin: 0 8px;
  opacity: 0.4;
}
</style>
