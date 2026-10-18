import {test} from 'node:test';
import assert from 'node:assert/strict';
import {actionResult,repeatedDinners} from '../lib/agent-progress';
import type {AgentRun} from '../lib/agent-types';
import {recipes} from '../lib/recipes';
test('progress never describes an incomplete basket as fully priced',()=>{
 const run={preferences:{budgetCents:10000},candidate:{totalCents:2500}} as AgentRun;
 assert.match(actionResult('build_basket',run,{},false),/still need a matching price/);
 run.candidate!.simulationQuote={totalCents:2500} as any;
 assert.match(actionResult('build_basket',run,{},false),/within your \$100.00 cap/);
 run.candidate!.totalCents=11000;
 assert.match(actionResult('build_basket',run,{},false),/exceeds your \$100.00 cap/);
 assert.doesNotMatch(actionResult('build_basket',run,{error:'private upstream error'},true),/private upstream error|Every ingredient/);
});
test('different IDs or tracking URLs cannot disguise duplicate dinners',()=>{
 const first=recipes[0];
 assert.equal(repeatedDinners([first,{...first,id:'other',title:'Different title',source:first.source+'?tracking=1'}]).length,1);
 assert.equal(repeatedDinners([first,{...first,id:'other',title:first.title.toUpperCase(),source:'https://another.example/recipe'}]).length,1);
 assert.equal(repeatedDinners([first,{...first,id:'other',title:'A different dinner',source:'https://another.example/recipe'}]).length,0);
});
