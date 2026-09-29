"""Make the new edit clock from the preserved 62-second source animation clock.

Anchors are deliberately exact at all five presses so frames and sound samples
stay aligned. Between anchors only the editorial pacing changes; native UI
states, typing order and the user's Send actions stay the same.
"""
from pathlib import Path
import copy
import json

HERE = Path(__file__).parent
SOURCE = json.loads((HERE / "source-timeline.json").read_text(encoding="utf-8"))

# (source seconds, edited seconds). Text holds are shortened less than transitions.
MAP = [
    (0, 0), (7, 5.8), (10.85, 9.6), (11.12, 9.9),
    (15.4, 12.3), (17.1, 13.7), (21.8, 17.7), (22.65, 18.45),
    (25.4, 20.8), (28.7, 23.2), (30.55, 24.6), (31.65, 25.4),
    (32.85, 26.4), (35.9, 29.35), (36.6, 30), (37.8, 30.95),
    (40, 32.15), (40.7, 32.7), (43, 34.75), (44.25, 35.9),
    (44.9, 36.5), (47.64, 39), (52.25, 44), (53.2, 44.7),
    (54.05, 45.4), (54.7, 45.95), (54.95, 46.2), (55.75, 47),
    (58.55, 49.25), (58.9, 49.55), (59.45, 50), (59.85, 50.4),
    (62, 52),
]

assert all(a[0] < b[0] and a[1] < b[1] for a, b in zip(MAP, MAP[1:]))

def edited(source_seconds):
    for (old_a, new_a), (old_b, new_b) in zip(MAP, MAP[1:]):
        if source_seconds <= old_b:
            return new_a + (source_seconds - old_a) * (new_b - new_a) / (old_b - old_a)
    return MAP[-1][1]

result = copy.deepcopy(SOURCE)
result["duration"] = 52
result["posterTime"] = 48.4
result["timeMap"] = MAP
result["sourceDuration"] = SOURCE["duration"]
for click in result["clicks"]:
    click["sourceTime"] = click["time"]
    click["time"] = round(edited(click["time"]), 6)
    assert abs(click["time"] * result["fps"] - round(click["time"] * result["fps"])) < 1e-6
for typing in result["typing"]:
    typing["sourceStart"], typing["sourceEnd"] = typing["start"], typing["end"]
    typing["start"], typing["end"] = round(edited(typing["start"]), 6), round(edited(typing["end"]), 6)
    typing["keyTimes"] = [round(edited(s), 6) for s in typing["keyTimes"]]
for move in result["motion"]:
    move["sourceStart"], move["sourceEnd"] = move["start"], move["end"]
    move["start"], move["end"] = round(edited(move["start"]), 6), round(edited(move["end"]), 6)

(HERE / "timeline.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"duration": result["duration"], "clicks": [(x["target"], x["time"]) for x in result["clicks"]], "motionCues": len(result["motion"])}, indent=2))
