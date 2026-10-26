/* Offline .xlsx input reader. Reads source values only; never evaluates formulas.
 * Dependencies (bundled locally): pako 1.0.11 inflate, sax 1.6.1. See vendor licenses.
 */
(function(root){
'use strict';
const MAX_FILE=25*1024*1024,MAX_ENTRY=20*1024*1024,MAX_TOTAL=50*1024*1024,MAX_ENTRIES=2000;
const MAIN='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const decoder=new TextDecoder('utf-8',{fatal:true});
const fail=message=>{throw new Error(message);};
const crcTable=new Uint32Array(256);
for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[i]=c>>>0;}
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function openZip(input){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
 if(bytes.length>MAX_FILE)fail('엑셀 파일은 25 MB 이하여야 합니다.');
 if(bytes.length<22)fail('올바른 .xlsx 파일이 아닙니다.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=o=>view.getUint16(o,true),u32=o=>view.getUint32(o,true);
 let end=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(u32(p)===0x06054b50&&p+22+u16(p+20)===bytes.length){end=p;break;}
 if(end<0)fail('엑셀 ZIP 구조가 손상되었거나 암호화되어 있습니다.');
 const count=u16(end+10),size=u32(end+12),offset=u32(end+16);
 if(u16(end+4)||u16(end+6)||u16(end+8)!==count||count===65535||size===0xffffffff||offset===0xffffffff)fail('분할 또는 ZIP64 엑셀 파일은 지원하지 않습니다.');
 if(count>MAX_ENTRIES||offset+size>end)fail('엑셀 내부 파일 수 또는 압축 구조를 확인하세요.');
 const entries=new Map();let p=offset,total=0;
 for(let i=0;i<count;i++){
  if(p+46>offset+size||u32(p)!==0x02014b50)fail('엑셀 압축 목록이 손상되었습니다.');
  const flags=u16(p+8),method=u16(p+10),crc=u32(p+16),compressed=u32(p+20),uncompressed=u32(p+24),nl=u16(p+28),el=u16(p+30),cl=u16(p+32),local=u32(p+42);
  if(p+46+nl+el+cl>offset+size)fail('엑셀 내부 파일명이 손상되었습니다.');
  const name=decoder.decode(bytes.subarray(p+46,p+46+nl));
  if(!name||name.startsWith('/')||name.includes('\\')||name.split('/').includes('..')||entries.has(name))fail('엑셀 내부 파일 경로가 잘못되었거나 중복됩니다.');
  if(flags&1)fail('암호가 설정된 엑셀 파일은 지원하지 않습니다.');
  if(![0,8].includes(method)||local===0xffffffff||compressed===0xffffffff||uncompressed===0xffffffff)fail('지원하지 않는 엑셀 압축 형식입니다.');
  if(uncompressed>MAX_ENTRY||(total+=uncompressed)>MAX_TOTAL)fail('압축 해제 후 엑셀 용량이 제한을 초과합니다.');
  if(local+30>offset||u32(local)!==0x04034b50)fail('엑셀 내부 파일 위치가 손상되었습니다.');
  const localNameLength=u16(local+26),localExtraLength=u16(local+28),start=local+30+localNameLength+localExtraLength;
  if(start+compressed>offset||u16(local+8)!==method||(u16(local+6)&1)||decoder.decode(bytes.subarray(local+30,local+30+localNameLength))!==name)fail('엑셀 내부 파일 정보가 일치하지 않습니다.');
  entries.set(name,{name,method,crc,compressed,uncompressed,start});p+=46+nl+el+cl;
 }
 if(p!==offset+size)fail('엑셀 압축 목록의 크기가 일치하지 않습니다.');
 const cache=new Map();
 function read(name){
  if(cache.has(name))return cache.get(name);
  const e=entries.get(name);if(!e)fail('엑셀 내부 자료가 없습니다: '+name);
  const packed=bytes.subarray(e.start,e.start+e.compressed);let unpacked;
  if(e.method===0){if(e.compressed!==e.uncompressed)fail('엑셀 내부 크기가 일치하지 않습니다.');unpacked=packed;}
  else{
   if(!root.pako?.Inflate)fail('엑셀 압축 해제 모듈을 불러오지 못했습니다.');
   const inflater=new root.pako.Inflate({raw:true,chunkSize:16384}),parts=[];let actual=0;
   inflater.onData=chunk=>{actual+=chunk.length;if(actual>e.uncompressed||actual>MAX_ENTRY)fail('엑셀 압축 해제 용량이 기록된 크기를 초과합니다.');parts.push(chunk);};
   inflater.push(packed,true);if(inflater.err||!inflater.ended||actual!==e.uncompressed)fail('엑셀 압축 데이터가 손상되었습니다.');
   unpacked=new Uint8Array(actual);let pos=0;for(const chunk of parts){unpacked.set(chunk,pos);pos+=chunk.length;}
  }
  if(crc32(unpacked)!==e.crc)fail('엑셀 파일 무결성 확인에 실패했습니다: '+name);
  const text=decoder.decode(unpacked);cache.set(name,text);return text;
 }
 return {entries,read};
}
function parseXml(text,label){
 if(/<!DOCTYPE|<!ENTITY/i.test(text))fail(label+': DTD·외부 엔터티는 지원하지 않습니다.');
 if(!root.sax?.parser)fail('엑셀 XML 모듈을 불러오지 못했습니다.');
 const parser=root.sax.parser(true,{xmlns:true,strictEntities:true}),stack=[],document={name:'#document',attrs:{},children:[],text:''};let nodes=0;
 stack.push(document);
 parser.onerror=e=>fail(label+': XML 형식을 확인하세요. '+String(e.message).split('\n')[0]);
 parser.onopentag=tag=>{
  if(++nodes>1200000||stack.length>40)fail(label+': XML 구조가 너무 큽니다.');
  const attrs=Object.create(null);for(const [key,value]of Object.entries(tag.attributes))attrs[key]=value.value;
  const node={name:tag.local,uri:tag.uri,attrs,children:[],text:''};stack[stack.length-1].children.push(node);stack.push(node);
 };
 parser.onclosetag=()=>stack.pop();parser.ontext=t=>{stack[stack.length-1].text+=t;};parser.oncdata=parser.ontext;
 for(let p=0;p<text.length;p+=16384)parser.write(text.slice(p,p+16384));parser.close();
 if(document.children.length!==1)fail(label+': XML 루트가 올바르지 않습니다.');return document.children[0];
}
const children=(node,name)=>node.children.filter(n=>n.name===name);
const child=(node,name)=>children(node,name)[0];
function descendants(node,name){const result=[];function walk(n){for(const c of n.children){if(c.name===name)result.push(c);walk(c);}}walk(node);return result;}
function allText(node){return node.text+node.children.map(allText).join('');}
function relativePart(base,target){
 if(!target||/[:\\?#]/.test(target))fail('엑셀 외부 연결 또는 잘못된 내부 경로입니다.');
 const source=target.startsWith('/')?[]:base.split('/').slice(0,-1);
 for(const part of target.split('/')){if(!part||part==='.')continue;if(part==='..'){if(!source.length)fail('엑셀 내부 경로가 범위를 벗어납니다.');source.pop();}else source.push(part);}
 return source.join('/');
}
function relationshipMap(xml){const result=new Map();for(const r of children(xml,'Relationship')){if(!r.attrs.Id||result.has(r.attrs.Id))fail('엑셀 관계 ID가 누락되었거나 중복됩니다.');result.set(r.attrs.Id,r.attrs);}return result;}
function getCellValue(cell,strings,label){
 if(child(cell,'f'))return {value:'',formula:true};
 const type=cell.attrs.t||'n';let value=child(cell,'v')?.text??'';
 if(type==='s'){if(!/^\d+$/.test(value)||!strings[Number(value)]&&strings[Number(value)]!=='')fail(label+': 공유 문자열 참조가 올바르지 않습니다.');value=strings[Number(value)];}
 else if(type==='inlineStr'){const inline=child(cell,'is');value=inline?descendants(inline,'t').map(allText).join(''):'';}
 else if(type==='e')fail(label+': Excel 오류값 '+value+'이 있습니다.');
 else if(type==='b')fail(label+': 참/거짓 셀 대신 숫자 또는 문자열을 입력하세요.');
 else if(!['n','str','d'].includes(type))fail(label+': 지원하지 않는 셀 형식입니다.');
 return {value:String(value).trim(),formula:false};
}
function readSheet(xml,strings,label,required,maxRows){
 if(xml.name!=='worksheet'||![MAIN,'http://purl.oclc.org/ooxml/spreadsheetml/main'].includes(xml.uri))fail(label+': 올바른 워크시트가 아닙니다.');
 const data=child(xml,'sheetData');if(!data)fail(label+': 표가 없습니다.');
 const rows=[],rowIDs=new Set();
 for(const row of children(data,'row')){
  const n=Number(row.attrs.r);if(!Number.isInteger(n)||n<1||n>1048576||rowIDs.has(n))fail(label+': 행 번호가 잘못되었거나 중복됩니다.');rowIDs.add(n);
  const map=new Map();
  for(const c of children(row,'c')){
   const match=/^([A-Z]{1,3})([1-9]\d*)$/.exec(c.attrs.r||'');if(!match||Number(match[2])!==n)fail(label+': 셀 위치를 확인하세요.');
   let col=0;for(const char of match[1])col=col*26+char.charCodeAt(0)-64;if(col>256||map.has(col-1))fail(label+': 열 수가 너무 많거나 셀이 중복됩니다.');
   map.set(col-1,getCellValue(c,strings,label+'!'+c.attrs.r));
  }
  if([...map.values()].some(c=>c.formula||c.value!==''))rows.push({n,map});
 }
 rows.sort((a,b)=>a.n-b.n);if(!rows.length)fail(label+': 열 이름이 없습니다.');
 const head=rows.shift(),headers=new Map();
 for(const [index,c]of head.map){if(c.formula)fail(label+': 열 이름에 수식을 사용할 수 없습니다.');if(c.value){const name=c.value.toLowerCase();if(headers.has(name))fail(label+': 중복된 열 이름 '+name);headers.set(name,index);}}
 for(const name of required)if(!headers.has(name))fail(label+': '+name+' 열이 필요합니다.');
 const selected=[...new Set([...required,...(headers.has('image_filename')?['image_filename']:[])])],out=[];
 for(const row of rows){
  const obj={};let any=false;
  for(const name of selected){const c=row.map.get(headers.get(name));if(c?.formula)fail(label+'!'+row.n+'행 '+name+': 수식 대신 측정값을 값으로 붙여넣으세요.');obj[name]=c?.value||'';any ||=obj[name]!=='';}
  if(any)out.push(obj);if(out.length>maxRows)fail(label+': 지원하는 최대 행 수를 초과합니다.');
 }
 return out;
}
const csvCell=value=>{const text=String(value??'');return /[",\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;};
function toCsv(headers,rows){return [headers,...rows.map(r=>headers.map(h=>r[h]))].map(r=>r.map(csvCell).join(',')).join('\n')+'\n';}
function readBytes(bytes,filename='input.xlsx'){
 const W=root.Hfo2WorkflowMath;if(!W)fail('두께 분석 모듈을 먼저 불러오세요.');
 const zip=openZip(bytes);
 if([...zip.entries.keys()].some(n=>/vbaproject\.bin$/i.test(n)))fail('매크로 포함 엑셀 파일은 지원하지 않습니다. .xlsx로 저장하세요.');
 const roots=relationshipMap(parseXml(zip.read('_rels/.rels'),'엑셀 관계'));
 const office=[...roots.values()].filter(r=>/\/officeDocument$/.test(r.Type||''));
 if(office.length!==1||office[0].TargetMode==='External')fail('엑셀 통합문서 연결이 올바르지 않습니다.');
 const workbookPath=relativePart('',office[0].Target),workbook=parseXml(zip.read(workbookPath),'통합문서');
 const part=workbookPath.split('/'),base=part.pop(),relsPath=part.concat('_rels',base+'.rels').join('/');
 const rels=relationshipMap(parseXml(zip.read(relsPath),'시트 관계'));
 let strings=[];const shared=[...rels.values()].filter(r=>/\/sharedStrings$/.test(r.Type||''));
 if(shared.length>1)fail('공유 문자열 표가 중복되었습니다.');
 if(shared.length){if(shared[0].TargetMode==='External')fail('외부 공유 문자열은 지원하지 않습니다.');const sst=parseXml(zip.read(relativePart(workbookPath,shared[0].Target)),'공유 문자열');strings=children(sst,'si').map(si=>descendants(si,'t').map(allText).join(''));}
 const sheets=child(workbook,'sheets');if(!sheets)fail('엑셀 시트가 없습니다.');
 function sheet(name,required,max){
  const found=children(sheets,'sheet').filter(s=>s.attrs.name===name);if(found.length!==1)fail("엑셀에 '"+name+"' 시트가 한 개 있어야 합니다. 동봉 양식을 사용하세요.");
  const id=Object.entries(found[0].attrs).find(([k])=>k==='r:id'||k.endsWith(':id'))?.[1],rel=rels.get(id);
  if(!rel||rel.TargetMode==='External'||!/\/worksheet$/.test(rel.Type||''))fail(name+': 시트 연결이 올바르지 않습니다.');
  return readSheet(parseXml(zip.read(relativePart(workbookPath,rel.Target)),name),strings,name,required,max);
 }
 const metadata=sheet('공정조건',W.META,1000),thickness=sheet('두께',W.THICK,100000),ids=metadata.map(r=>r.image_id).filter(Boolean);
 const validated=W.join(toCsv(W.META,metadata),toCsv(W.THICK,thickness),ids);
 for(let i=0;i<validated.samples.length;i++)validated.samples[i].image_filename=metadata[i].image_filename||null;
 return {samples:validated.samples,warnings:validated.warnings,filename:String(filename),sourceSheets:['공정조건','두께'],positionCount:thickness.length};
}
async function readFile(file){
 if(!file||typeof file.arrayBuffer!=='function')fail('엑셀 파일을 선택하세요.');
 if(!/\.xlsx$/i.test(file.name||''))fail('.xlsx 파일을 선택하세요. .xls·CSV는 Excel에서 .xlsx로 저장한 뒤 첨부하세요.');
 if(file.size>MAX_FILE)fail('엑셀 파일은 25 MB 이하여야 합니다.');
 return readBytes(new Uint8Array(await file.arrayBuffer()),file.name);
}
root.Hfo2Excel={readFile,readBytes};
})(typeof window==='undefined'?globalThis:window);
