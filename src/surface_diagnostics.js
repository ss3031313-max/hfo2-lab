/* Threshold sensitivity uses the same image, reference and area settings.
 * It is a review aid, not a calibrated defect classifier. */
(function(root){
 'use strict';
 const VERSION=1;
 function value(v,name){if(typeof v!=='number'||!Number.isFinite(v))throw new Error(name+' 값이 올바르지 않습니다.');return v;}
 function summarize(r,threshold){
  const areaPercent=value(r?.areaPercent,'면적률'),particleDensityPer10k=value(r?.particleDensityPer10k,'밀도');
  if(areaPercent<0||areaPercent>100||particleDensityPer10k<0)throw new Error('민감도 결과 범위 오류');
  return {threshold,areaPercent,particleDensityPer10k};
 }
 function analyze({analyzePixels,pixels,roi,reference,policy,result}){
  if(typeof analyzePixels!=='function')throw new Error('영상 분석 함수가 필요합니다.');
  const threshold=value(policy?.threshold,'차이 기준');
  if(threshold<0||threshold>100)throw new Error('차이 기준은 0~100%입니다.');
  if(!result||result.threshold!==threshold||result.minArea!==policy.minArea||result.particleMinArea!==policy.particleMinArea)throw new Error('동일 검출 설정의 분석 결과가 필요합니다.');
  const total=value(pixels?.width,'이미지 너비')*value(pixels?.height,'이미지 높이'),count=value(result.roiPixelCount,'분석 픽셀');
  if(total<=0||count<=0||count>total)throw new Error('분석 영역 크기 오류');
  const thresholds=[...new Set([Math.max(0,threshold*.8),threshold,Math.min(100,threshold*1.2)].map(t=>Number(t.toFixed(8))))].sort((a,b)=>a-b);
  // Keep the exact current value rather than rounding a user-entered threshold.
  const currentIndex=thresholds.findIndex(t=>Math.abs(t-threshold)<1e-8);if(currentIndex>=0)thresholds[currentIndex]=threshold;
  return {version:VERSION,method:'FIXED_REFERENCE_THRESHOLD_PLUS_MINUS_20_PERCENT',currentThreshold:threshold,roiCoveragePercent:count/total*100,thresholds:thresholds.map(t=>summarize(t===threshold?result:analyzePixels({...pixels,roi,reference,threshold:t,minArea:policy.minArea,particleMinArea:policy.particleMinArea}),t))};
 }
 function assess(diagnostics,policy){
  if(!diagnostics||diagnostics.version!==VERSION||!Array.isArray(diagnostics.thresholds)||!diagnostics.thresholds.length)return {available:false,changed:false,points:[],reason:'민감도 확인 전'};
  const areaLimit=value(policy?.areaLimit,'면적 상한'),densityLimit=value(policy?.particleDensityLimit,'밀도 상한');
  if(areaLimit<0||areaLimit>100||densityLimit<0)throw new Error('판정 상한 범위 오류');
  const points=diagnostics.thresholds.map(p=>({...summarize(p,value(p.threshold,'차이 기준')),state:p.areaPercent>areaLimit||p.particleDensityPer10k>densityLimit?'fail':'pass',current:p.threshold===diagnostics.currentThreshold}));
  const current=points.find(p=>p.current);if(!current)return {available:false,changed:false,points:[],reason:'현재 설정과 민감도 결과 불일치'};
  const changed=points.some(p=>p.state!==current.state);
  return {available:true,changed,points,reason:changed?'차이 기준 ±20%에서 수치 판정 변경 · 원본 대조 필요':'비교한 차이 기준 범위에서 수치 판정 동일'};
 }
 const api={VERSION,analyze,assess};root.Hfo2SurfaceDiagnostics=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
