export const LAUNCHER_ICON_SIZES = Object.freeze([16, 48, 128]);

export const DEFAULT_LAUNCHER_ARGUMENTS = Object.freeze({
  vscode: '"{rawPath}"',
  idea: '"{rawPath}"',
  fileExplorer: '"{rawPath}"',
  custom: '"{rawPath}"'
});

export const BUILTIN_LAUNCHERS = Object.freeze([
  Object.freeze({
    launcherId: "builtin-vscode",
    iconKey: "vscode",
    name: "VS Code",
    executablePath: "",
    argumentsTemplate: DEFAULT_LAUNCHER_ARGUMENTS.vscode,
    enabled: false,
    pinned: false,
    sortOrder: 10,
    builtin: true
  }),
  Object.freeze({
    launcherId: "builtin-idea",
    iconKey: "intellij-idea",
    name: "IntelliJ IDEA",
    executablePath: "",
    argumentsTemplate: DEFAULT_LAUNCHER_ARGUMENTS.idea,
    enabled: false,
    pinned: false,
    sortOrder: 20,
    builtin: true
  }),
  Object.freeze({
    launcherId: "builtin-file-explorer",
    iconKey: "file-explorer",
    name: "File Explorer",
    executablePath: "C:\\Windows\\explorer.exe",
    argumentsTemplate: DEFAULT_LAUNCHER_ARGUMENTS.fileExplorer,
    enabled: true,
    pinned: true,
    sortOrder: 30,
    builtin: true
  })
]);

const BUILTIN_LAUNCHER_BY_ID = new Map(BUILTIN_LAUNCHERS.map((launcher) => [launcher.launcherId, launcher]));
const SAFE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanPath(value) {
  return String(value || "").trim();
}

function cleanTemplate(value, fallback) {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function slugify(value, fallback = "launcher") {
  const slug = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return slug || fallback;
}

function normalizeSafeKey(value, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return SAFE_KEY_PATTERN.test(normalized) ? normalized : fallback;
}

function uniqueKey(baseKey, existingKeys) {
  const used = new Set(Array.from(existingKeys || []).map((item) => String(item || "").toLowerCase()));
  let candidate = normalizeSafeKey(baseKey, "custom-launcher");
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${normalizeSafeKey(baseKey, "custom-launcher")}-${index}`;
    index += 1;
  }
  return candidate;
}

function normalizeSortOrder(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeBuiltinLauncher(storedLauncher, defaultLauncher) {
  const executablePath = cleanPath(storedLauncher?.executablePath);
  const hasStoredEnabled = Boolean(storedLauncher)
    && Object.prototype.hasOwnProperty.call(storedLauncher, "enabled");
  const hasStoredPinned = Boolean(storedLauncher)
    && Object.prototype.hasOwnProperty.call(storedLauncher, "pinned");
  return {
    ...defaultLauncher,
    name: cleanText(storedLauncher?.name) || defaultLauncher.name,
    executablePath: executablePath || defaultLauncher.executablePath,
    argumentsTemplate: cleanTemplate(storedLauncher?.argumentsTemplate, defaultLauncher.argumentsTemplate),
    enabled: hasStoredEnabled
      ? storedLauncher.enabled === true && Boolean(executablePath || defaultLauncher.executablePath)
      : defaultLauncher.enabled === true && Boolean(defaultLauncher.executablePath),
    pinned: hasStoredPinned
      ? storedLauncher.pinned === true
      : defaultLauncher.pinned === true,
    sortOrder: normalizeSortOrder(storedLauncher?.sortOrder, defaultLauncher.sortOrder)
  };
}

function normalizeCustomLauncher(storedLauncher, fallbackIndex, existingIds, existingIconKeys) {
  const name = cleanText(storedLauncher?.name) || "自定义软件";
  const generatedLauncherId = generateLauncherId(name, existingIds, { seed: fallbackIndex });
  const launcherId = uniqueKey(
    normalizeSafeKey(storedLauncher?.launcherId, generatedLauncherId),
    existingIds
  );
  existingIds.add(launcherId);

  const generatedIconKey = generateIconKey(launcherId, existingIconKeys);
  const iconKey = uniqueKey(
    normalizeSafeKey(storedLauncher?.iconKey, generatedIconKey),
    existingIconKeys
  );
  existingIconKeys.add(iconKey);

  return {
    launcherId,
    iconKey,
    name,
    executablePath: cleanPath(storedLauncher?.executablePath),
    argumentsTemplate: cleanTemplate(storedLauncher?.argumentsTemplate, DEFAULT_LAUNCHER_ARGUMENTS.custom),
    enabled: storedLauncher?.enabled === true,
    pinned: storedLauncher?.pinned === true,
    sortOrder: normalizeSortOrder(storedLauncher?.sortOrder, 1000 + fallbackIndex * 10),
    builtin: false
  };
}

// 置顶软件决定弹窗主按钮默认打开项；归一化时强制只保留一个置顶，避免多个来源写入后默认项不稳定。
function normalizePinnedLaunchers(launchers = []) {
  const sorted = sortLaunchers(launchers);
  const pinnedLauncher = sorted.find((launcher) => launcher.pinned === true)
    || sorted.find((launcher) => launcher.launcherId === "builtin-file-explorer")
    || sorted[0]
    || null;

  return sorted.map((launcher) => ({
    ...launcher,
    pinned: pinnedLauncher?.launcherId === launcher.launcherId
  }));
}

export function getBuiltinLauncher(launcherId) {
  return BUILTIN_LAUNCHER_BY_ID.get(String(launcherId || "")) || null;
}

export function generateLauncherId(name, existingIds = [], options = {}) {
  const seed = options.seed === undefined || options.seed === null
    ? Date.now().toString(36)
    : String(options.seed);
  return uniqueKey(`custom-${slugify(name)}-${seed}`, existingIds);
}

export function generateIconKey(launcherId, existingIconKeys = []) {
  return uniqueKey(String(launcherId || "custom-launcher").replace(/^custom-/, "custom-icon-"), existingIconKeys);
}

export function sortLaunchers(launchers = []) {
  return [...launchers].sort((left, right) => {
    if (left?.pinned === true && right?.pinned !== true) {
      return -1;
    }
    if (right?.pinned === true && left?.pinned !== true) {
      return 1;
    }
    const sortDiff = normalizeSortOrder(left?.sortOrder, 0) - normalizeSortOrder(right?.sortOrder, 0);
    if (sortDiff !== 0) {
      return sortDiff;
    }
    return cleanText(left?.name).localeCompare(cleanText(right?.name), "zh-CN");
  });
}

export function normalizeCustomLaunchers(value) {
  const inputLaunchers = Array.isArray(value) ? value : [];
  const storedById = new Map(inputLaunchers.map((launcher) => [String(launcher?.launcherId || ""), launcher]));
  const existingIds = new Set();
  const existingIconKeys = new Set();

  const builtins = BUILTIN_LAUNCHERS.map((defaultLauncher) => {
    existingIds.add(defaultLauncher.launcherId);
    existingIconKeys.add(defaultLauncher.iconKey);
    return normalizeBuiltinLauncher(storedById.get(defaultLauncher.launcherId), defaultLauncher);
  });

  const customLaunchers = inputLaunchers
    .filter((launcher) => !BUILTIN_LAUNCHER_BY_ID.has(String(launcher?.launcherId || "")))
    .map((launcher, index) => normalizeCustomLauncher(launcher, index + 1, existingIds, existingIconKeys));

  return normalizePinnedLaunchers([...builtins, ...customLaunchers]).map((launcher, index) => ({
    ...launcher,
    sortOrder: (index + 1) * 10
  }));
}

export function isLauncherConfigured(launcher) {
  return Boolean(cleanPath(launcher?.executablePath));
}

export function isLauncherAvailable(launcher) {
  return launcher?.enabled === true && isLauncherConfigured(launcher);
}

export function getAvailableLaunchers(launchers = []) {
  return sortLaunchers(launchers).filter(isLauncherAvailable);
}

export function selectDefaultLauncher(launchers = []) {
  return getAvailableLaunchers(launchers)[0] || null;
}

export function getLauncherIconPath(launcher, size = 16) {
  const normalizedSize = LAUNCHER_ICON_SIZES.includes(Number(size)) ? Number(size) : 16;
  const iconKey = normalizeSafeKey(launcher?.iconKey, "file-explorer");
  // 页面位于 src/pages/，assets/ 在扩展根目录，需上两层
  return `../../assets/icons/launchers/${iconKey}-${normalizedSize}.png`;
}

export function getExtensionIconPath(size = 16) {
  const normalizedSize = LAUNCHER_ICON_SIZES.includes(Number(size)) ? Number(size) : 16;
  return `../../assets/icons/extension/icon-${normalizedSize}.png`;
}

export function createCustomLauncherDraft(input = {}, existingLaunchers = []) {
  const existingIds = new Set(existingLaunchers.map((launcher) => launcher.launcherId));
  const existingIconKeys = new Set(existingLaunchers.map((launcher) => launcher.iconKey));
  const name = cleanText(input.name || input.displayName) || "自定义软件";
  const launcherId = generateLauncherId(name, existingIds, { seed: input.seed });
  const iconKey = generateIconKey(launcherId, existingIconKeys);
  const nextSortOrder = sortLaunchers(existingLaunchers).at(-1)?.sortOrder || 0;

  return {
    launcherId,
    iconKey,
    name,
    executablePath: cleanPath(input.executablePath),
    argumentsTemplate: cleanTemplate(input.argumentsTemplate, DEFAULT_LAUNCHER_ARGUMENTS.custom),
    enabled: input.enabled !== false,
    pinned: false,
    sortOrder: nextSortOrder + 10,
    builtin: false
  };
}

// 设置页的“置顶”只改变默认启动优先级：新置顶排第一，旧置顶保留为第二优先级。
export function pinLauncher(launchers = [], launcherId) {
  const sorted = normalizeCustomLaunchers(launchers);
  const target = sorted.find((launcher) => launcher.launcherId === launcherId);
  if (!target) {
    return sorted;
  }

  const previousPinned = sorted.find((launcher) => launcher.pinned === true && launcher.launcherId !== launcherId);
  const nextLaunchers = [
    { ...target, pinned: true },
    ...(
      previousPinned
        ? [{ ...previousPinned, pinned: false }]
        : []
    ),
    ...sorted
      .filter((launcher) => (
        launcher.launcherId !== target.launcherId
        && launcher.launcherId !== previousPinned?.launcherId
      ))
      .map((launcher) => ({ ...launcher, pinned: false }))
  ];

  return nextLaunchers.map((launcher, index) => ({
    ...launcher,
    sortOrder: (index + 1) * 10
  }));
}

export function getDefaultArgumentsTemplate(launcher) {
  const builtinLauncher = getBuiltinLauncher(launcher?.launcherId);
  return builtinLauncher?.argumentsTemplate || DEFAULT_LAUNCHER_ARGUMENTS.custom;
}

export function applyDiscoveredLaunchers(currentLaunchers = [], discoveredLaunchers = []) {
  const discoveredById = new Map(
    (Array.isArray(discoveredLaunchers) ? discoveredLaunchers : [])
      .map((launcher) => [String(launcher?.launcherId || ""), launcher])
  );

  return normalizeCustomLaunchers(currentLaunchers.map((launcher) => {
    const discovered = discoveredById.get(launcher.launcherId);
    if (!launcher.builtin || !discovered?.executablePath) {
      return launcher;
    }

    return {
      ...launcher,
      name: launcher.name,
      executablePath: cleanPath(discovered.executablePath),
      enabled: true
    };
  }));
}
