import type { ImageItem } from '../types'
import { isVideoExt } from './media'

/**
 * 批量重命名规则解析与预览。
 *
 * 规则中可用的变量（花括号包裹）：
 *   {i}                序号（可写成 {i:3} 表示补零到 3 位）
 *   {origin}           原文件名（不含扩展名）
 *   {origin:/正则/}     用正则从原名中提取（有捕获组取第 1 组，否则取整个匹配）
 *   {origin:/正则/替换/} 用正则替换（$1 引用捕获组），如 {origin:/^\d+_//}
 *   {name}             同 {origin}
 *   {w} / {h}          图片宽 / 高（像素，未读取时为空）
 *   {ext}              扩展名（不含点）
 *   {size}             文件大小（1.2MB / 340KB）
 *   {mdate}            修改日期（默认 YYYYMMDD，可写 {mdate:YYYY-MM-DD}）
 *   {date}             今天日期（默认 YYYYMMDD，可写 {date:YYYY-MM-DD}）
 *   {n}                本次重命名文件总数
 *
 * 日期格式占位符：YYYY、YY、MM、M、DD、D、HH、H、mm、m、ss、s
 */

/** 变量定义（用于面板展示与插入） */
export const BATCH_RENAME_VARS = [
  { token: '{i}', key: 'i', labelKey: 'ext.batch_rename.var_i' },
  { token: '{origin}', key: 'origin', labelKey: 'ext.batch_rename.var_origin' },
  { token: '{w}', key: 'w', labelKey: 'ext.batch_rename.var_w' },
  { token: '{h}', key: 'h', labelKey: 'ext.batch_rename.var_h' },
  { token: '{ext}', key: 'ext', labelKey: 'ext.batch_rename.var_ext' },
  { token: '{size}', key: 'size', labelKey: 'ext.batch_rename.var_size' },
  { token: '{mdate}', key: 'mdate', labelKey: 'ext.batch_rename.var_mdate' },
  { token: '{date}', key: 'date', labelKey: 'ext.batch_rename.var_date' },
  { token: '{n}', key: 'n', labelKey: 'ext.batch_rename.var_n' },
] as const

/** 高级写法（用于面板展示与插入模板） */
export const BATCH_RENAME_ADVANCED = [
  {
    display: '{origin:/正则/}',
    insert: '{origin://}',
    /** 插入后光标位置（相对插入起点），置于两个斜杠之间便于直接输入正则 */
    cursorOffset: '{origin:/'.length,
    labelKey: 'ext.batch_rename.adv_extract',
  },
  {
    display: '{origin:/正则/替换/}',
    insert: '{origin:///}',
    cursorOffset: '{origin:/'.length,
    labelKey: 'ext.batch_rename.adv_replace',
  },
  {
    display: '{date:YYYY-MM-DD}',
    insert: '{date:YYYY-MM-DD}',
    cursorOffset: undefined,
    labelKey: 'ext.batch_rename.adv_date',
  },
  {
    display: '{mdate:YYYY-MM-DD_HH-mm-ss}',
    insert: '{mdate:YYYY-MM-DD_HH-mm-ss}',
    cursorOffset: undefined,
    labelKey: 'ext.batch_rename.adv_mdate',
  },
] as const

/** 新文件名（不含扩展名）的最大长度，超长截断避免超出文件系统限制 */
const MAX_STEM_LENGTH = 100

/** 默认日期格式（与原 {date} / {mdate} 行为一致） */
const DEFAULT_DATE_FORMAT = 'YYYYMMDD'

export interface BatchRenameOptions {
  /** 起始序号 */
  start: number
  /** 序号补零位数（0/1=不补零） */
  digits: number
}

/** 预览行错误类型（由界面按 i18n 翻译） */
export type BatchRenameErrorCode = 'empty' | 'duplicate' | 'exists' | 'bad_regex'

export interface BatchRenameRow {
  item: ImageItem
  /** 生成的新文件名（不含扩展名，已清洗非法字符） */
  name: string
  /** 该行的阻断性错误 */
  error?: BatchRenameErrorCode
  /** 非阻断提示：该行的正则未匹配到内容 */
  warnExtract?: boolean
}

export interface BatchRenamePlan {
  rows: BatchRenameRow[]
  /** 存在阻断性问题时不能执行 */
  hasError: boolean
  /** 可正常重命名的行数 */
  validCount: number
  /** 尺寸未读取（{w}/{h} 输出为空）的行数 */
  missingDims: number
  /** 规则中是否使用了宽高变量 */
  usesDims: boolean
  /** 正则未匹配（将输出空串）的行数 */
  extractMiss: number
}

/** 规则解析结果节点 */
export type BatchRenamePatternNode =
  | { kind: 'text'; value: string }
  | { kind: 'var'; key: string; arg?: string }
  | {
      kind: 'originRegex'
      source: string
      replacement?: string
      /** 惰性编译缓存（null 表示编译失败），整批复用避免逐文件重复编译 */
      regex?: RegExp | null
    }

/** 单次规则渲染结果 */
export interface PatternRenderResult {
  /** 展开后的文本（未做文件名清洗） */
  text: string
  /** 是否有正则未匹配（该变量输出为空） */
  missed: boolean
  /** 是否有非法正则 */
  badRegex: boolean
}

/** 取文件主名（不含扩展名） */
export function fileStem(item: ImageItem): string {
  const idx = item.name.lastIndexOf('.')
  return idx > 0 ? item.name.substring(0, idx) : item.name
}

/** 取扩展名（不含点） */
function fileExt(item: ImageItem): string {
  if (item.ext) return item.ext.replace(/^\./, '')
  const idx = item.name.lastIndexOf('.')
  return idx > 0 ? item.name.substring(idx + 1) : ''
}

/** 文件名安全清洗：非法字符替换为下划线，去掉末尾空格/点，避开 Windows 保留名 */
export function sanitizeFileStem(raw: string): string {
  let text = raw
  // 控制字符与 Windows 文件名非法字符
  text = text.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
  // 末尾的空格和点会被 Windows 静默丢弃
  text = text.replace(/[. ]+$/g, '')
  text = text.trim()
  // Windows 保留设备名
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(text)) {
    text = '_' + text
  }
  if (text.length > MAX_STEM_LENGTH) {
    text = text.substring(0, MAX_STEM_LENGTH).replace(/[. ]+$/g, '')
  }
  return text
}

function padNumber(value: number, digits: number): string {
  if (!digits || digits <= 1) return String(value)
  const text = String(Math.abs(value))
  return (value < 0 ? '-' : '') + text.padStart(digits, '0')
}

/** 文件大小：紧凑写法，适合放进文件名 */
export function formatSizeCompact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : 1
  return `${value.toFixed(digits)}${units[unit]}`
}

/** 按格式串格式化日期；支持 YYYY/YY/MM/M/DD/D/HH/H/mm/m/ss/s */
export function formatDatePattern(date: Date, format: string): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return format.replace(/YYYY|YY|MM|M|DD|D|HH|H|mm|m|ss|s/g, token => {
    switch (token) {
      case 'YYYY': return String(date.getFullYear())
      case 'YY': return pad(date.getFullYear() % 100)
      case 'MM': return pad(date.getMonth() + 1)
      case 'M': return String(date.getMonth() + 1)
      case 'DD': return pad(date.getDate())
      case 'D': return String(date.getDate())
      case 'HH': return pad(date.getHours())
      case 'H': return String(date.getHours())
      case 'mm': return pad(date.getMinutes())
      case 'm': return String(date.getMinutes())
      case 'ss': return pad(date.getSeconds())
      case 's': return String(date.getSeconds())
      default: return token
    }
  })
}

/** 解析 "YYYY-MM-DD HH:MM:SS"，失败返回 null */
function parseDateText(text: string): Date | null {
  const m = /(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(
    text || '',
  )
  if (!m) return null
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] || 0),
    Number(m[5] || 0),
    Number(m[6] || 0),
  )
}

/** 日期：取 YYYY-MM-DD 部分拼成 YYYYMMDD（保留供旧调用使用） */
export function formatDateCompact(dateText: string): string {
  const date = parseDateText(dateText)
  return date ? formatDatePattern(date, DEFAULT_DATE_FORMAT) : ''
}

/** 展开单个基础变量 */
function resolveVar(
  key: string,
  arg: string | undefined,
  item: ImageItem,
  index: number,
  opts: BatchRenameOptions,
  total: number,
): string {
  switch (key) {
    case 'i': {
      const digits = arg !== undefined && /^\d+$/.test(arg) ? Number(arg) : opts.digits
      return padNumber(opts.start + index, digits)
    }
    case 'origin':
    case 'name':
      return fileStem(item)
    case 'w':
      return item.width > 0 ? String(item.width) : ''
    case 'h':
      return item.height > 0 ? String(item.height) : ''
    case 'ext':
      return fileExt(item)
    case 'size':
      return formatSizeCompact(item.size_bytes)
    case 'mdate': {
      const date = parseDateText(item.modified)
      return date ? formatDatePattern(date, arg || DEFAULT_DATE_FORMAT) : ''
    }
    case 'date': {
      return formatDatePattern(new Date(), arg || DEFAULT_DATE_FORMAT)
    }
    case 'n':
      return String(total)
    default:
      return ''
  }
}

/** 匹配基础变量：{key} / {key:arg}（arg 中不允许出现花括号） */
const VAR_AT_RE = /^\{(i|origin|name|w|h|ext|size|mdate|date|n)(?::([^{}]*))?\}/

/**
 * 解析 `{origin:/正则/}`、`{origin:/正则/替换/}`（`{name:/.../}` 为同义写法）。
 * 正则与替换内容中可用 `\/` 表示斜杠；无匹配时该变量输出空串。
 */
function parseOriginRegexAt(
  pattern: string,
  start: number,
): { node: BatchRenamePatternNode; end: number } | null {
  const prefix = pattern.startsWith('{origin:/', start)
    ? '{origin:/'
    : pattern.startsWith('{name:/', start)
      ? '{name:/'
      : ''
  if (!prefix) return null
  let pos = start + prefix.length
  const sourceStart = pos
  let foundSlash = false
  while (pos < pattern.length) {
    const ch = pattern[pos]
    if (ch === '\\') {
      pos += 2
      continue
    }
    if (ch === '/') {
      foundSlash = true
      break
    }
    pos++
  }
  if (!foundSlash) return null
  const source = pattern.slice(sourceStart, pos)
  pos++ // 跳过结束斜杠
  if (pattern[pos] === '}') {
    return { node: { kind: 'originRegex', source }, end: pos + 1 }
  }
  // 替换模式：替换文本直到下一个未转义的斜杠
  const replStart = pos
  let replEnd = -1
  while (pos < pattern.length) {
    const ch = pattern[pos]
    if (ch === '\\') {
      pos += 2
      continue
    }
    if (ch === '/') {
      replEnd = pos
      break
    }
    pos++
  }
  if (replEnd < 0 || pattern[replEnd + 1] !== '}') return null
  // 替换文本中 `\/` 表示普通斜杠（可用来在文件名中输出斜杠，随后会被清洗为 _）
  const replacement = pattern.slice(replStart, replEnd).replace(/\\\//g, '/')
  return { node: { kind: 'originRegex', source, replacement }, end: replEnd + 2 }
}

/** 解析指定位置的变量节点；不是合法变量时返回 null（该文本原样保留） */
function parseNodeAt(
  pattern: string,
  start: number,
): { node: BatchRenamePatternNode; end: number } | null {
  const regexNode = parseOriginRegexAt(pattern, start)
  if (regexNode) return regexNode

  const m = VAR_AT_RE.exec(pattern.slice(start))
  if (!m) return null
  const key = m[1]
  const arg = m[2]
  if (arg !== undefined) {
    // {i:位数} 限定为数字；{date:格式} / {mdate:格式} 允许任意格式串；其余变量不接受参数
    if (key === 'i') {
      if (!/^\d+$/.test(arg)) return null
    } else if (key !== 'date' && key !== 'mdate') {
      return null
    }
  }
  return { node: { kind: 'var', key, arg }, end: start + m[0].length }
}

/** 把规则拆成文本与变量节点（导出的解析结果可复用于整批预览） */
export function parseBatchRenamePattern(pattern: string): BatchRenamePatternNode[] {
  const nodes: BatchRenamePatternNode[] = []
  let i = 0
  while (i < pattern.length) {
    const open = pattern.indexOf('{', i)
    if (open < 0) {
      nodes.push({ kind: 'text', value: pattern.slice(i) })
      break
    }
    if (open > i) nodes.push({ kind: 'text', value: pattern.slice(i, open) })
    const parsed = parseNodeAt(pattern, open)
    if (!parsed) {
      // 未识别的花括号原样保留，逐字符继续
      nodes.push({ kind: 'text', value: '{' })
      i = open + 1
      continue
    }
    nodes.push(parsed.node)
    i = parsed.end
  }
  return nodes
}

/** 用已解析的节点渲染单个文件（批量预览时复用解析结果） */
export function renderParsedPattern(
  nodes: BatchRenamePatternNode[],
  item: ImageItem,
  index: number,
  opts: BatchRenameOptions,
  total: number,
): PatternRenderResult {
  let text = ''
  let missed = false
  let badRegex = false
  for (const node of nodes) {
    if (node.kind === 'text') {
      text += node.value
      continue
    }
    if (node.kind === 'var') {
      text += resolveVar(node.key, node.arg, item, index, opts, total)
      continue
    }
    // origin 正则提取 / 替换
    const stem = fileStem(item)
    if (node.regex === undefined) {
      try {
        node.regex = new RegExp(node.source)
      } catch {
        node.regex = null
      }
    }
    if (node.regex === null) {
      badRegex = true
      continue
    }
    const re = node.regex
    if (node.replacement === undefined) {
      const m = re.exec(stem)
      if (!m) {
        missed = true
        continue
      }
      text += m.length > 1 && m[1] !== undefined ? m[1] : m[0]
    } else {
      if (!re.test(stem)) missed = true
      // 非全局正则：replace 只替换第一个匹配，与 test 共用同一实例不会互相影响
      text += stem.replace(re, node.replacement)
    }
  }
  return { text, missed, badRegex }
}

/** 按规则生成原始文件名（未清洗） */
export function renderBatchRenamePattern(
  pattern: string,
  item: ImageItem,
  index: number,
  opts: BatchRenameOptions,
  total: number,
): string {
  return renderParsedPattern(parseBatchRenamePattern(pattern), item, index, opts, total).text
}

/** 规则中是否使用了宽高变量 */
export function patternUsesDims(pattern: string): boolean {
  return parseBatchRenamePattern(pattern).some(
    node => node.kind === 'var' && (node.key === 'w' || node.key === 'h'),
  )
}

/** 目录规范化（小写、正斜杠） */
function normDir(dir: string): string {
  return dir.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
}

/**
 * 构建已加载文件的「目录 → 文件名集合」索引，用于预览时提示与现有文件重名。
 * 仅在打开面板时构建一次。
 */
export function buildExistingNameIndex(items: ImageItem[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  for (const item of items) {
    const dir = normDir(item.dir)
    let set = index.get(dir)
    if (!set) {
      set = new Set<string>()
      index.set(dir, set)
    }
    set.add(item.name.toLowerCase())
  }
  return index
}

/**
 * 生成批量重命名预览。
 * @param items 参与重命名的文件（顺序决定 {i} 序号）
 * @param pattern 命名规则
 * @param opts 起始序号 / 补零位数
 * @param existing 同目录已有文件名索引（可选，用于提示与现有文件重名）
 */
export function buildBatchRenamePlan(
  items: ImageItem[],
  pattern: string,
  opts: BatchRenameOptions,
  existing?: Map<string, Set<string>>,
): BatchRenamePlan {
  const usesDims = patternUsesDims(pattern)
  const nodes = parseBatchRenamePattern(pattern)
  const rows: BatchRenameRow[] = []
  let missingDims = 0
  let extractMiss = 0

  items.forEach((item, index) => {
    if (!pattern.trim()) {
      rows.push({ item, name: '', error: 'empty' })
      return
    }
    const detail = renderParsedPattern(nodes, item, index, opts, items.length)
    const name = sanitizeFileStem(detail.text)
    if (usesDims && (item.width <= 0 || item.height <= 0)) missingDims++
    if (detail.badRegex) {
      rows.push({ item, name: '', error: 'bad_regex' })
      return
    }
    const row: BatchRenameRow = { item, name, error: name ? undefined : 'empty' }
    if (detail.missed) {
      row.warnExtract = true
      extractMiss++
    }
    rows.push(row)
  })

  // 批内目标名重复（同一目录、忽略大小写）
  const seen = new Map<string, BatchRenameRow[]>()
  for (const row of rows) {
    if (!row.name) continue
    const key = `${normDir(row.item.dir)}|${row.name.toLowerCase()}`
    const list = seen.get(key)
    if (list) list.push(row)
    else seen.set(key, [row])
  }
  for (const list of seen.values()) {
    if (list.length > 1) {
      for (const row of list) row.error = 'duplicate'
    }
  }

  // 与未参与本次重命名的已有文件重名
  if (existing) {
    // 本次会改动的文件当前名（这些名字最终会空出来，供批内其他文件使用）
    const batchCurrentNames = new Map<string, Set<string>>()
    for (const row of rows) {
      const dir = normDir(row.item.dir)
      let set = batchCurrentNames.get(dir)
      if (!set) {
        set = new Set<string>()
        batchCurrentNames.set(dir, set)
      }
      set.add(row.item.name.toLowerCase())
    }
    for (const row of rows) {
      if (!row.name || row.error) continue
      const dir = normDir(row.item.dir)
      // 索引中保存的是完整文件名（含扩展名），这里按「新主名 + 原扩展名」比对
      const ext = fileExt(row.item)
      const fullLower = (ext ? `${row.name}.${ext}` : row.name).toLowerCase()
      const dirNames = existing.get(dir)
      if (dirNames?.has(fullLower) && !batchCurrentNames.get(dir)?.has(fullLower)) {
        row.error = 'exists'
      }
    }
  }

  const validCount = rows.filter(r => r.name && !r.error).length
  return {
    rows,
    hasError: rows.some(r => !!r.error) || rows.length === 0,
    validCount,
    missingDims,
    usesDims,
    extractMiss,
  }
}

/** 变量示例值（用第一张图片演示，帮助用户理解规则） */
export function buildVarSamples(
  items: ImageItem[],
  opts: BatchRenameOptions,
): Record<string, string> {
  const sample = items[0]
  const result: Record<string, string> = {}
  for (const v of BATCH_RENAME_VARS) {
    if (!sample) {
      result[v.key] = ''
      continue
    }
    result[v.key] = resolveVar(v.key, undefined, sample, 0, opts, items.length)
  }
  return result
}

/** 是否为视频（面板中用于显示提示/图标） */
export function isVideoItem(item: ImageItem): boolean {
  return isVideoExt(item.ext)
}
