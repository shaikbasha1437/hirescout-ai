const test = require('node:test'); const assert = require('node:assert');
const K = require('../js/schedule.js'); const S = require('../js/seed.js');
const H = 3600000; const FROM = Date.UTC(2026, 10, 17, 6); const D0 = '2026-11-17';
const person = (id, tz, hours, busy) => ({ id, name: id, tz, hours: hours || { start: '09:00', end: '17:00' }, busy: busy || [] });
test('time zone conversion is DST-aware', () => {
  assert.strictEqual(K.zonedToUtc('2026-11-17', '09:00', 'America/Chicago'), Date.UTC(2026, 10, 17, 15));
  assert.strictEqual(K.zonedToUtc('2026-07-17', '09:00', 'America/Chicago'), Date.UTC(2026, 6, 17, 14));
  assert.strictEqual(K.local(Date.UTC(2026, 10, 17, 15), 'Europe/London').mins, 15 * 60);
});
test('slots respect every attendee\u2019s working hours, weekends and buffers', () => {
  const busy = [{ start: Date.UTC(2026, 10, 17, 15), end: Date.UTC(2026, 10, 17, 16) }];
  const c = person('cand', 'America/Chicago'); const a = person('a', 'America/New_York', null, busy); const b = person('b', 'Europe/London', { start: '10:00', end: '18:00' });
  const slots = K.findSlots({ candidate: c, parts: [{ label: 'x', mins: 60, people: [a, b] }], from: FROM, days: 7, buffer: 15, limit: 20, perDay: 5 });
  assert.ok(slots.length > 0);
  for (const s of slots) { for (const p of [c, a, b]) assert.ok(K.inHours(p, s.start, s.end), p.id + ' ' + new Date(s.start).toISOString()); assert.ok(s.start >= busy[0].end + 15 * 60000 || s.end <= busy[0].start - 15 * 60000); }
});
test('multi-part panels run back to back with gaps, each interviewer only in their part', () => {
  const panel = S.PANEL.map((p) => Object.assign({}, p, { busy: K.demoBusy(p, D0, 14) }));
  const c = Object.assign(person('c', 'America/Denver'), { busy: [] });
  const loop = K.planLoop({ candidate: c, panel, stages: S.JOBS[0].loop, from: FROM });
  assert.deepStrictEqual(loop.map((l) => !!l.slot), [true, true, true]);
  const on = loop[2].slot.sessions; assert.strictEqual(on.length, 3); assert.strictEqual(on[1].start - on[0].end, 15 * 60000);
  assert.ok(loop[1].slot.start > loop[0].slot.end && K.local(loop[1].slot.start, c.tz).date > K.local(loop[0].slot.start, c.tz).date, 'stages on later days');
  for (const s of on) for (const id of s.people) { const p = panel.find((x) => x.id === id); assert.ok(K.inHours(p, s.start, s.end)); assert.ok(K.free(p, s.start, s.end, 10)); }
});
test('explains when working hours never overlap', () => {
  const r = K.planLoop({ candidate: person('c', 'Asia/Kolkata'), panel: [person('x', 'America/Los_Angeles')], stages: [{ id: 's', label: 'S', parts: [{ label: 'p', mins: 30, panel: ['x'] }] }], from: FROM, days: 5 });
  assert.strictEqual(r[0].slot, null); assert.match(r[0].why.join(' '), /no shared working hours/);
});
test('ics files publish without notifying anyone and fold long lines', () => {
  const t = K.ics([{ uid: 'iv1', title: 'Technical interview: Senior Frontend Engineer, with a very long title that goes past seventy five octets', start: Date.UTC(2026, 10, 18, 16), end: Date.UTC(2026, 10, 18, 17), attendees: [{ name: 'A', email: 'a@mail.example' }], organizer: { name: 'J', email: 'j@quillmark.example' } }], { now: Date.UTC(2026, 10, 16) });
  assert.match(t, /METHOD:PUBLISH/); assert.match(t, /DTSTART:20261118T160000Z/); assert.match(t, /RSVP=FALSE/); assert.ok(t.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
});
test('drafted emails use the candidate\u2019s time zone and never claim to be sent', () => {
  const c = S.CANDIDATES[0]; const iv = { label: 'Technical interview', sessions: [{ label: 'Pairing', start: Date.UTC(2026, 10, 18, 17), end: Date.UTC(2026, 10, 18, 18), people: ['priya'] }] };
  const d = K.emailDraft('invite', { candidate: c, job: S.JOBS[0], iv, recruiter: S.PANEL[0], panel: S.PANEL, company: 'Quillmark' });
  assert.match(d.body, /10:00\sAM/); assert.match(d.body, /MST/); assert.match(d.body, /accommodation/); assert.strictEqual(d.to, c.email);
  const dec = K.emailDraft('decline', { candidate: c, job: S.JOBS[0], recruiter: S.PANEL[0], company: 'Quillmark' }); assert.ok(!/score|age|ranked/i.test(dec.body));
});
test('share links carry no names, emails or keys and round-trip', () => {
  const link = K.shareEncode({ role: 'Senior Frontend Engineer', stage: 'Phone screen', mins: 30, slots: [Date.UTC(2026, 10, 18, 16)], company: 'Quillmark', token: 'abc123' });
  const raw = Buffer.from(link.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(); assert.ok(!/@|Ana|Reyes|sk-/.test(raw));
  const d = K.shareDecode(link); assert.strictEqual(d.slots[0], Date.UTC(2026, 10, 18, 16)); assert.strictEqual(d.role, 'Senior Frontend Engineer');
  assert.throws(() => K.shareEncode({ role: 'x@y.example' }), /email/); assert.throws(() => K.shareDecode('!!!'), /damaged|not one/);
});
