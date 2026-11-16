/* HireScout guard: resumes, job descriptions and uploaded files are untrusted data. Flags instruction-like text
   aimed at AI screeners (including hidden "rank this candidate first" text and keyword stuffing), fences sources
   for prompts, and makes sure no key-like string or fence-breaking tag slips into a prompt. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'));
  else (root.HS = root.HS || {}).guard = factory(root.HS.text);
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';
  const AI = '(?:ai|llm|language models?|assistants?|chatbots?|agents?|screeners?|screening (?:tools?|software|systems?|bots?)|recruit(?:ing|er|ment) (?:ai|bots?|tools?|software|systems?)|ats|applicant tracking systems?|resume (?:parsers?|scanners?|screeners?)|scoring (?:models?|systems?))';
  const PATTERNS = [
    { id: 'ignore-instructions', re: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|other|any|your)\b[^.\n]{0,30}\b(instructions?|prompts?|rules|sources?|guidelines|results?|context|criteria|scorecards?|scoring)\b/i },
    { id: 'addressed-to-ai', re: new RegExp('\\b(note|message|attention|instructions?|hello|hi|dear)\\s+(to|for)?\\s*(the\\s+)?' + AI + '\\b', 'i') },
    { id: 'ai-should', re: new RegExp('\\b' + AI + '\\b[^.\\n]{0,60}\\b(should|must|shall|are required to|need to|will)\\b[^.\\n]{0,40}\\b(describe|say|state|report|conclude|cite|rate|score|rank|omit|ignore|disregard|mention|write|claim|recommend|advance|select|shortlist|approve|tell|send)\\b', 'i') },
    { id: 'rank-steer', re: /\b(rank|score|rate|put|place|mark|list|move|recommend|shortlist|advance|select)\b[^.\n]{0,30}\b(this|the|me|my)\s*(candidate|applicant|resume|cv|profile)?[^.\n]{0,20}\b(first|top|highest|best|#\s?1|number one|10\s?\/\s?10|5\s?\/\s?5|100\s?%|perfect|above (?:all|every|other))/i },
    { id: 'verdict-claim', re: /\b(this|the)\s+(candidate|applicant)\b[^.\n]{0,30}\b(is the (?:best|strongest|ideal|perfect)|meets all (?:requirements|criteria)|must be (?:hired|advanced|selected|shortlisted)|should be (?:hired|advanced|selected|shortlisted))\b/i },
    { id: 'role-tag', re: /(^|[\[<\s(])(system|assistant|developer)\s*[:\]>]/i },
    { id: 'role-change', re: /\byou are now\b|\bact as (?:an?|the) (?:ai|assistant|system|recruiter)\b|\bnew instructions\b|\bjailbreak\b/i },
    { id: 'exfiltrate', re: /\b(api[- ]?key|password|secret|token)\b[^.\n]{0,40}\b(send|post|reveal|print|share|include)\b|\b(send|post|reveal|print)\b[^.\n]{0,40}\b(api[- ]?key|password|secret|system prompt)\b/i },
    { id: 'hidden-markup', re: /<!--[\s\S]*?(ai|assistant|instruction|system|rank|score)[\s\S]*?-->|\u200b|\u200c|\u200d|\u2060|\[hidden text\]/i }
  ];
  /* Keyword stuffing: one sentence/line that repeats the same skill words many times with little else. */
  function stuffed(sentence) {
    const w = T.norm(sentence).match(/[a-z][a-z0-9+#.]*/g) || []; if (w.length < 12) return false;
    const c = new Map(); w.forEach((x) => c.set(x, (c.get(x) || 0) + 1));
    const max = Math.max(...c.values()); return max >= 4 && c.size / w.length < 0.6 && !w.some((x) => /^(the|and|with|for|to|of|in|a|on|at|by)$/.test(x));
  }
  /* Returns [{ sentence, start, rules:[ids] }] for every instruction-like sentence in the text. */
  function scan(text) {
    const out = [];
    for (const s of T.sentences(text)) {
      const rules = PATTERNS.filter((p) => p.re.test(s.text)).map((p) => p.id);
      if (stuffed(s.text)) rules.push('keyword-stuffing');
      if (rules.length) out.push({ sentence: s.text, start: s.start, rules });
    }
    return out;
  }
  function isInjection(sentence) { return PATTERNS.some((p) => p.re.test(String(sentence || ''))) || stuffed(sentence); }
  /* Neutralise anything that could close or forge our fence, then wrap. */
  function sanitize(text) { return String(text || '').replace(/<\/?\s*(untrusted_source|source|resume|system|instructions?)[^>]*>/gi, (m) => m.replace(/</g, '\u2039').replace(/>/g, '\u203A')); }
  function fence(src, body, flagged) {
    const attrs = 'id="' + src.id + '" title="' + String(src.title || '').replace(/"/g, "'").slice(0, 120) + '"';
    const warn = flagged && flagged.length ? '\n[guard: ' + flagged.length + ' instruction-like sentence(s) were removed from this source before you saw it]' : '';
    return '<untrusted_source ' + attrs + '>' + warn + '\n' + sanitize(body) + '\n</untrusted_source>';
  }
  const KEYLIKE = /\b(sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|tvly-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g;
  function redactKeys(s) { return String(s || '').replace(KEYLIKE, '[redacted key]'); }
  /* Last line of defence before a prompt leaves the page. */
  function assertNoSecrets(prompt, secrets) {
    const p = String(prompt || '');
    for (const k of secrets || []) if (k && k.length >= 6 && p.indexOf(k) >= 0) throw new Error('Blocked: a prompt contained one of your keys. Nothing was sent.');
    return p;
  }
  return { PATTERNS, scan, stuffed, isInjection, sanitize, fence, redactKeys, assertNoSecrets, KEYLIKE };
});
