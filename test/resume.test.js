const test = require('node:test'); const assert = require('node:assert');
const R = require('../js/resume.js'); const S = require('../js/seed.js');
const NOW = Date.UTC(2026, 10, 16);
test('parses contact details, skills, sections and merged years', () => {
  const p = R.parse(S.CANDIDATES[0].text, NOW);
  assert.strictEqual(p.name, 'Ana Reyes'); assert.strictEqual(p.email, 'ana.reyes@mail.example'); assert.strictEqual(p.location, 'Denver, CO');
  for (const k of ['React', 'TypeScript', 'Testing', 'Accessibility', 'Design systems', 'GraphQL']) assert.ok(p.skills.includes(k), k);
  assert.ok(p.years > 9 && p.years < 10, String(p.years)); assert.deepStrictEqual(p.sections, ['summary', 'experience', 'education', 'skills']);
});
test('overlapping ranges are not double counted and education dates are ignored', () => {
  const t = '## Experience\nA, Jan 2020 - Dec 2021\nB, Jan 2021 - Dec 2022\n\n## Education\nB.S., 2010 - 2014';
  assert.strictEqual(R.experience(t, NOW).years, 2.9);
});
test('skill aliases respect word boundaries', () => {
  assert.ok(R.mentions('Node.js', 'Built Node services')); assert.ok(!R.mentions('Java', 'JavaScript only')); assert.ok(!R.mentions('SQL', 'nosql stores')); assert.ok(R.mentions('Accessibility', 'met WCAG AA')); assert.ok(!R.mentions('Go', 'go to market'));
});
test('relevant years only count roles that mention the skills', () => {
  const p = R.parse(S.CANDIDATES.find((c) => c.id === 'c-ethan').text, NOW);
  assert.ok(p.years > 8); assert.ok(R.relevantYears(p.ranges, ['React']).years < 3);
});
test('missing information is listed', () => {
  const g = S.CANDIDATES.find((c) => c.id === 'c-grace'); const m = R.missing(R.parse(g.text, NOW), { knockouts: S.JOBS[0].knockouts, answers: g.answers }).map((x) => x.id);
  for (const id of ['email', 'phone', 'dates', 'education', 'short', 'ko-hours']) assert.ok(m.includes(id), id);
});
test('duplicate applications are detected by phone and text, not by name alone', () => {
  const d = R.duplicates(S.CANDIDATES);
  assert.strictEqual(d.length, 1); assert.deepStrictEqual([d[0].a, d[0].b], ['c-sam', 'c-samuel']); assert.ok(d[0].reasons.includes('same phone'));
  assert.deepStrictEqual(R.duplicates([{ id: 'a', name: 'Alex Kim', text: 'Python and SQL analyst' }, { id: 'b', name: 'Alex Kim', text: 'Nurse with ten years in pediatrics' }]), []);
});
