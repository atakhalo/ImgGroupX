<script setup lang="ts">
import { ref } from 'vue'
import type { HierarchyRow } from '../types'

defineProps<{
  /** 由 FolderPanel 按主视图显示规则生成的分组行 */
  rows: HierarchyRow[]
  /** 面板是否展开 */
  open: boolean
}>()

const emit = defineEmits<{
  togglePanel: []
  toggleRow: [row: HierarchyRow]
  jump: [row: HierarchyRow]
  expandAll: []
  collapseAll: []
}>()

/** 最近一次点击跳转的行（高亮显示，便于确认落点） */
const activeKey = ref('')

function handleJump(row: HierarchyRow) {
  activeKey.value = row.key
  emit('jump', row)
}

/** 行缩进（层级压缩后的真实显示层级） */
function indent(row: HierarchyRow): string {
  return 6 + row.depth * 12 + 'px'
}
</script>

<template>
  <div class="hier-dock" :class="{ open }">
    <!-- 收起状态：左侧垂直居中的悬浮按钮 -->
    <button
      v-if="!open"
      class="hier-fab"
      type="button"
      :title="$t('hierarchy.expand')"
      @click="emit('togglePanel')"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="9 6 15 12 9 18" />
      </svg>
    </button>

    <section v-else class="hier-panel">
      <header class="hier-header">
        <span class="hier-title">{{ $t('hierarchy.title') }}</span>
        <span class="hier-total" :title="$t('hierarchy.count_tip')">{{ rows.length }}</span>
        <span class="hier-header-actions">
          <button class="hier-icon-btn" type="button" :title="$t('hierarchy.expand_all')" @click="emit('expandAll')">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 7 12 13 18 7" />
              <polyline points="6 13 12 19 18 13" />
            </svg>
          </button>
          <button class="hier-icon-btn" type="button" :title="$t('hierarchy.collapse_all')" @click="emit('collapseAll')">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 17 12 11 18 17" />
              <polyline points="6 11 12 5 18 11" />
            </svg>
          </button>
          <button class="hier-icon-btn hier-collapse-btn" type="button" :title="$t('hierarchy.collapse')" @click="emit('togglePanel')">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 6 9 12 15 18" />
            </svg>
          </button>
        </span>
      </header>

      <div class="hier-body">
        <div
          v-for="row in rows"
          :key="row.key"
          class="hier-row"
          :class="{
            active: activeKey === row.key,
            'is-virtual': row.isVirtual,
            'is-virtual-root': row.isVirtualRoot,
          }"
          :style="{ paddingLeft: indent(row) }"
          :title="row.hint"
          @click="handleJump(row)"
        >
          <button
            v-if="row.hasChildren"
            class="hier-caret"
            type="button"
            @click.stop="emit('toggleRow', row)"
          >
            <svg v-if="row.expanded" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <svg v-else viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </button>
          <span v-else class="hier-caret-placeholder"></span>
          <span class="hier-row-label">{{ row.label }}</span>
          <span class="hier-row-count">{{ row.count }}</span>
        </div>
        <div v-if="rows.length === 0" class="hier-empty">{{ $t('hierarchy.empty') }}</div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/*
 * 停靠区：不占宽度（收起时），不参与内容滚动。
 * 作为内容边距之外的独立元素存在，因此不受「内容边距」设置影响。
 */
.hier-dock {
  position: relative;
  flex: 0 0 auto;
  align-self: stretch;
  width: 0;
}

.hier-dock.open {
  width: 250px;
}

/* ===== 收起状态：左侧垂直居中悬浮按钮 ===== */
.hier-fab {
  position: absolute;
  left: 6px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 20;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(32, 32, 58, 0.9);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  opacity: 0.78;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}

.hier-fab:hover {
  opacity: 1;
  background: rgba(56, 56, 96, 0.95);
  color: #fff;
}

/* ===== 面板 ===== */
.hier-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #20203a;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
}

.hier-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px 7px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  flex-shrink: 0;
}

.hier-title {
  font-weight: 500;
  letter-spacing: 0.5px;
}

.hier-total {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.32);
}

.hier-header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}

.hier-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.hier-icon-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

/* 最右侧的收起按钮 */
.hier-collapse-btn {
  margin-left: 2px;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0 4px 4px 0;
  padding-left: 4px;
  width: 24px;
}

.hier-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0 10px;
}

.hier-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px 3px 6px;
  margin: 1px 4px;
  border-radius: 4px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.62);
  cursor: pointer;
  user-select: none;
  transition: background 0.12s, color 0.12s;
}

.hier-row:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.hier-row.active {
  background: rgba(100, 108, 255, 0.22);
  color: #cfd2ff;
}

.hier-row.is-virtual-root .hier-row-label {
  color: #ffd166;
}

.hier-row.is-virtual:not(.is-virtual-root) .hier-row-label {
  color: rgba(255, 209, 102, 0.78);
}

.hier-caret {
  width: 12px;
  flex: 0 0 12px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1;
  cursor: pointer;
}

.hier-caret:hover {
  color: #fff;
}

.hier-caret-placeholder {
  width: 12px;
  flex: 0 0 12px;
}

.hier-row-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hier-row-count {
  flex-shrink: 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
}

.hier-empty {
  padding: 18px 12px;
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.3);
}
</style>
