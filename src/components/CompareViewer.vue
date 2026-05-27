<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { ImageItem } from '../types'
import { state, loadImageBase64, showToast, applyFileChanges, setSuppressWatcher } from '../stores/imageStore'
import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { matchShortcut } from '../utils/shortcuts'

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

/** 检查是否因大小跳过而未加载 */
function isSkipped(item: { size_bytes: number }): boolean {
  const maxMB = state.settings.maxLoadSizeMB
  return maxMB > 0 && item.size_bytes > maxMB * 1024 * 1024 && !state.settings.loadSkippedOnView
}

onMounted(async () => {
  document.addEventListener('keydown', handleKeydown)
  if (isLeftImage.value) {
    try { leftSrc.value = await loadImageBase64(props.left, state.settings.loadSkippedOnView) } catch { /* */ }
  }
  if (isRightImage.value) {
    try { rightSrc.value = await loadImageBase64(props.right, state.settings.loadSkippedOnView) } catch { /* */ }
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
  if (matchShortcut(e, 'close')) emit('close')
  else if (matchShortcut(e, 'compare.zoomIn')) zoomIn()
  else if (matchShortcut(e, 'compare.zoomOut')) zoomOut()
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
  e.preventDefault()
  scale.value = Math.max(0.1, Math.min(10, scale.value + (e.deltaY > 0 ? -0.25 : 0.25)))
}

/** 点击背景遮罩或图片周围空白区域时关闭查看器 */
function handleClose() {
  emit('close')
}

// 右键菜单
const compareCtx = ref({ show: false, x: 0, y: 0 })
function handleCompareContextMenu(e: MouseEvent) {
  e.preventDefault()
  compareCtx.value = { show: true, x: e.clientX, y: e.clientY }
}
function closeCompareCtx() { compareCtx.value.show = false }
function handleCtxExit() { closeCompareCtx(); emit('close') }
async function handleCtxCopyPath(item: ImageItem | null) {
  closeCompareCtx()
  if (!item?.path) return
  try { await navigator.clipboard.writeText(item.path); showToast('已复制路径') } catch {}
}

/** 将 data URI 的图片复制到剪贴板 */
async function copyImageFromSrc(src: string, label: string) {
  if (!src) { showToast(label + '尚未加载'); return }
  try {
    const comma = src.indexOf(',')
    const mime = src.slice(5, comma).match(/^(.*?);/)![1]
    const raw = atob(src.slice(comma + 1))
    const buf = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i)

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
    showToast('已复制' + label)
  } catch { showToast('复制' + label + '失败') }
}

function handleCtxCopyLeftImage() { closeCompareCtx(); copyImageFromSrc(leftSrc.value, '左图') }
function handleCtxCopyRightImage() { closeCompareCtx(); copyImageFromSrc(rightSrc.value, '右图') }

async function saveImage(item: ImageItem | null, label: string) {
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
    showToast('已保存' + label + '到 ' + destStr)
  } catch (e: any) {
    showToast('保存' + label + '失败: ' + (e.message || e))
  }
}
function handleCtxSaveLeft() { closeCompareCtx(); saveImage(props.left, '左图') }
function handleCtxSaveRight() { closeCompareCtx(); saveImage(props.right, '右图') }
</script>

<template>
  <div class="compare-viewer" ref="containerRef" :class="{ 'pan-active': panMode }" @mousedown="onPanDown" @wheel="handleWheel" @contextmenu.prevent="handleCompareContextMenu">
    <!-- 右键菜单 -->
    <Teleport to="body">
      <div v-if="compareCtx.show" class="ctx-backdrop" @click="closeCompareCtx"></div>
      <div v-if="compareCtx.show" class="ctx-menu" :style="{ left: compareCtx.x + 'px', top: compareCtx.y + 'px' }" @click.stop>
        <button class="ctx-menu-item" @click="handleCtxExit">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
          <span>{{ $t('viewer.close') }}</span>
        </button>
        <div class="ctx-separator"></div>
        <button class="ctx-menu-item" @click="handleCtxCopyPath(left)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <span>复制左图路径</span>
        </button>
        <button class="ctx-menu-item" @click="handleCtxCopyPath(right)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <span>复制右图路径</span>
        </button>
        <div class="ctx-separator"></div>
        <button class="ctx-menu-item" @click="handleCtxCopyLeftImage">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
          </svg>
          <span>复制左图</span>
        </button>
        <button class="ctx-menu-item" @click="handleCtxCopyRightImage">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
          </svg>
          <span>复制右图</span>
        </button>
        <div class="ctx-separator"></div>
        <button class="ctx-menu-item" @click="handleCtxSaveLeft">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
          </svg>
          <span>左图另存为</span>
        </button>
        <button class="ctx-menu-item" @click="handleCtxSaveRight">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
          </svg>
          <span>右图另存为</span>
        </button>
      </div>
    </Teleport>
    <div class="compare-backdrop" @click="handleClose"></div>

    <!-- 底层图（右侧可见） -->
    <div class="compare-layer compare-bottom" @click.self="handleClose">
      <img v-if="rightSrc" :src="rightSrc" class="compare-img" :style="{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }" />
      <div v-else-if="!isRightImage || isSkipped(props.right)" class="compare-file-info">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span class="compare-file-name">{{ right.name }}</span>
      </div>
      <div v-else class="compare-loading"><span class="loading-spinner"></span></div>
    </div>

    <!-- 顶层图（左侧可见，clip裁剪） -->
    <div class="compare-layer compare-top" :style="{ clipPath: `inset(0 ${(1 - splitRatio) * 100}% 0 0)` }" @click.self="handleClose">
      <img v-if="leftSrc" :src="leftSrc" class="compare-img" :style="{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }" />
      <div v-else-if="!isLeftImage || isSkipped(props.left)" class="compare-file-info">
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
