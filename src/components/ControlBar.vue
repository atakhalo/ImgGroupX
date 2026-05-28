<script setup lang="ts">
import { ref } from 'vue'
import { state } from '../stores/imageStore'

const emit = defineEmits<{
  toggleFolderGroup: []
  toggleGroupTitles: []
  collapseAll: []
  expandAll: []
  collapseLeaves: []
  clearAll: []
  viewMode: []
  selectMode: []
}>()

/** 折叠菜单下拉状态 */
const showCollapseMenu = ref(false)
const collapseMenuPos = ref({ x: 0, y: 0 })
const collapseBtnRef = ref<HTMLElement | null>(null)

function toggleCollapseMenu() {
  if (!showCollapseMenu.value) {
    if (collapseBtnRef.value) {
      const rect = collapseBtnRef.value.getBoundingClientRect()
      collapseMenuPos.value = {
        x: Math.max(4, rect.left),
        y: Math.max(4, rect.top - 120),
      }
    }
  }
  showCollapseMenu.value = !showCollapseMenu.value
}

function closeCollapseMenu() {
  showCollapseMenu.value = false
}

function handleCollapseAll() {
  closeCollapseMenu()
  emit('collapseAll')
}

function handleExpandAll() {
  closeCollapseMenu()
  emit('expandAll')
}

function handleCollapseLeaves() {
  closeCollapseMenu()
  emit('collapseLeaves')
}
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

        <!-- 折叠菜单按钮 -->
        <div class="ctrl-dropdown">
          <button ref="collapseBtnRef" class="ctrl-btn" :class="{ active: showCollapseMenu }" :title="$t('control.collapse')" @click.stop="toggleCollapseMenu">
            <span>▼</span>
            <span>{{ $t('control.collapse') }}</span>
          </button>
          <Teleport to="body">
            <div v-if="showCollapseMenu" class="ctrl-backdrop" @click="closeCollapseMenu"></div>
            <div v-if="showCollapseMenu" class="ctrl-dropdown-menu" :style="{ left: collapseMenuPos.x + 'px', top: collapseMenuPos.y + 'px' }" @click.stop>
              <button class="ctrl-dropdown-item" @click="handleCollapseAll">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M9 18l6-6-6-6" />
                </svg>
                <span>{{ $t('control.collapse_all') }}</span>
              </button>
              <button class="ctrl-dropdown-item" @click="handleExpandAll">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M6 9l6 6 6-6" />
                </svg>
                <span>{{ $t('control.expand_all') }}</span>
              </button>
              <div class="ctrl-dropdown-separator"></div>
              <button class="ctrl-dropdown-item" @click="handleCollapseLeaves">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3" />
                  <path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" />
                  <path d="M12 8v8" />
                  <path d="M8 12h8" />
                </svg>
                <span>{{ $t('control.collapse_leaves') }}</span>
              </button>
            </div>
          </Teleport>
        </div>

        <!-- 紧凑模式开关 -->
        <button
          class="ctrl-btn"
          :class="{ active: state.settings.compactMode }"
          :title="$t('control.toggle_compact_mode')"
          @click="state.settings.compactMode = !state.settings.compactMode"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="12" y1="3" x2="12" y2="21" />
            <line x1="3" y1="12" x2="21" y2="12" />
          </svg>
          <span>{{ $t('control.compact') }}</span>
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
      <button
        class="ctrl-btn"
        :class="{ active: state.settings.showMarks }"
        :title="$t('control.toggle_marks')"
        @click="state.settings.showMarks = !state.settings.showMarks"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        <span>{{ $t('control.marks') }}</span>
      </button>
      <button
        class="ctrl-btn"
        :class="{ active: state.alwaysShowFileName }"
        :title="$t('control.toggle_filename')"
        @click="state.alwaysShowFileName = !state.alwaysShowFileName"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <line x1="3" y1="9" x2="21" y2="9"/>
          <line x1="9" y1="21" x2="9" y2="9"/>
        </svg>
        <span>{{ $t('control.filename') }}</span>
      </button>
    </div>

    <div class="control-right">
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

.ctrl-dropdown {
  position: relative;
}

.ctrl-backdrop {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 9998;
}

.ctrl-dropdown-menu {
  position: fixed;
  z-index: 9999;
  background: rgba(30, 30, 50, 0.95);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 4px;
  min-width: 130px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.ctrl-dropdown-item {
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
  font-size: 12px;
  white-space: nowrap;
  transition: background 0.12s;
}

.ctrl-dropdown-item:hover {
  background: rgba(100, 108, 255, 0.2);
  color: white;
}

.ctrl-dropdown-separator {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 4px 8px;
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
</style>
