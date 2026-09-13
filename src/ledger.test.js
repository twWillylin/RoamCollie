import {test} from 'node:test';import assert from 'node:assert/strict';import {splitEqual,balances,settlements} from './ledger.js';
test('equal split preserves every cent',()=>{assert.deepEqual(splitEqual(100,['A','B','C']),{A:34,B:33,C:33})});
test('custom shares and settlement conserve balances',()=>{const trip={members:['A','B','C'],expenses:[{payer:'A',cents:100,shares:{A:20,B:30,C:50}},{payer:'B',cents:60,shares:{A:30,B:30}}]};assert.deepEqual(balances(trip),{A:50,B:0,C:-50});assert.deepEqual(settlements(trip),[{from:'C',to:'A',cents:50}])});
test('no expenses means no transfers',()=>assert.deepEqual(settlements({members:['A'],expenses:[]}),[]));
