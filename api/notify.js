// POST /api/notify — sends a real push notification (via FCM) to every
// registered device. Called directly by the client (app.js addNotif) right
// after it writes a change to Firestore, replacing the old Firebase Cloud
// Function that triggered on every appData/familyPayments update.
//
// Gated by the app's own admin password (same trust boundary as the rest of
// the app's shared-family data) so random internet traffic can't spam pushes
// to the family.
const { getDb, getMessaging, checkAdminPass, dedupeTokenDocs, notifPrefAllows, isShabbatNow, isYomTovNow } = require('./_lib/firebaseAdmin');
const { yemotConfigured, phoneEntriesFor, callOrQueue } = require('./_lib/yemot');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const { adminPass, title, body, target, excludeFamIds, kind, relatedFamIds, excludeSlots } = req.body || {};
  if (!title || !body) { res.status(400).json({ error: 'title and body required' }); return; }

  // No pushes during Shabbat or Yom Tov, regardless of who triggered this or why.
  if (isShabbatNow() || isYomTovNow()) { res.status(200).json({ sent: 0, registered: 0, skipped: 'shabbat' }); return; }

  const db = getDb();
  if (!(await checkAdminPass(db, adminPass))) { res.status(401).json({ error: 'unauthorized' }); return; }

  // Kosher-phone families who chose this kind get a spoken call (or, at
  // night, one in the morning). Independent of push, so it runs first.
  let phone = {};
  if (yemotConfigured() && kind) {
    try {
      const snap = await db.doc('appData/familyPayments').get();
      phone = await callOrQueue(db, phoneEntriesFor(snap.data()?.families, kind, { target, excludeFamIds }, body));
      console.log(`notify: kind=${kind} phone ${JSON.stringify(phone)}`);
    } catch (e) {
      console.error('notify: phone calls failed', e);
    }
  }

  const tokSnap = await db.collection('fcmTokens').get();
  console.log(`notify: ${tokSnap.size} registered token(s) found`);
  if (tokSnap.empty) { res.status(200).json({ sent: 0, registered: 0, phone }); return; }
  const tokenDocs = await dedupeTokenDocs(tokSnap.docs);

  // Devices registered from admin.html should land back on admin.html when
  // the notification is tapped, not on the public family page (and vice
  // versa) — registerFCMToken() records which page each token came from.
  const LINKS = {
    admin: 'https://yankeleviz.vercel.app/admin.html',
    index: 'https://yankeleviz.vercel.app/',
  };
  // target:'admin' restricts delivery to admin devices only — used for
  // events that matter to the admin (money movement, family self-edits) but
  // would just be noise on every other family member's phone. Anything else
  // (the default) reaches everyone. "Admin device" means either page==='admin'
  // (the dedicated admin.html install) OR isAdmin===true (a device that
  // unlocked edit mode from the regular family page — that lock icon works
  // there too, and app.js flags the device the moment it's used, see
  // _refreshAdminPushFlag) — a treasurer who never installs admin.html
  // separately is exactly as much an admin as one who does. excludeFamIds
  // additionally drops specific families' own devices regardless of target
  // — e.g. a surprise-gift goal fund announced to everyone except the
  // family it's for (admin-registered devices have no famId, so they're
  // never affected by this). excludeSlots is the finer-grained sibling of
  // that — "famId:slot" strings for the specific registered emails that
  // opted into email-instead-of-push (see app.js's notifEmailSection),
  // dropping only that one parent's devices rather than the whole family's.
  const excludeSlotSet = new Set(Array.isArray(excludeSlots) ? excludeSlots : []);
  const groups = { admin: [], index: [] };
  tokenDocs.forEach(d => {
    const data = d.data();
    // `page` (which link a tap opens, and whether this device's own
    // notifPref applies) stays tied to the literal page it registered
    // from — only the target:'admin' eligibility check below also honors
    // isAdmin, so an admin who unlocks from the family page still taps
    // through to their usual link and keeps their own notifPref for
    // everything else, same as before.
    const page = data.page === 'admin' ? 'admin' : 'index';
    const isAdminDevice = page === 'admin' || data.isAdmin === true;
    if (target === 'admin' && !isAdminDevice) return;
    if (Array.isArray(excludeFamIds) && excludeFamIds.includes(data.famId)) return;
    if (data.famId != null && data.slot != null && excludeSlotSet.has(data.famId + ':' + data.slot)) return;
    // A family device's own notifPref only ever filters family-page pushes —
    // the admin device always gets everything.
    if (page === 'index' && !notifPrefAllows(data.notifPref, kind, relatedFamIds, data.famId, data.moneyPush)) return;
    groups[page].push(d);
  });

  let sent = 0, registered = 0, deleted = 0;
  for (const [page, docs] of Object.entries(groups)) {
    if (!docs.length) continue;
    registered += docs.length;
    // Deliberately a data-only message (no top-level `notification` field):
    // when FCM messages carry a notification payload, the browser's push
    // service auto-displays it AND our own onBackgroundMessage handler in
    // sw.js displays it again — a well-known FCM web-push double-notification
    // gotcha. Data-only means only our own code ever calls showNotification,
    // exactly once.
    const resp = await getMessaging().sendEachForMulticast({
      tokens: docs.map(d => d.data().token),
      data: { title, body, icon: 'https://yankeleviz.vercel.app/icon.jpg', link: LINKS[page] },
    });
    sent += resp.successCount;
    resp.responses.forEach((r, i) => {
      if (!r.success) console.log(`notify[${page}]: token ${i} failed — ${r.error?.code || r.error?.message || 'unknown error'}`);
    });
    const toDelete = docs.filter((_, i) => !resp.responses[i]?.success);
    deleted += toDelete.length;
    await Promise.all(toDelete.map(d => d.ref.delete()));
  }

  console.log(`notify: sent ${sent}/${registered}, removed ${deleted} invalid token(s)`);
  res.status(200).json({ sent, registered, phone });
};
