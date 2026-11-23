/**
 * Copies joinable outings from the Family calendar to the public Playdates calendar, with guardrails.
 *
 * Every 15 minutes, syncFamilyCalendar() looks at upcoming Family events it hasn't decided on yet:
 *   1. Rules: anything that looks personal (medical, work, money, travel, school notices, meetings,
 *      deadlines, all-day reminders) is skipped. These events never leave Google.
 *   2. Claude reads what's left and answers publish, private or review, and writes a public title and
 *      description without names, prices, confirmation numbers or contact details.
 *   3. Checks on that public text: a family name, an email, a phone number, a long number, a price,
 *      or confidence below MIN_CONFIDENCE sends the event to review instead.
 * Review items are emailed to you with Publish and Skip buttons. Published copies follow the
 * original's time and place, and are removed if it's deleted.
 *
 * Settings live in Script properties (Project Settings › Script properties), not in this file:
 *   WATCHED_CALENDARS  comma-separated IDs of the calendars to watch (the Family calendar)
 *   ANTHROPIC_API_KEY  the Claude API key
 *   SENSITIVE_WORDS    comma-separated names and places that must never be published
 *   PLACE_HINTS        optional notes on your shorthand, one per line ("tranmpoline = Sky Zone Mountlake Terrace")
 *   DRY_RUN            "true" (the default) only reports decisions; "false" publishes
 */
const MODEL = 'claude-sonnet-5-5';
const MIN_CONFIDENCE = 0.85;

/**
 * Words that mark an event as personal, case-insensitive. Titles are checked against all of them.
 * Descriptions only against the strongest ones: ticketed outings mention prices and order numbers.
 */
const STRONG_PRIVATE = [
  /\b(doctor|dr\.|dentist|dental|orthodont\w*|pediatrician|clinic|hospital|urgent care|therap(y|ist)|counsel(ing|or)|dietitian|physio\w*|vaccin\w*|check-?up|lab work|prescription|pharmacy)\b/i,
  /\b(interview|recruiter|onboarding|performance review|one-on-one)\b/i,
  /\b(flight|airline|boarding pass|hotel stay|rental car|work authorization|i-9|visa (appointment|interview|application|stamp)|passport)\b/i,
];
const TITLE_PRIVATE = STRONG_PRIVATE.concat([
  /\b(appointment|appt|visit with|1:1|standup|offsite|shift|judge|review invite|training course)\b/i,
  /\b(bill|payment|due|bank|credit card|statement|autopay|mortgage|loan|lease|rent|tax|insurance|invoice|refund|renews?|subscription)\b|\$\d/i,
  /\b(airport|hotel|check-?in|check-?out|cancellation|cancel)\b|✈|→/i,
  /\b(meeting|call|webinar|conference|hoa|budget|deadline|expires?|expiring|authorization|dmv|court|jury|license)\b/i,
  /\b(brightwheel|parent-teacher|closed|closure|staff meeting|sign up for|registration)\b/i,
  /\b(date night|dinner|reservation|table for 2|party of 2|anniversary|haircut|salon|spa|massage|nails)\b/i,
]);

function syncFamilyCalendar() {
  try {
    checkBookings_();
  } catch (err) {
    console.error('Checking bookings failed: ' + err.message); // keep syncing regardless
  }
  const playdates = CalendarApp.getCalendarById(CALENDAR_ID);
  const dryRun = property_('DRY_RUN', 'true') !== 'false';
  const sync = syncSheet_();
  const rows = sync.getDataRange().getValues();
  const known = {}, series = {};
  rows.slice(1).forEach(function (row, i) {
    known[row[0]] = { row: i + 2, decision: row[1], copyId: row[2] };
    remember_(series, row[0], row[1], row[7], row[3]);
  });

  const now = new Date();
  const until = new Date(now.getTime() + DAYS_AHEAD * 24 * 3600 * 1000);
  const seen = {};
  const reviews = [];
  const dryRunNotes = [];

  watchedCalendars_().forEach(function (calendarId) {
    const calendar = CalendarApp.getCalendarById(calendarId);
    if (!calendar) throw new Error('Can’t open calendar ' + calendarId);
    calendar.getEvents(now, until).forEach(function (event) {
      if (event.getTag('playdates')) return; // a booking this script made, not one of yours
      const key = eventKey_(event);
      seen[key] = true;
      const entry = known[key];
      if (entry && entry.decision === 'would publish' && !dryRun) {
        // Decided during the dry run: publish it now that DRY_RUN is off.
        const copy = publish_(playdates, event, JSON.parse(sync.getRange(entry.row, 8).getValue() || '{}'));
        sync.getRange(entry.row, 2, 1, 2).setValues([['published', copy.getId()]]);
        return;
      }
      if (entry) {
        if (entry.decision === 'published' && entry.copyId) followChanges_(event, playdates.getEventById(entry.copyId), sync, entry.row);
        return;
      }
      // A repeating event, or the same title added on several days, is judged once: the others follow.
      const earlier = series[seriesKey_(key)] || series[titleKey_(event.getTitle())];
      if (earlier && earlier.decision === 'review') {
        sync.appendRow([key, 'review', '', event.getTitle(), 'Same as earlier weeks: waiting for your review', new Date(), '', '']);
        remember_(series, key, 'review', '', event.getTitle());
        return;
      }
      const verdict = earlier
        ? (earlier.decision === 'private' ? { decision: 'private', reason: 'Same as earlier weeks' } : Object.assign({}, earlier.verdict, { decision: 'publish' }))
        : judge_(event);
      if (verdict.decision === 'publish' && dryRun) {
        dryRunNotes.push(verdict);
        sync.appendRow([key, 'would publish', '', event.getTitle(), verdict.reason, new Date(), '', JSON.stringify(verdict)]);
        remember_(series, key, 'would publish', JSON.stringify(verdict), event.getTitle());
      } else if (verdict.decision === 'publish') {
        const copy = publish_(playdates, event, verdict);
        sync.appendRow([key, 'published', copy.getId(), event.getTitle(), verdict.reason, new Date(), '', JSON.stringify(verdict)]);
        remember_(series, key, 'published', JSON.stringify(verdict), event.getTitle());
      } else if (verdict.decision === 'review') {
        const token = Utilities.getUuid();
        sync.appendRow([key, 'review', '', event.getTitle(), verdict.reason, new Date(), token, JSON.stringify(verdict)]);
        remember_(series, key, 'review', JSON.stringify(verdict), event.getTitle());
        reviews.push({ event: event, verdict: verdict, token: token });
      } else {
        sync.appendRow([key, 'private', '', event.getTitle(), verdict.reason, new Date(), '', '']);
        remember_(series, key, 'private', '', event.getTitle());
      }
    });
  });

  // An original that's gone (deleted, or moved off the watched calendars) takes its copy with it.
  rows.slice(1).forEach(function (row) {
    if (row[1] !== 'published' || seen[row[0]]) return;
    const start = Number(String(row[0]).split('_').pop());
    if (start < now.getTime()) return;
    const copy = row[2] && playdates.getEventById(row[2]);
    if (copy) copy.deleteEvent();
    const at = sync.getDataRange().getValues().findIndex(function (r) { return r[0] === row[0]; });
    if (at > 0) sync.getRange(at + 1, 2).setValue('removed');
  });

  if (reviews.length) emailReviews_(reviews);
  if (dryRunNotes.length) emailDryRun_(dryRunNotes);
}

// MARK: - Deciding

/** The key without its start time: the same for every week of a repeating event. */
function seriesKey_(key) {
  return String(key).split('_').slice(0, -1).join('_');
}

/** Keeps the strongest decision per series: yours (published, private) over review over would publish. */
function remember_(series, key, decision, verdict, title) {
  const rank = { 'would publish': 1, review: 2, published: 3, private: 3, booked: 3, removed: 0 };
  let parsed = null;
  try { parsed = verdict ? JSON.parse(verdict) : null; } catch (err) { parsed = null; }
  [seriesKey_(key), title ? titleKey_(title) : null].forEach(function (id) {
    if (!id) return;
    const current = series[id];
    if (current && (rank[current.decision] || 0) >= (rank[decision] || 0)) return;
    series[id] = { decision: decision, verdict: parsed };
  });
}

/** The same outing added on several days shares a title. */
function titleKey_(title) {
  return 'title:' + String(title || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Rules, then Claude, then checks on the public text. Returns {decision, reason, confidence, title, description, location}. */
function judge_(event) {
  const title = event.getTitle(), description = stripHtml_(event.getDescription()), location = event.getLocation();
  const rule = privateRule_(title, description, event.isAllDayEvent());
  if (rule) return { decision: 'private', reason: rule };

  let verdict;
  const details = { title: title, description: description, location: location,
      start: event.getStartTime().toString(), end: event.getEndTime().toString(), recurring: event.isRecurringEvent() };
  try {
    verdict = askClaude_(details);
  } catch (first) {
    try {
      verdict = askClaude_(details);
    } catch (err) {
      return { decision: 'review', reason: 'Couldn’t ask Claude (' + err.message + ')', title: title, description: '', location: location };
    }
  }
  if (verdict.decision !== 'publish') return verdict;
  if (!(verdict.confidence >= MIN_CONFIDENCE)) {
    return Object.assign({}, verdict, { decision: 'review', reason: 'Not sure enough (' + verdict.confidence + '): ' + verdict.reason });
  }
  const leak = leakCheck_([verdict.title, verdict.description, verdict.location].join('\n'), sensitiveWords_());
  if (leak) return Object.assign({}, verdict, { decision: 'review', reason: 'Public text mentions ' + leak });
  return verdict;
}

/** The first rule an event breaks, or null. All-day events are reminders, closures and deadlines. */
function privateRule_(title, description, allDay) {
  if (allDay) return 'All-day event';
  const checks = TITLE_PRIVATE.map(function (p) { return [p, title]; })
    .concat(STRONG_PRIVATE.map(function (p) { return [p, description]; }));
  for (let i = 0; i < checks.length; i++) {
    const match = String(checks[i][1] || '').match(checks[i][0]);
    if (match) return 'Looks personal (“' + match[0] + '”)';
  }
  return null;
}

/** What in a public text shouldn't be published, or null. */
function leakCheck_(text, sensitive) {
  for (let i = 0; i < sensitive.length; i++) {
    const word = sensitive[i].trim();
    if (word && new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text)) return 'a private name (“' + word + '”)';
  }
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(text)) return 'an email address';
  if (/(\+?\d[\s().-]?){10,}/.test(text) || /\(\d{3}\)\s*\d{3}-\d{4}/.test(text)) return 'a phone number';
  if (/\$\s?\d|\d+(\.\d\d)?\s?(usd|dollars)\b/i.test(text)) return 'a price';
  if (/\b(confirmation|order|booking|reservation|ticket)\s*(no\.?|number|#|code)/i.test(text)) return 'a booking reference';
  if (/\b[A-Z0-9-]*\d[A-Z0-9-]{5,}\b/.test(text.replace(/\b\d{1,5}\s+[A-Z][a-z]+/g, ''))) return 'a long code or number';
  return null;
}

/** How to write what other parents see, shared by deciding and by rewriting approved events. */
function writingRules_() {
  const hints = property_('PLACE_HINTS', '').trim();
  return [
    'Write what other parents will see.',
    'title: a clear, correctly spelled name for the outing, with the venue when it helps, e.g. "Open Jump at Sky Zone Mountlake Terrace" or "Story Time at Bothell Library". The calendar title is the family\'s own shorthand: fix typos, expand abbreviations, and capitalize properly. No family names or ticket counts.',
    'description: 1-3 friendly sentences with useful public info (what it is, whether to book tickets, where to meet). Never include names of family members, prices, order or confirmation numbers, phone numbers, emails, or who is coming.',
    'location: the venue name and city, plus the street address only if you are sure of it. Never a home address. If neither the event nor the notes say where it is, leave location empty and don\'t mention the missing place in the description (no "check back for details").',
    hints ? 'The family\'s notes on what their shorthand means (trust these):\n' + hints : '',
  ].filter(String).join('\n\n');
}

/**
 * Asks Claude about one event. `approved` means you already chose to publish it: Claude only
 * writes the public text.
 */
function askClaude_(event, approved) {
  const key = property_('ANTHROPIC_API_KEY', '');
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  const instructions = (approved ? [
    'The family has approved sharing this event from their private calendar on a public page where other parents can join with their kids.',
    writingRules_(),
    'Reply with only a JSON object: {"decision": "publish", "confidence": 1, "reason": "approved", "title": "", "description": "", "location": ""}',
  ] : [
    'You decide whether an event from a family\'s private calendar should be shared on a public page where other parents can see it and bring their kids along.',
    'publish: an outing or activity at a public venue that other families could join with their kids (a park, museum, show, festival, open play, holiday lights, a library story time). They would buy their own tickets if needed.',
    'private: anything personal: health, work, money, travel, school admin, appointments, lessons or classes booked just for this family, adult-only plans, or anything at a home address.',
    'review: if you are unsure.',
    'For publish and review: ' + writingRules_(),
    'Reply with only a JSON object: {"decision": "publish"|"private"|"review", "confidence": 0 to 1, "reason": "short", "title": "", "description": "", "location": ""}',
  ]).join('\n\n');
  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system: instructions,
      messages: [{ role: 'user', content: 'Event:\n' + JSON.stringify(event, null, 2) }],
    }),
  });
  if (response.getResponseCode() !== 200) throw new Error('HTTP ' + response.getResponseCode());
  const text = JSON.parse(response.getContentText()).content.map(function (part) { return part.text || ''; }).join('');
  const verdict = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  if (['publish', 'private', 'review'].indexOf(verdict.decision) === -1) throw new Error('unexpected answer');
  verdict.confidence = Number(verdict.confidence);
  return verdict;
}

// MARK: - Publishing and following changes

/** The public text for an event you approved, from Claude; null if it can't be written safely. */
function writePublic_(original) {
  try {
    const text = askClaude_({ title: original.getTitle(), description: stripHtml_(original.getDescription()),
      location: original.getLocation(), start: original.getStartTime().toString(), end: original.getEndTime().toString(),
      recurring: original.isRecurringEvent() }, true);
    if (!text.title || leakCheck_([text.title, text.description, text.location].join('\n'), sensitiveWords_())) return null;
    return text;
  } catch (err) {
    return null;
  }
}

/**
 * Run by hand after changing PLACE_HINTS or the writing rules: rewrites the title, description and
 * place of everything already published, once per series, and updates the copies.
 */
function refreshPublished() {
  const sync = syncSheet_();
  const rows = sync.getDataRange().getValues();
  const playdates = CalendarApp.getCalendarById(CALENDAR_ID);
  const written = {};
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] !== 'published' || !rows[i][2]) continue;
    const series = seriesKey_(rows[i][0]);
    if (!(series in written)) {
      const original = findOriginal_(rows[i][0]);
      written[series] = original ? writePublic_(original) : null;
      if (written[series]) written[series].sourceLocation = (original.getLocation() || '').trim();
    }
    const text = written[series], copy = playdates.getEventById(rows[i][2]);
    if (!text || !copy) continue;
    copy.setTitle(text.title);
    copy.setDescription(text.description || '');
    copy.setLocation(text.location || '');
    sync.getRange(i + 1, 8).setValue(JSON.stringify(text));
  }
  Logger.log(JSON.stringify(written, null, 2));
}

function publish_(playdates, event, verdict) {
  const options = { description: verdict.description || '', location: verdict.location || '' };
  return playdates.createEvent(verdict.title || event.getTitle(), event.getStartTime(), event.getEndTime(), options);
}

/** Keeps a published copy in step with the original: its time, and its text when you add or change the place. */
function followChanges_(original, copy, sync, row) {
  if (!copy) return;
  if (copy.getStartTime().getTime() !== original.getStartTime().getTime() || copy.getEndTime().getTime() !== original.getEndTime().getTime()) {
    copy.setTime(original.getStartTime(), original.getEndTime());
  }
  const place = (original.getLocation() || '').trim();
  if (!place || !sync) return;
  let saved = {};
  try { saved = JSON.parse(sync.getRange(row, 8).getValue() || '{}'); } catch (err) { saved = {}; }
  if (saved.sourceLocation === place) return;
  const text = writePublic_(original); // checked for names, contact details and codes
  if (!text) return;
  copy.setTitle(text.title);
  copy.setDescription(text.description || '');
  copy.setLocation(text.location || '');
  text.sourceLocation = place;
  sync.getRange(row, 8).setValue(JSON.stringify(text));
}

// MARK: - Review queue

function emailReviews_(reviews) {
  const base = WEB_APP_URL;
  const items = reviews.map(function (item) {
    const v = item.verdict, e = item.event;
    const link = function (action) { return base + '?action=' + action + '&token=' + encodeURIComponent(item.token); };
    return '<div style="border:3px solid #2b2350;border-radius:16px;padding:14px;margin:12px 0">' +
      '<b>' + escape_(e.getTitle()) + '</b><br>' + escape_(e.getStartTime().toString()) +
      '<p style="color:#6a6390">Why it’s here: ' + escape_(v.reason || '') + '</p>' +
      (v.title ? '<p>Would publish as: <b>' + escape_(v.title) + '</b><br>' + escape_(v.description || '') + '<br>' + escape_(v.location || '') + '</p>' : '') +
      (!v.location && !e.getLocation() ? '<p style="color:#c2185b"><b>No place set.</b> Add a location to the calendar event, or a line to PLACE_HINTS, before publishing.</p>' : '') +
      '<a href="' + link('approve') + '" style="background:#5ed27a;color:#fff;padding:10px 18px;border-radius:99px;text-decoration:none;font-weight:bold">Publish</a> ' +
      '<a href="' + link('skip') + '" style="background:#ff5a5f;color:#fff;padding:10px 18px;border-radius:99px;text-decoration:none;font-weight:bold">Keep private</a></div>';
  }).join('');
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: reviews.length === 1 ? 'Playdate check: ' + reviews[0].event.getTitle() : reviews.length + ' events to check for the playdate page',
    htmlBody: '<div style="font-family:system-ui,sans-serif;color:#2b2350"><p>Should these go on the playdate page?</p>' + items + '</div>',
  });
}

function emailDryRun_(verdicts) {
  const items = verdicts.map(function (v) {
    return '<li><b>' + escape_(v.title) + '</b> (' + Math.round(v.confidence * 100) + '% sure)<br>' + escape_(v.description) + '<br>' + escape_(v.location) + '</li>';
  }).join('');
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: 'Dry run: would publish ' + verdicts.length + ' playdate' + (verdicts.length === 1 ? '' : 's'),
    htmlBody: '<div style="font-family:system-ui,sans-serif;color:#2b2350"><p>Nothing was published (DRY_RUN is on). This is what would have gone up:</p><ul>' + items +
      '</ul><p>Happy with these? Set DRY_RUN to false in Script properties.</p></div>',
  });
}

/** Run by hand: emails the reviews still waiting for you again, one per outing. */
function resendReviews() {
  const rows = syncSheet_().getDataRange().getValues();
  const pending = {};
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] !== 'review' || !rows[i][6]) continue;
    const id = titleKey_(rows[i][3]);
    if (pending[id]) continue;
    const event = findOriginal_(rows[i][0]);
    if (event) pending[id] = { event: event, verdict: JSON.parse(rows[i][7] || '{}'), token: rows[i][6] };
  }
  const reviews = Object.keys(pending).map(function (id) { return pending[id]; });
  if (reviews.length) emailReviews_(reviews);
  Logger.log(reviews.length + ' sent');
}

/** The Publish and Keep private buttons in review emails. A decision covers every date of the same outing. */
function decideReview_(action, token) {
  const sync = syncSheet_();
  const rows = sync.getDataRange().getValues();
  const hit = rows.findIndex(function (row, i) { return i > 0 && token && row[6] === token && row[1] === 'review'; });
  if (hit < 1) return page_('Already decided, or the link is old.');
  const verdict = JSON.parse(rows[hit][7] || '{}');
  const series = seriesKey_(rows[hit][0]), title = titleKey_(rows[hit][3]);
  const playdates = CalendarApp.getCalendarById(CALENDAR_ID);
  let published = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] !== 'review' || (seriesKey_(rows[i][0]) !== series && titleKey_(rows[i][3]) !== title)) continue;
    if (action === 'skip') { sync.getRange(i + 1, 2).setValue('private'); continue; }
    const original = findOriginal_(rows[i][0]);
    if (!original) continue;
    // Claude often leaves vague events without public text: write it now, once for the series.
    if (!verdict.title) Object.assign(verdict, writePublic_(original) || { title: original.getTitle() });
    const text = Object.assign({}, verdict);
    if (leakCheck_([text.title, text.description, text.location].join('\n'), sensitiveWords_())) {
      text.title = 'Playdate'; text.description = ''; // never leak: publish the time and place only
    }
    const copy = publish_(playdates, original, text);
    sync.getRange(i + 1, 2, 1, 3).setValues([['published', copy.getId(), rows[i][3]]]);
    sync.getRange(i + 1, 8).setValue(JSON.stringify(text));
    published++;
  }
  if (action === 'skip') return page_('Kept private. It won’t go on the page.');
  return published ? page_('Published! It’s on the playdate page' + (published > 1 ? ' (' + published + ' dates).' : '.'))
    : page_('That event isn’t on the calendar any more.');
}

function findOriginal_(key) {
  const parts = String(key).split('_'), start = new Date(Number(parts.pop())), id = parts.join('_');
  const ids = watchedCalendars_();
  for (let i = 0; i < ids.length; i++) {
    const calendar = CalendarApp.getCalendarById(ids[i]);
    const match = calendar.getEvents(start, new Date(start.getTime() + 60000)).filter(function (e) { return e.getId().split('@')[0] === id; })[0];
    if (match) return match;
  }
  return null;
}

// MARK: - Helpers

function syncSheet_() {
  return sheet_('Sync', ['Event key', 'Decision', 'Playdates copy', 'Original title', 'Reason', 'Decided', 'Review token', 'Verdict']);
}

function watchedCalendars_() {
  const ids = property_('WATCHED_CALENDARS', '').split(',').map(function (id) { return id.trim(); }).filter(String);
  if (!ids.length) throw new Error('Set WATCHED_CALENDARS in Script properties to the Family calendar’s ID.');
  return ids;
}

function sensitiveWords_() {
  return property_('SENSITIVE_WORDS', '').split(',').map(function (w) { return w.trim(); }).filter(String);
}

function property_(name, fallback) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  return value === null ? fallback : value;
}

function page_(message) {
  return HtmlService.createHtmlOutput('<div style="font:20px system-ui;text-align:center;padding:48px;color:#2b2350">' + message + '</div>');
}
