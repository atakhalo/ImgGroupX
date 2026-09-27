/**
 * 全局共享的 IntersectionObserver。
 * 每个 GridItem 各建一个 observer，在数万张图片时创建开销明显，这里合并为一个：
 * 元素进入视口（含 300px 预加载边距）后回调一次并自动取消观察。
 */
type LazyCallback = () => void

const callbacks = new WeakMap<Element, LazyCallback>()
let sharedObserver: IntersectionObserver | null = null

function ensureObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const cb = callbacks.get(entry.target)
          if (!cb) continue
          callbacks.delete(entry.target)
          sharedObserver?.unobserve(entry.target)
          cb()
        }
      },
      { rootMargin: '300px' }
    )
  }
  return sharedObserver
}

/** 元素进入视口后回调一次；不支持 IntersectionObserver 时立即回调 */
export function observeOnce(el: Element, cb: LazyCallback): void {
  const observer = ensureObserver()
  if (!observer) {
    cb()
    return
  }
  callbacks.set(el, cb)
  observer.observe(el)
}

/** 停止观察（组件卸载时调用） */
export function unobserveElement(el: Element | null): void {
  if (!el) return
  callbacks.delete(el)
  sharedObserver?.unobserve(el)
}

/**
 * 持续观察元素的可见性（含 600px 预加载边距），进入/离开时都回调。
 * 用于"分组是否出现在视口附近"这类需要长期跟随的判断。
 */
type VisibilityCallback = (visible: boolean) => void

const visibilityCallbacks = new WeakMap<Element, VisibilityCallback>()
let sharedVisibilityObserver: IntersectionObserver | null = null

function ensureVisibilityObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null
  if (!sharedVisibilityObserver) {
    sharedVisibilityObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visibilityCallbacks.get(entry.target)?.(entry.isIntersecting)
        }
      },
      { rootMargin: '600px' }
    )
  }
  return sharedVisibilityObserver
}

/** 观察元素可见性；不支持 IntersectionObserver 时按"始终可见"处理 */
export function observeVisibility(el: Element, cb: VisibilityCallback): void {
  const observer = ensureVisibilityObserver()
  if (!observer) {
    cb(true)
    return
  }
  visibilityCallbacks.set(el, cb)
  observer.observe(el)
}

/** 停止可见性观察 */
export function unobserveVisibility(el: Element | null): void {
  if (!el) return
  visibilityCallbacks.delete(el)
  sharedVisibilityObserver?.unobserve(el)
}
