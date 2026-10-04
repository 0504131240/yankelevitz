// /api/email-img — images attached to a broadcast email.
//   POST {adminPass, dataUrl} → {url}: the admin's broadcast tool uploads an
//     image here (Firestore rules don't let the browser write emailImages
//     itself), stored in emailImages/{id}.
//   GET ?id=… → the image. Emails can't reliably embed images (Gmail strips
//     data: URIs), so the email links here instead. Public on purpose —
//     email clients fetch it with no login — and the ids are long random
//     strings.
const crypto = require('crypto');
const { getDb, checkAdminPass } = require('./_lib/firebaseAdmin');

const TYPE_RE = /^image\/(jpeg|png|webp|gif)$/;

module.exports = async (req, res) => {
  const db = getDb();
  if (req.method === 'POST') {
    const { adminPass, dataUrl } = req.body || {};
    if (!(await checkAdminPass(db, adminPass))) { res.status(401).json({ error: 'unauthorized' }); return; }
    const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m || !TYPE_RE.test(m[1])) { res.status(400).json({ error: 'bad image' }); return; }
    if (m[2].length > 900000) { res.status(413).json({ error: 'image too large' }); return; }
    const id = crypto.randomBytes(12).toString('hex');
    await db.doc('emailImages/' + id).set({ type: m[1], data: m[2], ts: Date.now() });
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    res.status(200).json({ id, url: 'https://' + host + '/api/email-img?id=' + id });
    return;
  }
  const id = String((req.query && req.query.id) || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) { res.status(400).send('bad id'); return; }
  const snap = await db.doc('emailImages/' + id).get();
  if (!snap.exists) { res.status(404).send('not found'); return; }
  const { type, data } = snap.data();
  if (!TYPE_RE.test(type || '') || !data) { res.status(404).send('not found'); return; }
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.status(200).send(Buffer.from(data, 'base64'));
};
