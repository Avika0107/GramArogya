/* IndexedDB wrapper — the ASHA PWA's offline storage.
 *
 * Stores:
 *   patients : local cache of patient records (key: abha_id)
 *   pending  : queue of records to sync to the backend (key: client_id)
 *   settings : key/value (last sync time, device id, ...)
 *
 * All functions return Promises.
 */

const DB_NAME = 'gramarogya-db';
const DB_VERSION = 1;
let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('patients')) {
        const store = db.createObjectStore('patients', { keyPath: 'abha_id' });
        store.createIndex('name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains('pending')) {
        const store = db.createObjectStore('pending', { keyPath: 'client_id' });
        store.createIndex('created_at', 'created_at', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return _dbPromise;
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore(storeName, mode, fn) {
  return openDB().then((db) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      Promise.resolve(fn(store)).then(resolve, reject);
      tx.onerror = () => reject(tx.error);
    })
  );
}

const db = {
  // patients
  savePatient: (patient) => withStore('patients', 'readwrite', (s) => reqToPromise(s.put(patient))),
  getPatient: (abhaId) => withStore('patients', 'readonly', (s) => reqToPromise(s.get(abhaId))),
  getAllPatients: () => withStore('patients', 'readonly', (s) => reqToPromise(s.getAll())),

  // pending sync queue
  enqueue: (record) => withStore('pending', 'readwrite', (s) => reqToPromise(s.put(record))),
  savePending: (record) => withStore('pending', 'readwrite', (s) => reqToPromise(s.put(record))),
  getPending: () => withStore('pending', 'readonly', (s) => reqToPromise(s.getAll())),
  removePending: (clientId) => withStore('pending', 'readwrite', (s) => reqToPromise(s.delete(clientId))),
  clearPending: () => withStore('pending', 'readwrite', (s) => reqToPromise(s.clear())),

  // settings
  setSetting: (key, value) => withStore('settings', 'readwrite', (s) => reqToPromise(s.put({ key, value }))),
  getSetting: (key) => withStore('settings', 'readonly', (s) => reqToPromise(s.get(key))),
};