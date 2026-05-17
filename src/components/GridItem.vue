<script setup lang="ts">
import type { ImageItem } from '../types'
import { state, loadImageBase64 } from '../stores/imageStore'
import { ref, onMounted, onUnmounted, watch } from 'vue'

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

const elRef = ref<HTMLElement | null>(null)
const imgSrc = ref('')
const isLoaded = ref(false)
const hasError = ref(false)
const aspectRatio = ref(1)

let loadingPromise: Promise<string> | null = null
let visObserver: IntersectionObserver | null = null
let hasTriggered = false

async function doLoad() {
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
  if (props.item.width && props.item.height) {
    aspectRatio.value = props.item.width / props.item.height
  }

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
      width: gridSize + 'px',
      borderRadius: borderRadius + 'px',
    }"
    @click="handleClick"
    @dblclick="state.selectMode === 'select' && emit('click', item)"
  >
    <div class="item-inner" :style="{ borderRadius: borderRadius + 'px' }">
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
      <div v-if="isSelected" class="select-check">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="white">
          <circle cx="12" cy="12" r="10" fill="rgba(0,120,255,0.8)" />
          <path d="M9 12l2 2 4-4" stroke="white" stroke-width="2" fill="none" />
        </svg>
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
  outline: 3px solid #0078ff;
  outline-offset: -3px;
}

.item-inner {
  width: 100%;
  overflow: hidden;
  position: relative;
  background: #2a2a3e;
}

.item-placeholder {
  width: 100%;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #2a2a3e;
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
  display: block;
  object-fit: cover;
  aspect-ratio: auto;
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
</style>
