"""Rebuild clqn's logos and README GIF."""

from itertools import groupby
from pathlib import Path

from PIL import Image, ImageDraw


ASSETS = Path(__file__).resolve().parents[1] / "docs" / "assets"
PAPER = "#f9faf7"
INK = "#20231f"
DESCRIPTION = "Three pixel groundhogs in separate holes staggered back, front-left, and front-right."
SIZE = (96, 62)
REST = (29, 23, 18)
# Paint from back to front so foreground sprites naturally cover the rear rim.
HOLES = ((48, 38), (30, 47), (55, 49))
TRAVEL_MS = 200
FRAME_MS = 40
FULL_HEIGHT = 29
ANTICIPATION_MS = 160
ANTICIPATION_PIXELS = 6


def emergence(t, offset, hold):
    phase = (t - offset) % 6000
    if phase < TRAVEL_MS:
        return round(FULL_HEIGHT * (1 - (1 - phase / TRAVEL_MS) ** 2))
    phase -= TRAVEL_MS
    if phase < hold:
        return FULL_HEIGHT
    phase -= hold
    # Flick upward quickly, hold for a beat, then drop from the raised pose.
    if phase < ANTICIPATION_MS:
        lift = min(1, phase / FRAME_MS)
        return FULL_HEIGHT + round(ANTICIPATION_PIXELS * lift)
    phase -= ANTICIPATION_MS
    if phase < TRAVEL_MS:
        return round((FULL_HEIGHT + ANTICIPATION_PIXELS) * (1 - phase / TRAVEL_MS) ** 2)
    return 0


# All three reach full height, anticipate the drop, and fully retreat independently.
SEQUENCE = [
    (FRAME_MS, tuple(emergence(t, offset, hold) for offset, hold in
                ((0, 1500), (1700, 1800), (3500, 1000))))
    for t in range(0, 6000, FRAME_MS)
]


def groundhog(height):
    sprite = Image.new("RGBA", (23, 40))
    d = ImageDraw.Draw(sprite)
    outline = [(7, 0), (15, 0), (15, 1), (18, 1), (18, 3),
               (20, 3), (20, 6), (21, 6), (21, 39), (1, 39),
               (1, 6), (2, 6), (2, 3), (4, 3), (4, 1), (7, 1)]
    d.polygon(outline, fill="#392d2b")
    d.polygon([(7, 2), (15, 2), (15, 3), (17, 3), (17, 5),
               (19, 5), (19, 8), (19, 39), (3, 39), (3, 6),
               (4, 6), (4, 4), (7, 4)], fill="#ae805b")
    d.rectangle((17, 8, 19, 39), fill="#866047")
    d.rectangle((5, 5, 7, 9), fill="#d7b28a")
    d.rectangle((8, 3, 13, 4), fill="#d7b28a")
    for x in (6, 15):
        d.rectangle((x, 9, x + 1, 13), fill="#241f24")
        d.point((x, 9), fill=PAPER)
    d.rectangle((7, 16, 15, 20), fill="#392d2b")
    d.rectangle((6, 17, 16, 19), fill="#392d2b")
    d.rectangle((8, 16, 14, 19), fill="#e894a5")
    d.rectangle((7, 17, 15, 18), fill="#e894a5")
    d.rectangle((9, 16, 11, 16), fill="#ffe1dc")
    d.rectangle((9, 20, 14, 20), fill="#ba657f")
    return sprite.crop((0, 0, 23, height))


def icon(heights=REST):
    image = Image.new("RGBA", SIZE)
    for (cx, cy), height in zip(HOLES, heights):
        d = ImageDraw.Draw(image)
        # Separate stepped earth rims and dark openings, with clear air between them.
        d.polygon([(cx-15, cy-1), (cx-12, cy-4), (cx-7, cy-5),
                   (cx+8, cy-5), (cx+12, cy-3), (cx+15, cy),
                   (cx+15, cy+3), (cx+10, cy+6), (cx-9, cy+6),
                   (cx-14, cy+4)], fill="#866047")
        d.rectangle((cx-11, cy-2, cx+11, cy+2), fill="#392d2b")
        d.rectangle((cx-8, cy-3, cx+8, cy+3), fill="#392d2b")
        if height:
            image.alpha_composite(groundhog(height), (cx-11, cy+1-height))
        d = ImageDraw.Draw(image)
        # Front lip occludes the feet, even when the sprite is almost underground.
        d.rectangle((cx-10, cy+2, cx+10, cy+4), fill="#ae805b")
        d.rectangle((cx-7, cy+5, cx+8, cy+5), fill="#866047")
        d.rectangle((cx-12, cy, cx-10, cy+2), fill="#d7b28a")
        d.rectangle((cx+10, cy+2, cx+13, cy+3), fill="#d7b28a")
        d.rectangle((cx-6, cy+3, cx-4, cy+3), fill="#d7b28a")
    return image


# Four hand-drawn lowercase glyphs share a baseline and two pixels of spacing.
LETTERS = [
    [".......", ".......", "..####.", ".######", "###..##", "##.....",
     "##.....", "###..##", ".######", "..####.", ".......", "......."],
    ["##...", "##...", "##...", "##...", "##...", "##...",
     "##...", "##...", "#####", ".####", ".....", "....."],
    ["........", "........", "..###.##", ".#######", "###..###", "##....##",
     "##....##", "###..###", ".#######", "..######", "......##", "......##"],
    [".......", ".......", "##.###.", "#######", "###..##", "##...##",
     "##...##", "##...##", "##...##", "##...##", ".......", "......."],
]


def wordmark():
    gap = 2
    width = sum(len(glyph[0]) for glyph in LETTERS) + gap * (len(LETTERS) - 1)
    image = Image.new("RGBA", (width, 12))
    draw = ImageDraw.Draw(image)
    left = 0
    for glyph in LETTERS:
        for y, row in enumerate(glyph):
            for x, pixel in enumerate(row):
                if pixel == "#":
                    draw.point((left + x, y), fill=INK)
        left += len(glyph[0]) + gap
    return image


def pixel_paths(image):
    """Combine horizontal runs by color to preserve the hand-pixeled contours."""
    paths = {}
    pixels = image.load()
    for y in range(image.height):
        x = 0
        for color, run in groupby(pixels[i, y] for i in range(image.width)):
            length = sum(1 for _ in run)
            if color[3]:
                fill = "#%02x%02x%02x" % color[:3]
                paths.setdefault(fill, []).append(f"M{x} {y}h{length}v1h-{length}z")
            x += length
    return "\n".join(f'  <path fill="{fill}" d="{"".join(runs)}"/>' for fill, runs in paths.items())


def write_svg(filename, size, scale, content, description):
    width, height = size
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width * scale}" height="{height * scale}" viewBox="0 0 {width} {height}" shape-rendering="crispEdges" role="img" aria-labelledby="title desc">
  <title id="title">clqn</title>
  <desc id="desc">{description}</desc>
{content}
</svg>
'''
    (ASSETS / filename).write_bytes(svg.encode())


def scale(image, factor):
    return image.resize((image.width * factor, image.height * factor), Image.Resampling.NEAREST)


def main():
    # Use shared bounds across poses so no hidden canvas padding separates the wordmark.
    boxes = [icon(pose).getbbox() for pose in [REST] + [pose for _, pose in SEQUENCE]]
    bounds = (min(b[0] for b in boxes), min(b[1] for b in boxes),
              max(b[2] for b in boxes), max(b[3] for b in boxes))
    mark = icon().crop(bounds)
    name = wordmark()
    mark_paths = pixel_paths(mark)
    name_paths = pixel_paths(name)
    write_svg("logo.svg", mark.size, 4, mark_paths, DESCRIPTION)
    write_svg("wordmark.svg", name.size, 8, name_paths, "Lowercase pixel lettering.")

    size = (344, 104)
    letters = scale(name, 4)
    gap = 8
    left = (size[0] - mark.width - letters.width - gap) // 2
    key_at = (left, (size[1] - mark.height) // 2 - 4)
    name_at = (left + mark.width + gap, (size[1] - letters.height) // 2)
    header = f'''  <rect width="{size[0]}" height="{size[1]}" fill="{PAPER}"/>
  <g transform="translate({key_at[0]} {key_at[1]})">
{mark_paths}
  </g>
  <g transform="translate({name_at[0]} {name_at[1]}) scale(4)">
{name_paths}
  </g>'''
    write_svg("header.svg", size, 3, header, DESCRIPTION)

    frames = []
    for _, heights in SEQUENCE:
        frame = Image.new("RGBA", size, PAPER)
        frame.alpha_composite(icon(heights).crop(bounds), key_at)
        frame.alpha_composite(letters, name_at)
        frames.append(scale(frame, 3).convert("RGB"))
    frames[0].save(
        ASSETS / "header.gif",
        save_all=True,
        append_images=frames[1:],
        duration=[duration for duration, _ in SEQUENCE],
        loop=0,
        disposal=1,
        optimize=True,
    )


if __name__ == "__main__":
    main()
