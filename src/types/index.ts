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
}

/** 视图模式 */
export type ViewMode = 'grid' | 'detail'

/** 选择模式 */
export type SelectMode = 'select' | 'view'

/** 排序方式 */
export type SortBy = 'name' | 'modified' | 'size'

/** 排序方向 */
export type SortOrder = 'asc' | 'desc'

/** 筛选目标 */
export type FilterTarget = 'name' | 'group' | 'path'

/** 大图查看器背景模式 */
export type ViewerBgMode = 'overlay' | 'color'

/** 应用设置 */
export interface AppSettings {
  /** 格子圆角 */
  borderRadius: number
  /** 格子间距 */
  gap: number
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
  /** 排序方向 */
  sortOrder: SortOrder
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
  /** 图片加载大小阈值（MB），超过则跳过加载仅显示文件名，0=不限 */
  maxLoadSizeMB: number
  /** 大小跳过的图片在查看/对比时是否尝试加载 */
  loadSkippedOnView: boolean
  /** 自定义快捷键映射 */
  keyBindings: Record<string, string>
  /** 自定义替代键映射 */
  keyAltBindings: Record<string, string>
}
