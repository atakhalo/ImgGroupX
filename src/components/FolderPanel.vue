<script setup lang="ts">
import { computed, reactive, ref, watch, nextTick, onMounted, onUnmounted, provide } from 'vue'
import type { FolderNode, HierarchyRow, ImageItem } from '../types'
import { state, buildFolderTree, filterImages, sortFolderTree, addSelectionToVirtualGroup, removeSelectionFromVirtualGroup, excludeNodeFromVirtualGroup } from '../stores/imageStore'
import { t } from '../i18n'
import FolderGroup from './FolderGroup.vue'
import HierarchyPanel from './HierarchyPanel.vue'

const props = defineProps<{
  images: ImageItem[]
  virtualGroups: FolderNode[]
}>()

const emit = defineEmits<{
  viewImage: [item: ImageItem, scope?: ImageItem[], navKey?: string, imageIndex?: number]
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
/**
 * 筛选激活期间的展开覆盖表：只在 filterRegex 非空时生效。
 * 与 expandedMap 隔离，取消筛选后直接丢弃覆盖、回到用户原有展开状态
 * （旧实现直接改写 expandedMap，导致取消筛选时全部展开）。
 */
const filterExpandedMap = reactive(new Map<string, boolean>())
/** 筛选期间每个节点子树的匹配图片数量（键与 filterExpandedMap 一致），用于标题计数 */
const filterMatchCountMap = reactive(new Map<string, number>())
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

/** 在树中递归搜索指定节点的根节点（基于对象引用判断归属，避免同名相对路径误判） */
function findRootForNode(node: FolderNode, roots: FolderNode[]): FolderNode | undefined {
  return roots.find(r => containsNode(r, node))
}

/** 判断 target 节点是否位于 parent 子树内（对象引用比较） */
function containsNode(parent: FolderNode, target: FolderNode): boolean {
  if (parent === target) return true
  return parent.children.some(c => containsNode(c, target))
}

/** 真实目录树节点的绝对路径 key（子节点 node.path 为相对路径，需拼接根路径，避免多根同名子目录冲突） */
function getNodeAbsKey(node: FolderNode): string {
  const nodeNorm = node.path.replace(/\\/g, '/')
  // 已是绝对路径（根节点或虚拟分组节点）直接返回
  if (/^[A-Za-z]:\//.test(nodeNorm) || nodeNorm.startsWith('/')) return nodeNorm
  const rootNode = folderTree.value.find(r => r.path === nodeNorm) ?? findRootForNode(node, folderTree.value)
  if (!rootNode) return nodeNorm
  const rootNorm = rootNode.path.replace(/\\/g, '/').replace(/\/$/, '')
  return rootNorm + '/' + nodeNorm
}

/** 判断根节点是否已达到大型标准（>100张图 或 >5个子文件夹） */
function isRootLarge(rootNode: FolderNode): boolean {
  if (rootNode.children.length > 5) return true
  return totalNodeImages(rootNode) > 100
}

/** 获取节点展开状态：仅在首次构造时决定，之后不变（key 由调用方提供，真实树为绝对路径） */
function isExpanded(node: FolderNode, key?: string): boolean {
  const k = key || getNodeAbsKey(node)
  // 筛选激活时以筛选展开表为准（临时覆盖，不污染用户的展开状态）
  if (state.settings.filterRegex && filterExpandedMap.has(k)) {
    return filterExpandedMap.get(k)!
  }
  if (expandedMap.has(k)) {
    return expandedMap.get(k)!
  }
  // 首次构造：找到所属根节点
  const rootNode = folderTree.value.find(r => r.path === node.path) ?? findRootForNode(node, folderTree.value)
  const rootKey = rootNode?.path ?? node.path
  // 查该根路径的检测标志
  if (rootLargeDetected.get(rootKey)) {
    expandedMap.set(k, false)
    return false
  }
  // 默认为展开，然后检查根节点维度是否达到大型标准
  expandedMap.set(k, true)
  if (rootNode && isRootLarge(rootNode)) {
    rootLargeDetected.set(rootKey, true)
    expandedMap.set(k, false) // 触发节点自身也折叠
  }
  return expandedMap.get(k)!
}

/** 为虚拟分组创建作用域化的 isExpanded */
function makeVgExpanded(vgIndex: number): (node: FolderNode, key?: string) => boolean {
  return (node: FolderNode, key?: string) => {
    const k = key || `vg:${vgIndex}:${node.path}`
    if (expandedMap.has(k)) {
      return expandedMap.get(k)!
    }
    // 委托给 isExpanded 初始化，但使用作用域键
    return isExpanded(node, k)
  }
}

const folderTree = computed(() => {
  return sortFolderTree(buildFolderTree(props.images, state.loadedRootPaths))
})

/** 完整节点列表：虚拟分组（原始顺序）+ 排序后的文件夹树 */
const allRootNodes = computed<(FolderNode & { isVirtualGroup?: boolean })[]>(() => {
  const virtualRoots = props.virtualGroups
    .map((vg, i) => ({
      ...vg,
      isVirtualGroup: true,
      _vgIndex: i,
    }))
    // 仅用于分组查看器的临时分组不在主视图显示（保留原始索引，保证 vgIndex 正确）
    .filter(vg => !vg.temporary)
  return [...virtualRoots, ...folderTree.value]
})

/**
 * 分组渐进渲染：首屏只挂载少量分组，其余分组在后续帧中分批追加。
 * 分组多了以后（如数百个子目录、数万张图片），一次性挂载全部网格组件
 * 会长时间阻塞主线程，表现为图片"一张一张地冒出来"。
 */
const GROUP_RENDER_STEP = 12
/** 每帧最多新增的图片数（预算），避免单帧渲染时间过长 */
const GROUP_RENDER_IMAGE_BUDGET = 400

const renderedGroupCount = ref(GROUP_RENDER_STEP)
const visibleRootNodes = computed(() => {
  const nodes = allRootNodes.value
  // 筛选生效时直接过滤出可见根节点（结果通常很少，无需分批），
  // 避免为注定隐藏的根节点创建组件实例
  if (state.settings.filterRegex) return nodes.filter(isRootVisible)
  return nodes.slice(0, renderedGroupCount.value)
})
const hasMoreGroups = computed(() => renderedGroupCount.value < allRootNodes.value.length)

const nodeImageCountCache = new WeakMap<FolderNode, number>()
function countNodeImages(node: FolderNode): number {
  const cached = nodeImageCountCache.get(node)
  if (cached !== undefined) return cached
  let n = node.images.length
  for (const child of node.children) {
    n += countNodeImages(child)
  }
  nodeImageCountCache.set(node, n)
  return n
}

let renderRafId = 0
function scheduleMoreGroups() {
  if (!hasMoreGroups.value || renderRafId) return
  renderRafId = requestAnimationFrame(() => {
    renderRafId = 0
    let budget = GROUP_RENDER_IMAGE_BUDGET
    while (hasMoreGroups.value && budget > 0) {
      const node = allRootNodes.value[renderedGroupCount.value]
      budget -= Math.max(node ? countNodeImages(node) : 1, 1)
      renderedGroupCount.value += 1
    }
    scheduleMoreGroups()
  })
}

onMounted(() => scheduleMoreGroups())
onUnmounted(() => {
  if (renderRafId) cancelAnimationFrame(renderRafId)
  if (jumpFlashTimer) {
    clearTimeout(jumpFlashTimer)
    jumpFlashTimer = null
  }
})

watch(hasMoreGroups, (more) => {
  if (more) scheduleMoreGroups()
})

/** 统一写入展开状态：筛选激活时同步覆盖表，保证用户点击立即生效 */
function setExpandedState(key: string, value: boolean) {
  expandedMap.set(key, value)
  if (filterExpandedMap.has(key)) filterExpandedMap.set(key, value)
}

function toggleNode(node: FolderNode, scopeKey?: string) {
  const key = scopeKey || getNodeAbsKey(node)
  setExpandedState(key, !isExpanded(node, key))
}

/** 展开指定节点（新建子目录后调用，确保新目录可见） */
function expandNode(key: string) {
  setExpandedState(key, true)
}

/** 根据根路径构造节点绝对 key（node.path 可能是相对或绝对路径） */
function absKeyFor(rootPath: string, nodePath: string): string {
  const rootNorm = rootPath.replace(/\\/g, '/').replace(/\/$/, '')
  const nodeNorm = nodePath.replace(/\\/g, '/')
  if (nodeNorm === rootNorm || nodeNorm.startsWith(rootNorm + '/')) return nodeNorm
  return rootNorm + '/' + nodeNorm
}

function toggleAll(expand: boolean) {
  expandedMap.clear()
  rootLargeDetected.clear()
  // 用户显式操作全部节点：丢弃筛选覆盖，避免筛选期间的展开状态与操作冲突
  filterExpandedMap.clear()
  function setAll(node: FolderNode, rootPath: string) {
    expandedMap.set(absKeyFor(rootPath, node.path), expand)
    for (const child of node.children) {
      setAll(child, rootPath)
    }
  }
  for (const node of folderTree.value) {
    setAll(node, node.path)
  }
  for (let vi = 0; vi < props.virtualGroups.length; vi++) {
    setAllVg(props.virtualGroups[vi], vi, expand)
  }
}

function setAllVg(vg: FolderNode, vi: number, expand: boolean) {
  expandedMap.set(`vg:${vi}:${vg.path}`, expand)
  for (const child of vg.children) {
    expandedMap.set(`vg:${vi}:${child.path}`, expand)
    setAllVg(child, vi, expand)
  }
}

/** 折叠叶子节点（仅图片无子文件夹），展开其他节点 */
function collapseLeaves() {
  expandedMap.clear()
  rootLargeDetected.clear()
  filterExpandedMap.clear()
  function walk(node: FolderNode, rootPath: string) {
    const isLeaf = node.images.length > 0 && node.children.length === 0
    expandedMap.set(absKeyFor(rootPath, node.path), !isLeaf) // 叶子折叠，非叶子展开
    for (const child of node.children) {
      walk(child, rootPath)
    }
  }
  for (const root of folderTree.value) {
    walk(root, root.path)
  }
  for (let vi = 0; vi < props.virtualGroups.length; vi++) {
    collapseLeavesVg(props.virtualGroups[vi], vi)
  }
}

function collapseLeavesVg(vg: FolderNode, vi: number) {
  const isLeaf = vg.images.length > 0 && vg.children.length === 0
  expandedMap.set(`vg:${vi}:${vg.path}`, !isLeaf)
  for (const child of vg.children) {
    collapseLeavesVg(child, vi)
  }
}

// 加载完成时重置检测标志，下次扫描重新判断
watch(() => state.loading, (loading) => {
  if (!loading) {
    rootLargeDetected.clear()
    // 扫描期间若筛选仍激活，新数据需要重算覆盖表
    if (state.settings.filterRegex) updateExpandedByFilter()
  }
})

/**
 * 按筛选结果刷新展开覆盖表：只写 filterExpandedMap，不动用户的 expandedMap。
 * 清空筛选时直接丢弃覆盖表，展开状态自动回到筛选前。
 * 同时该表兼作「节点子树是否有匹配」的可见性来源：FolderGroup 据此隐藏无结果的分组；
 * filterMatchCountMap 记录子树匹配数，用于筛选时标题显示匹配数量。
 */
function updateExpandedByFilter() {
  filterExpandedMap.clear()
  filterMatchCountMap.clear()
  const regex = state.settings.filterRegex
  if (!regex) return

  // 后序遍历：每个节点只算一次子树匹配，避免逐节点重复递归
  function walk(node: FolderNode, rootPath: string): number {
    let count = filterImages(node.images, regex, state.settings.filterTarget, state.virtualGroups).length
    for (const child of node.children) {
      count += walk(child, rootPath)
    }
    const key = absKeyFor(rootPath, node.path)
    filterMatchCountMap.set(key, count)
    filterExpandedMap.set(key, count > 0)
    return count
  }
  for (const node of folderTree.value) {
    walk(node, node.path)
  }
  // 虚拟分组同样按子树（含子节点）递归，键与 FolderGroup 的作用域展开键一致
  function walkVg(node: FolderNode, vi: number): number {
    let count = filterImages(node.images, regex, state.settings.filterTarget, state.virtualGroups).length
    for (const child of node.children) {
      count += walkVg(child, vi)
    }
    const key = `vg:${vi}:${node.path}`
    filterMatchCountMap.set(key, count)
    filterExpandedMap.set(key, count > 0)
    return count
  }
  for (let vi = 0; vi < state.virtualGroups.length; vi++) {
    walkVg(state.virtualGroups[vi], vi)
  }
}

/**
 * 供 FolderGroup 查询：筛选激活期间该节点子树是否无匹配（键与展开键一致）。
 * 返回 undefined 表示“不隐藏”（未筛选 / 尚未计算出结果，如扫描中新出现的节点）。
 */
function isFilteredOut(key: string): boolean | undefined {
  if (!state.settings.filterRegex) return undefined
  const matched = filterExpandedMap.get(key)
  return matched === undefined ? undefined : !matched
}

/** 供 FolderGroup 查询：筛选激活期间该节点子树的匹配图片数量 */
function getFilterMatchCount(key: string): number | undefined {
  if (!state.settings.filterRegex) return undefined
  return filterMatchCountMap.get(key)
}

provide('isFilteredOut', isFilteredOut)
provide('getFilterMatchCount', getFilterMatchCount)

/** 筛选期间根节点是否可见（子树无匹配的根节点整体隐藏） */
function isRootVisible(node: FolderNode & { isVirtualGroup?: boolean; _vgIndex?: number }): boolean {
  if (!state.settings.filterRegex) return true
  const key = node.isVirtualGroup
    ? `vg:${node._vgIndex}:${node.path}`
    : absKeyFor(node.path, node.path)
  return filterExpandedMap.get(key) !== false
}

watch(
  () => [state.settings.filterRegex, state.settings.filterTarget],
  () => updateExpandedByFilter(),
)

/* ===================== 左侧层级面板 ===================== */

/** 面板展开状态在本地存储中的键（不作为设置项，避免与配置文件结构耦合） */
const HIERARCHY_OPEN_KEY = 'imggroup:hierarchy-panel-open'

function readStoredHierarchyOpen(): boolean {
  try {
    return localStorage.getItem(HIERARCHY_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

const hierarchyOpen = ref(readStoredHierarchyOpen())
const panelScrollRef = ref<HTMLElement | null>(null)

watch(hierarchyOpen, (open) => {
  try {
    localStorage.setItem(HIERARCHY_OPEN_KEY, open ? '1' : '0')
  } catch { /* 忽略本地存储不可用 */ }
})

function toggleHierarchyPanel() {
  hierarchyOpen.value = !hierarchyOpen.value
}

/** 与 FolderGroup.shouldCollapse 一致的层级压缩判定：只有一个子节点且无一级图片的中间节点被跳过 */
function isCompressedMiddleNode(node: FolderNode, depth: number): boolean {
  if (!state.settings.collapseHierarchy) return false
  if (depth === 0) return false
  if (node.children.length !== 1) return false
  if (node.images.length > 0) return false
  return true
}

/**
 * 面板自己的展开状态表（与主视图的 expandedMap 完全独立）。
 * 缺省视为展开，因此「展开全部」只需清空本表。
 */
const hierarchyExpandedMap = reactive(new Map<string, boolean>())

function isRowExpanded(key: string): boolean {
  const v = hierarchyExpandedMap.get(key)
  return v === undefined ? true : v
}

/** 面板内单击某行的折叠箭头：只影响面板自身，不影响主视图 */
function toggleHierarchyRow(row: HierarchyRow) {
  hierarchyExpandedMap.set(row.key, !row.expanded)
}

/** 面板「展开全部」：清空覆盖表，全部回到默认展开 */
function hierarchyExpandAllRows() {
  hierarchyExpandedMap.clear()
}

/** 面板「折叠全部」：所有分组在面板中折叠（主视图不受影响） */
function hierarchyCollapseAllRows() {
  hierarchyExpandedMap.clear()
  const roots = allRootNodes.value as (FolderNode & { isVirtualGroup?: boolean; _vgIndex?: number })[]
  function setAll(node: FolderNode, vgIndex: number | undefined, rootPath: string) {
    const key = vgIndex !== undefined ? `vg:${vgIndex}:${node.path}` : absKeyFor(rootPath, node.path)
    hierarchyExpandedMap.set(key, false)
    for (const child of node.children) {
      setAll(child, vgIndex, rootPath)
    }
  }
  for (const node of roots) {
    setAll(node, node.isVirtualGroup ? node._vgIndex : undefined, node.path)
  }
}

/**
 * 生成层级面板的行。
 * - 只包含分组（不含图片）
 * - 展开状态来自面板自己的 hierarchyExpandedMap（与主视图互不影响）
 * - 与主视图共用层级压缩规则（被压缩的中间节点不单独成行）
 * - 筛选激活时只保留子树有匹配的分组，数量显示匹配数
 */
const hierarchyRows = computed<HierarchyRow[]>(() => {
  const rows: HierarchyRow[] = []
  const privacy = state.settings.privacyMode
  const filtering = !!state.settings.filterRegex
  const roots = allRootNodes.value as (FolderNode & { isVirtualGroup?: boolean; _vgIndex?: number })[]

  function walk(
    node: FolderNode,
    depth: number,
    parentKeys: string[],
    namePrefix: string,
    hintPrefix: string,
    vgIndex: number | undefined,
    rootPath: string,
    rootIndex: number,
    siblingIndex: number,
  ) {
    let cur = node
    let curDepth = depth
    let labelPrefix = namePrefix
    let hint = hintPrefix
    let sib = siblingIndex
    // 层级压缩：跳过中间节点，名称合并到最终节点的标题中
    while (isCompressedMiddleNode(cur, curDepth)) {
      const child = cur.children[0]
      labelPrefix += cur.name + ' / '
      hint += cur.name + ' / '
      cur = child
      // 只有一个子节点，最终节点在同级中的序号为 0（隐私模式匿名名与主视图一致）
      sib = 0
    }
    const key = vgIndex !== undefined ? `vg:${vgIndex}:${cur.path}` : absKeyFor(rootPath, cur.path)
    // 筛选后无匹配的分组（含其子分组）整体不显示
    if (isFilteredOut(key) === true) return
    const matched = filtering ? getFilterMatchCount(key) : undefined
    const count = matched !== undefined ? matched : countNodeImages(cur)
    const hintPath = hint + cur.name
    const label = privacy
      ? `${t('control.anonymous_node')}${sib + 1}`
      : labelPrefix + cur.name
    const expanded = isRowExpanded(key)
    const ancestorKeys = [...parentKeys, key]
    rows.push({
      key,
      label,
      depth: curDepth,
      count,
      hasChildren: cur.children.length > 0,
      expanded,
      isVirtual: vgIndex !== undefined,
      isVirtualRoot: vgIndex !== undefined && curDepth === 0,
      hint: hintPath,
      ancestorKeys,
      rootIndex,
    })
    if (!expanded) return
    const childHint = hintPath + ' / '
    for (let i = 0; i < cur.children.length; i++) {
      walk(cur.children[i], curDepth + 1, ancestorKeys, '', childHint, vgIndex, rootPath, rootIndex, i)
    }
  }

  for (let i = 0; i < roots.length; i++) {
    const node = roots[i]
    const vgIndex = node.isVirtualGroup ? node._vgIndex : undefined
    walk(node, 0, [], '', '', vgIndex, node.path, i, 0)
  }
  return rows
})

/** 面板未展开时不做整棵树的行生成（避免每次渲染都遍历全部节点） */
const hierarchyPanelRows = computed<HierarchyRow[]>(() =>
  hierarchyOpen.value ? hierarchyRows.value : []
)

/** 在已挂载的分组中查找跳转目标元素（从目标自身向根回退，兼容层级压缩） */
function findGroupElement(keys: string[]): HTMLElement | null {
  const root = panelScrollRef.value
  if (!root) return null
  const map = new Map<string, HTMLElement>()
  root.querySelectorAll<HTMLElement>('[data-group-key]').forEach((el) => {
    const k = el.dataset.groupKey
    if (k && !map.has(k)) map.set(k, el)
  })
  for (let i = keys.length - 1; i >= 0; i--) {
    const el = map.get(keys[i])
    if (el) return el
  }
  return null
}

/** 瞬时定位到目标分组（不使用平滑滚动：避免中间位置的图片被逐个加载） */
function scrollToGroupInstant(el: HTMLElement) {
  const scroller = panelScrollRef.value
  if (!scroller) return
  const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  scroller.scrollTop = Math.max(0, scroller.scrollTop + offset - 2)
}

let jumpFlashTimer: ReturnType<typeof setTimeout> | null = null

/** 跳转目标闪烁提示（元素由 FolderGroup 渲染，故使用全局样式类） */
function flashGroupElement(el: HTMLElement) {
  if (jumpFlashTimer) {
    clearTimeout(jumpFlashTimer)
    jumpFlashTimer = null
  }
  document.querySelectorAll('.hier-jump-flash').forEach((n) => n.classList.remove('hier-jump-flash'))
  void el.offsetWidth
  el.classList.add('hier-jump-flash')
  jumpFlashTimer = setTimeout(() => {
    el.classList.remove('hier-jump-flash')
    jumpFlashTimer = null
  }, 1200)
}

/**
 * 点击面板条目：展开主视图中的祖先与目标分组自身（不递归展开其子分组），
 * 确保根节点已挂载后瞬时定位过去。
 */
async function jumpToHierarchyGroup(row: HierarchyRow) {
  // ancestorKeys 含自身：祖先用于让目标可见，自身用于显示该分组的图片/子分组
  for (const key of row.ancestorKeys) {
    setExpandedState(key, true)
  }
  // 目标根节点可能还在渐进渲染队列中
  if (row.rootIndex >= renderedGroupCount.value) {
    renderedGroupCount.value = row.rootIndex + 1
  }
  await nextTick()
  const el = findGroupElement(row.ancestorKeys)
  if (!el) return
  scrollToGroupInstant(el)
  flashGroupElement(el)
}

function handleViewImage(item: ImageItem, scope?: ImageItem[], navKey?: string, imageIndex?: number) {
  emit('viewImage', item, scope, navKey, imageIndex)
}

function handleSelectImage(item: ImageItem, ctrl: boolean) {
  emit('selectImage', item, ctrl)
}

function handleDeleteVg(index: number) {
  emit('deleteVirtualGroup', index)
}

/** 删除虚拟分组中的子节点 */
function handleVirtualExcludeNode(rootPath: string, subPath: string) {
  const vgIndex = state.virtualGroups.findIndex(v => v.path === rootPath)
  if (vgIndex >= 0) excludeNodeFromVirtualGroup(vgIndex, subPath)
}

function handleExcludeNode(rootPath: string, subPath: string) {
  emit('excludeNode', rootPath, subPath)
}

defineExpose({ toggleAll, collapseLeaves })
</script>

<template>
  <div class="folder-panel-shell">
    <!-- 左侧层级面板：只列分组，与主视图显示条目一致，点击快速跳转 -->
    <HierarchyPanel
      :rows="hierarchyPanelRows"
      :open="hierarchyOpen"
      @togglePanel="toggleHierarchyPanel"
      @toggleRow="toggleHierarchyRow"
      @jump="jumpToHierarchyGroup"
      @expandAll="hierarchyExpandAllRows"
      @collapseAll="hierarchyCollapseAllRows"
    />
    <div
      ref="panelScrollRef"
      class="folder-panel"
      :style="{ marginLeft: state.settings.contentMarginX + 'px', marginRight: state.settings.contentMarginX + 'px' }"
    >
      <div v-if="state.settings.compactMode && state.settings.rootCompactMode" class="folder-panel-compact" :style="{ gap: state.settings.nodeGridGapH + 'px' }">
        <template v-for="(node, i) in visibleRootNodes" :key="node.path || `vg-${i}`">
          <FolderGroup
            v-if="(node as any).isVirtualGroup"
            :node="node"
            :depth="0"
            :rootPath="node.path"
            :showTitle="state.showGroupTitle"
            :getExpanded="makeVgExpanded((node as any)._vgIndex)"
            :isVirtualRoot="true"
            :vgIndex="(node as any)._vgIndex"
            collapsePrefix=""
            :siblingNodes="allRootNodes as any"
            :anonName="state.settings.privacyMode ? $t('control.anonymous_node') + (i + 1) : undefined"
            @toggle="toggleNode"
            @viewImage="handleViewImage"
            @selectImage="handleSelectImage"
            @removeRoot="() => handleDeleteVg((node as any)._vgIndex)"
            @excludeNode="handleVirtualExcludeNode"
            @toggleSelectFolder="(p:string) => emit('toggleSelectFolder', p)"
            @addToVirtualGroup="addSelectionToVirtualGroup((node as any)._vgIndex)"
            @removeFromVirtualGroup="removeSelectionFromVirtualGroup((node as any)._vgIndex)"
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
            collapsePrefix=""
            :siblingNodes="allRootNodes as any"
            :anonName="state.settings.privacyMode ? $t('control.anonymous_node') + (i + 1) : undefined"
            @toggle="toggleNode"
            @viewImage="handleViewImage"
            @selectImage="handleSelectImage"
            @removeRoot="(p:string) => emit('removeRoot', p)"
            @excludeNode="handleExcludeNode"
            @toggleSelectFolder="(p:string) => emit('toggleSelectFolder', p)"
            @copyToFolder="(p:string) => emit('copyToFolder', p)"
            @moveToFolder="(p:string) => emit('moveToFolder', p)"
            @expandNode="expandNode"
          />
        </template>
      </div>
      <template v-else v-for="(node, i) in visibleRootNodes" :key="node.path || `vg-${i}`">
        <FolderGroup
          v-if="(node as any).isVirtualGroup"
          :node="node"
          :depth="0"
          :rootPath="node.path"
          :showTitle="state.showGroupTitle"
          :getExpanded="makeVgExpanded((node as any)._vgIndex)"
          :isVirtualRoot="true"
          :vgIndex="(node as any)._vgIndex"
          collapsePrefix=""
          :siblingNodes="allRootNodes as any"
          :anonName="state.settings.privacyMode ? $t('control.anonymous_node') + (i + 1) : undefined"
          @toggle="toggleNode"
          @viewImage="handleViewImage"
          @selectImage="handleSelectImage"
          @removeRoot="() => handleDeleteVg((node as any)._vgIndex)"
          @excludeNode="handleVirtualExcludeNode"
          @toggleSelectFolder="(p:string) => emit('toggleSelectFolder', p)"
          @addToVirtualGroup="addSelectionToVirtualGroup((node as any)._vgIndex)"
          @removeFromVirtualGroup="removeSelectionFromVirtualGroup((node as any)._vgIndex)"
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
          collapsePrefix=""
          :siblingNodes="allRootNodes as any"
          :anonName="state.settings.privacyMode ? $t('control.anonymous_node') + (i + 1) : undefined"
          @toggle="toggleNode"
          @viewImage="handleViewImage"
          @selectImage="handleSelectImage"
          @removeRoot="(p:string) => emit('removeRoot', p)"
          @excludeNode="handleExcludeNode"
          @toggleSelectFolder="(p:string) => emit('toggleSelectFolder', p)"
          @copyToFolder="(p:string) => emit('copyToFolder', p)"
          @moveToFolder="(p:string) => emit('moveToFolder', p)"
          @expandNode="expandNode"
        />
      </template>
      <div v-if="allRootNodes.length === 0" class="empty-hint">
        <p>{{ $t('empty.drop_hint') }}</p>
        <p class="sub-hint">{{ $t('empty.format_hint') }}</p>
      </div>
      <div v-else-if="state.settings.filterRegex && visibleRootNodes.length === 0" class="empty-hint">
        <p>{{ $t('empty.no_results') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 整体：左层级面板 + 右侧滚动内容区并排（内容区自身滚动，面板固定不随内容滚动） */
.folder-panel-shell {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: stretch;
}

.folder-panel {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  /* 为底部固定控制栏留出空间，避免最后图片被遮挡 */
  padding-bottom: 80px;
}

.folder-panel-compact {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
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

<style>
/* 层级面板跳转目标闪烁（目标元素由 FolderGroup 渲染，需全局样式才匹配得到） */
.hier-jump-flash {
  animation: hier-jump-flash 1.1s ease-out;
}

@keyframes hier-jump-flash {
  0% {
    outline: 2px solid rgba(130, 140, 255, 0.95);
    outline-offset: 1px;
  }
  70% {
    outline: 2px solid rgba(130, 140, 255, 0.55);
    outline-offset: 3px;
  }
  100% {
    outline: 2px solid rgba(130, 140, 255, 0);
    outline-offset: 6px;
  }
}
</style>
