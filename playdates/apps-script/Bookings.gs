/**
 * One family per playdate.
 *
 * When a family says yes on the website, book_() takes the outing off the Playdates calendar (and so
 * off the site), puts "Playdate: … with <family>" on the Family calendar with the family invited as a
 * guest, and emails you. checkBookings_() runs with every sync: if the family declines the invite,
 * is removed from it, or you delete the booking, the outing goes back on the Playdates calendar.
 */

const BOOKING_HEADERS = ['Booked', 'Status', 'Family', 'Kids', 'Email', 'Note', 'Booking event',
  'Sync key', 'Public text', 'Start', 'End', 'Updated'];

const TAKEN_MESSAGE = 'Oh, another family just said yes to this one! Pick another adventure below, there’s more fun coming.';

/** A family says yes. Returns {ok} or {ok: false, taken, error}. */
function book_(body) {
  const eventId = clean_(body.eventId, 120);
  const nickname = clean_(body.nickname, 40);
  const email = clean_(body.email, 120).toLowerCase();
  const kids = Math.max(0, Math.min(10, parseInt(body.kids, 10) || 0));
  const note = clean_(body.note, 300);
  if (!eventId || !nickname) return { ok: false, error: 'Please add a family nickname.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Please add an email so we can send you the invite.' };

  const copy = findCopy_(eventId);
  if (!copy) return { ok: false, taken: true, error: TAKEN_MESSAGE };

  const text = { title: copy.getTitle(), description: stripHtml_(copy.getDescription()), location: copy.getLocation() };
  const start = copy.getStartTime(), end = copy.getEndTime();
  const familyCalendar = CalendarApp.getCalendarById(watchedCalendars_()[0]);
  const booking = familyCalendar.createEvent('Playdate: ' + text.title + ' with ' + nickname, start, end, {
    location: text.location,
    guests: email,
    sendInvites: true,
    description: text.description + '\n\n' +
      'It’s a playdate! This one is all yours: we keep each outing to one family so the kids get real time together.\n' +
      'Playing with: ' + nickname + (kids ? ' (' + kids + (kids === 1 ? ' kid' : ' kids') + ')' : '') + '\n' +
      (note ? 'Your note: ' + note + '\n' : '') +
      '\nIf plans change, just decline this invite and we’ll put the outing back for another family. No worries at all!',
  });
  booking.setTag('playdates', 'booked');
  booking.setGuestsCanSeeGuests(false);

  // Off the public calendar and the site. The sync row remembers it's booked, so it isn't re-added.
  const syncKey = markSync_(copy.getId(), 'booked', '');
  copy.deleteEvent();

  bookingsSheet_().appendRow([new Date(), 'booked', nickname, kids, email, note, booking.getId(), syncKey,
    JSON.stringify(text), start, end, new Date()]);
  notifyOwner_('Playdate booked: ' + text.title + ' 🎉',
    '<p><b>' + escape_(nickname) + '</b>' + (kids ? ' (' + kids + (kids === 1 ? ' kid' : ' kids') + ')' : '') +
    ' said yes to <b>' + escape_(text.title) + '</b> on ' + escape_(start.toString()) + '.</p>' +
    (note ? '<p>Their note: “' + escape_(note) + '”</p>' : '') +
    '<p>They’ve been sent an invite at ' + escape_(email) + ', and the outing is off the page. ' +
    'It’s on the Family calendar as “Playdate: … with ' + escape_(nickname) + '”. Delete that event to cancel and put the outing back.</p>');
  return { ok: true };
}

/** Every 15 minutes: puts outings back when a booking falls through, and closes past ones. */
function checkBookings_() {
  const sheet = bookingsSheet_();
  const rows = sheet.getDataRange().getValues();
  const familyCalendar = CalendarApp.getCalendarById(watchedCalendars_()[0]);
  const now = new Date();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[1] !== 'booked') continue;
    const end = new Date(row[10]);
    if (end < now) { sheet.getRange(i + 1, 2).setValue('done'); continue; }
    const booking = familyCalendar.getEventById(row[6]);
    let why = null;
    if (!booking) {
      why = 'you removed the booking';
    } else {
      const guest = booking.getGuestByEmail(row[4]);
      if (!guest) why = 'they’re no longer on the invite';
      else if (guest.getGuestStatus() === CalendarApp.GuestStatus.NO) why = 'they declined the invite';
    }
    if (!why) continue;
    if (booking) booking.deleteEvent();
    release_(row);
    sheet.getRange(i + 1, 2).setValue('released');
    sheet.getRange(i + 1, 12).setValue(new Date());
    const text = JSON.parse(row[8] || '{}');
    notifyOwner_(text.title + ' is open again',
      '<p><b>' + escape_(row[2]) + '</b> can’t make <b>' + escape_(text.title) + '</b> after all (' + why + '), ' +
      'so it’s back on the playdate page for another family.</p>');
  }
}

/** Puts a released outing back on the Playdates calendar, and tells the sync it's published again. */
function release_(row) {
  const text = JSON.parse(row[8] || '{}');
  const copy = CalendarApp.getCalendarById(CALENDAR_ID).createEvent(text.title || 'Playdate', new Date(row[9]), new Date(row[10]),
    { description: text.description || '', location: text.location || '' });
  if (row[7]) setSyncRow_(row[7], 'published', copy.getId());
}

// MARK: - Helpers

/** The Playdates calendar event for a website event id (`<event id>_<start ms>`), or null if it's gone. */
function findCopy_(eventId) {
  const parts = String(eventId).split('_'), start = Number(parts.pop()), id = parts.join('_');
  if (!start || !id) return null;
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  return calendar.getEvents(new Date(start), new Date(start + 60000)).filter(function (event) {
    return event.getId().split('@')[0] === id && event.getStartTime().getTime() === start;
  })[0] || null;
}

/** Sets the Sync row whose Playdates copy is `copyId`; returns that row's key ('' for events added by hand). */
function markSync_(copyId, decision, newCopyId) {
  const sync = syncSheet_();
  const rows = sync.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][2] !== copyId) continue;
    sync.getRange(i + 1, 2, 1, 2).setValues([[decision, newCopyId]]);
    return rows[i][0];
  }
  return '';
}

function setSyncRow_(key, decision, copyId) {
  const sync = syncSheet_();
  const rows = sync.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === key) { sync.getRange(i + 1, 2, 1, 2).setValues([[decision, copyId]]); return; }
  }
}

function bookingsSheet_() {
  return sheet_('Bookings', BOOKING_HEADERS);
}

function notifyOwner_(subject, html) {
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: subject,
    htmlBody: '<div style="font-family:system-ui,sans-serif;font-size:16px;color:#2b2350">' + html + '</div>',
  });
}
