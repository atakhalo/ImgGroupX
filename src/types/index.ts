/** 图片信息（从Rust后端返回） */
export interface ImageInfo {
  path: string
  name: string
  dir: string
  ext: string
  size_bytes: number
  modified: string
  width: number
  height: number
}

/** 扫描结果 */
export interface ScanResult {
  images: ImageInfo[]
  total: number
  /** 扫描到的所有子目录（含空目录） */
  dirs: string[]
}

/** 标记等级：0 无标记，1-5 为标记等级 */
export type MarkLevel = 0 | 1 | 2 | 3 | 4 | 5

/** 带缓存base64的图片项（前端使用） */
export interface ImageItem extends ImageInfo {
  /** base64缓存，按需加载 */
  base64?: string
  /** 加载状态 */
  loading: boolean
  /** 加载失败 */
  error?: string
  /** 标记等级（1-5），0或无此字段表示未标记 */
  markLevel?: MarkLevel
  /** 网格视频缩略图（320 档，data URI） */
  thumb?: string
  /** 查看器/对比/壁纸缩略图（1280 档，data URI，按需加载） */
  preview?: string
  /** 视频缩略图加载失败 */
  thumbFailed?: boolean
  /** 视频时长（毫秒，仅大图/元信息按需读取） */
  durationMs?: number
}

/** 目录分组节点 */
export interface FolderNode {
  /** 节点路径（文件夹路径或虚拟分组ID） */
  path: string
  /** 节点名称 */
  name: string
  /** 子文件夹 */
  children: FolderNode[]
  /** 该文件夹下的图片 */
  images: ImageItem[]
  /** 是否展开 */
  expanded: boolean
  /** 是否为虚拟分组（非文件夹加载） */
  isVirtual?: boolean
  /** 是否仅为分组查看器临时创建（不显示在主视图，关闭查看器时移除） */
  temporary?: boolean
}

/** 视图模式 */
export type ViewMode = 'grid' | 'detail'

/** 选择模式 */
export type SelectMode = 'select' | 'view'

/** 排序方式 */
export type SortBy = 'name' | 'modified' | 'size'

/** 分组排序方式 */
export type GroupSortBy = 'name' | 'modified' | 'count'

/** 排序方向 */
export type SortOrder = 'asc' | 'desc'

/** 筛选目标 */
export type FilterTarget = 'name' | 'group' | 'path'

/** 大图查看器背景模式 */
export type ViewerBgMode = 'overlay' | 'color'

/** 封面预览-格子比例：目标比例 */
export type CoverRatio = '4:3' | '3:4' | '16:9' | '9:16' | '1:1'

/** 封面预览-格子比例：图片填充方式 */
export type CoverRatioFit = 'cover' | 'contain'

/** 导航列表条目类型 */
export interface NavigableEntry {
  images: ImageItem[]
  path: string
  displayPath: string
  scopeId: string
  groupName: string
}

/** 批量重命名规则预设 */
export interface BatchRenamePreset {
  /** 预设名称 */
  name: string
  /** 命名规则（可含变量，如 {i}_{origin}_{w}x{h}） */
  pattern: string
  /** 起始序号 */
  start: number
  /** 序号补零位数（0=不补零） */
  digits: number
  /** 是否包含子文件夹内图片 */
  includeSub: boolean
}

/** 应用设置 */
export interface AppSettings {
  /** 格子圆角 */
  borderRadius: number
  /** 格子间距 */
  gap: number
  /** 内容展示区域两侧空白边距（px） */
  contentMarginX: number
  /** 网格背景色 */
  bgColor: string
  /** 格子大小 */
  gridSize: number
  /** 是否启用目录分组 */
  folderGroup: boolean
  /** 是否显示分组标题 */
  showGroupTitle: boolean
  /** 筛选正则 */
  filterRegex: string
  /** 筛选目标：文件名或文件夹名 */
  filterTarget: FilterTarget
  /** 排序方式 */
  sortBy: SortBy
  /** 分组排序方式 */
  groupSortBy: GroupSortBy
  /** 排序方向 */
  sortOrder: SortOrder
  /** 分组排序方向 */
  groupSortOrder: SortOrder
  /** 筛选预设列表 */
  filterPresets: string[]
  /** 外部程序打开方式列表 */
  openWithPrograms: string[]
  /** 根节点标题颜色 */
  rootTitleColor: string
  /** 子节点标题颜色 */
  childTitleColor: string
  /** 根节点标题背景色 */
  rootTitleBgColor: string
  /** 子节点标题背景色 */
  childTitleBgColor: string
  /** 节点网格垂直间距 */
  nodeGridGapV: number
  /** 节点网格水平间距 */
  nodeGridGapH: number
  /** 紧凑模式（非根节点自适应宽度排列） */
  compactMode: boolean
  /** 根节点紧凑（紧凑模式时根节点和虚拟分组一级节点也参与） */
  rootCompactMode: boolean
  /** 标题栏紧凑（紧凑模式时隐藏打开/移动/复制/移除按钮） */
  compactHeader: boolean
  /** 层级压缩（隐藏只有一个子节点的中间节点，路径合并到子节点标题） */
  collapseHierarchy: boolean
  /** 彩虹层级着色开关 */
  rainbowEnabled: boolean
  /** 彩虹层级颜色列表 */
  rainbowColors: string[]
  /** 界面语言 */
  language: 'zh' | 'en'
  /** 大图查看器背景模式：'overlay' 蒙灰 | 'color' 纯色背景 */
  viewerBgMode: ViewerBgMode
  /** 大图查看器背景颜色（color 模式时使用） */
  viewerBgColor: string
  /** 扫描文件夹时是否包含所有文件（非图片仅显示文件名） */
  scanAllFiles: boolean
  /** 扫描文件夹时是否包含视频（显示 Shell 缩略图） */
  includeVideos: boolean
  /** 图片放大超过 100% 时自动开启平移模式 */
  autoPan: boolean
  /** 切换图片时自动居中 */
  autoCenter: boolean
  /** 标记颜色（5级标记对应5种颜色） */
  markColors: string[]
  /** 是否显示标记边框与角标 */
  showMarks: boolean
  /** 是否显示标记角标 */
  showMarkBadge: boolean
  /** 大图查看时是否按标记颜色显示图片边框 */
  showViewerMarkBorder: boolean
  /** 扫描文件夹时是否跳过空文件夹（勾选后空文件夹不创建为子节点） */
  skipEmptyFolders: boolean
  /** 图片加载大小阈值（MB），超过则跳过加载仅显示文件名，0=不限 */
  maxLoadSizeMB: number
  /** 大小跳过的图片在查看/对比时是否尝试加载 */
  loadSkippedOnView: boolean
  /** 自定义快捷键映射 */
  keyBindings: Record<string, string>
  /** 自定义替代键映射 */
  keyAltBindings: Record<string, string>
  /** 隐私模式：图片显示为占位图标，节点名匿名显示 */
  privacyMode: boolean
  /** 随机分组开关（开启后节点右键菜单显示「随机抽取为新分组」） */
  randomGroupEnabled: boolean
  /** 随机分组默认抽取文件数 */
  randomGroupCount: number
  /** 是否启用自定义回收站（删除时移动到指定文件夹而非系统回收站） */
  customTrashEnabled: boolean
  /** 自定义回收站文件夹路径 */
  customTrashPath: string

  // ===== 扩展：封面预览-格子比例 =====
  /** 是否启用格子比例（统一格子宽高比，按封面方式裁切预览） */
  coverRatioEnabled: boolean
  /** 格子比例：4:3 / 3:4 / 16:9 / 9:16 / 1:1 */
  coverRatio: CoverRatio
  /** 自动识别竖屏/横屏：竖图用竖版比例（3:4 / 9:16）、横图用横版比例（4:3 / 16:9） */
  coverRatioAutoOrient: boolean
  /** 图片填充方式 */
  coverRatioFit: CoverRatioFit

  // ===== 扩展：手动排序 =====
  /** 是否启用手动排序扩展（开启后分组背景右键菜单出现「手动排序」） */
  manualSortEnabled: boolean

  // ===== 扩展：批量重命名 =====
  /** 是否启用批量重命名扩展（开启后分组标题右键菜单出现「批量重命名」） */
  batchRenameEnabled: boolean
  /** 批量重命名规则预设列表 */
  batchRenamePresets: BatchRenamePreset[]
}
