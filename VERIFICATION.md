# Verification

Checked on 2026-11-16 against the live site, https://shaikbasha1437.github.io/hirescout-ai/

## Unit tests

`npm test` runs Node's built-in test runner. **48 tests, 48 passing.** They cover:

- providers: request shapes for OpenAI, Anthropic (including the browser-access header), Gemini and OpenAI-compatible endpoints, plus key redaction
- the injection and keyword-stuffing guard
- blind-mode redaction and protected-attribute flags
- resume parsing, years in relevant roles, missing info and duplicates
- scoring:
  - evidence quotes
  - flagged text that has no effect on the score
  - blind and name-swap invariance
  - LLM scores without a verbatim citation being withheld
- scheduling: time zones, working hours, buffers, loops, the no-overlap diagnosis, .ics files, share links with no PII, and email drafts
- interview kits and the debrief
- CSV formula guard, Markdown and backup with no keys
- DOCX and PDF hidden-text detection
- repo hygiene

## Browser tests (Playwright, live site, not committed)

| Browser | Result |
|---|---|
| Chrome (stable) | **218 / 218** |
| Firefox (Playwright build) | **218 / 218** |

What the checks cover:

- **Load:** first load, the demo job and its 12 candidates.
- **Screening:** evidence quotes on every score, ranking explanations, flags, and the two injection resumes. The test confirms the injected text does not change the score.
- **Decisions:**
  - advance, hold and decline, each with a reason and undo
  - knockout answers and duplicate review
  - notes, including protected-attribute warnings
- **Board:**
  - mouse drag between columns, including a drop on Declined, which asks for a reason
  - keyboard moves
  - filters and search
- **Upload:** TXT, DOCX (with a hidden white run) and PDF (with white and 1px text).
- **Job:** edit the job and draft a scorecard from a pasted job description. Wording such as "young" is flagged on save.
- **Scheduling:**
  - panel lanes across time zones and the full loop
  - .ics download and drafted emails
- **Share:**
  - the self-scheduling preview link contains no PII
  - booking from it shows as held in the recruiter tab without a reload
  - a damaged link explains itself
- **Interviews:** the kit, feedback forms and the debrief.
- **Audit:** score distributions and the decision log.
- **Export:** CSV, Markdown, JSON backup and .ics, with a scan for keys.
- **Live mode:** a stubbed provider confirms that a citation-less score is withheld and that the key is never in an export.
- **Modals:** every modal closes via X, Cancel, Esc, backdrop click and browser Back. Unsaved edits get a discard prompt, and required fields never block Cancel.
- **Display and offline:** no horizontal overflow at 375px, the dark theme works, and the app reloads offline from the service worker.

## Bugs found and fixed during verification

- **Adding a criterion crashed:** "+ Criterion" threw `undefined.join` for a new keyword criterion, so the row was never added.
- **Share-link race:** the preview tab could open before the new link was saved, so a pick didn't register as held. The link is now saved immediately.
- **Stale recruiter tab:** an open recruiter tab could overwrite a booking made in the preview tab. It now reloads its saved state when it gets a BroadcastChannel notice.
- **Header leak in blind mode:** the city and state in a resume header weren't redacted. Fixed.
- **Back button:** swapping one modal for another left an extra history entry, so Back needed two presses. Fixed.
- **Toolbar layout:** search and filter inputs stretched to full width. Fixed.
- **Scoring and parsing:**
  - years were counted from unrelated roles
  - "Go" matched "go to market"
  - the short-resume threshold was too strict
  - the stuffing detector missed a real stuffed line

## Not verified (honest limits)

- **Untested:**
  - real API keys for OpenAI, Anthropic, Gemini and OpenRouter (live mode was tested only with a stubbed endpoint)
  - Ollama and WebLLM
  - Safari
- **Calendars:** the .ics files were checked for structure but not imported into Google Calendar, Outlook or Apple Calendar.
- **Hidden text:** in PDFs, only text under 2.5pt is detected structurally. White text in a PDF is caught only when its wording looks like an instruction. In DOCX, hidden, white and tiny runs are detected.
- **Redaction:** blind-mode redaction is pattern-based and can miss things.
- **Scanned PDFs:** these have no text layer and are not supported.
- **Not a compliance tool:** no bias audit of any model has been done. EEOC and NYC Local Law 144 are mentioned as general information only.
