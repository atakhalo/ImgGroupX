/** 可渲染为图片的格式（与 Rust 端 SUPPORTED_EXTENSIONS 保持一致） */
export const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif',
  'tif', 'tiff', 'jxl', 'avif', 'svg', 'pcx', 'ico',
])

/** 视频格式（缩略图由 Windows Shell 生成，与 Rust 端 VIDEO_EXTENSIONS 保持一致） */
export const VIDEO_EXTENSIONS = new Set([
  'mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'ts', 'm2ts',
  'mts', 'mpg', 'mpeg', '3gp', '3g2', 'ogv', 'rm', 'rmvb', 'asf', 'vob',
  'f4v', 'mxf',
])

export function isImageExt(ext?: string | null): boolean {
  return !!ext && IMAGE_EXTENSIONS.has(ext.toLowerCase())
}

export function isVideoExt(ext?: string | null): boolean {
  return !!ext && VIDEO_EXTENSIONS.has(ext.toLowerCase())
}

/** 文件对话框可选的图片扩展名 */
export const IMAGE_FILTER_EXTENSIONS = Array.from(IMAGE_EXTENSIONS)

/** 文件对话框可选的视频扩展名 */
export const VIDEO_FILTER_EXTENSIONS = Array.from(VIDEO_EXTENSIONS)

/** 文件对话框可选的媒体扩展名（图片 + 视频） */
export const MEDIA_FILTER_EXTENSIONS = [...IMAGE_FILTER_EXTENSIONS, ...VIDEO_FILTER_EXTENSIONS]

/** 时长格式化：小于 1 小时显示 mm:ss，否则 h:mm:ss */
export function formatDuration(ms?: number): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '--:--'
  const total = Math.floor(ms / 1000)
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
