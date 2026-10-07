"""Plot archived ordinal ranks against observed time; no invented score curves."""
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
DATA = json.loads((HERE / "model-ranking.json").read_text(encoding="utf-8"))
W, H, SCALE = 1400, 1200, 2
canvas = Image.new("RGB", (W * SCALE, H * SCALE), "black")
draw = ImageDraw.Draw(canvas)
WHITE, MUTED = "#F3F3F3", "#929292"
COLORS = ["#F4E5A6", "#BE891D", "#3079CF", "#83B8C3"]


def font(size, bold=False):
    candidates = [Path("C:/Windows/Fonts") / ("segoeuib.ttf" if bold else "segoeui.ttf"),
                  Path("/usr/share/fonts/truetype/dejavu") / ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf")]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), round(size * SCALE))
    raise RuntimeError("Segoe UI or DejaVu Sans is required")


def text(x, y, value, size=24, color=WHITE, bold=False, anchor=None):
    draw.text((x * SCALE, y * SCALE), value, font=font(size, bold), fill=color, anchor=anchor)


def line(points, color=WHITE, width=1.2):
    draw.line([(round(x * SCALE), round(y * SCALE)) for x, y in points], fill=color, width=round(width * SCALE))


def marker(x, y, index, radius=11):
    color = COLORS[index]
    if index < 2:
        # Sun marks echo the reference, with the second model in subdued gold.
        r = radius * .38
        draw.ellipse(((x-r)*SCALE, (y-r)*SCALE, (x+r)*SCALE, (y+r)*SCALE), fill=color)
        for n in range(8):
            angle = n * math.pi / 4
            line([(x + math.cos(angle)*radius*.64, y + math.sin(angle)*radius*.64),
                  (x + math.cos(angle)*radius, y + math.sin(angle)*radius)], color, 1.5)
    elif index == 2:
        points = []
        for n in range(10):
            angle = -math.pi/2 + n * math.pi/5
            r = radius if n % 2 == 0 else radius * .43
            points.append(((x+math.cos(angle)*r)*SCALE, (y+math.sin(angle)*r)*SCALE))
        draw.polygon(points, fill=color)
    else:
        draw.ellipse(((x-radius*.65)*SCALE, (y-radius*.65)*SCALE,
                      (x+radius*.65)*SCALE, (y+radius*.65)*SCALE), outline=color, width=3*SCALE)


text(104, 83, "CapContextBench", 30, bold=True)
text(1290, 91, "03 OCT 2026", 18, MUTED, anchor="ra")
legend_x = [104, 401, 737, 1091]
rows = [row for row in DATA["archive"]["rows"] if row["rank"] is not None]
names = [row["name"] for row in rows]
for index, (x, name) in enumerate(zip(legend_x, names)):
    marker(x+10, 184, index, 10)
    text(x+32, 169, name, 23)

LEFT, RIGHT, TOP, BOTTOM = 240, 1270, 260, 1000
line([(LEFT, TOP), (LEFT, BOTTOM), (RIGHT, BOTTOM)], width=1.4)
for seconds in range(0, 26, 5):
    x = LEFT + seconds / 25 * (RIGHT-LEFT)
    line([(x, BOTTOM), (x, BOTTOM+9)])
    text(x, BOTTOM+30, f"{seconds}s", 23, anchor="mm")
for rank in range(1, 5):
    y = TOP + (rank-.5)/4 * (BOTTOM-TOP)
    line([(LEFT-9, y), (LEFT, y)])
    text(LEFT-25, y, f"#{rank}", 24, anchor="rm")

text((LEFT+RIGHT)/2, 1090, "Median response time", 25, anchor="mm")
label_font = font(25)
label = "Source-reviewed rank"
bbox = label_font.getbbox(label)
label_image = Image.new("RGBA", (bbox[2]-bbox[0]+8*SCALE, bbox[3]-bbox[1]+8*SCALE))
ImageDraw.Draw(label_image).text((4*SCALE-bbox[0], 4*SCALE-bbox[1]), label, font=label_font, fill=WHITE)
label_image = label_image.rotate(90, expand=True)
canvas.paste(label_image, (round(116*SCALE-label_image.width/2),
                          round((TOP+BOTTOM)/2*SCALE-label_image.height/2)), label_image)

# These are four independent historical judgments, not samples along a curve.
# Do not connect models or turn ordinal ranks into accuracy percentages.
assert [row["rank"] for row in rows] == [1, 2, 3, 4]
for index, row in enumerate(rows):
    seconds = row["medianElapsedMs"] / 1000
    assert 0 <= seconds <= 25
    x = LEFT + seconds/25*(RIGHT-LEFT)
    y = TOP + (row["rank"]-.5)/4*(BOTTOM-TOP)
    marker(x, y, index, 14)
    text(x, y-36, f"{seconds:.1f}s", 22, COLORS[index], anchor="mm")

text(LEFT, 1148, "3 shared conversations · historical qualitative ranks", 18, MUTED)
text(RIGHT, 1148, "Gemma: unscored (429)", 18, MUTED, anchor="ra")
output = HERE / "model-ranking-dark.png"
canvas.resize((W, H), Image.Resampling.LANCZOS).save(output, optimize=True)
print(f"Saved {W} x {H}: {output}")
