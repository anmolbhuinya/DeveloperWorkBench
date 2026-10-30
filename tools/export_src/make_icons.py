"""export.ico (blue, arrow up out of a box) and import.ico (green, arrow down into a box)."""
from pathlib import Path

from PIL import Image, ImageDraw

S = 512
HERE = Path(__file__).resolve().parent


def base(top, bottom):
    grad = Image.new("RGB", (S, S))
    px = grad.load()
    for y in range(S):
        for x in range(S):
            t = (x + y) / (2 * S - 2)
            px[x, y] = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((8, 8, S - 8, S - 8), radius=104, fill=255)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img.paste(grad, (0, 0), mask)
    return img


def box(d, w):
    d.rounded_rectangle((110, 330, 402, 400), radius=20, fill=w)
    d.rectangle((110, 290, 146, 380), fill=w)
    d.rectangle((366, 290, 402, 380), fill=w)


w = (255, 255, 255, 255)
img = base((25, 90, 190), (0, 170, 200))
d = ImageDraw.Draw(img)
d.polygon([(256, 70), (130, 200), (212, 200), (212, 290), (300, 290), (300, 200), (382, 200)], fill=w)   # arrow up
box(d, w)
img.save(HERE / "export.ico", format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

img = base((20, 130, 70), (110, 190, 40))
d = ImageDraw.Draw(img)
d.polygon([(256, 300), (130, 170), (212, 170), (212, 80), (300, 80), (300, 170), (382, 170)], fill=w)    # arrow down
box(d, w)
img.save(HERE / "import.ico", format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("icons written")
