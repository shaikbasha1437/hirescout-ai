/* HireScout scheduling: availability across time zones, working hours and buffers; slot finding for single
   interviews and multi-part panels; full interview loops; .ics files (METHOD:PUBLISH, so importing never emails
   anyone); drafted invite, confirmation, reschedule and decline emails; and self-scheduling share links that
   carry only the role title, stage, duration and offered times (no names, emails or keys). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'));
  else (root.HS = root.HS || {}).schedule = factory(root.HS.text);
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';
  const MIN = 60000; const DAY = 86400000;
  function tzOffsetMin(utcMs, tz) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
    return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - utcMs) / 60000;
  }
  /* Wall-clock date + time in an IANA zone -> UTC ms. */
  function zonedToUtc(date, time, tz) {
    const [y, m, d] = date.split('-').map(Number); const [hh, mm] = time.split(':').map(Number);
    const wall = Date.UTC(y, m - 1, d, hh, mm);
    let t = wall - tzOffsetMin(wall, tz) * 60000; t = wall - tzOffsetMin(t, tz) * 60000;
    return t;
  }
  /* Local parts of a UTC instant in a zone. */
  function local(ms, tz) { const w = new Date(ms + tzOffsetMin(ms, tz) * MIN); return { date: w.toISOString().slice(0, 10), mins: w.getUTCHours() * 60 + w.getUTCMinutes(), dow: w.getUTCDay() }; }
  const hm = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
  const pad = (n) => String(n).padStart(2, '0');
  const addDays = (date, n) => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  function validTz(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; } }
  /* Deterministic "existing meetings" for a fictional person on a local date: 1-3 blocks inside working hours. */
  function demoBusy(person, fromDate, days) {
    const out = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(fromDate, i); const dow = new Date(date + 'T00:00:00Z').getUTCDay(); if (dow === 0 || dow === 6) continue;
      const h = parseInt(T.hash(person.id + date), 36); const n = 1 + (h % 3); const s0 = hm(person.hours.start); const e0 = hm(person.hours.end);
      for (let k = 0; k < n; k++) {
        const len = [30, 60, 60, 90][(h >> (k * 3 + 2)) & 3]; const slots = Math.max(1, Math.floor((e0 - s0 - len) / 30));
        const st = s0 + 30 * ((h >> (k * 5 + 7)) % slots); const start = zonedToUtc(date, pad(Math.floor(st / 60)) + ':' + pad(st % 60), person.tz);
        out.push({ start, end: start + len * MIN, title: 'Busy (demo calendar)' });
      }
    }
    return out;
  }
  /* Is [s,e) inside the person's working hours on a weekday in their zone? */
  function inHours(p, s, e) {
    const a = local(s, p.tz); const b = local(e - 1, p.tz);
    if (a.date !== b.date || a.dow === 0 || a.dow === 6) return false;
    return a.mins >= hm(p.hours.start) && b.mins + 1 <= hm(p.hours.end);
  }
  function free(p, s, e, buffer) { const bf = (buffer || 0) * MIN; return !(p.busy || []).some((b) => b.start < e + bf && b.end > s - bf); }
  /* Find slots. req = { candidate, parts:[{ label, mins, people:[...] }], gap (mins between parts), buffer, from, days, step, perDay, limit }
     Each person: { id, name, tz, hours:{start,end}, busy:[{start,end}] }. The candidate attends every part. */
  function findSlots(req) {
    const step = (req.step || 15) * MIN; const gap = (req.gap == null ? 15 : req.gap) * MIN; const buffer = req.buffer == null ? 10 : req.buffer;
    const parts = req.parts; const span = parts.reduce((a, p) => a + p.mins * MIN, 0) + gap * (parts.length - 1);
    let t = Math.ceil(req.from / (15 * MIN)) * 15 * MIN; const end = req.from + (req.days || 10) * DAY; const out = []; const perDay = {};
    for (; t + span <= end; t += step) {
      if (!inHours(req.candidate, t, t + span) || !free(req.candidate, t, t + span, buffer)) continue;
      let cur = t; let ok = true; const sessions = [];
      for (const p of parts) {
        const s = cur; const e = cur + p.mins * MIN;
        for (const person of p.people) if (!inHours(person, s, e) || !free(person, s, e, buffer)) { ok = false; break; }
        if (!ok) break; sessions.push({ label: p.label, start: s, end: e, people: p.people.map((x) => x.id) }); cur = e + gap;
      }
      if (!ok) continue;
      const day = local(t, req.candidate.tz).date; perDay[day] = (perDay[day] || 0) + 1;
      if (perDay[day] > (req.perDay || 2)) continue;
      out.push({ start: t, end: t + span, sessions }); t += Math.max(0, 60 * MIN - step); // spread offered times out a little
      if (out.length >= (req.limit || 6)) break;
    }
    return out;
  }
  /* Why nothing fits: pairs of people whose working hours never overlap on a sample weekday. */
  function diagnose(people, fromDate) {
    let date = fromDate; for (let i = 0; i < 7; i++) { const dow = new Date(date + 'T00:00:00Z').getUTCDay(); if (dow !== 0 && dow !== 6) break; date = addDays(date, 1); }
    const win = (p) => { const s = zonedToUtc(date, p.hours.start, p.tz); const e = zonedToUtc(date, p.hours.end, p.tz); return [s, e]; };
    const issues = [];
    for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
      const [a1, a2] = win(people[i]); const [b1, b2] = win(people[j]); const ov = Math.min(a2, b2) - Math.max(a1, b1);
      if (ov < 30 * MIN) issues.push(people[i].name + ' (' + people[i].tz + ') and ' + people[j].name + ' (' + people[j].tz + ') have ' + (ov > 0 ? Math.round(ov / MIN) + ' minutes of' : 'no') + ' shared working hours.');
    }
    return issues;
  }
  /* Plan a whole loop: each stage at least `spacingDays` after the previous one ends. stages: [{ id, label, parts:[{label, mins, panel:[ids]}] }] */
  function planLoop(o) {
    const out = []; let from = o.from; const booked = [];
    for (const st of o.stages) {
      const parts = st.parts.map((p) => ({ label: p.label, mins: p.mins, people: p.panel.map((id) => { const x = o.panel.find((y) => y.id === id); return Object.assign({}, x, { busy: (x.busy || []).concat(booked) }); }) }));
      const cand = Object.assign({}, o.candidate, { busy: (o.candidate.busy || []).concat(booked) });
      const slots = findSlots({ candidate: cand, parts, from, days: o.days || 14, buffer: o.buffer, gap: o.gap, perDay: 1, limit: 1 });
      if (!slots.length) { out.push({ stage: st.id, label: st.label, slot: null, why: diagnose([o.candidate].concat(...parts.map((p) => p.people)).filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i), local(from, o.candidate.tz).date) }); continue; }
      const s = slots[0]; out.push({ stage: st.id, label: st.label, slot: s });
      booked.push({ start: s.start, end: s.end });
      const nextDay = local(s.end, o.candidate.tz).date; from = Math.max(s.end, zonedToUtc(addDays(nextDay, o.spacingDays || 1), '00:00', o.candidate.tz));
    }
    return out;
  }
  /* ---------- formatting ---------- */
  function fmt(ms, tz, o) { return new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }, o || {})).format(new Date(ms)); }
  function fmtRange(s, e, tz) { const t = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); return fmt(s, tz, { timeZoneName: undefined }) + ' \u2013 ' + t.format(new Date(e)); }
  /* ---------- iCalendar ---------- */
  const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  function fold(line) {
    const enc = new TextEncoder(); if (enc.encode(line).length <= 75) return line;
    const out = []; let cur = ''; let len = 0; const lim = () => (out.length ? 74 : 75);
    for (const ch of line) { const n = enc.encode(ch).length; if (len + n > lim()) { out.push(cur); cur = ''; len = 0; } cur += ch; len += n; }
    out.push(cur); return out.join('\r\n ');
  }
  const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  /* events: [{ uid, title, start, end, description, location, organizer:{name,email}, attendees:[{name,email}], status, sequence }] */
  function ics(events, o) {
    const now = (o && o.now) || Date.now();
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HireScout AI//Interview scheduling//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    for (const e of events) {
      L.push('BEGIN:VEVENT', 'UID:' + e.uid + '@hirescout.quillmark.example', 'DTSTAMP:' + stamp(now), 'DTSTART:' + stamp(e.start), 'DTEND:' + stamp(e.end), 'SUMMARY:' + icsEsc(e.title));
      if (e.sequence) L.push('SEQUENCE:' + e.sequence);
      if (e.status) L.push('STATUS:' + e.status);
      if (e.location) L.push('LOCATION:' + icsEsc(e.location));
      if (e.description) L.push('DESCRIPTION:' + icsEsc(e.description));
      if (e.organizer) L.push('ORGANIZER;CN=' + icsEsc(e.organizer.name) + ':mailto:' + e.organizer.email);
      for (const a of e.attendees || []) if (a.email && /@/.test(a.email)) L.push('ATTENDEE;CN=' + icsEsc(a.name) + ';RSVP=FALSE:mailto:' + a.email);
      L.push('END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }
  /* ---------- drafted emails (never sent) ---------- */
  const first = (n) => String(n || 'there').split(/\s+/)[0];
  function sessionLines(iv, tz, panelById) { return iv.sessions.map((s) => '- ' + fmtRange(s.start, s.end, tz) + ': ' + s.label + ' with ' + s.people.map((id) => (panelById[id] ? panelById[id].name + ' (' + panelById[id].title + ')' : id)).join(', ')).join('\n'); }
  function emailDraft(kind, o) {
    const c = o.candidate; const tz = c.tz || 'UTC'; const job = o.job; const rec = o.recruiter; const byId = Object.fromEntries((o.panel || []).map((p) => [p.id, p]));
    const sig = '\n\nBest,\n' + rec.name + '\n' + rec.title + ', ' + o.company;
    if (kind === 'invite') return { to: c.email || '(no email on file)', subject: 'Interview invitation: ' + job.title + ' at ' + o.company + ' (' + o.iv.label + ')', body: 'Hi ' + first(c.name) + ',\n\nThank you for applying for the ' + job.title + ' role. We\u2019d like to invite you to a ' + o.iv.label.toLowerCase() + '. The proposed time, shown in your time zone (' + tz + '):\n\n' + sessionLines(o.iv, tz, byId) + '\n\nIt will be on a video call; a link will follow. If this time doesn\u2019t work, reply with a few times that do, or use the scheduling link if we sent one. If you need any accommodation for the interview, just let us know.' + sig };
    if (kind === 'confirm') return { to: c.email || '(no email on file)', subject: 'Confirmed: ' + o.iv.label + ' for ' + job.title, body: 'Hi ' + first(c.name) + ',\n\nYou\u2019re confirmed for:\n\n' + sessionLines(o.iv, tz, byId) + '\n\nA calendar file is attached. Reply here if anything changes.' + sig };
    if (kind === 'reschedule') return { to: c.email || '(no email on file)', subject: 'New time for your ' + o.iv.label.toLowerCase() + ': ' + job.title, body: 'Hi ' + first(c.name) + ',\n\nWe need to move your ' + o.iv.label.toLowerCase() + ', and we\u2019re sorry for the change. It was ' + fmt(o.old.start, tz) + '. The new proposed time:\n\n' + sessionLines(o.iv, tz, byId) + '\n\nIf the new time doesn\u2019t work, reply with times that do.' + sig };
    if (kind === 'decline') return { to: c.email || '(no email on file)', subject: 'Your application for ' + job.title + ' at ' + o.company, body: 'Hi ' + first(c.name) + ',\n\nThank you for your interest in ' + o.company + ' and for the time you put into your application for ' + job.title + '. After careful review, we won\u2019t be moving forward with your application for this role.\n\nWe\u2019d be glad to see you apply for future openings that match your experience.' + sig };
    if (kind === 'panel') return { to: o.iv.sessions.flatMap((s) => s.people).filter((x, i, a) => a.indexOf(x) === i).map((id) => (byId[id] ? byId[id].email : id)).join(', '), subject: 'Interview: ' + o.iv.label + ' for ' + job.title, body: 'Hi all,\n\nPlease hold this time for a ' + o.iv.label.toLowerCase() + ' for the ' + job.title + ' role:\n\n' + sessionLines(o.iv, rec.tz, byId) + '\n\nThe interview kit and feedback form are in HireScout. Please submit feedback before the debrief and keep notes to job-related evidence.' + sig };
    throw new Error('Unknown draft');
  }
  /* ---------- self-scheduling share links (simulated) ---------- */
  function b64u(s) { const b = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'); return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(s) { const t = String(s).replace(/-/g, '+').replace(/_/g, '/'); return typeof atob === 'function' ? decodeURIComponent(escape(atob(t))) : Buffer.from(t, 'base64').toString('utf8'); }
  /* Only whitelisted, non-identifying fields go in the link. */
  function shareEncode(o) {
    const payload = { v: 1, r: String(o.role || '').slice(0, 80), s: String(o.stage || '').slice(0, 60), m: +o.mins || 30, t: (o.slots || []).slice(0, 8).map((x) => Math.round(x / MIN)), c: String(o.company || '').slice(0, 40), x: o.expires ? Math.round(o.expires / MIN) : 0, k: String(o.token || '').replace(/[^a-z0-9]/gi, '').slice(0, 12) };
    const json = JSON.stringify(payload);
    if (/@/.test(json)) throw new Error('A scheduling link may not contain an email address.');
    return b64u(json);
  }
  function shareDecode(s) {
    let j; try { j = JSON.parse(unb64u(s)); } catch (e) { throw new Error('This scheduling link is damaged.'); }
    if (!j || j.v !== 1 || !Array.isArray(j.t)) throw new Error('This scheduling link is not one HireScout made.');
    return { role: String(j.r || ''), stage: String(j.s || ''), mins: +j.m || 30, slots: j.t.filter((x) => Number.isFinite(x)).map((x) => x * MIN), company: String(j.c || ''), expires: j.x ? j.x * MIN : 0, token: String(j.k || '') };
  }
  return { MIN, DAY, tzOffsetMin, zonedToUtc, local, hm, addDays, validTz, demoBusy, inHours, free, findSlots, diagnose, planLoop, fmt, fmtRange, icsEsc, fold, ics, emailDraft, shareEncode, shareDecode };
});
