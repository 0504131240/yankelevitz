// POST /api/phone-test — places one spoken test call through Yemot right away
// (ignoring quiet hours), so the admin can check the kosher-phone setup.
// Gated by the admin password like /api/notify.
const { getDb, checkAdminPass, isShabbatNow, isYomTovNow } = require('./_lib/firebaseAdmin');
const { yemotConfigured, normalizePhone, runYemotCalls } = require('./_lib/yemot');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const { adminPass, phone, mode } = req.body || {};
  const db = getDb();
  if (!(await checkAdminPass(db, adminPass))) { res.status(401).json({ error: 'unauthorized' }); return; }
  if (!yemotConfigured()) { res.status(200).json({ ok: false, error: 'not-configured' }); return; }
  if (isShabbatNow() || isYomTovNow()) { res.status(200).json({ ok: false, error: 'shabbat' }); return; }
  const num = normalizePhone(phone);
  if (!num) { res.status(200).json({ ok: false, error: 'bad-phone' }); return; }
  try {
    // mode 'tzintuk': a test missed call; the text waits for the call back.
    const r = await runYemotCalls([{ phone: num, mode: mode === 'tzintuk' ? 'tzintuk' : 'call', text: mode === 'tzintuk'
      ? 'זה צינתוק בדיקה. אם שמעתם את ההודעה הזו, הצינתוקים עובדים.'
      : 'זו שיחת בדיקה. אם שמעתם את ההודעה, השיחות לטלפון הכשר עובדות.' }], db);
    res.status(200).json({ ok: true, ...r });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e.message || e) });
  }
};
