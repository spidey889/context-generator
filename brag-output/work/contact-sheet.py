from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

frames = Path(__file__).with_name('frames')
groups = [[.65, 2.15, 3.4, 4.9, 5.6, 6.7], [7.5, 8.5, 9.6, 10.08, 10.8, 11.65], [12.8, 14.7, 15.7, 16.3, 18.7, 20.72], [21.6, 23]]
font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 23)
for group_index, group in enumerate(groups, 1):
    sheet = Image.new('RGB', (1920, ((len(group) + 1) // 2) * 577), '#e3dfdb')
    draw = ImageDraw.Draw(sheet)
    for index, seconds in enumerate(group):
        x, y = (index % 2) * 960, (index // 2) * 577
        shot = Image.open(frames / f'scene-{seconds:g}.png').convert('RGB').resize((960, 540), Image.Resampling.LANCZOS)
        sheet.paste(shot, (x, y + 37))
        draw.text((x + 18, y + 5), f'{seconds:g}s', fill='#51475d', font=font)
    sheet.save(frames / f'contact-{group_index}.jpg', quality=96)
print('Four contact sheets ready.')
