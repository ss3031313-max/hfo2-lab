// Node built-ins only; tests the same bundled XML/inflate implementation as the app.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {deflateRawSync} from 'node:zlib';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ctx=vm.createContext({console,TextDecoder,TextEncoder,Uint8Array,Uint32Array,DataView,ArrayBuffer});ctx.window=ctx;
const template=fs.readFileSync(path.join(root,'src/om_app.template.html'),'utf8');
for(const id of ['om-math','workflow-math'])vm.runInContext(template.match(new RegExp('<script id="'+id+'">([\\s\\S]*?)</script>'))[1],ctx);
for(const file of ['vendor/pako_inflate.min.js','vendor/sax.js','xlsx_import.js'])vm.runInContext(fs.readFileSync(path.join(root,'src',file),'utf8'),ctx);
const X=ctx.Hfo2Excel;
const main='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rels='http://schemas.openxmlformats.org/package/2006/relationships',rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const metaHeaders=['sample_id','image_id','concentration_M','coats','rpm','spin_time_s','anneal_temp_C','anneal_time_min','data_source','image_filename'];
const thicknessHeaders=['sample_id','position','thickness_nm','data_source'];
const metadata=['DEMO-CASE','arbitrary.jpg',0.2,1,3000,30,550,120,'SYNTHETIC','alternate.png'];
const positions=[['DEMO-CASE','center',14.8,'SYNTHETIC'],['DEMO-CASE','top',15.2,'SYNTHETIC']];
const col=index=>String.fromCharCode(65+index);
function sheet(rows){return `<worksheet xmlns="${main}"><sheetData>${rows.map((values,i)=>`<row r="${i+1}">${values.map((v,j)=>v===null?'':`<c r="${col(j)}${i+1}" t="inlineStr"><is><t>${escape(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;}
function fixture(overrides={}){
 return {
 '_rels/.rels':`<Relationships xmlns="${rels}"><Relationship Id="root" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
 'xl/workbook.xml':`<workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="공정조건" sheetId="1" r:id="meta"/><sheet name="두께" sheetId="2" r:id="thick"/></sheets></workbook>`,
 'xl/_rels/workbook.xml.rels':`<Relationships xmlns="${rels}"><Relationship Id="meta" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="thick" Type="${rel}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
 'xl/worksheets/sheet1.xml':sheet([metaHeaders,metadata]),
 'xl/worksheets/sheet2.xml':sheet([thicknessHeaders,...positions]),...overrides};
}
function crc32(bytes){let c=-1;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return (c^-1)>>>0;}
function zip(parts,{deflate=false}={}){
 const chunks=[],central=[];let offset=0;
 for(const [name,text]of Object.entries(parts)){
  const content=Buffer.from(text),filename=Buffer.from(name),packed=deflate?deflateRawSync(content):content,method=deflate?8:0,crc=crc32(content),local=Buffer.alloc(30),entry=Buffer.alloc(46);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(method,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(content.length,22);local.writeUInt16LE(filename.length,26);
  entry.writeUInt32LE(0x02014b50,0);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(method,10);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(packed.length,20);entry.writeUInt32LE(content.length,24);entry.writeUInt16LE(filename.length,28);entry.writeUInt32LE(offset,42);
  chunks.push(local,filename,packed);central.push(entry,filename);offset+=local.length+filename.length+packed.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...chunks,directory,end]);
}
const parse=(parts,options)=>X.readBytes(zip(parts,options));
test('shipped XLSX reads six samples and 21 actual input positions, preserving source',()=>{
 const result=X.readBytes(new Uint8Array(fs.readFileSync(path.join(root,'sample_data/HfO2_sample_inputs.xlsx'))),'HfO2_sample_inputs.xlsx');
 assert.equal(result.samples.length,6);assert.equal(result.positionCount,21);assert.equal(result.samples[0].stats.mean,15);assert.ok(Math.abs(result.samples[1].stats.mean-18)<1e-10);assert.ok(result.samples[2].stats.cv>21);assert.equal(result.samples[3].points.length,1);assert.equal(result.samples[4].points.length,0);assert.equal(result.samples[5].stats.mean,13);assert.ok(result.samples.every(s=>s.data_source==='SYNTHETIC'));assert.equal(result.filename,'HfO2_sample_inputs.xlsx');
});
test('stored and deflated packages yield the same values and preserve unresolved image references',()=>{
 for(const deflate of [false,true]){const result=parse(fixture(),{deflate}),s=result.samples[0];assert.equal(s.image_id,'arbitrary.jpg');assert.equal(s.image_filename,'alternate.png');assert.equal(s.stats.mean,15);assert.equal(s.anneal_temp_C,550);}
});
test('file API rejects legacy .xls and oversize files before reading',async()=>{
 await assert.rejects(()=>X.readFile({name:'test.xls',size:1,arrayBuffer(){throw Error('should not read');}}),/\.xlsx/);
 await assert.rejects(()=>X.readFile({name:'test.xlsx',size:26*1024*1024,arrayBuffer(){throw Error('should not read');}}),/25 MB/);
});
test('missing required source sheet gives an actionable error',()=>{
 const p=fixture();p['xl/workbook.xml']=p['xl/workbook.xml'].replace('name="두께"','name="Summary"');assert.throws(()=>parse(p),/'두께' 시트/);
});
test('missing and duplicate headers are rejected',()=>{
 assert.throws(()=>parse(fixture({'xl/worksheets/sheet1.xml':sheet([metaHeaders.slice(1),metadata.slice(1)])})),/sample_id 열/);
 assert.throws(()=>parse(fixture({'xl/worksheets/sheet1.xml':sheet([[...metaHeaders,'sample_id'],[...metadata,'DEMO-CASE']])})),/중복된 열 이름/);
});
test('input formulas are rejected even when a plausible cached value exists',()=>{
 const p=fixture();p['xl/worksheets/sheet2.xml']=p['xl/worksheets/sheet2.xml'].replace('<c r="C2" t="inlineStr"><is><t>14.8</t></is></c>','<c r="C2"><f>15-0.2</f><v>14.8</v></c>');assert.throws(()=>parse(p),/수식 대신 측정값/);
});
test('styled blank trailing rows do not become phantom samples',()=>{
 const p=fixture();p['xl/worksheets/sheet1.xml']=p['xl/worksheets/sheet1.xml'].replace('</sheetData>','<row r="200"><c r="A200" s="4"/></row></sheetData>');assert.equal(parse(p).samples.length,1);
});
test('duplicate samples and duplicate locations remain invalid',()=>{
 assert.throws(()=>parse(fixture({'xl/worksheets/sheet1.xml':sheet([metaHeaders,metadata,metadata])})),/중복/);
 assert.throws(()=>parse(fixture({'xl/worksheets/sheet2.xml':sheet([thicknessHeaders,positions[0],positions[0]])})),/중복/);
});
test('mismatched data sources and orphan measurements are rejected',()=>{
 assert.throws(()=>parse(fixture({'xl/worksheets/sheet2.xml':sheet([thicknessHeaders,['DEMO-CASE','center',15,'REAL_MEASUREMENT']])})),/출처가 다릅니다/);
 assert.throws(()=>parse(fixture({'xl/worksheets/sheet2.xml':sheet([thicknessHeaders,['DEMO-OTHER','center',15,'SYNTHETIC']])})),/연결할 메타데이터/);
});
test('one-point and missing measurements are preserved without invented uniformity',()=>{
 const one=parse(fixture({'xl/worksheets/sheet2.xml':sheet([thicknessHeaders,positions[0]])}));assert.equal(one.samples[0].points.length,1);
 const none=parse(fixture({'xl/worksheets/sheet2.xml':sheet([thicknessHeaders])}));assert.equal(none.samples[0].stats,null);assert.equal(none.samples[0].points.length,0);assert.ok(none.warnings.length);
});
test('external worksheet relationships are rejected without making requests',()=>{
 const p=fixture();p['xl/_rels/workbook.xml.rels']=p['xl/_rels/workbook.xml.rels'].replace('Target="worksheets/sheet1.xml"','Target="https://example.invalid/data" TargetMode="External"');assert.throws(()=>parse(p),/시트 연결/);
});
test('DTD/entity declarations and malformed XML are rejected',()=>{
 assert.throws(()=>parse(fixture({'xl/workbook.xml':'<!DOCTYPE workbook [<!ENTITY x SYSTEM "file:///x">]><workbook>&x;</workbook>'})),/DTD/);
 assert.throws(()=>parse(fixture({'xl/workbook.xml':'<workbook><sheets></workbook>'})),/XML 형식/);
});
test('CRC mismatch cannot silently supply input data',()=>{
 const data=zip(fixture());data[data.indexOf(Buffer.from('alternate.png'))]=0x42;assert.throws(()=>X.readBytes(data),/무결성/);
});
test('declared ZIP expansion limits are checked before inflation',()=>{
 const data=zip(fixture());const at=data.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));data.writeUInt32LE(21*1024*1024,at+24);assert.throws(()=>X.readBytes(data),/압축 해제 후 엑셀 용량/);
});
test('actual inflate size cannot exceed a forged smaller declared size',()=>{
 const data=zip(fixture(),{deflate:true});const at=data.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));data.writeUInt32LE(1,at+24);assert.throws(()=>X.readBytes(data),/기록된 크기를 초과/);
});
test('shared strings and inline rich text preserve identifiers and names',()=>{
 const p=fixture();p['xl/_rels/workbook.xml.rels']=p['xl/_rels/workbook.xml.rels'].replace('</Relationships>',`<Relationship Id="str" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
 p['xl/sharedStrings.xml']=`<sst xmlns="${main}"><si><r><t>DEMO-</t></r><r><t>CASE</t></r></si></sst>`;
 p['xl/worksheets/sheet1.xml']=p['xl/worksheets/sheet1.xml'].replace('<c r="A2" t="inlineStr"><is><t>DEMO-CASE</t></is></c>','<c r="A2" t="s"><v>0</v></c>');assert.equal(parse(p).samples[0].id,'DEMO-CASE');
});
test('misplaced or duplicate cell addresses are rejected',()=>{
 const p=fixture();p['xl/worksheets/sheet1.xml']=p['xl/worksheets/sheet1.xml'].replace('r="B2"','r="A2"');assert.throws(()=>parse(p),/셀이 중복/);
});
