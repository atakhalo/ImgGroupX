import type { CoverRatio } from '../types'

/** 各比例选项对应的宽高比（宽/高） */
export const COVER_RATIO_ASPECT: Record<CoverRatio, number> = {
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
}

/** 比例家族：[竖版比例, 横版比例]，自动识别横竖屏时在同一家族内切换 */
export const COVER_RATIO_FAMILY: Record<CoverRatio, [CoverRatio, CoverRatio]> = {
  '4:3': ['3:4', '4:3'],
  '3:4': ['3:4', '4:3'],
  '16:9': ['9:16', '16:9'],
  '9:16': ['9:16', '16:9'],
  '1:1': ['1:1', '1:1'],
}

/** 设置面板中的比例选项顺序 */
export const COVER_RATIO_ORDER: CoverRatio[] = ['4:3', '3:4', '16:9', '9:16', '1:1']
