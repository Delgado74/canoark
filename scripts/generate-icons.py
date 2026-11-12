from PIL import Image, ImageDraw

BG = (11, 14, 17, 255)
ORANGE = (247, 147, 26, 255)
TEAL = (45, 212, 191, 255)

SCALE = 4


def diamond(draw, center, radius, fill):
    cx, cy = center
    points = [
        (cx, cy - radius),
        (cx + radius, cy),
        (cx, cy + radius),
        (cx - radius, cy),
    ]
    draw.polygon(points, fill=fill)


def mark(size, transparent):
    canvas = Image.new("RGBA", (size * SCALE, size * SCALE), (0, 0, 0, 0) if transparent else BG)
    draw = ImageDraw.Draw(canvas)
    c = (size * SCALE // 2, size * SCALE // 2)
    r = int(size * SCALE * 0.36)
    diamond(draw, c, r, ORANGE)
    diamond(draw, c, int(r * 0.72), (0, 0, 0, 0) if transparent else BG)
    diamond(draw, c, int(r * 0.42), TEAL)
    return canvas.resize((size, size), Image.LANCZOS)


mark(1024, False).save("assets/icon.png")
mark(1024, True).save("assets/adaptive-icon.png")
mark(512, True).save("assets/splash-icon.png")
print("icons written")
