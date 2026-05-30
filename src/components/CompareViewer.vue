<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { ImageItem } from '../types'
import { state, loadImageBase64, showToast, applyFileChanges, setSuppressWatcher, PRIVACY_ICON_SRC, ensurePrivacyIcon } from '../stores/imageStore'
import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { matchShortcut } from '../utils/shortcuts'

const props = defineProps<{
  images: ImageItem[]
}>()

const emit = defineEmits<{
  close: []
}>()

// 共享状态
const splitRatio = ref(0.5)
const scale = ref(1)
const showBar = ref(false)
const panMode = ref(false)
const offset = ref({ x: 0, y: 0 })
const panStart = ref({ x: 0, y: 0 })
const isPanDragging = ref(false)

// 拖拽分割线
const isDraggingDivider = ref(false)
const dragCellEl = ref<HTMLElement | null>(null)

// 2图模式：原始全屏单对比
const isSinglePair = computed(() => props.images.length === 2)

// 文件名 & 坐标轴显隐
const showLabels = ref(true)
const showAxes = ref(true)
// 局部模式：共享单元级缩放/平移（不影响网格）
const localMode = ref(false)
const localScale = ref(1)
const localOffset = ref({ x: 0, y: 0 })
// 进入局部模式时冻结网格的变换矩阵
const frozenScale = ref(1)
const frozenOffset = ref({ x: 0, y: 0 })
// 视图模式：'right'=右三角(i<j) / 'left'=左三角(i>j) / 'matrix'=全矩阵
const viewMode = ref<'right' | 'left' | 'matrix'>('left')

// 类似 position:sticky 的坐标轴
// 列轴用下边缘贴网格上边缘，行轴用右边缘贴网格左边缘
const BASE_PAD = 16, TRI_PAD = 4, COL_H = 28, ROW_W = 80
// 多图时 wrap 左 padding 增大给行轴腾空间
const extraPad = computed(() => N.value >= 3 ? ROW_W : 0)
// 视图模式循环
const nextViewMode = () => {
  const cycle: ('right' | 'left' | 'matrix')[] = ['left', 'right', 'matrix']
  const idx = cycle.indexOf(viewMode.value)
  viewMode.value = cycle[(idx + 1) % 3]
}

// 切换模式时冻结/解冻网格变换，cell-img 的 transform 始终保留
watch(localMode, (isLocal) => {
  if (isLocal) {
    // 全局→局部：冻结当前网格变换，cell-img 已有 local 值保持不变
    frozenScale.value = scale.value
    frozenOffset.value = { ...offset.value }
  } else {
    // 局部→全局：网格恢复冻结值，cell-img 的 local 值保持不变
    scale.value = frozenScale.value
    offset.value = { ...frozenOffset.value }
  }
})
const LP = () => BASE_PAD + extraPad.value  // wrap padding-left
const RP = () => BASE_PAD                     // wrap padding-right
const TP = () => BASE_PAD                     // wrap padding-top
const BP = () => BASE_PAD                     // wrap padding-bottom
// 网格内容区左上角相对视口的位置（三角在 wrap 内，网格在三角内偏移 TRI_PAD）
const GX = () => LP() + TRI_PAD    // 网格左边缘
const GY = () => TP() + TRI_PAD    // 网格上边缘
// wrap 内容区尺寸
const Wc = () => window.innerWidth - LP() - RP()
const Hc = () => window.innerHeight - TP() - BP()

const stickyColStyle = computed(() => {
  const s = scale.value, ox = offset.value.x, oy = offset.value.y
  // 网格左上角完整视觉位置（含缩放中心偏移）
  const gridLeft = GX() + ox + (Wc() / 2) * (1 - s)
  const gridTop = GY() + oy + (Hc() / 2) * (1 - s)
  const gridBottom = gridTop + (Hc() - 8) * s
  // 列轴：水平用 gridLeft，垂直用 sticky/follow
  const followY = gridTop - COL_H
  const stickyY = 0  // 贴边时列轴上沿在视口顶部，完整显示
  const yOff = (gridTop < TP() && gridBottom >= TP()) ? stickyY : followY
  return {
    transform: `translate(${gridLeft}px, ${yOff}px) scaleX(${s})`,
    transformOrigin: 'left top',
  }
})

const stickyRowStyle = computed(() => {
  const s = scale.value, ox = offset.value.x, oy = offset.value.y
  const gridLeft = GX() + ox + (Wc() / 2) * (1 - s)
  const gridTop = GY() + oy + (Hc() / 2) * (1 - s)
  const gridRight = gridLeft + (Wc() - 8) * s
  // 行轴：水平用 sticky/follow，垂直用 gridTop
  const followX = gridLeft - ROW_W
  const stickyX = 0  // 贴边时行轴左沿在视口左边缘，紧贴
  const xOff = (gridLeft < LP() && gridRight >= LP()) ? stickyX : followX
  return {
    transform: `translate(${xOff}px, ${gridTop}px) scaleY(${s})`,
    transformOrigin: 'left top',
  }
})

// 单元格标签字号：图片越多字号越小
const cellLabelFontSize = computed(() => {
  const n = N.value
  if (n <= 3) return '10px'
  if (n >= 8) return '6px'
  return `${10 - (n - 3) * 0.8}px`
})

/** 可渲染为图片的支持格式 */
const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif',
  'tif', 'tiff', 'jxl', 'avif', 'svg', 'pcx', 'ico',
])

/** 检查是否因大小跳过而未加载 */
function isSkipped(item: { size_bytes: number }): boolean {
  const maxMB = state.settings.maxLoadSizeMB
  return maxMB > 0 && item.size_bytes > maxMB * 1024 * 1024 && !state.settings.loadSkippedOnView
}

// 对数据定义
interface PairData {
  i: number
  j: number
  left: ImageItem
  right: ImageItem
  leftSrc: string
  rightSrc: string
  leftIsImage: boolean
  rightIsImage: boolean
}

const pairDataList = ref<PairData[]>([])

// 根据模式过滤显示的配对
const displayPairs = computed(() => {
  const m = viewMode.value
  if (m === 'matrix') return pairDataList.value
  if (m === 'left') return pairDataList.value.filter(p => p.i > p.j)
  return pairDataList.value.filter(p => p.i < p.j) // right
})

const N = computed(() => props.images.length)

// 网格样式（单元格区域，坐标轴通过固定悬浮层实现）
const gridSize = computed(() => viewMode.value === 'matrix' ? N.value : Math.max(N.value - 1, 1))
const gridStyle = computed(() => {
  const n = gridSize.value
  if (n < 1) return {}
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(${n}, 1fr)`,
    gridTemplateRows: `repeat(${n}, 1fr)`,
    gap: '1px',
  }
})

// 整视图变换（缩放+平移）；局部模式时使用冻结值保持网格位置
const triangleStyle = computed(() => {
  const s = localMode.value ? frozenScale.value : scale.value
  const o = localMode.value ? frozenOffset.value : offset.value
  if (s === 1 && o.x === 0 && o.y === 0) return {}
  return {
    transform: `scale(${s}) translate(${o.x / s}px, ${o.y / s}px)`,
    transformOrigin: 'center center',
  }
})

function getCellGridStyle(i: number, j: number) {
  const m = viewMode.value
  if (m === 'matrix') return { gridRow: i + 1, gridColumn: j + 1 }
  if (m === 'left') return { gridRow: i, gridColumn: j + 1 }
  // right：gridRow = i+1, gridColumn = j
  return { gridRow: i + 1, gridColumn: j }
}

onMounted(async () => {
  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('mousemove', onDividerMove)
  document.addEventListener('mouseup', onDividerUp)
  document.addEventListener('mousemove', onPanMove)
  document.addEventListener('mouseup', onPanUp)

  // 预先确保隐私图标已加载
  if (state.settings.privacyMode) await ensurePrivacyIcon()

  // 并行加载所有图片对（三角：i<j；矩阵：全量 i,j，含对角线 i=j）
  const loadPromises: Promise<PairData>[] = []
  for (let i = 0; i < props.images.length; i++) {
    for (let j = 0; j < props.images.length; j++) {
      // 三角模式跳过 i>=j
      if (j <= i) continue
      const left = props.images[i]
      const right = props.images[j]
      loadPromises.push(
        (async () => {
          let leftSrc = '', rightSrc = ''
          if (state.settings.privacyMode) {
            leftSrc = PRIVACY_ICON_SRC
            rightSrc = PRIVACY_ICON_SRC
          } else {
            if (IMAGE_EXTENSIONS.has(left.ext)) {
              try { leftSrc = await loadImageBase64(left, state.settings.loadSkippedOnView) } catch { /* */ }
            }
            if (IMAGE_EXTENSIONS.has(right.ext)) {
              try { rightSrc = await loadImageBase64(right, state.settings.loadSkippedOnView) } catch { /* */ }
            }
          }
          return { i, j, left, right, leftSrc, rightSrc, leftIsImage: IMAGE_EXTENSIONS.has(left.ext), rightIsImage: IMAGE_EXTENSIONS.has(right.ext) } as PairData
        })()
      )
    }
  }
  const results = await Promise.all(loadPromises)
  pairDataList.value = results

  // 矩阵模式：补充对角线及 i>j 的配对（图片无需重新加载，已有缓存）
  if (props.images.length >= 3) {
    const extraPromises: Promise<PairData>[] = []
    for (let i = 0; i < props.images.length; i++) {
      for (let j = 0; j < props.images.length; j++) {
        // 跳过已加载的 i<j
        if (j > i) continue
        const left = props.images[i]  // 行索引对应左图
        const right = props.images[j] // 列索引对应右图
        extraPromises.push(
          (async () => {
            let leftSrc = '', rightSrc = ''
            if (state.settings.privacyMode) {
              leftSrc = PRIVACY_ICON_SRC
              rightSrc = PRIVACY_ICON_SRC
            } else {
              if (IMAGE_EXTENSIONS.has(left.ext)) {
                try { leftSrc = await loadImageBase64(left, state.settings.loadSkippedOnView) } catch { /* */ }
              }
              if (IMAGE_EXTENSIONS.has(right.ext)) {
                try { rightSrc = await loadImageBase64(right, state.settings.loadSkippedOnView) } catch { /* */ }
              }
            }
            return { i, j, left, right, leftSrc, rightSrc, leftIsImage: IMAGE_EXTENSIONS.has(left.ext), rightIsImage: IMAGE_EXTENSIONS.has(right.ext) } as PairData
          })()
        )
      }
    }
    const extra = await Promise.all(extraPromises)
    pairDataList.value.push(...extra)
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('mousemove', onDividerMove)
  document.removeEventListener('mouseup', onDividerUp)
  document.removeEventListener('mousemove', onPanMove)
  document.removeEventListener('mouseup', onPanUp)
})

function handleKeydown(e: KeyboardEvent) {
  if (matchShortcut(e, 'close')) emit('close')
  else if (matchShortcut(e, 'compare.zoomIn')) zoomIn()
  else if (matchShortcut(e, 'compare.zoomOut')) zoomOut()
}

function checkAutoPan() {
  const s = localMode.value ? localScale.value : scale.value
  if (s > 1 && state.settings.autoPan) panMode.value = true
}

function zoomIn() {
  if (localMode.value) {
    localScale.value = Math.min(10, localScale.value + 0.05)
  } else {
    scale.value = Math.min(10, scale.value + 0.05)
  }
  checkAutoPan()
}
function zoomOut() {
  if (localMode.value) {
    localScale.value = Math.max(0.1, localScale.value - 0.05)
  } else {
    scale.value = Math.max(0.1, scale.value - 0.05)
  }
}
function fitToWindow() {
  if (localMode.value) {
    localScale.value = 1; localOffset.value = { x: 0, y: 0 }
  } else {
    scale.value = 1; offset.value = { x: 0, y: 0 }
  }
  panMode.value = false
}

function handleWheel(e: WheelEvent) {
  e.preventDefault()
  const s = localMode.value ? localScale.value : scale.value
  const ns = Math.max(0.1, Math.min(10, s + (e.deltaY > 0 ? -0.05 : 0.05)))
  if (localMode.value) localScale.value = ns; else scale.value = ns
  checkAutoPan()
}

function handleClose() { emit('close') }

// 2图模式容器引用（用于分割线拖拽）
const spContainerRef = ref<HTMLElement | null>(null)

// 分割线拖拽（事件代理：通过 closest 找到对应的对比单元）
function onDividerMouseDown(e: MouseEvent) {
  const divider = e.currentTarget as HTMLElement
  const cell = divider.closest('.compare-cell') as HTMLElement | null
  if (cell) {
    e.preventDefault()
    e.stopPropagation()
    isDraggingDivider.value = true
    dragCellEl.value = cell
    return
  }
  // 2图模式：使用容器本身
  if (isSinglePair.value && spContainerRef.value) {
    e.preventDefault()
    e.stopPropagation()
    isDraggingDivider.value = true
    dragCellEl.value = spContainerRef.value
  }
}

function onDividerMove(e: MouseEvent) {
  if (!isDraggingDivider.value || !dragCellEl.value) return
  const rect = dragCellEl.value.getBoundingClientRect()
  splitRatio.value = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width))
}

function onDividerUp() {
  isDraggingDivider.value = false
  dragCellEl.value = null
}

// 平移拖拽
function onPanDown(e: MouseEvent) {
  if (!panMode.value) return
  isPanDragging.value = true
  const o = localMode.value ? localOffset.value : offset.value
  panStart.value = { x: e.clientX - o.x, y: e.clientY - o.y }
}

function onPanMove(e: MouseEvent) {
  if (!isPanDragging.value) return
  const val = { x: e.clientX - panStart.value.x, y: e.clientY - panStart.value.y }
  if (localMode.value) localOffset.value = val; else offset.value = val
}

function onPanUp() {
  isPanDragging.value = false
}

// 右键菜单
const ctx = ref<{ show: boolean; x: number; y: number; pair: PairData | null; simple?: boolean }>({ show: false, x: 0, y: 0, pair: null })

function openContextMenu(e: MouseEvent, pair: PairData) {
  e.preventDefault()
  e.stopPropagation()
  ctx.value = { show: true, x: e.clientX, y: e.clientY, pair }
}

/** 空白区域右键菜单（仅关闭） */
function openGlobalContextMenu(e: MouseEvent) {
  e.preventDefault()
  // 如果点击在单元格上则不处理（已被单元格自身的 handler 拦截）
  if ((e.target as HTMLElement).closest('.compare-cell')) return
  ctx.value = { show: true, x: e.clientX, y: e.clientY, pair: null, simple: true }
}

function closeCtx() { ctx.value.show = false; ctx.value.pair = null }

function handleCtxExit() { closeCtx(); emit('close') }

async function handleCtxCopyPath(item: ImageItem | null, label: string) {
  closeCtx()
  if (!item?.path) return
  try {
    await navigator.clipboard.writeText(item.path)
    showToast('已复制' + label + '路径')
  } catch { /* */ }
}

/** 将 data URI 的图片复制到剪贴板 */
async function copyImageFromSrc(src: string, label: string) {
  if (!src) { showToast(label + '尚未加载'); return }
  try {
    const comma = src.indexOf(',')
    const mime = src.slice(5, comma).match(/^(.*?);/)![1]
    const raw = atob(src.slice(comma + 1))
    const buf = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i)

    if (mime === 'image/png') {
      const blob = new Blob([buf], { type: 'image/png' })
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    } else {
      const blob = new Blob([buf], { type: mime })
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()
      const pngBlob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'))
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
    }
    showToast('已复制' + label)
  } catch { showToast('复制' + label + '失败') }
}

function handleCtxCopyLeftImage() { const p = ctx.value.pair; if (p) { closeCtx(); copyImageFromSrc(p.leftSrc, p.left.name + '(左)') } }
function handleCtxCopyRightImage() { const p = ctx.value.pair; if (p) { closeCtx(); copyImageFromSrc(p.rightSrc, p.right.name + '(右)') } }

async function saveImage(item: ImageItem | null, label: string) {
  if (!item) return
  try {
    const dest = await save({
      defaultPath: item.name,
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'] }],
    })
    if (!dest) return
    const destStr = String(dest).replace(/\\/g, '/')
    const lastSlash = destStr.lastIndexOf('/')
    const destDir = lastSlash >= 0 ? destStr.substring(0, lastSlash) : ''
    const fileName = lastSlash >= 0 ? destStr.substring(lastSlash + 1) : destStr
    await setSuppressWatcher(true)
    const created = await invoke<[string, string][]>('copy_files', { files: [[item.path, fileName]], destDir })
    await setSuppressWatcher(false)
    const createdPaths = created.map(([_, dest]) => dest)
    const roots = state.loadedRootPaths.map(r => r.replace(/[\\/]/g, '/').replace(/\/$/, ''))
    if (roots.some(r => destDir === r || destDir.startsWith(r + '/'))) {
      await applyFileChanges(createdPaths)
    }
    showToast('已保存' + label + '到 ' + destStr)
  } catch (e: any) {
    showToast('保存' + label + '失败: ' + (e.message || e))
  }
}

function handleCtxSaveLeft() { const p = ctx.value.pair; if (p) { closeCtx(); saveImage(p.left, p.left.name + '(左)') } }
function handleCtxSaveRight() { const p = ctx.value.pair; if (p) { closeCtx(); saveImage(p.right, p.right.name + '(右)') } }
</script>

<template>
  <div class="compare-viewer" :class="{ 'pan-active': panMode }" @mousedown="onPanDown" @wheel="handleWheel" @contextmenu.prevent="openGlobalContextMenu">
    <div class="compare-backdrop"></div>

    <!-- 2图：原始全屏单对比视图 -->
    <template v-if="isSinglePair && pairDataList[0]">
      <div class="sp-container" ref="spContainerRef" @contextmenu.prevent="isSinglePair && pairDataList[0] && openContextMenu($event, pairDataList[0])">
        <!-- 底层（右图） -->
        <div class="sp-layer sp-bottom" @click.self="handleClose">
          <img v-if="pairDataList[0].rightSrc" :src="pairDataList[0].rightSrc" class="sp-img"
            :style="{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }" />
          <div v-else-if="!pairDataList[0].rightIsImage || isSkipped(pairDataList[0].right)" class="sp-placeholder">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span class="sp-file-name">{{ pairDataList[0].right.name }}</span>
          </div>
          <div v-else class="sp-loading"><span class="loading-spinner"></span></div>
        </div>
        <!-- 顶层（左图，clip裁剪） -->
        <div class="sp-layer sp-top" :style="{ clipPath: `inset(0 ${(1 - splitRatio) * 100}% 0 0)` }" @click.self="handleClose">
          <img v-if="pairDataList[0].leftSrc" :src="pairDataList[0].leftSrc" class="sp-img"
            :style="{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }" />
          <div v-else-if="!pairDataList[0].leftIsImage || isSkipped(pairDataList[0].left)" class="sp-placeholder">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span class="sp-file-name">{{ pairDataList[0].left.name }}</span>
          </div>
          <div v-else class="sp-loading"><span class="loading-spinner"></span></div>
        </div>
        <!-- 分割线 -->
        <div class="sp-divider" :style="{ left: splitRatio * 100 + '%' }" @mousedown="onDividerMouseDown"></div>
        <!-- 标签 -->
        <div class="sp-label sp-label-left" :style="{ opacity: splitRatio > 0.1 ? 1 : 0 }">{{ pairDataList[0].left.name }}</div>
        <div class="sp-label sp-label-right" :style="{ opacity: splitRatio < 0.9 ? 1 : 0 }">{{ pairDataList[0].right.name }}</div>
      </div>
    </template>

    <!-- 3+图：三角网格对比 -->
    <template v-else>
      <div class="compare-triangle-wrap" :style="extraPad ? { paddingLeft: (16 + extraPad) + 'px' } : undefined" @click.self="handleClose">
        <div class="compare-triangle" :style="[gridStyle, triangleStyle]">
          <!-- 对比单元 -->
          <div
            v-for="(pair, idx) in displayPairs"
            :key="idx"
            class="compare-cell"
            :class="{ 'cell-diagonal': pair.i === pair.j }"
            :style="getCellGridStyle(pair.i, pair.j)"
            @contextmenu.prevent.stop="openContextMenu($event, pair)"
            @click.stop
          >
            <!-- 矩阵模式对角线留空 -->
            <template v-if="pair.i !== pair.j">
              <div class="cell-layer cell-bottom">
                <img v-if="pair.rightSrc" :src="pair.rightSrc" class="cell-img"
                  :style="{ transform: `translate(${localOffset.x}px, ${localOffset.y}px) scale(${localScale})` }" />
                <div v-else-if="!pair.rightIsImage || isSkipped(pair.right)" class="cell-placeholder">
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span class="cell-file-name">{{ pair.right.name }}</span>
                </div>
                <div v-else class="cell-loading"><span class="loading-spinner"></span></div>
              </div>
              <div class="cell-layer cell-top"
                :style="{ clipPath: `inset(0 ${(1 - splitRatio) * 100}% 0 0)` }">
                <img v-if="pair.leftSrc" :src="pair.leftSrc" class="cell-img"
                  :style="{ transform: `translate(${localOffset.x}px, ${localOffset.y}px) scale(${localScale})` }" />
                <div v-else-if="!pair.leftIsImage || isSkipped(pair.left)" class="cell-placeholder">
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span class="cell-file-name">{{ pair.left.name }}</span>
                </div>
                <div v-else class="cell-loading"><span class="loading-spinner"></span></div>
              </div>
              <div class="cell-divider" :style="{ left: splitRatio * 100 + '%' }" @mousedown="onDividerMouseDown"></div>
              <div v-if="showLabels" class="cell-label cell-label-left" :style="{ opacity: splitRatio > 0.1 ? 1 : 0, fontSize: cellLabelFontSize }">{{ pair.left.name }}</div>
              <div v-if="showLabels" class="cell-label cell-label-right" :style="{ opacity: splitRatio < 0.9 ? 1 : 0, fontSize: cellLabelFontSize }">{{ pair.right.name }}</div>
            </template>
          </div>
        </div>
      </div>
      <!-- Excel 冻结首行：列轴 -->
      <div v-if="showAxes" class="sticky-col-bar" :style="[stickyColStyle, { width: (Wc() - 8) + 'px' }]">
        <div v-for="ci in gridSize" :key="'sci-' + ci" class="sticky-col-item"
          :style="{ width: (100 / gridSize) + '%' }">
          <span :title="props.images[viewMode === 'right' ? ci : ci - 1].name"
            :style="{ transform: `scaleX(${1 / scale})`, transformOrigin: 'center center' }">{{ props.images[viewMode === 'right' ? ci : ci - 1].name }}</span>
        </div>
      </div>
      <!-- Excel 冻结首列：行轴 -->
      <div v-if="showAxes" class="sticky-row-bar" :style="[stickyRowStyle, { height: (Hc() - 8) + 'px' }]">
        <div v-for="rj in gridSize" :key="'sri-' + rj" class="sticky-row-item"
          :style="{ height: (100 / gridSize) + '%' }">
          <span :title="props.images[viewMode === 'left' ? rj : rj - 1].name"
            :style="{ transform: `scaleY(${1 / scale})`, transformOrigin: 'center center' }">{{ props.images[viewMode === 'left' ? rj : rj - 1].name }}</span>
        </div>
      </div>
    </template>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div v-if="ctx.show" class="ctx-backdrop" @click="closeCtx"></div>
      <div v-if="ctx.show" class="ctx-menu" :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }" @click.stop>
        <button class="ctx-menu-item" @click="handleCtxExit">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
          <span>{{ $t('viewer.close') }}</span>
        </button>
        <div class="ctx-separator"></div>
        <!-- 显隐开关（全局可用） -->
        <button class="ctx-menu-item" @click="showLabels = !showLabels; closeCtx()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
          </svg>
          <span style="margin-right:auto">文件名</span>
          <span :class="['ctx-toggle-dot', { on: showLabels }]"></span>
        </button>
        <button class="ctx-menu-item" @click="showAxes = !showAxes; closeCtx()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="4" y1="4" x2="4" y2="20"/><line x1="20" y1="4" x2="20" y2="20"/>
            <line x1="4" y1="4" x2="20" y2="4"/><line x1="4" y1="20" x2="20" y2="20"/>
          </svg>
          <span style="margin-right:auto">坐标轴</span>
          <span :class="['ctx-toggle-dot', { on: showAxes }]"></span>
        </button>
        <div class="ctx-separator"></div>
        <button class="ctx-menu-item" @click="localMode = !localMode; closeCtx()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/>
            <rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>
          </svg>
          <span style="margin-left:6px">局部模式</span>
          <span style="margin-left:auto" :class="['ctx-toggle-dot', { on: localMode }]"></span>
        </button>
        <div class="ctx-separator"></div>
        <button class="ctx-menu-item" @click="nextViewMode(); closeCtx()">
          <svg v-if="viewMode === 'right'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3L12 21l9 -18z"/>
          </svg>
          <svg v-else-if="viewMode === 'left'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 21L12 3l-9 18z"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>
          </svg>
          <span style="margin-left:6px">{{ viewMode === 'right' ? '右三角' : viewMode === 'left' ? '左三角' : '矩阵' }}</span>
        </button>
        <template v-if="ctx.pair">
          <div class="ctx-separator"></div>
          <button class="ctx-menu-item" @click="handleCtxCopyPath(ctx.pair!.left, '左图')">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            <span>复制左图路径</span>
          </button>
          <button class="ctx-menu-item" @click="handleCtxCopyPath(ctx.pair!.right, '右图')">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            <span>复制右图路径</span>
          </button>
          <div class="ctx-separator"></div>
          <button class="ctx-menu-item" @click="handleCtxCopyLeftImage">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
            </svg>
            <span>复制左图</span>
          </button>
          <button class="ctx-menu-item" @click="handleCtxCopyRightImage">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
            </svg>
            <span>复制右图</span>
          </button>
          <div class="ctx-separator"></div>
          <button class="ctx-menu-item" @click="handleCtxSaveLeft">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
            </svg>
            <span>左图另存为</span>
          </button>
          <button class="ctx-menu-item" @click="handleCtxSaveRight">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
            </svg>
            <span>右图另存为</span>
          </button>
        </template>
      </div>
    </Teleport>

    <!-- 底部悬浮操作栏 -->
    <div class="compare-bar-hotarea" @mouseenter="showBar = true" @mouseleave="showBar = false" @click.stop>
      <div class="compare-bar" :class="{ visible: showBar }">
        <button class="op-btn" :title="$t('image.fit_window')" @click="fitToWindow">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"/>
          </svg>
        </button>
        <button class="op-btn" :title="$t('image.zoom_in')" @click="zoomIn">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
        <button class="op-btn" :title="$t('image.zoom_out')" @click="zoomOut">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
        <button class="op-btn" :class="{ active: panMode }" :title="$t('image.pan')" @click="panMode = !panMode">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v20M2 12h20M5 5l14 14M19 5l-14 14"/>
          </svg>
        </button>
        <div class="op-sep"></div>
        <button class="op-btn" :class="{ active: showLabels }" :title="'文件名'" @click="showLabels = !showLabels">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
          </svg>
        </button>
        <button class="op-btn" :class="{ active: showAxes }" :title="'坐标轴'" @click="showAxes = !showAxes">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="4" y1="4" x2="4" y2="20"/><line x1="20" y1="4" x2="20" y2="20"/>
            <line x1="4" y1="4" x2="20" y2="4"/><line x1="4" y1="20" x2="20" y2="20"/>
          </svg>
        </button>
        <div class="op-sep"></div>
        <button class="op-btn" :class="{ active: localMode }" :title="'局部模式'" @click="localMode = !localMode">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/>
            <rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>
          </svg>
        </button>
        <div class="op-sep"></div>
        <!-- 视图切换：左三角→右三角→矩阵→... -->
        <button class="op-btn" :title="viewMode === 'right' ? '右三角' : viewMode === 'left' ? '左三角' : '矩阵'" @click="nextViewMode">
          <svg v-if="viewMode === 'right'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3L12 21l9 -18z"/>
          </svg>
          <svg v-else-if="viewMode === 'left'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 21L12 3l-9 18z"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>
          </svg>
        </button>
        <span class="zoom-text">{{ Math.round(scale * 100) }}%</span>
        <button class="op-btn close-btn" :title="$t('viewer.close') + ' (Esc)'" @click="emit('close')">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.compare-viewer {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 1000;
  overflow: hidden;
  cursor: default;
}

.compare-viewer.pan-active {
  cursor: grab;
}

.compare-backdrop {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.92);
  z-index: 1;
}

/* === 2图：全屏单对比视图 === */
.sp-container {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 2;
  overflow: hidden;
  cursor: default;
}

.sp-layer {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sp-bottom { z-index: 1; }
.sp-top { z-index: 2; }

.sp-img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
}

.sp-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px;
}

.sp-file-name {
  font-size: 14px;
  color: rgba(255,255,255,0.4);
  text-align: center;
  word-break: break-all;
}

.sp-loading { padding: 40px; }

.sp-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 3px;
  background: rgba(255, 255, 255, 0.5);
  z-index: 10;
  transform: translateX(-50%);
  cursor: ew-resize;
  transition: background 0.15s, width 0.15s;
}

.sp-divider:hover {
  background: rgba(255, 255, 255, 0.85);
  width: 5px;
}

.sp-label {
  position: absolute;
  top: 16px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  background: rgba(0, 0, 0, 0.5);
  padding: 4px 10px;
  border-radius: 4px;
  z-index: 3;
  transition: opacity 0.2s;
  pointer-events: none;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sp-label-left { left: 16px; }
.sp-label-right { right: 16px; }

/* === 3+图：三角网格 === */
.compare-triangle-wrap {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 16px;
  z-index: 2;
}

.compare-triangle {
  width: 100%;
  height: 100%;
  background: rgba(15, 15, 35, 0.95);
  border-radius: 8px;
  padding: 4px;
}

/* Excel 冻结首行首列 */
.sticky-col-bar {
  position: fixed;
  z-index: 15;
  top: 0; left: 0;
  height: 28px;
  display: flex;
  gap: 1px;
  pointer-events: none;
  overflow: hidden;
  background: rgba(20, 20, 45, 0.92);
  border-bottom: 1px solid rgba(255,255,255,0.08);
}

.sticky-row-bar {
  position: fixed;
  z-index: 15;
  top: 0; left: 0;
  width: 80px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  pointer-events: none;
  overflow: hidden;
  background: rgba(20, 20, 45, 0.92);
  border-right: 1px solid rgba(255,255,255,0.08);
}

.sticky-col-item {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0 2px 4px;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  line-height: 1.3;
  word-break: break-all;
}
.sticky-col-item:nth-child(odd) {
  background: rgba(30, 30, 60, 0.85);
}
.sticky-col-item:nth-child(even) {
  background: rgba(20, 20, 45, 0.85);
}

.sticky-row-item {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 1px 6px 1px 2px;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.55);
  font-size: 11px;
  line-height: 1.2;
  word-break: break-all;
}
.sticky-row-item:nth-child(odd) {
  background: rgba(30, 30, 60, 0.85);
}
.sticky-row-item:nth-child(even) {
  background: rgba(20, 20, 45, 0.85);
}

/* 单个对比单元 - 恢复指针事件 */
.compare-cell {
  position: relative;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  min-height: 40px;
  pointer-events: auto;
}

.cell-layer {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cell-bottom { z-index: 1; }
.cell-top { z-index: 2; }

.cell-img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
}

.cell-loading { padding: 20px; }

.cell-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 20px;
}

.cell-file-name {
  font-size: 11px;
  color: rgba(255,255,255,0.35);
  text-align: center;
  word-break: break-all;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 4px;
}

.loading-spinner {
  display: block;
  width: 24px; height: 24px;
  border: 2px solid rgba(255,255,255,0.2);
  border-top-color: #646cff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.cell-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: rgba(255, 255, 255, 0.5);
  z-index: 10;
  transform: translateX(-50%);
  cursor: ew-resize;
  transition: background 0.15s, width 0.15s;
}

.cell-divider:hover {
  background: rgba(255, 255, 255, 0.85);
  width: 4px;
}

/* 矩阵模式对角线单元格（留空） */
.cell-diagonal {
  background: rgba(0, 0, 0, 0.15) !important;
  border-color: rgba(255,255,255,0.03) !important;
}

.cell-label {
  position: absolute;
  top: 2px;
  font-size: 9px;
  color: rgba(255, 255, 255, 0.5);
  background: rgba(0, 0, 0, 0.45);
  padding: 1px 4px;
  border-radius: 2px;
  z-index: 3;
  transition: opacity 0.2s;
  pointer-events: none;
  max-width: 20%;
  overflow: hidden;
  word-break: break-all;
  line-height: 1.15;
}

.cell-label-left { left: 4px; }
.cell-label-right { right: 4px; }

/* 底部悬浮操作栏 */
.compare-bar-hotarea {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 100px;
  z-index: 10;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 16px;
  pointer-events: auto;
}

.compare-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(30, 30, 50, 0.85);
  backdrop-filter: blur(8px);
  border-radius: 12px;
  padding: 6px 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  opacity: 0;
  transition: opacity 0.2s ease;
}

.compare-bar.visible { opacity: 1; }

.op-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  padding: 6px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}

.op-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: white;
}

.op-btn.active {
  background: rgba(100, 108, 255, 0.25);
  color: #aab0ff;
}

.close-btn:hover {
  background: rgba(255, 60, 60, 0.3);
  color: #ff6b6b;
}

.zoom-text {
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  padding: 0 4px;
}

.op-sep {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.1);
  margin: 0 4px;
}

/* 右键菜单切换指示点 */
.ctx-toggle-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255,255,255,0.15);
  transition: background 0.15s;
}
.ctx-toggle-dot.on {
  background: #646cff;
}

/* 右键菜单 */
.ctx-backdrop {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 9998;
}
.ctx-menu {
  position: fixed;
  z-index: 9999;
  background: rgba(30, 30, 50, 0.95);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 4px;
  min-width: 120px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
.ctx-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
  white-space: nowrap;
  transition: background 0.12s;
}
.ctx-menu-item:hover {
  background: rgba(100, 108, 255, 0.2);
  color: white;
}
.ctx-separator {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 4px 8px;
}
</style>
