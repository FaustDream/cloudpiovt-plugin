const DB_NAME = "vue-editor-data-writer";
const STORE_NAME = "handles";
const HANDLE_KEY_PREFIX = "target-directory";
const PAGE_HANDLE_KEY_PREFIX = "target-directory-page";

function normalizePageType(pageType) {
  const normalized = String(pageType || "").trim();
  return normalized || "default";
}

function buildHandleKey(pageType) {
  return `${HANDLE_KEY_PREFIX}:${normalizePageType(pageType)}`;
}

function normalizeScopeKey(scopeKey) {
  return String(scopeKey || "").trim();
}

function buildPageHandleKey(pageScope) {
  const normalizedScopeKey = normalizeScopeKey(pageScope);
  if (!normalizedScopeKey) {
    throw new Error("页面目录句柄 scope 不能为空。");
  }

  return `${PAGE_HANDLE_KEY_PREFIX}:${normalizedScopeKey}`;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB."));
  });
}

async function withStore(mode, callback) {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);

    let request;

    try {
      request = callback(store);
    } catch (error) {
      reject(error);
      database.close();
      return;
    }

    transaction.oncomplete = () => {
      database.close();
      resolve(request?.result);
    };

    transaction.onerror = () => {
      reject(transaction.error || request?.error || new Error("IndexedDB transaction failed."));
      database.close();
    };
  });
}

export async function saveTargetDirectoryHandle(handle, pageType = "default") {
  await withStore("readwrite", (store) => store.put(handle, buildHandleKey(pageType)));
}

export async function getTargetDirectoryHandle(pageType = "default") {
  return withStore("readonly", (store) => store.get(buildHandleKey(pageType)));
}

export async function clearTargetDirectoryHandle(pageType = "default") {
  await withStore("readwrite", (store) => store.delete(buildHandleKey(pageType)));
}

/**
 * 保存页面级目录句柄快照，使已打开页面继续使用自己创建时的目录选择。
 */
export async function saveTargetDirectoryHandleForScope(handle, pageScope) {
  await withStore("readwrite", (store) => store.put(handle, buildPageHandleKey(pageScope)));
}

/**
 * 读取页面级目录句柄；scope 为空时返回 null，避免误读全局默认句柄。
 */
export async function getTargetDirectoryHandleForScope(pageScope) {
  const normalizedScopeKey = normalizeScopeKey(pageScope);
  if (!normalizedScopeKey) {
    return null;
  }

  return withStore("readonly", (store) => store.get(buildPageHandleKey(normalizedScopeKey)));
}

/**
 * 清理页面级目录句柄，通常在当前页面改用 Native Host 绝对路径时调用。
 */
export async function clearTargetDirectoryHandleForScope(pageScope) {
  const normalizedScopeKey = normalizeScopeKey(pageScope);
  if (!normalizedScopeKey) {
    return;
  }

  await withStore("readwrite", (store) => store.delete(buildPageHandleKey(normalizedScopeKey)));
}

/**
 * 新页面建立快照时复制当前页面类型的默认句柄，复制后不再跟随默认句柄变化。
 */
export async function copyTargetDirectoryHandleToScope(pageType, pageScope) {
  const normalizedScopeKey = normalizeScopeKey(pageScope);
  if (!normalizedScopeKey) {
    return false;
  }

  const handle = await getTargetDirectoryHandle(pageType).catch(() => null);
  if (!handle) {
    return false;
  }

  // 新页面第一次建立快照时复制当前默认句柄，后续默认值变化不会回写到旧页面 scope。
  await saveTargetDirectoryHandleForScope(handle, normalizedScopeKey);
  return true;
}

/**
 * 标签页关闭后按 scope 前缀清理 IndexedDB 中的页面级句柄快照。
 */
export async function clearTargetDirectoryHandlesByScopePrefix(scopePrefix) {
  const normalizedPrefix = normalizeScopeKey(scopePrefix);
  if (!normalizedPrefix) {
    return;
  }

  const keyPrefix = `${PAGE_HANDLE_KEY_PREFIX}:${normalizedPrefix}`;
  await withStore("readwrite", (store) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        return;
      }

      if (String(cursor.key || "").startsWith(keyPrefix)) {
        cursor.delete();
      }
      cursor.continue();
    };
    return request;
  });
}

export async function getTargetDirectoryLabel(pageType = "default") {
  const handle = await getTargetDirectoryHandle(pageType);
  return handle?.name || "";
}
