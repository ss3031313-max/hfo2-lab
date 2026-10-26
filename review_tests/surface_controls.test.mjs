// UI behavior and state-preservation checks; not physical OM validation.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'src/surface_review.js'),'utf8');
function policyHarness(){
 const result={threshold:5,minArea:16,particleMinArea:2,areaPercent:4,particleCount:2,smallParticleCount:1,particleDensityPer10k:80,referenceSpreadPercent:0.1};
 const seededState={reference:{left:10,top:10,right:20,bottom:20},referenceSource:'MANUAL',result,automaticResult:result,corrections:[{seed:1,bounds:{x0:1,y0:1,x1:3,y1:3}}],confirmation:'OVERLAY_REVIEWED'};
 const savedMask=new Uint8Array([1,2]),ctx=vm.createContext({console,seededState,savedMask});
 vm.runInContext(source.replace('const publicAPI=',"states.set('test',seededState);masks.set('test',savedMask);root.testInternals={states,masks,setBusy:v=>busy=v};const publicAPI="),ctx);
 return {ctx,S:ctx.Hfo2Surface,state:seededState,mask:savedMask};
}
test('judgment limits preserve results, mask, exclusions and confirmation while regrading',()=>{
 const h=policyHarness(),before=h.state.result,corrections=h.state.corrections;
 assert.equal(h.S.getAssessment('test').state,'fail');
 h.S.applyJudgmentLimits({areaLimit:5,particleDensityLimit:100});
 assert.equal(h.S.getAssessment('test').state,'pass');
 assert.equal(h.state.result,before);assert.equal(h.state.corrections,corrections);assert.equal(h.state.confirmation,'OVERLAY_REVIEWED');
 assert.equal(h.ctx.testInternals.masks.get('test'),h.mask);
 const p=h.S.getPolicy();assert.equal(p.threshold,5);assert.equal(p.minArea,16);assert.equal(p.particleMinArea,2);assert.equal(p.particleDensityLimit,100);
});
test('invalid or missing judgment limit is atomic and leaves prior policy untouched',()=>{
 for(const limits of [{areaLimit:101,particleDensityLimit:100},{areaLimit:5,particleDensityLimit:-1},{areaLimit:'',particleDensityLimit:10},{areaLimit:5},{areaLimit:5,particleDensityLimit:Infinity}]){
  const h=policyHarness(),before=JSON.stringify(h.S.getPolicy());assert.throws(()=>h.S.applyJudgmentLimits(limits));assert.equal(JSON.stringify(h.S.getPolicy()),before);assert.equal(h.state.confirmation,'OVERLAY_REVIEWED');
 }
});
test('judgment limit update rejects an in-progress analysis without partial mutation',()=>{
 const h=policyHarness();h.ctx.testInternals.setBusy(true);assert.throws(()=>h.S.applyJudgmentLimits({areaLimit:8,particleDensityLimit:100}),/완료/);assert.equal(h.S.getPolicy().areaLimit,5);assert.equal(h.S.getPolicy().particleDensityLimit,10);
});
function uiPolicyHarness(){
 const fields=new Map(Object.entries({srThreshold:'5',srMinArea:'16',srParticleMinArea:'2',srAreaLimit:'5',srParticleDensityLimit:'10'}).map(([k,value])=>[k,{value}]));
 let renders=0,events=0;
 const ctx=vm.createContext({console,root:{Hfo2Bridge:{}},MAX_PIXELS:20000000,busy:false,policy:{threshold:5,minArea:16,particleMinArea:2,areaLimit:5,particleDensityLimit:10},policyError:'',$:id=>fields.get(id),document:{getElementById:id=>fields.get(id)},render:()=>renders++,emit:()=>events++,error:()=>{},getPolicy:()=>({...ctx.policy})});
 const num=source.slice(source.indexOf('function num('),source.indexOf('\nfunction bounds('));
 const normalize=source.slice(source.indexOf('function normalizePolicy('),source.indexOf('\nfunction assessResult('));
 const apply=source.slice(source.indexOf('function applyJudgmentLimits('),source.indexOf('\nfunction getAssessment('));
 vm.runInContext(num+'\n'+normalize+'\n'+apply,ctx);
 return {ctx,fields,get renders(){return renders;},get events(){return events;}};
}
test('silent limit update synchronizes OM inputs and renders once without an intermediate event',()=>{
 const h=uiPolicyHarness();h.ctx.applyJudgmentLimits({areaLimit:7,particleDensityLimit:100},{emit:false});assert.equal(h.fields.get('srAreaLimit').value,'7');assert.equal(h.fields.get('srParticleDensityLimit').value,'100');assert.equal(h.renders,1);assert.equal(h.events,0);
});
test('an invalid or uncommitted detection draft cannot be silently discarded by inline limits',()=>{
 for(const value of ['', '6']){const h=uiPolicyHarness();h.fields.get('srThreshold').value=value;assert.throws(()=>h.ctx.applyJudgmentLimits({areaLimit:7,particleDensityLimit:100}));assert.equal(h.ctx.policy.areaLimit,5);assert.equal(h.fields.get('srAreaLimit').value,'5');assert.equal(h.renders,0);assert.equal(h.events,0);}
});
test('corrected limit values recover a limit-only input error and emit one update',()=>{
 const h=uiPolicyHarness();h.ctx.policyError='limit error';h.fields.get('srAreaLimit').value='';h.ctx.applyJudgmentLimits({areaLimit:7,particleDensityLimit:100});assert.equal(h.ctx.policyError,'');assert.equal(h.renders,1);assert.equal(h.events,1);
});
function dragHarness(){
 const applied=[],boxes=[],points=[],selections=[],errors=[];
 let draws=0,prevents=0,pixelsAvailable=true,resultAvailable=true;
 const result={width:100,height:100,areaPercent:0.04,particleCount:11,particleDensityPer10k:0.28};
 const reviewState={result,automaticResult:result,confirmation:'OVERLAY_REVIEWED',reference:{left:10,top:10,right:20,bottom:20}};
 function canvas(id){const handlers={};return {id,width:100,height:100,handlers,captured:[],addEventListener(type,fn){handlers[type]=fn;},getBoundingClientRect:()=>({left:100,top:200,width:400,height:200}),setPointerCapture(id){this.captured.push(id);},releasePointerCapture(){}};}
 const left=canvas('srOriginal'),right=canvas('srResult'),nodes={srOriginal:left,srResult:right};
 const ctx=vm.createContext({console,drag:null,suppressResultClick:false,busy:false,policyError:'',current:'test',$:id=>nodes[id],B:{getPixels:()=>pixelsAvailable?{width:100,height:100}:null},draw:()=>draws++,applyReference:r=>applied.push({...r}),state:()=>({...reviewState,result:resultAvailable?result:null}),reviewMask:()=>{},masks:new Map([['test',[]]]),inspectComponent:(r,m,p)=>{points.push({...p});return {seed:1};},inspectComponentsInBox:(r,m,b)=>{boxes.push({...b});return [{seed:1},{seed:2}];},selectReviewComponent:c=>selections.push(c?[{...c}]:[]),selectReviewComponents:items=>selections.push(Array.from(items,c=>({...c}))),reviewFeedback:()=>{},error:message=>errors.push(message)});
 const begin=source.indexOf('function referencePointerPosition('),end=source.indexOf("\n$('srAnalyze').addEventListener",begin);
 const click=source.split('\n').find(line=>line.startsWith("$('srResult').addEventListener('click'"));
 vm.runInContext(source.slice(begin,end)+'\n'+click,ctx);
 function event(canvas,x,y,pointerId=1,button=0){return {clientX:100+x*4,clientY:200+y*2,pointerId,button,isPrimary:true,currentTarget:canvas,target:canvas,preventDefault(){prevents++;}};}
 function fire(canvas,type,x,y,pointerId=1,button=0){canvas.handlers[type]?.(event(canvas,x,y,pointerId,button));}
 return {ctx,left,right,applied,boxes,points,selections,errors,reviewState,result,fire,setPixels:v=>{pixelsAvailable=v;},setResult:v=>{resultAvailable=v;},get draws(){return draws;},get prevents(){return prevents;}};
}
test('right box drag selects connected regions without changing the reference or measurements',()=>{
 const h=dragHarness(),before=JSON.stringify(h.reviewState);
 h.fire(h.right,'pointerdown',20,20);h.fire(h.right,'pointermove',40,40);h.fire(h.right,'pointerup',40,40);
 assert.equal(h.applied.length,0);assert.deepEqual(h.boxes,[{x0:20,y0:20,x1:40,y1:40}]);assert.equal(h.selections.length,1);assert.equal(h.selections[0].length,2);
 assert.equal(JSON.stringify(h.reviewState),before);assert.equal(h.ctx.drag,null);assert.deepEqual(h.right.captured,[1]);
});
test('right reversed drag maps scaled screen coordinates to image pixel coordinates',()=>{
 const h=dragHarness();h.fire(h.right,'pointerdown',60,70);h.fire(h.right,'pointermove',25,30);h.fire(h.right,'pointerup',25,30);
 assert.deepEqual(h.boxes,[{x0:25,y0:30,x1:60,y1:70}]);assert.equal(h.applied.length,0);
 h.fire(h.right,'click',25,30);assert.equal(h.selections.length,1);
});
test('left drag changes only the reference and remains in percentage coordinates',()=>{
 const h=dragHarness();h.fire(h.left,'pointerdown',15,20);h.fire(h.left,'pointerup',25,35);
 assert.deepEqual(h.applied,[{left:15,top:20,right:25,bottom:35}]);assert.equal(h.selections.length,0);assert.equal(h.boxes.length,0);
});
test('events from a different canvas or pointer cannot complete an active drag',()=>{
 for(const side of ['left','right']){
  const h=dragHarness(),canvas=h[side],other=h[side==='left'?'right':'left'];
  h.fire(canvas,'pointerdown',15,20);h.fire(other,'pointerup',40,40);h.fire(canvas,'pointerup',40,40,2);
  assert.equal(h.applied.length,0);assert.equal(h.selections.length,0);
  h.fire(canvas,'pointerup',25,35);assert.equal(h.applied.length+h.selections.length,1);
 }
});
test('cancelling right selection changes nothing and nonprimary buttons never start a drag',()=>{
 const h=dragHarness();h.fire(h.right,'pointerdown',15,20,1,2);assert.equal(h.ctx.drag,null);
 h.fire(h.right,'pointerdown',15,20);h.fire(h.right,'pointercancel',25,35);h.fire(h.right,'pointerup',25,35);
 assert.equal(h.applied.length,0);assert.equal(h.selections.length,0);assert.equal(h.ctx.drag,null);
});
test('busy analysis blocks both canvas interactions',()=>{
 const h=dragHarness();h.ctx.busy=true;
 for(const c of [h.left,h.right]){h.fire(c,'pointerdown',15,20);h.fire(c,'pointerup',25,35);}
 assert.equal(h.applied.length,0);assert.equal(h.selections.length,0);assert.equal(h.ctx.drag,null);
});
test('missing pixels block both canvases and missing analysis blocks only right selection',()=>{
 const h=dragHarness();h.setPixels(false);
 for(const c of [h.left,h.right]){h.fire(c,'pointerdown',15,20);h.fire(c,'pointerup',25,35);}
 assert.equal(h.applied.length,0);assert.equal(h.selections.length,0);
 h.setPixels(true);h.setResult(false);h.fire(h.right,'pointerdown',15,20);h.fire(h.right,'pointerup',25,35);
 assert.equal(h.selections.length,0);h.fire(h.left,'pointerdown',15,20);h.fire(h.left,'pointerup',25,35);assert.equal(h.applied.length,1);
});
test('tiny right movement acts as a single click and suppresses the browser follow-up click',()=>{
 const h=dragHarness();h.fire(h.right,'pointerdown',20,20);h.fire(h.right,'pointerup',20.1,20.1);
 assert.equal(h.boxes.length,0);assert.equal(h.points.length,1);assert.equal(h.selections.length,1);assert.equal(h.selections[0].length,1);
 h.fire(h.right,'click',20.1,20.1);assert.equal(h.selections.length,1);assert.equal(h.applied.length,0);
});
test('a direct right click still supports individual connected-component inspection',()=>{
 const h=dragHarness();h.fire(h.right,'click',30,40);
 assert.equal(h.points.length,1);assert.equal(h.selections.length,1);assert.equal(h.boxes.length,0);assert.equal(h.applied.length,0);
});
