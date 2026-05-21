<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { FolderNode, ImageItem } from '../types'
import { state, buildFolderTree, filterImages } from '../stores/imageStore'
import FolderGroup from './FolderGroup.vue'
import GridView from './GridView.vue'

const props = defineProps<{
  images: ImageItem[]
  virtualGroups: FolderNode[]
}>()

const emit = defineEmits<{
  viewImage: [item: ImageItem, scope?: ImageItem[]]
  selectImage: [item: ImageItem, ctrl: boolean]
  deleteVirtualGroup: [index: number]
  removeRoot: [path: string]
  excludeNode: [rootPath: string, subPath: string]
}>()

/** 展开状态存储：首次构造时确定，用户可切换，永不重算 */
const expandedMap = reactive(new Map<string, boolean>())
/** 每个根路径的大文件夹检测标志 */
const rootLargeDetected = reactive(new Map<string, boolean>())

/** 计算节点子树中的图片总数 */
function totalNodeImages(node: FolderNode): number {
  let n = node.images.length
  for (const child of node.children) {
    n += totalNodeImages(child)
  }
  return n
}

/** 在树中递归搜索指定路径的节点，返回其根节点 */
function findRootForNode(node: FolderNode, roots: FolderNode[]): FolderNode | undefined {
  return roots.find(r => isNodeInTree(r, node))
}

function isNodeInTree(parent: FolderNode, target: FolderNode): boolean {
  if (parent.path === target.path) return true
  return parent.children.some(c => isNodeInTree(c, target))
}

/** 判断根节点是否已达到大型标准（>100张图 或 >5个子文件夹） */
function isRootLarge(rootNode: FolderNode): boolean {
  if (rootNode.children.length > 5) return true
  return totalNodeImages(rootNode) > 100
}

/** 获取节点展开状态：仅在首次构造时决定，之后不变 */
function isExpanded(node: FolderNode): boolean {
  if (expandedMap.has(node.path)) {
    return expandedMap.get(node.path)!
  }
  // 首次构造：找到所属根节点
  const rootNode = folderTree.value.find(r => r.path === node.path) ?? findRootForNode(node, folderTree.value)
  const rootKey = rootNode?.path ?? node.path
  // 查该根路径的检测标志
  if (rootLargeDetected.get(rootKey)) {
    expandedMap.set(node.path, false)
    return false
  }
  // 默认为展开，然后检查根节点维度是否达到大型标准
  expandedMap.set(node.path, true)
  if (rootNode && isRootLarge(rootNode)) {
    rootLargeDetected.set(rootKey, true)
    expandedMap.set(node.path, false) // 触发节点自身也折叠
  }
  return expandedMap.get(node.path)!
}

const folderTree = computed(() => {
  return buildFolderTree(props.images, state.loadedRootPaths)
})

/** 完整节点列表：虚拟分组（根层） + 文件夹树 */
const allRootNodes = computed<(FolderNode & { isVirtualGroup?: boolean })[]>(() => {
  const virtualRoots = props.virtualGroups.map((vg, i) => ({
    ...vg,
    isVirtualGroup: true,
    _vgIndex: i,
  }))
  return [...virtualRoots, ...folderTree.value]
})

function toggleNode(node: FolderNode) {
  expandedMap.set(node.path, !(expandedMap.get(node.path) ?? true))
}

function toggleAll(expand: boolean) {
  expandedMap.clear()
  rootLargeDetected.clear()
  function setAll(node: FolderNode) {
    expandedMap.set(node.path, expand)
    for (const child of node.children) {
      setAll(child)
    }
  }
  for (const node of folderTree.value) {
    setAll(node)
  }
  for (const vg of props.virtualGroups) {
    expandedMap.set(vg.path, expand)
  }
}

/** 折叠叶子节点（仅图片无子文件夹），展开其他节点 */
function collapseLeaves() {
  expandedMap.clear()
  rootLargeDetected.clear()
  function walk(node: FolderNode) {
    const isLeaf = node.images.length > 0 && node.children.length === 0
    expandedMap.set(node.path, !isLeaf) // 叶子折叠，非叶子展开
    for (const child of node.children) {
      walk(child)
    }
  }
  for (const root of folderTree.value) {
    walk(root)
  }
  for (const vg of props.virtualGroups) {
    expandedMap.set(vg.path, true)
  }
}

// 加载完成时重置检测标志，下次扫描重新判断
watch(() => state.loading, (loading) => {
  if (!loading) {
    rootLargeDetected.clear()
  }
})

/** 根据筛选状态自动展开/折叠节点 */
function hasMatchingImages(node: FolderNode): boolean {
  const filtered = filterImages(node.images, state.settings.filterRegex, state.settings.filterTarget, state.virtualGroups)
  if (filtered.length > 0) return true
  for (const child of node.children) {
    if (hasMatchingImages(child)) return true
  }
  return false
}

function updateExpandedByFilter() {
  const regex = state.settings.filterRegex
  function walk(node: FolderNode) {
    if (!regex) {
      expandedMap.set(node.path, true)
    } else {
      expandedMap.set(node.path, hasMatchingImages(node))
    }
    for (const child of node.children) {
      walk(child)
    }
  }
  for (const node of folderTree.value) {
    walk(node)
  }
  for (const vg of state.virtualGroups) {
    if (!regex) {
      expandedMap.set(vg.path, true)
    } else {
      const filtered = filterImages(vg.images, regex, state.settings.filterTarget, state.virtualGroups)
      expandedMap.set(vg.path, filtered.length > 0)
    }
  }
}

watch(
  () => [state.settings.filterRegex, state.settings.filterTarget],
  () => updateExpandedByFilter(),
)

function handleViewImage(item: ImageItem, scope?: ImageItem[]) {
  emit('viewImage', item, scope)
}

function handleSelectImage(item: ImageItem, ctrl: boolean) {
  emit('selectImage', item, ctrl)
}

function handleDeleteVg(index: number) {
  emit('deleteVirtualGroup', index)
}

function handleExcludeNode(rootPath: string, subPath: string) {
  emit('excludeNode', rootPath, subPath)
}

defineExpose({ toggleAll, collapseLeaves })
</script>

<template>
  <div class="folder-panel">
    <!-- 虚拟分组节点 -->
    <template v-for="(node, i) in allRootNodes" :key="node.path || `vg-${i}`">
      <!-- 虚拟分组节点 -->
      <div v-if="(node as any).isVirtualGroup" class="virtual-group-root">
        <div v-if="state.showGroupTitle" class="virtual-group-header" :style="{ backgroundColor: state.settings.rootTitleBgColor }" @click="toggleNode(node)">
          <span class="vg-left">
            <span class="vg-icon">📦</span>
          </span>
          <span class="vg-label">
            <span class="folder-arrow">{{ isExpanded(node) ? '▼' : '▶' }}</span>
            <span class="folder-name" :style="{ color: state.settings.rootTitleColor }">{{ node.name }}</span>
            <span class="folder-count">({{ node.images.length }})</span>
          </span>
          <span class="vg-right">
            <button
              class="vg-delete-btn"
              :title="`删除分组「${node.name}」`"
              @click.stop="handleDeleteVg((node as any)._vgIndex)"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </span>
        </div>
        <div
          v-if="isExpanded(node) && node.images.length"
          class="folder-grid-wrapper"
          :style="{
            paddingLeft: '32px',
            marginBottom: state.settings.nodeGridGap + 'px',
          }"
        >
          <GridView
            :images="node.images"
            :bgColor="state.settings.bgColor"
            @viewImage="(item: ImageItem, scope?: ImageItem[]) => handleViewImage(item, scope)"
            @selectImage="handleSelectImage"
          />
        </div>
      </div>
      <!-- 文件夹树节点 -->
      <FolderGroup
        v-else
        :node="node"
        :depth="0"
        :rootPath="node.path"
        :showTitle="state.showGroupTitle"
        :getExpanded="isExpanded"
        @toggle="toggleNode"
        @viewImage="handleViewImage"
        @selectImage="handleSelectImage"
        @removeRoot="(p:string) => emit('removeRoot', p)"
        @excludeNode="handleExcludeNode"
      />
    </template>
    <div v-if="allRootNodes.length === 0" class="empty-hint">
      <p>{{ $t('empty.drop_hint') }}</p>
      <p class="sub-hint">{{ $t('empty.format_hint') }}</p>
    </div>
  </div>
</template>

<style scoped>
.folder-panel {
  width: 100%;
}

.virtual-group-root {
  margin-bottom: 4px;
}

.virtual-group-header {
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

.virtual-group-header:hover {
  background-image: linear-gradient(rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.09));
}

.folder-count {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
}

.vg-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}

.vg-label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.vg-right {
  display: flex;
  justify-content: flex-end;
}

.vg-icon {
  font-size: 14px;
  opacity: 0.7;
}

.virtual-group-header:hover .folder-arrow {
  color: rgba(255, 255, 255, 0.7);
}

.vg-delete-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.25);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  display: flex;
  align-items: center;
}

.vg-delete-btn:hover {
  color: #ff6b6b;
  background: rgba(255, 60, 60, 0.1);
}

.empty-hint {
  text-align: center;
  padding: 60px 20px;
  color: rgba(255, 255, 255, 0.3);
}

.sub-hint {
  font-size: 13px;
  margin-top: 8px;
  color: rgba(255, 255, 255, 0.18);
}

.folder-grid-wrapper {
  padding: 0;
  overflow: hidden;
}
</style>

<style scoped>
.folder-panel {
  width: 100%;
}

.empty-hint {
  text-align: center;
  padding: 40px;
  color: rgba(255, 255, 255, 0.3);
}
</style>
