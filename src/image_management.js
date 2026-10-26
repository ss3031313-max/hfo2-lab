/* Reversible, image-only cleanup. No image is removed merely by opening the app. */
(function(root){
'use strict';
const clone=value=>JSON.parse(JSON.stringify(value));
function clearImageSnapshot(snapshot,parseCSV){
 if(!snapshot||snapshot.schema!==1||!Array.isArray(snapshot.core?.images)||!Array.isArray(snapshot.intake?.queue)||!Array.isArray(snapshot.surface?.images))throw new Error('사진을 비울 수 있는 저장 형식이 아닙니다.');
 if(typeof parseCSV!=='function'||typeof snapshot.core.metadataCsv!=='string')throw new Error('공정조건 연결 정보를 읽을 수 없습니다.');
 const next=clone(snapshot),rows=parseCSV(next.core.metadataCsv),headers=rows[0]?.cells.map(value=>String(value).trim().toLowerCase())||[],idColumn=headers.indexOf('image_id'),filenameColumn=headers.indexOf('image_filename');
 if(idColumn<0)throw new Error('공정조건의 image_id 열을 찾을 수 없습니다.');
 for(const row of rows.slice(1)){if(row.cells.length!==headers.length)throw new Error('공정조건 CSV의 열 수를 확인하세요.');row.cells[idColumn]='';if(filenameColumn>=0)row.cells[filenameColumn]='';}
 // This is an internal round trip, not a spreadsheet export. Preserve IDs literally;
 // formula-prefix escaping here would change the identity of a valid sample.
 const cell=value=>{const text=String(value??'');return /[",\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;};
 next.core.metadataCsv=rows.map(row=>row.cells.map(cell).join(',')).join('\n')+'\n';
 next.core.images=[];next.core.selectedImageId='';
 for(const list of [next.intake.queue,next.intake.undoQueue])if(Array.isArray(list))for(const sample of list){sample.image_id=null;if(Object.prototype.hasOwnProperty.call(sample,'image_filename'))sample.image_filename=null;}
 if(next.intake.form){next.intake.form.image_id='';next.intake.form.file_pending=false;if(Object.prototype.hasOwnProperty.call(next.intake.form,'image_filename'))next.intake.form.image_filename='';}
 next.surface.images=[];
 return next;
}
function materialSignature(snapshot){
 const content=clone({core:snapshot.core,intake:snapshot.intake,surface:snapshot.surface});
 // Navigating and selecting a row do not change the content restored by undo.
 for(const key of ['activePage','selectedImageId','selectedSampleId','reviewOnly'])delete content.core[key];
 return JSON.stringify(content);
}
function createManager({ready=Promise.resolve(),capture,restore,flush=async()=>true,parseCSV,isBusy=()=>false,isBlocked=()=>false,onState=()=>{},onApplied=()=>{}}){
 let initialized=false,busy=false,undoSnapshot=null,baseline=null,message='',tone='info';
 function state(){return {initialized,busy,canUndo:!!undoSnapshot,message,tone};}
 function report(text=message,nextTone=tone){message=text;tone=nextTone;onState(state());}
 function changed(){if(!initialized||busy||!undoSnapshot)return;try{if(materialSignature(capture())!==baseline){undoSnapshot=null;baseline=null;report('사진을 비운 뒤 자료가 변경되어 즉시 취소할 수 없습니다. 필요한 사진은 다시 첨부하거나 기존 전체 백업을 사용하세요.');}}catch{undoSnapshot=null;baseline=null;report('현재 자료가 변경되어 비우기 취소를 종료했습니다.');}}
 const settled=Promise.resolve(ready).then(()=>{initialized=true;report();},()=>{initialized=true;report('자동 저장 상태를 확인한 뒤 사진을 비워 주세요.','error');});
 function guard(){if(busy||isBusy())throw new Error('진행 중인 작업이 끝난 뒤 다시 시도하세요.');if(isBlocked())throw new Error('기존 자료 복원에 문제가 있습니다. 전체 백업으로 자료를 확인한 뒤 다시 시도하세요.');}
 async function clear(){
  await settled;guard();const previous=capture();if(!previous.core.images.length){report('등록된 OM 사진이 없습니다.');return {changed:false,count:0};}
  const count=previous.core.images.length,next=clearImageSnapshot(previous,parseCSV);busy=true;report('OM 사진 정리 중');
  try{
   const result=await restore(next);
   onApplied(false);
   undoSnapshot=clone(previous);baseline=materialSignature(capture());
   const saved=await flush(),warnings=result?.warnings||[];
   report('OM 사진 '+count+'장 비움 · 두께·공정조건·판정 기준 유지. 이 화면에서 다른 자료를 수정하기 전까지 취소할 수 있습니다.'+(warnings.length?' '+warnings.join(' · '):'')+(saved?'':' 자동 저장 실패 · 전체 백업을 보관하세요.'),saved?'success':'error');
   return {changed:true,count,warnings:result?.warnings||[],saved};
  }catch(e){report('사진을 비우지 못했습니다. '+String(e?.message||e),'error');throw e;}
  finally{busy=false;onState(state());}
 }
 async function undo(){
  await settled;guard();changed();if(!undoSnapshot)throw new Error('취소할 사진 비우기 기록이 없습니다. 기존 전체 백업이나 원본 사진을 사용하세요.');
  const previous=clone(undoSnapshot),current=capture();previous.core.activePage=current.core.activePage;
  busy=true;report('OM 사진 복원 중');
  try{const result=await restore(previous);onApplied(true);undoSnapshot=null;baseline=null;const saved=await flush();report('사진과 연결·OM 검토 상태를 복원했습니다.'+(result?.warnings?.length?' '+result.warnings.join(' · '):'')+(saved?'':' 자동 저장 실패 · 전체 백업을 보관하세요.'),saved?'success':'error');return {restored:true,saved,warnings:result?.warnings||[]};}
  catch(e){report('사진을 복원하지 못했습니다. '+String(e?.message||e),'error');throw e;}
  finally{busy=false;onState(state());}
 }
 return {ready:settled,clear,undo,changed,getState:state};
}
root.Hfo2ImageManagementLogic={clearImageSnapshot,materialSignature,createManager};
if(typeof document==='undefined')return;
const A=root.Hfo2Autosave,B=root.Hfo2Bridge,W=root.Hfo2WorkflowMath;
const panel=document.querySelector('#omSelectionPanel .gallery-panel'),title=panel?.querySelector('.titlebar');
if(!A||!B||!W||!panel||!title)return;
const controls=document.createElement('div');controls.className='om-image-actions';controls.innerHTML='<button type="button" id="omClearImages" title="등록된 모든 OM 사진과 사진 연결을 비웁니다. 두께·공정조건은 유지됩니다.">사진 비우기</button><button type="button" id="omUndoClearImages" hidden>비우기 취소</button>';
title.append(controls);
const message=document.createElement('p');message.id='omImageMessage';message.className='om-image-message';message.setAttribute('role','status');message.setAttribute('aria-live','polite');message.hidden=true;title.insertAdjacentElement('afterend',message);
const css=document.createElement('style');css.textContent='.om-image-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.app-page .om-image-actions button{font-size:11px;padding:6px 9px;background:#fff;color:#597482;border-color:#d7e2e8}.om-image-message{padding:10px 12px;border-radius:8px;background:#f3f8f7;color:#416c65;font-size:11px;line-height:1.7}.om-image-message[data-tone="error"]{background:#fff2f0;color:#a1423a}.om-image-actions [hidden],.om-image-message[hidden]{display:none!important}@media(max-width:650px){#omSelectionPanel .gallery-panel .titlebar{flex-wrap:wrap}.om-image-actions{width:100%}}';document.head.append(css);
const clearButton=document.getElementById('omClearImages'),undoButton=document.getElementById('omUndoClearImages');
let locked=false,previousInert=[],previousManagerBusy=false;
const lockTargets=[document.querySelector('.app-workspace'),document.querySelector('.app-nav')].filter(Boolean);
function setLock(value){if(value&&!locked){previousInert=lockTargets.map(node=>node.inert);lockTargets.forEach(node=>node.inert=true);locked=true;}else if(!value&&locked){lockTargets.forEach((node,index)=>node.inert=previousInert[index]);locked=false;}}
function externalBusy(){return root.Hfo2Surface?.isBusy?.()||root.Hfo2QuickImport?.isBusy?.()||document.getElementById('uploadFiles')?.disabled||document.getElementById('srStatus')?.textContent==='분석 중'||['loading','restoring'].includes(A.getStatus?.().state);}
function render(state){setLock(state.busy);clearButton.disabled=!state.initialized||state.busy||externalBusy()||!B.listImages().length;undoButton.hidden=!state.canUndo;undoButton.disabled=state.busy||externalBusy();message.textContent=state.message;message.dataset.tone=state.tone;message.hidden=!state.message;if(previousManagerBusy!==state.busy){previousManagerBusy=state.busy;document.dispatchEvent(new CustomEvent('hfo2-image-management-busy',{detail:{busy:state.busy}}));}}
const manager=createManager({ready:A.ready,capture:A.exportState,restore:A.importState,flush:A.flush,parseCSV:W.parseCSV,isBusy:externalBusy,isBlocked:()=>A.getStatus?.().blocked===true,onState:render,onApplied:restored=>document.dispatchEvent(new CustomEvent('hfo2-images-cleared',{detail:{restored}}))});
function actionError(e){render({...manager.getState(),message:String(e?.message||e),tone:'error'});}
clearButton.addEventListener('click',()=>{void manager.clear().catch(actionError);});
undoButton.addEventListener('click',()=>{void manager.undo().catch(actionError);});
for(const event of ['wf-rendered','intake-changed','surface-reviewed','hfo2-image-added','hfo2-navigate'])document.addEventListener(event,()=>{manager.changed();render(manager.getState());});
for(const event of ['input','change'])document.addEventListener(event,e=>{if(e.target?.closest?.('.app-workspace')){manager.changed();render(manager.getState());}});
// Analysis and uploads publish data before their finally blocks release busy state.
// Observe the displayed busy indicators so controls recover when those operations end.
const busyObserver=new MutationObserver(()=>render(manager.getState()));
for(const [id,options]of [['srStatus',{childList:true,characterData:true,subtree:true}],['quickImport',{attributes:true,attributeFilter:['aria-busy']}],['uploadFiles',{attributes:true,attributeFilter:['disabled']}],['hfoSaveStatus',{attributes:true,attributeFilter:['data-state']}]]){const node=document.getElementById(id);if(node)busyObserver.observe(node,options);}
root.Hfo2ImageManagement={clear:manager.clear,undo:manager.undo,getState:manager.getState};
render(manager.getState());
})(typeof window==='undefined'?globalThis:window);
