import test from 'node:test';
import assert from 'node:assert/strict';
import {schedulingNoticeText} from '../.sites-runtime/shared/message-display.mjs';

test('saved scheduling notices show restaurant dates and overnight times without changing their evidence',()=>{
 const body='Server: 2026-09-20T20:00:00.000Z to 2026-09-21T05:00:00.000Z.';
 const result=schedulingNoticeText('Shift published',body,'America/New_York');
 assert.equal(result,'Server: Sun, Sep 20, 4:00 PM EDT to Mon, Sep 21, 1:00 AM EDT.');
 assert.ok(body.includes('T20:00:00.000Z'));
});
test('schedule notice clocks distinguish the two fall-back hours and preserve unrelated text',()=>{
 const body='Cook: 2026-11-01T05:30:00.000Z to 2026-11-01T06:30:00.000Z.';
 assert.equal(schedulingNoticeText('Your schedule changed',body,'America/New_York'),'Cook: Sun, Nov 1, 1:30 AM EDT to Sun, Nov 1, 1:30 AM EST.');
 assert.equal(schedulingNoticeText('A question',body,'America/New_York'),body);
 assert.equal(schedulingNoticeText('Shift published','Already written in local time.','America/New_York'),'Already written in local time.');
 assert.equal(schedulingNoticeText('Shift cancelled','Invalid: 2026-99-99T99:99:99.000Z','America/New_York'),'Invalid: 2026-99-99T99:99:99.000Z');
});
