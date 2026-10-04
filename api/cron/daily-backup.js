// GET /api/cron/daily-backup — runs on Vercel's schedule (see vercel.json).
// Vercel signs its own cron requests with an Authorization header matching
// the CRON_SECRET env var; set CRON_SECRET in Vercel Project Settings so
// nobody else can trigger this by just guessing the URL.
//
// Also sends the daily birthday/anniversary/yahrzeit reminder push, AND
// (Sundays only) the weekly debt reminder email/push — both bundled into
// this same once-a-day cron rather than their own separate entries.
// vercel.json lists three cron paths, but empirically Vercel's Hobby plan
// only ever actually registers ONE of a project's cron entries (confirmed
// via the dashboard's Cron Jobs tab, which listed just this one) — the
// other two were silently never invoked, which is why the weekly debt email
// never went out and the old client-side birthday check (which only ran if
// someone happened to open the app that day) was the sole source of that
// reminder. Doing all three here, gated by day-of-week where relevant, is
// the only way that's actually reliable on this plan.
const { getDb, getMessaging, dedupeTokenDocs, notifPrefAllows, isShabbatNow, isYomTovNow, sendViaEmailJS, notifEmailHtml } = require('../_lib/firebaseAdmin');
const { allOccasions } = require('../_lib/birthdayCalc');
const { sendWeeklyDebtReminders } = require('./weekly-debt-reminder');
const { flushPhoneQueue } = require('../_lib/yemot');

const BACKUP_RETENTION_DAYS = 30;

async function sendBirthdayReminders(db, data) {
  const all = allOccasions(data.families || [], data.yahrzeits || []);
  if (!all.length) return { occasions: 0, sent: 0 };

  // Registered emails (family+slot) that opted into email-instead-of-push
  // (see the 📧 toggle in app.js's notifPrefModal) for the 'birthday'
  // category — their own fcmTokens devices are excluded from the push loop
  // below, and they get an EmailJS send per occasion instead. This cron has
  // no live browser to drive the client's own EmailJS call, so it needs the
  // same publicKey/serviceId/templateId mirrored server-side
  // (settings/emailjs) that sendWeeklyDebtReminders already relies on.
  // Email and push are independent: a slot gets the email if it checked
  // birthdays, and its devices are dropped from push only if it also chose
  // "no push" (pref.push !== true — older prefs predate the choice and were
  // always email-instead-of-push).
  const emailSlots = new Set(), pushOffSlots = new Set();
  (data.families || []).forEach(f => {
    if (!f.notifEmailPref) return;
    [1, 2].forEach(slot => {
      const pref = f.notifEmailPref[slot]; if (!pref) return;
      if (pref.cats?.birthday) emailSlots.add(f.id + ':' + slot);
      if (pref.push !== true) pushOffSlots.add(f.id + ':' + slot);
    });
  });
  const ejsSnap = emailSlots.size ? await db.doc('settings/emailjs').get() : null;
  const ejsCreds = ejsSnap?.exists ? ejsSnap.data() : null;

  const tokSnap = await db.collection('fcmTokens').get();
  if (tokSnap.empty && !emailSlots.size) return { occasions: 0, sent: 0 };
  const tokenDocs = await dedupeTokenDocs(tokSnap.docs);
  const LINKS = {
    admin: 'https://yankeleviz.vercel.app/admin.html',
    index: 'https://yankeleviz.vercel.app/',
  };
  const groups = { admin: [], index: [] };
  tokenDocs.forEach(d => {
    const t = d.data();
    if (t.page !== 'admin' && t.famId != null && t.slot != null && pushOffSlots.has(t.famId + ':' + t.slot)) return;
    groups[t.page === 'admin' ? 'admin' : 'index'].push(d);
  });

  const dayFmt = new Intl.DateTimeFormat('he-IL-u-ca-hebrew-nu-latn', { day: 'numeric' });
  const monthFmt = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { month: 'long' });
  const today = new Date();
  // Intl renders Adar as plain "אדר" in a regular year but "אדר א׳"/"אדר ב׳" in a
  // leap year — an occasion saved in one kind of year never string-equals today's
  // month name in the other, silently skipping it for years at a time. Treat any
  // Adar variant as interchangeable (same fix as app.js's calendar matching).
  const hebMonthEq = (a, b) => a === b || (!!a && !!b && a.startsWith('אדר') && b.startsWith('אדר'));

  let sent = 0, occasions = 0;
  for (let i = 0; i <= 1; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    const hd = parseInt(dayFmt.format(d)), hm = monthFmt.format(d);
    for (const b of all.filter(x => x.hebDay === hd && hebMonthEq(x.hebMonth, hm))) {
      occasions++;
      const isAnniv = b.kind === 'anniversary';
      const isYahrzeit = b.kind === 'yahrzeit';
      const title = isYahrzeit ? (i === 0 ? '🕯️ יארצייט היום' : '🕯️ יארצייט מחר')
        : isAnniv ? (i === 0 ? '💍 יום נישואין היום!' : '💍 יום נישואין מחר')
        : (i === 0 ? '🎂 יום הולדת היום!' : '🎂 יום הולדת מחר');
      const body = isYahrzeit ? (i === 0 ? 'היום היארצייט של ' + b.name : 'מחר היארצייט של ' + b.name)
        : isAnniv ? (i === 0 ? 'מזל טוב למשפחת ' + b.name + '!' : 'מחר יום הנישואין של משפחת ' + b.name)
        : (i === 0 ? 'יום הולדת שמח ל' + b.name + '!' : 'מחר יום ההולדת של ' + b.name);

      for (const [page, allDocs] of Object.entries(groups)) {
        // A family device's own notifPref ('important'/'mine'/'all') only
        // ever filters family-page pushes — the admin device always gets
        // everything. Birthdays/anniversaries/yahrzeits are kind
        // 'birthday'; b.famId (when set — yahrzeits have none) is who a
        // "רק שלנו" device needs to match to still get it.
        const docs = page === 'index'
          ? allDocs.filter(d => notifPrefAllows(d.data().notifPref, 'birthday', b.famId != null ? [b.famId] : undefined, d.data().famId, undefined, { cats: d.data().pushCats, scopes: d.data().pushScopes }))
          : allDocs;
        if (!docs.length) continue;
        try {
          // Data-only (no top-level `notification`) — see notify.js for why:
          // a notification payload gets auto-displayed by the browser's push
          // service AND by our own onBackgroundMessage handler, doubling it.
          const resp = await getMessaging().sendEachForMulticast({
            tokens: docs.map(d => d.data().token),
            data: { title, body, icon: 'https://yankeleviz.vercel.app/icon.jpg', link: LINKS[page] },
          });
          sent += resp.successCount;
          const dead = docs.filter((_, i) => !resp.responses[i]?.success);
          if (dead.length) {
            await Promise.all(dead.map(d => d.ref.delete()));
            groups[page] = groups[page].filter(d => !dead.includes(d));
          }
        } catch (e) {
          console.error(`dailyBackup: birthday push failed [${page}]`, e);
        }
      }

      if (ejsCreds?.publicKey && ejsCreds?.serviceId && ejsCreds?.templateId) {
        for (const key of emailSlots) {
          const [fidStr, slotStr] = key.split(':');
          const fam = (data.families || []).find(f => f.id === parseInt(fidStr));
          if (!fam) continue;
          const email = slotStr === '2' ? fam.email2 : fam.email;
          if (!email) continue;
          const famName = fam.name.replace('משפחת', '').trim();
          const html = notifEmailHtml(title.split(' ')[0], title, body);
          try {
            await sendViaEmailJS(ejsCreds.publicKey, ejsCreds.serviceId, ejsCreds.templateId, email, famName, title + ' · ינקלביץ', body, html);
            sent++;
          } catch (e) {
            console.error('dailyBackup: birthday email failed for', email, e);
          }
        }
      }
    }
  }
  return { occasions, sent };
}

module.exports = async (req, res) => {
  // Fail closed, not open: if CRON_SECRET is ever missing from Vercel's env
  // (unset, wrong environment scope), this used to let the request through
  // for anyone who found the URL, silently triggering full data backups,
  // birthday pushes, and (Sundays) debt-reminder emails on demand.
  const auth = req.headers['authorization'];
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  // Nothing runs on Shabbat or Yom Tov — no backup, no reminders, no debt
  // email. The schedule (vercel.json) fires daily at 6:00 UTC, which lands
  // Saturday morning in Israel (skipped by isShabbatNow) and would
  // otherwise also land during Rosh Hashana, Yom Kippur, Sukkot/Pesach's
  // first and last days, and Shavuot (skipped by isYomTovNow).
  if (isShabbatNow() || isYomTovNow()) { res.status(200).json({ ok: true, skipped: 'shabbat' }); return; }

  const db = getDb();
  const snap = await db.doc('appData/familyPayments').get();
  if (!snap.exists) { res.status(200).json({ ok: true, skipped: true }); return; }
  const data = snap.data();

  const today = new Date().toISOString().slice(0, 10);
  await db.doc(`backups/${today}`).set({ data, backedUpAt: new Date().toISOString() });

  const cutoff = new Date(Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const old = await db.collection('backups').where('__name__', '<', db.doc(`backups/${cutoff}`)).get();
  await Promise.all(old.docs.map(d => d.ref.delete()));

  let reminders = { occasions: 0, sent: 0 };
  try {
    reminders = await sendBirthdayReminders(db, data);
  } catch (e) {
    console.error('dailyBackup: birthday reminder step failed', e);
  }

  let debtReminders = { skipped: 'not sunday' };
  if (new Date().getUTCDay() === 0) {
    try {
      debtReminders = await sendWeeklyDebtReminders(db, data);
    } catch (e) {
      console.error('dailyBackup: weekly debt reminder step failed', e);
    }
  }

  // All of the morning's kosher-phone calls at once: the weekly debt reminder
  // and anything that came in during last night's quiet hours.
  let phoneCalls = {};
  try {
    phoneCalls = await flushPhoneQueue(db, debtReminders.phoneEntries || []);
  } catch (e) {
    console.error('dailyBackup: phone calls failed', e);
  }
  delete debtReminders.phoneEntries;

  res.status(200).json({ ok: true, date: today, deletedOld: old.docs.length, reminders, debtReminders, phoneCalls });
};
