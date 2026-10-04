// Spoken-call notifications for families on a kosher phone (no internet, so
// no push and no email), placed through Yemot HaMashiach's RunCampaign with a
// per-number text-to-speech message.
//
// Credentials live only in Vercel environment variables, never in Firestore
// (which the browser can read):
//   YEMOT_TOKEN        Yemot API key (or "<system number>:<password>")
//   YEMOT_TEMPLATE_ID  optional campaign template id; without it Yemot uses
//                      the system's default template
//   YEMOT_CALLER_ID    optional approved outgoing caller id
const API = 'https://www.call2all.co.il/ym/api/';

function yemotConfigured() {
  return !!process.env.YEMOT_TOKEN;
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

// Each parent (slot 1/2, like email/email2) has their own kosher phone and
// categories in f.kosherPhones. A family-level kosherPhone/phonePref from the
// first version counts as parent 1's until that parent is saved again.
function familyPhones(f) {
  const out = [];
  const byslot = f.kosherPhones || {};
  [1, 2].forEach(slot => {
    const e = byslot[slot] || (slot === 1 && f.kosherPhone ? { phone: f.kosherPhone, cats: f.phonePref?.cats } : null);
    const phone = e && normalizePhone(e.phone);
    // off: the parent turned calls off in the 🔔 window (number kept).
    if (phone && !e.off) out.push({ phone, cats: e.cats || {}, scopes: e.scopes || {} });
  });
  return out;
}

// The only kinds a kosher phone can be called for (every call rings, so the
// list is kept short). Enforced here too, since older saved preferences may
// still have other kinds checked. The weekly debt reminder calls separately.
// 'deposit' (a family's own wallet) is chosen as 'wallet' and only ever calls
// the families it's about.
const PHONE_KINDS = new Set(['poll', 'event', 'goalFund', 'money', 'deposit']);
const PREF_OF_KIND = { deposit: 'wallet' };
// Calls only about the caller's own family: a new event they take part in,
// a deposit to a fund that concerns them. (No "everyone" option for phones.)
const ONLY_MINE = new Set(['event', 'money']);

// Every parent phone whose chosen categories include this notification kind.
function phoneEntriesFor(families, kind, { target, excludeFamIds, relatedFamIds, noPhone } = {}, text) {
  if (!PHONE_KINDS.has(kind) || noPhone || target === 'admin') return [];
  const onlyFor = kind === 'deposit' ? new Set(relatedFamIds || []) : null;
  const pref = PREF_OF_KIND[kind] || kind;
  const excluded = new Set(excludeFamIds || []);
  const spoken = speakable(text);
  if (!spoken) return [];
  const out = [];
  (families || []).forEach(f => {
    if (excluded.has(f.id) || (onlyFor && !onlyFor.has(f.id))) return;
    const related = (relatedFamIds || []).includes(f.id);
    familyPhones(f).forEach(p => {
      if (!p.cats[pref]) return;
      if (ONLY_MINE.has(pref) && !related) return;
      out.push({ phone: p.phone, text: spoken });
    });
  });
  return out;
}

// Israel local hour; calls between 22:00 and 08:00 wait for the morning run.
function isQuietHours() {
  const h = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false }).format(new Date()), 10) % 24;
  return h >= 22 || h < 8;
}

// One call per number; several messages for the same number are read in a
// row, and the same message twice (two parents sharing a phone) only once.
async function runYemotCalls(entries) {
  if (!yemotConfigured() || !entries.length) return { calls: 0 };
  const byPhone = {};
  entries.forEach(e => {
    const list = byPhone[e.phone] || (byPhone[e.phone] = []);
    if (!list.includes(e.text)) list.push(e.text);
  });
  const phones = {};
  Object.entries(byPhone).forEach(([phone, texts]) => { phones[phone] = { text: 'הודעה ממערכת המשפחה. ' + texts.join('. ') }; });
  const params = new URLSearchParams({
    token: process.env.YEMOT_TOKEN,
    ttsMode: '1',
    phones: JSON.stringify(phones),
  });
  if (process.env.YEMOT_TEMPLATE_ID) params.set('templateId', process.env.YEMOT_TEMPLATE_ID);
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

module.exports = { yemotConfigured, speakable, normalizePhone, familyPhones, phoneEntriesFor, isQuietHours, runYemotCalls, callOrQueue, flushPhoneQueue };
