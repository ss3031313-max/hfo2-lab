// Independent finite fixtures for intake serialization and criterion presentation.
// Run from the project folder: node review_tests/intake_math.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const template=fs.readFileSync(path.join(root,'src/om_app.template.html'),'utf8');
const intake=fs.readFileSync(path.join(root,'src/intake.js'),'utf8');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/catalog.json'),'utf8'));
const context=vm.createContext({console,document:{},Hfo2Bridge:{listImages:()=>catalog}});
vm.runInContext('globalThis.window=globalThis',context);
for(const id of ['om-math','workflow-math']){
 const match=template.match(new RegExp('<script id="'+id+'">([\\s\\S]*?)</script>'));
 if(!match)throw new Error('Missing '+id);vm.runInContext(match[1],context);
}
const prefix=intake.slice(0,intake.indexOf('const css='));
const functions=['builtInSamples','grade','criterionLines'].map(name=>intake.split('\n').find(line=>line.startsWith('function '+name+'('))).join('\n');
vm.runInContext(prefix+'\n'+functions+'\nglobalThis.PureIntake={rowsFor,csvFor,validateBatch,builtInSamples,grade,criterionLines};})();',context);
const P=context.PureIntake,M=context.OMDemoMath,W=context.Hfo2WorkflowMath;
const rule={target:15,tolerance:2,cvLimit:10};let pass=0,fail=0;
function check(name,fn){try{if(!fn())throw new Error('assertion false');console.log('PASS '+name);pass++;}catch(e){console.log('FAIL '+name+' :: '+e.message);fail++;}}
function rejects(fn,rx){try{fn();return false;}catch(e){return rx.test(e.message);}}
const samples=P.builtInSamples(),joined=P.validateBatch(samples).samples;
check('built-in: 3 independently identified samples and 15 positions',()=>joined.length===3&&joined.reduce((n,s)=>n+s.points.length,0)===15);
check('built-in: 15 / 18 / 15 means',()=>joined.every((s,i)=>Math.abs(s.stats.mean-[15,18,15][i])<1e-9));
check('built-in: one eligible and two review cases',()=>joined.map(s=>P.grade(s,rule).overall).join(',')==='ok,review,review');
check('original source flags are retained',()=>joined.every(s=>s.data_source==='SYNTHETIC'&&s.id.startsWith('DEMO-')));
check('metadata numeric 550 C / 120 min preserved',()=>joined.every(s=>s.anneal_temp_C===550&&s.anneal_time_min===120));
check('CSV quotes and commas round-trip without ID mutation',()=>{const s={...samples[0],id:'DEMO-a,"b',points:[{position:'top, "left"',value:15},{position:'bottom',value:15.1}]};const r=P.validateBatch([s]).samples[0];return r.id===s.id&&r.points[0].position===s.points[0].position;});
check('empty batch creates no pretend samples',()=>P.validateBatch([]).samples.length===0);
check('empty saved CSV pair restores as an empty workspace',()=>{const c=P.csvFor([]),r=W.join(c.meta,c.thickness,[],true);return r.samples.length===0&&r.warnings.length===0;});
check('normal CSV import still rejects a header-only sample list',()=>{const c=P.csvFor([]);return rejects(()=>W.join(c.meta,c.thickness,[]),/Sample 행/);});
check('empty backup does not accept orphaned thickness rows',()=>{const empty=P.csvFor([]),full=P.csvFor(samples);return rejects(()=>W.join(empty.meta,full.thickness,[],true),/연결할 메타데이터/);});

check('zero positions remain unassessed and warn',()=>{const r=P.validateBatch([{...samples[0],points:[]}]);return r.samples[0].stats===null&&r.warnings.length>0&&P.grade(r.samples[0],rule).overall==='na';});
check('single position inside mean range: uniformity unavailable',()=>{const g=P.grade({stats:M.thickness([15])},rule);return g.mean==='ok'&&g.cv==='na'&&g.overall==='na';});
check('single position above mean limit is still detected',()=>{const g=P.grade({stats:M.thickness([18])},rule);return g.mean==='review'&&g.cv==='na'&&g.overall==='review';});
check('single position below mean limit is still detected',()=>P.grade({stats:M.thickness([12])},rule).overall==='review');
check('lower and upper mean boundaries are inclusive',()=>[13,17].every(v=>P.grade({stats:M.thickness([v,v])},rule).overall==='ok'));
check('CV 10 percent boundary is inclusive',()=>P.grade({stats:M.thickness([13.5,15,16.5])},rule).overall==='ok');
check('CV above boundary is flagged',()=>P.grade({stats:M.thickness([13.49,15,16.51])},rule).cv==='review');
check('input error cannot qualify as eligible',()=>P.grade({stats:M.thickness([15,15]),editError:'bad'},rule).overall==='invalid');
check('same-ID duplicate rejected',()=>rejects(()=>P.validateBatch([samples[0],samples[0]]),/중복/));
check('same-position duplicate case insensitive rejected',()=>rejects(()=>P.validateBatch([{...samples[0],points:[{position:'Top',value:15},{position:'top',value:16}]}]),/중복/));
check('thickness units inside value rejected',()=>rejects(()=>P.validateBatch([{...samples[0],points:[{position:'c',value:'15nm'}]}]),/thickness_nm/));
check('noninteger coating count rejected',()=>rejects(()=>P.validateBatch([{...samples[0],coats:1.5}]),/coats/));
check('real source cannot be silently applied to DEMO id',()=>rejects(()=>P.validateBatch([{...samples[0],data_source:'REAL_MEASUREMENT'}]),/DEMO-/));
check('unknown image rejected',()=>rejects(()=>P.validateBatch([{...samples[0],image_id:'OM-999'}]),/찾을 수 없습니다/));
check('source groups stay separate',()=>{const a=P.validateBatch([samples[0],{...samples[0],id:'REAL-001',data_source:'REAL_MEASUREMENT'}]).samples;return W.groups(a,rule).length===2;});
check('error text is escaped in criteria HTML',()=>{const h=P.criterionLines({editError:'<img src=x onerror=alert(1)>'},rule);return h.includes('&lt;img')&&!h.includes('<img');});
check('criteria shows actual mean and cutoff',()=>{const h=P.criterionLines(joined[1],rule);return h.includes('18.00')&&h.includes('17.0')&&h.includes('초과');});
console.log(`SUMMARY ${pass} pass / ${fail} fail`);if(fail)process.exitCode=1;
