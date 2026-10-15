"""Draws the OI Trade home-screen icon (design 1: crossed green-up / red-down arrows, gold "OI").
Run: python3 tools/make_icon.py   → writes icon/*.png
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import os, math

S = 2048  # work size, downscaled at the end
OUT = os.path.join(os.path.dirname(__file__), "..", "icon")
FONT = "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"
os.makedirs(OUT, exist_ok=True)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def grad(stops, angle_deg):
    """linear gradient across the whole canvas along angle_deg; stops = [(t, rgb)]"""
    small = 256
    img = Image.new("RGB", (small, small))
    px = img.load()
    a = math.radians(angle_deg)
    dx, dy = math.cos(a), math.sin(a)
    span = abs(dx) * small + abs(dy) * small
    for y in range(small):
        for x in range(small):
            t = ((x - small / 2) * dx + (y - small / 2) * dy) / span + 0.5
            t = min(1, max(0, t))
            for i in range(len(stops) - 1):
                if stops[i][0] <= t <= stops[i + 1][0]:
                    lt = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0])
                    px[x, y] = lerp(stops[i][1], stops[i + 1][1], lt)
                    break
    return img.resize((S, S), Image.BILINEAR)


def radial_bg():
    small = 512
    img = Image.new("RGB", (small, small))
    px = img.load()
    cx, cy = small * 0.5, small * 0.45
    inner, outer = (30, 26, 18), (5, 5, 7)
    for y in range(small):
        for x in range(small):
            d = min(1.0, math.hypot(x - cx, y - cy) / (small * 0.72))
            px[x, y] = lerp(inner, outer, d ** 0.9)
    return img.resize((S, S), Image.BILINEAR)


def arrow_poly(x0, y0, x1, y1, shaft, head_w, head_l):
    L = math.hypot(x1 - x0, y1 - y0)
    ux, uy = (x1 - x0) / L, (y1 - y0) / L
    nx, ny = -uy, ux
    bx, by = x1 - ux * head_l, y1 - uy * head_l  # base of the head
    h, w = shaft / 2, head_w / 2
    return [
        (x0 + nx * h, y0 + ny * h), (bx + nx * h, by + ny * h), (bx + nx * w, by + ny * w),
        (x1, y1),
        (bx - nx * w, by - ny * w), (bx - nx * h, by - ny * h), (x0 - nx * h, y0 - ny * h),
    ]


def mask_of(pts, grow=0, blur=0):
    m = Image.new("L", (S, S), 0)
    ImageDraw.Draw(m).polygon(pts, fill=255)
    if grow:
        m = m.filter(ImageFilter.MaxFilter(grow))
    if blur:
        m = m.filter(ImageFilter.GaussianBlur(blur))
    return m


def draw(pad=0.0):
    img = radial_bg()
    k = 1 - pad

    def P(pts):
        return [(S / 2 + (x - S / 2) * k, S / 2 + (y - S / 2) * k) for x, y in pts]

    m = 360
    down = P(arrow_poly(m, m, S - m, S - m, 190, 520, 420))      # red, top-left → bottom-right
    up = P(arrow_poly(m, S - m, S - m, m, 190, 520, 420))        # green, bottom-left → top-right

    red = grad([(0, (255, 120, 110)), (0.55, (232, 58, 58)), (1, (150, 22, 26))], 45)
    green = grad([(0, (18, 140, 86)), (0.5, (34, 204, 128)), (1, (140, 255, 200))], -45)

    for pts, fill, glowc in ((down, red, (255, 70, 70)), (up, green, (40, 230, 140))):
        glow = mask_of(pts, blur=60).point(lambda v: int(v * 0.45))
        img = Image.composite(Image.new("RGB", (S, S), glowc), img, glow)
        img.paste((8, 8, 10), (0, 0), mask_of(pts, grow=41))
        img.paste(fill, (0, 0), mask_of(pts))

    # --- centre badge -----------------------------------------------------
    cx = cy = S / 2
    r = 470 * k
    d = ImageDraw.Draw(img)
    shadow = Image.new("L", (S, S), 0)
    ImageDraw.Draw(shadow).ellipse([cx - r - 40, cy - r - 10, cx + r + 40, cy + r + 70], fill=220)
    img.paste((0, 0, 0), (0, 0), shadow.filter(ImageFilter.GaussianBlur(45)))

    gold = grad([(0, (255, 238, 170)), (0.45, (232, 186, 82)), (0.7, (196, 140, 40)), (1, (122, 80, 16))], 70)
    ring = Image.new("L", (S, S), 0)
    ImageDraw.Draw(ring).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    img.paste(gold, (0, 0), ring)
    inner = r - 42 * k
    d.ellipse([cx - inner, cy - inner, cx + inner, cy + inner], fill=(14, 13, 12))

    font = ImageFont.truetype(FONT, int(430 * k))
    tm = Image.new("L", (S, S), 0)
    td = ImageDraw.Draw(tm)
    td.text((cx, cy + 24 * k), "OI", font=font, anchor="mm", fill=255)
    img.paste(gold, (0, 0), tm)
    return img


def save(img, size, name):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)


full = draw(0.0)
for size, name in [(1024, "icon-1024.png"), (512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png"), (32, "favicon-32.png")]:
    save(full, size, name)
save(draw(0.18), 512, "icon-maskable-512.png")
print("icons written to", os.path.abspath(OUT))
