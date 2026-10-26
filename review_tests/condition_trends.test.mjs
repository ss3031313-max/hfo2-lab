import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const T=require('../src/condition_trends.js');
const rule={target:15,tolerance:2,cvLimit:10};
function sample(id,extra={}){return {id,concentration_M:.2,coats:1,rpm:3000,spin_time_s:30,anneal_temp_C:550,anneal_time_min:120,data_source:'SYNTHETIC',points:[{position:'P1',value:14.9},{position:'P2',value:15.1}],stats:{mean:15,cv:1.05,n:2},...extra};}
const demo=[sample('DEMO-01'),sample('DEMO-02',{concentration_M:.1,coats:3}),sample('DEMO-03',{concentration_M:.4,stats:{mean:15,cv:21.08,n:2}})];

test('three submitted inputs recommend concentration CV and isolate the two one-coat samples',()=>{
 assert.equal(T.choosePreset(demo,rule),'concentration_cv');
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
test('recommendation prefers an available controlled comparison over a confounded multi-level axis',()=>{
 const inputs=[sample('a'),sample('b',{rpm:4000}),sample('c',{concentration_M:.5,coats:4})];
 assert.equal(T.choosePreset(inputs,rule),'rpm_mean');
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
