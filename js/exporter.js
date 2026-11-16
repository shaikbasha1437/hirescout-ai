/* HireScout exports: pipeline CSV (with a blind option and spreadsheet-formula protection), a Markdown
   screening report with evidence quotes, a JSON backup, and backup restore validation. Exports never include
   settings or API keys; anything key-shaped is redacted as a last check. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./guard.js'));
  else (root.HS = root.HS || {}).exporter = factory(root.HS.guard);
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';
  const STAGES = [{ id: 'applied', label: 'Applied' }, { id: 'screened', label: 'Screened' }, { id: 'phone', label: 'Phone screen' }, { id: 'interview', label: 'Interview' }, { id: 'offer', label: 'Offer' }, { id: 'hired', label: 'Hired' }, { id: 'declined', label: 'Declined' }];
  const stageLabel = (id) => (STAGES.find((s) => s.id === id) || { label: id }).label;
  function cell(v) { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function blindLabel(c) { return 'Candidate ' + String(c.id).replace(/^c-/, '').slice(0, 6).toUpperCase(); }
  function pipelineCsv(state, o) {
    const blind = !!(o && o.blind); const jobs = Object.fromEntries(state.jobs.map((j) => [j.id, j]));
    const head = ['candidate', 'job', 'stage', 'on_hold', 'score', 'recommendation', 'scored_by', 'gaps', 'flags', 'knockouts', 'last_decision', 'last_reason'].concat(blind ? [] : ['name', 'email', 'phone', 'source']);
    const rows = [head.join(',')];
    for (const c of state.candidates.filter((x) => !x.archived && (!o || !o.jobId || x.jobId === o.jobId))) {
      const sc = c.score || {}; const dec = state.decisions.filter((d) => d.candId === c.id).slice(-1)[0];
      const flags = [].concat((sc.flagged || []).length ? ['instruction-like text ignored'] : [], c.duplicateOf ? ['possible duplicate'] : []);
      rows.push([blindLabel(c), (jobs[c.jobId] || {}).title, stageLabel(c.stage), c.hold ? 'yes' : '', sc.total == null ? '' : sc.total, sc.rec ? sc.rec.label : '', sc.source === 'llm' ? 'AI (checked)' : 'rules', (sc.gaps || []).join('; '), flags.join('; '), (sc.knockouts || []).map((k) => k.q + ' ' + (k.answer || 'unanswered')).join('; '), dec ? dec.at.slice(0, 10) + ' ' + stageLabel(dec.from) + ' > ' + stageLabel(dec.to) : '', dec ? dec.reason : ''].concat(blind ? [] : [c.name, c.email, c.phone, c.source]).map(cell).join(','));
    }
    return G.redactKeys(rows.join('\r\n') + '\r\n');
  }
  function reportMd(state, jobId, o) {
    const job = state.jobs.find((j) => j.id === jobId); const blind = !!(o && o.blind);
    const cands = state.candidates.filter((c) => c.jobId === jobId && !c.archived).sort((a, b) => ((b.score || {}).total || 0) - ((a.score || {}).total || 0));
    const L = ['# Screening report: ' + job.title, '', '_Generated ' + (o && o.date ? o.date : new Date().toISOString().slice(0, 10)) + ' by HireScout AI. Scores are recommendations backed by quoted resume evidence; people make every decision._', '', '## Scorecard', '', '| Criterion | Weight | Type |', '|---|---|---|'];
    for (const c of job.criteria) L.push('| ' + c.label + (c.must ? ' (must-have)' : '') + ' | ' + c.weight + ' | ' + c.type + (c.skills && c.skills.length ? ': ' + c.skills.join(', ') : c.keywords && c.keywords.length ? ': ' + c.keywords.join(', ') : '') + ' |');
    if ((job.knockouts || []).length) { L.push('', 'Knockout questions (a mismatch flags for review; it never rejects anyone automatically):'); for (const k of job.knockouts) L.push('- ' + k.q + ' (expected: ' + k.want + ')'); }
    L.push('', '## Candidates (' + cands.length + ')', '');
    cands.forEach((c, i) => {
      const sc = c.score || {}; L.push('### ' + (i + 1) + '. ' + (blind ? blindLabel(c) : c.name) + ': ' + (sc.total == null ? 'not scored' : sc.total + '/100') + ' \u00b7 ' + stageLabel(c.stage) + (c.hold ? ' (on hold)' : ''), '');
      if (sc.rec) L.push('**' + sc.rec.label + '.** ' + (sc.explain || ''), '');
      for (const r of sc.results || []) { L.push('- **' + r.label + '**: ' + (r.score == null ? (r.withheld ? 'withheld' : 'no evidence') : r.score + '/5') + (r.rationale ? ' \u2014 ' + r.rationale : '') + (r.withheld ? ' (' + r.withheld + ')' : '')); for (const e of r.evidence || []) L.push('  - > ' + e.quote.replace(/\n/g, ' ')); }
      if ((sc.flagged || []).length) L.push('- Ignored for scoring (flagged as instruction-like or keyword stuffing): ' + sc.flagged.map((f) => '\u201c' + f.sentence.slice(0, 120) + '\u201d').join('; '));
      L.push('');
    });
    return G.redactKeys(L.join('\n'));
  }
  function backupJson(state) {
    const copy = JSON.parse(JSON.stringify(state)); delete copy.settings; delete copy.keys;
    return G.redactKeys(JSON.stringify({ app: 'hirescout-ai', version: 1, exportedAt: new Date().toISOString(), data: copy }, null, 2));
  }
  function parseBackup(text) {
    let j; try { j = JSON.parse(text); } catch (e) { throw new Error('That file isn\u2019t valid JSON.'); }
    const d = j && j.app === 'hirescout-ai' ? j.data : null;
    if (!d || !Array.isArray(d.jobs) || !Array.isArray(d.candidates)) throw new Error('That file isn\u2019t a HireScout backup.');
    for (const c of d.candidates) if (!c || typeof c.id !== 'string' || typeof c.text !== 'string' || !STAGES.some((s) => s.id === c.stage)) throw new Error('The backup has a damaged candidate record.');
    for (const k of ['interviews', 'feedback', 'decisions']) if (!Array.isArray(d[k])) d[k] = [];
    return d;
  }
  return { STAGES, stageLabel, cell, blindLabel, pipelineCsv, reportMd, backupJson, parseBackup };
});
