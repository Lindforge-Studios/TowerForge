import { describe, expect, it } from "vitest";
import { createIndexedDbSessionStorage } from "./indexeddb-session-storage.mjs";

describe("R18 IndexedDB transaction durability regressions (RED)", () => {
  it.each([
    ["setItem", (storage) => storage.setItem("key", "value")],
    ["removeItem", (storage) => storage.removeItem("key")]
  ])("%s resolves only after the readwrite transaction completes", async (_label, start) => {
    const fake = new ControlledIndexedDb();
    const storage = createIndexedDbSessionStorage({ indexedDB: fake, dbName: "test", storeName: "sessions" });
    let settled = false;
    const operation = start(storage).finally(() => { settled = true; });
    const transaction = await fake.nextTransaction();
    transaction.succeedRequest();
    await Promise.resolve();
    await Promise.resolve();
    const resolvedBeforeCommit = settled;
    transaction.complete();
    await operation;
    expect(resolvedBeforeCommit).toBe(false);
  });

  it.each(["abort", "error"])("rejects when the readwrite transaction emits %s after request success", async (event) => {
    const fake = new ControlledIndexedDb();
    const storage = createIndexedDbSessionStorage({ indexedDB: fake, dbName: "test", storeName: "sessions" });
    const operation = storage.setItem("key", "value");
    const transaction = await fake.nextTransaction();
    transaction.succeedRequest();
    transaction.failTransaction(event);
    await expect(operation).rejects.toThrow(/transaction|abort|indexeddb/i);
  });
});

class ControlledIndexedDb {
  constructor() {
    this.transactions = [];
    this.waiters = [];
    this.database = {
      objectStoreNames: { contains: () => true },
      transaction: (_storeName, mode) => {
        const transaction = new ControlledTransaction(mode);
        const waiter = this.waiters.shift();
        if (waiter) waiter(transaction);
        else this.transactions.push(transaction);
        return transaction;
      }
    };
  }

  open() {
    const request = { result: this.database, error: null };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  }

  nextTransaction() {
    const transaction = this.transactions.shift();
    if (transaction) return Promise.resolve(transaction);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

class ControlledTransaction {
  constructor(mode) {
    this.mode = mode;
    this.error = null;
    this.request = null;
  }

  objectStore() {
    return {
      get: () => this.makeRequest(null),
      put: () => this.makeRequest(undefined),
      delete: () => this.makeRequest(undefined)
    };
  }

  makeRequest(result) {
    this.request = { result, error: null };
    return this.request;
  }

  succeedRequest() {
    this.request.onsuccess?.();
  }

  complete() {
    this.oncomplete?.();
  }

  failTransaction(kind) {
    this.error = new Error(`IndexedDB transaction ${kind}`);
    if (kind === "abort") this.onabort?.();
    else this.onerror?.();
  }
}
