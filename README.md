# TicketConta

PWA (iOS y Android) que convierte fotos de tickets en contabilidad según el PGC español.

## Qué hace
- **Captura**: cámara del móvil o subida de imágenes/PDF (varios a la vez).
- **Extracción**: con IA (Claude, si pones tu clave de API en Ajustes) o con OCR local (Tesseract) sin clave.
- **Revisión**: formulario editable con desglose de IVA por tipo, retención IRPF, forma de pago y cuenta de gasto (6xx).
- **Contabilidad**: asiento automático (gasto + 472 IVA soportado / 570 caja, 572 bancos o 410 acreedores), resumen por trimestre/año, IVA soportado por tipo, gasto por cuenta y libro diario.
- **Exportación CSV** (formato Excel español): libro registro de facturas recibidas, libro diario y asientos genéricos para importar en A3, Contasol, Sage, Holded…
- **Datos locales**: todo se guarda en el dispositivo (IndexedDB). Copia de seguridad/restauración en JSON.
- **Offline**: funciona sin conexión (salvo la lectura con IA).

## Probar en local
```
python -m http.server 5180 -d .
```
y abrir http://localhost:5180

## Instalar en el móvil
Para instalarla como app, el móvil necesita abrirla por **HTTPS**. Basta con subir esta carpeta tal cual a cualquier hosting estático
(GitHub Pages, Netlify, Cloudflare Pages…). No hay que compilar nada.

- **Android (Chrome)**: menú ⋮ → «Instalar aplicación» (o el botón en Ajustes).
- **iPhone (Safari)**: Compartir → «Añadir a pantalla de inicio».

## Notas
- La clave de API se guarda solo en el navegador del dispositivo y las imágenes se envían directamente a la API de Anthropic.
- `tools/make_icons.py` regenera los iconos. `test/ticket-prueba.jpg` es un ticket de ejemplo.
