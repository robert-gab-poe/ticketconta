// Almacenamiento local con IndexedDB (tickets) y localStorage (ajustes).
const DB_NAME = 'ticketconta';
const STORE = 'tickets';
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('fecha', 'fecha');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export const db = {
  all: () => tx('readonly', (s) => s.getAll()).then((rows) =>
    rows.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || b.creado - a.creado)),
  get: (id) => tx('readonly', (s) => s.get(id)),
  put: (t) => tx('readwrite', (s) => s.put(t)),
  remove: (id) => tx('readwrite', (s) => s.delete(id)),
  clear: () => tx('readwrite', (s) => s.clear()),
};

const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'claude-opus-5-5',
  cuentaIva: '472',
  cuentaAcreedor: '410',
  cuentaCaja: '570',
  cuentaBanco: '572',
  cuentaRetencion: '4751',
};

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('tc-settings') || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem('tc-settings', JSON.stringify(s));
  } catch { /* almacenamiento bloqueado */ }
}
