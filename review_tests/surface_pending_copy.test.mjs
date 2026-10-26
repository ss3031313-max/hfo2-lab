// Software regression fixtures for numeric screening versus human review status.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const source=fs.readFileSync(new URL('../src/surface_review.js',import.meta.url),'utf8');
function harness(){
 const states=new Map(),ctx=vm.createContext({console,__testStates:states});
 vm.runInContext(source.replace('const states=new Map(),','const states=root.__testStates,'),ctx);
 return {S:ctx.Hfo2Surface,states};
}
const policy={threshold:5,minArea:16,areaLimit:5,particleMinArea:2,particleDensityLimit:10};
const within={threshold:5,minArea:16,particleMinArea:2,areaPercent:0.04,particleCount:11,smallParticleCount:9,particleDensityPer10k:0.28,referenceSpreadPercent:0.5};

test('zero detected objects still require review and explicitly meet numeric criteria',()=>{
 const {S}=harness(),data=new Uint8ClampedArray(20*20*4);
 for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=100;data[i+3]=255;}
 const result=S.analyzePixels({width:20,height:20,imageData:data,roi:{left:0,top:0,right:100,bottom:100},reference:{left:0,top:0,right:25,bottom:25},...policy});
 assert.equal(result.particleCount,0);assert.equal(result.areaPercent,0);
 const a=S.assessResult(result,'UNREVIEWED',policy);
 assert.equal(a.state,'pending');assert.equal(a.label,'수치 기준 충족 · 검토 대기');assert.match(a.reason,/원본과 대조/);
});

test('screenshot values are within limits while awaiting review',()=>{
 const {S}=harness(),a=S.assessResult(within,'UNREVIEWED',policy);
 assert.equal(a.state,'pending');assert.equal(a.label,'수치 기준 충족 · 검토 대기');
 assert.match(a.reason,/0.04% ≤ 5%/);assert.match(a.reason,/0.28 ≤ 10개/);
});

test('stable automatic reference meets numeric criteria without fabricating human review',()=>{
 const {S,states}=harness();states.set('image',{result:within,referenceSource:'AUTO',confirmation:'UNREVIEWED'});
 const a=S.getAssessment('image');assert.equal(a.state,'pass');assert.equal(a.label,'OM 자동 기준 충족');assert.equal(a.decisionSource,'AUTOMATIC');assert.equal(a.user_confirmation,'UNREVIEWED');assert.match(a.reason,/사용자 미확인/);
});

test('automatic reference does not relabel numeric failure as a review-only state',()=>{
 const {S,states}=harness();
 for(const metric of [{areaPercent:5.01},{particleDensityPer10k:10.01}]){
  states.set('image',{result:{...within,...metric},referenceSource:'AUTO',confirmation:'UNREVIEWED'});
  const a=S.getAssessment('image');assert.equal(a.state,'fail');assert.equal(a.label,'OM 기준 초과 · 검토 필요');
 }
});

test('review completion promotes an otherwise valid result to final OM pass',()=>{
 const {S}=harness(),a=S.assessResult(within,'OVERLAY_REVIEWED',policy);
 assert.equal(a.state,'pass');assert.equal(a.label,'OM 기준 충족 · 확인 완료');assert.match(a.reason,/확인 완료/);
});

test('unstable reference remains a separate reason even with low area and density',()=>{
 const {S}=harness(),a=S.assessResult({...within,referenceSpreadPercent:5},'UNREVIEWED',policy);
 assert.equal(a.state,'pending');assert.equal(a.label,'기준 영역 재확인');assert.doesNotMatch(a.label,/수치 기준 충족/);
});

test('missing analysis and explicit further-review status keep their existing priority',()=>{
 const {S}=harness();assert.equal(S.assessResult(null,'UNREVIEWED',policy).label,'자동 분석 대기');
 const a=S.assessResult({...within,areaPercent:8},'NEEDS_FURTHER_REVIEW',policy);
 assert.equal(a.state,'pending');assert.equal(a.label,'추가 검토');
});
