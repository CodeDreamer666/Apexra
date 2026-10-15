// Compare actual racecraft decisions over matched 40 s starts; no mocked planning/controls.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const m={exports:{}};new Function('module',fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1])(m);const SIM=m.exports;
const totals={chaos:{attempts:0,defends:0,passes:0},ruthless:{attempts:0,defends:0,passes:0}};
for(const def of SIM.CIRCUITS){const t=new SIM.Track(def);t.configureElimination();for(const eliminationVariant of ['chaos','ruthless']){
 const S=new SIM.Session(t,{type:'race',gameMode:'elimination',eliminationVariant,seed:73,difficulty:.9,weather:'dry',mistakes:0,tyreWear:'normal',entries:SIM.DRIVERS.map(driver=>({driver}))});
 S.lightsOut=true;S.lightsOutTime=0;
 while(S.time<40){S.fixedStep(SIM.PHYS_DT);S.messages.length=0;S.events.length=0;}
 const result=Object.fromEntries(['attempts','defends','passes'].map(k=>[k,S.cars.reduce((n,c)=>n+c.ai.stats[k],0)]));for(const k of Object.keys(result))totals[eliminationVariant][k]+=result[k];
 for(const c of S.cars)assert.equal(c.mass,820);
 console.log(def.id,eliminationVariant,JSON.stringify(result));
}}
assert.ok(totals.ruthless.attempts>totals.chaos.attempts,'more actual attack attempts across matched starts');
console.log('TOTAL',JSON.stringify(totals));
