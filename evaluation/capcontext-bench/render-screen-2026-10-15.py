"""Render the fresh small screen in the retained dark ranking image's style.

Offline only. Never import the generation runner or make provider requests.
"""
import hashlib
import json
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
LONG_HISTORY = "--long-history" in sys.argv
BASE = HERE / f"baselines/2026-10-15-{'long' if LONG_HISTORY else 'small'}-screen"
report_bytes = (BASE / "generations.json").read_bytes()
report = json.loads(report_bytes)
review = json.loads((BASE / "review.json").read_text(encoding="utf-8"))
assert hashlib.sha256(report_bytes).hexdigest() == review["reportSha256"], "Report changed after review"
results = {row["model"]: row for row in report["results"]}
reviews = {row["model"]: row for row in review["entries"]}
assert len(results) == len(reviews) == 4
assert all(row["sourceReviewed"] for row in reviews.values())
assert all(isinstance(row[dimension]["pass"], bool) and row[dimension]["evidence"] for row in reviews.values() for dimension in ("continuity", "fidelity", "grounding"))
assert all(row["status"] == "generated" and row["attempt"] == 1 for row in results.values())
# Competition ranks preserve equal reviews without assigning a speed tiebreaker.
assert all(row["rank"] == 1 + sum(other["rank"] < row["rank"] for other in reviews.values()) for row in reviews.values())

# Keep Dots' established blue star; new routes use the other original marks.
order = ["claude-haiku-5.5:free", "deepseek-v4.1-flash:free", "dots-studio/dots-3-note-preview:free", "mimo-v2.6-flash:free"]
W, H, SCALE = 1400, 1200, 2
canvas = Image.new("RGB", (W * SCALE, H * SCALE), "black")
draw = ImageDraw.Draw(canvas)
WHITE, MUTED = "#F3F3F3", "#929292"
COLORS = ["#F4E5A6", "#BE891D", "#3079CF", "#83B8C3"]


def font(size, bold=False):
    candidates = [Path("C:/Windows/Fonts") / ("segoeuib.ttf" if bold else "segoeui.ttf"), Path("/usr/share/fonts/truetype/dejavu") / ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf")]
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
        r = radius * .38
        draw.ellipse(((x-r)*SCALE, (y-r)*SCALE, (x+r)*SCALE, (y+r)*SCALE), fill=color)
        for n in range(8):
            angle = n * math.pi / 4
            line([(x + math.cos(angle)*radius*.64, y + math.sin(angle)*radius*.64), (x + math.cos(angle)*radius, y + math.sin(angle)*radius)], color, 1.5)
    elif index == 2:
        points = []
        for n in range(10):
            angle = -math.pi/2 + n * math.pi/5
            r = radius if n % 2 == 0 else radius * .43
            points.append(((x+math.cos(angle)*r)*SCALE, (y+math.sin(angle)*r)*SCALE))
        draw.polygon(points, fill=color)
    else:
        draw.ellipse(((x-radius*.65)*SCALE, (y-radius*.65)*SCALE, (x+radius*.65)*SCALE, (y+radius*.65)*SCALE), outline=color, width=3*SCALE)


text(104, 83, "CapContextBench", 30, bold=True)
text(1290, 91, "15 OCT 2026", 18, MUTED, anchor="ra")
for index, (x, model) in enumerate(zip([104, 370, 770, 1110], order)):
    marker(x+10, 184, index, 10)
    text(x+32, 169, results[model]["name"], 23)

LEFT, RIGHT, TOP, BOTTOM = 240, 1270, 260, 1000
line([(LEFT, TOP), (LEFT, BOTTOM), (RIGHT, BOTTOM)], width=1.4)
max_seconds = max(30, math.ceil(max(row["elapsedMs"] for row in results.values()) / 10000) * 10)
tick_seconds = 5 if max_seconds <= 30 else max_seconds // 6
for seconds in range(0, max_seconds + 1, tick_seconds):
    x = LEFT + seconds / max_seconds * (RIGHT-LEFT)
    line([(x, BOTTOM), (x, BOTTOM+9)])
    text(x, BOTTOM+30, f"{seconds}s", 23, anchor="mm")
for rank in range(1, 5):
    y = TOP + (rank-.5)/4 * (BOTTOM-TOP)
    line([(LEFT-9, y), (LEFT, y)])
    text(LEFT-25, y, f"#{rank}", 24, anchor="rm")

text((LEFT+RIGHT)/2, 1090, "Response time", 25, anchor="mm")
label_font = font(25)
label = "Source-reviewed rank"
bbox = label_font.getbbox(label)
label_image = Image.new("RGBA", (bbox[2]-bbox[0]+8*SCALE, bbox[3]-bbox[1]+8*SCALE))
ImageDraw.Draw(label_image).text((4*SCALE-bbox[0], 4*SCALE-bbox[1]), label, font=label_font, fill=WHITE)
label_image = label_image.rotate(90, expand=True)
canvas.paste(label_image, (round(116*SCALE-label_image.width/2), round((TOP+BOTTOM)/2*SCALE-label_image.height/2)), label_image)

# An equal review stays tied. Speed never breaks a quality tie; no curves or
# percentages are inferred from these four independent single observations.
for index, model in enumerate(order):
    seconds = results[model]["elapsedMs"] / 1000
    assert 0 <= seconds <= max_seconds
    x = LEFT + seconds/max_seconds*(RIGHT-LEFT)
    y = TOP + (reviews[model]["rank"]-.5)/4*(BOTTOM-TOP)
    marker(x, y, index, 14)
    text(x, y-36, f"{seconds:.1f}s", 22, COLORS[index], anchor="mm")

first_count = sum(row["rank"] == 1 for row in reviews.values())
scope = f"{report['inputChars']:,} chars" if LONG_HISTORY else "1 shared case"
tie_note = " · #1 tied" if first_count > 1 else ""
text(LEFT, 1148, f"{scope} · 1 request/model{tie_note}", 18, MUTED)
text(RIGHT, 1148, "4 requests · screening only", 18, MUTED, anchor="ra")
output = HERE / ("model-ranking-dark-2026-10-15-long.png" if LONG_HISTORY else "model-ranking-dark-2026-10-15.png")
canvas.resize((W, H), Image.Resampling.LANCZOS).save(output, optimize=True)
print(f"Saved {W} x {H}: {output}")
