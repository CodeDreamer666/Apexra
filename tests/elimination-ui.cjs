// Run: THREE_JS=/path/to/three.module.min.js node tests/elimination-ui.cjs
// Uses the existing Playwright test dependency; no runtime dependency is added.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..'),THREE_JS=process.env.THREE_JS,OUT=process.env.ELIM_UI_OUTPUT||path.resolve(ROOT,'../work/elimination-ui');
assert.ok(THREE_JS&&fs.existsSync(THREE_JS),'Set THREE_JS to the existing Three.js 0.160.0 module for this offline browser test.');fs.mkdirSync(OUT,{recursive:true});
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message);});
 page.setDefaultTimeout(180000);await page.addInitScript(()=>{localStorage.setItem('apexgp.settings.v1',JSON.stringify({quality:'low',camera:'chase',quali:'off',volume:0,engineerVoice:'off'}));const native=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>{if(/\bframe\(/.test(String(cb))){window.__frame=cb;return 1;}return native(cb);};});
 await page.route(/https:.*three.*\.js$/,route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(THREE_JS),headers:{'access-control-allow-origin':'*'}}));
 let html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');html=html.replace(/https:\/\/cdn.jsdelivr.net\/npm\/three@0.160.0\/build\/three.module.js/g,'/three.js').replace(/<link[^>]+fonts.googleapis.com[^>]*>/g,'');const at=html.lastIndexOf('</script>');html=html.slice(0,at)+'window.__test={hideAllOverlays,startSession,sessionConfig,buildEntries,updateHud,processEvents,showResults,updatePitService,startRace,exitToMenu,S};\n'+html.slice(at);
 await page.route('**/index.html',r=>r.fulfill({contentType:'text/html',body:html}));
 const server=require('http').createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/three.js'?'application/javascript':'text/html');res.end(req.url==='/three.js'?fs.readFileSync(THREE_JS):html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));browser.on('disconnected',()=>server.close());await page.goto('http://127.0.0.1:'+server.address().port+'/index.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__test&&document.getElementById('loading').classList.contains('hidden'),null,{timeout:180000,polling:200});
 await page.locator('[data-mode="elimination"]').click();
 for(const variant of ['classic','chaos','ruthless']){
  await page.locator('[data-variant="'+variant+'"]').click();assert.equal(await page.locator('[data-variant="'+variant+'"]').getAttribute('aria-pressed'),'true');
  assert.ok((await page.locator('#variantRules').innerText()).includes(variant==='ruthless'?'Lap 7':'Lap 8'));
 }
 await page.screenshot({path:path.join(OUT,'menu.png')});
 for(const variant of ['classic','chaos','ruthless']){
  await page.evaluate(v=>{const T=__test;T.hideAllOverlays();T.S.eliminationVariant=v;T.S.gameMode='elimination';T.startRace(null,T.buildEntries());},variant);
  assert.equal(await page.locator('#briefChoices button').count(),4);assert.ok((await page.locator('#briefModeNote').innerText()).includes(variant[0].toUpperCase()+variant.slice(1)));
  await page.locator('#briefStart').click();
  await page.evaluate(()=>{APEX.session.lightsOut=true;__test.updateHud(.1);});
  const initial=await page.locator('#eliminationHud').innerText();assert.ok(initial.includes(variant.toUpperCase()));assert.ok(initial.includes(variant==='ruthless'?'/ 7':'/ 8'));
  if(variant!=='classic')assert.ok(initial.includes('Unknown'));assert.notEqual(await page.locator('#posNow').innerText(),'TT');
  await page.evaluate(()=>{const S=APEX.session,e=S.elimination.events[0];S.activeOrder[0].totalDist=e.reveal;S.revealEliminations();__test.updateHud(.1);});
  assert.ok((await page.locator('#eliminationHud').innerText()).includes('survive'));
  await page.screenshot({path:path.join(OUT,variant+'-hud.png')});
  // Render a drive-through visit, make a real tyre choice, then render GP service afterward.
  await page.evaluate(()=>{const p=APEX.player;p.pit={phase:'out',station:0,serviced:false};__test.updatePitService(p,APEX.session,true);});
  assert.equal(await page.locator('#psTyres button').count(),5);await page.locator('#psTyres [data-compound="W"]').click();assert.equal(await page.evaluate(()=>APEX.player.boxCompound),'W');assert.equal(await page.locator('#psFuelSection').isVisible(),false);
  await page.evaluate(()=>{const S=APEX.session;APEX.player.pit=null;for(const c of S.cars)if(c!==APEX.player)S.startRetirement(c,'Test retirement');S.refreshEliminationOrder();S.elimination.round=6;const c=APEX.player;c.totalDist=S.totalLaps*S.track.length;c.laps=S.totalLaps;c.finished=true;c.finishOrder=1;c.finishTime=700;S.finishRace();__test.showResults();});
  assert.ok((await page.locator('#resTitle').innerText()).includes(variant.toUpperCase()));assert.doesNotMatch(await page.locator('#results').innerText(),/Average|Lap 15/);
  console.log('PASS browser',variant,'selection, briefing, HUD reveal, service choice, results');
 }
 await page.evaluate(()=>{const T=__test;T.startSession(T.sessionConfig('race',{gameMode:'grandprix',entries:T.buildEntries()}));const p=APEX.player;p.pit={phase:'awaiting',box:0,selection:{tyre:'H',fuel:0},arrivedAt:0,entryTime:0};T.updatePitService(p,APEX.session,true);});
 assert.equal(await page.locator('#psTyres button').count(),5);assert.equal(await page.locator('#psFuelSection').isVisible(),true);assert.equal(await page.locator('#psConfirm').isVisible(),true);
 assert.deepEqual(errors,[]);console.log('PASS browser: GP service restored; no page errors');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
