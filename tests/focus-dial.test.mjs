import test from 'node:test';
import assert from 'node:assert/strict';
import {dialDelta,dialMinutes} from '../public/web/focus-dial.mjs';
test('dial unwraps clockwise and reverse crossings without dropping accumulated turns',()=>{
  assert.equal(dialDelta(175,-175),10);assert.equal(dialDelta(-175,175),-10);
  let value=25,previous=0;
  for(let angle=12;angle<=792;angle+=12){const wrapped=((angle+180)%360)-180;value=dialMinutes(value+dialDelta(previous,wrapped)/12);previous=wrapped;}
  assert.equal(value,91);
  for(let angle=780;angle>=0;angle-=12){const wrapped=((angle+180)%360)-180;value=dialMinutes(value+dialDelta(previous,wrapped)/12);previous=wrapped;}
  assert.equal(value,25);
});
test('dial bounds keep the existing 1–120 minute contract and fractional drag until release',()=>{
  assert.equal(dialMinutes(-30),1);assert.equal(dialMinutes(160),120);
  assert.equal(dialMinutes(58.4),58.4);assert.equal(Math.round(dialMinutes(58.4)),58);
  assert.equal(dialMinutes(NaN),25);
});
