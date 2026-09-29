"""Build timestamped review sheets from the actual supplied film, not old notes."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json

root = Path(__file__).parent / 'reference'
font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 25)

def sheets(label, times):
    for group_index in range(0, len(times), 4):
        group = times[group_index:group_index + 4]
        sheet = Image.new('RGB', (1920, 2 * 580), '#dcd8d2')
        draw = ImageDraw.Draw(sheet)
        for index, time in enumerate(group):
            frame = round(time * 2)
            filename = root / f'reference-{frame:03d}.jpg'
            if not filename.exists():
                continue
            x, y = (index % 2) * 960, (index // 2) * 580
            image = Image.open(filename).convert('RGB')
            sheet.paste(image, (x, y + 40))
            draw.text((x + 18, y + 5), f'{time:g}s', fill='#423c34', font=font)
        filename = root / f'{label}-{group_index // 4 + 1:02d}.jpg'
        sheet.save(filename, quality=97)

sheets('overview', list(range(0, 69, 2)))
print('Nine chronological overview sheets ready; half-second frames retained for motion inspection.')
