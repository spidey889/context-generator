// Read-only visual references in a new, anonymous Brave process.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const {chromium}=createRequire('C:/Users/vinit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/_cap-film.cjs')('playwright');
const out=path.join(__dirname,'host-reference');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,args:['--new-window','--disable-gpu']});
 try{
  const results=await Promise.allSettled([['claude','https://claude.ai'],['chatgpt','https://chatgpt.com']].map(async([name,url])=>{
   const page=await browser.newPage({viewport:{width:1440,height:1000}});
   await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
   await page.waitForTimeout(8000);await page.screenshot({path:path.join(out,name+'.png')});
   const state=await page.evaluate(()=>({title:document.title,url:location.href,text:document.body.innerText.slice(0,3000),fonts:[...new Set(performance.getEntriesByType('resource').map(r=>r.name).filter(s=>/woff/.test(s)))],computed:[...document.querySelectorAll('h1,p,textarea,button')].slice(0,20).map(e=>({tag:e.tagName,text:e.textContent.slice(0,80),font:getComputedStyle(e).fontFamily,size:getComputedStyle(e).fontSize}))}));
   fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify(state,null,2));return {name,...state};
  }));console.log(JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
