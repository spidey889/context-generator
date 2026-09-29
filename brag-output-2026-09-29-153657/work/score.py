"""Original quiet piano and synchronized UI Foley. No reference audio is reused."""
from pathlib import Path
import json, hashlib, subprocess, urllib.request, wave
import numpy as np

ROOT=Path(__file__).parent
OUT=ROOT/'audio';SAMPLES=OUT/'samples';SAMPLES.mkdir(parents=True,exist_ok=True)
TIMELINE=json.loads((ROOT/'timeline.json').read_text())
SR=48000;DURATION=TIMELINE['duration'];SIZE=round(SR*DURATION)
rng=np.random.default_rng(29092026)
music=np.zeros((SIZE,2));effects=np.zeros_like(music)
source='https://raw.githubusercontent.com/sgossner/VSCO-2-CE/master/'
sample_credit=[];piano={}
for octave,midi in [(3,48),(4,60),(5,72)]:
    name=f'UR1_C{octave}_pp_RR1.wav';file=SAMPLES/name
    url=source+'Keys/Upright%20Nr1/'+name
    if not file.exists():urllib.request.urlretrieve(url,file)
    raw=SAMPLES/f'C{octave}.f32'
    subprocess.run(['ffmpeg','-v','error','-y','-i',str(file),'-ar',str(SR),'-ac','2','-f','f32le',str(raw)],check=True)
    sound=np.fromfile(raw,'<f4').astype(float).reshape(-1,2)
    sound-=sound.mean(axis=0)
    # Preserve the recorded instrument's transient and stereo image. Only its
    # playback rate and a shared soft low-pass change for the restrained score.
    piano[midi]=sound/max(.01,float(abs(sound).max()))*.55
    sample_credit.append({'name':name,'url':url,'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'license':'CC0-1.0'})

def filtered(x,low=0,high=2600):
    n=len(x);f=np.fft.rfftfreq(n,1/SR)
    shape=1/np.sqrt(1+(f/high)**6)
    if low:shape*=1-1/np.sqrt(1+(f/low)**6)
    if x.ndim==2:shape=shape[:,None]
    return np.fft.irfft(np.fft.rfft(x,axis=0)*shape,n=n,axis=0)

def add(track,seconds,sound,gain=1,pan=0):
    start=round(seconds*SR)
    if start>=SIZE:return
    if sound.ndim==1:sound=np.column_stack([sound,sound])
    if start<0:sound=sound[-start:];start=0
    n=min(len(sound),SIZE-start)
    track[start:start+n]+=sound[:n]*gain*np.array([np.sqrt((1-pan)/2),np.sqrt((1+pan)/2)])

def note(midi,duration=4.2):
    base=min(piano,key=lambda b:abs(b-midi));data=piano[base]
    ratio=2**((midi-base)/12);n=min(round(duration*SR),int((len(data)-1)/ratio))
    at=np.arange(n)*ratio
    result=np.column_stack([np.interp(at,np.arange(len(data)),data[:,c]) for c in range(2)])
    t=np.arange(n)/SR
    result*=np.minimum(1,t/.003)[:,None]
    release=np.minimum(1,(n/SR-t)/.55)
    result*=release[:,None]
    return filtered(result,high=2300)

chords={
    'D':[50,57,64,66],
    'Bm':[47,54,57,62],
    'G':[43,54,59,62],
    'A':[45,52,59,62]
}
changes=[(.28,'D',.055),(4.1,'Bm',.038),(7.3,'G',.04),(12.2,'D',.018),
         (17.1,'D',.06),(21.8,'Bm',.055),(25.4,'G',.054),(28.7,'A',.054),
         (31.75,'D',.062),(35.9,'Bm',.05),(40.3,'G',.05),(44.25,'A',.056),
         (48.0,'D',.062),(54.9,'G',.067),(59.0,'D',.075)]
for start,key,level in changes:
    for i,pitch in enumerate(chords[key]):
        offset=i*.065+float(rng.uniform(-.009,.009))
        add(music,start+offset,note(pitch,4.4),level*(1-i*.09),pan=(i-1.5)*.15)
    if key in ['D','G']:
        add(music,start+1.25,note(chords[key][2]+12,2.8),level*.29,pan=.22)

def mechanical(kind='click'):
    n=round(.12*SR);t=np.arange(n)/SR
    noise=filtered(rng.normal(size=n),low=250,high=2400)
    main=noise*np.exp(-t/(.009 if kind=='click' else .006))
    body=np.sin(2*np.pi*(280 if kind=='click' else 610)*t)*np.exp(-t/.018)*.35
    sound=(main+body)*np.minimum(1,t/.0007)
    release=round((.058 if kind=='click' else .033)*SR)
    tail=filtered(rng.normal(size=n-release),low=400,high=2000)*np.exp(-np.arange(n-release)/SR/.006)*.23
    sound[release:]+=tail
    return sound/max(.001,float(abs(sound).max()))

cue_sheet=[]
for e in TIMELINE['clicks']:
    add(effects,e['time'],mechanical(),.058)
    cue_sheet.append({'type':'click','target':e['target'],'seconds':e['time'],'sample':round(e['time']*SR),'frame':e['time']*TIMELINE['fps']})
for typing in TIMELINE['typing']:
    text=typing['text']
    # These are the same character thresholds used by the pure-time text reveal.
    for i,char in enumerate(text):
        when=typing.get('keyTimes',[])[i] if typing.get('keyTimes') else typing['start']+(i+1)/len(text)*(typing['end']-typing['start'])
        add(effects,when,mechanical('key'),float(rng.uniform(.011,.018)),pan=float(rng.uniform(-.16,.16)))
        cue_sheet.append({'type':'key','seconds':when,'sample':round(when*SR),'target':typing['target'],'character':char})

def sweep(duration,level=.013):
    n=round(duration*SR);t=np.arange(n)/n
    noise=filtered(rng.normal(size=(n,2)),low=160,high=1300)
    env=np.sin(np.pi*t)**2
    return noise*env[:,None]*level

for move in TIMELINE['motion']:
    if move['name'] in ['separate message','brand close']:continue
    duration=move['end']-move['start']
    add(effects,move['start'],sweep(duration),1)
    cue_sheet.append({'type':'motion','seconds':move['start'],'end':move['end'],'name':move['name']})

# The limit has a muted body; progress and paste have light, warm tonal accents.
t=np.arange(round(.22*SR))/SR
impact=(np.sin(2*np.pi*146.83*t)*np.exp(-t/.055)+filtered(rng.normal(size=len(t)),high=900)*np.exp(-t/.017)*.2)*np.minimum(1,t/.004)
add(effects,11.12,impact,.03)
for when,pitch in [(25.4,62),(28.7,64),(30.55,66),(32.85,69),(36.6,62),(44.9,64)]:
    add(effects,when,note(pitch,1.6),.031)
    cue_sheet.append({'type':'status','seconds':when,'midi':pitch})

def room(track):
    wet=track.copy()
    for seconds,gain,swap in [(.027,.13,False),(.057,.11,True),(.093,.085,False),(.143,.066,True),(.211,.05,False),(.337,.035,True),(.473,.023,False),(.683,.012,True)]:
        shift=round(seconds*SR)
        reflection=track[:-shift,::-1] if swap else track[:-shift]
        wet[shift:]+=reflection*gain
    return wet

music=room(music);effects=room(effects)
mix=music+effects
# Gentle saturation rounds the source transients; it is not a hard clip/limiter.
mix=np.tanh(mix*1.1)/1.1
rms=float(np.sqrt((mix*mix).mean()));peak=float(abs(mix).max())
gain=min(10**(-29/20)/max(1e-9,rms),10**(-7/20)/max(1e-9,peak))
mix*=gain
envelope=np.minimum(1,np.arange(SIZE)/SR/.2)*np.minimum(1,(DURATION-np.arange(SIZE)/SR)/2.4)
mix*=envelope[:,None]
with wave.open(str(OUT/'score.wav'),'wb') as w:
    w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes((np.clip(mix,-1,1)*32767).astype('<i2').tobytes())
report={'sampleRate':SR,'duration':DURATION,'seed':29092026,'peakDb':float(20*np.log10(abs(mix).max())),'rmsDb':float(20*np.log10(np.sqrt((mix*mix).mean()))),'clickCount':len(TIMELINE['clicks']),'music':'Original sparse D-major upright-piano score','samples':sample_credit,'cues':cue_sheet}
(ROOT/'audio-manifest.json').write_text(json.dumps(report,indent=2))
print(json.dumps({k:v for k,v in report.items() if k not in ['samples','cues']},indent=2))
