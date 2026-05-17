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

/** 带缓存base64的图片项（前端使用） */
export interface ImageItem extends ImageInfo {
  /** base64缓存，按需加载 */
  base64?: string
  /** 加载状态 */
  loading: boolean
  /** 加载失败 */
  error?: string
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
  /** 界面语言 */
  language: 'zh' | 'en'
}
