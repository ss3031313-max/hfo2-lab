/* Per-specimen process trends. A scatter plot is descriptive, not a causal model. */
(function(root){'use strict';
const FIELDS=[['concentration_M','농도','M'],['coats','코팅','회'],['rpm','RPM','rpm'],['spin_time_s','코팅 시간','초'],['anneal_temp_C','어닐링 온도','°C'],['anneal_time_min','어닐링 시간','분']];
const PRESETS=[
 {id:'coats_cv',x:'coats',y:'cv',label:'코팅 횟수 → 두께 CV',xLabel:'코팅 횟수 (회)',yLabel:'두께 CV (%)',unit:'%'},
 {id:'coats_area',x:'coats',y:'areaPercent',kind:'om',label:'코팅 횟수 → OM 얼룩 의심 면적',xLabel:'코팅 횟수 (회)',yLabel:'OM 얼룩 의심 면적 (%)',unit:'%'},
 {id:'coats_density',x:'coats',y:'particleDensityPer10k',kind:'om',label:'코팅 횟수 → OM 검출 영역 밀도',xLabel:'코팅 횟수 (회)',yLabel:'OM 검출 영역 밀도 (개/1만 픽셀)',unit:'개/1만 픽셀'},
 {id:'concentration_cv',x:'concentration_M',y:'cv',label:'농도 → 두께 CV',xLabel:'전구체 농도 (M)',yLabel:'두께 CV (%)'},
 {id:'rpm_mean',x:'rpm',y:'mean',label:'RPM → 평균 두께',xLabel:'회전수 (rpm)',yLabel:'평균 두께 (nm)'},
 {id:'concentration_mean',x:'concentration_M',y:'mean',label:'농도 → 평균 두께',xLabel:'전구체 농도 (M)',yLabel:'평균 두께 (nm)'}
];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>v===null||v===undefined||typeof v==='boolean'||(typeof v==='string'&&!v.trim())?null:Number.isFinite(Number(v))?Number(v):null;
const fmt=(v,d=2)=>number(v)===null?'—':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:d});
const sourceLabel=s=>s==='SYNTHETIC'?'기능 확인용':s==='REAL_MEASUREMENT'?'실측 표기 · 미검증':'출처 미입력';
function getPreset(id){return PRESETS.find(p=>p.id===id)||PRESETS[0];}
function validRule(rule){return !!rule&&number(rule.target)>0&&number(rule.tolerance)!==null&&number(rule.tolerance)>=0&&number(rule.cvLimit)!==null&&number(rule.cvLimit)>=0;}
function thicknessState(mean,cv,rule){
 if(Math.abs(mean-rule.target)>rule.tolerance+1e-10||(cv!==null&&cv>rule.cvLimit+1e-10))return 'fail';
 return cv===null?'pending':'pass';
}
function opticalContext(result,image){
 const raw=String(image.magnification??result.magnification??'').trim(),match=raw.match(/^(\d+(?:\.\d+)?)\s*[x×]?$/i),magnification=match?Number(match[1]):null;
 const values={magnification,width:number(result.width),height:number(result.height),roi:['left','top','right','bottom'].map(k=>number(result.roi?.[k])),threshold:number(result.threshold),minArea:number(result.minArea),particleMinArea:number(result.particleMinArea),referenceSource:result.referenceSource||result.reference_source||''};
 const complete=magnification>0&&values.width>0&&values.height>0&&values.roi.every(v=>v!==null)&&values.threshold!==null&&values.minArea>0&&values.particleMinArea>0&&!!values.referenceSource;
 return {...values,complete,key:JSON.stringify(values)};
}
function buildOpticalData(samples,presetId,context={}){
 const preset=getPreset(presetId),results=new Map((context.results||[]).map(r=>[r.image_id,r])),images=new Map((context.images||[]).map(image=>[image.id,image])),linked=new Map(),points=[],ambiguousImages=[];let duplicateCollapsed=0;
 for(const sample of samples){if(!sample.image_id)continue;if(!linked.has(sample.image_id))linked.set(sample.image_id,[]);linked.get(sample.image_id).push(sample);}
 for(const [imageId,members] of linked){
  const recipes=new Set(members.map(sample=>JSON.stringify([sample.data_source||'',...FIELDS.map(([key])=>number(sample[key]))])));
  if(recipes.size>1){ambiguousImages.push(imageId);continue;}
  const sample=[...members].sort((a,b)=>String(a.id).localeCompare(String(b.id)))[0],result=results.get(imageId),image=images.get(imageId),x=number(sample[preset.x]),p=context.policy||result?.policy;
  if(!result||!image||x===null||x<=0||p?.valid===false)continue;
  if(p&&['threshold','minArea','particleMinArea'].some(key=>number(p[key])===null||number(result[key])!==number(p[key])))continue;
  const area=number(result.areaPercent),density=number(result.particleDensityPer10k),y=preset.y==='areaPercent'?area:density;
  if(y===null||y<0||(preset.y==='areaPercent'&&y>100))continue;
  const sampleIds=[...new Set(members.map(s=>String(s.id)))].sort(),assessment=result.assessment||{},optics=opticalContext(result,image);
  const point={id:sampleIds[0],sampleIds,image_id:imageId,image_filename:image.filename||result.image_filename||imageId,kind:'om',source:sample.data_source||'',x,y,areaPercent:area,particleDensityPer10k:density,particleCount:number(result.particleCount),correctionCount:number(result.correctionCount)||0,state:['pass','fail','pending'].includes(assessment.state)?assessment.state:'pending',assessmentLabel:assessment.label||'OM 판정 대기',assessmentReason:assessment.reason||'',optics};
  for(const [key] of FIELDS)point[key]=number(sample[key]);
  duplicateCollapsed+=members.length-1;points.push(point);
 }
 return {points:points.sort((a,b)=>a.x-b.x||a.id.localeCompare(b.id)),ambiguousImages,duplicateCollapsed};
}
function buildPoints(samples,presetId,rule,context={}){
 const preset=getPreset(presetId),points=[];
 if(preset.kind==='om')return buildOpticalData(samples,presetId,context).points;
 if(!validRule(rule))return points;
 for(const sample of samples){
  const stats=sample.stats,mean=number(stats?.mean),n=number(stats?.n),x=number(sample[preset.x]);
  const positions=(sample.points||[]).filter(p=>number(p.value)>0);
  if(sample.editError||mean===null||mean<=0||n===null||!Number.isInteger(n)||n<1||!positions.length||x===null||x<=0)continue;
  const rawCV=number(stats?.cv),cv=n>=2&&rawCV!==null&&rawCV>=0?rawCV:null;
  const y=preset.y==='cv'?cv:mean;if(y===null)continue;
  const point={id:String(sample.id),source:sample.data_source||'',mean,cv,n,x,y,state:thicknessState(mean,cv,rule)};
  for(const [key] of FIELDS)point[key]=number(sample[key]);
  points.push(point);
 }
 return points.sort((a,b)=>a.x-b.x||a.id.localeCompare(b.id));
}
function groupPoints(points,presetId){
 const preset=getPreset(presetId),fixed=FIELDS.filter(([key])=>key!==preset.x),groups=new Map();
 for(const point of points){
  // Provenance is held constant too: simulated and measured inputs are not one comparison group.
  const key=JSON.stringify([point.source,...fixed.map(([field])=>point[field]),...(preset.kind==='om'?[point.optics?.key]:[])]);
  if(!groups.has(key))groups.set(key,{key,source:point.source,fixed:Object.fromEntries(fixed.map(([field])=>[field,point[field]])),optics:point.optics||null,complete:!!point.source&&fixed.every(([field])=>point[field]!==null)&&(preset.kind!=='om'||!!point.optics?.complete),points:[]});
  groups.get(key).points.push(point);
 }
 return [...groups.values()].map(group=>({...group,levels:new Set(group.points.map(p=>p.x)).size})).sort((a,b)=>Number(b.complete&&b.levels>=2)-Number(a.complete&&a.levels>=2)||b.levels-a.levels||b.points.length-a.points.length||a.key.localeCompare(b.key));
}
function choosePreset(){return 'coats_cv';}
function buildModel(samples,presetId,rule,requestedGroup=null,context={}){
 const preset=getPreset(presetId),optical=preset.kind==='om'?buildOpticalData(samples,preset.id,context):null,allPoints=optical?optical.points:buildPoints(samples,preset.id,rule),groups=groupPoints(allPoints,preset.id);
 const group=requestedGroup==='all'?null:groups.find(g=>g.key===requestedGroup)||(requestedGroup===null?groups.find(g=>g.complete&&g.levels>=2):null);
 const points=group?group.points:allPoints,levels=new Set(points.map(p=>p.x)).size;
 return {preset,allPoints,groups,group,groupKey:group?.key||'all',points,levels,excluded:samples.length-allPoints.length-(optical?.duplicateCollapsed||0),controlled:!!group&&group.complete&&levels>=2,omPolicy:context.policy||context.results?.[0]?.policy||null,ambiguousImages:optical?.ambiguousImages||[],duplicateCollapsed:optical?.duplicateCollapsed||0};
}
function domain(values,{zero=false,padding=.08}={}){
 const valid=values.filter(v=>typeof v==='number'&&Number.isFinite(v));
 if(!valid.length)return [0,1];
 let low=Math.min(...valid),high=Math.max(...valid);
 if(zero)low=Math.min(0,low);
 if(low===high){const d=Math.abs(low)*.1||1;low=zero&&low===0?0:low-d;high+=d;}
 const gap=(high-low)*padding;
 return [zero?Math.min(0,low):Math.max(0,low-gap),high+gap];
}
function fixedDescription(group,preset){
 if(!group)return '전체 시편 · 공정조건 혼합';
 return FIELDS.filter(([key])=>key!==preset.x).map(([key,label,unit])=>label+' '+fmt(group.fixed[key])+unit).join(' · ')+(preset.kind==='om'?' · 배율 '+fmt(group.optics?.magnification)+'× · '+fmt(group.optics?.width,0)+'×'+fmt(group.optics?.height,0)+' px':'');
}
function pointDescription(point){const metric=point.kind==='om'?'OM '+point.image_filename+' · 큰 영역 '+fmt(point.areaPercent)+'% · 검출 밀도 '+fmt(point.particleDensityPer10k,4)+'개/1만 픽셀 · 사용자 수정 '+point.correctionCount+'곳 · '+point.assessmentLabel+(point.sampleIds.length>1?' · 같은 이미지에 연결: '+point.sampleIds.join(', '):''):'평균 '+fmt(point.mean)+' nm · CV '+fmt(point.cv)+'% · 위치 '+point.n+'개';return point.id+' · '+metric+' · '+FIELDS.map(([key,label,unit])=>label+' '+fmt(point[key])+unit).join(' · ')+' · '+sourceLabel(point.source);}
const STATE={pass:['두께 적합','#087d70'],fail:['두께 부적합','#cf5a42'],pending:['두께 판정 대기','#8190a3']};
const OM_STATE={pass:['OM 기준 충족','#087d70'],fail:['OM 기준 초과','#cf5a42'],pending:['OM 검토 대기','#8190a3']};
function graphHTML(model,rule){
 const {preset,points}=model,isOM=preset.kind==='om',states=isOM?OM_STATE:STATE;
 if(!points.length)return '<div class="hfo-trends-empty">그래프에 표시할 '+(isOM?'OM 분석 결과':'두께 데이터')+'가 없습니다.<br>'+(isOM?'OM 이미지를 연결·분석하고 코팅 횟수를 확인하세요. 같은 이미지를 서로 다른 공정조건에 연결하면 제외됩니다.':'자료를 등록·분석하고 공정조건과 두께 값을 확인하세요.')+'</div>';
 const single=preset.y!=='mean',limitValue=preset.y==='cv'?rule.cvLimit:number(model.omPolicy?.[preset.y==='areaPercent'?'areaLimit':'particleDensityLimit']),limit=single?(limitValue===null?[]:[limitValue]):[rule.target-rule.tolerance,rule.target+rule.tolerance];
 const xd=domain(points.map(p=>p.x)),yd=domain([...points.map(p=>p.y),...limit],{zero:true});
 const l=68,r=728,t=36,b=270,px=v=>l+(v-xd[0])/(xd[1]-xd[0])*(r-l),py=v=>b-(v-yd[0])/(yd[1]-yd[0])*(b-t);
 const tickValues=Array.from({length:5},(_,i)=>yd[0]+(yd[1]-yd[0])*i/4);
 const xs=[...new Set(points.map(p=>p.x))],xticks=xs.length<=7?xs:Array.from({length:6},(_,i)=>xd[0]+(xd[1]-xd[0])*i/5);
 let svg='<svg class="hfo-trends-svg" viewBox="0 0 760 325" role="group" aria-label="'+esc(preset.label)+' 산점도"><title>'+esc(preset.label)+' · 점 1개는 '+(isOM?'OM 이미지':'시편')+' 1개</title><desc>색은 '+(isOM?'얼룩 의심 면적과 검출 영역 밀도 및 검토 상태를 반영한 OM 판정':'평균 두께와 CV를 함께 적용한 두께 판정')+'입니다. 동일 좌표의 점은 겹칠 수 있으며 아래 데이터 표에서 모두 확인할 수 있습니다.</desc>';
 if(!single){const yHigh=py(limit[1]),yLow=py(Math.max(0,limit[0]));svg+='<rect class="hfo-trends-band" x="'+l+'" y="'+yHigh+'" width="'+(r-l)+'" height="'+Math.max(0,yLow-yHigh)+'" fill="#e5f5ee"/><text x="'+(r-5)+'" y="'+(yHigh+14)+'" text-anchor="end" fill="#367a5c" font-size="11">평균 기준 '+esc(fmt(limit[0]))+'–'+esc(fmt(limit[1]))+' nm</text>';}
 for(const y of tickValues)svg+='<line x1="'+l+'" x2="'+r+'" y1="'+py(y)+'" y2="'+py(y)+'" stroke="#e7edf2"/><text x="'+(l-12)+'" y="'+(py(y)+4)+'" text-anchor="end" fill="#63758a" font-size="11">'+fmt(y,2)+'</text>';
 if(single&&limitValue!==null)svg+='<line class="hfo-trends-limit" x1="'+l+'" x2="'+r+'" y1="'+py(limitValue)+'" y2="'+py(limitValue)+'" stroke="#9b7240" stroke-dasharray="6 4"/><text x="'+(r-5)+'" y="'+(py(limitValue)-7)+'" text-anchor="end" fill="#8d6634" font-size="11">'+(preset.y==='cv'?'CV':preset.y==='areaPercent'?'얼룩 의심 면적':'검출 밀도')+' 상한 '+esc(fmt(limitValue))+(preset.y==='particleDensityPer10k'?'개/1만 픽셀':'%')+'</text>';
 svg+='<line x1="'+l+'" x2="'+r+'" y1="'+b+'" y2="'+b+'" stroke="#adbcca"/>';
 for(const x of xticks)svg+='<line x1="'+px(x)+'" x2="'+px(x)+'" y1="'+b+'" y2="'+(b+5)+'" stroke="#adbcca"/><text x="'+px(x)+'" y="'+(b+20)+'" text-anchor="middle" fill="#63758a" font-size="11">'+fmt(x,3)+'</text>';
 for(const point of points){const title=pointDescription(point)+' · '+states[point.state][0];svg+='<g tabindex="0" role="button" data-trend-point="'+esc(point.id)+'" aria-label="'+esc(title)+'"><title>'+esc(title)+'</title><circle cx="'+px(point.x)+'" cy="'+py(point.y)+'" r="6" fill="'+states[point.state][1]+'" fill-opacity=".8" stroke="#fff" stroke-width="2"/></g>';}
 return svg+'<text x="398" y="316" text-anchor="middle" fill="#405970" font-size="12">'+esc(preset.xLabel)+'</text><text x="'+l+'" y="19" fill="#405970" font-size="12">'+esc(preset.yLabel)+'</text></svg>';
}
const api={FIELDS,PRESETS,getPreset,buildPoints,buildOpticalData,groupPoints,choosePreset,buildModel,domain,graphHTML,fixedDescription,pointDescription};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.Hfo2ConditionTrends=api;
if(!root.document||!root.Hfo2Bridge)return;
const document=root.document,B=root.Hfo2Bridge,anchor=document.querySelector('#page-compare > .app-page-title');if(!anchor)return;
const style=document.createElement('style');style.textContent=`
.hfo-trends{margin-bottom:18px}.hfo-trends h3{margin:0;font-size:16px;color:#254259}.hfo-trends-intro{margin:7px 0 17px;color:#6c7e90;font-size:12px;line-height:1.7}.hfo-trends-controls{display:grid;grid-template-columns:minmax(180px,.8fr) minmax(240px,1.2fr);gap:14px}.hfo-trends-controls label{display:flex;flex-direction:column;gap:7px;color:#52677c;font-size:12px;font-weight:650}.hfo-trends-controls select{min-width:0;width:100%;border:1px solid #d6e0e8;padding:10px;border-radius:7px;background:white;color:#213d52;font:inherit}.hfo-trends-note{padding:11px 13px;background:#f3f7fa;border-radius:8px;margin:13px 0;font-size:12px;line-height:1.7;color:#5b7084;overflow-wrap:anywhere}.hfo-trends-note strong{color:#285d63;display:block}.hfo-trends-svg{width:100%;height:auto;max-height:340px;display:block;min-height:200px}.hfo-trends-svg g[role=button]{cursor:pointer;outline:none}.hfo-trends-svg g[role=button]:focus circle,.hfo-trends-svg g[aria-pressed=true] circle{stroke:#172f47;stroke-width:3}.hfo-trends-legend{display:flex;flex-wrap:wrap;gap:15px;font-size:11px;color:#64798b;margin:6px 0 12px}.hfo-trends-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}.hfo-trends-detail{min-height:34px;padding:11px 13px;border:1px solid #e2eaf0;border-radius:8px;font-size:12px;line-height:1.7;color:#5b7084;overflow-wrap:anywhere}.hfo-trends-detail strong{color:#244c60}.hfo-trends-empty{padding:48px 15px;text-align:center;color:#78899a;font-size:13px;line-height:1.8}.hfo-trends-data{margin-top:14px;font-size:12px}.hfo-trends-data summary{cursor:pointer;color:#4f687e;font-weight:650}.hfo-trends-data table{width:100%;border-collapse:collapse;margin-top:10px;white-space:nowrap}.hfo-trends-data th,.hfo-trends-data td{text-align:left;padding:10px 9px;border-bottom:1px solid #e8edf3;font-size:12px}.hfo-trends-data th{font-size:11px;color:#708398}.hfo-trends-data button{padding:3px 0;background:none;border:0;color:#156c79;text-decoration:underline;text-underline-offset:3px;font:inherit;cursor:pointer}.hfo-trends-small{font-size:11px;color:#78899a;line-height:1.7;margin:11px 0 0}.hfo-trends-badge{font-size:11px;font-weight:650}.hfo-trends-badge.pass{color:#087d70}.hfo-trends-badge.fail{color:#ba4a35}.hfo-trends-badge.pending{color:#6d7c8c}@media(max-width:640px){.hfo-trends-controls{grid-template-columns:1fr}.hfo-trends-svg{min-height:0}.hfo-trends{padding:15px!important}}
`;document.head.appendChild(style);
const card=document.createElement('section');card.id='hfoConditionTrends';card.className='app-card hfo-trends';anchor.insertAdjacentElement('afterend',card);
let presetId=null,groupKey=null,manualPreset=false,manualGroup=false,selectedId=null,currentModel=null;
function selectPoint(id){
 const point=currentModel?.points.find(p=>p.id===id);if(!point)return;
 selectedId=id;const detail=document.getElementById('hfoTrendDetail');
 detail.innerHTML='<strong>'+esc(point.id)+' · '+(point.kind==='om'?OM_STATE:STATE)[point.state][0]+'</strong><br>'+esc(pointDescription(point).replace(point.id+' · ',''));
 for(const node of card.querySelectorAll('g[data-trend-point]'))node.setAttribute('aria-pressed',String(node.dataset.trendPoint===id));
}
function render(){
 let rule;try{rule=B.getRule();}catch(_){rule=null;}
 const samples=B.getSamples();if(!manualPreset)presetId=choosePreset();
 const surface=root.Hfo2Surface,context={images:B.listImages(),results:surface?.getResults?.()||[],policy:surface?.getPolicy?.()||null};
 const model=buildModel(samples,presetId,rule,manualGroup?groupKey:null,context);currentModel=model;groupKey=model.groupKey;
 const {preset,points,groups}=model,isOM=preset.kind==='om',states=isOM?OM_STATE:STATE,unit=isOM?'이미지':'시편',focusId=document.activeElement?.id;
 const groupOptions='<option value="all">전체 '+unit+' · 탐색</option>'+groups.map((g,i)=>'<option value="'+esc(g.key)+'">그룹 '+(i+1)+' · '+g.points.length+unit+' / '+g.levels+'조건 · '+esc(sourceLabel(g.source))+(g.complete?'':' · 정보 미입력')+'</option>').join('');
 const range=points.length?fmt(Math.min(...points.map(p=>p.y)),isOM?4:2)+'–'+fmt(Math.max(...points.map(p=>p.y)),isOM?4:2)+(preset.unit||(preset.y==='cv'?'%':' nm')):'—';
 let message=model.controlled?(isOM?'선택한 축 외의 공정조건·자료 출처·배율·해상도·ROI·검출 설정이 같은 비교군입니다.':'선택한 축 외의 공정조건과 자료 출처가 같은 비교군입니다.'):model.group?'선택한 축의 조건이 1종이거나 비교 조건 정보가 부족합니다.':'다른 공정조건'+(isOM?' 또는 촬영·검출 설정':'')+'이 함께 달라질 수 있으므로 코팅 횟수 등 한 변수의 영향으로 단정할 수 없습니다.';
 if(model.levels===1)message+=' '+preset.xLabel+' 값이 1종이어서 변화 경향은 아직 비교할 수 없습니다.';
 if(!isOM&&!validRule(rule))message='두께 판정 기준을 확인한 뒤 그래프를 표시합니다.';
 const rows=points.map(p=>'<tr><td><button type="button" data-trend-point="'+esc(p.id)+'">'+esc(p.id)+'</button><br><span class="hfo-trends-small">'+esc(sourceLabel(p.source))+(isOM&&p.sampleIds.length>1?' · 연결 '+p.sampleIds.length+'시편':'')+'</span></td><td>'+fmt(p.x,3)+'</td>'+(isOM?'<td>'+fmt(p.areaPercent,4)+'</td><td>'+fmt(p.particleDensityPer10k,4)+'</td><td>'+p.correctionCount+'곳</td>':'<td>'+fmt(p.mean)+'</td><td>'+fmt(p.cv)+'</td><td>'+p.n+'</td>')+'<td><span class="hfo-trends-badge '+p.state+'">'+states[p.state][0]+'</span></td></tr>').join('');
 const metricHeader=isOM?'<th>큰 영역 (%)</th><th>검출 밀도 (개/1만 픽셀)</th><th>사용자 수정</th><th>OM 판정</th>':'<th>평균 (nm)</th><th>CV (%)</th><th>측정 위치</th><th>두께 판정</th>';
 const measureNote=isOM?'점 1개 = 서로 다른 OM 이미지 1장 · 사용자 수정이 반영된 면적률·밀도<br>동일 이미지의 중복 연결은 1점으로 표시합니다. 같은 배율·조명 사진끼리 해석하고, OM 지표를 실제 파티클 또는 젖음성 원인으로 확정하지 마세요.':'점 1개 = 시편 1개 · CV가 낮을수록 입력 위치의 두께 편차가 작습니다.<br>CV = 시편 내 위치별 표본 표준편차 ÷ 평균 두께 × 100';
 const excludedNote=(model.excluded?'<br>'+ (isOM?'OM 결과·공정조건 부족, 재분석 필요 또는 연결 충돌':'두께·공정조건 부족 또는 입력 오류')+'로 제외: '+model.excluded+'시편':'')+(model.ambiguousImages.length?'<br>서로 다른 조건에 연결된 동일 이미지 제외: '+esc(model.ambiguousImages.join(', ')):'')+(model.duplicateCollapsed?'<br>동일 이미지·동일 조건의 중복 연결 '+model.duplicateCollapsed+'건을 1점으로 통합':'');
 card.innerHTML='<h3>공정조건별 경향</h3><p class="hfo-trends-intro">코팅 횟수에 따른 두께 균일도·표면 상태 비교</p><div class="hfo-trends-controls"><label for="hfoTrendPreset">그래프<select id="hfoTrendPreset">'+PRESETS.map(p=>'<option value="'+p.id+'">'+p.label+'</option>').join('')+'</select></label><label for="hfoTrendGroup">비교 범위<select id="hfoTrendGroup">'+groupOptions+'</select></label></div><div class="hfo-trends-note"><strong>'+points.length+unit+' · '+model.levels+'조건 · 관측 범위 '+range+'</strong>'+esc(fixedDescription(model.group,preset))+'<br>'+esc(message)+'</div>'+graphHTML(model,rule)+'<div class="hfo-trends-legend">'+Object.entries(states).map(([,state])=>'<span><i style="background:'+state[1]+'"></i>'+state[0]+'</span>').join('')+'</div><div id="hfoTrendDetail" class="hfo-trends-detail" role="status">점 또는 아래 Sample ID를 선택하면 공정조건을 확인할 수 있습니다.</div><details class="hfo-trends-data"><summary>그래프 데이터 · '+points.length+unit+'</summary><div class="table-wrap"><table><thead><tr><th>Sample ID / 출처</th><th>'+esc(preset.xLabel)+'</th>'+metricHeader+'</tr></thead><tbody>'+rows+'</tbody></table></div></details><p class="hfo-trends-small">'+measureNote+'<br>동일 좌표의 점은 겹칠 수 있습니다. 점 사이를 연결하거나 최적 조건을 자동 확정하지 않습니다.'+excludedNote+'</p>';
 document.getElementById('hfoTrendPreset').value=preset.id;document.getElementById('hfoTrendGroup').value=groupKey;
 if(selectedId)selectPoint(selectedId);
 if(focusId==='hfoTrendPreset'||focusId==='hfoTrendGroup')document.getElementById(focusId)?.focus({preventScroll:true});
}
card.addEventListener('change',event=>{if(event.target.id==='hfoTrendPreset'){presetId=event.target.value;manualPreset=true;manualGroup=false;groupKey=null;selectedId=null;render();}else if(event.target.id==='hfoTrendGroup'){groupKey=event.target.value;manualGroup=true;selectedId=null;render();}});
card.addEventListener('click',event=>{const target=event.target.closest('[data-trend-point]');if(target)selectPoint(target.dataset.trendPoint);});
card.addEventListener('keydown',event=>{const target=event.target.closest('g[data-trend-point]');if(target&&(event.key==='Enter'||event.key===' ')){event.preventDefault();selectPoint(target.dataset.trendPoint);}});
for(const event of ['wf-rendered','intake-changed','surface-reviewed','hfo2-navigate','hfo2-images-cleared'])document.addEventListener(event,render);
api.render=render;render();
})(typeof window==='undefined'?globalThis:window);
