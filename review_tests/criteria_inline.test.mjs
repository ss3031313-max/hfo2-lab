// Comparison criteria edit the authoritative rules together, preserving unapplied drafts.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const template=fs.readFileSync(path.join(root,'src/om_app.template.html'),'utf8');
const intake=fs.readFileSync(path.join(root,'src/intake.js'),'utf8');
function setup(){
 const elements=new Map(),events=[],calls=[],refreshes=[];
 const initial={target:15,tolerance:2,cvLimit:10,areaLimit:5,particleDensityLimit:100};
 for(const [id,value] of Object.entries({wfTarget:15,wfTolerance:2,wfCV:10,intakeCriteriaTarget:15,intakeCriteriaTolerance:2,intakeCriteriaCV:10,intakeCriteriaArea:5,intakeCriteriaDensity:100}))elements.set(id,{value:String(value)});
 elements.set('intakeCriteriaFeedback',{textContent:'',dataset:{}});
 const policy={threshold:5,minArea:16,particleMinArea:2,areaLimit:5,particleDensityLimit:100};
 const context=vm.createContext({console,document:{getElementById:id=>elements.get(id),dispatchEvent:event=>events.push(event.type)},CustomEvent:class{constructor(type){this.type=type;}},Hfo2Bridge:{refresh:()=>refreshes.push([...['wfTarget','wfTolerance','wfCV'].map(id=>elements.get(id).value),policy.areaLimit,policy.particleDensityLimit])},Hfo2WorkflowMath:{},Hfo2Surface:{applyJudgmentLimits:(limits,options)=>{calls.push({limits:{...limits},options:{...options}});Object.assign(policy,limits);}}});
 vm.runInContext('globalThis.window=globalThis',context);
 vm.runInContext(template.match(/<script id="om-math">([\s\S]*?)<\/script>/)[1],context);
 vm.runInContext(intake.slice(0,intake.indexOf('const css='))+'\nglobalThis.Editor={validateCriteria,criteriaEditorHTML,applyCriteria,captureCriteriaDraft,resetCriteriaDraft};})();',context);
 return {E:context.Editor,context,elements,events,calls,refreshes,policy,initial};
}
test('comparison fields load saved criteria including density 100 rather than defaults',()=>{
 const {E,initial,policy}=setup(),html=E.criteriaEditorHTML(initial,policy);
 assert.match(html,/평균 13\.0~17\.0 nm · 두께 CV ≤ 10\.0%/);
 assert.match(html,/검출 영역 밀도 ≤ 100\.0개\/1만 px/);
 assert.match(html,/id="intakeCriteriaDensity"[^>]*value="100"/);
 assert.equal((html.match(/data-criteria-field=/g)||[]).length,5);
});
test('all five criteria update together before refresh and emit one change signal',()=>{
 const {E,elements,events,calls,refreshes}=setup();
 E.applyCriteria({target:'16',tolerance:'1.5',cvLimit:'8',areaLimit:'4',particleDensityLimit:'80'});
 assert.deepEqual(calls,[{limits:{areaLimit:4,particleDensityLimit:80},options:{emit:false}}]);
 assert.deepEqual(refreshes,[['16','1.5','8',4,80]]);
 assert.deepEqual(events,['surface-reviewed']);
 assert.equal(elements.get('wfTarget').value,'16');
});
test('invalid criteria reject the whole edit without partially changing thickness or OM',()=>{
 const invalid=[{target:''},{target:'0'},{target:'Infinity'},{tolerance:'-1'},{cvLimit:'abc'},{cvLimit:'-1'},{areaLimit:''},{areaLimit:'101'},{areaLimit:'-1'},{particleDensityLimit:''},{particleDensityLimit:'-1'},{particleDensityLimit:'Infinity'}];
 for(const change of invalid){const {E,initial,elements,calls,events,refreshes}=setup();assert.throws(()=>E.applyCriteria({...initial,...change}),undefined,JSON.stringify(change));assert.equal(calls.length,0);assert.equal(events.length,0);assert.equal(refreshes.length,0);assert.deepEqual(['wfTarget','wfTolerance','wfCV'].map(id=>elements.get(id).value),['15','2','10']);}
});
test('an unavailable or busy OM editor prevents a partial thickness change',()=>{
 for(const surface of [{}, {applyJudgmentLimits:()=>{throw new Error('진행 중인 외관 분석');}}]){const {E,context,initial,elements,events}=setup();context.Hfo2Surface=surface;assert.throws(()=>E.applyCriteria({...initial,cvLimit:5}));assert.equal(elements.get('wfCV').value,'10');assert.deepEqual(events,[]);}
});
test('unapplied draft survives unrelated comparison rerenders while current summary stays applied',()=>{
 const {E,initial,policy,elements}=setup();E.criteriaEditorHTML(initial,policy);
 elements.get('intakeCriteriaDensity').value='75';elements.get('intakeCriteriaCV').value='8';E.captureCriteriaDraft();
 for(let n=0;n<3;n++){const html=E.criteriaEditorHTML(initial,policy);assert.match(html,/id="intakeCriteriaDensity"[^>]*value="75"/);assert.match(html,/id="intakeCriteriaCV"[^>]*value="8"/);assert.match(html,/검출 영역 밀도 ≤ 100\.0개\/1만 px/);assert.match(html,/변경 대기/);}
});
test('a rule changed in the original controls resynchronizes the comparison editor',()=>{
 const {E,initial,policy,elements}=setup();E.criteriaEditorHTML(initial,policy);elements.get('intakeCriteriaDensity').value='75';E.captureCriteriaDraft();
 const html=E.criteriaEditorHTML({...initial,cvLimit:9},{...policy,particleDensityLimit:50});
 assert.match(html,/id="intakeCriteriaDensity"[^>]*value="50"/);assert.match(html,/id="intakeCriteriaCV"[^>]*value="9"/);assert.doesNotMatch(html,/변경 대기/);
});
test('cancel discards draft without altering saved criteria',()=>{
 const {E,initial,policy,elements,calls}=setup();E.criteriaEditorHTML(initial,policy);elements.get('intakeCriteriaDensity').value='75';E.captureCriteriaDraft();E.resetCriteriaDraft();
 assert.match(E.criteriaEditorHTML(initial,policy),/id="intakeCriteriaDensity"[^>]*value="100"/);assert.equal(calls.length,0);
});
test('successful apply clears the draft and retains visible completion feedback',()=>{
 const {E,initial,policy,elements}=setup();E.criteriaEditorHTML(initial,policy);elements.get('intakeCriteriaDensity').value='75';E.captureCriteriaDraft();const next=E.applyCriteria({...initial,particleDensityLimit:75});
 const html=E.criteriaEditorHTML(next,policy);assert.match(html,/검출 영역 밀도 ≤ 75\.0개\/1만 px/);assert.match(html,/기준 적용 완료/);assert.doesNotMatch(html,/변경 대기/);
});
test('boundary zero and 100 percent limits are allowed by the same validation rules',()=>{
 const {E,initial}=setup();const result=E.validateCriteria({...initial,tolerance:0,cvLimit:0,areaLimit:100,particleDensityLimit:0});assert.equal(result.areaLimit,100);assert.equal(result.particleDensityLimit,0);assert.equal(result.cvLimit,0);
});
