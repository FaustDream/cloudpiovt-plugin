import assert from "node:assert/strict";
import {
  MAX_RECENT_TARGET_DIRECTORIES,
  mergeRecentTargetDirectories,
  normalizeRecentTargetDirectories
} from "../lib/recent-target-directories.js";

const normalizedRecords = normalizeRecentTargetDirectories([
  { path: "D:/workspace/project-b", pageType: "list", lastUsedAt: 2 },
  { path: "D:/workspace/project-a", pageType: "form", lastUsedAt: 3 },
  { path: "D:/workspace/project-b", pageType: "default", lastUsedAt: 1 },
  { path: "   ", pageType: "form", lastUsedAt: 999 },
  null
]);

assert.deepEqual(
  normalizedRecords,
  [
    { path: "D:/workspace/project-a", pageType: "form", lastUsedAt: 3 },
    { path: "D:/workspace/project-b", pageType: "list", lastUsedAt: 2 }
  ],
  "标准化后应按最近时间排序、去重并过滤空路径"
);

const mergedRecords = mergeRecentTargetDirectories(
  [
    { path: "D:/workspace/project-a", pageType: "form", lastUsedAt: 3 },
    { path: "D:/workspace/project-b", pageType: "list", lastUsedAt: 2 }
  ],
  {
    path: "D:/workspace/project-b",
    pageType: "default",
    lastUsedAt: 8
  }
);

assert.equal(mergedRecords[0].path, "D:/workspace/project-b", "重复路径应被提升到最近位置");
assert.equal(mergedRecords[0].pageType, "default", "重复路径应覆盖为最新的页面类型");
assert.equal(mergedRecords.length, 2, "重复路径合并后不应新增多余记录");

const overflowRecords = mergeRecentTargetDirectories(
  Array.from({ length: MAX_RECENT_TARGET_DIRECTORIES }, (_, index) => ({
    path: `D:/workspace/project-${index}`,
    pageType: "default",
    lastUsedAt: index + 1
  })),
  {
    path: "D:/workspace/project-new",
    pageType: "form",
    lastUsedAt: 99
  }
);

assert.equal(
  overflowRecords.length,
  MAX_RECENT_TARGET_DIRECTORIES,
  "最近路径数量应被限制在最大值以内"
);
assert.equal(overflowRecords[0].path, "D:/workspace/project-new", "新路径应排在最前面");

console.log("recent target directory scenarios passed");
