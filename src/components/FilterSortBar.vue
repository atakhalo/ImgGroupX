<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { state } from '../stores/imageStore'
import type { SortBy } from '../types'

const regexInput = ref(state.settings.filterRegex)
const showPresets = ref(false)
const presetsRef = ref<HTMLElement | null>(null)

function applyFilter() {
  state.settings.filterRegex = regexInput.value
}

function clearFilter() {
  regexInput.value = ''
  state.settings.filterRegex = ''
}

function usePreset(pattern: string) {
  regexInput.value = pattern
  state.settings.filterRegex = pattern
  showPresets.value = false
}

function setSortBy(by: SortBy) {
  state.settings.sortBy = by
}

function toggleOrder() {
  state.settings.sortOrder = state.settings.sortOrder === 'asc' ? 'desc' : 'asc'
}

import { t } from '../i18n'

const filterTargetOrder: Array<'name' | 'group' | 'path'> = ['name', 'group', 'path']

function toggleFilterTarget() {
  const idx = filterTargetOrder.indexOf(state.settings.filterTarget as any)
  state.settings.filterTarget = filterTargetOrder[(idx + 1) % 3]
}

const sortOptions = computed(() => [
  { label: t('filter.sort_name'), value: 'name' as SortBy },
  { label: t('filter.sort_modified'), value: 'modified' as SortBy },
  { label: t('filter.sort_size'), value: 'size' as SortBy },
])

const hasPresets = computed(() => state.settings.filterPresets.length > 0)

const emit = defineEmits<{
  openSettings: []
}>()

// 点击外部关闭
function onClickOutside(e: MouseEvent) {
  if (showPresets.value && presetsRef.value && !presetsRef.value.contains(e.target as Node)) {
    showPresets.value = false
  }
}
onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))
</script>

<template>
  <div class="filter-sort-bar">
    <!-- 排序 -->
    <div class="sort-group">
      <span class="sort-label">{{ $t('filter.sort') }}</span>
      <button
        v-for="opt in sortOptions"
        :key="opt.value"
        class="sort-btn"
        :class="{ active: state.settings.sortBy === opt.value }"
        @click="setSortBy(opt.value)"
      >
        {{ opt.label }}
      </button>
      <button class="sort-order-btn" @click="toggleOrder" :title="state.settings.sortOrder === 'asc' ? '升序' : '降序'">
        <svg v-if="state.settings.sortOrder === 'asc'" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M8 9l4-4 4 4" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 19V5M8 15l4 4 4-4" />
        </svg>
      </button>
    </div>

    <div class="filter-right-area">
      <slot name="right-prepend" />
      <!-- 筛选模式切换 -->
      <button
        class="filter-mode-btn"
        :title="state.settings.filterTarget === 'name' ? '按文件名筛选' : '按文件夹名筛选'"
        @click="toggleFilterTarget"
      >
        <span>{{ state.settings.filterTarget === 'name' ? $t('filter.file') : state.settings.filterTarget === 'group' ? $t('filter.group') : $t('filter.path') }}</span>
      </button>

      <!-- 正则筛选 -->
      <div class="filter-group">
        <input
          v-model="regexInput"
          type="text"
          class="filter-input"
          :placeholder="$t('filter.placeholder')"
          @input="applyFilter"
        />
        <button v-if="regexInput" class="filter-clear" @click="clearFilter">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <!-- 预设快速切换 -->
        <div v-if="hasPresets" ref="presetsRef" class="presets-dropdown">
          <button class="presets-trigger" title="筛选预设" @click="showPresets = !showPresets">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <div v-if="showPresets" class="presets-menu">
            <button
              v-for="(p, i) in state.settings.filterPresets"
              :key="i"
              class="preset-item"
              @click="usePreset(p)"
            >
              {{ p || '(空)' }}
            </button>
          </div>
        </div>
      </div>

      <button class="settings-btn" title="设置" @click="emit('openSettings')">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.filter-sort-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  width: 100%;
}

.sort-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.sort-label {
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  margin-right: 4px;
}

.sort-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s, color 0.15s;
}

.sort-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.7);
}

.sort-btn.active {
  background: rgba(100, 108, 255, 0.15);
  color: #aab0ff;
}

.sort-order-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.sort-order-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: white;
}

.filter-right-area {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.filter-mode-btn {
  background: rgba(100, 108, 255, 0.12);
  border: 1px solid rgba(100, 108, 255, 0.2);
  color: #aab0ff;
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  flex-shrink: 0;
  transition: background 0.15s;
}

.filter-mode-btn:hover {
  background: rgba(100, 108, 255, 0.2);
}

.filter-group {
  position: relative;
  width: 200px;
}

.filter-input {
  width: 100%;
  padding: 5px 28px 5px 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s;
}

.filter-input:focus {
  border-color: rgba(100, 108, 255, 0.4);
}

.filter-input::placeholder {
  color: rgba(255, 255, 255, 0.25);
}

.filter-clear {
  position: absolute;
  right: 24px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  padding: 2px;
  display: flex;
}

.filter-clear:hover {
  color: white;
}

.presets-dropdown {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
}

.presets-trigger {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.35);
  cursor: pointer;
  padding: 2px 4px;
  display: flex;
  border-radius: 3px;
}

.presets-trigger:hover {
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.08);
}

.presets-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: #252545;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  min-width: 140px;
  overflow: hidden;
  z-index: 100;
}

.preset-item {
  display: block;
  width: 100%;
  padding: 6px 12px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.preset-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: white;
}

.settings-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.settings-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: white;
}
</style>
