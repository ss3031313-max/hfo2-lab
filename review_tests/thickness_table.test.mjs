// Thickness UI must remain independent of OM; explicit screening retains the combined decision.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const template=fs.readFileSync(path.join(root,'src/om_app.template.html'),'utf8');
const rule={target:15,tolerance:2,cvLimit:10};
function setup(){
 const nodes=new Map(),surface=new Map();let context;
 function node(id){if(nodes.has(id))return nodes.get(id);const classes=new Set();let html='';
  const n={id,value:'',checked:false,hidden:false,dataset:{},rows:[],textContent:'',classList:{add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x)),toggle:(k,b)=>b?classes.add(k):classes.delete(k),contains:k=>classes.has(k)},querySelectorAll:()=>n.rows};
  Object.defineProperty(n,'innerHTML',{get:()=>html,set:value=>{html=value;if(id==='wfSampleTable')n.rows=[...value.matchAll(/<tr data-wf-id="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)].map(m=>{
   const cls=new Set(),cells=new Map();for(const key of ['data-om-assessment','data-combined-assessment'])if(m[2].includes(key))cells.set('['+key+']',{innerHTML:'',style:{}});
   return {dataset:{wfId:m[1]},classList:{add:(...v)=>v.forEach(x=>cls.add(x)),remove:(...v)=>v.forEach(x=>cls.delete(x)),contains:k=>cls.has(k)},querySelector:key=>cells.get(key)||null};
  });}});nodes.set(id,n);return n;
 }
 context=vm.createContext({console,Event,combinedScreening:false,joined:[],selectedSample:'',records:[],ruleError:'',byId:node,escape:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),format:(v,d=2)=>v==null?'—':Number(v).toFixed(d),srcLabel:s=>s,errorBox:()=>{},preview:()=>{},selectImage:()=>{},currentRule:()=>rule,groupAssessments:()=>[],Hfo2Surface:{getAssessment:id=>surface.get(id)},document:{activeElement:null,dispatchEvent:event=>{if(event.type==='wf-rendered')context.updateOMPresentation();}}});
 vm.runInContext('globalThis.window=globalThis',context);
 for(const id of ['om-math','workflow-math'])vm.runInContext(template.match(new RegExp('<script id="'+id+'">([\\s\\S]*?)</script>'))[1],context);
 context.W=context.Hfo2WorkflowMath;
 for(const [start,end] of [['function result(','function selectedRecord('],['function render(','function choose('],['function sampleAssessment(','function groupAssessments('],['function assessmentBadge(','document.addEventListener(\'surface-reviewed\'']])vm.runInContext(template.slice(template.indexOf(start),template.indexOf(end)),context);
 const sample=(id,values=[15,15],imageId='OM-'+id)=>({id,image_id:imageId,data_source:'REAL_MEASUREMENT',concentration_M:.2,coats:1,rpm:3000,spin_time_s:30,anneal_temp_C:550,anneal_time_min:120,points:values.map((value,i)=>({position:'P'+i,value})),stats:values.length?context.OMDemoMath.thickness(values):null});
 const setOM=(s,state)=>surface.set(s.image_id,{state,label:state,reason:'OM '+state,areaPercent:state==='fail'?6:.04,areaLimit:5});
 return {context,node,sample,setOM,rows:()=>node('wfSampleTable').rows,html:()=>node('wfSampleTable').innerHTML};
}
test('passing thickness is green and contains only thickness judgement for missing, pending, failed and passed OM',()=>{
 for(const om of ['missing','pending','fail','pass']){
  const t=setup(),s=t.sample('sample-'+om,[14.8,14.9,15,15.1,15.2],om==='missing'?null:'OM-'+om);t.context.joined=[s];if(om!=='missing')t.setOM(s,om);t.context.render();
  assert.equal(t.rows().length,1);assert.ok(t.rows()[0].classList.contains('wf-row-pass'));assert.equal(t.rows()[0].dataset.thicknessState,'pass');assert.equal(t.rows()[0].dataset.combinedState,undefined);
  assert.match(t.html(),/두께 적합/);assert.doesNotMatch(t.html(),/data-om-assessment|data-combined-assessment|OM 미평가|OM 미충족/);assert.equal(t.node('wfAssessmentHeading').textContent,'두께 판정');
 }
});
test('thickness-only filter includes mean and CV failures but excludes an OM-only failure',()=>{
 const t=setup(),omFail=t.sample('om-only'),meanFail=t.sample('mean-fail',[18,18]),cvFail=t.sample('cv-fail',[11,13,15,17,19]),missing=t.sample('one-location',[15]);
 t.context.joined=[omFail,meanFail,cvFail,missing];t.setOM(omFail,'fail');t.setOM(meanFail,'pass');t.setOM(cvFail,'pass');t.setOM(missing,'pass');t.node('wfOnlyReview').checked=true;t.context.render();
 assert.deepEqual(t.rows().map(r=>r.dataset.wfId),['mean-fail','cv-fail']);assert.ok(t.rows().every(r=>r.classList.contains('wf-row-fail')));assert.match(t.html(),/두께 부적합/);assert.equal(t.node('wfFilterLabel').textContent,'두께 부적합만 보기');
});
test('a one-location thickness result remains pending even when OM passes',()=>{
 const t=setup(),s=t.sample('one-location',[15]);t.context.joined=[s];t.setOM(s,'pass');t.context.render();
 assert.ok(t.rows()[0].classList.contains('wf-row-pending'));assert.equal(t.rows()[0].dataset.thicknessState,'pending');assert.match(t.html(),/평가 불가/);
});
test('OM review updates cannot recolor the thickness row or add an overall verdict',()=>{
 const t=setup(),s=t.sample('review-change');t.context.joined=[s];t.setOM(s,'pending');t.context.render();const html=t.html();
 for(const om of ['fail','pass','pending']){t.setOM(s,om);t.context.updateOMPresentation();assert.ok(t.rows()[0].classList.contains('wf-row-pass'));assert.equal(t.html(),html);assert.equal(t.rows()[0].dataset.combinedState,undefined);}
});
test('explicit screening still filters OM failures and displays combined status',()=>{
 const t=setup(),omFail=t.sample('om-fail'),pending=t.sample('om-pending'),meanFail=t.sample('mean-fail',[18,18]),pass=t.sample('all-pass');
 t.context.joined=[omFail,pending,meanFail,pass];t.setOM(omFail,'fail');t.setOM(pending,'pending');t.setOM(meanFail,'pass');t.setOM(pass,'pass');t.context.combinedScreening=true;t.node('wfOnlyReview').checked=true;t.context.render();
 assert.deepEqual(t.rows().map(r=>r.dataset.wfId),['om-fail','mean-fail']);assert.ok(t.rows().every(r=>r.dataset.combinedState==='fail'));assert.match(t.html(),/data-om-assessment/);assert.match(t.html(),/data-combined-assessment/);assert.equal(t.node('appSamplesTitle').textContent,'Sample Screening');assert.equal(t.node('wfAssessmentHeading').textContent,'두께 · OM 판정');
});
test('returning from screening restores thickness status despite an OM-only failure',()=>{
 const t=setup(),s=t.sample('mode-change');t.context.joined=[s];t.setOM(s,'fail');t.context.combinedScreening=true;t.context.render();assert.ok(t.rows()[0].classList.contains('wf-row-fail'));
 t.context.combinedScreening=false;t.context.render();assert.ok(t.rows()[0].classList.contains('wf-row-pass'));assert.doesNotMatch(t.html(),/data-om-assessment|data-combined-assessment/);assert.equal(t.node('appSamplesTitle').textContent,'Thickness Analysis');
});
