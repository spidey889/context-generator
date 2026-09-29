// Export production DOM/CSS, not a painted approximation. Host and messaging
// boundaries are local fixtures; the product's UI constructors/handlers run.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const {chromium}=createRequire('C:/Users/vinit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/_cap-film.cjs')('playwright');
const root=path.resolve(__dirname,'../..'),out=path.join(__dirname,'native');fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<body style="margin:0;background:#faf9f5"></body>');return;}
 const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',{'.woff2':'font/woff2','.png':'image/png'}[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,args:['--new-window','--disable-gpu']});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:900},deviceScaleFactor:2});await page.goto(base);
  await page.evaluate(base=>{
   window.chrome={runtime:{getURL:p=>base+'/extension/'+p,onMessage:{addListener(){},removeListener(){}},sendMessage:()=>Promise.resolve({ok:true})},storage:{local:{get:()=>Promise.resolve({}),set:()=>Promise.resolve()}}};
   window.__CONTEXT_GENERATOR_TEST_HOOKS__={register:hooks=>window.ui=hooks};
  },base);
  const production=fs.readFileSync(path.join(root,'extension/platform-content.js'),'utf8');
  const replacements=[
   ['const currentPlatform = getCurrentPlatform();','const currentPlatform = { ...PLATFORMS.claude, id: "claude" };'],
   ['scrapeConversationText,','ensureDestinationSheet, createFloatingButton, showOverlay, setHandoffProgress, scrapeConversationText,'],
   ['startDestinationTransfer(option.id);','window.__videoSelection = option.id;']
  ];
  let source=production;for(const [from,to] of replacements){if(!source.includes(from))throw Error('Fixture entry point missing: '+from);source=source.replace(from,to);}
  await page.addScriptTag({content:source});
  await page.evaluate(()=>{const el=ui.ensureDestinationSheet();Object.assign(el.style,{display:'block',opacity:'1',transform:'none',left:'470px',top:'250px'});el.setAttribute('aria-hidden','false');});
  await page.evaluate(()=>document.fonts.ready);
  const data={components:{},sizes:{}};
  async function save(name,selector){
   const el=page.locator(selector);await page.waitForTimeout(380);
   data.components[name]=await el.evaluate(e=>e.outerHTML);
   data.sizes[name]=await el.boundingBox();
   await el.screenshot({path:path.join(out,name+'.png'),omitBackground:true});
  }
  await save('picker','#context-generator-destination-sheet');
  const tile=page.getByRole('button',{name:'Continue in ChatGPT',exact:true});await tile.hover();
  await save('pickerHover','#context-generator-destination-sheet');
  const box=await tile.boundingBox(),pickerBox=data.sizes.picker;
  data.chatgptTarget={x:box.x-pickerBox.x+box.width/2,y:box.y-pickerBox.y+box.height/2,width:box.width,height:box.height};
  await tile.click();await save('pickerSelected','#context-generator-destination-sheet');
  if(await page.evaluate(()=>window.__videoSelection)!=='chatgpt')throw Error('Real selection handler failed');
  await page.evaluate(()=>{document.getElementById('context-generator-destination-sheet').style.display='none';const el=ui.createFloatingButton();document.body.appendChild(el);Object.assign(el.style,{display:'flex',left:'100px',top:'100px',opacity:'1'});});
  await save('orb','#context-generator-bubble');
  await page.evaluate(()=>{ui.showOverlay('chatgpt');document.getElementById('context-generator-handoff-scrim').style.display='none';document.getElementById('context-generator-bubble').style.display='none';Object.assign(document.getElementById('context-generator-overlay').style,{opacity:'1',transform:'translate(-50%,-50%)'});document.getElementById('context-generator-handoff-countdown').style.display='none';});
  for(const [name,stage,phase] of [['capture','capture','active'],['summary','summary','active'],['paste','paste','active'],['done','paste','done']]){
   await page.evaluate(({stage,phase})=>ui.setHandoffProgress(stage,phase,'ChatGPT'),{stage,phase});await save(name,'#context-generator-overlay');
  }
  data.styles=await page.evaluate(()=>[...document.querySelectorAll('style')].map(e=>e.textContent).join('\n'));
  data.provenance={source:'extension/platform-content.js',sha256:crypto.createHash('sha256').update(production).digest('hex'),commit:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),capturedAt:new Date().toISOString(),browser:'New isolated Brave process',method:'Actual constructors, hover and selection handlers; DOM and CSS exported for deterministic animation',fixtureBoundaries:replacements.map(r=>r[0]),editorialOmissions:['Estimated countdown omitted because the film condenses network transfer time'],selectionHandlerVerified:true};
  // Relative URLs keep the captured markup useful after the fixture server exits.
  const json=JSON.stringify(data,null,2).split(base+'/extension/').join('../../extension/');
  fs.writeFileSync(path.join(out,'ui.json'),json);console.log(JSON.stringify({sizes:data.sizes,chatgptTarget:data.chatgptTarget,provenance:data.provenance},null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
