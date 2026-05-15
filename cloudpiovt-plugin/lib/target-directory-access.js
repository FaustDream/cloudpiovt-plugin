import {
  clearTargetDirectoryHandle,
  getTargetDirectoryHandle,
  saveTargetDirectoryHandle
} from "./file-handle-db.js";
import {
  getTargetDirectoryPathByPageType,
  loadConfig,
  saveTargetDirectoryPathByPageType
} from "./config.js";
import {
  pickNativeDirectory,
  probeNativeHost,
  readNativeDirectoryFiles,
  writeNativeDirectoryFiles
} from "./native-host.js";

function createAbortError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function buildSelection(kind, values = {}) {
  return {
    kind,
    handle: null,
    directoryPath: "",
    label: "",
    ...values
  };
}

export function supportsDirectoryPicker() {
  return typeof window.showDirectoryPicker === "function";
}

async function ensureDirectoryPermission(handle, mode = "readwrite") {
  if (!handle) {
    throw new Error("尚未选择目标目录。");
  }

  const options = { mode };
  if (typeof handle.queryPermission === "function") {
    const permission = await handle.queryPermission(options);
    if (permission === "granted") {
      return;
    }
  }

  if (typeof handle.requestPermission === "function") {
    const permission = await handle.requestPermission(options);
    if (permission === "granted") {
      return;
    }
  }

  throw new Error(mode === "read" ? "目录读取权限未授予。" : "目录写入权限未授予。");
}

async function selectHandleDirectory(pageType) {
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  await saveTargetDirectoryHandle(handle, pageType);
  await saveTargetDirectoryPathByPageType(pageType, "");
  return buildSelection("handle", {
    handle,
    label: handle?.name || "未命名目录"
  });
}

async function selectNativeDirectory(pageType) {
  const config = await loadConfig();
  const existingPath = getTargetDirectoryPathByPageType(config, pageType);
  const response = await pickNativeDirectory(existingPath);
  if (!response?.ok) {
    if (response?.cancelled) {
      throw createAbortError("已取消选择目标目录。");
    }
    throw new Error(response?.error || "选择目标目录失败。");
  }

  const directoryPath = String(response.directoryPath || "").trim();
  if (!directoryPath) {
    throw new Error("原生助手未返回目录路径。");
  }

  await saveTargetDirectoryPathByPageType(pageType, directoryPath);
  await clearTargetDirectoryHandle(pageType);
  return buildSelection("native-path", {
    directoryPath,
    label: directoryPath
  });
}

export async function getStoredTargetDirectorySelection(pageType) {
  const config = await loadConfig();
  const directoryPath = getTargetDirectoryPathByPageType(config, pageType);
  if (directoryPath) {
    return buildSelection("native-path", {
      directoryPath,
      label: directoryPath
    });
  }

  const handle = await getTargetDirectoryHandle(pageType).catch(() => null);
  if (handle) {
    return buildSelection("handle", {
      handle,
      label: handle?.name || "未命名目录"
    });
  }

  return buildSelection("none");
}

export async function refreshTargetDirectorySelection(pageType) {
  const hostStatus = await probeNativeHost();
  if (hostStatus.available) {
    return selectNativeDirectory(pageType);
  }

  if (supportsDirectoryPicker()) {
    return selectHandleDirectory(pageType);
  }

  return selectNativeDirectory(pageType);
}

export async function ensureTargetDirectorySelection(pageType, mode = "readwrite") {
  const storedSelection = await getStoredTargetDirectorySelection(pageType);
  if (storedSelection.kind === "handle") {
    await ensureDirectoryPermission(storedSelection.handle, mode);
    return storedSelection;
  }

  if (storedSelection.kind === "native-path") {
    return storedSelection;
  }

  const selection = await refreshTargetDirectorySelection(pageType);
  if (selection.kind === "handle") {
    await ensureDirectoryPermission(selection.handle, mode);
  }
  return selection;
}

async function writeTextToHandle(handle, content) {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function readTextFromHandle(handle) {
  const file = await handle.getFile();
  return file.text();
}

export async function fileExistsInSelection(selection, fileName) {
  const [fileEntry] = await readFilesFromSelection(selection, [fileName]);
  return Boolean(fileEntry?.exists);
}

export async function writeFilesToSelection(selection, files) {
  if (selection.kind === "handle") {
    const results = [];
    for (const file of files) {
      let existed = true;
      try {
        await selection.handle.getFileHandle(file.fileName);
      } catch (error) {
        if (error?.name === "NotFoundError") {
          existed = false;
        } else {
          throw error;
        }
      }

      const fileHandle = await selection.handle.getFileHandle(file.fileName, { create: true });
      await writeTextToHandle(fileHandle, file.content);
      results.push({
        fileName: file.fileName,
        exists: existed
      });
    }
    return results;
  }

  if (selection.kind === "native-path") {
    const response = await writeNativeDirectoryFiles({
      directoryPath: selection.directoryPath,
      files
    });
    if (!response?.ok) {
      throw new Error(response?.error || "原生助手写入目录失败。");
    }
    return Array.isArray(response.files) ? response.files : [];
  }

  throw new Error("尚未选择目标目录。");
}

export async function readFilesFromSelection(selection, fileNames) {
  if (selection.kind === "handle") {
    const results = [];
    for (const fileName of fileNames) {
      try {
        const fileHandle = await selection.handle.getFileHandle(fileName);
        results.push({
          fileName,
          exists: true,
          content: await readTextFromHandle(fileHandle)
        });
      } catch (error) {
        if (error?.name === "NotFoundError") {
          results.push({
            fileName,
            exists: false,
            content: ""
          });
          continue;
        }
        throw error;
      }
    }
    return results;
  }

  if (selection.kind === "native-path") {
    const response = await readNativeDirectoryFiles({
      directoryPath: selection.directoryPath,
      fileNames
    });
    if (!response?.ok) {
      throw new Error(response?.error || "原生助手读取目录失败。");
    }
    return Array.isArray(response.files) ? response.files : [];
  }

  throw new Error("尚未选择目标目录。");
}
