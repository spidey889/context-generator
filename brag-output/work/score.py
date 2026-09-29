"""Original, restrained stereo score. Soft cues share the music's key and mix."""
import math, random, struct, wave
from pathlib import Path

RATE, DURATION = 48000, 24
random.seed(290929)
left, right = [0.] * (RATE * DURATION), [0.] * (RATE * DURATION)

def add(start, duration, synth, gain=.1, pan=0):
    begin = round(start * RATE)
    for i in range(round(duration * RATE)):
        j = begin + i
        if 0 <= j < len(left):
            sample = synth(i / RATE) * gain
            left[j] += sample * (1 - .35 * pan)
            right[j] += sample * (1 + .35 * pan)

def key(f, t):
    return (1 - math.exp(-t * 160)) * (math.sin(math.tau * f * t) * math.exp(-t * 2.8) + .18 * math.sin(math.tau * f * 2 * t) * math.exp(-t * 6))

chords = [[164.814, 207.652, 246.942, 329.628], [130.813, 164.814, 195.998, 261.626], [146.832, 184.997, 220., 293.665], [123.471, 155.563, 184.997, 246.942]]
beat = 60 / 112
for i in range(39):
    start = .16 + i * beat
    if start > 20.5:
        break
    f = chords[int(start / 4) % 4][[0, 2, 1, 3, 1, 2, 3, 2][i % 8]]
    add(start, 2.5, lambda t, f=f: key(f, t), .085, .4 if i % 2 else -.4)
    add(start + .19, 1.8, lambda t, f=f: key(f, t), .017, -.7 if i % 2 else .7)
    if start > 5.2 and i % 2 == 0:
        add(start, .22, lambda t: math.sin(math.tau * (55 * t + .7 * (1 - math.exp(-t * 28)))) * math.exp(-t * 25), .065)
    if start > 7.4 and i % 2:
        add(start, .07, lambda t: random.uniform(-1, 1) * math.exp(-t * 78), .008, .4)
for k in range(6):
    for n, f in enumerate(chords[k % 4][:3]):
        add(k * 4, 4.7, lambda t, f=f: min(1, t / .8) * min(1, (4.7 - t) / 1.1) * math.sin(math.tau * f * .5 * t), .021, (n - 1) * .6)
for start in [5.05, 7.18, 11.98, 15.43]:
    add(start, .07, lambda t: key(659.25, t) * math.exp(-t * 50), .026)
add(2.3, .38, lambda t: key(523.25, t), .027)
for start in [5.13, 7.35, 10.15, 20.5]:
    add(start - .1, .4, lambda t: random.uniform(-1, 1) * math.sin(math.pi * t / .4) ** 2, .009)
for f in chords[0]:
    add(20.7, 3.3, lambda t, f=f: key(f, t), .087)
peak = max(max(map(abs, left)), max(map(abs, right)))
scale = .59 / peak
data = bytearray()
for i, (l, r) in enumerate(zip(left, right)):
    t = i / RATE
    fade = min(1, t / .18) * min(1, (DURATION - t) / 1.0)
    data.extend(struct.pack('<hh', round(l * scale * fade * 32767), round(r * scale * fade * 32767)))
with wave.open(str(Path(__file__).with_name('score.wav')), 'wb') as output:
    output.setnchannels(2)
    output.setsampwidth(2)
    output.setframerate(RATE)
    output.writeframes(data)
print('Original 24-second stereo score ready.')
