import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source=fs.readFileSync(path.join(root,'src/intake.js'),'utf8');
function setup(){
 const buttons=['register','analyze','om','screen','compare'].map(step=>({dataset:{intakeStep:step},attributes:{},setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];}}));
 const filter={checked:false},calls=[],listeners={};
 const context=vm.createContext({activePage:'intake',$:id=>{assert.equal(id,'wfOnlyReview');return filter;},B:{navigate:page=>calls.push(['navigate',page]),refresh:()=>calls.push(['refresh']),selectSample:()=>{throw new Error('navigation must not replace sample selection');},selectImage:()=>{throw new Error('navigation must not replace image selection');},clearSamples:()=>{throw new Error('navigation must not clear analysis');},applyCSVs:()=>{throw new Error('navigation must not apply a new batch');}},I:{runAnalysis:()=>{throw new Error('navigation must not analyze a pending batch');},setQueue:()=>{throw new Error('navigation must not replace a pending batch');}},document:{querySelectorAll:()=>buttons,querySelector:()=>({addEventListener:(name,handler)=>listeners[name]=handler})}});
 vm.runInContext(source.slice(source.indexOf('function syncStep('),source.indexOf("document.addEventListener('hfo2-navigate'")),context);
 return {context,buttons,filter,calls,listeners,active:()=>buttons.filter(b=>b.attributes['aria-current']==='step').map(b=>b.dataset.intakeStep),click:step=>listeners.click({target:{closest:()=>step?buttons.find(b=>b.dataset.intakeStep===step)||{dataset:{intakeStep:step}}:null}})};
}
test('five distinct workflow destinations retain the compare interception key',()=>{
 const nav=source.match(/<nav class="intake-steps"[\s\S]*?<\/nav>/)[0];
 assert.deepEqual([...nav.matchAll(/data-intake-step="([^"]+)"/g)].map(m=>m[1]),['register','analyze','om','screen','compare']);
 for(const label of ['01 등록','02 두께 분석','03 OM 분석','04 선별','05 비교'])assert.ok(nav.includes(label));
});
test('OM and thickness pages have separate active steps, including empty and saved page navigation',()=>{
 const t=setup();for(const [page,active] of [['intake','register'],['data','register'],['samples','analyze'],['om','om'],['compare','compare']]){t.context.syncStep(page);assert.deepEqual(t.active(),[active]);}
 t.filter.checked=true;t.context.syncStep('samples');assert.deepEqual(t.active(),['screen']);
 t.context.syncStep('om');t.context.syncStep();assert.deepEqual(t.active(),['om']);
});
test('OM step only navigates and preserves selected sample, image, pending batch and thickness filter',()=>{
 const t=setup();t.filter.checked=true;t.click('om');assert.deepEqual(t.calls,[['navigate','om']]);assert.deepEqual(t.active(),['om']);assert.equal(t.filter.checked,true);
});
test('thickness step clears the screening filter and refreshes existing analysis',()=>{
 const t=setup();t.filter.checked=true;t.click('analyze');assert.equal(t.filter.checked,false);assert.deepEqual(t.calls,[['navigate','samples'],['refresh']]);assert.deepEqual(t.active(),['analyze']);
});
test('screen step activates the existing filter, while returning to thickness removes it',()=>{
 const t=setup();t.click('screen');assert.equal(t.filter.checked,true);assert.deepEqual(t.active(),['screen']);t.click('analyze');assert.equal(t.filter.checked,false);assert.deepEqual(t.active(),['analyze']);
});
test('registration and comparison use existing destinations without implicit analysis',()=>{
 const t=setup();t.click('register');t.click('compare');assert.deepEqual(t.calls,[['navigate','intake'],['navigate','compare']]);assert.deepEqual(t.active(),['compare']);
});
test('non-button clicks and unknown step keys do not navigate or change the filter',()=>{
 const t=setup();t.filter.checked=true;t.click(null);t.click('invalid');assert.deepEqual(t.calls,[]);assert.equal(t.filter.checked,true);
});
