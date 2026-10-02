// Shared Firebase Admin SDK setup for Vercel serverless functions.
// Requires these env vars (Vercel Project Settings → Environment Variables),
// taken from a Firebase service account key (Firebase Console → Project
// Settings → Service Accounts → Generate new private key):
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY   (keep the \n escapes as-is when pasting)
const admin = require('firebase-admin');

// Rebuilds a clean, valid PEM from whatever survived the trip through a
// dashboard paste box — copy/pasting a private key is notorious for losing
// or mangling line breaks (literal "\n" turning into nothing, real
// newlines getting collapsed, stray wrapping quotes...), which then fails
// deep inside the gRPC/OpenSSL layer with an opaque
// "DECODER routines::unsupported" error. Re-deriving the PEM structure from
// just the base64 body sidesteps all of that, as long as the base64
// content itself made it through intact.
function _normalizePrivateKey(raw) {
  let key = (raw || '').trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  key = key.replace(/\\n/g, '\n');
  const m = key.match(/-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/);
  if (m) {
    const body = m[1].replace(/\s+/g, '');
    const lines = body.match(/.{1,64}/g) || [];
    key = '-----BEGIN PRIVATE KEY-----\n' + lines.join('\n') + '\n-----END PRIVATE KEY-----\n';
  }
  return key;
}

function getAdminApp() {
  if (admin.apps.length) return admin.apps[0];
  const privateKey = _normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

function getDb() {
  getAdminApp();
  return admin.firestore();
}

function getMessaging() {
  getAdminApp();
  return admin.messaging();
}

// Same trust model as the app itself: the family's own admin password
// (stored on appData/familyPayments) gates access, failing closed if no
// admin password has been set yet.
async function checkAdminPass(db, supplied) {
  const snap = await db.doc('appData/familyPayments').get();
  const real = snap.exists ? snap.data().adminPass : '';
  return !!real && !!supplied && supplied === real;
}

// Collapse duplicate fcmTokens docs that share the exact same push token —
// e.g. the client's localStorage device id was reset (site data cleared,
// PWA reinstalled...) so a new doc got created, but the browser's
// underlying push subscription — and therefore the token itself — stayed
// the same, leaving both the old and new doc valid and delivering every
// push twice to the same device. Keeps whichever doc was registered most
// recently and deletes the rest, so this self-heals the next time any push
// fires — no separate cleanup job needed.
// Note: this only catches two docs with an identical token value. Two
// genuinely different push subscriptions on the same physical phone (e.g.
// an installed PWA and a regular browser tab, which each get their own
// token) look like two different devices and can't be merged from the data
// alone.
async function dedupeTokenDocs(docs) {
  const byToken = new Map();
  docs.forEach(d => {
    const data = d.data();
    if (!data.token) return;
    const existing = byToken.get(data.token);
    if (!existing || (data.ts || 0) > (existing.data().ts || 0)) byToken.set(data.token, d);
  });
  const keep = new Set([...byToken.values()].map(d => d.id));
  const stale = docs.filter(d => d.data().token && !keep.has(d.id));
  if (stale.length) {
    await Promise.all(stale.map(d => d.ref.delete().catch(() => {})));
  }
  return [...byToken.values()];
}

// A family device can choose (via the 🔔 button, see notifPrefModal in
// app.js) how much it wants pushed to it: 'all' (default — every push,
// unchanged), 'important' (skips chat/poll noise) or 'mine' (skips anything
// not about this family's own events, per relatedFamIds). Only ever applied
// to family-page ('index') devices — admin devices always get everything,
// regardless of what's stored in their own notifPref field.
function notifPrefAllows(pref, kind, relatedFamIds, famId, moneyPush) {
  const p = pref || 'all';
  // Money moving in/out of a shared fund: the families it's about always get
  // it; anyone else only if this device opted in (💰 in the 🔔 picker).
  if (kind === 'money') {
    if (Array.isArray(relatedFamIds) && famId != null && relatedFamIds.includes(famId)) return true;
    return moneyPush === true;
  }
  if (p === 'all') return true;
  if (kind === 'chat' || kind === 'poll') return false;
  if (p === 'important') return true;
  if (p === 'mine') return Array.isArray(relatedFamIds) && famId != null && relatedFamIds.includes(famId);
  return true;
}

// Rough, conservative Shabbat window in Israel local time: starts Friday
// afternoon (well before the earliest winter candle-lighting, ~16:00) and
// ends Saturday night (well after the latest summer havdalah, ~21:00).
// Not astronomically precise (no location/zmanim lookup), but deliberately
// errs on the side of staying quiet rather than risking a push or a cron
// run landing during actual Shabbat.
function isShabbatNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', weekday: 'short', hour: 'numeric', hour12: false,
  }).formatToParts(new Date());
  const weekday = parts.find(p => p.type === 'weekday').value;
  let hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  if (hour === 24) hour = 0; // some environments format midnight as "24"
  if (weekday === 'Fri' && hour >= 16) return true;
  if (weekday === 'Sat' && hour < 21) return true;
  return false;
}

// Major Yom Tov days — same "no work" reasoning as Shabbat, so reminders
// and crons should stay quiet then too. Only the Israel-observed single day
// of each holiday (Rosh Hashana is the one exception kept as two days
// everywhere); Chol Hamoed (Sukkot/Pesach's intermediate days) is
// deliberately excluded since it isn't a rest day.
const YOM_TOV_DAYS = [
  { month: 'תשרי', day: 1 },  // Rosh Hashana, day 1
  { month: 'תשרי', day: 2 },  // Rosh Hashana, day 2
  { month: 'תשרי', day: 10 }, // Yom Kippur
  { month: 'תשרי', day: 15 }, // Sukkot, day 1
  { month: 'תשרי', day: 22 }, // Shmini Atzeret / Simchat Torah
  { month: 'ניסן', day: 15 }, // Pesach, day 1
  { month: 'ניסן', day: 21 }, // Pesach, day 7 (last day)
  { month: 'סיוון', day: 6 }, // Shavuot
];
// Same rough, conservative, non-astronomical approach as isShabbatNow:
// the Hebrew calendar day itself covers the holiday, and the same
// Fri-16:00-style cutoff extends it back to cover erev (the evening
// before, once the Gregorian day hasn't rolled over yet).
function isYomTovNow() {
  const tz = 'Asia/Jerusalem';
  const hebParts = d => new Intl.DateTimeFormat('he-IL-u-ca-hebrew-nu-latn', {
    timeZone: tz, day: 'numeric', month: 'long',
  }).formatToParts(d);
  const isYomTovDate = d => {
    const parts = hebParts(d);
    const day = parseInt(parts.find(p => p.type === 'day').value, 10);
    const month = parts.find(p => p.type === 'month').value;
    return YOM_TOV_DAYS.some(h => h.day === day && h.month === month);
  };
  const now = new Date();
  if (isYomTovDate(now)) return true;
  const hour = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', hour12: false,
  }).formatToParts(now).find(p => p.type === 'hour').value, 10);
  if (hour >= 16 && isYomTovDate(new Date(now.getTime() + 24 * 60 * 60 * 1000))) return true;
  return false;
}

function escHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Shared with weekly-debt-reminder.js and daily-backup.js's birthday-email
// routing — both need to fire an EmailJS send from a server context with no
// live browser, using the same publicKey/serviceId/templateId the client
// already stores (mirrored server-side in the settings/emailjs doc).
async function sendViaEmailJS(publicKey, serviceId, templateId, toEmail, toName, subject, message, messageHtml) {
  // EmailJS's "Allow API for non-browser applications" account setting also
  // requires the account's Private Key (EmailJS dashboard → Account →
  // General → API Keys) sent as accessToken — set via the EMAILJS_PRIVATE_KEY
  // env var in Vercel, never stored in Firestore or served to the browser
  // (unlike the public key, which /api/settings/emailjs.js does expose).
  const body = {
    service_id: serviceId,
    template_id: templateId,
    user_id: publicKey,
    template_params: { to_email: toEmail, to_name: toName, subject, message, message_html: messageHtml },
  };
  if (process.env.EMAILJS_PRIVATE_KEY) body.accessToken = process.env.EMAILJS_PRIVATE_KEY;
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`EmailJS ${res.status}: ${await res.text()}`);
}
// Generic notification-email wrapper — same visual shell as the client's
// own _emailWrap, kept lightweight since this covers many different
// notification kinds (birthdays today, more later) rather than one
// specific email type like the weekly debt reminder's own template.
function notifEmailHtml(icon, title, body) {
  return `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"></head><body style="margin:0;padding:12px;background:#eef0f8;font-family:-apple-system,Helvetica,Arial,sans-serif;direction:rtl">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
    <table role="presentation" style="width:100%;max-width:480px;background:#fff;border-radius:10px;overflow:hidden" cellspacing="0" cellpadding="0">
    <tr><td style="background:linear-gradient(135deg,#0C447C,#1E88D8);padding:20px;text-align:center">
      <div style="font-size:28px">${icon}</div><div style="color:#fff;font-size:17px;font-weight:700">${escHtml(title)}</div>
    </td></tr>
    <tr><td style="padding:20px;font-size:14px;color:#333">${escHtml(body)}</td></tr>
    <tr><td style="padding:0 20px 20px;text-align:center">
      <a href="https://yankeleviz.vercel.app/" style="display:inline-block;background:#1E88D8;color:#fff;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:700">פתח באפליקציה ←</a>
    </td></tr>
    </table></td></tr></table></body></html>`;
}

module.exports = { getDb, getMessaging, checkAdminPass, dedupeTokenDocs, notifPrefAllows, isShabbatNow, isYomTovNow, escHtml, sendViaEmailJS, notifEmailHtml };
