// Comparison summary cards navigate without filtering or changing sample data.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source=fs.readFileSync(path.join(root,'src/intake.js'),'utf8');
function setup(states=['pass','pass','pending','fail'],reducedMotion=false){
 const focused=[],scrolled=[],status={textContent:''};
 const rows=states.map((state,index)=>({dataset:{combinedState:state},hidden:false,classes:new Set(),classList:{toggle(name,on){if(on)rows[index].classes.add(name);else rows[index].classes.delete(name);}},focus:options=>focused.push({index,...options}),scrollIntoView:options=>scrolled.push({index,...options})}));
 const buttons=['pass','pending','fail'].map(state=>({dataset:{comparisonJump:state},attributes:{},setAttribute(name,value){this.attributes[name]=value;}}));
 const context=vm.createContext({window:{matchMedia:()=>({matches:reducedMotion})},$:id=>{assert.equal(id,'intakeComparisonJumpStatus');return status;},candidates:{querySelectorAll:selector=>selector==='tr[data-combined-state]'?rows:buttons}});
 vm.runInContext(source.slice(source.indexOf('function combinedCounts('),source.indexOf('function thicknessCounts(')),context);
 return {context,rows,buttons,focused,scrolled,status};
}
test('comparison cards are native keyboard-operable buttons with disabled empty groups',()=>{
 const {context}=setup();
 const html=context.combinedCounts([{state:'pass'},{state:'pending'}],true);
 assert.equal((html.match(/<button type="button"/g)||[]).length,3);
 assert.equal((html.match(/aria-controls="intakeComparisonTable"/g)||[]).length,3);
 assert.match(html,/data-comparison-jump="fail"[^>]* disabled/);
 assert.match(html,/기준 충족 1시편 · 샘플별 비교로 이동/);
 assert.doesNotMatch(context.combinedCounts([{state:'pass'}]),/data-comparison-jump|<button/);
});
test('navigation highlights all matching rows and focuses the first while retaining every sample',()=>{
 const t=setup(),rowReferences=[...t.rows];
 assert.equal(t.context.jumpToComparisonState('pass'),true);
 assert.deepEqual(t.focused,[{index:0,preventScroll:true}]);
 assert.deepEqual(t.scrolled,[{index:0,behavior:'smooth',block:'center',inline:'nearest'}]);
 assert.deepEqual(t.rows.map(row=>row.classes.has('intake-comparison-match')),[true,true,false,false]);
 assert.deepEqual(t.rows.map(row=>row.classes.has('intake-comparison-target')),[true,false,false,false]);
 assert.deepEqual(t.rows,rowReferences);assert.ok(t.rows.every(row=>row.hidden===false));
 assert.equal(t.status.textContent,'기준 충족 2시편 강조 · 전체 4시편 표시');
});
test('another category moves to its row and clears the previous emphasis without reordering',()=>{
 const t=setup();t.context.jumpToComparisonState('pass');t.context.jumpToComparisonState('fail');
 assert.deepEqual(t.rows.map(row=>row.dataset.combinedState),['pass','pass','pending','fail']);
 assert.deepEqual(t.rows.map(row=>row.classes.has('intake-comparison-match')),[false,false,false,true]);
 assert.deepEqual(t.buttons.map(button=>button.attributes['aria-pressed']),['false','false','true']);
 assert.equal(t.focused.at(-1).index,3);assert.equal(t.scrolled.at(-1).index,3);
 assert.ok(t.rows.every(row=>!row.hidden));
});
test('missing and invalid categories never scroll to an unrelated row',()=>{
 const t=setup(['pending']);
 assert.equal(t.context.jumpToComparisonState('pass'),false);
 assert.match(t.status.textContent,/기준 충족 시편 없음 · 전체 1시편 표시/);
 assert.equal(t.context.jumpToComparisonState('__proto__'),false);
 assert.deepEqual(t.focused,[]);assert.deepEqual(t.scrolled,[]);assert.equal(t.rows.length,1);
});
test('reduced-motion preference uses immediate scrolling',()=>{
 const t=setup(['pending'],true);t.context.jumpToComparisonState('pending');
 assert.equal(t.scrolled[0].behavior,'auto');
});
