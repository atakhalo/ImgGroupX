<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { state, scanFolders, scanFilesAsVirtualGroup, clearAll, addVirtualGroup, removeVirtualGroup, loadConfig, saveConfig, excludeSubPath, rootExclusions, deleteImages, setupFolderWatcher, refreshFolders, applyFileChanges, startProgressiveScan, handleDirProgress, handleScanComplete } from './stores/imageStore'
import type { ImageItem } from './types'
import GridView from './components/GridView.vue'
import ImageViewer from './components/ImageViewer.vue'
import ControlBar from './components/ControlBar.vue'
import FolderPanel from './components/FolderPanel.vue'
import FilterSortBar from './components/FilterSortBar.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import CompareViewer from './components/CompareViewer.vue'
import LoadPanel from './components/LoadPanel.vue'
import { open, ask } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'

const folderPanelRef = ref<InstanceType<typeof FolderPanel>>()

const viewingIndex = ref(-1)
const viewingImages = ref<ImageItem[]>([])
const viewerKey = ref(0)
const showControls = ref(true)
const isDragOver = ref(false)
const showSettingsPanel = ref(false)

// 新建分组命名
const groupNameInput = ref('')
const showGroupNameInput = ref(false)

// 对比模式
const showCompare = ref(false)
const comparePair = ref<{ left: ImageItem; right: ImageItem } | null>(null)

let unlistenDragDrop: (() => void) | null = null
let unlistenFsChange: (() => void) | null = null

/** 未分组模式：所有图片平铺 */
const displayImages = computed(() => {
  if (state.folderGroup) return []
  return state.allImages
})

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && viewingIndex.value === -1 && !showCompare.value) {
    closeApp()
  }
}

async function closeApp() {
  try {
    await getCurrentWindow().close()
  } catch {
    window.close()
  }
}

onMounted(async () => {
  document.addEventListener('keydown', handleKeydown)
  setupDragDrop()
  await loadConfig()
  settingsReady = true
  // 处理命令行传入的图片路径
  try {
    const cliArgs = await invoke<string[]>('get_cli_args')
    if (cliArgs.length > 0) {
      await handleDroppedPaths(cliArgs)
    }
  } catch { /* 忽略 */ }
  // 监听文件系统变更事件（记录变更路径，仅显示提示不自动应用）
  try {
    const { listen } = await import('@tauri-apps/api/event')
    unlistenFsChange = await listen<string[]>('fs-changed', (event) => {
      const paths = event.payload
      if (paths.length === 0) return
      // 合并新路径到待处理列表（去重）
      const existing = new Set(state.pendingChanges)
      for (const p of paths) {
        if (!existing.has(p)) {
          state.pendingChanges.push(p)
          existing.add(p)
        }
      }
      state.refreshAvailable = true
    })    // 监听渐进扫描进度
    await listen<{ dir: string; images: any[]; root: string }>('scan-dir-progress', (event) => {
      handleDirProgress(event.payload)
    })
    await listen('scan-all-complete', () => {
      handleScanComplete()
      setupFolderWatcher()
    })  } catch { /* 兼容非Tauri环境 */ }
  // 初始化文件监听器
  await setupFolderWatcher()
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  if (unlistenDragDrop) unlistenDragDrop()
  if (unlistenFsChange) unlistenFsChange()
})

let settingsReady = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => state.settings,
  () => {
    if (!settingsReady) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveConfig(), 500)
  },
  { deep: true }
)

async function setupDragDrop() {
  try {
    unlistenDragDrop = await getCurrentWindow().onDragDropEvent((event) => {
      const evt = event.payload
      if (evt.type === 'enter' || evt.type === 'over') {
        isDragOver.value = true
      } else if (evt.type === 'leave') {
        isDragOver.value = false
      } else if (evt.type === 'drop') {
        isDragOver.value = false
        if (evt.paths && evt.paths.length > 0) {
          handleDroppedPaths(Array.from(evt.paths))
        }
      }
    })
  } catch (e) {
    console.warn('拖拽事件注册失败:', e)
  }
}

/** 区分拖入的是文件夹还是文件 */
async function handleDroppedPaths(paths: string[]) {
  const folders: string[] = []
  const files: string[] = []
  for (const p of paths) {
    try {
      const isDir = await invoke<boolean>('check_is_dir', { path: p })
      if (isDir) folders.push(p)
      else files.push(p)
    } catch {
      files.push(p)
    }
  }
  // 文件夹走渐进式扫描
  if (folders.length > 0) {
    await startProgressiveScan(folders)
  }
  // 文件走虚拟分组
  if (files.length > 0) await scanFilesAsVirtualGroup(files)
}

/** 删除文件夹根节点及其图片（保留其他根路径仍覆盖的图片） */
function removeFolderRoot(path: string) {
  const idx = state.loadedRootPaths.indexOf(path)
  if (idx >= 0) state.loadedRootPaths.splice(idx, 1)
  const norm = path.replace(/\\/g, '/').replace(/\/$/, '')
  rootExclusions.delete(norm)
  const remainingRoots = state.loadedRootPaths.map(p => p.replace(/\\/g, '/'))
  state.allImages = state.allImages.filter(img => {
    const imgDir = img.dir.replace(/\\/g, '/')
    if (!imgDir.startsWith(norm)) return true
    return remainingRoots.some(r => imgDir.startsWith(r))
  })
  state.selectedPaths.clear()
  // 更新文件监听器
  setupFolderWatcher()
}

async function handleOpenFolder() {
  try {
    const selected = await open({
      directory: true,
      multiple: true,
      title: '选择文件夹',
    })
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected]
      await startProgressiveScan(paths)
    }
  } catch (e) {
    console.error('打开文件夹失败:', e)
  }
}

async function handleOpenImages() {
  try {
    const selected = await open({
      multiple: true,
      title: '选择图片',
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }],
    })
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected]
      await scanFilesAsVirtualGroup(paths)
    }
  } catch (e) {
    console.error('打开图片失败:', e)
  }
}

function viewImage(item: ImageItem, scope?: ImageItem[]) {
  const images = (scope && state.folderGroup) ? scope : state.allImages
  const idx = images.findIndex(i => i.path === item.path)
  if (idx >= 0) {
    viewingImages.value = [...images]
    viewingIndex.value = idx
  } else {
    viewingImages.value = [item]
    viewingIndex.value = 0
  }
}

function selectImage(item: ImageItem, _ctrl: boolean) {
  // 选择模式：默认多选，点击切换选中/取消
  if (state.selectedPaths.has(item.path)) state.selectedPaths.delete(item.path)
  else state.selectedPaths.add(item.path)
}

function closeViewer() {
  viewingIndex.value = -1
  viewingImages.value = []
}

async function handleViewerDelete(path: string) {
  await deleteImages([path])
  const updated = viewingImages.value.filter(img => img.path !== path)
  if (updated.length === 0) {
    closeViewer()
    viewerKey.value++
    return
  }
  viewingImages.value = updated
  if (viewingIndex.value >= updated.length) {
    viewingIndex.value = updated.length - 1
  }
  viewerKey.value++
}

function toggleFolderGroup() { state.folderGroup = !state.folderGroup }
function toggleGroupTitles() { state.showGroupTitle = !state.showGroupTitle }
function collapseAll() { folderPanelRef.value?.toggleAll(false) }
function expandAll() { folderPanelRef.value?.toggleAll(true) }
function collapseLeaves() { folderPanelRef.value?.collapseLeaves() }

function switchToViewMode() {
  state.selectMode = 'view'
  state.selectedPaths.clear()
}

function switchToSelectMode() {
  state.selectMode = 'select'
}

// 新建分组
function createVirtualGroup() {
  if (state.selectedPaths.size === 0) return
  showGroupNameInput.value = true
  groupNameInput.value = ''
}

function confirmVirtualGroup() {
  const name = groupNameInput.value.trim() || `临时图片分组-${state.virtualGroups.length + 1}`
  const selectedImages = state.allImages.filter(img => state.selectedPaths.has(img.path))
  if (selectedImages.length > 0) {
    addVirtualGroup(name, selectedImages)
  }
  groupNameInput.value = ''
  showGroupNameInput.value = false
  state.selectedPaths.clear()
}

function cancelVirtualGroup() {
  groupNameInput.value = ''
  showGroupNameInput.value = false
}

function handleCompare() {
  const paths = Array.from(state.selectedPaths)
  if (paths.length !== 2) return
  const left = state.allImages.find(img => img.path === paths[0])
  const right = state.allImages.find(img => img.path === paths[1])
  if (left && right) {
    comparePair.value = { left, right }
    showCompare.value = true
  }
}

function closeCompare() {
  showCompare.value = false
  comparePair.value = null
}

function openSettings() {
  showSettingsPanel.value = true
}

function closeSettings() {
  showSettingsPanel.value = false
}

function handleDeleteVirtualGroup(index: number) {
  removeVirtualGroup(index)
}

function handleExcludeNode(rootPath: string, subPath: string) {
  excludeSubPath(rootPath, subPath)
}

async function handleDeleteSelection() {
  const paths = Array.from(state.selectedPaths)
  if (paths.length === 0) return
  const ok = await ask(`确定要删除 ${paths.length} 张图片吗？此操作不可撤销。`, { title: '删除确认', kind: 'warning' })
  if (!ok) return
  await deleteImages(paths)
}

function handleContentWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -10 : 10
    state.settings.gridSize = Math.max(10, Math.min(400, state.settings.gridSize + delta))
  }
}

function handleLoadPanelRelease() {
  // 释放后，可见的 GridItem 会自动重新加载
  // LoadPanel 已调用 releaseBase64，这里通知 GridView 重置显示上限
}

async function handleRefresh() {
  if (state.refreshAvailable && state.pendingChanges.length > 0) {
    // 有变更提示时，细粒度刷新
    const paths = [...state.pendingChanges]
    state.pendingChanges = []
    state.refreshAvailable = false
    await applyFileChanges(paths)
  } else {
    // 无变更提示时，全量刷新
    await refreshFolders()
  }
}
</script>

<template>
  <div
    class="app-root"
    :class="{ 'drag-over': isDragOver }"
  >
    <div class="main-area">
      <div class="top-bar">
        <FilterSortBar @openSettings="openSettings">
          <template #right-prepend>
            <LoadPanel @releaseAll="handleLoadPanelRelease" />
          </template>
        </FilterSortBar>
      </div>

      <div class="content-area" @wheel="handleContentWheel">
        <!-- 未分组模式：所有图片平铺网格 -->
        <template v-if="!state.folderGroup">
          <GridView :images="displayImages" @viewImage="(item: ImageItem, scope?: ImageItem[]) => viewImage(item, scope)" @selectImage="selectImage" />
          <!-- 虚拟分组（未分组模式下额外显示） -->
          <template v-for="(vg, vi) in state.virtualGroups" :key="vg.path">
            <div class="vg-section">
              <div class="vg-section-header">
                <span class="vg-section-icon">📦</span>
                <span class="vg-section-title" :style="{ color: state.settings.rootTitleColor }">{{ vg.name }}</span>
                <span class="vg-section-count">({{ vg.images.length }})</span>
                <button class="vg-section-del" @click="removeVirtualGroup(vi)" title="删除分组">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <GridView :images="vg.images" @viewImage="(item: ImageItem, scope?: ImageItem[]) => viewImage(item, scope)" @selectImage="selectImage" />
            </div>
          </template>
        </template>
        <!-- 分组模式：树状结构 -->
        <template v-else>
          <FolderPanel
            ref="folderPanelRef"
            :images="state.allImages"
            :virtualGroups="state.virtualGroups"
            @viewImage="(item: ImageItem, scope?: ImageItem[]) => viewImage(item, scope)"
            @selectImage="selectImage"
            @deleteVirtualGroup="handleDeleteVirtualGroup"
            @removeRoot="removeFolderRoot"
            @excludeNode="handleExcludeNode"
          />
        </template>
      </div>

      <div class="bottom-bar" :class="{ hidden: !showControls }">
        <ControlBar
          @openFolder="handleOpenFolder"
          @openImages="handleOpenImages"
          @viewMode="switchToViewMode"
          @selectMode="switchToSelectMode"
          @toggleFolderGroup="toggleFolderGroup"
          @toggleGroupTitles="toggleGroupTitles"
          @collapseAll="collapseAll"
          @expandAll="expandAll"
          @collapseLeaves="collapseLeaves"
          @clearAll="clearAll"
          @createGroup="createVirtualGroup"
          @compare="handleCompare"
          @deleteSelection="handleDeleteSelection"
          @refresh="handleRefresh"
        />
      </div>
    </div>

    <!-- 分组命名弹窗 -->
    <Teleport to="body">
      <div v-if="showGroupNameInput" class="name-input-overlay" @click.self="cancelVirtualGroup">
        <div class="name-input-dialog">
          <h4>{{ $t('hint.create_group') }}</h4>
          <p class="name-input-hint">{{ $t('hint.selected_count', { n: state.selectedPaths.size }) }}</p>
          <input
            v-model="groupNameInput"
            type="text"
            class="name-input"
            :placeholder="$t('hint.group_name')"
            @keyup.enter="confirmVirtualGroup"
          />
          <div class="name-input-actions">
            <button class="name-btn secondary" @click="cancelVirtualGroup">{{ $t('settings.reset') }}</button>
            <button class="name-btn primary" @click="confirmVirtualGroup">{{ $t('settings.apply') }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 设置面板 -->
    <SettingsPanel v-if="showSettingsPanel" @close="closeSettings" />

    <!-- 大图查看器 -->
    <ImageViewer v-if="viewingIndex >= 0" :key="viewerKey" :images="viewingImages" :initialIndex="viewingIndex" @close="closeViewer" @deleteImage="handleViewerDelete" />

    <!-- 对比查看器 -->
    <CompareViewer v-if="showCompare && comparePair" :left="comparePair.left" :right="comparePair.right" @close="closeCompare" />

    <!-- 拖入提示 -->
    <div v-if="isDragOver" class="drop-overlay">
      <div class="drop-hint">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p>{{ $t('hint.drag_over') }}</p>
      </div>
    </div>

  </div>
</template>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px; line-height: 1.5; font-weight: 400;
  color: rgba(255,255,255,0.87);
  background-color: #1a1a2e;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  overflow: hidden;
}
html, body, #app { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
</style>

<style scoped>
.app-root { width: 100%; height: 100vh; display: flex; flex-direction: column; background-color: #1a1a2e; position: relative; overflow: hidden; }
.app-root.drag-over { background-color: #1a1a3e; }
.main-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; position: relative; }
.top-bar { padding: 8px 16px 0; flex-shrink: 0; display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.content-area { flex: 1; overflow-y: auto; overflow-x: hidden; }

/* 未分组模式下的虚拟分组区域 */
.vg-section { padding: 0 16px; margin-bottom: 12px; }
.vg-section-header {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06);
  margin-bottom: 8px;
}
.vg-section-icon { font-size: 14px; opacity: 0.7; }
.vg-section-title { font-size: 13px; }
.vg-section-count { font-size: 12px; color: rgba(255,255,255,0.3); margin-left: 4px; }
.vg-section-del {
  margin-left: auto; background: transparent; border: none;
  color: rgba(255,255,255,0.25); cursor: pointer; padding: 2px 4px; border-radius: 3px;
  display: flex; align-items: center;
}
.vg-section-del:hover { color: #ff6b6b; background: rgba(255,60,60,0.1); }
.bottom-bar {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  display: flex;
  justify-content: center;
  transition: opacity 0.3s, transform 0.3s, bottom 0.3s;
  z-index: 100;
  pointer-events: auto;
}
.bottom-bar.hidden {
  opacity: 0;
  bottom: -20px;
  pointer-events: none;
}
.drop-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(26,26,46,0.9); display: flex; align-items: center; justify-content: center; z-index: 500; pointer-events: none; }
.drop-hint { text-align: center; color: rgba(255,255,255,0.5); }
.drop-hint p { margin-top: 16px; font-size: 18px; }


/* 命名弹窗 */
.name-input-overlay {
  position: fixed; top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 2000;
}
.name-input-dialog {
  background: #1e1e3a; border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.1);
  padding: 20px; width: 360px; max-width: 90vw;
}
.name-input-dialog h4 { margin: 0 0 4px; font-size: 15px; color: white; font-weight: 500; }
.name-input-hint { font-size: 12px; color: rgba(255,255,255,0.4); margin-bottom: 12px; }
.name-input {
  width: 100%; padding: 8px 12px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px; color: white; font-size: 14px; outline: none;
}
.name-input:focus { border-color: rgba(100,108,255,0.4); }
.name-input-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
.name-btn {
  padding: 6px 16px; border-radius: 6px; cursor: pointer;
  font-size: 13px; border: 1px solid transparent;
}
.name-btn.primary { background: rgba(100,108,255,0.2); border-color: rgba(100,108,255,0.3); color: #aab0ff; }
.name-btn.primary:hover { background: rgba(100,108,255,0.3); }
.name-btn.secondary { background: transparent; border-color: rgba(255,255,255,0.1); color: rgba(255,255,255,0.5); }
.name-btn.secondary:hover { background: rgba(255,255,255,0.06); color: white; }
</style>
