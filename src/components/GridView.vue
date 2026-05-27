<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import type { ImageItem } from '../types'
import { state, getProcessedImages, releaseBase64, getLoadStats } from '../stores/imageStore'
import GridItem from './GridItem.vue'

const gridCtx = ref({ show: false, x: 0, y: 0 })
function handleGridCtxMenu(e: MouseEvent) {
  // 只响应空白区域（点击目标不是 GridItem 或其内部）
  const target = e.target as HTMLElement
  if (target.closest('.grid-item')) return
  e.preventDefault()
  gridCtx.value = { show: true, x: e.clientX, y: e.clientY }
}
function closeGridCtx() { gridCtx.value.show = false }
function switchToViewMode() { closeGridCtx(); state.selectMode = 'view'; state.selectedPaths.clear(); state.selectedFolderPaths.clear() }
function switchToSelectMode() { closeGridCtx(); state.selectMode = 'select' }

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

function handleSelect(item: ImageItem, ctrl: boolean) {
  emit('selectImage', item, ctrl)
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
    @contextmenu="handleGridCtxMenu"
  >
    <!-- 空白处右键菜单 -->
    <Teleport to="body">
      <div v-if="gridCtx.show" class="ctx-backdrop" @click="closeGridCtx"></div>
      <div v-if="gridCtx.show" class="ctx-menu" :style="{ left: gridCtx.x + 'px', top: gridCtx.y + 'px' }" @click.stop>
        <button v-if="state.selectMode === 'select'" class="ctx-menu-item" @click="switchToViewMode">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
          </svg>
          <span>查看模式</span>
        </button>
        <button v-else class="ctx-menu-item" @click="switchToSelectMode">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
          </svg>
          <span>选择模式</span>
        </button>
      </div>
    </Teleport>
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
.ctx-menu-item.active {
  background: rgba(100, 108, 255, 0.3);
  color: #aab0ff;
}
</style>
