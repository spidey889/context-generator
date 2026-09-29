// Fresh, production-owned Claude → ChatGPT controls. Only the local fixture's
// host/runtime boundary and test exports change; no live chat is read or sent.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {createRequire}=require('node:module');
const deps=process.env.CAP_VIDEO_NODE_MODULES||'C:/Users/vinit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=createRequire(path.join(deps,'_brag.cjs'))('playwright');
const root=path.resolve(__dirname,'../..'),out=path.join(__dirname,'assets');
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<body style="margin:0;background:transparent"></body>');return;}
 const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',{'.woff2':'font/woff2','.png':'image/png'}[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:process.env.BRAVE_PATH||'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,args:['--new-window','--disable-gpu']});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:800},deviceScaleFactor:3,reducedMotion:'reduce'});
  await page.goto(base);
  await page.evaluate(base=>{
   window.chrome={runtime:{getURL:p=>base+'/extension/'+p,onMessage:{addListener(){},removeListener(){}},sendMessage:()=>Promise.resolve({ok:true})},storage:{local:{get:()=>Promise.resolve({}),set:()=>Promise.resolve()}}};
   window.__CONTEXT_GENERATOR_TEST_HOOKS__={register:hooks=>window.ui=hooks};
  },base);
  let source=fs.readFileSync(path.join(root,'extension/platform-content.js'),'utf8');
  const host='const currentPlatform = getCurrentPlatform();';
  if(!source.includes(host)||!source.includes('scrapeConversationText,'))throw Error('Production fixture entry points changed');
  source=source.replace(host,'const currentPlatform = { ...PLATFORMS.claude, id: "claude" };');
  source=source.replace('scrapeConversationText,','ensureDestinationSheet, createFloatingButton, showOverlay, setHandoffProgress, scrapeConversationText,');
  await page.addScriptTag({content:source});
  await page.evaluate(()=>{const sheet=ui.ensureDestinationSheet();Object.assign(sheet.style,{display:'block',opacity:'1',transform:'none',left:'400px',top:'200px'});sheet.setAttribute('aria-hidden','false');});
  await page.evaluate(()=>document.fonts.ready);
  const picker=page.locator('#context-generator-destination-sheet'),tile=page.getByRole('button',{name:'Continue in ChatGPT',exact:true});
  await picker.screenshot({path:path.join(out,'picker.png'),omitBackground:true});
  const pr=await picker.boundingBox(),tr=await tile.boundingBox();
  await tile.hover();await page.waitForTimeout(250);
  await picker.screenshot({path:path.join(out,'picker-hover.png'),omitBackground:true});
  const pickerText=await picker.innerText();
  await page.evaluate(()=>{document.getElementById('context-generator-destination-sheet').style.display='none';const orb=ui.createFloatingButton();document.body.appendChild(orb);Object.assign(orb.style,{display:'flex',left:'100px',top:'100px'});});
  await page.locator('#context-generator-bubble').screenshot({path:path.join(out,'orb.png'),omitBackground:true});
  await page.evaluate(()=>{ui.showOverlay('chatgpt');document.getElementById('context-generator-handoff-scrim').style.display='none';document.getElementById('context-generator-bubble').style.display='none';document.getElementById('context-generator-overlay').style.opacity='1';document.getElementById('context-generator-handoff-countdown').style.display='none';});
  for(const [name,stage,phase] of [['capture','capture','active'],['summary','summary','active'],['paste','paste','active'],['done','paste','done']]){
   await page.evaluate(({stage,phase})=>ui.setHandoffProgress(stage,phase,'ChatGPT'),{stage,phase});
   await page.locator('#context-generator-overlay').screenshot({path:path.join(out,name+'.png'),omitBackground:true});
  }
  const production=fs.readFileSync(path.join(root,'extension/platform-content.js'));
  fs.writeFileSync(path.join(out,'provenance.json'),JSON.stringify({source:'extension/platform-content.js',sourceCommit:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceSha256:require('node:crypto').createHash('sha256').update(production).digest('hex'),sourcePlatform:'claude',destinationPlatform:'chatgpt',browser:'Isolated Brave',fixture:'Local runtime stub; production UI functions, controls, styles and fonts',editorialOmissions:['Estimated countdown hidden because transfer timing is condensed'],pickerText,picker:{width:pr.width,height:pr.height,targetCenter:{x:tr.x-pr.x+tr.width/2,y:tr.y-pr.y+tr.height/2}}},null,2));
  console.log('Captured real Claude-source picker, ChatGPT hover, orb, and ChatGPT handoff stages.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
