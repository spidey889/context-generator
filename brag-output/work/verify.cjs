const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {execFileSync,spawnSync}=require('node:child_process'),{createRequire}=require('node:module');
const {chromium}=createRequire(path.join(process.env.CAP_VIDEO_NODE_MODULES||'C:/Users/vinit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules','_brag.cjs'))('playwright');
const out=path.dirname(__dirname),file=path.join(out,'brag.mp4'),poster=path.join(out,'brag.jpg'),ff=process.env.FFMPEG_PATH||'ffmpeg';
const metadata=JSON.parse(execFileSync(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));
const v=metadata.streams.find(s=>s.codec_type==='video'),a=metadata.streams.find(s=>s.codec_type==='audio');
if(v?.width!==1920||v?.height!==1080||v?.r_frame_rate!=='60/1'||Number(v?.nb_frames)!==1440||v?.codec_name!=='h264'||v?.pix_fmt!=='yuv420p'||v?.color_range!=='tv'||v?.color_space!=='bt709'||a?.codec_name!=='aac'||a?.channels!==2||Math.abs(Number(metadata.format.duration)-24)>.04)throw Error('Wrong export duration, dimensions, codecs, frame count or color range');
execFileSync(ff,['-v','error','-xerror','-i',file,'-f','null','-'],{stdio:['ignore','pipe','pipe']});
const levels=spawnSync(ff,['-hide_banner','-i',file,'-af','volumedetect','-f','null','-'],{encoding:'utf8',maxBuffer:10*1024*1024});
const peak=Number(levels.stderr.match(/max_volume: ([-\d.]+) dB/)?.[1]),mean=Number(levels.stderr.match(/mean_volume: ([-\d.]+) dB/)?.[1]);
if(levels.status!==0||!Number.isFinite(peak)||peak>=0||!Number.isFinite(mean)||mean< -45)throw Error('Missing, inaudible or clipped soundtrack');
const server=http.createServer((req,res)=>{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<body style="margin:0;background:#f8f7f4"><video muted playsinline preload="auto" style="width:1920px;height:1080px" src="/film.mp4"></video>');return;}
 if(req.url==='/poster.jpg'){res.setHeader('Content-Type','image/jpeg');res.end(fs.readFileSync(poster));return;}
 if(req.url!='/film.mp4'){res.writeHead(404).end();return;}
 const size=fs.statSync(file).size,range=req.headers.range;
 if(range){const match=range.match(/^bytes=(\d+)-(\d*)$/);if(!match){res.writeHead(416).end();return;}const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),size-1):size-1;if(start>end){res.writeHead(416).end();return;}res.writeHead(206,{'Content-Type':'video/mp4','Content-Range':`bytes ${start}-${end}/${size}`,'Accept-Ranges':'bytes','Content-Length':end-start+1});fs.createReadStream(file,{start,end}).pipe(res);}
 else{res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':size,'Accept-Ranges':'bytes'});fs.createReadStream(file).pipe(res);}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.BRAVE_PATH||'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,args:['--new-window','--disable-gpu']});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}});await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
  const posterError=await page.evaluate(async()=>{const image=new Image();image.src='/poster.jpg';await image.decode();const canvas=document.createElement('canvas');canvas.width=384;canvas.height=216;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,384,216);const expected=ctx.getImageData(0,0,384,216).data;ctx.drawImage(document.querySelector('video'),0,0,384,216);const actual=ctx.getImageData(0,0,384,216).data;let sum=0;for(let i=0;i<actual.length;i+=4)for(let channel=0;channel<3;channel++)sum+=Math.abs(actual[i+channel]-expected[i+channel]);return sum/(384*216*3);});
  if(posterError>5)throw Error('Poster was not baked into frame 0: '+posterError);
  const samples=[.65,3.4,5.6,6.7,8.5,9.6,10.8,11.65,12.8,14.7,15.7,18.7,21.6,23],colors=[];
  for(const t of samples){
   await page.evaluate(t=>new Promise((resolve,reject)=>{const video=document.querySelector('video');video.addEventListener('seeked',resolve,{once:true});video.addEventListener('error',()=>reject(Error('Browser video decode error')),{once:true});video.currentTime=t;}),t);
   await page.screenshot({path:path.join(__dirname,'frames',`export-${t}.png`)});
   if(t===8.5||t===23){const rgb=await page.evaluate(()=>{const video=document.querySelector('video'),canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0);return [...ctx.getImageData(10,10,1,1).data].slice(0,3);});const expected=t===23?[238,233,224]:[246,245,244];if(rgb.some((n,i)=>Math.abs(n-expected[i])>6))throw Error('Browser color mismatch: '+rgb);colors.push({seconds:t,expectedRgb:expected,decodedRgb:rgb,tolerance:6});}
  }
  await page.evaluate(async()=>{const video=document.querySelector('video');video.currentTime=0;await video.play();});
  await page.waitForFunction(()=>document.querySelector('video').ended,{},{timeout:40000});
  const playback=await page.evaluate(()=>{const video=document.querySelector('video'),q=video.getVideoPlaybackQuality();return {ended:video.ended,currentTime:video.currentTime,totalVideoFrames:q.totalVideoFrames,droppedVideoFrames:q.droppedVideoFrames,error:video.error?.message||null};});
  if(playback.error||Math.abs(playback.currentTime-24)>.04)throw Error('Playback did not complete');
  const sha=filename=>crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  const report={edition:'brag-slim first draft',story:'Claude limit → Cap Context → ChatGPT continuation',durationSeconds:Number(metadata.format.duration),width:v.width,height:v.height,fps:60,frames:Number(v.nb_frames),video:v.codec_name,pixelFormat:v.pix_fmt,colorRange:v.color_range,colorSpace:v.color_space,audio:a.codec_name,audioChannels:a.channels,audioPeakDb:peak,audioMeanDb:mean,posterFrame0MeanRgbError:posterError,browserColorChecks:colors,fullDecode:'passed',isolatedBraveSeeking:'passed',fullBravePlayback:playback,sizeBytes:fs.statSync(file).size,sha256:sha(file),posterSha256:sha(poster),compositionSha256:sha(path.join(__dirname,'film.html')),productionUiProvenance:JSON.parse(fs.readFileSync(path.join(__dirname,'assets/provenance.json'),'utf8')),sampleFrames:samples};
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
