"""Regenerate the site's existing film brand mark as browser icons (Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw

PUBLIC = Path(__file__).resolve().parent.parent / "public"
ACCENT, INK = "#914536", "#faf5e9"
FILM = '''<rect x="14" y="12" width="36" height="40" rx="4"/>
  <path d="M24 12v40M40 12v40M14 32h36M14 22h10M40 22h10M14 42h10M40 42h10"/>'''
PUBLIC.joinpath("favicon.svg").write_text(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="{ACCENT}"/>
  <g fill="none" stroke="{INK}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">{FILM}</g>
</svg>\n''')
PUBLIC.joinpath("safari-pinned-tab.svg").write_text(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <g fill="none" stroke="#000" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">{FILM}</g>
</svg>\n''')
# Raster equivalents for browsers that do not use SVG favicons and iOS bookmarks.
SCALE = 16
image = Image.new("RGBA", (64 * SCALE, 64 * SCALE))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, 64*SCALE-1, 64*SCALE-1), radius=14*SCALE, fill=ACCENT)
w = round(3.5*SCALE)
# Pillow outlines are drawn inward; expand the bounds to match the SVG stroke.
draw.rounded_rectangle((14*SCALE-w/2, 12*SCALE-w/2, 50*SCALE+w/2, 52*SCALE+w/2), radius=round(5.75*SCALE), outline=INK, width=w)
for x1,y1,x2,y2 in [(24,12,24,52),(40,12,40,52),(14,32,50,32),(14,22,24,22),(40,22,50,22),(14,42,24,42),(40,42,50,42)]:
    draw.line((x1*SCALE,y1*SCALE,x2*SCALE,y2*SCALE), fill=INK, width=w)
for size, name in [(32,"favicon-32.png"),(180,"apple-touch-icon.png")]:
    image.resize((size,size),Image.Resampling.LANCZOS).save(PUBLIC/name)
image.save(PUBLIC/"favicon.ico",sizes=[(16,16),(32,32),(48,48)])
