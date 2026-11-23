# Come Play!

A kid-style page where other parents can see our upcoming playdate outings, say they're coming,
add them to their own calendar, subscribe to the whole calendar, or get an email when we add one.

- **Site:** `index.html`, `styles.css`, `app.js`, settings in `config.js`. Plain HTML, CSS and
  JavaScript, served by GitHub Pages. All sounds are synthesized in the browser.
- **Backend:** `apps-script/Code.gs`, a Google Apps Script web app bound to a Google Sheet. It reads
  the public **Playdates** Google Calendar, saves joins and email sign-ups to the sheet, and emails
  subscribers every hour when new events appear.

Only what's on the Playdates calendar is ever published. Keep everything else on the Family calendar.
Parents' notes and email addresses stay in the sheet; the site shows only each family's nickname
and number of kids.

## One-time setup (about 10 minutes)

1. **Create the calendar.** In Google Calendar on the web: *Other calendars › + › Create new
   calendar*, name it "Playdates". Then open its settings:
   - *Access permissions for events › Make available to public* (see all event details).
   - *Integrate calendar* › copy the **Calendar ID**.
2. **Create the backend.**
   - Make a new Google Sheet called "Playdates", then *Extensions › Apps Script*.
   - Replace the code with `apps-script/Code.gs` and paste the Calendar ID into `CALENDAR_ID`.
   - Choose the `setup` function and click *Run*. Approve the permissions (Calendar, Sheets, sending
     email). It creates the *Joins* and *Subscribers* tabs and the hourly email trigger.
   - *Deploy › New deployment › Web app*: execute as **Me**, who has access **Anyone**. Copy the
     web app URL.
3. **Point the site at them.** In `config.js`, set `scriptUrl` to the web app URL and `calendarId`
   to the Calendar ID, then commit and push.

## Adding a playdate

Add an event to the **Playdates** calendar (or *Duplicate* one from Family into it). Write the title,
time and place as you'd want other parents to see them, and anything useful in the description.
Within a few minutes it's on the site, on subscribers' calendars, and within the hour subscribers
get an email.

## After changing `Code.gs`

*Deploy › Manage deployments › Edit › Version: New version › Deploy*, so the URL keeps working with
the new code.
