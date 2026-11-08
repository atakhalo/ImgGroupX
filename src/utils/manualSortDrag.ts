/**
 * 手动排序拖拽（指针事件实现）。
 *
 * 该拖拽只在「手动排序模式」开启时启用：不使用 HTML5 drag & drop，
 * 因为 WebView2 会接管页面内的原生拖拽（可能触发窗口级「拖入文件」提示或禁止光标），
 * 也会与排序拖拽互相干扰。这里用 pointerdown/pointermove/pointerup
 * 自行绘制拖拽副本与插入位置指示线，并在首次拖动时把该分组标记为手动排序。
 */
import { onUnmounted, watch, type Ref } from 'vue'
import type { ImageItem } from '../types'
import { ensureManualSort, manualSortDragging, reorderManualSort } from '../stores/imageStore'

export interface ManualSortDragOptions {
  /** 承载网格项（.grid-item[data-path]）的容器 */
  container: Ref<HTMLElement | null>
  /** 当前是否允许拖拽（手动排序模式开启且属于可排序分组时） */
  enabled: () => boolean
  /** 当前分组的手动排序键 */
  sortKey: () => string | undefined
  /** 当前分组的完整图片列表（用于更新手动顺序） */
  images: () => ImageItem[]
}

/** 超过该像素位移才视为拖拽，避免影响点击/选择 */
const DRAG_THRESHOLD = 5
/** 距离滚动容器上下边缘多少像素开始自动滚动 */
const EDGE_SCROLL_MARGIN = 64
const EDGE_SCROLL_STEP = 14

interface DragState {
  itemEl: HTMLElement
  path: string
  startX: number
  startY: number
  started: boolean
  ghost: HTMLElement | null
  indicator: HTMLElement | null
  beforePath: string | null
  scrollEl: HTMLElement | null
}

export function useManualSortDrag(opts: ManualSortDragOptions) {
  let containerEl: HTMLElement | null = null
  let drag: DragState | null = null
  /** 拖拽结束后抑制紧随其后的 click，避免误触查看/选择 */
  let suppressClick = false
  let suppressTimer: ReturnType<typeof setTimeout> | null = null

  /** 判断格子是否属于当前容器（排除嵌套在内部的其他分组网格） */
  function isOwnItem(itemEl: HTMLElement): boolean {
    let cur: HTMLElement | null = itemEl.parentElement
    while (cur && cur !== containerEl) {
      if (
        cur.classList.contains('folder-content-grid') ||
        cur.classList.contains('grid-container')
      ) {
        return false
      }
      cur = cur.parentElement
    }
    return cur === containerEl
  }

  function getItems(exclude: HTMLElement): HTMLElement[] {
    if (!containerEl) return []
    return Array.from(containerEl.querySelectorAll<HTMLElement>('.grid-item[data-path]'))
      .filter(el => el !== exclude && isOwnItem(el))
  }

  /**
   * 按“阅读顺序”计算插入位置。
   * 返回：插入点之后的第一项索引（items.length 表示末尾）、用于定位指示线的锚点元素、锚点左侧还是右侧。
   */
  function computeInsertion(
    items: HTMLElement[],
    x: number,
    y: number
  ): { index: number; anchor: HTMLElement | null; after: boolean } {
    if (items.length === 0) return { index: 0, anchor: null, after: false }
    const rects = items.map(el => el.getBoundingClientRect())
    // 按行分组：flex-wrap 下同一行的 top 一致
    const rows: { top: number; bottom: number; indices: number[] }[] = []
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]
      const last = rows[rows.length - 1]
      if (last && Math.abs(r.top - last.top) < Math.max(4, r.height * 0.5)) {
        last.indices.push(i)
        last.bottom = Math.max(last.bottom, r.bottom)
      } else {
        rows.push({ top: r.top, bottom: r.bottom, indices: [i] })
      }
    }
    for (const row of rows) {
      if (y < row.top) {
        return { index: row.indices[0], anchor: items[row.indices[0]], after: false }
      }
      if (y <= row.bottom) {
        for (const i of row.indices) {
          const r = rects[i]
          if (x < r.left + r.width / 2) return { index: i, anchor: items[i], after: false }
        }
        // 落在本行右侧空白：插入到本行末尾之后
        const lastIdx = row.indices[row.indices.length - 1]
        return { index: lastIdx + 1, anchor: items[lastIdx], after: true }
      }
    }
    const lastIdx = items.length - 1
    return { index: items.length, anchor: items[lastIdx], after: true }
  }

  /** 向上查找可滚动祖先（网格本身通常不滚动，滚动发生在内容区/分组查看器） */
  function findScrollParent(el: HTMLElement): HTMLElement | null {
    let cur: HTMLElement | null = el.parentElement
    while (cur) {
      const style = getComputedStyle(cur)
      if (/(auto|scroll|overlay)/.test(style.overflowY) && cur.scrollHeight > cur.clientHeight) {
        return cur
      }
      cur = cur.parentElement
    }
    return null
  }

  function autoScroll(d: DragState, x: number, y: number) {
    const el = d.scrollEl
    if (!el) return
    const r = el.getBoundingClientRect()
    let delta = 0
    if (y < r.top + EDGE_SCROLL_MARGIN) delta = -EDGE_SCROLL_STEP
    else if (y > r.bottom - EDGE_SCROLL_MARGIN) delta = EDGE_SCROLL_STEP
    if (delta === 0) return
    const before = el.scrollTop
    el.scrollTop += delta
    // 滚动后网格位置变化，指示线需要重新定位
    if (el.scrollTop !== before) updateIndicator(d, x, y)
  }

  function updateIndicator(d: DragState, x: number, y: number) {
    const items = getItems(d.itemEl)
    const target = computeInsertion(items, x, y)
    d.beforePath = items[target.index]?.dataset.path ?? null
    const ind = d.indicator
    if (!ind) return
    const el = target.anchor ?? d.itemEl
    const rect = el.getBoundingClientRect()
    const gap = 4
    ind.style.display = 'block'
    ind.style.top = rect.top + 'px'
    ind.style.height = rect.height + 'px'
    ind.style.left = (target.after ? rect.right + gap : rect.left - gap) + 'px'
  }

  function moveGhost(d: DragState, x: number, y: number) {
    if (!d.ghost) return
    const dx = x - d.startX
    const dy = y - d.startY
    d.ghost.style.transform = `translate(${dx}px, ${dy}px) rotate(1.6deg)`
  }

  function beginDrag(d: DragState) {
    d.started = true
    // 第一次拖动某分组时，以当前排序建立该分组的手动顺序（即“标记”该分组）
    const key = opts.sortKey()
    if (key) ensureManualSort(key, opts.images())
    manualSortDragging.value = true
    document.body.classList.add('manual-sort-drag-active')
    const rect = d.itemEl.getBoundingClientRect()
    const ghost = d.itemEl.cloneNode(true) as HTMLElement
    ghost.removeAttribute('data-path')
    ghost.classList.add('manual-sort-ghost')
    ghost.style.cssText = [
      'position: fixed',
      `left: ${rect.left}px`,
      `top: ${rect.top}px`,
      `width: ${rect.width}px`,
      `height: ${rect.height}px`,
      'margin: 0',
      'pointer-events: none',
      'z-index: 100000',
      'opacity: 0.88',
      'transform-origin: center',
    ].join('; ')
    document.body.appendChild(ghost)
    d.ghost = ghost
    d.itemEl.classList.add('manual-sort-source')

    const indicator = document.createElement('div')
    indicator.className = 'manual-sort-indicator'
    document.body.appendChild(indicator)
    d.indicator = indicator
    d.scrollEl = findScrollParent(d.itemEl)
  }

  function cleanupDragNodes(d: DragState) {
    d.ghost?.remove()
    d.indicator?.remove()
    d.ghost = null
    d.indicator = null
    d.itemEl.classList.remove('manual-sort-source')
    document.body.classList.remove('manual-sort-drag-active')
    manualSortDragging.value = false
  }

  function addWindowListeners() {
    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
  }

  function removeWindowListeners() {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
  }

  function finishDrag(commit: boolean) {
    const d = drag
    drag = null
    removeWindowListeners()
    if (!d) return
    if (!d.started) return
    const beforePath = d.beforePath
    cleanupDragNodes(d)
    // 拦住拖拽结束后浏览器补发的 click（否则会打开大图/切换选择）
    suppressClick = true
    if (suppressTimer) clearTimeout(suppressTimer)
    suppressTimer = setTimeout(() => {
      suppressClick = false
      suppressTimer = null
    }, 0)
    if (commit) {
      const key = opts.sortKey()
      if (key) reorderManualSort(key, opts.images(), d.path, beforePath)
    }
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !opts.enabled() || !containerEl) return
    const target = e.target as HTMLElement | null
    const itemEl = target?.closest<HTMLElement>('.grid-item')
    if (!itemEl || !containerEl.contains(itemEl) || !isOwnItem(itemEl)) return
    // 右键菜单打开时不开始拖拽
    if (document.querySelector('.ctx-menu, .content-ctx-menu, .imctx-menu')) return
    const path = itemEl.dataset.path
    if (!path) return
    // 清掉上一次未正常结束的拖拽
    if (drag) finishDrag(false)
    drag = {
      itemEl,
      path,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
      ghost: null,
      indicator: null,
      beforePath: null,
      scrollEl: null,
    }
    addWindowListeners()
  }

  function onPointerMove(e: PointerEvent) {
    const d = drag
    if (!d) return
    if (!d.started) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return
      beginDrag(d)
    }
    // 阻止拖拽过程中的文本选择/原生拖拽
    e.preventDefault()
    moveGhost(d, e.clientX, e.clientY)
    updateIndicator(d, e.clientX, e.clientY)
    autoScroll(d, e.clientX, e.clientY)
  }

  function onPointerUp() {
    finishDrag(true)
  }

  function onPointerCancel() {
    finishDrag(false)
  }

  function onClickCapture(e: MouseEvent) {
    if (!suppressClick) return
    suppressClick = false
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
  }

  /**
   * 手动排序激活时禁止原生拖拽（排序由指针事件接管）；
   * 未激活时放行，保留把图片拖到浏览器/其他窗口的原生拖出能力。
   */
  function onDragStart(e: DragEvent) {
    if (opts.enabled()) e.preventDefault()
  }

  function bind(el: HTMLElement) {
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('click', onClickCapture, true)
    el.addEventListener('dragstart', onDragStart)
  }

  function unbind(el: HTMLElement) {
    el.removeEventListener('pointerdown', onPointerDown)
    el.removeEventListener('click', onClickCapture, true)
    el.removeEventListener('dragstart', onDragStart)
  }

  watch(opts.container, (el, oldEl) => {
    if (oldEl) unbind(oldEl)
    containerEl = el
    if (el) bind(el)
  }, { immediate: true, flush: 'post' })

  onUnmounted(() => {
    if (containerEl) unbind(containerEl)
    containerEl = null
    if (drag) finishDrag(false)
    if (suppressTimer) {
      clearTimeout(suppressTimer)
      suppressTimer = null
    }
  })
}
