<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FolderNode, ImageItem } from '../types'
import { state, openInExplorer, saveVirtualGroup, getProcessedImages, startProgressiveScan } from '../stores/imageStore'
import GridView from './GridView.vue'
import GridItem from './GridItem.vue'
import FolderGroup from './FolderGroup.vue'

defineOptions({
  name: 'FolderGroup',
})

const props = withDefaults(defineProps<{
  node: FolderNode
  depth: number
  rootPath: string
  showTitle: boolean
  getExpanded: (node: FolderNode) => boolean
  isVirtualRoot?: boolean
  vgIndex?: number
  collapsePrefix?: string
  /** 真实层级深度（不受压缩影响） */
  realDepth?: number
}>(), {
  collapsePrefix: '',
  realDepth: 0,
})

const emit = defineEmits<{
  toggle: [node: FolderNode]
  viewImage: [item: ImageItem, scope?: ImageItem[]]
  selectImage: [item: ImageItem, ctrl: boolean]
  removeRoot: [path: string]
  excludeNode: [rootPath: string, subPath: string]
  toggleSelectFolder: [path: string]
  addToVirtualGroup: [vgIndex: number]
  removeFromVirtualGroup: [vgIndex: number]
  copyToFolder: [targetPath: string]
  moveToFolder: [targetPath: string]
}>()

function handleToggle() {
  emit('toggle', props.node)
}

function handleSelectClick(e: MouseEvent) {
  e.stopPropagation()
  // 虚拟根节点（depth=0 且 isVirtualRoot）不可选，子节点可选
  if (!(props.isVirtualRoot && props.depth === 0) && state.selectMode === 'select') {
    emit('toggleSelectFolder', props.node.path)
  }
}

function parentPath(path: string): string {
  // 先去掉尾部斜杠，避免 lastIndexOf 定位到末尾
  const clean = path.replace(/\/$/, '')
  const i = clean.lastIndexOf('/')
  if (i <= 0) return ''
  return clean.substring(0, i + 1)
}

function totalCount(node: FolderNode): number {
  let n = node.images.length
  for (const child of node.children) {
    n += totalCount(child)
  }
  return n
}

/** 获取节点的绝对路径（子节点 node.path 是相对路径，需拼接 rootPath） */
function getNodeAbsolutePath(): string {
  const root = props.rootPath.replace(/\\/g, '/').replace(/\/$/, '')
  if (props.depth === 0) return root
  const rel = props.node.path.replace(/\\/g, '/')
  return root + '/' + rel
}

function handleRemove() {
  if (props.depth === 0) {
    emit('removeRoot', props.node.path)
  } else {
    emit('excludeNode', props.rootPath, props.node.path)
  }
}

const isSelected = () => state.selectedFolderPaths.has(props.node.path)

/** 递归收集节点下所有图片路径 */
function collectAllImagePaths(node: FolderNode): string[] {
  const paths: string[] = node.images.map(img => img.path)
  for (const child of node.children) {
    paths.push(...collectAllImagePaths(child))
  }
  return paths
}

/** 全选：选中节点下所有图片（含子节点） */
function selectAll() {
  const paths = collectAllImagePaths(props.node)
  for (const p of paths) {
    state.selectedPaths.add(p)
  }
}

/** 反选：反转节点下所有图片的选中状态 */
function invertSelection() {
  const paths = collectAllImagePaths(props.node)
  for (const p of paths) {
    if (state.selectedPaths.has(p)) state.selectedPaths.delete(p)
    else state.selectedPaths.add(p)
  }
}

/** 一级图片：仅选中节点直接下的图片 */
function selectDirectImages() {
  for (const img of props.node.images) {
    state.selectedPaths.add(img.path)
  }
}

/** 节点内（含子节点）被勾选的图片数 */
function countSelectedInNode(node: FolderNode): number {
  let n = 0
  for (const img of node.images) {
    if (state.selectedPaths.has(img.path)) n++
  }
  for (const child of node.children) {
    n += countSelectedInNode(child)
  }
  return n
}

/** 节点内图片选中状态：'none' | 'partial' | 'all' */
const nodeSelectionState = computed<'none' | 'partial' | 'all'>(() => {
  const total = totalCount(props.node)
  if (total === 0) return 'none'
  const selected = countSelectedInNode(props.node)
  if (selected === 0) return 'none'
  if (selected === total) return 'all'
  return 'partial'
})

/** 节点是否既有子节点又有图片（用于控制"一级图片"按钮显示） */
const hasBothChildrenAndImages = computed(() =>
  props.node.children.length > 0 && props.node.images.length > 0
)

/** 检查虚拟分组中是否有一级选中项（用于显示移除按钮） */
const hasFirstLevelSelection = () => {
  if (!props.isVirtualRoot || props.depth !== 0) return false
  // 一级图片：直接挂在虚拟根节点上的图片
  for (const img of props.node.images) {
    if (state.selectedPaths.has(img.path)) return true
  }
  // 一级子节点：虚拟根的直接 children
  for (const child of props.node.children) {
    if (state.selectedFolderPaths.has(child.path)) return true
  }
  return false
}

/** 是否有任意选中项（用于显示 移动至此/复制至此 按钮） */
const hasAnySelection = computed(() =>
  state.selectedPaths.size > 0 || state.selectedFolderPaths.size > 0
)

/** 是否启用层级压缩（只有一个子节点且无图片时跳过自身） */
const shouldCollapse = computed(() => {
  if (!state.settings.collapseHierarchy) return false
  // 根节点不压缩
  if (props.depth === 0) return false
  if (props.node.children.length !== 1) return false
  // 有图片（一级图片）的节点不压缩，避免图片归属混乱
  if (props.node.images.length > 0) return false
  return true
})

/** 压缩路径分段：每段对应其原始层级 */
const collapsePrefixSegments = computed(() => {
  const prefix = props.collapsePrefix
  if (!prefix) return []
  const parts = prefix.split(' / ').filter(Boolean)
  // 根据 realDepth 计算每段的起始层级
  const startLevel = props.realDepth - parts.length
  return parts.map((name, i) => ({
    name: name + ' / ',
    level: startLevel + i,
  }))
})

/** 获取路径段在对应层级的颜色（与 getBaseColor 映射一致） */
function getSegmentColor(level: number): string {
  if (!state.settings.rainbowEnabled) return 'rgba(255, 255, 255, 0.35)'
  // 使用 getBaseColor(level + 1)，与节点着色算法一致
  return hexToRgba(getBaseColor(level), 0.85)
}

/** 此节点自身是否采用紧凑布局 */
const isCompactNode = computed(() => {
  if (!state.settings.compactMode) return false
  // 根节点不紧凑
  if (props.depth === 0) return false
  // 虚拟分组的一级子节点不紧凑
  if (props.isVirtualRoot && props.depth === 1) return false
  return true
})

/** 内容区域是否使用统一网格（子节点+图片混合排列）
 *  与 isCompactNode 不同：根节点自身不紧凑，但内容区域也可使用统一网格 */
const useUnifiedGrid = computed(() => {
  if (!state.settings.compactMode) return false
  // 虚拟分组的一级子节点不紧凑，内容也不使用统一网格
  if (props.isVirtualRoot && props.depth === 1) return false
  return true
})

/** 此节点的子节点是否需要放在 flex-wrap 容器中 */
const wrapChildren = computed(() => {
  if (!state.settings.compactMode) return false
  // 虚拟根节点的一级子节点不紧凑，不需要 wrap
  if (props.isVirtualRoot && props.depth === 0) return false
  return true
})

/** 紧凑模式下统一网格中的图片列表（排序+筛选） */
const processedImages = computed(() => getProcessedImages(props.node.images))

function isImageSelected(item: ImageItem): boolean {
  return state.selectedPaths.has(item.path)
}

function handleGridImageClick(item: ImageItem) {
  emit('viewImage', item, processedImages.value)
}

function handleGridImageSelect(item: ImageItem, ctrl: boolean) {
  emit('selectImage', item, ctrl)
}

/** 标题栏右键菜单状态 */
const headerCtxMenu = ref({ show: false, x: 0, y: 0 })

function openHeaderCtxMenu(e: MouseEvent) {
  e.preventDefault()
  headerCtxMenu.value = {
    show: true,
    x: Math.min(e.clientX, window.innerWidth - 200),
    y: Math.min(e.clientY, window.innerHeight - 350),
  }
}

function closeHeaderCtxMenu() {
  headerCtxMenu.value.show = false
}

/** 向上：加载父文件夹并移除当前根节点 */
async function handleUp() {
  if (props.depth !== 0 || props.isVirtualRoot) return
  const currentPath = getNodeAbsolutePath()
  const parent = parentPath(currentPath)
  if (!parent || parent === currentPath) return
  // 先移除当前根节点（会取消正在进行的扫描），再加载父文件夹
  emit('removeRoot', props.node.path)
  const cleanParent = parent.replace(/\/$/, '')
  await startProgressiveScan([cleanParent])
}

/** 复制文件夹路径到剪贴板 */
async function handleCopyFolderPath() {
  const p = getNodeAbsolutePath()
  try {
    await navigator.clipboard.writeText(p)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = p
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

function handleCopyToFolder() {
  const p = getNodeAbsolutePath()
  console.log('FolderGroup emit copyToFolder:', p)
  emit('copyToFolder', p)
}

function handleMoveToFolder() {
  const p = getNodeAbsolutePath()
  console.log('FolderGroup emit moveToFolder:', p)
  emit('moveToFolder', p)
}

// 调试：暴露 hasAnySelection 到 window
if (import.meta.env.DEV) {
  const win = window as any
  win.__debug = { state, hasAnySelection }
}

/** 是否应该显示路径（虚拟根的一级子节点 或 普通根节点） */
const shouldShowPath = () => {
  if (props.isVirtualRoot) return props.depth === 1
  return props.depth === 0
}


/** hex → rgba */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/** 获取节点基础色（子标题背景色 or 彩虹色） */
function getBaseColor(depth: number): string {
  if (depth === 0) return state.settings.rootTitleBgColor
  if (!state.settings.rainbowEnabled) return state.settings.childTitleBgColor
  const colors = state.settings.rainbowColors
  if (!colors.length) return state.settings.childTitleBgColor
  return colors[(depth - 1) % colors.length]
}

/** 获取节点整体背景色（folder-group） */
function getNodeGroupBg(depth: number): string {
  if (depth === 0) return state.settings.rootTitleBgColor
  return hexToRgba(getBaseColor(depth), 1)
}

/** 获取节点标题背景色（folder-header） */
function getNodeHeaderBg(_depth: number): string {
  return 'transparent'
}

/** 获取节点网格包装背景色（folder-grid-wrapper） */
function getNodeGridWrapperBg(_depth: number): string {
  return 'transparent'
}

/** 获取网格容器背景色（grid-container） */
function getNodeGridContainerBg(depth: number): string {
  if (!state.settings.rainbowEnabled) {
    return state.settings.bgColor
  } else {
    return hexToRgba(getBaseColor(depth), 1)
  }
}
</script>

<template>
  <!-- 层级压缩：跳过当前节点，子节点继承路径 -->
  <template v-if="shouldCollapse">
    <FolderGroup
      v-for="child in node.children"
      :key="child.path"
      :node="child"
      :depth="depth"
      :rootPath="rootPath"
      :showTitle="showTitle"
      :getExpanded="getExpanded"
      :isVirtualRoot="isVirtualRoot"
      :collapsePrefix="collapsePrefix + node.name + ' / '"
      :realDepth="realDepth + 1"
      @toggle="(n: FolderNode) => emit('toggle', n)"
      @viewImage="(item: ImageItem, scope?: ImageItem[]) => emit('viewImage', item, scope)"
      @selectImage="(item: ImageItem, ctrl: boolean) => emit('selectImage', item, ctrl)"
      @removeRoot="(p: string) => emit('removeRoot', p)"
      @excludeNode="(rp: string, sp: string) => emit('excludeNode', rp, sp)"
      @toggleSelectFolder="(p: string) => emit('toggleSelectFolder', p)"
      @copyToFolder="(p: string) => emit('copyToFolder', p)"
      @moveToFolder="(p: string) => emit('moveToFolder', p)"
    />
  </template>
  <!-- 正常渲染 -->
  <template v-else>
    <div
      class="folder-group"
    :class="{ 
      'folder-group-selected': isSelected(),
      'folder-group-compact': isCompactNode,
    }"
    :style="{ 
      borderRadius: '20px',
      marginLeft: depth === 0 ? 0: 20 + 'px',
      backgroundColor: getNodeGroupBg(realDepth),
      marginTop: state.settings.nodeGridGapV + 'px',
      marginBottom: state.settings.nodeGridGapV + 'px',
      boxShadow: isSelected() ? '0 0 0 2px rgba(100,108,255,0.6)' : 'inset 0 0 0px 2px rgba(255,255,255,0.08)',
	  padding: '4px',
      // 紧凑模式下：等分行宽，最小宽度由内容（含图片网格）决定
      ...(isCompactNode ? { flex: '1 1 0%', minWidth: 'fit-content' } : {}),
    }"
  >
    <div
      v-if="showTitle"
      class="folder-header"
      :class="{ 
        'root-header': depth === 0, 
        'child-header': depth > 0,
      }"
      :style="{
        borderRadius: '20px',
        backgroundColor: getNodeHeaderBg(realDepth),
        boxShadow: 'inset 0 0 0px 1px rgba(255,255,255,0.06)',
      }"
      @click="handleToggle"
      @contextmenu="openHeaderCtxMenu"
    >
      <span class="folder-left">
        <button
          v-if="!(isVirtualRoot && depth === 0) && !(state.settings.compactHeader && isCompactNode)"
          class="folder-open-btn"
          :title="$t('folder.open_in_explorer')"
          @click.stop="openInExplorer(getNodeAbsolutePath())"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </button>
        <button
          v-if="depth === 0 && !isVirtualRoot && !(state.settings.compactHeader && isCompactNode)"
          class="folder-up-btn"
          :title="$t('folder.up')"
          @click.stop="handleUp"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 19V5M5 12l7-7 7 7" />
            <line x1="5" y1="19" x2="19" y2="19" />
          </svg>
        </button>
        <button
          v-if="isVirtualRoot && depth === 0"
          class="folder-save-btn"
          :title="$t('folder.save_to_folder')"
          @click.stop="saveVirtualGroup(node, vgIndex)"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
        </button>
        <span v-if="shouldShowPath()" class="folder-path">{{ parentPath(node.path) }}</span>
        <span class="folder-left-actions">
          <!-- 移动至此 / 复制至此（隐藏时保留宽度，用 visibility 控制） -->
          <button
            v-if="!(state.settings.compactHeader && isCompactNode)"
            class="folder-action-btn folder-move-btn"
            :class="{ 'btn-invisible': !(state.selectMode === 'select' && hasAnySelection && !isVirtualRoot) }"
            :title="$t('folder.move_here')"
            @click.stop="handleMoveToFolder"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
          <button
            v-if="!(state.settings.compactHeader && isCompactNode)"
            class="folder-action-btn folder-copy-btn"
            :class="{ 'btn-invisible': !(state.selectMode === 'select' && hasAnySelection && !isVirtualRoot) }"
            :title="$t('folder.copy_here')"
            @click.stop="handleCopyToFolder"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
          <!-- 选择勾选框（隐藏时保留宽度） -->
          <span
            class="folder-select-box"
            :class="{
              checked: isSelected(),
              'btn-invisible': !(state.selectMode === 'select' && !(isVirtualRoot && depth === 0)),
            }"
            @click="handleSelectClick"
          >
            <svg v-if="isSelected()" viewBox="0 0 24 24" width="14" height="14" fill="white">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
          </span>
          <!-- 虚拟分组 +/- 按钮 -->
          <template v-if="isVirtualRoot && depth === 0 && state.selectMode === 'select'">
            <button
              v-if="state.selectedPaths.size > 0 || state.selectedFolderPaths.size > 0"
              class="vg-action-btn vg-add-btn"
              :title="$t('folder.add_to_group')"
              @click.stop="emit('addToVirtualGroup', vgIndex!)"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            </button>
            <button
              v-if="hasFirstLevelSelection()"
              class="vg-action-btn vg-remove-btn"
              :title="$t('folder.remove_from_group')"
              @click.stop="emit('removeFromVirtualGroup', vgIndex!)"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            </button>
          </template>
        </span>
      </span>
      <span class="folder-label" :class="{ 'has-collapse': collapsePrefixSegments.length > 0 }">
        <span class="folder-arrow">{{ getExpanded(node) ? '▼' : '▶' }}</span>
        <span v-if="collapsePrefixSegments.length" class="collapse-prefix">
          <span v-for="(seg, i) in collapsePrefixSegments" :key="i" :style="{ color: getSegmentColor(seg.level) }">{{ seg.name }}</span>
        </span>
        <span class="folder-name" :style="{ color: realDepth === 0 ? state.settings.rootTitleColor : state.settings.childTitleColor }">{{ node.name }}</span>
        <span v-if="totalCount(node)" class="folder-count" :class="{ 'all-selected': state.selectMode === 'select' && nodeSelectionState === 'all' }">
          <template v-if="state.selectMode === 'select' && nodeSelectionState !== 'none'">
            (<span :class="{ 'partial-selected': nodeSelectionState === 'partial' }">{{ countSelectedInNode(props.node) }}</span><span class="sep">/</span>{{ totalCount(node) }})
          </template>
          <template v-else>
            ({{ totalCount(node) }})
          </template>
        </span>
      </span>
      <span class="folder-right">
        <!-- 紧凑模式下隐藏选择按钮，放入右键菜单 -->
        <span v-if="state.selectMode === 'select' && !isCompactNode" class="folder-select-actions">
          <button
            class="folder-select-action-btn"
            :title="$t('folder.select_all')"
            @click.stop="selectAll"
          >{{ $t('folder.select_all') }}</button>
          <button
            class="folder-select-action-btn"
            :title="$t('folder.invert_selection')"
            @click.stop="invertSelection"
          >{{ $t('folder.invert_selection') }}</button>
          <button
            v-if="hasBothChildrenAndImages"
            class="folder-select-action-btn"
            :title="$t('folder.first_level')"
            @click.stop="selectDirectImages"
          >{{ $t('folder.first_level') }}</button>
        </span>
        <button
          v-if="!(state.settings.compactHeader && isCompactNode)"
          class="folder-remove-btn"
          :title="$t('folder.remove')"
          @click.stop="handleRemove"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </span>
    </div>

    <!-- 标题栏右键菜单 -->
    <Teleport to="body">
      <div v-if="headerCtxMenu.show" class="ctx-backdrop" @click="closeHeaderCtxMenu"></div>
      <div
        v-if="headerCtxMenu.show"
        class="ctx-menu folder-header-ctx-menu"
        :style="{ left: headerCtxMenu.x + 'px', top: headerCtxMenu.y + 'px' }"
        @click.stop
      >
        <!-- 选择操作（选择模式下） -->
        <template v-if="state.selectMode === 'select'">
          <button class="ctx-menu-item" @click="selectAll(), closeHeaderCtxMenu()">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <polyline points="9 12 12 15 17 8"/>
            </svg>
            <span>{{ $t('folder.select_all') }}</span>
          </button>
          <button class="ctx-menu-item" @click="invertSelection(), closeHeaderCtxMenu()">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="9" y1="12" x2="15" y2="12"/>
            </svg>
            <span>{{ $t('folder.invert_selection') }}</span>
          </button>
          <button
            v-if="hasBothChildrenAndImages"
            class="ctx-menu-item"
            @click="selectDirectImages(), closeHeaderCtxMenu()"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="12" y1="8" x2="12" y2="16"/>
            </svg>
            <span>{{ $t('folder.first_level') }}</span>
          </button>
          <!-- 移动至此 / 复制至此（显示条件同在标题栏上） -->
          <template v-if="hasAnySelection && !isVirtualRoot">
            <div class="ctx-separator"></div>
            <button class="ctx-menu-item" @click="handleMoveToFolder(), closeHeaderCtxMenu()">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
              <span>{{ $t('folder.move_here') }}</span>
            </button>
            <button class="ctx-menu-item" @click="handleCopyToFolder(), closeHeaderCtxMenu()">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              <span>{{ $t('folder.copy_here') }}</span>
            </button>
          </template>
          <div class="ctx-separator"></div>
        </template>
        <!-- 模式切换 -->
        <button
          v-if="state.selectMode === 'select'"
          class="ctx-menu-item"
          @click="state.selectMode = 'view', state.selectedPaths.clear(), state.selectedFolderPaths.clear(), closeHeaderCtxMenu()"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
          </svg>
          <span>{{ $t('control.view_mode') }}</span>
        </button>
        <button
          v-else
          class="ctx-menu-item"
          @click="state.selectMode = 'select', closeHeaderCtxMenu()"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
          </svg>
          <span>{{ $t('control.select_mode') }}</span>
        </button>
        <div class="ctx-separator"></div>
        <!-- 文件名显隐 -->
        <button
          class="ctx-menu-item"
          :class="{ active: state.alwaysShowFileName }"
          @click="state.alwaysShowFileName = !state.alwaysShowFileName, closeHeaderCtxMenu()"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="9" y1="21" x2="9" y2="9"/>
          </svg>
          <span>{{ $t('control.filename') }}</span>
        </button>
        <div class="ctx-separator"></div>
        <!-- 文件夹操作 -->
        <button class="ctx-menu-item" @click="openInExplorer(getNodeAbsolutePath()), closeHeaderCtxMenu()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <span>{{ $t('folder.open_in_explorer') }}</span>
        </button>
        <button class="ctx-menu-item" @click="handleCopyFolderPath(), closeHeaderCtxMenu()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <span>{{ $t('hint.copy_path') }}</span>
        </button>
        <div class="ctx-separator"></div>
        <button class="ctx-menu-item ctx-danger" @click="handleRemove(), closeHeaderCtxMenu()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          <span>{{ $t('folder.remove') }}</span>
        </button>
      </div>
    </Teleport>

    <!-- 紧凑模式：统一内容网格（子节点 + 图片作为同级网格项混合排列） -->
    <div
      v-if="useUnifiedGrid"
      class="folder-content-grid"
      :class="{ 'folder-content-collapsed': !getExpanded(node) }"
      :style="{
        gap: getExpanded(node) ? state.settings.gap + 'px' : '0',
        backgroundColor: getNodeGridContainerBg(realDepth),
      }"
    >
      <FolderGroup
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :realDepth="realDepth + 1"
        :rootPath="rootPath"
        :showTitle="showTitle"
        :getExpanded="getExpanded"
        :isVirtualRoot="isVirtualRoot"
        @toggle="(n: FolderNode) => emit('toggle', n)"
        @viewImage="(item: ImageItem, scope?: ImageItem[]) => emit('viewImage', item, scope)"
        @selectImage="(item: ImageItem, ctrl: boolean) => emit('selectImage', item, ctrl)"
        @removeRoot="(p: string) => emit('removeRoot', p)"
        @excludeNode="(rp: string, sp: string) => emit('excludeNode', rp, sp)"
        @toggleSelectFolder="(p: string) => emit('toggleSelectFolder', p)"
        @copyToFolder="(p: string) => emit('copyToFolder', p)"
        @moveToFolder="(p: string) => emit('moveToFolder', p)"
      />
      <GridItem
        v-for="item in processedImages"
        :key="item.path"
        :item="item"
        :gridSize="state.settings.gridSize"
        :borderRadius="state.settings.borderRadius"
        :isSelected="isImageSelected(item)"
        @click="handleGridImageClick"
        @select="handleGridImageSelect"
      />
    </div>

    <!-- 非紧凑模式：子节点 + 图片分区域布局 -->
    <template v-if="!useUnifiedGrid">
      <div
        v-if="node.children.length"
        class="folder-children-section"
        :class="{ 'folder-children-collapsed': !getExpanded(node) }"
      >
        <div v-if="wrapChildren" class="folder-children-compact" :style="{ gap: state.settings.nodeGridGapH + 'px' }">
          <FolderGroup
            v-for="child in node.children"
            :key="child.path"
            :node="child"
            :depth="depth + 1"
            :realDepth="realDepth + 1"
            :rootPath="rootPath"
            :showTitle="showTitle"
            :getExpanded="getExpanded"
            :isVirtualRoot="isVirtualRoot"
            @toggle="(n: FolderNode) => emit('toggle', n)"
            @viewImage="(item: ImageItem, scope?: ImageItem[]) => emit('viewImage', item, scope)"
            @selectImage="(item: ImageItem, ctrl: boolean) => emit('selectImage', item, ctrl)"
            @removeRoot="(p: string) => emit('removeRoot', p)"
            @excludeNode="(rp: string, sp: string) => emit('excludeNode', rp, sp)"
            @toggleSelectFolder="(p: string) => emit('toggleSelectFolder', p)"
            @copyToFolder="(p: string) => emit('copyToFolder', p)"
            @moveToFolder="(p: string) => emit('moveToFolder', p)"
          />
        </div>
        <template v-else>
          <FolderGroup
            v-for="child in node.children"
            :key="child.path"
            :node="child"
            :depth="depth + 1"
            :realDepth="realDepth + 1"
            :rootPath="rootPath"
            :showTitle="showTitle"
            :getExpanded="getExpanded"
            :isVirtualRoot="isVirtualRoot"
            @toggle="(n: FolderNode) => emit('toggle', n)"
            @viewImage="(item: ImageItem, scope?: ImageItem[]) => emit('viewImage', item, scope)"
            @selectImage="(item: ImageItem, ctrl: boolean) => emit('selectImage', item, ctrl)"
            @removeRoot="(p: string) => emit('removeRoot', p)"
            @excludeNode="(rp: string, sp: string) => emit('excludeNode', rp, sp)"
            @toggleSelectFolder="(p: string) => emit('toggleSelectFolder', p)"
            @copyToFolder="(p: string) => emit('copyToFolder', p)"
            @moveToFolder="(p: string) => emit('moveToFolder', p)"
          />
        </template>
      </div>
      <div
        v-if="node.images.length"
        class="folder-grid-wrapper"
        :class="{ 'folder-grid-collapsed': !getExpanded(node) }"
        :style="{
		  borderRadius:'20px',
          backgroundColor: getNodeGridWrapperBg(realDepth),
        }"
      >
        <GridView
          :images="node.images"
          :bgColor="getNodeGridContainerBg(realDepth)"
          @viewImage="(item: ImageItem, scope?: ImageItem[]) => emit('viewImage', item, scope)"
          @selectImage="(item: ImageItem, ctrl: boolean) => emit('selectImage', item, ctrl)"
        />
      </div>
    </template>
  </div>
  </template>
</template>

<style scoped>
.folder-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 6px 12px;
  cursor: pointer;
  user-select: none;
  border-radius: 4px;
  transition: background 0.15s;
  margin: 2px 0;
}

.folder-header:hover {
  background-image: linear-gradient(rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.09));
}

.folder-group-selected {
  box-shadow: 0 0 0 2px rgba(100,108,255,0.6) !important;
}

.folder-select-box {
  width: 18px; height: 18px;
  border: 2px solid rgba(255,255,255,0.25);
  border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: border-color 0.15s, background 0.15s;
  box-sizing: border-box;
}
.folder-select-box:hover {
  border-color: rgba(255,255,255,0.5);
}
.folder-select-box.checked {
  background: rgba(100,108,255,0.8);
  border-color: rgba(100,108,255,0.8);
}

.folder-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

.folder-left-actions {
  margin-left: auto;
  margin-right: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.folder-left-actions .folder-select-box {
  margin-right: 2px;
}

/* 隐藏但保留宽度（用于移动/复制/勾选框） */
.btn-invisible {
  visibility: hidden;
}

.folder-action-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  padding: 2px 5px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, background 0.15s, border-color 0.15s;
}
.folder-header:hover .folder-action-btn {
  opacity: 1;
}
.folder-move-btn:hover {
  color: #4fc3f7;
  background: rgba(79, 195, 247, 0.2);
  border-color: rgba(79, 195, 247, 0.4);
}
.folder-copy-btn:hover {
  color: #66d9a0;
  background: rgba(102, 217, 160, 0.2);
  border-color: rgba(102, 217, 160, 0.4);
}

.folder-open-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  padding: 2px 5px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, background 0.15s, border-color 0.15s;
}
.folder-header:hover .folder-open-btn {
  opacity: 1;
}
.folder-open-btn:hover {
  color: #4fc3f7;
  background: rgba(79, 195, 247, 0.2);
  border-color: rgba(79, 195, 247, 0.4);
}

.folder-up-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  padding: 2px 5px;
  border-radius: 4px;
  align-items: center;
  flex-shrink: 0;
  display: none;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.folder-header:hover .folder-up-btn {
  display: flex;
}
.folder-up-btn:hover {
  color: #4fc3f7;
  background: rgba(79, 195, 247, 0.2);
  border-color: rgba(79, 195, 247, 0.4);
}

.folder-save-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  padding: 2px 5px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, background 0.15s, border-color 0.15s;
}
.folder-header:hover .folder-save-btn {
  opacity: 1;
}
.folder-save-btn:hover {
  color: #66d9a0;
  background: rgba(102, 217, 160, 0.2);
  border-color: rgba(102, 217, 160, 0.4);
}

.vg-action-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  padding: 2px 5px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.vg-add-btn:hover {
  color: #4fc3f7;
  background: rgba(79, 195, 247, 0.2);
  border-color: rgba(79, 195, 247, 0.4);
}
.vg-remove-btn:hover {
  color: #ff6b6b;
  background: rgba(255, 60, 60, 0.2);
  border-color: rgba(255, 60, 60, 0.4);
}

.folder-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.folder-select-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: 8px;
}

.folder-select-action-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, background 0.15s, border-color 0.15s;
  white-space: nowrap;
  line-height: 1.4;
}
.folder-header:hover .folder-select-action-btn {
  opacity: 1;
}
.folder-select-action-btn:hover {
  color: #7eb8ff;
  background: rgba(100, 150, 255, 0.2);
  border-color: rgba(100, 150, 255, 0.4);
}

.folder-remove-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  padding: 2px 5px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  opacity: 0;
  margin-left: auto;
  transition: opacity 0.15s, color 0.15s, background 0.15s, border-color 0.15s;
}
.folder-header:hover .folder-remove-btn {
  opacity: 1;
}
.folder-remove-btn:hover {
  color: #ff6b6b;
  background: rgba(255, 60, 60, 0.2);
  border-color: rgba(255, 60, 60, 0.4);
}

.collapse-prefix {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
  max-width: 200px;
  /* text-shadow: 0 1px 3px rgba(0,0,0,0.5); */
}

.folder-arrow {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  width: 12px;
  flex-shrink: 0;
  transition: color 0.15s;
}

.folder-header:hover .folder-arrow {
  color: rgba(255, 255, 255, 0.7);
}

.folder-count.all-selected {
  color: rgba(100, 180, 255, 1);
}
.folder-count .partial-selected {
  color: rgba(100, 180, 255, 1);
}

.folder-path {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.folder-label.has-collapse {
  background: rgba(0, 0, 0, 0.5);
  border-radius: 4px;
  padding: 2px 8px;
}

.folder-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-count {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
}

.folder-grid-wrapper {
  padding: 0;
  overflow: hidden;
}

/* ===== 右键菜单通用样式（与 GridItem 保持一致） ===== */
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

.ctx-menu-item.active {
  color: #aab0ff;
}

.ctx-menu-item.ctx-danger:hover {
  background: rgba(255, 60, 60, 0.2);
  color: #ff6b6b;
}

.ctx-separator {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 4px 8px;
}

/* 标题栏右键菜单 */
.folder-header-ctx-menu {
  min-width: 170px;
}

/* ===== 紧凑模式 ===== */

/* 紧凑节点自身：inline-flex，宽度由内容撑开 */
.folder-group-compact {
  display: inline-flex;
  flex-direction: column;
  width: auto;
  max-width: 100%;
  vertical-align: top;
}

/* ===== 紧凑模式 - 统一内容网格 ===== */

/* 统一网格容器：flex-wrap，子节点和图片作为同级项排列 */
.folder-content-grid {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: center;
  padding: 8px;
  border-radius: 20px;
  overflow: hidden;
}

/* 折叠状态：不可见，高度为 0，宽度保留 */
.folder-content-collapsed {
  visibility: hidden;
  height: 0;
  overflow: hidden;
  padding: 0 !important;
  gap: 0 !important;
}

/* ===== 非紧凑模式 - 原有布局 ===== */

/* 折叠状态：图片网格不可见，高度为 0，宽度保留 */
.folder-grid-collapsed {
  visibility: hidden;
  height: 0;
  overflow: hidden;
}

/* 子文件夹区域折叠状态：不可见，高度为 0，宽度保留 */
.folder-children-collapsed {
  visibility: hidden;
  height: 0;
  overflow: hidden;
}

/* 子节点 flex-wrap 容器：等分占满行宽 */
.folder-children-compact {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0;
}
</style>
