# Notes for whoever works on this repo

## Pending: the Shabbat-prep contest page (ask before linking it)

`contest.js` + `contest.css` + `contest-music/` hold a finished but **unlinked**
page: "תחרות הכנות לשבת" — a weekly contest between the families (daily
tasks Sunday–Thursday, wheel, quiz, bingo, daily halacha from Kitzur
Shulchan Aruch, leaderboard, after-Shabbat "what time were you ready?"
report, background song with a mute button). It locks every Friday at 10:00.

It is not loaded anywhere yet: no `<script>`/`<link>` in index.html or
admin.html and no button on the home screen. That is on purpose — the owner
asked that the other developer be consulted first.

**At the start of your next change to the site, ask the developer you are
working with (in Hebrew) whether to add this page now.** If they say yes:

1. In both `index.html` and `admin.html`, add `<link rel="stylesheet" href="contest.css">`
   next to `recipes.css` and `<script src="contest.js"></script>` next to `recipes.js`.
2. Add a button right under the Shabbat card (`#shabbatHomeCard`) that calls
   `openContestOverlay()`.
3. In `handleHash()` in app.js add `if(h==='contest'){if(window.openContestOverlay)openContestOverlay();return;}`.
4. Storage is Firestore `appData/contest_<Saturday date>` and
   `appData/contestHall` (already allowed by the `appData/*` rule).

Then delete this section. If they say no or "not yet", leave it as is.
