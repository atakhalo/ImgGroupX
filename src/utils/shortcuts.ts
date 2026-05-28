import { state } from '../stores/imageStore'

/** 所有可自定义的快捷键动作定义 */
export interface ShortcutDef {
  id: string
  /** 默认键位（KeyboardEvent.key 值） */
  defaultKey: string
  /** 替代键位（如主键 Shift+ 变体或辅助键） */
  altKeys?: string[]
  /** 作用范围 */
  scope: 'global' | 'grid' | 'viewer' | 'compare'
  /** 动作描述i18n key */
  labelKey: string
  /** 是否为只读说明（不可自定义，如滚轮操作） */
  readonly?: boolean
}

/** 快捷键定义列表 */
export const SHORTCUTS: ShortcutDef[] = [
  // 全局
  { id: 'close', defaultKey: 'Escape', scope: 'global', labelKey: 'shortcuts.close' },
  // 网格视图
  { id: 'grid.zoom', defaultKey: 'Ctrl+Wheel', scope: 'grid', labelKey: 'shortcuts.grid_zoom', readonly: true },
  { id: 'grid.shiftSelect', defaultKey: 'Shift+点击', scope: 'grid', labelKey: 'shortcuts.grid_shift_select', readonly: true },
  // 查看器
  { id: 'viewer.prev', defaultKey: 'ArrowLeft', scope: 'viewer', labelKey: 'shortcuts.viewer_prev' },
  { id: 'viewer.next', defaultKey: 'ArrowRight', scope: 'viewer', labelKey: 'shortcuts.viewer_next' },
  { id: 'viewer.zoomIn', defaultKey: '+', altKeys: ['='], scope: 'viewer', labelKey: 'shortcuts.viewer_zoom_in' },
  { id: 'viewer.zoomOut', defaultKey: '-', scope: 'viewer', labelKey: 'shortcuts.viewer_zoom_out' },
  { id: 'viewer.zoomWheel', defaultKey: 'Wheel', scope: 'viewer', labelKey: 'shortcuts.viewer_zoom_wheel', readonly: true },
  { id: 'viewer.delete', defaultKey: 'Delete', scope: 'viewer', labelKey: 'shortcuts.viewer_delete' },
  { id: 'viewer.mark0', defaultKey: '`', altKeys: ['0'], scope: 'viewer', labelKey: 'shortcuts.viewer_mark_0' },
  { id: 'viewer.mark1', defaultKey: '1', scope: 'viewer', labelKey: 'shortcuts.viewer_mark_1' },
  { id: 'viewer.mark2', defaultKey: '2', scope: 'viewer', labelKey: 'shortcuts.viewer_mark_2' },
  { id: 'viewer.mark3', defaultKey: '3', scope: 'viewer', labelKey: 'shortcuts.viewer_mark_3' },
  { id: 'viewer.mark4', defaultKey: '4', scope: 'viewer', labelKey: 'shortcuts.viewer_mark_4' },
  { id: 'viewer.mark5', defaultKey: '5', scope: 'viewer', labelKey: 'shortcuts.viewer_mark_5' },
  // 对比查看器
  { id: 'compare.close', defaultKey: 'Escape', scope: 'compare', labelKey: 'shortcuts.close' },
  { id: 'compare.zoomIn', defaultKey: '+', altKeys: ['='], scope: 'compare', labelKey: 'shortcuts.viewer_zoom_in' },
  { id: 'compare.zoomOut', defaultKey: '-', scope: 'compare', labelKey: 'shortcuts.viewer_zoom_out' },
  { id: 'compare.zoomWheel', defaultKey: 'Wheel', scope: 'compare', labelKey: 'shortcuts.viewer_zoom_wheel', readonly: true },
]

/** 获取当前有效按键绑定 */
function getBindings(): Record<string, string> {
  return state.settings.keyBindings || {}
}
function getAltBindings(): Record<string, string> {
  return state.settings.keyAltBindings || {}
}

/** 获取某个动作的实际主按键 */
export function getKey(actionId: string): string {
  const bindings = getBindings()
  if (bindings[actionId]) return bindings[actionId]
  const def = SHORTCUTS.find(s => s.id === actionId)
  return def?.defaultKey || ''
}

/** 获取某个动作的替代按键 */
export function getAltKey(actionId: string): string {
  const bindings = getAltBindings()
  if (bindings[actionId]) return bindings[actionId]
  const def = SHORTCUTS.find(s => s.id === actionId)
  return (def?.altKeys && def.altKeys[0]) || ''
}

/** 判断某个事件是否匹配指定动作（主键/替代键均匹配） */
export function matchShortcut(e: KeyboardEvent, actionId: string): boolean {
  const keys = new Set<string>()

  // 主键：自定义 > 默认
  const main = getKey(actionId)
  if (main) keys.add(main)

  // 替代键：自定义 > 默认
  const alt = getAltKey(actionId)
  if (alt) keys.add(alt)

  for (const key of keys) {
    if (!key) continue
    const parts = key.split('+')
    const mainKey = parts.pop()!
    if (e.key === mainKey || e.code === mainKey) return true
  }
  return false
}

/** 格式化按键显示 */
const KEY_MAP: Record<string, string> = {
  'Escape': 'Esc',
  'ArrowLeft': '←',
  'ArrowRight': '→',
  'Delete': 'Del',
  '`': '`',
  '0': '0',
}
export function formatKey(key: string): string {
  return KEY_MAP[key] || key
}

/** 获取默认主键绑定对象 */
export function getDefaultBindings(alt = false): Record<string, string> {
  const result: Record<string, string> = {}
  for (const s of SHORTCUTS) {
    if (s.readonly) continue
    if (alt) {
      result[s.id] = (s.altKeys && s.altKeys[0]) || ''
    } else {
      result[s.id] = s.defaultKey
    }
  }
  return result
}
