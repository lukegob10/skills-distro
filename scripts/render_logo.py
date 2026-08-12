"""Render the vector-style Agentic Toolbox mark as a marketplace PNG."""

from pathlib import Path
from math import cos, radians, sin

from PIL import Image, ImageDraw, ImageFilter


SCALE = 4
SIZE = 256
CANVAS = SIZE * SCALE


def scaled(value: float) -> int:
    return round(value * SCALE)


def interpolate(first: tuple[int, int, int], second: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    return tuple(round(a + (b - a) * amount) for a, b in zip(first, second))


def gradient_image() -> Image.Image:
    start = (139, 102, 255)
    middle = (92, 114, 242)
    end = (50, 199, 183)
    image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    pixels = image.load()
    for y in range(CANVAS):
        for x in range(CANVAS):
            progress = min(1.0, max(0.0, (x * 0.46 + y * 0.54) / (CANVAS - 1)))
            if progress < 0.48:
                color = interpolate(start, middle, progress / 0.48)
            else:
                color = interpolate(middle, end, (progress - 0.48) / 0.52)
            highlight = max(0.0, 1.0 - (((x - scaled(62)) ** 2 + (y - scaled(42)) ** 2) ** 0.5) / scaled(185))
            color = interpolate(color, (255, 255, 255), highlight * 0.17)
            pixels[x, y] = (*color, 255)
    mask = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (scaled(10), scaled(10), scaled(246), scaled(246)),
        radius=scaled(58),
        fill=255,
    )
    image.putalpha(mask)
    return image


def draw_mark(image: Image.Image) -> None:
    shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.ellipse(
        (scaled(55), scaled(63), scaled(201), scaled(209)),
        fill=(18, 25, 72, 70),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(scaled(10)))
    image.alpha_composite(shadow)

    mark = Image.new("RGBA", image.size, (0, 0, 0, 0))
    mark_draw = ImageDraw.Draw(mark)
    track_bounds = (scaled(56), scaled(56), scaled(200), scaled(200))
    mark_draw.ellipse(
        track_bounds,
        fill=(21, 25, 50, 34),
        outline=(255, 255, 255, 56),
        width=scaled(4),
    )
    arc_width = scaled(16)
    arc_radius = scaled(8)
    arcs = [(-90, -32), (-10, 58), (78, 146), (166, 238)]
    for start, end in arcs:
        mark_draw.arc(track_bounds, start, end, fill=(255, 255, 255, 255), width=arc_width)
        for angle in (start, end):
            x = scaled(128) + scaled(72) * cos(radians(angle))
            y = scaled(128) + scaled(72) * sin(radians(angle))
            mark_draw.ellipse(
                (round(x) - arc_radius, round(y) - arc_radius, round(x) + arc_radius, round(y) + arc_radius),
                fill=(255, 255, 255, 255),
            )
    image.alpha_composite(mark)

    detail = Image.new("RGBA", image.size, (0, 0, 0, 0))
    detail_draw = ImageDraw.Draw(detail)
    core = [(128, 91), (139.2, 116.8), (165, 128), (139.2, 139.2), (128, 165), (116.8, 139.2), (91, 128), (116.8, 116.8)]
    detail_draw.polygon([(scaled(x), scaled(y)) for x, y in core], fill=(255, 255, 255, 255))
    radius = scaled(7)
    detail_draw.ellipse(
        (scaled(128) - radius, scaled(128) - radius, scaled(128) + radius, scaled(128) + radius),
        fill=(97, 115, 240, 166),
    )
    detail_draw.arc((scaled(24), scaled(18), scaled(162), scaled(156)), 190, 265, fill=(255, 255, 255, 36), width=scaled(7))
    image.alpha_composite(detail)


def main() -> None:
    image = gradient_image()
    draw_mark(image)
    output = Path(__file__).resolve().parents[1] / "media" / "marketplace-icon.png"
    image.resize((SIZE, SIZE), Image.Resampling.LANCZOS).save(output, optimize=True)
    print(output)


if __name__ == "__main__":
    main()
