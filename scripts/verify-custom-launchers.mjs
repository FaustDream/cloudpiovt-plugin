import assert from "node:assert/strict";
import {
  BUILTIN_LAUNCHERS,
  applyDiscoveredLaunchers,
  createCustomLauncherDraft,
  generateIconKey,
  generateLauncherId,
  getAvailableLaunchers,
  getDefaultArgumentsTemplate,
  normalizeCustomLaunchers,
  pinLauncher,
  selectDefaultLauncher
} from "../lib/custom-launchers.js";

function launcherNames(launchers) {
  return launchers.map((launcher) => launcher.name);
}

const defaults = normalizeCustomLaunchers();
assert.deepEqual(
  launcherNames(defaults),
  ["File Explorer", "VS Code", "IntelliJ IDEA", "Git Bash"],
  "默认列表必须置顶 File Explorer，其他内置软件保持稳定顺位"
);
assert.equal(defaults.filter((launcher) => launcher.pinned === true).length, 1);
assert.equal(defaults.find((launcher) => launcher.pinned === true)?.launcherId, "builtin-file-explorer");
assert.equal(selectDefaultLauncher(defaults)?.launcherId, "builtin-file-explorer");
assert.deepEqual(
  getAvailableLaunchers(defaults).map((launcher) => launcher.launcherId),
  ["builtin-file-explorer"],
  "新安装默认只有 File Explorer 可用"
);

const custom = createCustomLauncherDraft(
  { name: "Cursor", executablePath: "C:\\Tools\\Cursor.exe", seed: "fixed" },
  defaults
);
assert.match(custom.launcherId, /^custom-cursor-fixed/);
assert.match(custom.iconKey, /^custom-icon-cursor-fixed/);
assert.equal(custom.builtin, false);
assert.equal(custom.enabled, true);

const duplicated = normalizeCustomLaunchers([
  ...defaults,
  custom,
  { ...custom, launcherId: custom.launcherId, iconKey: custom.iconKey, name: "Cursor 2" }
]);
assert.equal(new Set(duplicated.map((launcher) => launcher.launcherId)).size, duplicated.length);
assert.equal(new Set(duplicated.map((launcher) => launcher.iconKey)).size, duplicated.length);

const discovered = applyDiscoveredLaunchers(defaults, [
  {
    launcherId: "builtin-vscode",
    executablePath: "C:\\Users\\Lynn\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
    displayName: "VS Code"
  },
  {
    launcherId: "builtin-git-bash",
    executablePath: "C:\\Program Files\\Git\\git-bash.exe",
    displayName: "Git Bash"
  }
]);
assert.deepEqual(
  getAvailableLaunchers(discovered).map((launcher) => launcher.launcherId),
  ["builtin-file-explorer", "builtin-vscode", "builtin-git-bash"],
  "自动发现后可用启动器必须保持置顶优先"
);
assert.equal(selectDefaultLauncher(discovered)?.launcherId, "builtin-file-explorer");

const pinnedGitBash = pinLauncher(defaults, "builtin-git-bash");
assert.deepEqual(
  pinnedGitBash.slice(0, 2).map((launcher) => launcher.launcherId),
  ["builtin-git-bash", "builtin-file-explorer"],
  "新置顶项必须排第一，旧置顶项顺位必须变成第二"
);
assert.equal(pinnedGitBash.filter((launcher) => launcher.pinned === true).length, 1);
assert.equal(pinnedGitBash.find((launcher) => launcher.pinned === true)?.launcherId, "builtin-git-bash");
assert.equal(selectDefaultLauncher(pinnedGitBash)?.launcherId, "builtin-file-explorer");
assert.equal(getDefaultArgumentsTemplate(BUILTIN_LAUNCHERS[0]), '"{rawPath}"');
assert.match(generateLauncherId("My Tool", [], { seed: "abc" }), /^custom-my-tool-abc$/);
assert.match(generateIconKey("custom-my-tool-abc", []), /^custom-icon-my-tool-abc$/);

console.log("custom launchers verification passed");
