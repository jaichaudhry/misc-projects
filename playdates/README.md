# Come Play!

A kid-style page where other parents can see our upcoming playdate outings, say they're coming,
add them to their own calendar, subscribe to the whole calendar, or get an email when we add one.

- **Site:** `index.html`, `styles.css`, `app.js`, settings in `config.js`. Plain HTML, CSS and
  JavaScript, served by GitHub Pages. All sounds are synthesized in the browser.
- **Backend:** `apps-script/Code.gs` and `Sync.gs`, a Google Apps Script web app bound to a Google
  Sheet. It reads the public **Playdates** Google Calendar, saves joins and email sign-ups to the
  sheet, and emails subscribers every hour when new events appear.
- **Automatic copying:** every 15 minutes `Sync.gs` looks at new events on the Family calendar and
  copies the ones other families could join onto the Playdates calendar, with a public title and
  description that leave out names, prices and booking details:
  1. Rules skip anything that looks personal (medical, work, money, travel, school notices, meetings,
     all-day reminders). These events never leave Google.
  2. Claude decides on the rest: publish, private, or not sure.
  3. The public text is checked for family names, emails, phone numbers, prices and booking codes.
     Anything flagged, or anything Claude is less than 85% sure about, goes to a review email with
     **Publish** and **Keep private** buttons.

  Every decision is logged in the sheet's *Sync* tab. Published copies follow the original's time,
  and come off the page if the original is deleted.

Parents' notes and email addresses stay in the sheet; the site shows only each family's nickname
and number of kids.

## One-time setup (about 10 minutes)

1. **Create the calendar.** In Google Calendar on the web: *Other calendars › + › Create new
   calendar*, name it "Playdates". Then open its settings:
   - *Access permissions for events › Make available to public* (see all event details).
   - *Integrate calendar* › copy the **Calendar ID**.
2. **Create the backend.**
   - Make a new Google Sheet called "Playdates", then *Extensions › Apps Script*.
   - Replace the code with `apps-script/Code.gs`, add a second script file named `Sync` with
     `apps-script/Sync.gs`, and paste the Playdates Calendar ID into `CALENDAR_ID`.
   - *Project Settings › Script properties*, add:
     - `WATCHED_CALENDARS`: the Family calendar's ID (more than one, comma-separated, is fine).
     - `ANTHROPIC_API_KEY`: a Claude API key.
     - `SENSITIVE_WORDS`: comma-separated names and places that must never be published (your
       family's first and last names, the kids' school, your street).
     - `DRY_RUN`: `true`. For the first days it only emails you what it *would* publish.
   - Choose the `setup` function and click *Run*. Approve the permissions (Calendar, Sheets, sending
     email, calling the Claude API). It creates the sheet tabs and the triggers.
   - *Deploy › New deployment › Web app*: execute as **Me**, who has access **Anyone**. Copy the
     web app URL.
3. **Point the site at them.** In `config.js`, set `scriptUrl` to the web app URL and `calendarId`
   to the Calendar ID, then commit and push.

4. **Go live.** When the dry-run emails look right, set `DRY_RUN` to `false`. Anything it marked
   "would publish" goes up on the next run.

## Adding a playdate

Put it on the Family calendar as usual. Within 15 minutes it's either on the page, kept private, or
in your inbox for review. To publish something by hand, add it straight to the Playdates calendar.
To take something down, delete it from the Playdates calendar; to stop the sync re-adding it, set
its row in the *Sync* tab to `private`.

## After changing `Code.gs`

*Deploy › Manage deployments › Edit › Version: New version › Deploy*, so the URL keeps working with
the new code.
