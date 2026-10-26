// Software workflow checks; these fixtures do not validate physical OM defects.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const source=fs.readFileSync(new URL('../src/surface_review.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function pure(){const ctx=vm.createContext({console});vm.runInContext(source,ctx);return ctx.Hfo2Surface;}
const policy={threshold:5,minArea:16,particleMinArea:2,areaLimit:5,particleDensityLimit:10};
const within={threshold:5,minArea:16,particleMinArea:2,areaPercent:0.04,particleCount:11,smallParticleCount:9,particleDensityPer10k:0.28,referenceSpreadPercent:0.5,reference_source:'AUTO'};

test('stable automatic result passes without inventing human confirmation',()=>{
 const a=pure().assessResult(within,'UNREVIEWED',policy);
 assert.equal(a.state,'pass');assert.equal(a.label,'OM 자동 기준 충족');
 assert.equal(a.user_confirmation,'UNREVIEWED');assert.equal(a.decisionSource,'AUTOMATIC');
 assert.match(a.reason,/사용자 미확인/);
});
test('manual reference and corrected automatic results remain pending until reviewed',()=>{
 const S=pure();
 for(const [result,context] of [[{...within,reference_source:'MANUAL'},{}],[{...within,correctionCount:1},{}],[within,{correctionCount:1}],[within,{reviewRequired:true}]]){
  const a=S.assessResult(result,'UNREVIEWED',policy,context);
  assert.equal(a.state,'pending');assert.equal(a.decisionSource,'MANUAL_PENDING');
 }
 const reviewed=S.assessResult({...within,correctionCount:1},'OVERLAY_REVIEWED',policy);
 assert.equal(reviewed.state,'pass');assert.equal(reviewed.decisionSource,'USER_REVIEWED');
 assert.equal(reviewed.user_confirmation,'OVERLAY_REVIEWED');
});
test('automatic analysis cannot suppress unstable references, thresholds or further review',()=>{
 const S=pure();
 assert.equal(S.assessResult({...within,referenceSpreadPercent:5},'UNREVIEWED',policy).state,'pending');
 assert.equal(S.assessResult({...within,threshold:6},'UNREVIEWED',policy).state,'pending');
 assert.equal(S.assessResult({...within,particleDensityPer10k:10.1},'UNREVIEWED',policy).state,'fail');
 assert.equal(S.assessResult({...within,areaPercent:5.1},'UNREVIEWED',policy).state,'fail');
 assert.equal(S.assessResult(within,'NEEDS_FURTHER_REVIEW',policy).state,'pending');
 assert.equal(S.assessResult({...within,areaPercent:10},'OVERLAY_REVIEWED',policy).state,'fail');
});

function queueHarness({run=async()=>{},keys=new Map([['a','v1'],['b','v1']]),allowed=true}={}){
 let serial=0;const timers=new Map(),errors=[],calls=[];const S=pure();
 const q=S.createAutomaticQueue({getKey:id=>keys.get(id)??null,canRun:()=>allowed,run:async ids=>{calls.push(Array.from(ids));return run(ids);},onError:e=>errors.push(e.message),setTimer:fn=>{timers.set(++serial,fn);return serial;},clearTimer:id=>timers.delete(id)});
 function fireNow(){const entry=timers.entries().next().value;if(entry){timers.delete(entry[0]);entry[1]();}}
 async function fire(){fireNow();await tick();}
 return {q,keys,timers,errors,calls,fire,fireNow,setAllowed:v=>{allowed=v;}};
}
test('automatic queue waits for readiness and coalesces duplicate image requests',async()=>{
 const h=queueHarness({allowed:false});h.q.request(['a','a','b']);assert.equal(h.timers.size,0);
 h.setAllowed(true);h.q.wake();await h.fire();
 assert.deepEqual(h.calls,[['a','b']]);h.q.request(['a','b']);await h.fire();assert.equal(h.calls.length,1);
});
test('a failed automatic attempt is retried only when image or detection key changes',async()=>{
 const h=queueHarness({run:async()=>{throw new Error('no stable reference');}});
 h.q.request(['a']);await h.fire();assert.equal(h.errors.length,1);
 h.q.request(['a']);await h.fire();assert.equal(h.calls.length,1);
 h.keys.set('a','roi-2');h.q.request(['a']);await h.fire();assert.equal(h.calls.length,2);
});
test('automatic jobs serialize and invalidated pending images are skipped',async()=>{
 const gate=deferred(),h=queueHarness({run:async ids=>{if(ids.includes('a'))await gate.promise;}});
 h.q.request(['a']);await h.fire();assert.equal(h.q.isRunning(),true);
 h.q.request(['b']);h.keys.delete('b');assert.equal(h.timers.size,0);
 gate.resolve();await h.q.whenIdle();await tick();await h.fire();
 assert.deepEqual(h.calls,[['a']]);assert.equal(h.q.isRunning(),false);
});
test('pause preserves pending work and release is idempotent',async()=>{
 const h=queueHarness();h.q.request(['a']);const release=h.q.pause();assert.equal(h.timers.size,0);
 h.q.request(['b']);await h.fire();assert.equal(h.calls.length,0);
 release();release();await h.fire();assert.deepEqual(h.calls,[['a','b']]);
});
test('pause between timer and analysis microtask keeps analysis suspended until release',async()=>{
 const h=queueHarness();h.q.request(['a']);h.fireNow();
 assert.equal(h.q.isRunning(),true);const release=h.q.pause();await h.q.whenIdle();await tick();
 assert.deepEqual(h.calls,[]);assert.equal(h.q.has('a'),true);assert.equal(h.timers.size,0);
 release();await h.fire();assert.deepEqual(h.calls,[['a']]);
});
test('reset between timer and analysis microtask prevents work from an old generation',async()=>{
 const h=queueHarness();h.q.request(['a']);h.fireNow();h.q.reset();await h.q.whenIdle();await tick();
 assert.deepEqual(h.calls,[]);assert.equal(h.q.has('a'),false);
 h.q.request(['a']);await h.fire();assert.deepEqual(h.calls,[['a']]);
});
test('reset discards old pending work and permits a restored image to be analyzed once',async()=>{
 const h=queueHarness();h.q.request(['a']);h.q.reset();await h.fire();assert.equal(h.calls.length,0);
 h.q.request(['b']);await h.fire();h.q.reset();h.q.request(['b']);await h.fire();assert.deepEqual(h.calls,[['b'],['b']]);
});
test('queue whenIdle waits for active work without waiting on paused pending jobs',async()=>{
 const gate=deferred(),h=queueHarness({run:()=>gate.promise});h.q.request(['a']);await h.fire();
 let settled=false;const idle=h.q.whenIdle().then(()=>{settled=true;});const release=h.q.pause();h.q.request(['b']);
 await tick();assert.equal(settled,false);gate.resolve();await idle;assert.equal(settled,true);assert.equal(h.q.has('b'),true);release();
});

function pixels(){const data=new Uint8ClampedArray(40*40*4);for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=100;data[i+3]=255;}for(let y=20;y<24;y++)for(let x=20;x<24;x++){const i=(y*40+x)*4;data[i]=data[i+1]=data[i+2]=200;}return {width:40,height:40,imageData:{data}};}
// Execute the actual batch functions with presentation calls stubbed out.
function batchHarness({delayed=false}={}){
 let roi={left:0,top:0,right:100,bottom:100};const imageMap=new Map([['a',{id:'a',filename:'a.png'}],['b',{id:'b',filename:'b.png'}]]),pixelMap=new Map([['a',pixels()],['b',pixels()]]),gates=[];
 const B={getROI:()=>roi,getImage:id=>imageMap.get(id),getPixels:id=>pixelMap.get(id),getSelectedImageId:()=> 'a'};
 const ctx=vm.createContext({console,Hfo2Bridge:B,crypto:delayed?{subtle:{digest:()=>{const g=deferred();gates.push(g);return g.promise;}}}:undefined});
 const prefix=source.slice(0,source.indexOf('const publicAPI='));
 const state=source.split('\n').find(line=>line.startsWith('function state('));
 const batches=source.slice(source.indexOf('function analyzeBatch('),source.indexOf('\nasync function importState(',source.indexOf('function analyzeBatch(')));
 vm.runInContext(prefix+'\nconst B=root.Hfo2Bridge;function error(){}function render(){}function emit(){}function requestAutomatic(){}\n'+state+'\n'+batches+'\nroot.testAPI={analyzeBatch,states,masks,applyCorrections,inspectComponent,assessResult,getAssessment,isBusy:()=>busy};\n})(globalThis);',ctx);
 return {S:ctx.testAPI,gates,pixelMap,imageMap,setROI:value=>{roi=value;}};
}
test('same-settings batch retains manual exclusions and their reviewed density',async()=>{
 const h=batchHarness();await h.S.analyzeBatch(['a'],{automaticReference:true});
 const s=h.S.states.get('a'),raw=s.result,mask=h.S.masks.get('a'),component=h.S.inspectComponent(raw,mask,{x:21,y:21});
 const edit={...plain(component),action:'EXCLUDE_COUNT',reason:'NON_PARTICLE_PATTERN',note:''};
 const adjusted=h.S.applyCorrections(raw,mask,[edit]);s.result=adjusted.result;s.corrections=adjusted.result.manualCorrections;s.confirmation='OVERLAY_REVIEWED';
 const before=s.result,corr=s.corrections,second=await h.S.analyzeBatch(['a'],{automaticReference:true});
 assert.equal(second.retained,1);assert.equal(second.analyzed,0);assert.equal(s.result,before);assert.equal(s.corrections,corr);assert.equal(s.confirmation,'OVERLAY_REVIEWED');assert.equal(s.result.particleDensityPer10k,0);assert.equal(s.result.areaPercent,raw.areaPercent);
});
test('concurrent analysis calls are serialized and both complete',async()=>{
 const h=batchHarness({delayed:true}),first=h.S.analyzeBatch(['a'],{automaticReference:true}),second=h.S.analyzeBatch(['b'],{automaticReference:true});
 await tick();assert.equal(h.gates.length,1);assert.equal(h.S.isBusy(),true);
 h.gates[0].resolve(new Uint8Array(32).buffer);const a=await first;await tick();assert.equal(h.gates.length,2);
 h.gates[1].resolve(new Uint8Array(32).buffer);const b=await second;
 assert.equal(a.analyzed,1);assert.equal(b.analyzed,1);assert.equal(h.S.isBusy(),false);
});
test('ROI or pixel replacement while a signature is awaited cannot apply a stale result',async()=>{
 for(const replace of [h=>h.setROI({left:0,top:0,right:80,bottom:80}),h=>h.pixelMap.set('a',pixels()),h=>h.imageMap.delete('a')]){
  const h=batchHarness({delayed:true}),running=h.S.analyzeBatch(['a'],{automaticReference:true});await tick();replace(h);h.gates[0].resolve(new Uint8Array(32).buffer);const result=await running;
  assert.equal(result.analyzed,0);assert.equal(result.unprocessed,1);assert.equal(h.S.states.get('a').result,null);assert.equal(h.S.masks.has('a'),false);assert.match(result.warnings.join(' '),/변경/);
 }
});
