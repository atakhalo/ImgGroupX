<script setup lang="ts">
import { computed } from 'vue'
import type { FolderNode, ImageItem } from '../types'
import { state } from '../stores/imageStore'
import GridView from './GridView.vue'
import FolderGroup from './FolderGroup.vue'

defineOptions({
  name: 'FolderGroup',
})

const props = defineProps<{
  node: FolderNode
  depth: number
  rootPath: string
  showTitle: boolean
  getExpanded: (node: FolderNode) => boolean
  isVirtualRoot?: boolean
  vgIndex?: number
}>()

const emit = defineEmits<{
  toggle: [node: FolderNode]
  viewImage: [item: ImageItem, scope?: ImageItem[]]
  selectImage: [item: ImageItem, ctrl: boolean]
  removeRoot: [path: string]
  excludeNode: [rootPath: string, subPath: string]
  toggleSelectFolder: [path: string]
  addToVirtualGroup: [vgIndex: number]
  removeFromVirtualGroup: [vgIndex: number]
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
  const i = path.lastIndexOf('/')
  return i > 0 ? path.substring(0, i + 1) : ''
}

function totalCount(node: FolderNode): number {
  let n = node.images.length
  for (const child of node.children) {
    n += totalCount(child)
  }
  return n
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
  <div
    class="folder-group"
    :class="{ 'folder-group-selected': isSelected() }"
    :style="{ 
      borderRadius: '20px',
      marginLeft: depth === 0 ? 0: 20 + 'px',
      backgroundColor: getNodeGroupBg(depth),
      marginTop: state.settings.nodeGridGap + 'px',
      marginBottom: state.settings.nodeGridGap + 'px',
      boxShadow: isSelected() ? '0 0 0 2px rgba(100,108,255,0.6)' : 'inset 0 0 0px 2px rgba(255,255,255,0.08)',
	  padding: '4px',
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
        backgroundColor: getNodeHeaderBg(depth),
        boxShadow: 'inset 0 0 0px 1px rgba(255,255,255,0.06)',
      }"
      @click="handleToggle"
    >
      <span class="folder-left">
        <span v-if="shouldShowPath()" class="folder-path">{{ parentPath(node.path) }}</span>
      </span>
      <span class="folder-label">
        <!-- 选择勾选框（仅选择模式、非虚拟根节点时显示） -->
        <span
          v-if="state.selectMode === 'select' && !(isVirtualRoot && depth === 0)"
          class="folder-select-box"
          :class="{ checked: isSelected() }"
          @click="handleSelectClick"
        >
          <svg v-if="isSelected()" viewBox="0 0 24 24" width="14" height="14" fill="white">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
          </svg>
        </span>
        <!-- 虚拟分组根节点的添加/移除按钮（放在箭头前） -->
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
        <span class="folder-arrow">{{ getExpanded(node) ? '▼' : '▶' }}</span>
        <span class="folder-name" :style="{ color: depth === 0 ? state.settings.rootTitleColor : state.settings.childTitleColor }">{{ node.name }}</span>
        <span v-if="totalCount(node)" class="folder-count">({{ totalCount(node) }})</span>
        <!-- 选择操作按钮：全选、反选、一级图片 -->
        <span v-if="state.selectMode === 'select' && !(isVirtualRoot && depth === 0)" class="folder-select-actions">
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
      </span>
      <span class="folder-right">
        <button
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

    <template v-if="getExpanded(node)">
      <!-- 递归子文件夹 -->
      <FolderGroup
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
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
      />
      <!-- 当前文件夹图片网格 -->
      <div
        v-if="node.images.length"
        class="folder-grid-wrapper"
        :style="{
		  borderRadius:'20px',
          backgroundColor: getNodeGridWrapperBg(depth),
        }"
      >
        <GridView
          :images="node.images"
          :bgColor="getNodeGridContainerBg(depth)"
          @viewImage="(item: ImageItem, scope?: ImageItem[]) => emit('viewImage', item, scope)"
          @selectImage="(item: ImageItem, ctrl: boolean) => emit('selectImage', item, ctrl)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.folder-group {
  /* width: 100%; */
}

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
  justify-content: flex-end;
}

.folder-select-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: 4px;
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
</style>
