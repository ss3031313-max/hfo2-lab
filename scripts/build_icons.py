"""Optional icon regeneration. Requires Pillow; app/build_demo.mjs needs no Python."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
OUT.mkdir(exist_ok=True)
SCALE = 4

def make_icon(maskable=False):
    canvas = Image.new("RGBA", (512 * SCALE, 512 * SCALE), "#142737" if maskable else (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    def box(coords, fill, radius=0):
        values = tuple(round(x * SCALE) for x in coords)
        if radius:
            draw.rounded_rectangle(values, radius=radius * SCALE, fill=fill)
        else:
            draw.rectangle(values, fill=fill)
    def polygon(points, fill):
        draw.polygon([(round(x*SCALE),round(y*SCALE)) for x,y in points], fill=fill)
    box((0, 0, 512, 512), "#142737", 0 if maskable else 108)
    # The Hf letterforms and two film layers stay inside the maskable safe circle.
    polygon([(154,142),(183,142),(183,210),(248,210),(248,142),(277,142),(277,311),(248,311),(248,237),(183,237),(183,311),(154,311)], "white")
    box((308, 142, 366, 197), "white", 28)
    box((337, 168, 370, 197), "#142737")
    box((308, 181, 337, 311), "white")
    box((287, 195, 366, 221), "white")
    box((128,342,384,366), "#087f82")
    box((128,378,384,390), "#70d4c0")
    return canvas

for size in (192, 512):
    make_icon().resize((size,size), Image.Resampling.LANCZOS).save(OUT / f"icon-{size}.png")
make_icon(True).resize((512,512), Image.Resampling.LANCZOS).convert("RGB").save(OUT / "maskable-512.png")
print("Wrote three PWA PNG icons.")
