// Extracción de datos del ticket: Claude (si hay clave) u OCR local con Tesseract.
import { CUENTAS_GASTO, r2 } from './accounting.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.5.0/+esm';
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';

// ---------------- Claude ----------------
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['es_ticket', 'fecha', 'numero', 'proveedor', 'nif', 'concepto', 'cuenta', 'pago', 'iva', 'retencion', 'total', 'avisos'],
  properties: {
    es_ticket: { type: 'boolean', description: 'false si la imagen no es un ticket o factura' },
    fecha: { type: 'string', description: 'Fecha de emisión en formato AAAA-MM-DD, o "" si no aparece' },
    numero: { type: 'string', description: 'Número de factura o ticket, o ""' },
    proveedor: { type: 'string', description: 'Nombre comercial o razón social del emisor' },
    nif: { type: 'string', description: 'NIF/CIF del emisor sin espacios ni guiones, o ""' },
    concepto: { type: 'string', description: 'Descripción breve del gasto (máx. 60 caracteres)' },
    cuenta: { type: 'string', enum: CUENTAS_GASTO.map((c) => c.cuenta) },
    pago: { type: 'string', enum: ['tarjeta', 'efectivo', 'transferencia', 'pendiente'] },
    iva: {
      type: 'array',
      description: 'Desglose por tipo de IVA (o IGIC). Una entrada por tipo.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tipo', 'base', 'cuota'],
        properties: {
          tipo: { type: 'number', description: 'Porcentaje, p. ej. 21, 10, 4, 0' },
          base: { type: 'number' },
          cuota: { type: 'number' },
        },
      },
    },
    retencion: { type: 'number', description: 'Retención IRPF en euros (0 si no hay)' },
    total: { type: 'number', description: 'Importe total pagado' },
    avisos: { type: 'string', description: 'Dudas o datos ilegibles, en español; "" si todo está claro' },
  },
};

const SYSTEM = `Eres un asistente contable español. Extraes los datos de tickets y facturas simplificadas o completas para registrarlos como gasto según el Plan General Contable.
Reglas:
- Usa los importes que aparecen impresos. Si el ticket solo muestra el total con "IVA incluido" y un tipo, calcula base = total / (1 + tipo/100) y cuota = total - base, redondeando a 2 decimales.
- Si no se indica tipo de IVA, deduce el más probable (21 % general; 10 % hostelería, transporte de viajeros y alimentación elaborada; 4 % pan, leche, libros, medicamentos; 0 % tasas y seguros).
- Seguros, tasas y servicios bancarios están exentos: IVA con tipo 0 y cuota 0.
- La suma de bases + cuotas - retención debe coincidir con el total.
- Elige la cuenta de gasto más adecuada. Restaurantes, hoteles y dietas → 629. Combustible → 628. Taxi, tren, avión, peajes → 624. Parking → 621.
- Forma de pago: "efectivo" si pone efectivo/cash/cambio; "tarjeta" si aparece tarjeta, VISA, datáfono, contactless; si no se sabe, "tarjeta".
- Indica en "avisos" cualquier dato dudoso o ilegible.`;

let sdkPromise;
const loadSdk = () => (sdkPromise ??= import(SDK_URL).then((m) => m.default ?? m.Anthropic));

export async function extractWithClaude(input, settings) {
  const Anthropic = await loadSdk();
  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });

  const media = input.kind === 'pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.base64 } }
    : { type: 'image', source: { type: 'base64', media_type: input.mediaType, data: input.base64 } };

  const params = {
    model: settings.model,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: [media, { type: 'text', text: 'Extrae los datos de este ticket.' }] }],
  };

  let response;
  if (settings.model.startsWith('claude-haiku')) {
    // Haiku no admite reintento automático en otro modelo.
    response = await client.messages.create(params);
  } else {
    // Si el modelo rechaza la petición, la API la reintenta automáticamente en otro modelo.
    response = await client.beta.messages.create({
      ...params,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  }

  if (response.stop_reason === 'refusal') {
    throw new Error('El modelo no ha podido procesar esta imagen.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('La respuesta se ha cortado. Prueba de nuevo.');
  }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const data = JSON.parse(text);
  return normalise(data, 'claude');
}

export function describeApiError(err) {
  const status = err?.status;
  if (status === 401) return 'Clave de API no válida. Revísala en Ajustes.';
  if (status === 403) return 'La clave no tiene permiso para este modelo.';
  if (status === 429) return 'Demasiadas peticiones o sin saldo. Espera un momento.';
  if (status === 413) return 'La imagen es demasiado grande.';
  if (status >= 500) return 'El servicio de IA no está disponible ahora mismo. Inténtalo más tarde.';
  if (err?.name === 'APIConnectionError' || err instanceof TypeError) return 'Sin conexión con el servicio de IA.';
  return err?.message || 'Error desconocido';
}

// ---------------- OCR local (Tesseract) ----------------
let tessPromise;
function loadTesseract() {
  return (tessPromise ??= new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => { tessPromise = null; reject(new Error('No se pudo cargar el OCR (¿sin conexión?)')); };
    document.head.appendChild(s);
  }));
}

export async function extractWithOcr(dataUrl, onProgress) {
  const T = await loadTesseract();
  const worker = await T.createWorker('spa', 1, {
    logger: (m) => m.status === 'recognizing text' && onProgress?.(Math.round(m.progress * 100)),
  });
  try {
    const { data } = await worker.recognize(dataUrl);
    return normalise(parseOcrText(data.text), 'ocr');
  } finally {
    await worker.terminate();
  }
}

const num = (s) => {
  if (s == null) return NaN;
  let v = String(s).replace(/\s|€|EUR/gi, '');
  if (/,\d{1,2}$/.test(v)) v = v.replace(/\./g, '').replace(',', '.');
  else v = v.replace(/,/g, '');
  return parseFloat(v);
};

export function parseOcrText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const all = lines.join('\n');
  const AMT = '(\\d{1,3}(?:[.\\s]\\d{3})*[.,]\\d{2}|\\d+[.,]\\d{2})';

  // Total: la última línea que contenga "total" (evitando "subtotal"/"total iva")
  let total = NaN;
  for (const l of lines) {
    if (/total/i.test(l) && !/sub\s*total|total\s*(iva|impuestos|base)/i.test(l)) {
      const m = l.match(new RegExp(AMT + '(?!.*\\d)'));
      if (m) total = num(m[1]);
    }
  }
  if (isNaN(total)) {
    const amounts = [...all.matchAll(new RegExp(AMT, 'g'))].map((m) => num(m[1])).filter((n) => !isNaN(n));
    total = amounts.length ? Math.max(...amounts) : 0;
  }

  // Fecha
  let fecha = '';
  const fm = all.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (fm) {
    let [, d, m, y] = fm;
    if (y.length === 2) y = '20' + y;
    if (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31) fecha = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // NIF/CIF
  const nm = all.toUpperCase().replace(/[-\s]/g, (c) => (c === '\n' ? '\n' : '')).match(/\b([ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]|\d{8}[A-Z]|[XYZ]\d{7}[A-Z])\b/);
  const nif = nm ? nm[1] : '';

  // Nº ticket
  let numero = '';
  for (const l of lines) {
    const tm = l.match(/(?:factura|ticket|fra\.?|n[ºo°]\.?)\s*(?:n[ºo°]\.?|num\.?|doc\.?)?\s*[:#.]?\s*([A-Z0-9][A-Z0-9\/\-]*\d[A-Z0-9\/\-]*)/i);
    if (tm && !/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(tm[1])) { numero = tm[1]; break; }
  }

  // Tipo de IVA
  const im = all.match(/(?:IVA|I\.V\.A\.?)[^\n%\d]{0,10}(21|10|4)\s*%|\b(21|10|4)[.,]?0{0,2}\s*%/i);
  const tipo = im ? Number(im[1] || im[2]) : 21;
  const base = r2(total / (1 + tipo / 100));

  // Proveedor: primera línea con letras que no sea dirección/NIF
  const proveedor = lines.find((l) => /[a-záéíóúñ]{3,}/i.test(l) && !/c\/|calle|avda|nif|cif|tel|www|@/i.test(l)) || '';

  const efectivo = /efectivo|cambio|entregado|cash/i.test(all);

  return {
    es_ticket: true,
    fecha, numero, proveedor: proveedor.slice(0, 60), nif,
    concepto: '', cuenta: '629', pago: efectivo ? 'efectivo' : 'tarjeta',
    iva: total ? [{ tipo, base, cuota: r2(total - base) }] : [],
    retencion: 0, total,
    avisos: 'Datos leídos con OCR local: revisa todos los campos con atención.',
  };
}

function normalise(d, origen) {
  return {
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(d.fecha) ? d.fecha : '',
    numero: d.numero || '',
    proveedor: d.proveedor || '',
    nif: (d.nif || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
    concepto: d.concepto || '',
    cuenta: CUENTAS_GASTO.some((c) => c.cuenta === d.cuenta) ? d.cuenta : '629',
    pago: d.pago || 'tarjeta',
    iva: (d.iva || []).map((l) => ({ tipo: Number(l.tipo) || 0, base: r2(l.base), cuota: r2(l.cuota) })),
    retencion: r2(d.retencion),
    total: r2(d.total),
    avisos: [d.es_ticket === false ? 'La imagen no parece un ticket.' : '', d.avisos || ''].filter(Boolean).join(' '),
    origen,
  };
}
