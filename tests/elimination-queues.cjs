// Multiple physical arrivals share a drive-through lane; nobody waits for a crew/box.
const fs=require('fs'),assert=require('node:assert/strict'),path=require('node:path');const m={exports:{}};new Function('module',fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1])(m);const SIM=m.exports;
for(const def of SIM.CIRCUITS)for(let station=0;station<2;station++){
 const S=new SIM.Session(new SIM.Track(def),{type:'race',gameMode:'elimination',entries:SIM.DRIVERS.map(driver=>({driver})),seed:11,weather:'dry',mistakes:0,tyreWear:'off'});S.lightsOut=true;
 const cars=S.cars.slice(0,3),p=S.track.stations[station];for(const o of S.cars.slice(3)){o.inGarage=true;o.ghost=true;}
 for(const [i,c]of cars.entries()){const s=S.track.wrapS(p.entry0-150-i*45);c.placeAt(S.track,s,0,40);c.totalDist=100-i*45;c.launch.active=false;c.ai.boxThisLap=true;c.ai.strategy=()=>{};c.ai.assessDamage=()=>{};c.stationChoice=p.id;c.boxCompound='S';}
 S.aiServiceChoice=()=>({tyre:'S',fuel:0});let phases=new Set();
 while(S.time<90){S.fixedStep(SIM.PHYS_DT);for(const c of cars)if(c.pit)phases.add(c.pit.phase);assert.equal(S.pitQueue.length,0);assert.ok(S.pitBoxes.every(c=>!c));if(cars.every(c=>c.pitStops===1&&!c.pit))break;}
 for(const c of cars){assert.equal(c.pitStops,1,def.id+' station '+station);assert.equal(c.pit,null);assert.equal(c.damage.severity(),0);assert.equal(c.pitHistory[0].service,0);}
 assert.deepEqual([...phases],['out']);console.log('PASS',def.id,'station',station+1,'three arrivals serviced without stationary queue');
}
