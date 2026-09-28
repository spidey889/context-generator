const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{execFileSync,spawnSync}=require('node:child_process'),{createRequire}=require('node:module');
let pw;try{pw=require('playwright')}catch{pw=createRequire(path.join(process.env.CAP_VIDEO_NODE_MODULES||'C:/Users/vinit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules','_video.cjs'))('playwright')}
const file=path.join(__dirname,'output/cap-context-launch-v2.mp4'),ff=process.env.FFMPEG_PATH||'ffmpeg';
const metadata=JSON.parse(execFileSync(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));
const v=metadata.streams.find(s=>s.codec_type==='video'),a=metadata.streams.find(s=>s.codec_type==='audio');
if(v?.width!==1920||v?.height!==1080||v?.r_frame_rate!=='60/1'||Number(v?.nb_frames)!==1770||v?.codec_name!=='h264'||v?.pix_fmt!=='yuv420p'||v?.color_range!=='tv'||v?.color_space!=='bt709'||a?.codec_name!=='aac'||a?.channels!==2||Math.abs(Number(metadata.format.duration)-29.5)>.05)throw Error('Wrong V2 export format/color range');
// Strict full decoding catches damaged packets beyond the seeked sample frames.
execFileSync(ff,['-v','error','-xerror','-i',file,'-f','null','-'],{stdio:['ignore','pipe','pipe']});
const levels=spawnSync(ff,['-hide_banner','-i',file,'-af','volumedetect','-f','null','-'],{encoding:'utf8',maxBuffer:10*1024*1024});
const peak=Number(levels.stderr.match(/max_volume: ([-\d.]+) dB/)?.[1]);if(levels.status!==0||!Number.isFinite(peak)||peak>=0)throw Error('Missing/clipped audio');
const server=http.createServer((req,res)=>{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<body style="margin:0;background:#f8f7f4"><video muted playsinline preload="auto" style="width:1920px;height:1080px" src="/film.mp4"></video>');return}
 if(req.url!='/film.mp4'){res.writeHead(404).end();return}
 const size=fs.statSync(file).size,range=req.headers.range;
 if(range){const m=range.match(/bytes=(\d+)-(\d*)/),start=Number(m[1]),end=m[2]?Math.min(Number(m[2]),size-1):size-1;res.writeHead(206,{'Content-Type':'video/mp4','Content-Range':`bytes ${start}-${end}/${size}`,'Accept-Ranges':'bytes','Content-Length':end-start+1});fs.createReadStream(file,{start,end}).pipe(res)}
 else{res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':size,'Accept-Ranges':'bytes'});fs.createReadStream(file).pipe(res)}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await pw.chromium.launch({executablePath:process.env.BRAVE_PATH||'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,args:['--new-window','--disable-gpu']});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}});await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
  await page.evaluate(()=>document.querySelector('video').play());await page.waitForFunction(()=>document.querySelector('video').currentTime>.25);await page.evaluate(()=>document.querySelector('video').pause());
  const samples=[1.8,4.5,6.7,8.95,12,14.9,16.7,18.9,20.6,21.9,24.3,27.5];
  const colorSamples=[];
  for(const t of samples){
   await page.evaluate(t=>new Promise((resolve,reject)=>{const e=document.querySelector('video');e.addEventListener('seeked',resolve,{once:true});e.addEventListener('error',()=>reject(Error('Video decode error')),{once:true});e.currentTime=t}),t);await page.screenshot({path:path.join(__dirname,'output',`export-${t}.png`)});
   if(t===12||t===27.5){
    // Decode through the browser, not FFmpeg alone: conflicting range metadata
    // previously passed decoding while washing out the warm canvas in Chromium.
    const rgb=await page.evaluate(()=>{const e=document.querySelector('video'),canvas=document.createElement('canvas');canvas.width=e.videoWidth;canvas.height=e.videoHeight;const ctx=canvas.getContext('2d');ctx.drawImage(e,0,0);return[...ctx.getImageData(10,10,1,1).data].slice(0,3)});
    // Source screenshot colors: the 12s paper includes the modal scrim.
    const expected=t===12?[246,245,243]:[234,228,216];
    // Six levels (~2.4%) allow JPEG/H.264 quantization and browser color
    // conversion. The earlier range mismatch shifted these flats by 9–20.
    const tolerance=6;
    if(rgb.some((value,i)=>Math.abs(value-expected[i])>tolerance))throw Error('Browser color mismatch at '+t+': '+rgb.join(','));
    colorSamples.push({seconds:t,expectedRgb:expected,browserDecodedRgb:rgb,toleranceRgbLevels:tolerance});
   }
  }
  // Play the whole delivered timeline, beyond seek-only decoder checks.
  await page.evaluate(async()=>{const e=document.querySelector('video');e.currentTime=0;await e.play()});
  await page.waitForFunction(()=>document.querySelector('video').ended,{},{timeout:45000});
  const playback=await page.evaluate(()=>{const e=document.querySelector('video'),q=e.getVideoPlaybackQuality();return{ended:e.ended,currentTime:e.currentTime,totalVideoFrames:q.totalVideoFrames,droppedVideoFrames:q.droppedVideoFrames,error:e.error?.message||null}});
  if(playback.error||Math.abs(playback.currentTime-29.5)>.05)throw Error('Incomplete full playback');
  const report={edition:'polished V2',deliveryFile:'video/cap-context-launch-v2-polished.mp4',durationSeconds:Number(metadata.format.duration),width:v.width,height:v.height,fps:60,frames:Number(v.nb_frames),video:v.codec_name,pixelFormat:v.pix_fmt,colorRange:v.color_range,colorSpace:v.color_space,browserColorSamples:colorSamples,audio:a.codec_name,audioChannels:a.channels,audioPeakDb:peak,sizeBytes:fs.statSync(file).size,sha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'),compositionSha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname,'film.html'))).digest('hex'),fullDecode:'passed',isolatedBravePlaybackAndSeeking:'passed',fullBravePlaybackToEnd:playback,sampleFrames:samples};
  fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
