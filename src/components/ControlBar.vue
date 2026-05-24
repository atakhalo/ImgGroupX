<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { state, getTotalSelectedCount } from '../stores/imageStore'

const emit = defineEmits<{
  toggleFolderGroup: []
  toggleGroupTitles: []
  collapseAll: []
  expandAll: []
  collapseLeaves: []
  clearAll: []
  createGroup: []
  compare: []
  deleteSelection: []
  viewMode: []
  selectMode: []
  moveSelection: []
  copySelection: []
}>()

const showOpMenu = ref(false)

const totalSelectedCount = computed(() => getTotalSelectedCount())

function toggleOpMenu() {
  showOpMenu.value = !showOpMenu.value
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
  if (!showOpMenu.value) return
  const target = e.target as HTMLElement
  if (!target.closest('.op-menu-container')) {
    showOpMenu.value = false
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
  <div class="control-bar">
    <div class="control-left">
      <!-- 目录分组切换 -->
      <button
        class="ctrl-btn"
        :class="{ active: state.folderGroup }"
        :title="state.folderGroup ? $t('control.toggle_compact') : $t('control.toggle_group')"
        @click="emit('toggleFolderGroup')"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z" />
          <path d="M3 9V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v1" />
        </svg>
        <span>{{ $t('control.group') }}</span>
      </button>

      <template v-if="state.folderGroup">
        <button
          class="ctrl-btn"
          :class="{ active: state.showGroupTitle }"
          :title="$t('control.toggle_titles')"
          @click="emit('toggleGroupTitles')"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <button class="ctrl-btn" :title="$t('control.collapse_all')" @click="emit('collapseAll')">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        <button class="ctrl-btn" :title="$t('control.expand_all')" @click="emit('expandAll')">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <button class="ctrl-btn" :title="$t('control.collapse_leaves')" @click="emit('collapseLeaves')">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3" />
            <path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" />
            <path d="M12 8v8" />
            <path d="M8 12h8" />
          </svg>
          <span>{{ $t('control.collapse_leaves') }}</span>
        </button>
        <button
          class="ctrl-btn"
          :class="{ active: state.settings.rainbowEnabled }"
          :title="$t('control.toggle_rainbow')"
          @click="state.settings.rainbowEnabled = !state.settings.rainbowEnabled"
        >
          <span class="rainbow-icon">🌈</span>
          <span>{{ $t('control.rainbow') }}</span>
        </button>
      </template>
    </div>

    <div class="control-center">
      <div class="mode-group">
        <button
          class="ctrl-btn mode-btn"
          :class="{ active: state.selectMode === 'view' }"
          @click="emit('viewMode')"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span>{{ $t('control.view') }}</span>
        </button>
        <button
          class="ctrl-btn mode-btn"
          :class="{ active: state.selectMode === 'select' }"
          @click="emit('selectMode')"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
          </svg>
          <span>{{ $t('control.select') }}</span>
        </button>
      </div>
    </div>

    <div class="control-right">
      <span v-if="state.selectedPaths.size > 0 || state.selectedFolderPaths.size > 0" class="select-count">
        {{ $t('control.selected') }} {{ totalSelectedCount }}
      </span>
      <button
        v-if="(state.selectedPaths.size > 0 || state.selectedFolderPaths.size > 0) && state.selectMode === 'select'"
        class="ctrl-btn"
        :title="$t('hint.create_group')"
        @click="emit('createGroup')"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span>{{ $t('control.new_group') }}</span>
      </button>

      <button
        v-if="state.selectedPaths.size === 2 && state.selectedFolderPaths.size === 0 && state.selectMode === 'select'"
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

      <div
        v-if="(state.selectedPaths.size > 0 || state.selectedFolderPaths.size > 0) && state.selectMode === 'select'"
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
          <!-- 大量图片警告 -->
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

      <button class="ctrl-btn" :title="$t('control.clear')" @click="emit('clearAll')">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        <span>{{ $t('control.clear') }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.control-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(30, 30, 50, 0.85);
  backdrop-filter: blur(12px);
  border-radius: 12px;
  padding: 6px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  gap: 8px;
}

.control-left,
.control-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.control-center {
  display: flex;
  align-items: center;
}

.ctrl-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.65);
  padding: 5px 10px;
  border-radius: 8px;
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

.rainbow-icon {
  font-size: 16px;
  line-height: 1;
}

.refresh-btn {
  position: relative;
}

.refresh-icon-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.refresh-icon {
  transition: transform 0.3s ease;
}

.refresh-btn:hover .refresh-icon {
  transform: rotate(90deg);
}

.refresh-dot {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 8px;
  height: 8px;
  background: #ff6b6b;
  border-radius: 50%;
  border: 2px solid rgba(30, 30, 58, 0.9);
  animation: pulse-dot 1.5s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.2); }
}

.refresh-btn.has-update {
  color: #ff6b6b;
}

.mode-group {
  display: flex;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  padding: 2px;
}

.mode-btn {
  border-radius: 6px;
}

.delete-btn:hover {
  background: rgba(255, 60, 60, 0.2) !important;
  color: #ff6b6b !important;
}

.select-count {
  color: #aab0ff;
  font-size: 12px;
  padding: 0 8px;
  white-space: nowrap;
}

/* 操作弹出菜单 */
.op-menu-container {
  position: relative;
}

.op-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 999;
}

.op-trigger-btn.active {
  background: rgba(100, 108, 255, 0.25);
  color: #aab0ff;
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
</style>
