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
