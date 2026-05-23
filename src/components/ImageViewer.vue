<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import type { ImageItem } from '../types'
import { state, loadImageBase64 } from '../stores/imageStore'
import { invoke } from '@tauri-apps/api/core'
import OperationBar from './OperationBar.vue'
import { revealItemInDir } from '@tauri-apps/plugin-opener'

/** 可渲染为图片的支持格式 */
const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif',
  'tif', 'tiff', 'jxl', 'avif', 'svg', 'pcx', 'ico',
])

const props = defineProps<{
  images: ImageItem[]
  initialIndex: number
}>()

const emit = defineEmits<{
  close: []
  deleteImage: [path: string, index: number]
}>()

const currentIndex = ref(props.initialIndex)
const isImage = computed(() => IMAGE_EXTENSIONS.has(currentItem.value?.ext || ''))
const imgSrc = ref('')
const textContent = ref<string | undefined>(undefined)
const textError = ref<string | undefined>(undefined)
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
  // 非图片文件：尝试以文本方式读取
  if (!isImage.value) {
    imgSrc.value = ''
    textContent.value = undefined
    textError.value = undefined
    isLoaded.value = false
    try {
      textContent.value = await invoke<string>('read_file_text', { path: item.path })
      isLoaded.value = true
    } catch (e: any) {
      textError.value = String(e)
      isLoaded.value = true
    }
    return
  }
  isLoaded.value = false
  // 自动居中（设置启用时切换图片始终重置偏移）
  if (state.settings.autoCenter) {
    offset.value = { x: 0, y: 0 }
  }
  // 不同尺寸图片切换时重置缩放和平移
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

// 缩放超过 100% 时自动开启平移（设置启用时）
watch([scale, () => state.settings.autoPan], ([s, auto]) => {
  if (auto && s > 1) panMode.value = true
})

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
        <!-- 非图片文件：尝试文本展示 -->
        <div v-if="currentItem && !isImage" class="viewer-text-wrap"
          :style="{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }">
          <template v-if="textContent !== undefined">
            <pre class="viewer-text"><code>{{ textContent }}</code></pre>
          </template>
          <template v-else-if="textError">
            <div class="viewer-text-placeholder">
              <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span class="viewer-text-name">{{ currentItem.name }}</span>
              <span class="viewer-text-hint">{{ textError }}</span>
            </div>
          </template>
          <div v-else class="viewer-loading">
            <span class="loading-spinner"></span>
          </div>
        </div>
        <!-- 图片文件 -->
        <img
          v-if="imgSrc && isImage"
          ref="imgRef"
          :src="imgSrc"
          :alt="currentItem?.name"
          class="viewer-image"
          :style="{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }"
          @load="isLoaded = true"
          :draggable="!panMode"
        />
        <div v-if="isImage && !isLoaded" class="viewer-loading">
          <span class="loading-spinner"></span>
        </div>
      </div>

      <button v-if="currentIndex > 0" class="nav-btn prev-btn" @click.stop="prevImage">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="white"><path d="M15 18l-6-6 6-6" stroke="white" stroke-width="2" fill="none"/></svg>
      </button>
      <button v-if="currentIndex < images.length - 1" class="nav-btn next-btn" @click.stop="nextImage">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="white"><path d="M9 18l6-6-6-6" stroke="white" stroke-width="2" fill="none"/></svg>
      </button>
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

    <!-- 图片信息（置于操作栏下方，确保不被遮挡） -->
    <div v-if="state.showImageInfo" class="viewer-info">
      <span>{{ currentItem?.name }}</span><span class="info-sep">|</span>
      <span>{{ Math.round(scale * 100) }}%</span><span class="info-sep">|</span>
      <span>{{ currentIndex + 1 }}/{{ images.length }}</span><span class="info-sep">|</span>
      <span>{{ formatSize(currentItem?.size_bytes) }}</span><span class="info-sep">|</span>
      <span>{{ currentItem?.width }}×{{ currentItem?.height }}</span>
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

.viewer-text-wrap {
  width: 100%;
  height: 100%;
  overflow: auto;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

.viewer-text {
  width: 100%;
  max-height: 100%;
  margin: 0;
  padding: 20px 30px;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: rgba(255,255,255,0.8);
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-y: auto;
  background: transparent;
  border: none;
}

.viewer-text-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 40px;
}

.viewer-text-name {
  font-size: 16px;
  color: rgba(255,255,255,0.5);
  text-align: center;
  word-break: break-all;
}

.viewer-text-hint {
  font-size: 13px;
  color: rgba(255,255,255,0.25);
  text-align: center;
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
  bottom: 4px; left: 50%; transform: translateX(-50%);
  color: rgba(255,255,255,0.5);
  font-size: 12px;
  background: rgba(0,0,0,0.35);
  padding: 2px 10px; border-radius: 4px;
  white-space: nowrap;
  z-index: 20;
  pointer-events: none;
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
