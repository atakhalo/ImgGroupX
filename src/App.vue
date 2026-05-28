<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { t } from './i18n'
import { matchShortcut } from './utils/shortcuts'
import { state, scanFilesAsVirtualGroup, clearAll, addVirtualGroup, removeVirtualGroup, loadConfig, saveConfig, excludeSubPath, rootExclusions, deleteImages, setupFolderWatcher, refreshFolders, applyFileChanges, startProgressiveScan, handleDirProgress, handleScanComplete, buildFolderTree, findSubTreeInTree, toastState, moveSelectedImages, copySelectedImages, collectAllSelectedPaths, deleteSelectedContents, copyImagesToFolder, moveImagesToFolder, closeRenameDialog, renameImage } from './stores/imageStore'
import type { ImageItem, FolderNode } from './types'
import GridView from './components/GridView.vue'
import ImageViewer from './components/ImageViewer.vue'
import ControlBar from './components/ControlBar.vue'
import SelectionBar from './components/SelectionBar.vue'
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

// 内容区右键菜单（模式切换）
const contentCtx = ref({ show: false, x: 0, y: 0 })
function handleContentCtxMenu(e: MouseEvent) {
  // 单元格有自己的右键菜单，不处理
  const target = e.target as HTMLElement
  if (target.closest('.grid-item')) return
  // 标题栏有自己的右键菜单，不重复弹出
  if (target.closest('.folder-header')) return
  e.preventDefault()
  contentCtx.value = { show: true, x: Math.min(e.clientX, window.innerWidth - 180), y: Math.min(e.clientY, window.innerHeight - 120) }
}
function closeContentCtx() { contentCtx.value.show = false }
function ctxSwitchToViewMode() {
  closeContentCtx()
  state.selectMode = 'view'
  state.selectedPaths.clear()
  state.selectedFolderPaths.clear()
}
function ctxSwitchToSelectMode() {
  closeContentCtx()
  state.selectMode = 'select'
}

// 命令行单图：待打开图片路径（加载完父文件夹后自动大图显示）
const pendingOpenImagePath = ref('')

let unlistenDragDrop: (() => void) | null = null
let unlistenFsChange: (() => void) | null = null

/** 未分组模式：所有图片平铺 */
const displayImages = computed(() => {
  if (state.folderGroup) return []
  return state.allImages
})

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (showSettingsPanel.value) {
      closeSettings()
    } else if (viewingIndex.value >= 0) {
      closeViewer()
    } else if (showCompare.value) {
      closeCompare()
    } else {
      closeApp()
    }
  } else if (matchShortcut(e, 'global.modeSwitch') && viewingIndex.value < 0 && !showCompare.value) {
    e.preventDefault()
    if (state.selectMode === 'view') {
      state.selectMode = 'select'
    } else {
      state.selectMode = 'view'
      state.selectedPaths.clear()
      state.selectedFolderPaths.clear()
    }
  }
}

async function closeApp() {
  try {
    await getCurrentWindow().close()
  } catch {
    window.close()
  }
}

function preventCtx(e: MouseEvent) { e.preventDefault() }

onMounted(async () => {
  document.addEventListener('keydown', handleKeydown)
  // 全局取消浏览器默认右键菜单
  document.addEventListener('contextmenu', preventCtx)
  setupDragDrop()
  await loadConfig()
  settingsReady = true

  // 先注册事件监听器（确保 CLI 扫描时事件不丢失）
  try {
    const { listen } = await import('@tauri-apps/api/event')
    unlistenFsChange = await listen<string[]>('fs-changed', (event) => {
      const paths = event.payload
      if (paths.length === 0) return
      const existing = new Set(state.pendingChanges)
      for (const p of paths) {
        if (!existing.has(p)) {
          state.pendingChanges.push(p)
          existing.add(p)
        }
      }
      state.refreshAvailable = true
    })
    await listen<{ dir: string; images: any[]; root: string }>('scan-dir-progress', (event) => {
      handleDirProgress(event.payload)
    })
    await listen('scan-all-complete', () => {
      handleScanComplete()
      setupFolderWatcher()
    })
  } catch { /* 兼容非Tauri环境 */ }

  // 初始化文件监听器
  await setupFolderWatcher()

  // 再处理命令行参数（此时事件监听器已就绪，不会丢失扫描事件）
  try {
    const cliArgs = await invoke<string[]>('get_cli_args')
    if (cliArgs.length === 1) {
      const isDir = await invoke<boolean>('check_is_dir', { path: cliArgs[0] })
      if (!isDir) {
        // 单图：加载父文件夹，扫描完成后自动打开大图
        const parentDir = cliArgs[0].replace(/\\/g, '/').replace(/\/[^/]+$/, '')
        if (parentDir) {
          // 规范化待打开路径（统一正斜杠，便于后续匹配）
          pendingOpenImagePath.value = cliArgs[0].replace(/\\/g, '/')
          await startProgressiveScan([parentDir])
          // 等待扫描完成（loading=false）后自动打开大图
          const tryOpenImage = () => {
            if (!pendingOpenImagePath.value) return
            const target = pendingOpenImagePath.value
            const item = state.allImages.find(i =>
              i.path.replace(/\\/g, '/') === target
            )
            if (item) viewImage(item)
            pendingOpenImagePath.value = ''
            stopWatch()
          }
          const stopWatch = watch(() => state.loading, (loading) => {
            if (!loading) tryOpenImage()
          })
          // 防止扫描在 watch 创建前就已结束（极小文件夹等场景）
          if (!state.loading) tryOpenImage()
        }
      } else {
        await handleDroppedPaths(cliArgs)
      }
    } else if (cliArgs.length > 0) {
      await handleDroppedPaths(cliArgs)
    }
  } catch { /* 忽略 */ }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('contextmenu', preventCtx)
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
  const norm = path.replace(/\\/g, '/').replace(/\/$/, '')
  // 如果正在扫描中，取消后台扫描线程并标记忽略该根路径的后续事件
  if (state.loading) {
    invoke('cancel_scan')
    state.cancelledRoots.add(norm)
  }
  const idx = state.loadedRootPaths.indexOf(path)
  if (idx >= 0) state.loadedRootPaths.splice(idx, 1)
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
      title: t('dialog.select_folder'),
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
      title: t('dialog.select_images'),
      filters: [{ name: t('dialog.image_filter'), extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff', 'jxl', 'avif', 'svg', 'pcx', 'ico'] }],
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

async function handleViewerDelete(path: string, index: number) {
  await deleteImages([path])
  const updated = viewingImages.value.filter(img => img.path !== path)
  if (updated.length === 0) {
    closeViewer()
    viewerKey.value++
    return
  }
  viewingImages.value = updated
  // 使用删除时的实际索引计算新位置，避免因查看器内导航导致索引不同步
  viewingIndex.value = Math.min(index, updated.length - 1)
}

/** 收集树中所有节点的图片组（后序遍历：子节点→父节点） */
function collectAllImageGroups(): { images: ImageItem[]; path: string }[] {
  const groups: { images: ImageItem[]; path: string }[] = []
  const tree = buildFolderTree(state.allImages, state.loadedRootPaths)
  function walk(nodes: FolderNode[]) {
    for (const node of nodes) {
      if (node.children.length > 0) {
        walk(node.children)
      }
      if (node.images.length > 0) {
        groups.push({ images: node.images, path: node.path })
      }
    }
  }
  walk(tree)
  return groups
}

/** 查找当前图片所属的节点组索引 */
function findCurrentGroupIndex(groups: { images: ImageItem[]; path: string }[], imagePath: string): number {
  return groups.findIndex(g => g.images.some(img => img.path === imagePath))
}

/** 大图查看器：切换到上一节点 */
function handleViewerPrevNode() {
  const currentItem = viewingImages.value[viewingIndex.value]
  if (!currentItem) return
  const groups = collectAllImageGroups()
  const idx = findCurrentGroupIndex(groups, currentItem.path)
  if (idx <= 0) return
  const prevGroup = groups[idx - 1]
  viewingImages.value = [...prevGroup.images]
  viewingIndex.value = prevGroup.images.length - 1
}

/** 大图查看器：切换到下一节点 */
function handleViewerNextNode() {
  const currentItem = viewingImages.value[viewingIndex.value]
  if (!currentItem) return
  const groups = collectAllImageGroups()
  const idx = findCurrentGroupIndex(groups, currentItem.path)
  if (idx < 0 || idx >= groups.length - 1) return
  const nextGroup = groups[idx + 1]
  viewingImages.value = [...nextGroup.images]
  viewingIndex.value = 0
}

function toggleFolderGroup() { state.folderGroup = !state.folderGroup }
function toggleGroupTitles() { state.showGroupTitle = !state.showGroupTitle }
function collapseAll() { folderPanelRef.value?.toggleAll(false) }
function expandAll() { folderPanelRef.value?.toggleAll(true) }
function collapseLeaves() { folderPanelRef.value?.collapseLeaves() }

function switchToViewMode() {
  state.selectMode = 'view'
  state.selectedPaths.clear()
  state.selectedFolderPaths.clear()
}

function switchToSelectMode() {
  state.selectMode = 'select'
}

// 新建分组
function createVirtualGroup() {
  if (state.selectedPaths.size === 0 && state.selectedFolderPaths.size === 0) return
  showGroupNameInput.value = true
  groupNameInput.value = ''
}

/** 递归将子树的相对路径转为绝对路径（利用图片的 dir 字段） */
function makeNodePathsAbsolute(node: import('./types').FolderNode) {
  if (node.images.length > 0) {
    const absDir = node.images[0].dir.replace(/\\/g, '/')
    node.path = absDir
  }
  for (const child of node.children) {
    makeNodePathsAbsolute(child)
  }
}

function confirmVirtualGroup() {
  const name = groupNameInput.value.trim() || `${t('virtual_group_default')}-${state.virtualGroups.length + 1}`
  const selectedImages = state.allImages.filter(img => state.selectedPaths.has(img.path))
  // 构建选中的文件夹节点子树
  const childNodes: import('./types').FolderNode[] = []
  const fullTree = buildFolderTree(state.allImages, state.loadedRootPaths)
  for (const fp of state.selectedFolderPaths) {
    const found = findSubTreeInTree(fullTree, fp)
    if (found) {
      makeNodePathsAbsolute(found)
      childNodes.push(found)
    }
  }
  if (selectedImages.length > 0 || childNodes.length > 0) {
    addVirtualGroup(name, selectedImages, childNodes)
  }
  groupNameInput.value = ''
  showGroupNameInput.value = false
  state.selectedPaths.clear()
  state.selectedFolderPaths.clear()
}

function cancelVirtualGroup() {
  groupNameInput.value = ''
  showGroupNameInput.value = false
}

function confirmRename() {
  const item = state.renameDialog.item
  const name = state.renameDialog.name.trim()
  if (!item || !name) return
  closeRenameDialog()
  renameImage(item, name)
}

function handleCompare() {
  if (state.selectedFolderPaths.size > 0) return
  const paths = Array.from(state.selectedPaths)
  if (paths.length !== 2) return
  const left = state.allImages.find(img => img.path === paths[0])
  const right = state.allImages.find(img => img.path === paths[1])
  if (left && right) {
    comparePair.value = { left, right }
    showCompare.value = true
  }
}

function handleToggleSelectFolder(path: string) {
  if (state.selectedFolderPaths.has(path)) {
    state.selectedFolderPaths.delete(path)
  } else {
    state.selectedFolderPaths.add(path)
  }
}

async function handleCopyToFolder(targetPath: string) {
  try {
    const dir = targetPath.replace(/\\/g, '/')
    await copyImagesToFolder(dir)
  } catch (e: any) {
    console.error('复制失败:', e)
  }
}

async function handleMoveToFolder(targetPath: string) {
  try {
    const dir = targetPath.replace(/\\/g, '/')
    await moveImagesToFolder(dir)
  } catch (e: any) {
    console.error('移动失败:', e)
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
  const allPaths = collectAllSelectedPaths()
  const folderCount = state.selectedFolderPaths.size
  if (allPaths.length === 0 && folderCount === 0) return
  let msg: string
  if (folderCount > 0) {
    msg = t('dialog.delete_folder_confirm', { n: folderCount, m: allPaths.length })
  } else {
    msg = t('dialog.delete_image_confirm', { n: allPaths.length })
  }
  const ok = await ask(msg, { title: t('dialog.delete_confirm'), kind: 'warning' })
  if (!ok) return
  await deleteSelectedContents()
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
    // 先取消正在进行的扫描
    if (state.loading) { invoke('cancel_scan') }
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
          <template #left-prepend>
            <!-- 打开文件夹 -->
            <button class="top-btn" :title="$t('control.open_folder')" @click="handleOpenFolder">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span>{{ $t('control.open') }}</span>
            </button>
            <!-- 打开图片 -->
            <button class="top-btn" :title="$t('control.open_images')" @click="handleOpenImages">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              <span>{{ $t('control.images') }}</span>
            </button>
            <!-- 刷新 -->
            <button class="top-btn refresh-btn" :class="{ 'has-update': state.refreshAvailable }" :title="$t('control.refresh')" @click="handleRefresh">
              <span class="refresh-icon-wrap">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" class="refresh-icon">
                  <path d="M23 4v6h-6" />
                  <path d="M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                <span v-if="state.refreshAvailable" class="refresh-dot"></span>
              </span>
              <span>{{ $t('control.refresh') }}</span>
            </button>
          </template>
          <template #right-prepend>
            <LoadPanel @releaseAll="handleLoadPanelRelease" />
          </template>
        </FilterSortBar>
      </div>

      <div class="content-area" @wheel="handleContentWheel" @contextmenu="handleContentCtxMenu">
        <!-- 内容区右键菜单（模式切换） -->
        <Teleport to="body">
          <div v-if="contentCtx.show" class="content-ctx-backdrop" @click="closeContentCtx"></div>
          <div v-if="contentCtx.show" class="content-ctx-menu" :style="{ left: contentCtx.x + 'px', top: contentCtx.y + 'px' }" @click.stop>
            <button v-if="state.selectMode === 'select'" class="content-ctx-item" @click="ctxSwitchToViewMode">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
              <span>查看模式</span>
            </button>
            <button v-else class="content-ctx-item" @click="ctxSwitchToSelectMode">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
              </svg>
              <span>选择模式</span>
            </button>
            <div class="content-ctx-separator"></div>
            <button class="content-ctx-item" :class="{ active: state.alwaysShowFileName }" @click="state.alwaysShowFileName = !state.alwaysShowFileName; closeContentCtx()">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <line x1="3" y1="9" x2="21" y2="9"/>
                <line x1="9" y1="21" x2="9" y2="9"/>
              </svg>
              <span>文件名</span>
            </button>
          </div>
        </Teleport>
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
            @toggleSelectFolder="handleToggleSelectFolder"
            @copyToFolder="handleCopyToFolder"
            @moveToFolder="handleMoveToFolder"
          />
        </template>
      </div>

      <div class="bottom-bar" :class="{ hidden: !showControls }">
        <div class="sub-bar-row">
          <SelectionBar
            @createGroup="createVirtualGroup"
            @compare="handleCompare"
            @deleteSelection="handleDeleteSelection"
            @moveSelection="moveSelectedImages"
            @copySelection="copySelectedImages"
          />
        </div>
        <ControlBar
          @viewMode="switchToViewMode"
          @selectMode="switchToSelectMode"
          @toggleFolderGroup="toggleFolderGroup"
          @toggleGroupTitles="toggleGroupTitles"
          @collapseAll="collapseAll"
          @expandAll="expandAll"
          @collapseLeaves="collapseLeaves"
          @clearAll="clearAll"
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

    <!-- 重命名弹窗 -->
    <Teleport to="body">
      <div v-if="state.renameDialog.show" class="name-input-overlay" @click.self="closeRenameDialog">
        <div class="name-input-dialog">
          <h4>重命名</h4>
          <p class="name-input-hint">{{ state.renameDialog.item?.name }}</p>
          <input
            v-model="state.renameDialog.name"
            type="text"
            class="name-input"
            placeholder="输入新文件名"
            @keyup.enter="confirmRename"
          />
          <div class="name-input-actions">
            <button class="name-btn secondary" @click="closeRenameDialog">取消</button>
            <button class="name-btn primary" @click="confirmRename">确认</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 设置面板 -->
    <SettingsPanel v-if="showSettingsPanel" @close="closeSettings" />

    <!-- 大图查看器 -->
    <ImageViewer v-if="viewingIndex >= 0" :key="viewerKey" :images="viewingImages" :initialIndex="viewingIndex" @close="closeViewer" @deleteImage="handleViewerDelete" @prevNode="handleViewerPrevNode" @nextNode="handleViewerNextNode" />

    <!-- 对比查看器 -->
    <CompareViewer v-if="showCompare && comparePair" :left="comparePair.left" :right="comparePair.right" @close="closeCompare" />

    <!-- 冒泡提示 -->
    <div v-if="toastState.visible" class="toast-bubble">{{ toastState.text }}</div>

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
.content-area {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding-bottom: 80px; /* 为底部固定控制栏留出空间，避免最后图片被遮挡 */
}

/* 内容区右键菜单 */
.content-ctx-backdrop {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 9998;
}
.content-ctx-menu {
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
.content-ctx-item {
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
.content-ctx-item:hover {
  background: rgba(100, 108, 255, 0.2);
  color: white;
}
.content-ctx-item.active {
  background: rgba(100, 108, 255, 0.3);
  color: #aab0ff;
}
.content-ctx-separator {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 4px 8px;
}

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

/* 顶部按钮 */
.top-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: rgba(255,255,255,0.65);
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
  flex-shrink: 0;
}
.top-btn:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.9); }
.refresh-icon-wrap { position: relative; display: flex; }
.refresh-dot {
  position: absolute; top: -2px; right: -2px;
  width: 6px; height: 6px; border-radius: 50%;
  background: #646cff;
}

.bottom-bar {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  transition: opacity 0.3s, transform 0.3s, bottom 0.3s;
  z-index: 100;
  pointer-events: auto;
}
.bottom-bar.hidden {
  opacity: 0;
  bottom: -40px;
  pointer-events: none;
}

.sub-bar-row {
  display: flex;
  justify-content: center;
}
.toast-bubble {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(40,40,80,0.95);
  color: rgba(255,255,255,0.9);
  padding: 10px 24px;
  border-radius: 10px;
  font-size: 14px;
  z-index: 1000;
  pointer-events: none;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  border: 1px solid rgba(255,255,255,0.1);
  backdrop-filter: blur(8px);
  animation: toast-in 0.25s ease-out;
}
@keyframes toast-in {
  from { opacity: 0; transform: translateX(-50%) translateY(12px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
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
