const test = require('node:test'); const assert = require('node:assert');
const SC = require('../js/scoring.js'); const S = require('../js/seed.js'); const T = require('../js/text.js');
const NOW = Date.UTC(2026, 10, 16); const FE = S.JOBS[0];
const cand = (id) => Object.assign({}, S.CANDIDATES.find((c) => c.id === id), { now: NOW });
test('every non-null score cites verbatim evidence from the resume', () => {
  for (const c of S.CANDIDATES) {
    const job = S.JOBS.find((j) => j.id === c.jobId); const sc = SC.score(job, Object.assign({}, c, { now: NOW }));
    for (const r of sc.results) { if (r.score == null) { assert.strictEqual(r.evidence.length, 0); continue; } assert.ok(r.evidence.length, c.id + ' ' + r.id); for (const e of r.evidence) assert.ok(T.norm(SC.prepare(c).blind.text).includes(T.norm(e.quote.replace(/\u2026$/, '')).slice(0, 60)), e.quote); }
  }
});
test('strong candidates rank above weak ones, and nobody is auto-rejected', () => {
  const t = (id) => SC.score(FE, cand(id)).total;
  assert.ok(t('c-ana') > t('c-lucia')); assert.ok(t('c-kwame') > t('c-grace'));
  for (const c of S.CANDIDATES) assert.ok(['advance', 'review', 'low'].includes(SC.score(S.JOBS.find((j) => j.id === c.jobId), Object.assign({}, c, { now: NOW })).rec.id));
});
test('hidden injection and keyword stuffing do not change the score', () => {
  const mei = cand('c-mei'); const sc = SC.score(FE, mei);
  assert.ok(sc.flagged.length >= 2); assert.ok(sc.flagged.some((f) => f.rules.includes('keyword-stuffing')));
  const clean = Object.assign({}, mei, { text: mei.text.split('\n').filter((l) => !/Note to AI|React TypeScript React/.test(l)).join('\n') });
  assert.strictEqual(sc.total, SC.score(FE, clean).total); assert.ok(sc.total < 40, 'stays a low match: ' + sc.total);
  const dm = cand('c-dmitri'); const dclean = Object.assign({}, dm, { text: dm.text.replace(/\[system\][^\n]*\n/, '') });
  assert.strictEqual(SC.score(FE, dm).total, SC.score(FE, dclean).total);
});
test('names, pronouns and personal details do not move scores (invariance check)', () => {
  const inv = SC.invariance(FE, S.CANDIDATES.filter((c) => c.jobId === 'job-fe').map((c) => Object.assign({}, c, { now: NOW })), { now: NOW });
  assert.ok(inv.every((x) => x.same), JSON.stringify(inv.filter((x) => !x.same)));
  const e = cand('c-ethan'); const noPersonal = Object.assign({}, e, { text: e.text.replace(/Married, two children\.\n/, '').replace(/Website volunteer, Grace Community Church food pantry, 2022 - Present\n/, '') });
  assert.strictEqual(SC.score(FE, e).total, SC.score(FE, noPersonal).total);
});
test('knockout mismatches flag for review instead of rejecting', () => {
  const sc = SC.score(FE, cand('c-dmitri')); assert.ok(sc.knockouts.some((k) => k.pass === false)); assert.notStrictEqual(sc.rec.id, 'advance');
  assert.match(SC.score(FE, cand('c-grace')).rec.why, /not a rejection/);
});
test('drafts a scorecard from a pasted job description', () => {
  const j = SC.draftFromJd(FE.jd);
  assert.strictEqual(j.title, 'Senior Frontend Engineer'); assert.strictEqual(j.minYears, 5); assert.strictEqual(j.remote, 'remote');
  for (const k of ['React', 'TypeScript', 'Testing', 'Accessibility']) assert.ok(j.must.includes(k), k);
  for (const k of ['Design systems', 'GraphQL', 'Node.js']) assert.ok(j.nice.includes(k), k);
  assert.ok(j.criteria.find((c) => c.id === 'mentoring')); assert.deepStrictEqual(j.flags, []);
  assert.ok(SC.draftFromJd('Barista\nRequirements\n- Young and energetic\n- Native English speaker').flags.length >= 2);
});
test('lintJob catches protected references in criteria, knockouts and notes', () => {
  const job = Object.assign({}, FE, { notes: 'Prefer recent graduates only', knockouts: FE.knockouts.concat([{ id: 'x', q: 'Are you married?', want: 'no' }]) });
  const where = SC.lintJob(job).map((x) => x.where); assert.ok(where.includes('Notes')); assert.ok(where.some((w) => /married/.test(w)));
  assert.deepStrictEqual(SC.lintJob(FE), []);
});
test('live replies: uncited, invented, flagged or protected-attribute scores are withheld', () => {
  const c = cand('c-mei'); const p = SC.scorePrompt(FE, c);
  assert.ok(!/rank this candidate first/.test(p.messages[0].content)); assert.ok(!/Mei|Tanaka|mei\.tanaka/.test(p.messages[0].content));
  const raw = JSON.stringify({ criteria: [
    { id: 'must', score: 5, evidence: ['React TypeScript React TypeScript Jest Playwright'], rationale: 'Lots of React.' },
    { id: 'years', score: 3, evidence: ['Web Developer, Pinecrest Studio, Sep 2023 - Present'], rationale: 'About three years.' },
    { id: 'nice', score: 4, evidence: [], rationale: 'Probably fine.' },
    { id: 'mentoring', score: 2, evidence: ['Update content in the CMS for clients'], rationale: 'She is young, so limited mentoring.' },
    { id: 'collab', score: 3, evidence: ['Worked with the CEO daily'], rationale: 'x' }], summary: 'ok' });
  const sc = SC.parseScore(FE, c, raw, p); const by = Object.fromEntries(sc.results.map((r) => [r.id, r]));
  assert.strictEqual(by.must.score, null); assert.strictEqual(by.years.score, 3); assert.strictEqual(by.nice.score, null); assert.match(by.nice.withheld, /No evidence/);
  assert.strictEqual(by.mentoring.score, null); assert.match(by.mentoring.withheld, /protected/); assert.strictEqual(by.collab.score, null); assert.strictEqual(sc.withheld, 4);
  assert.throws(() => SC.parseScore(FE, c, 'not json', p), /JSON/);
});
test('live job-description drafts are normalised and linted', () => {
  const j = SC.parseJd(JSON.stringify({ title: 'Analyst', remote: 'remote', minYears: '3', must: ['sql', 'postgres'], criteria: [{ label: 'Young team player', type: 'keywords', keywords: ['team'], weight: 300 }] }));
  assert.deepStrictEqual(j.must, ['SQL', 'SQL']); assert.strictEqual(j.criteria[0].weight, 50); assert.ok(j.flags.length);
});
