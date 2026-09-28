// 60 fps export with deterministic camera/cursor motion. JPEG 98 frame transport
// avoids the slow PNG compression of V1; final delivery remains high quality H.264.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process'),{createRequire}=require('node:module');
let pw;try{pw=require('playwright')}catch{pw=createRequire(path.join(process.env.CAP_VIDEO_NODE_MODULES||'C:/Users/vinit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules','_video.cjs'))('playwright')}
const root=path.resolve(__dirname,'../..'),output=path.join(__dirname,'output'),duration=29.5,fps=60;
fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{const f=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!f.startsWith(root+path.sep)){res.writeHead(403).end();return}try{res.setHeader('Content-Type',{'.html':'text/html','.png':'image/png','.woff2':'font/woff2'}[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f))}catch{res.writeHead(404).end()}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await pw.chromium.launch({executablePath:process.env.BRAVE_PATH||'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,args:['--new-window','--disable-gpu']});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/video/v2/film.html`);await page.evaluate(()=>window.ready);
  const bad=await page.evaluate(()=>[...document.images].filter(i=>!i.naturalWidth).map(i=>i.src));if(bad.length)throw Error('Missing art: '+bad.join(', '));
  if(process.argv.includes('--preview')){
   for(const t of [1.3,2.65,4.5,6.3,7.5,8.95,10.75,12.0,14.85,16.6,18.1,19.8,21.5,23.7,27.0]){await page.evaluate(t=>setTime(t),t);await page.screenshot({path:path.join(output,`frame-${t}.png`)})}
   console.log('V2 storyboard ready.');
  }else{
   const target=path.join(output,'cap-context-launch-v2.mp4');
   // JPEG transport is full-range BT.601. Convert the samples, not just tags,
   // to limited-range BT.709 so Chromium and native players agree on colors.
   const ff=spawn(process.env.FFMPEG_PATH||'ffmpeg',['-y','-hide_banner','-loglevel','warning','-f','image2pipe','-vcodec','mjpeg','-framerate',String(fps),'-i','pipe:0','-i',path.join(output,'score.wav'),'-vf','scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p','-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p','-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-c:a','aac','-b:a','192k','-ar','48000','-t',String(duration),'-movflags','+faststart',target],{stdio:['pipe','ignore','pipe']});
   let log='';ff.stderr.on('data',d=>log+=d);ff.stdin.on('error',()=>{});
   const completion=new Promise((resolve,reject)=>{ff.on('error',reject);ff.on('close',c=>c===0?resolve():reject(Error('Encoder exit '+c+': '+log.slice(-1500))))});
   const started=Date.now();
   for(let i=0;i<duration*fps;i++){
    await page.evaluate(t=>setTime(t),i/fps);const frame=await page.screenshot({type:'jpeg',quality:98});
    if(!ff.stdin.write(frame))await new Promise(r=>ff.stdin.once('drain',r));
    if(i%240===0)console.log(`V2 ${i}/${duration*fps} frames; ${Math.round((Date.now()-started)/1000)}s elapsed`);
   }
   ff.stdin.end();await completion;console.log('Rendered '+target);
  }
  if(errors.length)throw Error(errors.join('\n'));
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
