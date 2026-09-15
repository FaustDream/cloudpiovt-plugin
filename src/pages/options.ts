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
import { buildDiagnosticPackage, saveLastDiagnosticPackage, loadLastDiagnosticPackage } from '../services/preflight-diagnostics.js';
import { fetchLatestRelease, isUpToDate, hasNewerVersion, type LatestReleaseInfo } from '../services/update-checker.js';
import { CURRENT_EXTENSION_VERSION } from '../lib/release-notes.js';
import { saveDefaultDirectoryHandle, clearDefaultDirectoryHandle } from '../lib/directory/file-handle-db.js';

// ── 工具 ──────────────────────────────────────────────

function $(sel: string): HTMLElement | null { return document.querySelector(sel) as HTMLElement | null; }
function $$(sel: string): NodeListOf<HTMLElement> { return document.querySelectorAll(sel) as NodeListOf<HTMLElement>; }
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

const state = {
  config: null as ExtensionConfig | null,
  artifacts: null as ArtifactConfig | null,
  activeHelpPlatform: 'cloudpivot' as 'cloudpivot' | 'h3yun',
  collapseStateCache: {} as Record<string, boolean>,
};

async function showConfirm(message: string): Promise<boolean> {
  const overlay = $('#confirm-overlay');
  const msgEl = $('#confirm-message');
  if (!overlay || !msgEl) return false;
  msgEl.textContent = message;
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
  return `
    <label class="toggle-inline artifact-capture-row" data-artifact-id="${escapeHtml(artifact.id)}" data-artifact-platform="${escapeHtml(platformKey)}">
      <input type="checkbox" data-artifact-field="enabled" ${artifact.enabled ? 'checked' : ''}>
      <span class="toggle-track" aria-hidden="true"></span>
      <span>${escapeHtml(artifact.label)}</span>
    </label>
  `;
}

/** 可自定义产物：名称 / 路径 / 文件名 / 开关 / 默认内容 五字段全可编辑 */
function renderTemplateArtifactCard(artifact: ArtifactDefinition, platformKey: PlatformKey): string {
  const variables = ARTIFACT_TEMPLATE_VARIABLES.map((variable) =>
    `<button type="button" class="ghost-btn-sm artifact-var-btn" data-artifact-var="${escapeHtml(variable.token)}">${escapeHtml(variable.label)}</button>`,
  ).join('');
  const deleteBtn = artifact.builtin
    ? ''
    : '<button type="button" class="ghost-btn-sm artifact-delete-btn" data-artifact-delete="1">删除</button>';

  return `
    <div class="artifact-card" data-artifact-id="${escapeHtml(artifact.id)}" data-artifact-platform="${escapeHtml(platformKey)}">
      <div class="artifact-card-head">
        <label class="toggle-inline">
          <input type="checkbox" data-artifact-field="enabled" ${artifact.enabled ? 'checked' : ''}>
          <span class="toggle-track" aria-hidden="true"></span>
          <span>启用</span>
        </label>
        <input class="artifact-label-input" type="text" data-artifact-field="label" value="${escapeHtml(artifact.label)}" aria-label="产物名称" placeholder="产物名称">
        ${deleteBtn}
      </div>
      <div class="artifact-field-row">
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
        <textarea class="artifact-content-input" rows="5" data-artifact-field="defaultContent">${escapeHtml(artifact.defaultContent)}</textarea>
      </label>
      <div class="artifact-variable-row">
        <span class="artifact-field-label">插入变量</span>
        ${variables}
      </div>
      <p class="artifact-note">已存在则跳过，不覆盖已有内容；变量只在首次生成时替换。</p>
    </div>
  `;
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

/** 新增一条自定义产物 */
function handleAddArtifact(platformKey: PlatformKey): void {
  if (!state.artifacts) return;
  syncArtifactsFromDom();
  state.artifacts[platformKey] = [...getPlatformArtifacts(state.artifacts, platformKey), createCustomArtifact()];
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
  if (!await showConfirm(`确定删除产物「${artifact.label}」？`)) return;

  syncArtifactsFromDom();
  state.artifacts[platformKey] = getPlatformArtifacts(state.artifacts, platformKey)
    .filter((item) => item.id !== artifactId);
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

  root.addEventListener('input', () => syncArtifactsFromDom());
  root.addEventListener('change', () => syncArtifactsFromDom());

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
    }
  });
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

function renderDefaultDirs(): void {
  if (!state.config) return;
  const cpInput = $('#default-dir-cloudpivot') as HTMLInputElement | null;
  const hyInput = $('#default-dir-h3yun') as HTMLInputElement | null;
  if (cpInput) cpInput.value = getFallbackDirectoryPathByPlatform(state.config, 'cloudpivot');
  if (hyInput) hyInput.value = getFallbackDirectoryPathByPlatform(state.config, 'h3yun');
}

/** 通过原生目录选择器浏览并绑定平台默认目录（保存句柄 + 回填路径字符串） */
async function pickDefaultDirectory(platformKey: PlatformKey): Promise<void> {
  const w = window as unknown as {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  };
  if (typeof w.showDirectoryPicker !== 'function') {
    showToast('当前浏览器不支持目录选择，请使用 Chrome 86+ 或 Edge 86+', 'error');
    return;
  }
  try {
    const handle = await w.showDirectoryPicker({ mode: 'read' });
    const label = handle.name || '';
    const input = platformKey === 'h3yun' ? $('#default-dir-h3yun') : $('#default-dir-cloudpivot');
    if (input) (input as HTMLInputElement).value = label;
    await saveDefaultDirectoryHandle(handle, platformKey);
    showToast(label ? `已选择默认目录：${label}` : '已选择默认目录', 'success');
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') return; // 用户取消
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
  if (hyBody) hyBody.innerHTML = H3YUN_CONTROL_TYPE_REFERENCE.map(c => `<tr><td>${escapeHtml(c.typeCode)}</td><td>${escapeHtml(c.typeName)}</td><td>${escapeHtml(c.notes)}</td></tr>`).join('');
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
    const supported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
    fsa.innerHTML = supported
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
    const fsa = typeof window !== 'undefined' && 'showDirectoryPicker' in window ? 'supported' : 'not supported';
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

  const cpPath = ($('#default-dir-cloudpivot') as HTMLInputElement | null)?.value || '';
  const hyPath = ($('#default-dir-h3yun') as HTMLInputElement | null)?.value || '';

  try {
    state.artifacts = await saveArtifactConfig(state.artifacts);
    await saveConfig({
      h3yunOneClickWriteback: state.config.h3yunOneClickWriteback,
      fallbackDirectoryPaths: { cloudpivot: cpPath, h3yun: hyPath },
    });
    // 默认目录被清空时同步清空对应句柄，避免路径字符串与句柄不一致
    if (!cpPath.trim()) await clearDefaultDirectoryHandle('cloudpivot');
    if (!hyPath.trim()) await clearDefaultDirectoryHandle('h3yun');
    state.config = await loadConfig();
    renderAllConfigUI(state.config);
    showToast('配置已保存', 'success');
  } catch (err: unknown) {
    logger.error('保存配置失败', { error: String(err) });
    showToast(`保存失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

/** 恢复出厂产物配置（自定义产物与全部改动都会丢失） */
async function handleFactoryReset(): Promise<void> {
  if (!await showConfirm('确定恢复产物默认配置？自定义产物与所有修改都会丢失。')) return;
  try {
    state.artifacts = await resetArtifactConfig();
    renderAllArtifactZones();
    showToast('已恢复产物默认配置', 'success');
  } catch (err: unknown) {
    logger.error('恢复默认失败', { error: String(err) });
    showToast(`恢复默认失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

/** 丢弃未保存改动，还原为当前已保存的设置 */
async function handleReset(): Promise<void> {
  if (!await showConfirm('确定丢弃未保存的改动？')) return;
  state.config = await loadConfig();
  state.artifacts = await loadArtifactConfig();
  renderAllConfigUI(state.config);
  showToast('已还原为当前保存的设置', 'info');
}

function renderAllConfigUI(config: ExtensionConfig): void {
  renderAllArtifactZones();
  renderH3yunWritebackToggle();
  renderDefaultDirs();
}

// ── 6. Sidebar / 折叠 ─────────────────────────────────

function loadCollapse(): Record<string, boolean> { return state.collapseStateCache; }
function saveCollapse(next: Record<string, boolean>): void { state.collapseStateCache = next; void chrome.storage.local.set({ [COLLAPSE_STATE_KEY]: next }); }

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

function bindSidebar(): void {
  for (const item of $$('.sidebar-item[data-nav-target]')) {
    item.addEventListener('click', () => {
      const key = item.dataset.navTarget || '';
      const sec = document.querySelector<HTMLElement>(`section[data-section="${key}"]`);
      if (!sec) return;
      const head = sec.querySelector('.section-head');
      if (sec.classList.contains('is-collapsed')) {
        sec.classList.remove('is-collapsed'); if (head) head.setAttribute('aria-expanded', 'true');
        const c = loadCollapse(); delete c[key]; saveCollapse(c);
      }
      const tb = document.querySelector('.top-bar'); const tbH = tb?.getBoundingClientRect().height || 52;
      window.scrollTo({ top: sec.getBoundingClientRect().top + window.scrollY - tbH - 16, behavior: 'smooth' });
    });
  }
}

let spyTimer: ReturnType<typeof setTimeout> | null = null;
function updateSidebarSpy(): void {
  const secs = Array.from($$('section[data-section]'));
  const tbH = document.querySelector('.top-bar')?.getBoundingClientRect().height || 52;
  const mid = window.scrollY + tbH + 60;
  let active = secs[0]?.dataset.section ?? '';
  for (const s of secs) { if (mid >= s.getBoundingClientRect().top + window.scrollY) active = s.dataset.section || active; }
  for (const item of $$('.sidebar-item[data-nav-target]')) item.classList.toggle('is-active', (item as HTMLElement).dataset.navTarget === active);
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

  // Sidebar
  bindSidebar();
  bindExpandAll();
}

// ── 8. 初始化 ─────────────────────────────────────────

async function init(): Promise<void> {
  const stored = await chrome.storage.local.get({ [COLLAPSE_STATE_KEY]: {} });
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

  window.addEventListener('scroll', () => { if (spyTimer) clearTimeout(spyTimer); spyTimer = setTimeout(updateSidebarSpy, 80); }, { passive: true });
  updateSidebarSpy();
}

document.addEventListener('DOMContentLoaded', () => { bindEvents(); init().catch(e => logger.error('Init failed', { error: String(e) })); });