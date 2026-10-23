import {test} from 'node:test';
import assert from 'node:assert/strict';
import policy from '../desktop/policy.cjs';
test('desktop accepts HTTPS origins and loopback development only',()=>{
 for(const value of ['https://school.example','http://localhost:3001','http://127.0.0.1:3001','http://[::1]:3001'])assert.equal(policy.serverOrigin(value),value);
 for(const value of ['http://school.example','http://192.168.1.2:3001','file:///tmp/x','javascript:alert(1)','https://school.example/api','https://user:pass@school.example','https://school.example?token=secret','https://school.example/#x',null])assert.throws(()=>policy.serverOrigin(value));
 assert.equal(policy.sameOrigin('https://school.example/api','https://school.example'),true);
 assert.equal(policy.sameOrigin('https://school.example.evil.test','https://school.example'),false);
});
