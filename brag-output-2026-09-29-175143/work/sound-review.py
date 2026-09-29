"""Objective mix check; it cannot replace listening to the exported video."""
from pathlib import Path
import json, wave
import numpy as np

ROOT=Path(__file__).parent
timeline=json.loads((ROOT/'timeline.json').read_text())
with wave.open(str(ROOT/'audio/score.wav')) as sound:
    assert sound.getframerate()==48000 and sound.getnchannels()==2
    samples=np.frombuffer(sound.readframes(sound.getnframes()),'<i2').astype(np.float64).reshape(-1,2)/32768
mono=samples.mean(axis=1);sr=48000
def db(x):return round(20*np.log10(max(float(np.sqrt(np.mean(x*x))),1e-9)),2)
segments=[('opening',0,9.9),('limit',9.9,13.7),('picker',13.7,18.45),
          ('in-chat handoff',18.45,25.4),('ChatGPT context',25.4,30.95),
          ('follow-up',30.95,36.5),('answer',36.5,45.95),('outro',45.95,52)]
report={'overallPeakDb':round(20*np.log10(float(abs(samples).max())),2),
        'overallRmsDb':db(samples),'sectionRmsDb':{name:db(mono[round(a*sr):round(b*sr)]) for name,a,b in segments},
        'clicks':[]}
for click in timeline['clicks']:
    at=round(click['time']*sr)
    before=mono[at-round(.120*sr):at-round(.020*sr)]
    onset=mono[at:at+round(.060*sr)]
    report['clicks'].append({'target':click['target'],'seconds':click['time'],
                             'preRmsDb':db(before),'onsetRmsDb':db(onset),
                             'onsetGainDb':round(db(onset)-db(before),2)})
assert report['overallPeakDb'] < -1
assert all(c['onsetGainDb'] > -2 for c in report['clicks'])
(ROOT.parent/'sound-review.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
