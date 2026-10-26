/* Local-only persistence. No account, server, or network request is used. */
(function(root){
'use strict';
const MAX_BACKUP_BYTES=100*1024*1024;
function plain(v){return !!v&&typeof v==='object'&&!Array.isArray(v);}
function validateSnapshot(v){
 if(!plain(v)||v.schema!==1)throw new Error('지원하는 HfO₂ 전체 백업 파일이 아닙니다.');
 for(const key of ['core','intake','surface'])if(!plain(v[key]))throw new Error('백업의 '+key+' 자료가 없습니다.');
 if(typeof v.savedAt!=='string'||!Number.isFinite(Date.parse(v.savedAt)))throw new Error('백업 저장 시각을 확인하세요.');
 if(typeof v.version!=='string'||v.version.length>40)throw new Error('백업 버전 정보가 올바르지 않습니다.');
 if(!Array.isArray(v.core.images)||v.core.images.length>100)throw new Error('백업 이미지 목록은 100장 이하여야 합니다.');
 return v;
}

// I/O is injected so ordering, failure handling and startup races can be tested.
function createController({read,write,savePrevious=async()=>{},capture,apply,status=()=>{},lock=()=>{},delay=650,setTimer=setTimeout,clearTimer=clearTimeout}){
 let initialized=false,held=0,blocked=false,dirty=0,saved=0,timer=null,running=null,currentStatus={state:'loading',message:'저장 자료 확인 중'},lastSavedAt=null,restoreWarnings=[];
 function report(state,message,detail=restoreWarnings.join('\n')){currentStatus={state,message,detail,lastSavedAt,dirty:dirty>saved};status({...currentStatus});}
 function cancelTimer(){if(timer!==null){clearTimer(timer);timer=null;}}
 function snapshot(){return validateSnapshot(capture());}
 async function flush(){
  cancelTimer();
  if(!initialized||held||blocked)return false;
  if(running)return running;
  if(dirty<=saved)return true;
  running=(async()=>{
   while(dirty>saved&&!held&&!blocked){
    const revision=dirty;let value;
    try{value=snapshot();report('saving','저장 중');await write(value);saved=revision;lastSavedAt=value.savedAt;report('saved','저장됨');}
    catch(e){report('error','자동저장 실패',String(e?.message||e));return false;}
   }
   return true;
  })();
  try{return await running;}finally{running=null;}
 }
 function changed(){
  if(!initialized||held)return;
  dirty++;
  if(blocked){report('error','복원 실패 · 기존 저장 보존','전체 백업을 보관한 뒤 올바른 백업 파일을 불러오세요.');return;}
  cancelTimer();report('pending','저장 대기');timer=setTimer(()=>{timer=null;void flush();},delay);
 }
 async function restore(value){
  validateSnapshot(value);await ready;cancelTimer();
  // A pending local write finishes before imports can replace the active state.
  if(running)await running;
  const previous=snapshot();let previousWarning='';held++;lock(true);report('restoring','백업 복원 중');
  try{
   try{await savePrevious(previous);}catch(e){previousWarning='이전 상태의 브라우저 보관 실패: '+String(e?.message||e);}
   const warnings=await apply(value);restoreWarnings=[...(Array.isArray(warnings)?warnings:[]),...(previousWarning?[previousWarning]:[])];blocked=false;dirty++;report('pending','복원됨 · 저장 대기');
   return {ok:true,warnings:[...restoreWarnings]};
  }catch(e){
   try{await apply(previous);report('error','백업 복원 실패',String(e?.message||e)+' · 이전 화면을 유지했습니다.');}
   catch(rollbackError){blocked=true;report('error','복원 중단 · 자동저장 보류',String(e?.message||e)+' / 이전 상태 복구 실패: '+String(rollbackError?.message||rollbackError));}
   throw e;
  }finally{
   held--;lock(false);
   if(!blocked&&dirty>saved)void flush();
  }
 }
 const ready=(async()=>{
  held++;lock(true);report('loading','저장 자료 확인 중');
  let original,baseline;
  try{
   original=await read();
   if(original){
    validateSnapshot(original);baseline=snapshot();report('restoring','저장 자료 복원 중');const warnings=await apply(original);lastSavedAt=original.savedAt;restoreWarnings=Array.isArray(warnings)?[...warnings]:[];
    report(restoreWarnings.length?'warning':'saved',restoreWarnings.length?'복원됨 · 일부 확인 필요':'복원됨');
   }else report('ready','자동저장 준비');
  }catch(e){
   blocked=!!original;
   if(baseline){try{await apply(baseline);}catch{}}
   report('error',blocked?'복원 실패 · 기존 저장 보존':'자동저장 사용 불가',String(e?.message||e));
  }finally{held--;initialized=true;lock(false);}
  return {restored:!!original&&!blocked,blocked,status:{...currentStatus}};
 })();
 return {ready,changed,flush,restore,snapshot,getStatus:()=>({...currentStatus,dirty:dirty>saved,blocked,initialized})};
}
root.Hfo2AutosaveLogic={validateSnapshot,createController,MAX_BACKUP_BYTES};
if(typeof document==='undefined')return;
const B=root.Hfo2Bridge,I=root.Hfo2Intake,S=root.Hfo2Surface;
if(!B||!I||!S)return;

const css=document.createElement('style');css.textContent=`
.app-header-right{flex-wrap:wrap;justify-content:flex-end}.hfo-save-tools{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}.hfo-save-status{font-size:10px;white-space:nowrap;color:#4e7665;border:1px solid #d5e9df;background:#f0f8f4;border-radius:6px;padding:5px 8px;display:flex;align-items:center;gap:5px}.hfo-save-status::before{content:'';width:5px;height:5px;border-radius:50%;background:#248768}.hfo-save-status[data-state=error]{color:#9f3c32;background:#fff1ee;border-color:#edc7c0}.hfo-save-status[data-state=error]::before{background:#b65347}.hfo-save-status[data-state=pending],.hfo-save-status[data-state=saving],.hfo-save-status[data-state=loading],.hfo-save-status[data-state=restoring],.hfo-save-status[data-state=warning]{color:#82652f;background:#fff9ec;border-color:#eadbb7}.hfo-save-tools button{white-space:nowrap}.hfo-save-help{color:#6e8092;font-size:11px;line-height:1.7;margin:0 0 14px;padding:10px 13px;background:#f8fafc;border:1px solid #e0e7ee;border-radius:8px}.hfo-save-help summary{cursor:pointer;font-weight:600}.hfo-save-help p{margin:6px 0 0}.hfo-save-message{font-size:11px;line-height:1.7;white-space:pre-line;color:#62758a}.hfo-save-message[data-state=error]{color:#a44438}.hfo-save-loading{opacity:.65}@media(max-width:950px){.app-header{align-items:flex-start}.app-header-right{max-width:62%}.hfo-save-tools{gap:4px}}@media print{.hfo-save-tools,.hfo-save-help{display:none!important}}`;
document.head.append(css);
const box=document.createElement('div');box.className='hfo-save-tools';box.innerHTML='<span id="hfoSaveStatus" class="hfo-save-status" role="status" aria-live="polite">저장 자료 확인 중</span><button id="hfoBackup" type="button">전체 백업</button><button id="hfoRestore" type="button">백업 불러오기</button><input id="hfoRestoreFile" type="file" accept=".json,application/json" hidden>';
document.querySelector('.app-header-right')?.append(box);
const help=document.createElement('details');help.className='hfo-save-help';help.innerHTML='<summary>자동저장 · 이 브라우저</summary><p>등록한 샘플·OM 사진·판정 기준·검토 상태를 이 PC의 브라우저에 저장합니다. 서버 전송이나 다른 PC와의 동기화는 없습니다.</p><p>브라우저 데이터를 삭제하거나 실행 파일의 위치·브라우저가 바뀌면 복원되지 않을 수 있습니다. 이동 전 전체 백업 파일을 보관하세요. 아직 등록하지 않은 사진 파일 선택은 저장 대상이 아닙니다.</p><p id="hfoSaveMessage" class="hfo-save-message" role="status"></p>';
const intake=document.getElementById('page-intake');if(intake)intake.insertBefore(help,intake.firstChild?.nextSibling||null);
const $=id=>document.getElementById(id),lockTargets=[document.querySelector('.app-workspace'),document.querySelector('.app-nav')].filter(Boolean);
let lockCount=0,storedInert=[];
function lock(on){
 if(on){if(lockCount++===0){storedInert=lockTargets.map(n=>n.inert);lockTargets.forEach(n=>{n.inert=true;n.setAttribute('aria-busy','true');n.classList.add('hfo-save-loading');});$('hfoBackup').disabled=true;$('hfoRestore').disabled=true;}}
 else if(lockCount>0&&--lockCount===0){lockTargets.forEach((n,i)=>{n.inert=storedInert[i];n.removeAttribute('aria-busy');n.classList.remove('hfo-save-loading');});$('hfoBackup').disabled=false;$('hfoRestore').disabled=false;}
}
function showStatus(s){const el=$('hfoSaveStatus');el.dataset.state=s.state;el.textContent=s.message;el.title='자동저장 · 이 브라우저'+(s.lastSavedAt?'\n마지막 저장: '+new Date(s.lastSavedAt).toLocaleString('ko-KR'):'')+(s.detail?'\n'+s.detail:'');const msg=$('hfoSaveMessage');if(msg){msg.dataset.state=s.state;msg.textContent=s.detail||'';}}
let databasePromise,expectedRevision=0;
function database(){
 if(databasePromise)return databasePromise;
 databasePromise=new Promise((resolve,reject)=>{
  if(!root.indexedDB){reject(new Error('이 브라우저에서는 저장소를 사용할 수 없습니다. 전체 백업 또는 CSV로 저장하세요.'));return;}
  let request,finished=false;const timeout=setTimeout(()=>done(new Error('저장소 응답이 지연됩니다. 다른 창을 닫고 다시 열거나 전체 백업을 사용하세요.')),8000);
  function done(error,db){if(finished){db?.close();return;}finished=true;clearTimeout(timeout);if(error)reject(error);else resolve(db);}
  try{request=root.indexedDB.open('HfO2Lab-Local',1);}catch(e){done(e);return;}
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('snapshots'))request.result.createObjectStore('snapshots');};
  request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();done(null,db);};
  request.onerror=()=>done(request.error||new Error('브라우저 저장소를 열 수 없습니다.'));
  request.onblocked=()=>done(new Error('다른 창이 저장소를 사용 중입니다. 다른 HfO₂ 창을 닫고 다시 열어 주세요.'));
 });return databasePromise;
}
async function read(){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readonly'),request=tx.objectStore('snapshots').get('current');let result=null;request.onsuccess=()=>{const record=request.result;expectedRevision=record?.revision||0;result=record?.snapshot||record||null;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||new Error('저장 자료를 읽지 못했습니다.'));tx.onabort=tx.onerror;});}
async function write(value){
 const db=await database();return new Promise((resolve,reject)=>{
  const tx=db.transaction('snapshots','readwrite'),store=tx.objectStore('snapshots'),request=store.get('current');let error=null,nextRevision=expectedRevision+1;
  request.onsuccess=()=>{const revision=request.result?.revision||0;if(revision!==expectedRevision){error=new Error('다른 창에서 더 최근 자료를 저장했습니다. 현재 내용을 전체 백업한 뒤 이 창을 다시 열어 주세요.');tx.abort();return;}store.put({revision:nextRevision,snapshot:value},'current');};
  tx.oncomplete=()=>{expectedRevision=nextRevision;resolve();};
  tx.onerror=()=>reject(error||tx.error||new Error('저장 공간 또는 브라우저 설정을 확인하세요. 전체 백업으로 보관할 수 있습니다.'));tx.onabort=tx.onerror;
 });
}
async function savePrevious(value){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put(value,'previous');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error('이전 상태 보관에 실패했습니다.'));tx.onabort=tx.onerror;});}
function capture(){
 if(!B.exportState||!I.exportState||!S.exportState)throw new Error('전체 저장 기능을 불러오지 못했습니다. 최신 프로그램을 다시 열어 주세요.');
 return {schema:1,version:'0.5.2',savedAt:new Date().toISOString(),core:B.exportState(),intake:I.exportState(),surface:S.exportState()};
}
async function apply(value){
 validateSnapshot(value);if(!B.importState||!I.importState||!S.importState)throw new Error('복원 기능을 불러오지 못했습니다. 최신 프로그램을 다시 열어 주세요.');
 const resume=await S.pauseAutomatic?.();
 try{
  const warnings=[];
  for(const [api,part] of [[B,value.core],[I,value.intake],[S,value.surface]]){const result=await api.importState(part);if(Array.isArray(result))warnings.push(...result);else if(Array.isArray(result?.warnings))warnings.push(...result.warnings);}
  if(value.core.activePage&&B.navigate)B.navigate(value.core.activePage);
  return warnings;
 }finally{resume?.();}
}
const controller=createController({read,write,savePrevious,capture,apply,status:showStatus,lock});
root.Hfo2Autosave={ready:controller.ready,flush:controller.flush,getStatus:controller.getStatus,exportState:controller.snapshot,importState:controller.restore};
for(const event of ['wf-rendered','surface-reviewed','hfo2-image-added','hfo2-navigate','intake-changed'])document.addEventListener(event,controller.changed);
for(const event of ['input','change'])document.addEventListener(event,e=>{if(e.target?.closest?.('.app-workspace')&&e.target.id!=='hfoRestoreFile')controller.changed();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')void controller.flush();});
root.addEventListener('pagehide',()=>{void controller.flush();});
$('hfoBackup').addEventListener('click',()=>{
 try{const value=controller.snapshot(),text=JSON.stringify(value);if(new Blob([text]).size>MAX_BACKUP_BYTES)throw new Error('전체 백업은 100 MB 이하여야 합니다. 사진 수 또는 크기를 줄여 주세요.');const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='HfO2_full_backup_'+new Date().toISOString().slice(0,19).replace(/[-:T]/g,'')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 catch(e){showStatus({state:'error',message:'전체 백업 실패',detail:String(e?.message||e)});}
});
$('hfoRestore').addEventListener('click',()=>{$('hfoRestoreFile').value='';$('hfoRestoreFile').click();});
$('hfoRestoreFile').addEventListener('change',async()=>{
 const file=$('hfoRestoreFile').files?.[0];if(!file)return;
 try{if(file.size>MAX_BACKUP_BYTES)throw new Error('전체 백업 파일은 100 MB 이하여야 합니다.');const value=JSON.parse(await file.text()),result=await controller.restore(value);if(result.warnings.length){help.open=true;$('hfoSaveMessage').textContent=result.warnings.join('\n');}}
 catch(e){help.open=true;const msg=$('hfoSaveMessage');msg.dataset.state='error';msg.textContent='백업을 적용하지 못했습니다. '+String(e?.message||e);}
 finally{$('hfoRestoreFile').value='';}
});
})(typeof window==='undefined'?globalThis:window);
