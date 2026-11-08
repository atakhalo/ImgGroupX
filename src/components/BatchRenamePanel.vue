<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { BatchRenamePreset, ImageItem } from '../types'
import {
  BATCH_RENAME_ADVANCED,
  BATCH_RENAME_VARS,
  buildBatchRenamePlan,
  buildExistingNameIndex,
  buildVarSamples,
  isVideoItem,
  patternUsesDims,
} from '../utils/batchRename'
import type { BatchRenameErrorCode } from '../utils/batchRename'
import { applyBatchRename, requestImageDimsUrgent, state, showToast } from '../stores/imageStore'
import { t } from '../i18n'

const props = defineProps<{
  /** 分组名称（用于面板标题） */
  folderName: string
  /** 该分组直接包含的图片 */
  directImages: ImageItem[]
  /** 该分组及子文件夹内的全部图片 */
  allImages: ImageItem[]
}>()

const emit = defineEmits<{
  close: []
}>()

/** 当前命名规则 */
const pattern = ref('{i}_{origin}')
/** 起始序号 */
const start = ref(1)
/** 序号补零位数（0=不补零） */
const digits = ref(0)
/** 是否包含子文件夹 */
const includeSub = ref(true)
/** 正在保存预设时显示名称输入行 */
const savingPreset = ref(false)
const presetName = ref('')
const applying = ref(false)
const loadingDims = ref(false)
/** 高级写法默认折叠 */
const showAdvanced = ref(false)
const patternInput = ref<HTMLInputElement | null>(null)

/** 参与重命名的图片列表（顺序决定 {i} 序号） */
const images = computed(() => (includeSub.value ? props.allImages : props.directImages))

/** 规则选项 */
const opts = computed(() => ({
  start: Math.max(0, Math.floor(Number(start.value)) || 0),
  digits: Math.max(0, Math.min(10, Math.floor(Number(digits.value)) || 0)),
}))

/** 已加载文件的「目录 → 文件名」索引，用于预览时提示与现有文件重名 */
const existingIndex = buildExistingNameIndex(state.allImages)

/** 预览计划 */
const plan = computed(() => buildBatchRenamePlan(images.value, pattern.value, opts.value, existingIndex))

/** 预览最多展示的行数 */
const PREVIEW_LIMIT = 200
const rows = computed(() => plan.value.rows.slice(0, PREVIEW_LIMIT))

/** 变量示例值 */
const varSamples = computed(() => buildVarSamples(images.value, opts.value))

/** 预设列表 */
const presets = computed(() => state.settings.batchRenamePresets)

/** 应用预设 */
function applyPreset(preset: BatchRenamePreset) {
  pattern.value = preset.pattern
  start.value = preset.start
  digits.value = preset.digits
  includeSub.value = preset.includeSub
}

/** 保存当前规则为预设（同名覆盖） */
function savePreset() {
  const name = presetName.value.trim() || pattern.value.trim()
  if (!name || !pattern.value.trim()) return
  const preset: BatchRenamePreset = {
    name,
    pattern: pattern.value,
    start: Math.max(0, Math.floor(Number(start.value)) || 0),
    digits: Math.max(0, Math.min(10, Math.floor(Number(digits.value)) || 0)),
    includeSub: includeSub.value,
  }
  const index = state.settings.batchRenamePresets.findIndex(p => p.name === name)
  if (index >= 0) state.settings.batchRenamePresets[index] = preset
  else state.settings.batchRenamePresets.push(preset)
  savingPreset.value = false
  presetName.value = ''
  showToast(t('ext.batch_rename.preset_saved', { name }))
}

/** 删除预设 */
function removePreset(index: number) {
  state.settings.batchRenamePresets.splice(index, 1)
}

/** 在规则输入框光标处插入变量；cursorOffset 指定插入后的光标位置（相对插入起点） */
function insertVar(token: string, cursorOffset?: number) {
  const el = patternInput.value
  if (!el) {
    pattern.value += token
    return
  }
  const startPos = el.selectionStart ?? pattern.value.length
  const endPos = el.selectionEnd ?? pattern.value.length
  pattern.value = pattern.value.slice(0, startPos) + token + pattern.value.slice(endPos)
  nextTick(() => {
    el.focus()
    const pos = startPos + (cursorOffset === undefined ? token.length : cursorOffset)
    el.setSelectionRange(pos, pos)
  })
}

/** 行错误文案 */
const ERROR_LABEL: Record<BatchRenameErrorCode, string> = {
  empty: 'ext.batch_rename.err_empty',
  duplicate: 'ext.batch_rename.err_duplicate',
  exists: 'ext.batch_rename.err_exists',
  bad_regex: 'ext.batch_rename.err_bad_regex',
}

function errorLabel(code?: BatchRenameErrorCode): string {
  return code ? t(ERROR_LABEL[code]) : ''
}

/** 规则用到宽高时按需读取尺寸（缺失的图片补读，到达后预览自动更新） */
watch(
  [pattern, includeSub],
  async () => {
    if (!patternUsesDims(pattern.value)) return
    const missing = images.value.filter(i => !isVideoItem(i) && i.width <= 0 && i.height <= 0)
    if (missing.length === 0) return
    loadingDims.value = true
    try {
      await requestImageDimsUrgent(missing)
    } finally {
      loadingDims.value = false
    }
  },
  { immediate: true },
)

/** 执行批量重命名 */
async function apply() {
  if (applying.value || plan.value.hasError || plan.value.validCount === 0) return
  const entries = plan.value.rows
    .filter(row => row.name && !row.error)
    .map(row => ({ item: row.item, newName: row.name }))
  if (entries.length === 0) return
  applying.value = true
  try {
    const result = await applyBatchRename(entries)
    if (result.failed === 0) emit('close')
  } finally {
    applying.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  // 打开后聚焦规则输入框，光标置于末尾，方便直接输入或继续编辑
  nextTick(() => {
    const el = patternInput.value
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  })
})
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="brn-overlay">
      <div class="brn-dialog">
        <div class="brn-header">
          <div class="brn-title-wrap">
            <span class="brn-title">{{ $t('ext.batch_rename.panel_title') }}</span>
            <span class="brn-subtitle">
              {{ folderName }} · {{ $t('ext.batch_rename.file_count', { n: images.length }) }}
            </span>
          </div>
          <button class="brn-close" :title="$t('ext.batch_rename.close')" @click="emit('close')">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div class="brn-body">
          <!-- 预设 -->
          <section class="brn-section">
            <div class="brn-label-row">
              <span class="brn-label">{{ $t('ext.batch_rename.presets') }}</span>
              <button class="brn-link" @click="savingPreset = !savingPreset">
                {{ savingPreset ? $t('ext.batch_rename.cancel') : $t('ext.batch_rename.save_preset') }}
              </button>
            </div>
            <div class="brn-preset-list">
              <span v-if="presets.length === 0" class="brn-empty">{{ $t('ext.batch_rename.no_preset') }}</span>
              <span v-for="(preset, i) in presets" :key="preset.name + i" class="brn-preset-chip">
                <button class="brn-preset-btn" :title="preset.pattern" @click="applyPreset(preset)">
                  {{ preset.name }}
                </button>
                <button
                  class="brn-preset-del"
                  :title="$t('ext.batch_rename.remove_preset')"
                  @click.stop="removePreset(i)"
                >×</button>
              </span>
            </div>
            <div v-if="savingPreset" class="brn-save-row">
              <input
                v-model="presetName"
                class="brn-input"
                :placeholder="$t('ext.batch_rename.preset_name_placeholder')"
                @keyup.enter="savePreset"
              />
              <button class="brn-mini primary" @click="savePreset">{{ $t('settings.apply') }}</button>
            </div>
          </section>

          <!-- 命名规则 -->
          <section class="brn-section">
            <div class="brn-label-row">
              <span class="brn-label">{{ $t('ext.batch_rename.pattern') }}</span>
              <span class="brn-hint">{{ $t('ext.batch_rename.pattern_hint') }}</span>
            </div>
            <input
              ref="patternInput"
              v-model="pattern"
              class="brn-input brn-pattern"
              spellcheck="false"
              :placeholder="$t('ext.batch_rename.pattern_placeholder')"
            />
            <div class="brn-vars">
              <button
                v-for="v in BATCH_RENAME_VARS"
                :key="v.key"
                class="brn-var"
                :title="$t(v.labelKey)"
                @mousedown.prevent
                @click="insertVar(v.token)"
              >{{ v.token }}</button>
            </div>
            <!-- 高级写法：正则提取 / 日期格式（默认折叠） -->
            <button
              class="brn-advanced-toggle"
              :class="{ open: showAdvanced }"
              @click="showAdvanced = !showAdvanced"
            >
              <svg
                class="brn-advanced-arrow"
                :class="{ open: showAdvanced }"
                viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span class="brn-advanced-label">{{ $t('ext.batch_rename.adv_title') }}</span>
              <span class="brn-advanced-hint">{{ $t('ext.batch_rename.adv_hint') }}</span>
            </button>
            <div v-show="showAdvanced" class="brn-advanced">
              <div
                v-for="adv in BATCH_RENAME_ADVANCED"
                :key="adv.display"
                class="brn-advanced-row"
              >
                <button
                  class="brn-adv-token"
                  :title="$t(adv.labelKey)"
                  @mousedown.prevent
                  @click="insertVar(adv.insert, adv.cursorOffset)"
                >{{ adv.display }}</button>
                <span class="brn-adv-desc">{{ $t(adv.labelKey) }}</span>
              </div>
            </div>
            <!-- 变量取值预览（基于第一张图片） -->
            <div class="brn-var-preview">
              <div v-for="v in BATCH_RENAME_VARS" :key="v.key" class="brn-var-item">
                <code class="brn-var-code">{{ v.token }}</code>
                <span class="brn-var-value" :title="$t(v.labelKey)">{{ varSamples[v.key] || '—' }}</span>
                <span class="brn-var-desc">{{ $t(v.labelKey) }}</span>
              </div>
            </div>
          </section>

          <!-- 选项 -->
          <section class="brn-options">
            <label class="brn-opt">
              <span class="brn-opt-label">{{ $t('ext.batch_rename.start') }}</span>
              <input v-model.number="start" type="number" min="0" max="999999" class="brn-num" />
            </label>
            <label class="brn-opt">
              <span class="brn-opt-label">{{ $t('ext.batch_rename.digits') }}</span>
              <input v-model.number="digits" type="number" min="0" max="10" class="brn-num" />
            </label>
            <label class="brn-check">
              <input v-model="includeSub" type="checkbox" />
              <span>{{ $t('ext.batch_rename.include_sub') }}</span>
            </label>
          </section>

          <!-- 提示 -->
          <div v-if="loadingDims" class="brn-note">{{ $t('ext.batch_rename.reading_dims') }}</div>
          <div v-if="plan.missingDims > 0" class="brn-note warn">
            {{ $t('ext.batch_rename.dims_missing', { n: plan.missingDims }) }}
          </div>
          <div v-if="plan.extractMiss > 0" class="brn-note warn">
            {{ $t('ext.batch_rename.extract_miss', { n: plan.extractMiss }) }}
          </div>

          <!-- 预览 -->
          <section class="brn-section">
            <div class="brn-label-row">
              <span class="brn-label">{{ $t('ext.batch_rename.preview') }}</span>
              <span class="brn-hint">
                {{ $t('ext.batch_rename.preview_summary', { total: images.length, valid: plan.validCount }) }}
              </span>
            </div>
            <div class="brn-preview">
              <div
                v-for="(row, i) in rows"
                :key="row.item.path"
                class="brn-row"
                :class="{ error: !!row.error }"
              >
                <span class="brn-row-index">{{ i + 1 }}</span>
                <span class="brn-row-old" :title="row.item.name">{{ row.item.name }}</span>
                <span class="brn-row-arrow">→</span>
                <span class="brn-row-new" :title="row.name">
                  {{ row.name || '—' }}<span class="brn-row-ext">.{{ row.item.ext }}</span>
                </span>
                <span v-if="row.error" class="brn-row-error">{{ errorLabel(row.error) }}</span>
                <span v-else-if="row.warnExtract" class="brn-row-warn">{{ $t('ext.batch_rename.warn_extract') }}</span>
              </div>
              <div v-if="rows.length === 0" class="brn-empty">{{ $t('ext.batch_rename.no_files') }}</div>
              <div v-else-if="images.length > rows.length" class="brn-more">
                {{ $t('ext.batch_rename.preview_more', { n: images.length - rows.length }) }}
              </div>
            </div>
          </section>
        </div>

        <div class="brn-footer">
          <span v-if="plan.hasError" class="brn-footer-error">{{ $t('ext.batch_rename.has_error') }}</span>
          <span v-else class="brn-footer-ok">{{ $t('ext.batch_rename.ready', { n: plan.validCount }) }}</span>
          <button class="brn-btn" @click="emit('close')">{{ $t('ext.batch_rename.cancel') }}</button>
          <button
            class="brn-btn primary"
            :disabled="plan.hasError || applying || plan.validCount === 0"
            @click="apply"
          >
            {{ applying ? $t('ext.batch_rename.applying') : $t('ext.batch_rename.apply') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.brn-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2200;
}

.brn-dialog {
  background: #1e1e3a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  width: 760px;
  max-width: 92vw;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
  color: rgba(255, 255, 255, 0.85);
}

.brn-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 18px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.brn-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.brn-title { font-size: 15px; font-weight: 600; color: #fff; }
.brn-subtitle {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brn-close {
  flex-shrink: 0;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}
.brn-close:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }

.brn-body {
  padding: 14px 18px 6px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.brn-section { margin-bottom: 14px; }

.brn-label-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
}
.brn-label {
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.6);
  flex-shrink: 0;
}
.brn-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brn-link {
  margin-left: auto;
  background: transparent;
  border: none;
  color: #8f95ff;
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}
.brn-link:hover { text-decoration: underline; }

.brn-preset-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.brn-preset-chip {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
}
.brn-preset-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
}
.brn-preset-btn:hover { background: rgba(100, 108, 255, 0.18); color: #fff; }
.brn-preset-del {
  background: transparent;
  border: none;
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.35);
  font-size: 13px;
  line-height: 1;
  padding: 0 7px;
  cursor: pointer;
}
.brn-preset-del:hover { background: rgba(220, 80, 80, 0.25); color: #ffb3b3; }

.brn-save-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.brn-input {
  flex: 1;
  min-width: 0;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 6px 10px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  font-family: inherit;
  outline: none;
}
.brn-input:focus { border-color: rgba(100, 108, 255, 0.5); }

.brn-pattern {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 13px;
  padding: 8px 10px;
}

.brn-mini {
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.75);
  font-size: 12px;
  padding: 4px 12px;
  cursor: pointer;
  flex-shrink: 0;
}
.brn-mini:hover { background: rgba(255, 255, 255, 0.12); }
.brn-mini.primary { background: rgba(100, 108, 255, 0.28); border-color: rgba(100, 108, 255, 0.5); color: #dfe1ff; }

.brn-vars {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.brn-var {
  background: rgba(100, 108, 255, 0.1);
  border: 1px solid rgba(100, 108, 255, 0.25);
  border-radius: 5px;
  color: #aab0ff;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 11px;
  padding: 3px 8px;
  cursor: pointer;
}
.brn-var:hover { background: rgba(100, 108, 255, 0.25); color: #fff; }

/* 高级写法（默认折叠） */
.brn-advanced-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-top: 10px;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.45);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s;
}
.brn-advanced-toggle:hover { background: rgba(255, 255, 255, 0.06); }
.brn-advanced-toggle.open {
  border-color: rgba(100, 108, 255, 0.25);
  color: rgba(255, 255, 255, 0.65);
}
.brn-advanced-arrow {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.3);
  transition: transform 0.15s;
}
.brn-advanced-arrow.open { transform: rotate(90deg); }
.brn-advanced-label { flex-shrink: 0; }
.brn-advanced-hint {
  margin-left: auto;
  color: rgba(255, 255, 255, 0.22);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.brn-advanced {
  margin-top: 6px;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.16);
  border: 1px dashed rgba(255, 255, 255, 0.08);
  border-radius: 8px;
}
.brn-advanced-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 5px;
  min-width: 0;
}
.brn-adv-token {
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  color: #aab0ff;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 11px;
  padding: 2px 7px;
  cursor: pointer;
}
.brn-adv-token:hover { background: rgba(100, 108, 255, 0.22); color: #fff; }
.brn-adv-desc {
  font-size: 11px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.32);
  min-width: 0;
}

.brn-var-preview {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 4px 14px;
  margin-top: 10px;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px dashed rgba(255, 255, 255, 0.08);
  border-radius: 8px;
}
.brn-var-item {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  min-width: 0;
}
.brn-var-code { color: #aab0ff; flex-shrink: 0; }
.brn-var-value {
  color: #8ee6a0;
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}
.brn-var-desc {
  color: rgba(255, 255, 255, 0.3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brn-options {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 12px;
}
.brn-opt { display: flex; align-items: center; gap: 6px; }
.brn-opt-label { font-size: 12px; color: rgba(255, 255, 255, 0.5); }
.brn-num {
  width: 68px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 4px 8px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  outline: none;
}
.brn-num:focus { border-color: rgba(100, 108, 255, 0.5); }
.brn-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  user-select: none;
}
.brn-check input { accent-color: #646cff; }

.brn-note {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 10px;
}
.brn-note.warn { color: #f0c674; }

.brn-preview {
  max-height: 230px;
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.18);
}
.brn-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  font-size: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
.brn-row:last-child { border-bottom: none; }
.brn-row.error { background: rgba(220, 80, 80, 0.08); }
.brn-row-index {
  width: 34px;
  flex-shrink: 0;
  text-align: right;
  color: rgba(255, 255, 255, 0.25);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.brn-row-old {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.45);
}
.brn-row-arrow { color: rgba(255, 255, 255, 0.2); flex-shrink: 0; }
.brn-row-new {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.9);
}
.brn-row-ext { color: rgba(255, 255, 255, 0.35); }
.brn-row-error {
  flex-shrink: 0;
  font-size: 11px;
  color: #ff9b9b;
}
.brn-row-warn {
  flex-shrink: 0;
  font-size: 11px;
  color: #f0c674;
}

.brn-empty {
  padding: 10px 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.3);
}
.brn-more {
  padding: 6px 12px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.brn-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.brn-footer-ok,
.brn-footer-error {
  flex: 1;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.brn-footer-ok { color: rgba(142, 230, 160, 0.85); }
.brn-footer-error { color: #f0a0a0; }

.brn-btn {
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.75);
  font-size: 12px;
  padding: 7px 18px;
  cursor: pointer;
  flex-shrink: 0;
}
.brn-btn:hover { background: rgba(255, 255, 255, 0.12); }
.brn-btn.primary {
  background: rgba(100, 108, 255, 0.3);
  border-color: rgba(100, 108, 255, 0.5);
  color: #dfe1ff;
}
.brn-btn.primary:hover { background: rgba(100, 108, 255, 0.42); }
.brn-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
