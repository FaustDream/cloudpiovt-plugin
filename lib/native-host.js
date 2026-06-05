export const NATIVE_HOST_NAME = "com.cloudpiovt.editor_helper";

function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response || {});
    });
  });
}

export async function probeNativeHost() {
  try {
    const response = await sendNativeMessage({ command: "ping" });
    return {
      available: Boolean(response?.ok),
      version: String(response?.version || ""),
      hostName: String(response?.hostName || NATIVE_HOST_NAME),
      error: ""
    };
  } catch (error) {
    return {
      available: false,
      version: "",
      hostName: NATIVE_HOST_NAME,
      error: error?.message || String(error)
    };
  }
}

export async function pickNativeEditor(existingPath = "") {
  return sendNativeMessage({
    command: "pick_editor",
    existingPath: String(existingPath || "")
  });
}

export async function pickNativeDirectory(existingPath = "") {
  return sendNativeMessage({
    command: "pick_directory",
    existingPath: String(existingPath || "")
  });
}

export async function writeNativeDirectoryFiles({ directoryPath, files }) {
  return sendNativeMessage({
    command: "write_directory_files",
    directoryPath: String(directoryPath || ""),
    files: Array.isArray(files)
      ? files.map((file) => ({
          fileName: String(file?.fileName || ""),
          content: String(file?.content ?? "")
        }))
      : []
  });
}

export async function readNativeDirectoryFiles({ directoryPath, fileNames }) {
  return sendNativeMessage({
    command: "read_directory_files",
    directoryPath: String(directoryPath || ""),
    files: Array.isArray(fileNames)
      ? fileNames.map((fileName) => ({
          fileName: String(fileName || "")
        }))
      : []
  });
}

export async function launchNativeEditor({ executablePath, argumentsTemplate, targetPath }) {
  return sendNativeMessage({
    command: "launch_native_editor",
    executablePath: String(executablePath || ""),
    argumentsTemplate: String(argumentsTemplate || '"{path}"'),
    targetPath: String(targetPath || "")
  });
}

// 通过 Native Host 执行 Git 仓库同步；shouldSync=true 时强制 reset --hard origin/master
export async function gitSync({ sync: shouldSync = false } = {}) {
  return sendNativeMessage({
    command: "git_sync",
    sync: Boolean(shouldSync)
  });
}
