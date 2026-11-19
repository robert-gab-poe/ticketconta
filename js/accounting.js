// Lógica contable (Plan General Contable español).

export const CUENTAS_GASTO = [
  { cuenta: '600', nombre: 'Compras de mercaderías' },
  { cuenta: '602', nombre: 'Compras de otros aprovisionamientos (material de oficina, consumibles)' },
  { cuenta: '621', nombre: 'Arrendamientos y cánones (alquileres, parking)' },
  { cuenta: '622', nombre: 'Reparaciones y conservación' },
  { cuenta: '623', nombre: 'Servicios de profesionales independientes' },
  { cuenta: '624', nombre: 'Transportes (taxi, tren, avión, mensajería)' },
  { cuenta: '625', nombre: 'Primas de seguros' },
  { cuenta: '626', nombre: 'Servicios bancarios y similares' },
  { cuenta: '627', nombre: 'Publicidad, propaganda y relaciones públicas' },
  { cuenta: '628', nombre: 'Suministros (luz, agua, gas, combustible, teléfono)' },
  { cuenta: '629', nombre: 'Otros servicios (restaurantes, dietas, hoteles, software)' },
  { cuenta: '631', nombre: 'Otros tributos (tasas, IBI, IVTM)' },
  { cuenta: '216', nombre: 'Mobiliario (inmovilizado)' },
  { cuenta: '217', nombre: 'Equipos para procesos de información (inmovilizado)' },
];

export const nombreCuenta = (c) => CUENTAS_GASTO.find((x) => x.cuenta === c)?.nombre ?? c;

export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const fmt = (n) =>
  (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function totales(t) {
  const base = r2((t.iva || []).reduce((s, l) => s + (Number(l.base) || 0), 0));
  const cuota = r2((t.iva || []).reduce((s, l) => s + (Number(l.cuota) || 0), 0));
  const retencion = r2(t.retencion);
  return { base, cuota, retencion, calculado: r2(base + cuota - retencion) };
}

/** Cuenta de contrapartida según forma de pago. */
function cuentaPago(t, s) {
  if (t.pago === 'efectivo') return s.cuentaCaja;
  if (t.pago === 'pendiente') return s.cuentaAcreedor;
  return s.cuentaBanco;
}

/**
 * Genera las líneas del asiento de un ticket.
 * Debe: gasto (base) + IVA soportado (cuota, por tipo)
 * Haber: retención IRPF (si hay) + caja/banco/acreedor (total)
 * Si el total del ticket no cuadra por céntimos de redondeo, se ajusta en la base.
 */
export function asiento(t, s) {
  const { base, cuota, retencion } = totales(t);
  const total = r2(t.total);
  const concepto = `${t.proveedor || 'Ticket'}${t.numero ? ' · ' + t.numero : ''}`;
  const lineas = [];
  const descuadre = r2(total - (base + cuota - retencion));
  const ajuste = Math.abs(descuadre) <= 0.05 ? descuadre : 0;

  lineas.push({ cuenta: t.cuenta || '629', concepto, debe: r2(base + ajuste), haber: 0 });
  for (const l of t.iva || []) {
    if (Number(l.cuota)) {
      lineas.push({ cuenta: `${s.cuentaIva}`, concepto: `IVA ${l.tipo}% ${concepto}`, debe: r2(l.cuota), haber: 0 });
    }
  }
  if (retencion) lineas.push({ cuenta: s.cuentaRetencion, concepto: `Retención IRPF ${concepto}`, debe: 0, haber: retencion });
  const totalDebe = r2(lineas.reduce((a, l) => a + l.debe, 0));
  lineas.push({ cuenta: cuentaPago(t, s), concepto, debe: 0, haber: r2(totalDebe - retencion) });
  return lineas;
}

// ---------- Periodos ----------
export function periodos(tickets) {
  const years = [...new Set(tickets.map((t) => (t.fecha || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  if (!years.length) years.push(String(new Date().getFullYear()));
  const out = [{ id: 'all', label: 'Todo' }];
  for (const y of years) {
    out.push({ id: y, label: `Año ${y}` });
    for (let q = 4; q >= 1; q--) out.push({ id: `${y}-T${q}`, label: `${q}T ${y}` });
  }
  return out;
}

export function enPeriodo(t, p) {
  if (p === 'all') return true;
  const f = t.fecha || '';
  if (/^\d{4}$/.test(p)) return f.startsWith(p);
  const [y, q] = p.split('-T');
  if (!f.startsWith(y)) return false;
  const m = Number(f.slice(5, 7));
  return Math.ceil(m / 3) === Number(q);
}

// ---------- Exportación CSV (formato España: ; y coma decimal) ----------
const csvCell = (v) => {
  const s = typeof v === 'number' ? fmt(v).replace(/\./g, '') : String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
const fechaES = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

export function csvRegistro(tickets) {
  const rows = [['Fecha', 'Nº factura', 'Proveedor', 'NIF', 'Cuenta', 'Base imponible', 'Tipo IVA %', 'Cuota IVA', 'Retención', 'Total']];
  for (const t of tickets) {
    const lines = t.iva?.length ? t.iva : [{ tipo: 0, base: 0, cuota: 0 }];
    lines.forEach((l, i) => rows.push([
      fechaES(t.fecha), t.numero, t.proveedor, t.nif, t.cuenta,
      r2(l.base), Number(l.tipo), r2(l.cuota), i === 0 ? r2(t.retencion) : 0, i === 0 ? r2(t.total) : 0,
    ]));
  }
  return toCsv(rows);
}

export function csvDiario(tickets, s) {
  const rows = [['Asiento', 'Fecha', 'Cuenta', 'Concepto', 'Debe', 'Haber']];
  [...tickets].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')).forEach((t, i) => {
    for (const l of asiento(t, s)) rows.push([i + 1, fechaES(t.fecha), l.cuenta, l.concepto, l.debe, l.haber]);
  });
  return toCsv(rows);
}

export function csvAsientosGenerico(tickets, s) {
  // Una fila por apunte, con NIF y documento — fácil de mapear en A3, Contasol, Sage, Holded…
  const rows = [['Asiento', 'Fecha', 'Documento', 'Cuenta', 'NIF', 'Nombre', 'Concepto', 'Debe', 'Haber', 'Base', 'Tipo IVA']];
  [...tickets].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')).forEach((t, i) => {
    for (const l of asiento(t, s)) {
      const ivaLine = l.cuenta === s.cuentaIva ? (t.iva || []).find((x) => r2(x.cuota) === l.debe) : null;
      rows.push([i + 1, fechaES(t.fecha), t.numero, l.cuenta, t.nif, t.proveedor, l.concepto, l.debe, l.haber,
        ivaLine ? r2(ivaLine.base) : '', ivaLine ? Number(ivaLine.tipo) : '']);
    }
  });
  return toCsv(rows);
}
