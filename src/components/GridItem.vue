<script setup lang="ts">
import type { ImageItem } from '../types'
import { state, loadImageBase64, showToast, applyFileChanges, setSuppressWatcher, showRenameDialog } from '../stores/imageStore'
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { save } from '@tauri-apps/plugin-dialog'


/** 可渲染为图片的支持格式 */
const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif',
  'tif', 'tiff', 'jxl', 'avif', 'svg', 'pcx', 'ico',
])

const props = defineProps<{
  item: ImageItem
  gridSize: number
  borderRadius: number
  isSelected?: boolean
}>()

const emit = defineEmits<{
  click: [item: ImageItem]
  select: [item: ImageItem, ctrl: boolean]
}>()

const isImage = computed(() => IMAGE_EXTENSIONS.has(props.item.ext))

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / 1024 / 1024).toFixed(1) + 'MB'
}

const markLevel = computed(() => props.item.markLevel || 0)
const markColor = computed(() => {
  const lv = markLevel.value
  if (lv < 1 || lv > 5) return ''
  return state.settings.markColors[lv - 1] || ''
})
const markBadgeSize = computed(() => Math.max(12, Math.round(props.gridSize / 10)))
const markBadgeFontSize = computed(() => Math.max(7, Math.round(props.gridSize / 16)))

const elRef = ref<HTMLElement | null>(null)
const imgSrc = ref('')
const isLoaded = ref(false)
const hasError = ref(false)
const aspectRatio = computed(() => {
  if (props.item.width && props.item.height) {
    return props.item.width / props.item.height
  }
  return 1
})

const itemWidth = computed(() => {
  return Math.round(props.gridSize * aspectRatio.value)
})

let loadingPromise: Promise<string> | null = null
let visObserver: IntersectionObserver | null = null
let hasTriggered = false

async function doLoad() {
  if (!isImage.value) return // 非图片不加载
  if (hasError.value) return
  if (props.item.base64) {
    imgSrc.value = props.item.base64
    isLoaded.value = true
    return
  }
  if (props.item.loading) return
  isLoaded.value = false
  try {
    loadingPromise = loadImageBase64(props.item)
    const b64 = await loadingPromise
    if (props.item.base64 === undefined && b64) return
    imgSrc.value = b64
    isLoaded.value = true
  } catch (e) {
    hasError.value = true
    isLoaded.value = false
  } finally {
    loadingPromise = null
  }
}

onMounted(() => {
  // 使用 IntersectionObserver：进入视口才加载
  if (!elRef.value) return
  visObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && !hasTriggered) {
        hasTriggered = true
        doLoad()
        // 加载一次后断开观察
        visObserver?.disconnect()
        visObserver = null
      }
    },
    { rootMargin: '300px' } // 提前 300px 开始加载
  )
  visObserver.observe(elRef.value)
})

onUnmounted(() => {
  visObserver?.disconnect()
  imgSrc.value = ''
})

// 监听 base64 被外部填充（如批量预加载）
watch(() => props.item.base64, (val) => {
  if (val && !isLoaded.value) {
    imgSrc.value = val
    isLoaded.value = true
    hasError.value = false
  } else if (!val && imgSrc.value) {
    // base64 被释放，清空显示并等待下次进入视口
    imgSrc.value = ''
    isLoaded.value = false
    hasTriggered = false
    // 如果仍在视口内，立即重新加载
    doLoad()
  }
})

const ctxMenu = ref({ show: false, x: 0, y: 0 })

function handleClick(e: MouseEvent) {
  if (state.selectMode === 'select') {
    emit('select', props.item, e.ctrlKey || e.metaKey)
  } else {
    emit('click', props.item)
  }
}

function handleContextMenu(e: MouseEvent) {
  e.preventDefault()
  ctxMenu.value = { show: true, x: e.clientX, y: e.clientY }
}

function closeCtxMenu() {
  ctxMenu.value.show = false
}

function handleCtxView() {
  closeCtxMenu()
  emit('click', props.item)
}

function handleCtxOpenExplorer() {
  closeCtxMenu()
  revealItemInDir(props.item.path).catch(() => {})
}

function handleCtxOpenDefault() {
  closeCtxMenu()
  invoke('open_in_explorer', { path: props.item.path }).catch(() => {})
}

async function handleCtxCopyPath() {
  closeCtxMenu()
  try {
    await navigator.clipboard.writeText(props.item.path)
    showToast('已复制路径')
  } catch {
    const ta = document.createElement('textarea')
    ta.value = props.item.path
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

async function handleCtxSaveAs() {
  closeCtxMenu()
  const path = props.item.path
  try {
    const dest = await save({
      defaultPath: props.item.name,
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'] }],
    })
    if (!dest) return
    const destStr = String(dest).replace(/\\/g, '/')
    const lastSlash = destStr.lastIndexOf('/')
    const destDir = lastSlash >= 0 ? destStr.substring(0, lastSlash) : ''
    const fileName = lastSlash >= 0 ? destStr.substring(lastSlash + 1) : destStr
    // 参考 copyImagesToFolder：抑制监听器 → 复制 → 恢复 → 用实际路径刷新
    await setSuppressWatcher(true)
    const created = await invoke<[string, string][]>('copy_files', { files: [[path, fileName]], destDir })
    await setSuppressWatcher(false)
    const createdPaths = created.map(([_, dest]) => dest)
    // 如果保存在已加载的根路径下，增量刷新
    const roots = state.loadedRootPaths.map(r => r.replace(/[\\/]/g, '/').replace(/\/$/, ''))
    if (roots.some(r => destDir === r || destDir.startsWith(r + '/'))) {
      await applyFileChanges(createdPaths)
    }
    showToast('已保存到 ' + destStr)
  } catch (e: any) {
    showToast('保存失败: ' + (e.message || e))
  }
}

function handleCtxRename() {
  closeCtxMenu()
  const item = props.item
  if (!item) return
  showRenameDialog(item)
}

async function handleCtxCopyImage() {
  closeCtxMenu()
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
      // PNG 直接写入（浏览器剪贴板原生支持）
      const blob = new Blob([buf], { type: 'image/png' })
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    } else {
      // 非 PNG 格式（webp/jpeg 等）→ Canvas 解码后重新编码为 PNG
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
</script>

<template>
  <div
    ref="elRef"
    class="grid-item"
    :class="{ selected: isSelected, 'show-filename': state.alwaysShowFileName }"
    :style="{
      height: gridSize + 'px',
      width: itemWidth + 'px',
      borderRadius: borderRadius + 'px',
      outline: markLevel && markColor && state.settings.showMarks ? `2px solid ${markColor}` : '',
      outlineOffset: markLevel && state.settings.showMarks ? '2px' : '',
    }"
    @click="handleClick"
    @dblclick="state.selectMode === 'select' && emit('click', item)"
    @contextmenu.prevent="handleContextMenu"
  >
    <!-- 右键菜单 -->
    <Teleport to="body">
      <div v-if="ctxMenu.show" class="ctx-backdrop" @click="closeCtxMenu"></div>
      <div v-if="ctxMenu.show" class="ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" @click.stop>
        <button class="ctx-menu-item" @click="handleCtxView">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
          </svg>
          <span>{{ $t('viewer.view') }}</span>
        </button>
        <div class="ctx-separator"></div>
        <button class="ctx-menu-item" @click="handleCtxCopyImage">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
          </svg>
          <span>复制图片</span>
        </button>
        <button class="ctx-menu-item" @click="handleCtxCopyPath">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <span>复制路径</span>
        </button>
        <div class="ctx-separator"></div>
        <button class="ctx-menu-item" @click="handleCtxRename">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
          </svg>
          <span>{{ $t('viewer.rename') }}</span>
        </button>
        <button class="ctx-menu-item" @click="handleCtxSaveAs">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
          </svg>
          <span>另存为</span>
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
      </div>
    </Teleport>
    <div class="item-inner" :style="{ borderRadius: borderRadius + 'px' }">
      <!-- 非图片文件：仅显示文件名 -->
      <template v-if="!isImage">
        <div class="file-placeholder">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span class="file-name">{{ item.name }}</span>
        </div>
      </template>
      <!-- 图片文件 -->
      <template v-else>
        <!-- 加载中 / 等待进入视口 -->
        <div v-if="!isLoaded && !hasError" class="item-placeholder">
          <div class="item-placeholder-info">
            <span v-if="item.loading" class="loading-spinner"></span>
            <span class="placeholder-file-name">{{ item.name }}</span>
            <span class="placeholder-file-size">{{ formatSize(item.size_bytes) }}</span>
          </div>
        </div>
        <!-- 加载失败 / 跳过 -->
        <div v-if="hasError" class="item-placeholder item-error">
          <div class="item-placeholder-info">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            <span class="placeholder-file-name">{{ item.name }}</span>
            <span class="placeholder-file-size">{{ formatSize(item.size_bytes) }}</span>
            <span class="placeholder-skipped">已跳过</span>
          </div>
        </div>
        <img
          v-if="imgSrc && !hasError"
          :src="imgSrc"
          :alt="item.name"
          class="item-img"
          :style="{
            borderRadius: borderRadius + 'px',
          }"
          @load="isLoaded = true"
          @error="hasError = true; isLoaded = false"
        />
        <div class="item-overlay">
          <span class="item-name">{{ item.name }}</span>
        </div>
      </template>
      <div v-if="isSelected" class="select-check">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="white">
          <circle cx="12" cy="12" r="10" fill="rgba(0,120,255,0.8)" />
          <path d="M9 12l2 2 4-4" stroke="white" stroke-width="2" fill="none" />
        </svg>
      </div>
      <!-- 标记等级徽标 -->
      <div v-if="markLevel && markColor && state.settings.showMarks && state.settings.showMarkBadge" class="mark-badge" :style="{ backgroundColor: markColor, width: markBadgeSize + 'px', height: markBadgeSize + 'px' }">
        <span class="mark-badge-text" :style="{ fontSize: markBadgeFontSize + 'px' }">{{ markLevel }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid-item {
  flex-shrink: 0;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  position: relative;
}

.grid-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.grid-item.selected {
  box-shadow: 0 0 0 3px #0078ff;
}

.item-inner {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
  background: #2a2a3e;
}

.item-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #2a2a3e;
}

.item-placeholder-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px;
  text-align: center;
  overflow: hidden;
  max-width: 100%;
}

.placeholder-file-name {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.placeholder-file-size {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.2);
}

.placeholder-skipped {
  font-size: 9px;
  color: rgba(255, 180, 60, 0.5);
}

.file-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px;
  background: #2a2a3e;
  overflow: hidden;
}

.file-name {
  font-size: 11px;
  color: rgba(255,255,255,0.4);
  text-align: center;
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.3;
}

.item-error {
  background: #2a1a1a;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: #646cff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.item-img {
  width: 100%;
  height: 100%;
  display: block;
  transition: opacity 0.3s;
}

.item-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 4px 6px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
  opacity: 0;
  transition: opacity 0.2s;
}

.grid-item:hover .item-overlay {
  opacity: 1;
}

.grid-item.show-filename .item-overlay {
  opacity: 1;
}

.item-name {
  color: white;
  font-size: 11px;
  line-height: 1.3;
  word-break: break-all;
}

.select-check {
  position: absolute;
  top: 6px;
  right: 6px;
}

.mark-badge {
  position: absolute;
  bottom: 0px;
  right: 0px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  opacity: 0.75;
}

.mark-badge-text {
  color: white;
  font-weight: 700;
  line-height: 1;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}

/* 右键菜单背板 */
.ctx-backdrop {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 9998;
}

/* 右键菜单 */
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
