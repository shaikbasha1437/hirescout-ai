/* HireScout interview kits: role-specific questions tied to scorecard criteria, structured feedback forms and a
   debrief that aggregates ratings, surfaces disagreement, and flags notes that stray into protected territory. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./fairness.js'));
  else (root.HS = root.HS || {}).kits = factory(root.HS.fairness);
})(typeof self !== 'undefined' ? self : this, function (F) {
  'use strict';
  const BANK = {
    'React': ['Walk me through how you\u2019d split a complex editor screen into React components. Where does state live and why?', 'Tell me about a React performance problem you diagnosed. How did you find it and what changed?'],
    'TypeScript': ['How do you type a component API so misuse fails at compile time? Show an example you\u2019ve used.', 'When have you chosen not to add stricter types, and what was the trade-off?'],
    'Testing': ['How do you decide between unit, integration and end-to-end tests for a new feature?', 'Describe a flaky test you fixed. What was the root cause?'],
    'Accessibility': ['How would you make a custom dropdown usable with a keyboard and a screen reader?', 'Tell me about an accessibility issue you found late. How did you fix it and prevent it next time?'],
    'Design systems': ['How do you evolve a shared component without breaking the teams that use it?'], 'GraphQL': ['How do you handle loading, error and cache invalidation with a GraphQL client?'],
    'Node.js': ['Describe a Node.js service you built or maintained. How did you handle errors and timeouts?'], 'Web performance': ['Which metrics do you watch for page speed, and what\u2019s the biggest improvement you\u2019ve shipped?'],
    'SQL': ['Given orders and customers tables, how would you find customers whose spend dropped by half quarter over quarter?', 'How do you check that a query\u2019s result is actually right?'],
    'Data visualization': ['Tell me about a dashboard people actually used. What did you leave out on purpose?'], 'Statistics': ['How would you explain a confidence interval to a store manager?', 'When is a difference in an A/B test not worth acting on?'],
    'dbt': ['How do you structure and test dbt models so analysts trust them?'], 'Python': ['What do you reach for Python for that SQL can\u2019t do well?'], 'A/B testing': ['Walk me through designing an experiment for a pricing change, including sample size.'],
    _years: ['Pick the project from your recent roles you\u2019re proudest of. What was your part, and what would you do differently?', 'Tell me about a time scope changed late. How did you respond?'],
    _mentoring: ['Tell me about someone you helped grow. What did you do, and what changed for them?', 'How do you give feedback on code to someone more junior?'],
    _collab: ['Describe a disagreement with a designer or product manager. How was it resolved?', 'How do you explain a technical trade-off to a non-engineer?'],
    _generic: ['Tell me about a time you had to learn something quickly to deliver. How did you approach it?']
  };
  const SIGNALS = { 1: 'No evidence or concerning', 2: 'Some evidence, gaps', 3: 'Solid evidence', 4: 'Strong, specific evidence' };
  const OVERALL = [{ id: 'strong-no', label: 'Strong no', v: 1 }, { id: 'no', label: 'No', v: 2 }, { id: 'yes', label: 'Yes', v: 3 }, { id: 'strong-yes', label: 'Strong yes', v: 4 }];
  /* Kit for a job and stage: for each criterion, 1-3 questions and what a strong answer shows. */
  function kit(job, stage) {
    const qs = [];
    for (const c of job.criteria || []) {
      let list = [];
      if (c.type === 'skills') for (const s of c.skills || []) list = list.concat((BANK[s] || []).slice(0, stage === 'phone' ? 1 : 2).map((q) => ({ q, about: s })));
      else if (c.type === 'years') list = BANK._years.map((q) => ({ q, about: 'Experience' }));
      else if (/mentor|coach|grow/i.test(c.label)) list = BANK._mentoring.map((q) => ({ q, about: 'Mentoring' }));
      else if (/collab|stakeholder|cross/i.test(c.label)) list = BANK._collab.map((q) => ({ q, about: 'Collaboration' }));
      else list = BANK._generic.map((q) => ({ q, about: c.label }));
      qs.push({ criterion: c.id, label: c.label, weight: c.weight, questions: list.slice(0, stage === 'phone' ? 2 : 4), strong: 'A strong answer gives a specific example with the candidate\u2019s own role, decisions and measurable result for \u201c' + c.label + '\u201d.' });
    }
    return { stage, criteria: qs, guidance: ['Ask every candidate for this stage the same core questions.', 'Rate each criterion on evidence you heard, not on impressions.', 'Don\u2019t ask about age, family plans, religion, national origin, health or other protected topics. If a candidate brings one up, don\u2019t note it.', 'Submit feedback before reading other interviewers\u2019 notes.'] };
  }
  function checkFeedback(fb) { return F.check(fb.notes || ''); }
  /* Debrief over all feedback for one candidate. */
  function debrief(job, feedback) {
    const rows = (job.criteria || []).map((c) => {
      const vals = feedback.map((f) => +(f.ratings || {})[c.id]).filter((v) => v >= 1 && v <= 4);
      const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : null;
      const spread = vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0;
      return { id: c.id, label: c.label, weight: c.weight, avg, n: vals.length, spread, disagree: spread >= 2 };
    });
    const tally = Object.fromEntries(OVERALL.map((o) => [o.id, feedback.filter((f) => f.overall === o.id).length]));
    const yes = tally.yes + tally['strong-yes']; const no = tally.no + tally['strong-no'];
    const flags = feedback.map((f) => ({ id: f.id, interviewer: f.interviewer, flags: F.check(f.notes || '') })).filter((x) => x.flags.length);
    const W = rows.reduce((a, r) => a + (r.avg != null ? +r.weight : 0), 0);
    const weighted = W ? Math.round(rows.reduce((a, r) => a + (r.avg != null ? r.weight * r.avg : 0), 0) / W * 10) / 10 : null;
    const lean = !feedback.length ? 'No feedback yet.' : yes && !no ? 'Panel leans yes (' + yes + ' of ' + feedback.length + ').' : no && !yes ? 'Panel leans no (' + no + ' of ' + feedback.length + ').' : 'Panel is split (' + yes + ' yes, ' + no + ' no). Discuss before deciding.';
    return { rows, tally, weighted, lean, flags, disagreements: rows.filter((r) => r.disagree).map((r) => r.label), count: feedback.length, missing: [] };
  }
  return { BANK, SIGNALS, OVERALL, kit, debrief, checkFeedback };
});
