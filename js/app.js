/* HireScout AI app: jobs and scorecards, resume upload, evidence-cited screening with blind mode, pipeline board,
   interview scheduling and self-scheduling preview, interview kits and debriefs, fairness audit, settings and exports.
   Modal and undo-toast utilities are shared with the earlier AgentKit apps. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s); const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const HS = window.HS; const T = HS.text; const G = HS.guard; const F = HS.fairness; const R = HS.resume; const SC = HS.scoring; const K = HS.schedule; const KT = HS.kits; const DOCS = HS.docs; const X = HS.exporter; const SEED = HS.seed;
  const LLM = window.AgentKit.llm; const WEBLLM = window.HSWebLLM; const ST = window.HSStore; const ls = ST.ls;
  const esc = T.esc; const clone = (x) => JSON.parse(JSON.stringify(x));
  const LS = { settings: 'hs.settings', keys: 'hs.keys', theme: 'hs.theme', visited: 'hs.visited' };
  const PROVIDERS = Object.assign({}, LLM.PROVIDERS, { webllm: { label: 'In-browser (WebLLM, experimental)', defaultModel: WEBLLM.MODELS[0].id, models: WEBLLM.MODELS.map((m) => m.id), needsKey: false } });
  const LOCAL_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'; } catch (e) { return 'America/Chicago'; } })();
  const TZS = Array.from(new Set(['America/Los_Angeles', 'America/Denver', 'America/Phoenix', 'America/Chicago', 'America/New_York', 'America/Toronto', 'America/Sao_Paulo', 'Europe/London', 'Europe/Lisbon', 'Europe/Berlin', 'Africa/Lagos', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'UTC', LOCAL_TZ]));
  const DEFAULTS = { mode: 'demo', provider: 'openai', models: {}, baseUrl: '', remember: false, tab: 'candidates', viewTz: LOCAL_TZ, q: '', minScore: 0, flag: 'all', buffer: 10 };
  let settings = Object.assign({}, DEFAULTS, ls.get(LS.settings, {}));
  let keys = settings.remember ? ls.get(LS.keys, {}) : {};
  let state = null; let busy = false; let proposals = {}; let schedCand = null; let kitCand = null; let kitStage = 'tech'; let availDate = null; let invResult = null;
  const RECRUITER = () => state.panel.find((p) => p.role === 'recruiter') || state.panel[0];
  const saveSettings = () => { ls.set(LS.settings, settings); if (settings.remember) ls.set(LS.keys, keys); else ls.del(LS.keys); };
  const persist = () => ST.save(state);
  const job = () => state.jobs.find((j) => j.id === state.currentJob) || state.jobs[0] || null;
  const jobCands = (all) => state.candidates.filter((c) => job() && c.jobId === job().id && (all || !c.archived));
  const cand = (id) => state.candidates.find((c) => c.id === id);
  const who = (c) => (state.blind ? X.blindLabel(c) : c.name || X.blindLabel(c));
  const stageLabel = X.stageLabel; const STAGES = X.STAGES; const ORDER = STAGES.map((s) => s.id);
  const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  /* ---------------- toast with undo ---------------- */
  let toastTimer = null;
  function toast(msg, undo) {
    const t = $('#toast');
    t.innerHTML = '<span>' + esc(msg) + '</span>' + (undo ? '<button type="button" id="toast-undo">Undo</button>' : '');
    t.classList.add('show');
    if (undo) $('#toast-undo').onclick = () => { t.classList.remove('show'); undo(); };
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), undo ? 8000 : 3800);
  }
  function snapshot(label) { const before = clone(state); return () => { state = before; proposals = {}; persist(); renderAll(); toast(label + ' undone.'); }; }
  /* ---------------- modals: X, Cancel, Esc, backdrop, Back; discard prompt for unsaved edits ---------------- */
  let modal = null; let lastFocus = null;
  function openModal(title, html, o) {
    const op = o || {};
    if (modal) removeModal('replaced'); else { lastFocus = document.activeElement; window.history.pushState({ hsModal: true }, ''); }
    $('#modal-host').innerHTML = '<div class="backdrop"><section class="modal ' + (op.wide ? 'wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><h2 id="modal-title">' + esc(title) + '</h2><button type="button" data-close="x" aria-label="Close">×</button></div><div class="modal-body">' + html + '</div><div class="modal-footer">' + (op.extraFooter || '') + '<button type="button" data-close="cancel">' + esc(op.cancelLabel || (op.save ? 'Cancel' : 'Close')) + '</button>' + (op.save ? '<button type="button" id="modal-save" class="primary">' + esc(op.saveLabel || 'Save') + '</button>' : '') + '</div></section></div>';
    modal = { dirty: false, watch: !!op.dirty, onClose: op.onClose || null, name: op.name || '' };
    document.body.style.overflow = 'hidden';
    $('.backdrop').addEventListener('mousedown', (e) => { if (e.target.classList.contains('backdrop')) closeModal(); });
    $$('[data-close]').forEach((b) => (b.onclick = () => closeModal()));
    $('.modal-body').addEventListener('input', () => { if (modal && modal.watch) modal.dirty = true; });
    if (op.save) $('#modal-save').onclick = () => op.save();
    if (op.onmount) op.onmount();
    setTimeout(() => { if (!modal) return; const first = $('.modal-body input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]):not([readonly]),.modal-body textarea,.modal-body select'); const el = op.focusFirst && first ? first : $('.modal [data-close=x]'); if (el) el.focus(); }, 0);
  }
  function removeModal(reason) { const m = modal; modal = null; $('#modal-host').innerHTML = ''; document.body.style.overflow = ''; if (reason !== 'replaced' && lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true }); if (m && m.onClose) m.onClose(reason || 'cancel'); }
  function closeModal(force, reason) { if (!modal || modal.closing) return; if (!force && modal.dirty && !confirm('Discard unsaved changes?')) return; modal.dirty = false; modal.closing = true; modal.reason = reason; const m = modal; window.history.back(); setTimeout(() => { if (modal === m) removeModal(m.reason); }, 800); }
  addEventListener('popstate', () => { if (!modal) return; if (!modal.closing && modal.dirty && !confirm('Discard unsaved changes?')) { window.history.pushState({ hsModal: true }, ''); return; } removeModal(modal.reason); });
  addEventListener('keydown', (e) => {
    if (!modal) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    if (e.key === 'Tab') { const els = $$('.modal button,.modal input,.modal select,.modal textarea,.modal a[href]').filter((x) => !x.disabled && x.offsetParent !== null); if (!els.length) return; const f = els[0]; const l = els[els.length - 1]; if (e.shiftKey && document.activeElement === f) { l.focus(); e.preventDefault(); } else if (!e.shiftKey && document.activeElement === l) { f.focus(); e.preventDefault(); } }
  });
  function download(name, data, type) { const blob = new Blob([data], { type: type || 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
  async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Copied. Nothing was sent.'); } catch (e) { toast('Copy failed; select the text and copy it yourself.'); } }
  const fileSlug = (s) => String(s || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function draftBox(d, id) { const full = 'To: ' + d.to + '\nSubject: ' + d.subject + '\n\n' + d.body; return '<div class="draft"' + (id ? ' id="' + id + '"' : '') + '><div class="hd"><span><b>Draft to ' + esc(d.to) + '</b> <span class="pill">Not sent</span></span><button type="button" class="small-btn" data-act="copy" data-text="' + esc(full) + '">Copy</button></div><div class="small muted">Subject: ' + esc(d.subject) + '</div><pre>' + esc(d.body) + '</pre></div>'; }

  /* ---------------- state ---------------- */
  function scoreCand(c, jb) { const j = jb || state.jobs.find((x) => x.id === c.jobId); if (!j) return; c.score = SC.score(j, c); c.missing = R.missing(R.parse(c.text), { knockouts: j.knockouts, answers: c.answers, email: c.email, phone: c.phone }); }
  function rescoreJob(jb) { for (const c of state.candidates.filter((x) => x.jobId === jb.id)) scoreCand(c, jb); }
  function fresh() {
    const s = { version: 1, seededOn: todayIso(), company: clone(SEED.COMPANY), panel: clone(SEED.PANEL), jobs: clone(SEED.JOBS), candidates: clone(SEED.CANDIDATES).map((c) => Object.assign(c, { hold: false, archived: false, notes: [], added: new Date().toISOString() })), interviews: [], feedback: [], decisions: [], shares: [], dismissedDupes: [], blind: true, currentJob: 'job-fe' };
    const t0 = Date.now(); s.feedback = clone(SEED.FEEDBACK).map((f, i) => Object.assign(f, { at: new Date(t0 - (3 - i) * 86400000).toISOString() }));
    s.decisions = clone(SEED.DECISIONS).map((d, i, a) => Object.assign({ id: 'd-seed-' + i, jobId: (SEED.CANDIDATES.find((c) => c.id === d.candId) || {}).jobId, at: new Date(t0 - (a.length - i) * 86400000 * 0.8).toISOString(), blind: true, action: 'move' }, d));
    state = s; for (const c of s.candidates) scoreCand(c); for (const d of s.decisions) { const c = s.candidates.find((x) => x.id === d.candId); d.score = c && c.score ? c.score.total : null; }
    return s;
  }
  function dupes() { const cs = state.candidates.filter((c) => !c.archived); return R.duplicates(cs).filter((d) => !state.dismissedDupes.includes(d.a + '|' + d.b) && cand(d.a).jobId === cand(d.b).jobId); }
  function flagsOf(c) {
    const out = []; const sc = c.score || {};
    if ((sc.flagged || []).length) out.push({ id: 'inject', label: 'Instructions in resume ignored', cls: 'bad' });
    if (dupes().some((d) => d.a === c.id || d.b === c.id)) out.push({ id: 'dupe', label: 'Possible duplicate', cls: 'warn' });
    if ((c.missing || []).some((m) => m.severity !== 'low')) out.push({ id: 'missing', label: 'Missing info', cls: 'warn' });
    if ((sc.knockouts || []).some((k) => k.pass === false)) out.push({ id: 'knockout', label: 'Knockout mismatch', cls: 'warn' });
    if (c.hold) out.push({ id: 'hold', label: 'On hold', cls: '' });
    return out;
  }
  function decide(c, to, reason, action) {
    const from = c.stage; const d = { id: SC.uid('d'), at: new Date().toISOString(), candId: c.id, jobId: c.jobId, from, to, reason: reason || '', by: RECRUITER().name + ' (you)', rec: c.score && c.score.rec ? c.score.rec.id : null, score: c.score ? c.score.total : null, blind: !!state.blind, action: action || 'move' };
    state.decisions.push(d); if (action !== 'hold') { c.stage = to; c.hold = false; } return d;
  }

  /* ---------------- rendering ---------------- */
  function renderContext() {
    const sel = $('#job-select'); sel.innerHTML = state.jobs.map((j) => '<option value="' + esc(j.id) + '"' + (j.id === state.currentJob ? ' selected' : '') + '>' + esc(j.title) + ' (' + state.candidates.filter((c) => c.jobId === j.id && !c.archived).length + ')</option>').join('');
    $('#blind-toggle').checked = !!state.blind;
    const j = job();
    $('#job-summary').innerHTML = j ? '<span><b>' + esc(j.location || 'Location not set') + '</b> \u00b7 ' + esc(j.remote) + '</span><span>Must-haves: <b>' + esc((j.must || []).join(', ') || 'none') + '</b></span><span>' + (j.minYears ? j.minYears + '+ years' : 'No minimum years') + '</span><span>' + j.criteria.length + ' scorecard criteria</span>' + (SC.lintJob(j).length ? '<span class="pill bad">Wording flagged in this job</span>' : '') : '<span>No job yet. Create one to start screening.</span>';
    const live = settings.mode === 'live'; $('#mode-pill').textContent = live ? 'Live mode \u00b7 ' + PROVIDERS[settings.provider].label : 'Demo mode \u00b7 no key'; $('#mode-pill').className = 'pill' + (live ? ' ok' : '');
  }
  function renderTabs() { $$('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === settings.tab))); }
  function renderAll() { renderContext(); renderTabs(); renderPanel(); }
  function renderPanel() {
    const p = $('#panel'); const t = settings.tab; const j = job();
    if (!j && t !== 'audit') { p.innerHTML = '<div class="empty">No jobs yet. <button type="button" data-act="new-job" class="primary">Create a job</button></div>'; return; }
    p.innerHTML = t === 'pipeline' ? renderPipeline() : t === 'schedule' ? renderSchedule() : t === 'interviews' ? renderInterviews() : t === 'audit' ? renderAudit() : t === 'job' ? renderJob() : renderCandidates();
    if (t === 'pipeline') bindBoard();
  }

  /* ---------------- candidates ---------------- */
  function matches(c) {
    const q = T.norm(settings.q || ''); const sc = c.score || {};
    if (q && !T.norm([who(c), state.blind ? '' : c.email, (c.score && c.score.strengths || []).join(' '), stageLabel(c.stage), c.source].join(' ')).includes(q)) return false;
    if ((sc.total || 0) < (+settings.minScore || 0)) return false;
    if (settings.flag !== 'all') { const f = flagsOf(c).map((x) => x.id); if (settings.flag === 'none' ? f.length : !f.includes(settings.flag)) return false; }
    return true;
  }
  function filterBar(extra) {
    return '<div class="toolbar"><input type="search" id="f-q" class="grow" placeholder="Search candidates, stages, strengths" aria-label="Search candidates" value="' + esc(settings.q) + '" style="max-width:340px">' +
      '<select id="f-min" aria-label="Minimum score">' + [0, 40, 60, 70, 80].map((v) => '<option value="' + v + '"' + (+settings.minScore === v ? ' selected' : '') + '>' + (v ? 'Score \u2265 ' + v : 'Any score') + '</option>').join('') + '</select>' +
      '<select id="f-flag" aria-label="Flag filter">' + [['all', 'All candidates'], ['inject', 'Injection flagged'], ['dupe', 'Possible duplicates'], ['missing', 'Missing info'], ['knockout', 'Knockout mismatch'], ['hold', 'On hold'], ['none', 'No flags']].map(([v, l]) => '<option value="' + v + '"' + (settings.flag === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' + (extra || '') + '</div>';
  }
  function scorePill(sc) { return sc && sc.rec ? '<span class="pill rec-' + sc.rec.id + '">' + esc(sc.rec.label) + '</span>' : ''; }
  function renderCandidates() {
    const all = jobCands(); const list = all.filter(matches).sort((a, b) => (b.stage === 'declined' ? -1 : 0) - (a.stage === 'declined' ? -1 : 0) || ((b.score || {}).total || 0) - ((a.score || {}).total || 0));
    const ds = dupes().filter((d) => cand(d.a).jobId === job().id);
    const live = settings.mode === 'live';
    let h = filterBar('<button type="button" data-act="score-all"' + (busy ? ' disabled' : '') + '>' + (live ? 'Score all with AI' : 'Re-score all') + '</button>');
    h += '<p class="small muted" style="margin-top:0">Ranked by scorecard evidence. These are recommendations: nothing moves until a person advances, holds or declines. ' + (state.blind ? 'Blind screening is on, so names and personal details are hidden.' : 'Blind screening is off; scoring still runs on the redacted text.') + '</p>';
    for (const d of ds) h += '<div class="note" data-dupe="' + esc(d.a + '|' + d.b) + '"><b>Possible duplicate:</b> ' + esc(who(cand(d.a))) + ' and ' + esc(who(cand(d.b))) + ' (' + esc(d.reasons.join(', ')) + '). <button type="button" class="small-btn" data-act="review-dupe" data-a="' + esc(d.a) + '" data-b="' + esc(d.b) + '">Review</button></div>';
    if (!all.length) return h + '<div class="empty">No candidates for this job yet. <button type="button" class="primary" data-act="upload">Add resumes</button></div>';
    if (!list.length) h += '<div class="empty">No candidates match these filters.</div>';
    list.forEach((c, i) => {
      const sc = c.score || {}; const fl = flagsOf(c);
      h += '<article class="cand" data-cand="' + esc(c.id) + '"><div class="rank">' + (c.stage === 'declined' ? '\u2013' : i + 1) + '</div><div><h3><button type="button" class="linkish" data-act="open-cand" data-cid="' + esc(c.id) + '">' + esc(who(c)) + '</button></h3><div class="meta"><span class="pill">' + esc(stageLabel(c.stage)) + '</span>' + scorePill(sc) + (sc.source === 'llm' ? '<span class="pill ok">AI scored, evidence checked</span>' : '') + fl.map((f) => '<span class="pill ' + f.cls + '" data-flag="' + f.id + '">' + esc(f.label) + '</span>').join('') + '</div><div class="small muted" style="margin-top:4px">' + esc(sc.explain || '') + '</div></div>' +
        '<div class="score" title="Weighted scorecard total"><b>' + (sc.total == null ? '\u2013' : sc.total) + '</b><div class="bar"><i style="width:' + (sc.total || 0) + '%"></i></div></div>' +
        '<div class="acts">' + (c.stage !== 'declined' && c.stage !== 'hired' ? '<button type="button" class="small-btn" data-act="advance" data-cid="' + esc(c.id) + '">Advance</button><button type="button" class="small-btn" data-act="hold" data-cid="' + esc(c.id) + '">' + (c.hold ? 'Release hold' : 'Hold') + '</button><button type="button" class="small-btn danger" data-act="decline" data-cid="' + esc(c.id) + '">Decline</button>' : '<span class="small muted">' + esc(stageLabel(c.stage)) + '</span>') + '</div></article>';
    });
    return h;
  }
  function nextStage(s) { const i = ORDER.indexOf(s); return i >= 0 && i < ORDER.indexOf('hired') ? ORDER[i + 1] : null; }
  function advance(id, reason) {
    const c = cand(id); const to = nextStage(c.stage); if (!to) return;
    const undo = snapshot('Move'); decide(c, to, reason || 'Advanced from ' + stageLabel(c.stage) + ' (recommendation: ' + (c.score && c.score.rec ? c.score.rec.label.toLowerCase() : 'none') + ').');
    persist(); renderAll(); toast(who(c) + ' moved to ' + stageLabel(to) + '. Logged.', undo);
  }
  function toggleHold(id) { const c = cand(id); const undo = snapshot('Hold'); c.hold = !c.hold; decide(c, c.stage, c.hold ? 'Placed on hold' : 'Hold released', 'hold'); persist(); renderAll(); toast(who(c) + (c.hold ? ' is on hold.' : ' is off hold.'), undo); }
  const DECLINE_REASONS = ['Must-have skills not evidenced', 'Experience level doesn\u2019t match the role', 'Knockout requirement not met (confirmed with candidate)', 'Stronger match chosen for this opening', 'Candidate withdrew', 'Position filled or closed', 'Other job-related reason'];
  function declineModal(id, onDone) {
    const c = cand(id);
    openModal('Decline ' + who(c), '<p class="small muted" style="margin-top:0">A person makes this decision. Pick a job-related reason; it is logged in the audit trail. You can undo right after.</p><div class="field"><label for="dc-reason">Reason</label><select id="dc-reason"><option value="">Choose a reason\u2026</option>' + DECLINE_REASONS.map((r) => '<option>' + esc(r) + '</option>').join('') + '</select></div><div class="field"><label for="dc-note">Details (optional)</label><textarea id="dc-note" rows="2" placeholder="Job-related details only"></textarea><div class="help">Notes are checked for references to protected characteristics.</div></div><label class="check"><input type="checkbox" id="dc-draft" checked> <span>Draft a respectful decline email (not sent)</span></label><div class="err" id="dc-err" hidden></div>', { dirty: true, name: 'decline', saveLabel: 'Decline', save: () => {
      const r = $('#dc-reason').value; const note = $('#dc-note').value.trim(); const err = $('#dc-err');
      if (!r) { err.hidden = false; err.textContent = 'Choose a reason. (Cancel works any time.)'; $('#dc-reason').focus(); return; }
      const fl = F.check(note); if (fl.length) { err.hidden = false; err.textContent = 'Rewrite the details without protected characteristics: ' + F.summary(fl) + '.'; return; }
      const undo = snapshot('Decline'); const from = c.stage; decide(c, 'declined', r + (note ? ': ' + note : '')); const wantDraft = $('#dc-draft').checked;
      persist(); modal.dirty = false; closeModal(true, 'saved'); renderAll(); toast(who(c) + ' declined (was ' + stageLabel(from) + '). Logged.', undo);
      if (wantDraft) setTimeout(() => openModal('Decline email draft', draftBox(K.emailDraft('decline', { candidate: c, job: job(), recruiter: RECRUITER(), company: state.company.name })) + '<p class="small muted">Copy it into your email tool if you want to send it. HireScout never sends email.</p>', { name: 'decline-draft' }), 850);
      if (onDone) onDone();
    } });
  }
  function highlightResume(c) {
    const text = state.blind ? F.blind(c.text, { name: c.name }).text : c.text; let html = esc(text);
    for (const f of G.scan(text)) html = html.split(esc(f.sentence)).join('<mark class="flag" title="Flagged: ' + esc(f.rules.join(', ')) + '">' + esc(f.sentence) + '</mark>');
    if (state.blind) html = html.replace(/\[(Candidate|email|phone|link|address|location|year|personal detail removed|photo removed|affinity group|age removed)\]/g, '<mark class="redact">[$1]</mark>');
    return html;
  }
  function critHtml(r) {
    return '<div class="crit" data-crit="' + esc(r.id) + '"><h4>' + esc(r.label) + (r.must ? ' <span class="pill">Must-have</span>' : '') + ' <span class="pill">Weight ' + r.weight + '</span><span class="sc">' + (r.score == null ? (r.withheld ? 'Withheld' : 'No evidence') : r.score + ' / 5') + '</span></h4>' +
      (r.rationale ? '<div class="small" style="margin-top:4px">' + esc(r.rationale) + '</div>' : '') + (r.withheld ? '<div class="note bad">' + esc(r.withheld) + '</div>' : '') +
      (r.evidence || []).map((e) => '<blockquote class="quote">\u201c' + esc(e.quote) + '\u201d' + (e.section || e.strength ? '<small>' + esc([e.section, e.strength].filter(Boolean).join(' \u00b7 ')) + '</small>' : '') + '</blockquote>').join('') + '</div>';
  }
  function openCandidate(id) {
    const c = cand(id); if (!c) return; const sc = c.score || {}; const j = state.jobs.find((x) => x.id === c.jobId); const live = settings.mode === 'live';
    const notes = (c.notes || []).map((n, i) => '<li>' + esc(n.text) + ' <span class="small muted">' + esc(n.by) + ', ' + esc(n.at.slice(0, 10)) + '</span>' + (n.flags && n.flags.length ? ' <span class="pill bad">Flagged: ' + esc(F.summary(n.flags)) + '</span>' : '') + ' <button type="button" class="small-btn" data-act="del-note" data-cid="' + esc(c.id) + '" data-i="' + i + '">Delete</button></li>').join('');
    const body = '<div class="row" style="margin-bottom:8px"><span class="pill">' + esc(stageLabel(c.stage)) + '</span>' + scorePill(sc) + '<span class="pill">Score ' + (sc.total == null ? '\u2013' : sc.total) + '/100</span><span class="pill">' + (sc.source === 'llm' ? 'Scored by AI, every quote checked' : 'Scored by the rule engine') + '</span>' + (state.blind ? '<span class="pill ok">Blind view</span>' : '') + '</div>' +
      '<p style="margin-top:0"><b>' + esc(sc.rec ? sc.rec.label : '') + '.</b> ' + esc(sc.explain || '') + (sc.rec && sc.rec.why ? ' <span class="muted">(' + esc(sc.rec.why) + ')</span>' : '') + '</p>' +
      ((sc.flagged || []).length ? '<div class="note bad" id="inject-box"><b>Ignored for scoring:</b> these lines look like instructions to an AI screener or keyword stuffing, so they were removed before scoring and never sent to a model.<ul>' + sc.flagged.map((f) => '<li>\u201c' + esc(f.sentence.slice(0, 200)) + '\u201d <span class="small muted">(' + esc(f.rules.join(', ')) + ')</span></li>').join('') + '</ul>' + (c.hiddenNote ? '<div class="small">' + esc(c.hiddenNote) + '</div>' : '') + '</div>' : '') +
      ((c.missing || []).length ? '<div class="note"><b>Missing information:</b> ' + c.missing.map((m) => esc(m.label)).join('; ') + '.</div>' : '') +
      '<div class="grid2" style="margin-top:10px"><div><h3 style="margin:0 0 6px;font-size:15px">Scorecard evidence</h3>' + (sc.results || []).map(critHtml).join('') +
      '<h3 style="margin:12px 0 6px;font-size:15px">Knockout questions</h3>' + ((j.knockouts || []).length ? (j.knockouts || []).map((k) => '<div class="field"><label for="ko-' + esc(k.id) + '">' + esc(k.q) + ' <span class="muted small">(expected: ' + k.want + ')</span></label><select id="ko-' + esc(k.id) + '" data-ko="' + esc(k.id) + '"><option value="">Not answered</option><option value="yes"' + ((c.answers || {})[k.id] === 'yes' ? ' selected' : '') + '>Yes</option><option value="no"' + ((c.answers || {})[k.id] === 'no' ? ' selected' : '') + '>No</option></select></div>').join('') + '<p class="small muted">A mismatch flags the candidate for review; it never declines anyone automatically.</p>' : '<p class="small muted">No knockout questions for this job.</p>') +
      '</div><div><h3 style="margin:0 0 6px;font-size:15px">Resume ' + (state.blind ? '(blinded)' : '') + '</h3><div class="resume" id="resume-view">' + highlightResume(c) + '</div>' +
      (!state.blind ? '<div class="small muted" style="margin-top:6px">' + esc([c.email, c.phone, c.tz, c.source].filter(Boolean).join(' \u00b7 ')) + '</div>' : '<div class="small muted" style="margin-top:6px">' + (sc.redactions || 0) + ' details redacted. Turn blind screening off to see contact details.</div>') +
      '<h3 style="margin:12px 0 6px;font-size:15px">Recruiter notes</h3><ul class="small" id="note-list">' + (notes || '<li class="muted">No notes yet.</li>') + '</ul><div class="composer"><textarea id="note-text" rows="2" placeholder="Job-related observations only" aria-label="New note"></textarea><button type="button" data-act="add-note" data-cid="' + esc(c.id) + '">Add note</button></div><div class="err" id="note-err" hidden></div></div></div>';
    const footer = (c.stage !== 'declined' && c.stage !== 'hired' ? '<button type="button" data-act="m-advance" data-cid="' + esc(c.id) + '" class="primary">Advance to ' + esc(stageLabel(nextStage(c.stage))) + '</button><button type="button" data-act="m-hold" data-cid="' + esc(c.id) + '">' + (c.hold ? 'Release hold' : 'Hold') + '</button><button type="button" class="danger" data-act="m-decline" data-cid="' + esc(c.id) + '">Decline</button>' : '') + (live ? '<button type="button" data-act="ai-score" data-cid="' + esc(c.id) + '"' + (busy ? ' disabled' : '') + '>Re-score with AI</button>' : '') + '<button type="button" data-act="edit-cand" data-cid="' + esc(c.id) + '">Edit</button><button type="button" class="danger" data-act="remove-cand" data-cid="' + esc(c.id) + '">Remove</button>';
    openModal(who(c) + ' \u00b7 ' + j.title, body, { wide: true, name: 'candidate', extraFooter: footer, onmount: () => {
      $$('[data-ko]').forEach((s) => (s.onchange = () => { const undo = snapshot('Answer'); c.answers = Object.assign({}, c.answers, { [s.dataset.ko]: s.value || undefined }); if (!s.value) delete c.answers[s.dataset.ko]; const llm = c.score && c.score.source === 'llm'; scoreCand(c); persist(); renderAll(); toast('Knockout answer recorded; recommendation updated' + (llm ? ' (back to the rule-engine score)' : '') + '.', undo); openCandidate(c.id); }));
    } });
  }
  function addNote(id) {
    const c = cand(id); const t = $('#note-text').value.trim(); const err = $('#note-err'); if (!t) { err.hidden = false; err.textContent = 'Write a note first.'; return; }
    const fl = F.check(t); const undo = snapshot('Note'); c.notes = (c.notes || []).concat([{ text: t, by: RECRUITER().name, at: new Date().toISOString(), flags: fl }]);
    persist(); renderAll(); openCandidate(id); toast(fl.length ? 'Note saved but flagged: it mentions ' + F.summary(fl) + '. Consider rewriting it.' : 'Note saved.', undo);
  }
  function editCandidate(id) {
    const c = cand(id);
    openModal('Edit candidate', '<div class="row2"><div class="field"><label for="ec-name">Name</label><input id="ec-name" value="' + esc(c.name) + '"></div><div class="field"><label for="ec-email">Email</label><input id="ec-email" type="email" value="' + esc(c.email) + '"></div></div><div class="row2"><div class="field"><label for="ec-phone">Phone</label><input id="ec-phone" value="' + esc(c.phone) + '"></div><div class="field"><label for="ec-tz">Time zone</label><select id="ec-tz">' + TZS.map((z) => '<option' + (z === c.tz ? ' selected' : '') + '>' + esc(z) + '</option>').join('') + '</select></div></div><div class="field"><label for="ec-source">Source</label><input id="ec-source" value="' + esc(c.source || '') + '"></div><div class="field"><label for="ec-text">Resume text</label><textarea id="ec-text" rows="10">' + esc(c.text) + '</textarea><div class="help">Changing the text re-scores the candidate.</div></div><div class="err" id="ec-err" hidden></div>', { dirty: true, name: 'edit-cand', focusFirst: true, save: () => {
      const name = $('#ec-name').value.trim(); const text = $('#ec-text').value; const err = $('#ec-err');
      if (!name) { err.hidden = false; err.textContent = 'Add a name (it stays hidden in blind mode).'; $('#ec-name').focus(); return; }
      if (T.wordCount(text) < 5) { err.hidden = false; err.textContent = 'The resume text is too short to score.'; return; }
      const undo = snapshot('Edit'); Object.assign(c, { name, email: $('#ec-email').value.trim(), phone: $('#ec-phone').value.trim(), tz: $('#ec-tz').value, source: $('#ec-source').value.trim(), text }); scoreCand(c);
      persist(); modal.dirty = false; closeModal(true, 'saved'); renderAll(); toast('Candidate saved and re-scored.', undo);
    } });
  }
  function removeCandidate(id) { const c = cand(id); const undo = snapshot('Remove'); state.candidates = state.candidates.filter((x) => x.id !== id); state.interviews = state.interviews.filter((x) => x.candId !== id); state.feedback = state.feedback.filter((x) => x.candId !== id); if (modal) closeModal(true); persist(); renderAll(); toast('Removed ' + who(c) + ' and their interviews and feedback.', undo); }
  function reviewDupe(a, b) {
    const A = cand(a); const B = cand(b); const d = dupes().find((x) => x.a === a && x.b === b) || { reasons: [] };
    const col = (c) => '<div><h3 style="margin:0 0 4px;font-size:15px">' + esc(who(c)) + '</h3><div class="small muted">' + esc(stageLabel(c.stage)) + ' \u00b7 score ' + ((c.score || {}).total ?? '\u2013') + ' \u00b7 ' + esc(c.source || '') + ' \u00b7 added ' + esc(String(c.added || '').slice(0, 10)) + '</div><div class="resume" style="max-height:220px;margin-top:6px">' + highlightResume(c) + '</div><button type="button" style="margin-top:8px" data-act="keep-dupe" data-keep="' + esc(c.id) + '" data-drop="' + esc(c === A ? b : a) + '">Keep this one, archive the other</button></div>';
    openModal('Possible duplicate', '<p class="small muted" style="margin-top:0">Matched on: ' + esc(d.reasons.join(', ')) + '. Archiving keeps the record (with its source) for the audit trail and moves notes over; you can undo.</p><div class="grid2">' + col(A) + col(B) + '</div>', { wide: true, name: 'dupe', extraFooter: '<button type="button" data-act="not-dupe" data-a="' + esc(a) + '" data-b="' + esc(b) + '">Not the same person</button>' });
  }
  function keepDupe(keep, drop) { const k = cand(keep); const d = cand(drop); const undo = snapshot('Merge'); d.archived = true; d.duplicateOf = keep; k.notes = (k.notes || []).concat((d.notes || [])).concat([{ text: 'Merged duplicate application (source: ' + (d.source || 'unknown') + ').', by: RECRUITER().name, at: new Date().toISOString(), flags: [] }]); closeModal(true); persist(); renderAll(); toast('Archived the duplicate; kept ' + who(k) + '.', undo); }
  function notDupe(a, b) { const undo = snapshot('Dismiss'); state.dismissedDupes.push(a + '|' + b); closeModal(true); persist(); renderAll(); toast('Marked as different people.', undo); }

  /* ---------------- upload ---------------- */
  function addCandidateFromText(text, o) {
    const p = R.parse(text); const name = p.name || (o && o.fallbackName ? o.fallbackName.replace(/\b\w/g, (m) => m.toUpperCase()) : 'Unnamed candidate');
    const c = { id: 'c-' + Math.random().toString(36).slice(2, 8), jobId: job().id, name, email: p.email, phone: p.phone, tz: settings.viewTz, stage: 'applied', hold: false, archived: false, source: (o && o.source) || 'Pasted text', answers: {}, text, notes: [], added: new Date().toISOString(), hiddenNote: o && o.hidden && o.hidden.length ? o.hidden.length + ' hidden line(s) were found in the file (white, tiny or hidden text).' : '' };
    scoreCand(c); state.candidates.push(c); return c;
  }
  function uploadModal() {
    openModal('Add resumes to ' + job().title, '<p class="small muted" style="margin-top:0">PDF, DOCX, TXT or Markdown, several at once. Files are read in this browser and never uploaded. Hidden text (white or tiny) is kept, flagged and ignored for scoring.</p><div class="field"><label for="up-files">Resume files</label><input id="up-files" type="file" multiple accept=".pdf,.docx,.txt,.md,.markdown,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></div><div class="field"><label for="up-text">Or paste a resume</label><textarea id="up-text" rows="7" placeholder="Paste resume text here"></textarea></div><div id="up-results" class="small"></div><div class="err" id="up-err" hidden></div>', { dirty: true, name: 'upload', saveLabel: 'Add', save: async () => {
      const files = Array.from($('#up-files').files || []); const pasted = $('#up-text').value.trim(); const err = $('#up-err'); const out = $('#up-results');
      if (!files.length && !pasted) { err.hidden = false; err.textContent = 'Choose files or paste a resume.'; return; }
      err.hidden = true; $('#modal-save').disabled = true; const undo = snapshot('Add'); const lines = []; let added = 0;
      for (const f of files) {
        try { const r = await DOCS.parseFile({ name: f.name, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()) }); const c = addCandidateFromText(r.text, { source: 'Upload: ' + f.name, fallbackName: r.fallbackName, hidden: r.hidden }); added++; lines.push('<li>' + esc(f.name) + ': added as <b>' + esc(who(c)) + '</b>, score ' + c.score.total + (c.score.flagged.length ? ' <span class="pill bad">' + c.score.flagged.length + ' line(s) flagged and ignored</span>' : '') + '</li>'); }
        catch (e) { lines.push('<li class="err">' + esc(f.name) + ': ' + esc(e.message) + '</li>'); }
      }
      if (pasted) { if (T.wordCount(pasted) < 5) lines.push('<li class="err">Pasted text is too short to score.</li>'); else { const c = addCandidateFromText(pasted, { source: 'Pasted text' }); added++; lines.push('<li>Pasted resume: added as <b>' + esc(who(c)) + '</b>, score ' + c.score.total + '</li>'); } }
      if (modal) { out.innerHTML = '<ul>' + lines.join('') + '</ul>'; $('#modal-save').disabled = false; }
      if (!added) return;
      persist(); renderAll(); if (modal) { modal.dirty = false; $('#up-files').value = ''; $('#up-text').value = ''; }
      toast('Added ' + added + ' candidate' + (added === 1 ? '' : 's') + ' and scored them.', undo);
    } });
  }

  /* ---------------- live model ---------------- */
  function modelFor() { return settings.models[settings.provider] || PROVIDERS[settings.provider].defaultModel; }
  async function callModel(prompt) {
    G.assertNoSecrets(prompt.system + JSON.stringify(prompt.messages), Object.values(keys).filter(Boolean));
    if (settings.provider === 'webllm') return WEBLLM.call(modelFor(), prompt, (p) => toast('Loading in-browser model ' + Math.round((p.progress || 0) * 100) + '%'));
    return LLM.call({ provider: settings.provider, key: keys[settings.provider] || '', model: modelFor(), baseUrl: settings.provider === 'compatible' ? settings.baseUrl : '' }, prompt);
  }
  async function aiScore(ids) {
    if (busy) return; busy = true; renderPanel(); let ok = 0; let withheld = 0; let lastErr = '';
    const undo = snapshot('AI scoring');
    for (const id of ids) {
      const c = cand(id); const j = state.jobs.find((x) => x.id === c.jobId);
      try { const p = SC.scorePrompt(j, c); const r = await callModel(p); const sc = SC.parseScore(j, c, r.text, p); sc.meta = PROVIDERS[settings.provider].label + ' \u00b7 ' + (r.model || modelFor()) + ' \u00b7 ' + r.latencyMs + ' ms' + (r.cost != null ? ' \u00b7 ~$' + r.cost.toFixed(5) : ''); c.score = sc; ok++; withheld += sc.withheld; }
      catch (e) { lastErr = G.redactKeys(e.message); }
    }
    busy = false; persist(); renderAll();
    if (ok) toast('AI scored ' + ok + ' candidate' + (ok === 1 ? '' : 's') + (withheld ? '; ' + withheld + ' uncited score(s) withheld' : '') + (lastErr ? '. Some failed: ' + lastErr : '.'), undo);
    else toast('AI scoring failed, so the rule-engine scores stay: ' + lastErr);
    if (modal && modal.name === 'candidate' && ids.length === 1) openCandidate(ids[0]);
  }

  /* ---------------- pipeline board ---------------- */
  function renderPipeline() {
    const list = jobCands().filter(matches);
    let h = filterBar() + '<p class="small muted" style="margin-top:0">Drag cards between columns, or focus a card and press \u2190 / \u2192 to move it and Enter to open it. Every move is logged; declines need a reason.</p><div class="board" id="board">';
    for (const s of STAGES) {
      const cs = list.filter((c) => c.stage === s.id).sort((a, b) => ((b.score || {}).total || 0) - ((a.score || {}).total || 0));
      h += '<section class="col" data-stage="' + s.id + '" aria-label="' + esc(s.label) + '"><h3><span>' + esc(s.label) + '</span><span class="muted">' + cs.length + '</span></h3>' + cs.map((c) => { const sc = c.score || {}; const i = ORDER.indexOf(c.stage); return '<div class="kcard" draggable="true" tabindex="0" data-kcard="' + esc(c.id) + '" aria-label="' + esc(who(c) + ', ' + s.label + ', score ' + (sc.total ?? 'none')) + '"><b>' + esc(who(c)) + '</b><div class="meta"><span class="pill">' + (sc.total ?? '\u2013') + '</span>' + (sc.rec ? '<span class="pill rec-' + sc.rec.id + '">' + esc(sc.rec.label.replace('Recommend advancing', 'Advance').replace('Needs a closer look', 'Review').replace('Low match on this scorecard', 'Low match')) + '</span>' : '') + flagsOf(c).map((f) => '<span class="pill ' + f.cls + '">' + esc(f.label) + '</span>').join('') + '</div><div class="mv"><button type="button" data-act="mv" data-cid="' + esc(c.id) + '" data-dir="-1" aria-label="Move ' + esc(who(c)) + ' left"' + (i <= 0 ? ' disabled' : '') + '>\u2190</button><button type="button" data-act="mv" data-cid="' + esc(c.id) + '" data-dir="1" aria-label="Move ' + esc(who(c)) + ' right"' + (i >= ORDER.length - 1 ? ' disabled' : '') + '>\u2192</button></div></div>'; }).join('') + '</section>';
    }
    return h + '</div>';
  }
  function moveTo(id, to) {
    const c = cand(id); if (!c || c.stage === to || !ORDER.includes(to)) return;
    if (to === 'declined') { declineModal(id); return; }
    const undo = snapshot('Move'); const from = c.stage; decide(c, to, 'Moved on the board from ' + stageLabel(from) + ' to ' + stageLabel(to) + '.'); persist(); renderAll();
    toast(who(c) + ' moved to ' + stageLabel(to) + '. Logged.', undo);
    const el = $('[data-kcard="' + CSS.escape(id) + '"]'); if (el) el.focus();
  }
  function bindBoard() {
    let dragId = null;
    $$('.kcard').forEach((k) => {
      k.addEventListener('dragstart', (e) => { dragId = k.dataset.kcard; k.classList.add('dragging'); try { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } catch (er) { /* ignore */ } });
      k.addEventListener('dragend', () => { k.classList.remove('dragging'); $$('.col.over').forEach((c) => c.classList.remove('over')); });
      k.addEventListener('keydown', (e) => {
        if (e.target !== k) return; const c = cand(k.dataset.kcard); const i = ORDER.indexOf(c.stage);
        if (e.key === 'ArrowRight' && i < ORDER.length - 1) { e.preventDefault(); moveTo(c.id, ORDER[i + 1]); }
        if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); moveTo(c.id, ORDER[i - 1]); }
        if (e.key === 'Enter') { e.preventDefault(); openCandidate(c.id); }
      });
      k.addEventListener('dblclick', () => openCandidate(k.dataset.kcard));
    });
    $$('.col').forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', () => col.classList.remove('over'));
      col.addEventListener('drop', (e) => { e.preventDefault(); col.classList.remove('over'); let id = dragId; try { id = e.dataTransfer.getData('text/plain') || dragId; } catch (er) { /* ignore */ } if (id) moveTo(id, col.dataset.stage); dragId = null; });
    });
  }

  /* ---------------- scheduling ---------------- */
  const HOURS = { start: '09:00', end: '17:00' };
  const activeIvs = () => state.interviews.filter((iv) => iv.status !== 'cancelled');
  function busyFromIvs(personId, isCand) { return activeIvs().flatMap((iv) => iv.sessions.filter(() => isCand ? iv.candId === personId : false).map((s) => ({ start: s.start, end: s.end, title: iv.label })).concat(isCand ? [] : iv.sessions.filter((s) => s.people.includes(personId)).map((s) => ({ start: s.start, end: s.end, title: iv.label + ' (interview)' })))); }
  const fromDate = () => K.local(Date.now() - 86400000, settings.viewTz).date;
  function candPerson(c) { return { id: c.id, name: who(c), tz: c.tz || settings.viewTz, hours: HOURS, busy: K.demoBusy({ id: c.id, tz: c.tz || settings.viewTz, hours: HOURS }, fromDate(), 24).concat(busyFromIvs(c.id, true)) }; }
  function panelPerson(p) { return Object.assign({}, p, { busy: K.demoBusy(p, fromDate(), 24).concat(busyFromIvs(p.id, false)) }); }
  const earliest = () => Date.now() + 18 * 3600000;
  function schedList() { return jobCands().filter((c) => !['declined', 'hired'].includes(c.stage)); }
  function curSched() { const l = schedList(); if (!l.find((c) => c.id === schedCand)) schedCand = (l.find((c) => c.stage === 'phone') || l.find((c) => c.stage === 'screened') || l[0] || {}).id || null; return cand(schedCand); }
  function stageParts(st) { return st.parts.map((p) => ({ label: p.label, mins: p.mins, people: p.panel.map((id) => panelPerson(state.panel.find((x) => x.id === id))).filter(Boolean) })); }
  function ivFor(c, stageId) { return activeIvs().find((iv) => iv.candId === c.id && iv.stage === stageId); }
  function findTimes(c, st) {
    const slots = K.findSlots({ candidate: candPerson(c), parts: stageParts(st), from: earliest(), days: 14, buffer: +settings.buffer, gap: 15, perDay: 1, limit: 5 });
    proposals[c.id + '|' + st.id] = { slots, why: slots.length ? [] : K.diagnose([candPerson(c)].concat(...stageParts(st).map((p) => p.people)).filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i), K.local(earliest(), c.tz).date) };
  }
  function planWhole(c) {
    const plan = K.planLoop({ candidate: candPerson(c), panel: state.panel.map(panelPerson), stages: job().loop.filter((st) => !ivFor(c, st.id)), from: earliest(), days: 21, buffer: +settings.buffer, gap: 15 });
    for (const p of plan) proposals[c.id + '|' + p.stage] = { slots: p.slot ? [p.slot] : [], why: p.why || [], fromLoop: true };
  }
  const names = (ids) => ids.map((id) => (state.panel.find((p) => p.id === id) || { name: id }).name).join(', ');
  function slotHtml(c, st, s, i) { return '<div class="slot" data-slot="' + i + '"><div><b>' + esc(K.fmtRange(s.start, s.end, settings.viewTz)) + '</b><div class="small muted">Candidate\u2019s time: ' + esc(K.fmtRange(s.start, s.end, c.tz)) + '</div>' + (s.sessions.length > 1 ? '<div class="small">' + s.sessions.map((x) => esc(x.label) + ' with ' + esc(names(x.people)) + ' (' + esc(K.fmt(x.start, settings.viewTz, { weekday: undefined, month: undefined, day: undefined, timeZoneName: undefined })) + ')').join(' \u00b7 ') + '</div>' : '<div class="small">With ' + esc(names(s.sessions[0].people)) + '</div>') + '</div><button type="button" class="small-btn primary" data-act="hold-slot" data-stage="' + esc(st.id) + '" data-i="' + i + '">Hold this time</button></div>'; }
  function renderSchedule() {
    const c = curSched(); const j = job();
    let h = '<div class="toolbar"><div class="field" style="margin:0;min-width:200px"><label for="sc-cand">Candidate</label><select id="sc-cand">' + schedList().map((x) => '<option value="' + esc(x.id) + '"' + (c && x.id === c.id ? ' selected' : '') + '>' + esc(who(x)) + ' \u00b7 ' + esc(stageLabel(x.stage)) + '</option>').join('') + '</select></div>' +
      (c ? '<div class="field" style="margin:0"><label for="sc-tz">Candidate time zone</label><select id="sc-tz">' + TZS.map((z) => '<option' + (z === c.tz ? ' selected' : '') + '>' + esc(z) + '</option>').join('') + '</select></div>' : '') +
      '<div class="field" style="margin:0"><label for="sc-view">Show times in</label><select id="sc-view">' + TZS.map((z) => '<option' + (z === settings.viewTz ? ' selected' : '') + '>' + esc(z) + '</option>').join('') + '</select></div><div class="field" style="margin:0"><label for="sc-buf">Buffer around meetings</label><select id="sc-buf">' + [0, 10, 15, 30].map((v) => '<option value="' + v + '"' + (+settings.buffer === v ? ' selected' : '') + '>' + v + ' min</option>').join('') + '</select></div></div>';
    if (!c) return h + '<div class="empty">No active candidates to schedule for this job.</div>';
    h += '<div class="grid2"><div class="panel"><h2>Interview loop for ' + esc(who(c)) + '</h2><p class="small muted" style="margin-top:0">Slots fit everyone\u2019s working hours (9 to 5 in each person\u2019s own time zone; Lena works 10 to 6), avoid existing meetings with a ' + settings.buffer + '-minute buffer, start at least 18 hours from now, and keep each stage on a later day. Calendars are fictional.</p><div class="row" style="margin-bottom:10px"><button type="button" class="primary" data-act="plan-loop">Plan the whole loop</button>' + (Object.keys(proposals).some((k) => k.startsWith(c.id + '|') && proposals[k].fromLoop && proposals[k].slots.length) ? '<button type="button" data-act="hold-loop">Hold all proposed</button>' : '') + '</div>';
    for (const st of j.loop) {
      const iv = ivFor(c, st.id); const pr = proposals[c.id + '|' + st.id];
      h += '<div class="crit" data-loop="' + esc(st.id) + '"><h4>' + esc(st.label) + ' <span class="pill">' + st.parts.reduce((a, p) => a + p.mins, 0) + ' min' + (st.parts.length > 1 ? ' across ' + st.parts.length + ' sessions' : '') + '</span>' + (iv ? '<span class="pill ' + (iv.status === 'confirmed' ? 'ok' : 'warn') + '">' + (iv.status === 'confirmed' ? 'Confirmed' : 'Held') + '</span>' : '') + '</h4><div class="small muted">' + st.parts.map((p) => esc(p.label) + ': ' + esc(names(p.panel))).join(' \u00b7 ') + '</div>';
      if (iv) h += '<div class="small" style="margin-top:6px"><b>' + esc(K.fmtRange(iv.sessions[0].start, iv.sessions[iv.sessions.length - 1].end, settings.viewTz)) + '</b></div><div class="row" style="margin-top:6px"><button type="button" class="small-btn" data-act="iv-drafts" data-iv="' + esc(iv.id) + '">Drafts</button>' + (iv.status !== 'confirmed' ? '<button type="button" class="small-btn" data-act="iv-confirm" data-iv="' + esc(iv.id) + '">Mark confirmed</button>' : '') + '<button type="button" class="small-btn" data-act="iv-resched" data-iv="' + esc(iv.id) + '">Reschedule</button><button type="button" class="small-btn" data-act="iv-ics" data-iv="' + esc(iv.id) + '">.ics</button><button type="button" class="small-btn danger" data-act="iv-cancel" data-iv="' + esc(iv.id) + '">Cancel</button></div>';
      else {
        h += '<div class="row" style="margin-top:6px"><button type="button" class="small-btn" data-act="find" data-stage="' + esc(st.id) + '">Find times</button>' + (pr && pr.slots.length ? '<button type="button" class="small-btn" data-act="share" data-stage="' + esc(st.id) + '">Let the candidate pick</button>' : '') + '</div>';
        if (pr) h += pr.slots.length ? '<div style="margin-top:8px">' + pr.slots.map((s, i) => slotHtml(c, st, s, i)).join('') + '</div>' : '<div class="note bad">No time fits in the next two weeks. ' + esc(pr.why.join(' ') || 'Calendars are full; try a smaller buffer or another interviewer.') + '</div>';
      }
      h += '</div>';
    }
    h += '</div><div class="panel"><h2>Availability</h2>' + availHtml(c) + '<h2 style="margin-top:14px">Panel</h2><div class="table-wrap"><table class="tbl stack"><thead><tr><th>Interviewer</th><th>Time zone</th><th>Hours</th><th>Local time now</th></tr></thead><tbody>' + state.panel.map((p) => '<tr><td data-l="Interviewer">' + esc(p.name) + '<div class="small muted">' + esc(p.title) + '</div></td><td data-l="Time zone">' + esc(p.tz) + '</td><td data-l="Hours">' + esc(p.hours.start + '\u2013' + p.hours.end) + '</td><td data-l="Now">' + esc(new Intl.DateTimeFormat('en-US', { timeZone: p.tz, hour: 'numeric', minute: '2-digit', weekday: 'short' }).format(new Date())) + '</td></tr>').join('') + '</tbody></table></div></div></div>';
    const ivs = activeIvs().filter((iv) => iv.jobId === j.id).sort((a, b) => a.sessions[0].start - b.sessions[0].start);
    h += '<h3 style="margin:16px 0 8px;font-size:15px">All scheduled interviews for this job (' + ivs.length + ')</h3>' + (ivs.length ? '<div class="table-wrap"><table class="tbl stack"><thead><tr><th>Candidate</th><th>Stage</th><th>When (' + esc(settings.viewTz) + ')</th><th>Status</th><th></th></tr></thead><tbody>' + ivs.map((iv) => '<tr><td data-l="Candidate">' + esc(who(cand(iv.candId))) + '</td><td data-l="Stage">' + esc(iv.label) + '</td><td data-l="When">' + esc(K.fmtRange(iv.sessions[0].start, iv.sessions[iv.sessions.length - 1].end, settings.viewTz)) + '</td><td data-l="Status">' + esc(iv.status === 'confirmed' ? 'Confirmed' : 'Held') + (iv.picked ? ' (picked by candidate, simulated)' : '') + '</td><td data-l=""><button type="button" class="small-btn" data-act="iv-ics" data-iv="' + esc(iv.id) + '">.ics</button></td></tr>').join('') + '</tbody></table></div><div class="row" style="margin-top:8px"><button type="button" data-act="all-ics">Download all as .ics</button></div>' : '<p class="small muted">Nothing scheduled yet.</p>');
    return h;
  }
  function weekdays(n) { const out = []; let d = K.local(Date.now(), settings.viewTz).date; while (out.length < n) { const dow = new Date(d + 'T00:00:00Z').getUTCDay(); if (dow && dow !== 6) out.push(d); d = K.addDays(d, 1); } return out; }
  function availHtml(c) {
    const days = weekdays(10); if (!days.includes(availDate)) { const firstProp = Object.entries(proposals).find(([k, v]) => k.startsWith(c.id + '|') && v.slots.length); availDate = firstProp ? K.local(firstProp[1].slots[0].start, settings.viewTz).date : days[0]; if (!days.includes(availDate)) availDate = days[0]; }
    const people = [candPerson(c)].concat(Array.from(new Set(job().loop.flatMap((st) => st.parts.flatMap((p) => p.panel)))).map((id) => panelPerson(state.panel.find((x) => x.id === id))));
    const dayStart = K.zonedToUtc(availDate, '00:00', settings.viewTz); const props = Object.entries(proposals).filter(([k]) => k.startsWith(c.id + '|')).flatMap(([, v]) => v.slots.flatMap((s) => s.sessions.map((x) => Object.assign({ cand: true }, x))));
    let h = '<div class="field"><label for="av-date">Day</label><select id="av-date">' + days.map((d) => '<option value="' + d + '"' + (d === availDate ? ' selected' : '') + '>' + esc(new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(d + 'T12:00:00Z'))) + '</option>').join('') + '</select></div><div class="avail" id="avail">';
    for (const p of people) {
      let lane = '';
      for (let i = 0; i < 48; i++) {
        const s = dayStart + i * 1800000; const e = s + 1800000; let cls = '';
        if (K.inHours(p, s, e)) cls = 'w';
        if ((p.busy || []).some((b) => b.start < e && b.end > s)) cls = (p.busy.find((b) => b.start < e && b.end > s).title || '').includes('Busy') ? 'b' : 'h';
        if (props.some((x) => (x.cand && p.id === c.id || x.people.includes(p.id)) && x.start < e && x.end > s)) cls = 'p';
        lane += '<i class="' + cls + '"></i>';
      }
      h += '<div class="who" title="' + esc(p.name + ' \u00b7 ' + p.tz) + '">' + esc(p.name) + ' <span class="muted small">' + esc(p.tz.split('/').pop().replace(/_/g, ' ')) + '</span></div><div class="lane" aria-hidden="true">' + lane + '</div>';
    }
    return h + '</div><div class="avail" style="margin-top:2px"><div></div><div class="avail-scale">' + [0, 3, 6, 9, 12, 15, 18, 21].map((x) => '<span>' + (x % 12 || 12) + (x < 12 ? 'a' : 'p') + '</span>').join('') + '</div></div><div class="legend"><span><i style="background:color-mix(in srgb,var(--ok) 22%,transparent)"></i>Working hours</span><span><i style="background:color-mix(in srgb,var(--bad) 55%,transparent)"></i>Busy</span><span><i style="background:var(--brand2)"></i>Interview held</span><span><i style="background:color-mix(in srgb,var(--warn) 70%,transparent)"></i>Proposed</span><span>Times in ' + esc(settings.viewTz) + '</span></div>';
  }
  function makeIv(c, st, slot, extra) { return Object.assign({ id: SC.uid('iv'), candId: c.id, jobId: c.jobId, stage: st.id, label: st.label, sessions: clone(slot.sessions), status: 'held', sequence: 0, created: new Date().toISOString() }, extra || {}); }
  function holdSlot(stageId, i) {
    const c = curSched(); const st = job().loop.find((x) => x.id === stageId); const pr = proposals[c.id + '|' + stageId]; const slot = pr && pr.slots[i]; if (!slot) return;
    const undo = snapshot('Hold'); const iv = makeIv(c, st, slot); state.interviews.push(iv); delete proposals[c.id + '|' + stageId]; persist(); renderAll();
    toast(st.label + ' held for ' + K.fmt(slot.start, settings.viewTz) + '. Invite drafted, not sent.', undo); draftsModal(iv.id);
  }
  function holdLoop() {
    const c = curSched(); const undo = snapshot('Hold loop'); let n = 0;
    for (const st of job().loop) { const pr = proposals[c.id + '|' + st.id]; if (pr && pr.fromLoop && pr.slots.length && !ivFor(c, st.id)) { state.interviews.push(makeIv(c, st, pr.slots[0])); delete proposals[c.id + '|' + st.id]; n++; } }
    persist(); renderAll(); toast('Held ' + n + ' interview' + (n === 1 ? '' : 's') + '. Invites are drafted, not sent.', undo);
  }
  function ivEvent(iv) {
    const c = cand(iv.candId); const j = state.jobs.find((x) => x.id === iv.jobId);
    return iv.sessions.map((s, k) => ({ uid: iv.id + '-' + k, title: iv.label + (iv.sessions.length > 1 ? ': ' + s.label : '') + ' \u00b7 ' + j.title + ' \u00b7 ' + (c ? c.name : 'Candidate'), start: s.start, end: s.end, sequence: iv.sequence, status: iv.status === 'confirmed' ? 'CONFIRMED' : 'TENTATIVE', location: 'Video call (link to follow)', description: 'Interview kit and feedback form are in HireScout. Drafted by HireScout AI; importing this file does not send invitations.', organizer: { name: RECRUITER().name, email: RECRUITER().email }, attendees: [{ name: c ? c.name : 'Candidate', email: c ? c.email : '' }].concat(s.people.map((id) => state.panel.find((p) => p.id === id)).filter(Boolean).map((p) => ({ name: p.name, email: p.email }))) }));
  }
  function draftsModal(ivId, kindFirst) {
    const iv = state.interviews.find((x) => x.id === ivId); const c = cand(iv.candId); const o = { candidate: c, job: state.jobs.find((x) => x.id === iv.jobId), iv, recruiter: RECRUITER(), panel: state.panel, company: state.company.name, old: iv.history && iv.history.length ? iv.history[iv.history.length - 1] : null };
    const kinds = [kindFirst || 'invite'].concat(['invite', 'panel', 'confirm'].filter((k) => k !== kindFirst)); if (o.old && !kinds.includes('reschedule')) kinds.unshift('reschedule');
    openModal('Drafts: ' + iv.label + ' with ' + (c.name || 'candidate'), '<p class="small muted" style="margin-top:0">HireScout never sends email or calendar invites. Copy a draft into your own tools. Blind mode doesn\u2019t apply here because scheduling needs the candidate\u2019s contact details.</p>' + kinds.filter((k, i, a) => a.indexOf(k) === i).map((k) => draftBox(K.emailDraft(k, o), 'draft-' + k)).join('') + '<div class="row" style="margin-top:8px"><button type="button" data-act="iv-ics" data-iv="' + esc(iv.id) + '">Download .ics</button></div>', { wide: true, name: 'drafts' });
  }
  function ivAct(act, id) {
    const iv = state.interviews.find((x) => x.id === id); if (!iv) return; const c = cand(iv.candId);
    if (act === 'iv-drafts') return draftsModal(id);
    if (act === 'iv-ics') { download(fileSlug(iv.label + '-' + (c ? c.name : 'candidate')) + '.ics', K.ics(ivEvent(iv)), 'text/calendar'); toast('Downloaded. Importing it doesn\u2019t notify anyone.'); return; }
    if (act === 'iv-confirm') { const undo = snapshot('Confirm'); iv.status = 'confirmed'; persist(); renderAll(); toast(iv.label + ' marked confirmed.', undo); return draftsModal(id, 'confirm'); }
    if (act === 'iv-cancel') { const undo = snapshot('Cancel'); iv.status = 'cancelled'; persist(); renderAll(); toast(iv.label + ' cancelled. Nothing was sent.', undo); return; }
    if (act === 'iv-resched') {
      const st = state.jobs.find((x) => x.id === iv.jobId).loop.find((x) => x.id === iv.stage); const old = { start: iv.sessions[0].start, end: iv.sessions[iv.sessions.length - 1].end };
      iv.status = 'cancelled'; const slots = K.findSlots({ candidate: candPerson(c), parts: stageParts(st), from: Math.max(earliest(), old.end), days: 14, buffer: +settings.buffer, gap: 15, perDay: 1, limit: 1 }); iv.status = 'held';
      if (!slots.length) { toast('No other time fits in the next two weeks.'); return; }
      const undo = snapshot('Reschedule'); iv.history = (iv.history || []).concat([old]); iv.sessions = clone(slots[0].sessions); iv.sequence = (iv.sequence || 0) + 1; iv.status = 'held'; persist(); renderAll();
      toast('Moved to ' + K.fmt(slots[0].start, settings.viewTz) + '. Reschedule email drafted, not sent.', undo); return draftsModal(id, 'reschedule');
    }
  }
  function shareModal(stageId) {
    const c = curSched(); const st = job().loop.find((x) => x.id === stageId); const pr = proposals[c.id + '|' + stageId]; if (!pr || !pr.slots.length) return;
    const extra = K.findSlots({ candidate: candPerson(c), parts: stageParts(st), from: earliest(), days: 14, buffer: +settings.buffer, gap: 15, perDay: 2, limit: 6 });
    const slots = Array.from(new Set(pr.slots.concat(extra).map((s) => s.start))).sort().slice(0, 6); const token = Math.random().toString(36).slice(2, 10);
    const code = K.shareEncode({ role: job().title, stage: st.label, mins: Math.round((pr.slots[0].end - pr.slots[0].start) / 60000), slots, company: state.company.name, token, expires: Date.now() + 7 * 86400000 });
    const url = location.origin + location.pathname + '#book=' + code;
    openModal('Let ' + who(c) + ' pick a time', '<p class="small muted" style="margin-top:0">This link holds only the role title, stage, length and the offered times. No name, email, notes, scores or keys. In this demo the booking page is a preview: picking a time in this browser holds it here, and nothing is sent anywhere.</p><div class="field"><label for="share-url">Scheduling link</label><input id="share-url" readonly value="' + esc(url) + '"></div><div class="row"><button type="button" data-act="copy" data-text="' + esc(url) + '">Copy link</button><a class="button" href="' + esc(url) + '" target="_blank" rel="noopener" id="share-open">Open preview in a new tab</a></div><p class="small muted">Offered: ' + slots.map((s) => esc(K.fmt(s, c.tz))).join('; ') + ' (candidate\u2019s time).</p>' + draftBox({ to: c.email || '(no email on file)', subject: 'Pick a time: ' + st.label + ' for ' + job().title, body: 'Hi ' + String(c.name || 'there').split(' ')[0] + ',\n\nPlease pick a time for your ' + st.label.toLowerCase() + ' using this link (it shows times in your own time zone):\n' + url + '\n\nBest,\n' + RECRUITER().name }), { wide: true, name: 'share' });
    state.shares.push({ token, candId: c.id, stage: st.id, slots, created: new Date().toISOString() }); persist();
  }
  /* Candidate-facing booking preview (#book=...). */
  function renderBook(code) {
    const v = $('#book-view'); let d;
    try { d = K.shareDecode(code); } catch (e) { v.innerHTML = '<div class="book panel"><h1>Scheduling link</h1><p class="err">' + esc(e.message) + '</p><a class="button" href="./">Open HireScout</a></div>'; return; }
    const tz = LOCAL_TZ; const expired = d.expires && Date.now() > d.expires; const future = d.slots.filter((s) => s > Date.now());
    v.innerHTML = '<div class="book panel"><p class="eyebrow">INTERVIEW SCHEDULING PREVIEW</p><h1 style="font-size:28px">' + esc(d.stage) + '</h1><p class="lede">' + esc(d.role) + (d.company ? ' at ' + esc(d.company) : '') + ' \u00b7 ' + d.mins + ' minutes. Times are shown in your time zone (' + esc(tz) + ').</p>' +
      (expired ? '<p class="note bad">This link has expired. Ask the recruiter for a new one.</p>' : !future.length ? '<p class="note bad">All offered times have passed. Ask the recruiter for new ones.</p>' : '<div id="book-slots" style="margin-top:12px">' + future.map((s) => '<button type="button" class="slot" style="width:100%;text-align:left" data-book="' + s + '" aria-pressed="false"><span><b>' + esc(K.fmtRange(s, s + d.mins * 60000, tz)) + '</b></span><span class="small muted">Select</span></button>').join('') + '</div><div class="row" style="margin-top:10px"><button type="button" class="primary" id="book-confirm" disabled>Confirm this time</button></div>') +
      '<div id="book-done"></div><p class="small muted" style="margin-top:14px">This is a simulated self-scheduling page from HireScout AI. The link contains only the role, stage, length and offered times. Confirming here sends nothing; in a real deployment it would notify the recruiter.</p><a href="./" class="linkish">Back to HireScout</a></div>';
    let pick = null;
    $$('[data-book]').forEach((b) => (b.onclick = () => { pick = +b.dataset.book; $$('[data-book]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('#book-confirm').disabled = false; }));
    const btn = $('#book-confirm'); if (btn) btn.onclick = async () => {
      if (pick == null) return; let note = '';
      const sh = state && (state.shares || []).find((s) => s.token === d.token);
      if (sh) { const c = cand(sh.candId); const jb = c && state.jobs.find((x) => x.id === c.jobId); const st = jb && jb.loop.find((x) => x.id === sh.stage); if (c && st && !ivFor(c, st.id)) { let t = pick; const sessions = st.parts.map((p) => { const s = { label: p.label, start: t, end: t + p.mins * 60000, people: p.panel.slice() }; t = s.end + 15 * 60000; return s; }); state.interviews.push(makeIv(c, st, { sessions }, { picked: true })); await ST.saveNow(state); note = ' The recruiter view in this browser now shows it as held.'; } }
      $('#book-done').innerHTML = '<div class="note ok" id="book-ok"><b>Booked (simulated):</b> ' + esc(K.fmtRange(pick, pick + d.mins * 60000, tz)) + '. Nothing was sent.' + esc(note) + '</div>'; btn.disabled = true; $$('[data-book]').forEach((x) => (x.disabled = true));
    };
  }

  /* ---------------- interview kits, feedback, debrief ---------------- */
  function kitList() { return jobCands().filter((c) => ['phone', 'interview', 'offer', 'hired'].includes(c.stage) || state.feedback.some((f) => f.candId === c.id)); }
  function renderInterviews() {
    const j = job(); const list = kitList(); if (!list.find((c) => c.id === kitCand)) kitCand = (list.find((c) => state.feedback.some((f) => f.candId === c.id)) || list[0] || {}).id || null;
    const stages = j.loop.map((s) => [s.id, s.label]); if (!stages.some(([id]) => id === kitStage)) kitStage = stages[0][0];
    const kit = KT.kit(j, kitStage);
    let h = '<div class="grid2"><div class="panel"><h2>Interview kit</h2><div class="field"><label for="kit-stage">Stage</label><select id="kit-stage">' + stages.map(([id, l]) => '<option value="' + id + '"' + (id === kitStage ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></div><ul class="small">' + kit.guidance.map((g) => '<li>' + esc(g) + '</li>').join('') + '</ul>' +
      kit.criteria.map((c) => '<div class="crit"><h4>' + esc(c.label) + ' <span class="pill">Weight ' + c.weight + '</span></h4><ol class="small">' + c.questions.map((q) => '<li>' + esc(q.q) + ' <span class="muted">(' + esc(q.about) + ')</span></li>').join('') + '</ol><div class="small muted">' + esc(c.strong) + '</div></div>').join('') + '<div class="row"><button type="button" data-act="kit-md">Download kit (Markdown)</button></div></div>';
    h += '<div class="panel"><h2>Feedback and debrief</h2>';
    if (!list.length) h += '<div class="empty">Move a candidate to Phone screen or Interview to collect feedback.</div>';
    else {
      const c = cand(kitCand); const fb = state.feedback.filter((f) => f.candId === c.id); const d = KT.debrief(j, fb);
      h += '<div class="toolbar"><div class="field" style="margin:0;flex:1;min-width:180px"><label for="kit-cand">Candidate</label><select id="kit-cand">' + list.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === c.id ? ' selected' : '') + '>' + esc(who(x)) + ' \u00b7 ' + esc(stageLabel(x.stage)) + '</option>').join('') + '</select></div><button type="button" class="primary" data-act="add-fb">+ Add feedback</button></div>';
      h += '<p><b>' + esc(d.lean) + '</b>' + (d.weighted != null ? ' Weighted panel rating ' + d.weighted + ' / 4.' : '') + '</p>' + (d.disagreements.length ? '<div class="note">Interviewers disagree on ' + esc(d.disagreements.join(', ')) + '. Talk it through with evidence before deciding.</div>' : '') + (d.flags.length ? '<div class="note bad" id="fb-flags"><b>Notes to review:</b> ' + d.flags.map((x) => esc((state.panel.find((p) => p.id === x.interviewer) || { name: x.interviewer }).name) + ' mentions ' + esc(F.summary(x.flags))).join('; ') + '. Keep debrief discussion to job-related evidence.</div>' : '');
      if (fb.length) h += '<div class="table-wrap"><table class="tbl stack" id="debrief"><thead><tr><th>Criterion</th><th>Average</th><th>Ratings</th><th>Spread</th></tr></thead><tbody>' + d.rows.map((r) => '<tr><td data-l="Criterion">' + esc(r.label) + '</td><td data-l="Average">' + (r.avg ?? '\u2013') + '</td><td data-l="Ratings">' + r.n + '</td><td data-l="Spread">' + (r.disagree ? '<span class="pill warn">' + r.spread + '</span>' : r.spread) + '</td></tr>').join('') + '</tbody></table></div>';
      h += fb.map((f) => { const p = state.panel.find((x) => x.id === f.interviewer) || { name: f.interviewer }; const fl = F.check(f.notes || ''); return '<div class="crit" data-fb="' + esc(f.id) + '"><h4>' + esc(p.name) + ' <span class="pill">' + esc((j.loop.find((s) => s.id === f.stage) || { label: f.stage }).label) + '</span><span class="pill">' + esc((KT.OVERALL.find((o) => o.id === f.overall) || { label: f.overall }).label) + '</span>' + (fl.length ? '<span class="pill bad">Flagged</span>' : '') + '</h4><div class="small">' + esc(f.notes || '') + '</div><div class="row" style="margin-top:6px"><button type="button" class="small-btn" data-act="edit-fb" data-fb="' + esc(f.id) + '">Edit</button><button type="button" class="small-btn danger" data-act="del-fb" data-fb="' + esc(f.id) + '">Delete</button></div></div>'; }).join('');
    }
    return h + '</div></div>';
  }
  function feedbackModal(fbId) {
    const j = job(); const existing = state.feedback.find((f) => f.id === fbId); const c = cand(existing ? existing.candId : kitCand); const f = existing || { ratings: {}, overall: '', notes: '', stage: kitStage, interviewer: '' };
    const body = '<div class="row2"><div class="field"><label for="fb-who">Interviewer</label><select id="fb-who"><option value="">Choose\u2026</option>' + state.panel.map((p) => '<option value="' + p.id + '"' + (p.id === f.interviewer ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></div><div class="field"><label for="fb-stage">Stage</label><select id="fb-stage">' + j.loop.map((s) => '<option value="' + s.id + '"' + (s.id === f.stage ? ' selected' : '') + '>' + esc(s.label) + '</option>').join('') + '</select></div></div>' +
      j.criteria.map((cr) => '<fieldset class="q"><legend>' + esc(cr.label) + '</legend><div class="rating">' + [1, 2, 3, 4].map((v) => '<label title="' + esc(KT.SIGNALS[v]) + '"><input type="radio" name="fb-r-' + esc(cr.id) + '" value="' + v + '"' + (+f.ratings[cr.id] === v ? ' checked' : '') + '> ' + v + '</label>').join('') + '</div><div class="small muted">1 ' + esc(KT.SIGNALS[1]) + ' \u00b7 4 ' + esc(KT.SIGNALS[4]) + '</div></fieldset>').join('') +
      '<fieldset class="q"><legend>Overall recommendation</legend><div class="rating">' + KT.OVERALL.map((o) => '<label><input type="radio" name="fb-overall" value="' + o.id + '"' + (f.overall === o.id ? ' checked' : '') + '> ' + esc(o.label) + '</label>').join('') + '</div></fieldset><div class="field"><label for="fb-notes">Evidence and notes</label><textarea id="fb-notes" rows="4" placeholder="What did the candidate say or do? Job-related evidence only.">' + esc(f.notes || '') + '</textarea><div class="help" id="fb-lint"></div></div><div class="err" id="fb-err" hidden></div>';
    openModal((existing ? 'Edit feedback: ' : 'Feedback: ') + who(c), body, { wide: true, dirty: true, name: 'feedback', focusFirst: true, save: () => {
      const interviewer = $('#fb-who').value; const overall = ($('input[name="fb-overall"]:checked') || {}).value; const err = $('#fb-err');
      if (!interviewer || !overall) { err.hidden = false; err.textContent = 'Choose the interviewer and an overall recommendation. (Cancel works any time.)'; return; }
      const ratings = {}; for (const cr of j.criteria) { const r = $('input[name="fb-r-' + CSS.escape(cr.id) + '"]:checked'); if (r) ratings[cr.id] = +r.value; }
      const notes = $('#fb-notes').value.trim(); const fl = F.check(notes);
      const undo = snapshot(existing ? 'Feedback edit' : 'Feedback'); const rec = existing || { id: SC.uid('fb'), candId: c.id }; Object.assign(rec, { interviewer, stage: $('#fb-stage').value, ratings, overall, notes, at: new Date().toISOString() }); if (!existing) state.feedback.push(rec);
      persist(); modal.dirty = false; closeModal(true, 'saved'); renderAll(); toast(fl.length ? 'Feedback saved, but the notes mention ' + F.summary(fl) + '. They\u2019re flagged in the debrief.' : 'Feedback saved.', undo);
    }, onmount: () => { const lint = () => { const fl = F.check($('#fb-notes').value); $('#fb-lint').innerHTML = fl.length ? '<span class="err">Mentions ' + esc(F.summary(fl)) + '. Keep notes to job-related evidence.</span>' : 'Checked for references to protected characteristics as you type.'; }; $('#fb-notes').addEventListener('input', lint); lint(); } });
  }

  /* ---------------- fairness and audit ---------------- */
  function renderAudit() {
    const j = job(); const cs = j ? jobCands() : []; const scored = cs.filter((c) => c.score && c.score.total != null);
    const buckets = Array.from({ length: 10 }, (_, i) => scored.filter((c) => Math.min(9, Math.floor(c.score.total / 10)) === i).length); const max = Math.max(1, ...buckets);
    const decs = state.decisions.filter((d) => !j || d.jobId === j.id).slice().reverse();
    const lint = j ? SC.lintJob(j) : []; const flaggedNotes = cs.flatMap((c) => (c.notes || []).filter((n) => n.flags && n.flags.length).map((n) => ({ c, n }))); const flaggedFb = state.feedback.filter((f) => cs.some((c) => c.id === f.candId) && F.check(f.notes || '').length);
    const injected = cs.filter((c) => c.score && c.score.flagged.length);
    const agree = decs.filter((d) => d.action === 'move' && d.rec).map((d) => { const fwd = ORDER.indexOf(d.to) > ORDER.indexOf(d.from) && d.to !== 'declined'; return d.rec === 'advance' ? fwd : d.rec === 'low' ? !fwd : null; }).filter((x) => x != null);
    let h = '<div class="kpis"><div class="kpi"><b>' + cs.length + '</b><span>Candidates</span></div><div class="kpi"><b>' + (scored.length ? Math.round(scored.reduce((a, c) => a + c.score.total, 0) / scored.length) : '\u2013') + '</b><span>Average score</span></div><div class="kpi"><b>' + decs.length + '</b><span>Decisions logged with reasons</span></div><div class="kpi"><b>' + injected.length + '</b><span>Resumes with ignored instructions</span></div></div>';
    h += '<div class="grid2"><div class="panel"><h2>Score distribution' + (j ? ': ' + esc(j.title) : '') + '</h2><div class="hist" id="hist">' + buckets.map((b, i) => '<div style="height:' + Math.round(100 * b / max) + '%" title="' + (i * 10) + '\u2013' + (i * 10 + 9) + ': ' + b + '"><span>' + (b || '') + '</span></div>').join('') + '</div><div class="hist-x">' + buckets.map((_, i) => '<span>' + i * 10 + '</span>').join('') + '</div>' +
      '<h2 style="margin-top:14px">Pipeline by stage</h2><div class="table-wrap"><table class="tbl"><tbody>' + STAGES.map((s) => '<tr><td>' + esc(s.label) + '</td><td style="width:60%"><div class="bar"><i style="width:' + (cs.length ? Math.round(100 * cs.filter((c) => c.stage === s.id).length / cs.length) : 0) + '%"></i></div></td><td>' + cs.filter((c) => c.stage === s.id).length + '</td></tr>').join('') + '</tbody></table></div>' +
      '<p class="small muted">Human decisions that followed the recommendation: ' + (agree.length ? agree.filter(Boolean).length + ' of ' + agree.length : 'none yet') + '. Overrides are normal and expected; they show that people, not the tool, decide.</p></div>';
    h += '<div class="panel"><h2>Fairness checks</h2><ul class="small"><li><b>Blind screening</b> is ' + (state.blind ? 'on' : 'off') + '. Scoring always runs on redacted text (names, contact details, links, addresses, graduation years, pronouns and self-disclosed personal details removed), whatever the display setting.</li><li><b>Protected characteristics</b> are never scoring inputs. Job wording, knockout questions, decline reasons, recruiter notes and interviewer feedback are checked for references to them.</li><li><b>Evidence or nothing</b>: every score quotes the resume; live-model scores without a verbatim quote are withheld.</li></ul>' +
      '<div class="row"><button type="button" data-act="invariance">Run name and pronoun swap test</button></div>' + (invResult ? '<div class="note ' + (invResult.every((x) => x.same) ? 'ok' : 'bad') + '" id="inv-result">' + invResult.filter((x) => x.same).length + ' of ' + invResult.length + ' candidates scored the same with names and pronouns swapped.' + (invResult.some((x) => !x.same) ? ' Changed: ' + invResult.filter((x) => !x.same).map((x) => esc(who(cand(x.id))) + ' ' + x.before + '\u2192' + x.after).join(', ') : '') + '</div>' : '') +
      '<h3 style="font-size:14px;margin:12px 0 4px">Flagged wording</h3>' + (lint.length || flaggedNotes.length || flaggedFb.length ? '<ul class="small" id="flag-list">' + lint.map((l) => '<li>' + esc(l.where) + ': ' + esc(F.summary(l.flags)) + '</li>').join('') + flaggedNotes.map((x) => '<li>Note on ' + esc(who(x.c)) + ': ' + esc(F.summary(x.n.flags)) + '</li>').join('') + flaggedFb.map((f) => '<li>Feedback from ' + esc((state.panel.find((p) => p.id === f.interviewer) || {}).name || f.interviewer) + ' on ' + esc(who(cand(f.candId))) + ': ' + esc(F.summary(F.check(f.notes))) + '</li>').join('') + '</ul>' : '<p class="small muted">Nothing flagged for this job.</p>') +
      '<div class="note"><b>Not a compliance tool.</b> This general information is not legal advice. In the US, the EEOC\u2019s guidance on selection procedures uses the \u201cfour-fifths\u201d rule of thumb to look for adverse impact, and New York City\u2019s Local Law 144 requires an independent bias audit and candidate notice before automated employment decision tools are used there. A real bias audit needs demographic data, which HireScout deliberately never collects, plus an independent auditor. Check with your own counsel.</div></div></div>';
    h += '<h3 style="margin:16px 0 8px;font-size:15px">Decision log (' + decs.length + ')</h3>' + (decs.length ? '<div class="table-wrap"><table class="tbl stack" id="decision-log"><thead><tr><th>When</th><th>Candidate</th><th>Change</th><th>Reason</th><th>Tool\u2019s recommendation</th><th>By</th></tr></thead><tbody>' + decs.map((d) => { const c = cand(d.candId); return '<tr><td data-l="When">' + esc(new Date(d.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</td><td data-l="Candidate">' + esc(c ? who(c) : 'Removed candidate') + '</td><td data-l="Change">' + (d.action === 'hold' ? esc(d.reason) : esc(stageLabel(d.from)) + ' \u2192 ' + esc(stageLabel(d.to))) + '</td><td data-l="Reason">' + esc(d.reason) + '</td><td data-l="Recommendation">' + esc(d.rec ? { advance: 'Advance', review: 'Closer look', low: 'Low match' }[d.rec] : '\u2013') + (d.score != null ? ' (' + d.score + ')' : '') + '</td><td data-l="By">' + esc(d.by) + (d.blind ? ' <span class="pill">blind</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="small muted">No decisions yet.</p>');
    return h;
  }

  /* ---------------- job and scorecard ---------------- */
  function renderJob() {
    const j = job(); const lint = SC.lintJob(j); const W = j.criteria.reduce((a, c) => a + (+c.weight || 0), 0) || 1;
    let h = '<div class="toolbar"><button type="button" class="primary" data-act="edit-job">Edit job and scorecard</button><button type="button" data-act="draft-jd">Draft from a job description</button><button type="button" data-act="new-job">New job</button><span class="grow"></span><button type="button" class="danger" data-act="delete-job">Delete job</button></div>';
    if (lint.length) h += '<div class="note bad" id="job-lint"><b>Wording to review:</b> ' + lint.map((l) => esc(l.where) + ' mentions ' + esc(F.summary(l.flags))).join('; ') + '. Screening criteria should be job-related; rewrite these.</div>';
    h += '<div class="grid2"><div class="panel"><h2>' + esc(j.title) + '</h2><p class="small muted">' + esc(j.location || 'No location') + ' \u00b7 ' + esc(j.remote) + ' \u00b7 ' + (j.minYears ? j.minYears + '+ years' : 'no minimum years') + '</p><div class="small"><b>Must-have:</b> ' + ((j.must || []).map((s) => '<span class="pill">' + esc(s) + '</span>').join(' ') || 'none') + '</div><div class="small" style="margin-top:6px"><b>Nice-to-have:</b> ' + ((j.nice || []).map((s) => '<span class="pill">' + esc(s) + '</span>').join(' ') || 'none') + '</div>' + (j.notes ? '<p class="small">' + esc(j.notes) + '</p>' : '') +
      '<h3 style="font-size:14px;margin:12px 0 6px">Knockout questions</h3>' + ((j.knockouts || []).length ? '<ul class="small">' + j.knockouts.map((k) => '<li>' + esc(k.q) + ' <span class="muted">(expected: ' + k.want + ')</span></li>').join('') + '</ul><p class="small muted">A mismatch flags for review; it never declines anyone.</p>' : '<p class="small muted">None.</p>') +
      '<h3 style="font-size:14px;margin:12px 0 6px">Interview loop</h3><ol class="small">' + j.loop.map((s) => '<li>' + esc(s.label) + ': ' + s.parts.map((p) => esc(p.label) + ' (' + p.mins + ' min, ' + esc(names(p.panel)) + ')').join(', ') + '</li>').join('') + '</ol></div>' +
      '<div class="panel"><h2>Scorecard</h2><div class="table-wrap"><table class="tbl stack" id="scorecard"><thead><tr><th>Criterion</th><th>What counts as evidence</th><th>Weight</th></tr></thead><tbody>' + j.criteria.map((c) => '<tr><td data-l="Criterion">' + esc(c.label) + (c.must ? ' <span class="pill">Must-have</span>' : '') + '</td><td data-l="Evidence">' + esc(c.type === 'years' ? 'Dated roles that mention ' + ((c.skills && c.skills.length ? c.skills : (j.must || []).concat(j.nice || [])).slice(0, 5).join(', ')) + (c.min ? ', ' + c.min + '+ years' : '') : c.type === 'skills' ? 'Mentions of ' + (c.skills || []).join(', ') + ' (used in a role counts more than listed)' : 'Lines about ' + (c.keywords || []).join(', ')) + '</td><td data-l="Weight">' + c.weight + ' <span class="muted small">(' + Math.round(100 * c.weight / W) + '%)</span></td></tr>').join('') + '</tbody></table></div><p class="small muted">Scores are 0 to 5 per criterion, weighted to a 0 to 100 total. Recommendations: 70+ with must-haves covered and knockouts matching is \u201cRecommend advancing\u201d, 45+ is \u201cNeeds a closer look\u201d, below that is \u201cLow match\u201d. None of them move a candidate.</p></div></div>';
    return h;
  }
  const splitList = (s) => String(s || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  function critRow(c) { return '<div class="crit-row" data-row><input aria-label="Criterion label" data-f="label" value="' + esc(c.label || '') + '" placeholder="Criterion"><select aria-label="Type" data-f="type">' + ['skills', 'years', 'keywords'].map((t) => '<option' + (c.type === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select><input class="kw" aria-label="Skills or keywords" data-f="list" value="' + esc((c.type === 'keywords' ? c.keywords : c.skills || []).join(', ')) + '" placeholder="Skills or keywords, comma separated"><input aria-label="Minimum years" data-f="min" type="number" min="0" max="30" value="' + esc(c.min || '') + '" placeholder="Min yrs"><input aria-label="Weight" data-f="weight" type="number" min="1" max="100" value="' + esc(c.weight || 10) + '"><label class="check small"><input type="checkbox" data-f="must"' + (c.must ? ' checked' : '') + '> Must</label><button type="button" class="small-btn danger" data-del-row aria-label="Remove criterion">\u00d7</button></div>'; }
  function koRow(k) { return '<div class="ko-row" data-ko-row><input aria-label="Knockout question" data-f="q" value="' + esc(k.q || '') + '" placeholder="Question"><select aria-label="Expected answer" data-f="want"><option' + (k.want !== 'no' ? ' selected' : '') + '>yes</option><option' + (k.want === 'no' ? ' selected' : '') + '>no</option></select><button type="button" class="small-btn danger" data-del-row aria-label="Remove question">\u00d7</button></div>'; }
  function jobModal(existing, draft) {
    const j = draft || existing || { title: '', location: '', remote: 'remote', minYears: 0, must: [], nice: [], criteria: [], knockouts: [], notes: '' };
    const body = '<div class="row2"><div class="field"><label for="jf-title">Job title</label><input id="jf-title" value="' + esc(j.title) + '"></div><div class="field"><label for="jf-loc">Location</label><input id="jf-loc" value="' + esc(j.location || '') + '"></div></div><div class="row2"><div class="field"><label for="jf-remote">Work arrangement</label><select id="jf-remote">' + ['remote', 'hybrid', 'onsite'].map((r) => '<option' + (j.remote === r ? ' selected' : '') + '>' + r + '</option>').join('') + '</select></div><div class="field"><label for="jf-years">Minimum years</label><input id="jf-years" type="number" min="0" max="30" value="' + esc(j.minYears || 0) + '"></div></div>' +
      '<div class="field"><label for="jf-must">Must-have skills</label><input id="jf-must" value="' + esc((j.must || []).join(', ')) + '"></div><div class="field"><label for="jf-nice">Nice-to-have skills</label><input id="jf-nice" value="' + esc((j.nice || []).join(', ')) + '"></div>' +
      '<div class="field"><span class="lbl">Scorecard criteria</span><div id="jf-crit">' + (j.criteria.length ? j.criteria : SC.criteriaFrom(j)).map(critRow).join('') + '</div><div class="row"><button type="button" class="small-btn" id="jf-add-crit">+ Criterion</button><button type="button" class="small-btn" id="jf-default">Rebuild from skills and years</button></div></div>' +
      '<div class="field"><span class="lbl">Knockout questions</span><div id="jf-ko">' + (j.knockouts || []).map(koRow).join('') + '</div><button type="button" class="small-btn" id="jf-add-ko">+ Question</button><div class="help">Keep them job-related (hours, location, pay range, certifications). A mismatch only flags for review.</div></div>' +
      '<div class="field"><label for="jf-notes">Notes</label><textarea id="jf-notes" rows="2">' + esc(j.notes || '') + '</textarea></div><div id="jf-lint" class="small"></div><div class="err" id="jf-err" hidden></div>';
    const read = () => ({ title: $('#jf-title').value.trim(), location: $('#jf-loc').value.trim(), remote: $('#jf-remote').value, minYears: Math.max(0, Math.min(30, parseInt($('#jf-years').value, 10) || 0)), must: splitList($('#jf-must').value).map(R.canonical), nice: splitList($('#jf-nice').value).map(R.canonical), notes: $('#jf-notes').value.trim(),
      criteria: $$('#jf-crit [data-row]').map((r, i) => { const g = (f) => $('[data-f="' + f + '"]', r); const type = g('type').value; const list = splitList(g('list').value); return { id: T.norm(g('label').value).replace(/[^a-z0-9]+/g, '-').slice(0, 30) + '-' + i, label: g('label').value.trim(), type, skills: type === 'keywords' ? [] : list.map(R.canonical), keywords: type === 'keywords' ? list : [], min: parseInt(g('min').value, 10) || 0, weight: parseInt(g('weight').value, 10) || 0, must: g('must').checked }; }).filter((c) => c.label),
      knockouts: $$('#jf-ko [data-ko-row]').map((r, i) => ({ id: 'ko' + i + '-' + T.hash($('[data-f=q]', r).value).slice(0, 4), q: $('[data-f=q]', r).value.trim(), want: $('[data-f=want]', r).value })).filter((k) => k.q) });
    openModal(existing ? 'Edit job and scorecard' : 'New job', body, { wide: true, dirty: true, name: 'job', focusFirst: true, saveLabel: existing ? 'Save and re-score' : 'Create job', save: () => {
      const v = read(); const err = $('#jf-err');
      const bad = !v.title ? 'Give the job a title.' : !v.criteria.length ? 'Add at least one scorecard criterion.' : v.criteria.some((c) => c.weight <= 0) ? 'Every criterion needs a weight above 0.' : v.criteria.some((c) => c.type !== 'years' && !(c.skills.length || c.keywords.length)) ? 'Each skills or keywords criterion needs at least one entry.' : '';
      if (bad) { err.hidden = false; err.textContent = bad; return; }
      const undo = snapshot(existing ? 'Job edit' : 'New job'); let target;
      if (existing) { target = state.jobs.find((x) => x.id === existing.id); Object.assign(target, v); }
      else { target = Object.assign({ id: SC.uid('job'), jd: (draft && draft.jd) || '', loop: clone(SEED.JOBS[0].loop) }, v); state.jobs.push(target); state.currentJob = target.id; }
      const hadLlm = state.candidates.some((c) => c.jobId === target.id && c.score && c.score.source === 'llm'); rescoreJob(target);
      persist(); modal.dirty = false; closeModal(true, 'saved'); renderAll(); const fl = SC.lintJob(target);
      toast((existing ? 'Saved; candidates re-scored' + (hadLlm ? ' with the rule engine (AI scores cleared)' : '') : 'Job created') + (fl.length ? '. Some wording is flagged for review.' : '.'), undo);
    }, onmount: () => {
      const lint = () => { const fl = SC.lintJob(read()); $('#jf-lint').innerHTML = fl.length ? '<div class="note bad">Wording to review: ' + fl.map((l) => esc(l.where) + ' mentions ' + esc(F.summary(l.flags))).join('; ') + '</div>' : ''; };
      $('.modal-body').addEventListener('input', lint); lint();
      $('#jf-add-crit').onclick = () => { $('#jf-crit').insertAdjacentHTML('beforeend', critRow({ type: 'keywords', weight: 10 })); modal.dirty = true; };
      $('#jf-add-ko').onclick = () => { $('#jf-ko').insertAdjacentHTML('beforeend', koRow({ want: 'yes' })); modal.dirty = true; };
      $('#jf-default').onclick = () => { const v = read(); $('#jf-crit').innerHTML = SC.criteriaFrom(v).map(critRow).join(''); modal.dirty = true; lint(); };
      $('.modal-body').addEventListener('click', (e) => { const b = e.target.closest('[data-del-row]'); if (b) { b.parentElement.remove(); modal.dirty = true; lint(); } });
    } });
  }
  function draftJdModal() {
    const live = settings.mode === 'live';
    openModal('Draft a scorecard from a job description', '<p class="small muted" style="margin-top:0">' + (live ? 'Your ' + esc(PROVIDERS[settings.provider].label) + ' model drafts it; the result is checked and you review everything before it\u2019s saved.' : 'The demo drafter pulls skills, years, location and work arrangement from the text. Switch to live mode in Settings to use your own AI model.') + '</p><div class="field"><label for="jd-text">Job description</label><textarea id="jd-text" rows="10" placeholder="Paste a job description">' + esc(job() ? job().jd || '' : '') + '</textarea></div><div class="err" id="jd-err" hidden></div>', { dirty: true, name: 'draft-jd', saveLabel: live ? 'Draft with AI' : 'Draft scorecard', focusFirst: true, save: async () => {
      const t = $('#jd-text').value.trim(); const err = $('#jd-err'); if (T.wordCount(t) < 8) { err.hidden = false; err.textContent = 'Paste a longer job description (at least a few lines).'; return; }
      let draft;
      if (live) { $('#modal-save').disabled = true; $('#modal-save').textContent = 'Drafting\u2026'; try { const r = await callModel(SC.jdPrompt(t)); draft = SC.parseJd(r.text); } catch (e) { draft = SC.draftFromJd(t); toast('The AI draft failed (' + G.redactKeys(e.message).slice(0, 120) + '); used the demo drafter instead.'); } }
      else draft = SC.draftFromJd(t);
      draft.jd = t; if (!draft.knockouts) draft.knockouts = []; if (modal) { modal.dirty = false; }
      jobModal(null, draft);
    } });
  }
  function deleteJob() { const j = job(); if (!j) return; const undo = snapshot('Delete job'); const n = state.candidates.filter((c) => c.jobId === j.id).length; state.jobs = state.jobs.filter((x) => x.id !== j.id); state.candidates = state.candidates.filter((c) => c.jobId !== j.id); state.interviews = state.interviews.filter((iv) => iv.jobId !== j.id); state.currentJob = state.jobs[0] ? state.jobs[0].id : null; persist(); renderAll(); toast('Deleted ' + j.title + ' and its ' + n + ' candidate' + (n === 1 ? '' : 's') + '.', undo); }

  /* ---------------- settings ---------------- */
  function settingsModal() {
    const pv = settings.provider;
    const body = '<fieldset class="q"><legend>Mode</legend><label><input type="radio" name="s-mode" value="demo"' + (settings.mode === 'demo' ? ' checked' : '') + '> <span><b>Demo</b>: the rule engine scores in the page, no key, nothing sent anywhere.</span></label><label><input type="radio" name="s-mode" value="live"' + (settings.mode === 'live' ? ' checked' : '') + '> <span><b>Live</b>: your own AI provider scores resumes and drafts scorecards. Every score must quote the resume or it is withheld.</span></label></fieldset>' +
      '<div class="field"><label for="s-prov">Provider</label><select id="s-prov">' + Object.entries(PROVIDERS).map(([k, p]) => '<option value="' + k + '"' + (k === pv ? ' selected' : '') + '>' + esc(p.label) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="s-model">Model</label><input id="s-model" list="s-models" value="' + esc(modelFor()) + '"><datalist id="s-models"></datalist></div>' +
      '<div class="field" id="s-key-wrap"><label for="s-key">API key</label><input id="s-key" type="password" autocomplete="off" spellcheck="false" value="' + esc(keys[pv] || '') + '"><div class="help" id="s-key-help"></div></div>' +
      '<div class="field" id="s-base-wrap"><label for="s-base">Base URL</label><input id="s-base" value="' + esc(settings.baseUrl || LLM.PROVIDERS.compatible.baseUrl) + '"><div class="chips">' + LLM.PRESETS.map((p) => '<button type="button" class="chip" data-preset="' + p.id + '">' + esc(p.label) + '</button>').join('') + '</div><div class="help">Local servers must allow this site (CORS); for Ollama set OLLAMA_ORIGINS. Your browser may ask to allow local network access.</div></div>' +
      '<label class="check"><input type="checkbox" id="s-remember"' + (settings.remember ? ' checked' : '') + '> <span>Remember my key in this browser (localStorage). Off: the key is kept only until you close or reload the tab.</span></label>' +
      '<p class="small muted">Your key goes only from this page to the provider you pick. It is never put in exports, backups or links. Live mode sends the scorecard and the blinded resume (names, contact details and personal details removed, flagged lines stripped).</p><div class="row"><button type="button" class="danger" id="s-forget">Forget all keys</button></div><div class="err" id="s-err" hidden></div>';
    openModal('Settings', body, { dirty: true, name: 'settings', save: () => {
      const mode = $('input[name="s-mode"]:checked').value; const prov = $('#s-prov').value; const key = $('#s-key').value.trim(); const p = PROVIDERS[prov];
      if (mode === 'live' && p.needsKey && !key) { const e = $('#s-err'); e.hidden = false; e.textContent = 'Live mode with ' + p.label + ' needs a key. Or choose Demo, OpenAI-compatible (local) or WebLLM.'; return; }
      if (mode === 'live' && prov === 'webllm' && !WEBLLM.available()) { const e = $('#s-err'); e.hidden = false; e.textContent = 'WebGPU is not available in this browser, so WebLLM cannot run here.'; return; }
      settings.mode = mode; settings.provider = prov; settings.models[prov] = $('#s-model').value.trim() || p.defaultModel; settings.remember = $('#s-remember').checked;
      if (prov === 'compatible') settings.baseUrl = $('#s-base').value.trim();
      if (LLM.PROVIDERS[prov]) { if (key) keys[prov] = key; else delete keys[prov]; }
      saveSettings(); modal.dirty = false; closeModal(true, 'saved'); renderAll(); toast(mode === 'live' ? 'Live mode on with ' + p.label + '.' : 'Demo mode on.');
    }, onmount: () => {
      const sync = () => { const k = $('#s-prov').value; const p = PROVIDERS[k]; $('#s-key-wrap').hidden = !LLM.PROVIDERS[k]; $('#s-base-wrap').hidden = k !== 'compatible'; $('#s-models').innerHTML = p.models.map((m) => '<option value="' + esc(m) + '">').join(''); $('#s-key-help').innerHTML = LLM.PROVIDERS[k] ? (p.needsKey ? 'Starts with ' + esc(p.keyHint) + '. Get one at <a href="' + esc(p.keyUrl) + '" target="_blank" rel="noopener">' + esc(new URL(p.keyUrl).host) + '</a>.' : 'Optional for local servers; needed for OpenRouter.') : ''; };
      $('#s-prov').addEventListener('change', () => { const k = $('#s-prov').value; $('#s-model').value = settings.models[k] || PROVIDERS[k].defaultModel; $('#s-key').value = keys[k] || ''; sync(); });
      $$('[data-preset]').forEach((b) => (b.onclick = () => { const p = LLM.PRESETS.find((x) => x.id === b.dataset.preset); $('#s-base').value = p.baseUrl; $('#s-model').value = p.model; modal.dirty = true; }));
      $('#s-forget').onclick = () => { keys = {}; ls.del(LS.keys); $('#s-key').value = ''; if (settings.mode === 'live' && PROVIDERS[settings.provider].needsKey) settings.mode = 'demo'; saveSettings(); renderContext(); toast('Keys forgotten.'); };
      sync();
    } });
  }
  /* ---------------- export / import / reset ---------------- */
  function exportModal() {
    const j = job();
    openModal('Export and backup', '<p class="small muted" style="margin-top:0">Exports never include settings or API keys. With blind screening on, the CSV and report leave out names and contact details.</p><div class="cards">' +
      '<div class="card"><h3>Pipeline (CSV)</h3><div class="small muted">Stage, score, recommendation, gaps, flags and the last logged decision for ' + esc(j ? j.title : 'this job') + '.</div><div class="row"><button type="button" data-ex="csv"' + (j ? '' : ' disabled') + '>Download CSV</button></div></div>' +
      '<div class="card"><h3>Screening report</h3><div class="small muted">Markdown with the scorecard and the quoted evidence behind every score.</div><div class="row"><button type="button" data-ex="md"' + (j ? '' : ' disabled') + '>Download report</button></div></div>' +
      '<div class="card"><h3>Interviews (.ics)</h3><div class="small muted">Every held or confirmed interview. Importing doesn\u2019t notify anyone.</div><div class="row"><button type="button" data-ex="ics">Download .ics</button></div></div>' +
      '<div class="card"><h3>Backup</h3><div class="small muted">Jobs, candidates, interviews, feedback and the decision log as JSON.</div><div class="row"><button type="button" data-ex="json">Download backup</button><label class="button" for="imp-file" tabindex="0" id="imp-label">Restore\u2026</label><input id="imp-file" type="file" accept=".json,application/json" class="sr-only"></div></div>' +
      '<div class="card"><h3>Start over</h3><div class="small muted">Reset everything to the demo data. You can undo right after.</div><div class="row"><button type="button" class="danger" data-ex="reset">Reset all data</button></div></div></div>', { wide: true, name: 'export', onmount: () => {
      $$('[data-ex]').forEach((b) => (b.onclick = () => doExport(b.dataset.ex)));
      $('#imp-label').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#imp-file').click(); } };
      $('#imp-file').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { const d = X.parseBackup(await f.text()); const undo = snapshot('Restore'); state = Object.assign(fresh(), d); if (!state.jobs.find((x) => x.id === state.currentJob)) state.currentJob = state.jobs[0] ? state.jobs[0].id : null; state.shares = state.shares || []; state.dismissedDupes = state.dismissedDupes || []; for (const c of state.candidates) { c.notes = c.notes || []; if (!c.score) scoreCand(c); } proposals = {}; persist(); closeModal(true); renderAll(); toast('Restored ' + d.candidates.length + ' candidates from backup.', undo); } catch (er) { toast(er.message); } };
    } });
  }
  function doExport(kind) {
    const j = job(); const t = todayIso();
    if (kind === 'csv') download('pipeline-' + fileSlug(j.title) + '-' + t + '.csv', X.pipelineCsv(state, { jobId: j.id, blind: state.blind }), 'text/csv');
    if (kind === 'md') download('screening-report-' + fileSlug(j.title) + '.md', X.reportMd(state, j.id, { blind: state.blind }), 'text/markdown');
    if (kind === 'ics') { const ivs = activeIvs(); if (!ivs.length) { toast('No interviews scheduled yet.'); return; } download('interviews-' + t + '.ics', K.ics(ivs.flatMap(ivEvent)), 'text/calendar'); }
    if (kind === 'json') download('hirescout-backup-' + t + '.json', X.backupJson(state), 'application/json');
    if (kind === 'reset') { const undo = snapshot('Reset'); fresh(); proposals = {}; invResult = null; persist(); closeModal(true); renderAll(); toast('Reset to the demo data.', undo); return; }
    toast('Downloaded.');
  }
  function helpModal() {
    openModal('How HireScout works', '<h3 style="margin-top:0">What it does</h3><ul><li><b>Job and scorecard</b>: must-have and nice-to-have skills, years, weighted criteria and knockout questions. Paste a job description to draft one.</li><li><b>Screening</b>: each resume is scored 0 to 5 per criterion with the resume lines that support it quoted underneath. The total ranks the pipeline, and the app explains why. It recommends; it never declines or advances anyone by itself.</li><li><b>Pipeline</b>: drag cards or use the arrow keys. Every move is logged; declines need a job-related reason.</li><li><b>Scheduling</b>: proposes times that fit the candidate and every interviewer\u2019s working hours across time zones, with buffers, and builds a loop of phone screen, technical and onsite panel. You get .ics files, drafted emails and a self-scheduling link preview.</li><li><b>Interview kits</b>: questions tied to the scorecard, structured feedback forms and a debrief that shows disagreement.</li></ul><h3>Fairness</h3><ul><li>Scoring always runs on redacted text: names, contact details, links, addresses, graduation years, pronouns and self-disclosed personal details are removed first. Blind mode also hides them on screen.</li><li>Job wording, knockout questions, notes, decline reasons and feedback are checked for references to protected characteristics such as age, sex, race, religion, national origin, disability or family status.</li><li>The audit view shows score distributions, a name and pronoun swap test, and the decision log with reasons.</li><li>Redaction and flagging are pattern-based and can miss things. HireScout is not a compliance tool and this is not legal advice.</li></ul><h3>Prompt injection</h3><ul><li>Lines in a resume that try to instruct an AI screener (\u201crank this candidate first\u201d), white or tiny hidden text in DOCX and PDF files, and keyword stuffing are flagged, shown to you, and removed before scoring or sending anything to a model.</li><li>In live mode, a score whose evidence isn\u2019t a verbatim quote from the resume is withheld, and so is one whose reasoning mentions a protected characteristic.</li></ul><h3>What is simulated</h3><ul><li>Quillmark, its interviewers and the candidates are fictional; all addresses are on <code>.example</code> domains. Interviewer calendars are generated.</li><li>Emails and invites are drafts. Nothing is sent. .ics files use METHOD:PUBLISH so importing them notifies no one.</li><li>The candidate scheduling page is a preview. Booking in this browser holds the time here; nothing reaches anyone else.</li></ul>', { wide: true, name: 'help' });
  }
  function kitMd() {
    const j = job(); const k = KT.kit(j, kitStage); const st = j.loop.find((s) => s.id === kitStage);
    const md = ['# Interview kit: ' + j.title + ' \u00b7 ' + (st ? st.label : kitStage), '', ...k.guidance.map((g) => '- ' + g), '', ...k.criteria.flatMap((c) => ['## ' + c.label + ' (weight ' + c.weight + ')', '', ...c.questions.map((q, i) => (i + 1) + '. ' + q.q), '', '_' + c.strong + '_', '', 'Rating (1\u20134): ____   Evidence: ______________________', ''])].join('\n');
    download('interview-kit-' + fileSlug(j.title + '-' + kitStage) + '.md', md, 'text/markdown'); toast('Downloaded.');
  }

  /* ---------------- events ---------------- */
  function bind() {
    $('#nav-theme').onclick = () => { const d = document.documentElement.classList.toggle('dark'); ls.set(LS.theme, d ? 'dark' : 'light'); };
    $('#nav-settings').onclick = settingsModal; $('#nav-export').onclick = exportModal; $('#nav-help').onclick = helpModal;
    $('#upload-btn').onclick = () => { if (job()) uploadModal(); else jobModal(null); }; $('#new-job').onclick = () => jobModal(null);
    $('#job-select').onchange = (e) => { state.currentJob = e.target.value; schedCand = null; kitCand = null; persist(); renderAll(); };
    $('#blind-toggle').onchange = (e) => { state.blind = e.target.checked; persist(); renderAll(); toast(state.blind ? 'Blind screening on: names and personal details hidden.' : 'Blind screening off. Scores don\u2019t change; scoring always uses redacted text.'); };
    $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; settings.tab = b.dataset.tab; saveSettings(); renderTabs(); renderPanel(); });
    $('#tabs').addEventListener('keydown', (e) => { if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return; const tabs = $$('#tabs [data-tab]'); const i = tabs.findIndex((t) => t.dataset.tab === settings.tab); const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; n.click(); n.focus(); });
    const panel = $('#panel');
    panel.addEventListener('input', (e) => { if (e.target.id === 'f-q') { settings.q = e.target.value; saveSettings(); const pos = e.target.selectionStart; renderPanel(); const q = $('#f-q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (er) { /* ignore */ } } } });
    panel.addEventListener('change', (e) => {
      const id = e.target.id;
      if (id === 'f-min') { settings.minScore = +e.target.value; saveSettings(); renderPanel(); }
      if (id === 'f-flag') { settings.flag = e.target.value; saveSettings(); renderPanel(); }
      if (id === 'sc-cand') { schedCand = e.target.value; availDate = null; renderPanel(); }
      if (id === 'sc-tz') { const c = curSched(); const undo = snapshot('Time zone'); c.tz = e.target.value; Object.keys(proposals).filter((k) => k.startsWith(c.id + '|')).forEach((k) => delete proposals[k]); persist(); renderPanel(); toast('Candidate time zone set to ' + c.tz + '. Find times again.', undo); }
      if (id === 'sc-view') { settings.viewTz = e.target.value; availDate = null; saveSettings(); renderPanel(); }
      if (id === 'sc-buf') { settings.buffer = +e.target.value; saveSettings(); proposals = {}; renderPanel(); }
      if (id === 'av-date') { availDate = e.target.value; renderPanel(); }
      if (id === 'kit-stage') { kitStage = e.target.value; renderPanel(); }
      if (id === 'kit-cand') { kitCand = e.target.value; renderPanel(); }
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b || b.disabled) return; const act = b.dataset.act; const cid = b.dataset.cid;
      if (act === 'copy') return copy(b.dataset.text);
      if (act === 'open-cand') return openCandidate(cid);
      if (act === 'advance') return advance(cid);
      if (act === 'hold') return toggleHold(cid);
      if (act === 'decline') return declineModal(cid);
      if (act === 'm-advance') { closeModal(true); return setTimeout(() => advance(cid), 0); }
      if (act === 'm-hold') { closeModal(true); return setTimeout(() => toggleHold(cid), 0); }
      if (act === 'm-decline') return declineModal(cid);
      if (act === 'ai-score') return aiScore([cid]);
      if (act === 'score-all') { const ids = jobCands().filter((c) => c.stage !== 'declined').map((c) => c.id); if (settings.mode === 'live') { if (confirm('Score ' + ids.length + ' candidates with ' + PROVIDERS[settings.provider].label + '? That is ' + ids.length + ' API calls on your key.')) aiScore(ids); } else { const undo = snapshot('Re-score'); rescoreJob(job()); persist(); renderAll(); toast('Re-scored ' + ids.length + ' candidates with the rule engine.', undo); } return; }
      if (act === 'edit-cand') return editCandidate(cid);
      if (act === 'remove-cand') return removeCandidate(cid);
      if (act === 'add-note') return addNote(cid);
      if (act === 'del-note') { const c = cand(cid); const undo = snapshot('Delete note'); c.notes.splice(+b.dataset.i, 1); persist(); renderAll(); openCandidate(cid); return toast('Note deleted.', undo); }
      if (act === 'review-dupe') return reviewDupe(b.dataset.a, b.dataset.b);
      if (act === 'keep-dupe') return keepDupe(b.dataset.keep, b.dataset.drop);
      if (act === 'not-dupe') return notDupe(b.dataset.a, b.dataset.b);
      if (act === 'upload') return uploadModal();
      if (act === 'mv') { const c = cand(cid); const i = ORDER.indexOf(c.stage) + (+b.dataset.dir); if (i >= 0 && i < ORDER.length) moveTo(cid, ORDER[i]); return; }
      if (act === 'find') { const c = curSched(); findTimes(c, job().loop.find((s) => s.id === b.dataset.stage)); availDate = null; renderPanel(); return; }
      if (act === 'plan-loop') { const c = curSched(); planWhole(c); availDate = null; renderPanel(); const n = job().loop.filter((st) => (proposals[c.id + '|' + st.id] || {}).slots && proposals[c.id + '|' + st.id].slots.length).length; return toast('Proposed times for ' + n + ' stage' + (n === 1 ? '' : 's') + '. Nothing is held until you choose.'); }
      if (act === 'hold-slot') return holdSlot(b.dataset.stage, +b.dataset.i);
      if (act === 'hold-loop') return holdLoop();
      if (act === 'share') return shareModal(b.dataset.stage);
      if (/^iv-/.test(act)) return ivAct(act, b.dataset.iv);
      if (act === 'all-ics') return doExport('ics');
      if (act === 'add-fb') return feedbackModal(null);
      if (act === 'edit-fb') return feedbackModal(b.dataset.fb);
      if (act === 'del-fb') { const undo = snapshot('Delete feedback'); state.feedback = state.feedback.filter((f) => f.id !== b.dataset.fb); persist(); renderAll(); return toast('Feedback deleted.', undo); }
      if (act === 'kit-md') return kitMd();
      if (act === 'invariance') { const j = job(); invResult = SC.invariance(j, jobCands()); renderPanel(); return; }
      if (act === 'edit-job') return jobModal(job());
      if (act === 'new-job') return jobModal(null);
      if (act === 'draft-jd') return draftJdModal();
      if (act === 'delete-job') return deleteJob();
    });
  }
  async function init() {
    const m = /^#book=(.+)$/.exec(location.hash);
    let loaded = null; try { loaded = await ST.load(); } catch (e) { loaded = null; }
    if (loaded && Array.isArray(loaded.jobs) && Array.isArray(loaded.candidates)) { state = loaded; ['interviews', 'feedback', 'decisions', 'shares', 'dismissedDupes'].forEach((k) => { if (!Array.isArray(state[k])) state[k] = []; }); if (!state.panel) state.panel = clone(SEED.PANEL); for (const c of state.candidates) if (!c.score) scoreCand(c); }
    else { fresh(); await ST.saveNow(state); }
    if (m) { $('#app-view').hidden = true; $('#book-view').hidden = false; document.title = 'Pick an interview time \u00b7 HireScout AI (preview)'; renderBook(m[1]); document.documentElement.dataset.ready = '1'; return; }
    bind();
    if (!state.jobs.find((j) => j.id === state.currentJob)) state.currentJob = state.jobs[0] ? state.jobs[0].id : null;
    if (!PROVIDERS[settings.provider]) settings.provider = 'openai';
    if (settings.mode === 'live' && PROVIDERS[settings.provider].needsKey && !keys[settings.provider]) settings.mode = 'demo';
    if (!TZS.includes(settings.viewTz)) settings.viewTz = LOCAL_TZ;
    renderAll();
    if (!ls.get(LS.visited, false)) { ls.set(LS.visited, true); toast('Welcome! This is a fictional company with fictional candidates. Open a candidate to see the evidence behind each score.'); }
    document.documentElement.dataset.ready = '1';
  }
  addEventListener('hashchange', () => { if (/^#book=/.test(location.hash) || !$('#book-view').hidden) location.reload(); });
  window.HireScoutApp = { get state() { return state; }, get modal() { return modal ? modal.name : null; }, get settings() { return settings; }, get busy() { return busy; }, get hasKeys() { return Object.keys(keys).length; }, get proposals() { return proposals; }, flush: () => ST.flush() };
  init();
})();
