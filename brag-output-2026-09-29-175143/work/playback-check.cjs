const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{createRequire}=require('node:module');
const {chromium}=createRequire('C:/Users/vinit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/_cap-film.cjs')('playwright');
const file=path.resolve(__dirname,'../brag.mp4'),headed=process.argv.includes('--headed');
const server=http.createServer((req,res)=>{
 if(req.url==='/'){
  res.setHeader('Content-Type','text/html');res.end('<body style="margin:0;background:#e5ded0"><video muted preload="auto" playsinline style="width:100vw;height:100vh" src="/film.mp4"></video>');return;
 }
 if(req.url!=='/film.mp4'){res.writeHead(404).end();return;}
 const size=fs.statSync(file).size,range=req.headers.range,match=range?.match(/^bytes=(\d+)-(\d*)$/);
 if(range&&!match){res.writeHead(416).end();return;}
 const start=match?Number(match[1]):0,end=match?.[2]?Math.min(Number(match[2]),size-1):size-1;
 const headers={'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1};if(match)headers['Content-Range']=`bytes ${start}-${end}/${size}`;
 res.writeHead(match?206:200,headers);
 fs.createReadStream(file,{start,end}).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:!headed,args:['--new-window']});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}});await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
  await page.evaluate(async()=>document.querySelector('video').play());
  await page.waitForFunction(()=>document.querySelector('video').ended,{},{timeout:90000});
  const playback=await page.evaluate(()=>{const v=document.querySelector('video'),q=v.getVideoPlaybackQuality();return{ended:v.ended,currentTime:v.currentTime,totalVideoFrames:q.totalVideoFrames,droppedVideoFrames:q.droppedVideoFrames,error:v.error?.message||null}});
  const report={mode:headed?'separate visible Brave window':'separate headless Brave',playback};
  fs.writeFileSync(path.resolve(__dirname,'../playback-review.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
