from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json
root=Path(__file__).parent/'frames'
font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',23)
groups={
 'opening':[.4,1.8,3,5.8],
 'limit':[7.6,10.85,11.7,14.4],
 'orb-picker':[15.8,17.2,18.3,20.6],
 'native-transfer':[21.8,23.4,26.5,29.6],
 'destination':[31.8,32.45,33.5,35.9],
 'ack-followup':[36.6,38.5,40.8,44.25],
 'continue':[45.7,47.8,49.6,53.5],
 'close':[54.35,55.85,57.3,60.4]
}
for name,times in groups.items():
 sheet=Image.new('RGB',(1920,1160),'#e5ded0');draw=ImageDraw.Draw(sheet)
 for i,t in enumerate(times):
  x,y=i%2*960,i//2*580
  im=Image.open(root/f'scene-{t}.png').resize((960,540),Image.Resampling.LANCZOS)
  sheet.paste(im,(x,y+40));draw.text((x+14,y+4),f'{t:.2f}s',font=font,fill='#35352b')
 sheet.save(root/f'review-{name}.jpg',quality=96)
print('Eight full-story review sheets created.')
if (root/'motion-groups.json').exists():
 for name,times in json.loads((root/'motion-groups.json').read_text()).items():
  sheet=Image.new('RGB',(1920,1182),'#e5ded0');draw=ImageDraw.Draw(sheet)
  for i,t in enumerate(times):
   x,y=i%3*640,i//3*394
   im=Image.open(root/f'motion-{name}-{i}.png').resize((640,360),Image.Resampling.LANCZOS)
   sheet.paste(im,(x,y+34));draw.text((x+12,y+3),f'{t:.3f}s',font=font,fill='#35352b')
  sheet.save(root/f'choreography-{name}.jpg',quality=96)
 print('Eight dense choreography sheets created.')
