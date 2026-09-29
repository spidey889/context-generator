const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process'),{createRequire}=require('node:module');
const {chromium}=createRequire('C:/Users/vinit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/_cap-film.cjs')('playwright');
const root=path.resolve(__dirname,'../..'),out=path.dirname(__dirname),frames=path.join(__dirname,'frames'),timeline=JSON.parse(fs.readFileSync(path.join(__dirname,'timeline.json')));
fs.mkdirSync(frames,{recursive:true});
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',{'.html':'text/html','.png':'image/png','.jpg':'image/jpeg','.json':'application/json','.woff2':'font/woff2','.wav':'audio/wav'}[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
});
const samples=[.4,1.8,3,5.8,7.6,9.8,10.1,10.85,11.2,11.7,12.2,14.4,15.8,16.8,17.2,17.6,18.3,19.8,20.6,21.8,22.55,22.7,23.4,25.3,25.8,26.5,28.7,29.6,30.8,31.4,31.8,32.45,33.5,34.5,35.9,36.1,36.6,38.5,40.1,40.8,42.7,43.5,44.25,44.6,45.25,45.7,47.8,49.6,52.4,53.5,54.35,54.73,55.2,55.85,57.3,58.75,59.2,60.4];
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,args:['--new-window','--disable-gpu']});
 try{
  const errors=[],url=`http://127.0.0.1:${server.address().port}/${path.basename(out)}/work/film.html`;
  async function prepare(){const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.evaluate(()=>window.ready);return page;}
  const page=await prepare();
  if(process.argv.includes('--motion-study')){
   const groups={
    'claude-send':[9.5,9.75,10,10.25,10.5,10.85,10.95,11.12,11.35],
    'orb-picker':[15.4,15.75,16.1,16.5,17.1,17.25,17.6,17.95,18.3],
    'picker-select':[19.6,19.9,20.2,20.5,20.8,21.8,21.9,22.2,22.5],
    'transfer':[22.65,22.85,23.15,23.35,25.4,25.7,26.1,26.5,28.2],
    'destination':[31.65,31.85,32.05,32.25,32.45,32.85,33,33.2,33.6],
    'context-send':[35.9,36.08,36.2,36.35,36.5,36.75,37,37.5,38],
    'continue':[43.1,43.45,43.8,44.25,44.4,44.75,45.1,45.5,46],
    'work-title':[53.5,54.05,54.2,54.35,54.5,54.7,54.95,55.3,55.8]
   };
   for(const [name,times] of Object.entries(groups))for(let i=0;i<times.length;i++){await page.evaluate(t=>setTime(t),times[i]);await page.screenshot({path:path.join(frames,`motion-${name}-${i}.png`)});}
   fs.writeFileSync(path.join(frames,'motion-groups.json'),JSON.stringify(groups,null,2));console.log('72 dense motion stills ready.');return;
  }
  if(process.argv.includes('--preview')){
   const audit=[];
   for(const t of samples){await page.evaluate(t=>setTime(t),t);await page.screenshot({path:path.join(frames,`scene-${t}.png`)});audit.push(await page.evaluate(()=>({state:window.frameState,missingImages:[...document.images].filter(i=>!i.naturalWidth).map(i=>i.src),pageWidth:document.documentElement.scrollWidth,pageHeight:document.documentElement.scrollHeight})));}
   fs.writeFileSync(path.join(frames,'sample-audit.json'),JSON.stringify(audit,null,2));
   if(errors.length||audit.some(a=>a.missingImages.length||a.pageWidth!==1920||a.pageHeight!==1080))throw Error('Composition error: '+JSON.stringify({errors,bad:audit.filter(a=>a.missingImages.length||a.pageWidth!==1920||a.pageHeight!==1080).map(a=>({time:a.state.time,width:a.pageWidth,height:a.pageHeight}))}));
   const clickAudit=[];
   for(const event of timeline.clicks){await page.evaluate(t=>setTime(t-.001),event.time);const result=await page.evaluate(({target})=>{
    const selectors={'Claude Send':'#claude-send','Cap Context orb':'#context-generator-bubble','Continue in ChatGPT':'[aria-label="Continue in ChatGPT"]','Send carried context':'#gpt-send','Send follow-up':'#gpt-send'};
    const rect=document.querySelector(selectors[target]).getBoundingClientRect(),p=window.frameState.cursor.screen;
    return{tip:p,targetBounds:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},inside:p.x>=rect.x&&p.x<=rect.right&&p.y>=rect.y&&p.y<=rect.bottom,centerError:Math.hypot(p.x-rect.x-rect.width/2,p.y-rect.y-rect.height/2)};
   },event);clickAudit.push({...event,...result});}
   if(clickAudit.some(c=>!c.inside))throw Error('Cursor missed a click: '+JSON.stringify(clickAudit));
   const determinism=[];
   for(const t of [18.3,26.5,35.9,49.6,57.3]){await page.evaluate(t=>setTime(t),t);const first=await page.screenshot({type:'png'});await page.evaluate(()=>setTime(4));await page.evaluate(t=>setTime(t),t);const second=await page.screenshot({type:'png'});determinism.push({time:t,equal:first.equals(second)});if(!first.equals(second)){fs.writeFileSync(path.join(frames,`determinism-${t}-a.png`),first);fs.writeFileSync(path.join(frames,`determinism-${t}-b.png`),second);}}
   if(determinism.some(d=>!d.equal))throw Error('Timeline depends on previously sampled frame: '+JSON.stringify(determinism));
   fs.writeFileSync(path.join(frames,'composition-audit.json'),JSON.stringify({samples:audit,clicks:clickAudit,determinism},null,2));console.log(JSON.stringify({previewFrames:samples.length,clicks:clickAudit,determinism},null,2));return;
  }
  await page.evaluate(t=>setTime(t),timeline.posterTime);const poster=await page.screenshot({type:'jpeg',quality:98});fs.writeFileSync(path.join(out,'brag.jpg'),poster);
  const pages=[page,...await Promise.all([prepare(),prepare()])],target=path.join(out,'brag.mp4');
  // Chromium JPEGs use full-range BT.601. Convert their samples, not only tags,
  // to limited-range BT.709 to preserve the cream and lilac in browser playback.
  const ff=spawn('ffmpeg',['-y','-hide_banner','-loglevel','warning','-f','image2pipe','-vcodec','mjpeg','-framerate',String(timeline.fps),'-i','pipe:0','-i',path.join(__dirname,'audio/score.wav'),'-vf','scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p','-c:v','libx264','-preset','medium','-crf','16','-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-c:a','aac','-b:a','256k','-ar','48000','-t',String(timeline.duration),'-movflags','+faststart',target],{stdio:['pipe','ignore','pipe']});
  let log='';ff.stderr.on('data',d=>log+=d);ff.stdin.on('error',()=>{});const completion=new Promise((resolve,reject)=>{ff.on('error',reject);ff.on('close',code=>code===0?resolve():reject(Error('Encoder exit '+code+': '+log.slice(-2000))))});
  const total=Math.round(timeline.duration*timeline.fps),started=Date.now();
  for(let base=0;base<total;base+=pages.length){
   const batch=await Promise.all(pages.map(async(p,j)=>{const frame=base+j;if(frame>=total)return null;if(frame===0)return poster;await p.evaluate(t=>setTime(t),frame/timeline.fps);return p.screenshot({type:'jpeg',quality:98});}));
   for(const frame of batch)if(frame&&!ff.stdin.write(frame))await new Promise(r=>ff.stdin.once('drain',r));
   if(base%300===0)console.log(`${base}/${total} frames; ${Math.round((Date.now()-started)/1000)}s elapsed`);
  }
  ff.stdin.end();await completion;if(errors.length)throw Error(errors.join('\n'));console.log('Rendered '+target);
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
