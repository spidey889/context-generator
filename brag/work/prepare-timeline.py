"""Give the two typed prompts natural key spacing and one shared audio clock."""
from pathlib import Path
import json, random
file=Path(__file__).with_name('timeline.json')
data=json.loads(file.read_text())
rng=random.Random(2909)
for typing in data['typing']:
    weights=[(.145 if c==' ' else rng.uniform(.066,.105)) for c in typing['text']]
    elapsed=0;times=[]
    for weight in weights:
        elapsed+=weight
        times.append(round(typing['start']+elapsed/sum(weights)*(typing['end']-typing['start']),6))
    times[-1]=typing['end'];typing['keyTimes']=times
file.write_text(json.dumps(data,indent=2)+'\n')
print('Natural key thresholds prepared for both prompts and their sound cues.')
