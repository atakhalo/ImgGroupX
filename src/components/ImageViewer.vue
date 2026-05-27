<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import type { ImageItem, MarkLevel } from '../types'
import { state, loadImageBase64, setImageMark, showToast, applyFileChanges, setSuppressWatcher } from '../stores/imageStore'
import { matchShortcut } from '../utils/shortcuts'
import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
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
/** 当前图片是否因大小阈值被跳过 */
const isSkipped = computed(() => {
  const item = currentItem.value
  if (!item) return false
  const maxMB = state.settings.maxLoadSizeMB
  return maxMB > 0 && item.size_bytes > maxMB * 1024 * 1024 && !state.settings.loadSkippedOnView
})
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

/** 递增的加载序号，用于防止异步竞态 */
let loadingSeq = 0

const backdropStyle = computed(() => {
  if (state.settings.viewerBgMode === 'color') {
    return { background: state.settings.viewerBgColor }
  }
  // overlay 模式保持原有蒙灰效果
  return { background: 'rgba(0, 0, 0, 0.85)' }
})

const currentMarkLevel = computed(() => currentItem.value?.markLevel || 0)
const currentMarkColor = computed(() => {
  const lv = currentMarkLevel.value
  if (lv < 1 || lv > 5) return ''
  return state.settings.markColors[lv - 1] || ''
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

  // 递增加载序号并捕获当前值，用于后续判断是否被新请求覆盖
  const seq = ++loadingSeq
  isLoaded.value = false

  // 自动居中（设置启用时切换图片始终重置偏移）
  if (state.settings.autoCenter) {
    offset.value = { x: 0, y: 0 }
  }
  // 不同尺寸图片切换时重置缩放和平移
  if (item.width !== prevImageSize.value.width || item.height !== prevImageSize.value.height) {
    scale.value = 1
    // offset.value = { x: 0, y: 0 }
  }
  prevImageSize.value = { width: item.width, height: item.height }
  // 大小跳过且未开启查看时加载 → 不尝试加载，直接标记完成
  const maxMB = state.settings.maxLoadSizeMB
  if (maxMB > 0 && item.size_bytes > maxMB * 1024 * 1024 && !state.settings.loadSkippedOnView) {
    isLoaded.value = true
    return
  }
  try {
    const b64 = await loadImageBase64(item, state.settings.loadSkippedOnView)
    // 只有当前序号未被更新的请求覆盖才应用结果
    if (seq === loadingSeq) {
      imgSrc.value = b64
    }
  } catch {
    if (seq === loadingSeq) {
      imgSrc.value = ''
    }
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
  if (matchShortcut(e, 'close')) {
    if (isFullscreen.value) exitFullscreen()
    else emit('close')
  } else if (matchShortcut(e, 'viewer.prev')) prevImage()
  else if (matchShortcut(e, 'viewer.next')) nextImage()
  else if (matchShortcut(e, 'viewer.zoomIn')) zoomIn()
  else if (matchShortcut(e, 'viewer.zoomOut')) zoomOut()
  else if (matchShortcut(e, 'viewer.delete')) handleDeleteImage()
  else if (matchShortcut(e, 'viewer.mark0')) handleSetMark(0)
  else if (matchShortcut(e, 'viewer.mark1')) handleSetMark(1)
  else if (matchShortcut(e, 'viewer.mark2')) handleSetMark(2)
  else if (matchShortcut(e, 'viewer.mark3')) handleSetMark(3)
  else if (matchShortcut(e, 'viewer.mark4')) handleSetMark(4)
  else if (matchShortcut(e, 'viewer.mark5')) handleSetMark(5)
}

function handleSetMark(level: MarkLevel) {
  const item = currentItem.value
  if (item) {
    setImageMark(item.path, level)
  }
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

// 右键菜单
const viewerCtx = ref({ show: false, x: 0, y: 0 })
function handleViewerContextMenu(e: MouseEvent) {
  e.preventDefault()
  viewerCtx.value = { show: true, x: e.clientX, y: e.clientY }
}
function closeViewerCtx() { viewerCtx.value.show = false }
function handleCtxExit() { closeViewerCtx(); emit('close') }
function handleCtxOpenExplorer() { closeViewerCtx(); handleOpenExplorer() }
function handleCtxOpenDefault() { closeViewerCtx(); handleOpenDefault() }
async function handleCtxCopyPath() {
  closeViewerCtx()
  const p = currentItem.value?.path
  if (!p) return
  try { await navigator.clipboard.writeText(p); showToast('已复制路径') }
  catch { showToast('复制路径失败') }
}
async function handleCtxSaveAs() {
  closeViewerCtx()
  const item = currentItem.value
  if (!item) return
  try {
    const dest = await save({
      defaultPath: item.name,
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'] }],
    })
    if (!dest) return
    const destStr = String(dest).replace(/\\/g, '/')
    const lastSlash = destStr.lastIndexOf('/')
    const destDir = lastSlash >= 0 ? destStr.substring(0, lastSlash) : ''
    const fileName = lastSlash >= 0 ? destStr.substring(lastSlash + 1) : destStr
    await setSuppressWatcher(true)
    const created = await invoke<[string, string][]>('copy_files', { files: [[item.path, fileName]], destDir })
    await setSuppressWatcher(false)
    const createdPaths = created.map(([_, dest]) => dest)
    const roots = state.loadedRootPaths.map(r => r.replace(/[\\/]/g, '/').replace(/\/$/, ''))
    if (roots.some(r => destDir === r || destDir.startsWith(r + '/'))) {
      await applyFileChanges(createdPaths)
    }
    showToast('已保存到 ' + destStr)
  } catch (e: any) {
    showToast('保存失败: ' + (e.message || e))
  }
}

async function handleCtxCopyImage() {
  closeViewerCtx()
  const src = imgSrc.value
  if (!src) { showToast('图片尚未加载'); return }
  try {
    const comma = src.indexOf(',')
    const mime = src.slice(5, comma).match(/^(.*?);/)![1]
    const raw = atob(src.slice(comma + 1))
    const len = raw.length
    const buf = new Uint8Array(len)
    for (let i = 0; i < len; i++) buf[i] = raw.charCodeAt(i)

    if (mime === 'image/png') {
      const blob = new Blob([buf], { type: 'image/png' })
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    } else {
      const blob = new Blob([buf], { type: mime })
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()
      const pngBlob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'))
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
    }
    showToast('已复制图片')
  } catch (e: any) {
    showToast('复制图片失败: ' + (e.message || e))
  }
}

/** 点击背景遮罩或图片周围空白区域时关闭查看器 */
function handleClose() {
  if (isFullscreen.value) exitFullscreen()
  else emit('close')
}
</script>

<template>
  <div
    ref="containerRef"
    class="image-viewer"
    :class="{ fullscreen: isFullscreen }"
    @wheel="handleWheel"
    @contextmenu.prevent="handleViewerContextMenu"
  >
    <!-- 右键菜单 -->
    <Teleport to="body">
      <div v-if="viewerCtx.show" class="ctx-backdrop" @click="closeViewerCtx"></div>
      <div v-if="viewerCtx.show" class="ctx-menu" :style="{ left: viewerCtx.x + 'px', top: viewerCtx.y + 'px' }" @click.stop>
        <button class="ctx-menu-item" @click="handleCtxExit">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
          <span>{{ $t('viewer.close') }}</span>
        </button>
        <div class="ctx-separator"></div>
        <button class="ctx-menu-item" @click="handleCtxOpenExplorer">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <span>{{ $t('folder.open_in_explorer') }}</span>
        </button>
        <button class="ctx-menu-item" @click="handleCtxOpenDefault">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
          <span>{{ $t('viewer.default') }}</span>
        </button>
        <button class="ctx-menu-item" @click="handleCtxCopyPath">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <span>复制路径</span>
        </button>
        <button class="ctx-menu-item" @click="handleCtxCopyImage">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
          </svg>
          <span>复制图片</span>
        </button>
        <button class="ctx-menu-item" @click="handleCtxSaveAs">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
          </svg>
          <span>另存为</span>
        </button>
      </div>
    </Teleport>
    <div class="viewer-backdrop" :style="backdropStyle" @click="handleClose"></div>

    <div class="viewer-content" @click.self="handleClose">
      <div
        class="image-wrapper"
        :class="{ 'pan-active': panMode }"
        :style="{ cursor: panMode ? (isDragging ? 'grabbing' : 'grab') : 'default' }"
        @click.self="handleClose"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseUp"
      >
        <!-- 非图片文件：尝试文本展示 -->
        <div v-if="currentItem && !isImage" class="viewer-text-wrap"
          :style="{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }"
          @click.self="handleClose">
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
        <!-- 图片文件：始终保留在 DOM 中，仅切换 src，避免重建元素导致闪烁 -->
        <img
          v-if="isImage && !isSkipped"
          ref="imgRef"
          :src="imgSrc || undefined"
          :alt="currentItem?.name"
          class="viewer-image"
          :class="{ loaded: isLoaded }"
          :style="{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }"
          @load="isLoaded = true"
          @error="isLoaded = true"
          :draggable="!panMode"
        />
        <!-- 大小跳过的图片显示占位符 -->
        <div v-if="isImage && isSkipped" class="viewer-text-wrap"
          :style="{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }"
          @click.self="handleClose">
          <div class="viewer-text-placeholder">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            <span class="viewer-text-name">{{ currentItem?.name }}</span>
            <span class="viewer-text-hint">{{ formatSize(currentItem?.size_bytes) }} - 已跳过</span>
          </div>
        </div>
        <!-- 加载指示器使用 absolute 覆盖，避免撑开 flex 布局造成位移 -->
        <div v-if="isImage && !isSkipped && !isLoaded" class="viewer-loading-overlay">
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
      <span v-if="currentMarkLevel && currentMarkColor" class="info-sep">|</span>
      <span v-if="currentMarkLevel && currentMarkColor" class="mark-info-badge" :style="{ backgroundColor: currentMarkColor }">{{ currentMarkLevel }}</span>
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
  /* 用 opacity 过渡实现淡入淡出，避免硬切闪烁 */
  transition: opacity 0.12s ease;
}
.viewer-image.loaded {
  opacity: 1;
}

.viewer-loading { padding: 40px; }

.viewer-text-wrap {
  width: 100%;
  height: 100%;
  overflow: auto;
  display: flex;
  align-items: center;
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

.mark-info-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: white;
  font-size: 10px;
  font-weight: 700;
  vertical-align: middle;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  line-height: 1;
  text-shadow: 0 1px 2px rgba(0,0,0,0.4);
}

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

/* 加载指示器覆盖层：absolute 铺满容器，不撑开 flex 布局
   半透明背景遮住旧图片，避免残影感 */
.viewer-loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  pointer-events: none;
}

/* 右键菜单 */
.ctx-backdrop {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 9998;
}
.ctx-menu {
  position: fixed;
  z-index: 9999;
  background: rgba(30, 30, 50, 0.95);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 4px;
  min-width: 120px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
.ctx-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
  white-space: nowrap;
  transition: background 0.12s;
}
.ctx-menu-item:hover {
  background: rgba(100, 108, 255, 0.2);
  color: white;
}
.ctx-separator {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 4px 8px;
}
</style>
