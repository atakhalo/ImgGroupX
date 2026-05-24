<script setup lang="ts">
import type { ImageItem } from '../types'
import { state, loadImageBase64 } from '../stores/imageStore'
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

/** 可渲染为图片的支持格式 */
const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif',
  'tif', 'tiff', 'jxl', 'avif', 'svg', 'pcx', 'ico',
])

const props = defineProps<{
  item: ImageItem
  gridSize: number
  borderRadius: number
  isSelected?: boolean
}>()

const emit = defineEmits<{
  click: [item: ImageItem]
  select: [item: ImageItem, ctrl: boolean]
}>()

const isImage = computed(() => IMAGE_EXTENSIONS.has(props.item.ext))

const markLevel = computed(() => props.item.markLevel || 0)
const markColor = computed(() => {
  const lv = markLevel.value
  if (lv < 1 || lv > 5) return ''
  return state.settings.markColors[lv - 1] || ''
})
const markBadgeSize = computed(() => Math.max(12, Math.round(props.gridSize / 10)))
const markBadgeFontSize = computed(() => Math.max(7, Math.round(props.gridSize / 16)))

const elRef = ref<HTMLElement | null>(null)
const imgSrc = ref('')
const isLoaded = ref(false)
const hasError = ref(false)
const aspectRatio = computed(() => {
  if (props.item.width && props.item.height) {
    return props.item.width / props.item.height
  }
  return 1
})

const itemWidth = computed(() => {
  return Math.round(props.gridSize * aspectRatio.value)
})

let loadingPromise: Promise<string> | null = null
let visObserver: IntersectionObserver | null = null
let hasTriggered = false

async function doLoad() {
  if (!isImage.value) return // 非图片不加载
  if (hasError.value) return
  if (props.item.base64) {
    imgSrc.value = props.item.base64
    isLoaded.value = true
    return
  }
  if (props.item.loading) return
  isLoaded.value = false
  try {
    loadingPromise = loadImageBase64(props.item)
    const b64 = await loadingPromise
    if (props.item.base64 === undefined && b64) return
    imgSrc.value = b64
    isLoaded.value = true
  } catch (e) {
    hasError.value = true
    isLoaded.value = false
  } finally {
    loadingPromise = null
  }
}

onMounted(() => {
  // 使用 IntersectionObserver：进入视口才加载
  if (!elRef.value) return
  visObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && !hasTriggered) {
        hasTriggered = true
        doLoad()
        // 加载一次后断开观察
        visObserver?.disconnect()
        visObserver = null
      }
    },
    { rootMargin: '300px' } // 提前 300px 开始加载
  )
  visObserver.observe(elRef.value)
})

onUnmounted(() => {
  visObserver?.disconnect()
  imgSrc.value = ''
})

// 监听 base64 被外部填充（如批量预加载）
watch(() => props.item.base64, (val) => {
  if (val && !isLoaded.value) {
    imgSrc.value = val
    isLoaded.value = true
    hasError.value = false
  } else if (!val && imgSrc.value) {
    // base64 被释放，清空显示并等待下次进入视口
    imgSrc.value = ''
    isLoaded.value = false
    hasTriggered = false
    // 如果仍在视口内，立即重新加载
    doLoad()
  }
})

function handleClick(e: MouseEvent) {
  if (state.selectMode === 'select') {
    emit('select', props.item, e.ctrlKey || e.metaKey)
  } else {
    emit('click', props.item)
  }
}
</script>

<template>
  <div
    ref="elRef"
    class="grid-item"
    :class="{ selected: isSelected }"
    :style="{
      height: gridSize + 'px',
      width: itemWidth + 'px',
      borderRadius: borderRadius + 'px',
      outline: markLevel && markColor ? `2px solid ${markColor}` : '',
      outlineOffset: markLevel ? '2px' : '',
    }"
    @click="handleClick"
    @dblclick="state.selectMode === 'select' && emit('click', item)"
  >
    <div class="item-inner" :style="{ borderRadius: borderRadius + 'px' }">
      <!-- 非图片文件：仅显示文件名 -->
      <template v-if="!isImage">
        <div class="file-placeholder">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span class="file-name">{{ item.name }}</span>
        </div>
      </template>
      <!-- 图片文件 -->
      <template v-else>
        <!-- 加载中 / 等待进入视口 -->
        <div v-if="!isLoaded && !hasError" class="item-placeholder">
          <span v-if="item.loading" class="loading-spinner"></span>
        </div>
        <!-- 加载失败 -->
        <div v-if="hasError" class="item-placeholder item-error">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </div>
        <img
          v-if="imgSrc && !hasError"
          :src="imgSrc"
          :alt="item.name"
          class="item-img"
          :style="{
            borderRadius: borderRadius + 'px',
          }"
          @load="isLoaded = true"
          @error="hasError = true; isLoaded = false"
        />
        <div v-if="isLoaded" class="item-overlay">
          <span class="item-name">{{ item.name }}</span>
        </div>
      </template>
      <div v-if="isSelected" class="select-check">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="white">
          <circle cx="12" cy="12" r="10" fill="rgba(0,120,255,0.8)" />
          <path d="M9 12l2 2 4-4" stroke="white" stroke-width="2" fill="none" />
        </svg>
      </div>
      <!-- 标记等级徽标 -->
      <div v-if="markLevel && markColor" class="mark-badge" :style="{ backgroundColor: markColor, width: markBadgeSize + 'px', height: markBadgeSize + 'px' }">
        <span class="mark-badge-text" :style="{ fontSize: markBadgeFontSize + 'px' }">{{ markLevel }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid-item {
  flex-shrink: 0;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  position: relative;
}

.grid-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.grid-item.selected {
  box-shadow: 0 0 0 3px #0078ff;
}

.item-inner {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
  background: #2a2a3e;
}

.item-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #2a2a3e;
}

.file-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px;
  background: #2a2a3e;
  overflow: hidden;
}

.file-name {
  font-size: 11px;
  color: rgba(255,255,255,0.4);
  text-align: center;
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.3;
}

.item-error {
  background: #2a1a1a;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: #646cff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.item-img {
  width: 100%;
  height: 100%;
  display: block;
  transition: opacity 0.3s;
}

.item-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 4px 6px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
  opacity: 0;
  transition: opacity 0.2s;
}

.grid-item:hover .item-overlay {
  opacity: 1;
}

.item-name {
  color: white;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
}

.select-check {
  position: absolute;
  top: 6px;
  right: 6px;
}

.mark-badge {
  position: absolute;
  bottom: 0px;
  right: 0px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  opacity: 0.75;
}

.mark-badge-text {
  color: white;
  font-weight: 700;
  line-height: 1;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}
</style>
