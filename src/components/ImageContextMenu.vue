<script setup lang="ts">
import type { ImageItem, MarkLevel } from '../types'
import { state, showToast, showRenameDialog, setImageMark, applyFileChanges, setSuppressWatcher } from '../stores/imageStore'
import { t } from '../i18n'
import { invoke } from '@tauri-apps/api/core'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFiles } from 'tauri-plugin-clipboard-api'

const props = defineProps<{
  show: boolean
  x: number
  y: number
  item: ImageItem | null
  imgSrc?: string
  /** 'grid' → 显示"查看"作为第一项, 'viewer' → 显示"关闭"作为第一项 */
  mode: 'grid' | 'viewer'
}>()

const emit = defineEmits<{
  close: []
  view: []
  closeViewer: []
  showMetadata: [item: ImageItem]
}>()

function close() {
  emit('close')
}

/* ===== 第一项 ===== */
function handleFirstAction() {
  close()
  if (props.mode === 'grid') {
    emit('view')
  } else {
    emit('closeViewer')
  }
}

/* ===== 标记 ===== */
function handleSetMark(level: MarkLevel) {
  close()
  if (props.item) setImageMark(props.item.path, level)
}

/* ===== 复制图片 ===== */
async function handleCopyImage() {
  close()
  const src = props.imgSrc
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

/* ===== 复制路径 ===== */
async function handleCopyPath() {
  close()
  const p = props.item?.path
  if (!p) return
  try {
    await navigator.clipboard.writeText(p)
    showToast('已复制路径')
  } catch {
    const ta = document.createElement('textarea')
    ta.value = p
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

/* ===== 复制为文件 ===== */
async function handleCopyFile() {
  close()
  const p = props.item?.path
  if (!p) return
  try {
    await writeFiles([p])
    showToast(t('hint.copy_file') + ' — ' + t('hint.copy_file_tip'))
  } catch (e: any) {
    showToast(t('hint.copy_file') + '失败: ' + (e.message || e))
  }
}

/* ===== 重命名 ===== */
function handleRename() {
  close()
  if (props.item) showRenameDialog(props.item)
}

/* ===== 另存为 ===== */
async function handleSaveAs() {
  close()
  const item = props.item
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

/* ===== 设置为壁纸 ===== */
async function handleSetWallpaper() {
  close()
  const item = props.item
  if (!item) return
  try {
    await invoke('set_wallpaper', { path: item.path })
    showToast(t('hint.wallpaper_set'))
  } catch (e: any) {
    showToast(t('hint.wallpaper_set_failed', { msg: e.message || e }))
  }
}

/* ===== 元信息 ===== */
function handleMetadata() {
  close()
  if (props.item) emit('showMetadata', props.item)
}

/* ===== 资源管理器打开 ===== */
function handleOpenExplorer() {
  close()
  const p = props.item?.path
  if (p) revealItemInDir(p).catch(() => {})
}

/* ===== 默认程序打开 ===== */
async function handleOpenDefault() {
  close()
  const p = props.item?.path
  if (p) invoke('open_in_explorer', { path: p }).catch(() => {})
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="imctx-backdrop" @click.self="close" @contextmenu.prevent="close"></div>
    <div v-if="show" class="imctx-menu" :style="{ left: x + 'px', top: y + 'px' }" @click.stop>
      <!-- 第一项：查看（grid） / 关闭（viewer） -->
      <button class="imctx-item" @click="handleFirstAction">
        <svg v-if="mode === 'grid'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
        </svg>
        <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
        <span>{{ mode === 'grid' ? $t('viewer.view') : $t('viewer.close') }}</span>
      </button>

      <div class="imctx-sep"></div>

      <!-- 标记子菜单 -->
      <div class="imctx-item imctx-hoverable">
        <div class="imctx-item-inner">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          <span>{{ $t('control.mark') }}</span>
          <svg class="imctx-sub-arrow" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
        <div class="imctx-submenu">
          <button
            v-for="lv in 5" :key="lv"
            class="imctx-subitem"
            @click="handleSetMark(lv as MarkLevel)"
          >
            <span class="imctx-mark-dot" :style="{ background: state.settings.markColors[lv - 1] }"></span>
            <span>{{ $t('viewer.mark_level', { n: lv }) }}</span>
          </button>
          <div class="imctx-sep"></div>
          <button class="imctx-subitem" @click="handleSetMark(0)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            <span>{{ $t('viewer.mark_clear') }}</span>
          </button>
        </div>
      </div>

      <div class="imctx-sep"></div>

      <!-- 复制图片 -->
      <button class="imctx-item" @click="handleCopyImage">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
        </svg>
        <span>复制图片</span>
      </button>

      <!-- 复制路径 -->
      <button class="imctx-item" @click="handleCopyPath">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        <span>{{ $t('hint.copy_path') }}</span>
      </button>

      <!-- 复制为文件 -->
      <button class="imctx-item" @click="handleCopyFile" :title="$t('hint.copy_file_tip')">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
        </svg>
        <span>{{ $t('hint.copy_file') }}</span>
      </button>

      <div class="imctx-sep"></div>

      <!-- 重命名 -->
      <button class="imctx-item" @click="handleRename">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
        </svg>
        <span>{{ $t('viewer.rename') }}</span>
      </button>

      <!-- 另存为 -->
      <button class="imctx-item" @click="handleSaveAs">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
        </svg>
        <span>另存为</span>
      </button>

      <!-- 设置为壁纸 -->
      <button class="imctx-item" @click="handleSetWallpaper">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
        </svg>
        <span>{{ $t('viewer.set_wallpaper') }}</span>
      </button>

      <div class="imctx-sep"></div>

      <!-- 元信息 -->
      <button class="imctx-item" @click="handleMetadata">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        <span>{{ $t('viewer.metadata') }}</span>
      </button>

      <!-- 资源管理器打开 -->
      <button class="imctx-item" @click="handleOpenExplorer">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span>{{ $t('folder.open_in_explorer') }}</span>
      </button>

      <!-- 默认程序打开 -->
      <button class="imctx-item" @click="handleOpenDefault">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
        </svg>
        <span>{{ $t('viewer.default') }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
/* ===== 背景遮罩 ===== */
.imctx-backdrop {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 9999;
}

/* ===== 主菜单容器 ===== */
.imctx-menu {
  position: fixed;
  z-index: 10000;
  min-width: 180px;
  background: rgba(35, 35, 55, 0.97);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  user-select: none;
}

/* ===== 菜单项 ===== */
.imctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #e0e0f0;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  text-align: left;
  transition: background 0.1s;
}
.imctx-item:hover {
  background: rgba(100, 108, 255, 0.25);
}
.imctx-item svg {
  flex-shrink: 0;
}

/* ===== 分隔线 ===== */
.imctx-sep {
  height: 1px;
  margin: 4px 8px;
  background: rgba(255, 255, 255, 0.08);
}

/* ===== 可展开的子菜单容器 ===== */
.imctx-hoverable {
  position: relative;
  padding: 0;
}
.imctx-hoverable > .imctx-item-inner {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
}
.imctx-hoverable:hover > .imctx-item-inner {
  background: rgba(100, 108, 255, 0.25);
}

/* ===== 子菜单箭头 ===== */
.imctx-sub-arrow {
  margin-left: auto;
  opacity: 0.5;
  transition: opacity 0.1s;
}
.imctx-hoverable:hover .imctx-sub-arrow {
  opacity: 1;
}

/* ===== 子菜单弹出面板 ===== */
.imctx-submenu {
  display: none;
  position: absolute;
  left: 100%;
  top: 0;
  min-width: 150px;
  background: rgba(35, 35, 55, 0.97);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  z-index: 10001;
}
.imctx-hoverable:hover > .imctx-submenu,
.imctx-submenu:hover {
  display: block;
}

/* ===== 子菜单项 ===== */
.imctx-subitem {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #e0e0f0;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  text-align: left;
  transition: background 0.1s;
}
.imctx-subitem:hover {
  background: rgba(100, 108, 255, 0.25);
}

/* ===== 标记圆点 ===== */
.imctx-mark-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  font-size: 10px;
  color: #fff;
  flex-shrink: 0;
}
</style>
