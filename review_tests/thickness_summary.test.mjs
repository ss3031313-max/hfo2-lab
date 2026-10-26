// Thickness-stage results must not wait for a later OM review.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const template=fs.readFileSync(path.join(root,'src/om_app.template.html'),'utf8');
const intake=fs.readFileSync(path.join(root,'src/intake.js'),'utf8');
const baseRule={target:15,tolerance:2,cvLimit:10};
let loaded=[],activeRule={...baseRule},screening=false;
const results=new Map(),elements=new Map();
const getElement=id=>{if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',disabled:false});return elements.get(id);};
const context=vm.createContext({console,
 document:{getElementById:getElement,querySelectorAll:()=>[],activeElement:null},
 Hfo2Bridge:{getSamples:()=>loaded,getRule:()=>activeRule,listImages:()=>[],isCombinedScreening:()=>screening},
 Hfo2Surface:{getPolicy:()=>({threshold:5,minArea:16,areaLimit:5,particleMinArea:2,particleDensityLimit:10,valid:true}),getAssessment:id=>results.get(id)}
});
vm.runInContext('globalThis.window=globalThis',context);
for(const id of ['om-math','workflow-math'])vm.runInContext(template.match(new RegExp('<script id="'+id+'">([\\s\\S]*?)</script>'))[1],context);
const prefix=intake.slice(0,intake.indexOf('const css='));
const functions=intake.slice(intake.indexOf('function grade('),intake.indexOf('function exportRows('));
vm.runInContext(prefix+'\nconst candidates={innerHTML:""},summaryBody={innerHTML:""};function updatePending(){}\n'+functions+'\nglobalThis.ThicknessPage={assessThickness,getThicknessAssessments,sourceSummary,assessCombined,render:()=>{renderAnalysis();return {summary:summaryBody.innerHTML,comparison:candidates.innerHTML};}};})();',context);
const P=context.ThicknessPage,M=context.OMDemoMath;
function sample(id,values=[14.8,14.9,15,15.1,15.2],extra={}){return {id,image_id:'OM-'+id,concentration_M:.2,coats:1,rpm:3000,spin_time_s:30,anneal_temp_C:550,anneal_time_min:120,data_source:'REAL_MEASUREMENT',points:values.map((value,i)=>({position:'P'+i,value})),stats:values.length?M.thickness(values):null,...extra};}
function om(state){return {state,label:'OM '+state,reason:'OM '+state,areaPercent:state==='fail'?6:.04,areaLimit:5,particleCount:2,particleDensityPer10k:.28,particleDensityLimit:10,particleMinArea:2};}
function render(samples,{combined=false,rule=baseRule}={}){loaded=samples;screening=combined;activeRule={...rule};return P.render();}
function count(html,state){const match=html.match(new RegExp('data-thickness-state="'+state+'"><span>[^<]*</span><b>(\\d+)<small>'));assert.ok(match,'missing '+state+' count');return Number(match[1]);}

test('matching mean and CV pass independently of missing, pending or failed OM',()=>{
 for(const state of ['missing','pending','fail','pass']){
  const s=sample(state,undefined,{image_id:state==='missing'?null:'OM-'+state});
  if(s.image_id)results.set(s.image_id,om(state));
  assert.equal(P.assessThickness(s,baseRule).state,'pass');
  assert.equal(P.getThicknessAssessments([s],baseRule)[0].state,'pass');
  assert.equal(P.assessCombined(s,baseRule).state,state==='pass'?'pass':state==='fail'?'fail':'pending');
 }
});
test('reported screenshot case counts as thickness pass before OM confirmation',()=>{
 const s=sample('reported');results.set(s.image_id,om('pending'));
 const {summary,comparison}=render([s]);
 assert.equal(count(summary,'pass'),1);assert.equal(count(summary,'pending'),0);assert.equal(count(summary,'fail'),0);
 assert.match(summary,/두께 분석 결과/);assert.match(summary,/평균 두께·CV 모두 기준 이내/);
 assert.doesNotMatch(summary,/두께·OM 모두 충족|자료·분석·사용자 확인 필요|OM 연결/);
 assert.match(summary,/출처별 두께 집계/);assert.match(summary,/두께 적합<b>1<\/b>/);
 assert.match(comparison,/두께 충족 · OM 검토 대기 1시편/);
});
test('mean or CV failure stays in thickness fail despite passing OM',()=>{
 const samples=[sample('mean',[18,18]),sample('cv',[11,13,15,17,19])];
 for(const s of samples)results.set(s.image_id,om('pass'));
 const {summary}=render(samples);
 assert.equal(count(summary,'pass'),0);assert.equal(count(summary,'fail'),2);assert.equal(count(summary,'pending'),0);
});
test('unavailable or invalid thickness waits, while a known mean failure is decisive',()=>{
 const samples=[sample('empty',[]),sample('one',[15]),sample('invalid',undefined,{editError:'입력 오류'}),sample('nan',undefined,{stats:{n:5,mean:15,cv:NaN}}),sample('one-out',[18])];
 const {summary}=render(samples);
 assert.equal(count(summary,'pass'),0);assert.equal(count(summary,'pending'),4);assert.equal(count(summary,'fail'),1);
});
test('source summaries use thickness only and keep sources separate',()=>{
 const real=sample('real'),synthetic=sample('DEMO-example',[11,13,15,17,19],{data_source:'SYNTHETIC'});
 results.set(real.image_id,om('fail'));results.set(synthetic.image_id,om('pass'));
 const realHTML=P.sourceSummary([real,synthetic],baseRule,'REAL_MEASUREMENT');
 const syntheticHTML=P.sourceSummary([real,synthetic],baseRule,'SYNTHETIC');
 assert.match(realHTML,/두께 적합<b>1<\/b>/);assert.match(realHTML,/두께 부적합<b>0<\/b>/);
 assert.match(syntheticHTML,/두께 적합<b>0<\/b>/);assert.match(syntheticHTML,/두께 부적합<b>1<\/b>/);
});
test('changing OM state updates comparison without changing thickness summary',()=>{
 const s=sample('dynamic');results.set(s.image_id,om('pending'));const before=render([s]);
 results.set(s.image_id,om('fail'));const after=render([s]);
 assert.equal(after.summary,before.summary);assert.notEqual(after.comparison,before.comparison);
 assert.equal(P.assessCombined(s,baseRule).state,'fail');
});
test('screen mode preserves combined results and switching back restores thickness scope',()=>{
 const s=sample('screen');results.set(s.image_id,om('pending'));
 const combined=render([s],{combined:true}).summary;
 assert.match(combined,/종합 선별 결과/);assert.match(combined,/두께·OM 모두 충족/);assert.match(combined,/출처별 종합 집계/);
 assert.match(combined,/class="intake-combined-count pending"><span>검토 대기<\/span><b>1/);
 assert.doesNotMatch(combined,/data-assessment-scope="thickness"/);
 const thickness=render([s]).summary;assert.equal(count(thickness,'pass'),1);assert.equal(count(thickness,'pending'),0);
});
test('inclusive boundaries and user criteria updates remain effective',()=>{
 const samples=[sample('lower',[13,13]),sample('upper',[17,17]),sample('cv-boundary',[13.5,15,16.5])];
 assert.equal(count(render(samples).summary,'pass'),3);
 const tightened=render(samples,{rule:{...baseRule,cvLimit:9.9}}).summary;
 assert.equal(count(tightened,'pass'),2);assert.equal(count(tightened,'fail'),1);
});
test('an empty thickness stage remains empty',()=>{
 const {summary}=render([]);assert.match(summary,/분석 대기/);assert.doesNotMatch(summary,/data-thickness-state/);
});
