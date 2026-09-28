// Render production-owned controls in a local fixture. Never touch live chats or
// send conversation data: only the runtime boundary and current host are mocked.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {createRequire} = require('node:module');
const deps = process.env.CAP_VIDEO_NODE_MODULES || 'C:/Users/vinit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
let playwright;
try {playwright=require('playwright');} catch {playwright=createRequire(path.join(deps, '_video.cjs'))('playwright');}
const {chromium}=playwright;
const root = path.resolve(__dirname, '..');
const v2Capture=process.argv.includes('--v2');
const out = path.join(__dirname, v2Capture?'v2/assets':'assets');
fs.mkdirSync(out, {recursive:true});
const server = http.createServer((req,res)=>{
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root + path.sep)) {res.writeHead(403).end();return;}
  if (req.url === '/') {res.setHeader('Content-Type','text/html');res.end('<html><body style="margin:0;background:transparent"></body></html>');return;}
  try {res.setHeader('Content-Type', file.endsWith('.woff2')?'font/woff2':file.endsWith('.png')?'image/png':'text/plain');res.end(fs.readFileSync(file));} catch {res.writeHead(404).end();}
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({executablePath:process.env.BRAVE_PATH || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,args:['--new-window','--disable-gpu']});
  try {
    const page = await browser.newPage({viewport:{width:1200,height:800},deviceScaleFactor:3,reducedMotion:'reduce'});
    await page.goto(url);
    await page.evaluate(base=>{
      window.chrome = {runtime:{getURL:p=>base+'/extension/'+p,onMessage:{addListener(){},removeListener(){}},sendMessage(){return Promise.resolve({ok:true});}},storage:{local:{get:()=>Promise.resolve({}),set:()=>Promise.resolve()}}};
      window.__CONTEXT_GENERATOR_TEST_HOOKS__ = {register:h=>window.ui=h};
    },url);
    let source = fs.readFileSync(path.join(root,'extension/platform-content.js'),'utf8');
    source = source.replace('const currentPlatform = getCurrentPlatform();','const currentPlatform = { ...PLATFORMS.chatgpt, id: "chatgpt" };');
    source = source.replace('scrapeConversationText,','ensureDestinationSheet, createFloatingButton, showOverlay, setHandoffProgress, teardownContextGeneratorInstance, scrapeConversationText,');
    await page.addScriptTag({content:source});
    await page.evaluate(()=>{
      const sheet=ui.ensureDestinationSheet();
      Object.assign(sheet.style,{display:'block',opacity:'1',transform:'none',left:'400px',top:'220px'});
      sheet.setAttribute('aria-hidden','false');
    });
    // The production picker builds the fast-capture control in ensureDestinationSheet.
    await page.evaluate(()=>document.fonts.ready);
    await page.locator('#context-generator-destination-sheet').screenshot({path:path.join(out,'picker.png'),omitBackground:true});
    if(v2Capture){
      // Capture the actual production hover treatment, including platform accent,
      // rather than approximating it with an editorial selection outline.
      await page.getByRole('button',{name:'Continue in Claude',exact:true}).hover();
      await page.waitForTimeout(280);
      await page.locator('#context-generator-destination-sheet').screenshot({path:path.join(out,'picker-hover.png'),omitBackground:true});
    }
    const pickerDimensions=await page.locator('#context-generator-destination-sheet').evaluate(e=>({width:e.offsetWidth,height:e.offsetHeight}));
    await page.evaluate(()=>{
      document.getElementById('context-generator-destination-sheet').style.display='none';
      const orb=ui.createFloatingButton(); document.body.appendChild(orb);
      Object.assign(orb.style,{display:'flex',left:'100px',top:'100px'});
    });
    await page.locator('#context-generator-bubble').screenshot({path:path.join(out,'orb.png'),omitBackground:true});
    await page.evaluate(()=>{
      ui.showOverlay('claude');
      document.getElementById('context-generator-handoff-scrim').style.display='none';
      document.getElementById('context-generator-bubble').style.display='none';
      document.getElementById('context-generator-overlay').style.opacity='1';
    });
    for(const [file,stage,phase] of [['capture','capture','active'],['summary','summary','active'],['paste','paste','active'],['done','paste','done']]) {
      await page.evaluate(({stage,phase})=>ui.setHandoffProgress(stage,phase,'Claude'),{stage,phase});
      await page.locator('#context-generator-overlay').screenshot({path:path.join(out,file+'.png'),omitBackground:true});
    }
    const labels=await page.locator('#context-generator-destination-sheet').innerText();
    fs.writeFileSync(path.join(out,'provenance.json'),JSON.stringify({source:'extension/platform-content.js',sourceCommit:require('node:child_process').execSync('git rev-parse HEAD',{cwd:root}).toString().trim(),fixture:'local runtime stub; ChatGPT source; production UI functions and styles',pickerText:labels,dimensions:{picker:pickerDimensions}},null,2));
    console.log('Captured production picker, orb, and four handoff states in isolated Brave.');
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
