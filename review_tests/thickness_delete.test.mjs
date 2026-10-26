// Removal must update the registration queue and analyzed records together.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const template=fs.readFileSync(path.join(root,'src/om_app.template.html'),'utf8');
const intake=fs.readFileSync(path.join(root,'src/intake.js'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function setup({confirm=true}={}){
 const elements=new Map(),events=[],prompts=[],listeners=new Map();
 const node=id=>{if(!elements.has(id))elements.set(id,{value:'',files:[],children:[],textContent:'',hidden:false,disabled:false,checked:false,replaceChildren(){this.children=[];}});return elements.get(id);};
 const document={getElementById:node,querySelector:()=>null,querySelectorAll:()=>[],activeElement:null,dispatchEvent:event=>{events.push(event.type);for(const cb of listeners.get(event.type)||[])cb(event);},addEventListener:(type,cb)=>listeners.set(type,[...(listeners.get(type)||[]),cb])};
 const context=vm.createContext({console,document,structuredClone,Event,CustomEvent:class{constructor(type){this.type=type;}},confirm:message=>{prompts.push(message);return confirm;}});
 vm.runInContext('globalThis.window=globalThis',context);
 for(const id of ['om-math','workflow-math'])vm.runInContext(template.match(new RegExp('<script id="'+id+'">([\\s\\S]*?)</script>'))[1],context);
 const coreCode=template.slice(template.indexOf('function setThicknessData('),template.indexOf('async function importCoreState('));
 vm.runInContext(`let joined=[],selectedSample='',selected='OM-A',records=[{id:'OM-A',filename:'A.png'},{id:'OM-B',filename:'B.png'}],combinedScreening=false,metaFilename='meta',thickFilename='thickness';
 const byId=id=>document.getElementById(id);function selectedRecord(){return joined.find(s=>s.id===selectedSample);}function render(){document.dispatchEvent(new Event('wf-rendered'));}
 ${coreCode}
 globalThis.Hfo2Bridge={getSamples:()=>structuredClone(joined),getSelectedSampleId:()=>selectedSample,listImages:()=>structuredClone(records),getImage:id=>records.find(s=>s.id===id),isCombinedScreening:()=>combinedScreening,getRule:()=>({target:15,tolerance:2,cvLimit:10}),setThicknessData,exportState:exportCoreState,navigate:()=>{},applyCSVs:(meta,thickness)=>{joined=Hfo2WorkflowMath.join(meta,thickness,records.map(r=>r.id)).samples;render();}};
 globalThis.TestCore={set:(samples,id)=>{joined=structuredClone(samples);selectedSample=id||samples[0]?.id||'';},select:id=>{selectedSample=id;render();},edit:(id,values)=>{const s=joined.find(s=>s.id===id);s.points=values.map((value,i)=>({position:'P'+i,value}));s.stats=OMDemoMath.thickness(values);render();}};`,context);
 const prefix=intake.slice(0,intake.indexOf('const css='));
 const stateFns=intake.slice(intake.indexOf('function exportState('),intake.indexOf('function readForm('));
 const runFn=intake.split('\n').find(line=>line.startsWith('function runAnalysis('));
 const fields=['intakeSampleId','intakeSource','intakeConcentration','intakeCoats','intakeRpm','intakeSpinTime','intakeAnnealTemp','intakeAnnealTime','intakeImage'];
 for(const id of fields)node(id).value='';
 for(const [id,value] of Object.entries({wfTarget:'15',wfTolerance:'2',wfCV:'10',roiMode:'full',roiLeft:'0',roiTop:'0',roiRight:'100',roiBottom:'100'}))node(id).value=value;
 vm.runInContext(prefix+`
 function renderQueue(){updateThicknessControls();}function renderAnalysis(){updateThicknessControls();}
 function refreshImages(){}function updatePositionCount(){}function updateSourceHint(){}function updatePhoto(){}
 function appendPosition(position,thickness_nm){$('intakePositions').children.push({querySelector:key=>({value:key==='[data-position]'?position:thickness_nm})});}
 ${stateFns}\n${runFn}
 document.addEventListener('wf-rendered',()=>{if(!internal&&!dirty){queue=B.getSamples();renderQueue();}renderAnalysis();});
 ${intake.split('\n').find(line=>line.startsWith("document.addEventListener('hfo2-import-busy'"))}
 globalThis.Hfo2Intake={deleteThickness,undoThicknessDeletion,exportState,importState,csvFor,rowsFor,setQueue,runAnalysis,getQueue:()=>clone(queue),updateThicknessControls};
 globalThis.TestIntake={init:(samples,pending=false,oldUndo=null)=>{queue=clone(samples);dirty=pending;undoQueue=clone(oldUndo);thicknessUndo=null;thicknessMessage='';updateThicknessControls();},isDirty:()=>dirty};})();`,context);
 const sample=(id,values=[14.8,15,15.2],extra={})=>({id,image_id:id==='A'?'OM-A':'OM-B',concentration_M:.2,coats:1,rpm:3000,spin_time_s:30,anneal_temp_C:550,anneal_time_min:120,data_source:'REAL_MEASUREMENT',points:values.map((value,i)=>({position:'P'+i,value})),stats:values.length?plain(context.OMDemoMath.thickness(values)):null,...extra});
 const init=(samples,queued=samples,{dirty=false,undo=null}={})=>{context.TestCore.set(samples);context.TestIntake.init(queued,dirty,undo);};
 return {context,I:context.Hfo2Intake,B:context.Hfo2Bridge,node,events,prompts,sample,init};
}
function assertEmpty(sample){assert.deepEqual(plain(sample.points),[]);assert.equal(sample.stats,null);assert.equal(Boolean(sample.editText),false);assert.equal(Boolean(sample.editError),false);}
test('selected deletion clears only its thickness and keeps recipe, image and other samples',()=>{
 const t=setup(),a=t.sample('A'),b=t.sample('B');t.init([a,b],[a,b],{undo:[a,b]});
 assert.equal(t.I.deleteThickness('selected'),true);
 for(const samples of [t.B.getSamples(),t.I.getQueue()]){assertEmpty(samples[0]);assert.deepEqual(plain(samples[1]),b);assert.equal(samples[0].image_id,'OM-A');for(const key of ['concentration_M','coats','rpm','spin_time_s','anneal_temp_C','anneal_time_min','data_source'])assert.equal(samples[0][key],a[key]);}
 assert.deepEqual(plain(t.B.listImages()),[{id:'OM-A',filename:'A.png'},{id:'OM-B',filename:'B.png'}]);
 assert.equal(t.I.exportState().undoQueue,null);assert.equal(t.node('intakeDeleteSelectedThickness').disabled,true);assert.equal(t.node('intakeDeleteAllThickness').disabled,false);assert.equal(t.node('intakeUndoThickness').disabled,false);
 assert.match(t.prompts[0],/선택 시편 A/);assert.match(t.prompts[0],/분석 결과: 1개 시편 · 3개 위치/);assert.match(t.prompts[0],/등록 목록: 1개 시편 · 3개 위치/);
 assert.ok(t.events.includes('wf-rendered'));assert.ok(t.events.includes('intake-changed'));
});
test('canceling either confirmation is a no-op including the previous undo snapshot',()=>{
 for(const scope of ['selected','all']){const t=setup({confirm:false}),a=t.sample('A'),b=t.sample('B');t.init([a,b],[a,b],{undo:[a]});const before=JSON.stringify([t.B.exportState(),t.I.exportState()]);assert.equal(t.I.deleteThickness(scope),false);assert.equal(JSON.stringify([t.B.exportState(),t.I.exportState()]),before);assert.equal(t.events.length,0);assert.equal(t.prompts.length,1);}
});
test('all deletion includes pending registrations and analyzed-only samples without applying drafts',()=>{
 const t=setup(),a=t.sample('A'),b=t.sample('B'),c=t.sample('C',[18,19]);t.init([a,b],[{...a,coats:4},c],{dirty:true});
 assert.equal(t.I.deleteThickness('all'),true);t.B.getSamples().forEach(assertEmpty);t.I.getQueue().forEach(assertEmpty);
 assert.equal(t.B.getSamples()[0].coats,1);assert.equal(t.I.getQueue()[0].coats,4);assert.equal(t.context.TestIntake.isDirty(),true);
 assert.deepEqual(t.B.getSamples().map(s=>s.id),['A','B']);assert.deepEqual(plain(t.I.getQueue().map(s=>s.id)),['A','C']);
 assert.match(t.prompts[0],/전체 3개 시편/);assert.match(t.prompts[0],/분석 결과: 2개 시편 · 6개 위치/);assert.match(t.prompts[0],/등록 목록: 2개 시편 · 5개 위치/);
 assert.equal(t.node('intakeDeleteAllThickness').disabled,true);assert.equal(t.I.deleteThickness('all'),false);assert.equal(t.prompts.length,1);
});
test('invalid editor text and stale statistics are removed even with no valid points',()=>{
 const t=setup(),a=t.sample('DEMO-invalid',[],{data_source:'SYNTHETIC',editText:'15,broken',editError:'잘못된 값',stats:null});t.init([a]);t.node('wfEditValues').value=a.editText;t.context.document.activeElement=t.node('wfEditValues');
 assert.equal(t.node('intakeDeleteSelectedThickness').disabled,false);t.I.deleteThickness('selected');assertEmpty(t.B.getSamples()[0]);assertEmpty(t.I.getQueue()[0]);assert.equal(t.node('wfEditValues').value,'');assert.deepEqual(plain(t.B.exportState().invalidEdits),[]);
});
test('rerunning analysis, export and restore cannot resurrect cleared values',()=>{
 const t=setup(),a=t.sample('A'),b=t.sample('B');t.init([a,b],[a,b],{undo:[a,b]});t.I.deleteThickness('all');
 const savedIntake=plain(t.I.exportState()),savedCore=plain(t.B.exportState());assert.equal(savedIntake.undoQueue,null);assert.equal(savedCore.invalidEdits.length,0);assert.equal(savedCore.thicknessCsv.trim().split('\n').length,1);
 t.I.runAnalysis();t.B.getSamples().forEach(assertEmpty);t.I.getQueue().forEach(assertEmpty);
 const restored=t.context.Hfo2WorkflowMath.join(savedCore.metadataCsv,savedCore.thicknessCsv,t.B.listImages().map(r=>r.id),true).samples;t.context.TestCore.set(restored);t.I.importState(savedIntake);
 t.B.getSamples().forEach(assertEmpty);t.I.getQueue().forEach(assertEmpty);assert.equal(t.node('intakeUndoThickness').disabled,true);assert.equal(t.I.undoThicknessDeletion(),false);
});
test('one-step undo restores the exact queue and results, including invalid edits and pending state',()=>{
 const t=setup(),a=t.sample('A'),b=t.sample('DEMO-invalid',[],{data_source:'SYNTHETIC',editText:'bad',editError:'오류'});t.init([a,b],[{...a,coats:4},b],{dirty:true});const before=plain([t.B.getSamples(),t.I.getQueue()]);
 t.I.deleteThickness('all');assert.equal(t.I.undoThicknessDeletion(),true);assert.deepEqual(plain([t.B.getSamples(),t.I.getQueue()]),before);assert.equal(t.context.TestIntake.isDirty(),true);assert.equal(t.I.undoThicknessDeletion(),false);assert.equal(t.node('intakeUndoThickness').disabled,true);
});
test('another thickness edit or registration invalidates undo so new work cannot be overwritten',()=>{
 for(const kind of ['edit','registration']){const t=setup(),a=t.sample('A'),b=t.sample('B');t.init([a,b]);t.I.deleteThickness('selected');if(kind==='edit')t.context.TestCore.edit('B',[17,17]);else t.I.setQueue([...t.I.getQueue(),t.sample('C')]);const current=plain([t.B.getSamples(),t.I.getQueue()]);assert.equal(t.I.undoThicknessDeletion(),false);assert.deepEqual(plain([t.B.getSamples(),t.I.getQueue()]),current);assert.equal(t.node('intakeUndoThickness').disabled,true);}
});
test('changing selection preserves undo and empty states disable deletion',()=>{
 const t=setup(),a=t.sample('A'),b=t.sample('B');t.init([a,b]);t.I.deleteThickness('selected');t.context.TestCore.select('B');assert.equal(t.node('intakeDeleteSelectedThickness').disabled,false);assert.equal(t.I.undoThicknessDeletion(),true);
 t.init([t.sample('A',[])]);assert.equal(t.node('intakeDeleteSelectedThickness').disabled,true);assert.equal(t.node('intakeDeleteAllThickness').disabled,true);t.init([]);assert.equal(t.node('intakeDeleteSelectedThickness').disabled,true);assert.equal(t.node('intakeDeleteAllThickness').disabled,true);
});
test('management actions are visible on thickness analysis and use existing persistence/preview events',()=>{
 for(const id of ['intakeDeleteSelectedThickness','intakeDeleteAllThickness','intakeUndoThickness'])assert.match(intake,new RegExp('id="'+id+'"'));
 assert.match(intake,/intakeDeleteSelectedThickness'\)\.addEventListener\('click',\(\)=>deleteThickness\('selected'\)\)/);
 assert.match(intake,/intakeDeleteAllThickness'\)\.addEventListener\('click',\(\)=>deleteThickness\('all'\)\)/);
 for(const file of ['src/quick_import.js','src/autosave.js'])assert.match(fs.readFileSync(path.join(root,file),'utf8'),/intake-changed/);
 const mutation=template.slice(template.indexOf('function setThicknessData('),template.indexOf('function exportCoreState('));assert.doesNotMatch(mutation,/records\.|Hfo2Surface|clearSamples|applyCSVs/);
});

test('first-page preview refreshes from the cleared queue and image remapping does not reload old workbook values',()=>{
 const t=setup(),a=t.sample('A'),b=t.sample('B');t.init([a,b]);
 const quick=fs.readFileSync(path.join(root,'src/quick_import.js'),'utf8'),pureContext=vm.createContext({});vm.runInContext(quick,pureContext);t.context.resolveMappings=pureContext.Hfo2QuickImport.resolveMappings;
 const helpers=quick.slice(quick.indexOf('function queueSignature('),quick.indexOf('function setBusy('));
 const refreshCode=quick.slice(quick.indexOf('function rawForQueue('),quick.indexOf('function refreshResultPhotos('));
 vm.runInContext(`(function(){const root=window,B=Hfo2Bridge,I=Hfo2Intake,$=id=>document.getElementById(id),escape=value=>String(value??''),fmt=(value,d=1)=>Number.isFinite(value)?value.toFixed(d):'—';
 let busy=false,applyingQueue=false,lastSignature='',workbookLabel='엑셀 2개',workbookNames=['old.xlsx'],hints=new Map([['A',{image_filename:'A.png'}]]),manual={},latestMatches=[];
 ${helpers}\n${refreshCode}
 lastSignature=queueSignature(I.getQueue());refresh();
 for(const event of ['intake-changed','wf-rendered'])document.addEventListener(event,()=>{if(!applyingQueue)refresh();});
 globalThis.TestQuick={refresh,resolveCurrentQueue};})();`,t.context);
 assert.match(t.node('quickPreview').innerHTML,/평균 15.00 nm/);t.I.deleteThickness('all');
 assert.doesNotMatch(t.node('quickPreview').innerHTML,/평균 15.00 nm/);assert.equal((t.node('quickPreview').innerHTML.match(/두께 미입력/g)||[]).length,2);assert.equal(t.node('quickExcelNames').textContent,'');
 t.context.TestQuick.resolveCurrentQueue();t.I.getQueue().forEach(assertEmpty);t.I.runAnalysis();t.B.getSamples().forEach(assertEmpty);assert.doesNotMatch(t.node('quickPreview').innerHTML,/평균 15.00 nm/);
});

test('async workbook/OM work blocks deletion and undo, then reenables controls when it settles',()=>{
 const t=setup(),a=t.sample('A'),b=t.sample('B');t.init([a,b]);t.I.deleteThickness('selected');
 const before=JSON.stringify([t.B.exportState(),t.I.exportState()]),promptCount=t.prompts.length;
 const quick=fs.readFileSync(path.join(root,'src/quick_import.js'),'utf8'),setBusy=quick.split('\n').find(line=>line.startsWith('function setBusy('));
 vm.runInContext(`(function(){let busy=false;const panel={setAttribute:()=>{}},manualDetails={},$=id=>document.getElementById(id);function refresh(){}${setBusy}
 window.Hfo2QuickImport={isBusy:()=>busy};window.TestBusy={set:setBusy,silent:value=>{busy=value;}};})();`,t.context);
 // The event disables already-visible controls immediately, including the undo button.
 t.context.TestBusy.set(true);
 for(const id of ['intakeDeleteSelectedThickness','intakeDeleteAllThickness','intakeUndoThickness'])assert.equal(t.node(id).disabled,true);
 for(const scope of ['selected','all'])assert.equal(t.I.deleteThickness(scope),false);
 assert.equal(t.I.undoThicknessDeletion(),false);assert.equal(t.prompts.length,promptCount);assert.equal(JSON.stringify([t.B.exportState(),t.I.exportState()]),before);
 // Completion/failed-analysis cleanup re-enables controls without requiring navigation.
 t.context.TestBusy.set(false);assert.equal(t.node('intakeDeleteSelectedThickness').disabled,true);assert.equal(t.node('intakeDeleteAllThickness').disabled,false);assert.equal(t.node('intakeUndoThickness').disabled,false);
 // The entry guard also protects a stale enabled button if no render/event has happened yet.
 t.context.TestBusy.silent(true);assert.equal(t.node('intakeDeleteAllThickness').disabled,false);assert.equal(t.I.deleteThickness('all'),false);assert.equal(t.I.undoThicknessDeletion(),false);assert.equal(JSON.stringify([t.B.exportState(),t.I.exportState()]),before);
 t.context.TestBusy.set(false);assert.equal(t.I.undoThicknessDeletion(),true);assert.deepEqual(plain(t.B.getSamples()),[a,b]);
});
