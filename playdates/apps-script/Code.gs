/**
 * Playdates backend: a Google Apps Script web app bound to a Google Sheet.
 *
 * - GET  ?action=events        upcoming events from the public Playdates calendar, with who's coming
 * - GET  ?action=unsubscribe&token=…   stops the new-playdate emails for one address
 * - POST {type: "join", …}     a family says they're coming (saved to the "Joins" sheet)
 * - POST {type: "alerts", …}   a parent asks for an email when a new playdate is added
 * - emailNewPlaydates()        runs every hour (see setup()), emails subscribers about new events
 *
 * Only what's in the Playdates calendar is ever published. Parents' email addresses and notes stay
 * in this sheet and are never sent back to the website.
 */

// The Playdates calendar's ID (Google Calendar › Settings for the calendar › Integrate calendar).
const CALENDAR_ID = 'PASTE_PLAYDATES_CALENDAR_ID_HERE';
// The website's address, used in emails.
const SITE_URL = 'https://jaichaudhry.github.io/misc-projects/playdates/';
// How far ahead the website shows events.
const DAYS_AHEAD = 120;

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'events';
  if (action === 'unsubscribe') return unsubscribe_(e.parameter.token);
  return json_({ events: upcomingEvents_() });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'That didn’t look right. Please try again.' });
  }
  if (body.website) return json_({ ok: true }); // honeypot field: bots fill it, people don't see it
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (body.type === 'join') return join_(body);
    if (body.type === 'alerts') return subscribe_(body);
    return json_({ ok: false, error: 'Unknown request.' });
  } finally {
    lock.releaseLock();
  }
}

// MARK: - Events

function upcomingEvents_() {
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!calendar) throw new Error('Set CALENDAR_ID to the Playdates calendar’s ID.');
  const now = new Date();
  const until = new Date(now.getTime() + DAYS_AHEAD * 24 * 3600 * 1000);
  const joins = joinsByEvent_();
  return calendar.getEvents(now, until).map(function (event) {
    const id = eventKey_(event);
    return {
      id: id,
      title: event.getTitle(),
      start: event.getStartTime().toISOString(),
      end: event.getEndTime().toISOString(),
      allDay: event.isAllDayEvent(),
      location: event.getLocation(),
      description: stripHtml_(event.getDescription()),
      going: joins[id] || [],
    };
  });
}

/** One key per occurrence, so each week of a repeating event has its own guest list. */
function eventKey_(event) {
  return event.getId().split('@')[0] + '_' + event.getStartTime().getTime();
}

function stripHtml_(text) {
  return String(text || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim()
    .slice(0, 600);
}

// MARK: - Joins

function join_(body) {
  const eventId = clean_(body.eventId, 120);
  const nickname = clean_(body.nickname, 40);
  const kids = Math.max(0, Math.min(10, parseInt(body.kids, 10) || 0));
  const note = clean_(body.note, 300);
  if (!eventId || !nickname) return json_({ ok: false, error: 'Please add a family nickname.' });
  sheet_('Joins', ['When', 'Event', 'Nickname', 'Kids', 'Note'])
    .appendRow([new Date(), eventId, nickname, kids, note]);
  return json_({ ok: true });
}

/** Only nickname and kid count are published; notes stay in the sheet. */
function joinsByEvent_() {
  const rows = sheet_('Joins', ['When', 'Event', 'Nickname', 'Kids', 'Note']).getDataRange().getValues().slice(1);
  const byEvent = {};
  rows.forEach(function (row) {
    const list = byEvent[row[1]] || (byEvent[row[1]] = []);
    list.push({ nickname: String(row[2]), kids: Number(row[3]) || 0 });
  });
  return byEvent;
}

// MARK: - Email alerts

function subscribe_(body) {
  const email = clean_(body.email, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json_({ ok: false, error: 'That email doesn’t look right.' });
  const sheet = sheet_('Subscribers', ['Email', 'Token', 'Since']);
  const exists = sheet.getDataRange().getValues().slice(1).some(function (row) { return row[0] === email; });
  if (!exists) {
    const token = Utilities.getUuid();
    sheet.appendRow([email, token, new Date()]);
    MailApp.sendEmail({
      to: email,
      subject: 'You’re on the playdate list! 🎈',
      htmlBody: emailHtml_('You’re on the list!',
        '<p>We’ll email you whenever a new playdate goes on our calendar.</p>' +
        '<p><a href="' + SITE_URL + '">See what’s coming up</a></p>', token),
    });
  }
  return json_({ ok: true });
}

function unsubscribe_(token) {
  const sheet = sheet_('Subscribers', ['Email', 'Token', 'Since']);
  const rows = sheet.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (token && rows[i][1] === token) sheet.deleteRow(i + 1);
  }
  return HtmlService.createHtmlOutput(
    '<div style="font:20px system-ui;text-align:center;padding:48px">You won’t get any more playdate emails. 👋</div>');
}

/** Hourly: emails every subscriber about events added since the last run. */
function emailNewPlaydates() {
  const properties = PropertiesService.getScriptProperties();
  const seen = JSON.parse(properties.getProperty('seenEvents') || 'null');
  const events = upcomingEvents_();
  const ids = events.map(function (event) { return event.id; });
  properties.setProperty('seenEvents', JSON.stringify(ids));
  if (seen === null) return; // first run: remember what's there without emailing about it
  const fresh = events.filter(function (event) { return seen.indexOf(event.id) === -1; });
  if (fresh.length === 0) return;

  const timeZone = CalendarApp.getCalendarById(CALENDAR_ID).getTimeZone();
  const list = fresh.map(function (event) {
    const when = Utilities.formatDate(new Date(event.start), timeZone, event.allDay ? 'EEE d MMM' : 'EEE d MMM, h:mm a');
    return '<li><b>' + escape_(event.title) + '</b><br>' + when +
      (event.location ? '<br>' + escape_(event.location) : '') + '</li>';
  }).join('');
  const subject = fresh.length === 1 ? 'New playdate: ' + fresh[0].title + ' 🎈' : fresh.length + ' new playdates 🎈';
  sheet_('Subscribers', ['Email', 'Token', 'Since']).getDataRange().getValues().slice(1).forEach(function (row) {
    MailApp.sendEmail({
      to: row[0],
      subject: subject,
      htmlBody: emailHtml_('Come play!', '<ul>' + list + '</ul><p><a href="' + SITE_URL + '">Say you’re coming</a></p>', row[1]),
    });
  });
}

function emailHtml_(heading, body, token) {
  const leave = ScriptApp.getService().getUrl() + '?action=unsubscribe&token=' + encodeURIComponent(token);
  return '<div style="font-family:system-ui,sans-serif;font-size:16px;color:#2b2350">' +
    '<h2 style="color:#ff5a5f">' + heading + '</h2>' + body +
    '<p style="font-size:12px;color:#777;margin-top:32px"><a href="' + leave + '">Stop these emails</a></p></div>';
}

// MARK: - Setup and helpers

/** Run once from the editor: creates the sheets and the hourly email trigger. */
function setup() {
  sheet_('Joins', ['When', 'Event', 'Nickname', 'Kids', 'Note']);
  sheet_('Subscribers', ['Email', 'Token', 'Since']);
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'emailNewPlaydates') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('emailNewPlaydates').timeBased().everyHours(1).create();
  emailNewPlaydates(); // remembers today's events, so subscribers only hear about new ones
  Logger.log(JSON.stringify(upcomingEvents_(), null, 2));
}

function sheet_(name, headers) {
  const spreadsheet = SpreadsheetApp.getActive();
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function clean_(value, max) {
  return String(value == null ? '' : value).replace(/[<>]/g, '').trim().slice(0, max);
}

function escape_(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
