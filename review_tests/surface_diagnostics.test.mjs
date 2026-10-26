import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../src/surface_diagnostics.js',import.meta.url),'utf8'),context);
const D=context.Hfo2SurfaceDiagnostics;
const policy={threshold:5,minArea:16,particleMinArea:2,areaLimit:5,particleDensityLimit:10};
const result={...policy,roiPixelCount:49,areaPercent:1,particleDensityPer10k:2};
test('sensitivity holds the reference, ROI and sizes fixed and reuses current metrics',()=>{
 const roi={left:15,top:15,right:85,bottom:85},reference={left:30,top:30,right:40,bottom:40},calls=[];
 const d=D.analyze({analyzePixels:p=>{calls.push(p);return {areaPercent:p.threshold===4?8:.5,particleDensityPer10k:1};},pixels:{width:10,height:10,imageData:{data:[]}},roi,reference,policy,result});
 assert.deepEqual(calls.map(c=>c.threshold),[4,6]);assert.ok(calls.every(c=>c.roi===roi&&c.reference===reference&&c.minArea===16&&c.particleMinArea===2));
 assert.equal(d.roiCoveragePercent,49);assert.equal(d.thresholds[1].areaPercent,1);
 const a=D.assess(d,policy);assert.equal(a.changed,true);assert.equal(a.points[1].state,'pass');assert.equal(a.points[0].state,'fail');
 assert.equal(result.areaPercent,1);
});
test('density flip independently marks sensitivity and new judgment limits reuse metrics',()=>{
 const d={version:1,currentThreshold:5,thresholds:[{threshold:4,areaPercent:1,particleDensityPer10k:11},{threshold:5,areaPercent:1,particleDensityPer10k:2},{threshold:6,areaPercent:1,particleDensityPer10k:1}]};
 assert.equal(D.assess(d,policy).changed,true);assert.equal(D.assess(d,{...policy,particleDensityLimit:12}).changed,false);
});
test('zero threshold avoids duplicate analysis and missing diagnostics is not evidence of stability',()=>{
 let calls=0;const p={...policy,threshold:0};const d=D.analyze({analyzePixels:()=>{calls++;throw new Error('unexpected');},pixels:{width:10,height:10},roi:{},reference:{},policy:p,result:{...result,threshold:0}});
 assert.equal(calls,0);assert.equal(d.thresholds.length,1);assert.equal(D.assess(null,policy).available,false);
});
test('threshold upper bound is clamped and incompatible result is rejected',()=>{
 const p={...policy,threshold:100};const d=D.analyze({analyzePixels:()=>({areaPercent:0,particleDensityPer10k:0}),pixels:{width:10,height:10},roi:{},reference:{},policy:p,result:{...result,threshold:100}});
 assert.deepEqual(Array.from(d.thresholds,t=>t.threshold),[80,100]);
 assert.throws(()=>D.analyze({analyzePixels:()=>{},pixels:{width:10,height:10},policy:p,result}),/동일 검출 설정/);
});
test('nonfinite metrics cannot appear as stable',()=>{
 assert.throws(()=>D.assess({version:1,currentThreshold:5,thresholds:[{threshold:5,areaPercent:NaN,particleDensityPer10k:1}]},policy),/면적률/);
});
