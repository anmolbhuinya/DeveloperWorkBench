"""deploy.ico: orange-to-magenta rounded square with a white 'deploy' arrow pointing up out of a tray."""
from pathlib import Path

from PIL import Image, ImageDraw

S = 512
HERE = Path(__file__).resolve().parent

top, bottom = (255, 140, 0), (200, 40, 120)
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
d = ImageDraw.Draw(img)
w = (255, 255, 255, 255)
# arrow
d.polygon([(256, 96), (132, 232), (212, 232), (212, 332), (300, 332), (300, 232), (380, 232)], fill=w)
# tray
d.rounded_rectangle((120, 372, 392, 412), radius=18, fill=w)
d.rectangle((120, 340, 152, 392), fill=w)
d.rectangle((360, 340, 392, 392), fill=w)
img.save(HERE / "deploy.ico", format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("wrote", HERE / "deploy.ico")
