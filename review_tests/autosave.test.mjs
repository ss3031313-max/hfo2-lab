// Autosave ordering and recovery safeguards. Run: node --test review_tests/autosave.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const context=vm.createContext({setTimeout,clearTimeout});
vm.runInContext(fs.readFileSync(path.join(root,'src/autosave.js'),'utf8'),context);
const {createController,validateSnapshot}=context.Hfo2AutosaveLogic;
const copy=v=>JSON.parse(JSON.stringify(v));
const frame=(n=0)=>({schema:1,version:'0.4.5',savedAt:'2026-10-25T00:00:'+String(n%60).padStart(2,'0')+'.000Z',core:{images:[],value:n},intake:{value:n},surface:{value:n}});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function harness(extra={}){
 let current=frame(),timers=new Map(),nextTimer=0;
 const writes=[],statuses=[],applied=[],previous=[],locks=[];
 const options={read:async()=>null,write:async v=>{writes.push(copy(v));},capture:()=>copy(current),apply:async v=>{applied.push(copy(v));current=copy(v);return [];},savePrevious:async v=>{previous.push(copy(v));},status:s=>statuses.push(copy(s)),lock:v=>locks.push(v),setTimer:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimer:id=>timers.delete(id),...extra};
 const c=createController(options);
 return {c,writes,statuses,applied,previous,locks,timers,get current(){return current;},set current(v){current=copy(v);}};
}

test('startup does not overwrite saved data with an empty bootstrap state',async()=>{
 const gate=deferred(),h=harness({read:()=>gate.promise});
 h.c.changed();await h.c.flush();assert.equal(h.writes.length,0);assert.deepEqual(h.locks,[true]);
 gate.resolve(frame(7));await h.c.ready;
 assert.equal(h.current.core.value,7);assert.equal(h.writes.length,0);assert.deepEqual(h.locks,[true,false]);assert.equal(h.c.getStatus().state,'saved');
});

test('initial events during applying restored data cannot schedule writes',async()=>{
 let c;const gate=deferred();
 const h=harness({read:()=>gate.promise,apply:async()=>{c.changed();await c.flush();return [];}});c=h.c;
 gate.resolve(frame(3));await c.ready;assert.equal(h.writes.length,0);assert.equal(h.timers.size,0);assert.equal(c.getStatus().dirty,false);
});

test('every saved page opens registration on startup without changing stored data',async()=>{
 for(const page of ['intake','data','samples','om','compare']){
  const saved=frame(7);saved.core.activePage=page;saved.core.ruleInputs={target:'15',tolerance:'2',cvLimit:'10'};
  saved.core.images=[{id:'OM-1',filename:'surface.png'}];saved.intake.queue=[{id:'S1',points:[12,15,18]}];saved.surface.reviews={id:'OM-1',confirmed:true};
  const before=copy(saved),h=harness({read:async()=>saved});await h.c.ready;
  const expected=copy(saved);expected.core.activePage='intake';
  assert.deepEqual(h.current,expected);assert.deepEqual(saved,before);assert.equal(h.writes.length,0);
 }
});

test('manual restoration still keeps its requested page for backup and image-undo workflows',async()=>{
 const saved=frame(4);saved.core.activePage='om';const h=harness({read:async()=>saved});await h.c.ready;
 assert.equal(h.current.core.activePage,'intake');await h.c.restore(saved);
 assert.equal(h.current.core.activePage,'om');assert.equal(h.current.core.value,4);
});

test('debounced changes write the latest complete snapshot once',async()=>{
 const h=harness();await h.c.ready;
 for(let i=1;i<=4;i++){h.current=frame(i);h.c.changed();}
 assert.equal(h.timers.size,1);await h.c.flush();assert.equal(h.writes.length,1);assert.equal(h.writes[0].core.value,4);assert.equal(h.c.getStatus().dirty,false);
});

test('changes during a save are serialized into a second latest-state write',async()=>{
 const gate=deferred(),writes=[];let concurrent=0,maxConcurrent=0;
 const h=harness({write:async v=>{concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);writes.push(copy(v));if(writes.length===1)await gate.promise;concurrent--;}});
 await h.c.ready;h.current=frame(1);h.c.changed();const first=h.c.flush();h.current=frame(2);h.c.changed();const second=h.c.flush();gate.resolve();await Promise.all([first,second]);
 assert.equal(maxConcurrent,1);assert.deepEqual(writes.map(v=>v.core.value),[1,2]);assert.equal(h.c.getStatus().dirty,false);
});

test('a failed write stays visibly unsaved and later changes can retry',async()=>{
 let attempts=0;const h=harness({write:async()=>{if(++attempts===1)throw new Error('quota exceeded');}});await h.c.ready;
 h.current=frame(1);h.c.changed();assert.equal(await h.c.flush(),false);assert.equal(h.c.getStatus().state,'error');assert.equal(h.c.getStatus().dirty,true);
 h.current=frame(2);h.c.changed();assert.equal(await h.c.flush(),true);assert.equal(h.c.getStatus().state,'saved');assert.equal(attempts,2);
});

test('malformed stored state is preserved and cannot be replaced by an empty session',async()=>{
 const h=harness({read:async()=>({...frame(4),schema:2})});await h.c.ready;
 assert.equal(h.c.getStatus().blocked,true);h.current=frame(5);h.c.changed();assert.equal(await h.c.flush(),false);assert.equal(h.writes.length,0);
});

test('a valid manual backup can recover a blocked session',async()=>{
 const h=harness({read:async()=>({...frame(4),schema:2})});await h.c.ready;
 await h.c.restore(frame(9));await h.c.flush();assert.equal(h.c.getStatus().blocked,false);assert.equal(h.current.core.value,9);assert.equal(h.writes.at(-1).core.value,9);
});

test('manual import saves the previous state and rolls back if applying fails',async()=>{
 const h=harness();await h.c.ready;h.current=frame(5);
 // A second controller uses externally held state to model a partial core import.
 let current=frame(5),persisted=frame(5),savedPrevious;
 const c=createController({read:async()=>null,capture:()=>copy(current),write:async v=>{persisted=copy(v);},savePrevious:async v=>{savedPrevious=copy(v);},apply:async v=>{current=copy(v);if(v.core.value===9)throw new Error('bad image');return [];},setTimer:()=>1,clearTimer:()=>{}});
 await c.ready;await assert.rejects(()=>c.restore(frame(9)),/bad image/);
 assert.equal(current.core.value,5);assert.equal(savedPrevious.core.value,5);assert.equal(persisted.core.value,5);assert.equal(c.getStatus().state,'error');assert.equal(c.getStatus().blocked,false);
});

test('failed automatic restoration rolls partial state back and blocks saving',async()=>{
 let current=frame(),calls=[];const c=createController({read:async()=>frame(8),capture:()=>copy(current),write:async()=>{throw new Error('unexpected write');},apply:async v=>{calls.push(v.core.value);current=copy(v);if(v.core.value===8)throw new Error('decode failure');return [];}});
 await c.ready;assert.deepEqual(calls,[8,0]);assert.equal(current.core.value,0);assert.equal(c.getStatus().blocked,true);
});

test('manual import waits for the already running save before replacing state',async()=>{
 const gate=deferred(),events=[];let current=frame(1),writes=0;
 const c=createController({read:async()=>null,capture:()=>copy(current),write:async v=>{events.push('write'+v.core.value);if(++writes===1)await gate.promise;events.push('done'+v.core.value);},apply:async v=>{events.push('apply'+v.core.value);current=copy(v);return [];},setTimer:()=>1,clearTimer:()=>{}});
 await c.ready;c.changed();const saving=c.flush(),importing=c.restore(frame(2));await Promise.resolve();assert.deepEqual(events,['write1']);gate.resolve();await saving;await importing;await c.flush();assert.deepEqual(events,['write1','done1','apply2','write2','done2']);
});

test('unsupported backups are rejected before any import mutation',async()=>{
 const h=harness();await h.c.ready;assert.doesNotThrow(()=>validateSnapshot({...frame(),core:{images:Array(100).fill({})}}));for(const bad of [null,[],{...frame(),schema:2},{...frame(),core:[]},{...frame(),savedAt:'bad'},{...frame(),core:{images:Array(101).fill({})}}]){
  assert.throws(()=>validateSnapshot(bad));await assert.rejects(()=>h.c.restore(bad));
 }
 assert.equal(h.applied.length,0);assert.equal(h.previous.length,0);
});

test('read-only storage failure is reported without claiming data was saved',async()=>{
 const h=harness({read:async()=>{throw new Error('storage disabled');},write:async()=>{throw new Error('storage disabled');}});await h.c.ready;
 assert.equal(h.c.getStatus().state,'error');assert.equal(h.c.getStatus().lastSavedAt,null);assert.equal(h.c.getStatus().blocked,false);
 h.current=frame(1);h.c.changed();await h.c.flush();assert.equal(h.c.getStatus().state,'error');assert.equal(h.c.getStatus().dirty,true);
});

test('manual restoration warnings survive the ensuing save and later ordinary saves',async()=>{
 let current=frame();const h=harness({capture:()=>copy(current),apply:async v=>{current=copy(v);return v.core.value===7?['OM-01 기준 영역 재확인 필요']:[];},savePrevious:async()=>{throw new Error('previous slot unavailable');}});
 await h.c.ready;const result=await h.c.restore(frame(7));await h.c.flush();
 assert.equal(h.c.getStatus().state,'saved');assert.equal(h.c.getStatus().dirty,false);assert.match(h.c.getStatus().detail,/OM-01 기준 영역 재확인 필요/);assert.match(h.c.getStatus().detail,/previous slot unavailable/);assert.equal(result.warnings.length,2);
 h.c.changed();await h.c.flush();assert.equal(h.c.getStatus().state,'saved');assert.match(h.c.getStatus().detail,/OM-01 기준 영역 재확인 필요/);
});

test('startup restoration warnings remain available after a save until a clean restoration replaces them',async()=>{
 let current=frame();const h=harness({read:async()=>frame(8),capture:()=>copy(current),apply:async v=>{current=copy(v);return v.core.value===8?['일부 확인 상태 미복원']:[];}});
 await h.c.ready;h.c.changed();await h.c.flush();assert.equal(h.c.getStatus().state,'saved');assert.match(h.c.getStatus().detail,/일부 확인 상태 미복원/);
 await h.c.restore(frame(9));await h.c.flush();assert.equal(h.c.getStatus().detail,'');assert.equal(h.c.getStatus().state,'saved');
});
