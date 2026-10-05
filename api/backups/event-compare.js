// GET /api/backups/event-compare?key=…&q=<part of the event name>
// Shows one event as it is now and as it was in each saved daily backup, to
// see what an edit changed. key must match DIAG_KEY.
// With &fixId=<event id>&splitMethod=equal|percapita|weighted it instead sets
// that event's split method (a one-off repair: editing used to reset a
// cumulative event to "equal").
// &full=1 returns every field of the matching events.
// &fixSettled=<event id>&fromFid=&toFid=&amt= sets the amount of the last
// settled entry between those two families (a one-off repair).
const { getDb } = require('../_lib/firebaseAdmin');

const FIELDS = ['id', 'name', 'date', 'dateISO', 'open', 'cumulative', 'participants', 'excluded', 'totalCost', 'expenses',
  'expenseItems', 'splitMethod', 'childOverrides', 'parentOverrides', 'marriedIn', 'savingsTotal', 'settled',
  'potFoldedExpenses', 'potDeposits', 'pot'];
const pick = ev => Object.fromEntries(FIELDS.filter(k => ev[k] !== undefined).map(k => [k, ev[k]]));

module.exports = async (req, res) => {
  const key = process.env.DIAG_KEY;
  if (!key || req.query.key !== key) { res.status(401).send('unauthorized'); return; }
  const q = String(req.query.q || '');
  const db = getDb();
  if (req.query.fixSettled) {
    const id = parseInt(req.query.fixSettled, 10);
    const fromFid = parseInt(req.query.fromFid, 10), toFid = parseInt(req.query.toFid, 10);
    const amt = Number(req.query.amt);
    if (!(amt > 0)) { res.status(400).send('bad amt'); return; }
    const ref = db.doc('appData/familyPayments');
    const out = await db.runTransaction(async tx => {
      const events = (await tx.get(ref)).data().events || [];
      const ev = events.find(e => e.id === id);
      if (!ev) return { error: 'no event ' + id };
      const s = (ev.settled || []).filter(x => x.fromFid === fromFid && x.toFid === toFid).pop();
      if (!s) return { error: 'no settled entry' };
      const before = s.amt;
      s.amt = amt;
      tx.update(ref, { events });
      return { id, name: ev.name, fromFid, toFid, before, after: amt };
    });
    console.log('settled-fix', JSON.stringify(out));
    res.status(200).json(out);
    return;
  }
  if (req.query.fixId) {
    const id = parseInt(req.query.fixId, 10);
    const method = String(req.query.splitMethod || '');
    if (!['equal', 'percapita', 'weighted'].includes(method)) { res.status(400).send('bad splitMethod'); return; }
    const ref = db.doc('appData/familyPayments');
    const out = await db.runTransaction(async tx => {
      const events = (await tx.get(ref)).data().events || [];
      const ev = events.find(e => e.id === id);
      if (!ev) return { error: 'no event ' + id };
      const before = ev.splitMethod;
      ev.splitMethod = method;
      tx.update(ref, { events });
      return { id, name: ev.name, before, after: method };
    });
    console.log('event-fix', JSON.stringify(out));
    res.status(200).json(out);
    return;
  }
  const full = req.query.full === '1';
  const match = d => ((d && d.events) || []).filter(e => q && String(e.name || '').includes(q)).map(e => full ? e : ({ ...pick(e), _otherKeys: Object.keys(e).filter(k => !FIELDS.includes(k)) }));
  const live = (await db.doc('appData/familyPayments').get()).data();
  const backups = await db.collection('backups').get();
  const out = { live: match(live), backups: {} };
  backups.docs.map(d => d.id).sort().slice(-4).forEach(id => {
    const doc = backups.docs.find(d => d.id === id);
    out.backups[id + ' @' + (doc.data().backedUpAt || '')] = match(doc.data().data);
  });
  out.families = (live.families || []).map(f => ({ id: f.id, name: f.name, children: f.children, kids: (f.kids || []).length }));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).send(JSON.stringify(out));
};
