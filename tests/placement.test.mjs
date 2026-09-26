import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blank, mergeCharacter } from '../web/character-client.js';
import { assignBodyPlacement, moveEquipment, stowAndUnattune } from '../web/character-inventory.js';

const item = (id, bodyPlacement) => ({ id, name:'Owned item', quantity:1, location:'equipped', bodyPlacement, attuned:true, acquisition:'Quest', notes:'Retain notes', grantId:'ruling' });
const guidance = { one:{canEquip:true,slot:'armor',bodyPlacements:['body']}, two:{canEquip:true,slot:'armor',bodyPlacements:['body']} };
test('placement uses current guidance and explicit moves preserve owned state', () => {
 const owned=item('one','body'), original=structuredClone(owned);
 assert.equal(assignBodyPlacement(owned,'face',guidance),false); assert.deepEqual(owned,original);
 assert.equal(assignBodyPlacement(owned,'',{}),true); assert.equal(Object.hasOwn(owned,'bodyPlacement'),false);
 assert.equal(assignBodyPlacement(owned,'body',{}),false);
 assert.equal(assignBodyPlacement(owned,'body',guidance),true);
 const inventory=[owned,{...item('two'),location:'carried',attuned:false}];
 const before=structuredClone(inventory);
 assert.equal(moveEquipment(inventory,'two','equipped',guidance),true);
 const {bodyPlacement: _, ...unplaced}=original;
 assert.deepEqual(owned,{...unplaced,location:'carried'});
 assert.equal(owned.attuned,true);
 assert.equal(assignBodyPlacement(inventory[1],'body',guidance),true);
 assert.equal(assignBodyPlacement(owned,'body',guidance),false);
 inventory[1].attuned=true;
 assert.equal(stowAndUnattune(inventory[1]),true);
 assert.equal(Object.hasOwn(inventory[1],'bodyPlacement'),false);
 assert.equal(inventory[1].id,before[1].id); assert.equal(inventory[1].notes,before[1].notes);
});

test('placement preserves whole-inventory conflict semantics and disjoint edits', () => {
 const base=blank(); base.play.inventory=[item('one','body')];
 const local=structuredClone(base),remote=structuredClone(base);
 local.play.inventory[0].bodyPlacement='other';remote.play.currency.gp=12;
 const result=mergeCharacter(base,local,remote);
 assert.equal(result.play.inventory[0].bodyPlacement,'other');assert.equal(result.play.currency.gp,12);
 remote.play.inventory[0].bodyPlacement='neck';
 assert.equal(mergeCharacter(base,local,remote),undefined);
});
