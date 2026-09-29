from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json
root=Path(__file__).parent/'frames'
font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',23)
anchors=json.loads((Path(__file__).parent/'timeline.json').read_text())['timeMap']
def edited(source):
 for (old_a,new_a),(old_b,new_b) in zip(anchors,anchors[1:]):
  if source<=old_b:return round(new_a+(source-old_a)*(new_b-new_a)/(old_b-old_a),3)
 return anchors[-1][1]
def tag(time):return f'{time:.3f}'.rstrip('0').rstrip('.')
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
 for i,source in enumerate(times):
  t=edited(source)
  x,y=i%2*960,i//2*580
  im=Image.open(root/f'scene-{tag(t)}.png').resize((960,540),Image.Resampling.LANCZOS)
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
 print(f"{len(json.loads((root/'motion-groups.json').read_text()))} dense choreography sheets created.")
