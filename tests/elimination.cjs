const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function sim(){const m={exports:{}};new Function('module',html.match(/<script>([\s\S]*?)<\/script>/)[1])(m);return m.exports;}
const SIM=sim();
const tracks=new Map(SIM.CIRCUITS.map(d=>[d.id,new SIM.Track(d)]));
function race(id='summit',extra={}){return new SIM.Session(tracks.get(id),{type:'race',gameMode:'elimination',seed:11,weather:'dry',mistakes:0,mandatory:false,entries:SIM.DRIVERS.map(driver=>({driver})),...extra});}
function crossing(S,c,lap,at){if(lap===12&&c.finalStart==null)c.timedRaceBoundary=11;S.time=at;c.stepDistance=lap*S.track.length-.1;c.totalDist=lap*S.track.length+.1;c.stepS=S.track.wrapS(-.1);c.lastLapBase=lap-1;c.lastWithin=S.track.length-.1;c.crossings=Math.max(1,c.crossings);c.sectorIdx=2;S.timing(c,c.stepS,.01,at);}
function checkpoint(S,lap){S.time=lap*100;for(const c of S.activeOrder){c.stepDistance=c.totalDist=lap*S.track.length+(20-c.gridSlot)*5;c.timedRaceBoundary=lap;c.laps=lap;}S.eliminationRound(lap,1,.01);}
for(const def of SIM.CIRCUITS)test(def.id+': 20 starters, 19→12→4, no state reset across phases',()=>{
 const S=race(def.id);assert.equal(S.cars.length,20);assert.equal(S.totalLaps,15);S.lightsOut=true;
 const c=S.cars[0];c.tyre.wear.fill(.4);c.damage.c[0]=.3;const tyre=c.tyre,damage=c.damage,weather=S.weather,fuel=c.fuel;
 for(let lap=1;lap<=12;lap++){checkpoint(S,lap);assert.equal(S.activeOrder.length,lap<=8?20-lap:12-(lap-8)*2);assert.equal(S.elimination.history.at(-1).removed.length,lap<=8?1:2);const n=S.elimination.history.length;S.eliminationRound(lap,1,.01);assert.equal(S.elimination.history.length,n);}
 assert.equal(S.elimination.phase,3);assert.equal(S.elimination.finalists.length,4);assert.equal(c.tyre,tyre);assert.equal(c.damage,damage);assert.equal(c.weather,undefined);assert.equal(S.weather,weather);assert.equal(c.fuel,fuel);assert.equal(c.tyre.wear[0],.4);assert.equal(c.damage.c[0],.3);assert.equal(S.track.def,tracks.get(def.id).def);assert.equal(tracks.get(def.id).stations,undefined);
});
test('leader crossing does not eliminate; pit users and delayed tail must physically finish checkpoint',()=>{
 const S=race();S.lightsOut=true;const tail=S.cars.at(-1);for(const c of S.cars){c.stepDistance=c.totalDist=S.track.length+100-c.gridSlot;c.timedRaceBoundary=1;}
 tail.timedRaceBoundary=0;tail.stepDistance=tail.totalDist=S.track.length-2;S.eliminationRound(1,1,.01);assert.equal(S.elimination.round,0);assert.equal(S.elimination.out.length,0);
 tail.pit={phase:'stopped',station:0,box:0};tail.timedRaceBoundary=1;tail.stepDistance=tail.totalDist=S.track.length;S.eliminationRound(1,1,.01);assert.equal(S.elimination.round,1);assert.ok(tail.eliminated);assert.equal(tail.pit.phase,'release');
});
test('retirements spend checkpoint slots, never resurrect cars; stalled final competitors retire deterministically',()=>{
 const S=race();S.lightsOut=true;S.startRetirement(S.cars.at(-1),'Damage');checkpoint(S,1);assert.equal(S.activeOrder.length,19);assert.equal(S.elimination.history[0].removed.length,0);
 for(let lap=2;lap<=12;lap++)checkpoint(S,lap);assert.equal(S.activeOrder.length,4);assert.ok(S.cars.at(-1).eliminated);
 const c=S.activeOrder[0];c.progressAnchor=c.totalDist;c.lastProgressAt=0;for(const o of S.activeOrder){o.stepDistance=o.totalDist;o.stepS=o.s;o.lastProgressAt=S.time;}c.lastProgressAt=0;S.eliminationTiming(.01);assert.ok(c.eliminated);assert.equal(c.eliminated.reason,'Unable to make progress');
});
test('own lap-12 crossings start clocks; fourth on road wins after ALL finish; stopped pit time included',()=>{
 const S=race();S.lightsOut=true;for(let lap=1;lap<=12;lap++)checkpoint(S,lap);
 const cars=S.activeOrder.slice();
 for(let i=0;i<4;i++)crossing(S,cars[i],12,1200+i*30);
 for(let lap=13;lap<=15;lap++)for(let i=0;i<4;i++){
  if(i===3&&lap===13)cars[i].pit={phase:'stopped',station:0};
  crossing(S,cars[i],lap,1200+i*30+(lap-12)*(90-i*5));
  if(lap===15&&i<3)assert.equal(S.over,false);
 }
 S.refreshEliminationOrder();S.finishRace();assert.equal(S.winner,cars[3]);assert.deepEqual([...cars[3].finalLaps],[75,75,75]);assert.equal(S.results[0].car,cars[3]);assert.equal(S.finalTiming(cars[3]).average,75);
 const S2=race();const c=S2.cars[0];S2.lightsOut=true;crossing(S2,c,12,100);c.pit={phase:'stopped',station:0};crossing(S2,c,13,230);assert.equal(c.finalLaps[0],130);crossing(S2,c,13,231);assert.equal(c.finalLaps.length,1,'no double counting a recrossing');
});
test('ties use sorted final laps, then grid slot; existing compound penalties affect total once',()=>{
 const S=race(),[a,b]=S.cars;for(const c of [a,b])c.finished=true;
 a.finalLaps=[80,100,90];b.finalLaps=[85,90,95];assert.ok(S.compareFinal(a,b)<0);
 a.finalLaps=[80,80,110];b.finalLaps=[80,90,100];assert.ok(S.compareFinal(a,b)<0);
 b.finalLaps=[110,80,80];assert.ok(S.compareFinal(a,b)<0);
 a.penalty=30;assert.ok(S.compareFinal(a,b)>0);
});
test('no compulsory compound; Elimination counts a compound only once driven on; the four lifespans',()=>{
 const S=race('summit',{mandatory:true}),c=S.cars[0];assert.equal(SIM.needsCompound,undefined,'no two-compound rule, whatever the config says');
 S.fitTyres(c,'S',80);assert.equal(c.tyre.used.has('S'),false,'fitting alone does not credit use');
 assert.deepEqual(Object.values(SIM.COMPOUNDS).map(c=>c.id+c.life),['S2','H4','I2','W4']);
});
test('distributed geometry is connected, separated, bounded and never changes GP / Career pits',()=>{
 for(const def of SIM.CIRCUITS){const S=race(def.id),t=S.track;assert.equal(t.stations.length,4);const fake={pit:{station:0},offN:4,s:t.stations[0].entry0,d:-t.stations[0].side*20,idx:0};assert.equal(S.legalProgress(fake,5,0,0),0,'off-route pit state grants no shortcut credit');
  for(const p of t.stations){assert.equal(p.boxes.length,1);assert.ok(p.len<tracks.get(def.id).pit.len);for(let q=0;q<p.len;q+=5){const s=t.wrapS(p.entry0+q),d=t.pitTargetD(s,p.boxes[0]),i=t.wrapI(Math.round(s/SIM.DS));assert.equal(t.pitAt(s).id,p.id);assert.equal(t.surfaceAt(i,d,true),0,def.id+' station '+p.id+' q '+q);const w=t.walls(i,s,true,{innerPit:0});assert.ok(Math.abs(d)<(p.side>0?w.r:w.l));if(w.innerPit)assert.ok(Math.abs(d)>w.innerPit);assert.ok(S.legalProgress({pit:{station:p.id},offN:4,s,d},5,0,0)===5);}
  }
  const gp=new SIM.Session(tracks.get(def.id),{type:'race',gameMode:'grandprix',entries:SIM.DRIVERS.map(driver=>({driver})),seed:3});assert.equal(gp.totalLaps,6);assert.equal(gp.track.stations,undefined);assert.equal(gp.track.pit.boxes.length,4);
 }
});
test('each station independently assigns in physical arrival order and never transfers queues',()=>{
 const S=race(),c=S.cars;
 function arrive(c,k,at,q=1){c.pit={station:k,phase:'queue',box:null,entryTime:at};S.pitArrivals.push({car:c,t:at,q});}
 arrive(c[5],0,10);arrive(c[2],0,11);arrive(c[1],1,10);arrive(c[0],0,11,2);S.allocatePitBoxes();assert.equal(S.pitBoxes[0],c[5]);assert.equal(S.pitBoxes[1],c[1]);assert.deepEqual([...S.pitQueue],[c[0],c[2]]);assert.equal(S.pitBoxes[2],null);
 c[5].pit.phase='out';c[5].s=S.track.wrapS(S.track.stations[0].boxes[0]+20);S.allocatePitBoxes();assert.equal(S.pitBoxes[0],c[0]);assert.deepEqual([...S.pitQueue],[c[2]]);
});
test('a moving unfinished finalist is never globally timed out',()=>{
 const S=race();S.lightsOut=true;for(let lap=1;lap<=12;lap++)checkpoint(S,lap);const last=S.activeOrder.at(-1);for(const c of S.activeOrder)c.finished=c!==last;S.finishedFlag=true;S.finishLeaderTime=0;S.time=2000;last.lastProgressAt=2000;S.slowUpdate();assert.equal(S.over,false);
});
test('dynamic weather state persists across both phase transitions; player and AI receive identical crew durations',()=>{
 const S=race('summit',{weather:'dynamic'}),weather=S.weather;
 weather.update(30);const before=weather.snapshot();for(let lap=1;lap<=12;lap++)checkpoint(S,lap);
 assert.equal(S.weather,weather);assert.deepEqual(S.weather.snapshot(),before);weather.update(30);assert.ok(weather.time>before.time);
 const [a,b]=S.activeOrder;a.isPlayer=true;for(const c of [a,b]){c.damage.c[0]=.5;c.pit={phase:'awaiting',station:0};}
 SIM.setSeed(123);S.beginPitService(a,{tyre:'S',fuel:2});SIM.setSeed(123);S.beginPitService(b,{tyre:'S',fuel:2});
 assert.deepEqual([a.pit.total,a.pit.tyreT,a.pit.fuelT,a.pit.fwT],[b.pit.total,b.pit.tyreT,b.pit.fuelT,b.pit.fwT]);
 const gp=new SIM.Session(tracks.get('summit'),{type:'race',entries:SIM.DRIVERS.map(driver=>({driver})),seed:1});assert.equal(S.fuelCapacity,gp.fuelCapacity);assert.equal(S.fuelRate,gp.fuelRate);assert.equal(S.fuelPerLap,gp.fuelPerLap);
});
test('active crew work and its queue do not consume the inactivity deadline',()=>{
 const S=race();S.lightsOut=true;for(let lap=1;lap<=12;lap++)checkpoint(S,lap);
 const [waiting,crew]=S.activeOrder;for(const c of S.activeOrder){c.stepDistance=c.totalDist;c.stepS=c.s;c.lastProgressAt=500;c.progressAnchor=c.totalDist;}
 S.time=500;waiting.lastProgressAt=0;waiting.pit={station:0,phase:'queue'};crew.pit={station:0,phase:'stopped',timer:1};S.pitBoxes[0]=crew;
 S.eliminationTiming(.01);assert.equal(waiting.eliminated,null);assert.equal(waiting.lastProgressAt,500);
 crew.pit.phase='out';waiting.lastProgressAt=0;S.eliminationTiming(.01);assert.equal(waiting.eliminated?.reason,'Unable to make progress');
});
test('a candidate finishing early cannot bypass unresolved position checkpoints',()=>{
 const S=race();S.lightsOut=true;for(let lap=1;lap<=11;lap++)checkpoint(S,lap);
 const c=S.activeOrder.at(-1);for(const o of S.activeOrder){o.timedRaceBoundary=16;o.stepDistance=o.totalDist=16*S.track.length+(20-o.gridSlot)*5;}
 c.finished=true;c.finalLaps=[90,90,90];c.stepDistance=c.totalDist=15*S.track.length+10;S.eliminationRound(12,1,.01);
 assert.equal(c.eliminated?.kind,'checkpoint');assert.equal(c.finished,false);assert.equal(S.elimination.finalists.some(o=>o===c),false);assert.equal(S.activeOrder.length,4);
});
