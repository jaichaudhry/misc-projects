/**
 * Playdates backend: a Google Apps Script web app bound to a Google Sheet.
 *
 * - GET  ?action=events        upcoming events from the public Playdates calendar, with who's coming
 * - GET  ?action=unsubscribe&token=…   stops the new-playdate emails for one address
 * - POST {type: "join", …}     a family books an outing: one family per outing (Bookings.gs)
 * - POST {type: "alerts", …}   a parent asks for an email when a new playdate is added
 * - emailNewPlaydates()        runs every hour (see setup()), emails subscribers about new events
 * - syncFamilyCalendar()       runs every 15 minutes, copies joinable outings from the Family calendar
 *                              (Sync.gs), with a review queue for anything it isn't sure about
 *
 * Only what's in the Playdates calendar is ever published. Parents' email addresses and notes stay
 * in this sheet and are never sent back to the website.
 */

// The Playdates calendar's ID (Google Calendar › Settings for the calendar › Integrate calendar).
const CALENDAR_ID = 'd7a58c65618e83092b219fb1e2f456cfaaf95b431ea4eb50a6e5766ff0c6bc56@group.calendar.google.com';
// The website's address, used in emails.
const SITE_URL = 'https://swiftworksolutions.com/playwithpjs/';
// How far ahead the website shows events.
const DAYS_AHEAD = 120;

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'events';
  if (action === 'unsubscribe') return unsubscribe_(e.parameter.token);
  if (action === 'approve' || action === 'skip') return decideReview_(action, e.parameter.token);
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
    if (body.type === 'join') return json_(book_(body));
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
    };
  });
}

/** One key per occurrence, so each week of a repeating event can be booked on its own. */
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

/** Run once from the editor: creates the sheets and the triggers (emails hourly, sync every 15 minutes). */
function setup() {
  bookingsSheet_();
  sheet_('Subscribers', ['Email', 'Token', 'Since']);
  syncSheet_();
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (['emailNewPlaydates', 'syncFamilyCalendar'].indexOf(trigger.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('emailNewPlaydates').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('syncFamilyCalendar').timeBased().everyMinutes(15).create();
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
