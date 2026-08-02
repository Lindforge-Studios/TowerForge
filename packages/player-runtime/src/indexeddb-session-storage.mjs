export function createIndexedDbSessionStorage(options = {}) {
  const indexedDB = options.indexedDB ?? globalThis.indexedDB;
  const dbName = options.dbName ?? "towerforge-player";
  const storeName = options.storeName ?? "sessions";
  if (!indexedDB || typeof indexedDB.open !== "function") throw new Error("IndexedDB is unavailable.");
  if (typeof dbName !== "string" || !dbName || typeof storeName !== "string" || !storeName) throw new TypeError("IndexedDB names are invalid.");
  let databasePromise;
  const database = () => {
    databasePromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB."));
      request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked."));
    });
    return databasePromise;
  };
  const execute = async (mode, operation) => {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let request;
      try { request = operation(store); } catch (error) { reject(error); return; }
      let requestResult = null;
      request.onsuccess = () => {
        requestResult = request.result ?? null;
        if (mode === "readonly") resolve(requestResult);
      };
      request.onerror = () => reject(request.error ?? transaction.error ?? new Error("IndexedDB operation failed."));
      transaction.oncomplete = () => { if (mode === "readwrite") resolve(requestResult); };
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    });
  };
  return Object.freeze({
    getItem: async (key) => {
      const value = await execute("readonly", (store) => store.get(key));
      return value === undefined ? null : value;
    },
    setItem: async (key, value) => { await execute("readwrite", (store) => store.put(value, key)); },
    removeItem: async (key) => { await execute("readwrite", (store) => store.delete(key)); }
  });
}
