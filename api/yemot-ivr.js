// /api/yemot-ivr?key=… — an "API" extension in the Yemot HaMashiach system,
// so a parent on a kosher phone can answer the site's open polls by keypad.
//
// Yemot calls this on every step of the call with the caller's number
// (ApiPhone) plus every value keyed in so far in this call, and plays back
// whatever commands we answer with. So this is stateless: each request first
// saves any answers it carries, then asks the next unanswered question.
//
// The caller is identified by the kosher-phone numbers saved on the families
// (each parent's in the person modal). key must match the YEMOT_IVR_KEY
// environment variable, so nobody else can vote through this address.
const { getDb } = require('./_lib/firebaseAdmin');
const { normalizePhone } = require('./_lib/yemot');

// Yemot reserves . - " ' & | in spoken text, and = , separate read options.
const clean = t => String(t || '').replace(/[.\-"'&|=,\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
const say = (...parts) => parts.map(clean).filter(Boolean).map(p => 't-' + p).join('.');

// Every phone saved on a family, including ones with calls turned off —
// turning calls off shouldn't stop that parent from calling in to vote.
function findFamily(families, phone) {
  for (const f of families || []) {
    const nums = [];
    Object.values(f.kosherPhones || {}).forEach(e => e && nums.push(e.phone));
    if (f.kosherPhone) nums.push(f.kosherPhone);
    if (nums.some(n => normalizePhone(n) === phone)) return f;
  }
  return null;
}

// Same rule as the site's _pollVisibleQuestions: a follow-up question shows
// only after the matching answer to its condition question.
const visibleQs = (p, votes) => p.questions.filter(q => !q.showIf || votes[q.showIf.qId] === q.showIf.optIdx);
const openPollsFor = (polls, famId) => (polls || []).filter(p => !p.closed && Array.isArray(p.questions) && !(p.hiddenFrom || []).includes(famId));
const valName = (p, q) => 'q_' + p.id + '_' + q.id;

// The next question this family hasn't answered, newest poll first.
function nextQuestion(polls, famId) {
  for (const p of openPollsFor(polls, famId)) {
    const votes = (p.votes && p.votes[String(famId)]) || {};
    const q = visibleQs(p, votes).find(q => votes[q.id] == null && (q.options || []).length);
    if (q) return { p, q, firstInPoll: !Object.keys(votes).length };
  }
  return null;
}

// Saves the answers carried by this request that aren't saved yet. Runs in a
// transaction so a vote from the site at the same moment isn't lost.
async function saveAnswers(db, famId, values) {
  const ref = db.doc('appData/familyPayments');
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const polls = snap.data()?.polls || [];
    let saved = 0;
    for (const p of openPollsFor(polls, famId)) {
      if (!p.votes) p.votes = {};
      const votes = p.votes[String(famId)] || {};
      // In order, so a follow-up answered in this call counts once its
      // condition answer (also in this call) is in.
      for (const q of p.questions) {
        const raw = values[valName(p, q)];
        if (raw == null || votes[q.id] != null) continue;
        if (!visibleQs(p, votes).includes(q)) continue;
        const idx = parseInt(Array.isArray(raw) ? raw[raw.length - 1] : raw, 10) - 1;
        if (!(idx >= 0 && idx < (q.options || []).length)) continue;
        votes[q.id] = idx;
        saved++;
      }
      if (Object.keys(votes).length) p.votes[String(famId)] = votes;
    }
    if (saved) tx.update(ref, { polls });
    return { saved, polls };
  });
}

module.exports = async (req, res) => {
  const values = { ...(req.query || {}), ...(req.method === 'POST' && req.body && typeof req.body === 'object' ? req.body : {}) };
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  const send = txt => res.status(200).send(txt);
  const bye = (...parts) => send('id_list_message=' + say(...parts) + '&go_to_folder=hangup');

  const key = process.env.YEMOT_IVR_KEY;
  if (!key || values.key !== key) { res.status(401).send('unauthorized'); return; }

  const db = getDb();
  const phone = normalizePhone(values.ApiPhone);
  const families = phone ? (await db.doc('appData/familyPayments').get()).data()?.families : null;
  const fam = phone && findFamily(families, phone);
  if (!fam) { bye('המספר שממנו התקשרתם לא רשום באתר המשפחה', 'אפשר להוסיף אותו בעריכת המשפחה באתר'); return; }

  let polls, saved = 0;
  try {
    ({ saved, polls } = await saveAnswers(db, fam.id, values));
  } catch (e) {
    console.error('yemot-ivr: saving answers failed', e);
    bye('אירעה שגיאה בשמירת התשובה', 'נסו שוב מאוחר יותר');
    return;
  }
  if (saved) console.log(`yemot-ivr: family ${fam.id} saved ${saved} answer(s)`);
  if (values.hangup === 'yes') { send('ok'); return; }

  const next = nextQuestion(polls, fam.id);
  if (!next) {
    bye(saved ? 'תודה רבה התשובות נשמרו' : 'אין כרגע סקרים פתוחים שלא עניתם עליהם', 'להתראות');
    return;
  }
  const { p, q, firstInPoll } = next;
  const intro = firstInPoll ? ['סקר חדש מאתר המשפחה'] : [];
  // "לכן הקישו 1"; a numeric answer reads better without the ל ("3 הקישו 3").
  const choices = q.options.map((o, i) => (/^\d/.test(clean(o)) ? '' : 'ל') + clean(o) + ' הקישו ' + (i + 1));
  const allowed = q.options.map((_, i) => i + 1).join('.');
  // read=<prompt>=<name>,<re-enter if exists>,<max>,<min>,<seconds>,<playback>,<block *>,<block 0>,<replace>,<allowed>,<attempts>,<allow empty>,<empty value>,<keyboard>
  send('read=' + say(...intro, q.text, ...choices) + '=' + [valName(p, q), 'no', String(q.options.length).length, 1, 10, 'No', 'yes', 'yes', '', allowed, '', '', '', ''].join(','));
};
