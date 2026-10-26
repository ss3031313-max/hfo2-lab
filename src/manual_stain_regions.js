/* User-marked missed stains: pixel-centre polygon union, not a particle classifier. */
(function(root){
'use strict';
const LIMITS=Object.freeze({maxPixels:20000000,maxRegions:100,maxVertices:200,maxRasterWork:250000000});
const MANUAL_LABEL=6,EPS=1e-9;
function geometry(input){
 const {width,height}=input||{},b=input?.roiBounds;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>LIMITS.maxPixels)throw new Error('이미지는 2,000만 픽셀 이하이어야 합니다.');
 if(!b||!['x0','y0','x1','y1'].every(k=>Number.isInteger(b[k]))||b.x0<0||b.y0<0||b.x1>width||b.y1>height||b.x0>=b.x1||b.y0>=b.y1)throw new Error('추가 영역의 분석 범위를 확인하세요.');
 const rw=b.x1-b.x0,rh=b.y1-b.y0;
 return {width,height,roiBounds:{...b},rw,rh,n:rw*rh};
}
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const same=(a,b)=>a.x===b.x&&a.y===b.y;
function onSegment(a,b,p){return Math.abs(cross(a,b,p))<=EPS&&p.x>=Math.min(a.x,b.x)-EPS&&p.x<=Math.max(a.x,b.x)+EPS&&p.y>=Math.min(a.y,b.y)-EPS&&p.y<=Math.max(a.y,b.y)+EPS;}
function intersects(a,b,c,d){const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);return (abC>EPS&&abD< -EPS||abC< -EPS&&abD>EPS)&&(cdA>EPS&&cdB< -EPS||cdA< -EPS&&cdB>EPS)||onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b);}
function normalizePolygon(points,input){
 const {roiBounds:b}=geometry(input);
 if(!Array.isArray(points)||points.length<3||points.length>LIMITS.maxVertices)throw new Error('얼룩 윤곽은 3~200개의 점으로 지정하세요.');
 const out=points.map(p=>{if(typeof p?.x!=='number'||typeof p?.y!=='number'||!Number.isFinite(p.x)||!Number.isFinite(p.y))throw new Error('추가 영역 좌표가 올바르지 않습니다.');if(p.x<b.x0||p.y<b.y0||p.x>b.x1||p.y>b.y1)throw new Error('추가 영역은 청록색 분석 영역 안에 지정하세요.');return {x:p.x,y:p.y};});
 if(same(out[0],out[out.length-1]))out.pop();
 if(out.length<3)throw new Error('얼룩 윤곽에는 서로 다른 점이 3개 이상 필요합니다.');
 let area=0;
 for(let i=0;i<out.length;i++){const next=(i+1)%out.length;if(same(out[i],out[next]))throw new Error('연속된 윤곽 점이 중복되었습니다.');area+=out[i].x*out[next].y-out[next].x*out[i].y;for(let j=i+1;j<out.length;j++){const end=(j+1)%out.length;if(j===next||end===i)continue;if(intersects(out[i],out[next],out[j],out[end]))throw new Error('얼룩 윤곽선이 서로 교차합니다. 점을 순서대로 다시 지정하세요.');}}
 if(Math.abs(area)<=EPS)throw new Error('얼룩 윤곽이 면적을 이루지 않습니다.');
 return out;
}
function normalizeRegions(regions,input){
 geometry(input);
 if(!Array.isArray(regions)||regions.length>LIMITS.maxRegions)throw new Error('추가 얼룩 영역은 이미지당 100개 이하여야 합니다.');
 const ids=new Set();let work=0;
 return regions.map(region=>{
  const id=typeof region?.id==='string'?region.id.trim():'';
  if(!id||id.length>80||ids.has(id))throw new Error('추가 영역 식별값이 없거나 중복되었습니다.');ids.add(id);
  const points=normalizePolygon(region.points,input),xs=points.map(p=>p.x),ys=points.map(p=>p.y),w=Math.ceil(Math.max(...xs))-Math.floor(Math.min(...xs)),h=Math.ceil(Math.max(...ys))-Math.floor(Math.min(...ys));work+=h*(points.length+w);
  if(work>LIMITS.maxRasterWork)throw new Error('추가 영역이 너무 복잡합니다. 영역 수나 꼭짓점을 줄여주세요.');
  if(region.note!==undefined&&typeof region.note!=='string')throw new Error('검토 메모 형식이 올바르지 않습니다.');
  const note=(region.note||'').trim();if(note.length>300)throw new Error('검토 메모는 300자 이하여야 합니다.');
  const createdAt=region.createdAt??null;if(createdAt!==null&&(typeof createdAt!=='string'||!Number.isFinite(Date.parse(createdAt))))throw new Error('추가 영역 기록 시각을 확인하세요.');
  return {id,points,note,createdAt};
 });
}
function rasterizeRegions({width,height,roiBounds,regions=[]}){
 const g=geometry({width,height,roiBounds}),normalized=normalizeRegions(regions,g),mask=new Uint8Array(g.n),regionPixelCounts=[];
 for(const region of normalized){
  const points=region.points,minY=Math.max(g.roiBounds.y0,Math.floor(Math.min(...points.map(p=>p.y)))),maxY=Math.min(g.roiBounds.y1,Math.ceil(Math.max(...points.map(p=>p.y))));let pixels=0;
  for(let y=minY;y<maxY;y++){
   const cy=y+.5,cuts=[];
   for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if((a.y>cy)!==(b.y>cy))cuts.push(a.x+(cy-a.y)/(b.y-a.y)*(b.x-a.x));}
   cuts.sort((a,b)=>a-b);
   for(let i=0;i+1<cuts.length;i+=2){const x0=Math.max(g.roiBounds.x0,Math.ceil(cuts[i]-.5)),x1=Math.min(g.roiBounds.x1,Math.ceil(cuts[i+1]-.5));if(x1<=x0)continue;pixels+=x1-x0;const offset=(y-g.roiBounds.y0)*g.rw;mask.fill(1,offset+x0-g.roiBounds.x0,offset+x1-g.roiBounds.x0);}
  }
  if(!pixels)throw new Error('추가 영역이 1픽셀보다 작습니다. 윤곽을 다시 지정하세요.');
  regionPixelCounts.push({id:region.id,pixelCount:pixels});
 }
 let pixelCount=0;for(const value of mask)pixelCount+=value;
 return {regions:normalized,mask,pixelCount,regionPixelCounts};
}
function applyRegions({result,mask,regions=[],largeMask}){
 const g=geometry(result);
 if(result.roiPixelCount!==g.n||!mask||mask.length!==g.n||largeMask&&largeMask.length!==g.n)throw new Error('추가 영역을 적용할 분석 결과를 다시 확인하세요.');
 const originalArea=new Uint8Array(g.n),displayMask=new Uint8Array(g.n);let basePixels=0;
 for(let i=0;i<g.n;i++){
  if(!Number.isInteger(mask[i])||mask[i]<0||mask[i]>4)throw new Error('원본 검출 표시가 올바르지 않습니다. 수동 영역을 원본 결과에 다시 적용하세요.');
  if(largeMask&&largeMask[i]!==0&&largeMask[i]!==1)throw new Error('얼룩 면적 표시가 올바르지 않습니다.');
  const isLarge=largeMask?largeMask[i]:Number(mask[i]===1);originalArea[i]=isLarge;basePixels+=isLarge;displayMask[i]=mask[i];
 }
 if(result.retainedPixelCount!==basePixels)throw new Error('얼룩 면적 수치와 표시가 일치하지 않습니다. 다시 분석하세요.');
 const manual=rasterizeRegions({...g,regions}),areaMask=new Uint8Array(originalArea);let added=0;
 for(let i=0;i<g.n;i++)if(manual.mask[i]&&!originalArea[i]){areaMask[i]=1;displayMask[i]=MANUAL_LABEL;added++;}
 const adjusted={...result,areaPercent:(basePixels+added)/g.n*100,retainedPixelCount:basePixels+added,manualStainRegions:manual.regions,manualRegionCount:manual.regions.length,manualStainPixelCount:manual.pixelCount,manualAddedPixelCount:added};
 return {result:adjusted,displayMask,areaMask,manualMask:manual.mask,regionPixelCounts:manual.regionPixelCounts};
}
const api={LIMITS,MANUAL_LABEL,normalizePolygon,normalizeRegions,rasterizeRegions,applyRegions};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.Hfo2ManualStains=api;
})(typeof globalThis!=='undefined'?globalThis:this);
