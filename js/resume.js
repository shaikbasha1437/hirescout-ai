/* HireScout resume parsing: sections, contact details, skills (with aliases), experience years from date ranges,
   education, missing-information checks and duplicate-candidate detection. Pure functions, unit-tested in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'));
  else (root.HS = root.HS || {}).resume = factory(root.HS.text);
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';
  /* Canonical skill -> aliases. Short all-caps aliases are matched case-sensitively. */
  const SKILLS = {
    'JavaScript': ['javascript', 'ecmascript', 'es6', 'JS'], 'TypeScript': ['typescript', 'TS'], 'React': ['react', 'react.js', 'reactjs', 'react native'], 'Next.js': ['next.js', 'nextjs'],
    'Vue': ['vue', 'vue.js', 'nuxt'], 'Angular': ['angular'], 'Svelte': ['svelte', 'sveltekit'], 'Node.js': ['node.js', 'nodejs', 'node', 'express'], 'GraphQL': ['graphql', 'apollo'],
    'REST APIs': ['REST', 'restful', 'rest api', 'rest apis'], 'HTML': ['HTML', 'html5'], 'CSS': ['CSS', 'css3', 'sass', 'scss', 'tailwind', 'css-in-js'], 'Redux': ['redux', 'zustand', 'mobx'],
    'Testing': ['jest', 'vitest', 'cypress', 'playwright', 'testing library', 'unit tests', 'end-to-end tests', 'e2e tests', 'test coverage'],
    'Build tooling': ['webpack', 'vite', 'rollup', 'esbuild', 'babel'], 'Accessibility': ['accessibility', 'accessible', 'a11y', 'wcag', 'aria', 'screen reader', 'screen readers'],
    'Web performance': ['core web vitals', 'lighthouse', 'web performance', 'page load', 'bundle size', 'time to interactive', 'lcp'], 'Design systems': ['design system', 'design systems', 'storybook', 'component library'],
    'Python': ['python'], 'SQL': ['SQL', 'postgresql', 'postgres', 'mysql', 'bigquery', 'snowflake', 'redshift'], 'dbt': ['dbt'], 'Airflow': ['airflow'], 'Tableau': ['tableau'], 'Looker': ['looker'], 'Power BI': ['power bi'],
    'Excel': ['excel', 'spreadsheets'], 'pandas': ['pandas', 'numpy'], 'Spark': ['spark', 'pyspark'], 'Statistics': ['statistics', 'statistical', 'regression', 'hypothesis testing'], 'A/B testing': ['a/b test', 'a/b tests', 'a/b testing', 'experimentation', 'experiments'],
    'Machine learning': ['machine learning', 'scikit-learn', 'ml models'], 'AWS': ['AWS', 'amazon web services', 'lambda', 's3', 'cloudfront'], 'GCP': ['GCP', 'google cloud'], 'Azure': ['azure'], 'Docker': ['docker', 'containers'], 'Kubernetes': ['kubernetes', 'k8s'],
    'CI/CD': ['ci/cd', 'github actions', 'jenkins', 'circleci', 'continuous integration'], 'Git': ['git'], 'Figma': ['figma'], 'Java': ['java'], 'Go': ['golang'], 'Rust': ['rust'], 'Swift': ['swift'], 'Kotlin': ['kotlin'], 'C#': ['c#', '.net'],
    'Mentoring': ['mentored', 'mentoring', 'mentor', 'coached', 'onboarded new'], 'Leadership': ['led', 'lead engineer', 'tech lead', 'managed a team', 'headed', 'owned the roadmap'], 'Agile': ['agile', 'scrum', 'kanban', 'sprint'],
    'Stakeholder communication': ['stakeholders', 'presented to', 'cross-functional', 'partnered with'], 'Customer success': ['customer success', 'renewals', 'churn', 'onboarding customers', 'account management'], 'Data visualization': ['dashboards', 'dashboard', 'data visualization', 'd3', 'charts']
  };
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reCache = new Map();
  function skillRe(skill) {
    if (reCache.has(skill)) return reCache.get(skill);
    const aliases = (SKILLS[skill] || [skill.toLowerCase()]).concat(skill === 'Go' ? [] : [skill]);
    const cs = aliases.filter((a) => /^[A-Z#/.]{2,5}$/.test(a)); const ci = aliases.filter((a) => !/^[A-Z#/.]{2,5}$/.test(a));
    const wrap = (xs) => '(?<![A-Za-z0-9#+])(?:' + xs.sort((a, b) => b.length - a.length).map(escRe).join('|') + ')(?![A-Za-z0-9#+]|\\.[a-z])';
    const r = { ci: ci.length ? new RegExp(wrap(ci), 'i') : null, cs: cs.length ? new RegExp(wrap(cs)) : null };
    reCache.set(skill, r); return r;
  }
  function mentions(skill, s) { const r = skillRe(skill); return !!((r.ci && r.ci.test(s)) || (r.cs && r.cs.test(s))); }
  function canonical(name) { const n = T.norm(name); for (const [k, al] of Object.entries(SKILLS)) if (T.norm(k) === n || al.some((a) => T.norm(a) === n)) return k; return String(name || '').trim(); }

  const HEAD = /^(summary|profile|about(?: me)?|objective|experience|work experience|work history|employment(?: history)?|professional experience|relevant experience|education|academic background|skills|technical skills|core skills|tools|projects|selected projects|certifications|awards|volunteer(?:ing| work)?|interests|publications|leadership|languages|additional information)\s*:?$/i;
  function sectionOf(h) { const x = h.toLowerCase(); if (/experience|employment|work history/.test(x)) return 'experience'; if (/education|academic/.test(x)) return 'education'; if (/skill|tools/.test(x)) return 'skills'; if (/project/.test(x)) return 'projects'; if (/summary|profile|about|objective/.test(x)) return 'summary'; return 'other'; }
  /* Lines with their section, start offset and text. */
  function lines(text) {
    const out = []; let sec = 'header'; let pos = 0;
    for (const raw of String(text || '').split('\n')) {
      const t = raw.replace(/^#+\s*/, '').replace(/[*_]/g, '').trim();
      if (t && HEAD.test(t)) { sec = sectionOf(t); out.push({ text: raw, start: pos, section: sec, heading: true }); }
      else if (t) out.push({ text: raw, start: pos, section: sec, heading: false });
      pos += raw.length + 1;
    }
    return out;
  }
  const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  const RANGE = /\b(?:(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+)?((?:19|20)\d{2})\s*(?:\u2013|\u2014|-|to|until)\s*(?:(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+)?((?:19|20)\d{2}|present|current|now|today)\b/gi;
  /* Experience from date ranges in experience lines (or anywhere outside education when no sections exist). */
  function experience(text, now) {
    const ref = now ? new Date(now) : new Date(); const nowM = ref.getUTCFullYear() * 12 + ref.getUTCMonth();
    const ls = lines(text); const hasExp = ls.some((l) => l.section === 'experience');
    const ranges = []; let last = null;
    for (const l of ls) {
      if (last && !l.heading && l.section === last.section && !new RegExp(RANGE.source, 'i').test(l.text)) last.r.forEach((r) => { r.block += '\n' + l.text; });
      if (l.heading || l.section === 'education' || (hasExp && l.section !== 'experience')) continue;
      const re = new RegExp(RANGE.source, 'gi'); let m; const here = [];
      while ((m = re.exec(l.text))) {
        const a = +m[2] * 12 + (m[1] ? MON[m[1].toLowerCase().slice(0, 4)] ?? MON[m[1].toLowerCase().slice(0, 3)] : 0);
        const endY = /\d/.test(m[4]) ? +m[4] : null;
        const b = endY == null ? nowM : endY * 12 + (m[3] ? MON[m[3].toLowerCase().slice(0, 4)] ?? MON[m[3].toLowerCase().slice(0, 3)] : (m[1] ? 0 : 11));
        if (b >= a && b <= nowM + 1) { const r = { a, b: Math.min(b, nowM), line: l.text.trim(), start: l.start, block: l.text }; ranges.push(r); here.push(r); }
      }
      if (here.length) last = { section: l.section, r: here };
    }
    return { years: mergeYears(ranges), ranges };
  }
  function mergeYears(ranges) {
    const sorted = ranges.slice().sort((x, y) => x.a - y.a); let months = 0; let cur = null;
    for (const r of sorted) { if (!cur || r.a > cur.b) { if (cur) months += cur.b - cur.a; cur = { a: r.a, b: r.b }; } else cur.b = Math.max(cur.b, r.b); }
    if (cur) months += cur.b - cur.a;
    return Math.round(months / 12 * 10) / 10;
  }
  /* Years from roles whose own lines mention at least one of the given skills. */
  function relevantYears(ranges, skills) { const rel = ranges.filter((r) => (skills || []).some((k) => mentions(k, r.block))); return { years: mergeYears(rel), ranges: rel }; }
  const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/; const PHONE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
  const DEGREE = /\b(ph\.?d|doctorate|m\.?s\.?c?|master'?s?|mba|m\.?eng|b\.?s\.?c?|b\.?a\.?|bachelor'?s?|b\.?eng|associate'?s?|bootcamp|certificate|diploma)\b/i;
  function guessName(text) {
    for (const l of String(text || '').split('\n').slice(0, 4)) { const t = l.replace(/^#+\s*/, '').trim(); if (!t) continue; if (/^[A-Z][A-Za-z\u00C0-\u024F'.-]+(?:\s+[A-Z][A-Za-z\u00C0-\u024F'.-]+){1,3}$/.test(t) && !HEAD.test(t) && !/resume|curriculum|vitae/i.test(t)) return t; return ''; }
    return '';
  }
  /* Full parse. now: Date/ms for "present". */
  function parse(text, now) {
    const s = String(text || ''); const ls = lines(s); const head = ls.filter((l) => l.section === 'header').map((l) => l.text).join('\n');
    const email = (EMAIL.exec(s) || [])[0] || ''; const phoneM = PHONE.exec(s); const phone = phoneM && phoneM[0].replace(/\D/g, '').length >= 10 ? phoneM[0].trim() : '';
    const loc = (/\b([A-Z][a-zA-Z .]+,\s*(?:[A-Z]{2}|[A-Z][a-z]+))\b(?:\s+\d{5})?/.exec(head.replace(EMAIL, ' ')) || [])[1] || (/\bremote\b/i.test(head) ? 'Remote' : '');
    const skills = Object.keys(SKILLS).filter((k) => mentions(k, s));
    const exp = experience(s, now);
    const education = ls.filter((l) => l.section === 'education' && !l.heading && DEGREE.test(l.text)).map((l) => l.text.replace(/^[-*\u2022]\s*/, '').trim());
    const words = T.wordCount(s);
    return { name: guessName(s), email, phone, location: loc.trim(), skills, years: exp.years, ranges: exp.ranges, education, sections: Array.from(new Set(ls.filter((l) => l.heading).map((l) => l.section))), words };
  }
  /* What a recruiter would need to ask for before deciding. knockouts: [{id,q}], answers: {id:'yes'|'no'} */
  function missing(p, o) {
    const out = [];
    if (!p.email && !(o && o.email)) out.push({ id: 'email', label: 'No email address', severity: 'high' });
    if (!p.phone && !(o && o.phone)) out.push({ id: 'phone', label: 'No phone number', severity: 'low' });
    if (!p.ranges.length) out.push({ id: 'dates', label: 'No employment dates, so years of experience can\u2019t be checked', severity: 'high' });
    if (!p.skills.length) out.push({ id: 'skills', label: 'No recognisable skills', severity: 'high' });
    if (!p.education.length) out.push({ id: 'education', label: 'No education listed (fine if the role doesn\u2019t need it)', severity: 'low' });
    if (p.words < 50) out.push({ id: 'short', label: 'Very short resume (' + p.words + ' words)', severity: 'medium' });
    for (const k of (o && o.knockouts) || []) if (!o.answers || !o.answers[k.id]) out.push({ id: 'ko-' + k.id, label: 'Knockout not answered: ' + k.q, severity: 'medium' });
    return out;
  }
  function shingles(text, n) { const w = T.tokens(text); const out = new Set(); for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' ')); return out; }
  function jaccard(a, b) { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); }
  const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);
  /* candidates: [{ id, name, email, phone, text, jobId }] -> [{ a, b, reasons:[...] }] */
  function duplicates(cands) {
    const out = []; const sh = new Map(cands.map((c) => [c.id, shingles(c.text, 4)]));
    for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) {
      const a = cands[i]; const b = cands[j]; const r = [];
      if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) r.push('same email');
      if (digits(a.phone).length === 10 && digits(a.phone) === digits(b.phone)) r.push('same phone');
      if (a.name && b.name && T.norm(a.name).replace(/[^a-z ]/g, '') === T.norm(b.name).replace(/[^a-z ]/g, '')) r.push('same name');
      const sim = jaccard(sh.get(a.id), sh.get(b.id)); if (sim >= 0.6) r.push(Math.round(sim * 100) + '% identical text');
      if (r.length && (r.length > 1 || !/same name/.test(r[0]))) out.push({ a: a.id, b: b.id, reasons: r });
    }
    return out;
  }
  return { SKILLS, mergeYears, relevantYears, mentions, canonical, lines, experience, parse, missing, duplicates, jaccard, shingles, guessName };
});
