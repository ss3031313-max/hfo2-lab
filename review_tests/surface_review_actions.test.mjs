// Action-handler regressions use the real correction arithmetic and minimal UI sinks.
// These software fixtures do not establish physical defect-detection accuracy.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'src/surface_review.js'),'utf8');
const pure=vm.createContext({console});vm.runInContext(source,pure);
const S=pure.Hfo2Surface;
const roi={left:15,top:15,right:85,bottom:85},reference={left:25,top:25,right:30,bottom:30};
const policy={threshold:5,minArea:16,particleMinArea:2,areaLimit:5,particleDensityLimit:10};

function extracted(name,next){
 const start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction '+next+'(',start);
 assert.ok(start>=0&&end>start,'Missing action-handler boundary: '+name);
 return source.slice(start,end);
}
const handlers=[extracted('reviewFeedback','selectReviewComponent'),extracted('applyReviewEdit','restoreReviewEdit'),extracted('restoreReviewEdit','draw')].join('\n');
function fixture(){
 const width=100,height=100,imageData=new Uint8ClampedArray(width*height*4);
 for(let i=0;i<imageData.length;i+=4){imageData[i]=imageData[i+1]=imageData[i+2]=180;imageData[i+3]=255;}
 for(const [x0,y0,size] of [[35,35,30],[20,20,2],[75,75,2]])for(let y=y0;y<y0+size;y++)for(let x=x0;x<x0+size;x++){const i=(y*width+x)*4;imageData[i]=imageData[i+1]=imageData[i+2]=40;}
 return S.analyzePixels({width,height,imageData,roi,reference,...policy});
}
function harness(){
 const raw=fixture(),mask=raw.mask,automatic={...raw};delete automatic.mask;
 const state={result:automatic,automaticResult:automatic,corrections:[],confirmation:'OVERLAY_REVIEWED'};
 const fields=new Map(),renders=[],errors=[];let emissions=0;
 function element(id){if(!fields.has(id)){const classes=new Set();fields.set(id,{value:'',textContent:'',dataset:{},classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);},contains(name){return classes.has(name);}}});}return fields.get(id);}
 const ctx=vm.createContext({console,current:'test-image',busy:false,selectedComponent:S.inspectComponent(raw,mask,{x:50,y:50}),displayCache:null,masks:new Map([['test-image',mask]]),state:()=>state,$:element,reviewMask:()=>mask,applyCorrections:S.applyCorrections,error:message=>errors.push(message),fmt:(value,d=2)=>Number.isFinite(value)?value.toFixed(d):'—',render:()=>renders.push({count:state.result.particleCount,density:state.result.particleDensityPer10k,area:state.result.areaPercent,confirmation:state.confirmation}),emit:()=>{emissions++;}});
 vm.runInContext(handlers,ctx);
 return {raw,mask,state,ctx,renders,errors,element,get emissions(){return emissions;},feedback:()=>element('srReviewFeedback'),setInput(reason='NON_PARTICLE_PATTERN',note=''){element('srCorrectionReason').value=reason;element('srCorrectionNote').value=note;},select(x,y){ctx.selectedComponent=S.inspectComponent(raw,mask,{x,y});},apply(action='EXCLUDE_COUNT'){ctx.applyReviewEdit(action);},restore(all=false){ctx.restoreReviewEdit(all);}};
}

test('missing reason rejects the edit without changing measurements or existing confirmation',()=>{
 const h=harness(),before=h.state.result;h.apply();
 assert.equal(h.state.result,before);assert.equal(h.state.corrections.length,0);assert.equal(h.state.confirmation,'OVERLAY_REVIEWED');assert.equal(h.renders.length,0);assert.equal(h.emissions,0);
 assert.equal(h.feedback().dataset.tone,'error');assert.ok(h.feedback().textContent.length>0);assert.equal(h.feedback().classList.contains('sr-hidden'),false);assert.ok(h.errors.at(-1));
});
test('successful count exclusion publishes reduced count and density while retaining area',()=>{
 const h=harness();h.setInput();h.apply();
 assert.equal(h.state.result.particleCount,2);assert.equal(h.state.automaticResult.particleCount,3);assert.equal(h.state.result.particleDensityPer10k,2/4900*10000);assert.equal(h.state.result.areaPercent,h.raw.areaPercent);
 assert.equal(h.renders.length,1);assert.equal(h.renders[0].count,2);assert.equal(h.renders[0].density,2/4900*10000);assert.equal(h.renders[0].confirmation,'UNREVIEWED');assert.equal(h.emissions,1);
 assert.equal(h.feedback().dataset.tone,'success');assert.match(h.feedback().textContent,/3 → 2/);assert.equal(h.feedback().classList.contains('sr-hidden'),false);assert.equal(h.errors.at(-1),'');
 assert.equal(h.ctx.displayCache.mask[h.ctx.selectedComponent.seed],3);
});
test('repeating the identical exclusion preserves confirmed result and does not subtract again',()=>{
 const h=harness();h.setInput('NON_PARTICLE_PATTERN','confirmed broad pattern');h.apply();h.state.confirmation='OVERLAY_REVIEWED';
 const before=h.state.result,edit=h.state.corrections[0],cache=h.ctx.displayCache;
 h.setInput('NON_PARTICLE_PATTERN','  confirmed broad pattern  ');h.apply();
 assert.equal(h.state.result,before);assert.equal(h.state.result.particleCount,2);assert.equal(h.state.corrections[0],edit);assert.equal(h.ctx.displayCache,cache);assert.equal(h.state.confirmation,'OVERLAY_REVIEWED');assert.equal(h.renders.length,1);assert.equal(h.emissions,1);assert.equal(h.feedback().dataset.tone,'info');assert.ok(h.feedback().textContent);
});
test('changing only the review note records it and requires renewed confirmation without double subtraction',()=>{
 const h=harness();h.setInput();h.apply();h.state.confirmation='OVERLAY_REVIEWED';
 h.setInput('NON_PARTICLE_PATTERN','checked against another image');h.apply();
 assert.equal(h.state.result.particleCount,2);assert.equal(h.state.corrections.length,1);assert.equal(h.state.corrections[0].note,'checked against another image');assert.equal(h.state.confirmation,'UNREVIEWED');assert.equal(h.renders.length,2);assert.equal(h.emissions,2);assert.match(h.feedback().textContent,/개수·밀도 유지/);
});
test('invalid replacement of an existing correction retains its numbers, reason and confirmation',()=>{
 const h=harness();h.setInput();h.apply();h.state.confirmation='OVERLAY_REVIEWED';const before=h.state.result,oldEdit=h.state.corrections[0];
 h.setInput('OTHER_CONFIRMED','  ');h.apply('EXCLUDE_ALL');
 assert.equal(h.state.result,before);assert.equal(h.state.corrections[0],oldEdit);assert.equal(h.state.confirmation,'OVERLAY_REVIEWED');assert.equal(h.renders.length,1);assert.equal(h.emissions,1);assert.equal(h.feedback().dataset.tone,'error');
});
test('switching an existing count exclusion to analysis exclusion changes area but subtracts no second count',()=>{
 const h=harness();h.setInput();h.apply();h.setInput('OTHER_CONFIRMED','confirmed test annotation');h.apply('EXCLUDE_ALL');
 assert.equal(h.state.result.particleCount,2);assert.equal(h.state.result.areaPercent,0);assert.equal(h.state.result.componentCount,0);assert.equal(h.state.result.roiPixelCount,4900);assert.equal(h.state.corrections.length,1);assert.equal(h.state.corrections[0].action,'EXCLUDE_ALL');assert.equal(h.renders[1].area,0);assert.equal(h.ctx.displayCache.mask[h.ctx.selectedComponent.seed],4);assert.match(h.feedback().textContent,/이미 계수에서 제외/);
});
test('selecting a different component can subtract another count and restoring one preserves the other edit',()=>{
 const h=harness();h.setInput();h.apply();h.select(20,20);h.setInput('OTHER_CONFIRMED','test small component');h.apply();
 assert.equal(h.state.result.particleCount,1);assert.equal(h.state.result.smallParticleCount,1);assert.equal(h.state.corrections.length,2);
 h.state.confirmation='OVERLAY_REVIEWED';h.restore();
 assert.equal(h.state.result.particleCount,2);assert.equal(h.state.result.smallParticleCount,2);assert.equal(h.state.corrections.length,1);assert.equal(h.state.confirmation,'UNREVIEWED');assert.equal(h.renders.at(-1).count,2);assert.equal(h.feedback().classList.contains('sr-hidden'),true);
});
test('restore all returns original counts and area and clears action feedback',()=>{
 const h=harness();h.setInput('OTHER_CONFIRMED','test annotation');h.apply('EXCLUDE_ALL');h.select(20,20);h.apply();h.restore(true);
 for(const key of ['particleCount','smallParticleCount','particleDensityPer10k','areaPercent','componentCount','largestComponentPixels'])assert.equal(h.state.result[key],h.raw[key]);
 assert.equal(h.state.corrections.length,0);assert.equal(h.state.confirmation,'UNREVIEWED');assert.equal(h.renders.at(-1).count,3);assert.equal(h.feedback().textContent,'');assert.equal(h.feedback().classList.contains('sr-hidden'),true);
});
test('busy or unselected actions cannot mutate stored results',()=>{
 for(const kind of ['busy','unselected']){const h=harness();h.setInput();const before=h.state.result;if(kind==='busy')h.ctx.busy=true;else h.ctx.selectedComponent=null;h.apply();assert.equal(h.state.result,before);assert.equal(h.state.confirmation,'OVERLAY_REVIEWED');assert.equal(h.renders.length,0);assert.equal(h.emissions,0);}
});

function selectBox(h,box){const components=S.inspectComponentsInBox(h.raw,h.mask,box);h.ctx.selectedComponent=components.length===1?components[0]:components.length?{components}:null;return components;}
test('box selection alone changes neither metrics nor confirmation',()=>{
 const h=harness(),before=h.state.result;assert.equal(selectBox(h,{x0:19,y0:19,x1:77,y1:77}).length,3);
 assert.equal(h.state.result,before);assert.equal(h.state.corrections.length,0);assert.equal(h.state.confirmation,'OVERLAY_REVIEWED');assert.equal(h.emissions,0);
});
test('bulk count exclusion subtracts selected components once while retaining area',()=>{
 const h=harness();selectBox(h,{x0:19,y0:19,x1:36,y1:36});h.setInput('OTHER_CONFIRMED','verified selection');h.apply();
 assert.equal(h.state.result.particleCount,1);assert.equal(h.state.result.areaPercent,h.raw.areaPercent);assert.equal(h.state.result.smallParticleCount,1);assert.equal(h.state.corrections.length,2);assert.equal(h.state.confirmation,'UNREVIEWED');assert.equal(h.emissions,1);
 for(const edit of h.state.corrections){assert.equal(edit.action,'EXCLUDE_COUNT');assert.equal(edit.reason,'OTHER_CONFIRMED');assert.equal(edit.note,'verified selection');assert.ok(edit.updatedAt);}
 assert.match(h.feedback().textContent,/선택 2개/);
});
test('bulk analysis exclusion removes full overlapping components, not just box pixels',()=>{
 const h=harness();selectBox(h,{x0:19,y0:19,x1:36,y1:36});h.setInput('ANNOTATION');h.apply('EXCLUDE_ALL');
 assert.equal(h.state.result.particleCount,1);assert.equal(h.state.result.areaPercent,0);assert.equal(h.state.result.roiPixelCount,h.raw.roiPixelCount);assert.equal(h.state.corrections.length,2);
 assert.equal(h.state.corrections.find(c=>c.pixelCount>10).pixelCount,900);assert.equal(h.state.confirmation,'UNREVIEWED');
});
test('repeating an identical bulk exclusion keeps metrics, audit records and confirmation',()=>{
 const h=harness();selectBox(h,{x0:19,y0:19,x1:36,y1:36});h.setInput('ANNOTATION');h.apply('EXCLUDE_ALL');h.state.confirmation='OVERLAY_REVIEWED';
 const before=h.state.result,edits=h.state.corrections;h.apply('EXCLUDE_ALL');
 assert.equal(h.state.result,before);assert.equal(h.state.corrections,edits);assert.equal(h.state.confirmation,'OVERLAY_REVIEWED');assert.equal(h.emissions,1);
});
test('invalid bulk exclusion remains atomic for every selected component',()=>{
 const h=harness(),before=h.state.result;selectBox(h,{x0:19,y0:19,x1:77,y1:77});h.setInput('OTHER_CONFIRMED','');h.apply('EXCLUDE_ALL');
 assert.equal(h.state.result,before);assert.equal(h.state.corrections.length,0);assert.equal(h.state.confirmation,'OVERLAY_REVIEWED');assert.equal(h.emissions,0);assert.equal(h.feedback().dataset.tone,'error');
});
test('excluded components remain selectable for bulk restore and restore-all keeps remaining edits correct',()=>{
 const h=harness();selectBox(h,{x0:19,y0:19,x1:77,y1:77});h.setInput('ANNOTATION');h.apply('EXCLUDE_ALL');assert.equal(h.state.result.particleCount,0);
 const selected=selectBox(h,{x0:19,y0:19,x1:36,y1:36});assert.equal(selected.length,2);h.state.confirmation='OVERLAY_REVIEWED';h.restore();
 assert.equal(h.state.result.particleCount,2);assert.equal(h.state.result.areaPercent,h.raw.areaPercent);assert.equal(h.state.corrections.length,1);assert.equal(h.state.confirmation,'UNREVIEWED');
 h.restore(true);assert.equal(h.state.result.particleCount,3);assert.equal(h.state.corrections.length,0);assert.equal(h.state.result.areaPercent,h.raw.areaPercent);
});

function syncHarness(){
 const raw=fixture(),mask=raw.mask,automatic={...raw};delete automatic.mask;
 let selectedImage='image-A',currentROI={...roi};
 const initial={roiKey:JSON.stringify(currentROI),result:automatic,automaticResult:automatic,corrections:[],confirmation:'OVERLAY_REVIEWED',autoReason:''};
 const states=new Map([['image-A',initial]]),classes=new Set(),renders=[],feedback={textContent:'',dataset:{},classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);},contains(name){return classes.has(name);}}};
 const ctx=vm.createContext({current:'image-A',states,masks:new Map([['image-A',mask]]),drag:{active:true},selectedComponent:S.inspectComponent(raw,mask,{x:50,y:50}),displayCache:{id:'image-A'},B:{getSelectedImageId:()=>selectedImage},roiKey:()=>JSON.stringify(currentROI),$:()=>feedback,error:()=>{},render:updateInputs=>renders.push(updateInputs),emit:()=>{}});
 ctx.state=(id=ctx.current)=>{if(!states.has(id))states.set(id,{roiKey:'',result:null,automaticResult:null,corrections:[],confirmation:'UNREVIEWED',autoReason:''});return states.get(id);};
 vm.runInContext(extracted('reviewFeedback','selectReviewComponent')+'\n'+extracted('sync','readRefInputs'),ctx);
 ctx.reviewFeedback('applied to image-A','success');
 return {ctx,states,initial,feedback,renders,select:id=>{selectedImage=id;},setROI:value=>{currentROI=value;},sync:()=>ctx.sync()};
}
test('switching images clears feedback from the previous image without discarding its result',()=>{
 const h=syncHarness(),before=h.initial.result;h.select('image-B');h.sync();
 assert.equal(h.ctx.current,'image-B');assert.equal(h.feedback.textContent,'');assert.equal(h.feedback.classList.contains('sr-hidden'),true);
 assert.equal(h.initial.result,before);assert.equal(h.ctx.selectedComponent,null);assert.equal(h.ctx.displayCache,null);assert.equal(h.renders.at(-1),true);
});
test('removing image selection clears feedback including an already-empty selection',()=>{
 const h=syncHarness();h.select('');h.sync();
 assert.equal(h.ctx.current,'');assert.equal(h.feedback.textContent,'');assert.equal(h.feedback.classList.contains('sr-hidden'),true);
 h.ctx.reviewFeedback('stale message','error');h.sync();
 assert.equal(h.feedback.textContent,'');assert.equal(h.feedback.classList.contains('sr-hidden'),true);assert.equal(h.renders.at(-1),true);
});
test('changing the ROI clears feedback when invalidating the current analysis',()=>{
 const h=syncHarness();h.setROI({...roi,right:80});h.sync();
 assert.equal(h.ctx.current,'image-A');assert.equal(h.feedback.textContent,'');assert.equal(h.feedback.classList.contains('sr-hidden'),true);
 assert.equal(h.initial.result,null);assert.equal(h.initial.automaticResult,null);assert.equal(h.initial.confirmation,'UNREVIEWED');assert.equal(h.ctx.masks.has('image-A'),false);assert.equal(h.ctx.selectedComponent,null);assert.equal(h.renders.at(-1),false);
});
test('unrelated same-image same-ROI synchronization preserves current action feedback and result',()=>{
 const h=syncHarness(),before=h.initial.result,selected=h.ctx.selectedComponent;h.sync();
 assert.equal(h.feedback.textContent,'applied to image-A');assert.equal(h.feedback.dataset.tone,'success');assert.equal(h.feedback.classList.contains('sr-hidden'),false);
 assert.equal(h.initial.result,before);assert.equal(h.initial.confirmation,'OVERLAY_REVIEWED');assert.equal(h.ctx.selectedComponent,selected);assert.equal(h.renders.at(-1),false);
});
