"""Membuat ikon launcher Android dari ikon web yang sudah ada (www/icons)."""
import os
import sys
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
SRC = os.path.join(ROOT, 'www', 'icons', 'icon-512x512.png')
SRC_MASK = os.path.join(ROOT, 'www', 'icons', 'icon-maskable-512x512.png')

if not os.path.isdir(RES):
    sys.exit('Folder android/ belum ada. Jalankan "npx cap add android" dulu.')

legacy = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
foreground = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}

icon = Image.open(SRC).convert('RGBA')
mask_icon = Image.open(SRC_MASK).convert('RGBA')

for dpi, size in legacy.items():
    d = os.path.join(RES, f'mipmap-{dpi}')
    os.makedirs(d, exist_ok=True)
    img = icon.resize((size, size), Image.LANCZOS)
    img.save(os.path.join(d, 'ic_launcher.png'))
    img.save(os.path.join(d, 'ic_launcher_round.png'))

for dpi, size in foreground.items():
    d = os.path.join(RES, f'mipmap-{dpi}')
    os.makedirs(d, exist_ok=True)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    inner = int(size * 0.80)
    ic = mask_icon.resize((inner, inner), Image.LANCZOS)
    off = (size - inner) // 2
    canvas.paste(ic, (off, off), ic)
    canvas.save(os.path.join(d, 'ic_launcher_foreground.png'))

# Latar belakang ikon adaptif: putih
bg = os.path.join(RES, 'values', 'ic_launcher_background.xml')
if os.path.isdir(os.path.dirname(bg)):
    with open(bg, 'w') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                '    <color name="ic_launcher_background">#FFFFFF</color>\n</resources>\n')

print('Ikon launcher dibuat')
