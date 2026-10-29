import {test} from 'node:test';
import assert from 'node:assert/strict';
import {personalizedQuestions} from '../server/assessments.js';
import {blueprintSchema} from '../server/assessment-studio.js';
test('quiz bank selection is stable, bounded and preserves the correct shuffled answer',()=>{
 const questions=Array.from({length:8},(_,i)=>({prompt:'Question '+i,options:['wrong','correct '+i],answer:1}));
 const selected=personalizedQuestions(questions,'student-a','activity-a',3);
 assert.equal(selected.length,3);assert.equal(new Set(selected.map(q=>q.prompt)).size,3);
 assert.deepEqual(selected,personalizedQuestions(questions,'student-a','activity-a',3));
 for(const q of selected)assert.equal(q.options[q.answer],'correct '+q.prompt.split(' ')[1]);
 const blueprint={kind:'quiz',title:'Sampled quiz',questionCount:3,questions,tasks:questions.map(q=>({title:q.prompt,instructions:'Choose one',criteria:'Correct answer',marks:2}))};
 assert.equal(blueprintSchema.safeParse(blueprint).success,true);
 assert.equal(blueprintSchema.safeParse({...blueprint,questionCount:9}).success,false);
 assert.equal(blueprintSchema.safeParse({...blueprint,tasks:blueprint.tasks.map((t,i)=>({...t,marks:i?2:3}))}).success,false);
});
