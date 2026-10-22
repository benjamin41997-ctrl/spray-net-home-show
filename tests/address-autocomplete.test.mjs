import test from 'node:test';
import assert from 'node:assert/strict';
import {addressParts,eligibleAddressQuery} from '../public/address-autocomplete.js';
test('local lookup starts at three house digits and narrows with street letters or a complete address',()=>{
 for(const query of ['101','101 m','101 ma','101main','1234 S Main','12 ma','101 Main St, Belmont','101 Main St, Belmont, NC 28012'])assert.equal(eligibleAddressQuery(query),true,query);
 for(const query of ['','1','10','ma','12 m','000','1234567','Main Street',null,'a'.repeat(121)])assert.equal(eligibleAddressQuery(query),false,String(query));
});
test('only the selected address carries its actual city/state/ZIP; edits cannot keep stale parts',()=>{
 const selected={display:'101 Main St, Belmont, NC 28012',city:'Belmont',state:'NC',zip:'28012'};
 assert.deepEqual(addressParts(selected.display,selected),{city:'Belmont',state:'NC',zip:'28012'});
 assert.deepEqual(addressParts('101 Other St',selected),{city:'',state:'',zip:''});
 assert.deepEqual(addressParts('101 Main St',null),{city:'',state:'',zip:''});
 assert.deepEqual(addressParts('  '+selected.display+'  ',selected),{city:'Belmont',state:'NC',zip:'28012'});
});
