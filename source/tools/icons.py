import os
from PIL import Image, ImageDraw, ImageFont
OUT = 'icons'; os.makedirs(OUT, exist_ok=True)
PAPER = (237, 241, 239); SHELF = (182, 193, 187); SHELF_EDGE = (151, 163, 157)
SPINES = [((43, 106, 96), 0.50), ((140, 94, 30), 0.41), ((45, 74, 122), 0.56)]

def spines(d, cx, base_y, unit):
    # unit = overall group scale in px
    w = unit * 0.20; gap = unit * 0.055
    total = 3 * w + 2 * gap
    x = cx - total / 2
    for col, h in SPINES:
        H = unit * h * 1.55
        top = base_y - H
        r = max(1, int(unit * 0.02))
        d.rounded_rectangle([x, top, x + w, base_y], radius=r, fill=col)
        shade = tuple(max(0, c - 28) for c in col)
        d.rectangle([x + w * 0.84, top + r, x + w, base_y], fill=shade)
        band = tuple(min(255, c + 70) for c in col)
        bh = max(1, unit * 0.012)
        d.rectangle([x, top + H * 0.10, x + w * 0.84, top + H * 0.10 + bh], fill=band)
        d.rectangle([x, base_y - H * 0.16, x + w * 0.84, base_y - H * 0.16 + bh], fill=band)
        x += w + gap
    sw = total + unit * 0.16
    sh = unit * 0.05
    d.rectangle([cx - sw / 2, base_y, cx + sw / 2, base_y + sh], fill=SHELF)
    d.rectangle([cx - sw / 2, base_y + sh, cx + sw / 2, base_y + sh * 1.6], fill=SHELF_EDGE)

def icon(size, maskable=False, rounded=True, scale=1.0):
    S = size * 4
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if maskable or not rounded:
        d.rectangle([0, 0, S, S], fill=PAPER)
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=PAPER)
    unit = S * (0.46 if maskable else 0.56) * scale
    base_y = S * (0.70 if maskable else 0.74)
    spines(d, S / 2, base_y, unit)
    return im.resize((size, size), Image.LANCZOS)

icon(512).save(f'{OUT}/icon-512.png')
icon(192).save(f'{OUT}/icon-192.png')
icon(512, maskable=True).save(f'{OUT}/maskable-512.png')
icon(180, rounded=False).convert('RGB').save(f'{OUT}/apple-touch-icon.png')
icon(32, scale=1.12).save(f'{OUT}/favicon-32.png')

def find_kr_font():
    path = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
    for i in range(10):
        try:
            f = ImageFont.truetype(path, 40, index=i)
            if 'KR' in ' '.join(f.getname()): return path, i
        except Exception: break
    return path, 0
FP, FI = find_kr_font()

def shortcut(name, bg, glyph=None, bars=False):
    S = 96 * 4
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.ellipse([0, 0, S - 1, S - 1], fill=bg)
    if bars:
        bw = S * 0.11; xs = [S * 0.30, S * 0.445, S * 0.59]; hs = [0.22, 0.40, 0.30]
        for x, h in zip(xs, hs):
            d.rounded_rectangle([x, S * 0.68 - S * h, x + bw, S * 0.68], radius=int(S * 0.02), fill=(255, 255, 255))
        d.rectangle([S * 0.26, S * 0.70, S * 0.74, S * 0.72], fill=(255, 255, 255))
    else:
        f = ImageFont.truetype(FP, int(S * 0.46), index=FI)
        bb = d.textbbox((0, 0), glyph, font=f)
        w, h = bb[2] - bb[0], bb[3] - bb[1]
        d.text(((S - w) / 2 - bb[0], (S - h) / 2 - bb[1]), glyph, font=f, fill=(255, 255, 255))
    im.resize((96, 96), Image.LANCZOS).save(f'{OUT}/sc-{name}.png')

shortcut('write', (34, 64, 122), '쓰')
shortcut('site', (43, 106, 96), '현')
shortcut('money', (140, 94, 30), '₩')
shortcut('stats', (77, 87, 82), bars=True)
print('font', FP, FI)
