"""Render the saved benchmark evidence as a publication-size PNG, without APIs."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
DATA = json.loads((HERE / "model-ranking.json").read_text(encoding="utf-8"))
W, H = 2000, 1640
PAPER, INK, MUTED = "#F7F6F2", "#19201D", "#626964"
PURPLE, LAVENDER, LINE = "#6445D5", "#EEE9FB", "#E1E2DA"
image = Image.new("RGB", (W, H), PAPER)
draw = ImageDraw.Draw(image)


def font(size, weight="regular"):
    files = {"regular": "segoeui.ttf", "bold": "segoeuib.ttf", "light": "segoeuil.ttf"}
    candidates = [Path("C:/Windows/Fonts") / files[weight],
                  Path("/usr/share/fonts/truetype/dejavu") / ("DejaVuSans-Bold.ttf" if weight == "bold" else "DejaVuSans.ttf")]
    for file in candidates:
        if file.exists():
            return ImageFont.truetype(str(file), size)
    raise RuntimeError("Install Segoe UI or DejaVu Sans to render the leaderboard")


def text(x, y, value, size=24, color=INK, weight="regular", anchor=None):
    draw.text((x, y), str(value), font=font(size, weight), fill=color, anchor=anchor)


def wrap(x, y, value, width, size=22, color=MUTED, line_height=30):
    line = ""
    for word in value.split():
        candidate = (line + " " + word).strip()
        if draw.textlength(candidate, font=font(size)) > width and line:
            text(x, y, line, size, color)
            y += line_height
            line = word
        else:
            line = candidate
    if line:
        text(x, y, line, size, color)
    return y + line_height


def centered(x, y, value, size=30, color=INK, weight="regular"):
    text(x, y, value, size, color, weight, anchor="mm")


# Editorial table hierarchy, exact source numbers and ample space take priority
# over decorative chart marks. Unscored models never get a zero-quality bar.
draw.rounded_rectangle((96, 72, 135, 111), radius=10, fill=PURPLE)
draw.line([(106, 101), (125, 82)], fill="white", width=4)
draw.line([(112, 82), (125, 82), (125, 95)], fill="white", width=4)
text(154, 70, "CAPCONTEXT BENCH", 28, INK, "bold")
text(1904, 83, "EVIDENCE SNAPSHOT  /  07 OCT 2026", 20, MUTED, anchor="ra")
text(96, 142, "Historical model ranking", 66, INK, "bold")
text(96, 240, "Which models preserved the most useful context in past matched runs?", 27, MUTED)

draw.rounded_rectangle((96, 316, 384, 360), radius=22, fill=LAVENDER)
centered(240, 338, "ARCHIVE  ·  03 OCT 2026", 18, PURPLE, "bold")
text(414, 323, "Ranked by the recorded factual-usefulness review", 23, MUTED)

text(126, 393, "RANK", 18, MUTED, "bold")
text(270, 393, "MODEL / OBSERVED TRADEOFF", 18, MUTED, "bold")
centered(1150, 406, "OUTPUTS", 18, MUTED, "bold")
centered(1430, 406, "MEDIAN TIME", 18, MUTED, "bold")
centered(1750, 406, "OUTPUT TOKENS", 18, MUTED, "bold")

for index, row in enumerate(DATA["archive"]["rows"]):
    top = 440 + index * 118
    fill = LAVENDER if index == 0 else "#FFFFFF" if row["rank"] is not None else "#EFEEE8"
    draw.rounded_rectangle((96, top, 1904, top + 105), radius=16, fill=fill)
    if index == 0:
        draw.rounded_rectangle((96, top, 104, top + 105), radius=4, fill=PURPLE)
    badge = PURPLE if index == 0 else "#E8E9E1"
    draw.ellipse((132, top + 25, 186, top + 79), fill=badge)
    centered(159, top + 52, str(row["rank"]) if row["rank"] else "—", 27, "white" if index == 0 else MUTED, "bold")
    text(270, top + 12, row["name"], 32, INK, "bold")
    wrap(270, top + 59, row["note"], 800, 21, MUTED, 25)
    centered(1150, top + 42, f'{row["generated"]}/{row["attempts"]}', 34, INK, "bold")
    centered(1150, top + 78, "generated" if row["rank"] else "unscored", 18, MUTED)
    elapsed = f'{row["medianElapsedMs"] / 1000:.1f} s' if row["medianElapsedMs"] is not None else "—"
    centered(1430, top + 53, elapsed, 34)
    tokens = f'{row["medianCompletionTokens"]:,.0f}' if row["medianCompletionTokens"] is not None else "—"
    centered(1750, top + 53, tokens, 34)

text(96, 1052, "3 matched conversations  ·  20 attempts  ·  15 generated summaries  ·  All repeats retained", 22, MUTED)

# The current percentage metric is displayed separately; it is not assigned to
# legacy models or used to manufacture a cross-version numeric ranking.
draw.rounded_rectangle((96, 1120, 1904, 1385), radius=20, fill="#FFFFFF", outline=LINE, width=2)
text(128, 1140, "Latest v1 check — Dots only", 29, INK, "bold")
text(1870, 1150, "LEVEL 1  /  2 CASES × 2 REPEATS", 19, MUTED, anchor="ra")
for index, row in enumerate(DATA["latest"]["rows"]):
    y = 1220 + index * 66
    text(128, y - 4, row["label"], 24, INK)
    draw.rounded_rectangle((505, y + 6, 1335, y + 25), radius=9, fill="#EAE8E0")
    width = 830 * row["scorePercent"] / 100
    draw.rounded_rectangle((505, y + 6, 505 + width, y + 25), radius=9, fill=PURPLE if index == 0 else "#A4AAA2")
    text(1400, y - 8, f'{row["scorePercent"]:.0f}%', 34, INK, "bold")
    text(1600, y + 1, f'{row["passed"]}/{row["total"]} handoffs pass', 22, MUTED)
text(128, 1341, "Pass = continuity + fidelity + grounding + structure. Recorded source review; small sample.", 19, MUTED)

draw.line((96, 1440, 1904, 1440), fill=LINE, width=2)
text(96, 1468, "READ THE TWO PANELS SEPARATELY", 19, PURPLE, "bold")
text(96, 1505, "Archive ranks are qualitative judgments, not accuracy percentages. The v1 run uses different cases and prompts.", 22, MUTED)
text(96, 1541, "Gemma is unscored, not worst for quality. Timing is descriptive. No new model requests were made for this image.", 22, MUTED)
text(96, 1586, "SOURCES  /  Archived comparison + source review · Current v1 review · model-ranking.json", 18, MUTED)
text(1904, 1585, "CAPCONTEXT  /  01", 18, MUTED, anchor="ra")

output = HERE / "model-ranking.png"
image.save(output, optimize=True)
print(f"Saved {W}×{H} image: {output}")
