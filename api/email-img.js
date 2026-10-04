// GET /api/email-img?id=… — serves an image attached to a broadcast email
// (uploaded by the admin's broadcast tool into Firestore emailImages/{id}).
// Emails can't reliably embed images (Gmail strips data: URIs), so the email
// links here instead. Public on purpose — email clients fetch it with no
// login — and the ids are long random strings.
const { getDb } = require('./_lib/firebaseAdmin');

module.exports = async (req, res) => {
  const id = String((req.query && req.query.id) || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) { res.status(400).send('bad id'); return; }
  const snap = await getDb().doc('emailImages/' + id).get();
  if (!snap.exists) { res.status(404).send('not found'); return; }
  const { type, data } = snap.data();
  if (!/^image\/(jpeg|png|webp|gif)$/.test(type || '') || !data) { res.status(404).send('not found'); return; }
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.status(200).send(Buffer.from(data, 'base64'));
};
