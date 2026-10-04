// /api/yemot-ivr — an "API" extension in the Yemot HaMashiach system: the
// family's phone line. A parent calling from a kosher phone saved on their
// family hears a menu: answer the site's open polls by keypad, or hear
// information from the site (wallet and debts, open events, upcoming
// birthdays/anniversaries/yahrzeits, recent updates).
//
// Yemot calls this on every step of the call with the caller's number
// (ApiPhone) plus every value keyed in so far in this call, and plays back
// whatever commands we answer with. So this is stateless: every read gets a
// fresh name "s<step>_<what>", and the highest step present is the key just
// pressed. Poll answers ("s<step>_q<poll>x<question>") are saved on every
// request, so nothing is lost if the caller hangs up halfway.
//
// The extension passes key=YEMOT_IVR_KEY (api_add_0), so nobody else can
// vote or read family data through this address.
const { getDb } = require('./_lib/firebaseAdmin');
const { normalizePhone, speakable } = require('./_lib/yemot');
const { evAdjBalance } = require('./_lib/debtCalc');
const { allOccasions } = require('./_lib/birthdayCalc');

// Yemot reserves . - " ' & | in spoken text, and = , separate read options.
const clean = t => String(t || '')
  .replace(/(\d)\.(\d)/g, '$1 נקודה $2')
  .replace(/[.\-"'&|=,()\n\r]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const say = parts => parts.map(clean).filter(Boolean).map(p => 't-' + p).join('.');
const shekels = n => {
  const v = Math.round(Math.abs(n) * 100) / 100;
  const whole = Math.floor(v), ag = Math.round((v - whole) * 100);
  return whole + ' שקלים' + (ag ? ' ו ' + ag + ' אגורות' : '');
};

// Every phone saved on a family, including ones with calls turned off —
// turning outgoing calls off shouldn't stop that parent from calling in.
// Returns the family and which parent (slot 1/2) the number belongs to.
function findCaller(families, phone) {
  for (const f of families || []) {
    for (const slot of [1, 2]) {
      const e = (f.kosherPhones || {})[slot] || (slot === 1 && f.kosherPhone ? { phone: f.kosherPhone } : null);
      if (e && normalizePhone(e.phone) === phone) return { fam: f, slot };
    }
  }
  return null;
}
// Regular Yemot extensions set up in the Yemot dashboard, reached from the
// menu: family recordings to hear and leave (YEMOT_RECORDINGS_FOLDER) and the
// conference room (YEMOT_VOICE_FOLDER), e.g. "/5". No menu option without one.
const folderEnv = v => (/^\/[\d/]+$/.test(process.env[v] || '') ? process.env[v] : '');
// Option 4 records a new message straight into RECORDINGS (Yemot numbers
// the file after the highest one there), so it plays under option 3.
const RECORDINGS = folderEnv('YEMOT_RECORDINGS_FOLDER');
const VOICE = folderEnv('YEMOT_VOICE_FOLDER');
const famShort = f => clean(String(f.name || '').replace(/^משפחת\s*/, ''));

// ── Polls ────────────────────────────────────────────────────────────────
// Same rule as the site's _pollVisibleQuestions: a follow-up question shows
// only after the matching answer to its condition question.
const visibleQs = (p, votes) => p.questions.filter(q => !q.showIf || votes[q.showIf.qId] === q.showIf.optIdx);
const openPollsFor = (polls, famId) => (polls || []).filter(p => !p.closed && Array.isArray(p.questions) && !(p.hiddenFrom || []).includes(famId));
// Each parent answers for themselves (same as the site): votes are keyed
// "famId:slot"; an older family-wide vote (keyed by famId) still counts.
const myVotes = (p, who) => (p.votes && (p.votes[who.key] || p.votes[String(who.famId)])) || {};
const pendingQs = (p, who) => {
  const votes = myVotes(p, who);
  return visibleQs(p, votes).filter(q => votes[q.id] == null && (q.options || []).length);
};

// The next question this parent hasn't answered, newest poll first.
function nextQuestion(polls, who) {
  for (const p of openPollsFor(polls, who.famId)) {
    const q = pendingQs(p, who)[0];
    if (q) return { p, q, firstInPoll: !Object.keys(myVotes(p, who)).length };
  }
  return null;
}
const unansweredPolls = (polls, who) => openPollsFor(polls, who.famId).filter(p => pendingQs(p, who).length).length;

// Saves the poll answers carried by this request that aren't saved yet, in a
// transaction so a vote from the site at the same moment isn't lost.
async function saveAnswers(db, who, steps) {
  const answers = {};
  steps.forEach(s => {
    const m = /^q(\d+)x(\d+)$/.exec(s.what);
    if (m) answers[m[1] + ':' + m[2]] = s.digit;
  });
  const ref = db.doc('appData/familyPayments');
  if (!Object.keys(answers).length) return { saved: 0, data: (await ref.get()).data() || {} };
  return db.runTransaction(async tx => {
    const data = (await tx.get(ref)).data() || {};
    const polls = data.polls || [];
    let saved = 0;
    for (const p of openPollsFor(polls, who.famId)) {
      if (!p.votes) p.votes = {};
      const votes = { ...myVotes(p, who) };
      // In order, so a follow-up answered in this call counts once its
      // condition answer (also in this call) is in.
      for (const q of p.questions) {
        const raw = answers[p.id + ':' + q.id];
        if (raw == null || votes[q.id] != null) continue;
        if (!visibleQs(p, votes).includes(q)) continue;
        const idx = parseInt(raw, 10) - 1;
        if (!(idx >= 0 && idx < (q.options || []).length)) continue;
        votes[q.id] = idx;
        saved++;
      }
      if (Object.keys(votes).length && JSON.stringify(votes) !== JSON.stringify(myVotes(p, who))) {
        p.votes[who.key] = votes;
        // An old family-wide vote becomes this parent's own once they go on.
        delete p.votes[String(who.famId)];
      }
    }
    if (saved) tx.update(ref, { polls });
    return { saved, data };
  });
}

// ── Information from the site ────────────────────────────────────────────
const myOpenEvents = (data, fam) => (data.events || []).filter(e => e.open && (e.participants || []).includes(fam.id));
function walletInfo(data, fam) {
  const bal = ((data.fund || {}).famBalances || {})[String(fam.id)] || 0;
  const out = [Math.abs(bal) < 0.005 ? 'הארנק של המשפחה ריק'
    : bal > 0 ? 'בארנק של המשפחה יש ' + shekels(bal)
    : 'הארנק של המשפחה במינוס של ' + shekels(bal)];
  let net = 0;
  const debts = [];
  myOpenEvents(data, fam).forEach(ev => {
    const b = evAdjBalance(ev, data.families || [])[fam.id] || 0;
    net += b;
    if (-b > 0.5) debts.push('באירוע ' + ev.name + ' ' + shekels(b));
  });
  if (net < -0.5) out.push('יש לכם חוב פתוח של ' + shekels(net), ...debts);
  else out.push('אין לכם חוב פתוח');
  return out;
}
function eventsInfo(data, fam) {
  const evs = myOpenEvents(data, fam);
  if (!evs.length) return ['אין כרגע אירועים פתוחים שאתם משתתפים בהם'];
  const out = [evs.length === 1 ? 'יש אירוע פתוח אחד' : 'יש ' + evs.length + ' אירועים פתוחים'];
  evs.slice(0, 6).forEach(ev => {
    const b = evAdjBalance(ev, data.families || [])[fam.id] || 0;
    out.push('אירוע ' + ev.name + (ev.date ? ' בתאריך ' + ev.date : ''),
      b < -0.5 ? 'נשאר לכם לשלם ' + shekels(b) : b > 0.5 ? 'יש לכם זיכוי של ' + shekels(b) : 'החלק שלכם משולם');
  });
  return out;
}
function occasionsInfo(data) {
  const all = allOccasions(data.families || [], data.yahrzeits || []);
  const dayFmt = new Intl.DateTimeFormat('he-IL-u-ca-hebrew-nu-latn', { day: 'numeric', timeZone: 'Asia/Jerusalem' });
  const monthFmt = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { month: 'long', timeZone: 'Asia/Jerusalem' });
  // Adar in a leap year is "אדר א׳"/"אדר ב׳"; treat every Adar as the same.
  const monthEq = (a, b) => a === b || (!!a && !!b && a.startsWith('אדר') && b.startsWith('אדר'));
  const out = [];
  for (let i = 0; i <= 14; i++) {
    const d = new Date(Date.now() + i * 86400000);
    const hd = parseInt(dayFmt.format(d), 10), hm = monthFmt.format(d);
    const when = i === 0 ? 'היום' : i === 1 ? 'מחר' : 'בעוד ' + i + ' ימים';
    all.filter(b => b.hebDay === hd && monthEq(b.hebMonth, hm)).forEach(b => {
      const what = b.kind === 'yahrzeit' ? 'יארצייט של ' : b.kind === 'anniversary' ? 'יום נישואין של משפחת ' : 'יום הולדת של ';
      out.push(when + ' ' + what + b.name);
    });
  }
  return out.length ? ['בשבועיים הקרובים', ...out.slice(0, 8)] : ['אין ימי הולדת ושמחות בשבועיים הקרובים'];
}
function updatesInfo(data, fam) {
  const list = (data.notifications || [])
    .filter(n => n.audience !== 'admin' && !(n.hiddenFrom || []).includes(fam.id))
    .slice(0, 5)
    .map(n => speakable(n.text));
  return list.length ? ['העדכונים האחרונים באתר', ...list] : ['אין עדכונים חדשים'];
}
const INFO = { 1: walletInfo, 2: eventsInfo, 3: occasionsInfo, 4: updatesInfo };

// ── Call flow ────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  const values = { ...(req.query || {}), ...(req.method === 'POST' && req.body && typeof req.body === 'object' ? req.body : {}) };
  const last = v => (Array.isArray(v) ? v[v.length - 1] : v);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  const send = txt => res.status(200).send(txt);
  const bye = parts => send('id_list_message=' + say(parts) + '&go_to_folder=hangup');

  // Set as api_add_0=key=… in the extension; a key written inside api_link
  // arrives with Yemot's own "?…" glued on, so that part is dropped.
  const key = process.env.YEMOT_IVR_KEY;
  const given = String((Array.isArray(values.key) ? values.key[0] : values.key) || '').split('?')[0];
  if (!key || given !== key) {
    console.log('yemot-ivr: rejected key; params: ' + Object.keys(values).join(','));
    res.status(401).send('unauthorized'); return;
  }

  const db = getDb();
  const phone = normalizePhone(last(values.ApiPhone));
  const families = phone ? ((await db.doc('appData/familyPayments').get()).data() || {}).families : null;
  const caller = phone && findCaller(families, phone);
  const fam = caller && caller.fam;
  if (!fam) { bye(['המספר שממנו התקשרתם לא רשום באתר המשפחה', 'אפשר להוסיף אותו בעריכת המשפחה באתר']); return; }

  // Every key pressed so far in this call, in order.
  const steps = Object.keys(values).map(k => /^s(\d+)_(\w+)$/.exec(k)).filter(Boolean)
    .map(m => ({ n: parseInt(m[1], 10), what: m[2], digit: String(last(values[m[0]])) }))
    .sort((a, b) => a.n - b.n);
  const step = steps.length ? steps[steps.length - 1] : null;
  const nextN = (step ? step.n : 0) + 1;

  const who = { famId: fam.id, key: fam.id + ':' + caller.slot };
  const firstName = clean((caller.slot === 2 ? fam.emailName2 : fam.emailName) || '');
  let saved = 0, data;
  try {
    ({ saved, data } = await saveAnswers(db, who, steps));
  } catch (e) {
    console.error('yemot-ivr: saving answers failed', e);
    bye(['אירעה שגיאה בשמירת התשובה', 'נסו שוב מאוחר יותר']); return;
  }
  if (saved) console.log(`yemot-ivr: ${who.key} saved ${saved} answer(s)`);
  if (last(values.hangup) === 'yes') { send('ok'); return; }

  // read=<prompt>=<name>,<re-enter if exists>,<max>,<min>,<seconds>,<playback>,<block *>,<block 0>,<replace>,<allowed>,<attempts>,<allow empty>,<empty value>,<keyboard>
  const read = (parts, what, allowed) => send('read=' + say(parts) + '=' + [
    's' + nextN + '_' + what, 'no', String(Math.max(...allowed)).length, 1, 10, 'No', 'yes', allowed.includes(0) ? 'no' : 'yes', '', allowed.join('.'), '', '', '', '',
  ].join(','));

  const mainMenu = (pre = []) => {
    const n = unansweredPolls(data.polls, who);
    read([...pre,
      n ? (n === 1 ? 'יש סקר אחד שעוד לא ענית עליו' : 'יש ' + n + ' סקרים שעוד לא ענית עליהם') : '',
      'למידע מהאתר הקישו 1', 'לסקרים הקישו 2',
      RECORDINGS ? 'לשמיעת ההודעות המוקלטות של המשפחה הקישו 3' : '',
      RECORDINGS ? 'להשארת הודעה מוקלטת הקישו 4' : '',
      VOICE ? 'לחדר הוועידה המשפחתי הקישו 5' : ''],
    'main', [1, 2, ...(RECORDINGS ? [3] : []), ...(RECORDINGS ? [4] : []), ...(VOICE ? [5] : [])]);
  };
  const infoMenu = (pre = []) => read([...pre,
    'למצב הארנק והחובות הקישו 1', 'לאירועים הפתוחים הקישו 2', 'לימי הולדת ושמחות קרובים הקישו 3',
    'לעדכונים האחרונים באתר הקישו 4', 'לחזרה לתפריט הראשי הקישו 0'], 'info', [1, 2, 3, 4, 0]);
  const askNext = (pre = []) => {
    const next = nextQuestion(data.polls, who);
    if (!next) {
      // Why each poll was skipped, for checking a "no polls" report.
      console.log(`yemot-ivr: ${who.key} no question; polls: ` + (data.polls || []).map(p => {
        const v = myVotes(p, who);
        return `#${p.id}${p.closed ? ' closed' : ''}${(p.hiddenFrom || []).includes(fam.id) ? ' hidden' : ''} answered=${JSON.stringify(v)}`;
      }).join(' | '));
      mainMenu([...pre, 'אין עוד סקרים פתוחים שלא נענו']);
      return;
    }
    const { p, q, firstInPoll } = next;
    // "לכן הקישו 1"; a numeric answer reads better without the ל.
    const choices = q.options.map((o, i) => (/^\d/.test(clean(o)) ? '' : 'ל') + clean(o) + ' הקישו ' + (i + 1));
    read([...pre, firstInPoll ? 'סקר חדש' : '', q.text, ...choices], 'q' + p.id + 'x' + q.id, q.options.map((_, i) => i + 1));
  };

  if (!step) {
    // Updates that arrived as a tzintuk (api/_lib/yemot.js runTzintuk) are
    // read out first, once.
    let inbox = [];
    try {
      const ref = db.collection('phoneInbox').doc(phone);
      const snap = await ref.get();
      inbox = snap.exists ? (snap.data().items || []).map(i => i.text) : [];
      if (inbox.length) await ref.delete();
    } catch (e) { console.error('yemot-ivr: phoneInbox failed', e); }
    mainMenu([firstName ? 'שלום ' + firstName : 'שלום משפחת ' + famShort(fam),
      ...(inbox.length ? [inbox.length === 1 ? 'יש לכם עדכון חדש' : 'יש לכם ' + inbox.length + ' עדכונים חדשים', ...inbox] : [])]);
    return;
  }
  if (step.what === 'main') {
    if (step.digit === '1') infoMenu();
    else if (step.digit === '2') askNext();
    // Yemot's own extensions; the caller carries on there, not in this menu.
    else if (step.digit === '3' && RECORDINGS) send('go_to_folder=' + RECORDINGS);
    // read=<prompt>=<name>,<re-enter>,record,<folder>,<file name: auto>,<no confirm menu: no>,<save on hangup>,<append>,<min sec>,<max sec>
    else if (step.digit === '4' && RECORDINGS) send('read=' + say(['הקליטו את ההודעה אחרי הצליל', 'בסיום הקישו סולמית']) + '=' +
      ['s' + nextN + '_rec', 'no', 'record', RECORDINGS, '', '', 'yes', '', 2, 300].join(','));
    else if (step.digit === '5' && VOICE) send('go_to_folder=' + VOICE);
    else mainMenu();
    return;
  }
  if (step.what === 'rec') { mainMenu(['תודה ההודעה נשמרה']); return; }
  if (step.what === 'info') {
    const fn = INFO[step.digit];
    if (fn) infoMenu(fn(data, fam));
    else mainMenu();
    return;
  }
  // The last key answered a poll question: on to the next one.
  askNext(saved ? ['התשובה נשמרה'] : []);
};
