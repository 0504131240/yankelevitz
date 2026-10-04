// GET /api/backups/event-compare?key=…&q=<part of the event name>
// Read-only: shows one event as it is now and as it was in each saved
// daily backup, to see what an edit changed. key must match DIAG_KEY.
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
  const match = d => ((d && d.events) || []).filter(e => q && String(e.name || '').includes(q)).map(e => ({ ...pick(e), _otherKeys: Object.keys(e).filter(k => !FIELDS.includes(k)) }));
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
