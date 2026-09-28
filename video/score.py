"""Original synthesized score; no recordings, samples, or music licensing needed."""
import math, random, struct, wave
from pathlib import Path
RATE=48000
DURATION=27
out=Path(__file__).parent/'output'
out.mkdir(exist_ok=True)
random.seed(20260928)
left=[0.0]*(RATE*DURATION)
right=[0.0]*(RATE*DURATION)
def add(start,length,fn,gain=1,pan=0):
    offset=int(start*RATE)
    for i in range(int(length*RATE)):
        j=offset+i
        if 0<=j<len(left):
            v=fn(i/RATE)*gain
            left[j]+=v*(1-pan*.45)
            right[j]+=v*(1+pan*.45)
def pad(freq,t,length):
    env=min(1,t/.7)*min(1,(length-t)/.8)
    return env*(math.sin(math.tau*freq*t)*.7+math.sin(math.tau*freq*1.002*t)*.2+math.sin(math.tau*freq*2*t)*.08)
# F minor -> Db -> Ab -> Eb. Restrained pulse, airy arpeggio, warm resolution.
chords=[[174.614,207.652,261.626],[138.591,174.614,207.652],[207.652,261.626,311.127],[155.563,195.998,233.082]]
for k in range(7):
    start=k*4
    chord=chords[k%4]
    for n,f in enumerate(chord):
        add(start,4.8,lambda t,f=f:pad(f,t,4.8),.045,(n-1)*.7)
beat=60/112
for i in range(int(25/beat)):
    start=1.9+i*beat
    if start>25: break
    # A rounded low click rather than a loud dance kick.
    add(start,.22,lambda t:math.sin(math.tau*(58*t+1.9*(1-math.exp(-t*24))))*math.exp(-t*22),.10)
    if i%2:
        add(start,.07,lambda t:random.uniform(-1,1)*math.exp(-t*100),.018,.2)
    f=chords[int(start/4)%4][[0,1,2,1][i%4]]*2
    add(start,.75,lambda t,f=f:(math.sin(math.tau*f*t)+.12*math.sin(math.tau*f*3*t))*math.exp(-t*7)*(1-math.exp(-t*100)),.040,(-1 if i%2 else 1)*.6)
# UI ticks and soft editorial transition swells align with the picture.
for start in [8.95,18.7,20.93]:
    add(start,.09,lambda t:math.sin(math.tau*1150*t)*math.exp(-t*55),.036)
for start in [2.85,6.55,10.5,14.3,17.45,22.25]:
    add(start-.16,.52,lambda t:random.uniform(-1,1)*math.sin(math.pi*t/.52)**2,.017)
for f in [174.614,207.652,261.626,349.228]:
    add(22.5,4.5,lambda t,f=f:pad(f,t,4.5),.036)
peak=max(max(map(abs,left)),max(map(abs,right)))
scale=.67/max(peak,.001)
with wave.open(str(out/'score.wav'),'wb') as w:
    w.setnchannels(2);w.setsampwidth(2);w.setframerate(RATE)
    data=bytearray()
    for i,(l,r) in enumerate(zip(left,right)):
        t=i/RATE
        fade=min(1,t/.25)*min(1,(DURATION-t)/1.5)
        data.extend(struct.pack('<hh',round(l*scale*fade*32767),round(r*scale*fade*32767)))
    w.writeframes(data)
print('Original 27-second stereo score written.')
