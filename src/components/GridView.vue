<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ImageItem } from '../types'
import { state, getProcessedImages } from '../stores/imageStore'
import GridItem from './GridItem.vue'

const props = defineProps<{
  images: ImageItem[]
}>()

const emit = defineEmits<{
  viewImage: [item: ImageItem, scope: ImageItem[]]
  selectImage: [item: ImageItem, ctrl: boolean]
}>()

const containerRef = ref<HTMLElement | null>(null)

const processedImages = computed(() => {
  return getProcessedImages(props.images)
})

function handleClick(item: ImageItem) {
  emit('viewImage', item, processedImages.value)
}

function handleSelect(item: ImageItem, ctrl: boolean) {
  emit('selectImage', item, ctrl)
}

function isSelected(item: ImageItem): boolean {
  return state.selectedPaths.has(item.path)
}
</script>

<template>
  <div
    ref="containerRef"
    class="grid-container"
    :style="{
      gap: state.settings.gap + 'px',
      backgroundColor: state.settings.bgColor,
    }"
  >
    <div
      class="grid-inner"
      :style="{
        gap: state.settings.gap + 'px',
      }"
    >
      <GridItem
        v-for="item in processedImages"
        :key="item.path"
        :item="item"
        :gridSize="state.settings.gridSize"
        :borderRadius="state.settings.borderRadius"
        :isSelected="isSelected(item)"
        @click="handleClick"
        @select="handleSelect"
      />
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
</style>
