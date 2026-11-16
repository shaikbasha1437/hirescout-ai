/* HireScout fairness helpers. Two jobs:
   1. check(text): flag words in job criteria, knockout questions, recruiter notes and interviewer feedback that
      reference protected characteristics (or well-known proxies for them), so a person can rewrite them.
   2. blind(text, who): pattern-based redaction of names, contact details, links, addresses, graduation years,
      pronouns and self-disclosed personal details before a resume is scored or shown in blind mode.
   This is a helper, not a compliance tool, and pattern matching can miss things. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.HS = root.HS || {}).fairness = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CATEGORIES = {
    age: { label: 'Age', re: /\b(age[ds]?|years? old|young(?:er)?|youthful|digital natives?|recent (?:college )?grad(?:uate)?s? only|new grads? only|under (?:the age of )?\d{2}|over (?:the age of )?\d{2}|older (?:workers?|candidates?|people)|mature|millennials?|gen[- ]?z|boomers?|date of birth|born (?:in|after|before) (?:19|20)\d{2}|no more than \d+ years|at most \d+ years|maximum (?:of )?\d+ years)\b/i },
    gender: { label: 'Sex or gender', re: /\b(male|female|males|females|gender|sex|man|woman|men|women|guys|gals|ladies|gentlemen|salesman|saleswoman|chairman|manpower|he\/him|she\/her|his or her|maternity|paternity|pregnan\w*)\b/i },
    race: { label: 'Race, color or ethnicity', re: /\b(race|racial|ethnic(?:ity|ities)?|skin colou?r|complexion|caucasian|african[- ]american|hispanic|latin[oax]s?|asian|white|black)\b(?!\s*(?:box|board|list|hat|text))/i },
    religion: { label: 'Religion', re: /\b(religio(?:n|ns|us)|christian|muslim|islam(?:ic)?|jewish|judaism|hindu|buddhist|sikh|catholic|protestant|mormon|church|mosque|synagogue|temple|sabbath|atheis(?:t|m))\b/i },
    origin: { label: 'National origin or citizenship', re: /\b(national origin|nationality|nationalities|citizenship|citizens? only|native (?:english )?speakers?|native[- ]born|accent|accents|foreigners?|foreign[- ]born|immigra(?:nt|nts|tion|tion status)|country of (?:origin|birth)|ethnic origin|place of birth)\b/i },
    disability: { label: 'Disability or health', re: /\b(disab(?:led|ility|ilities)|handicap(?:ped)?|wheelchair|able[- ]bodied|mental(?:ly)? ill(?:ness)?|medical (?:condition|history)|health (?:condition|issues?|problems?)|deaf|blind)\b(?!\s*(?:screen\w*|mode|review\w*|scor\w*|hiring|audit\w*|redact\w*))/i },
    family: { label: 'Marital or family status', re: /\b(marital status|married|unmarried|divorced|widowed|spouses?|husband|wife|single (?:mother|father|parent|mom|dad)|(?:has|have|no|with) (?:kids|children)|childcare|family plans|starting a family|childless)\b/i },
    orientation: { label: 'Sexual orientation or gender identity', re: /\b(sexual orientation|gay|lesbian|bisexual|transgender|gender identity|lgbt\w*|queer)\b/i },
    genetic: { label: 'Genetic information', re: /\b(genetic|family medical history|dna test)\b/i },
    veteran: { label: 'Military or veteran status', re: /\b(veteran status|military status|discharge status)\b/i },
    proxy: { label: 'Possible proxy (review)', re: /\b(culture fit|good fit for the team culture|photo(?:graph)?s?|headshot|attractive|good[- ]looking|appearance|zip ?codes?|neighbou?rhood|graduation year|class of (?:19|20)\d{2}|ivy league only|elite (?:school|university) only)\b/i }
  };
  /* Returns [{ category, label, term, index }] for each protected-attribute reference. */
  function check(text) {
    const s = String(text || ''); const out = [];
    for (const [category, c] of Object.entries(CATEGORIES)) {
      const re = new RegExp(c.re.source, 'gi'); let m;
      while ((m = re.exec(s))) { out.push({ category, label: c.label, term: m[0], index: m.index }); if (m[0] === '') re.lastIndex++; }
    }
    return out.sort((a, b) => a.index - b.index);
  }
  function summary(flags) { return Array.from(new Set(flags.map((f) => f.label + ' (\u201c' + f.term + '\u201d)'))).join(', '); }

  /* ---------- blind screening ---------- */
  const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
  const URL_RE = /\b(?:https?:\/\/|www\.)[^\s)>\]]+|\b(?:linkedin\.com|github\.com|gitlab\.com|behance\.net|dribbble\.com)\/[^\s)>\]]+/gi;
  const PHONE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
  const STREET = /\b\d{1,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Boulevard|Blvd|Way|Court|Ct|Place|Pl|Terrace|Parkway|Pkwy)\b\.?(?:,?\s*(?:Apt|Suite|Unit)\.?\s*\w+)?/g;
  const ZIP = /\b([A-Z][a-zA-Z .]+,\s*[A-Z]{2})\s+\d{5}(?:-\d{4})?\b/g;
  const PERSONAL_LINE = /^\s*(?:[-*\u2022]\s*)?(nationality|citizenship|religion|marital status|date of birth|dob|age|gender|sex|pronouns|race|ethnicity|place of birth|photo|health|family|children|spouse)\s*[:\-\u2013]/i;
  const FAMILY_LINE = /\b(married|divorced|widowed|(?:\d+|one|two|three|four) (?:kids|children)|mother of|father of|my (?:husband|wife))\b/i;
  const RELIGION_LINE = /\b(church|mosque|synagogue|temple|ministry|parish|christian|muslim|islamic|jewish|hindu|sikh|buddhist|catholic|bible|quran|torah)\b/i;
  const AFFINITY = /\b(?:women(?:'s)?|men's|female|black|latin[oax]|hispanic|asian(?:[- ]american)?|african(?:[- ]american)?|lgbt\w*|queer|indigenous|native american)\b[^.\n]{0,40}?\b(?:society|association|club|network|group|alliance|chapter|collective|in (?:tech|engineering|computing|stem|data|design|product))\b/gi;
  const PRONOUNS = /\b(he|she|him|her|his|hers|himself|herself)\b/gi;
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  /* who = { name } (optional). Returns { text, redactions:[{ type, original }] }. */
  function blind(text, who) {
    const red = []; let s = String(text || '');
    const sub = (re, type, repl) => { s = s.replace(re, (m) => { red.push({ type, original: m }); return typeof repl === 'function' ? repl(m) : repl; }); };
    // Self-disclosed personal details: drop the whole line.
    s = s.split('\n').map((line) => {
      if (PERSONAL_LINE.test(line) || FAMILY_LINE.test(line) || (RELIGION_LINE.test(line) && !/\b(temple university)\b/i.test(line))) { red.push({ type: 'personal detail', original: line.trim() }); return '[personal detail removed]'; }
      if (/\[(?:photo|headshot)[^\]]*\]|\bphoto attached\b/i.test(line)) { red.push({ type: 'photo', original: line.trim() }); return '[photo removed]'; }
      return line;
    }).join('\n');
    sub(EMAIL, 'email', '[email]');
    sub(URL_RE, 'link', '[link]');
    sub(PHONE, 'phone', (m) => (m.replace(/\D/g, '').length >= 10 ? '[phone]' : m));
    sub(STREET, 'address', '[address]');
    sub(ZIP, 'address', '[location]');
    // Names: full name, then each part of 2+ letters, plus common nickname forms of the first name.
    const name = String((who && who.name) || '').replace(/[^A-Za-z\u00C0-\u024F' -]/g, ' ').trim();
    if (name) {
      const parts = name.split(/\s+/).filter((p) => p.length >= 2);
      sub(new RegExp('\\b' + escRe(name).replace(/\s+/g, '\\s+') + '\\b', 'gi'), 'name', '[Candidate]');
      for (const p of parts.sort((a, b) => b.length - a.length)) sub(new RegExp('(?<![\\w\\[])' + escRe(p) + '(?![\\w\\]])', 'g'), 'name', '[Candidate]');
    }
    // Graduation and birth years in the education block, "class of 2009", ages.
    const lines = s.split('\n'); let inEdu = false;
    for (let i = 0; i < lines.length; i++) {
      const h = lines[i].replace(/^#+\s*/, '').trim();
      if (/^(education|academic background|degrees?|qualifications)\s*:?$/i.test(h)) { inEdu = true; continue; }
      if (inEdu && /^(experience|work experience|employment|professional experience|skills|technical skills|projects|certifications|awards|volunteer\w*|interests|summary|profile|publications|leadership)\s*:?$/i.test(h)) inEdu = false;
      if (inEdu) lines[i] = lines[i].replace(/\b(?:19|20)\d{2}\b/g, (m) => { red.push({ type: 'graduation year', original: m }); return '[year]'; });
    }
    s = lines.join('\n');
    sub(/\bclass of (?:19|20)\d{2}\b/gi, 'graduation year', 'class of [year]');
    sub(/\b(?:aged?\s*:?\s*\d{2}|\d{2} years old|born (?:in )?(?:19|20)\d{2})\b/gi, 'age', '[age removed]');
    sub(AFFINITY, 'affinity group', '[affinity group]');
    sub(PRONOUNS, 'pronoun', (m) => (/^h(is|ers)$/i.test(m) ? 'their' : /self$/i.test(m) ? 'themself' : /^(him|her)$/i.test(m) ? 'them' : 'they'));
    return { text: s, redactions: red };
  }
  return { CATEGORIES, check, summary, blind };
});
