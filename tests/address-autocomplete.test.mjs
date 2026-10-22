import test from 'node:test';
import assert from 'node:assert/strict';
import {addressParts,eligibleAddressQuery,filterAddressSuggestions} from '../public/address-autocomplete.js';
test('local lookup starts at three house digits and narrows with street letters or a complete address',()=>{
 for(const query of ['101','101 m','101 ma','101main','1234 S Main','12 ma','101 Main St, Belmont','101 Main St, Belmont, NC 28012'])assert.equal(eligibleAddressQuery(query),true,query);
 for(const query of ['','1','10','ma','12 m','000','1234567','Main Street',null,'a'.repeat(121)])assert.equal(eligibleAddressQuery(query),false,String(query));
});

test('cached filtering narrows exact house, street and city prefixes with equivalent directions and suffixes',()=>{
 const values=[
  {street:'101 South Main Street',city:'Belmont',state:'NC',zip:'28012'},
  {street:'101 Maple Dr',city:'Charlotte',state:'NC',zip:'28277'},
  {street:'1010 Main St',city:'Belmont',state:'NC',zip:'28012'},
 ];
 for(const query of ['101 mai','101 s main st','101 South Main St Belmont','101 main, Bel','101 main, Belmont, NC 280'])assert.deepEqual(filterAddressSuggestions(query,values),[values[0]],query);
 assert.equal(filterAddressSuggestions('101 ma',values).length,2);
 assert.deepEqual(filterAddressSuggestions('1010 ma',values),[values[2]]);
 for(const query of ['101 main, Charlotte','101 main, Belmont, SC','202','10'])assert.deepEqual(filterAddressSuggestions(query,values),[],query);
});
test('only the selected address carries its actual city/state/ZIP; edits cannot keep stale parts',()=>{
 const selected={display:'101 Main St, Belmont, NC 28012',city:'Belmont',state:'NC',zip:'28012'};
 assert.deepEqual(addressParts(selected.display,selected),{city:'Belmont',state:'NC',zip:'28012'});
 assert.deepEqual(addressParts('101 Other St',selected),{city:'',state:'',zip:''});
 assert.deepEqual(addressParts('101 Main St',null),{city:'',state:'',zip:''});
 assert.deepEqual(addressParts('  '+selected.display+'  ',selected),{city:'Belmont',state:'NC',zip:'28012'});
});
