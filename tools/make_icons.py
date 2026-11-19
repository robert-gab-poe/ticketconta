"""Genera los iconos PNG de la PWA (ejecutar: python tools/make_icons.py)."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(exist_ok=True)

BG = (15, 118, 110)      # teal
PAPER = (255, 255, 255)
INK = (15, 118, 110)


def draw(size: int, maskable: bool) -> Image.Image:
    s = size
    img = Image.new("RGB", (s, s), BG)
    d = ImageDraw.Draw(img)
    pad = s * (0.24 if maskable else 0.18)
    x0, y0, x1, y1 = pad + s * 0.06, pad, s - pad - s * 0.06, s - pad
    # ticket con borde inferior dentado
    teeth = 6
    w = (x1 - x0) / teeth
    pts = [(x0, y0), (x1, y0), (x1, y1)]
    for i in range(teeth):
        xr = x1 - i * w
        pts += [(xr - w / 2, y1 - w / 2), (xr - w, y1)]
    d.polygon(pts, fill=PAPER)
    # líneas de texto
    lh = (y1 - y0) / 9
    for i, frac in enumerate([0.75, 0.55, 0.65, 0.45]):
        yy = y0 + lh * (1.3 + i * 1.3)
        d.rounded_rectangle([x0 + lh, yy, x0 + lh + (x1 - x0 - 2 * lh) * frac, yy + lh * 0.55],
                            radius=lh * 0.27, fill=(180, 200, 198))
    # total
    yy = y0 + lh * 6.6
    d.rounded_rectangle([x0 + lh, yy, x1 - lh, yy + lh * 0.9], radius=lh * 0.4, fill=INK)
    return img


for name, size, mask in [
    ("icon-192.png", 192, False),
    ("icon-512.png", 512, False),
    ("maskable-512.png", 512, True),
    ("apple-touch-icon.png", 180, True),
]:
    draw(size, mask).save(OUT / name)
    print("ok", name)
