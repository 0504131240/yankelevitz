// Spoken-call notifications for families on a kosher phone (no internet, so
// no push and no email), placed through Yemot HaMashiach's RunCampaign with a
// per-number text-to-speech message.
//
// Credentials live only in Vercel environment variables, never in Firestore
// (which the browser can read):
//   YEMOT_TOKEN        "<system number>:<password>"
//   YEMOT_TEMPLATE_ID  id of a campaign template in that Yemot system
//   YEMOT_CALLER_ID    optional approved outgoing caller id
const API = 'https://www.call2all.co.il/ym/api/';

function yemotConfigured() {
  return !!(process.env.YEMOT_TOKEN && process.env.YEMOT_TEMPLATE_ID);
}

const FINAL = { 'כ': 'ך', 'מ': 'ם', 'נ': 'ן', 'פ': 'ף', 'צ': 'ץ' };
// Notification text is written for the screen; make it read naturally aloud.
function speakable(text) {
  return String(text || '')
    .replace(/₪\s?([\d,]+(?:\.\d+)?)/g, (_, n) => n.replace(/,/g, '') + ' שקלים')
    // "הוסיפ/ה" → "הוסיף": drop the feminine suffix, fix the final letter.
    .replace(/([א-ת])\/(ה|ית)(?=[^א-ת]|$)/g, (_, c) => FINAL[c] || c)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/["“”״]/g, '')
    .replace(/\s*[·•|]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('972')) d = '0' + d.slice(3);
  return /^0\d{8,9}$/.test(d) ? d : null;
}

// Families whose kosher-phone preferences include this notification kind.
function phoneEntriesFor(families, kind, { target, excludeFamIds } = {}, text) {
  if (!kind || target === 'admin') return [];
  const excluded = new Set(excludeFamIds || []);
  const spoken = speakable(text);
  if (!spoken) return [];
  return (families || [])
    .filter(f => !excluded.has(f.id) && f.phonePref?.cats?.[kind])
    .map(f => ({ phone: normalizePhone(f.kosherPhone), text: spoken }))
    .filter(e => e.phone);
}

// Israel local hour; calls between 22:00 and 08:00 wait for the morning run.
function isQuietHours() {
  const h = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false }).format(new Date()), 10) % 24;
  return h >= 22 || h < 8;
}

// One call per number; several messages for the same number are read in a row.
async function runYemotCalls(entries) {
  if (!yemotConfigured() || !entries.length) return { calls: 0 };
  const phones = {};
  entries.forEach(e => {
    const prev = phones[e.phone];
    phones[e.phone] = { text: prev ? prev.text + '. ' + e.text : 'הודעה ממערכת המשפחה. ' + e.text };
  });
  const params = new URLSearchParams({
    token: process.env.YEMOT_TOKEN,
    templateId: process.env.YEMOT_TEMPLATE_ID,
    ttsMode: '1',
    phones: JSON.stringify(phones),
  });
  if (process.env.YEMOT_CALLER_ID) params.set('callerId', process.env.YEMOT_CALLER_ID);
  const resp = await fetch(API + 'RunCampaign?' + params.toString());
  const data = await resp.json().catch(() => ({}));
  if (data.responseStatus !== 'OK') throw new Error('Yemot RunCampaign failed: ' + (data.message || resp.status));
  return { calls: Object.keys(phones).length, campaignId: data.campaignId };
}

// Call now, or park the messages until the morning run during quiet hours.
async function callOrQueue(db, entries) {
  if (!yemotConfigured() || !entries.length) return { calls: 0 };
  if (isQuietHours()) {
    const batch = db.batch();
    entries.forEach(e => batch.set(db.collection('phoneQueue').doc(), { ...e, ts: Date.now() }));
    await batch.commit();
    return { queued: entries.length };
  }
  return runYemotCalls(entries);
}

// Morning run: everything queued overnight, plus the given entries, in one
// call per number. Anything older than three days is dropped as stale.
async function flushPhoneQueue(db, extraEntries = []) {
  if (!yemotConfigured()) return { calls: 0 };
  const snap = await db.collection('phoneQueue').get();
  const fresh = snap.docs.map(d => d.data()).filter(e => Date.now() - (e.ts || 0) < 3 * 86400000);
  const entries = fresh.map(e => ({ phone: e.phone, text: e.text })).concat(extraEntries);
  const result = entries.length ? await runYemotCalls(entries) : { calls: 0 };
  await Promise.all(snap.docs.map(d => d.ref.delete()));
  return result;
}

module.exports = { yemotConfigured, speakable, normalizePhone, phoneEntriesFor, isQuietHours, runYemotCalls, callOrQueue, flushPhoneQueue };
