<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { FolderNode, ImageItem } from '../types'
import { state } from '../stores/imageStore'
import FolderGroup from './FolderGroup.vue'

defineProps<{
  /** 当前在查看器中显示的分组（state.virtualGroups 中的节点） */
  node: FolderNode
  /** 分组在 state.virtualGroups 中的索引 */
  vgIndex: number
}>()

const emit = defineEmits<{
  close: []
  viewImage: [item: ImageItem, scope?: ImageItem[], navKey?: string, imageIndex?: number]
  selectImage: [item: ImageItem, ctrl: boolean]
  deleteGroup: []
  addToVirtualGroup: []
  removeFromVirtualGroup: []
  excludeNode: [subPath: string]
  toggleSelectFolder: [path: string]
  copyToFolder: [targetPath: string]
  moveToFolder: [targetPath: string]
}>()

/** 查看器内的展开状态（默认全部展开，键与 FolderGroup 的 viewer 作用域一致） */
const expandedMap = reactive(new Map<string, boolean>())

function getExpanded(node: FolderNode, key?: string): boolean {
  const k = key || `viewer:${node.path}`
  const v = expandedMap.get(k)
  return v === undefined ? true : v
}

function toggleNode(node: FolderNode, key?: string) {
  const k = key || `viewer:${node.path}`
  expandedMap.set(k, !getExpanded(node, k))
}

/** 周围背景与大图查看器保持一致 */
const bgStyle = computed(() =>
  state.settings.viewerBgMode === 'color'
    ? { background: state.settings.viewerBgColor }
    : { background: 'rgba(0, 0, 0, 0.85)' },
)

/** Ctrl+滚轮缩放网格（与网格视图一致） */
function handleWheel(e: WheelEvent) {
  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  const delta = e.deltaY > 0 ? -10 : 10
  state.settings.gridSize = Math.max(10, Math.min(1000, state.settings.gridSize + delta))
}
</script>

<template>
  <div class="group-viewer" :style="bgStyle" @wheel="handleWheel">
    <div class="group-viewer-scroll">
      <div class="group-viewer-card">
        <!-- 复用网格视图的分组渲染：标题栏、层级背景、紧凑模式及虚拟分组操作均保持一致 -->
        <FolderGroup
          :node="node"
          :depth="0"
          :rootPath="node.path"
          :showTitle="state.showGroupTitle"
          :getExpanded="getExpanded"
          :isVirtualRoot="true"
          :vgIndex="vgIndex"
          :siblingNodes="[node]"
          :viewerMode="true"
          @toggle="toggleNode"
          @viewImage="(item: ImageItem, scope?: ImageItem[], navKey?: string, imageIndex?: number) => emit('viewImage', item, scope, navKey, imageIndex)"
          @selectImage="(item: ImageItem, ctrl: boolean) => emit('selectImage', item, ctrl)"
          @removeRoot="emit('deleteGroup')"
          @excludeNode="(_rootPath: string, subPath: string) => emit('excludeNode', subPath)"
          @addToVirtualGroup="emit('addToVirtualGroup')"
          @removeFromVirtualGroup="emit('removeFromVirtualGroup')"
          @toggleSelectFolder="(p: string) => emit('toggleSelectFolder', p)"
          @copyToFolder="(p: string) => emit('copyToFolder', p)"
          @moveToFolder="(p: string) => emit('moveToFolder', p)"
          @expandNode="(k: string) => expandedMap.set(k, true)"
        />
      </div>
    </div>

    <button class="group-viewer-close" :title="$t('group_viewer.close')" @click="emit('close')">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
/*
 * 层级：网格视图之上、大图查看器（z-index 1000）之下；
 * 底部控制栏 z-index 100 位于查看器之上，保持可见可操作。
 */
.group-viewer {
  position: fixed;
  inset: 0;
  z-index: 90;
}

.group-viewer-scroll {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  /* 底部留出控制栏高度，避免最后一行图片被遮挡 */
  padding: 20px 24px 140px;
}

/* 分组居中：宽度随内容自适应，过大时限制最大宽度 */
.group-viewer-card {
  width: fit-content;
  min-width: min(360px, 100%);
  max-width: min(1280px, 100%);
  margin: auto;
}

.group-viewer-close {
  position: absolute;
  top: 14px;
  right: 16px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(0, 0, 0, 0.45);
  color: rgba(255, 255, 255, 0.75);
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition: background 0.15s, color 0.15s;
}

.group-viewer-close:hover {
  background: rgba(255, 60, 60, 0.35);
  color: #fff;
}
</style>
