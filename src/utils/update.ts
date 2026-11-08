import { computed, reactive, ref } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'

/** GitHub 仓库 Releases 页面 */
export const RELEASES_URL = 'https://github.com/atakhalo/ImgGroupX/releases'

/** 最新版本接口：GitHub REST API（返回 tag_name / html_url / published_at 等） */
const LATEST_RELEASE_API = 'https://api.github.com/repos/atakhalo/ImgGroupX/releases/latest'

/** 自动检查冷却时间：一天一次 */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/** 启动后延迟多久开始检查（避开首屏渲染与首次扫描） */
const STARTUP_DELAY_MS = 2500

/** 单次请求超时 */
const FETCH_TIMEOUT_MS = 8000

/** localStorage 键：上次检查时间戳 / 缓存的最新版本 / 已忽略版本 */
const KEY_LAST_CHECK = 'imggroup.update.lastCheckAt'
const KEY_CACHED_RELEASE = 'imggroup.update.cachedRelease'
const KEY_IGNORED_VERSION = 'imggroup.update.ignoredVersion'

/** GitHub release 接口中本模块关心的字段 */
interface GithubRelease {
  tag_name?: string
  name?: string
  html_url?: string
  published_at?: string
  body?: string
}

/** 版本信息（缓存与在线结果共用同一结构） */
interface ReleaseInfo {
  version: string
  name?: string
  url?: string
  publishedAt?: string
  notes?: string
}

/** 更新检查状态（全局响应式，设置按钮与设置面板共享） */
export const updateState = reactive({
  /** 当前软件版本（来自 tauri.conf.json，由 Tauri 提供） */
  currentVersion: '',
  /** 最新版本（GitHub 最新 release 的 tag，已去掉 v 前缀） */
  latestVersion: '',
  /** 最新版本页面地址 */
  releaseUrl: RELEASES_URL,
  releaseName: '',
  publishedAt: '',
  releaseNotes: '',
  /** 是否正在请求 */
  checking: false,
  /** 最近一次检查失败原因（空表示无错误） */
  error: '',
})

/** 用户选择忽略的版本（空表示未忽略） */
export const ignoredVersion = ref(readStorage(KEY_IGNORED_VERSION))

/** 是否存在需要提醒的新版本（已忽略的版本不算） */
export const hasUpdate = computed(() => {
  const latest = updateState.latestVersion
  const current = updateState.currentVersion
  if (!latest || !current) return false
  if (ignoredVersion.value && compareVersions(ignoredVersion.value, latest) === 0) return false
  return compareVersions(latest, current) > 0
})

/** 最新版本是否已被用户忽略（用于设置面板显示「已忽略」状态） */
export const latestIgnored = computed(() => {
  const latest = updateState.latestVersion
  if (!latest || !ignoredVersion.value) return false
  return compareVersions(ignoredVersion.value, latest) === 0
})

/** 读取 localStorage（WebView 不可用时静默降级） */
function readStorage(key: string): string {
  try {
    return localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

/** 写入 localStorage，value 为空时删除 */
function writeStorage(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // 隐私模式或存储不可用：忽略，仅本次运行有效
  }
}

/** 去掉版本号前面的 v/V 前缀与空白（如 v1.5.1 → 1.5.1） */
export function normalizeVersion(raw: string): string {
  return String(raw || '').trim().replace(/^v/i, '').trim()
}

/** 解析版本号为数字段（1.6.0-beta → [1,6,0]；无法解析返回空数组） */
function parseVersion(raw: string): number[] {
  const matched = normalizeVersion(raw).match(/\d+(?:\.\d+)*/)
  if (!matched) return []
  return matched[0].split('.').map(n => Number(n))
}

/**
 * 比较两个版本号：a > b 返回 1，a < b 返回 -1，相等返回 0。
 * 缺失的段按 0 处理（1.6 与 1.6.0 视为相同），预发布后缀忽略。
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

/** 应用版本信息到状态；persist 为 true 时写入缓存（在线结果） */
function applyReleaseInfo(info: ReleaseInfo, persist: boolean): void {
  updateState.latestVersion = normalizeVersion(info.version)
  updateState.releaseName = info.name || ''
  updateState.releaseUrl = info.url || RELEASES_URL
  updateState.publishedAt = info.publishedAt || ''
  updateState.releaseNotes = info.notes || ''
  if (persist) {
    writeStorage(KEY_CACHED_RELEASE, JSON.stringify(info))
  }
}

/** 用上次成功检查的缓存结果填充状态（先展示，再静默联网校验） */
function restoreCachedRelease(): void {
  const raw = readStorage(KEY_CACHED_RELEASE)
  if (!raw) return
  try {
    const cached = JSON.parse(raw) as ReleaseInfo
    if (cached && cached.version) applyReleaseInfo(cached, false)
  } catch {
    // 缓存损坏：丢弃，等下次联网结果覆盖
    writeStorage(KEY_CACHED_RELEASE, '')
  }
}

/** 当前版本号只查询一次 */
let currentVersionPromise: Promise<string> | null = null

/** 读取当前软件版本（tauri.conf.json 中的 version） */
async function loadCurrentVersion(): Promise<string> {
  if (updateState.currentVersion) return updateState.currentVersion
  if (!currentVersionPromise) {
    currentVersionPromise = getVersion().catch(() => '')
  }
  updateState.currentVersion = (await currentVersionPromise) || '0.0.0'
  return updateState.currentVersion
}

/** 请求 GitHub 最新 release（带超时） */
async function fetchLatestRelease(): Promise<GithubRelease> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as GithubRelease
  } finally {
    clearTimeout(timer)
  }
}

/** GitHub 返回的 release 转为内部版本信息 */
function toReleaseInfo(release: GithubRelease): ReleaseInfo {
  const version = normalizeVersion(release.tag_name || release.name || '')
  if (!version) throw new Error('无法解析版本号')
  return {
    version,
    name: release.name || '',
    url: release.html_url || RELEASES_URL,
    publishedAt: release.published_at || '',
    notes: release.body || '',
  }
}

/**
 * 检查更新。
 * - 默认受「一天一次」冷却限制：冷却期内直接使用缓存结果，不发起请求；
 * - force = true 时忽略冷却（设置面板的「重新检查」）。
 */
export async function checkForUpdate(options: { force?: boolean } = {}): Promise<void> {
  if (!isTauri() || updateState.checking) return
  await loadCurrentVersion()

  const forced = options.force === true
  const lastCheckAt = Number(readStorage(KEY_LAST_CHECK)) || 0
  const inCooldown = !forced && lastCheckAt > 0 && Date.now() - lastCheckAt < CHECK_INTERVAL_MS
  if (inCooldown) {
    restoreCachedRelease()
    return
  }

  updateState.checking = true
  updateState.error = ''
  try {
    applyReleaseInfo(toReleaseInfo(await fetchLatestRelease()), true)
  } catch (e) {
    updateState.error = e instanceof Error ? e.message : String(e)
  } finally {
    updateState.checking = false
    // 成功或失败都记录检查时间：一天只请求一次，失败可在设置面板手动重试
    writeStorage(KEY_LAST_CHECK, String(Date.now()))
  }
}

/** 忽略当前最新版本（不再提示，直到出现更高版本） */
export function ignoreLatestVersion(): void {
  if (!updateState.latestVersion) return
  ignoredVersion.value = updateState.latestVersion
  writeStorage(KEY_IGNORED_VERSION, ignoredVersion.value)
}

/** 取消忽略（恢复提示） */
export function unignoreVersion(): void {
  ignoredVersion.value = ''
  writeStorage(KEY_IGNORED_VERSION, '')
}

/**
 * 启动时初始化更新检查：先用缓存结果点亮红点，再按冷却规则静默联网校验。
 * 仅 Tauri 环境生效（纯浏览器调试时跳过）。
 */
export function initUpdateCheck(): void {
  restoreCachedRelease()
  if (!isTauri()) return
  void loadCurrentVersion()
  setTimeout(() => {
    void checkForUpdate()
  }, STARTUP_DELAY_MS)
}
