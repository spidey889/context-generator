"""Inspect dense motion sequences before choosing this film's camera language."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import wave, json, numpy as np

root = Path(__file__).parent / 'reference'
font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 22)
sequences = {
    'toggle': [3 + i / 4 for i in range(9)],
    'camera-send': [15.75 + i / 3 for i in range(9)],
    'question-expand': [23 + i / 3 for i in range(9)],
    'progress-camera': [43 + i / 3 for i in range(9)],
    'context-pullout': [47.5 + i / 3 for i in range(9)],
    'result-reveal': [52 + i / 3 for i in range(9)],
    'composer-push': [56.75 + i / 3 for i in range(9)],
    'outro-exit': [60.5 + i / 3 for i in range(9)],
}
for name, times in sequences.items():
    sheet = Image.new('RGB', (1920, 1182), '#e7e0d5')
    draw = ImageDraw.Draw(sheet)
    for n, sec in enumerate(times):
        f = root / f'dense-{round(sec * 6):04d}.jpg'
        im = Image.open(f).resize((640, 360), Image.Resampling.LANCZOS)
        x, y = (n % 3) * 640, (n // 3) * 394
        sheet.paste(im, (x, y + 34))
        draw.text((x + 12, y + 3), f'{sec:.3f}s', fill='#302c26', font=font)
    sheet.save(root / f'detail-{name}.jpg', quality=95)

with wave.open(str(root / 'reference-audio.wav')) as w:
    rate = w.getframerate()
    sound = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(float) / 32768
window = int(.01 * rate)
blocks = sound[:len(sound) // window * window].reshape(-1, window)
rms = np.sqrt((blocks * blocks).mean(axis=1))
# A waveform strip exposes transient hits and the much quieter UI sounds.
plot = Image.new('RGB', (1920, 560), '#faf9f5')
d = ImageDraw.Draw(plot)
for s in range(0, 69, 2):
    x = 30 + s / 68.63 * 1860
    d.line((x, 35, x, 520), fill='#e2dfd7')
    d.text((x, 3), str(s), font=font, fill='#59574f')
for i, v in enumerate(rms):
    x = 30 + i * window / rate / 68.63 * 1860
    h = min(470, v * 1600)
    d.line((x, 510, x, 510 - h), fill='#ca7654')
plot.save(root / 'audio-energy.png')
stats = {'sampleRate': rate, 'duration': len(sound) / rate,
         'peakDb': float(20*np.log10(max(abs(sound)))),
         'rmsDb': float(20*np.log10(np.sqrt((sound*sound).mean()))),
         'soundWindows': [{'seconds': float(i*.5), 'rmsDb': float(20*np.log10(max(1e-8,np.sqrt((sound[int(i*.5*rate):int((i+1)*.5*rate)]**2).mean()))))} for i in range(137)]}
(root / 'audio-analysis.json').write_text(json.dumps(stats, indent=2))
print('8 dense motion sheets and audio energy plot ready.')
