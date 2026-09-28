"""Original V2 music: felt-like keys, restrained pulse, soft stereo air.
No audio from the reference is sampled or reused.
"""
import math, random, struct, wave
from pathlib import Path
R=48000
D=29.5
out=Path(__file__).parent/'output'
out.mkdir(exist_ok=True)
random.seed(2909)
left=[0.] * int(R*D)
right=[0.] * int(R*D)
def add(start,duration,fn,gain=.1,pan=0):
    begin=int(start*R)
    for i in range(int(duration*R)):
        j=begin+i
        if 0<=j<len(left):
            sample=fn(i/R)*gain
            left[j]+=sample*(1-.4*pan)
            right[j]+=sample*(1+.4*pan)
def key(f,t):
    attack=1-math.exp(-t*180)
    return attack*(math.sin(math.tau*f*t)*math.exp(-t*2.4)+.22*math.sin(math.tau*f*2*t)*math.exp(-t*5)+.07*math.sin(math.tau*f*3*t)*math.exp(-t*9))
chords=[[164.814,207.652,246.942,329.628],[130.813,164.814,195.998,261.626],[146.832,184.997,220.,293.665],[123.471,155.563,184.997,246.942]]
beat=60/108
for i in range(50):
    start=.25+i*beat
    if start>25.0:break
    f=chords[int(start/4)%4][[0,2,1,3,2,1,3,2][i%8]]*(2 if i%4==3 else 1)
    add(start,2.8,lambda t,f=f:key(f,t),.09,(-.45 if i%2 else .45))
    add(start+.22,2.2,lambda t,f=f:key(f,t),.020,(-.75 if i%2 else .75))
    if start>6.5 and i%2==0:
        add(start,.2,lambda t:math.sin(math.tau*(55*t+1.1*(1-math.exp(-t*32))))*math.exp(-t*24),.07)
    if start>9.5 and i%2==1:
        add(start,.08,lambda t:random.uniform(-1,1)*math.exp(-t*70),.010,.55)
for k in range(7):
    for n,f in enumerate(chords[k%4][:3]):
        add(k*4,5,lambda t,f=f:min(1,t/.9)*min(1,(5-t)/1.1)*math.sin(math.tau*f*.5*t),.025,(n-1)*.6)
# Cursor clicks, a subdued limit cue, and soft camera-transition air.
for start in [7.0,9.4,19.16,21.72]:
    add(start,.055,lambda t:math.sin(math.tau*1180*t)*math.exp(-t*65),.027)
add(2.8,.4,lambda t:(math.sin(math.tau*523.25*t)+.3*math.sin(math.tau*659.25*t))*math.exp(-t*11),.033)
for start in [3.1,7.2,10.1,14.1,25.2]:
    add(start-.12,.44,lambda t:random.uniform(-1,1)*math.sin(math.pi*t/.44)**2,.011)
for f in [164.814,207.652,246.942,329.628]:
    add(25.35,4.0,lambda t,f=f:key(f,t),.09)
peak=max(max(map(abs,left)),max(map(abs,right)))
scale=.64/peak
with wave.open(str(out/'score.wav'),'wb') as w:
    w.setnchannels(2);w.setsampwidth(2);w.setframerate(R)
    data=bytearray()
    for i,(l,r) in enumerate(zip(left,right)):
        t=i/R
        fade=min(1,t/.22)*min(1,(D-t)/1.1)
        data.extend(struct.pack('<hh',round(l*scale*fade*32767),round(r*scale*fade*32767)))
    w.writeframes(data)
print('V2 original stereo score ready.')
