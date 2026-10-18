// Comparable full-20-car render throughput on a specified checkout. Uses the production frame/physics/render path.
// Headless software rendering is deliberately identified in the output; these are not consumer-GPU FPS claims.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { serveGame } = require('./browser-game.cjs');
const root = path.resolve(process.env.BENCH_ROOT || path.join(__dirname, '..'));
const out = path.resolve(process.env.BENCH_OUT || '/tmp/apexra-environment-benchmark');
const ids = (process.env.CIRCUITS || 'monza,silverstone,spa,suzuka,bahrain,interlagos').split(',');
const samples = Number(process.env.BENCH_FRAMES || 32), width = 640, height = 360;
fs.mkdirSync(out, { recursive: true });
const probe = `window.__environmentBench = {
  setup(id, rain) {
    loadCircuit(id); G.attract = true;
    startSession({ type: 'race', entries: SIM.DRIVERS.map(driver => ({ driver })), seed: 741, difficulty: 1,
      weather: 'dynamic', weatherState: Object.assign(new SIM.DynamicWeather(741).snapshot(), {
      pattern: rain ? 'wet' : 'dry', rain: rain ? 0.8 : 0, water: rain ? 0.7 : 0, lineWater: rain ? 0.6 : 0,
      cloud: rain ? 0.9 : 0.1, targetRain: rain ? 0.8 : 0, targetCloud: rain ? 0.9 : 0.1, patternEnds: 1e9, regimeEnds: 1e9 }) });
    const s = G.session; s.lightsOut = true; s.lightsOutTime = 0; s.time = 30;
    G.attract = false; G.mode = 'race'; G.director = false; G.fixedRes = true; G.resScale = 1;
    renderer.setPixelRatio(1); onResize(); document.getElementById('menu').classList.add('hidden');
    document.getElementById('hud').classList.add('hidden'); G.audio.update = () => {};
    G.focus = s.cars[10]; G.camRig.mode = 'chase'; this.clock = performance.now(); this.pixel = new Uint8Array(4);
    this.regions = [Math.round(G.track.N * 0.25), Math.round(G.track.N * 0.55),
      G.track.corners.reduce((a,c)=>c.R<a.R?c:a).apex, G.track.overpass ? Math.round(G.track.overpass.highS / SIM.DS) : Math.round(G.track.N * 0.8)];
    this.pose(0);
  },
  pose(region) {
    const t = G.track, s = G.session, base = this.regions[region] * SIM.DS;
    s.cars.forEach((c,i) => { const dist = base-i*8; c.placeAt(t,dist,i%2?1.8:-1.8,45);c.speed=c.u=45;
      c.totalDist=t.length+dist;c.laps=1;c.crossings=2;c.lastLapBase=Math.floor(c.totalDist/t.length);c.lastWithin=t.wrapS(c.totalDist);
      c.launch.active=false;c.started=true;c.fuel=s.fuelForLaps(5); });
    G.camRig.init=false;
  },
  sample() {
    this.clock += 1000/60; const begin = performance.now(); frame(this.clock); const cpu = performance.now()-begin;
    const gl = renderer.getContext(); gl.finish(); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,this.pixel);
    const info = renderer.info; return { ms:performance.now()-begin, cpuMs:cpu, calls:info.render.calls,
      triangles:info.render.triangles, geometries:info.memory.geometries, textures:info.memory.textures,
      heapBytes:performance.memory ? performance.memory.usedJSHeapSize : null };
  },
  info() { const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {
    renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
    gpuTimerAvailable:!!gl.getExtension('EXT_disjoint_timer_query_webgl2'), cars:G.session.cars.length,
    quality:S.quality, width:renderer.domElement.width,height:renderer.domElement.height,
    forest:G.forest ? G.forest.stats : null }; }
};`;
const percentile=(a,p)=>a.slice().sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor((a.length-1)*p))];
(async()=>{
 const server=await serveGame(root,html=>html.replace('window.APEX = G;', 'window.APEX = G; S.quality = "medium"; S.volume = 0;\n'+probe));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--js-flags=--expose-gc']});
 const report={protocol:{width,height,quality:'medium',samplesPerWeather:samples,seed:741,
  timing:'Synchronized frame throughput (production frame plus WebGL finish and blocking pixel readback); CPU is submission time, not isolated physics time.',
  regions:['forest straight','fast straight','tightest corner','overpass / distant hillside'],gpuFrameTimeMs:null},source:{indexSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex')},results:[]};
 try {
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(180000);
  const errors=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('pageerror',e=>{errors.push(e.message);console.error('pageerror:',e.message)});
  page.on('requestfailed',r=>{if(r.url().includes('three'))console.error('module request failed:',r.url(),r.failure().errorText)});
  await page.addInitScript(()=>{localStorage.setItem('apexgp.settings.v1',JSON.stringify({quality:'medium',camera:'chase',volume:0,circuit:'monza'}));let seed=741;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};window.requestAnimationFrame=()=>1;});
  await page.route('**/*',r=>{
    const url=r.request().url();
    if(url.includes('three.module'))return r.fulfill({contentType:'application/javascript',body:fs.readFileSync(process.env.THREE_JS||'/tmp/apexra-three.module.js')});
    if(url.includes('fonts.googleapis.com'))return r.fulfill({contentType:'text/css',body:''});
    return r.continue();
  });
  console.log('Loading',root);await page.goto(server.url+'/index.html');
  await page.waitForFunction(()=>document.getElementById('loading').classList.contains('hidden') || !document.getElementById('loadErr').classList.contains('hidden'), null, {polling:200});
  console.log('Renderer ready');const loadError=await page.locator('#loadErr').textContent();if(loadError)throw Error(loadError);
  for(const id of ids)for(const rain of [false,true]) {
    console.log('Rendering',id,rain?'rain':'sun');await page.evaluate(({id,rain})=>__environmentBench.setup(id,rain),{id,rain});
    const rows=[];
    for(let region=0;region<4;region++){
      console.log('Region',region);await page.evaluate(region=>__environmentBench.pose(region),region);
      await page.evaluate(()=>{for(let k=0;k<3;k++)__environmentBench.sample();});
      const frames=await page.evaluate(n=>Array.from({length:n},()=>__environmentBench.sample()),Math.ceil(samples/4));
      rows.push(...frames.map(f=>({...f,region})));
      if(!rain && region===0)await page.screenshot({path:path.join(out,id+'-dry.png')});
      if(rain && region===2)await page.screenshot({path:path.join(out,id+'-rain.png')});
    }
    const avg=key=>rows.reduce((n,f)=>n+f[key],0)/rows.length;
    const info=await page.evaluate(()=>__environmentBench.info());
    const result={circuit:id,weather:rain?'rain':'sun',...info,frames:rows.length,
      avgFps:1000/avg('ms'),p95FrameMs:percentile(rows.map(f=>f.ms),.95),p99FrameMs:percentile(rows.map(f=>f.ms),.99),
      cpuFrameMs:avg('cpuMs'),drawCalls:avg('calls'),triangles:avg('triangles'),geometries:Math.max(...rows.map(f=>f.geometries)),
      textures:Math.max(...rows.map(f=>f.textures)),heapMB:Math.max(...rows.map(f=>f.heapBytes||0))/1048576,
      regions:[0,1,2,3].map(region=>{const a=rows.filter(f=>f.region===region);return{region,avgFps:1000/(a.reduce((n,f)=>n+f.ms,0)/a.length),p95FrameMs:percentile(a.map(f=>f.ms),.95)}})};
    report.results.push(result);fs.writeFileSync(path.join(out,'metrics.json'),JSON.stringify({...report,errors},null,2));
    console.log(id, result.weather, result.avgFps.toFixed(2)+' FPS',result.p95FrameMs.toFixed(1)+' ms p95',Math.round(result.drawCalls)+' calls');
  }
  if(errors.length)throw Error(errors.join('\n'));
 } finally {await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
