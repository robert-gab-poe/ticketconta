// Utilidades de imagen: reducir tamaño (ahorra datos y coste de API) y miniaturas.

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen (¿formato HEIC no soportado?)')); };
    img.src = url;
  });
}

function toCanvas(img, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** Devuelve { dataUrl, base64, mediaType, thumb } listo para enviar/guardar. */
export async function prepareImage(file) {
  const img = await loadImage(file);
  const big = toCanvas(img, 1600);
  const dataUrl = big.toDataURL('image/jpeg', 0.85);
  const thumb = toCanvas(img, 240).toDataURL('image/jpeg', 0.7);
  return { dataUrl, base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', thumb };
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
