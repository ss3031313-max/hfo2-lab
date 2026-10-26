// Combined criteria: missing/stale OM must never become a thickness-only pass.
// Run: node --test review_tests/om_comparison.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const template=fs.readFileSync(path.join(root,'src/om_app.template.html'),'utf8');
const intake=fs.readFileSync(path.join(root,'src/intake.js'),'utf8');
const rule={target:15,tolerance:2,cvLimit:10};
const policy={threshold:5,minArea:16,areaLimit:5,particleMinArea:2,particleDensityLimit:10,valid:true};
let loaded=[];
const results=new Map();
const context=vm.createContext({console,document:{},Hfo2Bridge:{getSamples:()=>loaded,getRule:()=>rule,listImages:()=>[]},Hfo2Surface:{getPolicy:()=>policy,getAssessment:id=>results.get(id)}});
vm.runInContext('globalThis.window=globalThis',context);
for(const id of ['om-math','workflow-math']){
 const script=template.match(new RegExp('<script id="'+id+'">([\\s\\S]*?)</script>'));
 if(!script)throw new Error('Missing '+id);
 vm.runInContext(script[1],context);
}
const prefix=intake.slice(0,intake.indexOf('const css='));
const functions=intake.slice(intake.indexOf('function grade('),intake.indexOf('function renderAnalysis('));
vm.runInContext(prefix+'\nconst candidates={innerHTML:""};\n'+functions+'\nglobalThis.Comparison={assessCombined,getSampleAssessments,getConditionAssessments,render:(samples,rule)=>{renderCandidates(samples,rule);return candidates.innerHTML;}};})();',context);
const P=context.Comparison,M=context.OMDemoMath;
function sample(id='A',values=[15,15],overrides={}){return {id,image_id:'OM-'+id,concentration_M:.2,coats:1,rpm:3000,spin_time_s:30,anneal_temp_C:550,anneal_time_min:120,data_source:'REAL_MEASUREMENT',points:values.map((value,i)=>({position:'P'+i,value})),stats:values.length?M.thickness(values):null,...overrides};}
function om(state,overrides={}){return {state,label:{pass:'OM 기준 충족',fail:'OM 기준 초과',pending:'OM 검토 대기'}[state],reason:state==='pending'?'오버레이 미검토':state==='fail'?'의심 면적 상한 초과':'면적·밀도 기준 이내 · 오버레이 확인',areaPercent:state==='fail'?7:2,areaLimit:5,threshold:5,minArea:16,particleCount:4,smallParticleCount:3,particleDensityPer10k:2,particleDensityLimit:10,particleMinArea:2,user_confirmation:state==='pending'?'UNREVIEWED':'OVERLAY_REVIEWED',...overrides};}
function setOM(s,state,overrides){results.set(s.image_id,om(state,overrides));}

test('combined decision requires both checks; a known failure remains decisive',()=>{
 for(const thickness of ['pass','pending','fail'])for(const surface of ['pass','pending','fail']){
  const s=sample('matrix-'+thickness+'-'+surface,thickness==='pass'?[15,15]:thickness==='fail'?[18,18]:[15]);
  setOM(s,surface);
  const expected=thickness==='fail'||surface==='fail'?'fail':thickness==='pass'&&surface==='pass'?'pass':'pending';
  const result=P.assessCombined(s,rule);
  assert.equal(result.state,expected,thickness+' / '+surface);
  assert.equal(result.thickness.state,thickness);
  assert.equal(result.om.state,surface);
 }
});
test('missing OM is visible pending even when thickness meets all criteria',()=>{
 const result=P.assessCombined(sample('missing',[15,15],{image_id:null}),rule);
 assert.equal(result.state,'pending');assert.equal(result.om.reason,'OM 미연결');assert.equal(result.om.areaPercent,null);
 assert.equal(result.om.particleCount,null);assert.equal(result.om.particleDensityPer10k,null);assert.equal(result.om.particleDensityLimit,10);assert.equal(result.om.particleMinArea,2);
});
test('particle measurements and density failure reason survive combined assessment',()=>{
 const s=sample('particles-low-area'),reason='검출 영역 밀도 20.00개/1만 px · 상한 10.0 초과';
 setOM(s,'fail',{areaPercent:0,particleCount:40,smallParticleCount:40,particleDensityPer10k:20,reason});
 const result=P.assessCombined(s,rule);
 assert.equal(result.thickness.state,'pass');assert.equal(result.om.areaPercent,0);assert.equal(result.om.particleCount,40);assert.equal(result.om.smallParticleCount,40);
 assert.equal(result.om.particleDensityPer10k,20);assert.equal(result.om.particleDensityLimit,10);assert.equal(result.om.particleMinArea,2);
 assert.equal(result.state,'fail');assert.equal(result.reason,reason);assert.equal(P.getConditionAssessments([s],rule)[0].candidate,false);
});
test('comparison displays both OM limits and high-density failure despite zero large area',()=>{
 const s=sample('particles-ui');setOM(s,'fail',{areaPercent:0,particleCount:40,smallParticleCount:40,particleDensityPer10k:20,reason:'검출 영역 밀도 상한 초과'});
 const html=P.render([s],rule);
 assert.match(html,/OM 큰 영역 면적 ≤ 5\.0% · 검출 영역 밀도 ≤ 10\.0개\/1만 px/);
 assert.match(html,/큰 영역 면적 0\.00% \/ 상한 5\.0%/);assert.match(html,/검출 연결 영역 40개/);
 assert.match(html,/밀도 20\.00개\/1만 px \/ 상한 10\.0/);assert.match(html,/검출 영역 밀도 상한 초과/);
 assert.match(html,/data-combined-state="fail"/);assert.match(html,/큰 영역도 포함/);assert.match(html,/실제 파티클이나 결함으로 확정된 것은 아닙니다/);
});
test('assessment uses the linked image, never another current image',()=>{
 const s=sample('linked');setOM(s,'pending',{reason:'분석 대기'});results.set('unrelated-current-image',om('pass'));
 assert.equal(P.assessCombined(s,rule).state,'pending');
});
test('surface module not initialized cannot silently grant a pass',()=>{
 const surface=context.Hfo2Surface;context.Hfo2Surface=undefined;
 try{assert.equal(P.assessCombined(sample('startup'),rule).state,'pending');}finally{context.Hfo2Surface=surface;}
});
test('changing OM from reviewed to stale immediately removes combined pass',()=>{
 const s=sample('stale');setOM(s,'pass');assert.equal(P.assessCombined(s,rule).state,'pass');
 setOM(s,'pending',{reason:'설정 변경 · 재분석 필요'});
 const result=P.assessCombined(s,rule);assert.equal(result.state,'pending');assert.match(result.reason,/재분석/);
});
test('missing thickness and invalid edited thickness stay pending with passing OM',()=>{
 for(const s of [sample('empty',[]),sample('edited',[15,15],{editError:'15nm 입력'}),sample('nan',[15,15],{stats:{n:2,mean:15,cv:NaN}})]){
  setOM(s,'pass');assert.equal(P.assessCombined(s,rule).state,'pending');
 }
});
test('one location cannot pass spatial uniformity, but an out-of-range mean still fails',()=>{
 const within=sample('one-in',[15]),outside=sample('one-out',[18]);setOM(within,'pass');setOM(outside,'pending');
 assert.equal(P.assessCombined(within,rule).state,'pending');assert.equal(P.assessCombined(outside,rule).state,'fail');
});
test('inclusive mean and CV boundaries remain unchanged',()=>{
 for(const [id,values]of [['lo',[13,13]],['hi',[17,17]],['cv',[13.5,15,16.5]]]){const s=sample(id,values);setOM(s,'pass');assert.equal(P.assessCombined(s,rule).state,'pass');}
});
test('group denominator is independent sample count, with every pending and failed sample retained',()=>{
 const a=sample('g-pass',[15,15,15,15,15]),b=sample('g-pending'),c=sample('g-fail',[18,18]);setOM(a,'pass');setOM(b,'pending');setOM(c,'pending');
 const [g]=P.getConditionAssessments([a,b,c],rule);
 assert.equal(g.count,3);assert.equal(g.combined_pass,1);assert.equal(g.combined_pending,1);assert.equal(g.combined_fail,1);
 assert.equal(g.assessed_count,1);assert.equal(g.decided_count,2);assert.equal(g.om_pass,1);assert.equal(g.om_pending,2);assert.equal(g.om_fail,0);
 assert.deepEqual(Array.from(g.passing_sample_ids),['g-pass']);assert.deepEqual(Array.from(g.thickness_pass_om_pending_ids),['g-pending']);assert.equal(g.candidate,true);
});
test('same recipe keeps real-declared and synthetic samples in separate groups',()=>{
 const real=sample('real'),synthetic=sample('DEMO-synthetic',[15,15],{data_source:'SYNTHETIC'});setOM(real,'pass');setOM(synthetic,'pass');
 const groups=P.getConditionAssessments([real,synthetic],rule);
 assert.equal(groups.length,2);assert.ok(groups.every(g=>g.count===1));assert.deepEqual(Array.from(groups,g=>g.data_source).sort(),['REAL_MEASUREMENT','SYNTHETIC']);
});
test('incomplete process metadata cannot produce a condition candidate',()=>{
 const s=sample('partial',[15,15],{rpm:null});setOM(s,'pass');const [g]=P.getConditionAssessments([s],rule);
 assert.equal(g.combined_pass,1);assert.equal(g.partial,true);assert.equal(g.candidate,false);
});
test('thickness-only pass cannot produce a condition candidate',()=>{
 const s=sample('thickness-only',[15,15],{image_id:null});const [g]=P.getConditionAssessments([s],rule);
 assert.equal(g.pass,1);assert.equal(g.combined_pass,0);assert.equal(g.candidate,false);assert.equal(g.om_pending,1);
});
test('no-argument APIs read current analyzed batch and fresh surface status',()=>{
 const s=sample('current');loaded=[s];setOM(s,'pass');assert.equal(P.getSampleAssessments()[0].state,'pass');
 setOM(s,'fail');assert.equal(P.getConditionAssessments()[0].combined_fail,1);assert.equal(P.getConditionAssessments()[0].om_fail,1);loaded=[];
});
test('comparison rendering retains unlinked samples and orders pass, pending, fail',()=>{
 const pass=sample('row-pass'),pending=sample('row-pending',[15,15],{image_id:null}),fail=sample('row-fail',[18,18]);setOM(pass,'pass');setOM(fail,'fail');
 const html=P.render([fail,pending,pass],rule),body=html.slice(html.indexOf('<tbody>'),html.indexOf('</tbody>'));
 assert.ok(body.indexOf('row-pass')<body.indexOf('row-pending'));assert.ok(body.indexOf('row-pending')<body.indexOf('row-fail'));
 assert.match(body,/OM 미연결/);assert.match(html,/초기 운영 기준 · 검증 대기/);
 const card=html.match(/<div class="intake-candidate-samples">([\s\S]*?)<\/div>/)?.[1]||'';
 assert.match(card,/row-pass/);assert.doesNotMatch(card,/row-pending|row-fail/);
});
test('untrusted IDs and OM reasons are escaped in comparison markup',()=>{
 const s=sample('<img onerror=x>');setOM(s,'pending',{reason:'<script>bad()</script>'});const html=P.render([s],rule);
 assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|<img onerror/);
});
test('manual OM corrections use reviewed metrics and preserve automatic comparison context',()=>{
 const s=sample('reviewed');setOM(s,'pass',{areaPercent:2,particleCount:3,particleDensityPer10k:6,correctionCount:2,automaticAreaPercent:8,automaticParticleCount:5,automaticParticleDensityPer10k:10,manualCorrections:[{seed:4,action:'EXCLUDE_ALL',reason:'OUTSIDE_SPECIMEN'}]});
 const a=P.assessCombined(s,rule);assert.equal(a.state,'pass');assert.equal(a.om.automaticAreaPercent,8);assert.equal(a.om.correctionCount,2);assert.equal(a.om.manualCorrections.length,1);
 const html=P.render([s],rule);assert.match(html,/사용자 수정 2영역/);assert.match(html,/면적 8\.00 → 2\.00%/);assert.match(html,/개수 5 → 3개/);
 setOM(s,'pending',{correctionCount:2,reason:'사용자 재확인 필요'});assert.equal(P.getConditionAssessments([s],rule)[0].candidate,false);
});
test('sample CSV exports reviewed values alongside automatic metrics and exclusion reasons',()=>{
 const s=sample('csv-review'),edits=[{seed:4,action:'EXCLUDE_ALL',reason:'OTHER',note:'조명 확인, 재촬영 비교'}];
 setOM(s,'pending',{areaPercent:0,particleCount:2,particleDensityPer10k:4,correctionCount:1,automaticAreaPercent:18,automaticParticleCount:3,automaticParticleDensityPer10k:6,manualCorrections:edits});
 let captured;
 const exportContext=vm.createContext({window:{Hfo2Surface:context.Hfo2Surface},currentRule:()=>rule,joined:[s],records:[],metaFilename:'process',thickFilename:'thickness',result:()=>({label:'두께 충족',reasons:[]}),sampleAssessment:sample=>P.assessCombined(sample,rule),csvDownload:(name,rows)=>{captured=rows;}});
 vm.runInContext(template.slice(template.indexOf('function exportJoined(){'),template.indexOf('function exportGroups(){'))+'\nexportJoined();',exportContext);
 assert.equal(captured[0].length,captured[1].length);
 const row=Object.fromEntries(captured[0].map((key,i)=>[key,captured[1][i]]));
 assert.equal(row.om_suspect_area_percent,0);assert.equal(row.om_particle_count,2);assert.equal(row.om_automatic_area_percent,18);assert.equal(row.om_automatic_particle_count,3);assert.equal(row.om_manual_correction_count,1);assert.equal(row.om_user_confirmation,'UNREVIEWED');assert.deepEqual(JSON.parse(row.om_manual_corrections_json),edits);
});
