/**
 * Offline data snapshot — a tiny, dependency-free IndexedDB key/value store
 * holding the last successfully-loaded copy of the org's data (jobs, schedule,
 * customers, …). It lets the app show REAL data when the phone has no signal
 * instead of blanking out (the store's loadAll used to overwrite everything
 * with empty arrays the moment the network failed).
 *
 * Deliberately minimal: one database, one object store, one row keyed
 * "snapshot". Every operation is best-effort and swallows its own errors — a
 * storage failure must never throw into the app; the worst case is simply
 * "no offline data available", which is the pre-existing behaviour.
 *
 * SAFETY: the snapshot is stamped with the userId + orgId it was written for,
 * and loadSnapshot refuses to return anything unless the caller's userId
 * matches — so a second account signing in on the same device can never be
 * handed the first account's cached data. localStorage-scoped org/user are
 * kept separately by the store; this file only caches the bulk collections.
 */

const DB_NAME = "creed-offline";
const STORE_NAME = "kv";
const SNAPSHOT_KEY = "snapshot";
const SNAPSHOT_VERSION = 1;

export interface OfflineSnapshot {
  v: number;
  userId?: string;
  orgId?: string;
  at: number; // epoch ms of when the snapshot was written
  data: Record<string, unknown[]>;
}

function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Persist the current data set. No-op without a userId (can't scope it). */
export async function saveSnapshot(
  userId: string | undefined,
  orgId: string | undefined,
  data: Record<string, unknown[]>,
): Promise<void> {
  if (!idbAvailable() || !userId) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const snap: OfflineSnapshot = {
        v: SNAPSHOT_VERSION,
        userId,
        orgId,
        at: Date.now(),
        data,
      };
      tx.objectStore(STORE_NAME).put(snap, SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* best-effort — no offline snapshot is an acceptable degradation */
  }
}

/** Read the snapshot, but only if it belongs to this user (and org, if known). */
export async function loadSnapshot(
  userId: string | undefined,
  orgId: string | undefined,
): Promise<OfflineSnapshot | null> {
  if (!idbAvailable() || !userId) return null; // no user → can't verify owner
  try {
    const db = await openDb();
    const snap = await new Promise<OfflineSnapshot | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(SNAPSHOT_KEY);
      req.onsuccess = () =>
        resolve((req.result as OfflineSnapshot | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!snap || snap.v !== SNAPSHOT_VERSION) return null;
    // Owner guard: never serve one account's data to another.
    if (snap.userId && snap.userId !== userId) return null;
    if (orgId && snap.orgId && snap.orgId !== orgId) return null;
    return snap;
  } catch {
    return null;
  }
}

/** Wipe the snapshot (called on logout so the next account starts clean). */
export async function clearSnapshot(): Promise<void> {
  if (!idbAvailable()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
    db.close();
  } catch {
    /* best-effort */
  }
}
