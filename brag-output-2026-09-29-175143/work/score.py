"""Original second-cut score: felt upright, tonal pulse and shared-space Foley."""
from pathlib import Path
import hashlib, json, subprocess, urllib.request, wave
import numpy as np

ROOT=Path(__file__).parent
OUT=ROOT/'audio'; SAMPLES=OUT/'samples'; SAMPLES.mkdir(parents=True,exist_ok=True)
TIMELINE=json.loads((ROOT/'timeline.json').read_text(encoding='utf-8'))
SR=48000; DURATION=TIMELINE['duration']; SIZE=round(DURATION*SR)
RNG=np.random.default_rng(30092026)
music=np.zeros((SIZE,2),dtype=np.float64); effects=np.zeros_like(music)
piano={}; sources=[]
for octave,midi in [(3,48),(4,60),(5,72)]:
    name=f'UR1_C{octave}_pp_RR1.wav'
    url=f'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/master/Keys/Upright%20Nr1/{name}'
    file=SAMPLES/name
    if not file.exists(): urllib.request.urlretrieve(url,file)
    raw=SAMPLES/f'C{octave}.f32'
    subprocess.run(['ffmpeg','-v','error','-y','-i',str(file),'-ar',str(SR),'-ac','2','-f','f32le',str(raw)],check=True)
    signal=np.fromfile(raw,'<f4').astype(np.float64).reshape(-1,2)
    signal-=signal.mean(axis=0)
    piano[midi]=signal/max(.01,float(abs(signal).max()))*.55
    sources.append({'name':name,'url':url,'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),
                    'license':'CC0-1.0','publisher':'VSCO 2 Community Edition'})

def filtered(x,low=0,high=2600):
    n=len(x); f=np.fft.rfftfreq(n,1/SR)
    shape=1/np.sqrt(1+(f/high)**6)
    if low: shape*=1-1/np.sqrt(1+(f/low)**6)
    if x.ndim==2: shape=shape[:,None]
    return np.fft.irfft(np.fft.rfft(x,axis=0)*shape,n=n,axis=0)

def add(track,seconds,signal,gain=1,pan=0):
    start=round(seconds*SR)
    if start>=SIZE: return
    if signal.ndim==1: signal=np.column_stack([signal,signal])
    if start<0: signal=signal[-start:];start=0
    n=min(len(signal),SIZE-start)
    track[start:start+n]+=signal[:n]*gain*np.array([np.sqrt((1-pan)/2),np.sqrt((1+pan)/2)])

def piano_note(midi,duration=2.4):
    base=min(piano,key=lambda pitch:abs(pitch-midi)); data=piano[base]
    ratio=2**((midi-base)/12); n=min(round(duration*SR),int((len(data)-1)/ratio))
    positions=np.arange(n)*ratio
    signal=np.column_stack([np.interp(positions,np.arange(len(data)),data[:,c]) for c in range(2)])
    t=np.arange(n)/SR
    signal*=np.minimum(1,t/.005)[:,None]*np.minimum(1,(n/SR-t)/.45)[:,None]
    return filtered(signal,high=3200)

def pluck(midi,duration=.66):
    n=round(duration*SR);t=np.arange(n)/SR;phase=2*np.pi*440*2**((midi-69)/12)*t
    body=np.sin(phase)+.22*np.sin(phase*2)+.08*np.sin(phase*3)
    return body*(1-np.exp(-t/.003))*np.exp(-t/.18)*np.minimum(1,(duration-t)/.08)

def bass(midi,duration=1.45):
    n=round(duration*SR);t=np.arange(n)/SR;phase=2*np.pi*440*2**((midi-69)/12)*t
    return (np.sin(phase)+.20*np.sin(phase*2))*np.minimum(1,t/.018)*np.exp(-t/.70)*np.minimum(1,(duration-t)/.23)

def brush():
    n=round(.075*SR);t=np.arange(n)/SR
    signal=filtered(RNG.normal(size=n),low=1900,high=6000)*np.exp(-t/.015)*np.minimum(1,t/.001)
    return signal/max(.001,float(abs(signal).max()))

def mechanical(click):
    n=round(.105*SR);t=np.arange(n)/SR
    texture=filtered(RNG.normal(size=n),low=250 if click else 510,high=2600)
    body=np.sin(2*np.pi*(285 if click else 670)*t)*np.exp(-t/.020)
    signal=(texture*np.exp(-t/(.010 if click else .006))+.27*body)*np.minimum(1,t/.0007)
    return signal/max(.001,float(abs(signal).max()))

CHORDS=[('Dadd9',[50,57,64,66],38),('Bm7',[47,54,57,62],35),
        ('Gmaj7',[43,54,59,66],31),('Aadd9',[45,52,59,64],33)]
BEAT=.60;BAR=4*BEAT
def intensity(t):
    if t<9.9:return .84
    if t<13.7:return .17  # Limit: remove the pulse so the interruption lands.
    if t<18.45:return 1.06
    if t<25.4:return 1.22
    if t<30.95:return .96
    if t<36.5:return 1.03
    if t<45.95:return 1.13
    return .78

score_events=[]
for bar in range(22):
    start=.18+bar*BAR
    if start>=DURATION:break
    name,chord,root=CHORDS[bar%4];strength=intensity(start)
    for i,pitch in enumerate(chord):
        at=start+i*.050+float(RNG.uniform(-.009,.009))
        add(music,at,piano_note(pitch,3.0),.043*strength*(1-i*.11),pan=(i-1.5)*.13)
    add(music,start,bass(root),.026*strength)
    score_events.append({'type':'bar','seconds':round(start,3),'chord':name,'intensity':strength})
    if 9.9<=start<13.7:continue
    phrase=[chord[2]+12,chord[3]+12,chord[2]+12,chord[1]+12]
    for i,(offset,pitch) in enumerate(zip([.30,.90,1.35,1.95],phrase)):
        at=start+offset
        if at>=DURATION or 9.9<=at<13.7:continue
        add(music,at,piano_note(pitch,1.15),.019*intensity(at)*(1-.12*i),pan=-.20 if i%2 else .19)
        if i in (0,2):add(music,at,pluck(pitch+12),.007*intensity(at),pan=.13 if i else -.12)
        score_events.append({'type':'motif','seconds':round(at,3),'midi':pitch})

for beat in range(round(DURATION/BEAT)+1):
    at=.18+beat*BEAT
    if at>=DURATION or 9.9<=at<13.7:continue
    chord=CHORDS[(beat//4)%4][1]
    add(music,at,pluck(chord[1]+12,.50),.011*intensity(at)*(.82 if beat%4 else 1.10),
        pan=-.18 if beat%2 else .18)
    if 13.7<=at<45.95:add(music,at+BEAT*.5,brush(),.0040*intensity(at),
                           pan=.27 if beat%2 else -.27)

# Suspended limit note, pickup, three handoff stages, answer and outro blooms.
for at,pitch,gain in [(9.9,62,.012),(13.4,74,.019),(18.45,76,.025),
                      (20.8,78,.024),(23.2,79,.024),(25.4,74,.020),
                      (30,74,.018),(36.5,78,.032),(46.2,76,.028),(49.55,74,.025)]:
    add(music,at,piano_note(pitch,2.6),gain,pan=.12)
    score_events.append({'type':'accent','seconds':at,'midi':pitch})

cue_sheet=[]
for click in TIMELINE['clicks']:
    click_gain=(.125 if click['target']=='Send carried context' else
                .080 if click['target']=='Continue in ChatGPT' else .058)
    add(effects,click['time'],mechanical(True),click_gain)
    cue_sheet.append({'type':'click','target':click['target'],'seconds':click['time'],
                      'sample':round(click['time']*SR),'frame':round(click['time']*TIMELINE['fps'])})
for typing in TIMELINE['typing']:
    for char,at in zip(typing['text'],typing['keyTimes']):
        add(effects,at,mechanical(False),float(RNG.uniform(.010,.016)),pan=float(RNG.uniform(-.16,.16)))
        cue_sheet.append({'type':'key','target':typing['target'],'character':char,
                          'seconds':at,'sample':round(at*SR)})

def swish(duration):
    n=round(duration*SR);t=np.arange(n)/SR
    noise=filtered(RNG.normal(size=(n,2)),low=180,high=1400)
    return noise*(np.sin(np.pi*t/duration)**2)[:,None]
for move in TIMELINE['motion']:
    if move['name'] in ('separate message','brand close'):continue
    duration=move['end']-move['start']
    add(effects,move['start'],swish(duration),.010)
    cue_sheet.append({'type':'motion','name':move['name'],'seconds':move['start'],'end':move['end']})
t=np.arange(round(.20*SR))/SR
impact=(np.sin(2*np.pi*146.83*t)*np.exp(-t/.055)+.20*filtered(RNG.normal(size=len(t)),high=750)*np.exp(-t/.014))
add(effects,9.9,impact*np.minimum(1,t/.003),.034)

def room(track):
    wet=track.copy()
    for seconds,gain,swap in [(.027,.13,False),(.057,.11,True),(.093,.085,False),
                              (.143,.066,True),(.211,.05,False),(.337,.035,True)]:
        shift=round(seconds*SR)
        wet[shift:]+=(track[:-shift,::-1] if swap else track[:-shift])*gain
    return wet
music=room(music);effects=room(effects)
# A very short music dip makes the visible presses read clearly without
# making the Foley unnaturally loud or disturbing the preceding phrase.
for click in TIMELINE['clicks']:
    at=round(click['time']*SR);start=max(0,at-round(.12*SR));end=min(SIZE,at+round(.20*SR))
    relative=np.arange(start,end)/SR-click['time']
    notch=np.exp(-((relative-.015)/.070)**2)
    depth=.68 if click['target']=='Send carried context' else .40
    music[start:end]*=(1-depth*notch)[:,None]
mix=np.tanh((music+effects)*1.12)/1.12
raw_rms=float(np.sqrt((mix*mix).mean()))
mix*=10**(-25.5/20)/max(raw_rms,1e-9)
# Preserve the musical bed when one click is louder than its neighboring
# phrase. Only local peaks bend against the soft -6 dBFS ceiling.
ceiling=10**(-6/20)
mix=np.tanh(mix/ceiling)*ceiling
fade=np.minimum(1,np.arange(SIZE)/SR/.18)*np.minimum(1,(DURATION-np.arange(SIZE)/SR)/1.7)
mix*=fade[:,None]
with wave.open(str(OUT/'score.wav'),'wb') as output:
    output.setnchannels(2);output.setsampwidth(2);output.setframerate(SR)
    output.writeframes((np.clip(mix,-1,1)*32767).astype('<i2').tobytes())
report={'sampleRate':SR,'duration':DURATION,'seed':30092026,'tempoBpm':100,
        'music':'Original D-major felt-upright motif and tonal pulse',
        'peakDb':float(20*np.log10(abs(mix).max())),
        'rmsDb':float(20*np.log10(np.sqrt((mix*mix).mean()))),
        'musicRawRmsDb':float(20*np.log10(np.sqrt((music*music).mean()))),
        'effectsRawRmsDb':float(20*np.log10(np.sqrt((effects*effects).mean()))),
        'clickCount':len(TIMELINE['clicks']),'samples':sources,'scoreEvents':score_events,'cues':cue_sheet}
(ROOT/'audio-manifest.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k not in ('samples','scoreEvents','cues')},indent=2))
