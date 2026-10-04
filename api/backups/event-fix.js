// GET /api/backups/event-fix?key=…&id=<event id>&splitMethod=equal|percapita|weighted
// One-off repair of an event's split method (an edit used to reset a
// cumulative event to "equal"). key must match DIAG_KEY.
const { getDb } = require('../_lib/firebaseAdmin');

module.exports = async (req, res) => {
  const key = process.env.DIAG_KEY;
  if (!key || req.query.key !== key) { res.status(401).send('unauthorized'); return; }
  const id = parseInt(req.query.id, 10);
  const method = String(req.query.splitMethod || '');
  if (!['equal', 'percapita', 'weighted'].includes(method)) { res.status(400).send('bad splitMethod'); return; }
  const db = getDb();
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
};
