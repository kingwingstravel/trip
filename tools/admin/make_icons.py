# Значки King Wings для экрана «Домой» / рабочего стола.
# python3 tools/admin/make_icons.py  → apps/<name>/icon-*.png
from PIL import Image, ImageDraw, ImageFont
import os, sys

FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
SETS = {
    # name: (верх, низ, цвет подписи, подпись)
    'menu':    ('#1FA37F', '#0A4F3F', '#F4C95D', 'MENU'),
    'galeri':  ('#F39A2C', '#B0480A', '#FFF1CC', 'GALLERY'),
    'sales':   ('#2466D6', '#0B2A66', '#F4C95D', 'SALES'),
    'site':    ('#7B3FC4', '#3A1670', '#F4C95D', 'WEBSITE'),
}

def hexc(h): return tuple(int(h[i:i+2], 16) for i in (1, 3, 5))

def icon(top, bot, accent, label, size=1024, rounded=True):
    s = size
    g = Image.new('RGB', (s, s))
    a, b = hexc(top), hexc(bot)
    d = ImageDraw.Draw(g)
    for y in range(s):
        t = y / (s - 1)
        d.line([(0, y), (s, y)], fill=tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)))
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    mask = Image.new('L', (s, s), 0)
    r = int(s * 0.2) if rounded else 0
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], r, fill=255)
    img.paste(g, (0, 0), mask)
    d = ImageDraw.Draw(img)
    f1 = ImageFont.truetype(FONT, int(s * 0.36))
    d.text((s / 2, s * 0.44), 'KW', font=f1, fill='white', anchor='mm')
    d.rounded_rectangle([s * 0.24, s * 0.665, s * 0.76, s * 0.677], 6, fill=accent)
    fs = int(s * 0.115)
    f2 = ImageFont.truetype(FONT, fs)
    while d.textlength(label, font=f2) > s * 0.66:
        fs -= 4; f2 = ImageFont.truetype(FONT, fs)
    d.text((s / 2, s * 0.785), label, font=f2, fill=accent, anchor='mm')
    return img

root = os.path.join(os.path.dirname(__file__), '..', '..', 'apps')
for name, (t, b, acc, lab) in SETS.items():
    out = os.path.join(root, name); os.makedirs(out, exist_ok=True)
    big = icon(t, b, acc, lab)
    for n in (512, 192, 64):
        big.resize((n, n), Image.LANCZOS).save(os.path.join(out, f'icon-{n}.png'))
    full = icon(t, b, acc, lab, rounded=False)
    full.convert('RGB').resize((180, 180), Image.LANCZOS).save(os.path.join(out, 'apple-touch-icon.png'))
print('ok')
