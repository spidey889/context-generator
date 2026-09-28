// Verify the exported media itself: container, decode, audio, and Brave playback.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const deps=process.env.CAP_VIDEO_NODE_MODULES||'C:/Users/vinit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
let pw;try{pw=require('playwright')}catch{pw=createRequire(path.join(deps,'_video.cjs'))('playwright')}
const file=path.join(__dirname,'output','cap-context-launch.mp4'),ff=process.env.FFMPEG_PATH||'ffmpeg';
const metadata=JSON.parse(execFileSync(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));
const v=metadata.streams.find(s=>s.codec_type==='video'),a=metadata.streams.find(s=>s.codec_type==='audio');
if(v?.width!==1920||v?.height!==1080||v?.r_frame_rate!=='30/1'||v?.codec_name!=='h264'||a?.codec_name!=='aac'||a?.channels!==2||Math.abs(Number(metadata.format.duration)-27)>.05)throw Error('Unexpected export format');
execFileSync(ff,['-v','error','-xerror','-i',file,'-f','null','-'],{stdio:['ignore','pipe','pipe']});
// volumedetect writes its measurements to stderr, so inspect through spawnSync.
const measured=require('node:child_process').spawnSync(ff,['-hide_banner','-i',file,'-af','volumedetect','-f','null','-'],{encoding:'utf8',maxBuffer:10*1024*1024});
if(measured.status!==0)throw Error(measured.stderr);
const peak=Number(measured.stderr.match(/max_volume: ([-\d.]+) dB/)?.[1]);
if(!Number.isFinite(peak)||peak>=0)throw Error('Clipping or missing audio');
const server=http.createServer((req,res)=>{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<body style="margin:0;background:#08090c"><video id="video" muted playsinline preload="auto" style="width:1920px;height:1080px" src="/film.mp4"></video>');return;}
 if(req.url!='/film.mp4'){res.writeHead(404).end();return;}
 const size=fs.statSync(file).size,range=req.headers.range;
 if(range){const m=range.match(/bytes=(\d+)-(\d*)/);const start=Number(m[1]),end=m[2]?Math.min(Number(m[2]),size-1):size-1;res.writeHead(206,{'Content-Type':'video/mp4','Content-Range':`bytes ${start}-${end}/${size}`,'Accept-Ranges':'bytes','Content-Length':end-start+1});fs.createReadStream(file,{start,end}).pipe(res)}
 else{res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':size,'Accept-Ranges':'bytes'});fs.createReadStream(file).pipe(res)}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await pw.chromium.launch({executablePath:process.env.BRAVE_PATH||'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,args:['--new-window','--disable-gpu']});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}});await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
  await page.evaluate(()=>document.querySelector('video').play());
  await page.waitForFunction(()=>document.querySelector('video').currentTime>.2);
  await page.evaluate(()=>document.querySelector('video').pause());
  for(const t of [1.5,8.9,12.6,18.15,21.7,24.1]){
   await page.evaluate(t=>new Promise((resolve,reject)=>{const v=document.querySelector('video');v.addEventListener('seeked',resolve,{once:true});v.addEventListener('error',()=>reject(Error('Video decode error')),{once:true});v.currentTime=t}),t);
   await page.screenshot({path:path.join(__dirname,'output',`export-${t}.png`)});
  }
  const report={durationSeconds:Number(metadata.format.duration),width:v.width,height:v.height,fps:30,frames:Number(v.nb_frames),video:v.codec_name,audio:a.codec_name,audioChannels:a.channels,audioPeakDb:peak,sizeBytes:fs.statSync(file).size,sha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'),fullDecode:'passed',isolatedBravePlaybackAndSeek:'passed',visualReviewFrames:[1.5,8.9,12.6,18.15,21.7,24.1]};
  fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
