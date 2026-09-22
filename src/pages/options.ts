/**
 * 设置页控制器 v5 — 纯浏览器模式，File System Access API + 产物配置。
 */
import type { PlatformKey } from '../types/platform.js';
import type { ExtensionConfig } from '../types/config.js';
import type { ArtifactConfig, ArtifactDefinition } from '../types/artifacts.js';
import { logger } from '../lib/logger.js';
import { loadConfig, saveConfig, getFallbackDirectoryPathByPlatform, CLOUDPIVOT_READONLY_SETTINGS, H3YUN_READONLY_SETTINGS } from '../services/config.js';
import { CONTROL_TYPE_REFERENCE, H3YUN_CONTROL_TYPE_REFERENCE } from '../lib/platform/control-metadata.js';
import { ARTIFACT_TEMPLATE_VARIABLES, buildDefaultArtifactConfig, findDuplicateArtifactPaths } from '../lib/platform/artifacts.js';
import {
  ARTIFACT_PLATFORM_KEYS,
  createCustomArtifact,
  getPlatformArtifacts,
  loadArtifactConfig,
  resetArtifactConfig,
  saveArtifactConfig,
} from '../services/artifacts.js';
import { PLATFORM_LABELS } from '../lib/constants.js';
import { normalizeArtifactPath } from '../lib/utils.js';
import { buildDiagnosticPackage, saveLastDiagnosticPackage, loadLastDiagnosticPackage } from '../services/preflight-diagnostics.js';
import { fetchLatestRelease, isUpToDate, hasNewerVersion, type LatestReleaseInfo } from '../services/update-checker.js';
import { CURRENT_EXTENSION_VERSION } from '../lib/release-notes.js';
import { saveDefaultDirectoryHandle, getDefaultDirectoryHandle } from '../lib/directory/file-handle-db.js';
import { selectPlatformDefaultDirectory, supportsDirectoryPicker } from '../services/target-directory-access.js';

// ── 工具 ──────────────────────────────────────────────

function $(sel: string): HTMLElement | null { return document.querySelector(sel) as HTMLElement | null; }
function $$<T extends HTMLElement = HTMLElement>(sel: string): NodeListOf<T> {
  return document.querySelectorAll(sel) as unknown as NodeListOf<T>;
}
function escapeHtml(s: string): string {
  const m: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return s.replace(/[&<>"']/g, (ch) => m[ch] || ch);
}

function showToast(msg: string, type: 'success' | 'error' | 'info' = 'info'): void {
  const el = $('.toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast toast-${type} toast-visible`;
  el.removeAttribute('hidden');
  setTimeout(() => { el.className = 'toast'; el.setAttribute('hidden', ''); }, 2500);
}

// ── 状态 ──────────────────────────────────────────────

const COLLAPSE_STATE_KEY = 'optionsCollapseState';
/** 当前停留的分区（顶部导航项），下次打开设置页时恢复 */
const ACTIVE_SECTION_KEY = 'optionsActiveSection';

const state = {
  config: null as ExtensionConfig | null,
  artifacts: null as ArtifactConfig | null,
  /** 当前展开编辑的产物（`平台:产物id`）；同时只允许展开一个，避免页面被撑得过长 */
  expandedArtifactKey: null as string | null,
  activeHelpPlatform: 'cloudpivot' as 'cloudpivot' | 'h3yun',
  collapseStateCache: {} as Record<string, boolean>,
};

/** 确认弹窗语义色调：破坏性操作（删除 / 重置 / 丢弃改动）用危险色，其余用主色 */
type ConfirmTone = 'primary' | 'danger';

async function showConfirm(message: string, tone: ConfirmTone = 'primary'): Promise<boolean> {
  const overlay = $('#confirm-overlay');
  const msgEl = $('#confirm-message');
  const okBtn = $('#confirm-ok-btn');
  if (!overlay || !msgEl || !okBtn) return false;

  msgEl.textContent = message;
  // 确认按钮颜色跟随操作性质：危险操作红、普通操作主色（颜色语义见 buttons.css）
  okBtn.classList.toggle('btn-primary', tone === 'primary');
  okBtn.classList.toggle('btn-danger', tone === 'danger');
  overlay.removeAttribute('hidden');
  return new Promise<boolean>((resolve) => {
    const cleanup = (result: boolean) => {
      overlay.setAttribute('hidden', '');
      $('#confirm-ok-btn')?.removeEventListener('click', onOk);
      $('#confirm-cancel-btn')?.removeEventListener('click', onCancel);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    $('#confirm-ok-btn')?.addEventListener('click', onOk, { once: true });
    $('#confirm-cancel-btn')?.addEventListener('click', onCancel, { once: true });
  });
}

// ── 未保存改动（脏状态） ───────────────────────────────

/** 只有「文件助手」有可保存的配置；其余分区没有配置项 */
const ARTIFACT_SECTION = 'filehelper';
const SECTION_SCOPED_ACTIONS = ['#save-btn', '#factory-reset-btn', '#reset-btn'] as const;

/** 已保存内容快照：仅产物配置与氚云一键回写开关会变化（默认目录绑定即持久化，不参与） */
let savedSnapshot = '';

function buildConfigSnapshot(): string {
  if (!state.artifacts || !state.config) return '';
  return JSON.stringify({
    artifacts: state.artifacts,
    h3yunOneClickWriteback: state.config.h3yunOneClickWriteback,
  });
}

/** 判定当前是否存在未保存改动 */
function isDirty(): boolean {
  return savedSnapshot !== '' && buildConfigSnapshot() !== savedSnapshot;
}

/**
 * 刷新脏状态相关 UI。
 *
 * 无改动时「保存」降为次要观感（`is-clean`），有改动才恢复主色，并在「文件助手」
 * 导航项右上角显示小圆点，解决「按钮常亮、用户不知道要不要保存」。
 */
function refreshDirtyState(): void {
  const dirty = isDirty();

  const saveBtn = $('#save-btn');
  if (saveBtn) {
    // 颜色语义：有改动 = 主色（提交类），无改动 = 中性（无可提交内容）
    saveBtn.classList.toggle('btn-primary', dirty);
    saveBtn.classList.toggle('btn-neutral', !dirty);
    saveBtn.setAttribute('title', dirty ? '有未保存的改动' : '当前没有未保存的改动');
  }

  const navItem = document.querySelector<HTMLElement>(`.segmented-item[data-nav-target="${ARTIFACT_SECTION}"]`);
  if (navItem) navItem.classList.toggle('has-changes', dirty);
}

/** 把当前内容记为「已保存」基线（初始化与保存 / 撤销成功后调用） */
function captureSavedSnapshot(): void {
  savedSnapshot = buildConfigSnapshot();
  refreshDirtyState();
}

/** 「已保存 / 已恢复」反馈保持时长（ms） */
const SAVED_FEEDBACK_MS = 1200;

/**
 * 短暂显示按钮的成功态（复用既有 .is-saved / .is-reset 样式），结束后回调刷新脏状态。
 * @param stateClass 成功态类名（保存用 is-saved，恢复默认用 is-reset）
 */
function flashButtonState(selector: string, stateClass: 'is-saved' | 'is-reset', onDone?: () => void): void {
  const btn = $(selector);
  if (!btn) return;

  btn.classList.add(stateClass, 'btn-success');
  window.setTimeout(() => {
    btn.classList.remove(stateClass, 'btn-success');
    if (onDone) onDone();
  }, SAVED_FEEDBACK_MS);
}

/** 通用下拉开合：点击按钮切换，点击外部 / 菜单项 / Esc 关闭 */
function bindDropdown(buttonSelector: string, menuSelector: string): void {
  const btn = $(buttonSelector);
  const menu = $(menuSelector);
  if (!btn || !menu) return;

  const close = (): void => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };

  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });

  menu.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('.dropdown-item')) close();
  });

  document.addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) close();
  });
}

// ── 1. 文件助手（File System Access API + 产物配置） ──

/** 分区渲染顺序：抓取产物在前，可自定义产物在后 */
const ARTIFACT_ZONE_ORDER: readonly ArtifactDefinition['kind'][] = ['capture', 'template'];

/** 渲染全部平台的产物分区 */
function renderAllArtifactZones(): void {
  const config = state.artifacts ?? buildDefaultArtifactConfig();
  for (const platformKey of ARTIFACT_PLATFORM_KEYS) {
    const artifacts = getPlatformArtifacts(config, platformKey);
    for (const kind of ARTIFACT_ZONE_ORDER) {
      renderArtifactZone(platformKey, kind, artifacts.filter((artifact) => artifact.kind === kind));
    }
  }
  applyArtifactEditorState();
}

function renderArtifactZone(
  platformKey: PlatformKey,
  kind: ArtifactDefinition['kind'],
  artifacts: readonly ArtifactDefinition[],
): void {
  const container = $(`#artifacts-${platformKey}-${kind}`);
  if (!container) return;
  container.innerHTML = artifacts
    .map((artifact) => (kind === 'capture'
      ? renderCaptureArtifactRow(artifact, platformKey)
      : renderTemplateArtifactCard(artifact, platformKey)))
    .join('');
}

/** 抓取产物：只有开关，路径与内容不可编辑 */
function renderCaptureArtifactRow(artifact: ArtifactDefinition, platformKey: PlatformKey): string {
  // title 提供被省略的完整名称（窄列时标签会 ellipsis）
  return `
    <label class="toggle-inline artifact-capture-row" data-artifact-id="${escapeHtml(artifact.id)}" data-artifact-platform="${escapeHtml(platformKey)}" title="${escapeHtml(artifact.label)}">
      <input type="checkbox" data-artifact-field="enabled" ${artifact.enabled ? 'checked' : ''}>
      <span class="toggle-track" aria-hidden="true"></span>
      <span class="artifact-capture-label">${escapeHtml(artifact.label)}</span>
    </label>
  `;
}

/** 产物卡片在 DOM 中的唯一键（同一 id 在不同平台下会重复，必须带平台） */
function artifactCardKey(card: HTMLElement): string {
  const platformKey = card.dataset.artifactPlatform ?? '';
  const artifactId = card.dataset.artifactId ?? '';
  return platformKey && artifactId ? `${platformKey}:${artifactId}` : '';
}

/**
 * 可自定义产物：摘要行 + 折叠编辑区。
 *
 * 折叠而非全展开，是为了让产物数量增长时页面长度保持稳定；编辑区里默认内容
 * 文本框给足高度并可拖拽，避免写模板时反复滚动。
 */
function renderTemplateArtifactCard(artifact: ArtifactDefinition, platformKey: PlatformKey): string {
  const variables = ARTIFACT_TEMPLATE_VARIABLES.map((variable) =>
    `<button type="button" class="btn-neutral ghost-btn-sm artifact-var-btn" data-artifact-var="${escapeHtml(variable.token)}">${escapeHtml(variable.label)}</button>`,
  ).join('');
  const deleteBtn = artifact.builtin
    ? ''
    : '<button type="button" class="btn-danger ghost-btn-sm artifact-delete-btn" data-artifact-delete="1">删除</button>';
  const resolvedPath = normalizeArtifactPath(artifact.dirPath, artifact.fileName) || '（未设置路径）';

  return `
    <div class="artifact-card" data-artifact-id="${escapeHtml(artifact.id)}" data-artifact-platform="${escapeHtml(platformKey)}">
      <div class="artifact-summary">
        <label class="toggle-inline" title="启用 / 关闭">
          <input type="checkbox" data-artifact-field="enabled" ${artifact.enabled ? 'checked' : ''}>
          <span class="toggle-track" aria-hidden="true"></span>
        </label>
        <button type="button" class="artifact-summary-main" data-artifact-toggle-edit>
          <span class="artifact-summary-name">${escapeHtml(artifact.label)}</span>
          <span class="artifact-summary-path">${escapeHtml(resolvedPath)}</span>
          <span class="artifact-summary-action">编辑</span>
        </button>
        ${deleteBtn}
      </div>
      <div class="artifact-editor" hidden>
        <div class="artifact-field-row">
          <label class="artifact-field">
            <span class="artifact-field-label">名称（仅设置页显示）</span>
            <input type="text" data-artifact-field="label" value="${escapeHtml(artifact.label)}" placeholder="产物名称">
          </label>
          <label class="artifact-field">
            <span class="artifact-field-label">路径（相对目标目录，留空为根目录）</span>
            <input type="text" data-artifact-field="dirPath" value="${escapeHtml(artifact.dirPath)}" placeholder="design/">
          </label>
          <label class="artifact-field">
            <span class="artifact-field-label">文件名（留空则只建文件夹）</span>
            <input type="text" data-artifact-field="fileName" value="${escapeHtml(artifact.fileName)}" placeholder="design-js.md">
          </label>
        </div>
        <label class="artifact-field">
          <span class="artifact-field-label">默认内容（支持 {{变量}}）</span>
          <textarea class="artifact-content-input" rows="12" data-artifact-field="defaultContent">${escapeHtml(artifact.defaultContent)}</textarea>
        </label>
        <div class="artifact-variable-row">
          <span class="artifact-field-label">插入变量</span>
          ${variables}
        </div>
        <p class="artifact-note">已存在则跳过，不覆盖已有内容；变量只在首次生成时替换。</p>
      </div>
    </div>
  `;
}

/** 按 state.expandedArtifactKey 同步编辑区的展开状态（手风琴：同时只展开一个） */
function applyArtifactEditorState(): void {
  for (const card of $$<HTMLElement>('.artifact-card')) {
    const editor = card.querySelector<HTMLElement>('.artifact-editor');
    if (!editor) continue;
    const open = artifactCardKey(card) === state.expandedArtifactKey;
    editor.hidden = !open;
    card.classList.toggle('is-expanded', open);
    const action = card.querySelector<HTMLElement>('.artifact-summary-action');
    if (action) action.textContent = open ? '收起' : '编辑';
  }
}

/** 展开 / 收起某个产物的编辑区 */
function toggleArtifactEditor(card: HTMLElement): void {
  const key = artifactCardKey(card);
  if (!key) return;
  syncArtifactsFromDom();
  state.expandedArtifactKey = state.expandedArtifactKey === key ? null : key;
  applyArtifactEditorState();
}

/** 把编辑区里的名称 / 路径 / 文件名回显到摘要行 */
function refreshArtifactSummary(card: HTMLElement): void {
  const read = (field: string): string =>
    card.querySelector<HTMLInputElement>(`[data-artifact-field="${field}"]`)?.value ?? '';
  const nameEl = card.querySelector<HTMLElement>('.artifact-summary-name');
  const pathEl = card.querySelector<HTMLElement>('.artifact-summary-path');
  if (nameEl) nameEl.textContent = read('label').trim() || '（未命名）';
  if (pathEl) pathEl.textContent = normalizeArtifactPath(read('dirPath'), read('fileName')) || '（未设置路径）';
}

/** 从 DOM 回读产物配置，保持 state.artifacts 与界面一致 */
function syncArtifactsFromDom(): void {
  if (!state.artifacts) return;
  for (const platformKey of ARTIFACT_PLATFORM_KEYS) {
    for (const artifact of getPlatformArtifacts(state.artifacts, platformKey)) {
      const card = document.querySelector<HTMLElement>(
        `[data-artifact-platform="${platformKey}"][data-artifact-id="${CSS.escape(artifact.id)}"]`,
      );
      if (!card) continue;

      for (const field of card.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-artifact-field]')) {
        const name = field.dataset.artifactField;
        if (name === 'enabled') { artifact.enabled = (field as HTMLInputElement).checked; continue; }
        if (name === 'label') { artifact.label = field.value; continue; }
        if (name === 'dirPath') { artifact.dirPath = field.value; continue; }
        if (name === 'fileName') { artifact.fileName = field.value; continue; }
        if (name === 'defaultContent') { artifact.defaultContent = field.value; }
      }
    }
  }
}

/** 在默认内容光标处插入变量占位符 */
function insertTemplateVariable(card: HTMLElement, token: string): void {
  const textarea = card.querySelector<HTMLTextAreaElement>('[data-artifact-field="defaultContent"]');
  if (!textarea) return;

  const snippet = `{{${token}}}`;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  textarea.value = `${textarea.value.slice(0, start)}${snippet}${textarea.value.slice(end)}`;

  const caret = start + snippet.length;
  textarea.setSelectionRange(caret, caret);
  textarea.focus();
  syncArtifactsFromDom();
}

/** 新增一条自定义产物（新增后直接展开编辑区，省一次点击） */
function handleAddArtifact(platformKey: PlatformKey): void {
  if (!state.artifacts) return;
  syncArtifactsFromDom();
  const artifact = createCustomArtifact();
  state.artifacts[platformKey] = [...getPlatformArtifacts(state.artifacts, platformKey), artifact];
  state.expandedArtifactKey = `${platformKey}:${artifact.id}`;
  renderAllArtifactZones();
  showToast(`已在「${PLATFORM_LABELS[platformKey]}」新增一条产物，保存后生效`, 'info');
}

/** 删除一条自定义产物（内置产物不可删除） */
async function handleDeleteArtifact(card: HTMLElement): Promise<void> {
  if (!state.artifacts) return;
  const platformKey = card.dataset.artifactPlatform as PlatformKey | undefined;
  const artifactId = card.dataset.artifactId;
  if (!platformKey || !artifactId) return;

  const artifact = getPlatformArtifacts(state.artifacts, platformKey).find((item) => item.id === artifactId);
  if (!artifact) return;
  if (artifact.builtin) {
    showToast('内置产物不可删除，直接关闭开关即可', 'error');
    return;
  }
  if (!await showConfirm(`确定删除产物「${artifact.label}」？`, 'danger')) return;

  syncArtifactsFromDom();
  state.artifacts[platformKey] = getPlatformArtifacts(state.artifacts, platformKey)
    .filter((item) => item.id !== artifactId);
  if (state.expandedArtifactKey === `${platformKey}:${artifactId}`) state.expandedArtifactKey = null;
  renderAllArtifactZones();
  showToast('已删除，保存后生效', 'info');
}

/** 校验产物路径：同平台内重名会互相覆盖，禁止保存 */
function validateArtifactPaths(): boolean {
  if (!state.artifacts) return true;
  for (const platformKey of ARTIFACT_PLATFORM_KEYS) {
    const duplicates = findDuplicateArtifactPaths(getPlatformArtifacts(state.artifacts, platformKey));
    if (duplicates.length > 0) {
      showToast(`${PLATFORM_LABELS[platformKey]}产物路径重复：${duplicates.join('、')}`, 'error');
      return false;
    }
  }
  return true;
}

/** 产物区事件委托（渲染后无需重新绑定） */
function bindArtifactEvents(): void {
  const root = $('[data-section="filehelper"]');
  if (!root) return;

  const onEdit = (): void => {
    syncArtifactsFromDom();
    syncH3yunWritebackFromDom();
    refreshAllArtifactSummaries();
    refreshDirtyState();
  };
  root.addEventListener('input', onEdit);
  root.addEventListener('change', onEdit);

  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    const addBtn = target.closest('[data-artifact-add]') as HTMLElement | null;
    if (addBtn) {
      const platformKey = addBtn.dataset.artifactAdd as PlatformKey | undefined;
      if (platformKey) handleAddArtifact(platformKey);
      return;
    }

    const varBtn = target.closest('[data-artifact-var]') as HTMLElement | null;
    if (varBtn) {
      const card = varBtn.closest('.artifact-card') as HTMLElement | null;
      const token = varBtn.dataset.artifactVar;
      if (card && token) insertTemplateVariable(card, token);
      return;
    }

    const deleteBtn = target.closest('[data-artifact-delete]') as HTMLElement | null;
    if (deleteBtn) {
      const card = deleteBtn.closest('.artifact-card') as HTMLElement | null;
      if (card) void handleDeleteArtifact(card);
      return;
    }

    const toggleBtn = target.closest('[data-artifact-toggle-edit]') as HTMLElement | null;
    if (toggleBtn) {
      const card = toggleBtn.closest('.artifact-card') as HTMLElement | null;
      if (card) toggleArtifactEditor(card);
    }
  });
}

/** 刷新全部产物卡片的摘要行（编辑区输入后保持摘要同步） */
function refreshAllArtifactSummaries(): void {
  for (const card of $$<HTMLElement>('.artifact-card')) refreshArtifactSummary(card);
}

// ── 1.5 氚云一键回写开关 ──────────────────────────────

function renderH3yunWritebackToggle(): void {
  const checkbox = $('#h3yun-oneclick-writeback') as HTMLInputElement | null;
  if (checkbox && state.config) checkbox.checked = state.config.h3yunOneClickWriteback;
}

function syncH3yunWritebackFromDom(): void {
  if (!state.config) return;
  const checkbox = $('#h3yun-oneclick-writeback') as HTMLInputElement | null;
  state.config = { ...state.config, h3yunOneClickWriteback: checkbox?.checked ?? true };
}

// ── 2. 默认目录（双行并行） ───────────────────────────

/**
 * 渲染平台默认目录。
 *
 * 只显示「已绑定句柄」的目录名：默认目录必须通过「浏览」绑定句柄，浏览器才可能授权
 * 读写该目录。仅填写路径文本无法定位目录（File System Access 限制），会误导用户
 * 以为已配置——表现为弹窗定位不到默认目录、选择器只能打开系统默认位置。
 */
function renderDefaultDirs(): void {
  void syncDefaultDirInputsFromHandles();
}

/** 从已绑定句柄回填默认目录输入框（句柄是唯一真源），并暴露「已填路径但未绑定」状态 */
async function syncDefaultDirInputsFromHandles(): Promise<void> {
  const paths = await readBoundDefaultDirectoryPaths();
  for (const platformKey of ARTIFACT_PLATFORM_KEYS) {
    setDefaultDirValue(platformKey, paths[platformKey] || '');
    renderUnboundDirHint(platformKey, Boolean(paths[platformKey]));
  }
}

/**
 * 渲染「已填写路径但未绑定句柄」提示。
 *
 * 路径文本无法被浏览器授权（File System Access 只能通过句柄访问目录），这类配置在
 * 弹窗里定位不到，表现为选择器打开到系统默认位置。这里把残留的路径显示出来并给出
 * 绑定指引，避免它只在弹窗报错里出现、设置页却看不到。
 */
function renderUnboundDirHint(platformKey: PlatformKey, bound: boolean): void {
  const hint = $(platformKey === 'h3yun' ? '#default-dir-h3yun-hint' : '#default-dir-cloudpivot-hint');
  if (!hint) return;

  const configuredPath = state.config ? getFallbackDirectoryPathByPlatform(state.config, platformKey) : '';
  if (bound || !configuredPath) {
    hint.hidden = true;
    hint.textContent = '';
    return;
  }

  hint.innerHTML = `已填写路径 <code>${escapeHtml(configuredPath)}</code>，但未绑定访问句柄，无法定位该目录。`
    + `请点「浏览」选择该目录完成绑定（可在系统对话框中直接粘贴上面的路径）；仅填写路径不会生效。`;
  hint.hidden = false;
}

/**
 * 读取各平台「已绑定默认目录」的名称。
 * 句柄是唯一真源：未绑定句柄的平台一律返回空串，避免出现「有路径、无句柄」的假配置。
 */
async function readBoundDefaultDirectoryPaths(): Promise<Partial<Record<PlatformKey, string>>> {
  const paths: Partial<Record<PlatformKey, string>> = {};
  for (const platformKey of ARTIFACT_PLATFORM_KEYS) {
    const handle = await getDefaultDirectoryHandle(platformKey);
    paths[platformKey] = handle?.name || '';
  }
  return paths;
}

/** 回填单个平台的默认目录输入框 */
function setDefaultDirValue(platformKey: PlatformKey, value: string): void {
  const input = $(platformKey === 'h3yun' ? '#default-dir-h3yun' : '#default-dir-cloudpivot') as HTMLInputElement | null;
  if (input) input.value = value;
}

/**
 * 把已绑定句柄名写入配置（句柄是唯一真源）。
 *
 * 绑定后立即持久化，使默认目录「绑定即生效」，不再依赖顶栏「保存」；
 * 同时清掉遗留的手填路径，避免出现「有路径、无句柄」的假配置。
 */
async function persistBoundDefaultDirectoryPaths(): Promise<void> {
  await saveConfig({ fallbackDirectoryPaths: await readBoundDefaultDirectoryPaths() });
  state.config = await loadConfig();
  await syncDefaultDirInputsFromHandles();
}

/**
 * 通过原生目录选择器浏览并绑定平台默认目录（保存句柄 + 回填目录名）。
 *
 * 初始位置由 selectPlatformDefaultDirectory 统一决定：只用本平台自己的默认目录句柄，
 * 尚未配置时用中性位置，避免选择器停在另一个平台的默认目录上而绑错工作目录。
 */
async function pickDefaultDirectory(platformKey: PlatformKey): Promise<void> {
  if (!supportsDirectoryPicker()) {
    showToast('当前浏览器不支持目录选择，请使用 Chrome 86+ 或 Edge 86+', 'error');
    return;
  }
  try {
    const handle = await selectPlatformDefaultDirectory(platformKey);
    if (!handle) return; // 用户取消

    const label = handle.name || '';
    await saveDefaultDirectoryHandle(handle, platformKey);
    setDefaultDirValue(platformKey, label);
    // 绑定即生效：句柄名立刻写回配置，不再依赖顶栏「保存」
    await persistBoundDefaultDirectoryPaths();
    showToast(label ? `已绑定默认目录：${label}` : '已绑定默认目录', 'success');
  } catch (error: unknown) {
    logger.error('选择默认目录失败', { error: String(error) });
    showToast('选择目录失败', 'error');
  }
}

// ── 3. 使用说明 ───────────────────────────────────────

function setActiveHelpPlatform(key: 'cloudpivot' | 'h3yun'): void {
  state.activeHelpPlatform = key;
  for (const t of $$('[data-help-platform]')) {
    const on = t.dataset.helpPlatform === key;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  for (const p of $$('[data-help-panel]')) {
    p.hidden = p.dataset.helpPanel !== key;
  }
}

function renderHelpSection(): void {
  const cpBody = $('#cloudpivot-control-ref-body');
  if (cpBody) cpBody.innerHTML = CONTROL_TYPE_REFERENCE.map(c => `<tr><td>${escapeHtml(c.tagName)}</td><td>${escapeHtml(c.typeName)}</td><td>${escapeHtml(c.notes)}</td></tr>`).join('');
  const hyBody = $('#h3yun-control-ref-body');
  if (hyBody) {
    // 氚云表多一列「读取」：明确区分需要读取与需要忽略（布局 / 容器 / 说明类）的控件类型
    hyBody.innerHTML = H3YUN_CONTROL_TYPE_REFERENCE.map((c) => {
      const readLabel = c.readMode === 'read' ? '读取' : '不读取';
      return `<tr><td>${escapeHtml(c.typeCode)}</td><td>${escapeHtml(c.typeName)}</td>`
        + `<td>${escapeHtml(readLabel)}</td><td>${escapeHtml(c.notes)}</td></tr>`;
    }).join('');
  }
  const cpRules = $('#cloudpivot-rules-list');
  const hyRules = $('#h3yun-rules-list');
  if (cpRules) cpRules.innerHTML = CLOUDPIVOT_READONLY_SETTINGS.map(s => `<li>${escapeHtml(s)}</li>`).join('');
  if (hyRules) hyRules.innerHTML = H3YUN_READONLY_SETTINGS.map(s => `<li>${escapeHtml(s)}</li>`).join('');
  setActiveHelpPlatform('cloudpivot');
}

// ── 4. 问题排查 ───────────────────────────────────────

function updateDiagnosticInfo(): void {
  const m = chrome.runtime.getManifest();
  setText('#diag-version', `${m.name || '开发助手'} v${m.version || ''}`);
  setHtml('#diag-permissions', (m.permissions || []).map(p => `<code>${escapeHtml(p)}</code>`).join(', ') || '无');
  setText('#diag-browser', navigator.userAgent);
  const fsa = $('#diag-file-access');
  if (fsa) {
    fsa.innerHTML = supportsDirectoryPicker()
      ? '<span style="color:green;">&#10003; 已支持</span> File System Access API'
      : '<span style="color:red;">&#10007; 不支持</span> 请使用 Chrome 86+ 或 Edge 86+';
  }
}

function setText(sel: string, v: string): void { const el = $(sel); if (el) el.textContent = v; }
function setHtml(sel: string, v: string): void { const el = $(sel); if (el) el.innerHTML = v; }

async function handleDiagHealthCheck(): Promise<void> {
  try {
    updateDiagnosticInfo();
    const pkg = buildDiagnosticPackage({
      operationId: 'diagHealthCheck', browser: { userAgent: navigator.userAgent }, extension: { name: '开发助手', version: CURRENT_EXTENSION_VERSION },
    } as Record<string, unknown>);
    await saveLastDiagnosticPackage(pkg as unknown as Record<string, unknown>);
    showToast('全面检查完成', 'success');
    const summary = $('#last-diagnostic-summary'); const output = $('#status-output');
    if (summary) summary.textContent = `最近诊断: ${new Date().toLocaleString('zh-CN')}`;
    if (output) output.textContent = JSON.stringify(pkg, null, 2);
  } catch (err: unknown) {
    logger.error('全面检查失败', { error: String(err) });
    showToast(`检查失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

async function handleDiagCopyAll(): Promise<void> {
  try {
    const m = chrome.runtime.getManifest();
    const fsa = supportsDirectoryPicker() ? 'supported' : 'not supported';
    await navigator.clipboard.writeText(`fileSystemAccess: ${fsa}\n${m.name} v${m.version}\nbrowser: ${navigator.userAgent}\npermissions: ${(m.permissions||[]).join(', ')}`);
    showToast('已复制', 'success');
  } catch (err: unknown) {
    logger.error('复制诊断失败', { error: String(err) });
    showToast(`复制失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

async function handleDiagCopySummary(): Promise<void> {
  try {
    const pkg = buildDiagnosticPackage({} as Record<string, unknown>);
    const summary = JSON.stringify(pkg, null, 2);
    await navigator.clipboard.writeText(summary);
    showToast('摘要已复制', 'success');
  } catch (err: unknown) {
    logger.error('复制摘要失败', { error: String(err) });
    showToast(`复制失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

async function handleDiagExportLast(): Promise<void> {
  try {
    const pkg = await loadLastDiagnosticPackage();
    if (!pkg) { showToast('暂无诊断数据，请先执行全面检查', 'info'); return; }
    const text = JSON.stringify(pkg, null, 2);
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `cloudpiovt-diagnostic-${new Date().toISOString().slice(0,19).replace(/[T:]/g,'-')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast('诊断包已导出', 'success');
  } catch (err: unknown) {
    logger.error('导出诊断失败', { error: String(err) });
    showToast(`导出失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

async function handleDiagExport(): Promise<void> {
  try {
    const pkg = buildDiagnosticPackage({ operationId: 'diagExport', browser: { userAgent: navigator.userAgent }, extension: { name: '开发助手', version: CURRENT_EXTENSION_VERSION } } as Record<string, unknown>);
    const text = JSON.stringify(pkg, null, 2);
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `cloudpiovt-diagnostic-${new Date().toISOString().slice(0,19).replace(/[T:]/g,'-')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast('诊断包已导出', 'success');
  } catch (err: unknown) {
    logger.error('导出 JSON 失败', { error: String(err) });
    showToast(`导出失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

// ── 4.5 项目更新 ─────────────────────────────────────

let latestRelease: LatestReleaseInfo | null = null;

function renderUpdateResult(): void {
  const resultEl = $('#update-result');
  const statusEl = $('#update-status-text');
  const actionsEl = $('#update-actions');
  const downloadLink = $('#update-download-link') as HTMLAnchorElement | null;
  const openLink = $('#update-open-link') as HTMLAnchorElement | null;
  if (!resultEl || !statusEl || !actionsEl || !downloadLink || !openLink) return;

  if (!latestRelease) {
    resultEl.hidden = true;
    actionsEl.hidden = true;
    return;
  }

  resultEl.hidden = false;
  // 始终把「前往下载页面」指向 GitHub Release 页（即使已是最新也可查看历史版本）
  openLink.href = latestRelease.htmlUrl;

  if (isUpToDate(latestRelease)) {
    statusEl.textContent = `当前已是最新版本 v${CURRENT_EXTENSION_VERSION}，无需更新。`;
    actionsEl.hidden = true;
    return;
  }

  const published = latestRelease.publishedAt
    ? new Date(latestRelease.publishedAt).toLocaleString('zh-CN')
    : '未知';
  statusEl.textContent = `发现新版本 v${latestRelease.version}（发布于 ${published}）。点击「下载最新版」保存 zip 安装包，或在浏览器中解压后侧载。`;
  actionsEl.hidden = false;
  if (latestRelease.zipUrl) {
    downloadLink.href = latestRelease.zipUrl;
    downloadLink.download = latestRelease.zipName || `${latestRelease.tagName}.zip`;
    downloadLink.hidden = false;
  } else {
    downloadLink.hidden = true;
  }
}

async function handleCheckUpdate(): Promise<void> {
  const btn = $('#update-check-btn') as HTMLButtonElement | null;
  if (!btn) return;
  if (btn.classList.contains('is-running')) return;
  btn.classList.add('is-running');
  btn.disabled = true;
  try {
    latestRelease = await fetchLatestRelease();
    renderUpdateResult();
    showToast(
      hasNewerVersion(latestRelease)
        ? `发现新版本 v${latestRelease.version}`
        : '已是最新版本',
      hasNewerVersion(latestRelease) ? 'info' : 'success',
    );
  } catch (err: unknown) {
    latestRelease = null;
    renderUpdateResult();
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('检查更新失败', { error: msg });
    showToast(`检查更新失败: ${msg}`, 'error');
  } finally {
    btn.classList.remove('is-running');
    btn.disabled = false;
  }
}

// ── 5. 保存 / 重置 ────────────────────────────────────

async function handleSubmit(): Promise<void> {
  syncArtifactsFromDom();
  syncH3yunWritebackFromDom();
  if (!state.config || !state.artifacts) return;
  if (!validateArtifactPaths()) return;

  try {
    state.artifacts = await saveArtifactConfig(state.artifacts);
    // 默认目录以「已绑定句柄」为唯一真源：路径字符串随句柄派生，
    // 未绑定句柄的平台写空，避免留下「有路径、无句柄」的假配置
    await saveConfig({
      h3yunOneClickWriteback: state.config.h3yunOneClickWriteback,
      fallbackDirectoryPaths: await readBoundDefaultDirectoryPaths(),
    });
    state.config = await loadConfig();
    renderAllConfigUI(state.config);
    captureSavedSnapshot();
    flashButtonState('#save-btn', 'is-saved', refreshDirtyState);
    showToast('配置已保存', 'success');
  } catch (err: unknown) {
    logger.error('保存配置失败', { error: String(err) });
    showToast(`保存失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

/** 恢复出厂产物配置（自定义产物与全部改动都会丢失） */
async function handleFactoryReset(): Promise<void> {
  if (!await showConfirm('确定恢复产物默认配置？自定义产物与所有修改都会丢失。', 'danger')) return;
  try {
    state.artifacts = await resetArtifactConfig();
    renderAllArtifactZones();
    // 恢复出厂配置后属于「有未保存改动」：保存按钮恢复主色并提示，需再点「保存」落地
    flashButtonState('#factory-reset-btn', 'is-reset', refreshDirtyState);
    showToast('已恢复产物默认配置，记得点「保存」生效', 'success');
  } catch (err: unknown) {
    logger.error('恢复默认失败', { error: String(err) });
    showToast(`恢复默认失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

/** 丢弃未保存改动，还原为当前已保存的设置 */
async function handleReset(): Promise<void> {
  if (!await showConfirm('确定丢弃未保存的改动？', 'danger')) return;
  state.config = await loadConfig();
  state.artifacts = await loadArtifactConfig();
  renderAllConfigUI(state.config);
  captureSavedSnapshot();
  showToast('已还原为当前保存的设置', 'info');
}

function renderAllConfigUI(config: ExtensionConfig): void {
  renderAllArtifactZones();
  renderH3yunWritebackToggle();
  renderDefaultDirs();
}

// ── 6. 顶部导航 / 分区切换 / 折叠 ─────────────────────

function loadCollapse(): Record<string, boolean> { return state.collapseStateCache; }
function saveCollapse(next: Record<string, boolean>): void { state.collapseStateCache = next; void chrome.storage.local.set({ [COLLAPSE_STATE_KEY]: next }); }

/** 分区 key 顺序（以 DOM 顺序为准，第一个为默认分区） */
function listSectionKeys(): string[] {
  return Array.from($$<HTMLElement>('section[data-section]'))
    .map((sec) => sec.dataset.section || '')
    .filter(Boolean);
}

/**
 * 切换当前展示的分区。
 *
 * 顶部导航每项只展示自己对应的分区（其余 hidden），不再把所有分区堆叠在一页；
 * 切换时同步导航激活态、展开目标分区（避免切过去只看到折叠标题）并回到页首。
 * 「保存 / 恢复默认 / 撤销」仅在有配置可存的分区显示，避免出现死按钮。
 */
function setActiveSection(key: string, options: { persist?: boolean } = {}): void {
  const keys = listSectionKeys();
  const target = keys.includes(key) ? key : keys[0] || '';
  if (!target) return;

  for (const item of $$<HTMLElement>('.segmented-item[data-nav-target]')) {
    const isActive = item.dataset.navTarget === target;
    item.classList.toggle('is-active', isActive);
    item.setAttribute('aria-selected', isActive ? 'true' : 'false');
  }

  for (const sec of $$<HTMLElement>('section[data-section]')) {
    const isActive = sec.dataset.section === target;
    sec.hidden = !isActive;
    if (!isActive || !sec.classList.contains('is-collapsed')) continue;

    sec.classList.remove('is-collapsed');
    const head = sec.querySelector('.section-head');
    if (head) head.setAttribute('aria-expanded', 'true');
    const c = loadCollapse(); delete c[target]; saveCollapse(c);
  }

  for (const selector of SECTION_SCOPED_ACTIONS) {
    const btn = $(selector);
    if (btn) btn.hidden = target !== ARTIFACT_SECTION;
  }

  window.scrollTo({ top: 0, behavior: 'instant' });
  if (options.persist) void chrome.storage.local.set({ [ACTIVE_SECTION_KEY]: target });
}

/** 有未保存改动时离开分区前确认；返回是否允许离开 */
async function confirmLeaveIfDirty(): Promise<boolean> {
  if (!isDirty()) return true;
  return await showConfirm('「文件助手」有未保存的改动，仍要离开？', 'danger');
}

function bindTopNav(): void {
  for (const item of $$<HTMLElement>('.segmented-item[data-nav-target]')) {
    item.addEventListener('click', () => {
      const key = item.dataset.navTarget || '';
      void (async () => {
        if (!await confirmLeaveIfDirty()) return;
        setActiveSection(key, { persist: true });
      })();
    });
  }
}

function bindCollapse(initial: Record<string, boolean>): void {
  for (const sec of $$('section[data-section]')) {
    const head = sec.querySelector('.section-head'); if (!head) continue;
    const key = sec.dataset.section || '';
    if (initial[key]) { sec.classList.add('is-collapsed'); head.setAttribute('aria-expanded', 'false'); }
    head.addEventListener('click', () => {
      const will = !sec.classList.contains('is-collapsed');
      sec.classList.toggle('is-collapsed', will);
      head.setAttribute('aria-expanded', will ? 'false' : 'true');
      const c = loadCollapse();
      if (will) c[key] = true; else delete c[key];
      saveCollapse(c);
    });
  }
}

function bindExpandAll(): void {
  const btn = $('#expand-all-btn'); if (!btn) return;
  btn.addEventListener('click', () => {
    const secs = Array.from($$('section[data-section]'));
    const allCollapsed = secs.every(s => s.classList.contains('is-collapsed'));
    const ns: Record<string, boolean> = {};
    for (const s of secs) {
      const collapsed = !allCollapsed; const key = s.dataset.section || '';
      s.classList.toggle('is-collapsed', collapsed);
      const h = s.querySelector('.section-head'); if (h) h.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      if (collapsed) ns[key] = true;
    }
    saveCollapse(allCollapsed ? {} : ns);
    btn.textContent = allCollapsed ? '全部折叠' : '全部展开';
  });
}

// ── 7. 事件绑定 ───────────────────────────────────────

function bindEvents(): void {
  // 产物配置
  bindArtifactEvents();

  // 默认目录浏览按钮
  for (const btn of $$('[data-default-dir-platform]')) {
    btn.addEventListener('click', () => {
      const key = (btn as HTMLElement).dataset.defaultDirPlatform;
      if (key === 'cloudpivot' || key === 'h3yun') void pickDefaultDirectory(key);
    });
  }

  // 保存 / 恢复默认 / 撤销
  $('#save-btn')?.addEventListener('click', () => { void handleSubmit(); });
  $('#factory-reset-btn')?.addEventListener('click', () => { void handleFactoryReset(); });
  $('#reset-btn')?.addEventListener('click', () => { void handleReset(); });

  // 问题排查
  bindDropdown('#diag-more-btn', '#diag-more-menu');
  $('#diag-health-check-btn')?.addEventListener('click', () => { void handleDiagHealthCheck(); });
  $('#diag-copy-all-btn')?.addEventListener('click', () => { void handleDiagCopyAll(); });
  $('#copy-diagnostic-summary-btn')?.addEventListener('click', () => { void handleDiagCopySummary(); });
  $('#export-last-diagnostic-btn')?.addEventListener('click', () => { void handleDiagExportLast(); });
  $('#diag-export-btn')?.addEventListener('click', () => { void handleDiagExport(); });

  // 项目更新
  $('#update-check-btn')?.addEventListener('click', () => { void handleCheckUpdate(); });
  // 「下载最新版」为原生 <a download href="zipUrl">，由浏览器直接下载，无需 JS 拦截

  // 使用说明平台切换
  for (const t of $$('[data-help-platform]')) {
    t.addEventListener('click', () => setActiveHelpPlatform(t.dataset.helpPlatform as 'cloudpivot' | 'h3yun'));
  }

  // 顶部导航（分区切换）与折叠
  bindTopNav();
  bindExpandAll();
}

// ── 8. 初始化 ─────────────────────────────────────────

async function init(): Promise<void> {
  const stored = await chrome.storage.local.get({ [COLLAPSE_STATE_KEY]: {}, [ACTIVE_SECTION_KEY]: '' });
  state.collapseStateCache = (stored[COLLAPSE_STATE_KEY] && typeof stored[COLLAPSE_STATE_KEY] === 'object' ? stored[COLLAPSE_STATE_KEY] : {}) as Record<string, boolean>;

  state.config = await loadConfig();
  state.artifacts = await loadArtifactConfig();
  renderAllConfigUI(state.config);
  renderHelpSection();
  updateDiagnosticInfo();

  // 项目更新：填充当前版本号
  const curVerEl = $('#update-current-version');
  if (curVerEl) curVerEl.textContent = `v${CURRENT_EXTENSION_VERSION}`;

  bindCollapse(state.collapseStateCache);

  // 记录「已保存」基线，后续输入即进入脏状态（「保存」由 is-clean 弱化提示）
  captureSavedSnapshot();

  // 关闭设置页时提示未保存改动（扩展页是否弹窗由浏览器决定，作为尽力而为的兜底）
  window.addEventListener('beforeunload', (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  // 恢复上次停留的分区（无记录或记录已失效时回退到第一个分区）
  setActiveSection(String(stored[ACTIVE_SECTION_KEY] || ''));
}

document.addEventListener('DOMContentLoaded', () => { bindEvents(); init().catch(e => logger.error('Init failed', { error: String(e) })); });