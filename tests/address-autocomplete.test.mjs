import test from 'node:test';
import assert from 'node:assert/strict';
import {addressParts,eligibleAddressQuery} from '../public/address-autocomplete.js';
test('local lookup begins only for a useful house and street prefix',()=>{
 for(const query of ['101 ma','101main','1234 S Main','101 Main St, Belmont'])assert.equal(eligibleAddressQuery(query),true);
 for(const query of ['','101','ma','101 m','Main Street','101 Main St, Belmont, NC 28012',null,'a'.repeat(121)])assert.equal(eligibleAddressQuery(query),false);
});
test('only the selected address carries its actual city/state/ZIP; edits cannot keep stale parts',()=>{
 const selected={display:'101 Main St, Belmont, NC 28012',city:'Belmont',state:'NC',zip:'28012'};
 assert.deepEqual(addressParts(selected.display,selected),{city:'Belmont',state:'NC',zip:'28012'});
 assert.deepEqual(addressParts('101 Other St',selected),{city:'',state:'',zip:''});
 assert.deepEqual(addressParts('101 Main St',null),{city:'',state:'',zip:''});
 assert.deepEqual(addressParts('  '+selected.display+'  ',selected),{city:'Belmont',state:'NC',zip:'28012'});
});
