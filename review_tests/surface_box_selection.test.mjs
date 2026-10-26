// Box selection is an editing aid, not a physical particle classifier.
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../src/surface_review.js',import.meta.url),'utf8');
const context=vm.createContext({console});vm.runInContext(source,context);
const S=context.Hfo2Surface;
const full={left:0,top:0,right:100,bottom:100};
const policy={threshold:5,minArea:16,particleMinArea:2,areaLimit:5,particleDensityLimit:10};
function fixture({roi=full,draw}={}){
 const width=40,height=40,imageData=new Uint8ClampedArray(width*height*4);
 for(let i=0;i<imageData.length;i+=4){imageData[i]=imageData[i+1]=imageData[i+2]=150;imageData[i+3]=255;}
 const pixel=(x,y)=>{const at=(y*width+x)*4;imageData[at]=imageData[at+1]=imageData[at+2]=10;};
 const square=(x0,y0,size)=>{for(let y=y0;y<y0+size;y++)for(let x=x0;x<x0+size;x++)pixel(x,y);};
 if(draw)draw({pixel,square});else{square(12,12,4);square(25,25,2);}
 return S.analyzePixels({width,height,imageData,roi,reference:{left:25,top:0,right:40,bottom:10},...policy});
}
function box(r,x0,y0,x1,y1){return S.inspectComponentsInBox(r,r.mask,{x0,y0,x1,y1});}

test('one-pixel overlap selects a whole connected component',()=>{
 const r=fixture(),selected=box(r,15,15,16,16);
 assert.equal(selected.length,1);assert.equal(selected[0].pixelCount,16);
 assert.deepEqual({...selected[0].bounds},{x0:12,y0:12,x1:16,y1:16});
 assert.equal(selected[0].isLarge,true);assert.equal(selected[0].isCounted,true);
});

test('one box can select several distinct components once each',()=>{
 const r=fixture(),selected=box(r,11,11,28,28);
 assert.equal(selected.length,2);assert.deepEqual(Array.from(selected,c=>c.pixelCount).sort((a,b)=>a-b),[4,16]);
 assert.equal(new Set(Array.from(selected,c=>c.seed)).size,2);
 assert.equal(selected.filter(c=>c.isLarge).length,1);
});

test('empty pixels inside a component bounding box do not select it',()=>{
 const r=fixture({draw:({pixel})=>{for(let i=12;i<=20;i++){pixel(12,i);pixel(i,12);}}});
 assert.equal(box(r,16,16,19,19).length,0);
 assert.equal(box(r,12,18,13,19)[0].pixelCount,17);
});

test('box edges are half-open so touching without overlap selects nothing',()=>{
 const r=fixture();
 assert.equal(box(r,16,12,20,16).length,0);
 assert.equal(box(r,15,12,16,16).length,1);
 assert.equal(box(r,10,10,12,12).length,0);
});

test('coordinates refer to the original image despite an offset analysis ROI',()=>{
 const roi={left:25,top:0,right:100,bottom:100},r=fixture({roi});
 const selected=box(r,15,15,16,16);
 assert.equal(selected.length,1);assert.deepEqual({...selected[0].bounds},{x0:12,y0:12,x1:16,y1:16});
 assert.equal(box(r,0,0,9,40).length,0);
});

test('background and outside-image boxes return no components',()=>{
 const r=fixture();
 for(const coords of [[0,0,4,4],[41,41,50,50],[-5,-5,-1,-1]])assert.equal(box(r,...coords).length,0);
});

test('selection does not mutate the original mask or numeric measurements',()=>{
 const r=fixture(),beforeMask=new Uint8Array(r.mask),before=JSON.stringify({...r,mask:undefined});
 box(r,11,11,28,28);
 assert.deepEqual(Array.from(r.mask),Array.from(beforeMask));assert.equal(JSON.stringify({...r,mask:undefined}),before);
});

test('original mask still permits selecting an already excluded component',()=>{
 const r=fixture(),selected=box(r,11,11,28,28),corrections=Array.from(selected,c=>({...c,action:'EXCLUDE_ALL',reason:'ANNOTATION',note:''}));
 const adjusted=S.applyCorrections(r,r.mask,corrections);
 assert.equal(adjusted.result.particleCount,0);
 const restoredSelection=S.inspectComponentsInBox(adjusted.result,r.mask,{x0:11,y0:11,x1:28,y1:28});
 assert.deepEqual(Array.from(restoredSelection,c=>c.seed),Array.from(selected,c=>c.seed));
 assert.equal(restoredSelection.length,2);
});

