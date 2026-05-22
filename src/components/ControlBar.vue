<script setup lang="ts">
import { state } from '../stores/imageStore'

const emit = defineEmits<{
  openFolder: []
  openImages: []
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
  refresh: []
}>()
</script>

<template>
  <div class="control-bar">
    <div class="control-left">
      <!-- 打开文件夹 -->
      <button class="ctrl-btn" :title="$t('control.open_folder')" @click="emit('openFolder')">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span>{{ $t('control.open') }}</span>
      </button>
      <!-- 打开图片 -->
      <button class="ctrl-btn" :title="$t('control.open_images')" @click="emit('openImages')">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
        <span>{{ $t('control.images') }}</span>
      </button>

      <!-- 刷新 -->
      <button class="ctrl-btn refresh-btn" :class="{ 'has-update': state.refreshAvailable }" :title="$t('control.refresh')" @click="emit('refresh')">
        <span class="refresh-icon-wrap">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" class="refresh-icon">
            <path d="M23 4v6h-6" />
            <path d="M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          <span v-if="state.refreshAvailable" class="refresh-dot"></span>
        </span>
        <span>{{ $t('control.refresh') }}</span>
      </button>

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
      <span v-if="state.selectedPaths.size > 0" class="select-count">
        {{ $t('control.selected') }} {{ state.selectedPaths.size }}
      </span>
      <button
        v-if="state.selectedPaths.size > 0 && state.selectMode === 'select'"
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
        v-if="state.selectedPaths.size === 2 && state.selectMode === 'select'"
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

      <button
        v-if="state.selectedPaths.size > 0 && state.selectMode === 'select'"
        class="ctrl-btn delete-btn"
        title="删除所选图片"
        @click="emit('deleteSelection')"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        <span>删除</span>
      </button>

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
</style>
