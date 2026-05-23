import { reactive } from 'vue'
import type { ImageInfo, ImageItem, FolderNode, AppSettings, SortBy, SortOrder, FilterTarget } from '../types'
import { invoke } from '@tauri-apps/api/core'
import { open, ask } from '@tauri-apps/plugin-dialog'
import { t } from '../i18n'

/** 冒泡提示 */
export const toastState = reactive({
  text: '',
  visible: false,
  _timer: 0 as unknown as ReturnType<typeof setTimeout> | undefined,
})

export function showToast(text: string, duration = 3000) {
  if (toastState._timer) clearTimeout(toastState._timer)
  toastState.text = text
  toastState.visible = true
  toastState._timer = setTimeout(() => {
    toastState.visible = false
    toastState._timer = undefined
  }, duration)
}

/** 默认设置 */
const defaultSettings: AppSettings = {
  borderRadius: 4,
  gap: 8,
  bgColor: '#1a1a2e',
  gridSize: 200,
  folderGroup: true,
  showGroupTitle: true,
  filterRegex: '',
  filterTarget: 'name',
  sortBy: 'name',
  sortOrder: 'asc',
  filterPresets: [],
  openWithPrograms: [],
  rootTitleColor: '#ffffff',
  childTitleColor: '#c0c0e0',
	rootTitleBgColor: '#222240',
  childTitleBgColor: '#23234d',
  nodeGridGap: 4,
  rainbowEnabled: false,
  rainbowColors: ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db'],
  language: 'zh',
  viewerBgMode: 'overlay',
  viewerBgColor: '#202020',
  scanAllFiles: false,
  autoPan: true,
  autoCenter: true,
}

/** 全局状态 */
export const state = reactive({
  /** 所有图片列表 */
  allImages: [] as ImageItem[],
  /** 用户显式加载的根文件夹路径列表 */
  loadedRootPaths: [] as string[],
  /** 目录树结构 */
  folderTree: [] as FolderNode[],
  /** 虚拟分组列表（存放在树根层的节点） */
  virtualGroups: [] as FolderNode[],
  /** 是否启用目录分组 */
  folderGroup: true,
  /** 是否显示分组标题 */
  showGroupTitle: true,
  /** 当前查看的图片索引（-1表示不在查看状态） */
  viewingIndex: -1,
  /** 选择模式 */
  selectMode: 'view' as 'select' | 'view',
  /** 选中的图片路径集合 */
  selectedPaths: new Set<string>(),
  /** 选中的文件夹节点路径集合 */
  selectedFolderPaths: new Set<string>(),
  /** 设置 */
  settings: { ...defaultSettings },
  /** 加载状态 */
  loading: false,
  /** 是否显示图片信息（文件名、缩放系数） */
  showImageInfo: true,
  /** 缩放系数 */
  zoomFactor: 1,
  /** 刷新提示（检测到外部变更） */
  refreshAvailable: false,
  /** 待处理的变更路径列表 */
  pendingChanges: [] as string[],
  /** 用户取消扫描的根路径集合（忽略其后续事件） */
  cancelledRoots: new Set<string>(),
})

/** 按路径去重后添加到allImages */
function addImagesUnique(newItems: ImageItem[]) {
  const existingPaths = new Set(state.allImages.map(i => normPath(i.path)))
  const toAdd = newItems.filter(i => !existingPaths.has(normPath(i.path)))
  state.allImages.push(...toAdd)
}

/** 根据设置排序图片 */
export function sortImages(images: ImageItem[], sortBy: SortBy, sortOrder: SortOrder): ImageItem[] {
  return [...images].sort((a, b) => {
    let cmp = 0
    if (sortBy === 'name') {
      cmp = a.name.localeCompare(b.name)
    } else if (sortBy === 'modified') {
      cmp = a.modified.localeCompare(b.modified)
    } else if (sortBy === 'size') {
      cmp = a.size_bytes - b.size_bytes
    }
    return sortOrder === 'asc' ? cmp : -cmp
  })
}

/** 应用正则筛选 */
export function filterImages(images: ImageItem[], regex: string, target: FilterTarget = 'name', virtualGroups?: FolderNode[]): ImageItem[] {
  if (!regex) return images
  try {
    const re = new RegExp(regex, 'i')
    if (target === 'name') {
      return images.filter(img => re.test(img.name))
    }
    if (target === 'path') {
      return images.filter(img => re.test(img.dir))
    }
    // 分组模式：匹配文件夹名（dir 最后一段）或虚拟分组标题
    const matchingVGPaths = new Set<string>()
    if (virtualGroups) {
      for (const vg of virtualGroups) {
        if (re.test(vg.name)) {
          for (const img of vg.images) {
            matchingVGPaths.add(img.path)
          }
        }
      }
    }
    return images.filter(img => {
      const folderName = img.dir.replace(/\\/g, '/').split('/').pop() || ''
      return re.test(folderName) || matchingVGPaths.has(img.path)
    })
  } catch {
    return images
  }
}

/** 获取处理后的图片列表（排序+筛选） */
export function getProcessedImages(images: ImageItem[]): ImageItem[] {
  let result = [...images]
  // 筛选
  result = filterImages(result, state.settings.filterRegex, state.settings.filterTarget, state.virtualGroups)
  // 排序
  result = sortImages(result, state.settings.sortBy, state.settings.sortOrder)
  return result
}

/** 扫描文件夹（记录为根路径） */
export async function scanFolder(path: string): Promise<void> {
  state.loading = true
  try {
    const result = await invoke<{ images: ImageInfo[]; total: number }>('scan_folder', { path, scanAllFiles: state.settings.scanAllFiles })
    const items: ImageItem[] = result.images.map(img => ({
      ...img,
      loading: false,
    }))
    addImagesUnique(items)
    // 记录加载的根路径
    const norm = path.replace(/\\/g, '/').replace(/\/$/, '')
    if (!state.loadedRootPaths.includes(norm)) {
      state.loadedRootPaths.push(norm)
    }
  } catch (e) {
    console.error('扫描文件夹失败:', e)
    throw e
  } finally {
    state.loading = false
  }
}

/** 扫描多个文件夹 */
export async function scanFolders(paths: string[]): Promise<void> {
  state.loading = true
  try {
    const results = await invoke<{ images: ImageInfo[]; total: number }[]>('scan_folders', { paths, scanAllFiles: state.settings.scanAllFiles })
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      const items: ImageItem[] = result.images.map(img => ({
        ...img,
        loading: false,
      }))
      addImagesUnique(items)
      // 记录加载的根路径
      if (paths[i]) {
        const norm = paths[i].replace(/\\/g, '/').replace(/\/$/, '')
        if (!state.loadedRootPaths.includes(norm)) {
          state.loadedRootPaths.push(norm)
        }
      }
    }
  } catch (e) {
    console.error('扫描文件夹失败:', e)
    throw e
  } finally {
    state.loading = false
  }
}

/** 渐进式扫描：启动后台扫描线程，结果通过事件流式返回 */
export async function startProgressiveScan(paths: string[]): Promise<void> {
  state.loading = true
  // 预登记根路径，避免用户在扫描完成前移除后事件重新添加
  let hasNew = false
  for (const p of paths) {
    const norm = p.replace(/\\/g, '/').replace(/\/$/, '')
    if (!state.loadedRootPaths.includes(norm)) {
      state.loadedRootPaths.push(norm)
      hasNew = true
    }
  }
  // 所有路径都已存在（重复加载），不发起新扫描
  if (!hasNew) {
    state.loading = false
    return
  }
  try {
    await invoke('scan_folders_progressive', { paths, scanAllFiles: state.settings.scanAllFiles })
  } catch (e) {
    console.error('启动渐进扫描失败:', e)
    state.loading = false
  }
}

/** 处理单目录扫描结果（由 scan-dir-progress 事件触发） */
export function handleDirProgress(payload: { dir: string; images: ImageInfo[]; root: string }): void {
  const norm = payload.root.replace(/\\/g, '/').replace(/\/$/, '')
  // 根路径已被用户取消扫描（点击了 x），忽略后续事件
  if (state.cancelledRoots.has(norm)) return
  // 确保根路径已登记（startProgressiveScan 会预登记，但兼容手动调用场景）
  if (!state.loadedRootPaths.includes(norm)) {
    state.loadedRootPaths.push(norm)
  }
  const items: ImageItem[] = payload.images.map(img => ({
    ...img,
    loading: false,
  }))
  addImagesUnique(items)
}

/** 渐进扫描完成（由 scan-all-complete 事件触发） */
export function handleScanComplete(): void {
  state.loading = false
  state.cancelledRoots.clear()
}

/** 更新文件系统监听器（监视已加载根路径的变更，paths为空时停止所有监听） */
export async function setupFolderWatcher(): Promise<void> {
  try {
    await invoke('update_watcher', { paths: [...state.loadedRootPaths] })
  } catch (e) {
    console.error('设置文件监听失败:', e)
  }
}

/** 抑制/恢复文件变更监听（自身操作时抑制） */
export async function setSuppressWatcher(suppress: boolean): Promise<void> {
  try {
    await invoke('set_suppress_watcher', { suppress })
  } catch { /* 忽略 */ }
}

/** 获取单文件信息 */
export async function getFileInfo(path: string): Promise<ImageInfo | null> {
  try {
    const infos = await invoke<ImageInfo[]>('get_files_info', { paths: [path], scanAllFiles: state.settings.scanAllFiles })
    return infos[0] || null
  } catch { return null }
}

/** 规范化路径（统一小写+前斜杠，用于比较） */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase()
}

/** 细粒度应用文件变更（新增/修改/删除） */
export async function applyFileChanges(changedPaths: string[]): Promise<boolean> {
  if (changedPaths.length === 0) return false

  // 构建规范化路径映射：normPath → 原始路径
  const normToOrig = new Map<string, string>()
  for (const img of state.allImages) {
    normToOrig.set(normPath(img.path), img.path)
  }

  // 1. 找出变更路径中需要在 state 中删除的条目
  const pathsToRemove = new Set<string>()
  const toCheck: string[] = []

  for (const p of changedPaths) {
    const n = normPath(p)
    if (normToOrig.has(n)) {
      toCheck.push(p)
    }
  }

  if (toCheck.length > 0) {
    const existingInfos = await invoke<ImageInfo[]>('get_files_info', { paths: toCheck, scanAllFiles: state.settings.scanAllFiles })
    const existingSet = new Set(existingInfos.map(i => normPath(i.path)))
    for (const p of toCheck) {
      if (!existingSet.has(normPath(p))) {
        pathsToRemove.add(normToOrig.get(normPath(p))!)
      }
    }
  }

  // 执行删除
  if (pathsToRemove.size > 0) {
    state.allImages = state.allImages.filter(i => !pathsToRemove.has(i.path))
    for (const p of pathsToRemove) state.selectedPaths.delete(p)
    for (const vg of state.virtualGroups) {
      vg.images = vg.images.filter(i => !pathsToRemove.has(i.path))
    }
  }

  // 2. 处理新增/修改：获取文件信息并更新
const newInfos = await invoke<ImageInfo[]>('get_files_info', { paths: changedPaths, scanAllFiles: state.settings.scanAllFiles })

  for (const info of newInfos) {
    const n = normPath(info.path)
    // 先按规范化路径查找已有条目
    const idx = state.allImages.findIndex(i => normPath(i.path) === n)
    if (idx >= 0) {
      Object.assign(state.allImages[idx], info)
    } else {
      state.allImages.push({ ...info, loading: false })
    }
  }

  return true
}

/** 刷新所有已加载文件夹 */
export async function refreshFolders(): Promise<void> {
  if (state.loadedRootPaths.length === 0) return
  // 取消正在进行的扫描
  if (state.loading) { invoke('cancel_scan') }
  state.loading = true
  state.refreshAvailable = false
  // 记录旧路径，防止重复添加
  const paths = [...state.loadedRootPaths]
  // 清除所有图片（保留根路径记录）
  state.allImages = []
  state.selectedPaths.clear()
  for (const vg of state.virtualGroups) {
    vg.images = []
  }
  try {
    await scanFolders(paths)
    await setupFolderWatcher()
  } catch (e) {
    console.error('刷新失败:', e)
  } finally {
    state.loading = false
  }
}

/** 按加载的根文件夹构建目录树 */
export function buildFolderTree(images: ImageItem[], rootPaths: string[]): FolderNode[] {
  // 按目录分组图片，key 统一为前斜杠格式
  const dirMap = new Map<string, ImageItem[]>()
  for (const img of images) {
    const dir = img.dir.replace(/\\/g, '/')
    if (!dirMap.has(dir)) {
      dirMap.set(dir, [])
    }
    dirMap.get(dir)!.push(img)
  }

  const normalizedRoots = rootPaths.map(p => p.replace(/\\/g, '/').replace(/\/$/, ''))

  // 没有根路径时返回空（避免把虚拟分组的图片目录也建树）
  if (normalizedRoots.length === 0) {
    return []
  }

  const roots: FolderNode[] = []

  for (const rootPath of normalizedRoots) {
    const rootName = rootPath.split('/').pop() || rootPath
    const rootNode: FolderNode = {
      path: rootPath,
      name: rootName,
      children: [],
      images: [],
      expanded: true,
    }

    // 收集该根目录下的相对子目录路径（排除已标记的子路径）
    const relativeDirs: string[] = []
    const exclusions = rootExclusions.get(rootPath)

    for (const [dirPath, dirImages] of dirMap.entries()) {
      if (dirPath === rootPath) {
        // 根目录自身的图片
        rootNode.images.push(...dirImages)
      } else if (dirPath.startsWith(rootPath + '/')) {
        // 子目录：转为相对路径
        const relative = dirPath.substring(rootPath.length + 1)
        // 检查是否被排除（relative 或其上级路径被排除）
        if (exclusions && isExcluded(relative, exclusions)) continue
        relativeDirs.push(relative)
      }
    }

    // 构建子目录树（相对路径）
    if (relativeDirs.length > 0) {
      // 构建一个仅包含相对路径的 dirMap
      const relativeDirMap = new Map<string, ImageItem[]>()
      for (const [dirPath, dirImages] of dirMap.entries()) {
        if (dirPath.startsWith(rootPath + '/')) {
          const relative = dirPath.substring(rootPath.length + 1)
          relativeDirMap.set(relative, dirImages)
        }
      }
      rootNode.children = buildSubTree(relativeDirs, relativeDirMap)
    }

    roots.push(rootNode)
  }

  return roots
}

/** 根路径 → 被排除的子路径集合（子节点删除时记录，不删图片） */
export const rootExclusions = reactive(new Map<string, Set<string>>())

/** 从根路径中排除一个子路径（子节点删除） */
export function excludeSubPath(rootPath: string, subPath: string) {
  const norm = rootPath.replace(/\\/g, '/').replace(/\/$/, '')
  if (!rootExclusions.has(norm)) {
    rootExclusions.set(norm, new Set())
  }
  rootExclusions.get(norm)!.add(subPath)
}

/** 检查相对路径是否被排除（路径自身或其任意上级被排除） */
function isExcluded(relative: string, exclusions: Set<string>): boolean {
  if (exclusions.has(relative)) return true
  const parts = relative.split('/')
  let prefix = ''
  for (const part of parts) {
    prefix = prefix ? `${prefix}/${part}` : part
    if (exclusions.has(prefix)) return true
  }
  return false
}

/** 从一组相对路径构建子树 */
function buildSubTree(relPaths: string[], relDirMap: Map<string, ImageItem[]>): FolderNode[] {
  if (relPaths.length === 0) return []

  const partsList = relPaths.map(p => p.split('/').filter(Boolean))
  if (partsList.length === 0) return []

  const nodeMap = new Map<string, FolderNode>()
  const roots: FolderNode[] = []

  for (let pi = 0; pi < partsList.length; pi++) {
    const parts = partsList[pi]
    const originalRelPath = relPaths[pi]
    let current = ''

    for (let i = 0; i < parts.length; i++) {
      const parent = current
      current = current ? `${current}/${parts[i]}` : parts[i]

      if (!nodeMap.has(current)) {
        const node: FolderNode = {
          path: current,
          name: parts[i],
          children: [],
          images: [],
          expanded: true,
        }
        nodeMap.set(current, node)

        if (!parent) {
          roots.push(node)
        } else {
          const p = nodeMap.get(parent)
          if (p) p.children.push(node)
        }
      }

      // 叶子节点挂图片
      if (i === parts.length - 1) {
        const node = nodeMap.get(current)
        if (node) {
          node.images.push(...(relDirMap.get(originalRelPath) || []))
        }
      }
    }
  }

  return roots
}

/** 构建完整树（目录树 + 虚拟分组） */
export function buildFullTree(): FolderNode[] {
  const folderTree = buildFolderTree(state.allImages, state.loadedRootPaths)
  return [...state.virtualGroups, ...folderTree]
}

/** 从文件夹树中递归查找并提取指定路径的节点子树（深拷贝） */
export function findSubTreeInTree(tree: FolderNode[], targetPath: string): FolderNode | null {
  const norm = targetPath.replace(/\\/g, '/')
  for (const node of tree) {
    if (node.path === norm) {
      return JSON.parse(JSON.stringify(node))
    }
    const found = findSubTreeInTree(node.children, norm)
    if (found) return found
  }
  return null
}

/** 扫描单个文件并创建虚拟分组 */
export async function scanFilesAsVirtualGroup(filePaths: string[], groupName?: string): Promise<void> {
  state.loading = true
  try {
    const results = await invoke<{ images: ImageInfo[]; total: number }[]>('scan_folders', { paths: filePaths, scanAllFiles: state.settings.scanAllFiles })
    const allItems: ImageItem[] = []
    for (const result of results) {
      const items = result.images.map(img => ({
        ...img,
        loading: false,
      }))
      allItems.push(...items)
    }
    if (allItems.length > 0) {
      addImagesUnique(allItems)
      const name = groupName || `${t('virtual_group_default')}-${state.virtualGroups.length + 1}`
      addVirtualGroup(name, allItems)
    }
  } catch (e) {
    console.error('加载文件失败:', e)
    throw e
  } finally {
    state.loading = false
  }
}

/** 添加虚拟分组（支持子节点） */
export function addVirtualGroup(name: string, images: ImageItem[], children?: FolderNode[]): FolderNode {
  const node: FolderNode = {
    path: `__virtual__${Date.now()}`,
    name,
    children: children ? children.map(c => ({ ...c })) : [],
    images: [...images],
    expanded: true,
    isVirtual: true,
  }
  state.virtualGroups.push(node)
  return node
}

/** 删除虚拟分组 */
export function removeVirtualGroup(index: number) {
  state.virtualGroups.splice(index, 1)
}

/** 加载图片base64（按需加载） */
export async function loadImageBase64(item: ImageItem): Promise<string> {
  if (item.base64) return item.base64
  item.loading = true
  try {
    const b64 = await invoke<string>('load_image_base64', { path: item.path })
    item.base64 = b64
    return b64
  } catch (e) {
    item.error = String(e)
    throw e
  } finally {
    item.loading = false
  }
}

/** 批量加载base64（带并发控制） */
export async function loadImageBase64Batch(items: ImageItem[], concurrency = 4): Promise<void> {
  const toLoad = items.filter(i => !i.base64 && !i.loading)
  if (toLoad.length === 0) return

  let idx = 0
  async function worker() {
    while (idx < toLoad.length) {
      const item = toLoad[idx++]
      try {
        await loadImageBase64(item)
      } catch { /* 单个失败不中断批量 */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, toLoad.length) }, () => worker()))
}

/** 释放base64缓存（保留 keepPaths 中的图片） */
export function releaseBase64(keepPaths: Set<string>) {
  for (const img of state.allImages) {
    if (img.base64 && !keepPaths.has(img.path)) {
      img.base64 = undefined
    }
  }
}

/** 获取已加载统计 */
export function getLoadStats(): { total: number; loaded: number; memoryBytes: number } {
  let loaded = 0
  let memoryBytes = 0
  for (const img of state.allImages) {
    if (img.base64) {
      loaded++
      // base64 字符串 ≈ 原始字节的 4/3，这里粗略按字符数估算
      memoryBytes += img.base64.length
    }
  }
  return { total: state.allImages.length, loaded, memoryBytes }
}

/** 在资源管理器中打开 */
export async function openInExplorer(path: string): Promise<void> {
  await invoke('open_in_explorer', { path })
}

/** 删除图片（从磁盘和所有分组中移除） */
export async function deleteImages(paths: string[]): Promise<void> {
  await setSuppressWatcher(true)
  try {
    for (const p of paths) {
      try { await invoke('delete_file', { path: p }) } catch { /* */ }
    }
    const pathSet = new Set(paths)
    state.allImages = state.allImages.filter(img => !pathSet.has(img.path))
    for (const p of paths) state.selectedPaths.delete(p)
    // 从虚拟分组中移除
    for (const vg of state.virtualGroups) {
      vg.images = vg.images.filter(img => !pathSet.has(img.path))
    }
    state.virtualGroups = state.virtualGroups.filter(vg => vg.images.length > 0)
    // 清理空根路径
    state.loadedRootPaths = state.loadedRootPaths.filter(r => {
      const norm = r.replace(/\\/g, '/')
      return state.allImages.some(img => img.dir.replace(/\\/g, '/').startsWith(norm))
    })
  } finally {
    await setSuppressWatcher(false)
  }
}

/** 清除所有图片 */
/** 递归收集虚拟分组中所有图片及其相对路径（相对于分组名） */
function collectVGCopyFiles(vg: FolderNode, basePath: string): [string, string][] {
  const result: [string, string][] = []
  // 直接图片：放在 basePath 下
  for (const img of vg.images) {
    const fileName = img.name
    result.push([img.path, basePath ? `${basePath}/${fileName}` : fileName])
  }
  // 子节点：创建子目录
  for (const child of vg.children) {
    const childBase = basePath ? `${basePath}/${child.name}` : child.name
    result.push(...collectVGCopyFiles(child, childBase))
  }
  return result
}

/** 保存虚拟分组到指定文件夹 */
export async function saveVirtualGroup(vg: FolderNode): Promise<void> {
  try {
    const files = collectVGCopyFiles(vg, '')
    if (files.length === 0) {
      showToast('分组中没有图片')
      return
    }

    // 大量图片时确认
    if (files.length > 100) {
      const ok = await ask(
        `当前共 ${files.length} 张图片，数量较多，确定要保存到文件夹吗？`,
        { title: '保存确认', kind: 'warning' }
      )
      if (!ok) return
    }

    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择保存文件夹',
    })
    if (!selected) return

    const destDir = String(selected).replace(/\\/g, '/')

    await invoke('copy_files', { files, destDir })
    showToast(`已保存 ${files.length} 张图片到 ${destDir}`)
  } catch (e) {
    console.error('保存虚拟分组失败:', e)
    showToast(`保存失败: ${e}`)
  }
}

/** 获取选中图片总数（含选中文件夹节点下的所有图片） */
export function getTotalSelectedCount(): number {
  let count = state.selectedPaths.size
  if (state.selectedFolderPaths.size > 0) {
    const fullTree = buildFolderTree(state.allImages, state.loadedRootPaths)
    for (const fp of state.selectedFolderPaths) {
      const node = findSubTreeInTree(fullTree, fp)
      if (node) {
        count += countNodeImages(node)
      }
    }
  }
  return count
}

/** 递归统计节点及其子节点下的图片数 */
function countNodeImages(node: FolderNode): number {
  let n = node.images.length
  for (const child of node.children) {
    n += countNodeImages(child)
  }
  return n
}

/** 解析选中的文件夹节点为绝对路径列表（用于删除文件夹本身） */
export function collectSelectedFolderAbsolutePaths(): string[] {
  if (state.selectedFolderPaths.size === 0) return []
  const result: string[] = []
  const fullTree = buildFolderTree(state.allImages, state.loadedRootPaths)
  const roots = state.loadedRootPaths.map(r => r.replace(/\\/g, '/').replace(/\/$/, ''))
  for (const fp of state.selectedFolderPaths) {
    const node = findSubTreeInTree(fullTree, fp)
    if (!node) continue
    // 根节点：path 即为绝对路径
    if (roots.includes(node.path)) {
      result.push(node.path)
    } else {
      // 子节点：通过第一个图片的 dir 回溯到所属根，拼接相对路径
      const firstImg = node.images[0]
      if (firstImg) {
        const imgDir = firstImg.dir.replace(/\\/g, '/')
        const root = roots.find(r => imgDir === r || imgDir.startsWith(r + '/'))
        if (root) {
          result.push(root + '/' + node.path)
        }
      }
    }
  }
  return result
}

/** 递归收集节点下所有图片路径 */
function collectNodeImagePathsList(node: FolderNode): string[] {
  const result: string[] = node.images.map(img => img.path)
  for (const child of node.children) {
    result.push(...collectNodeImagePathsList(child))
  }
  return result
}

/** 删除选中内容（图片 + 文件夹），返回移除的图片路径列表 */
export async function deleteSelectedContents(): Promise<string[]> {
  const allRemoved: string[] = []

  // 1. 删除选中文件夹（整个目录到回收站）
  const folderPaths = collectSelectedFolderAbsolutePaths()
  if (folderPaths.length > 0) {
    await invoke('trash_paths', { paths: folderPaths })
    // 收集被删文件夹下的图片路径，用于清理 state
    const fullTree = buildFolderTree(state.allImages, state.loadedRootPaths)
    for (const fp of state.selectedFolderPaths) {
      const node = findSubTreeInTree(fullTree, fp)
      if (node) {
        allRemoved.push(...collectNodeImagePathsList(node))
      }
    }
  }

  // 2. 删除直接选中的图片（排除已在文件夹内的）
  if (state.selectedPaths.size > 0) {
    const folderImageSet = new Set(allRemoved)
    const standalonePaths = Array.from(state.selectedPaths).filter(p => !folderImageSet.has(p))
    if (standalonePaths.length > 0) {
      await setSuppressWatcher(true)
      try {
        for (const p of standalonePaths) {
          try { await invoke('delete_file', { path: p }) } catch { /* */ }
        }
      } finally {
        await setSuppressWatcher(false)
      }
      allRemoved.push(...standalonePaths)
    }
  }

  // 3. 清理 state
  const removedSet = new Set(allRemoved)
  state.allImages = state.allImages.filter(img => !removedSet.has(img.path))
  for (const p of removedSet) state.selectedPaths.delete(p)
  for (const vg of state.virtualGroups) {
    vg.images = vg.images.filter(img => !removedSet.has(img.path))
  }
  state.selectedFolderPaths.clear()
  // 清理空根路径
  state.loadedRootPaths = state.loadedRootPaths.filter(r => {
    const norm = r.replace(/\\/g, '/')
    return state.allImages.some(img => img.dir.replace(/\\/g, '/').startsWith(norm))
  })

  return allRemoved
}

/** 收集选中图片 + 选中文件夹下所有图片的路径集合（用于删除） */
export function collectAllSelectedPaths(): string[] {
  const paths = new Set(state.selectedPaths)
  if (state.selectedFolderPaths.size > 0) {
    const fullTree = buildFolderTree(state.allImages, state.loadedRootPaths)
    for (const fp of state.selectedFolderPaths) {
      const node = findSubTreeInTree(fullTree, fp)
      if (node) {
        collectNodeImagePathsInto(node, paths)
      }
    }
  }
  return Array.from(paths)
}

/** 递归收集节点下所有图片路径到 Set */
function collectNodeImagePathsInto(node: FolderNode, set: Set<string>) {
  for (const img of node.images) {
    set.add(img.path)
  }
  for (const child of node.children) {
    collectNodeImagePathsInto(child, set)
  }
}

/** 收集选中图片 + 选中文件夹下所有图片的 [sourcePath, relativePath] 列表（保留目录结构） */
function collectSelectedFiles(): [string, string][] {
  const result: [string, string][] = []
  const added = new Set<string>()
  const roots = state.loadedRootPaths.map(r => r.replace(/\\/g, '/').replace(/\/$/, ''))

  // 1. 选中的文件夹节点下的图片（保留子目录结构）
  if (state.selectedFolderPaths.size > 0) {
    const fullTree = buildFolderTree(state.allImages, state.loadedRootPaths)
    for (const fp of state.selectedFolderPaths) {
      const node = findSubTreeInTree(fullTree, fp)
      if (node) {
        // 判断是否为根节点
        const isRoot = roots.includes(node.path)
        // 根节点作为base → 文件直接放在目标根；子节点以自身名称作为子目录
        const basePath = isRoot ? '' : node.name
        const files = collectVGCopyFiles(node, basePath)
        for (const [src, rel] of files) {
          if (added.has(src)) continue
          added.add(src)
          result.push([src, rel])
        }
      }
    }
  }

  // 2. 直接选中的图片（保留相对于所属根的目录结构）
  for (const path of state.selectedPaths) {
    if (added.has(path)) continue
    added.add(path)
    const img = state.allImages.find(i => i.path === path)
    if (img) {
      const imgDir = img.dir.replace(/\\/g, '/')
      let relative = img.name
      for (const root of roots) {
        if (imgDir === root || imgDir.startsWith(root + '/')) {
          const relDir = imgDir === root ? '' : imgDir.substring(root.length + 1)
          relative = relDir ? `${relDir}/${img.name}` : img.name
          break
        }
      }
      result.push([path, relative])
    } else {
      result.push([path, path.split('/').pop() || path.split('\\').pop() || path])
    }
  }

  return result
}

/** 复制选中图片到目标文件夹 */
export async function copySelectedImages(): Promise<void> {
  const files = collectSelectedFiles()
  if (files.length === 0) return

  // 大量图片时确认
  const srcInfo = state.selectedFolderPaths.size > 0
    ? `（其中 ${state.selectedPaths.size} 张直接选中，${files.length - state.selectedPaths.size} 张来自选中的文件夹）`
    : ''
  if (files.length > 100) {
    const ok = await ask(
      `当前共 ${files.length} 张图片，数量较多，确定要复制吗？${srcInfo}`,
      { title: '复制确认', kind: 'warning' }
    )
    if (!ok) return
  }

  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择目标文件夹',
  })
  if (!selected) return

  const destDir = String(selected).replace(/\\/g, '/')
  await invoke('copy_files', { files, destDir })
  showToast(`已复制 ${files.length} 张图片到 ${destDir}`)
}

/** 移动选中图片到目标文件夹 */
export async function moveSelectedImages(): Promise<void> {
  const files = collectSelectedFiles()
  if (files.length === 0) return

  // 大量图片时确认
  const srcInfo = state.selectedFolderPaths.size > 0
    ? `（其中 ${state.selectedPaths.size} 张直接选中，${files.length - state.selectedPaths.size} 张来自选中的文件夹）`
    : ''
  if (files.length > 100) {
    const ok = await ask(
      `当前共 ${files.length} 张图片，数量较多，确定要移动吗？移动后原位置文件将被删除。${srcInfo}`,
      { title: '移动确认', kind: 'warning' }
    )
    if (!ok) return
  }

  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择目标文件夹',
  })
  if (!selected) return

  const destDir = String(selected).replace(/\\/g, '/')
  const movedPaths: string[] = await invoke('move_files', { files, destDir })

  // 从 state 中移除实际已移动的图片（后端会跳过同路径文件）
  const movedSet = new Set(movedPaths)
  state.allImages = state.allImages.filter(img => !movedSet.has(img.path))
  for (const p of movedSet) state.selectedPaths.delete(p)
  for (const vg of state.virtualGroups) {
    vg.images = vg.images.filter(img => !movedSet.has(img.path))
  }

  showToast(`已移动 ${movedPaths.length} 张图片到 ${destDir}`)
}

/** 将虚拟分组的图片按目录构建为树结构 */
export function buildVirtualGroupTree(images: ImageItem[]): FolderNode {
  // 按目录分组
  const dirMap = new Map<string, ImageItem[]>()
  for (const img of images) {
    const dir = img.dir.replace(/\\/g, '/')
    if (!dirMap.has(dir)) {
      dirMap.set(dir, [])
    }
    dirMap.get(dir)!.push(img)
  }

  const root: FolderNode = {
    path: `__virtual__${Date.now()}`,
    name: '',
    children: [],
    images: [],
    expanded: true,
  }

  for (const [dirPath, dirImages] of dirMap) {
    const parts = dirPath.split('/')
    const folderName = parts[parts.length - 1] || dirPath
    const child: FolderNode = {
      path: dirPath,
      name: folderName,
      children: [],
      images: dirImages.map(img => ({ ...img, loading: false })),
      expanded: true,
    }
    root.children.push(child)
  }

  return root
}

export function clearAll() {
  // 取消正在进行的扫描
  if (state.loading) { invoke('cancel_scan') }
  state.allImages = []
  state.loadedRootPaths = []
  state.folderTree = []
  state.selectedPaths.clear()
  state.selectedFolderPaths.clear()
  state.virtualGroups = []
  rootExclusions.clear()
}

/** 加载配置 */
export async function loadConfig(): Promise<void> {
  try {
    const cfg = await invoke<Partial<AppSettings>>('load_config')
    if (cfg && typeof cfg === 'object') {
      Object.assign(state.settings, cfg)
    }
  } catch {
    // 首次运行或文件不存在，使用默认配置
  }
}

/** 保存配置 */
export async function saveConfig(): Promise<void> {
  try {
    await invoke('save_config', { settings: { ...state.settings } })
  } catch (e) {
    console.error('保存配置失败:', e)
  }
}
