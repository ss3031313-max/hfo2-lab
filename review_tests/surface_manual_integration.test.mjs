// Software geometry and review-flow checks; these do not validate physical defect labels.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'src/surface_review.js'),'utf8');
const ctx=vm.createContext({console});
for(const name of ['manual_stain_regions.js','surface_diagnostics.js','surface_review.js'])vm.runInContext(fs.readFileSync(path.join(root,'src',name),'utf8'),ctx);
const S=ctx.Hfo2Surface,plain=v=>JSON.parse(JSON.stringify(v));
const roi={left:10,top:10,right:90,bottom:90},reference={left:15,top:15,right:20,bottom:20};
const policy={threshold:5,minArea:16,particleMinArea:2,areaLimit:5,particleDensityLimit:10};
function fixture(){
 const width=100,height=100,imageData=new Uint8ClampedArray(width*height*4);
 for(let i=0;i<imageData.length;i+=4){imageData[i]=imageData[i+1]=imageData[i+2]=180;imageData[i+3]=255;}
 for(const [left,top,size] of [[30,30,10],[70,70,2]])for(let y=top;y<top+size;y++)for(let x=left;x<left+size;x++){const i=(y*width+x)*4;imageData[i]=imageData[i+1]=imageData[i+2]=40;}
 return S.analyzePixels({width,height,imageData,roi,reference,...policy});
}
const region=(id='one',x=35,y=35,size=10)=>({id,points:[{x,y},{x:x+size,y},{x:x+size,y:y+size},{x,y:y+size}],note:'원본의 옅은 얼룩 윤곽 확인',createdAt:'2026-10-27T00:00:00.000Z'});
function correction(raw,action='EXCLUDE_COUNT'){return {...S.inspectComponent(raw,raw.mask,{x:32,y:32}),action,reason:action==='EXCLUDE_COUNT'?'NON_PARTICLE_PATTERN':'ANNOTATION',note:'',updatedAt:'2026-10-27T00:00:00.000Z'};}
function snapshot(raw,edits=[],regions=[]){return {imageSignature:'test-signature',roiKey:JSON.stringify(roi),manualCorrections:edits,manualStainRegions:regions,confirmation:'OVERLAY_REVIEWED',analysisSettings:{roi,reference,threshold:raw.threshold,minArea:raw.minArea,particleMinArea:raw.particleMinArea,referenceSource:'AUTO'}};}

test('manual polygon unions with automatic area and never increases particle counts',()=>{
 const raw=fixture(),before=plain(raw),out=S.applyAllReview(raw,raw.mask,[],[region()]);
 assert.equal(out.result.retainedPixelCount,175); // 100+100-25 overlapping pixels.
 assert.equal(out.result.areaPercent,175/6400*100);
 assert.equal(out.result.manualAddedPixelCount,75);
 assert.equal(out.result.particleCount,raw.particleCount);
 assert.equal(out.result.particleDensityPer10k,raw.particleDensityPer10k);
 assert.equal(out.result.correctionCount,1);
 assert.equal(out.result.automaticMetrics.retainedPixelCount,100);
 assert.deepEqual(plain(raw),before);
});
test('exclusion edits preserve polygons and count-only exclusion retains automatic area',()=>{
 const raw=fixture(),regions=[region()],one=S.applyAllReview(raw,raw.mask,[correction(raw)],regions),again=S.applyAllReview(raw,raw.mask,[correction(raw)],regions);
 assert.equal(one.result.retainedPixelCount,175);
 assert.equal(one.result.particleCount,1);
 assert.equal(one.result.correctionCount,2);
 assert.equal(one.result.automaticMetrics.particleCount,2);
 assert.deepEqual(plain(one.result),plain(again.result));
 assert.equal(one.displayMask[20*80+20],3);
});
test('area exclusion and manual union are independent and restoring exclusion preserves manual addition',()=>{
 const raw=fixture(),regions=[region()],excluded=S.applyAllReview(raw,raw.mask,[correction(raw,'EXCLUDE_ALL')],regions),restored=S.applyAllReview(raw,raw.mask,[],regions);
 assert.equal(excluded.result.retainedPixelCount,100);
 assert.equal(excluded.result.particleCount,1);
 assert.equal(excluded.result.manualAddedPixelCount,100);
 assert.equal(restored.result.retainedPixelCount,175);
 assert.equal(restored.result.particleCount,2);
});
test('deleting one polygon retains other geometry and deleting all exactly restores automatic area',()=>{
 const raw=fixture(),regions=[region(),region('two',50,50,10)],both=S.applyAllReview(raw,raw.mask,[],regions),one=S.applyAllReview(raw,raw.mask,[],regions.slice(1)),none=S.applyAllReview(raw,raw.mask,[],[]);
 assert.equal(both.result.retainedPixelCount,275);assert.equal(one.result.retainedPixelCount,200);assert.equal(none.result.retainedPixelCount,100);
 assert.equal(none.result.manualRegionCount,0);assert.equal(none.result.correctionCount,0);
 for(const key of ['areaPercent','particleCount','particleDensityPer10k'])assert.equal(none.result[key],raw[key]);
});
test('unexplained or invalid polygon fails without mutating automatic arrays',()=>{
 const raw=fixture(),before=plain(raw);
 for(const bad of [{...region(),note:''},{...region(),note:'   '},{...region(),points:[{x:0,y:0},{x:50,y:50},{x:70,y:70}]}])assert.throws(()=>S.applyAllReview(raw,raw.mask,[],[bad]));
 assert.deepEqual(plain(raw),before);
});
test('manual addition requires review even when reference was automatic',()=>{
 const raw=fixture(),out=S.applyAllReview(raw,raw.mask,[],[region()]).result;out.reference_source='AUTO';
 assert.equal(S.assessResult(out,'UNREVIEWED',policy).state,'pending');
 assert.equal(S.assessResult(out,'OVERLAY_REVIEWED',policy).state,'pass');
 const fail=S.applyAllReview(raw,raw.mask,[],[region('wide',30,30,25)]).result;fail.reference_source='AUTO';
 assert.equal(S.assessResult(fail,'UNREVIEWED',policy).state,'fail');
});
test('matching backup restores polygons, exclusions and prior confirmation eligibility',()=>{
 const raw=fixture(),payload=snapshot(raw,[correction(raw)],[region()]),restored=S.restoreReviewCorrections(payload,'test-signature',roi,reference,policy,'AUTO',raw,raw.mask);
 assert.equal(restored.allowConfirmation,true);assert.equal(restored.corrections.length,1);assert.equal(restored.manualRegions.length,1);
 assert.equal(restored.result.retainedPixelCount,175);assert.equal(restored.result.particleCount,1);
 const rebuilt=S.applyAllReview(raw,raw.mask,restored.corrections,restored.manualRegions);assert.deepEqual(plain(rebuilt.result),plain(restored.result));
});
test('changed pixels, ROI, detection or reference reject manual additions and confirmation',()=>{
 const raw=fixture(),payload=snapshot(raw,[],[region()]);
 for(const [signature,area,ref,p] of [['changed',roi,reference,policy],['test-signature',{...roi,left:11},reference,policy],['test-signature',roi,{...reference,left:16},policy],['test-signature',roi,reference,{...policy,threshold:4}]]){
  const out=S.restoreReviewCorrections(payload,signature,area,ref,p,'AUTO',raw,raw.mask);assert.equal(out.allowConfirmation,false);assert.equal(out.manualRegions.length,0);assert.equal(out.result,raw);
 }
});
test('invalid manual backups fail closed; legacy snapshots without polygons are unchanged',()=>{
 const raw=fixture();for(const invalid of [{},'bad',[{...region(),note:''}],[{...region(),points:[{x:500,y:500}]}]]){const payload=snapshot(raw);payload.manualStainRegions=invalid;const out=S.restoreReviewCorrections(payload,'test-signature',roi,reference,policy,'AUTO',raw,raw.mask);assert.equal(out.allowConfirmation,false);assert.equal(out.manualRegions.length,0);assert.equal(out.result,raw);}
 const old=snapshot(raw);delete old.manualStainRegions;const out=S.restoreReviewCorrections(old,'test-signature',roi,reference,policy,'AUTO',raw,raw.mask);assert.equal(out.allowConfirmation,true);assert.equal(out.result,raw);
});
test('numeric exceedance is retained; sensitivity only holds unreviewed numeric passes',()=>{
 const raw=fixture();raw.reference_source='AUTO';raw.diagnostics={version:1,currentThreshold:5,thresholds:[{threshold:4,areaPercent:8,particleDensityPer10k:3},{threshold:5,areaPercent:raw.areaPercent,particleDensityPer10k:raw.particleDensityPer10k},{threshold:6,areaPercent:1,particleDensityPer10k:1}],roiCoveragePercent:64};
 const automatic=S.assessResult(raw,'UNREVIEWED',policy);assert.equal(automatic.state,'pending');assert.match(automatic.label,/설정 민감/);
 assert.equal(S.assessResult(raw,'OVERLAY_REVIEWED',policy).state,'pass');
 assert.equal(S.assessResult({...raw,areaPercent:7},'UNREVIEWED',policy).state,'fail');
});
test('backup export deep-clones polygon records and preserves geometry for replay',()=>{
 const raw=fixture(),out=S.applyAllReview(raw,raw.mask,[correction(raw)],[region()]).result,state={result:out,automaticResult:raw,reference,referenceSource:'AUTO',roiKey:JSON.stringify(roi),imageSignature:'test-signature',corrections:[correction(raw)],manualRegions:[region()],confirmation:'OVERLAY_REVIEWED'};
 const c=vm.createContext({states:new Map([['image',state]]),getPolicy:()=>policy});
 const cloneStart=source.indexOf('function cloneManualRegions('),cloneEnd=source.indexOf('\nfunction applyAllReview',cloneStart),exportStart=source.indexOf('function exportState('),exportEnd=source.indexOf('// SHA-256',exportStart);
 vm.runInContext(source.slice(cloneStart,cloneEnd)+'\n'+source.slice(exportStart,exportEnd),c);
 const saved=c.exportState().images[0];assert.deepEqual(plain(saved.manualStainRegions),plain(state.manualRegions));saved.manualStainRegions[0].points[0].x=50;assert.equal(state.manualRegions[0].points[0].x,35);
 const restored=S.restoreReviewCorrections(c.exportState().images[0],'test-signature',roi,reference,policy,'AUTO',raw,raw.mask);assert.equal(restored.result.retainedPixelCount,175);assert.equal(restored.result.particleCount,1);
});
function actionHarness(){
 const raw=fixture(),mask=raw.mask,automatic={...raw};delete automatic.mask;
 const state={automaticResult:automatic,result:automatic,corrections:[],manualRegions:[],confirmation:'OVERLAY_REVIEWED'};
 const fields=new Map([['srStainNote',{value:'원본의 옅은 얼룩 윤곽 확인'}],['srReviewPanel',{open:false}]]),renders=[],errors=[],feedback=[];let emissions=0;
 const c=vm.createContext({console,current:'image',busy:false,policyError:'',stainDraft:region().points.map(point=>({...point})),state:()=>state,$:id=>fields.get(id),reviewMask:()=>mask,masks:new Map([['image',mask]]),applyAllReview:S.applyAllReview,displayCache:null,error:message=>errors.push(message),fmt:(value,d=2)=>value.toFixed(d),render:()=>renders.push({area:state.result.areaPercent,count:state.result.particleCount,confirmation:state.confirmation}),emit:()=>{emissions++;},reviewFeedback:(...args)=>feedback.push(args)});
 const start=source.indexOf('function applyManualStain('),end=source.indexOf('\nfunction drawStainPolygon(',start);vm.runInContext(source.slice(start,end),c);
 return {raw,mask,state,c,fields,renders,errors,feedback,get emissions(){return emissions;}};
}
test('applying a drawn polygon refreshes visible area, confirmation, display mask and emits the comparison/save update',()=>{
 const h=actionHarness();h.c.applyManualStain();
 assert.equal(h.state.manualRegions.length,1);assert.equal(h.state.result.retainedPixelCount,175);assert.equal(h.state.result.particleCount,2);assert.equal(h.state.confirmation,'UNREVIEWED');assert.equal(h.c.stainDraft.length,0);
 assert.equal(h.renders.length,1);assert.equal(h.emissions,1);assert.equal(h.renders[0].area,175/6400*100);assert.equal(h.c.displayCache.mask.some(value=>value===6),true);assert.equal(h.fields.get('srReviewPanel').open,true);assert.equal(h.fields.get('srStainNote').value,'');
});
test('an invalid manual polygon action remains atomic and keeps the previous review',()=>{
 for(const invalid of ['note','geometry']){const h=actionHarness(),before=h.state.result;if(invalid==='note')h.fields.get('srStainNote').value='';else h.c.stainDraft=[{x:35,y:35},{x:45,y:45},{x:35,y:45},{x:45,y:35}];h.c.applyManualStain();assert.equal(h.state.result,before);assert.equal(h.state.manualRegions.length,0);assert.equal(h.state.confirmation,'OVERLAY_REVIEWED');assert.equal(h.renders.length,0);assert.equal(h.emissions,0);assert.ok(h.errors.at(-1));}
});
test('cancelling an applied manual polygon recomputes area while retaining a count exclusion',()=>{
 const h=actionHarness(),edit=correction(h.raw);h.state.corrections=[edit];h.state.result=S.applyAllReview(h.state.automaticResult,h.mask,[edit],[]).result;h.c.applyManualStain();const id=h.state.manualRegions[0].id;h.state.confirmation='OVERLAY_REVIEWED';h.c.removeManualStain(id);
 assert.equal(h.state.manualRegions.length,0);assert.equal(h.state.corrections.length,1);assert.equal(h.state.result.retainedPixelCount,100);assert.equal(h.state.result.particleCount,1);assert.equal(h.state.confirmation,'UNREVIEWED');assert.equal(h.emissions,2);assert.equal(h.renders.at(-1).area,h.raw.areaPercent);
});
