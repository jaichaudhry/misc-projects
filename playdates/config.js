// Settings for the playdates site. Fill these in after the one-time setup in README.md.
window.PLAYDATES = {
  // The Apps Script web app URL (Deploy › New deployment › Web app). Empty: the site shows
  // `fallbackEvents` and joins stay on the visitor's device.
  scriptUrl: '',
  // The public Playdates calendar's ID, for the Subscribe buttons.
  calendarId: 'd7a58c65618e83092b219fb1e2f456cfaaf95b431ea4eb50a6e5766ff0c6bc56@group.calendar.google.com',
  // Times are shown in this time zone.
  timeZone: 'America/Los_Angeles',

  // Shown only until scriptUrl is set (or if the calendar can't be reached).
  fallbackEvents: [
    {
      id: 'garden-dlights-2026-12-06',
      title: "Garden d'Lights",
      start: '2026-12-06T16:30:00-08:00',
      end: '2026-12-06T17:30:00-08:00',
      location: 'Bellevue Botanical Garden, 12001 Main St, Bellevue, WA 98005',
      description: 'A twinkly holiday light walk through the garden, about 30–45 minutes outdoors (it’s on even in the rain, so bring boots!). Get your own timed-entry tickets for the 4:30 PM slot. Parking is $5 in the garden lot, or free at Wilburton Hill Park a short walk east.',
      going: [],
    },
    {
      id: 'santa-train-2026-12-19',
      title: 'North Pole Limited Santa Train',
      start: '2026-12-19T16:00:00-08:00',
      end: '2026-12-19T17:30:00-08:00',
      location: 'Northwest Railway Museum, Snoqualmie, WA',
      description: 'All aboard to visit Santa! Book your own tickets for the 4:00 PM North Pole Limited; they sell out fast. The museum boards from more than one depot, so check your ticket for where to meet.',
      going: [],
    },
  ],
};
