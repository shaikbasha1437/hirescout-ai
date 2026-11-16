const test = require('node:test'); const assert = require('node:assert');
const KT = require('../js/kits.js'); const X = require('../js/exporter.js'); const S = require('../js/seed.js'); const SC = require('../js/scoring.js');
const NOW = Date.UTC(2026, 10, 16);
const state = () => ({ jobs: S.JOBS, candidates: S.CANDIDATES.map((c) => Object.assign({}, c, { score: SC.score(S.JOBS.find((j) => j.id === c.jobId), Object.assign({}, c, { now: NOW })) })), decisions: S.DECISIONS.map((d) => Object.assign({ at: '2026-11-10T15:00:00Z' }, d)), interviews: [], feedback: S.FEEDBACK });
test('interview kits tie questions to every scorecard criterion', () => {
  const k = KT.kit(S.JOBS[0], 'tech'); assert.strictEqual(k.criteria.length, S.JOBS[0].criteria.length);
  for (const c of k.criteria) assert.ok(c.questions.length >= 1, c.label); assert.ok(k.guidance.some((g) => /protected/.test(g)));
});
test('debrief aggregates ratings, finds disagreement and flags biased notes', () => {
  const d = KT.debrief(S.JOBS[0], S.FEEDBACK.filter((f) => f.candId === 'c-kwame'));
  assert.strictEqual(d.count, 3); assert.ok(d.disagreements.includes('Cross-functional collaboration')); assert.match(d.lean, /leans yes/);
  assert.strictEqual(d.flags.length, 1); assert.ok(d.flags[0].flags.some((f) => f.category === 'age'));
});
test('CSV export is blind on request and guards against spreadsheet formulas', () => {
  const s = state(); s.candidates[0] = Object.assign({}, s.candidates[0], { source: '=HYPERLINK("x")' });
  const blind = X.pipelineCsv(s, { blind: true }); assert.ok(!/Ana Reyes|mail\.example/.test(blind)); assert.match(blind, /Candidate ANA/);
  const full = X.pipelineCsv(s, {}); assert.match(full, /Ana Reyes/); assert.match(full, /"'=HYPERLINK/);
});
test('Markdown report quotes evidence and lists ignored injections', () => {
  const md = X.reportMd(state(), 'job-fe', { blind: true, date: '2026-11-16' });
  assert.match(md, /> Led the rebuild of the course editor/); assert.match(md, /Ignored for scoring/); assert.ok(!/Mei Tanaka/.test(md));
});
test('backups never carry keys and restore validates', () => {
  const s = Object.assign(state(), { settings: { key: 'x' }, keys: { openai: 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX' } }); s.candidates[1] = Object.assign({}, s.candidates[1], { text: s.candidates[1].text + ' sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX' });
  const j = X.backupJson(s); assert.ok(!/sk-proj-/.test(j)); assert.ok(!/"keys"/.test(j));
  const d = X.parseBackup(j); assert.strictEqual(d.candidates.length, 12);
  assert.throws(() => X.parseBackup('{}'), /backup/); assert.throws(() => X.parseBackup('nope'), /JSON/);
});
