import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const context=vm.createContext({setTimeout,clearTimeout});
const template=fs.readFileSync(path.join(root,'src/om_app.template.html'),'utf8');
for(const id of ['om-math','workflow-math'])vm.runInContext(template.match(new RegExp('<script id="'+id+'">([\\s\\S]*?)<\\/script>'))[1],context);
vm.runInContext(fs.readFileSync(path.join(root,'src/autosave.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(root,'src/image_management.js'),'utf8'),context);
const {clearImageSnapshot,materialSignature,createManager}=context.Hfo2ImageManagementLogic;
const {parseCSV}=context.Hfo2WorkflowMath;
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){return {schema:1,version:'0.4.11',savedAt:'2026-10-26T00:00:00.000Z',core:{version:1,images:[{id:'UPLOAD-001',filename:'A.png',image_data_url:'data:image/png;base64,AAAA'}],metadataCsv:'sample_id,image_id,concentration_M,coats,rpm,spin_time_s,anneal_temp_C,anneal_time_min,data_source\nDEMO-S01,UPLOAD-001,0.2,1,3000,30,550,120,SYNTHETIC\n',thicknessCsv:'sample_id,position,thickness_nm,data_source\nDEMO-S01,center,15,SYNTHETIC\nDEMO-S01,top,15.2,SYNTHETIC\n',metadataFilename:'old.xlsx',thicknessFilename:'old.xlsx',ruleInputs:{target:'15',tolerance:'2',cvLimit:'10'},roiInputs:{mode:'center',left:'15',top:'15',right:'85',bottom:'85'},invalidEdits:[],selectedImageId:'UPLOAD-001',selectedSampleId:'DEMO-S01',reviewOnly:false,activePage:'om'},intake:{schemaVersion:1,queue:[{id:'DEMO-S01',image_id:'UPLOAD-001',image_filename:'A.png',concentration_M:.2,coats:1,data_source:'SYNTHETIC',points:[{position:'center',value:15},{position:'top',value:15.2}]}],undoQueue:[{id:'DEMO-S00',image_id:'UPLOAD-001',points:[]}],dirty:true,form:{sample_id:'pending',data_source:'REAL_MEASUREMENT',image_id:'UPLOAD-001',file_pending:true,positions:[{position:'center',thickness_nm:'16'}]}},surface:{version:1,policy:{threshold:5,minArea:16,particleMinArea:2,areaLimit:5,particleDensityLimit:10},inputDraft:{threshold:'5'},images:[{image_id:'UPLOAD-001',reference:{left:25,top:25,right:30,bottom:30},hadResult:true,confirmation:'OVERLAY_REVIEWED',manualCorrections:[{seed:1,action:'EXCLUDE_COUNT'}]}]}};}
function harness(extra={}){
 let current=fixture(),persistent=null,failApply=false,failWrite=false,externalBusy=false,blocked=false;const events=[],states=[],savedPrevious=[];
 const auto=context.Hfo2AutosaveLogic.createController({read:async()=>null,capture:()=>clone(current),apply:async value=>{if(failApply)throw new Error('apply failure');current=clone(value);return [];},write:async value=>{if(failWrite)throw new Error('disk full');persistent=clone(value);},savePrevious:async value=>savedPrevious.push(clone(value)),setTimer:()=>1,clearTimer:()=>{}});
 const manager=createManager({ready:auto.ready,capture:auto.snapshot,restore:auto.restore,flush:auto.flush,parseCSV,isBusy:()=>externalBusy,isBlocked:()=>blocked,onState:s=>states.push(clone(s)),onApplied:restored=>events.push(restored),...extra});
 return {manager,auto,states,events,savedPrevious,get current(){return current;},get persistent(){return persistent;},edit(fn){fn(current);},set failApply(v){failApply=v;},set failWrite(v){failWrite=v;},set externalBusy(v){externalBusy=v;},set blocked(v){blocked=v;}};
}

test('image-only transform clears every active image binding while preserving measurements and criteria',()=>{
 const original=fixture(),before=clone(original),out=clone(clearImageSnapshot(original,parseCSV));
 assert.deepEqual(original,before);assert.equal(out.core.images.length,0);assert.equal(out.core.selectedImageId,'');assert.equal(out.surface.images.length,0);
 assert.equal(out.intake.queue[0].image_id,null);assert.equal(out.intake.queue[0].image_filename,null);assert.equal(out.intake.undoQueue[0].image_id,null);assert.equal(out.intake.form.image_id,'');assert.equal(out.intake.form.file_pending,false);
 assert.equal(out.core.thicknessCsv,before.core.thicknessCsv);for(const field of ['ruleInputs','roiInputs','invalidEdits'])assert.deepEqual(out.core[field],before.core[field]);
 assert.deepEqual(out.intake.queue[0].points,before.intake.queue[0].points);assert.equal(out.intake.queue[0].concentration_M,.2);assert.equal(out.intake.dirty,true);assert.deepEqual(out.intake.form.positions,before.intake.form.positions);assert.deepEqual(out.surface.policy,before.surface.policy);assert.deepEqual(out.surface.inputDraft,before.surface.inputDraft);
 const row=parseCSV(out.core.metadataCsv)[1].cells;assert.equal(row[1],'');assert.deepEqual(clone(row.slice(2)),clone(parseCSV(before.core.metadataCsv)[1].cells.slice(2)));
});
test('CSV round trip preserves quoted, multiline, formula-like IDs and optional filename fields',()=>{
 const original=fixture();original.core.metadataCsv='sample_id,image_id,note,image_filename\n"=A,\"\"B\"\"",UPLOAD-001,"line1\nline2",A.png\n';const out=clearImageSnapshot(original,parseCSV),rows=parseCSV(out.core.metadataCsv);
 assert.equal(rows[1].cells[0],'=A,"B"');assert.equal(rows[1].cells[1],'');assert.equal(rows[1].cells[2],'line1\nline2');assert.equal(rows[1].cells[3],'');
});
test('missing image column or malformed row is rejected before modifying the input',()=>{
 for(const csv of ['sample_id\nA\n','sample_id,image_id\nA,B,C\n']){const original=fixture();original.core.metadataCsv=csv;const before=clone(original);assert.throws(()=>clearImageSnapshot(original,parseCSV));assert.deepEqual(original,before);}
 assert.throws(()=>clearImageSnapshot(null,parseCSV));
});
test('clear persists an empty image list and retains a reversible preclear snapshot',async()=>{
 const h=harness();await h.manager.ready;const before=clone(h.current);const result=await h.manager.clear();
 assert.equal(result.count,1);assert.equal(h.current.core.images.length,0);assert.equal(h.persistent.core.images.length,0);assert.equal(h.current.core.thicknessCsv,before.core.thicknessCsv);assert.equal(h.manager.getState().canUndo,true);assert.deepEqual(h.events,[false]);assert.deepEqual(h.savedPrevious[0],before);
 await h.manager.undo();assert.deepEqual(h.current,before);assert.deepEqual(h.persistent,before);assert.equal(h.manager.getState().canUndo,false);assert.deepEqual(h.events,[false,true]);
});
test('changing measurements after clearing disables undo and cannot erase the newer values',async()=>{
 const h=harness();await h.manager.ready;await h.manager.clear();h.edit(s=>s.intake.queue[0].points[0].value=19);h.manager.changed();assert.equal(h.manager.getState().canUndo,false);await assert.rejects(()=>h.manager.undo());assert.equal(h.current.intake.queue[0].points[0].value,19);
});
test('undo checks again even if an edit did not emit a change event',async()=>{
 const h=harness();await h.manager.ready;await h.manager.clear();h.edit(s=>s.core.images.push({id:'NEW',filename:'new.png'}));await assert.rejects(()=>h.manager.undo());assert.equal(h.current.core.images[0].id,'NEW');assert.equal(h.manager.getState().canUndo,false);
});
test('navigation and selection do not disable undo and current page survives undo',async()=>{
 const h=harness();await h.manager.ready;await h.manager.clear();h.edit(s=>{s.core.activePage='compare';s.core.selectedSampleId='another';s.core.reviewOnly=true;s.savedAt='2026-10-26T01:00:00.000Z';});h.manager.changed();assert.equal(h.manager.getState().canUndo,true);await h.manager.undo();assert.equal(h.current.core.activePage,'compare');assert.equal(h.current.core.images.length,1);
});
test('failed apply keeps the existing data and does not offer a false undo',async()=>{
 const h=harness();await h.manager.ready;const before=clone(h.current);h.failApply=true;await assert.rejects(()=>h.manager.clear(),/apply failure/);assert.deepEqual(h.current,before);assert.equal(h.manager.getState().canUndo,false);assert.equal(h.manager.getState().busy,false);assert.equal(h.manager.getState().tone,'error');
});
test('storage failure is visible and still permits session undo of the successful clear',async()=>{
 const h=harness();await h.manager.ready;h.failWrite=true;const result=await h.manager.clear();assert.equal(result.saved,false);assert.equal(h.current.core.images.length,0);assert.equal(h.manager.getState().canUndo,true);assert.equal(h.manager.getState().tone,'error');h.failWrite=false;await h.manager.undo();assert.equal(h.current.core.images.length,1);
});
test('empty gallery does not alter samples or write an unnecessary replacement',async()=>{
 const h=harness();await h.manager.ready;h.edit(s=>{s.core.images=[];});const before=clone(h.current);const result=await h.manager.clear();assert.equal(result.changed,false);assert.deepEqual(h.current,before);assert.equal(h.savedPrevious.length,0);assert.equal(h.manager.getState().canUndo,false);
});
test('active operations and blocked saved state reject cleanup without any mutation',async()=>{
 for(const field of ['externalBusy','blocked']){const h=harness();await h.manager.ready;h[field]=true;const before=clone(h.current);await assert.rejects(()=>h.manager.clear());assert.deepEqual(h.current,before);assert.equal(h.savedPrevious.length,0);}
});
test('manager locks throughout asynchronous apply and ignores its own emitted changes',async()=>{
 let resolve,called=0,current=fixture(),manager;const gate=new Promise(r=>resolve=r),states=[];
 manager=createManager({capture:()=>clone(current),restore:async s=>{called++;await gate;current=clone(s);manager.changed();},parseCSV,onState:s=>states.push(clone(s))});await manager.ready;const pending=manager.clear();await Promise.resolve();assert.equal(manager.getState().busy,true);await assert.rejects(()=>manager.clear());resolve();await pending;assert.equal(called,1);assert.equal(manager.getState().busy,false);assert.equal(manager.getState().canUndo,true);assert.ok(states.some(s=>s.busy));
});

function bootUI(){
 const listeners=new Map(),watchers=[],elements=new Map();let quickBusy=false;
 function notify(target,kind,name){for(const entry of watchers)if(entry.target===target&&(kind==='childList'?entry.options.childList:entry.options.attributes&&(!entry.options.attributeFilter||entry.options.attributeFilter.includes(name)))){if(entry.observer.queued)continue;entry.observer.queued=true;queueMicrotask(()=>{entry.observer.queued=false;entry.observer.callback();});}}
 class Element{
  constructor(){this.attrs={};this.dataset={};this.handlers=new Map();this._text='';this._disabled=false;this.hidden=false;this.inert=false;}
  get textContent(){return this._text;}set textContent(value){this._text=value;notify(this,'childList');}
  get disabled(){return this._disabled;}set disabled(value){this._disabled=value;notify(this,'attributes','disabled');}
  setAttribute(name,value){this.attrs[name]=value;notify(this,'attributes',name);}
  append(){}insertAdjacentElement(){}querySelector(){return title;}addEventListener(name,fn){this.handlers.set(name,fn);}
 }
 const title=new Element(),panel=new Element(),workspace=new Element(),nav=new Element();
 for(const id of ['omClearImages','omUndoClearImages','srStatus','quickImport','uploadFiles','hfoSaveStatus'])elements.set(id,new Element());
 elements.get('srStatus').textContent='OM 기준 초과';
 const document={head:new Element(),createElement:()=>new Element(),getElementById:id=>elements.get(id)||null,querySelector:selector=>selector==='#omSelectionPanel .gallery-panel'?panel:selector==='.app-workspace'?workspace:selector==='.app-nav'?nav:null,addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},dispatchEvent:event=>{for(const fn of listeners.get(event.type)||[])fn(event);}};
 class MutationObserver{constructor(callback){this.callback=callback;this.queued=false;}observe(target,options){watchers.push({observer:this,target,options});}}
 const ui=vm.createContext({document,MutationObserver,CustomEvent:class{constructor(type,args){this.type=type;this.detail=args?.detail;}},Hfo2Autosave:{ready:Promise.resolve(),exportState:fixture,importState:async()=>({ok:true}),flush:async()=>true,getStatus:()=>({state:'saved',blocked:false})},Hfo2Bridge:{listImages:()=>fixture().core.images},Hfo2WorkflowMath:{parseCSV},Hfo2QuickImport:{isBusy:()=>quickBusy}});
 vm.runInContext(fs.readFileSync(path.join(root,'src/image_management.js'),'utf8'),ui);
 return {elements,fire:type=>document.dispatchEvent({type}),setQuickBusy(value){quickBusy=value;elements.get('quickImport').setAttribute('aria-busy',String(value));}};
}
test('clear control recovers after surface event precedes analysis finally/render',async()=>{
 const h=bootUI();await new Promise(resolve=>setImmediate(resolve));const button=h.elements.get('omClearImages'),status=h.elements.get('srStatus');assert.equal(button.disabled,false);
 status.textContent='분석 중';await Promise.resolve();assert.equal(button.disabled,true);
 h.fire('surface-reviewed');assert.equal(button.disabled,true);status.textContent='OM 기준 초과';await Promise.resolve();assert.equal(button.disabled,false);
});
test('clear control recovers after final photo-added event precedes upload busy release',async()=>{
 const h=bootUI();await new Promise(resolve=>setImmediate(resolve));const button=h.elements.get('omClearImages');h.setQuickBusy(true);await Promise.resolve();assert.equal(button.disabled,true);
 h.fire('hfo2-image-added');assert.equal(button.disabled,true);h.setQuickBusy(false);await Promise.resolve();assert.equal(button.disabled,false);
});
