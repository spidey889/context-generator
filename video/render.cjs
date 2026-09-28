// Deterministic browser frames keep export and storyboard previews identical.
// Brave uses its own automation profile; the owner's browser stays untouched.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process'),{createRequire}=require('node:module');
const deps=process.env.CAP_VIDEO_NODE_MODULES||'C:/Users/vinit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
let playwright;
try {playwright=require('playwright');} catch {playwright=createRequire(path.join(deps,'_video.cjs'))('playwright');}
const {chromium}=playwright;
const root=path.resolve(__dirname,'..'),duration=27,fps=30;
const server=http.createServer((req,res)=>{const f=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!f.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{const ext=path.extname(f);res.setHeader('Content-Type',{'.html':'text/html','.png':'image/png','.woff2':'font/woff2'}[ext]||'application/octet-stream');res.end(fs.readFileSync(f));}catch{res.writeHead(404).end();}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.BRAVE_PATH||'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,args:['--new-window','--disable-gpu']});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/video/film.html`);await page.evaluate(()=>window.ready);
  // Missing local art should fail the export, rather than produce broken frames.
  const bad=await page.evaluate(()=>[...document.images].filter(i=>!i.naturalWidth).map(i=>i.src));if(bad.length)throw new Error('Missing images: '+bad.join(', '));
  const output=path.join(__dirname,'output');fs.mkdirSync(output,{recursive:true});
  if(process.argv.includes('--preview')){
   for(const t of [1.5,4.8,8.7,11.0,12.6,14.05,15.8,18.2,19.4,21.65,24.1]){await page.evaluate(t=>setTime(t),t);await page.screenshot({path:path.join(output,`frame-${t}.png`)});}
   console.log('Storyboard previews ready.');
  }else{
   const target=path.join(output,'cap-context-launch.mp4');
   const ff=spawn(process.env.FFMPEG_PATH||'ffmpeg',['-y','-hide_banner','-loglevel','warning','-f','image2pipe','-vcodec','png','-framerate',String(fps),'-i','pipe:0','-i',path.join(output,'score.wav'),'-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-ar','48000','-t',String(duration),'-movflags','+faststart',target],{stdio:['pipe','inherit','inherit']});
   const complete=new Promise((resolve,reject)=>{ff.on('error',reject);ff.on('close',c=>c===0?resolve():reject(new Error('ffmpeg exit '+c)));});
   for(let i=0;i<duration*fps;i++){
    await page.evaluate(t=>setTime(t),i/fps);const frame=await page.screenshot({type:'png'});
    if(!ff.stdin.write(frame))await new Promise(r=>ff.stdin.once('drain',r));
    if(i%150===0)console.log(`Rendering ${i}/${duration*fps} frames`);
   }
   ff.stdin.end();await complete;console.log('Rendered '+target);
  }
  if(errors.length)throw new Error(errors.join('\n'));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
