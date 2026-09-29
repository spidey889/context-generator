const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),{execFileSync,spawnSync}=require('node:child_process'),{createRequire}=require('node:module');
const {chromium}=createRequire('C:/Users/vinit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/_cap-film.cjs')('playwright');
const out=path.dirname(__dirname),root=path.resolve(__dirname,'../..'),file=path.join(out,'brag.mp4'),poster=path.join(out,'brag.jpg'),timeline=JSON.parse(fs.readFileSync(path.join(__dirname,'timeline.json'))),native=JSON.parse(fs.readFileSync(path.join(__dirname,'native/ui.json')));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function edited(source){const keys=timeline.timeMap;let i=0;while(i<keys.length-1&&source>keys[i+1][0])i++;const a=keys[i],b=keys[Math.min(i+1,keys.length-1)];return Number((a[1]+(source-a[0])*(b[1]-a[1])/(b[0]-a[0]||1)).toFixed(3))}
const metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'})),v=metadata.streams.find(s=>s.codec_type==='video'),a=metadata.streams.find(s=>s.codec_type==='audio');
if(v?.width!==1920||v?.height!==1080||v?.r_frame_rate!==`${timeline.fps}/1`||Number(v?.nb_frames)!==timeline.duration*timeline.fps||v?.codec_name!=='h264'||v?.pix_fmt!=='yuv420p'||v?.color_range!=='tv'||v?.color_space!=='bt709'||a?.codec_name!=='aac'||a?.channels!==2||Math.abs(Number(metadata.format.duration)-timeline.duration)>.04)throw Error('Export format failed');
execFileSync('ffmpeg',['-v','error','-xerror','-i',file,'-f','null','-'],{stdio:['ignore','pipe','pipe']});
const level=spawnSync('ffmpeg',['-hide_banner','-i',file,'-af','volumedetect','-f','null','-'],{encoding:'utf8',maxBuffer:10*1024*1024}),peak=Number(level.stderr.match(/max_volume: ([-\d.]+) dB/)?.[1]),mean=Number(level.stderr.match(/mean_volume: ([-\d.]+) dB/)?.[1]);
if(level.status!==0||!Number.isFinite(peak)||peak>=-1||!Number.isFinite(mean)||mean< -45)throw Error('Audio clipped or inaudible');
if(sha(path.join(root,'extension/platform-content.js'))!==native.provenance.sha256)throw Error('Production UI source changed after capture');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'audio-manifest.json'))),sync=timeline.clicks.map(c=>{
 const cue=manifest.cues.find(e=>e.type==='click'&&e.target===c.target),error=cue?Math.abs(cue.sample/manifest.sampleRate-c.time):Infinity;
 if(error>1/manifest.sampleRate||Math.abs(c.time*timeline.fps-Math.round(c.time*timeline.fps))>1e-6)throw Error('Click sound not synchronized: '+c.target);
 return{target:c.target,seconds:c.time,frame:Math.round(c.time*timeline.fps),soundSample:cue.sample,syncErrorSeconds:error};
});
const server=http.createServer((req,res)=>{
 const uri=req.url.split('?')[0];
 if(uri==='/'){res.setHeader('Content-Type','text/html');res.end('<body style="margin:0;background:#faf9f5"><video muted playsinline preload="auto" style="width:1920px;height:1080px" src="/film.mp4"></video>');return;}
 if(uri==='/poster.jpg'){res.setHeader('Content-Type','image/jpeg');res.end(fs.readFileSync(poster));return;}
 if(uri==='/film.mp4'){
  const size=fs.statSync(file).size,range=req.headers.range;
  if(range){const match=range.match(/^bytes=(\d+)-(\d*)$/);if(!match){res.writeHead(416).end();return;}const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),size-1):size-1;if(start>end){res.writeHead(416).end();return;}res.writeHead(206,{'Content-Type':'video/mp4','Content-Range':`bytes ${start}-${end}/${size}`,'Accept-Ranges':'bytes','Content-Length':end-start+1});fs.createReadStream(file,{start,end}).pipe(res);}
  else{res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':size,'Accept-Ranges':'bytes'});fs.createReadStream(file).pipe(res);}return;
 }
 const local=path.resolve(root,'.'+decodeURIComponent(uri));if(!local.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',{'.html':'text/html','.png':'image/png','.json':'application/json','.woff2':'font/woff2'}[path.extname(local)]||'application/octet-stream');res.end(fs.readFileSync(local));}catch{res.writeHead(404).end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,args:['--new-window','--disable-gpu']});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}});await page.goto(base);await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
  const posterError=await page.evaluate(async()=>{const img=new Image();img.src='/poster.jpg';await img.decode();const canvas=document.createElement('canvas');canvas.width=384;canvas.height=216;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,384,216);const expected=ctx.getImageData(0,0,384,216).data;ctx.drawImage(document.querySelector('video'),0,0,384,216);const actual=ctx.getImageData(0,0,384,216).data;let sum=0;for(let i=0;i<actual.length;i+=4)for(let c=0;c<3;c++)sum+=Math.abs(actual[i+c]-expected[i+c]);return sum/(384*216*3)});
  if(posterError>5)throw Error('Frame-zero poster mismatch');
  const sampleTimes=[.4,5.8,9.8,10.85,12.2,16.8,18.3,20.6,21.9,23.4,26.5,29.6,32.45,33.5,35.9,38.5,42.7,44.25,49.6,53.5,54.35,55.85,57.3,60.4].map(edited);
  sampleTimes.push(timeline.posterTime);
  sampleTimes.sort((a,b)=>a-b);
  const composition=await browser.newPage({viewport:{width:1920,height:1080}});await composition.goto(base+'/'+path.basename(out)+'/work/film.html');await composition.evaluate(()=>window.ready);
  const fidelity=[],checks=[];
  for(const t of sampleTimes){
   await page.evaluate(t=>new Promise((resolve,reject)=>{const video=document.querySelector('video');video.addEventListener('seeked',resolve,{once:true});video.addEventListener('error',()=>reject(Error('Video decode error')),{once:true});video.currentTime=t}),t);
   await page.screenshot({path:path.join(__dirname,'frames',`export-${t}.png`)});await composition.evaluate(t=>setTime(t),t);
   const state=await composition.evaluate(()=>window.frameState);checks.push({seconds:t,scene:state.scene,marketingVisible:state.marketingVisible,workVisible:state.workVisible});
   if(state.marketingVisible&&state.workVisible)throw Error('Marketing text overlaps work');
   if([edited(23.4),edited(49.6),timeline.posterTime].includes(t)){
    const reference=(await composition.screenshot({type:'png'})).toString('base64');
    const mae=await page.evaluate(async data=>{
      const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();
      const canvas=document.createElement('canvas');canvas.width=384;canvas.height=216;
      const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,384,216);
      const expected=ctx.getImageData(0,0,384,216).data;
      ctx.drawImage(document.querySelector('video'),0,0,384,216);
      const actual=ctx.getImageData(0,0,384,216).data;
      let sum=0;for(let i=0;i<actual.length;i+=4)for(let c=0;c<3;c++)sum+=Math.abs(actual[i+c]-expected[i+c]);
      return sum/(384*216*3);
    },reference);
    if(mae>7)throw Error('Encoded frame deviates from composition: '+JSON.stringify({time:t,mae}));
    fidelity.push({seconds:t,meanRgbError:mae});
   }
  }
  const inChatHandoff=await composition.evaluate(()=>{
    const inspect=t=>{setTime(t);const claude=document.getElementById('claude-scene'),transfer=document.getElementById('transfer-scene'),card=document.getElementById('context-generator-overlay');return{seconds:t,claudeVisible:getComputedStyle(claude).display!=='none',transferVisible:getComputedStyle(transfer).display!=='none',cardText:card?.innerText||'',claudeText:document.getElementById('claude-reply').textContent}};
    return[inspect(19.1),inspect(23.2)];
  });
  if(inChatHandoff.some(h=>!h.claudeVisible||!h.transferVisible||!h.cardText.includes('ChatGPT')||!h.claudeText.includes('Sanjo')))throw Error('Handoff is detached from Claude chat');
  const semantic=await composition.evaluate(()=>{setTime(42);return {ack:document.getElementById('gpt-ack').textContent,followup:document.getElementById('gpt-followup').textContent,answer:document.getElementById('gpt-answer').innerText,context:document.getElementById('carry-history').innerText}});
  if(semantic.ack!=="Context loaded. Let's pick up right where you left off."||semantic.followup!=='Continue with day three.'||!['Sanjo','Vegetarian','Leave it open'].every(s=>semantic.answer.includes(s))||!['WHO I AM','WHAT WE WERE DOING','WHERE WE LEFT OFF','DECISIONS MADE','OPEN QUESTIONS','KEY CONTEXT','NEXT STEP'].every(s=>semantic.context.includes(s)))throw Error('Story lost its source context or confirmation contract');
  await composition.close();await page.close();
  // A fresh video element separates playback drops from the many deliberate seek tests above.
  const playbackPage=await browser.newPage({viewport:{width:1920,height:1080}});await playbackPage.goto(base);await playbackPage.waitForFunction(()=>document.querySelector('video').readyState>=2);
  const startingDrops=await playbackPage.evaluate(()=>document.querySelector('video').getVideoPlaybackQuality().droppedVideoFrames);
  await playbackPage.evaluate(async()=>document.querySelector('video').play());console.log('Fresh Brave playback started; awaiting the complete 52-second film.');
  await playbackPage.waitForFunction(()=>document.querySelector('video').ended,{},{timeout:75000});
  const playback=await playbackPage.evaluate(()=>{const video=document.querySelector('video'),quality=video.getVideoPlaybackQuality();return{ended:video.ended,currentTime:video.currentTime,totalVideoFrames:quality.totalVideoFrames,droppedVideoFrames:quality.droppedVideoFrames,error:video.error?.message||null}});
  playback.droppedDuringPlayback=playback.droppedVideoFrames-startingDrops;
  await playbackPage.close();
  if(playback.error||Math.abs(playback.currentTime-timeline.duration)>.04)throw Error('Playback did not complete');
  const report={edition:'Second cut: in-chat handoff and stronger original score',width:v.width,height:v.height,durationSeconds:Number(metadata.format.duration),fps:timeline.fps,frames:Number(v.nb_frames),video:v.codec_name,pixelFormat:v.pix_fmt,colorRange:v.color_range,colorSpace:v.color_space,audio:a.codec_name,audioChannels:a.channels,audioPeakDb:peak,audioMeanDb:mean,posterFrame0MeanRgbError:posterError,fullDecode:'passed',encodedFrameFidelity:fidelity,seeking:'passed',fullBravePlayback:playback,clickSynchronization:sync,inChatHandoff,story:semantic,marketingSeparation:checks.every(c=>!(c.marketingVisible&&c.workVisible)),productionUi:native.provenance,compositionAudit:JSON.parse(fs.readFileSync(path.join(__dirname,'frames/composition-audit.json'))),sizeBytes:fs.statSync(file).size,sha256:sha(file),posterSha256:sha(poster),compositionSha256:sha(path.join(__dirname,'film.html')),timelineSha256:sha(path.join(__dirname,'timeline.json'))};
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({duration:report.durationSeconds,frames:report.frames,sizeBytes:report.sizeBytes,peak,mean,posterError,playback,marketingSeparation:report.marketingSeparation,clicks:sync.length,sha256:report.sha256},null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
