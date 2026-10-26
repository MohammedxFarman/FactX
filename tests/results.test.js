import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeResults} from '../src/lib/results.js';

test('results retain missing periods and weight marks and grade credits correctly',()=>{
  const result=summarizeResults([{semester:1,score:15,max_marks:20},{semester:1,score:60,max_marks:100},{semester:3,score:0,max_marks:30}], [{semester:1,grade_points:8,credits:3},{semester:1,grade_points:6,credits:1},{semester:8,grade_points:9,credits:2}]);
  assert.equal(result.total,75);assert.equal(result.maximum,150);assert.equal(result.percentage,50);
  assert.equal(result.gpa,8);assert.deepEqual(result.semesters.map(s=>s.semester),[1,3,8]);
  assert.equal(result.semesters[0].gpa,7.5);assert.equal(result.semesters[1].gpa,null);
  assert.equal(summarizeResults([],[]).percentage,null);assert.equal(summarizeResults([],[]).gpa,null);
});
