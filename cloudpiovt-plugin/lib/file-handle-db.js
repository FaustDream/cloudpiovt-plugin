const DB_NAME = "vue-editor-data-writer";
const STORE_NAME = "handles";
const HANDLE_KEY_PREFIX = "target-directory";

function normalizePageType(pageType) {
  const normalized = String(pageType || "").trim();
  return normalized || "default";
}

function buildHandleKey(pageType) {
  return `${HANDLE_KEY_PREFIX}:${normalizePageType(pageType)}`;
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

export async function getTargetDirectoryLabel(pageType = "default") {
  const handle = await getTargetDirectoryHandle(pageType);
  return handle?.name || "";
}
