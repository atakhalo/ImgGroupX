<script setup lang="ts">
import { ref } from 'vue'
import { t } from '../i18n'
import { state } from '../stores/imageStore'
import { open } from '@tauri-apps/plugin-dialog'

const emit = defineEmits<{
  close: []
}>()

const localSettings = ref({ ...state.settings })



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

function reset() {
  localSettings.value = {
    borderRadius: 4,
    gap: 8,
    bgColor: '#1a1a2e',
    gridSize: 200,
    folderGroup: true,
    showGroupTitle: true,
    filterRegex: '',
    filterTarget: 'name',
    sortBy: 'name',
    sortOrder: 'asc',
    filterPresets: [],
    openWithPrograms: [],
    rootTitleColor: '#ffffff',
    childTitleColor: '#c0c0e0',
    rootTitleBgColor: '#222240',
    childTitleBgColor: '#23234d',
    nodeGridGap: 4,
    rainbowEnabled: false,
    rainbowColors: ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db'],
    language: 'zh',
    viewerBgMode: 'overlay',
    viewerBgColor: '#202020',
    scanAllFiles: false,
    autoPan: true,
    autoCenter: true,
    markColors: ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db'],
  }
}
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
        <div class="settings-body">
          <!-- 语言 -->
          <div class="setting-section">
            <h4>{{ $t('settings.language') }}</h4>
            <div class="setting-row">
              <select v-model="localSettings.language" class="language-select">
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>

          <!-- 格子样式 -->
          <div class="setting-section">
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
          </div>

          <!-- 节点网格 -->
          <div class="setting-section">
            <h4>{{ $t('settings.node_grid') }}</h4>
            <div class="setting-row">
              <label>{{ $t('settings.node_grid_gap') }}</label>
              <input type="range" v-model.number="localSettings.nodeGridGap" min="0" max="40" step="1" />
              <span class="setting-value">{{ localSettings.nodeGridGap }}px</span>
            </div>

          </div>

          <!-- 彩虹层级 -->
          <div class="setting-section">
            <h4>{{ $t('settings.rainbow') }}</h4>
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
          </div>

          <!-- 标记颜色 -->
          <div class="setting-section">
            <h4>{{ $t('settings.mark_colors') }}</h4>
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

          <!-- 标题颜色 -->
          <div class="setting-section">
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
          </div>

          <!-- 大图背景 -->
          <div class="setting-section">
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
          </div>

          <!-- 扫描设置 -->
          <div class="setting-section">
            <h4>{{ $t('settings.scan_all_files') }}</h4>
            <div class="setting-row">
              <label class="toggle-label">
                <input type="checkbox" v-model="localSettings.scanAllFiles" class="toggle-input" />
                <span class="toggle-switch"></span>
                {{ $t('settings.scan_all_files') }}
              </label>
            </div>
            <div class="setting-hint">{{ $t('settings.scan_all_files_hint') }}</div>
          </div>

          <!-- 筛选预设 -->
          <div class="setting-section">
            <h4>{{ $t('settings.filter_presets') }}</h4>
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

          <!-- 其他打开方式 -->
          <div class="setting-section">
            <h4>{{ $t('settings.open_with') }}</h4>
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
        </div>
        <div class="settings-footer">
          <button class="settings-btn secondary" @click="reset">{{ $t('settings.reset') }}</button>
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

.settings-footer {
  padding: 12px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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
