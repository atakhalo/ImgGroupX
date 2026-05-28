<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import type { ImageItem } from '../types'
import { state, getProcessedImages, releaseBase64, getLoadStats } from '../stores/imageStore'
import GridItem from './GridItem.vue'

const props = defineProps<{
  images: ImageItem[]
  bgColor?: string
}>()

const emit = defineEmits<{
  viewImage: [item: ImageItem, scope: ImageItem[]]
  selectImage: [item: ImageItem, ctrl: boolean]
}>()

const sentinelRef = ref<HTMLElement | null>(null)

/** 初始 DOM 渲染上限 */
const INITIAL_LIMIT = 100
/** 每次增量 */
const LOAD_MORE = 50
const MIN_KEEP = 100

const displayLimit = ref(INITIAL_LIMIT)

const processedImages = computed(() => getProcessedImages(props.images))



/** 当前 DOM 中渲染的图片 */
const visibleImages = computed(() =>
  processedImages.value.slice(0, displayLimit.value)
)

const hasMore = computed(() => displayLimit.value < processedImages.value.length)

let sentinelObserver: IntersectionObserver | null = null

function setupSentinel() {
  if (!sentinelRef.value) return
  sentinelObserver?.disconnect()
  sentinelObserver = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting) {
      loadMore()
    }
  }, { rootMargin: '800px' })
  sentinelObserver.observe(sentinelRef.value)
}

function loadMore() {
  if (displayLimit.value < processedImages.value.length) {
    displayLimit.value = Math.min(
      displayLimit.value + LOAD_MORE,
      processedImages.value.length
    )
  }
}

/** 释放所有 base64（保留当前可见范围） */
function releaseAll() {
  displayLimit.value = Math.max(MIN_KEEP, Math.min(displayLimit.value, processedImages.value.length))
  const keepPaths = new Set(
    processedImages.value.slice(0, displayLimit.value + LOAD_MORE).map(i => i.path)
  )
  releaseBase64(keepPaths)
}

function handleClick(item: ImageItem) {
  emit('viewImage', item, processedImages.value)
}

function handleSelect(item: ImageItem, ctrl: boolean, shift: boolean) {
  if (shift && state.lastSelectedImagePath) {
    // 查找上次选中在当前列表中的索引
    const lastIdx = processedImages.value.findIndex(i => i.path === state.lastSelectedImagePath)
    if (lastIdx < 0) {
      // 上次选中的不在当前列表（跨节点），只选当前图片并更新锚点
      emit('selectImage', item, ctrl)
      state.lastSelectedImagePath = item.path
      return
    }
    const currentIdx = processedImages.value.findIndex(i => i.path === item.path)
    if (currentIdx >= 0) {
      const start = Math.min(lastIdx, currentIdx)
      const end = Math.max(lastIdx, currentIdx)
      const isSelecting = !state.selectedPaths.has(item.path)
      for (let i = start; i <= end; i++) {
        const p = processedImages.value[i].path
        if (isSelecting) state.selectedPaths.add(p)
        else state.selectedPaths.delete(p)
      }
    }
    state.lastSelectedImagePath = item.path
  } else {
    emit('selectImage', item, ctrl)
    state.lastSelectedImagePath = item.path
  }
}

function isSelected(item: ImageItem): boolean {
  return state.selectedPaths.has(item.path)
}

defineExpose({ releaseAll, loadMore, getLoadStats: () => getLoadStats() })

onMounted(() => {
  nextTick(() => setupSentinel())
})

onUnmounted(() => {
  sentinelObserver?.disconnect()
})

watch(() => props.images, () => {
  displayLimit.value = INITIAL_LIMIT
  nextTick(() => setupSentinel())
}, { deep: false })
</script>

<template>
  <div
    class="grid-container"
    :style="{
      gap: state.settings.gap + 'px',
      backgroundColor: props.bgColor || state.settings.bgColor,
    }"
  >
    <div
      class="grid-inner"
      :style="{
        gap: state.settings.gap + 'px',
      }"
    >
      <GridItem
        v-for="item in visibleImages"
        :key="item.path"
        :item="item"
        :gridSize="state.settings.gridSize"
        :borderRadius="state.settings.borderRadius"
        :isSelected="isSelected(item)"
        @click="handleClick"
        @select="handleSelect"
      />

      <!-- 加载哨兵 -->
      <div
        v-if="hasMore"
        ref="sentinelRef"
        class="load-sentinel"
      >
        <span class="load-more-hint">
          {{ $t('hint.display_limit', { shown: displayLimit, total: processedImages.length }) }}
        </span>
      </div>
    </div>
    <div v-if="processedImages.length === 0 && !state.loading" class="empty-hint">
      <p>{{ $t('empty.no_results') }}</p>
    </div>
  </div>
</template>

<style scoped>
.grid-container {
  width: 100%;
  min-height: 100%;
  padding: 8px;
  overflow-y: auto;
  display: flex;
  justify-content: center;
}

.grid-inner {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  justify-content: center;
  max-width: 100%;
}

.empty-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 60px;
  color: rgba(255, 255, 255, 0.25);
  font-size: 14px;
  user-select: none;
}

.load-sentinel {
  width: 100%;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.load-more-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.25);
  user-select: none;
}
</style>
