<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { MarkLevel } from '../types'
import { state, getTotalSelectedCount, setSelectedImagesMark, selectImagesByMark, deselectImagesByMark } from '../stores/imageStore'

const emit = defineEmits<{
  createGroup: []
  compare: []
  deleteSelection: []
  moveSelection: []
  copySelection: []
}>()

const showOpMenu = ref(false)
const showMarkMenu = ref(false)

const totalSelectedCount = computed(() => getTotalSelectedCount())

function toggleOpMenu() {
  showOpMenu.value = !showOpMenu.value
  showMarkMenu.value = false
}

function toggleMarkMenu() {
  showMarkMenu.value = !showMarkMenu.value
  showOpMenu.value = false
}

function handleMarkSelected(level: MarkLevel) {
  setSelectedImagesMark(level)
  showMarkMenu.value = false
}

function handleSelectByMark(level: MarkLevel) {
  selectImagesByMark(level)
  showMarkMenu.value = false
}

function handleDeselectByMark(level: MarkLevel) {
  deselectImagesByMark(level)
  showMarkMenu.value = false
}

function handleMove() {
  showOpMenu.value = false
  emit('moveSelection')
}

function handleCopy() {
  showOpMenu.value = false
  emit('copySelection')
}

function handleDelete() {
  showOpMenu.value = false
  emit('deleteSelection')
}

function closeOpMenu() {
  showOpMenu.value = false
}

function onDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (showOpMenu.value && !target.closest('.op-menu-container')) {
    showOpMenu.value = false
  }
  if (showMarkMenu.value && !target.closest('.op-menu-container')) {
    showMarkMenu.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick, true)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick, true)
})
</script>

<template>
  <div v-if="state.selectMode === 'select'" class="selection-bar">
    <!-- 已选计数 -->
    <span
      v-if="state.selectedPaths.size > 0 || state.selectedFolderPaths.size > 0"
      class="select-count"
    >
      {{ $t('control.selected') }} {{ totalSelectedCount }}
    </span>

    <!-- 新分组 -->
    <button
      v-if="state.selectedPaths.size > 0 || state.selectedFolderPaths.size > 0"
      class="ctrl-btn"
      :title="$t('hint.create_group')"
      @click="emit('createGroup')"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 5v14M5 12h14" />
      </svg>
      <span>{{ $t('control.new_group') }}</span>
    </button>

    <!-- 对比（2-8张） -->
    <button
      v-if="state.selectedPaths.size >= 2 && state.selectedPaths.size <= 8 && state.selectedFolderPaths.size === 0"
      class="ctrl-btn"
      :title="$t('control.compare')"
      @click="emit('compare')"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="7" height="18" rx="1" />
        <rect x="14" y="3" width="7" height="18" rx="1" />
        <line x1="10" y1="8" x2="14" y2="8" />
        <line x1="10" y1="12" x2="14" y2="12" />
      </svg>
      <span>{{ $t('control.compare') }}</span>
    </button>

    <!-- 全局全选/反选 -->
    <button
      class="ctrl-btn"
      :title="$t('folder.select_all')"
      @click="state.selectedPaths = new Set(state.allImages.map(i => i.path)); state.selectedFolderPaths.clear()"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <polyline points="9 12 12 15 17 8"/>
      </svg>
      <span>{{ $t('folder.select_all') }}</span>
    </button>
    <button
      class="ctrl-btn"
      :title="$t('folder.invert_selection')"
      @click="() => {
        const current = new Set(state.selectedPaths)
        state.selectedPaths.clear()
        for (const img of state.allImages) {
          if (!current.has(img.path)) state.selectedPaths.add(img.path)
        }
        state.selectedFolderPaths.clear()
      }"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <line x1="9" y1="12" x2="15" y2="12"/>
      </svg>
      <span>{{ $t('folder.invert_selection') }}</span>
    </button>

    <!-- 标记菜单 -->
    <div class="op-menu-container" @click.stop>
      <button
        class="ctrl-btn op-trigger-btn"
        :class="{ active: showMarkMenu }"
        :title="$t('control.mark_select')"
        @click="toggleMarkMenu"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        <span>{{ $t('control.mark_select') }}</span>
      </button>
      <div v-if="showMarkMenu" class="op-menu-backdrop" @click="showMarkMenu = false"></div>
      <div v-if="showMarkMenu" class="op-menu mark-menu-wide" @click.stop>
        <div v-for="lv in 5" :key="lv" class="mark-menu-row">
          <button
            class="mark-dot-btn"
            :style="{ backgroundColor: state.settings.markColors[lv - 1] || '#888' }"
            @click="handleMarkSelected(lv as MarkLevel)"
          >{{ lv }}</button>
          <button class="mark-action-btn" @click="handleSelectByMark(lv as MarkLevel)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {{ $t('control.mark_select_all') }}
          </button>
          <button class="mark-action-btn" @click="handleDeselectByMark(lv as MarkLevel)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
            {{ $t('control.mark_deselect') }}
          </button>
        </div>
        <div class="op-menu-divider"></div>
        <div class="mark-menu-row">
          <button class="mark-dot-btn mark-dot-none" @click="handleMarkSelected(0)">
            <span class="mark-dot-none-inner">✕</span>
          </button>
          <button class="mark-action-btn" @click="handleSelectByMark(0)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {{ $t('control.mark_select_all') }}
          </button>
          <button class="mark-action-btn" @click="handleDeselectByMark(0)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
            {{ $t('control.mark_deselect') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 操作菜单 -->
    <div
      v-if="state.selectedPaths.size > 0 || state.selectedFolderPaths.size > 0"
      class="op-menu-container"
      @click.stop
    >
      <button
        class="ctrl-btn op-trigger-btn"
        :class="{ active: showOpMenu }"
        :title="$t('control.operation_title')"
        @click="toggleOpMenu"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="19" r="1.5" />
        </svg>
        <span>{{ $t('control.operation') }}</span>
      </button>
      <div v-if="showOpMenu" class="op-menu-backdrop" @click="closeOpMenu"></div>
      <div v-if="showOpMenu" class="op-menu" @click.stop>
        <div v-if="totalSelectedCount > 100" class="op-menu-warning">
          ⚠ {{ $t('hint.large_selection_warning', { n: totalSelectedCount }) }}
        </div>
        <button class="op-menu-item" @click="handleMove">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
          <span>{{ $t('control.move') }}</span>
        </button>
        <button class="op-menu-item" @click="handleCopy">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <span>{{ $t('control.copy') }}</span>
        </button>
        <div class="op-menu-divider"></div>
        <button class="op-menu-item op-menu-delete" @click="handleDelete">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          <span>{{ $t('control.delete') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.selection-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgba(30, 30, 50, 0.75);
  backdrop-filter: blur(12px);
  border-radius: 10px;
  padding: 4px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.select-count {
  color: #aab0ff;
  font-size: 12px;
  padding: 0 8px;
  white-space: nowrap;
}

.ctrl-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.65);
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}

.ctrl-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.ctrl-btn.active {
  background: rgba(100, 108, 255, 0.2);
  color: #aab0ff;
}

.op-trigger-btn.active {
  background: rgba(100, 108, 255, 0.25);
  color: #aab0ff;
}

.op-menu-container {
  position: relative;
}

.op-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 999;
}

.op-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  background: rgba(35, 35, 60, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 6px;
  min-width: 180px;
  z-index: 1000;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(16px);
}

.op-menu-warning {
  padding: 10px 12px;
  margin: 2px 4px 6px;
  background: rgba(255, 180, 0, 0.15);
  border: 1px solid rgba(255, 180, 0, 0.3);
  border-radius: 8px;
  color: #ffd700;
  font-size: 12px;
  font-weight: 600;
  text-align: center;
  line-height: 1.4;
}

.op-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.75);
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.12s, color 0.12s;
}
.op-menu-item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: white;
}
.op-menu-item svg {
  flex-shrink: 0;
}

.op-menu-delete:hover {
  background: rgba(255, 60, 60, 0.2) !important;
  color: #ff6b6b !important;
}

.op-menu-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 4px 8px;
}

/* 标记菜单 */
.mark-menu-wide {
  min-width: 200px;
  padding: 8px;
}

.mark-menu-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px;
  border-radius: 6px;
  transition: background 0.12s;
}

.mark-menu-row:hover {
  background: rgba(255,255,255,0.04);
}

.mark-dot-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
  cursor: pointer;
  text-shadow: 0 1px 2px rgba(0,0,0,0.4);
  transition: transform 0.12s, box-shadow 0.12s;
}

.mark-dot-btn:hover {
  transform: scale(1.15);
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}

.mark-dot-none {
  background: rgba(255,255,255,0.12);
}

.mark-dot-none-inner {
  font-size: 13px;
  color: rgba(255,255,255,0.6);
  text-shadow: none;
}

.mark-action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.65);
  padding: 4px 8px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 11px;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  white-space: nowrap;
}

.mark-action-btn:hover {
  background: rgba(255,255,255,0.1);
  color: white;
  border-color: rgba(255,255,255,0.15);
}
</style>
