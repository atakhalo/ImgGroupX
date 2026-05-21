<script setup lang="ts">
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
}>()

const emit = defineEmits<{
  toggle: [node: FolderNode]
  viewImage: [item: ImageItem, scope?: ImageItem[]]
  selectImage: [item: ImageItem, ctrl: boolean]
  removeRoot: [path: string]
  excludeNode: [rootPath: string, subPath: string]
}>()

function handleToggle() {
  emit('toggle', props.node)
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
//   return hexToRgba(getBaseColor(depth), 0.30)
}

/** 获取节点标题背景色（folder-header） */
function getNodeHeaderBg(depth: number): string {
	return 'transparent'
  if (depth === 0) return state.settings.rootTitleBgColor
  return hexToRgba(getBaseColor(depth), 1)
}

/** 获取节点网格包装背景色（folder-grid-wrapper） */
function getNodeGridWrapperBg(depth: number): string {
	return 'transparent'
  if (depth === 0) return 'transparent'
  return hexToRgba(getBaseColor(depth), 0.12)
}

/** 获取网格容器背景色（grid-container） */
function getNodeGridContainerBg(depth: number): string {
  if (!state.settings.rainbowEnabled)
  {
	return state.settings.bgColor
  }
  else
  {
  	return hexToRgba(getBaseColor(depth), 1)
  }
}
</script>

<template>
  <div
    class="folder-group"
    :class="{ 'has-border': state.settings.nodeGridBorderEnabled }"
    :style="{ 
		borderRadius:'20px', marginLeft: 20 + 'px', 
		backgroundColor: getNodeGroupBg(depth),
	    marginTop: state.settings.nodeGridGap + 'px',
	    marginBottom: state.settings.nodeGridGap + 'px',
        borderColor: state.settings.nodeGridBorderEnabled ? state.settings.nodeGridBorderColor : 'transparent',
	}"
  >
    <div
      v-if="showTitle"
      class="folder-header"
      :class="{ 'root-header': depth === 0, 'child-header': depth > 0 }"
      :style="{ borderRadius:'20px', backgroundColor: getNodeHeaderBg(depth) }"
      @click="handleToggle"
    >
      <span class="folder-left">
        <span v-if="depth === 0" class="folder-path">{{ parentPath(node.path) }}</span>
      </span>
      <span class="folder-label">
        <span class="folder-arrow">{{ getExpanded(node) ? '▼' : '▶' }}</span>
        <span class="folder-name" :style="{ color: depth === 0 ? state.settings.rootTitleColor : state.settings.childTitleColor }">{{ node.name }}</span>
        <span v-if="totalCount(node)" class="folder-count">({{ totalCount(node) }})</span>
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
        @toggle="(n: FolderNode) => emit('toggle', n)"
        @viewImage="(item: ImageItem, scope?: ImageItem[]) => emit('viewImage', item, scope)"
        @selectImage="(item: ImageItem, ctrl: boolean) => emit('selectImage', item, ctrl)"
        @removeRoot="(p: string) => emit('removeRoot', p)"
        @excludeNode="(rp: string, sp: string) => emit('excludeNode', rp, sp)"
      />
      <!-- 当前文件夹图片网格 -->
      <div
        v-if="node.images.length"
        class="folder-grid-wrapper"
        :style="{
          marginLeft: 20 + 'px',
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
  width: 100%;
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

.folder-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

.folder-right {
  display: flex;
  justify-content: flex-end;
}

.folder-remove-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.2);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}

.folder-header:hover .folder-remove-btn {
  opacity: 1;
}

.folder-remove-btn:hover {
  color: #ff6b6b;
  background: rgba(255, 60, 60, 0.15);
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

.folder-group.has-border {
  border: 2px solid;
  border-radius: 6px;
}
</style>
