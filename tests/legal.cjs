'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname,'..'), dist = path.join(root,'dist');
const checks = [], errors = [], requests = [], failed = [];
const pass = s => { checks.push(s); console.log('PASS '+s); };
const build = args => spawnSync(process.execPath,['tools/build-release.cjs',...args],{cwd:root,encoding:'utf8'});
const headers = Object.fromEntries(require('../vercel.json').headers[0].headers.map(h=>[h.key,h.value]));
const mime = {'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.txt':'text/plain','.ttf':'font/ttf','.png':'image/png','.ico':'image/x-icon'};
(async()=>{
  const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'apexra-release-gate-'));
  fs.mkdirSync(path.join(fixture,'tools'));fs.mkdirSync(path.join(fixture,'legal'));fs.mkdirSync(path.join(fixture,'dist'));
  fs.copyFileSync(path.join(root,'tools/build-release.cjs'),path.join(fixture,'tools/build-release.cjs'));
  fs.copyFileSync(path.join(root,'legal/release.json'),path.join(fixture,'legal/release.json'));
  // An intentionally incomplete isolated fixture also works after real release metadata is completed.
  const incomplete=JSON.parse(fs.readFileSync(path.join(fixture,'legal/release.json'),'utf8'));incomplete.copyrightOwner='[REQUIRED]';
  fs.writeFileSync(path.join(fixture,'legal/release.json'),JSON.stringify(incomplete));
  fs.symlinkSync(path.join(root,'node_modules'),path.join(fixture,'node_modules'),'dir');
  const blocked=spawnSync(process.execPath,['tools/build-release.cjs'],{cwd:fixture,encoding:'utf8'});
  assert.equal(blocked.status,1);assert.match(blocked.stderr,/Release blocked/);assert.equal(fs.existsSync(path.join(fixture,'dist')),false);
  fs.rmSync(fixture,{recursive:true,force:true});
  pass('strict reviewed-release build refuses unresolved legal details and removes stale output');
  const prerelease=process.argv.includes('--prerelease');
  const draft = build([prerelease?'--prerelease':'--draft']); assert.equal(draft.status,0,draft.stderr);
  if(prerelease){
    for(const page of ['privacy.html','terms.html','credits.html']){
      const body=fs.readFileSync(path.join(dist,page),'utf8');assert.ok(!/\{\{|\}\}|\[.*REQUIRED\]/.test(body));
      assert.doesNotMatch(body,/pre-release|legal review|developer review|required.*review|must be confirmed/i);
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dist,'release-status.json'),'utf8')),{stage:'release'});
    pass('public pages omit review notices and placeholders without asserting legal approval');
  }
  assert.ok(!fs.existsSync(path.join(dist,'tools')) && !fs.existsSync(path.join(dist,'docs')) && !fs.existsSync(path.join(dist,'.git')));
  for(const p of ['sim.js','game.js']) assert.ok(!/sourceMappingURL|window\.__game|window\.APEX\s*=/.test(fs.readFileSync(path.join(dist,p),'utf8')));
  const source = fs.readFileSync(path.join(root,'index.html'),'utf8');
  const sim = source.match(/<script>([\s\S]*?)<\/script>/)[1];
  const box={module:{exports:{}}};vm.runInNewContext(sim,box);const save=JSON.parse(JSON.stringify(box.module.exports.PROGRESS.create()));
  const data=JSON.parse(source.match(/const CIRCUIT_DATA = (.*);/)[1]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dist,'data/circuit-data.json'),'utf8')),data);
  pass('allowlisted build excludes internals, strips debug accessors/maps and preserves the embedded dataset');
  const server=http.createServer((req,res)=>{
    let p;try{p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end();return;}
    const file=path.resolve(dist,'.'+(p==='/'?'/index.html':p));
    if(!file.startsWith(dist+path.sep)){res.writeHead(403);res.end();return;}
    try{const body=fs.readFileSync(file);res.writeHead(200,{...headers,'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);}catch{res.writeHead(404);res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:800}});
    // Render the initial WebGL frame, then stop only the game's self-scheduling frame callback.
    // Other animation callbacks (circuit layout and browser UI checks) still run normally.
    // The earlier full-animation check is recorded separately; this verifies launch/state, not driving performance.
    await context.addInitScript(()=>{
      if(location.pathname==='/'||location.pathname.endsWith('/index.html')) {
        const nativeFrame=window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame=callback=> /^function\s+[\w$]+\([^)]*\)\s*\{\s*requestAnimationFrame\(/.test(Function.prototype.toString.call(callback))
          ? 0 : nativeFrame(callback);
      }
    });
    context.on('request',r=>requests.push({url:r.url(),method:r.method()}));
    context.on('requestfailed',r=>failed.push({url:r.url(),error:r.failure()?.errorText}));
    const page=await context.newPage();page.setDefaultTimeout(60000);
    page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message)});page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
    await page.goto(origin+'/privacy.html');
    const keys=['apexgp.settings.v1','apexgp.gfx.v1','apexgp.progress.v4','apexgp.progress.v3','apexgp.career.v1','apexgp.ranked.v1'];
    await page.evaluate(keys=>{for(const k of keys)localStorage.setItem(k,'sentinel-'+k);localStorage.setItem('another-app','keep');},keys);
    const before=await page.evaluate(()=>JSON.stringify({...localStorage}));
    for(const width of [1280,390]){
      await page.setViewportSize({width,height:800});
      for(const name of ['privacy','terms','credits']){
        const r=await page.goto(origin+'/'+name+'.html');assert.equal(r.status(),200);
        assert.ok(await page.locator('h1').isVisible());
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
        assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),before,'reading legal pages preserves all saves');
        const localLinks=await page.locator('a[href]').evaluateAll(as=>as.map(a=>a.href).filter(x=>new URL(x).origin===location.origin && new URL(x).pathname!=='/'));
        for(const url of localLinks)assert.equal((await context.request.get(url)).status(),200,url);
      }
      await page.screenshot({path:'/tmp/apexra-credits-'+width+'.png',fullPage:true});
    }
    pass('Privacy, Terms and Credits render at desktop/mobile widths; legal links/licenses/dataset resolve; saves unchanged');
    await page.goto(origin+'/privacy.html');
    await page.locator('#clear-data').focus();page.once('dialog',d=>d.dismiss());await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),before);
    page.once('dialog',d=>{assert.match(d.message(),/permanently|permanently/i);return d.accept()});await page.locator('#clear-data').click();
    assert.equal(await page.evaluate(keys=>keys.every(k=>localStorage.getItem(k)===null),keys),true);
    assert.equal(await page.evaluate(()=>localStorage.getItem('another-app')),'keep');
    assert.match(await page.locator('#clear-status').textContent(),/have been cleared/);
    // Storage denial must report failure, never claim deletion succeeded.
    await page.evaluate(()=>{Storage.prototype.removeItem=()=>{throw new DOMException('denied','SecurityError')}});
    page.once('dialog',d=>d.accept());await page.locator('#clear-data').click();assert.match(await page.locator('#clear-status').textContent(),/could not be fully cleared/);
    pass('keyboard confirmation cancel preserves saves; confirmed reset clears all six current/legacy keys only; denied storage reports failure');
    await page.goto(origin+'/terms.html');await page.getByRole('link',{name:'Back to the game',exact:true}).focus();
    // Seed a legitimate, inactive Career so opening legal pages cannot forfeit it.
    await page.evaluate(save=>{localStorage.setItem('apexgp.progress.v4',JSON.stringify(save));localStorage.setItem('apexgp.settings.v1',JSON.stringify({resolution:'native',circuit:'monza'}));},save);
    await page.setViewportSize({width:800,height:600});await page.keyboard.press('Enter');
    await page.waitForSelector('#loading.hidden',{state:'attached',timeout:180000});assert.ok(await page.locator('#menu').isVisible());
    const saved=await page.evaluate(()=>localStorage.getItem('apexgp.progress.v4'));assert.deepEqual(JSON.parse(saved),save);
    assert.equal(await page.evaluate(()=>typeof window.__game==='undefined'&&typeof window.APEX==='undefined'),true);
    for(const name of ['Privacy','Terms','Credits']) assert.ok(await page.getByRole('navigation',{name:'Legal information'}).getByRole('link',{name,exact:true}).getAttribute('href'));
    await page.getByRole('navigation',{name:'Legal information'}).getByRole('link',{name:'Privacy',exact:true}).focus();await page.keyboard.press('Enter');
    await page.waitForURL(origin+'/privacy.html');
    assert.equal(await page.evaluate(()=>localStorage.getItem('apexgp.progress.v4')),saved);
    await page.getByRole('link',{name:'Back to the game',exact:true}).click();await page.waitForSelector('#loading.hidden',{state:'attached',timeout:180000});
    pass('real minified WebGL game boots under proposed CSP; menu legal navigation/back works and Career save is intact');
    await page.focus('#menuStart');await page.keyboard.press('Enter');await page.waitForSelector('#menu.selecting');
    await page.focus('#csGo');await page.keyboard.press('Enter');await page.waitForSelector('#raceBrief:not(.hidden)');await page.focus('#briefStart');await page.keyboard.press('Enter');await page.waitForSelector('#hud:not(.hidden)');
    pass('Grand Prix selection, briefing and grid launch work (initial-frame integration test)');
    await page.goto(origin+'/?quality=low');await page.waitForSelector('#loading.hidden',{state:'attached',timeout:180000});
    await page.focus('#btnCareer');await page.keyboard.press('Enter');await page.waitForSelector('#career:not(.hidden)');await page.focus('#crActions .btn.primary');await page.keyboard.press('Enter');await page.waitForSelector('#raceBrief:not(.hidden)');await page.focus('#briefStart');await page.keyboard.press('Enter');
    await page.waitForSelector('#hud:not(.hidden)');
    const started=await page.evaluate(()=>JSON.parse(localStorage.getItem('apexgp.progress.v4')));assert.equal(started.career.active.circuit,'monza');
    pass('Career launches and saves the active attempt in the browser');
    assert.deepEqual(await context.cookies(),[]);assert.equal(await page.evaluate(()=>sessionStorage.length),0);
    assert.deepEqual(await page.evaluate(()=>indexedDB.databases()),[]);assert.deepEqual(await page.evaluate(()=>caches.keys()),[]);
    assert.deepEqual(await page.evaluate(()=>navigator.serviceWorker.getRegistrations().then(x=>x.map(y=>y.scope))),[]);
    assert.ok(requests.every(r=>r.url.startsWith(origin+'/')&&r.method==='GET'),JSON.stringify(requests));assert.deepEqual(failed,[]);assert.deepEqual(errors,[]);
    pass('all runtime requests are same-origin GETs; no cookies, sessionStorage, IndexedDB, Cache Storage, service workers or console errors');
    fs.writeFileSync('/tmp/apexra-legal-test-results.json',JSON.stringify({checks,requests:[...new Map(requests.map(r=>[r.url,r])).values()],failed,errors},null,2)+'\n');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
