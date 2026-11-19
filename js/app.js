import { db, loadSettings, saveSettings } from './db.js';
import { prepareImage, fileToBase64 } from './image.js';
import { extractWithClaude, extractWithOcr, describeApiError } from './extract.js';
import {
  CUENTAS_GASTO, nombreCuenta, fmt, r2, totales, asiento,
  periodos, enPeriodo, csvRegistro, csvDiario, csvAsientosGenerico,
} from './accounting.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const today = () => new Date().toISOString().slice(0, 10);

let settings = loadSettings();
let drafts = [];          // tickets extraídos pendientes de revisar
let editing = null;       // ticket abierto en el formulario
let tickets = [];

// ---------------- Navegación ----------------
function show(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'list') renderList();
  if (view === 'books') renderBooks();
  if (view === 'settings') renderSettings();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

function toast(msg, ms = 3000) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}

// ---------------- Captura ----------------
function updateEngineHint() {
  $('#engineHint').textContent = settings.apiKey
    ? `Lectura con IA (${settings.model}).`
    : 'Lectura con OCR local. Añade una clave de API en Ajustes para mayor precisión.';
}

async function handleFiles(fileList) {
  const files = [...fileList];
  for (const file of files) processFile(file);
}
$('#inCamera').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
$('#inFile').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
$('#btnManual').addEventListener('click', () => openForm(blankTicket(), { isNew: true }));

function blankTicket() {
  return {
    id: uid(), fecha: today(), numero: '', proveedor: '', nif: '', concepto: '',
    cuenta: '629', pago: 'tarjeta', iva: [{ tipo: 21, base: 0, cuota: 0 }], retencion: 0, total: 0,
    avisos: '', origen: 'manual', thumb: '', imagen: '',
  };
}

async function processFile(file) {
  const isPdf = file.type === 'application/pdf';
  const item = document.createElement('div');
  item.className = 'qitem';
  item.innerHTML = `<div class="spinner"></div><div class="qtext">Preparando ${esc(file.name || 'imagen')}…</div>`;
  $('#queue').prepend(item);
  const setText = (t) => ($('.qtext', item).textContent = t);

  try {
    let input, thumb = '', imagen = '';
    if (isPdf) {
      if (!settings.apiKey) throw new Error('Los PDF solo se pueden leer con IA. Añade una clave de API en Ajustes.');
      input = { kind: 'pdf', base64: await fileToBase64(file) };
    } else {
      const img = await prepareImage(file);
      input = { kind: 'image', ...img };
      thumb = img.thumb;
      imagen = img.dataUrl;
      item.insertAdjacentHTML('afterbegin', `<img src="${thumb}" alt="">`);
    }

    let data;
    if (settings.apiKey) {
      setText('Leyendo ticket con IA…');
      try {
        data = await extractWithClaude(input, settings);
      } catch (err) {
        if (isPdf) throw new Error(describeApiError(err));
        setText(`${describeApiError(err)} Probando con OCR local…`);
        data = await extractWithOcr(imagen, (p) => setText(`OCR local… ${p}%`));
      }
    } else {
      setText('Leyendo ticket (OCR local)…');
      data = await extractWithOcr(imagen, (p) => setText(`OCR local… ${p}%`));
    }

    const draft = { ...blankTicket(), ...data, thumb, imagen };
    if (!draft.fecha) draft.fecha = today();
    if (!draft.iva.length) draft.iva = [{ tipo: 21, base: 0, cuota: 0 }];
    drafts.push(draft);
    $('.spinner', item)?.remove();
    setText(`${draft.proveedor || 'Ticket'} · ${fmt(draft.total)} € — listo para revisar`);
    item.dataset.draft = draft.id;
    if (!editing) openNextDraft();
  } catch (err) {
    $('.spinner', item)?.remove();
    setText(`❌ ${err.message}`);
    item.addEventListener('click', () => item.remove());
  }
}

function openNextDraft() {
  const next = drafts.shift();
  if (next) openForm(next, { isNew: true });
}

// ---------------- Formulario ----------------
const form = $('#ticketForm');
$('#selCuenta').innerHTML = CUENTAS_GASTO.map((c) => `<option value="${c.cuenta}">${c.cuenta} · ${esc(c.nombre)}</option>`).join('');

function ivaRow(l = { tipo: 21, base: 0, cuota: 0 }) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="iva-tipo" type="number" step="0.01" inputmode="decimal" value="${l.tipo}"></td>
    <td><input class="iva-base" type="number" step="0.01" inputmode="decimal" value="${l.base}"></td>
    <td><input class="iva-cuota" type="number" step="0.01" inputmode="decimal" value="${l.cuota}"></td>
    <td><button type="button" class="iconbtn" aria-label="Quitar">✕</button></td>`;
  $('.iconbtn', tr).addEventListener('click', () => { tr.remove(); refreshPreview(); });
  // Al cambiar base o tipo, recalcula la cuota
  const recalc = () => {
    const tipo = Number($('.iva-tipo', tr).value) || 0;
    const base = Number($('.iva-base', tr).value) || 0;
    $('.iva-cuota', tr).value = r2(base * tipo / 100);
  };
  $('.iva-tipo', tr).addEventListener('input', recalc);
  $('.iva-base', tr).addEventListener('input', recalc);
  return tr;
}

$('#btnAddIva').addEventListener('click', () => { $('#ivaRows').append(ivaRow({ tipo: 10, base: 0, cuota: 0 })); });

function readForm() {
  const f = new FormData(form);
  return {
    ...editing,
    fecha: f.get('fecha'),
    numero: f.get('numero').trim(),
    proveedor: f.get('proveedor').trim(),
    nif: f.get('nif').trim().toUpperCase(),
    pago: f.get('pago'),
    cuenta: f.get('cuenta'),
    concepto: f.get('concepto').trim(),
    retencion: r2(f.get('retencion')),
    total: r2(f.get('total')),
    iva: [...$('#ivaRows').children].map((tr) => ({
      tipo: Number($('.iva-tipo', tr).value) || 0,
      base: r2($('.iva-base', tr).value),
      cuota: r2($('.iva-cuota', tr).value),
    })).filter((l) => l.base || l.cuota),
  };
}

function refreshPreview() {
  if (!editing) return;
  const t = readForm();
  const { calculado } = totales(t);
  const diff = r2(t.total - calculado);
  const el = $('#checkTotal');
  if (Math.abs(diff) < 0.01) el.textContent = `✔ Bases + IVA − retención = ${fmt(calculado)} € (cuadra con el total)`;
  else if (Math.abs(diff) <= 0.05) el.textContent = `≈ Diferencia de ${fmt(diff)} € por redondeo: se ajustará en la base.`;
  else el.textContent = `⚠ Bases + IVA − retención = ${fmt(calculado)} €, no cuadra con el total (${fmt(diff)} €).`;
  $('#previewEntry').innerHTML = journalTable([t], false);
}
form.addEventListener('input', refreshPreview);

function openForm(t, { isNew }) {
  editing = t;
  form.dataset.isNew = isNew ? '1' : '';
  $('#formTitle').textContent = isNew ? 'Revisar ticket' : 'Editar ticket';
  $('#formThumb').src = t.thumb || '';
  $('#formThumb').onclick = t.imagen ? () => openImage(t.imagen) : null;
  const w = $('#formWarn');
  w.hidden = !t.avisos;
  w.textContent = t.avisos ? `⚠ ${t.avisos}` : '';
  for (const k of ['fecha', 'numero', 'proveedor', 'nif', 'pago', 'cuenta', 'concepto', 'retencion', 'total']) {
    form.elements[k].value = t[k] ?? '';
  }
  $('#ivaRows').replaceChildren(...(t.iva?.length ? t.iva : [{ tipo: 21, base: 0, cuota: 0 }]).map(ivaRow));
  $('#btnCancel').textContent = isNew ? 'Descartar' : 'Eliminar';
  form.hidden = false;
  show('scan');
  refreshPreview();
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeForm() {
  form.hidden = true;
  if (editing) document.querySelector(`.qitem[data-draft="${editing.id}"]`)?.remove();
  editing = null;
  openNextDraft();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = readForm();
  if (!t.iva.length && t.total) t.iva = [{ tipo: 0, base: t.total, cuota: 0 }];
  t.creado ??= Date.now();
  t.modificado = Date.now();
  await db.put(t);
  toast('Ticket guardado ✔');
  closeForm();
  await reload();
});

$('#btnCancel').addEventListener('click', async () => {
  if (form.dataset.isNew) {
    closeForm();
    return;
  }
  if (!confirm('¿Eliminar este ticket? No se puede deshacer.')) return;
  await db.remove(editing.id);
  toast('Ticket eliminado');
  closeForm();
  await reload();
  show('list');
});

function openImage(dataUrl) {
  const w = window.open();
  if (w) w.document.write(`<title>Ticket</title><body style="margin:0;background:#111"><img src="${dataUrl}" style="width:100%">`);
}

// ---------------- Lista ----------------
async function reload() {
  tickets = await db.all();
}

function renderList() {
  const month = $('#filterMonth').value;
  const q = $('#filterText').value.trim().toLowerCase();
  const rows = tickets.filter((t) =>
    (!month || (t.fecha || '').startsWith(month)) &&
    (!q || `${t.proveedor} ${t.nif} ${t.concepto} ${t.numero}`.toLowerCase().includes(q)));

  const sum = rows.reduce((a, t) => {
    const x = totales(t);
    return { base: a.base + x.base, cuota: a.cuota + x.cuota, total: a.total + Number(t.total || 0) };
  }, { base: 0, cuota: 0, total: 0 });
  $('#listSummary').innerHTML = `
    <div class="stat"><b>${fmt(sum.base)} €</b><span>Base</span></div>
    <div class="stat"><b>${fmt(sum.cuota)} €</b><span>IVA soportado</span></div>
    <div class="stat"><b>${fmt(sum.total)} €</b><span>Total (${rows.length})</span></div>`;

  const ul = $('#ticketList');
  if (!rows.length) {
    ul.innerHTML = `<li class="empty" style="cursor:default;border:0;background:none">No hay tickets${month || q ? ' con este filtro' : ' todavía'}.</li>`;
    return;
  }
  ul.innerHTML = rows.map((t) => `
    <li data-id="${t.id}">
      ${t.thumb ? `<img src="${t.thumb}" alt="">` : '<img alt="">'}
      <div class="main"><b>${esc(t.proveedor || 'Sin proveedor')}</b>
        <small>${esc(t.fecha?.split('-').reverse().join('/'))} · ${esc(t.cuenta)} ${esc(nombreCuenta(t.cuenta).split(' (')[0])}</small></div>
      <div class="amt">${fmt(t.total)} €</div>
    </li>`).join('');
}
$('#ticketList').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const t = tickets.find((x) => x.id === li.dataset.id);
  if (t) openForm({ ...t, avisos: '' }, { isNew: false });
});
$('#filterMonth').addEventListener('input', renderList);
$('#filterText').addEventListener('input', renderList);

// ---------------- Contabilidad ----------------
function journalTable(list, numbered = true) {
  const sorted = [...list].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  let td = 0, th = 0, html = '';
  sorted.forEach((t, i) => {
    const lines = asiento(t, settings);
    lines.forEach((l, j) => {
      td += l.debe; th += l.haber;
      html += `<tr class="${j === lines.length - 1 ? 'sep' : ''}">
        ${numbered ? `<td>${j === 0 ? i + 1 : ''}</td>` : ''}
        <td>${j === 0 ? esc(t.fecha?.split('-').reverse().join('/')) : ''}</td>
        <td>${esc(l.cuenta)}</td><td>${esc(l.concepto)}</td>
        <td class="num">${l.debe ? fmt(l.debe) : ''}</td><td class="num">${l.haber ? fmt(l.haber) : ''}</td></tr>`;
    });
  });
  return `<div class="scroll-x"><table class="books">
    <thead><tr>${numbered ? '<th>Nº</th>' : ''}<th>Fecha</th><th>Cuenta</th><th>Concepto</th><th class="num">Debe</th><th class="num">Haber</th></tr></thead>
    <tbody>${html}</tbody>
    <tfoot><tr>${numbered ? '<td></td>' : ''}<td colspan="3">Sumas</td><td class="num">${fmt(td)}</td><td class="num">${fmt(th)}</td></tr></tfoot>
  </table></div>`;
}

function currentPeriodTickets() {
  const p = $('#booksPeriod').value || 'all';
  return tickets.filter((t) => enPeriodo(t, p));
}

function renderBooks() {
  const sel = $('#booksPeriod');
  const prev = sel.value;
  const ps = periodos(tickets);
  sel.innerHTML = ps.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
  sel.value = ps.some((p) => p.id === prev) ? prev : 'all';

  const list = currentPeriodTickets();
  if (!list.length) {
    $('#booksSummary').innerHTML = '<p class="empty">No hay tickets en este periodo.</p>';
    $('#booksByAccount').innerHTML = '';
    $('#booksJournal').innerHTML = '';
    return;
  }

  // IVA por tipo
  const porTipo = {};
  let base = 0, cuota = 0, ret = 0, total = 0;
  for (const t of list) {
    for (const l of t.iva || []) {
      porTipo[l.tipo] ??= { base: 0, cuota: 0 };
      porTipo[l.tipo].base += Number(l.base) || 0;
      porTipo[l.tipo].cuota += Number(l.cuota) || 0;
    }
    const x = totales(t);
    base += x.base; cuota += x.cuota; ret += x.retencion; total += Number(t.total) || 0;
  }
  $('#booksSummary').innerHTML = `
    <div class="kv"><span>Nº de tickets</span><b>${list.length}</b></div>
    <div class="kv"><span>Base imponible total</span><b>${fmt(base)} €</b></div>
    ${Object.entries(porTipo).sort((a, b) => b[0] - a[0]).map(([k, v]) =>
      `<div class="kv"><span>&nbsp;&nbsp;IVA ${k}% — base ${fmt(v.base)} €</span><span>${fmt(v.cuota)} €</span></div>`).join('')}
    <div class="kv"><span>IVA soportado deducible (cuenta ${esc(settings.cuentaIva)})</span><b>${fmt(cuota)} €</b></div>
    ${ret ? `<div class="kv"><span>Retenciones IRPF practicadas</span><b>${fmt(ret)} €</b></div>` : ''}
    <div class="kv"><span>Total pagado</span><b>${fmt(total)} €</b></div>`;

  const porCuenta = {};
  for (const t of list) porCuenta[t.cuenta] = (porCuenta[t.cuenta] || 0) + totales(t).base;
  $('#booksByAccount').innerHTML = Object.entries(porCuenta).sort((a, b) => b[1] - a[1])
    .map(([c, v]) => `<div class="kv"><span>${esc(c)} · ${esc(nombreCuenta(c).split(' (')[0])}</span><b>${fmt(v)} €</b></div>`).join('');

  $('#booksJournal').innerHTML = journalTable(list);
}
$('#booksPeriod').addEventListener('change', renderBooks);

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const periodName = () => $('#booksPeriod').value || 'todo';
$('#expRegistro').addEventListener('click', () =>
  download(`registro-facturas-recibidas-${periodName()}.csv`, csvRegistro(currentPeriodTickets()), 'text/csv;charset=utf-8'));
$('#expDiario').addEventListener('click', () =>
  download(`libro-diario-${periodName()}.csv`, csvDiario(currentPeriodTickets(), settings), 'text/csv;charset=utf-8'));
$('#expA3').addEventListener('click', () =>
  download(`asientos-${periodName()}.csv`, csvAsientosGenerico(currentPeriodTickets(), settings), 'text/csv;charset=utf-8'));

// ---------------- Ajustes ----------------
const SETTING_FIELDS = {
  setKey: 'apiKey', setModel: 'model', setIva: 'cuentaIva', setAcreedor: 'cuentaAcreedor',
  setCaja: 'cuentaCaja', setBanco: 'cuentaBanco', setRet: 'cuentaRetencion',
};
function renderSettings() {
  for (const [id, key] of Object.entries(SETTING_FIELDS)) $('#' + id).value = settings[key];
}
$('#btnSaveSettings').addEventListener('click', () => {
  for (const [id, key] of Object.entries(SETTING_FIELDS)) settings[key] = $('#' + id).value.trim();
  saveSettings(settings);
  updateEngineHint();
  toast('Ajustes guardados');
});

$('#btnBackup').addEventListener('click', async () => {
  const all = await db.all();
  download(`ticketconta-copia-${today()}.json`, JSON.stringify({ version: 1, tickets: all }), 'application/json');
});
$('#inRestore').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.tickets;
    if (!Array.isArray(list)) throw new Error('Formato no válido');
    for (const t of list) if (t?.id) await db.put(t);
    await reload();
    toast(`${list.length} tickets restaurados`);
  } catch (err) {
    toast(`No se pudo restaurar: ${err.message}`);
  }
});
$('#btnWipe').addEventListener('click', async () => {
  if (!confirm('¿Borrar TODOS los tickets de este dispositivo? Descarga antes una copia si la necesitas.')) return;
  await db.clear();
  await reload();
  toast('Datos borrados');
});

// ---------------- PWA ----------------
function updateNet() { $('#netStatus').hidden = navigator.onLine; }
addEventListener('online', updateNet);
addEventListener('offline', updateNet);

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
let deferredInstall;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  const hint = $('#installHint');
  hint.innerHTML = '<button class="btn wide" id="btnInstall">Instalar la app en este dispositivo</button>';
  $('#btnInstall').onclick = async () => { deferredInstall.prompt(); await deferredInstall.userChoice; hint.innerHTML = ''; };
});
if (!standalone && isIos) {
  $('#installHint').textContent = 'Para instalarla en iPhone: pulsa Compartir ⬆️ y luego «Añadir a pantalla de inicio».';
}

if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

// ---------------- Inicio ----------------
updateNet();
updateEngineHint();
reload();
