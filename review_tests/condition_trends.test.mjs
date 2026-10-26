import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const T=require('../src/condition_trends.js');
const rule={target:15,tolerance:2,cvLimit:10};
function sample(id,extra={}){return {id,concentration_M:.2,coats:1,rpm:3000,spin_time_s:30,anneal_temp_C:550,anneal_time_min:120,data_source:'SYNTHETIC',points:[{position:'P1',value:14.9},{position:'P2',value:15.1}],stats:{mean:15,cv:1.05,n:2},...extra};}
const demo=[sample('DEMO-01'),sample('DEMO-02',{concentration_M:.1,coats:3}),sample('DEMO-03',{concentration_M:.4,stats:{mean:15,cv:21.08,n:2}})];

test('coating CV is the requested default while concentration CV still isolates the two one-coat samples',()=>{
 assert.equal(T.choosePreset(demo,rule),'coats_cv');
 assert.equal(T.PRESETS[0].id,'coats_cv');
 assert.equal(T.buildModel(demo,T.choosePreset(demo,rule),rule).controlled,false);
 const model=T.buildModel(demo,'concentration_cv',rule);
 assert.deepEqual(model.points.map(p=>p.id),['DEMO-01','DEMO-03']);
 assert.equal(model.controlled,true);assert.equal(model.levels,2);assert.equal(model.groups.length,2);
 assert.deepEqual(model.points.map(p=>p.state),['pass','fail']);
 assert.equal(model.group.fixed.coats,1);assert.equal(model.group.fixed.rpm,3000);
});
test('RPM plot correctly reports only one input level without fabricating a trend',()=>{
 const model=T.buildModel(demo,'rpm_mean',rule);
 assert.equal(model.levels,1);assert.equal(model.controlled,false);assert.equal(model.groupKey,'all');
 assert.deepEqual(model.points.map(p=>p.x),[3000,3000,3000]);
 assert.doesNotMatch(T.graphHTML(model,rule),/polyline|<path/);
});
test('every other process condition and provenance are held constant in comparison groups',()=>{
 const variants=T.FIELDS.filter(([k])=>k!=='concentration_M').map(([key],i)=>sample('different-'+key,{concentration_M:.4,[key]:demo[0][key]+i+1}));
 const inputs=[demo[0],demo[2],...variants,sample('measured',{concentration_M:.4,data_source:'REAL_MEASUREMENT'})];
 const model=T.buildModel(inputs,'concentration_cv',rule);
 assert.deepEqual(model.points.map(p=>p.id),['DEMO-01','DEMO-03']);
 assert.equal(model.groups.length,7);
});
test('missing fixed conditions remain exploratory even when x has multiple values',()=>{
 const inputs=[sample('a',{anneal_temp_C:null}),sample('b',{concentration_M:.4,anneal_temp_C:null})];
 const model=T.buildModel(inputs,'concentration_cv',rule);
 assert.equal(model.groupKey,'all');assert.equal(model.controlled,false);assert.equal(model.levels,2);
 assert.equal(model.groups[0].complete,false);
});
test('requested all or an explicit comparison group is honored; removed groups fall back safely',()=>{
 const chosen=T.buildModel(demo,'concentration_cv',rule),all=T.buildModel(demo,'concentration_cv',rule,'all');
 assert.equal(all.points.length,3);assert.equal(all.controlled,false);
 assert.deepEqual(T.buildModel(demo,'concentration_cv',rule,chosen.groupKey).points,chosen.points);
 const after=T.buildModel([demo[1]],'concentration_cv',rule,chosen.groupKey);
 assert.equal(after.groupKey,'all');assert.deepEqual(after.points.map(p=>p.id),['DEMO-02']);
});
test('invalid or deleted thickness is excluded and a valid single-position mean remains pending',()=>{
 const inputs=[sample('ok'),sample('deleted',{points:[],stats:null}),sample('stale',{points:[]}),sample('error',{editError:'bad'}),sample('bad-mean',{stats:{mean:NaN,cv:1,n:2}}),sample('no-x',{rpm:null}),sample('single',{stats:{mean:15,cv:null,n:1},points:[{position:'P1',value:15}]}),sample('bad-cv',{stats:{mean:15,cv:-2,n:2}})];
 const means=T.buildPoints(inputs,'rpm_mean',rule);
 assert.deepEqual(means.map(p=>p.id),['bad-cv','ok','single']);
 assert.equal(means.find(p=>p.id==='single').state,'pending');
 assert.deepEqual(T.buildPoints(inputs,'concentration_cv',rule).map(p=>p.id),['no-x','ok']);
});
test('mean failure is decisive even with no CV, inclusive limits pass, and rules update color and bands',()=>{
 const bound=sample('bound',{stats:{mean:17,cv:10,n:2}});
 assert.equal(T.buildPoints([bound],'concentration_mean',rule)[0].state,'pass');
 assert.equal(T.buildPoints([bound],'concentration_mean',{...rule,cvLimit:9.9})[0].state,'fail');
 assert.equal(T.buildPoints([sample('one-out',{stats:{mean:18,cv:null,n:1}})],'rpm_mean',rule)[0].state,'fail');
 const model=T.buildModel([bound],'concentration_mean',rule,'all');
 assert.match(T.graphHTML(model,rule),/평균 기준 13–17 nm/);
 assert.match(T.graphHTML(model,{...rule,tolerance:1}),/평균 기준 14–16 nm/);
 const cvs=T.buildModel([bound],'concentration_cv',rule,'all');
 assert.match(T.graphHTML(cvs,{...rule,cvLimit:7}),/CV 상한 7%/);
});
test('requested coating default stays fixed and a controlled RPM comparison remains selectable',()=>{
 const inputs=[sample('a'),sample('b',{rpm:4000}),sample('c',{concentration_M:.5,coats:4})];
 assert.equal(T.choosePreset(inputs,rule),'coats_cv');
 const model=T.buildModel(inputs,'rpm_mean',rule);
 assert.deepEqual(model.points.map(p=>p.id),['a','b']);
});
test('deleted data disappears immediately when rebuilt and restoration reproduces the same plot',()=>{
 const before=T.buildModel(demo,'concentration_cv',rule,'all');
 const removed=demo.map((s,i)=>i===2?{...s,points:[],stats:null}:s);
 const after=T.buildModel(removed,'concentration_cv',rule,'all');
 assert.equal(after.points.length,2);assert.equal(after.excluded,1);assert.ok(!after.points.some(p=>p.id==='DEMO-03'));
 assert.equal(T.graphHTML(T.buildModel(demo,'concentration_cv',rule,'all'),rule),T.graphHTML(before,rule));
});
test('coordinates are not jittered: identical x/y values retain exactly the same coordinates',()=>{
 const model=T.buildModel([sample('a'),sample('b')],'concentration_cv',rule,'all');
 const svg=T.graphHTML(model,rule),coords=[...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)"/g)].map(m=>m.slice(1));
 assert.equal(coords.length,2);assert.deepEqual(coords[0],coords[1]);
 assert.ok(coords[0].every(v=>Number.isFinite(Number(v))));
 assert.match(svg,/data-trend-point="a"/);assert.match(svg,/data-trend-point="b"/);
});
test('axis ranges stay finite for a single level, zero CV and no values',()=>{
 for(const values of [[3000],[0],[1,2],[]]){const [min,max]=T.domain(values,{zero:true});assert.ok(Number.isFinite(min)&&Number.isFinite(max));assert.ok(max>min);assert.ok(min>=0);}
 const zero=sample('zero',{stats:{mean:15,cv:0,n:2}}),zeroRule={...rule,cvLimit:0};
 assert.doesNotMatch(T.graphHTML(T.buildModel([zero],'concentration_cv',zeroRule),zeroRule),/NaN|Infinity/);
});
test('graph output escapes sample IDs and does not modify application inputs',()=>{
 const inputs=[...demo,sample('<img onerror="bad">')],before=JSON.stringify(inputs);
 const model=T.buildModel(inputs,'concentration_cv',rule,'all'),html=T.graphHTML(model,rule);
 assert.doesNotMatch(html,/<img onerror/);assert.match(html,/&lt;img onerror=&quot;bad&quot;&gt;/);
 T.choosePreset(inputs,rule);T.groupPoints(model.points,'concentration_cv');assert.equal(JSON.stringify(inputs),before);
});

const policy={threshold:5,minArea:16,particleMinArea:2,areaLimit:5,particleDensityLimit:10,valid:true};
function opticalResult(image_id,extra={}){return {image_id,width:1024,height:768,roi:{left:5,top:5,right:95,bottom:95},threshold:5,minArea:16,particleMinArea:2,referenceSource:'MANUAL',areaPercent:2,particleDensityPer10k:.28,particleCount:20,correctionCount:0,assessment:{state:'pass',label:'OM 기준 충족',reason:'검토 완료'},...extra};}
function opticalContext(samples,results,extra={}){return {images:samples.filter(s=>s.image_id).map(s=>({id:s.image_id,filename:s.image_id+'.png',magnification:100})),results,policy:{...policy},...extra};}
test('seven presets begin with coating CV and mean, followed by OM metrics',()=>{
 assert.equal(T.PRESETS.length,7);
 assert.deepEqual(T.PRESETS.slice(0,2).map(p=>p.id),['coats_cv','coats_mean']);
 assert.equal(T.getPreset('coats_area').unit,'%');
 assert.equal(T.getPreset('coats_density').unit,'개/1만 픽셀');
 assert.equal(T.getPreset('coats_area').x,'coats');
});

test('controlled coating comparison connects condition means, mixed conditions remain unconnected',()=>{
 const inputs=[sample('one',{coats:1,stats:{mean:12,cv:1.32,n:5}}),sample('two',{coats:2,stats:{mean:15,cv:5.27,n:5}}),sample('three',{coats:3,stats:{mean:18,cv:17.57,n:5}})];
 const model=T.buildModel(inputs,'coats_cv',rule);
 assert.equal(model.controlled,true);assert.equal(model.levels,3);
 const svg=T.graphHTML(model,rule);
 assert.match(svg,/hfo-trends-connection/);assert.match(svg,/1.32%/);assert.match(svg,/5.27%/);assert.match(svg,/17.57%/);
 assert.deepEqual(T.buildPoints(inputs,'coats_mean',rule).map(p=>p.y),[12,15,18]);
 assert.doesNotMatch(T.graphHTML(T.buildModel(inputs,'coats_cv',rule,'all'),rule),/polyline/);
 const mixed=inputs.map((s,i)=>({...s,concentration_M:(i+1)/10}));
 assert.doesNotMatch(T.graphHTML(T.buildModel(mixed,'coats_cv',rule),rule),/polyline/);
});
test('line summaries use each condition mean without joining replicates in input order',()=>{
 assert.deepEqual(T.conditionMeans([{x:2,y:8},{x:1,y:2},{x:2,y:4}]),[{x:1,y:2,n:1},{x:2,y:6,n:2}]);
});
test('CV graph color uses CV alone while overall thickness verdict still includes mean',()=>{
 const p=T.buildPoints([sample('thin',{stats:{mean:12,cv:1.32,n:5}})],'coats_cv',rule)[0];
 assert.equal(p.state,'fail');assert.equal(T.metricState(p,T.getPreset('coats_cv'),rule),'pass');
 assert.equal(T.metricState(p,T.getPreset('coats_mean'),rule),'fail');
 assert.equal(T.metricState({...p,mean:15,cv:12},T.getPreset('coats_cv'),rule),'fail');
 assert.equal(T.metricState({...p,mean:15,cv:12},T.getPreset('coats_mean'),rule),'pass');
});
test('rounded y-axis ticks cover data and zero and maintain finite spacing',()=>{
 const scale=T.niceScale([1.32,5.27,17.57,10]);assert.deepEqual(scale.ticks,[0,5,10,15,20]);
 for(const values of [[0],[.0002,.0007],[10,100],[]]){const s=T.niceScale(values);assert.ok(s.step>0&&Number.isFinite(s.high));assert.ok(s.high>=Math.max(0,...values));assert.equal(s.ticks[0],0);}
});
test('OM plots use adjusted metrics and do not depend on valid thickness',()=>{
 const s=sample('om-only',{image_id:'image1',points:[],stats:null}),r=opticalResult('image1',{areaPercent:1.5,particleDensityPer10k:.125,correctionCount:2,automaticMetrics:{areaPercent:8,particleDensityPer10k:50}}),context=opticalContext([s],[r]);
 const area=T.buildModel([s],'coats_area',null,null,context),density=T.buildModel([s],'coats_density',null,null,context);
 assert.equal(area.points[0].y,1.5);assert.equal(density.points[0].y,.125);
 assert.equal(area.points[0].correctionCount,2);assert.equal(area.points[0].state,'pass');
 assert.match(T.pointDescription(area.points[0]),/사용자 수정 2곳/);
 assert.match(T.graphHTML(density,null),/검출 밀도 상한 10개\/1만 픽셀/);
 assert.doesNotMatch(T.graphHTML(density,null),/두께 적합/);
});
test('missing or stale OM results are not fabricated as zeros',()=>{
 const samples=[sample('a',{image_id:'a'}),sample('b',{image_id:'b'}),sample('c',{image_id:'c'})];
 const context=opticalContext(samples,[opticalResult('a',{areaPercent:null}),opticalResult('b',{threshold:4})]);
 const model=T.buildModel(samples,'coats_area',rule,null,context);
 assert.equal(model.points.length,0);assert.equal(model.excluded,3);
 assert.match(T.graphHTML(model,rule),/OM 분석 결과가 없습니다/);
 assert.doesNotMatch(T.graphHTML(model,rule),/<circle/);
});
test('zero OM area and density are valid observations, not missing values',()=>{
 const s=sample('zero',{image_id:'a'}),context=opticalContext([s],[opticalResult('a',{areaPercent:0,particleDensityPer10k:0})]);
 assert.equal(T.buildPoints([s],'coats_area',rule,context)[0].y,0);
 assert.equal(T.buildPoints([s],'coats_density',rule,context)[0].y,0);
});
test('one image with conflicting recipe assignments is excluded, even with a valid OM result',()=>{
 const samples=[sample('a',{image_id:'shared'}),sample('b',{image_id:'shared',coats:3})],context=opticalContext(samples,[opticalResult('shared')]);
 const model=T.buildModel(samples,'coats_area',rule,null,context);
 assert.equal(model.points.length,0);assert.deepEqual(model.ambiguousImages,['shared']);assert.equal(model.excluded,2);
});
test('one image linked repeatedly to the same recipe is plotted only once and keeps all sample IDs',()=>{
 const samples=[sample('b',{image_id:'shared'}),sample('a',{image_id:'shared'})],context=opticalContext(samples,[opticalResult('shared')]);
 const model=T.buildModel(samples,'coats_density',rule,null,context);
 assert.equal(model.points.length,1);assert.equal(model.duplicateCollapsed,1);assert.equal(model.excluded,0);
 assert.deepEqual(model.points[0].sampleIds,['a','b']);assert.match(T.pointDescription(model.points[0]),/같은 이미지에 연결: a, b/);
});
test('OM controlled groups require matching known magnification, dimensions, ROI and detection settings',()=>{
 const samples=[sample('a',{image_id:'a'}),sample('b',{image_id:'b',coats:3})],base=opticalContext(samples,[opticalResult('a'),opticalResult('b')]);
 assert.equal(T.buildModel(samples,'coats_area',rule,null,base).controlled,true);
 for(const context of [
  {...base,images:base.images.map((i,n)=>({...i,magnification:n?50:100}))},
  {...base,images:base.images.map(i=>({...i,magnification:null}))},
  {...base,results:base.results.map((r,n)=>n?{...r,width:2048}:r)},
  {...base,results:base.results.map((r,n)=>n?{...r,roi:{...r.roi,left:10}}:r)},
  {...base,results:base.results.map((r,n)=>n?{...r,minArea:20}:r)}
 ])assert.equal(T.buildModel(samples,'coats_area',rule,null,context).controlled,false);
});
test('OM threshold lines follow current policy and colors follow OM assessment rather than thickness',()=>{
 const s=sample('a',{image_id:'a',stats:{mean:15,cv:99,n:2}}),r=opticalResult('a',{assessment:{state:'pending',label:'검토 대기'}}),context=opticalContext([s],[r],{policy:{...policy,areaLimit:3,particleDensityLimit:2}});
 const area=T.buildModel([s],'coats_area',rule,null,context),density=T.buildModel([s],'coats_density',rule,null,context);
 assert.equal(area.points[0].state,'pending');
 assert.match(T.graphHTML(area,rule),/얼룩 의심 면적 상한 3%/);
 assert.match(T.graphHTML(density,rule),/검출 밀도 상한 2개\/1만 픽셀/);
 assert.match(T.graphHTML(area,rule),/OM 검토 대기/);
});
test('OM corrections refresh the plotted density and image removal clears the point without mutation',()=>{
 const s=sample('a',{image_id:'a'}),old=opticalContext([s],[opticalResult('a')]),before=JSON.stringify(old);
 const updated={...old,results:[{...old.results[0],particleDensityPer10k:.05,correctionCount:1}]};
 assert.equal(T.buildPoints([s],'coats_density',rule,old)[0].y,.28);
 assert.equal(T.buildPoints([s],'coats_density',rule,updated)[0].y,.05);
 assert.equal(T.buildPoints([s],'coats_density',rule,{...updated,images:[]}).length,0);
 assert.equal(JSON.stringify(old),before);
});
