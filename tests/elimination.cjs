const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),m={exports:{}};
new Function('module',html.match(/<script>([\s\S]*?)<\/script>/)[1])(m);const SIM=m.exports;
const tracks=new Map(SIM.CIRCUITS.map(d=>{const t=new SIM.Track(d);t.configureElimination();return[d.id,t];}));
function race(id='summit',variant='classic',extra={}){const S=new SIM.Session(tracks.get(id),{type:'race',gameMode:'elimination',eliminationVariant:variant,seed:11,weather:'dynamic',mistakes:0,entries:SIM.DRIVERS.map((driver,i)=>({driver,isPlayer:i===0})),...extra});S.lightsOut=true;return S;}
function frame(S,moves,dt=.1){for(const c of S.cars){c.stepDistance=c.totalDist;c.stepS=c.s;c.lastProgressAt=S.time;}for(const [c,a,b]of moves){c.stepDistance=a;c.totalDist=b;c.lastLapBase=Math.floor(a/S.track.length);c.lastWithin=S.track.wrapS(a);c.crossings=Math.max(1,c.crossings);c.sectorIdx=2;c.stepS=S.track.wrapS(a);}S.time+=dt;S.eliminationTiming(dt);}
function round(S,lap){const e=S.elimination.events[lap-1],cars=S.activeOrder.slice();for(const c of cars)frame(S,[[c,e.distance-1,e.distance+1]]);}
function finish(S,c,at=S.time+1){S.time=at-.1;frame(S,[[c,S.totalLaps*S.track.length-1,S.totalLaps*S.track.length+1]]);}
for(const id of tracks.keys())for(const variant of Object.keys(SIM.ELIMINATION_RULES))test(id+' / '+variant+': all checkpoints and continuous finale',()=>{
 const S=race(id,variant),c=S.player,tyre=c.tyre,damage=c.damage,weather=S.weather;c.tyre.wear.fill(.4);c.damage.c[0]=.3;
 const snap={fuel:c.fuel,weather:weather.snapshot()};let expected=20;
 assert.equal(S.totalLaps,variant==='ruthless'?7:8);
 for(let lap=1;lap<=6;lap++){const before=S.elimination.history.length;round(S,lap);expected-=S.elimination.events[lap-1].count;assert.equal(S.activeOrder.length,expected);assert.equal(S.elimination.history.length,before+1);S.eliminationRound(lap);assert.equal(S.elimination.history.length,before+1);}
 assert.equal(expected,2);assert.equal(S.elimination.history[4].remaining,3);assert.equal(S.elimination.finalists.length,2);
 assert.equal(c.tyre,tyre);assert.equal(c.damage,damage);assert.equal(S.weather,weather);assert.deepEqual(weather.snapshot(),snap.weather);assert.equal(c.fuel,snap.fuel);assert.equal(c.tyre.wear[0],.4);assert.equal(c.damage.c[0],.3);
 const [a,b]=S.activeOrder;const e=S.totalLaps*S.track.length;
 frame(S,[[a,e-S.track.length-1,e-S.track.length+1]]);assert.equal(S.over,false,'penultimate lap cannot finish race');
 finish(S,b);assert.equal(S.over,true);assert.equal(S.winner,b,'first legitimate final crossing wins, irrespective of prior position/lap times');assert.equal(S.results[0].car,b);assert.equal(S.results.length,20);
 assert.equal(S.elimination.history.length,6);assert.equal(S.elimination.out.length,18);assert.equal(S.fuelEnabled,false);assert.equal(S.track.stations.length,2);assert.equal(c.mass,820);
});
test('classic exact progression and GP/Career rules stay separate',()=>{
 const S=race();for(let lap=1;lap<=6;lap++)round(S,lap);assert.deepEqual(S.elimination.history.map(e=>e.remaining),[19,17,14,9,3,2]);
 for(const career of [undefined,{tier:1,race:0}]){const gp=new SIM.Session(new SIM.Track(SIM.CIRCUITS[0]),{type:'race',seed:1,career,eliminationVariant:'ruthless',entries:SIM.DRIVERS.map(driver=>({driver}))});assert.equal(gp.totalLaps,SIM.GAME_MODES.grandprix.laps);assert.equal(gp.fuelEnabled,true);assert.equal(gp.track.stations,undefined);assert.equal(gp.ruthlessAggression(gp.cars[0]),0);}
});
test('random schedules cover every valid composition and are reproducible',()=>{
 const valid=new Set();function enumerate(a=[],sum=0){if(a.length===5){if(sum===17)valid.add(a.join());return;}for(let k=1;k<=6;k++)enumerate([...a,k],sum+k);}enumerate();
 const seen=new Set(),rng=SIM.makeRng(123);
 for(let i=0;i<60000;i++){const counts=SIM.eliminationSchedule(rng);assert.equal(counts.length,5);assert.equal(counts.reduce((a,b)=>a+b,0),17);assert.ok(counts.every(n=>n>=1&&n<=6));seen.add(counts.join());}
 assert.deepEqual(seen,valid);console.log('Verified '+seen.size+' distinct valid schedules across 60,000 draws');
 for(const variant of ['chaos','ruthless']){const a=race('summit',variant,{seed:0}),b=race('summit',variant,{seed:0});assert.deepEqual(a.elimination.events,b.elimination.events);assert.ok(Object.isFrozen(a.elimination.events));assert.ok(a.elimination.events.every(Object.isFrozen));}
});
test('Ruthless locations avoid service routes, stay ordered and provide fair warnings on every circuit',()=>{
 for(const t of tracks.values())for(let seed=0;seed<400;seed++){
  const events=SIM.eliminationEvents(t,'ruthless',seed);assert.equal(events.length,6);assert.equal(events.slice(0,5).reduce((a,e)=>a+e.count,0),17);
  events.forEach((e,i)=>{assert.ok(e.s>=(i===5?2000:1500)&&e.s<=(i===5?5000:5500));assert.equal(e.lap,i+1);assert.equal(e.distance,i*t.length+e.s);assert.ok(e.warning>=500&&e.warning<=1000);assert.equal(e.distance-e.reveal,e.warning);assert.ok(!t.stations.some(p=>t.wrapS(e.s-p.entry0)<p.len+60));assert.ok(Number.isFinite(t.pointAt(e.s,0)[0]));if(i)assert.ok(e.distance>events[i-1].distance);});
 }
});
test('unknown public view, engineer and AI never use hidden count or location',()=>{
 for(const variant of ['chaos','ruthless']){
  const A=race('summit',variant,{seed:12}),B=race('summit',variant,{seed:13});
  assert.notDeepEqual(A.elimination.events,B.elimination.events);
  for(const S of [A,B]){const c=S.player;assert.equal(S.eliminationInfo(c).count,null);assert.equal(S.eliminationInfo(c).cutoff,null);assert.equal(S.eliminationInfo(c).distance,null);if(variant==='ruthless')assert.equal(S.eliminationInfo(c).revealDistance,null);}
  assert.deepEqual(A.eliminationInfo(A.player),B.eliminationInfo(B.player));assert.equal(A.eliminationRisk(A.player),B.eliminationRisk(B.player));assert.equal(A.eliminationUrgency(A.player),B.eliminationUrgency(B.player));assert.equal(A.checkpointApproach(),0);
  A.messages.length=0;const e=A.elimination.events[0];A.cars[0].totalDist=e.reveal-1;A.refreshEliminationOrder();assert.equal(A.eliminationInfo().known,false);A.revealEliminations();assert.equal(A.messages.length,0);
  A.cars[0].totalDist=e.reveal;A.refreshEliminationOrder();A.revealEliminations();const info=A.eliminationInfo();assert.equal(info.count,e.count);assert.equal(info.cutoff,20-e.count);assert.equal(A.messages.length,1);assert.match(A.messages[0].text,new RegExp(e.count+' eliminated'));assert.equal(A.elimination.revealed.has(2),false);
  const original=JSON.stringify(A.elimination.events);A.player.position=20;A.player.damage.c[0]=.9;assert.equal(JSON.stringify(A.elimination.events),original);
 }
});
test('immutable crossing order beats post-checkpoint overtakes and live distance',()=>{
 const S=race(),e=S.elimination.events[0],cars=S.cars.slice();
 // Car 19 crosses first, then drops far back; car 0 crosses last, then jumps ahead.
 for(const c of cars.slice().reverse())frame(S,[[c,e.distance-1,e.distance+1]]);
 assert.equal(S.elimination.out[0].car,cars[0]);assert.equal(cars[19].eliminated,null);
 const T=race(),ev=T.elimination.events[0];for(const c of T.cars)T.elimination.crossings[0].set(c,10);T.eliminationRound(1);assert.equal(T.elimination.out[0].car,T.cars.at(-1),'exact ties use grid slot');
});
test('a leader cannot remove a lapped car; service routes use the same boundary',()=>{
 const S=race('summit','ruthless'),e=S.elimination.events[0],tail=S.cars.at(-1);
 for(const c of S.cars.slice(0,-1))frame(S,[[c,e.distance-1,e.distance+1]]);
 assert.equal(S.elimination.round,0);assert.equal(S.elimination.out.length,0);
 for(const c of S.cars.slice(0,-1))c.totalDist+=S.track.length*2;
 assert.equal(S.elimination.round,0);
 tail.pit={phase:'out',station:0};frame(S,[[tail,e.distance-1,e.distance+1]]);
 assert.equal(S.elimination.round,1);assert.equal(tail.eliminated.kind,'checkpoint');assert.equal(tail.pit.phase,'out');
});
test('multiple retirements, off-track/stalled drivers and a depleted field never remove the last survivor',()=>{
 for(const variant of ['classic','chaos','ruthless']){
  const S=race('summit',variant);for(const c of S.cars.slice(1))S.startRetirement(c,'Damage');
  for(let lap=1;lap<=6;lap++)round(S,lap);assert.equal(S.activeOrder.length,1);assert.equal(S.player.eliminated,null);finish(S,S.player);assert.equal(S.winner,S.player);
  const T=race('summit',variant);T.startRetirement(T.player,'Damage');assert.ok(T.events.some(e=>e.type==='playereliminated'));for(const c of T.cars)T.lastProgressAt=0;
  T.time=200;for(const c of T.cars){c.lastProgressAt=0;c.progressAnchor=c.totalDist;c.stepDistance=c.totalDist;c.stepS=c.s;}T.eliminationTiming(.01);assert.equal(T.over,true);assert.equal(T.winner,null);
 }
});
test('retirement can resolve a waiting checkpoint without changing recorded order',()=>{
 const S=race(),e=S.elimination.events[0],tail=S.cars.at(-1);for(const c of S.cars.slice(0,-1))frame(S,[[c,e.distance-1,e.distance+1]]);
 S.startRetirement(tail,'Damage');frame(S,[]);assert.equal(S.elimination.round,1);assert.equal(S.elimination.history[0].removed.length,0);assert.equal(S.activeOrder.length,19);
});
test('reverse and repeated crossings do not produce repeated events or finishes',()=>{
 const S=race(),c=S.player,e=S.elimination.events[0];frame(S,[[c,e.distance-1,e.distance+1]]);const at=S.elimination.crossings[0].get(c);frame(S,[[c,e.distance+1,e.distance-1]]);frame(S,[[c,e.distance-1,e.distance+1]]);assert.equal(S.elimination.crossings[0].get(c),at);assert.equal(S.elimination.round,0);
 const off=S.legalProgress(Object.assign(c,{offN:4,idx:100,d:100}),35,100,100);assert.equal(off,0,'projection jumps cannot earn progress');
});
test('Ruthless tactical changes retain personalities and the identical physical envelope',()=>{
 const results={};
 for(const variant of ['classic','chaos','ruthless']){
  const S=race('summit',variant),c=S.cars[1],ai=c.ai;c.tyre.wear.fill(.2);c.speed=c.u=40;
  ai.ruthless=S.ruthlessAggression(c);ai.strategic(.1,S.eliminationUrgency(c));results[variant]={risk:ai.riskBudget,bias:ai.attackBias,aggression:ai.ruthless,commit:ai.commit,brake:ai.brakeCommit,mass:c.mass,grip:c.gripEstimate(S.wet)};
  ai.target=S.cars[2];ai.passEval={car:ai.target,feasible:true,gain:.2,success:.9,value:.8,risk:.02,maneuver:'inside',side:1};for(let i=0;i<5;i++)ai.updateState(.1,ai.target,null,false,false);results[variant].conviction=ai.conviction;
  const healthy=S.ruthlessAggression(c);c.damage.c.fill(.7);c.tyre.wear.fill(.95);assert.ok(S.ruthlessAggression(c)<=healthy);
  assert.ok(new Set(S.cars.slice(1).map(c=>c.ai.mind.aggr)).size>1);
 }
 assert.equal(results.classic.aggression,0);assert.equal(results.chaos.aggression,0);assert.ok(results.ruthless.risk>results.chaos.risk);assert.ok(results.ruthless.bias>results.chaos.bias);assert.ok(results.ruthless.conviction>=results.chaos.conviction);
 for(const k of ['commit','brake','mass','grip'])assert.equal(results.classic[k],results.ruthless[k],k+' unchanged');
});
test('a finish ahead of an unresolved lapped competitor waits for eligibility, then retains its timestamp',()=>{
 const S=race();for(let lap=1;lap<=5;lap++)round(S,lap);const [a,b,c]=S.activeOrder,e=S.elimination.events[5];
 frame(S,[[a,e.distance-1,e.distance+1]]);frame(S,[[b,e.distance-1,e.distance+1]]);finish(S,a,100);assert.equal(S.over,false);
 frame(S,[[c,e.distance-1,e.distance+1]]);assert.equal(S.elimination.round,6);assert.equal(S.over,true);assert.equal(S.winner,a);assert.equal(a.finishTime,99.95);
});
test('substep finish crossing beats a later retirement regardless of physics iteration order',()=>{
 for(const reverse of [false,true]){const S=race();for(let lap=1;lap<=6;lap++)round(S,lap);const c=S.activeOrder[0],end=S.totalLaps*S.track.length;
  if(reverse)S.cars.reverse();for(const o of S.cars){o.stepDistance=o.totalDist;o.stepS=o.s;}
  c.stepDistance=end-1;c.totalDist=end+3;c.stepS=S.track.wrapS(end-1);c.lastLapBase=S.totalLaps-1;c.lastWithin=S.track.length-1;c.crossings=5;c.sectorIdx=2;
  S.time+=.1;S.processingEliminationPhysics=true;S.startRetirement(c,'Damage');S.processingEliminationPhysics=false;S.eliminationTiming(.1);
  assert.equal(S.winner,c);assert.equal(c.eliminated,null);assert.equal(c.dnf,false);
 }
});
test('engineer reveals only public values and global critical warnings render without a car',()=>{
 const S=race('summit','ruthless'),p=S.player;S.time=30;p.engineer.update(true);
 assert.ok(![...p.engineer.active.keys()].some(k=>k.startsWith('knockout-')));
 const e=S.elimination.events[0];S.activeOrder[0].totalDist=e.reveal;S.refreshEliminationOrder();p.engineer.update(true);
 const msg=p.engineer.active.get('knockout-1');assert.ok(msg);assert.match(msg.text,new RegExp(e.count+' eliminated'));assert.ok(!p.engineer.active.has('knockout-2'));
 const start=html.indexOf('function hudMessages()'),end=html.indexOf('const LED_N',start),shown=[];
 const call=new Function('G','performance','msgQueue','pushMsg',html.slice(start,end)+';hudMessages();');
 S.messages=[{text:'Public knockout warning',kind:'critical',car:null,dur:4}];
 call({session:S,msgSeen:0,focus:p,attract:false},{now:()=>0},[],(...args)=>shown.push(args));assert.equal(shown.length,1);
});
test('Elimination tyre plans never recommend an unavailable Medium compound',()=>{
 const S=race(),c=S.player;for(const wet of [0,.3,.8])for(const wear of [.2,.8]){
  const plan=SIM.planStrategy({...S,wet},c,8,'H',wear);assert.ok(plan.stops.every(s=>['S','H','I','W'].includes(s.c)));
 }
});
