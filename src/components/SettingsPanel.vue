<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { t } from '../i18n'
import { state } from '../stores/imageStore'
import { SHORTCUTS, getDefaultBindings, formatKey, getAltKey } from '../utils/shortcuts'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'

const emit = defineEmits<{
  close: []
}>()

const localSettings = ref({ ...state.settings })
const activeTab = ref('general')

const tabs = [
  { key: 'general', label: 'settings.tab_general' },
  { key: 'grid', label: 'settings.tab_grid' },
  { key: 'colors', label: 'settings.tab_colors' },
  { key: 'viewer', label: 'settings.tab_viewer' },
  { key: 'shortcuts', label: 'settings.tab_shortcuts' },
  { key: 'advanced', label: 'settings.tab_advanced' },
]

/** 各标签页对应的设置字段 */
const tabFields: Record<string, (keyof typeof state.settings)[]> = {
  general: ['language', 'filterPresets', 'filterRegex', 'filterTarget', 'sortBy', 'sortOrder'],
  grid: ['borderRadius', 'gap', 'gridSize', 'bgColor', 'nodeGridGap'],
  colors: ['rainbowEnabled', 'rainbowColors', 'markColors', 'showMarkBadge', 'rootTitleColor', 'childTitleColor', 'rootTitleBgColor', 'childTitleBgColor'],
  viewer: ['viewerBgMode', 'viewerBgColor', 'autoPan', 'autoCenter', 'openWithPrograms'],
  shortcuts: ['keyBindings', 'keyAltBindings'],
  advanced: ['scanAllFiles', 'folderGroup', 'showGroupTitle', 'showMarks'],
}

const defaultSettings = {
  borderRadius: 4, gap: 8, bgColor: '#1a1a2e', gridSize: 200,
  folderGroup: true, showGroupTitle: true,
  filterRegex: '', filterTarget: 'name' as const, sortBy: 'name' as const, sortOrder: 'asc' as const,
  filterPresets: [] as string[],
  openWithPrograms: [] as string[],
  rootTitleColor: '#ffffff', childTitleColor: '#c0c0e0',
  rootTitleBgColor: '#222240', childTitleBgColor: '#23234d',
  nodeGridGap: 4,
  rainbowEnabled: false,
  rainbowColors: ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db'],
  language: 'zh' as const,
  viewerBgMode: 'overlay' as const, viewerBgColor: '#202020',
  scanAllFiles: false, autoPan: true, autoCenter: true,
  markColors: ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db'],
  showMarks: true, showMarkBadge: true,
  keyBindings: getDefaultBindings(),
  keyAltBindings: getDefaultBindings(true),
}

function apply() {
  Object.assign(state.settings, localSettings.value)
  emit('close')
}

async function browseProgram(index: number) {
  try {
    const selected = await open({
      multiple: false,
      title: t('settings.select_program_title'),
      filters: [{ name: t('settings.exe_filter_title'), extensions: ['exe', 'bat', 'cmd'] }],
    })
    if (selected) {
      localSettings.value.openWithPrograms[index] = selected as string
    }
  } catch { /* 用户取消 */ }
}

function openExternal(url: string) {
  invoke('open_in_explorer', { path: url }).catch(() => {
    window.open(url, '_blank')
  })
}

/** 按当前标签页重置 */
function resetCurrentTab() {
  const fields = tabFields[activeTab.value] || []
  for (const field of fields) {
    ;(localSettings.value as any)[field] = (defaultSettings as any)[field]
  }
}

/** 全部重置 */
function resetAll() {
  Object.assign(localSettings.value, defaultSettings)
}

// 快捷键录制
const recordingId = ref('')
const recordingIsAlt = ref(false)

function editShortcut(id: string, isAlt = false) {
  recordingId.value = id
  recordingIsAlt.value = isAlt
}

function onRecordKeydown(e: KeyboardEvent) {
  if (!recordingId.value) return
  e.preventDefault()
  e.stopPropagation()
  const key = e.key
  if (key === 'Escape') {
    recordingId.value = ''
    return
  }
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(key)) return
  if (recordingIsAlt.value) {
    localSettings.value.keyAltBindings[recordingId.value] = key
  } else {
    localSettings.value.keyBindings[recordingId.value] = key
  }
  recordingId.value = ''
}

function resetShortcut(id: string, isAlt = false) {
  const def = SHORTCUTS.find(s => s.id === id)
  if (!def) return
  if (isAlt) {
    localSettings.value.keyAltBindings[id] = (def.altKeys && def.altKeys[0]) || ''
  } else {
    localSettings.value.keyBindings[id] = def.defaultKey
  }
}

onMounted(() => {
  document.addEventListener('keydown', onRecordKeydown, true)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onRecordKeydown, true)
})
</script>

<template>
  <Teleport to="body">
    <div class="settings-overlay" @click.self="emit('close')">
      <div class="settings-dialog">
        <div class="settings-header">
          <h3>{{ $t('settings.title') }}</h3>
          <button class="settings-close" @click="emit('close')">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <!-- 标签页导航 -->
        <div class="settings-tabs">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="settings-tab"
            :class="{ active: activeTab === tab.key }"
            @click="activeTab = tab.key"
          >{{ $t(tab.label) }}</button>
        </div>

        <div class="settings-body">
          <!-- ===== 通用 ===== -->
          <div v-show="activeTab === 'general'" class="setting-section">
            <h4>{{ $t('settings.language') }}</h4>
            <div class="setting-row">
              <select v-model="localSettings.language" class="language-select">
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>

            <!-- 筛选预设 -->
            <h4 style="margin-top: 20px;">{{ $t('settings.filter_presets') }}</h4>
            <div class="setting-hint">{{ $t('settings.presets_hint') }}</div>
            <div
              v-for="(_preset, i) in localSettings.filterPresets"
              :key="i"
              class="preset-row"
            >
              <input
                v-model="localSettings.filterPresets[i]"
                type="text"
                class="preset-input"
                :placeholder="$t('settings.regex_placeholder')"
              />
              <button class="preset-remove" @click="localSettings.filterPresets.splice(i, 1)">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <button class="preset-add" @click="localSettings.filterPresets.push('')">
              {{ $t('settings.add_preset') }}
            </button>
          </div>

          <!-- ===== 网格 ===== -->
          <div v-show="activeTab === 'grid'" class="setting-section">
            <h4>{{ $t('settings.grid_style') }}</h4>
            <div class="setting-row">
              <label>{{ $t('settings.border_radius') }}</label>
              <input type="range" v-model.number="localSettings.borderRadius" min="0" max="20" step="1" />
              <span class="setting-value">{{ localSettings.borderRadius }}px</span>
            </div>
            <div class="setting-row">
              <label>{{ $t('settings.gap') }}</label>
              <input type="range" v-model.number="localSettings.gap" min="0" max="32" step="1" />
              <span class="setting-value">{{ localSettings.gap }}px</span>
            </div>
            <div class="setting-row">
              <label>{{ $t('settings.grid_size') }}</label>
              <input type="range" v-model.number="localSettings.gridSize" min="10" max="400" step="10" />
              <span class="setting-value">{{ localSettings.gridSize }}px</span>
            </div>
            <div class="setting-row">
              <label>{{ $t('settings.bg_color') }}</label>
              <input type="color" v-model="localSettings.bgColor" class="color-input" />
              <span class="setting-value">{{ localSettings.bgColor }}</span>
            </div>

            <h4 style="margin-top: 20px;">{{ $t('settings.node_grid') }}</h4>
            <div class="setting-row">
              <label>{{ $t('settings.node_grid_gap') }}</label>
              <input type="range" v-model.number="localSettings.nodeGridGap" min="0" max="40" step="1" />
              <span class="setting-value">{{ localSettings.nodeGridGap }}px</span>
            </div>
          </div>

          <!-- ===== 颜色 ===== -->
          <div v-show="activeTab === 'colors'" class="setting-section">
            <!-- 标题颜色 -->
            <h4>{{ $t('settings.title_color') }}</h4>
            <div class="setting-row">
              <label>{{ $t('settings.root_text') }}</label>
              <input type="color" v-model="localSettings.rootTitleColor" class="color-input" />
              <span class="setting-value" :style="{ color: localSettings.rootTitleColor }">{{ $t('settings.preview') }}</span>
            </div>
            <div class="setting-row">
              <label>{{ $t('settings.root_bg') }}</label>
              <input type="color" v-model="localSettings.rootTitleBgColor" class="color-input" />
              <span class="setting-value" :style="{ backgroundColor: localSettings.rootTitleBgColor }">&nbsp;&nbsp;&nbsp;&nbsp;</span>
            </div>
            <div class="setting-row">
              <label>{{ $t('settings.child_text') }}</label>
              <input type="color" v-model="localSettings.childTitleColor" class="color-input" />
              <span class="setting-value" :style="{ color: localSettings.childTitleColor }">{{ $t('settings.preview') }}</span>
            </div>
            <div class="setting-row">
              <label>{{ $t('settings.child_bg') }}</label>
              <input type="color" v-model="localSettings.childTitleBgColor" class="color-input" />
              <span class="setting-value" :style="{ backgroundColor: localSettings.childTitleBgColor }">&nbsp;&nbsp;&nbsp;&nbsp;</span>
            </div>

            <!-- 彩虹层级 -->
            <h4 style="margin-top: 20px;">{{ $t('settings.rainbow') }}</h4>
            <div class="setting-row">
              <label class="toggle-label">
                <input type="checkbox" v-model="localSettings.rainbowEnabled" class="toggle-input" />
                <span class="toggle-switch"></span>
                {{ $t('settings.rainbow_enable') }}
              </label>
            </div>
            <div
              v-for="(_c, i) in localSettings.rainbowColors"
              :key="i"
              class="setting-row"
              :style="{ marginLeft: '12px' }"
            >
              <label>{{ $t('settings.rainbow_color') }} {{ i + 1 }}</label>
              <input type="color" v-model="localSettings.rainbowColors[i]" class="color-input" />
              <div
                class="rainbow-swatch"
                :style="{ backgroundColor: localSettings.rainbowColors[i] }"
              ></div>
              <button class="preset-remove" @click="localSettings.rainbowColors.splice(i, 1)" :title="$t('settings.remove')">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <button class="preset-add" @click="localSettings.rainbowColors.push('#cccccc')">
              {{ $t('settings.add_color') }}
            </button>

            <!-- 标记颜色 -->
            <h4 style="margin-top: 20px;">{{ $t('settings.mark_colors') }}</h4>
            <div class="setting-row">
              <label class="toggle-label">
                <input type="checkbox" v-model="localSettings.showMarkBadge" class="toggle-input" />
                <span class="toggle-switch"></span>
                {{ $t('settings.show_mark_badge') }}
              </label>
            </div>
            <div
              v-for="(_c, i) in localSettings.markColors"
              :key="i"
              class="setting-row"
            >
              <label>{{ $t('settings.mark_color') }} {{ i + 1 }}</label>
              <input type="color" v-model="localSettings.markColors[i]" class="color-input" />
              <div
                class="rainbow-swatch"
                :style="{ backgroundColor: localSettings.markColors[i] }"
              ></div>
            </div>

          </div>

          <!-- ===== 查看器 ===== -->
          <div v-show="activeTab === 'viewer'" class="setting-section">
            <h4>{{ $t('settings.viewer_bg') }}</h4>
            <div class="setting-row">
              <label>{{ $t('settings.viewer_bg_mode') }}</label>
              <select v-model="localSettings.viewerBgMode" class="language-select">
                <option value="overlay">{{ $t('settings.viewer_bg_overlay') }}</option>
                <option value="color">{{ $t('settings.viewer_bg_color') }}</option>
              </select>
            </div>
            <div class="setting-row" v-if="localSettings.viewerBgMode === 'color'">
              <label>{{ $t('settings.viewer_bg_color_pick') }}</label>
              <input type="color" v-model="localSettings.viewerBgColor" class="color-input" />
              <span class="setting-value">{{ localSettings.viewerBgColor }}</span>
            </div>
            <div class="setting-row">
              <label class="toggle-label">
                <input type="checkbox" v-model="localSettings.autoPan" class="toggle-input" />
                <span class="toggle-switch"></span>
                {{ $t('settings.auto_pan') }}
              </label>
            </div>
            <div class="setting-hint">{{ $t('settings.auto_pan_hint') }}</div>
            <div class="setting-row">
              <label class="toggle-label">
                <input type="checkbox" v-model="localSettings.autoCenter" class="toggle-input" />
                <span class="toggle-switch"></span>
                {{ $t('settings.auto_center') }}
              </label>
            </div>
            <div class="setting-hint">{{ $t('settings.auto_center_hint') }}</div>

            <!-- 其他打开方式 -->
            <h4 style="margin-top: 20px;">{{ $t('settings.open_with') }}</h4>
            <div class="setting-hint">{{ $t('settings.open_with_hint') }}</div>
            <div
              v-for="(_prog, i) in localSettings.openWithPrograms"
              :key="i"
              class="preset-row"
            >
              <input
                v-model="localSettings.openWithPrograms[i]"
                type="text"
                class="preset-input"
                :placeholder="$t('settings.program_placeholder')"
              />
              <button class="preset-browse" :title="$t('settings.select_program')" @click="browseProgram(i)">{{ $t('settings.btn_browse') }}</button>
              <button class="preset-remove" @click="localSettings.openWithPrograms.splice(i, 1)">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <button class="preset-add" @click="localSettings.openWithPrograms.push('')">
              {{ $t('settings.add_program') }}
            </button>
          </div>

          <!-- ===== 快捷键 ===== -->
          <div v-show="activeTab === 'shortcuts'" class="setting-section">
            <h4>{{ $t('shortcuts.title') }}</h4>
            <div class="setting-hint">{{ $t('shortcuts.hint') }}</div>

            <div v-for="scope in (['global', 'grid', 'viewer', 'compare'] as const)" :key="scope" class="shortcut-group">
              <h5 style="margin: 16px 0 8px; font-size:13px; color:rgba(255,255,255,0.6); font-weight:500;">
                {{ $t('shortcuts.scope_' + scope) }}
              </h5>
              <div
                v-for="s in SHORTCUTS.filter(s2 => s2.scope === scope)"
                :key="s.id"
                class="shortcut-row"
                :class="{ 'shortcut-readonly': s.readonly }"
              >
                <span class="shortcut-label">{{ $t(s.labelKey) }}</span>
                <template v-if="s.readonly">
                  <span class="shortcut-key shortcut-key-readonly">{{ formatKey(s.defaultKey) }}</span>
                  <span class="shortcut-readonly-icon" :title="$t('shortcuts.readonly')">🔒</span>
                </template>
                <template v-else>
                  <!-- 主键 -->
                  <span v-if="recordingId === s.id && !recordingIsAlt" class="shortcut-key recording-hint">{{ $t('shortcuts.press_key') }}</span>
                  <span v-else class="shortcut-key shortcut-key-main">{{ formatKey(localSettings.keyBindings[s.id] || s.defaultKey) }}</span>
                  <button class="shortcut-edit-btn" @click="editShortcut(s.id, false)" :title="$t('shortcuts.edit')">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button class="shortcut-reset-btn" @click="resetShortcut(s.id, false)" :title="$t('shortcuts.reset')">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                  </button>
                  <!-- 替代键 -->
                  <span class="shortcut-alt-label">{{ $t('shortcuts.alt') }}</span>
                  <span v-if="recordingId === s.id && recordingIsAlt" class="shortcut-key recording-hint">{{ $t('shortcuts.press_key') }}</span>
                  <span v-else class="shortcut-key shortcut-key-alt">{{ formatKey(localSettings.keyAltBindings[s.id] || getAltKey(s.id)) }}</span>
                  <button class="shortcut-edit-btn" @click="editShortcut(s.id, true)" :title="$t('shortcuts.edit')">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button class="shortcut-reset-btn" @click="resetShortcut(s.id, true)" :title="$t('shortcuts.reset')">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                  </button>
                </template>
              </div>
            </div>
          </div>

          <!-- ===== 高级 ===== -->
          <div v-show="activeTab === 'advanced'" class="setting-section">
            <!-- 扫描设置 -->
            <h4>{{ $t('settings.scan_all_files') }}</h4>
            <div class="setting-row">
              <label class="toggle-label">
                <input type="checkbox" v-model="localSettings.scanAllFiles" class="toggle-input" />
                <span class="toggle-switch"></span>
                {{ $t('settings.scan_all_files') }}
              </label>
            </div>
            <div class="setting-hint">{{ $t('settings.scan_all_files_hint') }}</div>

            <!-- GitHub -->
            <h4 style="margin-top: 24px;">GitHub</h4>
            <div class="setting-row" style="flex-wrap: wrap;">
              <a
                href="https://github.com/atakhalo/ImgGroupX"
                target="_blank"
                class="github-link"
                @click.prevent="openExternal('https://github.com/atakhalo/ImgGroupX')"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                <span>github.com/atakhalo/ImgGroupX</span>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:auto;flex-shrink:0;">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>
          </div>
        </div>
        <div class="settings-footer">
          <div class="footer-left">
            <button class="settings-btn secondary" @click="resetCurrentTab">{{ $t('settings.reset') }}</button>
            <button class="settings-btn secondary" @click="resetAll">{{ $t('settings.reset_all') }}</button>
          </div>
          <button class="settings-btn primary" @click="apply">{{ $t('settings.apply') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.settings-dialog {
  background: #1e1e3a;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  width: 500px;
  max-width: 90vw;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.settings-header h3 {
  margin: 0;
  font-size: 16px;
  color: white;
  font-weight: 500;
}

.settings-close {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}
.settings-close:hover { background: rgba(255,255,255,0.1); color: white; }

.settings-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
}

/* 标签页导航 */
.settings-tabs {
  display: flex;
  gap: 2px;
  padding: 0 16px;
  background: #1e1e3a;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.settings-tab {
  flex: 1;
  background: transparent;
  border: none;
  color: rgba(255,255,255,0.5);
  padding: 10px 6px;
  margin-bottom: -1px;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: color 0.15s, border-color 0.15s;
  text-align: center;
}

.settings-tab:hover {
  color: rgba(255,255,255,0.8);
}

.settings-tab.active {
  color: #aab0ff;
  border-bottom-color: #aab0ff;
}

.settings-tab:hover {
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.8);
}

.settings-tab.active {
  background: rgba(100,108,255,0.15);
  color: #aab0ff;
}

.setting-section {
  margin-bottom: 20px;
}
.setting-section h4 {
  font-size: 14px;
  color: rgba(255,255,255,0.7);
  margin-bottom: 12px;
  font-weight: 500;
}
.setting-hint {
  font-size: 12px;
  color: rgba(255,255,255,0.3);
  margin-bottom: 8px;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.language-select {
  padding: 6px 10px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  color: rgba(255,255,255,0.8);
  font-size: 13px;
  outline: none;
  cursor: pointer;
}

.language-select:focus { border-color: rgba(100,108,255,0.4); }

.language-select option {
  background: #1e1e3a;
  color: white;
}

.setting-row label {
  width: 70px;
  font-size: 13px;
  color: rgba(255,255,255,0.6);
  flex-shrink: 0;
}
.setting-row input[type="range"] {
  flex: 1;
  accent-color: #646cff;
  background: transparent;
}
.setting-value {
  width: 50px;
  font-size: 12px;
  color: rgba(255,255,255,0.4);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.color-input {
  width: 40px;
  height: 28px;
  padding: 0;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}

.rainbow-swatch {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.1);
  flex-shrink: 0;
}

.alpha-slider {
  width: 60px;
  accent-color: #646cff;
  background: transparent;
  flex-shrink: 0;
}

.preset-row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.preset-input {
  flex: 1;
  padding: 5px 8px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 4px;
  color: rgba(255,255,255,0.8);
  font-size: 12px;
  outline: none;
}
.preset-input:focus { border-color: rgba(100,108,255,0.4); }

.preset-remove {
  background: transparent;
  border: none;
  color: rgba(255,255,255,0.3);
  cursor: pointer;
  padding: 4px;
}
.preset-remove:hover { color: #ff6b6b; }

.preset-browse {
  background: transparent;
  border: 1px solid rgba(255,255,255,0.12);
  color: rgba(255,255,255,0.4);
  cursor: pointer;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 12px;
  flex-shrink: 0;
}
.preset-browse:hover { border-color: rgba(100,108,255,0.3); color: #aab0ff; }

/* 快捷键 */
.shortcut-group {
  margin-bottom: 8px;
}
.shortcut-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  transition: background 0.12s;
}
.shortcut-row:hover {
  background: rgba(255,255,255,0.04);
}
.shortcut-row.recording {
  background: rgba(100,108,255,0.15);
  outline: 1px solid rgba(100,108,255,0.3);
}
.shortcut-label {
  flex: 1;
  font-size: 13px;
  color: rgba(255,255,255,0.7);
}
.shortcut-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  padding: 2px 8px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 4px;
  font-size: 12px;
  color: rgba(255,255,255,0.8);
  font-family: monospace;
  text-align: center;
}
.shortcut-readonly {
  opacity: 0.7;
}
.shortcut-readonly:hover {
  background: transparent !important;
}
.shortcut-key-readonly {
  background: rgba(255,255,255,0.04);
  border-color: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.4);
  font-style: italic;
}
.shortcut-readonly-icon {
  font-size: 11px;
  opacity: 0.4;
  flex-shrink: 0;
}

.shortcut-row.recording {
  background: rgba(100,108,255,0.1);
  border-radius: 6px;
}
.shortcut-alt-label {
  font-size: 10px;
  color: rgba(255,255,255,0.3);
  margin: 0 2px;
  flex-shrink: 0;
}
.shortcut-key-main {
  background: rgba(100,108,255,0.15);
  border-color: rgba(100,108,255,0.2);
  color: #aab0ff;
}
.shortcut-key-alt {
  background: rgba(255,255,255,0.05);
}
.shortcut-edit-btn, .shortcut-reset-btn {
  background: transparent;
  border: none;
  color: rgba(255,255,255,0.3);
  cursor: pointer;
  padding: 3px;
  border-radius: 3px;
  display: flex;
  opacity: 0;
  transition: opacity 0.12s, color 0.12s;
  flex-shrink: 0;
}
.shortcut-row:hover .shortcut-edit-btn,
.shortcut-row:hover .shortcut-reset-btn {
  opacity: 1;
}
.shortcut-edit-btn:hover { color: #aab0ff; }
.shortcut-reset-btn:hover { color: #ffd700; }
.recording-hint {
  color: #aab0ff !important;
  animation: pulse 1s ease-in-out infinite;
  font-style: italic;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.preset-add {
  background: transparent;
  border: 1px dashed rgba(255,255,255,0.15);
  color: rgba(255,255,255,0.4);
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  width: 100%;
  margin-top: 4px;
}
.preset-add:hover { border-color: rgba(100,108,255,0.4); color: #aab0ff; }

.github-link {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  color: rgba(255,255,255,0.7);
  text-decoration: none;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.github-link:hover {
  background: rgba(255,255,255,0.08);
  border-color: rgba(100,108,255,0.3);
  color: #aab0ff;
}
.github-link svg:first-child {
  flex-shrink: 0;
  opacity: 0.7;
}
.github-link:hover svg:first-child {
  opacity: 1;
}

.settings-footer {
  padding: 12px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.footer-left {
  display: flex;
  gap: 6px;
}

.settings-btn {
  padding: 6px 20px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  border: 1px solid transparent;
}

.settings-btn.primary {
  background: rgba(100,108,255,0.2);
  border-color: rgba(100,108,255,0.3);
  color: #aab0ff;
}
.settings-btn.primary:hover { background: rgba(100,108,255,0.3); }

.settings-btn.secondary {
  background: transparent;
  border-color: rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.5);
}
.settings-btn.secondary:hover { background: rgba(255,255,255,0.06); color: white; }

/* 开关样式 */
.toggle-label {
  display: flex !important;
  align-items: center;
  gap: 8px;
  width: auto !important;
  cursor: pointer;
  font-size: 13px;
  color: rgba(255,255,255,0.6);
  user-select: none;
}

.toggle-input {
  display: none;
}

.toggle-switch {
  position: relative;
  width: 36px;
  height: 20px;
  background: rgba(255,255,255,0.12);
  border-radius: 10px;
  transition: background 0.2s;
  flex-shrink: 0;
}

.toggle-switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  background: rgba(255,255,255,0.5);
  border-radius: 50%;
  transition: transform 0.2s, background 0.2s;
}

.toggle-input:checked + .toggle-switch {
  background: rgba(100, 108, 255, 0.5);
}

.toggle-input:checked + .toggle-switch::after {
  transform: translateX(16px);
  background: white;
}
</style>
