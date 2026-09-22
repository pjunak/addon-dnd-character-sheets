import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reconcileCharacterMap} from '../web/character-client.js';
import {spellSourceLabel} from '../web/character-spells.js';
test('accepted spell withdrawals preserve later selections and alias edits',()=>{
 const sent={first:['a','b'],second:['c']}, current={first:['a','b'],second:['later']};
 reconcileCharacterMap(sent,current,{first:['a'],second:['c']});
 assert.deepEqual(current,{first:['a'],second:['later']});
 const migrated={legacy:1};reconcileCharacterMap({legacy:1},migrated,{canonical:1});assert.deepEqual(migrated,{canonical:1});
 const later={legacy:1,other:2};reconcileCharacterMap({legacy:1,other:1},later,{canonical:1,other:1});assert.deepEqual(later,{legacy:1,other:2});
 const edited={legacy:0};reconcileCharacterMap({legacy:1},edited,{canonical:1});assert.deepEqual(edited,{legacy:0});
});
test('grant labels identify acquisitions and translate only UI terms',()=>{
 const source={id:'test',name:'Recorded Spell',acquisition:{id:'asi:one',classId:'fighter',level:6}};
 assert.equal(spellSourceLabel(source,'en'),'Recorded Spell · Fighter · Level 6');
 assert.equal(spellSourceLabel(source,'cs'),'Recorded Spell · Fighter · Úroveň 6');
});
