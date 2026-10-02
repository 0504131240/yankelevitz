// Weekly debt reminder logic, called from daily-backup.js (see the comment
// there for why: Vercel's Hobby plan only ever actually registered ONE of
// this project's two cron entries — this file was never invoked on its own
// schedule, so the reminder silently never went out. Kept as a standalone
// module, exporting the sendable logic instead of its own HTTP handler.
const { getMessaging, dedupeTokenDocs, escHtml: _escHtml, sendViaEmailJS } = require('../_lib/firebaseAdmin');
const { evAdjBalance } = require('../_lib/debtCalc');
const { normalizePhone } = require('../_lib/yemot');

function debtEmailContent(famName, debts, totalDebt, credit) {
  const creditLine = credit > 0.5 ? `\n(מתוכם ₪${credit.toLocaleString()} מקוזזים מזיכוי שיש לך באירוע אחר)` : '';
  const message = `שלום ${famName},\n\nתזכורת שבועית — יש לך חוב פתוח באפליקציה:\n\n` +
    debts.map(d => `${d.name}: ₪${d.owe.toLocaleString()}`).join('\n') +
    `\n\nסה"כ (נטו): ₪${totalDebt.toLocaleString()}${creditLine}`;
  const rows = debts.map(d =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${_escHtml(d.name)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:left;font-weight:700">₪${d.owe.toLocaleString()}</td></tr>`
  ).join('');
  const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"></head><body style="margin:0;padding:12px;background:#eef0f8;font-family:-apple-system,Helvetica,Arial,sans-serif;direction:rtl">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
    <table role="presentation" style="width:100%;max-width:480px;background:#fff;border-radius:10px;overflow:hidden" cellspacing="0" cellpadding="0">
    <tr><td style="background:linear-gradient(135deg,#0C447C,#1E88D8);padding:20px;text-align:center">
      <div style="font-size:28px">📋</div><div style="color:#fff;font-size:17px;font-weight:700">תזכורת שבועית · ינקלביץ</div>
    </td></tr>
    <tr><td style="padding:20px">
      <p style="margin:0 0 12px;font-size:14px;color:#333">שלום ${_escHtml(famName)},</p>
      <p style="margin:0 0 14px;font-size:14px;color:#333">יש לך חוב פתוח באפליקציה:</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">${rows}</table>
      <div style="margin-top:14px;padding:10px 14px;background:#FEF2F2;border-radius:8px;text-align:center">
        <span style="font-weight:700;color:#A32D2D">סה"כ (נטו): ₪${totalDebt.toLocaleString()}</span>
        ${credit > 0.5 ? `<div style="font-size:11px;color:#888;margin-top:4px">מתוכם ₪${credit.toLocaleString()} מקוזזים מזיכוי שיש לך באירוע אחר</div>` : ''}
      </div>
    </td></tr>
    <tr><td style="padding:0 20px 20px;text-align:center">
      <a href="https://yankeleviz.vercel.app/" style="display:inline-block;background:#1E88D8;color:#fff;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:700">פתח באפליקציה ←</a>
    </td></tr>
    </table></td></tr></table></body></html>`;
  return { message, html };
}

async function sendWeeklyDebtReminders(db, data) {
  const ejsSnap = await db.doc('settings/emailjs').get();
  const { publicKey, serviceId, templateId } = ejsSnap.exists ? ejsSnap.data() : {};
  const emailReady = !!(publicKey && serviceId && templateId);
  const phoneEntries = [];

  const families = data.families || [];
  const openEvents = (data.events || []).filter(e => e.open);
  if (!openEvents.length) return { skipped: 'no open events' };

  const debtsByFam = {};
  const netByFam = {};
  openEvents.forEach(ev => {
    const adjBal = evAdjBalance(ev, families);
    ev.participants.forEach(fid => {
      const bal = adjBal[fid] || 0;
      netByFam[fid] = (netByFam[fid] || 0) + bal;
      const owe = Math.round(-bal);
      if (owe > 0.5) {
        if (!debtsByFam[fid]) debtsByFam[fid] = [];
        debtsByFam[fid].push({ name: ev.name, owe });
      }
    });
  });

  let emailsSent = 0, pushesSent = 0;
  for (const [fidStr, debts] of Object.entries(debtsByFam)) {
    const fid = parseInt(fidStr);
    // A credit balance in another open event that fully covers this debt
    // means the family isn't actually in the red overall — skip the nag.
    if ((netByFam[fid] || 0) >= -0.5) continue;
    const fam = families.find(f => f.id === fid);
    if (!fam) continue;
    const famName = fam.name.replace('משפחת', '').trim();
    // Show the real net amount owed (what the skip-check above already used),
    // not the raw sum of per-event debts — that sum ignores any credit this
    // family holds in another open event, overstating what they actually owe.
    const grossDebt = debts.reduce((s, d) => s + d.owe, 0);
    const totalDebt = Math.round(-(netByFam[fid] || 0));
    const credit = Math.max(0, grossDebt - totalDebt);

    const kosherPhone = fam.phonePref?.cats?.debt && normalizePhone(fam.kosherPhone);
    if (kosherPhone) {
      phoneEntries.push({ phone: kosherPhone, text: `תזכורת שבועית: למשפחת ${famName} יש חוב פתוח של ${totalDebt} שקלים` });
    }

    const addrs = [fam.email, fam.email2].filter(Boolean);
    if (addrs.length && emailReady) {
      const { message, html } = debtEmailContent(famName, debts, totalDebt, credit);
      for (const email of addrs) {
        try {
          await sendViaEmailJS(publicKey, serviceId, templateId, email, famName, '⚠️ תזכורת שבועית: חוב פתוח · ינקלביץ', message, html);
          emailsSent++;
        } catch (e) {
          console.error('weeklyDebtReminder email failed for', email, e);
        }
      }
    }

    // Push: only to this family's own registered device(s) — not a
    // broadcast to everyone, since the debt is specific to them.
    try {
      const tokSnap = await db.collection('fcmTokens').where('famId', '==', fid).get();
      const tokenDocs = await dedupeTokenDocs(tokSnap.docs);
      if (tokenDocs.length) {
        // Data-only (no top-level `notification`) — see notify.js for why:
        // a notification payload gets auto-displayed by the browser's push
        // service AND by our own onBackgroundMessage handler, doubling it.
        const resp = await getMessaging().sendEachForMulticast({
          tokens: tokenDocs.map(d => d.data().token),
          data: {
            title: '⚠️ תזכורת שבועית: חוב פתוח',
            body: `סה"כ ₪${totalDebt.toLocaleString()}`,
            icon: 'https://yankeleviz.vercel.app/icon.jpg',
            link: 'https://yankeleviz.vercel.app/',
          },
        });
        pushesSent += resp.successCount;
        const toDelete = tokenDocs.filter((_, i) => !resp.responses[i]?.success);
        await Promise.all(toDelete.map(d => d.ref.delete()));
      }
    } catch (e) {
      console.error('weeklyDebtReminder push failed for fam', fid, e);
    }
  }

  return { emailsSent, pushesSent, phoneEntries };
}

module.exports = { sendWeeklyDebtReminders };
