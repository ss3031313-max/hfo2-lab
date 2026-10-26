/* Two-file intake: explicit image matching, workbook queue, and preliminary OM review. */
(function(root){'use strict';
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key),text=value=>String(value??'').trim();
function imageStem(filename){return String(filename??'').replace(/\.(png|jpe?g|webp|bmp)$/i,'');}
function resolveMappings(samples,images,overrides={}){
 const byId=new Map(images.map(image=>[image.id,image])),matches=[],warnings=[];
 const resolved=samples.map(sample=>{
  let image_id=null,kind='unlinked',reason='OM 미연결',requested='';
  if(own(overrides,sample.id)){
   image_id=overrides[sample.id]||null;
   if(image_id&&!byId.has(image_id))throw new Error(sample.id+' · 선택한 OM 이미지를 찾을 수 없습니다.');
   kind='manual';reason=image_id?'직접 연결':'직접 미연결';
  }else{
   const filename=text(sample.image_filename),existing=text(sample.image_id);
   if(!filename&&existing&&byId.has(existing)){image_id=existing;kind='existing_id';reason='등록 이미지 ID';}
   else{
    requested=filename||existing||String(sample.id);
    const candidates=filename||existing?images.filter(image=>image.filename===requested):images.filter(image=>imageStem(image.filename)===String(sample.id));
    if(candidates.length===1){image_id=candidates[0].id;kind=filename||existing?'filename':'sample_stem';reason=kind==='filename'?'파일명 일치':'Sample ID · 파일명 일치';}
    else if(candidates.length>1){kind='ambiguous';reason='같은 이름 '+candidates.length+'장 · 직접 선택';}
    else reason=filename||existing?'일치 파일 없음 · '+requested:'Sample ID와 같은 파일명 없음';
   }
  }
  matches.push({sample_id:sample.id,image_id,kind,requested,reason});
  if(!image_id)warnings.push(sample.id+' · '+reason);
  return {...sample,image_id};
 });
 return {samples:resolved,matches,warnings};
}
const INPUT_FIELDS=['data_source','concentration_M','coats','rpm','spin_time_s','anneal_temp_C','anneal_time_min'];
function measurementKey(sample){
 const points=(sample.points||[]).map(point=>[point.position,point.value]).sort((a,b)=>String(a[0])<String(b[0])?-1:String(a[0])>String(b[0])?1:0);
 return JSON.stringify([INPUT_FIELDS.map(field=>sample[field]??null),points]);
}
function imageReference(sample,images){
 const filename=text(sample.image_filename),id=text(sample.image_id),requested=filename||id;
 if(!requested)return '';
 if(!filename&&images.some(image=>image.id===id))return 'id:'+id;
 const matching=images.filter(image=>image.filename===requested);
 return matching.length===1?'id:'+matching[0].id:'filename:'+requested;
}
function mergeWorkbooks(current,workbooks,options={}){
 const mode=options.mode||'append',images=options.images||[],originalHints=new Map(options.hints||[]),originalManual=options.manual||{};
 if(!['append','replace'].includes(mode)||!Array.isArray(current)||!Array.isArray(workbooks)||!workbooks.length)throw new Error('엑셀 목록과 가져오기 방식을 확인하세요.');
 const incoming=[],incomingFiles=new Map(),filenames=[],warnings=[];
 for(const workbook of workbooks){
  const filename=text(workbook.filename)||'이름 없는 엑셀';filenames.push(filename);
  if(!Array.isArray(workbook.samples))throw new Error(filename+' · 샘플 목록을 읽지 못했습니다.');
  for(const sample of workbook.samples){
   if(!sample||typeof sample.id!=='string'||!sample.id||!Array.isArray(sample.points))throw new Error(filename+' · Sample ID 또는 두께 목록을 확인하세요.');
   if(incomingFiles.has(sample.id))throw new Error('Sample ID 중복 · '+sample.id+' ('+incomingFiles.get(sample.id)+' / '+filename+'). 선택한 엑셀의 Sample ID를 서로 다르게 지정하세요.');
   incomingFiles.set(sample.id,filename);incoming.push(sample);
  }
  for(const warning of workbook.warnings||[])warnings.push(filename+' · '+warning);
 }
 const existing=new Map(current.map(sample=>[sample.id,sample])),toAdd=[];let skipped=0;
 for(const sample of incoming){
  const prior=mode==='append'?existing.get(sample.id):null;
  if(!prior){toAdd.push(sample);continue;}
  const knownReference=originalHints.has(sample.id),original=knownReference?{...prior,...originalHints.get(sample.id)}:prior;
  // A restored queue may only retain its mapped image ID. A blank incoming
  // reference does not erase that assignment or an explicit manual unlink.
  const sameImage=(!knownReference&&!text(sample.image_filename)&&!text(sample.image_id))||imageReference(original,images)===imageReference(sample,images);
  if(measurementKey(prior)!==measurementKey(sample)||!sameImage)throw new Error(sample.id+' · 기존 목록과 입력값이 다릅니다 ('+incomingFiles.get(sample.id)+'). ID를 변경하거나 "목록 교체"를 선택하세요.');
  skipped++;
 }
 const nextHints=mode==='append'?new Map(originalHints):new Map(),keepIds=new Set(mode==='append'?current.map(sample=>sample.id):incoming.map(sample=>sample.id));
 const nextManual=Object.fromEntries(Object.entries(originalManual).filter(([id])=>keepIds.has(id)));
 const result=resolveMappings(toAdd,images,nextManual),priorMatches=new Map((options.matches||[]).map(match=>[match.sample_id,match]));
 for(const sample of toAdd)nextHints.set(sample.id,{image_filename:sample.image_filename||null,image_id:sample.image_id||null});
 const samples=mode==='append'?[...current,...result.samples]:result.samples;
 const pointCount=samples.reduce((count,sample)=>count+sample.points.length,0);
 if(samples.length>1000)throw new Error('등록 목록은 최대 1,000개 샘플입니다. 선택한 엑셀을 나누거나 "목록 교체"를 선택하세요.');
 if(pointCount>100000)throw new Error('등록 목록은 최대 100,000개 두께값입니다. 선택한 엑셀을 나누거나 "목록 교체"를 선택하세요.');
 const retained=mode==='append'?current.map(sample=>{
  const previous=priorMatches.get(sample.id);if(previous&&previous.image_id===(sample.image_id||null))return {...previous};
  const manual=own(nextManual,sample.id);return {sample_id:sample.id,image_id:sample.image_id||null,kind:manual?'manual':sample.image_id?'existing_id':'unlinked',requested:'',reason:manual?(sample.image_id?'직접 연결':'직접 미연결'):sample.image_id?'기존 연결 유지':'OM 미연결 · 판정 대기'};
 }):[];
 return {samples,matches:[...retained,...result.matches],hints:nextHints,manual:nextManual,added:toAdd.length,skipped,filenames,warnings,pointCount,changed:mode==='replace'||toAdd.length>0,mode};
}
function isFileDrag(event){const transfer=event?.dataTransfer;return !!transfer&&(Array.from(transfer.types||[]).includes('Files')||Array.from(transfer.items||[]).some(item=>item.kind==='file')||!!transfer.files?.length);}
function uploadTypeError(file,kind){
 const name=String(file?.name||'');
 if(kind==='image')return /\.(png|jpe?g|webp|bmp)$/i.test(name)?'':'OM 사진에는 PNG·JPG·WebP·BMP 파일을 넣으세요.';
 if(/\.csv$/i.test(name))return 'CSV 파일은 왼쪽 CSV 입력에서 공정조건 CSV와 두께 CSV를 각각 등록하세요. 이 칸은 두 시트가 있는 .xlsx 파일용입니다.';
 return /\.xlsx$/i.test(name)?'':'측정값에는 공정조건·두께 시트가 있는 .xlsx 파일을 넣으세요.';
}
function bindFileDropZone(zone,{onFiles,isBusy,onError}){
 let depth=0;const reset=()=>{depth=0;zone.classList.remove('quick-drop-active');};
 zone.addEventListener('dragenter',event=>{if(!isFileDrag(event))return;event.preventDefault();if(isBusy())return;depth++;zone.classList.add('quick-drop-active');});
 zone.addEventListener('dragover',event=>{if(!isFileDrag(event))return;event.preventDefault();event.dataTransfer.dropEffect=isBusy()?'none':'copy';if(!isBusy())zone.classList.add('quick-drop-active');});
 zone.addEventListener('dragleave',event=>{depth=Math.max(0,depth-1);if(!depth||(event.relatedTarget&&!zone.contains(event.relatedTarget)))reset();});
 zone.addEventListener('drop',event=>{
  if(!isFileDrag(event))return;event.preventDefault();event.stopPropagation();reset();
  if(isBusy()){onError('파일 처리 중입니다. 완료된 뒤 다시 넣으세요.');return;}
  const files=Array.from(event.dataTransfer.files||[]);if(!files.length){onError('폴더 대신 파일을 선택해 넣으세요.');return;}
  // The dropped File objects use the exact same import path as the file chooser.
  try{Promise.resolve(onFiles(files)).catch(error=>onError(String(error.message||error)));}catch(error){onError(String(error.message||error));}
 });
 zone.addEventListener('dragend',reset);return {reset};
}
function summarizeOMAssessments(items){
 const counts={automaticPass:0,reviewedPass:0,otherPass:0,fail:0,pending:0};
 for(const item of items||[]){const a=item.assessment||item;if(a.state==='pass'){if(a.decisionSource==='AUTOMATIC'||a.user_confirmation==='UNREVIEWED')counts.automaticPass++;else if(a.user_confirmation==='OVERLAY_REVIEWED')counts.reviewedPass++;else counts.otherPass++;}else if(a.state==='fail')counts.fail++;else counts.pending++;}
 return counts;
}
root.Hfo2QuickImport={resolveMappings,imageStem,mergeWorkbooks,isFileDrag,uploadTypeError,bindFileDropZone,summarizeOMAssessments};
if(typeof document==='undefined')return;
const B=root.Hfo2Bridge,I=root.Hfo2Intake;
if(!B||!I)return;
const $=id=>document.getElementById(id),escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(value,d=1)=>Number.isFinite(value)?value.toLocaleString('ko-KR',{maximumFractionDigits:d}):'—';
let busy=false,applyingQueue=false,lastSignature='',workbookLabel='',workbookNames=[],hints=new Map(),manual={},latestMatches=[];
const page=$('page-intake'),hero=page.querySelector('.intake-hero'),layout=page.querySelector('.intake-layout');
const style=document.createElement('style');style.textContent=`
.quick-import{margin:0 0 20px}.quick-upload-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.quick-upload-card{padding:20px;border:1px solid #d9e4eb;border-radius:11px;background:#fff;min-width:0}.quick-upload-card h3{font-size:15px!important;margin:0 0 5px;color:#274355}.quick-upload-card p{font-size:11px;color:#718394;margin:5px 0 13px}.quick-upload-card input[type=file]{display:block;width:100%;font-size:11px;color:#506b7d;box-sizing:border-box}.quick-upload-card input::file-selector-button{border:1px solid #bccfd8;background:#f3f8fa;color:#345b6c;border-radius:6px;padding:8px 11px;margin-right:9px;cursor:pointer}.quick-file-label{font-size:12px;color:#41667b;line-height:1.6;overflow-wrap:anywhere;margin-top:13px}.quick-file-list{font-size:10px;line-height:1.6;color:#7a8b98;max-height:65px;overflow:auto;margin-top:5px;overflow-wrap:anywhere}.quick-upload-card button{font-size:10px;padding:5px 8px;margin-top:10px}.quick-preview{background:#fff;border:1px solid #d9e4eb;border-radius:10px;margin-top:16px;overflow:hidden}.quick-preview-head{padding:14px 17px;border-bottom:1px solid #e9eff3;display:flex;justify-content:space-between;align-items:center;gap:10px}.quick-preview-head h3{margin:0;font-size:13px}.quick-preview-head span{font-size:11px;color:#708597}.quick-preview .table-wrap{max-height:320px}.quick-match-table{width:100%;border-collapse:collapse;font-size:11px}.quick-match-table th,.quick-match-table td{text-align:left;padding:10px 14px;border-bottom:1px solid #edf1f5;vertical-align:middle}.quick-match-table td:first-child{min-width:125px}.quick-match-table select{font-size:11px;padding:7px;border:1px solid #ccdae4;border-radius:6px;background:white;width:100%;min-width:150px;max-width:370px}.quick-match-photo{display:flex;align-items:center;gap:10px}.quick-match-photo img{width:60px;height:42px;object-fit:cover;border-radius:5px;background:#edf1f4}.quick-match-photo small{display:block;color:#788c9b;font-size:10px;margin-top:3px;overflow-wrap:anywhere}.quick-match-state{font-size:10px;color:#357d6e;line-height:1.5;margin-top:5px}.quick-match-state.pending{color:#9a762e}.quick-match-state.fail{color:#b44e40}.quick-empty{padding:23px 18px;color:#81909f;text-align:center;font-size:12px;line-height:1.7}.quick-footer{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:15px}.quick-criteria{font-size:11px;color:#617e8e;line-height:1.9}.quick-criteria strong{color:#2a5967}.quick-compare{background:#087f82!important;color:#fff!important;border-color:#087f82!important;padding:12px 25px!important;font-size:14px!important;font-weight:700;white-space:nowrap}.quick-status{font-size:11px;color:#417568;white-space:pre-line;line-height:1.7;margin-top:10px}.quick-error{font-size:11px;color:#a4433c;background:#fff3f1;border:1px solid #efd0ca;border-radius:7px;padding:10px 12px;white-space:pre-line;line-height:1.7;margin-top:10px}.quick-manual{margin:18px 0;border-top:1px solid #dde7ed;padding-top:17px}.quick-manual>summary{cursor:pointer;font-size:13px;font-weight:650;color:#597185;margin-bottom:16px}.quick-photos{display:flex;gap:9px;overflow:auto;padding:3px 0 10px;margin:0 0 15px}.quick-photo-shortcut{flex:0 0 150px;min-width:0;border:1px solid #dce6ec;border-radius:8px;background:#fff;padding:8px;text-align:left}.quick-photo-shortcut img{width:100%;height:76px;object-fit:cover;border-radius:5px;background:#f1f4f6}.quick-photo-shortcut strong{display:block;font-size:11px;margin-top:5px;overflow-wrap:anywhere}.quick-photo-shortcut span{display:block;font-size:10px;line-height:1.5;color:#738392;margin-top:3px}.quick-photo-shortcut[data-state=pass]{border-color:#89c7ad;background:#f1faf5}.quick-photo-shortcut[data-state=fail]{border-color:#e1a2a8;background:#fff4f5}.quick-photo-shortcut[data-state=pending]{border-color:#dfc789;background:#fffcf2}.quick-photo-missing{height:76px;display:grid;place-items:center;background:#f3f5f7;border-radius:5px;font-size:10px;color:#8b97a3}.quick-photo-shortcut:disabled{opacity:1;cursor:default}.quick-import[aria-busy=true]{opacity:.75}@media(max-width:700px){.quick-upload-grid{grid-template-columns:1fr}.quick-footer{align-items:stretch;flex-direction:column}.quick-upload-card{padding:16px}.quick-match-table th,.quick-match-table td{padding:9px}.quick-match-photo{display:block}.quick-match-photo img{display:none}.quick-preview-head{align-items:start;flex-direction:column}}`;
style.textContent+='\n.quick-excel-mode{display:flex;align-items:center;gap:8px;font-size:11px;color:#698191;margin:10px 0 12px}.quick-excel-mode select{padding:6px 9px;background:#f7fafb;border:1px solid #cbd9e2;border-radius:6px;font-size:11px;color:#355c6d}';
style.textContent+=`
.app-page .quick-upload-grid{gap:18px}.app-page .quick-upload-card{border:1px solid #dde6eb;border-radius:13px;padding:22px;background:#fff}.app-page .quick-upload-card h3{font-size:18px!important;color:#203f4d}.app-page .quick-upload-card p{font-size:12px;line-height:1.6;color:#7a8c97}.app-page .quick-upload-card input[type=file]{font-size:12px;border:1px dashed #c6d8df;border-radius:8px;padding:12px;background:#fafcfd}.app-page .quick-upload-card input::file-selector-button{background:#eaf4f2;border-color:#c4dcd6;color:#256e68;border-radius:6px;font-weight:600;padding:8px 12px}.app-page .quick-file-label{font-size:12px;font-weight:600;color:#3c5d6b;margin-top:14px}.app-page .quick-file-list{font-size:11px;color:#84939b;max-height:48px}.app-page .quick-excel-mode{margin:8px 0 10px;font-size:11px}.quick-card-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.quick-card-heading span{font-size:10px;letter-spacing:.05em;color:#73908f;border:1px solid #dfe8e6;padding:3px 7px;border-radius:5px}.app-page .quick-card-heading h3{margin:0}.app-page .quick-upload-card #quickSampleWorkbook{color:#617c88;padding:6px 9px;background:#f8fafb;border-color:#dce5e9}
.app-page .quick-preview{border-radius:12px;border-color:#dfe7eb;margin-top:18px}.app-page .quick-preview-head{padding:16px 19px;background:#fbfcfd}.app-page .quick-preview-head h3{font-size:14px}.app-page .quick-preview-head span{font-size:12px}.app-page .quick-match-table th{background:#f5f8f9;font-size:11px;padding:10px 18px}.app-page .quick-match-table td{font-size:12px;padding:15px 18px}.app-page .quick-match-table td strong{font-size:13px;color:#2c4a59}.app-page .quick-match-table .quick-source{margin-top:5px;font-size:10px;color:#84939c}.app-page .quick-match-state{font-size:11px}.app-page .quick-match-table select{max-width:410px;padding:8px 10px;color:#3f5f6f}.app-page .quick-match-photo img{width:68px;height:48px}.app-page .quick-empty{padding:30px 18px;background:#fcfdfd;line-height:1.9;color:#8696a0}.quick-empty strong{display:block;font-size:14px;color:#5c7785;margin-bottom:5px}
.app-page .quick-footer{border:1px solid #dce7e9;border-radius:12px;background:#eff6f5;padding:18px 20px;align-items:center;margin-top:18px}.app-page .quick-criteria{font-size:12px;line-height:1.9;color:#5c7884}.app-page .quick-criteria strong{font-size:11px;color:#355f65}.app-page .quick-criteria small{display:block;font-size:10px;color:#7f8d87;margin-top:5px}.quick-next-action{text-align:right;flex-shrink:0}.quick-next-action small{display:block;margin:7px 0 0;font-size:10px;color:#69858b}.app-page .quick-compare{border-radius:8px!important;padding:12px 26px!important;font-size:14px!important}.app-page .quick-compare:disabled{background:#d6e4e3!important;border-color:#d6e4e3!important;color:#6f888a!important;opacity:1}.quick-photo-details{margin:18px 0;border:1px solid #dfe7ec;border-radius:10px;background:#fff;padding:14px 17px}.quick-photo-details>summary{font-size:12px;color:#5f7c8b;font-weight:600;cursor:pointer}.quick-photo-details .quick-photos{margin-top:14px;margin-bottom:0}.quick-photo-details[hidden]{display:none!important}.quick-status:empty{display:none}
@media(max-width:700px){.app-page .quick-upload-card{padding:18px}.app-page .quick-footer{padding:16px;align-items:stretch}.quick-next-action{text-align:left}.quick-next-action .quick-compare{width:100%}.app-page .quick-match-table th,.app-page .quick-match-table td{padding:11px}.app-page .quick-preview-head{padding:15px}.app-page .quick-match-photo img{display:none}}
`;
style.textContent+=`
.app-page .quick-drop-zone{transition:border-color .15s,background .15s,box-shadow .15s}.app-page .quick-drop-zone.quick-drop-active{border-color:#168a7e;background:#edf9f5;box-shadow:0 0 0 2px #8acabd}.app-page .quick-drop-zone:focus-within{border-color:#69aba2}.quick-drop-hint{padding:10px 12px;margin:8px 0 12px;border:1px dashed #b9d0d8;border-radius:7px;color:#547d84;background:#f8fbfc;font-size:12px;line-height:1.6}.quick-drop-active .quick-drop-hint{border-color:#168a7e;background:#e1f5ed;color:#166f63}.quick-format-note{font-size:11px;color:#7a8b98;margin-top:8px}.quick-upload-card .quick-format-note button{margin:0 3px;padding:2px 5px;background:transparent;color:#36796f;border:0;text-decoration:underline}.quick-import[aria-busy=true] .quick-drop-zone{cursor:progress}
`;
document.head.appendChild(style);
const panel=document.createElement('section');panel.id='quickImport';panel.className='quick-import';
panel.innerHTML='<div class="quick-upload-grid"><section id="quickOmDropZone" class="quick-upload-card quick-drop-zone" role="group" aria-label="OM 사진 파일 놓기" aria-describedby="quickOmDropHint"><div class="quick-card-heading"><h3>OM Images</h3><span>IMAGE</span></div><p>PNG · JPG · WebP · BMP · 여러 장 선택</p><div id="quickOmDropHint" class="quick-drop-hint">사진을 여기에 끌어 놓거나 파일 선택</div><input id="quickOmFiles" type="file" multiple accept="image/png,image/jpeg,image/webp,image/bmp" aria-label="OM 사진 업로드"><div id="quickOmLabel" class="quick-file-label">등록된 사진 없음</div><div id="quickOmNames" class="quick-file-list"></div></section><section id="quickExcelDropZone" class="quick-upload-card quick-drop-zone" role="group" aria-label="측정값 파일 놓기" aria-describedby="quickExcelDropHint"><div class="quick-card-heading"><h3>Measurements</h3><span>DATA</span></div><p>.xlsx · 공정조건 / 두께 2개 시트 · 여러 파일 선택</p><div id="quickExcelDropHint" class="quick-drop-hint">엑셀을 여기에 끌어 놓거나 파일 선택</div><label class="quick-excel-mode">가져오기<select id="quickExcelMode"><option value="append">목록에 추가</option><option value="replace">목록 교체</option></select></label><input id="quickExcelFile" type="file" multiple accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="측정값 여러 파일 업로드"><div id="quickExcelLabel" class="quick-file-label">선택된 엑셀 없음</div><div id="quickExcelNames" class="quick-file-list"></div><button id="quickSampleWorkbook" type="button">샘플 엑셀</button><div class="quick-format-note">CSV 양식은 <button id="quickOpenCSV" type="button">CSV 입력</button>에서 등록</div></section></div><div class="quick-preview"><div class="quick-preview-head"><h3>샘플 · 사진 연결</h3><span id="quickPreviewCount">샘플 0개</span></div><div id="quickPreview"></div></div><div class="quick-footer"><div id="quickCriteria" class="quick-criteria"></div><div class="quick-next-action"><button id="quickCompare" type="button" class="quick-compare" disabled>분석·비교</button><small>두께 계산 → OM 분석 → 조건 비교</small></div></div><div id="quickStatus" class="quick-status" role="status" aria-live="polite"></div><div id="quickError" class="quick-error" role="alert" hidden></div>';
hero.insertAdjacentElement('afterend',panel);
const manualDetails=document.createElement('details');manualDetails.id='quickManualDetails';manualDetails.className='quick-manual';manualDetails.innerHTML='<summary>직접 입력 · 상세 등록</summary>';layout.parentNode.insertBefore(manualDetails,layout);manualDetails.appendChild(layout);
const photoDetails=document.createElement('details');photoDetails.className='quick-photo-details';photoDetails.innerHTML='<summary>OM 이미지 바로가기</summary>';const photoStrip=document.createElement('div');photoStrip.id='quickComparePhotos';photoStrip.className='quick-photos';photoDetails.appendChild(photoStrip);$('intakeCandidateSummary').insertAdjacentElement('afterend',photoDetails);
function queueSignature(samples){return JSON.stringify(I.rowsFor(samples));}
function showError(message){$('quickError').textContent=message||'';$('quickError').hidden=!message;}
function showStatus(message){$('quickStatus').textContent=message||'';}
function setBusy(value){busy=value;panel.setAttribute('aria-busy',String(value));manualDetails.inert=value;for(const id of ['quickOmFiles','quickExcelFile','quickExcelMode','quickSampleWorkbook','quickOpenCSV'])$(id).disabled=value;refresh();document.dispatchEvent(new CustomEvent('hfo2-import-busy',{detail:{busy}}));}
function rawForQueue(samples){return samples.map(sample=>({...sample,...(hints.get(sample.id)||{})}));}
function setResolvedQueue(result){applyingQueue=true;try{I.setQueue(result.samples);lastSignature=queueSignature(I.getQueue());latestMatches=result.matches;}finally{applyingQueue=false;}refresh();}
function resolveCurrentQueue(){const samples=I.getQueue(),result=resolveMappings(rawForQueue(samples),B.listImages(),manual);if(queueSignature(result.samples)!==queueSignature(samples))setResolvedQueue(result);else{latestMatches=result.matches;refresh();}return result;}
function refresh(){
 const samples=I.getQueue(),signature=queueSignature(samples);
 if(!applyingQueue&&signature!==lastSignature){hints=new Map();manual={};workbookLabel='';workbookNames=[];latestMatches=[];lastSignature=signature;showStatus('');showError('');}
 const images=B.listImages();$('quickOmLabel').textContent=images.length?'등록된 사진 '+images.length+'장':'등록된 사진 없음';$('quickOmNames').textContent=images.map(image=>image.filename).join(' · ');
 $('quickExcelLabel').textContent=workbookLabel||(samples.length?'등록 목록 '+samples.length+'개 샘플':'선택된 엑셀 없음');$('quickExcelNames').textContent=workbookNames.join(' · ');$('quickPreviewCount').textContent='샘플 '+samples.length+'개 · OM 연결 '+samples.filter(sample=>sample.image_id&&B.getImage(sample.image_id)).length+'개';$('quickCompare').disabled=busy||!samples.length;
 const matches=new Map(latestMatches.map(match=>[match.sample_id,match]));
 $('quickPreview').innerHTML=samples.length?'<div class="table-wrap"><table class="quick-match-table"><thead><tr><th>Sample / 출처</th><th>위치별 두께</th><th>OM Images</th></tr></thead><tbody>'+samples.map(sample=>{const image=B.getImage(sample.image_id),match=matches.get(sample.id),source=sample.data_source==='SYNTHETIC'?'기능 확인용':'실측 표기 · 미검증',om=image?root.Hfo2Surface?.getAssessment?.(sample.image_id):null;return '<tr><td><strong>'+escape(sample.id)+'</strong><div class="quick-source">'+source+'</div></td><td>'+sample.points.length+'개'+(sample.stats?'<div class="quick-match-state">평균 '+fmt(sample.stats.mean,2)+' nm</div>':'<div class="quick-match-state pending">두께 미입력</div>')+'</td><td><div class="quick-match-photo">'+(image?'<img src="'+escape(image.image_data_url)+'" alt="'+escape(sample.id)+' 연결 OM">':'')+'<div><select data-quick-map="'+escape(sample.id)+'" aria-label="'+escape(sample.id)+' OM 사진 연결"'+(busy?' disabled':'')+'><option value="">OM 미연결</option>'+images.map(record=>'<option value="'+escape(record.id)+'"'+(record.id===sample.image_id?' selected':'')+'>'+escape(record.filename+' · '+record.id)+'</option>').join('')+'</select><div class="quick-match-state'+(image?'':' pending')+'">'+escape(match?.reason||(image?'등록 이미지 연결':'OM 미연결 · 판정 대기'))+'</div>'+(om?'<div class="quick-match-state '+(om.state==='fail'?'fail':om.state==='pass'?'':'pending')+'">'+escape(om.label)+'</div>':'')+'</div></div></td></tr>';}).join('')+'</tbody></table></div>':'<div class="quick-empty"><strong>등록된 샘플 없음</strong>OM 사진 · 측정값 첨부 후 Sample ID로 연결</div>';
 let rule;try{rule=B.getRule();}catch(e){$('quickCriteria').textContent='판정 기준 입력 확인 필요';return;}
 const policy=root.Hfo2Surface?.getPolicy?.()||{};$('quickCriteria').innerHTML='<strong>현재 판정 기준</strong><br>두께 '+fmt(rule.target)+' ± '+fmt(rule.tolerance)+' nm · CV ≤ '+fmt(rule.cvLimit)+'%<br>OM 얼룩 의심 면적 ≤ '+fmt(policy.areaLimit)+'% · 밀도 ≤ '+fmt(policy.particleDensityLimit)+'개/1만 px<small>초기 운영 기준 · OM 자동 판정 · 예외 검토</small>';
}
function refreshResultPhotos(){const samples=B.getSamples();photoDetails.hidden=!samples.length;photoStrip.hidden=!samples.length;photoStrip.innerHTML=samples.map(sample=>{const image=B.getImage(sample.image_id),assessment=I.assessCombined(sample,B.getRule());return '<button type="button" class="quick-photo-shortcut" data-quick-review="'+escape(sample.id)+'" data-state="'+assessment.om.state+'"'+(image?'':' disabled')+'>'+(image?'<img src="'+escape(image.image_data_url)+'" alt="'+escape(sample.id)+' OM">':'<div class="quick-photo-missing">OM 미연결</div>')+'<strong>'+escape(sample.id)+'</strong><span>'+escape(assessment.om.label)+(image?(assessment.om.state==='pass'?' · 결과 보기 →':' · 검토 →'):'')+'</span></button>';}).join('');}
async function compare(){
 if(busy)return null;
 const samples=I.getQueue();if(!samples.length){showError('측정값 또는 샘플을 먼저 등록하세요.');return null;}
 let previousCore,previousIntake,applied=false;
 setBusy(true);showError('');showStatus('두께 분석 · OM 자동 분석 중');
 try{
  B.getRule();if(!root.Hfo2Surface?.analyzeBatch)throw new Error('OM 자동 분석 기능을 불러오지 못했습니다.');
  previousCore=B.exportState();previousIntake=I.exportState();
  I.runAnalysis();applied=true;B.navigate('intake');
  const ids=[...new Set(B.getSamples().map(sample=>sample.image_id).filter(Boolean))];
  const result=await root.Hfo2Surface.analyzeBatch(ids,{automaticReference:true});
  B.refresh();I.renderAnalysis();refreshResultPhotos();B.navigate('compare');
  const pending=I.getSampleAssessments().filter(item=>item.state==='pending').length,omCounts=summarizeOMAssessments(result.items);
  showStatus('두께 분석 '+samples.length+'개 · OM 분석 '+result.analyzed+'장 · 기존 결과 유지 '+result.retained+'장\nOM 자동 충족 '+omCounts.automaticPass+'장 · 확인 완료 '+omCounts.reviewedPass+'장 · 기준 초과 '+omCounts.fail+'장 · 검토 대기 '+omCounts.pending+'장'+(omCounts.otherPass?' · 기준 충족 '+omCounts.otherPass+'장':'')+'\n종합 판정 대기 '+pending+'시편'+(result.warnings?.length?'\n'+result.warnings.join('\n'):''));
  try{await root.Hfo2Autosave?.flush?.();}catch(e){showError('분석 결과는 표시되었습니다. 자동 저장 확인 필요 · '+String(e.message||e));}
  return result;
 }catch(e){
  let suffix='이전 분석 결과 유지';
  if(applied&&previousCore){try{await B.importState(previousCore);I.importState(previousIntake);}catch(restoreError){suffix='이전 분석 복원 확인 필요 · '+String(restoreError.message||restoreError);}}
  showError(String(e.message||e)+'\n'+suffix);showStatus('');B.navigate('intake');return null;
 }finally{setBusy(false);}
}
async function importImageFiles(incoming){
 const files=Array.from(incoming||[]);if(!files.length||busy)return;
 setBusy(true);showError('');const failures=[];let added=0;
 try{for(const file of files){if(B.listImages().length>=100){failures.push(file.name+' · 이미지 100장 한도');continue;}try{const typeError=uploadTypeError(file,'image');if(typeError)throw new Error(typeError);await B.addImage(file);added++;}catch(e){failures.push(file.name+' · '+String(e.message||e));}}resolveCurrentQueue();showStatus('OM 사진 '+added+'장 등록 · 파일명과 Sample ID 연결 확인');if(failures.length)showError('등록하지 못한 사진 '+failures.length+'장\n'+failures.join('\n'));}
 catch(e){showError(String(e.message||e));}finally{$('quickOmFiles').value='';setBusy(false);}
}
async function importWorkbookFiles(incoming){
 const files=Array.from(incoming||[]);if(!files.length||busy)return;const mode=$('quickExcelMode').value;setBusy(true);showError('');showStatus('측정값 '+files.length+'개 읽는 중');
 const initialSignature=queueSignature(I.getQueue());
 try{
  if(!root.Hfo2Excel?.readFile)throw new Error('엑셀 읽기 기능을 불러오지 못했습니다.');
  for(const file of files){const typeError=uploadTypeError(file,'workbook');if(typeError)throw new Error(file.name+' · '+typeError);}
  const workbooks=[];
  for(const file of files){try{const data=await root.Hfo2Excel.readFile(file);workbooks.push({...data,filename:data.filename||file.name});}catch(e){throw new Error(file.name+' · '+String(e.message||e));}}
  if(queueSignature(I.getQueue())!==initialSignature)throw new Error('엑셀을 읽는 동안 등록 목록이 변경되었습니다. 파일을 다시 선택하세요.');
  const merged=mergeWorkbooks(I.getQueue(),workbooks,{mode,images:B.listImages(),hints,manual,matches:latestMatches});
  if(merged.changed)setResolvedQueue(merged);
  hints=merged.hints;manual=merged.manual;latestMatches=merged.matches;workbookNames=merged.filenames;
  workbookLabel='엑셀 '+files.length+'개 · '+(mode==='replace'?'교체 ':'추가 ')+merged.added+'개 · 건너뜀 '+merged.skipped+'개';
  showStatus(workbookLabel+' · 전체 '+merged.samples.length+'개 샘플\n사진 연결 확인 후 분석·비교'+(merged.warnings.length?'\n'+merged.warnings.join('\n'):''));refresh();
 }catch(e){showError(String(e.message||e)+'\n선택한 엑셀은 모두 적용하지 않았습니다. 기존 등록 목록·사진 연결·분석 결과 유지');showStatus('');}finally{$('quickExcelFile').value='';setBusy(false);}
}
$('quickOmFiles').addEventListener('change',()=>{void importImageFiles($('quickOmFiles').files);});
$('quickExcelFile').addEventListener('change',()=>{void importWorkbookFiles($('quickExcelFile').files);});
$('quickOpenCSV').addEventListener('click',()=>{B.navigate('data');const inputDetails=document.querySelector('#wfInputs details');if(inputDetails)inputDetails.open=true;});
const dropZones=[bindFileDropZone($('quickOmDropZone'),{onFiles:importImageFiles,isBusy:()=>busy,onError:showError}),bindFileDropZone($('quickExcelDropZone'),{onFiles:importWorkbookFiles,isBusy:()=>busy,onError:showError})];
// A file dropped outside either card must not replace this offline app with the file.
document.addEventListener('dragover',event=>{if(isFileDrag(event)){event.preventDefault();if(!event.target.closest?.('.quick-drop-zone'))event.dataTransfer.dropEffect='none';}});
document.addEventListener('drop',event=>{if(isFileDrag(event)){event.preventDefault();dropZones.forEach(zone=>zone.reset());}});
document.addEventListener('dragend',()=>dropZones.forEach(zone=>zone.reset()));
document.addEventListener('dragleave',event=>{if(!event.relatedTarget&&event.target===document.documentElement)dropZones.forEach(zone=>zone.reset());});
$('quickPreview').addEventListener('change',event=>{const select=event.target.closest('[data-quick-map]');if(!select||busy)return;try{showError('');const next={...manual,[select.dataset.quickMap]:select.value||null},resolved=resolveMappings(rawForQueue(I.getQueue()),B.listImages(),next);setResolvedQueue(resolved);manual=next;showStatus('사진 연결 변경 · 분석·비교로 반영');}catch(e){showError(String(e.message||e));refresh();}});
$('quickCompare').addEventListener('click',()=>{void compare();});
$('quickSampleWorkbook').addEventListener('click',()=>{try{const base64=root.HFO2_SAMPLE_WORKBOOK_BASE64;if(!base64)throw new Error('샘플 엑셀을 불러오지 못했습니다.');const bytes=Uint8Array.from(atob(base64),character=>character.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),link=document.createElement('a');link.href=url;link.download='HfO2_sample_inputs.xlsx';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){showError(String(e.message||e));}});
function openSampleOM(event){const button=event.target.closest('[data-quick-review]');if(!button)return;const sample=B.getSamples().find(item=>item.id===button.dataset.quickReview);if(!sample?.image_id||!B.getImage(sample.image_id))return;B.selectSample(sample.id);B.selectImage(sample.image_id);B.navigate('om');}
photoStrip.addEventListener('click',openSampleOM);$('intakeCandidateSummary').addEventListener('click',openSampleOM);
document.addEventListener('click',event=>{if(page.hidden)return;const button=event.target.closest('[data-intake-step="compare"],[data-page="compare"],[data-goto="compare"]');if(!button||(!busy&&!I.isPending()))return;event.preventDefault();event.stopImmediatePropagation();if(!busy)void compare();},true);
for(const event of ['intake-changed','wf-rendered'])document.addEventListener(event,()=>{if(!applyingQueue)refresh();});
document.addEventListener('hfo2-image-added',()=>{if(!busy)resolveCurrentQueue();});
document.addEventListener('hfo2-images-cleared',()=>{hints=new Map();manual={};latestMatches=[];lastSignature=queueSignature(I.getQueue());showError('');showStatus('');refresh();try{refreshResultPhotos();}catch(e){photoDetails.hidden=true;}});
document.addEventListener('surface-reviewed',()=>{refresh();try{refreshResultPhotos();}catch(e){photoStrip.hidden=true;photoDetails.hidden=true;}});
document.addEventListener('hfo2-navigate',event=>{if(event.detail?.page==='compare')try{refreshResultPhotos();}catch(e){photoStrip.hidden=true;photoDetails.hidden=true;}});
root.Hfo2QuickImport={resolveMappings,imageStem,mergeWorkbooks,isFileDrag,uploadTypeError,bindFileDropZone,summarizeOMAssessments,refresh,compare,isBusy:()=>busy};
lastSignature=queueSignature(I.getQueue());refresh();try{refreshResultPhotos();}catch(e){photoStrip.hidden=true;photoDetails.hidden=true;}
})(typeof window==='undefined'?globalThis:window);
