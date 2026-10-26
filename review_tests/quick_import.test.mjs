// Exact image registration prevents upload order from becoming sample evidence.
// Run: node --test review_tests/quick_import.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const code=fs.readFileSync(path.join(root,'src/quick_import.js'),'utf8');
const context=vm.createContext({});
vm.runInContext(code,context);
const {resolveMappings,imageStem,mergeWorkbooks}=context.Hfo2QuickImport;
const sample=(id='DEMO-S01',fields={})=>({id,image_id:null,concentration_M:.2,coats:1,rpm:3000,spin_time_s:30,anneal_temp_C:550,anneal_time_min:120,data_source:'SYNTHETIC',points:[{position:'center',value:15},{position:'top',value:15.1}],...fields});
const image=(id,filename)=>({id,filename,image_data_url:'data:image/png;base64,AA=='});
const plain=value=>JSON.parse(JSON.stringify(value));

test('image_filename resolves only the exact registered filename',()=>{
 const result=resolveMappings([sample('DEMO-S01',{image_filename:'measured surface.png'})],[image('UPLOAD-002','other.png'),image('UPLOAD-001','measured surface.png')]);
 assert.equal(result.samples[0].image_id,'UPLOAD-001');
 assert.equal(result.matches[0].sample_id,'DEMO-S01');assert.equal(result.matches[0].kind,'filename');assert.equal(result.matches[0].requested,'measured surface.png');
 assert.match(result.matches[0].reason,/파일명 일치/);assert.equal(result.warnings.length,0);
});
test('a filename stored in image_id resolves to the internal upload ID',()=>{
 const result=resolveMappings([sample('DEMO-S01',{image_id:'SEM view.jpg'})],[image('UPLOAD-007','SEM view.jpg')]);
 assert.equal(result.samples[0].image_id,'UPLOAD-007');assert.equal(result.matches[0].kind,'filename');
});
test('a valid existing image ID is retained without filename guessing',()=>{
 const result=resolveMappings([sample('DEMO-S01',{image_id:'UPLOAD-006'})],[image('UPLOAD-002','DEMO-S01.png'),image('UPLOAD-006','unrelated-label.png')]);
 assert.equal(result.samples[0].image_id,'UPLOAD-006');assert.equal(result.matches[0].kind,'existing_id');
});
test('Sample ID matches an exact filename stem when no explicit image reference exists',()=>{
 const result=resolveMappings([sample('DEMO-S01')],[image('UPLOAD-001','DEMO-S010.png'),image('UPLOAD-004','DEMO-S01.PNG')]);
 assert.equal(result.samples[0].image_id,'UPLOAD-004');assert.equal(result.matches[0].kind,'sample_stem');assert.equal(result.matches[0].requested,'DEMO-S01');
});
test('upload order does not control assignment',()=>{
 const samples=[sample('DEMO-S01'),sample('DEMO-S02')],photos=[image('UPLOAD-B','DEMO-S02.png'),image('UPLOAD-A','DEMO-S01.png')];
 const forward=resolveMappings(samples,photos),reverse=resolveMappings(samples,[...photos].reverse());
 assert.deepEqual(Array.from(forward.samples,item=>item.image_id),['UPLOAD-A','UPLOAD-B']);
 assert.deepEqual(Array.from(reverse.samples,item=>item.image_id),['UPLOAD-A','UPLOAD-B']);
});
test('one unrelated photograph is never assigned simply because it is the only photograph',()=>{
 const result=resolveMappings([sample('DEMO-S01')],[image('UPLOAD-001','unlabelled.png')]);
 assert.equal(result.samples[0].image_id,null);assert.equal(result.matches[0].kind,'unlinked');assert.match(result.warnings[0],/DEMO-S01/);
});
test('unmatched sample remains pending while an exact match in the same batch succeeds',()=>{
 const result=resolveMappings([sample('DEMO-S01'),sample('DEMO-S02')],[image('UPLOAD-001','DEMO-S02.png')]);
 assert.deepEqual(Array.from(result.samples,item=>item.image_id),[null,'UPLOAD-001']);assert.equal(result.warnings.length,1);assert.match(result.warnings[0],/DEMO-S01/);
});
test('duplicate exact filenames are ambiguous and require direct selection',()=>{
 const result=resolveMappings([sample('DEMO-S01',{image_filename:'surface.png'})],[image('UPLOAD-001','surface.png'),image('UPLOAD-002','surface.png')]);
 assert.equal(result.samples[0].image_id,null);assert.equal(result.matches[0].kind,'ambiguous');assert.match(result.matches[0].reason,/2장.*직접 선택/);assert.equal(result.warnings.length,1);
});
test('different extensions with the same Sample ID stem are also ambiguous',()=>{
 const result=resolveMappings([sample('DEMO-S01')],[image('UPLOAD-001','DEMO-S01.png'),image('UPLOAD-002','DEMO-S01.jpg')]);
 assert.equal(result.samples[0].image_id,null);assert.equal(result.matches[0].kind,'ambiguous');
});
test('filename and Sample ID stem matching are case sensitive',()=>{
 const explicit=resolveMappings([sample('DEMO-S01',{image_filename:'Surface.png'})],[image('UPLOAD-001','surface.png')]);
 const stem=resolveMappings([sample('DEMO-S01')],[image('UPLOAD-002','demo-s01.png')]);
 assert.equal(explicit.samples[0].image_id,null);assert.equal(stem.samples[0].image_id,null);
});
test('an unresolved explicit filename never falls back to the Sample ID stem',()=>{
 const result=resolveMappings([sample('DEMO-S01',{image_filename:'required.png'})],[image('UPLOAD-001','DEMO-S01.png')]);
 assert.equal(result.samples[0].image_id,null);assert.equal(result.matches[0].requested,'required.png');assert.match(result.matches[0].reason,/일치 파일 없음/);
});
test('an unresolved explicit image ID never falls back to the Sample ID stem',()=>{
 const result=resolveMappings([sample('DEMO-S01',{image_id:'UPLOAD-MISSING'})],[image('UPLOAD-001','DEMO-S01.png')]);
 assert.equal(result.samples[0].image_id,null);assert.equal(result.matches[0].requested,'UPLOAD-MISSING');
});
test('an explicit workbook filename has priority over a different image_id',()=>{
 const result=resolveMappings([sample('DEMO-S01',{image_filename:'preferred.png',image_id:'UPLOAD-001'})],[image('UPLOAD-001','old.png'),image('UPLOAD-002','preferred.png')]);
 assert.equal(result.samples[0].image_id,'UPLOAD-002');assert.equal(result.matches[0].kind,'filename');
});
test('manual mapping overrides filename hints and duplicate-name ambiguity',()=>{
 const result=resolveMappings([sample('DEMO-S01',{image_filename:'surface.png',image_id:'UPLOAD-001'})],[image('UPLOAD-001','surface.png'),image('UPLOAD-002','surface.png')],{'DEMO-S01':'UPLOAD-002'});
 assert.equal(result.samples[0].image_id,'UPLOAD-002');assert.equal(result.matches[0].kind,'manual');assert.equal(result.matches[0].reason,'직접 연결');assert.equal(result.warnings.length,0);
});
test('explicit manual unlink remains unlinked despite an available automatic match',()=>{
 for(const unlink of [null,'']){
  const result=resolveMappings([sample('DEMO-S01')],[image('UPLOAD-001','DEMO-S01.png')],{'DEMO-S01':unlink});
  assert.equal(result.samples[0].image_id,null);assert.equal(result.matches[0].kind,'manual');assert.equal(result.matches[0].reason,'직접 미연결');assert.equal(result.warnings.length,1);
 }
});
test('an invalid manual image ID is rejected instead of being guessed or silently cleared',()=>{
 assert.throws(()=>resolveMappings([sample('DEMO-S01')],[image('UPLOAD-001','DEMO-S01.png')],{'DEMO-S01':'UPLOAD-MISSING'}),/DEMO-S01.*선택한 OM 이미지를 찾을 수 없습니다/);
});
test('prototype properties are not treated as explicit manual mappings',()=>{
 const overrides=Object.create({'DEMO-S01':null});
 const result=resolveMappings([sample('DEMO-S01')],[image('UPLOAD-001','DEMO-S01.png')],overrides);
 assert.equal(result.samples[0].image_id,'UPLOAD-001');assert.equal(result.matches[0].kind,'sample_stem');
});
test('mapping preserves source, process metadata, point values and all input objects',()=>{
 const samples=[sample('DEMO-S01',{image_filename:'sample.png'})],images=[image('UPLOAD-001','sample.png')],overrides={},before=JSON.stringify({samples,images,overrides});
 const result=resolveMappings(samples,images,overrides);
 assert.equal(JSON.stringify({samples,images,overrides}),before);assert.notEqual(result.samples[0],samples[0]);
 const expected={...samples[0],image_id:'UPLOAD-001'};assert.deepEqual(plain(result.samples[0]),expected);
});
test('empty registry and empty queue preserve explicit missing-data outcomes',()=>{
 const empty=resolveMappings([],[]);assert.equal(empty.samples.length,0);assert.equal(empty.matches.length,0);assert.equal(empty.warnings.length,0);
 const missing=resolveMappings([sample()],[]);assert.equal(missing.samples.length,1);assert.equal(missing.samples[0].image_id,null);assert.equal(missing.warnings.length,1);
});
test('imageStem removes only a final supported image extension',()=>{
 assert.equal(imageStem('sample.v1.JPEG'),'sample.v1');assert.equal(imageStem('sample.webp'),'sample');assert.equal(imageStem('sample.bmp'),'sample');
 assert.equal(imageStem('sample.png.backup'),'sample.png.backup');assert.equal(imageStem('sample.tiff'),'sample.tiff');
});

const workbook=(filename,samples,warnings=[])=>({filename,samples,warnings});
const mergeOptions=(result,images=[])=>({images,hints:result.hints,manual:result.manual,matches:result.matches});
const mergeSnapshot=(current,workbooks,options)=>JSON.stringify({current,workbooks,images:options.images,hints:Array.from(options.hints||[]),manual:options.manual,matches:options.matches});

test('workbooks append by default without replacing the existing analysis queue',()=>{
 const current=[sample('DEMO-A')],incoming=sample('DEMO-B');
 const result=mergeWorkbooks(current,[workbook('batch-B.xlsx',[incoming])]);
 assert.equal(result.mode,'append');assert.deepEqual(Array.from(result.samples,item=>item.id),['DEMO-A','DEMO-B']);
 assert.equal(result.samples[0],current[0]);assert.equal(result.added,1);assert.equal(result.skipped,0);assert.equal(result.changed,true);assert.equal(result.pointCount,4);
 assert.deepEqual(Array.from(result.filenames),['batch-B.xlsx']);assert.equal(result.hints.get('DEMO-B').image_id,null);
});
test('sequential workbook imports accumulate and later identical files do not update the queue',()=>{
 const a=sample('DEMO-A'),b=sample('DEMO-B'),c=sample('DEMO-C');
 const first=mergeWorkbooks([],[workbook('A.xlsx',[a])]);
 const second=mergeWorkbooks(first.samples,[workbook('B.xlsx',[b]),workbook('C.xlsx',[c])],mergeOptions(first));
 const third=mergeWorkbooks(second.samples,[workbook('A-again.xlsx',[a])],mergeOptions(second));
 assert.deepEqual(Array.from(third.samples,item=>item.id),['DEMO-A','DEMO-B','DEMO-C']);
 assert.equal(second.added,2);assert.equal(third.added,0);assert.equal(third.skipped,1);assert.equal(third.changed,false);assert.equal(third.pointCount,6);
 assert.equal(third.samples[0],first.samples[0]);assert.equal(third.hints.size,3);
});
test('replacement is explicit and discards samples and filename hints absent from the incoming list',()=>{
 const current=[sample('DEMO-A'),sample('DEMO-B')],hints=new Map([['DEMO-A',{image_filename:'old-a.png',image_id:null}],['DEMO-B',{image_filename:'old-b.png',image_id:null}]]);
 const result=mergeWorkbooks(current,[workbook('new.xlsx',[sample('DEMO-C')])],{mode:'replace',hints});
 assert.equal(result.mode,'replace');assert.deepEqual(Array.from(result.samples,item=>item.id),['DEMO-C']);assert.equal(result.added,1);assert.equal(result.skipped,0);assert.equal(result.changed,true);
 assert.deepEqual(Array.from(result.hints.keys()),['DEMO-C']);
});
test('identical incoming IDs across selected workbooks are rejected with both filenames',()=>{
 const incoming=sample('DEMO-A');
 assert.throws(()=>mergeWorkbooks([],[workbook('first.xlsx',[incoming]),workbook('second.xlsx',[{...incoming}])]),error=>/Sample ID 중복/.test(error.message)&&/DEMO-A/.test(error.message)&&/first\.xlsx/.test(error.message)&&/second\.xlsx/.test(error.message));
});
test('duplicates inside a selected workbook are rejected before any merge',()=>{
 const incoming=sample('DEMO-A');
 assert.throws(()=>mergeWorkbooks([],[workbook('duplicate.xlsx',[incoming,incoming])]),/Sample ID 중복.*DEMO-A.*duplicate\.xlsx/);
});
test('identical source, process and measured values are skipped without replacing current sample objects',()=>{
 const prior=sample('DEMO-A',{stats:{mean:15.05,n:2,cv:.47},editText:'15,15.1'});
 const incoming=sample('DEMO-A',{points:[...prior.points].reverse()});
 const result=mergeWorkbooks([prior],[workbook('same.xlsx',[incoming])]);
 assert.equal(result.skipped,1);assert.equal(result.added,0);assert.equal(result.changed,false);assert.equal(result.samples[0],prior);
 assert.deepEqual(plain(result.samples[0].stats),prior.stats);assert.equal(result.samples[0].editText,'15,15.1');
});
test('changed thickness, position, process or source conflicts require an explicit list replacement',()=>{
 const current=sample('DEMO-A');
 const variants=[
  {...current,points:[{position:'center',value:16},{position:'top',value:15.1}]},
  {...current,points:[{position:'bottom',value:15},{position:'top',value:15.1}]},
  {...current,points:current.points.slice(0,1)},
  {...current,concentration_M:.4},
  {...current,coats:2},
  {...current,rpm:4000},
  {...current,spin_time_s:45},
  {...current,anneal_temp_C:600},
  {...current,anneal_time_min:90},
  {...current,data_source:'REAL_MEASUREMENT'}
 ];
 for(const incoming of variants)assert.throws(()=>mergeWorkbooks([current],[workbook('changed.xlsx',[incoming])]),/DEMO-A.*changed\.xlsx.*목록 교체/);
});
test('a known original workbook image reference conflicts even when the current image was manually changed',()=>{
 const photos=[image('UPLOAD-A','original.png'),image('UPLOAD-B','manual.png')],current=sample('DEMO-A',{image_id:'UPLOAD-B'});
 const options={images:photos,hints:new Map([['DEMO-A',{image_filename:'original.png',image_id:null}]]),manual:{'DEMO-A':'UPLOAD-B'}};
 const sameOriginal=mergeWorkbooks([current],[workbook('same.xlsx',[sample('DEMO-A',{image_filename:'original.png'})])],options);
 assert.equal(sameOriginal.skipped,1);assert.equal(sameOriginal.samples[0].image_id,'UPLOAD-B');
 assert.throws(()=>mergeWorkbooks([current],[workbook('changed-reference.xlsx',[sample('DEMO-A',{image_filename:'manual.png'})])],options),/목록 교체/);
 assert.throws(()=>mergeWorkbooks([current],[workbook('blank-reference.xlsx',[sample('DEMO-A')])],options),/목록 교체/);
});
test('the same original filename and its uniquely mapped internal ID are equivalent references',()=>{
 const photos=[image('UPLOAD-A','original.png')],current=sample('DEMO-A',{image_id:'UPLOAD-A'}),hints=[['DEMO-A',{image_filename:'original.png',image_id:null}]];
 const result=mergeWorkbooks([current],[workbook('id-reference.xlsx',[sample('DEMO-A',{image_id:'UPLOAD-A'})])],{images:photos,hints});
 assert.equal(result.skipped,1);assert.equal(result.changed,false);assert.equal(result.samples[0].image_id,'UPLOAD-A');
});
test('restored mapped queue accepts an otherwise identical incoming blank reference without erasing the image',()=>{
 const prior=sample('DEMO-A',{image_id:'UPLOAD-A'}),photos=[image('UPLOAD-A','original.png')];
 const result=mergeWorkbooks([prior],[workbook('restored-again.xlsx',[sample('DEMO-A')])],{images:photos});
 assert.equal(result.samples[0],prior);assert.equal(result.samples[0].image_id,'UPLOAD-A');assert.equal(result.skipped,1);assert.equal(result.changed,false);
});
test('append preserves explicit manual links and manual unlink decisions for retained samples',()=>{
 const current=[sample('DEMO-A',{image_id:'UPLOAD-MANUAL'}),sample('DEMO-B',{image_id:null})],manual={'DEMO-A':'UPLOAD-MANUAL','DEMO-B':null};
 const photos=[image('UPLOAD-MANUAL','picked.png'),image('UPLOAD-A','DEMO-A.png'),image('UPLOAD-B','DEMO-B.png'),image('UPLOAD-C','DEMO-C.png')];
 const result=mergeWorkbooks(current,[workbook('next.xlsx',[sample('DEMO-C')])],{images:photos,manual});
 assert.deepEqual(Array.from(result.samples,item=>item.image_id),['UPLOAD-MANUAL',null,'UPLOAD-C']);
 assert.deepEqual(plain(result.manual),manual);assert.equal(result.matches[0].kind,'manual');assert.equal(result.matches[1].reason,'직접 미연결');
});
test('replacement preserves manual decisions only for IDs retained in the replacement list',()=>{
 const photos=[image('UPLOAD-MANUAL','picked.png'),image('UPLOAD-A','DEMO-A.png'),image('UPLOAD-B','DEMO-B.png')];
 const current=[sample('DEMO-A',{image_id:'UPLOAD-MANUAL'}),sample('DEMO-B'),sample('DEMO-REMOVED')];
 const result=mergeWorkbooks(current,[workbook('replacement.xlsx',[sample('DEMO-A',{image_filename:'DEMO-A.png'}),sample('DEMO-B',{image_filename:'DEMO-B.png'})])],{mode:'replace',images:photos,manual:{'DEMO-A':'UPLOAD-MANUAL','DEMO-B':null,'DEMO-REMOVED':'UPLOAD-MANUAL'}});
 assert.deepEqual(Array.from(result.samples,item=>item.image_id),['UPLOAD-MANUAL',null]);
 assert.deepEqual(plain(result.manual),{'DEMO-A':'UPLOAD-MANUAL','DEMO-B':null});assert.equal(result.matches[1].reason,'직접 미연결');
});
test('append retains every current mapping rather than rematching current samples against new photos',()=>{
 const current=[sample('DEMO-A',{image_id:null}),sample('DEMO-B',{image_id:'UPLOAD-OLD'})];
 const photos=[image('UPLOAD-A','DEMO-A.png'),image('UPLOAD-OLD','same.png'),image('UPLOAD-DUPLICATE','same.png'),image('UPLOAD-C','DEMO-C.png')];
 const previous={sample_id:'DEMO-B',image_id:'UPLOAD-OLD',kind:'manual',requested:'',reason:'확인된 기존 연결'};
 const result=mergeWorkbooks(current,[workbook('new.xlsx',[sample('DEMO-C')])],{images:photos,matches:[previous]});
 assert.deepEqual(Array.from(result.samples,item=>item.image_id),[null,'UPLOAD-OLD','UPLOAD-C']);assert.equal(result.samples[0],current[0]);assert.equal(result.samples[1],current[1]);
 assert.equal(result.matches[1].reason,previous.reason);assert.notEqual(result.matches[1],previous);
});
test('workbook warnings retain their filenames and duplicate skip does not add the same points again',()=>{
 const current=[sample('DEMO-A')],result=mergeWorkbooks(current,[workbook('same.xlsx',[sample('DEMO-A')],['위치 2개 확인']),workbook('new.xlsx',[sample('DEMO-B')],['OM 연결 확인'])]);
 assert.deepEqual(Array.from(result.warnings),['same.xlsx · 위치 2개 확인','new.xlsx · OM 연결 확인']);assert.equal(result.pointCount,4);assert.equal(result.added,1);assert.equal(result.skipped,1);
});
test('current queue, workbook payloads, hints and manual decisions remain unchanged on input conflict',()=>{
 const current=[sample('DEMO-A',{image_id:'UPLOAD-A'})],workbooks=[workbook('new.xlsx',[sample('DEMO-B')]),workbook('conflict.xlsx',[sample('DEMO-A',{rpm:999})])];
 const options={images:[image('UPLOAD-A','a.png')],hints:new Map([['DEMO-A',{image_filename:'a.png',image_id:null}]]),manual:{'DEMO-A':'UPLOAD-A'},matches:[{sample_id:'DEMO-A',image_id:'UPLOAD-A',kind:'manual',reason:'직접 연결'}]},before=mergeSnapshot(current,workbooks,options);
 assert.throws(()=>mergeWorkbooks(current,workbooks,options),/목록 교체/);assert.equal(mergeSnapshot(current,workbooks,options),before);
});
test('the 1000-sample limit is inclusive for accumulated append and rejects sample 1001',()=>{
 const current=Array.from({length:999},(_,index)=>sample('DEMO-'+index,{points:[]}));
 const exact=mergeWorkbooks(current,[workbook('last.xlsx',[sample('DEMO-999',{points:[]})])]);
 assert.equal(exact.samples.length,1000);assert.equal(exact.added,1);
 assert.throws(()=>mergeWorkbooks(exact.samples,[workbook('overflow.xlsx',[sample('DEMO-1000',{points:[]})])]),/1,000개 샘플.*목록 교체/);
});
test('the 100000-point limit is inclusive and counts accumulated points from all samples',()=>{
 const values=Array.from({length:99999},(_,index)=>({position:'P'+index,value:15})),current=[sample('DEMO-MANY',{points:values})];
 const exact=mergeWorkbooks(current,[workbook('last-point.xlsx',[sample('DEMO-LAST',{points:[{position:'P0',value:15}]})])]);
 assert.equal(exact.pointCount,100000);assert.equal(exact.samples.length,2);
 assert.throws(()=>mergeWorkbooks(exact.samples,[workbook('overflow.xlsx',[sample('DEMO-OVERFLOW',{points:[{position:'P0',value:15}]})])]),/100,000개 두께값.*목록 교체/);
});
test('hints, manual decisions and all input payloads remain unchanged when sample or point limits fail',()=>{
 const options={images:[image('UPLOAD-A','a.png')],hints:new Map([['DEMO-A',{image_filename:'a.png',image_id:null}]]),manual:{'DEMO-A':null},matches:[{sample_id:'DEMO-A',image_id:null,kind:'manual',reason:'직접 미연결'}]};
 const cases=[
  {current:Array.from({length:1000},(_,index)=>sample('DEMO-'+index,{points:[]})),workbooks:[workbook('too-many.xlsx',[sample('DEMO-NEW',{points:[]})])]},
  {current:[sample('DEMO-A',{points:Array.from({length:100000},(_,index)=>({position:'P'+index,value:15}))})],workbooks:[workbook('too-many-values.xlsx',[sample('DEMO-NEW')])]}
 ];
 for(const {current,workbooks} of cases){const before=mergeSnapshot(current,workbooks,options);assert.throws(()=>mergeWorkbooks(current,workbooks,options),/최대/);assert.equal(mergeSnapshot(current,workbooks,options),before);}
});
test('explicit replacement can replace conflicting values instead of silently overwriting them in append mode',()=>{
 const current=[sample('DEMO-A')],incoming=sample('DEMO-A',{rpm:4000,points:[{position:'center',value:18}]});
 const result=mergeWorkbooks(current,[workbook('replacement.xlsx',[incoming])],{mode:'replace'});
 assert.equal(result.samples.length,1);assert.equal(result.samples[0].rpm,4000);assert.equal(result.samples[0].points[0].value,18);assert.equal(result.added,1);assert.equal(result.skipped,0);assert.equal(result.changed,true);
});
