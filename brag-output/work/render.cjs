const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process'),{createRequire}=require('node:module');
const {chromium}=createRequire(path.join(process.env.CAP_VIDEO_NODE_MODULES||'C:/Users/vinit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules','_brag.cjs'))('playwright');
const root=path.resolve(__dirname,'../..'),out=path.dirname(__dirname),frames=path.join(__dirname,'frames'),fps=60,duration=24;
fs.mkdirSync(frames,{recursive:true});
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',{'.html':'text/html','.png':'image/png','.jpg':'image/jpeg','.json':'application/json','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.BRAVE_PATH||'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,args:['--new-window','--disable-gpu']});
 try{
  const errors=[],url=`http://127.0.0.1:${server.address().port}/brag-output/work/film.html`;
  async function prepare(){const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.evaluate(()=>window.ready);return page;}
  const page=await prepare();
  const samples=[.65,2.15,3.4,4.9,5.6,6.7,7.5,8.5,9.6,10.08,10.8,11.65,12.8,14.7,15.7,16.3,18.7,20.72,21.6,23];
  if(process.argv.includes('--preview')){
   const audit=[];
   for(const t of samples){await page.evaluate(t=>setTime(t),t);await page.screenshot({path:path.join(frames,`scene-${t}.png`)});audit.push(await page.evaluate(()=>({state:window.frameState,missingImages:[...document.images].filter(i=>!i.naturalWidth).map(i=>i.src),pageWidth:document.documentElement.scrollWidth,pageHeight:document.documentElement.scrollHeight})));}
   if(errors.length||audit.some(a=>a.missingImages.length||a.pageWidth!==1920||a.pageHeight!==1080))throw Error('Composition errors: '+JSON.stringify({errors,audit}));
   fs.writeFileSync(path.join(frames,'composition-audit.json'),JSON.stringify(audit,null,2));console.log('20 scene and transition stills ready. No missing art or page overflow.');return;
  }
  await page.evaluate(()=>setTime(23));const poster=await page.screenshot({type:'jpeg',quality:98});fs.writeFileSync(path.join(out,'brag.jpg'),poster);
  const worker=await prepare(),pages=[page,worker],target=path.join(out,'brag.mp4');
  // JPEG frame transport is full-range BT.601. Convert samples to limited-range
  // BT.709; merely setting metadata causes washed-out colors in browser players.
  const ff=spawn(process.env.FFMPEG_PATH||'ffmpeg',['-y','-hide_banner','-loglevel','warning','-f','image2pipe','-vcodec','mjpeg','-framerate',String(fps),'-i','pipe:0','-i',path.join(__dirname,'score.wav'),'-vf','scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p','-c:v','libx264','-preset','medium','-crf','17','-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-c:a','aac','-b:a','192k','-ar','48000','-t',String(duration),'-movflags','+faststart',target],{stdio:['pipe','ignore','pipe']});
  let log='';ff.stderr.on('data',d=>log+=d);ff.stdin.on('error',()=>{});
  const completion=new Promise((resolve,reject)=>{ff.on('error',reject);ff.on('close',code=>code===0?resolve():reject(Error('Encoder exit '+code+': '+log.slice(-2000))));});
  const started=Date.now();
  // Two isolated pages render independently, but bounded batches reach FFmpeg
  // in frame order. Replacing frame zero with the poster preserves audio sync.
  for(let base=0;base<duration*fps;base+=pages.length){
   const batch=await Promise.all(pages.map(async(p,j)=>{const frame=base+j;if(frame>=duration*fps)return null;if(frame===0)return poster;await p.evaluate(t=>setTime(t),frame/fps);return p.screenshot({type:'jpeg',quality:98});}));
   for(const frame of batch){if(frame&&!ff.stdin.write(frame))await new Promise(r=>ff.stdin.once('drain',r));}
   if(base%180===0)console.log(`${base}/${duration*fps} frames; ${Math.round((Date.now()-started)/1000)}s elapsed`);
  }
  ff.stdin.end();await completion;if(errors.length)throw Error(errors.join('\n'));console.log('Rendered '+target);
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
