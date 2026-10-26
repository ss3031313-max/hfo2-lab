// File drops use the same registration paths as the native file chooser.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const rootPath=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source=fs.readFileSync(path.join(rootPath,'src/quick_import.js'),'utf8');
const context=vm.createContext({});vm.runInContext(source,context);
const {isFileDrag,uploadTypeError,bindFileDropZone,mergeWorkbooks}=context.Hfo2QuickImport;
const file=name=>({name});
function zone(){const handlers={},classes=new Set();return {handlers,classes,addEventListener:(name,fn)=>handlers[name]=fn,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},contains:node=>node?.inside===true};}
function event(files=[file('a.png')],extra={}){return {dataTransfer:{files,types:['Files'],dropEffect:'none'},prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra};}
function fixture(opts={}){const z=zone(),calls=[],errors=[];let busy=false;const controller=bindFileDropZone(z,{onFiles:files=>calls.push(files),isBusy:()=>busy,onError:error=>errors.push(error),...opts});return {z,calls,errors,controller,setBusy:x=>busy=x};}
const plain=value=>JSON.parse(JSON.stringify(value));

test('OS file drag is recognized while protected file list is empty; text and image URLs are not uploads',()=>{
 assert.equal(isFileDrag(event([])),true);
 assert.equal(isFileDrag(event([],{dataTransfer:{types:[],items:[{kind:'file'}]}})),true);
 assert.equal(isFileDrag(event([],{dataTransfer:{types:['text/plain','text/uri-list'],files:[]}})),false);
 assert.equal(isFileDrag({}),false);
});
test('multiple dropped File objects reach the importer intact and native navigation is stopped',()=>{
 const f=fixture(),files=[file('one.png'),file('two.PNG')],e=event(files);f.z.handlers.drop(e);
 assert.equal(e.prevented,true);assert.equal(e.stopped,true);assert.equal(f.calls.length,1);
 assert.equal(f.calls[0][0],files[0]);assert.equal(f.calls[0][1],files[1]);assert.equal(f.z.classes.size,0);
});
test('drag hover stays active across nested targets and clears after the balanced final leave',()=>{
 const f=fixture();f.z.handlers.dragenter(event());f.z.handlers.dragenter(event());
 f.z.handlers.dragleave(event([],{relatedTarget:{inside:true}}));assert.equal(f.z.classes.has('quick-drop-active'),true);
 f.z.handlers.dragleave(event([],{relatedTarget:null}));assert.equal(f.z.classes.size,0);
 f.z.handlers.dragenter(event());f.z.handlers.dragend();assert.equal(f.z.classes.size,0);
});
test('leaving to an outside target resets hover even if an inner event was missed',()=>{
 const f=fixture();f.z.handlers.dragenter(event());f.z.handlers.dragenter(event());f.z.handlers.dragleave(event([],{relatedTarget:{inside:false}}));assert.equal(f.z.classes.size,0);
});
test('busy file drops are rejected without importing and clear drag highlight',()=>{
 const f=fixture();f.z.handlers.dragenter(event());f.setBusy(true);const over=event();f.z.handlers.dragover(over);assert.equal(over.dataTransfer.dropEffect,'none');
 const e=event();f.z.handlers.drop(e);assert.equal(f.calls.length,0);assert.match(f.errors[0],/파일 처리 중/);assert.equal(e.prevented,true);assert.equal(f.z.classes.size,0);
});
test('non-file drops are left alone, and empty file drops explain that folders are unsupported',()=>{
 const f=fixture(),url=event([],{dataTransfer:{types:['text/uri-list'],files:[]}});f.z.handlers.drop(url);assert.equal(url.prevented,false);assert.equal(f.calls.length,0);
 f.z.handlers.drop(event([]));assert.match(f.errors[0],/폴더 대신 파일/);
});
test('a rejected asynchronous importer gives a visible error instead of an unhandled rejection',async()=>{
 const f=fixture({onFiles:async()=>{throw new Error('읽기 실패');}});f.z.handlers.drop(event());await new Promise(setImmediate);assert.equal(f.errors[0],'읽기 실패');
});
test('accepted image extensions and XLSX are separate; CSV explicitly routes to CSV 입력',()=>{
 for(const name of ['x.jpg','x.JPEG','x.png','x.webp','x.BMP'])assert.equal(uploadTypeError(file(name),'image'),'');
 assert.match(uploadTypeError(file('x.xlsx'),'image'),/OM 사진/);assert.equal(uploadTypeError(file('x.XLSX'),'workbook'),'');
 assert.match(uploadTypeError(file('x.CSV'),'workbook'),/CSV 입력.*공정조건 CSV.*두께 CSV/);
 assert.match(uploadTypeError(file('x.xls'),'workbook'),/\.xlsx/);
});
function importHarness({queue=[],readFile,addImage}={}){
 const elements={quickOmFiles:{value:'selected'},quickExcelFile:{value:'selected'},quickExcelMode:{value:'append'}},images=[],errors=[],statuses=[],flags=[],registered=[];
 let current=queue,updates=0,resolveCount=0;
 const scope=vm.createContext({uploadTypeError,mergeWorkbooks,Array,Map,root:{Hfo2Excel:{readFile:readFile|| (async f=>({filename:f.name,samples:[{id:f.name,image_id:null,points:[]}]}))}},
 B:{listImages:()=>images,addImage:async f=>{if(addImage)await addImage(f);images.push({id:f.name,filename:f.name});registered.push(f);}},
 I:{getQueue:()=>current},$:id=>elements[id],queueSignature:x=>JSON.stringify(x),showError:x=>errors.push(x),showStatus:x=>statuses.push(x),refresh:()=>{},
 resolveCurrentQueue:()=>resolveCount++,setResolvedQueue:result=>{current=result.samples;updates++;},setBusy:value=>{scope.busy=value;flags.push(value);}});
 vm.runInContext("var busy=false,hints=new Map(),manual={},latestMatches=[],workbookNames=[],workbookLabel='';\n"+source.slice(source.indexOf('async function importImageFiles('),source.indexOf("$('quickOmFiles').addEventListener('change'"))+"\nglobalThis.imports={images:importImageFiles,workbooks:importWorkbookFiles};",scope);
 return {scope,images,errors,statuses,flags,registered,elements,get queue(){return current;},get updates(){return updates;},get resolves(){return resolveCount;}};
}
test('image import handles valid multi-file additions and reports wrong types or decode failures individually',async()=>{
 const h=importHarness({addImage:async f=>{if(f.name==='broken.png')throw new Error('decode failed');}});
 await h.scope.imports.images([file('one.png'),file('bad.csv'),file('broken.png'),file('two.jpg')]);
 assert.deepEqual(h.registered.map(f=>f.name),['one.png','two.jpg']);assert.equal(h.resolves,1);assert.match(h.errors.at(-1),/bad.csv.*OM 사진[\s\S]*broken.png.*decode failed/);assert.deepEqual(h.flags,[true,false]);assert.equal(h.elements.quickOmFiles.value,'');
});
test('a dropped workbook batch imports together and duplicate handling stays in the shared merger',async()=>{
 const h=importHarness();const a=file('a.xlsx'),b=file('b.xlsx');await h.scope.imports.workbooks([a,b]);
 assert.deepEqual(Array.from(h.queue,s=>s.id),['a.xlsx','b.xlsx']);assert.equal(h.updates,1);
 await h.scope.imports.workbooks([a]);assert.equal(h.updates,1);assert.match(h.statuses.at(-1),/건너뜀 1개/);assert.equal(h.elements.quickExcelFile.value,'');
});
test('one unsupported CSV rejects the whole workbook batch before reads or queue changes',async()=>{
 let reads=0;const existing={id:'prior',image_id:null,points:[]},h=importHarness({queue:[existing],readFile:async()=>{reads++;}});
 await h.scope.imports.workbooks([file('valid.xlsx'),file('thickness.csv')]);assert.equal(reads,0);assert.equal(h.updates,0);assert.equal(h.queue[0],existing);assert.match(h.errors.at(-1),/CSV 입력[\s\S]*모두 적용하지 않았습니다/);
});
test('one unreadable workbook preserves the prior batch and busy imports never run',async()=>{
 let reads=0;const h=importHarness({queue:[{id:'old',points:[]}],readFile:async f=>{reads++;if(f.name==='bad.xlsx')throw new Error('손상');return {samples:[{id:'new',points:[]}]};}});
 await h.scope.imports.workbooks([file('ok.xlsx'),file('bad.xlsx')]);assert.equal(h.updates,0);assert.equal(h.queue[0].id,'old');assert.match(h.errors.at(-1),/손상/);
 h.scope.busy=true;await h.scope.imports.images([file('x.png')]);await h.scope.imports.workbooks([file('x.xlsx')]);assert.equal(h.registered.length,0);assert.equal(reads,2);
});
test('picker and drop callbacks refer to the same import functions',()=>{
 assert.match(source,/quickOmFiles'\)\.addEventListener\('change',\(\)=>\{void importImageFiles/);
 assert.match(source,/quickExcelFile'\)\.addEventListener\('change',\(\)=>\{void importWorkbookFiles/);
 assert.match(source,/quickOmDropZone'\),\{onFiles:importImageFiles/);assert.match(source,/quickExcelDropZone'\),\{onFiles:importWorkbookFiles/);
});
test('outside-zone file navigation is prevented without interfering with ordinary text drag/drop',()=>{
 const handlers={},document={documentElement:{},addEventListener:(name,fn)=>handlers[name]=fn};let resetCount=0;
 vm.runInNewContext(source.slice(source.indexOf('// A file dropped outside either card'),source.indexOf("$('quickPreview').addEventListener('change'")),{document,isFileDrag,dropZones:[{reset:()=>resetCount++}]});
 const e=event([],{target:{closest:()=>null}});handlers.dragover(e);assert.equal(e.prevented,true);assert.equal(e.dataTransfer.dropEffect,'none');handlers.drop(e);assert.equal(resetCount,1);
 const t=event([],{dataTransfer:{types:['text/plain'],files:[]}});handlers.drop(t);assert.equal(t.prevented,false);assert.equal(resetCount,1);
});
