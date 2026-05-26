<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { FolderNode, ImageItem } from '../types'
import { t } from '../i18n'
import { state, buildFolderTree, filterImages, findSubTreeInTree, showToast } from '../stores/imageStore'
import FolderGroup from './FolderGroup.vue'

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
  toggleSelectFolder: [path: string]
  addToVirtualGroup: [vgIndex: number]
  removeFromVirtualGroup: [vgIndex: number]
  copyToFolder: [targetPath: string]
  moveToFolder: [targetPath: string]
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

/** 删除虚拟分组中的子节点 */
function handleVirtualExcludeNode(rootPath: string, subPath: string) {
  const vg = state.virtualGroups.find(v => v.path === rootPath)
  if (!vg) return
  vg.children = vg.children.filter(c => c.path !== subPath)
  vg.images = vg.images.filter(img => !img.dir.startsWith(subPath))
}

function handleExcludeNode(rootPath: string, subPath: string) {
  emit('excludeNode', rootPath, subPath)
}

/** 递归将子树的相对路径转为绝对路径 */
function makeNodePathsAbsolute(node: FolderNode) {
  if (node.images.length > 0) {
    const absDir = node.images[0].dir.replace(/\\/g, '/')
    node.path = absDir
  }
  for (const child of node.children) {
    makeNodePathsAbsolute(child)
  }
}

/** 将选中项添加到指定虚拟分组 */
function handleAddToVirtualGroup(vgIndex: number) {
  const vg = state.virtualGroups[vgIndex]
  if (!vg) return

  // 收集分组中已有图片路径
  const existingPaths = new Set<string>()
  function collectImagePaths(n: FolderNode) {
    for (const img of n.images) existingPaths.add(img.path)
    for (const c of n.children) collectImagePaths(c)
  }
  collectImagePaths(vg)

  // 添加不重复的选中图片
  for (const fp of state.selectedPaths) {
    if (!existingPaths.has(fp)) {
      const img = state.allImages.find(i => i.path === fp)
      if (img) vg.images.push({ ...img, loading: false })
    }
  }

  // 收集分组中已有子节点路径
  const existingChildPaths = new Set<string>()
  function collectChildPaths(n: FolderNode) {
    existingChildPaths.add(n.path)
    for (const c of n.children) collectChildPaths(c)
  }
  collectChildPaths(vg)

  // 添加不重复的选中文件夹子树
  const fullTree = buildFolderTree(state.allImages, state.loadedRootPaths)
  for (const fp of state.selectedFolderPaths) {
    if (existingChildPaths.has(fp)) continue
    const found = findSubTreeInTree(fullTree, fp)
    if (found) {
      makeNodePathsAbsolute(found)
      vg.children.push(found)
    }
  }

  state.selectedPaths.clear()
  state.selectedFolderPaths.clear()
}

/** 从指定虚拟分组中移除选中项（仅处理一级节点和一级图片，非一级提示） */
function handleRemoveFromVirtualGroup(vgIndex: number) {
  const vg = state.virtualGroups[vgIndex]
  if (!vg) return

  // 判断是否有非一级项被选中
  const firstLevelImagePaths = new Set(vg.images.map(i => i.path))
  const firstLevelChildPaths = new Set(vg.children.map(c => c.path))
  let hasNonFirstLevel = false

  for (const fp of state.selectedPaths) {
    if (!firstLevelImagePaths.has(fp)) { hasNonFirstLevel = true; break }
  }
  if (!hasNonFirstLevel) {
    for (const fp of state.selectedFolderPaths) {
      if (!firstLevelChildPaths.has(fp)) { hasNonFirstLevel = true; break }
    }
  }

  // 移除一级图片
  vg.images = vg.images.filter(img => !state.selectedPaths.has(img.path))
  // 移除一级子节点
  state.selectedFolderPaths.forEach(fp => {
    const idx = vg.children.findIndex(c => c.path === fp)
    if (idx !== -1) vg.children.splice(idx, 1)
  })

  state.selectedPaths.clear()
  state.selectedFolderPaths.clear()

  // 有非一级项时提示
  if (hasNonFirstLevel) {
    showToast(t('hint.remove_first_level_only'))
  }
}

defineExpose({ toggleAll, collapseLeaves })
</script>

<template>
  <div class="folder-panel">
    <!-- 虚拟分组节点 -->
    <template v-for="(node, i) in allRootNodes" :key="node.path || `vg-${i}`">
      <FolderGroup
        v-if="(node as any).isVirtualGroup"
        :node="node"
        :depth="0"
        :rootPath="node.path"
        :showTitle="state.showGroupTitle"
        :getExpanded="isExpanded"
        :isVirtualRoot="true"
        :vgIndex="(node as any)._vgIndex"
        @toggle="toggleNode"
        @viewImage="handleViewImage"
        @selectImage="handleSelectImage"
        @removeRoot="() => handleDeleteVg((node as any)._vgIndex)"
        @excludeNode="handleVirtualExcludeNode"
        @toggleSelectFolder="(p:string) => emit('toggleSelectFolder', p)"
        @addToVirtualGroup="handleAddToVirtualGroup"
        @removeFromVirtualGroup="handleRemoveFromVirtualGroup"
        @copyToFolder="(p:string) => emit('copyToFolder', p)"
        @moveToFolder="(p:string) => emit('moveToFolder', p)"
      />
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
        @toggleSelectFolder="(p:string) => emit('toggleSelectFolder', p)"
        @copyToFolder="(p:string) => emit('copyToFolder', p)"
        @moveToFolder="(p:string) => emit('moveToFolder', p)"
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

.folder-count {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
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
