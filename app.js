const COLORS=[
  {bg:'#EEEDFE',c:'#3C3489'},{bg:'#E1F5EE',c:'#085041'},
  {bg:'#FAECE7',c:'#712B13'},{bg:'#FBEAF0',c:'#72243E'},
  {bg:'#E6F1FB',c:'#0C447C'},{bg:'#EAF3DE',c:'#27500A'},
  {bg:'#FAEEDA',c:'#633806'},{bg:'#FCEBEB',c:'#791F1F'},
];
let families=[];
let events=[];
let nxtId=1,nxtFam=1,actYear='all',expanded=new Set();
let collapsedEvents=new Set(),expandedArchGoals=new Set();
let expandedCumFamilies=new Set();
let expandedPotFamilies=new Set();
let addExpItemEvId=null,addExpItemFamId=null,addExpItemSharedWith=null,addExpItemSplitMode='equal',_editExpItemId=null,addExpItemFromPot=false,addExpItemPayMode='single',addExpItemMethod='equal';
const expandedExpItems=new Set();
const expandedFamShares=new Set();
let cumPotEvId=null,cumPotFamId=null;
let messages=[];
let calItems=[];
let birthdays=[];
let paymentClaims=[];
// Direct family-to-family settle-up transfers, computed across ALL open
// events combined (not tied to any one event) — the optional alternative to
// just paying the treasurer. Recorded here rather than in any single event's
// own `settled` array since the payment isn't "for" one specific event.
let globalSettled=[];
let visits=[];
let notifications=[];
let polls=[];
let countdowns=[];
let yahrzeits=[];
// Family tree: {id,name,gender:'boy'|'girl'|'', parentIds:[id,id?], spouseIds:[id,...]}[].
// A separate graph from `families` (nuclear-family units for money-splitting) —
// seeded once from it (seedFamilyTreeIfEmpty) but edited independently from
// then on, since a genealogical tree needs relations families/kids don't
// model (grandparents, siblings-in-law, multiple generations...).
let familyTree=[];
// Family-tree filling competition: {email:{name,points}} — see _awardTreePoints().
let treeScores={};
let nxtMsg=1,nxtCal=1,nxtBday=1,nxtClaim=1,nxtNotif=1,nxtPoll=1,nxtCountdown=1,nxtYahrzeit=1,nxtTreePerson=1;
let currentShell='home';
let calYear=new Date().getFullYear(),calMonth=new Date().getMonth(),calSelDay=null,calHebrew=true;
let calHebRefDate=new Date();
let fundTxOpen=false;
let settleModalEvId=null,potModalEvId=null,potTrModalEvId=null;
let _cumPotFromFund=false;
let _ppEvId=null,_ppFrom=null,_ppFromFid=null,_ppTo=null,_ppToFid=null,_ppMax=0,_ppFund=false,_ppSettle=false,_ppPot=false;
let adminPass='';
let editMode=false;
function toggleEvCollapse(evId){
  if(collapsedEvents.has(evId)){collapsedEvents.delete(evId);history.replaceState(null,'','#event-'+evId);}
  else{collapsedEvents.add(evId);history.replaceState(null,'','#events');}
  renderOpenList();
}
// fund: יתרה פנימית לכל משפחה + היסטוריית תנועות
// famBalances: {famId: number} — כמה כל משפחה הפקידה פחות מה שיצא
// transactions: [{id,type:'deposit'|'payout',famId,toFamId?,amount,desc,date}]
let fund={ famBalances:{}, transactions:[] };
let nxtTx=1;
// סך הקופה = סכום כל היתרות החיוביות
const fundTotal=()=>Object.values(fund.famBalances).filter(v=>v>0).reduce((s,v)=>s+v,0);
const famFundBal=fid=>(fund.famBalances[String(fid)]||0);
// קופות למטרה: {id, name, target, contributions:{famId:amount}, closed}
let goalFunds=[];
let nxtGoal=1;
// קופת חיסכון כללית: {expenses:[{id,name,amt,date}], nxtExpId}
let savingsPot={expenses:[],nxtExpId:1};
const goalTotal=g=>Object.values(g.contributions||{}).reduce((s,v)=>s+v,0);
const col=id=>COLORS[(id-1)%COLORS.length];
const ini=n=>n.replace('משפחת','').trim().slice(0,2);
const getFam=id=>families.find(f=>f.id===id);
const _isAdminPage=()=>/(^|\/)admin\.html$/.test(location.pathname);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const evCost=ev=>(ev.totalCost!=null?ev.totalCost:ev.participants.reduce((s,fid)=>s+(ev.expenses[fid]||0),0))+evPotExpTotal(ev);
const evShare=ev=>{ const n=ev.participants.length; return n?Math.round(evCost(ev)/n):0; };
const FAM_ADULTS=2;
const SPLIT_LABELS={equal:'שווה לכל משפחה',percapita:'לפי נפשות',weighted:'ילד = 50% ממבוגר'};
const famWeight=(f,method,childOverride,parentOverride)=>{
  if(!f) return 1;
  const ch=childOverride!=null?childOverride:((method==='percapita'||method==='weighted')?famAge3PlusChildCount(f):(f.children||0));
  const adults=parentOverride!=null?parentOverride:FAM_ADULTS;
  if(method==='percapita') return adults+ch;
  if(method==='weighted') return adults+ch*0.5;
  return 1;
};
const evSavingsPerFam=ev=>ev.savingsTotal?Math.round(ev.savingsTotal/((ev.participants||[]).length||1)):0;
// Exact (unrounded) share of one expense item that a single family owes — respects
// the item's own splitMethod override, falling back to plain-equal for an explicit
// partial sharedWith subset, else the event's overall default method.
const itemShareFor=(ev,it,fid)=>{
  if(it.customSplit)return it.customSplit[String(fid)]||0;
  const isPartialSubset=it.sharedWith&&it.sharedWith.length>0&&it.sharedWith.length<ev.participants.length;
  const sw=isPartialSubset?it.sharedWith.filter(p=>ev.participants.includes(p)):ev.participants;
  if(!sw.includes(fid))return 0;
  const method=it.splitMethod!=null?it.splitMethod:(isPartialSubset?'equal':(ev.splitMethod||'equal'));
  let itemW=0;const iw={};
  sw.forEach(p=>{
    iw[p]=famWeight(getFam(p),method,ev.childOverrides?.[p],ev.parentOverrides?.[p]);
    itemW+=iw[p];
  });
  return itemW?it.amt*(iw[fid]/itemW):0;
};
const evShares=ev=>{
  const defMethod=ev.splitMethod||'equal';
  const totalCost=evCost(ev);
  const items=ev.expenseItems||[];
  const exact={};
  ev.participants.forEach(fid=>{ exact[fid]=0; });
  let itemsTotal=0;
  // Each item is split on its own — using its own splitMethod if it has one (the
  // per-expense override), else falling back to a subset-shared item's implicit
  // equal split, else the event's overall default method. This lets different
  // items in the same event use different split methods.
  items.forEach(it=>{
    itemsTotal+=it.amt;
    ev.participants.forEach(fid=>{
      const s=itemShareFor(ev,it,fid);
      if(s)exact[fid]=(exact[fid]||0)+s;
    });
  });
  // Cost not accounted for by any expense item (e.g. a flat totalCost, or pot-funded
  // expenses) falls back to the event's overall default method across everyone.
  const remainder0=totalCost-itemsTotal;
  if(Math.abs(remainder0)>0.0001){
    let totalW=0; const w={};
    ev.participants.forEach(fid=>{ w[fid]=famWeight(getFam(fid),defMethod,ev.childOverrides?.[fid],ev.parentOverrides?.[fid]); totalW+=w[fid]; });
    if(totalW) ev.participants.forEach(fid=>{ exact[fid]=(exact[fid]||0)+remainder0*(w[fid]/totalW); });
  }
  const floors={};
  ev.participants.forEach(fid=>{ floors[fid]=Math.floor(exact[fid]||0); });
  let remainder=Math.round(totalCost-ev.participants.reduce((s,fid)=>s+floors[fid],0));
  const sorted=[...ev.participants].sort((a,b)=>((exact[b]||0)-floors[b])-((exact[a]||0)-floors[a]));
  const hasSavings=!!ev.savingsTotal;
  const shares={...floors};
  if(hasSavings){
    // When savings are set, round everyone up; the surplus over totalCost goes to the savings pot
    ev.participants.forEach(fid=>{ shares[fid]=Math.ceil(exact[fid]||0); });
  }else{
    for(let i=0;i<remainder&&i<sorted.length;i++) shares[sorted[i]]++;
  }
  const savingsPerFam=evSavingsPerFam(ev);
  if(savingsPerFam>0) ev.participants.forEach(fid=>{shares[fid]=(shares[fid]||0)+savingsPerFam;});
  return shares;
};
// Returns the extra shekels from ceiling-rounding that flow into the savings pot for this event
const evSavingsSurplus=ev=>{
  if(!ev.savingsTotal)return 0;
  const _sh=evShares(ev);
  const _spf=evSavingsPerFam(ev);
  const _sum=(ev.participants||[]).reduce((s,fid)=>s+(_sh[fid]||0),0);
  return Math.max(0,Math.round(_sum-_spf*(ev.participants||[]).length-evCost(ev)));
};
const evBalance=ev=>{ const shares=evShares(ev); const res={}; ev.participants.forEach(fid=>{ res[fid]=(ev.expenses[fid]||0)-(shares[fid]||0); }); return res; };
// Who fronted the money for an expense item, as {famId: amount} — normalizes the legacy
// single-payer (it.famId) shape and the newer multi-payer (it.payers) shape into one form.
const itemPayers=it=>it.payers||(it.famId!=null?{[it.famId]:it.amt}:{});
const itemPayerAmt=(it,fid)=>{const p=itemPayers(it);let s=0;Object.entries(p).forEach(([k,v])=>{if(Number(k)===Number(fid))s+=v;});return s;};
const itemPayerNames=it=>Object.keys(itemPayers(it)).map(fid=>{const f=getFam(parseInt(fid));return f?f.name.replace('משפחת','').trim():'';}).filter(Boolean);
function _creditItemPayers(ev,item){
  Object.entries(itemPayers(item)).forEach(([fid,amt])=>{const nfid=parseInt(fid);ev.expenses[nfid]=(ev.expenses[nfid]||0)+amt;});
}
function _uncreditItemPayers(ev,item){
  Object.entries(itemPayers(item)).forEach(([fid,amt])=>{const nfid=parseInt(fid);ev.expenses[nfid]=Math.max(0,(ev.expenses[nfid]||0)-amt);});
}
const evPotTotal=ev=>(ev.potPayments||[]).reduce((s,p)=>s+p.amt,0);
const evPotExpTotal=ev=>(ev.potExpItems||[]).reduce((s,it)=>s+it.amt,0);
const evPotBal=ev=>Math.max(0,evPotTotal(ev)-(ev.potToSavings||[]).reduce((s,p)=>s+p.amt,0));
const evNetPotBal=ev=>Math.max(0,evPotBal(ev)-evPotExpTotal(ev));
// Original deposit per family = remaining potPayments + already-transferred + excess-refunded settled entries
const evPotOrigByFam=ev=>{
  const r={};
  (ev.potPayments||[]).forEach(p=>{r[p.famId]=(r[p.famId]||0)+p.amt;});
  (ev.settled||[]).filter(s=>(s.method==='pot'||s.method==='pot-refund')&&s.fromFid!=null).forEach(s=>{r[s.fromFid]=(r[s.fromFid]||0)+s.amt;});
  return r;
};
// How much of a family's pot deposit for this event came from the wallet (main fund)
const evPotFromWallet=(ev,fid)=>Math.round((fund.transactions||[])
  .filter(t=>Number(t.famId)===Number(fid)&&t.type==='payout'&&(t.desc||'').includes('העברה לקופת האירוע')&&(t.evId!=null?t.evId===ev.id:(t.desc||'').includes(ev.name)))
  .reduce((s,t)=>s+t.amount,0));
// Amount transferred to creditors per depositing family
const evPotTransByFam=ev=>{
  const r={};
  (ev.settled||[]).filter(s=>s.method==='pot'&&s.fromFid!=null).forEach(s=>{r[s.fromFid]=(r[s.fromFid]||0)+s.amt;});
  return r;
};
// Excess amounts refunded back to depositing family
const evPotRefundByFam=ev=>{
  const r={};
  (ev.settled||[]).filter(s=>s.method==='pot-refund'&&s.fromFid!=null).forEach(s=>{r[s.fromFid]=(r[s.fromFid]||0)+s.amt;});
  return r;
};
// Savings pot helpers
const savingsPotContrib=()=>events.reduce((s,ev)=>
  s+(ev.savingsPaid||[]).reduce((ss,p)=>ss+p.amt,0)
   +(ev.potToSavings||[]).reduce((ss,p)=>ss+p.amt,0),0);
const savingsPotExpTotal=()=>(savingsPot.expenses||[]).reduce((s,e)=>s+e.amt,0);
const savingsPotBal=()=>savingsPotContrib()-savingsPotExpTotal();
function evEffectivePotPayments(ev){
  const payments=ev.potPayments||[];
  // Money already spent from the pot, whether on a real expense or released to savings,
  // is no longer available to hand back to depositors — dilute both the same way.
  const expTotal=evPotExpTotal(ev)+(ev.potToSavings||[]).reduce((s,p)=>s+p.amt,0);
  if(!expTotal)return payments;
  const total=payments.reduce((s,p)=>s+p.amt,0);
  if(!total)return payments;
  if(expTotal>=total)return payments.map(p=>({...p,amt:0}));
  const factor=(total-expTotal)/total;
  return payments.map(p=>({...p,amt:Math.round(p.amt*factor)}));
}
function evAdjBalance(ev){
  const adjBal=evBalance(ev);
  (ev.settled||[]).forEach(s=>{
    // Prefer the fromFid/toFid every settled entry already carries (matching
    // every other reader of ev.settled in the app) over matching by name —
    // name-only matching breaks silently the moment a family is renamed,
    // making an already-settled debt reappear as owed.
    const fromFid=s.fromFid!=null?s.fromFid:ev.participants.find(fid=>{ const f=getFam(fid); return f&&f.name.replace('משפחת','').trim()===s.from; });
    const toFid=s.toFid!=null?s.toFid:ev.participants.find(fid=>{ const f=getFam(fid); return f&&f.name.replace('משפחת','').trim()===s.to; });
    // A treasurer-fronted transfer (method:'treasurer') only resolves the
    // CREDITOR's side — the debtor didn't actually pay anything, the
    // treasurer covered it personally, so the debtor must keep showing as
    // still owing until they repay the treasurer (a separate 'treasurer-repay'
    // entry, which — having no toFid of its own — clears the debtor's side
    // the normal way below).
    if(fromFid!=null&&s.method!=='treasurer') adjBal[fromFid]=(adjBal[fromFid]||0)+s.amt;
    if(toFid!=null) adjBal[toFid]=(adjBal[toFid]||0)-s.amt;
  });
  (ev.potPayments||[]).forEach(p=>{ adjBal[p.famId]=(adjBal[p.famId]||0)+p.amt; });
  (ev.savingsPaid||[]).forEach(p=>{ adjBal[p.famId]=(adjBal[p.famId]||0)+p.amt; });
  // Note: potToSavings deliberately does NOT credit any family here. It's handled the
  // same way as a pot expense — evEffectivePotPayments() dilutes what depositors can
  // still draw from the pot, and whatever they're still owed for their deposit flows
  // through the normal creditor/debtor settlement in calcTransfers, exactly like any
  // other pot-funded cost.
  return adjBal;
}
const shareLabel=ev=>{
  const method=ev.splitMethod||'equal';
  if(method==='equal') return 'חלק שווה: ₪'+evShare(ev).toLocaleString()+'/משפחה';
  return 'חלוקה: '+SPLIT_LABELS[method]+' · סה"כ ₪'+evCost(ev).toLocaleString();
};

const firebaseConfig = {
  apiKey: "AIzaSyA0MZMuGBBIXckhdiOZRZXRC_NPEte7pMA",
  authDomain: "yossi20361.firebaseapp.com",
  projectId: "yossi20361",
  storageBucket: "yossi20361.firebasestorage.app",
  messagingSenderId: "789621490367",
  appId: "1:789621490367:web:e62376e9d46a86903f7c0a"
};

let _fb=null,_fbApp=null;
const FCM_VAPID_KEY='BArxsmOWaMQFdVOKOxFczYqBOHMZxqLofJobilD5zslw5hHByEHpu4VU2PFTuDuqFQlauxjhVAoO4s6ob9vaj6w';
async function fbInit(){
  if(_fb) return _fb;
  const appMod=await import("https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js");
  const fsMod=await import("https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js");
  _fbApp=appMod.initializeApp(firebaseConfig);
  const db=fsMod.getFirestore(_fbApp);
  _fb={db,doc:fsMod.doc,getDoc:fsMod.getDoc,setDoc:fsMod.setDoc,onSnapshot:fsMod.onSnapshot,collection:fsMod.collection,
    getDocs:fsMod.getDocs,query:fsMod.query,where:fsMod.where,deleteDoc:fsMod.deleteDoc};
  return _fb;
}

let _saving=false;

function openEjsSettingsModal(){
  loadEjsSettings();
  document.getElementById('ejsSettingsModal').style.display='flex';
}
function closeEjsSettingsModal(){
  document.getElementById('ejsSettingsModal').style.display='none';
}
function openPaymentSettingsModal(){
  loadPaymentSettings();
  document.getElementById('paymentSettingsModal').style.display='flex';
}
function closePaymentSettingsModal(){
  document.getElementById('paymentSettingsModal').style.display='none';
}
function openSettingsHubModal(){
  document.getElementById('settingsHubModal').style.display='flex';
}
function closeSettingsHubModal(){
  document.getElementById('settingsHubModal').style.display='none';
}

// EmailJS settings — read/written via /api/settings/emailjs (Admin SDK,
// bypasses Firestore rules) rather than the client SDK directly, so this
// keeps working regardless of how the settings/* collection's Firestore
// rules are configured.
async function loadEjsSettings(){
  try{
    const r=await fetch('/api/settings/emailjs');
    const d=await r.json();
    if(d.publicKey)  localStorage.setItem('ejsPublicKey', d.publicKey);
    if(d.serviceId)  localStorage.setItem('ejsServiceId', d.serviceId);
    if(d.templateId) localStorage.setItem('ejsTemplateId', d.templateId);
  }catch(e){}
  const keyEl=document.getElementById('ejsPublicKey');
  const svcEl=document.getElementById('ejsServiceId');
  const tplEl=document.getElementById('ejsTemplateId');
  if(keyEl) keyEl.value=localStorage.getItem('ejsPublicKey')||'';
  if(svcEl) svcEl.value=localStorage.getItem('ejsServiceId')||'';
  if(tplEl) tplEl.value=localStorage.getItem('ejsTemplateId')||'';
  const key=localStorage.getItem('ejsPublicKey');
  if(key&&typeof emailjs!=='undefined') emailjs.init(key);
}
async function saveEjsSettings(){
  const key=document.getElementById('ejsPublicKey').value.trim();
  const svc=document.getElementById('ejsServiceId').value.trim();
  const tpl=document.getElementById('ejsTemplateId').value.trim();
  localStorage.setItem('ejsPublicKey',key);
  localStorage.setItem('ejsServiceId',svc);
  localStorage.setItem('ejsTemplateId',tpl);
  if(key&&typeof emailjs!=='undefined') emailjs.init(key);
  const st=document.getElementById('ejsStatus');
  try{
    const r=await fetch('/api/settings/emailjs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adminPass,publicKey:key,serviceId:svc,templateId:tpl})});
    if(!r.ok)throw new Error('save failed');
    if(st){st.textContent='✓ נשמר';st.style.color='var(--green)';setTimeout(()=>{if(st)st.textContent='';},2500);}
  }catch(e){
    if(st){st.textContent='⚠ שמירה נכשלה';st.style.color='var(--red)';}
  }
}
function openBroadcastModal(){
  const subjEl=document.getElementById('broadcastSubject');if(subjEl)subjEl.value='';
  const msgEl=document.getElementById('broadcastMsg');if(msgEl)msgEl.value='';
  const err=document.getElementById('broadcastErr');if(err)err.style.display='none';
  const cnt=families.filter(f=>f.email||f.email2).length;
  const hint=document.getElementById('broadcastHint');
  if(hint)hint.textContent=cnt?`יישלח ל-${cnt} משפחות עם כתובת מייל שמורה`:'אין משפחות עם כתובת מייל שמורה';
  document.getElementById('broadcastModal').style.display='flex';
}
function closeBroadcastModal(){
  document.getElementById('broadcastModal').style.display='none';
}
// Shared by sendBroadcastEmail() and previewBroadcastEmail() so the preview
// is always built exactly the same way as what actually gets sent.
function _broadcastEmailHtml(subject,msg){
  const bodyHtml=`<p style="white-space:pre-wrap;margin:0">${_esc(msg)}</p>`;
  return _emailWrap(bodyHtml,subject,'📢','');
}
function previewBroadcastEmail(){
  const subject=(document.getElementById('broadcastSubject')?.value||'').trim();
  const msg=(document.getElementById('broadcastMsg')?.value||'').trim();
  const err=document.getElementById('broadcastErr');
  if(!subject||!msg){if(err){err.textContent='נא למלא נושא ותוכן כדי לראות תצוגה מקדימה';err.style.display='block';}return;}
  if(err)err.style.display='none';
  const frame=document.getElementById('broadcastPreviewFrame');
  if(frame)frame.srcdoc=_broadcastEmailHtml(subject,msg);
  document.getElementById('broadcastPreviewModal').style.display='flex';
}
function closeBroadcastPreviewModal(){
  document.getElementById('broadcastPreviewModal').style.display='none';
}
function sendBroadcastEmail(){
  const subject=(document.getElementById('broadcastSubject')?.value||'').trim();
  const msg=(document.getElementById('broadcastMsg')?.value||'').trim();
  const err=document.getElementById('broadcastErr');
  if(!subject||!msg){if(err){err.textContent='נא למלא נושא ותוכן';err.style.display='block';}return;}
  const recipients=families.filter(f=>f.email||f.email2).map(f=>({email:f.email,email2:f.email2,name:f.name.replace('משפחת','').trim()}));
  if(!recipients.length){if(err){err.textContent='אין משפחות עם כתובת מייל שמורה';err.style.display='block';}return;}
  if(err)err.style.display='none';
  const html=_broadcastEmailHtml(subject,msg);
  sendEmailNotif(recipients,subject,msg,html);
  closeBroadcastModal();
  showToast('📧 ההודעה נשלחה לכולם');
}
function openSiteUpdateModal(){
  const inp=document.getElementById('siteUpdateText');if(inp)inp.value='';
  const err=document.getElementById('siteUpdateErr');if(err)err.style.display='none';
  document.getElementById('siteUpdateModal').style.display='flex';
}
function closeSiteUpdateModal(){
  document.getElementById('siteUpdateModal').style.display='none';
}
function sendSiteUpdate(){
  const text=(document.getElementById('siteUpdateText')?.value||'').trim();
  const err=document.getElementById('siteUpdateErr');
  if(!text){if(err){err.textContent='נא לתאר את העדכון';err.style.display='block';}return;}
  if(err)err.style.display='none';
  addNotif('🆕',text,undefined,undefined,'siteUpdate');
  save();
  closeSiteUpdateModal();
  showToast('🆕 העדכון נשלח');
}
function getPaymentSettings(){
  return{
    name:localStorage.getItem('payTreasurerName')||'',
    bank:localStorage.getItem('payBankName')||'',
    branch:localStorage.getItem('payBranch')||'',
    account:localStorage.getItem('payAccount')||'',
    bit:localStorage.getItem('payBitLink')||''
  };
}
// Read/written via /api/settings/payment (Admin SDK, bypasses Firestore
// rules) rather than the client SDK directly, so this keeps working
// regardless of how the settings/* collection's Firestore rules are
// configured.
async function loadPaymentSettings(){
  try{
    const r=await fetch('/api/settings/payment');
    const d=await r.json();
    if(d.name)    localStorage.setItem('payTreasurerName',d.name);
    if(d.bank)    localStorage.setItem('payBankName',d.bank);
    if(d.branch)  localStorage.setItem('payBranch',d.branch);
    if(d.account) localStorage.setItem('payAccount',d.account);
    if(d.bit)     localStorage.setItem('payBitLink',d.bit);
  }catch(e){}
  const ids=['payTreasurerName','payBankName','payBranch','payAccount','payBitLink'];
  const keys=['payTreasurerName','payBankName','payBranch','payAccount','payBitLink'];
  ids.forEach((id,i)=>{const el=document.getElementById(id);if(el)el.value=localStorage.getItem(keys[i])||'';});
}
async function savePaymentSettings(){
  const p={
    name:(document.getElementById('payTreasurerName').value||'').trim(),
    bank:(document.getElementById('payBankName').value||'').trim(),
    branch:(document.getElementById('payBranch').value||'').trim(),
    account:(document.getElementById('payAccount').value||'').trim(),
    bit:(document.getElementById('payBitLink').value||'').trim()
  };
  localStorage.setItem('payTreasurerName',p.name);
  localStorage.setItem('payBankName',p.bank);
  localStorage.setItem('payBranch',p.branch);
  localStorage.setItem('payAccount',p.account);
  localStorage.setItem('payBitLink',p.bit);
  const st=document.getElementById('payStatus');
  try{
    const r=await fetch('/api/settings/payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adminPass,...p})});
    if(!r.ok)throw new Error('save failed');
    if(st){st.textContent='✓ נשמר';st.style.color='var(--green)';setTimeout(()=>{if(st)st.textContent='';},2500);}
  }catch(e){
    if(st){st.textContent='⚠ שמירה נכשלה';st.style.color='var(--red)';}
  }
}
function _paymentBlock(owe,evName,evId,famId){
  const p=getPaymentSettings();
  const hasBank=p.bank&&p.account;
  const hasBit=p.bit;
  let html='';
  if(hasBank||hasBit){
    html+=`<div style="margin-top:14px;padding:12px 14px;background:#F0FDF4;border-radius:8px;border:1px solid #BBF7D0">`;
    html+=`<div style="font-weight:700;font-size:13px;color:#15803D;margin-bottom:8px">💸 לתשלום:</div>`;
    if(hasBank){
      html+=`<div style="font-size:12px;color:#166534;line-height:1.8">`;
      html+=`🏦 <b>${_esc(p.bank)}</b>`;
      if(p.branch) html+=` · סניף <b>${_esc(p.branch)}</b>`;
      html+=`<br>מספר חשבון: <b style="letter-spacing:1px;direction:ltr;display:inline-block">${_esc(p.account)}</b>`;
      html+=`</div>`;
    }
    if(hasBit){
      html+=`<div style="margin-top:${hasBank?10:0}px">`;
      html+=`<a href="${_esc(p.bit)}" style="display:inline-block;background:#1A3C40;color:#3BFFF0;text-decoration:none;padding:10px 22px;border-radius:20px;font-size:14px;font-weight:700">💙 שלם בביט · ₪${owe.toLocaleString()}</a>`;
      html+=`</div>`;
    }
    html+=`</div>`;
  }
  if(evId!=null&&famId!=null){
    const confirmUrl=`${_ejsUrl()}#confirm-${evId}-${famId}-${Math.round(owe)}`;
    html+=`<div style="margin-top:10px;text-align:center">`;
    html+=`<a href="${_esc(confirmUrl)}" style="display:inline-block;background:#fff;color:#15803D;text-decoration:none;padding:9px 20px;border-radius:20px;font-size:13px;font-weight:700;border:1.5px solid #86EFAC">✓ כבר שילמתי, סמן בשבילי</a>`;
    html+=`</div>`;
  }
  return html;
}
function testEjsEmail(){
  const key=localStorage.getItem('ejsPublicKey');
  const svc=localStorage.getItem('ejsServiceId');
  const tpl=localStorage.getItem('ejsTemplateId');
  if(!key||!svc||!tpl){const st=document.getElementById('ejsStatus');if(st){st.textContent='נא לשמור הגדרות תחילה';st.style.color='var(--red)';}return;}
  const verified=new Set(JSON.parse(localStorage.getItem('verifiedEmails')||'[]'));
  const addrs=[];
  families.forEach(f=>{
    const name=f.name.replace('משפחת','').trim();
    if(_validEmail(f.email)&&!verified.has(f.email.trim())) addrs.push({email:f.email.trim(),name});
    if(_validEmail(f.email2)&&!verified.has(f.email2.trim())) addrs.push({email:f.email2.trim(),name});
  });
  if(!addrs.length){const st=document.getElementById('ejsStatus');if(st){st.textContent='✓ כל הכתובות כבר מאומתות';st.style.color='var(--green)';}return;}
  const st=document.getElementById('ejsStatus');if(st){st.textContent=`שולח ל-${addrs.length} כתובות חדשות...`;st.style.color='var(--text2)';}
  let done=0,failed=0;
  addrs.forEach((a,i)=>setTimeout(()=>{
    emailjs.send(svc,tpl,{to_email:a.email,to_name:a.name,subject:'בדיקת התראות · ינקלביץ',message:'מייל זה אישר שהתראות מוגדרות בהצלחה באפליקציית ינקלביץ.'})
      .then(()=>{done++;verified.add(a.email);localStorage.setItem('verifiedEmails',JSON.stringify([...verified]));if(done+failed===addrs.length&&st){st.textContent=`✓ נשלח ל-${done} כתובות${failed?` · ${failed} נכשלו`:''}`;st.style.color=failed?'var(--red)':'var(--green)';renderFamList();}})
      .catch(()=>{failed++;if(done+failed===addrs.length&&st){st.textContent=`נשלח ל-${done} · ${failed} נכשלו`;st.style.color='var(--red)';}});
  },i*600));
}
const _cleanEmail=e=>(e||'').replace(/[​-‏‪-‮⁠﻿ ]/g,'').trim().toLowerCase();
const _validEmail=e=>!!e&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(_cleanEmail(e));
function _ejsUrl(){return window.location.origin+window.location.pathname.replace(/[^/]*$/,'index.html');}
function _esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function _emailWrap(bodyHtml,headerTitle,headerIcon,urlOverride,headerSubtitle){
  const url=urlOverride!=null?urlOverride:_ejsUrl();
  return`<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:6px;background:#eef0f8;font-family:-apple-system,Helvetica,Arial,sans-serif;direction:rtl"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" style="width:100%;max-width:480px" cellspacing="0" cellpadding="0"><tr><td style="background:linear-gradient(135deg,#0C447C 0%,#1E88D8 100%);padding:20px 16px;text-align:center;border-radius:10px 10px 0 0"><div style="font-size:32px;margin-bottom:4px">${headerIcon}</div><div style="color:#fff;font-size:18px;font-weight:700;letter-spacing:0.5px">${_esc(headerTitle)}</div>${headerSubtitle?`<div style="color:rgba(255,255,255,0.82);font-size:12px;margin-top:3px">${_esc(headerSubtitle)}</div>`:''}</td></tr><tr><td style="background:#fff;padding:16px;direction:rtl;color:#1a1a2e;font-size:14px;line-height:1.6">${bodyHtml}</td></tr>${url?`<tr><td style="background:#fff;padding:0 16px 16px;text-align:center"><a href="${_esc(url)}" style="display:inline-block;background:#1E88D8;color:#fff;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:700">קישור לאירוע ←</a></td></tr>`:''}<tr><td style="background:#f4f4f6;padding:8px 16px;text-align:center;border-radius:0 0 10px 10px;border-top:1px solid #e4e4e8"><span style="font-size:11px;color:#aaa">ינקלביץ · מערכת ניהול הוצאות משפחתית</span></td></tr></table></td></tr></table></body></html>`;
}
function _eCard(rows){
  // Table layout (not flex) — email clients like Gmail ignore flexbox, which
  // collapses the row and glues the label to the amount. width:100% pushes the
  // amount to the far edge, and the label cell's side padding guarantees a gap.
  return`<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:10px 12px;margin-bottom:14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">`+rows.map(([l,v,hi],i)=>{const bb=i<rows.length-1?';border-bottom:1px solid #DBEAFE':'';return`<tr><td style="padding:4px 0 4px 12px;color:#666;font-size:13px;text-align:right${bb}">${_esc(l)}</td><td style="padding:4px 0;font-weight:700;font-size:13px;text-align:left;white-space:nowrap${hi?';color:#1E88D8':''}${bb}">${v}</td></tr>`;}).join('')+`</table></div>`;
}
function _eBadge(text,color){return`<div style="display:inline-block;background:${color}1a;border:1px solid ${color}55;border-radius:20px;padding:4px 12px;font-size:13px;font-weight:700;color:${color}">${_esc(text)}</div>`;}
function _splitMethodBlock(ev,fid){
  const method=ev.splitMethod||'equal';
  const label=SPLIT_LABELS[method]||method;
  let compLine='';
  if(method!=='equal'&&fid!=null){
    const pf=getFam(fid);
    if(pf){
      const ch=ev.childOverrides?.[fid]!=null?ev.childOverrides[fid]:(pf.children||0);
      const adults=ev.parentOverrides?.[fid]!=null?ev.parentOverrides[fid]:FAM_ADULTS;
      const aLabel=adults===0?'0 הורים':adults===1?'הורה 1':'2 הורים';
      compLine=ch>0?` · ${aLabel} + ${ch} ילד${ch===1?'':'ים'}`:` · ${aLabel}`;
    }
  }
  return`<div style="margin:0 0 12px;padding:8px 12px;background:#F0F9FF;border-radius:8px;border:1px solid #BAE6FD;font-size:12px;color:#0369A1"><span style="font-weight:700">📊 שיטת חלוקה: ${_esc(label)}</span>${compLine?`<span style="color:#075985"> ${_esc(compLine)}</span>`:''}</div>`;
}
function sendSettledEmail(ev,famId){
  const f=getFam(famId);
  if(!f||(!f.email&&!f.email2)) return;
  const notifKey='settled-'+ev.id+'-'+famId;
  if(localStorage.getItem(notifKey)) return;
  localStorage.setItem(notifKey,'1');
  const name=f.name.replace('משפחת','').trim();
  const cost=evCost(ev);
  const shares=evShares(ev);
  const share=Math.round(shares[famId]||0);
  const spent=Math.round(ev.expenses?(ev.expenses[famId]||0):(ev.expenseItems||[]).reduce((s,it)=>s+itemPayerAmt(it,famId),0));
  const lines=[];
  const _sfByName=n=>families.find(x=>x.name===n||x.name.replace(/^משפחת\s*/,'')===n);
  const _potTotal=Math.round((ev.potPayments||[]).filter(p=>Number(p.famId)===Number(famId)).reduce((s,p)=>s+p.amt,0));
  const _fromFundToPot=Math.round((fund.transactions||[])
    .filter(t=>Number(t.famId)===Number(famId)&&t.type==='payout'&&(t.desc||'').includes('העברה לקופת האירוע')&&(t.evId!=null?t.evId===ev.id:(t.desc||'').includes(ev.name)))
    .reduce((s,t)=>s+t.amount,0));
  if(_potTotal>0.5){
    if(_fromFundToPot>0.5&&_fromFundToPot===_potTotal) lines.push(`העברת מהארנק ₪${_potTotal.toLocaleString()} לקופת האירוע`);
    else{
      lines.push(`הפקדת לקופת האירוע: ₪${_potTotal.toLocaleString()}`);
      if(_fromFundToPot>0.5) lines.push(`מתוכם ₪${_fromFundToPot.toLocaleString()} הועברו מהארנק`);
    }
  }
  const _potRec=Math.round((ev.settled||[]).filter(s=>s.method==='pot'&&Number(s.toFid)===Number(famId)).reduce((s,t)=>s+t.amt,0));
  const _toFundFromPot=Math.round((fund.transactions||[])
    .filter(t=>Number(t.famId)===Number(famId)&&t.type==='deposit'&&(t.desc||'').includes('מקופת אירוע')&&(t.evId!=null?t.evId===ev.id:(t.desc||'').includes(ev.name)))
    .reduce((s,t)=>s+t.amount,0));
  if(_potRec>0.5){
    if(_toFundFromPot>0.5&&_toFundFromPot===_potRec) lines.push(`הועבר מקופת האירוע ₪${_potRec.toLocaleString()} לארנק שלכם`);
    else{
      lines.push(`קיבלת ₪${_potRec.toLocaleString()} מקופת האירוע`);
      if(_toFundFromPot>0.5) lines.push(`מתוכם ₪${_toFundFromPot.toLocaleString()} הועברו לארנק שלך`);
    }
  }
  (ev.settled||[]).forEach(s=>{
    if(s.method==='pot') return;
    const isFrom=s.fromFid!=null?Number(s.fromFid)===Number(famId):(_sfByName(s.from)||{}).id===famId;
    const isTo=s.toFid!=null?Number(s.toFid)===Number(famId):(_sfByName(s.to)||{}).id===famId;
    const sTo=(getFam(s.toFid)||{}).name?(getFam(s.toFid).name.replace('משפחת','').trim()):s.to;
    const sFrom=(getFam(s.fromFid)||{}).name?(getFam(s.fromFid).name.replace('משפחת','').trim()):s.from;
    if(isFrom){
      if(s.method==='fund') lines.push(`₪${s.amt.toLocaleString()} שולמו מהארנק ל${sTo}`);
      else lines.push(`העברה ישירה של ₪${s.amt.toLocaleString()} ל${sTo}`);
    } else if(isTo){
      if(s.method==='fund') lines.push(`₪${s.amt.toLocaleString()} מ${sFrom} – הועבר לארנק`);
      else lines.push(`קיבלת ₪${s.amt.toLocaleString()} ישירות מ${sFrom}`);
    }
  });
  const fundBal=Math.round(fund.famBalances[String(famId)]||0);
  const _savPF=evSavingsPerFam(ev);
  // plain text
  let msg=`האירוע "${ev.name}" – הסיכום שלך:\n\nעלות כוללת: ₪${cost.toLocaleString()}\nהחלק שלך: ₪${share.toLocaleString()}\n`;
  if(_savPF>0) msg+=`מתוכם ₪${_savPF.toLocaleString()} לקופת חיסכון 💎\n`;
  if(spent>0) msg+=`הוצאת: ₪${spent.toLocaleString()}\n`;
  if(lines.length) msg+=`\nאיך סודר:\n${lines.map(l=>'• '+l).join('\n')}`;
  if(fundBal>0) msg+=`\n\nיתרתך בארנק: ₪${fundBal.toLocaleString()}`;
  // HTML
  const cardRows=[['עלות כוללת האירוע',`₪${cost.toLocaleString()}`],['החלק שלך',`₪${share.toLocaleString()}`,true]];
  if(_savPF>0) cardRows.push(['💎 מתוכם לקופת חיסכון',`₪${_savPF.toLocaleString()}`]);
  if(spent>0) cardRows.push(['ההוצאות שלך',`₪${spent.toLocaleString()}`]);
  if(fundBal>0) cardRows.push(['💰 יתרה בארנק',`₪${fundBal.toLocaleString()}`]);
  let bodyHtml=_eCard(cardRows);
  bodyHtml+=_splitMethodBlock(ev,famId);
  if(lines.length){
    bodyHtml+=`<p style="font-weight:700;margin:0 0 8px;color:#333">⚖️ איך סודר:</p><ul style="margin:0 0 16px;padding-right:20px;color:#444">${lines.map(l=>`<li style="margin-bottom:4px">${_esc(l)}</li>`).join('')}</ul>`;
  }
  bodyHtml+=`<div style="text-align:center;margin-top:4px">${_eBadge('✅ החשבון שלך מסודר','#16a34a')}</div>`;
  const _evUrl=_ejsUrl()+'#'+(ev.open?'event-':'archive-')+ev.id;
  const html=_emailWrap(bodyHtml,ev.name,'✅',_evUrl,f.name);
  sendEmailNotif([{email:f.email,email2:f.email2,name}],`✅ סידרת את חלקך ב"${ev.name}" · ינקלביץ`,msg,html);
}
function testSingleEmail(inputId,btnId){
  const key=localStorage.getItem('ejsPublicKey');
  const svc=localStorage.getItem('ejsServiceId');
  const tpl=localStorage.getItem('ejsTemplateId');
  const email=_cleanEmail(document.getElementById(inputId)?.value||'');
  const btn=document.getElementById(btnId);
  if(!key||!svc||!tpl){if(btn){btn.textContent='הגדר EmailJS קודם';btn.style.color='var(--red)';}return;}
  if(!_validEmail(email)){if(btn){btn.textContent='✗ מייל לא תקין';btn.style.color='var(--red)';}setTimeout(()=>{if(btn){btn.textContent='בדוק';btn.style.color='var(--text2)';}},2500);return;}
  if(btn){btn.textContent='שולח...';btn.style.color='var(--text2)';btn.disabled=true;}
  const name=document.getElementById('famEditName')?.value.trim()||'';
  emailjs.send(svc,tpl,{to_email:email,to_name:name,subject:'בדיקת התראות · ינקלביץ',message:'מייל זה אישר שהתראות מוגדרות בהצלחה באפליקציית ינקלביץ.'})
    .then(()=>{
      const verified=new Set(JSON.parse(localStorage.getItem('verifiedEmails')||'[]'));
      verified.add(email);localStorage.setItem('verifiedEmails',JSON.stringify([...verified]));
      if(btn){btn.textContent='✓';btn.style.color='var(--green)';btn.style.fontWeight='700';btn.disabled=false;}
    })
    .catch(e=>{if(btn){btn.textContent='✗ שגיאה';btn.style.color='var(--red)';btn.disabled=false;}setTimeout(()=>{if(btn){btn.textContent='בדוק';btn.style.color='var(--text2)';btn.style.fontWeight='';}},3000);});
}
function sendEmailNotif(recipients,subject,message,html){
  const key=localStorage.getItem('ejsPublicKey');
  const svc=localStorage.getItem('ejsServiceId');
  const tpl=localStorage.getItem('ejsTemplateId');
  if(!key||!svc||!tpl||typeof emailjs==='undefined') return;
  const addrs=[];
  recipients.forEach(r=>{
    if(_validEmail(r.email)) addrs.push({email:r.email.trim(),name:r.name});
    if(_validEmail(r.email2)) addrs.push({email:r.email2.trim(),name:r.name});
  });
  const message_html=html||_emailWrap(`<p style="white-space:pre-wrap;margin:0">${_esc(message||'')}</p>`,subject,'📬');
  addrs.forEach((a,i)=>setTimeout(()=>{
    emailjs.send(svc,tpl,{to_email:a.email,to_name:a.name,subject,message,message_html})
      .then(()=>console.log('📧 מייל נשלח ל-'+a.email))
      .catch(e=>{console.error('📧 שגיאת מייל:',e);showToast('❌ שגיאה בשליחת מייל: '+(e?.text||e?.message||JSON.stringify(e)));});
  },i*600));
}
function sendFundUpdateEmail(famId,changeAmt,desc,note){
  const f=getFam(famId);
  if(!f||(!f.email&&!f.email2)){showToast('⚠️ לא הוגדר מייל למשפחה זו');return;}
  const key=localStorage.getItem('ejsPublicKey');
  const svc=localStorage.getItem('ejsServiceId');
  const tpl=localStorage.getItem('ejsTemplateId');
  if(!key||!svc||!tpl){showToast('⚠️ הגדרות מייל חסרות — כנס להגדרות משפחות');return;}
  const name=f.name.replace('משפחת','').trim();
  const newBal=Math.round(fund.famBalances[String(famId)]||0);
  const msg=`${desc}: ₪${Math.round(changeAmt).toLocaleString()}${note?`\n📝 ${note}`:''}\n\nיתרתך החדשה בארנק: ₪${newBal.toLocaleString()}`;
  const rows=[[desc,`₪${Math.round(changeAmt).toLocaleString()}`]];
  if(note)rows.push(['📝 הערה',_esc(note)]);
  rows.push(['💰 יתרה חדשה בקופה',`₪${newBal.toLocaleString()}`,true]);
  const html=_emailWrap(_eCard(rows),'עדכון ארנק','🏦',_ejsUrl()+'#fund');
  sendEmailNotif([{email:f.email,email2:f.email2,name}],'🏦 עדכון ארנק · ינקלביץ',msg,html);
}
// Deposit confirmation for a goal fund — sent for EVERY deposit, manual or
// wallet-sourced, so the depositing family always hears what their money
// went toward (who the gift is for, what it is, when the fund has those
// set). fromWallet additionally frames it as a wallet transfer and reports
// the new wallet balance, mirroring sendFundUpdateEmail's plain wallet
// deposit/withdraw email; a manual deposit just confirms the amount and
// gift details, since the wallet itself never moved.
function sendGoalDepositEmail(famId,amt,g,fromWallet){
  const f=getFam(famId);
  if(!f||(!f.email&&!f.email2)){showToast('⚠️ לא הוגדר מייל למשפחה זו');return;}
  const key=localStorage.getItem('ejsPublicKey');
  const svc=localStorage.getItem('ejsServiceId');
  const tpl=localStorage.getItem('ejsTemplateId');
  if(!key||!svc||!tpl){showToast('⚠️ הגדרות מייל חסרות — כנס להגדרות משפחות');return;}
  const name=f.name.replace('משפחת','').trim();
  const desc=fromWallet?`עבר מהארנק לקופת המטרה "${g.name}"`:`הפקדתם לקופת המטרה "${g.name}"`;
  const msgLines=[`${desc}: ₪${Math.round(amt).toLocaleString()}`];
  if(g.recipient)msgLines.push('🎁 עבור: '+g.recipient);
  if(g.gift)msgLines.push('🎀 מתנה: '+g.gift);
  const rows=[[desc,`₪${Math.round(amt).toLocaleString()}`]];
  if(g.recipient)rows.push(['🎁 עבור',_esc(g.recipient)]);
  if(g.gift)rows.push(['🎀 מתנה',_esc(g.gift)]);
  if(fromWallet){
    const newBal=Math.round(fund.famBalances[String(famId)]||0);
    msgLines.push('',`יתרתך החדשה בארנק: ₪${newBal.toLocaleString()}`);
    rows.push(['💰 יתרה חדשה בארנק',`₪${newBal.toLocaleString()}`,true]);
  }
  const msg=msgLines.join('\n');
  const html=_emailWrap(_eCard(rows),'הפקדה לקופת מטרה','🎯',_ejsUrl()+'#fund');
  sendEmailNotif([{email:f.email,email2:f.email2,name}],'🎯 הפקדה לקופת מטרה · ינקלביץ',msg,html);
}
// The reverse of sendGoalDepositEmail — the fund's collected money is paid
// OUT to the family who already bought the gift, landing in their wallet.
// The transferred amount is already net of the recipient's own share (they
// were exempted from paying it — see _goalOwedAmt) — this spells that out
// explicitly rather than just showing the raw total, so it doesn't read as
// if their own contribution was somehow missing from it.
function sendGoalPayoutEmail(famId,amt,g){
  const f=getFam(famId);
  if(!f||(!f.email&&!f.email2))return;
  const key=localStorage.getItem('ejsPublicKey');
  const svc=localStorage.getItem('ejsServiceId');
  const tpl=localStorage.getItem('ejsTemplateId');
  if(!key||!svc||!tpl)return;
  const name=f.name.replace('משפחת','').trim();
  const eligible=_goalPayers(g);
  const perFamily=g.target>0&&eligible.length?Math.ceil(g.target/eligible.length):0;
  const desc=`הועבר לארנק שלכם עבור המתנה שרכשתם`;
  const newBal=Math.round(fund.famBalances[String(famId)]||0);
  const msgLines=[`${desc}: ₪${Math.round(amt).toLocaleString()}`,'🎯 קופה: '+g.name];
  if(g.gift)msgLines.push('🎀 מתנה: '+g.gift);
  if(g.recipient)msgLines.push('🎁 עבור: '+g.recipient);
  if(g.notes)msgLines.push('📝 '+g.notes);
  if(perFamily>0)msgLines.push('💳 בניכוי החלק שלכם במתנה: ₪'+perFamily.toLocaleString());
  msgLines.push('',`יתרתכם החדשה בארנק: ₪${newBal.toLocaleString()}`);
  const rows=[[desc,`₪${Math.round(amt).toLocaleString()}`],['🎯 קופה',_esc(g.name)]];
  if(g.gift)rows.push(['🎀 מתנה',_esc(g.gift)]);
  if(g.recipient)rows.push(['🎁 עבור',_esc(g.recipient)]);
  if(g.notes)rows.push(['📝 הערות',_esc(g.notes)]);
  if(perFamily>0)rows.push(['💳 בניכוי החלק שלכם',`₪${perFamily.toLocaleString()}`]);
  rows.push(['💰 יתרה חדשה בארנק',`₪${newBal.toLocaleString()}`,true]);
  const msg=msgLines.join('\n');
  const html=_emailWrap(_eCard(rows),'העברה מקופת מטרה','💰',_ejsUrl()+'#fund');
  sendEmailNotif([{email:f.email,email2:f.email2,name}],'💰 העברה מקופת מטרה · ינקלביץ',msg,html);
}

function saveLocal(){
  try{
    localStorage.setItem('fe',JSON.stringify(events));
    localStorage.setItem('ff',JSON.stringify(families));
    localStorage.setItem('fund',JSON.stringify(fund));
    localStorage.setItem('nxtTx',String(nxtTx));
    localStorage.setItem('goalFunds',JSON.stringify(goalFunds));
    localStorage.setItem('savingsPot',JSON.stringify(savingsPot));
    localStorage.setItem('adminPass',adminPass);
    localStorage.setItem('messages',JSON.stringify(messages));
    localStorage.setItem('calItems',JSON.stringify(calItems));
    localStorage.setItem('birthdays',JSON.stringify(birthdays));
    localStorage.setItem('paymentClaims',JSON.stringify(paymentClaims));
    localStorage.setItem('globalSettled',JSON.stringify(globalSettled));
    localStorage.setItem('visits',JSON.stringify(visits));
    localStorage.setItem('notifications',JSON.stringify(notifications));
    localStorage.setItem('polls',JSON.stringify(polls));
    localStorage.setItem('countdowns',JSON.stringify(countdowns));
    localStorage.setItem('yahrzeits',JSON.stringify(yahrzeits));
    localStorage.setItem('familyTree',JSON.stringify(familyTree));
    localStorage.setItem('treeScores',JSON.stringify(treeScores));
  }catch(e){}
}

// Older polls stored a single flat {question, options, votes:{famId:optIdx}}.
// Multi-question polls with conditional follow-up questions need votes keyed
// by question id instead, so every poll is normalized to {questions:[{id,
// text,options,showIf}], votes:{famId:{qId:optIdx}}} the first time it's
// seen — everything downstream (rendering, voting, notifications) only ever
// deals with the new shape. Returns true if it actually converted anything.
function _migratePoll(p){
  if(p.questions)return false;
  p.questions=[{id:1,text:p.question||'',options:p.options||[],showIf:null}];
  const oldVotes=p.votes||{};
  p.votes={};
  Object.entries(oldVotes).forEach(([fid,optIdx])=>{p.votes[fid]={1:optIdx};});
  delete p.question;delete p.options;
  return true;
}
// Restores every locally-cached field (see saveLocal()) into the live
// variables. Used both when a save failed outright (network error) and when
// a save was left pending across a refresh — those two paths used to only
// share families/events/fund/savingsPot, so a pending familyTree/messages/
// polls/etc. change would silently get discarded and then re-saved over
// the real data.
function _restoreAllFromLocalCache(){
  const ev=localStorage.getItem('fe');if(ev)events=JSON.parse(ev);
  const fa=localStorage.getItem('ff');if(fa)families=JSON.parse(fa);
  const fd=localStorage.getItem('fund');if(fd){const p=JSON.parse(fd);fund=p.famBalances?p:{famBalances:{},transactions:p.transactions||[]};}
  const tx=localStorage.getItem('nxtTx');if(tx)nxtTx=parseInt(tx);
  const gf=localStorage.getItem('goalFunds');if(gf)goalFunds=JSON.parse(gf);
  const sp=localStorage.getItem('savingsPot');if(sp){savingsPot=JSON.parse(sp);if(!savingsPot.nxtExpId)savingsPot.nxtExpId=(savingsPot.expenses||[]).length?Math.max(...savingsPot.expenses.map(e=>e.id))+1:1;}
  const ap=localStorage.getItem('adminPass');if(ap)adminPass=ap;
  const msgs=localStorage.getItem('messages');if(msgs)messages=JSON.parse(msgs);
  const cals=localStorage.getItem('calItems');if(cals)calItems=JSON.parse(cals);
  const bds=localStorage.getItem('birthdays');if(bds)birthdays=JSON.parse(bds);
  const pcs=localStorage.getItem('paymentClaims');if(pcs)paymentClaims=JSON.parse(pcs);
  const gst=localStorage.getItem('globalSettled');if(gst)globalSettled=JSON.parse(gst);
  const vst=localStorage.getItem('visits');if(vst)visits=JSON.parse(vst);
  const nts=localStorage.getItem('notifications');if(nts)notifications=JSON.parse(nts);
  const pls=localStorage.getItem('polls');if(pls)polls=JSON.parse(pls);
  const cds=localStorage.getItem('countdowns');if(cds)countdowns=JSON.parse(cds);
  const yhz=localStorage.getItem('yahrzeits');if(yhz)yahrzeits=JSON.parse(yhz);
  const ftr=localStorage.getItem('familyTree');if(ftr)familyTree=JSON.parse(ftr);
  const trs=localStorage.getItem('treeScores');if(trs)treeScores=JSON.parse(trs);
  nxtMsg=messages.length?Math.max(...messages.map(m=>m.id))+1:1;
  nxtCal=calItems.length?Math.max(...calItems.map(c=>c.id))+1:1;
  nxtBday=birthdays.length?Math.max(...birthdays.map(b=>b.id))+1:1;
  nxtClaim=paymentClaims.length?Math.max(...paymentClaims.map(c=>c.id))+1:1;
  nxtNotif=notifications.length?Math.max(...notifications.map(n=>n.id))+1:1;
  nxtPoll=polls.length?Math.max(...polls.map(p=>p.id))+1:1;
  nxtCountdown=countdowns.length?Math.max(...countdowns.map(c=>c.id))+1:1;
  nxtYahrzeit=yahrzeits.length?Math.max(...yahrzeits.map(y=>y.id))+1:1;
  nxtTreePerson=familyTree.length?Math.max(...familyTree.map(p=>p.id))+1:1;
  nxtId=events.length?Math.max(...events.map(e=>e.id))+1:1;
  nxtFam=families.length?Math.max(...families.map(f=>f.id))+1:1;
  nxtGoal=goalFunds.length?Math.max(...goalFunds.map(g=>g.id))+1:1;
  if(!fund.famBalances)fund.famBalances={};
}
let _retryTimer=null;
async function save(){
  saveLocal();
  localStorage.setItem('pendingSave','1');
  localStorage.setItem('pendingSaveAt',String(Date.now()));
  if(_saving) return;
  _saving=true;
  if(_retryTimer){clearTimeout(_retryTimer);_retryTimer=null;}
  showSyncStatus('שומר...');
  try{
    const {db,doc,setDoc}=await fbInit();
    await setDoc(doc(db,'appData','familyPayments'),{families,events,fund,goalFunds,savingsPot,adminPass,messages,calItems,birthdays,paymentClaims,globalSettled,visits,notifications,polls,countdowns,yahrzeits,familyTree,treeScores});
    localStorage.removeItem('pendingSave');
    localStorage.removeItem('pendingSaveAt');
    showSyncStatus('✓ נשמר',2000);
  }catch(e){
    console.warn('save failed, will retry:',e);
    showSyncStatus('⚠ שמור מקומי · מנסה שוב...');
    _retryTimer=setTimeout(()=>{_saving=false;save();},8000);
    return;
  }
  _saving=false;
}



async function load(){
  showSyncStatus('טוען...');
  try{
    const {db,doc,getDoc}=await fbInit();
    const snap=await getDoc(doc(db,'appData','familyPayments'));
    const d=snap.exists()?snap.data():{};
    families=d.families||[];
    events=d.events||[];
    fund=d.fund||{famBalances:{},transactions:[]};
    if(!fund.famBalances)fund.famBalances={};
    goalFunds=d.goalFunds||[];
    savingsPot=d.savingsPot||{expenses:[],nxtExpId:1};
    if(!savingsPot.nxtExpId)savingsPot.nxtExpId=(savingsPot.expenses||[]).length?Math.max(...savingsPot.expenses.map(e=>e.id))+1:1;
    adminPass=d.adminPass||'';
    messages=d.messages||[];
    calItems=d.calItems||[];
    birthdays=d.birthdays||[];
    paymentClaims=d.paymentClaims||[];
    globalSettled=d.globalSettled||[];
    visits=d.visits||[];
    notifications=d.notifications||[];
    polls=d.polls||[];
    countdowns=d.countdowns||[];
    yahrzeits=d.yahrzeits||[];
    familyTree=d.familyTree||[];
    treeScores=d.treeScores||{};
    nxtMsg=messages.length?Math.max(...messages.map(m=>m.id))+1:1;
    nxtCal=calItems.length?Math.max(...calItems.map(c=>c.id))+1:1;
    nxtBday=birthdays.length?Math.max(...birthdays.map(b=>b.id))+1:1;
    nxtClaim=paymentClaims.length?Math.max(...paymentClaims.map(c=>c.id))+1:1;
    nxtNotif=notifications.length?Math.max(...notifications.map(n=>n.id))+1:1;
    nxtPoll=polls.length?Math.max(...polls.map(p=>p.id))+1:1;
    nxtCountdown=countdowns.length?Math.max(...countdowns.map(c=>c.id))+1:1;
    nxtYahrzeit=yahrzeits.length?Math.max(...yahrzeits.map(y=>y.id))+1:1;
    nxtTreePerson=familyTree.length?Math.max(...familyTree.map(p=>p.id))+1:1;
    nxtId=events.length?Math.max(...events.map(e=>e.id))+1:1;
    nxtFam=families.length?Math.max(...families.map(f=>f.id))+1:1;
    nxtTx=(fund.transactions||[]).length?Math.max(...fund.transactions.map(t=>t.id))+1:1;
    nxtGoal=goalFunds.length?Math.max(...goalFunds.map(g=>g.id))+1:1;
    // If a save was interrupted (network hiccup, tab closed mid-write) very recently,
    // trust the local cache — it's genuinely newer than what Firestore has and should
    // be re-pushed. But if the flag is old (the tab sat inactive for a while), other
    // devices have very likely saved changes since — blindly overwriting Firestore with
    // this stale local snapshot would silently wipe that work out, so just discard the
    // stale flag instead and keep the fresh data we already loaded above.
    const _pendingAt=parseInt(localStorage.getItem('pendingSaveAt')||'0');
    const _pendingFresh=_pendingAt>0&&(Date.now()-_pendingAt)<3*60*1000;
    if(localStorage.getItem('pendingSave')==='1'&&!_pendingFresh){
      localStorage.removeItem('pendingSave');
      localStorage.removeItem('pendingSaveAt');
    }
    if(localStorage.getItem('pendingSave')==='1'){
      try{_restoreAllFromLocalCache();}catch(e2){}
      _saving=false;save();
    } else {
      showSyncStatus('✓ מסונכרן',2000);
    }
  }catch(e){
    console.warn('load failed:',e);
    try{_restoreAllFromLocalCache();}catch(e2){}
    showSyncStatus('⚠ מקומי בלבד',3000);
  }finally{
    let _savAmtMigrated=false;
    events.forEach(ev=>{
      if(ev.savingsAmt==null)return;
      if(!ev.savingsTotal) ev.savingsTotal=Math.round(ev.savingsAmt*(ev.participants||[]).length);
      delete ev.savingsAmt;
      _savAmtMigrated=true;
    });
    let _kidsMigrated=false;
    families.forEach(f=>{
      if(f.kids)return;
      const n=f.children||0;
      f.kids=[];
      for(let i=0;i<n;i++)f.kids.push({id:i+1,name:'',gender:'',hebMonth:'',hebDay:null});
      _kidsMigrated=true;
    });
    const _bdaysCleared=birthdays.length>0;
    if(_bdaysCleared)birthdays=[];
    // Older tree data (or data cached before this fix) could carry an
    // undefined sourceFamId — Firestore's setDoc throws on that, silently
    // breaking every save from then on, so backfill it to null here.
    let _treeMigrated=false;
    familyTree.forEach(p=>{
      if(p.sourceFamId===undefined){p.sourceFamId=null;_treeMigrated=true;}
      if(p.birthYear===undefined){p.birthYear='';_treeMigrated=true;}
      if(p.deathYear===undefined){p.deathYear='';_treeMigrated=true;}
      if(p.deceased===undefined){p.deceased=false;_treeMigrated=true;}
      if(p.surname===undefined){p.surname='';_treeMigrated=true;}
      if(p.maidenName===undefined){p.maidenName='';_treeMigrated=true;}
    });
    let _pollsMigrated=false;
    polls.forEach(p=>{if(_migratePoll(p))_pollsMigrated=true;});
    if(_savAmtMigrated||_kidsMigrated||_bdaysCleared||_treeMigrated||_pollsMigrated)save();
    render();setTimeout(handleHash,100);
    if(!_isAdminPage()){
      const savedFamId=localStorage.getItem('deviceFamId3');
      if(!savedFamId){
        openEmailGateModal();
      } else {
        const savedFam=getFam(parseInt(savedFamId));
        if(savedFam) showEmailGateWelcome(savedFam,parseInt(localStorage.getItem('deviceEmailSlot3')||'1'));
        else openEmailGateModal();
      }
    }
  }
}

function showToast(msg,hideAfter){
  let el=document.getElementById('toastMsg');
  if(!el){
    el=document.createElement('div');
    el.id='toastMsg';
    el.style.cssText='position:fixed;bottom:calc(90px + env(safe-area-inset-bottom,0px));left:50%;transform:translateX(-50%);background:#1A1A18;color:#fff;font-size:13px;font-weight:600;padding:9px 18px;border-radius:20px;z-index:3000;transition:opacity 0.3s;white-space:nowrap;pointer-events:none;max-width:88vw;overflow:hidden;text-overflow:ellipsis';
    document.body.appendChild(el);
  }
  el.textContent=msg;
  el.style.opacity='1';
  clearTimeout(el._t);
  el._t=setTimeout(()=>{el.style.opacity='0';},hideAfter||2500);
}
function showSyncStatus(msg,hideAfter){
  let el=document.getElementById('syncStatus');
  if(!el){
    el=document.createElement('div');
    el.id='syncStatus';
    el.style.cssText='position:fixed;bottom:calc(130px + env(safe-area-inset-bottom,0px));left:50%;transform:translateX(-50%);background:#1A1A18;color:#fff;font-size:12px;font-weight:600;padding:6px 16px;border-radius:20px;z-index:500;transition:opacity 0.3s;white-space:nowrap;pointer-events:none';
    document.body.appendChild(el);
  }
  el.textContent=msg;
  el.style.opacity='1';
  if(hideAfter){
    clearTimeout(el._t);
    el._t=setTimeout(()=>{el.style.opacity='0';},hideAfter);
  }
}

function render(){
  applyEditMode();
  const fns=[renderHome,renderMetrics,renderOpenList,renderArchive,renderFamilies,renderFund,renderGoalFunds,renderFamilyHome,renderClaimsBanner,renderVisitLog,renderNotifCenterBadge,renderPollBanner,renderFamilyTreeIfOpen];
  fns.forEach(fn=>{try{fn();}catch(e){console.error(fn.name,e);}});
  const debt=calcDebt();
  const open=events.filter(e=>e.open).length;
  const sub=document.getElementById('topSub');
  if(sub)sub.textContent=open+' פתוחים · חוב: ₪'+debt.toLocaleString()+' · קופות: ₪'+fundTotal().toLocaleString();
}
function calcDebt(){
  let t=0;
  events.filter(e=>e.open).forEach(ev=>{
    const bal=evAdjBalance(ev);
    ev.participants.forEach(fid=>{ if(bal[fid]<-0.5) t+=Math.abs(bal[fid]); });
  });
  return t;
}
function renderMetrics(){
  const open=events.filter(e=>e.open).length,arch=events.filter(e=>!e.open).length,debt=calcDebt();
  const total=events.reduce((s,ev)=>s+evCost(ev),0);
  document.getElementById('metrics').innerHTML=`
    <div class="metric"><div class="metric-lbl">פעילים</div><div class="metric-val">${open}</div></div>
    <div class="metric"><div class="metric-lbl">ארכיון</div><div class="metric-val g">${arch}</div></div>
    <div class="metric"><div class="metric-lbl">חוב כולל</div><div class="metric-val r">₪${debt.toLocaleString()}</div></div>`;
}
function renderOpenList(){
  const open=events.filter(e=>e.open);
  document.getElementById('openList').innerHTML=open.length?open.map(evCard).join(''):`<div class="empty"><span class="empty-ico">📅</span>אין אירועים פעילים</div>`;
}
function switchShell(s){
  currentShell=s;
  closeChatSheet();
  document.body.classList.toggle('at-home',s==='home');
  document.getElementById('mn-home').classList.toggle('mn-active',s==='home');
  document.getElementById('mn-pay').classList.toggle('mn-active',s==='pay');
  if(s==='home'){renderFamilyHome();setTimeout(()=>{const sh=document.getElementById('shell-home');if(sh)sh.scrollTop=0;},10);}
  if(s==='pay')goTab('home',document.getElementById('nb-home'));
}
function openFamiliesFromHome(){
  renderFamilies();
  document.getElementById('familiesHomeOverlay').style.display='flex';
}
function closeFamiliesHomeOverlay(){
  document.getElementById('familiesHomeOverlay').style.display='none';
}

// ── Family tree ("אילן יוחסין") ─────────────────────────────────────────────
// A separate person graph from `families` (see the familyTree declaration
// above) — seeded once from the current families/kids, then edited freely by
// anyone (add parents/siblings/spouses/children, rename, delete) since a
// genealogical tree outgrows what the payments app's family units model.
const TREE_NODE_W=112,TREE_NODE_H=80,TREE_H_GAP=40,TREE_COUPLE_GAP=14,TREE_LEVEL_H=160;
// Gap left between the two parent couples that split around a married
// couple (his parents on one side, hers on the other). Wider than the
// normal TREE_H_GAP so those two families read as two separate lines
// rather than one block — this is the ONLY place spacing is widened;
// spouses, siblings and everyone else keep the standard gaps.
const TREE_FANOUT_GAP=120;
let _treeActivePersonId=null,_treeAddRelation=null,_treeAddGender='';
// What birthYear/deathYear/photo looked like when the person sheet was
// opened — compared against the current values in saveTreePersonChanges()
// so points are only ever awarded for NEWLY filling in a field, never for
// re-saving one that was already filled.
let _treePersonSnapshot=null;
// Sub-trees: a person can be marked as one, which folds their descendants
// out of the main tree. `collapsed` is stored on the person, so the branch
// stays folded away for everyone; opening one is a local view state that
// lasts for the session and changes nothing for anybody else.
let _treeExpanded=new Set();
function _treeChildrenMap(){
  const kids=new Map();
  familyTree.forEach(p=>(p.parentIds||[]).forEach(pid=>{
    if(!kids.has(pid))kids.set(pid,[]);
    kids.get(pid).push(p.id);
  }));
  return kids;
}
function _treeDescendantCount(id,kids){
  kids=kids||_treeChildrenMap();
  const seen=new Set(),q=[...(kids.get(id)||[])];
  while(q.length){
    const x=q.pop();
    if(seen.has(x))continue;
    seen.add(x);
    (kids.get(x)||[]).forEach(k=>q.push(k));
  }
  return seen.size;
}
// A collapsed person can name ONE child whose entire line stays fully
// visible (mainLineChildId) — that child, and everyone descending from
// them, is completely untouched by the fold. Every OTHER child is folded
// away — including the child themselves, not just their own descendants —
// so a collapsed ancestor never leaves a "half-hidden" sibling showing.
function _treeHiddenIds(kids){
  kids=kids||_treeChildrenMap();
  const byId=new Map(familyTree.map(p=>[p.id,p]));
  const hidden=new Set(),q=[];
  familyTree.forEach(p=>{
    if(p.collapsed&&!_treeExpanded.has(p.id)){
      (kids.get(p.id)||[]).forEach(k=>{ if(k!==p.mainLineChildId)q.push(k); });
    }
  });
  while(q.length){
    const id=q.pop();
    if(hidden.has(id))continue;
    const p=byId.get(id);
    if(!p)continue;
    hidden.add(id);
    (kids.get(id)||[]).forEach(k=>q.push(k));
    // A spouse who married in goes with them. One who has their own
    // recorded parents belongs to another documented family and stays
    // visible there.
    (p.spouseIds||[]).forEach(sid=>{
      const s=byId.get(sid);
      if(s&&!(s.parentIds&&s.parentIds.length))q.push(sid);
    });
  }
  return hidden;
}
// How many descendants a collapsed person's card badge should actually
// claim are hidden — same walk as _treeHiddenIds' own queue seed (skips
// the exempted main-line child's whole branch), so the number on the card
// never overstates what tapping it would reveal.
function _treeHiddenDescendantCount(p,kids){
  kids=kids||_treeChildrenMap();
  const seen=new Set();
  const q=(kids.get(p.id)||[]).filter(k=>k!==p.mainLineChildId);
  while(q.length){
    const x=q.pop();
    if(seen.has(x))continue;
    seen.add(x);
    (kids.get(x)||[]).forEach(k=>q.push(k));
  }
  return seen.size;
}
// Opening or closing a sub-tree from its card — view only, nothing saved.
function toggleTreeSubtree(id){
  if(_treeExpanded.has(id))_treeExpanded.delete(id);
  else _treeExpanded.add(id);
  renderFamilyTree();
  _fitTreeWhenReady();
}
// Making someone a sub-tree (or folding their branch back in) — saved.
// Un-collapsing is a direct single click. Collapsing, when this person has
// 2+ children, first asks which child's own line to keep fully visible
// (so a direct ancestor's line is never accidentally folded away along
// with their siblings' branches) — with fewer than 2 children there's
// nothing to choose between, so it collapses everything straight away.
function toggleTreePersonCollapsed(){
  const p=familyTree.find(x=>x.id===_treeActivePersonId);
  if(!p)return;
  if(p.collapsed){
    p.collapsed=false;p.mainLineChildId=null;
    _treeExpanded.delete(p.id);
    save();
    _syncTreeSubtreeBtn(p);
    renderFamilyTree();
    _fitTreeWhenReady();
    showToast('🌳 הצאצאים חזרו לעץ הראשי');
    return;
  }
  const kids=(_treeChildrenMap().get(p.id)||[]);
  if(kids.length>=2){
    openTreeCollapsePickModal(p.id,kids);
    return;
  }
  _collapseTreePerson(p.id,null);
}
let _treeCollapseTargetId=null;
function openTreeCollapsePickModal(personId,kidIds){
  _treeCollapseTargetId=personId;
  const byId=new Map(familyTree.map(x=>[x.id,x]));
  const list=document.getElementById('treeCollapsePickList');
  if(list){
    list.innerHTML=kidIds.map(kid=>{
      const k=byId.get(kid);
      return`<div onclick="_collapseTreePerson(${personId},${kid})" style="display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--border);cursor:pointer">
        <span style="font-size:18px">${k.gender==='boy'?'👦':k.gender==='girl'?'👧':'👤'}</span>
        <span style="font-size:13px;font-weight:600;color:var(--text)">${esc(k.name||'ללא שם')}${k.surname?' '+esc(k.surname):''}</span>
      </div>`;
    }).join('')+`<div onclick="_collapseTreePerson(${personId},null)" style="padding:10px 4px;cursor:pointer;font-size:13px;font-weight:600;color:var(--text2)">🌿 קפל הכל — בלי לשמר אף שושלת</div>`;
  }
  document.getElementById('treeCollapsePickModal').style.display='flex';
}
function closeTreeCollapsePickModal(){
  document.getElementById('treeCollapsePickModal').style.display='none';
  _treeCollapseTargetId=null;
}
function _collapseTreePerson(personId,mainLineChildId){
  const p=familyTree.find(x=>x.id===personId);if(!p)return;
  p.collapsed=true;p.mainLineChildId=mainLineChildId!=null?mainLineChildId:null;
  _treeExpanded.delete(p.id);
  closeTreeCollapsePickModal();
  save();
  _syncTreeSubtreeBtn(p);
  renderFamilyTree();
  _fitTreeWhenReady();
  showToast('🌿 הצאצאים קופלו לתת-עץ');
}
function _syncTreeSubtreeBtn(p){
  const btn=document.getElementById('treeSubtreeBtn');
  if(!btn)return;
  const n=_treeDescendantCount(p.id);
  btn.style.display=n?'block':'none';
  btn.textContent=p.collapsed?`🌳 החזר ${n} צאצאים לעץ הראשי`:`🌿 הפוך לתת-עץ (${n} צאצאים)`;
}

// The families already in the app are treated as siblings of one another —
// each one's own blood relative (see rootSurname below) is seeded as a
// child of one shared placeholder root couple, instead of each family
// being its own disconnected root. Rename that placeholder pair to the
// real grandparents once seeded.
function seedFamilyTreeIfEmpty(){
  if(familyTree.length||!families.length)return;
  familyTree=_buildSeedFamilyTree();
  save();
}
function _buildSeedFamilyTree(){
  const people=[];
  const root1={id:nxtTreePerson++,name:'הורה 1',surname:'',gender:'',parentIds:[],spouseIds:[],sourceFamId:null};
  const root2={id:nxtTreePerson++,name:'הורה 2',surname:'',gender:'',parentIds:[],spouseIds:[root1.id],sourceFamId:null};
  root1.spouseIds.push(root2.id);
  people.push(root1,root2);
  const rootIds=[root1.id,root2.id];
  // A family carrying the app's own surname kept it (a son); any other
  // surname married in from outside (a daughter) — just a starting guess
  // for each family's blood relative's gender, fully editable afterward.
  const rootSurname='שטיינהרט';
  families.forEach(f=>{
    const surname=f.name.replace('משפחת','').trim();
    const bloodGender=surname===rootSurname?'boy':'girl';
    // Tags every person seeded from this family with the same origin id, so
    // the tree can color-code each branch (see col() in renderFamilyTree)
    // and it's visually obvious who belongs to whom even in a wide tree.
    const p1={id:nxtTreePerson++,name:f.emailName||'הורה 1',surname,gender:bloodGender,parentIds:[...rootIds],spouseIds:[],sourceFamId:f.id};
    people.push(p1);
    let parentIds=[p1.id];
    if(!f.parent2Removed){
      const p2={id:nxtTreePerson++,name:f.emailName2||'הורה 2',surname,gender:bloodGender==='boy'?'girl':'boy',parentIds:[],spouseIds:[p1.id],sourceFamId:f.id};
      p1.spouseIds.push(p2.id);
      people.push(p2);
      parentIds=[p1.id,p2.id];
    }
    (f.kids||[]).forEach(k=>{
      if(!k.name)return;
      people.push({id:nxtTreePerson++,name:k.name,surname,gender:k.gender==='boy'||k.gender==='girl'?k.gender:'',parentIds:[...parentIds],spouseIds:[],sourceFamId:f.id});
    });
  });
  // Never leave these undefined (Firestore's setDoc throws on that).
  people.forEach(p=>{p.birthYear='';p.deathYear='';p.deceased=false;p.maidenName='';});
  return people;
}
function openFamilyTreeOverlay(){
  seedFamilyTreeIfEmpty();
  document.getElementById('familyTreeOverlay').style.display='flex';
  // Always open in normal (non-stats) mode with a clean selection.
  _treeStatsMode=false;_treeSel.clear();
  const _sp=document.getElementById('treeStatsPanel');if(_sp)_sp.style.display='none';
  const _sb=document.getElementById('treeStatsBtn');if(_sb){_sb.style.background='var(--surface2)';_sb.style.color='var(--text2)';}
  const wrap0=document.getElementById('treeCanvasWrap');
  if(wrap0){wrap0.scrollTop=0;wrap0.scrollLeft=0;} // known state immediately, before the fit even runs
  renderFamilyTree();
  _fitTreeWhenReady(); // canvas needs a layout pass first for its size to be known
}
function closeFamilyTreeOverlay(){
  document.getElementById('familyTreeOverlay').style.display='none';
}
function renderFamilyTreeIfOpen(){
  const overlay=document.getElementById('familyTreeOverlay');
  if(overlay&&overlay.style.display==='flex')renderFamilyTree();
}
// Zoom is a CSS transform on #treeCanvas — offsetWidth/Height stay the
// untransformed layout size regardless of scale, so "fit to screen" just
// compares that natural size against the scrollable wrapper's viewport.
let _treeZoom=1;
function applyTreeZoom(){
  const c=document.getElementById('treeCanvas');if(c)c.style.transform='scale('+_treeZoom+')';
}
function zoomTree(delta){
  _treeZoom=Math.max(0.2,Math.min(2,Math.round((_treeZoom+delta)*100)/100));
  applyTreeZoom();
}
function fitTreeToScreen(){
  const c=document.getElementById('treeCanvas');if(!c)return;
  // The page is RTL (<html dir="rtl">), where scrollLeft=0 shows the
  // *right* edge of overflowing content in an RTL container — but the
  // tree's own cards use physical left:Xpx starting at x=0. Rather than
  // fight browser-inconsistent RTL scroll-sign conventions, the wrapper
  // itself is forced dir="ltr" (see index.html/admin.html), so scrollLeft=0
  // unambiguously means "leftmost" everywhere.
  const wrap=document.getElementById('treeCanvasWrap')||c.parentElement;
  if(!wrap||!c.offsetWidth||!c.offsetHeight)return;
  const fit=Math.min((wrap.clientWidth-48)/c.offsetWidth,(wrap.clientHeight-48)/c.offsetHeight,1);
  // "⤢ הצג הכל" (show all/fit) should actually show everything — a floor
  // much above what a wide, many-generation tree needs defeats that,
  // forcing an overflow that then needs scrolling to see the rest at all.
  _treeZoom=Math.max(0.05,Math.round(fit*100)/100);
  applyTreeZoom();
  // A tree wide/tall enough that even the 0.15 floor can't shrink it to fit
  // still overflows — pinning scroll to (0,0) then leaves the whole thing
  // looking like it's "over on the right" (or bottom), since only the very
  // left/top sliver is on screen and everything else needs scrolling to
  // reach. Center the initial scroll on the middle of the tree instead, in
  // this same untransformed coordinate space _treeLayout/renderFamilyTree
  // already use (scrollWidth/Height track the layout size, not the scaled-
  // down visual size, so the visible slice at zoom Z is clientWidth/Z wide).
  wrap.scrollLeft=Math.max(0,(c.offsetWidth-wrap.clientWidth/_treeZoom)/2);
  wrap.scrollTop=Math.max(0,(c.offsetHeight-wrap.clientHeight/_treeZoom)/2);
}
// Retries until the canvas has actually been laid out (offsetWidth/Height
// read 0 right after a display:none→flex flip until the browser's next
// layout pass) instead of a fixed delay that can silently miss on a
// slower device, leaving the tree open scrolled to a stale/blank spot.
// Once it succeeds, a couple of rAF follow-ups re-apply the same scroll
// reset in case the browser re-anchors scroll position on a later paint
// (seen on some mobile browsers right after a large layout change).
function _fitTreeWhenReady(attempts){
  attempts=attempts||0;
  const c=document.getElementById('treeCanvas');
  if(c&&c.offsetWidth&&c.offsetHeight){
    fitTreeToScreen();
    requestAnimationFrame(()=>{fitTreeToScreen();requestAnimationFrame(fitTreeToScreen);});
    return;
  }
  if(attempts<20)setTimeout(()=>_fitTreeWhenReady(attempts+1),50);
}
// Assigns each person a generation level via BFS from roots (no parents),
// then aligns spouses to the same (max) level so a married-in partner sits
// beside their spouse's generation rather than off on their own.
function _treeComputeLevels(people){
  const byId=new Map(people.map(p=>[p.id,p]));
  const level={};
  people.forEach(p=>{ if(!(p.parentIds&&p.parentIds.length))level[p.id]=0; });
  let changed=true,guard=0;
  while(changed&&guard<200){
    changed=false;guard++;
    people.forEach(p=>{
      if(level[p.id]!=null)return;
      const pls=(p.parentIds||[]).filter(pid=>byId.has(pid)).map(pid=>level[pid]).filter(l=>l!=null);
      const validParents=(p.parentIds||[]).filter(pid=>byId.has(pid));
      if(validParents.length&&pls.length===validParents.length){level[p.id]=Math.max(...pls)+1;changed=true;}
    });
  }
  people.forEach(p=>{ if(level[p.id]==null)level[p.id]=0; }); // orphaned/cyclic refs fallback
  // A recorded parent must always end up exactly one row above their own
  // child — no matter how many extra generations are recorded on the
  // CHILD's SPOUSE's side. The pass above only computes each person's row
  // from their own blood ancestry in isolation, so this relaxation loop
  // keeps re-applying three rules together until nothing changes anymore:
  // (1) spouses always share the same row, (2) a child sits at least one
  // row below every recorded parent, (3) a recorded parent gets pulled
  // DOWN to exactly one row above their child when the child ended up
  // deeper (pushed down to match a spouse with a longer recorded lineage).
  // Rule 3 cascades through that parent's own recorded parents and spouse
  // on the next round too, so an entire "shallow" side of the family
  // shifts down together, generation by generation, to line up with
  // whatever "deep" side it married into.
  let al=true,g2=0;
  while(al&&g2<300){
    al=false;g2++;
    people.forEach(p=>{
      (p.spouseIds||[]).forEach(sid=>{
        if(!byId.has(sid))return;
        const m=Math.max(level[p.id],level[sid]);
        if(level[p.id]!==m){level[p.id]=m;al=true;}
        if(level[sid]!==m){level[sid]=m;al=true;}
      });
    });
    people.forEach(p=>{
      (p.parentIds||[]).forEach(pid=>{
        if(!byId.has(pid))return;
        const want=level[p.id]-1;
        if(level[pid]<want){level[pid]=want;al=true;}
        else if(level[pid]>want){level[p.id]=level[pid]+1;al=true;}
      });
    });
  }
  // Normalize so the shallowest person sits at row 0 (relaxation can in
  // theory leave everything shifted down if a root ends up deeper than
  // originally computed via the cascade above).
  const minLevel=people.length?Math.min(...people.map(p=>level[p.id])):0;
  if(minLevel!==0)people.forEach(p=>{level[p.id]-=minLevel;});
  return level;
}
// Order-correct, bottom-up tree layout: processes levels from the deepest
// generation up to the roots, one level fully at a time (order, then X
// position, before moving to the level above), so every ancestor row's
// left-right order is always derived from the REAL, already-computed
// positions of the row below it — guaranteeing a parent-cluster's rank
// always matches its children's (rightmost child's parents end up
// rightmost, an adjacent spouse's own parents end up adjacent on the
// correct side, cascading through every generation).
//
// Per level:
//  1. Group units into "clusters" — a true-sibling group (people sharing
//     the exact same recorded parents) is one cluster and keeps its
//     established RTL ("first-registered stays right") order, exactly what
//     moveTreeSibling() controls; everyone else is a singleton cluster.
//  2. Order the level's clusters by the average x of their own children
//     (already placed, since we're going bottom-up), attributing each
//     child to the SPECIFIC parent it descends from (not a blended couple
//     average) so a "double cross-lineage" marriage — both spouses
//     separately recorded as someone's child — still resolves to two
//     distinct, correctly-ordered ancestor lines. Where no real child
//     position exists (the deepest level, or a childless ancestor), a
//     structural fallback rank — computed once, top-down, from each
//     cluster's own parent's rank — is used instead (interpolated against
//     any real-positioned neighbors in the row), so a childless branch
//     still slots in next to the family it actually belongs to.
//  3. Assign X positions honoring that fixed order via isotonic regression
//     (pool-adjacent-violators): each cluster wants to sit centered on its
//     children's average x; where clusters would overlap, they're merged
//     into a block positioned at the average of their desired centers —
//     the least-distorting way to "space the row out so there's room for
//     everyone" while never reordering anything.
function _pava(targets){
  const blocks=[];
  for(let i=0;i<targets.length;i++){
    let b={sum:targets[i],count:1,start:i,end:i,val:targets[i]};
    blocks.push(b);
    while(blocks.length>1&&blocks[blocks.length-2].val>blocks[blocks.length-1].val+1e-9){
      const b2=blocks.pop(),b1=blocks.pop();
      const merged={sum:b1.sum+b2.sum,count:b1.count+b2.count,start:b1.start,end:b2.end};
      merged.val=merged.sum/merged.count;
      blocks.push(merged);
    }
  }
  const out=new Array(targets.length);
  blocks.forEach(b=>{ for(let i=b.start;i<=b.end;i++)out[i]=b.val; });
  return out;
}
function _treePlaceRow(items,widthOf,gapAfterOf,desiredCenterOf){
  const n=items.length;
  const w=items.map(widthOf);
  const off=new Array(n);
  off[0]=0;
  for(let i=1;i<n;i++)off[i]=off[i-1]+w[i-1]+gapAfterOf(i-1);
  const targets=items.map((it,i)=>(desiredCenterOf(it)-w[i]/2)-off[i]);
  const y=_pava(targets);
  return y.map((yi,i)=>yi+off[i]);
}
function _treeLayout(people){
  const byId=new Map(people.map(p=>[p.id,p]));
  const level=_treeComputeLevels(people);
  const maxLevel=people.length?Math.max(...people.map(p=>level[p.id])):0;
  const arrayIndex=new Map(people.map((p,i)=>[p.id,i]));
  const grank=id=>{const g=byId.get(id).gender;return g==='boy'?1:g==='girl'?-1:0;};

  // Build couple units (male right, female left; a lone person with no
  // same-level spouse is a width-1 unit).
  const used=new Set(),unitOf={},units=[];
  people.forEach(p=>{
    if(used.has(p.id))return;
    const spouseId=(p.spouseIds||[]).find(sid=>byId.has(sid)&&level[sid]===level[p.id]&&!used.has(sid));
    let ids=spouseId!=null?[p.id,spouseId]:[p.id];
    if(ids.length===2)ids=ids.slice().sort((a,b)=>grank(a)-grank(b));
    ids.forEach(id=>used.add(id));
    const u={ids,level:level[p.id]};
    units.push(u);
    ids.forEach(id=>unitOf[id]=u);
  });
  // Spouses always stand at the same tight spacing, so a couple always
  // reads as a couple, and every other gap in the row stays standard too.
  const parentUnitOfMember=id=>{
    const p=byId.get(id);
    if(!p.parentIds||!p.parentIds.length)return null;
    for(const pid of p.parentIds){ const pu=unitOf[pid]; if(pu)return pu; }
    return null;
  };
  const uWidth=u=>u.ids.length===2?TREE_NODE_W*2+TREE_COUPLE_GAP:TREE_NODE_W;
  const unitMinIndex=u=>Math.min(...u.ids.map(id=>arrayIndex.get(id)));

  // True-sibling clusters: people sharing the exact recorded parents set
  // keep their established left-right (RTL, first-registered-right) order —
  // the same convention moveTreeSibling() controls. Everyone else (no
  // recorded parents) is their own singleton cluster.
  const childrenByKey=new Map();
  people.forEach(p=>{
    if(!p.parentIds||!p.parentIds.length)return;
    const key=[...p.parentIds].sort((a,b)=>a-b).join(',');
    if(!childrenByKey.has(key))childrenByKey.set(key,[]);
    childrenByKey.get(key).push(p);
  });
  const rowsUnits=[];
  for(let l=0;l<=maxLevel;l++)rowsUnits[l]=units.filter(u=>u.level===l);
  const clusterOfUnit=new Map();
  const clustersByLevel=[];
  for(let l=0;l<=maxLevel;l++){
    const seen=new Set(),clusters=[];
    rowsUnits[l].forEach(u=>{
      if(seen.has(u))return;
      const sibUnitsOf=id=>{
        const p=byId.get(id);
        if(!p.parentIds||!p.parentIds.length)return [];
        const pkey=[...p.parentIds].sort((a,b)=>a-b).join(',');
        return [...new Set((childrenByKey.get(pkey)||[]).map(s=>unitOf[s.id]).filter(su=>su&&su.level===l))];
      };
      // Sorts sibling UNITS by their BLOOD-relative member's own array
      // index (not unitMinIndex, which takes the min of both couple
      // partners) — a married-in spouse's own recorded position in
      // familyTree has nothing to do with where their partner falls among
      // the partner's OWN siblings, and letting it leak in scrambles the
      // sibling order unpredictably depending on unrelated data-entry
      // order. `pkey` is the shared parentIds key these units' blood
      // members all share. RTL: first recorded stays rightmost, so a newly
      // added sibling appears to the LEFT of the ones before it.
      const siblingRtl=(arr,pkey)=>arr.slice().sort((a,b)=>{
        const keyOf=m=>{
          const bloodId=m.ids.find(id=>_treeParentKey(byId.get(id).parentIds)===pkey);
          return arrayIndex.get(bloodId!=null?bloodId:m.ids[0]);
        };
        return keyOf(b)-keyOf(a);
      });
      // Resolve THIS unit's own sibling group (if any) via whichever of its
      // members has recorded parents — entry-point independent, so it
      // resolves to the exact same group and decision regardless of WHICH
      // unit in the group happened to be encountered first while iterating
      // the row (unlike computing this off of "u" alone, which silently
      // changed behavior — and could break the "keep the married sibling's
      // family on their own side" rule entirely — depending on iteration
      // order).
      const bloodMember=u.ids.find(id=>byId.get(id).parentIds&&byId.get(id).parentIds.length);
      let members=[u];
      if(bloodMember!=null){
        const pkey=_treeParentKey(byId.get(bloodMember).parentIds);
        const groupUnits=sibUnitsOf(bloodMember);
        if(groupUnits.length>1){
          // A sibling who married someone from a SEPARATELY recorded
          // family bridges two family lines — landing that spouse between
          // two of the sibling's own blood siblings would make it look
          // like they're siblings too, and drags their own parents across
          // the in-laws' line above. So that one sibling's couple-unit is
          // pinned to whichever edge of the group puts the SPOUSE (not the
          // blood sibling) on the true outer boundary — every other
          // sibling, regardless of their own recorded/birth order relative
          // to the couple, ends up on the married sibling's OWN side.
          // Only handled when exactly one sibling in the group bridges
          // like this — with two or more, no single edge can satisfy both,
          // so the group falls back to plain recorded-order.
          const bridgeUnits=groupUnits.filter(gu=>{
            if(gu.ids.length!==2)return false;
            const gBlood=gu.ids.find(id=>_treeParentKey(byId.get(id).parentIds)===pkey);
            const gSpouse=gu.ids.find(id=>id!==gBlood);
            return parentUnitOfMember(gSpouse)!=null;
          });
          if(bridgeUnits.length===1){
            const bu=bridgeUnits[0];
            const bBlood=bu.ids.find(id=>_treeParentKey(byId.get(id).parentIds)===pkey);
            const bloodOnLeft=bu.ids[0]===bBlood;
            const rest=siblingRtl(groupUnits.filter(gu=>gu!==bu),pkey);
            members=bloodOnLeft?[...rest,bu]:[bu,...rest];
          } else {
            members=siblingRtl(groupUnits,pkey);
          }
        }
      }
      const cluster={members,level:l};
      members.forEach(m=>{ seen.add(m); clusterOfUnit.set(m,cluster); });
      clusters.push(cluster);
    });
    clustersByLevel[l]=clusters;
  }
  const cMinIndex=c=>Math.min(...c.members.map(unitMinIndex));

  // Each cluster's parent UNIT (all members share the exact same recorded
  // parentIds by construction, so any member gives the same answer). null
  // for a cluster with no recorded parents (a true root, or a lone married-
  // in person forming their own unit).
  const parentUnitOfCluster=new Map();
  clustersByLevel.forEach(clusters=>clusters.forEach(c=>{
    let pu=null;
    for(const u of c.members){
      const withParents=u.ids.find(id=>byId.get(id).parentIds&&byId.get(id).parentIds.length);
      if(withParents!=null){
        const pid=byId.get(withParents).parentIds.find(pid=>unitOf[pid]);
        if(pid!=null)pu=unitOf[pid];
        break;
      }
    }
    parentUnitOfCluster.set(c,pu);
  }));

  // Structural fallback rank: a top-down pass (independent of any computed
  // X position) that gives every unit a number reflecting its place in the
  // family hierarchy — its parent's own rank, refined by its RTL order
  // among its own siblings. Used ONLY as an ordering fallback where no
  // positioned-children average is available (most commonly the deepest
  // level), so that a childless cluster still ends up ordered consistently
  // with whichever specific parent/branch it actually descends from,
  // instead of by its own unrelated registration index.
  const FALLBACK_SCALE=1e-6,FALLBACK_BASE=1e9;
  const unitRank=new Map();
  for(let l=0;l<=maxLevel;l++){
    const withKey=clustersByLevel[l].map(c=>{
      const pu=parentUnitOfCluster.get(c);
      const key=(pu!=null&&unitRank.has(pu))?unitRank.get(pu):-cMinIndex(c)*FALLBACK_SCALE-FALLBACK_BASE;
      return {c,key};
    });
    withKey.sort((a,b)=>a.key!==b.key?a.key-b.key:cMinIndex(b.c)-cMinIndex(a.c));
    withKey.forEach(({c},idx)=>{
      const n=c.members.length;
      c.members.forEach((u,i)=>unitRank.set(u,idx+(i+1)/(n+2)));
    });
  }
  const clusterRank=c=>Math.min(...c.members.map(u=>unitRank.get(u)));

  // Direct child PERSONS of each unit, attributed to the SPECIFIC parent
  // they descend from (not the whole unit). This matters when a couple has
  // both spouses separately-recorded as someone's child (a "double cross-
  // lineage" marriage) — each spouse's own ancestor-line must center on
  // that spouse's own x, not the couple's blended average, or both
  // ancestor-lines end up targeting the identical position and their
  // left-right order collapses to an arbitrary tie-break.
  const childPersonsOf=new Map(units.map(u=>[u,new Set()]));
  people.forEach(p=>{
    (p.parentIds||[]).forEach(pid=>{
      const pu=unitOf[pid];
      if(pu)childPersonsOf.get(pu).add(p.id);
    });
  });

  // A unit's fan-out target: among its own recorded children, the ONE (if
  // exactly one) who is married to someone with their own separately-
  // recorded parents. That child's own position anchors this ancestor
  // unit's ordering AND X-target — not the whole sibling span — so an
  // ancestor's own parents don't drift to the wrong side just because that
  // ancestor happens to have siblings too, on top of the bridging marriage.
  const bridgingTargetCx=u=>{
    const kids=[...childPersonsOf.get(u)].filter(cid=>pos[cid]);
    const candidates=kids.filter(cid=>{
      const cu=unitOf[cid];
      if(!cu||cu.ids.length!==2)return false;
      const other=cu.ids.find(id=>id!==cid);
      const op=parentUnitOfMember(other);
      return op&&op!==u&&pos[other];
    });
    if(candidates.length!==1)return null;
    const c=candidates[0],cu=unitOf[c];
    const other=cu.ids.find(id=>id!==c);
    const mid=(pos[c].cx+pos[other].cx)/2;
    return pos[c].cx<pos[other].cx
      ?mid-TREE_FANOUT_GAP/2-uWidth(u)/2
      :mid+TREE_FANOUT_GAP/2+uWidth(u)/2;
  };
  const pos={};
  const placeUnitAt=(u,leftX)=>{
    const step=uWidth(u)-TREE_NODE_W;
    u.ids.forEach((id,i)=>{
      const ix=leftX+i*step;
      pos[id]={x:ix,y:u.level*TREE_LEVEL_H,cx:ix+TREE_NODE_W/2,cy:u.level*TREE_LEVEL_H+TREE_NODE_H/2,bottom:u.level*TREE_LEVEL_H+TREE_NODE_H};
    });
  };

  // Process levels bottom-up: order this row (using the row below's ALREADY
  // KNOWN real positions), then position this row, before moving up.
  for(let l=maxLevel;l>=0;l--){
    const rowClusters=clustersByLevel[l];
    // Center on the SPAN of children (midpoint of min/max x), not their
    // average — matches the original "parent sits centered over its
    // children" convention: with one child, min===max, so the parent lands
    // exactly centered on that one child; with several, the parent centers
    // on their overall spread rather than being pulled toward wherever more
    // of them happen to cluster.
    const childCxAvg=c=>{
      const xs=[];
      c.members.forEach(u=>{
        const bt=bridgingTargetCx(u);
        if(bt!=null){ xs.push(bt); return; }
        childPersonsOf.get(u).forEach(cid=>{ if(pos[cid])xs.push(pos[cid].cx); });
      });
      return xs.length?(Math.min(...xs)+Math.max(...xs))/2:null;
    };
    // Structural (hierarchy-only) order — always well-defined, used as a
    // baseline and as the source of a "virtual" desired position for any
    // cluster that has no real descendant position to go on (this row is
    // the deepest level, or this particular cluster has no recorded kids).
    // A childless cluster's virtual position is interpolated between the
    // nearest structurally-neighboring clusters that DO have a real one, so
    // it slots in among its siblings/cousins rather than being shoved to
    // one edge of the row by an arbitrary large constant.
    const structOrder=rowClusters.slice().sort((a,b)=>clusterRank(a)-clusterRank(b));
    const avgOf=new Map(rowClusters.map(c=>[c,childCxAvg(c)]));
    const virtual=new Map();
    structOrder.forEach(c=>{ if(avgOf.get(c)!=null)virtual.set(c,avgOf.get(c)); });
    let vi=0;
    while(vi<structOrder.length){
      if(virtual.has(structOrder[vi])){ vi++; continue; }
      let vj=vi;
      while(vj<structOrder.length&&!virtual.has(structOrder[vj]))vj++;
      const leftVal=vi>0?virtual.get(structOrder[vi-1]):null;
      const rightVal=vj<structOrder.length?virtual.get(structOrder[vj]):null;
      for(let k=vi;k<vj;k++){
        let v;
        if(leftVal!=null&&rightVal!=null)v=leftVal+(rightVal-leftVal)*((k-vi+1)/(vj-vi+1));
        else if(leftVal!=null)v=leftVal;
        else if(rightVal!=null)v=rightVal;
        else v=clusterRank(structOrder[k]);
        virtual.set(structOrder[k],v);
      }
      vi=vj;
    }
    const ordered=rowClusters.slice().sort((a,b)=>{
      const av=virtual.get(a),bv=virtual.get(b);
      if(av!==bv)return av-bv;
      return clusterRank(a)-clusterRank(b);
    });

    // Cluster order only decides SEQUENCE — actual X placement happens per
    // UNIT, each centered on its OWN attributed children, not the whole
    // sibling group's combined span. Without this, a multi-member cluster
    // (several full siblings) was centered as one block and its members
    // then laid out sequentially inside that block, completely disconnected
    // from where each individual sibling's own kids ended up — exactly the
    // "parent not above its own children" bug this fixes.
    const flatUnits=ordered.flatMap(c=>c.members);
    const clusterOfFlatUnit=new Map();
    ordered.forEach(c=>c.members.forEach(u=>clusterOfFlatUnit.set(u,c)));
    const unitChildCx=u=>{
      const kids=[...childPersonsOf.get(u)].filter(cid=>pos[cid]);
      if(!kids.length)return null;
      // When one of this unit's children married someone whose OWN parents
      // are also recorded, both parent couples want the very same spot —
      // right above two spouses standing side by side — and they can't
      // both have it. Instead of pulling those spouses apart (which stops
      // them from reading as a couple), fan the two parent couples out to
      // either side of the couple's midpoint. Each stays on its own
      // child's side, so their connecting lines still never reach across
      // each other — even when that child has siblings of their own too.
      const bt=bridgingTargetCx(u);
      if(bt!=null)return bt;
      const xs=kids.map(cid=>pos[cid].cx);
      return (Math.min(...xs)+Math.max(...xs))/2;
    };
    const unitAvgOf=new Map(flatUnits.map(u=>[u,unitChildCx(u)]));
    const unitVirtual=new Map();
    flatUnits.forEach(u=>{ if(unitAvgOf.get(u)!=null)unitVirtual.set(u,unitAvgOf.get(u)); });
    let ui=0;
    while(ui<flatUnits.length){
      if(unitVirtual.has(flatUnits[ui])){ ui++; continue; }
      let uj=ui;
      while(uj<flatUnits.length&&!unitVirtual.has(flatUnits[uj]))uj++;
      const leftVal=ui>0?unitVirtual.get(flatUnits[ui-1]):null;
      const rightVal=uj<flatUnits.length?unitVirtual.get(flatUnits[uj]):null;
      for(let k=ui;k<uj;k++){
        let v;
        if(leftVal!=null&&rightVal!=null)v=leftVal+(rightVal-leftVal)*((k-ui+1)/(uj-ui+1));
        else if(leftVal!=null)v=leftVal;
        else if(rightVal!=null)v=rightVal;
        else v=unitRank.get(flatUnits[k]);
        unitVirtual.set(flatUnits[k],v);
      }
      ui=uj;
    }
    const desiredByUnit=new Map(flatUnits.map(u=>[u,unitAvgOf.get(u)!=null?unitAvgOf.get(u):unitVirtual.get(u)]));
    // Normal spacing everywhere: spouses stay tight, siblings and unrelated
    // couples keep the standard gap. The only place extra room is added is
    // between two parent couples splitting around a married couple — see
    // TREE_FANOUT_GAP in unitChildCx above.
    const gapAfter=i=>(clusterOfFlatUnit.get(flatUnits[i])===clusterOfFlatUnit.get(flatUnits[i+1]))?TREE_COUPLE_GAP:TREE_H_GAP;
    const leftEdges=_treePlaceRow(flatUnits,uWidth,gapAfter,u=>desiredByUnit.get(u));
    flatUnits.forEach((u,i)=>placeUnitAt(u,leftEdges[i]));
  }

  // Top-down pass over the ancestry. Along a line of ancestry a couple sits
  // midway between the husband's parents and the wife's parents — or, where
  // only one side is recorded, that one child sits directly under their
  // parents — so the generation above always has room laid out side by
  // side. The row is then re-fitted with the same isotonic placement used
  // above, which makes room for those targets by spreading the row rather
  // than giving up when a neighbour is in the way; it never reorders.
  //
  // Only units on a single-child line of ancestry get a target. A couple
  // with several children of its own must stay centred on those children
  // instead, and siblings must stay spread as a group under their shared
  // parents rather than each piling onto the same spot — everyone else
  // simply keeps their current position and is pushed aside only if the
  // targets above genuinely need the room.
  const unitLeftX=u=>Math.min(...u.ids.map(id=>pos[id].x));
  const unitCenterX=u=>{const xs=u.ids.map(id=>pos[id].cx);return (Math.min(...xs)+Math.max(...xs))/2;};
  const kidUnitsOf=u=>{
    const ks=new Set();
    childPersonsOf.get(u).forEach(cid=>{ const ku=unitOf[cid]; if(ku)ks.add(ku); });
    return ks;
  };
  for(let l=1;l<=maxLevel;l++){
    const row=units.filter(u=>u.level===l&&u.ids.every(id=>pos[id])).sort((a,b)=>unitLeftX(a)-unitLeftX(b));
    if(!row.length)continue;
    const desired=row.map(u=>{
      const links=u.ids.map(id=>({id,pu:parentUnitOfMember(id)}))
        .filter(k=>k.pu&&k.pu!==u&&k.pu.ids.every(id=>pos[id]));
      const parents=[...new Set(links.map(k=>k.pu))];
      if(!parents.length)return unitCenterX(u);
      // Exactly one child: that's a link in a line of ancestry. Several
      // children means this couple must stay centred on them instead, and
      // NO children means a leaf, which belongs to its sibling group's own
      // layout rather than being pulled out of it.
      if(kidUnitsOf(u).size!==1)return unitCenterX(u);
      if(!parents.every(pu=>kidUnitsOf(pu).size<=1))return unitCenterX(u);
      if(parents.length>1){
        const cs=parents.map(unitCenterX);
        return (Math.min(...cs)+Math.max(...cs))/2;
      }
      // One side only: aim that child under their parents, which means
      // offsetting the couple by however far the child sits from its middle.
      return unitCenterX(parents[0])+(unitCenterX(u)-pos[links[0].id].cx);
    });
    const want=new Map(row.map((u,i)=>[u,desired[i]]));
    // Same minimum gaps as the original placement — siblings at the tight
    // couple gap, everyone else at the standard one — so re-fitting a row
    // that has no targets in it leaves that row exactly as it was.
    const rowGap=i=>(clusterOfUnit.get(row[i])===clusterOfUnit.get(row[i+1]))?TREE_COUPLE_GAP:TREE_H_GAP;
    const edges=_treePlaceRow(row,uWidth,rowGap,u=>want.get(u));
    row.forEach((u,i)=>{
      const delta=edges[i]-unitLeftX(u);
      if(Math.abs(delta)<0.01)return;
      u.ids.forEach(id=>{ pos[id].x+=delta; pos[id].cx+=delta; });
    });
  }

  // Shift everything into positive space.
  const allX=Object.values(pos).map(pp=>pp.x);
  const minX=allX.length?Math.min(...allX):0;
  if(minX<0)Object.values(pos).forEach(pp=>{pp.x-=minX;pp.cx-=minX;});

  const claimedBy={};
  people.forEach(p=>{ if(p.parentIds&&p.parentIds.length)claimedBy[p.id]=[...p.parentIds].sort((a,b)=>a-b).join(','); });

  return {pos,maxLevel,claimedBy};
}
function renderFamilyTree(){
  const canvas=document.getElementById('treeCanvas');if(!canvas)return;
  // Anyone folded away inside a sub-tree is left out of the layout
  // entirely, so the main tree is drawn as if that branch weren't there.
  const _kidsMap=_treeChildrenMap();
  const _hidden=_treeHiddenIds(_kidsMap);
  const people=_hidden.size?familyTree.filter(p=>!_hidden.has(p.id)):familyTree;
  if(!people.length){
    canvas.style.width='';canvas.style.height='';
    canvas.innerHTML='<div class="empty" style="padding:40px 0"><span class="empty-ico">🌳</span>אין עדיין אנשים בעץ. לחצו על "+ הוסף אדם" כדי להתחיל.</div>';
    return;
  }
  const {pos,maxLevel,claimedBy}=_treeLayout(people);
  const maxX=Math.max(...Object.values(pos).map(p=>p.x+TREE_NODE_W))+20;
  const totalH=(maxLevel+1)*TREE_LEVEL_H+20;
  let svgLines='';
  const drawnPairs=new Set();
  people.forEach(p=>{
    (p.spouseIds||[]).forEach(sid=>{
      const key=[p.id,sid].sort((a,b)=>a-b).join('-');
      if(drawnPairs.has(key)||!pos[sid])return;
      drawnPairs.add(key);
      const a=pos[p.id],b=pos[sid];
      // Dashed + lighter, on purpose: a marriage link needs to read as
      // visually distinct from the solid parent→child lineage lines below,
      // otherwise a spouse sitting right next to their partner's siblings
      // reads as if the bus line above connects them too (as if they were
      // a sibling themselves rather than someone who married in).
      svgLines+=`<line x1="${a.cx}" y1="${a.cy}" x2="${b.cx}" y2="${b.cy}" stroke="var(--text3)" stroke-width="1.5" stroke-dasharray="4,3"/>`;
    });
  });
  // Group children sharing the exact same parent set so siblings share one
  // drop line + bus instead of a tangle of separate lines.
  const groups=new Map();
  people.forEach(p=>{
    if(!p.parentIds||!p.parentIds.length)return;
    const key=[...p.parentIds].sort((a,b)=>a-b).join(',');
    if(!groups.has(key))groups.set(key,{parentIds:p.parentIds,kids:[]});
    groups.get(key).kids.push(p.id);
  });
  const farConnections=[]; // collected first so overlapping ones can be staggered below
  groups.forEach((g,key)=>{
    const parentPoints=g.parentIds.map(pid=>pos[pid]).filter(Boolean);
    if(!parentPoints.length)return;
    const dropX=parentPoints.reduce((s,pp)=>s+pp.cx,0)/parentPoints.length;
    const dropY=Math.max(...parentPoints.map(pp=>pp.bottom));
    // Halfway through the actual empty gap between a parent's bottom edge
    // and the next row's top edge — NOT half of TREE_LEVEL_H (which already
    // includes the card's own height), otherwise the bus lands exactly on
    // the children's top edge with zero visible drop into their card.
    const busY=dropY+(TREE_LEVEL_H-TREE_NODE_H)/2;
    // _treeLayout only credits a kid to the parent-unit that actually won
    // the race to position them (claimedBy) — a kid whose spouse also has
    // their own recorded parents can get positioned under THAT branch
    // instead (see _treeLayout's claimedBy), so this group's own
    // line to them has to reach across rather than join the normal bus.
    // A single-recorded-parent kid's own key ("116") is a strict subset of
    // the couple unit that actually claimed them ("116,117" once the other
    // parent's spouse joined) — compare by containment, not exact match,
    // or they'd wrongly count as "far" even though _treeLayout folded them
    // in as a normal local child of that same couple.
    const isLocal=kid=>{
      if(!claimedBy[kid])return false;
      const claimedIds=claimedBy[kid].split(',').map(Number);
      return g.parentIds.every(pid=>claimedIds.includes(pid));
    };
    const localKids=g.kids.filter(kid=>pos[kid]&&isLocal(kid));
    const farKids=g.kids.filter(kid=>pos[kid]&&!isLocal(kid));
    if(localKids.length){
      const kidXs=localKids.map(kid=>pos[kid].cx);
      svgLines+=`<line x1="${dropX}" y1="${dropY}" x2="${dropX}" y2="${busY}" stroke="var(--text2)" stroke-width="2.5"/>`;
      const minX=Math.min(dropX,...kidXs),maxXk=Math.max(dropX,...kidXs);
      svgLines+=`<line x1="${minX}" y1="${busY}" x2="${maxXk}" y2="${busY}" stroke="var(--text2)" stroke-width="2.5"/>`;
      localKids.forEach(kid=>{
        const kp=pos[kid];
        svgLines+=`<line x1="${kp.cx}" y1="${busY}" x2="${kp.cx}" y2="${kp.y}" stroke="var(--text2)" stroke-width="2.5"/>`;
      });
    }
    farKids.forEach(kid=>{
      const kp=pos[kid];
      farConnections.push({dropX,dropY,kx:kp.cx,ky:kp.y});
    });
  });
  // Draw each "married in from a separately-tracked family" connector as a
  // normal right-angle drop (matching the rest of the tree) instead of a
  // diagonal — but stagger the horizontal segment's height per connection
  // sharing the same source level, so two of these reaching across the
  // tree never sit at the exact same height and read as one merged bus.
  const farByLevel=new Map();
  farConnections.forEach(c=>{
    if(!farByLevel.has(c.dropY))farByLevel.set(c.dropY,[]);
    farByLevel.get(c.dropY).push(c);
  });
  farByLevel.forEach(list=>{
    list.forEach((c,i)=>{
      const frac=Math.min(0.3+i*0.3,0.85);
      const busY=c.dropY+(c.ky-c.dropY)*frac;
      svgLines+=`<line x1="${c.dropX}" y1="${c.dropY}" x2="${c.dropX}" y2="${busY}" stroke="var(--text2)" stroke-width="2.5"/>`;
      svgLines+=`<line x1="${c.dropX}" y1="${busY}" x2="${c.kx}" y2="${busY}" stroke="var(--text2)" stroke-width="2.5"/>`;
      svgLines+=`<line x1="${c.kx}" y1="${busY}" x2="${c.kx}" y2="${c.ky}" stroke="var(--text2)" stroke-width="2.5"/>`;
    });
  });
  const cards=people.map(p=>{
    const pp=pos[p.id];if(!pp)return'';
    // Gender-coded border (teal/rose), matching the standard genealogy-site
    // convention — a small bottom accent still shows the original seeded
    // family branch (sourceFamId) when known, without competing with it.
    const genderColor=p.gender==='boy'?'#2a9d8f':p.gender==='girl'?'#e56399':'var(--border)';
    const branchColor=p.sourceFamId!=null?col(p.sourceFamId).c:null;
    const borderStyle=`border:1.5px solid ${genderColor}`+(branchColor?`;border-bottom:3px solid ${branchColor}`:'');
    const avatarBg=p.gender==='boy'?'#e8f4f3':p.gender==='girl'?'#fbe9f0':'var(--surface2)';
    const avatarFg=p.gender==='boy'?'#2a9d8f':p.gender==='girl'?'#e56399':'var(--text2)';
    const deceased=p.deceased?`<span style="position:absolute;top:2px;left:2px;font-size:9px">🕯️</span>`:'';
    const years=(p.birthYear||p.deathYear)?`<span style="font-size:8px;color:var(--text2)">${esc(p.birthYear||'')}${p.deceased||p.deathYear?'–'+esc(p.deathYear||''):''}</span>`:'';
    // A small "+" below the card is a quick, always-visible shortcut straight
    // into this person's add-relation options (parent/sibling/child) —
    // discoverable without opening the full person card first (matches the
    // reference site's per-card "+" convention).
    const plusBtn=`<div onclick="event.stopPropagation();openTreeQuickAddMenu(${p.id})" title="הוסף קרוב" style="position:absolute;left:${pp.cx-9}px;top:${pp.bottom+3}px;width:18px;height:18px;border-radius:50%;background:var(--blue-mid);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;line-height:1;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.3);z-index:2">+</div>`;
    // Draggable so two same-parent siblings can swap left-right order by
    // dropping one card onto another — deliberately just a swap (not free
    // positioning), so the layout stays deterministic and never overlaps.
    // A person marked as a sub-tree gets a badge showing how many
    // descendants are folded away behind them; tapping it opens or closes
    // that branch just for this session.
    const _sub=p.collapsed?_treeHiddenDescendantCount(p,_kidsMap):0;
    const _open=_treeExpanded.has(p.id);
    const subBtn=(_sub&&!_treeStatsMode)?`<div onclick="event.stopPropagation();toggleTreeSubtree(${p.id})" title="${_open?'סגור את תת-העץ':'פתח את תת-העץ'}" style="position:absolute;left:${pp.cx+13}px;top:${pp.bottom+3}px;height:18px;min-width:18px;padding:0 5px;border-radius:9px;background:${_open?'var(--text2)':'#2a9d8f'};color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;line-height:1;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.3);z-index:2">${_open?'−':'+'+_sub}</div>`:'';
    // Statistics selection mode: a tap picks/unpicks the card (see
    // treeCardClick) instead of opening it; the "+"/sub-tree buttons and
    // drag are suppressed so the tree reads as a pick list. Chosen cards get
    // a blue ring + ✓ badge, the rest dim so the selection stands out.
    const _sel=_treeStatsMode&&_treeSel.has(p.id);
    const _dim=_treeStatsMode&&!_sel;
    const selRing=_sel?';box-shadow:0 0 0 3px var(--blue-mid),0 2px 6px rgba(0,0,0,0.08);border-color:var(--blue-mid)':'';
    const selBadge=_sel?`<span style="position:absolute;top:2px;right:2px;width:16px;height:16px;border-radius:50%;background:var(--blue-mid);color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;line-height:1">✓</span>`:'';
    const dragAttrs=_treeStatsMode?'':` draggable="true" ondragstart="treeCardDragStart(event,${p.id})" ondragend="treeCardDragEnd(event)" ondragover="treeCardDragOver(event)" ondragleave="treeCardDragLeave(event)" ondrop="treeCardDrop(event,${p.id})"`;
    return`<div onclick="treeCardClick(${p.id})"${dragAttrs} style="position:absolute;left:${pp.x}px;top:${pp.y}px;width:${TREE_NODE_W}px;height:${TREE_NODE_H}px;background:var(--surface);${borderStyle}${selRing};border-radius:var(--r2);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.08);padding:4px;box-sizing:border-box;text-align:center;gap:1px${_dim?';opacity:0.45':''}">
      ${deceased}${selBadge}
      <span style="width:24px;height:24px;border-radius:50%;background:${avatarBg};display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">
        ${p.photo?`<img src="${p.photo}" style="width:100%;height:100%;object-fit:cover">`:`<svg width="14" height="14" viewBox="0 0 24 24" fill="${avatarFg}"><circle cx="12" cy="8" r="4"/><path d="M12 14c-5 0-8 2.5-8 6v1h16v-1c0-3.5-3-6-8-6z"/></svg>`}
      </span>
      <span style="font-size:11px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">${esc(p.name||'ללא שם')}</span>
      ${p.gender==='girl'&&p.maidenName?`<span style="font-size:8px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">(לבית ${esc(p.maidenName)})</span>`:''}
      ${p.surname?`<span style="font-size:9px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">${esc(p.surname)}</span>`:''}
      ${years}
    </div>${_treeStatsMode?'':plusBtn}${subBtn}`;
  }).join('');
  canvas.style.width=maxX+'px';
  canvas.style.height=totalH+'px';
  canvas.innerHTML=`<svg width="${maxX}" height="${totalH}" style="position:absolute;top:0;left:0;pointer-events:none">${svgLines}</svg>${cards}`;
  applyTreeZoom();
}
// ── Family-tree statistics ──────────────────────────────────────────────
// A read-only selection overlay: in stats mode a card tap picks/unpicks the
// person (optionally their whole branch) instead of opening them, and a
// bottom sheet shows live figures — gender split, living/deceased, common
// first names and surnames, birth-year and age ranges — for the selection,
// or for the whole visible tree when nothing is picked. Nothing is saved.
let _treeStatsMode=false,_treeSelBranch=false;
let _treeSel=new Set();
let _treeLasso=null; // {x0,y0,x1,y1} in unscaled canvas coords while dragging
function toggleTreeStatsMode(){
  _treeStatsMode=!_treeStatsMode;
  if(!_treeStatsMode){_treeSel.clear();_treeLassoCancel();}
  _ensureTreeStatsUI();
  _initTreeLasso();
  const panel=document.getElementById('treeStatsPanel');
  if(panel)panel.style.display=_treeStatsMode?'flex':'none';
  const btn=document.getElementById('treeStatsBtn');
  if(btn){btn.style.background=_treeStatsMode?'var(--blue-mid)':'var(--surface2)';btn.style.color=_treeStatsMode?'#fff':'var(--text2)';}
  renderFamilyTree();
  if(_treeStatsMode)renderTreeStats();
}
// A card tap: pick/unpick in stats mode (whole branch when that toggle is
// on), otherwise the normal "open this person" action.
function treeCardClick(id){
  if(!_treeStatsMode){openTreePersonModal(id);return;}
  const ids=_treeSelBranch?[id,..._treeBranchIds(id)]:[id];
  const turnOn=!_treeSel.has(id);
  ids.forEach(x=>{ if(turnOn)_treeSel.add(x); else _treeSel.delete(x); });
  renderFamilyTree();
  renderTreeStats();
}
function _treeBranchIds(id){
  const kids=_treeChildrenMap();
  const out=new Set(),q=[...(kids.get(id)||[])];
  while(q.length){const x=q.pop();if(out.has(x))continue;out.add(x);(kids.get(x)||[]).forEach(k=>q.push(k));}
  return [...out];
}
// People currently drawn in the tree (anyone folded into a sub-tree is left
// out, matching what renderFamilyTree shows).
function _treeVisiblePeople(){
  const kids=_treeChildrenMap();
  const hidden=_treeHiddenIds(kids);
  return hidden.size?familyTree.filter(p=>!hidden.has(p.id)):familyTree;
}
function treeStatsSelectAll(){_treeVisiblePeople().forEach(p=>_treeSel.add(p.id));renderFamilyTree();renderTreeStats();}
function treeStatsClear(){_treeSel.clear();renderFamilyTree();renderTreeStats();}
function toggleTreeSelBranch(){
  _treeSelBranch=!_treeSelBranch;
  const b=document.getElementById('treeSelBranchChk');
  if(b){b.style.background=_treeSelBranch?'var(--blue-mid)':'transparent';b.style.color=_treeSelBranch?'#fff':'var(--text2)';b.style.borderColor=_treeSelBranch?'var(--blue-mid)':'var(--border)';}
}
// Drag-to-select ("lasso"): in stats mode, pressing on empty canvas space and
// dragging draws a rectangle; every card it touches is ADDED to the selection
// on release. Uses pointer events so a mouse drag (desktop) and a finger drag
// (mobile) both work; a press that lands on a card is left to the card's own
// tap handler (single pick). Listeners attach once to the scroll wrapper and
// no-op whenever stats mode is off.
function _initTreeLasso(){
  const wrap=document.getElementById('treeCanvasWrap');
  const canvas=document.getElementById('treeCanvas');
  if(!wrap||!canvas||wrap._lassoInit)return;
  wrap._lassoInit=true;
  const toCanvas=(cx,cy)=>{const r=canvas.getBoundingClientRect();return {x:(cx-r.left)/_treeZoom,y:(cy-r.top)/_treeZoom};};
  const onEmpty=t=>t===canvas||t===wrap||t.tagName==='svg'||t.tagName==='line';
  wrap.addEventListener('pointerdown',e=>{
    if(!_treeStatsMode||!onEmpty(e.target))return;
    const p=toCanvas(e.clientX,e.clientY);
    _treeLasso={x0:p.x,y0:p.y,x1:p.x,y1:p.y};
    let box=document.getElementById('treeLassoBox');
    if(!box){box=document.createElement('div');box.id='treeLassoBox';box.style.cssText='position:absolute;border:1.5px solid var(--blue-mid);background:rgba(12,68,124,0.12);border-radius:4px;z-index:3;pointer-events:none';canvas.appendChild(box);}
    box.style.display='block';_updateLassoBox();
    try{wrap.setPointerCapture(e.pointerId);}catch(_){}
    e.preventDefault();
  });
  wrap.addEventListener('pointermove',e=>{
    if(!_treeLasso)return;
    const p=toCanvas(e.clientX,e.clientY);
    _treeLasso.x1=p.x;_treeLasso.y1=p.y;_updateLassoBox();
    e.preventDefault();
  });
  const finish=()=>{
    if(!_treeLasso)return;
    const L=_treeLasso;_treeLasso=null;
    const box=document.getElementById('treeLassoBox');if(box)box.style.display='none';
    const minX=Math.min(L.x0,L.x1),maxX=Math.max(L.x0,L.x1),minY=Math.min(L.y0,L.y1),maxY=Math.max(L.y0,L.y1);
    if(maxX-minX<6&&maxY-minY<6)return; // a tap, not a drag
    // Re-run the (deterministic) layout to know where each card sits, then
    // add every card the rectangle overlaps to the selection.
    const people=_treeVisiblePeople();
    const {pos}=_treeLayout(people);
    people.forEach(p=>{
      const q=pos[p.id];if(!q)return;
      if(q.x<maxX&&q.x+TREE_NODE_W>minX&&q.y<maxY&&q.y+TREE_NODE_H>minY)_treeSel.add(p.id);
    });
    renderFamilyTree();renderTreeStats();
  };
  wrap.addEventListener('pointerup',finish);
  wrap.addEventListener('pointercancel',finish);
}
function _updateLassoBox(){
  const box=document.getElementById('treeLassoBox');if(!box||!_treeLasso)return;
  const L=_treeLasso;
  box.style.left=Math.min(L.x0,L.x1)+'px';box.style.top=Math.min(L.y0,L.y1)+'px';
  box.style.width=Math.abs(L.x1-L.x0)+'px';box.style.height=Math.abs(L.y1-L.y0)+'px';
}
function _treeLassoCancel(){
  _treeLasso=null;
  const box=document.getElementById('treeLassoBox');if(box)box.style.display='none';
}
// Build the floating stats window once and hang it inside the tree overlay,
// so neither index.html nor admin.html needs to carry the markup. It's a
// draggable pop-up (grab its title bar) rather than a fixed sheet, so it can
// be moved aside to keep the tree visible while picking people.
function _ensureTreeStatsUI(){
  const overlay=document.getElementById('familyTreeOverlay');
  if(!overlay||document.getElementById('treeStatsPanel'))return;
  const panel=document.createElement('div');
  panel.id='treeStatsPanel';
  panel.style.cssText='display:none;position:absolute;top:72px;right:14px;width:320px;max-width:calc(100% - 28px);max-height:78vh;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 10px 34px rgba(0,0,0,0.28);z-index:6;overflow:hidden';
  panel.innerHTML=
    '<div id="treeStatsHeader" style="padding:11px 14px 10px;border-bottom:1px solid var(--border);flex-shrink:0;cursor:move;touch-action:none;user-select:none;background:var(--surface2)">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px">'
    +'<span style="font-size:15px;font-weight:800;color:var(--text)">⠿ 📊 סטטיסטיקות</span>'
    +'<button onclick="toggleTreeStatsMode()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text2);line-height:1;padding:0">✕</button>'
    +'</div>'
    +'<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">'
    +'<button onclick="treeStatsSelectAll()" style="padding:6px 12px;border-radius:20px;border:none;background:var(--blue-mid);color:#fff;font-size:12px;font-weight:700;font-family:var(--font);cursor:pointer">בחר הכל</button>'
    +'<button onclick="treeStatsClear()" style="padding:6px 12px;border-radius:20px;border:1.5px solid var(--border);background:transparent;color:var(--text2);font-size:12px;font-weight:700;font-family:var(--font);cursor:pointer">נקה</button>'
    +'<button id="treeSelBranchChk" onclick="toggleTreeSelBranch()" title="בחירת אדם תסמן גם את כל צאצאיו" style="padding:6px 12px;border-radius:20px;border:1.5px solid var(--border);background:transparent;color:var(--text2);font-size:12px;font-weight:700;font-family:var(--font);cursor:pointer">👇 כולל צאצאים</button>'
    +'<span id="treeStatsCount" style="margin-inline-start:auto;font-size:12px;font-weight:700;color:var(--text2)"></span>'
    +'</div>'
    +'<div style="font-size:11px;color:var(--text3);margin-top:7px">💡 גררו על רקע ריק לבחירת כמה יחד · גררו את הכותרת כדי להזיז את החלון</div>'
    +'</div>'
    +'<div id="treeStatsBody" style="padding:12px 16px 18px;overflow-y:auto;flex:1;min-height:0"></div>';
  overlay.appendChild(panel);
  _initTreeStatsDrag(panel,panel.querySelector('#treeStatsHeader'));
}
// Make the stats pop-up draggable by its title bar, kept inside the overlay.
function _initTreeStatsDrag(panel,handle){
  if(!panel||!handle)return;
  const overlay=document.getElementById('familyTreeOverlay');
  let dragging=false,sx=0,sy=0,ox=0,oy=0;
  handle.addEventListener('pointerdown',e=>{
    if(e.target.closest('button'))return; // ✕ and the action pills aren't drag grips
    const pr=panel.getBoundingClientRect(),orc=overlay.getBoundingClientRect();
    ox=pr.left-orc.left;oy=pr.top-orc.top;sx=e.clientX;sy=e.clientY;dragging=true;
    // Switch from the initial right/top anchor to explicit left/top so moving is smooth.
    panel.style.left=ox+'px';panel.style.top=oy+'px';panel.style.right='auto';panel.style.bottom='auto';
    try{handle.setPointerCapture(e.pointerId);}catch(_){}
    e.preventDefault();
  });
  handle.addEventListener('pointermove',e=>{
    if(!dragging)return;
    const orc=overlay.getBoundingClientRect();
    let nx=ox+(e.clientX-sx),ny=oy+(e.clientY-sy);
    nx=Math.max(0,Math.min(nx,orc.width-panel.offsetWidth));
    ny=Math.max(0,Math.min(ny,orc.height-panel.offsetHeight));
    panel.style.left=nx+'px';panel.style.top=ny+'px';
    e.preventDefault();
  });
  const end=()=>{dragging=false;};
  handle.addEventListener('pointerup',end);
  handle.addEventListener('pointercancel',end);
}
function _treeStats(people){
  const nowY=new Date().getFullYear();
  let male=0,female=0,other=0,living=0,deceased=0;
  const firstNames={},surnames={},birthYears=[],ages=[];
  people.forEach(p=>{
    if(p.gender==='boy')male++;else if(p.gender==='girl')female++;else other++;
    if(p.deceased)deceased++;else living++;
    const fn=(p.name||'').trim();if(fn){const k=fn.split(/\s+/)[0];firstNames[k]=(firstNames[k]||0)+1;}
    const sn=(p.surname||'').trim();if(sn)surnames[sn]=(surnames[sn]||0)+1;
    const by=parseInt(p.birthYear,10);
    if(!isNaN(by)&&by>1000&&by<=nowY){
      birthYears.push(by);
      const end=p.deceased?(parseInt(p.deathYear,10)||nowY):nowY;
      const age=end-by;if(age>=0&&age<130)ages.push(age);
    }
  });
  const top=o=>Object.entries(o).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'he')).slice(0,5);
  const sum=a=>a.reduce((x,y)=>x+y,0);
  // Detailed age breakdown into life-stage brackets (only those with a birth
  // year are counted). Non-overlapping ranges, youngest first.
  const AGE_BRACKETS=[[0,2,'0–2'],[3,5,'3–5'],[6,12,'6–12'],[13,18,'13–18'],[19,25,'19–25'],[26,40,'26–40'],[41,60,'41–60'],[61,80,'61–80'],[81,999,'81+']];
  const ageBuckets=AGE_BRACKETS.map(b=>({label:b[2],count:0}));
  ages.forEach(a=>{ for(let i=0;i<AGE_BRACKETS.length;i++){ if(a>=AGE_BRACKETS[i][0]&&a<=AGE_BRACKETS[i][1]){ageBuckets[i].count++;break;} } });
  return {n:people.length,male,female,other,living,deceased,
    topNames:top(firstNames),topSurnames:top(surnames),
    minBirth:birthYears.length?Math.min(...birthYears):null,
    maxBirth:birthYears.length?Math.max(...birthYears):null,withBirth:birthYears.length,
    minAge:ages.length?Math.min(...ages):null,maxAge:ages.length?Math.max(...ages):null,
    avgAge:ages.length?Math.round(sum(ages)/ages.length):null,withAge:ages.length,ageBuckets};
}
function renderTreeStats(){
  const body=document.getElementById('treeStatsBody');if(!body)return;
  const all=_treeVisiblePeople();
  const sel=all.filter(p=>_treeSel.has(p.id));
  const useAll=sel.length===0;
  const people=useAll?all:sel;
  const cnt=document.getElementById('treeStatsCount');
  if(cnt)cnt.textContent=useAll?`כל העץ · ${all.length} אנשים`:`נבחרו ${sel.length}`;
  if(!people.length){body.innerHTML='<div style="text-align:center;color:var(--text2);font-size:13px;padding:24px 0">אין אנשים בעץ.</div>';return;}
  const s=_treeStats(people);
  const tile=(label,val,sub)=>`<div style="flex:1;min-width:82px;background:var(--surface2);border-radius:var(--r2);padding:10px 8px;text-align:center"><div style="font-size:22px;font-weight:800;color:var(--text);line-height:1.1">${val}</div><div style="font-size:11px;color:var(--text2);margin-top:3px">${label}</div>${sub?`<div style="font-size:10px;color:var(--text3);margin-top:1px">${sub}</div>`:''}</div>`;
  const pct=v=>s.n?Math.round(v/s.n*100):0;
  const sec=t=>`<div style="font-size:11px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:.3px;margin:16px 0 8px">${t}</div>`;
  // gender bar
  const gseg=(v,c)=>v?`<div style="width:${pct(v)}%;background:${c}" title="${v}"></div>`:'';
  const genderBar=`<div style="display:flex;height:12px;border-radius:6px;overflow:hidden;background:var(--surface2);margin-bottom:8px">${gseg(s.male,'#2a9d8f')}${gseg(s.female,'#e56399')}${gseg(s.other,'var(--text3)')}</div>`;
  const chips=list=>list.length
    ?`<div style="display:flex;flex-wrap:wrap;gap:6px">${list.map(([name,c])=>`<span style="display:inline-flex;align-items:center;gap:5px;background:var(--surface2);border-radius:16px;padding:5px 10px;font-size:12px;color:var(--text)"><span style="font-weight:700">${esc(name)}</span><span style="background:var(--blue-mid);color:#fff;border-radius:10px;padding:0 6px;font-size:10px;font-weight:800">${c}</span></span>`).join('')}</div>`
    :'<div style="font-size:12px;color:var(--text3)">— לא הוזנו —</div>';
  let html='';
  html+=`<div style="display:flex;gap:8px;flex-wrap:wrap">${tile('סה"כ אנשים',s.n)}${tile('חיים',s.living)}${tile('נפטרו',s.deceased)}</div>`;
  html+=sec('מגדר');
  html+=genderBar;
  html+=`<div style="display:flex;gap:14px;font-size:12px;color:var(--text2)">`
    +`<span>👦 זכרים: <b style="color:var(--text)">${s.male}</b> (${pct(s.male)}%)</span>`
    +`<span>👧 נקבות: <b style="color:var(--text)">${s.female}</b> (${pct(s.female)}%)</span>`
    +(s.other?`<span>ללא מגדר: <b style="color:var(--text)">${s.other}</b></span>`:'')
    +`</div>`;
  if(s.withBirth){
    html+=sec('גילאים ושנות לידה');
    html+=`<div style="display:flex;gap:8px;flex-wrap:wrap">`
      +tile('שנות לידה',s.minBirth===s.maxBirth?s.minBirth:`${s.minBirth}–${s.maxBirth}`,`${s.withBirth} עם תאריך`)
      +(s.withAge?tile('טווח גילאים',s.minAge===s.maxAge?s.minAge:`${s.minAge}–${s.maxAge}`,'שנים'):'')
      +(s.withAge?tile('גיל ממוצע',s.avgAge,'שנים'):'')
      +`</div>`;
    if(s.withAge){
      const maxB=Math.max(...s.ageBuckets.map(b=>b.count),1);
      const rows=s.ageBuckets.filter(b=>b.count>0).map(b=>
        `<div style="display:flex;align-items:center;gap:8px;margin-top:6px">`
        +`<span style="width:46px;flex-shrink:0;font-size:11px;color:var(--text2)">${b.label}</span>`
        +`<div style="flex:1;height:14px;background:var(--surface2);border-radius:7px;overflow:hidden"><div style="height:100%;width:${Math.round(b.count/maxB*100)}%;background:var(--blue-mid)"></div></div>`
        +`<span style="width:22px;flex-shrink:0;text-align:center;font-size:12px;font-weight:800;color:var(--text)">${b.count}</span>`
        +`</div>`).join('');
      html+=`<div style="font-size:11px;font-weight:700;color:var(--text2);margin:12px 0 2px">פילוח לפי קבוצת גיל</div>`+rows;
    }
  }
  html+=sec('שמות פרטיים נפוצים');
  html+=chips(s.topNames);
  html+=sec('שמות משפחה נפוצים');
  html+=chips(s.topSurnames);
  body.innerHTML=html;
}
function _treeGenderBtnMap(){return{'':'treeGenderNone',boy:'treeGenderBoy',girl:'treeGenderGirl'};}
function _renderTreeGenderButtons(g){
  const map=_treeGenderBtnMap();
  Object.keys(map).forEach(k=>{
    const el=document.getElementById(map[k]);if(!el)return;
    el.style.background=g===k?'var(--blue-mid)':'transparent';
    el.style.color=g===k?'#fff':'var(--text2)';
    el.style.borderColor=g===k?'var(--blue-mid)':'var(--border)';
  });
}
function openTreePersonModal(id){
  _treeActivePersonId=id;
  const p=familyTree.find(x=>x.id===id);if(!p)return;
  _treePersonSnapshot={birthYear:p.birthYear||'',deathYear:p.deathYear||'',photo:p.photo||null};
  _treePersonEditPhoto=undefined;
  const photoInp=document.getElementById('treePersonPhoto');
  if(photoInp)photoInp.value='';
  const photoPreview=document.getElementById('treePersonPhotoPreview');
  const photoClear=document.getElementById('treePersonPhotoClear');
  if(photoPreview)photoPreview.innerHTML=p.photo?`<img src="${p.photo}" style="width:100%;height:100%;object-fit:cover">`:'<span style="font-size:22px">👤</span>';
  if(photoClear)photoClear.style.display=p.photo?'inline-block':'none';
  document.getElementById('treePersonNameInp').value=p.name||'';
  document.getElementById('treePersonSurnameInp').value=p.surname||'';
  document.getElementById('treePersonMaidenNameInp').value=p.maidenName||'';
  document.getElementById('treePersonMaidenNameInp').style.display=p.gender==='girl'?'block':'none';
  document.getElementById('treePersonBirthYearInp').value=p.birthYear||'';
  document.getElementById('treePersonDeceasedChk').checked=!!p.deceased;
  document.getElementById('treePersonDeathYearInp').value=p.deathYear||'';
  document.getElementById('treePersonDeathYearInp').style.display=p.deceased?'block':'none';
  _renderTreeGenderButtons(p.gender||'');
  const addParentBtn=document.getElementById('treeAddParentBtn');
  if(addParentBtn)addParentBtn.style.display=(p.parentIds&&p.parentIds.length>=2)?'none':'block';
  // Hiding this once a spouse already exists prevents the confusing state
  // of ending up with 3+ "spouses" on one person — e.g. clicking "add
  // spouse" on the seeded root couple's placeholder instead of just
  // renaming the already-existing placeholder "הורה 2" card.
  const addSpouseBtn=document.getElementById('treeAddSpouseBtn');
  if(addSpouseBtn)addSpouseBtn.style.display=(p.spouseIds&&p.spouseIds.length>0)?'none':'block';
  _syncTreeSubtreeBtn(p);
  renderTreePersonKidsList(p);
  document.getElementById('treePersonModal').style.display='flex';
}
// The person sheet's own kids list: tapping a child jumps straight into
// THEIR sheet (openTreePersonModal is idempotent — it just re-populates
// the same modal for the new id), so you can drill down generation by
// generation without ever closing back out to the canvas.
function renderTreePersonKidsList(p){
  const el=document.getElementById('treePersonKidsList');if(!el)return;
  const kids=familyTree.filter(x=>x.parentIds&&x.parentIds.includes(p.id));
  if(!kids.length){
    el.innerHTML='<div style="font-size:11px;color:var(--text3);padding:2px 2px 4px">אין ילדים רשומים עדיין</div>';
    return;
  }
  el.innerHTML=kids.map(k=>`<div onclick="openTreePersonModal(${k.id})" style="display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:var(--r2);border:1px solid var(--border);cursor:pointer">
    <span style="font-size:15px">${k.gender==='boy'?'👦':k.gender==='girl'?'👧':'👤'}</span>
    <span style="font-size:12px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(k.name||'ללא שם')}${k.surname?' '+esc(k.surname):''}</span>
  </div>`).join('');
}
function closeTreePersonModal(){
  document.getElementById('treePersonModal').style.display='none';
  _treeActivePersonId=null;
  _treePersonSnapshot=null;
}
function setTreePersonGender(g){
  const p=familyTree.find(x=>x.id===_treeActivePersonId);if(!p)return;
  p.gender=g;_renderTreeGenderButtons(g);
  const mn=document.getElementById('treePersonMaidenNameInp');
  if(mn)mn.style.display=g==='girl'?'block':'none';
  renderFamilyTree();
}
// These edits only touch the in-memory familyTree array + re-render the
// canvas — they do NOT persist to the server on every keystroke. The
// person sheet has its own explicit "💾 שמור" button (saveTreePersonChanges)
// for that, so a field can be edited/corrected several times without
// triggering a save (and its sync-status flicker) each time.
function saveTreePersonName(){
  const p=familyTree.find(x=>x.id===_treeActivePersonId);if(!p)return;
  const v=(document.getElementById('treePersonNameInp').value||'').trim();
  if(v)p.name=v;
  p.surname=(document.getElementById('treePersonSurnameInp').value||'').trim();
  p.maidenName=(document.getElementById('treePersonMaidenNameInp').value||'').trim();
  p.birthYear=(document.getElementById('treePersonBirthYearInp').value||'').trim();
  p.deathYear=(document.getElementById('treePersonDeathYearInp').value||'').trim();
  renderFamilyTree();
}
function toggleTreePersonDeceased(){
  const p=familyTree.find(x=>x.id===_treeActivePersonId);if(!p)return;
  p.deceased=document.getElementById('treePersonDeceasedChk').checked;
  document.getElementById('treePersonDeathYearInp').style.display=p.deceased?'block':'none';
  renderFamilyTree();
}
function saveTreePersonChanges(){
  const p=familyTree.find(x=>x.id===_treeActivePersonId);
  if(p&&_treePersonEditPhoto!==undefined){
    p.photo=_treePersonEditPhoto||null;
    _treePersonEditPhoto=undefined;
  }
  if(p&&_treePersonSnapshot){
    if(!_treePersonSnapshot.birthYear&&p.birthYear)_awardTreePoints(2);
    if(!_treePersonSnapshot.deathYear&&p.deathYear)_awardTreePoints(2);
    if(!_treePersonSnapshot.photo&&p.photo)_awardTreePoints(5);
  }
  save();
  renderFamilyTree();
  showToast('נשמר ✓');
  closeTreePersonModal();
}
// Swaps this person's position in `familyTree` with the sibling immediately
// to their left/right (same parent set — see _treeLayout's stable-sort tie
// order) — a constrained, no-mess way to control left-right order directly,
// instead of relying on birth-year data that's often missing or free-form
// dragging that got confusing.
function moveTreeSibling(dir){
  const p=familyTree.find(x=>x.id===_treeActivePersonId);if(!p)return;
  const key=ids=>[...(ids||[])].sort((a,b)=>a-b).join(',');
  const myKey=key(p.parentIds);
  const siblingIdxs=[];
  familyTree.forEach((x,i)=>{ if(key(x.parentIds)===myKey)siblingIdxs.push(i); });
  const idx=familyTree.indexOf(p);
  const pos=siblingIdxs.indexOf(idx);
  const swapIdx=siblingIdxs[pos+dir];
  if(swapIdx==null)return;
  [familyTree[idx],familyTree[swapIdx]]=[familyTree[swapIdx],familyTree[idx]];
  save();renderFamilyTree();
  _fitTreeWhenReady(); // layout shifted — keep the whole tree in view
}
// Drag-and-drop reordering: dropping one card onto another swaps their
// positions in `familyTree` (the same array-order swap moveTreeSibling
// does) rather than allowing free positioning — so the tree's layout stays
// deterministic and cards never end up floating outside the grid. Only
// two people sharing the exact same parentIds set are swappable.
let _treeDragId=null;
function treeCardDragStart(e,id){
  _treeDragId=id;
  e.dataTransfer.effectAllowed='move';
  try{e.dataTransfer.setData('text/plain',String(id));}catch(err){}
  e.currentTarget.style.opacity='0.4';
}
function treeCardDragEnd(e){
  e.currentTarget.style.opacity='';
  _treeDragId=null;
}
function treeCardDragOver(e){
  if(_treeDragId==null)return;
  e.preventDefault();
  e.dataTransfer.dropEffect='move';
  e.currentTarget.style.outline='2px dashed var(--blue-mid)';
}
function treeCardDragLeave(e){
  e.currentTarget.style.outline='';
}
function treeCardDrop(e,targetId){
  e.preventDefault();
  e.currentTarget.style.outline='';
  const sourceId=_treeDragId;
  _treeDragId=null;
  if(sourceId==null||sourceId===targetId)return;
  const a=familyTree.find(x=>x.id===sourceId),b=familyTree.find(x=>x.id===targetId);
  if(!a||!b)return;
  const key=ids=>[...(ids||[])].sort((x,y)=>x-y).join(',');
  if(key(a.parentIds)!==key(b.parentIds)){
    showToast('אפשר להחליף מקום רק בין אחים מאותם הורים');
    return;
  }
  const idxA=familyTree.indexOf(a),idxB=familyTree.indexOf(b);
  [familyTree[idxA],familyTree[idxB]]=[familyTree[idxB],familyTree[idxA]];
  save();renderFamilyTree();
  _fitTreeWhenReady(); // layout shifted — keep the whole tree in view
}
function deleteTreePerson(){
  const p=familyTree.find(x=>x.id===_treeActivePersonId);if(!p)return;
  if(!confirm('למחוק את '+(p.name||'האדם הזה')+'? הקשרים המשפחתיים שלו יוסרו, אבל שאר בני המשפחה יישארו בעץ.'))return;
  const id=p.id;
  familyTree=familyTree.filter(x=>x.id!==id);
  familyTree.forEach(x=>{
    if(x.parentIds)x.parentIds=x.parentIds.filter(pid=>pid!==id);
    if(x.spouseIds)x.spouseIds=x.spouseIds.filter(sid=>sid!==id);
  });
  closeTreePersonModal();
  save();renderFamilyTree();
  _fitTreeWhenReady(); // layout shifted — keep the whole tree in view
}
function addRootTreePerson(){
  _treeActivePersonId=null;
  openTreeAddModal('root');
}
// The per-card "+" button's own small menu — jumps straight to the
// add-relation form (parent/sibling/child) without opening the full person
// card first, unlike tapping the card itself.
function openTreeQuickAddMenu(id){
  _treeActivePersonId=id;
  document.getElementById('treeQuickAddModal').style.display='flex';
}
function closeTreeQuickAddMenu(){
  document.getElementById('treeQuickAddModal').style.display='none';
}
function quickAddRelation(relation){
  closeTreeQuickAddMenu();
  openTreeAddModal(relation);
}
function openTreeAddModal(relation){
  if(relation==='sibling'){
    const p=familyTree.find(x=>x.id===_treeActivePersonId);
    if(!p||!p.parentIds||!p.parentIds.length){alert('קודם צריך שלאדם הזה יהיה הורה בעץ — לחצו "הוסף הורה", ורק אז אפשר להוסיף אח/אחות.');return;}
  }
  _treeAddRelation=relation;
  const titles={root:'הוספת אדם',parent:'הוספת הורה',spouse:'הוספת בן/בת זוג',sibling:'הוספת אח/אחות',child:'הוספת ילד/ה'};
  document.getElementById('treeAddModalTitle').textContent=titles[relation]||'הוספת אדם';
  document.getElementById('treeAddNameInp').value='';
  // Sibling/child naturally carry the same surname as the person you're
  // adding from — prefill it so it's not typed again every time (still editable).
  const base=familyTree.find(x=>x.id===_treeActivePersonId);
  document.getElementById('treeAddSurnameInp').value=(relation==='sibling'||relation==='child')&&base?(base.surname||''):'';
  document.getElementById('treeAddMaidenNameInp').value='';
  document.getElementById('treeAddMaidenNameInp').style.display='none';
  document.getElementById('treeAddBirthYearInp').value='';
  document.getElementById('treeAddDeceasedChk').checked=false;
  document.getElementById('treeAddDeathYearInp').value='';
  document.getElementById('treeAddDeathYearInp').style.display='none';
  setTreeAddGender('');
  document.getElementById('treeAddModal').style.display='flex';
  setTimeout(()=>document.getElementById('treeAddNameInp')?.focus(),50);
}
function closeTreeAddModal(){
  document.getElementById('treeAddModal').style.display='none';
}
function _renderTreeAddGenderButtons(g){
  const map={'':'treeAddGenderNone',boy:'treeAddGenderBoy',girl:'treeAddGenderGirl'};
  Object.keys(map).forEach(k=>{
    const el=document.getElementById(map[k]);if(!el)return;
    el.style.background=g===k?'var(--blue-mid)':'transparent';
    el.style.color=g===k?'#fff':'var(--text2)';
    el.style.borderColor=g===k?'var(--blue-mid)':'var(--border)';
  });
}
function setTreeAddGender(g){
  _treeAddGender=g;
  _renderTreeAddGenderButtons(g);
  const mn=document.getElementById('treeAddMaidenNameInp');
  if(mn)mn.style.display=g==='girl'?'block':'none';
}
function toggleTreeAddDeceased(){
  document.getElementById('treeAddDeathYearInp').style.display=document.getElementById('treeAddDeceasedChk').checked?'block':'none';
}
function confirmTreeAdd(){
  const name=(document.getElementById('treeAddNameInp').value||'').trim();
  if(!name)return;
  const surname=(document.getElementById('treeAddSurnameInp').value||'').trim();
  const maidenName=(document.getElementById('treeAddMaidenNameInp').value||'').trim();
  const birthYear=(document.getElementById('treeAddBirthYearInp').value||'').trim();
  const deceased=document.getElementById('treeAddDeceasedChk').checked;
  const deathYear=(document.getElementById('treeAddDeathYearInp').value||'').trim();
  const relation=_treeAddRelation;
  const base=familyTree.find(x=>x.id===_treeActivePersonId);
  // Firestore's setDoc throws on any `undefined` field value, so this must
  // never end up undefined (e.g. when base is the seeded root placeholder).
  const newPerson={id:nxtTreePerson++,name,surname,gender:_treeAddGender,parentIds:[],spouseIds:[],sourceFamId:(base&&base.sourceFamId!=null)?base.sourceFamId:null,birthYear,deathYear,deceased,maidenName};
  if(relation==='parent'){
    if(!base)return;
    if(!base.parentIds)base.parentIds=[];
    if(base.parentIds.length>=2){alert('כבר יש לאדם הזה 2 הורים.');return;}
    base.parentIds.push(newPerson.id);
  }else if(relation==='spouse'){
    if(!base)return;
    if(!base.spouseIds)base.spouseIds=[];
    base.spouseIds.push(newPerson.id);
    newPerson.spouseIds=[base.id];
    // If this person already has kids recorded with only one parent (base),
    // offer to attach the new spouse as their second parent too — otherwise
    // the new spouse would show with no connection to those existing kids.
    const singleParentKids=familyTree.filter(x=>x.parentIds&&x.parentIds.length===1&&x.parentIds[0]===base.id);
    if(singleParentKids.length&&confirm('לשייך את '+name+' גם כהורה השני של '+singleParentKids.length+' הילדים הקיימים של '+(base.name||'האדם הזה')+'?')){
      singleParentKids.forEach(k=>k.parentIds=[base.id,newPerson.id]);
    }
  }else if(relation==='sibling'){
    if(!base)return;
    newPerson.parentIds=[...(base.parentIds||[])];
  }else if(relation==='child'){
    if(!base)return;
    const spouseIds=base.spouseIds||[];
    newPerson.parentIds=spouseIds.length===1?[base.id,spouseIds[0]]:[base.id];
  }
  familyTree.push(newPerson);
  closeTreeAddModal();
  _awardTreePoints(5);
  if(birthYear)_awardTreePoints(2);
  if(deathYear)_awardTreePoints(2);
  save();renderFamilyTree();
  _fitTreeWhenReady(); // layout shifted — keep the whole tree in view
  // Back to the person we just added FROM (refreshed — e.g. showing the new
  // child in their kids list right away) instead of dropping out to the
  // bare canvas. A brand-new root person has no "back to" — that one still
  // just closes.
  if(base)openTreePersonModal(base.id);
  else closeTreePersonModal();
}
// Family-tree filling competition: 5 points for a new person, 2 for newly
// filling in a birth/death year, 5 for newly adding a photo (see the
// callers) — credited to whichever family email is filling in the tree on
// THIS device (the index.html per-device email gate — see
// _myFamId()/deviceEmailSlot3). Admin-side additions (admin.html has no
// such per-email identity) aren't credited — this is a competition between
// family members, not the admin.
function _awardTreePoints(points){
  if(_isAdminPage())return;
  const fid=_myFamId();if(fid==null)return;
  const fam=getFam(fid);if(!fam)return;
  const slot=parseInt(localStorage.getItem('deviceEmailSlot3')||'1');
  const email=_cleanEmail(slot===2?fam.email2:fam.email);
  if(!email)return;
  if(!treeScores[email])treeScores[email]={name:'',points:0};
  treeScores[email].name=_regDisplayName(fam,slot)||email;
  treeScores[email].points+=points;
}
function openTreeLeaderboardModal(){
  renderTreeLeaderboard();
  document.getElementById('treeLeaderboardModal').style.display='flex';
}
function closeTreeLeaderboardModal(){
  document.getElementById('treeLeaderboardModal').style.display='none';
}
function renderTreeLeaderboard(){
  const list=document.getElementById('treeLeaderboardList');if(!list)return;
  const rows=Object.values(treeScores).sort((a,b)=>b.points-a.points);
  if(!rows.length){
    list.innerHTML='<div class="empty" style="padding:24px 0"><span class="empty-ico">🏆</span>עדיין אין נקודות — כל שם חדש שתוסיפו לעץ שווה 5 נקודות!</div>';
    return;
  }
  const medals=['🥇','🥈','🥉'];
  list.innerHTML=rows.map((r,i)=>`
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--r2);border:1.5px solid var(--border);margin-bottom:6px">
      <span style="font-size:17px;width:24px;text-align:center;flex-shrink:0">${medals[i]||(i+1)}</span>
      <span style="flex:1;font-size:13px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name)}</span>
      <span style="font-size:13px;font-weight:800;color:var(--blue-mid);white-space:nowrap">${r.points} נק'</span>
    </div>`).join('');
}

// Links two people ALREADY in the tree — unlike "הוסף הורה/בן-זוג/אח/ילד"
// (which always creates a brand-new person), this is for two people who
// are both already recorded but weren't connected to each other yet.
// "Sibling" isn't its own relationship in this data model — it's derived
// from sharing the exact same parentIds — so linking two as siblings really
// means making their parentIds match.
function _treeParentKey(ids){return[...(ids||[])].sort((a,b)=>a-b).join(',');}
// Every ancestor of a person (their recorded parents, grandparents, …) —
// the mirror image of _treeBranchIds (which walks DOWN to descendants).
// Used to keep "link as child" from creating a cycle (making someone their
// own ancestor's ancestor).
function _treeAncestorIds(id){
  const byId=new Map(familyTree.map(x=>[x.id,x]));
  const out=new Set(),q=[id];
  while(q.length){
    const cur=byId.get(q.pop());if(!cur)continue;
    (cur.parentIds||[]).forEach(pid=>{ if(!out.has(pid)){out.add(pid);q.push(pid);} });
  }
  return out;
}
// Step 1: which relationship to link as. Mirrors openTreeAddModal's own
// visibility rules (a 3rd parent or 2nd spouse isn't a thing here either) —
// unlike there, sibling/child are always offered since this is about
// connecting to someone who ALREADY exists, not creating someone new.
function openTreeLinkRelationModal(){
  const p=familyTree.find(x=>x.id===_treeActivePersonId);if(!p)return;
  const parentBtn=document.getElementById('treeLinkParentBtn');
  if(parentBtn)parentBtn.style.display=(p.parentIds&&p.parentIds.length>=2)?'none':'flex';
  const spouseBtn=document.getElementById('treeLinkSpouseBtn');
  if(spouseBtn)spouseBtn.style.display=(p.spouseIds&&p.spouseIds.length>0)?'none':'flex';
  document.getElementById('treeLinkRelationModal').style.display='flex';
}
function closeTreeLinkRelationModal(){
  document.getElementById('treeLinkRelationModal').style.display='none';
}
function chooseTreeLinkRelation(relation){
  closeTreeLinkRelationModal();
  openTreeLinkPersonModal(relation);
}
const _TREE_LINK_TITLES={parent:'🔗 קשר להורה קיים/ת',spouse:'🔗 קשר לבן/בת זוג קיים/ת',sibling:'🔗 קשר לאח/אחות קיים/ת',child:'🔗 קשר לילד/ה קיים/ת'};
let _treeLinkRelation=null;
// Step 2: pick WHO, from everyone else in the tree already — filtered per
// relation so the list never even offers something that would need
// blocking on selection (an already-2-parents / already-married-in
// candidate isn't relevant here; a cycle-creating one — a descendant as
// your own parent, or an ancestor as your own child — genuinely can't be
// filtered away safely, so those two are excluded outright).
function openTreeLinkPersonModal(relation){
  const p=familyTree.find(x=>x.id===_treeActivePersonId);if(!p)return;
  _treeLinkRelation=relation;
  const title=document.getElementById('treeLinkPersonTitle');
  if(title)title.textContent=_TREE_LINK_TITLES[relation]||'🔗 קשר לבן משפחה קיים/ת';
  document.getElementById('treeLinkPersonSearch').value='';
  renderTreeLinkPersonList('');
  document.getElementById('treeLinkPersonModal').style.display='flex';
  setTimeout(()=>document.getElementById('treeLinkPersonSearch')?.focus(),50);
}
function closeTreeLinkPersonModal(){
  document.getElementById('treeLinkPersonModal').style.display='none';
}
function renderTreeLinkPersonList(filter){
  const el=document.getElementById('treeLinkPersonList');if(!el)return;
  const p=familyTree.find(x=>x.id===_treeActivePersonId);if(!p)return;
  const q=(filter||'').trim().toLowerCase();
  const exclude=new Set([p.id]);
  if(_treeLinkRelation==='sibling'){
    const myKey=_treeParentKey(p.parentIds);
    if(myKey)familyTree.forEach(x=>{ if(_treeParentKey(x.parentIds)===myKey)exclude.add(x.id); }); // already siblings
  }else if(_treeLinkRelation==='parent'){
    _treeBranchIds(p.id).forEach(id=>exclude.add(id)); // a descendant can't also be your parent
  }else if(_treeLinkRelation==='child'){
    _treeAncestorIds(p.id).forEach(id=>exclude.add(id)); // an ancestor can't also be your child
  }
  const candidates=familyTree.filter(x=>{
    if(exclude.has(x.id))return false;
    const full=((x.name||'')+' '+(x.surname||'')).toLowerCase();
    return!q||full.includes(q);
  });
  if(!candidates.length){el.innerHTML='<div style="padding:16px;text-align:center;font-size:13px;color:var(--text3)">לא נמצאו אנשים</div>';return;}
  el.innerHTML=candidates.map(x=>`<div onclick="linkExistingAs(${x.id})" style="display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--border);cursor:pointer">
    <span style="font-size:18px">${x.gender==='boy'?'👦':x.gender==='girl'?'👧':'👤'}</span>
    <span style="font-size:13px;font-weight:600;color:var(--text)">${esc(x.name||'ללא שם')}${x.surname?' '+esc(x.surname):''}</span>
  </div>`).join('');
}
// Step 3: commit the link. Each branch is written to be safe by
// construction wherever the list above couldn't filter that out on its
// own (sibling/child can overwrite the OTHER person's existing recorded
// parents, so those two confirm first — parent/spouse only ever ADD to
// data, never replace anything, so they don't need to).
function linkExistingAs(otherId){
  const a=familyTree.find(x=>x.id===_treeActivePersonId);if(!a)return;
  const b=familyTree.find(x=>x.id===otherId);if(!b)return;
  if(_treeLinkRelation==='sibling'){
    const aHas=!!(a.parentIds&&a.parentIds.length);
    const bHas=!!(b.parentIds&&b.parentIds.length);
    if(!aHas&&!bHas){alert('צריך שלפחות לאחד מהם יהיה הורה בעץ — הוסיפו הורה לאחד מהם ונסו שוב.');return;}
    if(aHas&&bHas){
      if(!confirm(`ל-${a.name||'האדם הראשון'} ול-${b.name||'האדם השני'} יש כרגע הורים שונים. לשייך את ${b.name||'השני'} להורים של ${a.name||'הראשון'}? (הקשר הקודם של ${b.name||'השני'} להורים שלו יוסר — ההורים עצמם יישארו בעץ)`))return;
      b.parentIds=[...a.parentIds];
    }else if(aHas){
      b.parentIds=[...a.parentIds];
    }else{
      a.parentIds=[...b.parentIds];
    }
  }else if(_treeLinkRelation==='spouse'){
    if(!a.spouseIds)a.spouseIds=[];
    if(!b.spouseIds)b.spouseIds=[];
    a.spouseIds.push(b.id);
    b.spouseIds.push(a.id);
    // Same courtesy confirmTreeAdd offers when adding a brand-new spouse:
    // attach them as the 2nd parent of kids `a` already has recorded alone.
    const singleParentKids=familyTree.filter(x=>x.parentIds&&x.parentIds.length===1&&x.parentIds[0]===a.id);
    if(singleParentKids.length&&confirm('לשייך את '+(b.name||'בן/בת הזוג')+' גם כהורה השני של '+singleParentKids.length+' הילדים הקיימים של '+(a.name||'האדם הזה')+'?')){
      singleParentKids.forEach(k=>k.parentIds=[a.id,b.id]);
    }
  }else if(_treeLinkRelation==='parent'){
    if(!a.parentIds)a.parentIds=[];
    if(a.parentIds.length>=2){alert('כבר יש לאדם הזה 2 הורים.');return;}
    if(a.parentIds.includes(b.id))return;
    a.parentIds.push(b.id);
  }else if(_treeLinkRelation==='child'){
    if(b.parentIds&&b.parentIds.length){
      if(!confirm('ל-'+(b.name||'האדם הזה')+' יש כבר הורים רשומים בעץ. להחליף אותם ולקשר כילד/ה של '+(a.name||'האדם הנוכחי')+'? (הקשר הקודם יוסר — ההורים הקודמים עצמם יישארו בעץ)'))return;
    }
    const spouseIds=a.spouseIds||[];
    b.parentIds=spouseIds.length===1?[a.id,spouseIds[0]]:[a.id];
  }else{
    return;
  }
  closeTreeLinkPersonModal();
  closeTreePersonModal();
  save();renderFamilyTree();
  _fitTreeWhenReady(); // layout shifted — keep the whole tree in view
}

function openFundDetail(){
  renderFund();
  document.getElementById('fundDetailOverlay').style.display='flex';
}
function closeFundDetail(){
  document.getElementById('fundDetailOverlay').style.display='none';
}

const HEB_MONTHS=['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const HEB_DAYS_SHORT=['א','ב','ג','ד','ה','ו','ש'];
const LAT_DAYS_SHORT=["א'","ב'","ג'","ד'","ה'","ו'","ש'"];
const HEB_DAY_NUM=['','א','ב','ג','ד','ה','ו','ז','ח','ט','י','יא','יב','יג','יד','טו','טז','יז','יח','יט','כ','כא','כב','כג','כד','כה','כו','כז','כח','כט','ל'];

function renderFamilyHome(){
  const sub=document.getElementById('fhSub');
  if(sub){
    const openCount=events.filter(e=>e.open).length;
    const famCount=families.length;
    sub.textContent=[famCount?famCount+' משפחות':'',openCount?openCount+' אירועים פעילים':''].filter(Boolean).join(' · ')||'ברוכים הבאים';
  }
  renderMessages();
  renderCalendar();
  renderCountdowns();
  renderNotifBtn();
  renderChatInput();
}

// ── Countdown clocks (home screen) ──────────────────────────
// Target is midnight (00:00:00) at the start of the chosen date; days/hours/
// minutes/seconds are all derived from one live ms-diff, re-rendered every
// second while any countdown is showing, so the clock actually ticks.
let _countdownTickTimer=null;
const _fmt2=n=>String(n).padStart(2,'0');
function _countdownParts(dateStr,timeStr){
  const diff=new Date(dateStr+'T'+(timeStr||'00:00')+':00').getTime()-Date.now();
  if(diff<=0)return null;
  const totalSec=Math.floor(diff/1000);
  return{days:Math.floor(totalSec/86400),hours:Math.floor((totalSec%86400)/3600),mins:Math.floor((totalSec%3600)/60),secs:totalSec%60};
}
// Renders the actual card look (gradient bg, emoji, digits, title) shared
// verbatim between the live home-screen cards and the modal's edit preview,
// so what you see while editing really is the same markup, not a mockup.
function _countdownCardHTML(c){
  const p=_countdownParts(c.date,c.time);
  const bg1=c.bg1||'#667eea',bg2=c.bg2||'#764ba2',tc=c.textColor||'#ffffff';
  const body=p
    ?`<div style="font-family:var(--font-head);font-size:24px;font-weight:800;line-height:1">${p.days}<span style="font-size:12px;font-weight:600"> ${p.days===1?'יום':'ימים'}</span></div>
      <div style="font-family:var(--font-head);font-size:15px;font-weight:700;margin-top:3px;direction:ltr">${_fmt2(p.hours)}:${_fmt2(p.mins)}:${_fmt2(p.secs)}</div>`
    :`<div style="font-family:var(--font-head);font-size:26px;font-weight:800;line-height:1">🎉</div><div style="font-size:11px;opacity:.9;margin-top:2px">הגיע היום!</div>`;
  const emojiHtml=c.emoji?`<div style="font-size:${c.emojiSize||32}px;line-height:1;margin-bottom:4px">${esc(c.emoji)}</div>`:'';
  return`<div style="background:linear-gradient(135deg,${bg1},${bg2});border-radius:16px;padding:14px 12px;color:${tc};text-align:center;box-shadow:0 4px 16px rgba(102,126,234,0.3)">
    ${emojiHtml}
    ${body}
    <div style="font-size:12.5px;font-weight:700;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.title||'')}</div>
  </div>`;
}
function renderCountdowns(){
  const el=document.getElementById('countdownSection');if(!el)return;
  if(_countdownTickTimer){clearInterval(_countdownTickTimer);_countdownTickTimer=null;}
  const sorted=[...countdowns].sort((a,b)=>new Date(a.date+'T'+(a.time||'00:00'))-new Date(b.date+'T'+(b.time||'00:00')));
  if(!sorted.length&&!editMode){el.innerHTML='';return;}
  const cards=sorted.map(c=>`<div style="position:relative;flex:1;min-width:120px">
      <div class="edit-only" style="position:absolute;top:6px;left:6px;display:flex;gap:4px;z-index:2">
        <button onclick="openCountdownModal(${c.id})" style="border:none;background:rgba(255,255,255,0.25);color:#fff;width:20px;height:20px;border-radius:50%;font-size:11px;line-height:1;cursor:pointer;padding:0">✏️</button>
        <button onclick="deleteCountdown(${c.id})" style="border:none;background:rgba(255,255,255,0.25);color:#fff;width:20px;height:20px;border-radius:50%;font-size:12px;line-height:1;cursor:pointer;padding:0">✕</button>
      </div>
      ${_countdownCardHTML(c)}
    </div>`).join('');
  const addBtn=`<button class="edit-only" onclick="openCountdownModal()" style="flex:1;min-width:120px;padding:14px 12px;border-radius:16px;border:1.5px dashed #667eea;background:transparent;color:#667eea;font-size:13px;font-weight:700;font-family:var(--font);cursor:pointer">+ שעון חדש</button>`;
  el.innerHTML=`<div style="display:flex;gap:10px;flex-wrap:wrap;padding:0 14px 6px">${cards}${addBtn}</div>`;
  if(sorted.length)_countdownTickTimer=setInterval(renderCountdowns,1000);
}
let _editCountdownId=null,_countdownEmojiSize=32;
function openCountdownModal(id){
  _editCountdownId=id!=null?id:null;
  const c=id!=null?countdowns.find(x=>x.id===id):null;
  const t=document.getElementById('countdownTitle');if(t)t.value=c?c.title:'';
  const d=document.getElementById('countdownDate');if(d)d.value=c?c.date:'';
  const tm=document.getElementById('countdownTime');if(tm)tm.value=c?(c.time||'00:00'):'00:00';
  const e=document.getElementById('countdownEmoji');if(e)e.value=c?(c.emoji||''):'';
  const b1=document.getElementById('countdownBg1');if(b1)b1.value=c&&c.bg1?c.bg1:'#667eea';
  const b2=document.getElementById('countdownBg2');if(b2)b2.value=c&&c.bg2?c.bg2:'#764ba2';
  const tc=document.getElementById('countdownTextColor');if(tc)tc.value=c&&c.textColor?c.textColor:'#ffffff';
  _countdownEmojiSize=c&&c.emojiSize?c.emojiSize:32;
  updateCountdownPreview();
  const err=document.getElementById('countdownErr');if(err)err.style.display='none';
  const mTitle=document.getElementById('countdownModalTitle');if(mTitle)mTitle.textContent=c?'✏️ עריכת שעון':'⏱ שעון ספירה לאחור חדש';
  const saveBtn=document.getElementById('countdownSaveBtn');if(saveBtn)saveBtn.textContent=c?'✓ שמור שינויים':'✓ צור שעון';
  document.getElementById('countdownModal').style.display='flex';
}
function closeCountdownModal(){
  document.getElementById('countdownModal').style.display='none';
  _editCountdownId=null;
}
function pickCountdownEmoji(e){
  const inp=document.getElementById('countdownEmoji');if(inp)inp.value=e;
  updateCountdownPreview();
}
function stepCountdownEmojiSize(delta){
  _countdownEmojiSize=Math.max(16,Math.min(80,_countdownEmojiSize+delta));
  updateCountdownPreview();
}
// Refreshes both the small emoji swatch next to the size stepper and the
// full "story-style" card preview at the top of the modal, so every change
// (title, date, emoji, size, colors) is reflected on the actual card look
// immediately, before saving.
function updateCountdownPreview(){
  const inp=document.getElementById('countdownEmoji');
  const val=(inp?.value||'').trim();
  const prev=document.getElementById('countdownEmojiPreview');
  if(prev){prev.textContent=val;prev.style.fontSize=_countdownEmojiSize+'px';}
  const lbl=document.getElementById('countdownEmojiSizeLbl');if(lbl)lbl.textContent=_countdownEmojiSize+'px';
  const card=document.getElementById('countdownPreviewCard');
  if(card){
    const title=(document.getElementById('countdownTitle')?.value||'').trim()||'האירוע שלי';
    const date=document.getElementById('countdownDate')?.value||new Date(Date.now()+3*86400000).toISOString().slice(0,10);
    const time=document.getElementById('countdownTime')?.value||'00:00';
    const bg1=document.getElementById('countdownBg1')?.value||'#667eea';
    const bg2=document.getElementById('countdownBg2')?.value||'#764ba2';
    const textColor=document.getElementById('countdownTextColor')?.value||'#ffffff';
    card.innerHTML=_countdownCardHTML({title,date,time,emoji:val,emojiSize:_countdownEmojiSize,bg1,bg2,textColor});
  }
}
function saveCountdown(){
  const title=(document.getElementById('countdownTitle')?.value||'').trim();
  const date=document.getElementById('countdownDate')?.value||'';
  const time=document.getElementById('countdownTime')?.value||'00:00';
  const emoji=(document.getElementById('countdownEmoji')?.value||'').trim();
  const bg1=document.getElementById('countdownBg1')?.value||'#667eea';
  const bg2=document.getElementById('countdownBg2')?.value||'#764ba2';
  const textColor=document.getElementById('countdownTextColor')?.value||'#ffffff';
  const err=document.getElementById('countdownErr');
  if(!title||!date){if(err){err.textContent='נא למלא כיתוב ותאריך';err.style.display='block';}return;}
  if(err)err.style.display='none';
  if(_editCountdownId!=null){
    const c=countdowns.find(x=>x.id===_editCountdownId);
    if(c){c.title=title;c.date=date;c.time=time;c.emoji=emoji;c.emojiSize=_countdownEmojiSize;c.bg1=bg1;c.bg2=bg2;c.textColor=textColor;}
  }else{
    countdowns.push({id:nxtCountdown++,title,date,time,emoji,emojiSize:_countdownEmojiSize,bg1,bg2,textColor,createdAt:Date.now()});
  }
  closeCountdownModal();
  save();renderCountdowns();
}
function deleteCountdown(id){
  countdowns=countdowns.filter(c=>c.id!==id);
  save();renderCountdowns();
}

function openChatSheet(){
  const s=document.getElementById('chatSheet');
  if(!s)return;
  s.classList.add('open');
  const ml=document.getElementById('msgList');
  if(ml)setTimeout(()=>ml.scrollTop=ml.scrollHeight,50);
  localStorage.setItem('chatLastSeen',String(Date.now()));
  renderChatBadge();
}
function closeChatSheet(){
  const s=document.getElementById('chatSheet');
  if(s)s.classList.remove('open');
  localStorage.setItem('chatLastSeen',String(Date.now()));
  renderChatBadge();
}

function openCalModal(){
  const dEl=document.getElementById('calAddDate');
  if(calSelDay)dEl.value=calSelDay;
  document.getElementById('calModal').style.display='flex';
  setTimeout(()=>{const i=document.getElementById('calAddTitle');if(i)i.focus();},50);
}
function closeCalModal(){
  document.getElementById('calModal').style.display='none';
  document.getElementById('calAddTitle').value='';
  document.getElementById('calAddDate').value='';
}

function deleteMsg(id){
  if(!confirm('למחוק הודעה זו?'))return;
  messages=messages.filter(m=>m.id!==id);
  save();renderMessages();
}

function _myChatName(){
  if(_isAdminPage())return(localStorage.getItem('chatName')||'').trim();
  const famId=localStorage.getItem('deviceFamId3');if(!famId)return'';
  const fam=getFam(parseInt(famId));if(!fam)return'';
  const slot=parseInt(localStorage.getItem('deviceEmailSlot3')||'1');
  const firstName=slot===2?fam.emailName2:fam.emailName;
  const surname=fam.name.replace('משפחת','').trim();
  return firstName?`${firstName} ${surname}`:surname;
}
// Shared by _fcmRegistrantName() (device-side, at registration time) and the
// admin devices list (renderNotifDevicesModal, recomputed live off current
// family data) so a filled-in parent name shows up immediately for everyone
// viewing the list, not just after that specific device re-registers.
function _regDisplayName(fam,slot){
  if(!fam)return null;
  const firstName=slot===2?fam.emailName2:fam.emailName;
  const surname=fam.name.replace('משפחת','').trim();
  if(firstName)return`${firstName} ${surname}`;
  const email=slot===2?fam.email2:fam.email;
  const localPart=email?_cleanEmail(email).split('@')[0]:'';
  return localPart?`${localPart} (${surname})`:surname;
}
// Like _myChatName(), but for the family devices list (openNotifDevicesModal):
// falls back to the email's own local-part when the family never filled in
// the parent-name field, so a registration is still traceable to a person
// and not just the family/surname.
function _fcmRegistrantName(){
  if(_isAdminPage())return(localStorage.getItem('chatName')||'').trim()||null;
  const famId=localStorage.getItem('deviceFamId3');if(!famId)return null;
  const fam=getFam(parseInt(famId));if(!fam)return null;
  const slot=parseInt(localStorage.getItem('deviceEmailSlot3')||'1');
  return _regDisplayName(fam,slot);
}
function renderChatInput(){
  const area=document.getElementById('chatInputArea');if(!area)return;
  const saved=_myChatName();
  if(!saved){
    area.innerHTML=`
      <div style="font-size:12px;color:var(--text2);text-align:center;direction:rtl">מה שמך? (פעם אחת בלבד)</div>
      <div style="display:flex;gap:6px">
        <input id="chatName" placeholder="שמך" maxlength="20" onkeydown="if(event.key==='Enter')saveChatName()" style="flex:1;border:1.5px solid var(--blue-mid);border-radius:var(--r2);padding:9px 10px;font-size:14px;font-family:var(--font);background:var(--bg);color:var(--text);direction:rtl;box-sizing:border-box">
        <button onclick="saveChatName()" style="background:var(--blue-mid);color:#fff;border:none;border-radius:var(--r2);padding:9px 16px;font-size:14px;font-weight:700;font-family:var(--font);cursor:pointer">המשך</button>
      </div>`;
  } else {
    area.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
        <span style="font-size:11px;color:var(--text3)">מחובר כ: <b style="color:var(--text2)">${esc(saved)}</b></span>
        ${_isAdminPage()?`<button onclick="changeChatName()" style="background:none;border:none;font-size:11px;color:var(--text3);cursor:pointer;text-decoration:underline;font-family:var(--font)">שנה שם</button>`:''}
      </div>
      <div style="display:flex;gap:6px">
        <input id="chatText" placeholder="כתוב הודעה..." maxlength="300" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMsg()}" style="flex:1;border:1.5px solid var(--border);border-radius:var(--r2);padding:8px 10px;font-size:14px;font-family:var(--font);background:var(--bg);color:var(--text);direction:rtl;box-sizing:border-box">
        <button onclick="sendChatMsg()" style="background:var(--blue-mid);color:#fff;border:none;border-radius:var(--r2);padding:8px 16px;font-size:14px;font-weight:700;font-family:var(--font);cursor:pointer">שלח</button>
      </div>`;
  }
}

function saveChatName(){
  const n=(document.getElementById('chatName')?.value||'').trim();
  if(!n)return;
  localStorage.setItem('chatName',n);
  renderChatInput();
}

function changeChatName(){
  localStorage.removeItem('chatName');
  renderChatInput();
}

function sendChatMsg(){
  const author=_myChatName();
  const textEl=document.getElementById('chatText');
  const text=(textEl?.value||'').trim();
  if(!text||!author)return;
  messages.push({id:nxtMsg++,author,text,ts:Date.now()});
  _sendPush('💬 הודעה חדשה',(author?author+': ':'')+text,'all',null,'chat');
  if(textEl){textEl.value='';textEl.focus();}
  save();renderMessages();
}

// ── Notifications & Real-time ──────────────────────────────────────────────

let _initialSync=true,_realtimeUnsub=null;

function _notifOk(){return 'Notification' in window&&Notification.permission==='granted';}

let _fcmForegroundBound=false;
async function registerFCMToken(){
  if(!('serviceWorker' in navigator)) throw new Error('הדפדפן לא תומך ב-Service Worker');
  if(!_fbApp) await fbInit();
  const msgMod=await import('https://www.gstatic.com/firebasejs/12.14.0/firebase-messaging.js');
  const messaging=msgMod.getMessaging(_fbApp);
  const swReg=await navigator.serviceWorker.ready;
  const token=await msgMod.getToken(messaging,{vapidKey:FCM_VAPID_KEY,serviceWorkerRegistration:swReg});
  if(!token) throw new Error('getToken החזיר ריק — בדוק הגדרות דפדפן');
  const {db,doc,setDoc,collection,query,where,getDocs,deleteDoc}=await fbInit();
  let did=localStorage.getItem('fcmDeviceId');
  if(!did){did=Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem('fcmDeviceId',did);}
  // isAdmin tracks whether THIS device is currently unlocked into edit mode,
  // separately from `page` (which only ever reflects the URL it loaded
  // from). Edit mode is reachable from the plain family link too (the 🔒 on
  // the home page), not just admin.html — a treasurer who unlocks from
  // there is exactly as much an admin as one using the dedicated admin.html
  // icon, so target:'admin' pushes (see _refreshAdminPushFlag) need to
  // reach them too, not just page==='admin' devices.
  await setDoc(doc(db,'fcmTokens',did),{token,ts:Date.now(),page:_isAdminPage()?'admin':'index',isAdmin:editMode||_isAdminPage(),famId:_isAdminPage()?null:_myFamId(),slot:_isAdminPage()?null:parseInt(localStorage.getItem('deviceEmailSlot3')||'1'),name:_fcmRegistrantName(),notifPref:localStorage.getItem('notifPref')||'all'});
  // If this exact push token is already registered under a different device
  // id (e.g. site data was cleared so a new fcmDeviceId got generated, but
  // the browser's underlying push subscription — and therefore the token —
  // stayed the same), that old doc is a genuine duplicate that would
  // receive every push twice. Clean it up.
  try{
    const dupSnap=await getDocs(query(collection(db,'fcmTokens'),where('token','==',token)));
    const stale=dupSnap.docs.filter(d=>d.id!==did);
    await Promise.all(stale.map(d=>deleteDoc(d.ref)));
  }catch(e){console.warn('fcmTokens dedup failed:',e);}
  console.log('FCM token saved OK');
  // Background pushes (tab closed/hidden) are shown automatically by
  // sw.js's onBackgroundMessage. But by design, Chrome does NOT auto-show
  // anything for a push that arrives while the tab is open and focused —
  // that case has to be handled here, in the page itself, or it's silently
  // dropped (the most common reason "the notification never popped").
  if(!_fcmForegroundBound){
    _fcmForegroundBound=true;
    msgMod.onMessage(messaging,payload=>{
      // Data-only payload (see api/notify.js) — reading payload.notification
      // here would silently show nothing for these messages, since the
      // server intentionally never sets that field (to avoid the browser
      // auto-displaying it a second time on top of this).
      const d=payload.data||{};
      showNotif(d.title||'ינקלביץ',d.body||'',d.title+'|'+d.body);
    });
  }
}
// Called right after a device successfully unlocks edit mode (from ANY
// page, not just admin.html — see registerFCMToken's isAdmin comment), so
// target:'admin' pushes (e.g. family-edit notifications) start reaching
// this device without waiting for it to reload. Best-effort and silent:
// notifications may simply not be granted yet on this device, which is
// fine — requestNotifPerm()/registerFCMToken() will set isAdmin correctly
// whenever that happens instead.
function _refreshAdminPushFlag(){
  if(_notifOk())registerFCMToken().catch(()=>{});
}

async function requestNotifPerm(){
  if(!('Notification' in window)){alert('הדפדפן שלך לא תומך בהתראות');return;}
  if(Notification.permission==='denied'){alert('הדפדפן חסם התראות. לאיפוס — לחץ על המנעול בסרגל הכתובת.');return;}
  const p=await Notification.requestPermission();
  renderNotifBtn();
  if(p==='granted'){
    showNotif('ינקלביץ 🔔','התראות הופעלו! תקבלו עדכונים על הודעות, הוצאות וימי הולדת.');
    registerFCMToken().then(()=>{}).catch(e=>alert('שגיאת התראות: '+e.message));
  }
}

function showNotif(title,body,tag){
  if(!_notifOk())return;
  try{new Notification(title,{body,icon:'./icon-192.png',dir:'rtl',lang:'he',...(tag?{tag}:{})});}catch(e){}
}

function renderNotifBtn(){
  const btn=document.getElementById('notifBtn');if(!btn)return;
  if(!('Notification' in window)){btn.style.display='none';return;}
  const perm=Notification.permission;
  btn.textContent=perm==='granted'?'🔔':'🔕';
  btn.style.opacity=perm==='granted'?'1':'0.55';
  btn.title=perm==='granted'?'התראות פעילות':'לחץ להפעלת התראות';
  btn.onclick=perm==='denied'
    ?()=>alert('הדפדפן חסם התראות. לאיפוס דרך הגדרות האתר בסרגל הכתובת.')
    :perm==='granted'
      ?openNotifPrefModal
      :requestNotifPerm;
}
// Lets a family device choose which pushes it actually wants — 'all' (every
// push, unchanged default), 'important' (skips chat/poll noise) or 'mine'
// (skips anything not about this family's own events). Falls back to the
// old plain alert when the picker markup isn't on this page (e.g. admin.html
// intentionally never gained it — the admin device always gets everything).
const NOTIF_PREFS=[
  {id:'all',ico:'🔔',title:'כל מה שזז',desc:'עדכון על כל פעילות באפליקציה — הודעות בצ\'אט, סקרים, אירועים, הוצאות ועוד.'},
  {id:'important',ico:'📌',title:'עדכונים חשובים',desc:'ימי הולדת, פתיחה/סגירה של אירוע, הוצאות חדשות וכדומה — בלי הודעות צ\'אט וסקרים.'},
  {id:'mine',ico:'🎯',title:'רק מה שקשור אליי',desc:'רק התראות על אירועים שהמשפחה שלכם משתתפת בהם.'},
];
function openNotifPrefModal(){
  const modal=document.getElementById('notifPrefModal');
  if(!modal){alert('התראות פעילות. לביטול — הגדרות האתר בסרגל הכתובת.');return;}
  renderNotifPrefModal();
  modal.style.display='flex';
}
function closeNotifPrefModal(){
  const modal=document.getElementById('notifPrefModal');if(modal)modal.style.display='none';
}
function renderNotifPrefModal(){
  const el=document.getElementById('notifPrefModalContent');if(!el)return;
  const cur=localStorage.getItem('notifPref')||'all';
  // The email section is rebuilt as part of the same innerHTML write (not a
  // pre-existing child) — a separate write would wipe out a static child
  // element with an id, since this replaces the whole container each time.
  el.innerHTML=NOTIF_PREFS.map(p=>`
    <button onclick="saveNotifPref('${p.id}')" style="width:100%;text-align:right;display:block;padding:12px 14px;margin-bottom:10px;border-radius:var(--r2);border:1.5px solid ${p.id===cur?'var(--blue-mid)':'var(--border)'};background:var(--surface2);cursor:pointer;font-family:var(--font)">
      <div style="font-size:14px;font-weight:700;color:var(--text)">${p.ico} ${p.title}${p.id===cur?' ✓':''}</div>
      <div style="font-size:12px;color:var(--text2);margin-top:4px;line-height:1.5">${esc(p.desc)}</div>
    </button>`).join('')+'<div id="notifEmailSection"></div>';
  renderNotifEmailSection();
}
async function saveNotifPref(pref){
  localStorage.setItem('notifPref',pref);
  try{
    const {db,doc,setDoc}=await fbInit();
    const did=localStorage.getItem('fcmDeviceId');
    if(did) await setDoc(doc(db,'fcmTokens',did),{notifPref:pref},{merge:true});
  }catch(e){console.warn('saveNotifPref failed:',e);}
  renderNotifPrefModal();
  showToast('✓ ההעדפה נשמרה',2000);
}

// A family-wide (not per-device, unlike NOTIF_PREFS above) choice to swap
// push for email on specific notification kinds — for a family that just
// doesn't want the app pushing to their phone at all, but still wants to
// know when a poll opens or someone's birthday comes up. Turning it on
// takes this family's devices OUT of push entirely (see addNotif's
// exclusion logic) — categories left unchecked below get neither push nor
// email, which the copy under the toggle spells out.
const NOTIF_EMAIL_CATS=[
  {id:'poll',ico:'🗳',label:'סקר חדש'},
  {id:'birthday',ico:'🎂',label:'ימי הולדת, יארצייט ויום נישואין'},
  {id:'expense',ico:'💳',label:'הוצאה חדשה'},
  {id:'event',ico:'📅',label:'אירוע חדש או סגירת אירוע'},
  {id:'deposit',ico:'💰',label:'הפקדה חדשה'},
  {id:'goalFund',ico:'🎯',label:'קופה חדשה למטרה'},
  {id:'siteUpdate',ico:'🆕',label:'עדכון או תכונה חדשה באתר'},
];
// Only these kinds are ever scoped to a specific family (relatedFamIds) —
// a poll, a birthday, a family-edit or a new goal fund aren't "about" any
// one family the way an event/expense/deposit is, so there's no sensible
// "רק שלי" to offer them; they're always broadcast to every opted-in family.
const NOTIF_EMAIL_SCOPED_CATS=new Set(['expense','event','deposit']);
// The email-instead-of-push preference is per REGISTERED EMAIL, not per
// family — a family with two parent emails might have one on push and one
// on email, or each on a different category set. deviceEmailSlot3 (set in
// submitEmailGate) already identifies which of the two slots this specific
// device logged in as, exactly like fcmTokens' own famId+slot pairing.
function _myEmailSlot(){
  if(_isAdminPage())return null;
  return parseInt(localStorage.getItem('deviceEmailSlot3')||'1');
}
function renderNotifEmailSection(){
  const el=document.getElementById('notifEmailSection');if(!el)return;
  const fid=_myFamId();
  const f=fid!=null?getFam(fid):null;
  const slot=_myEmailSlot();
  if(!f||!slot){el.innerHTML='';return;}
  const myEmail=slot===2?f.email2:f.email;
  const pref=f.notifEmailPref?.[slot];
  const on=!!pref;
  const cats=pref?.cats||{};
  const scopes=pref?.scopes||{};
  el.innerHTML=`<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
      <input type="checkbox" ${on?'checked':''} onchange="toggleNotifEmailMode(this.checked)">
      <span style="font-size:13px;font-weight:700;color:var(--text)">📧 קבל התראות למייל במקום פוש${myEmail?' — '+esc(myEmail):''}</span>
    </label>
    <div style="font-size:11px;color:var(--text2);margin:4px 0 10px;line-height:1.5">כשזה פעיל, המכשיר הזה מפסיק לקבל פושים — ותקבלו במייל רק את מה שמסומן למטה (מה שלא מסומן, לא יגיע בכלל). ליד קטגוריות שקשורות לאירוע ספציפי אפשר גם לבחור "הכל" או "רק שלי". ההגדרה הזו חלה רק על הכתובת שלכם${myEmail?' ('+esc(myEmail)+')':''} — לא על שאר בני המשפחה.</div>
    <div style="display:${on?'flex':'none'};flex-direction:column;gap:8px">
      ${NOTIF_EMAIL_CATS.map(c=>{
        const scoped=NOTIF_EMAIL_SCOPED_CATS.has(c.id);
        const scope=scopes[c.id]==='mine'?'mine':'all';
        return`<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text)">
          <input type="checkbox" ${cats[c.id]!==false?'checked':''} onchange="toggleNotifEmailCat('${c.id}',this.checked)">
          <span style="flex:1">${c.ico} ${c.label}</span>
          ${scoped?`<button type="button" onclick="event.preventDefault();event.stopPropagation();toggleNotifEmailScope('${c.id}')" style="border:1.5px solid var(--border);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;font-family:var(--font);cursor:pointer;flex-shrink:0;background:${scope==='mine'?'var(--blue-bg)':'var(--surface2)'};color:${scope==='mine'?'var(--blue)':'var(--text2)'}">${scope==='mine'?'רק שלי':'הכל'}</button>`:''}
        </label>`;
      }).join('')}
    </div>
  </div>`;
}
function toggleNotifEmailMode(on){
  const fid=_myFamId();const f=fid!=null?getFam(fid):null;
  const slot=_myEmailSlot();
  if(!f||!slot)return;
  if(on){
    if(!f.notifEmailPref)f.notifEmailPref={};
    if(!f.notifEmailPref[slot])f.notifEmailPref[slot]={cats:Object.fromEntries(NOTIF_EMAIL_CATS.map(c=>[c.id,true])),scopes:{}};
  }else if(f.notifEmailPref){
    delete f.notifEmailPref[slot];
    if(!Object.keys(f.notifEmailPref).length)f.notifEmailPref=null;
  }
  save();renderNotifEmailSection();
  showToast('✓ ההעדפה נשמרה',2000);
}
function toggleNotifEmailCat(catId,on){
  const fid=_myFamId();const f=fid!=null?getFam(fid):null;
  const slot=_myEmailSlot();
  const pref=(f&&slot)?f.notifEmailPref?.[slot]:null;if(!pref)return;
  pref.cats[catId]=on;
  save();
  showToast('✓ ההעדפה נשמרה',1500);
}
function toggleNotifEmailScope(catId){
  const fid=_myFamId();const f=fid!=null?getFam(fid):null;
  const slot=_myEmailSlot();
  const pref=(f&&slot)?f.notifEmailPref?.[slot]:null;if(!pref)return;
  if(!pref.scopes)pref.scopes={};
  const cur=pref.scopes[catId]==='mine'?'mine':'all';
  pref.scopes[catId]=cur==='mine'?'all':'mine';
  save();renderNotifEmailSection();
  showToast('✓ ההעדפה נשמרה',1500);
}

// Admin-only list of every registered fcmTokens doc — mainly for spotting
// stale/duplicate device registrations (see registerFCMToken's own
// same-token cleanup, which only self-heals the next time that specific
// device re-registers).
async function openNotifDevicesModal(){
  document.getElementById('notifDevicesModal').style.display='flex';
  document.getElementById('notifDevicesModalContent').innerHTML='<div style="text-align:center;padding:20px;color:var(--text2)">טוען...</div>';
  await renderNotifDevicesModal();
}
function closeNotifDevicesModal(){
  document.getElementById('notifDevicesModal').style.display='none';
}
async function renderNotifDevicesModal(){
  const el=document.getElementById('notifDevicesModalContent');if(!el)return;
  try{
    const {db,collection,getDocs}=await fbInit();
    const snap=await getDocs(collection(db,'fcmTokens'));
    const rows=[];
    snap.forEach(d=>rows.push({id:d.id,...d.data()}));
    rows.sort((a,b)=>(b.ts||0)-(a.ts||0));
    // Two docs sharing the exact same push token are a genuine duplicate —
    // the same device registered twice under different device ids. But a
    // browser tab and an installed PWA on the same physical phone get two
    // DIFFERENT tokens for the same underlying push permission — that can't
    // be deduped by token value at all, since they're genuinely different
    // subscriptions, yet it still double-fires every push. Catch that case
    // too by flagging the same family member (famId+slot) registered more
    // than once.
    const tokenCounts={},personCounts={};
    rows.forEach(r=>{
      if(r.token) tokenCounts[r.token]=(tokenCounts[r.token]||0)+1;
      if(r.famId!=null&&r.slot!=null){ const k=r.famId+':'+r.slot; personCounts[k]=(personCounts[k]||0)+1; }
    });
    const devicesHtml=rows.length?rows.map(r=>{
      const f=r.famId!=null?getFam(r.famId):null;
      const who=(f&&r.slot!=null)?_regDisplayName(f,r.slot):(r.name||(r.page==='admin'?'מנהל':(f?f.name.replace('משפחת','').trim():(r.famId!=null?'משפחה שנמחקה':'לא ידוע'))));
      // Surfacing which email this device logged in with makes it obvious,
      // right in this list, whether a surname-only entry is missing a first
      // name because that specific parent slot's name field is empty —
      // instead of that being invisible and looking like a bug.
      const regEmail=(f&&r.slot!=null)?(r.slot===2?f.email2:f.email):null;
      const dateStr=r.ts?new Date(r.ts).toLocaleString('he-IL',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
      const personKey=(r.famId!=null&&r.slot!=null)?r.famId+':'+r.slot:null;
      const isDup=(r.token&&tokenCounts[r.token]>1)||(personKey&&personCounts[personKey]>1);
      return`<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700">${esc(who)}${isDup?' <span style="font-size:10px;background:var(--red-bg);color:var(--red-mid);padding:1px 7px;border-radius:10px">כפול</span>':''}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">${r.page==='admin'?'עמוד ניהול':'עמוד משפחה'} · נרשם ${dateStr}${regEmail?' · '+esc(regEmail):''}</div>
        </div>
        <button onclick="deleteNotifDevice('${r.id}')" style="background:none;border:none;color:var(--red-mid);cursor:pointer;font-size:16px;padding:4px;flex-shrink:0" title="מחק רישום">🗑</button>
      </div>`;
    }).join(''):'<div class="empty" style="padding:20px 0"><span class="empty-ico">📱</span>אין מכשירים רשומים לפוש</div>';
    // Email is a per-REGISTERED-EMAIL choice (notifEmailPref on the family
    // record, keyed by slot 1/2 — see notifEmailSection), not a per-family
    // or per-device fcmTokens doc like the push list above, so it's listed
    // separately here, one row per opted-in email address rather than one
    // per family.
    const emailRows=[];
    families.forEach(f=>{
      if(!f.notifEmailPref)return;
      [1,2].forEach(slot=>{
        const pref=f.notifEmailPref[slot];if(!pref)return;
        emailRows.push({f,slot,pref});
      });
    });
    const emailHtml=emailRows.length?`
      <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border)">
        <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px">📧 רשומים למייל במקום פוש</div>
        ${emailRows.map(({f,slot,pref})=>{
          const who=_regDisplayName(f,slot);
          const email=(slot===2?f.email2:f.email)||'אין כתובת מייל';
          const catLabels=NOTIF_EMAIL_CATS.filter(c=>pref.cats[c.id]!==false).map(c=>{
            const scope=NOTIF_EMAIL_SCOPED_CATS.has(c.id)&&pref.scopes?.[c.id]==='mine'?' (רק שלי)':'';
            return c.ico+' '+c.label+scope;
          });
          return`<div style="padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="font-size:13px;font-weight:700">${esc(who)}</div>
            <div style="font-size:11px;color:var(--text2);margin-top:2px">${esc(email)}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:4px;line-height:1.6">${catLabels.length?esc(catLabels.join(' · ')):'לא סימנו אף קטגוריה'}</div>
          </div>`;
        }).join('')}
      </div>`:'';
    el.innerHTML=devicesHtml+emailHtml;
  }catch(e){
    el.innerHTML='<div style="padding:20px;text-align:center;color:var(--red-mid);font-size:13px">שגיאה בטעינה: '+esc(e.message||'')+'</div>';
  }
}
async function deleteNotifDevice(id){
  if(!confirm('למחוק את הרישום הזה? המכשיר יפסיק לקבל התראות עד שיירשם מחדש.'))return;
  const {db,doc,deleteDoc}=await fbInit();
  await deleteDoc(doc(db,'fcmTokens',id));
  renderNotifDevicesModal();
}

function allBirthdays(){
  const kidBdays=families.flatMap(f=>(f.kids||[]).filter(k=>k.hebDay&&k.hebMonth).map(k=>({
    name:(k.name?k.name:'ילד/ה')+' ('+f.name.replace('משפחת','').trim()+')',
    hebDay:k.hebDay,hebMonth:k.hebMonth,hebYear:k.hebYear||null,gender:k.gender||''
  })));
  const parentBdays=families.flatMap(f=>{
    const fam=f.name.replace('משפחת','').trim();
    const arr=[];
    if(f.parent1Bday&&f.parent1Bday.hebDay&&f.parent1Bday.hebMonth)arr.push({name:(f.emailName||'הורה')+' ('+fam+')',hebDay:f.parent1Bday.hebDay,hebMonth:f.parent1Bday.hebMonth,hebYear:f.parent1Bday.hebYear||null,gender:''});
    if(f.parent2Bday&&f.parent2Bday.hebDay&&f.parent2Bday.hebMonth)arr.push({name:(f.emailName2||'הורה')+' ('+fam+')',hebDay:f.parent2Bday.hebDay,hebMonth:f.parent2Bday.hebMonth,hebYear:f.parent2Bday.hebYear||null,gender:''});
    return arr;
  });
  return [...kidBdays,...parentBdays];
}
// Birthday/anniversary/yahrzeit push reminders are sent server-side now
// (api/cron/daily-backup.js, once a day) instead of from here — the old
// client-side check only ran when someone happened to have the app open
// that day, so it could silently miss the exact day if nobody did.

// Every shared collection here can be edited in place, not just appended to
// (a family's photo, an event's cost, a countdown's date...), so there's no
// single id/count to diff against — a plain JSON compare against what's
// already in memory is what actually catches an in-place change. Without
// this, a tab left open with any of these gone stale would silently
// overwrite someone else's just-saved edit the next time *anything* on that
// page calls save() — save() always pushes the whole document, including
// whatever happens to be sitting in memory. Messages are the one truly
// append-only exception (chat isn't edited after the fact), so that one
// keeps the cheaper max-id check.
function _adoptIfChanged(snapVal,getLocal,setLocal,recount){
  if(JSON.stringify(snapVal)===JSON.stringify(getLocal()))return false;
  setLocal(snapVal);
  if(recount)recount();
  return true;
}
async function startRealtimeSync(){
  if(_realtimeUnsub)return;
  try{
    const {db,doc,onSnapshot}=await fbInit();
    _realtimeUnsub=onSnapshot(doc(db,'appData','familyPayments'),snap=>{
      if(!snap.exists())return;
      const d=snap.data();
      if(!_initialSync&&!_saving){
        const snapMsgs=d.messages||[];
        const snapMax=snapMsgs.length?Math.max(...snapMsgs.map(m=>m.id)):0;
        const localMax=messages.length?Math.max(...messages.map(m=>m.id)):0;
        if(snapMax!==localMax){
          messages=snapMsgs;
          nxtMsg=messages.length?Math.max(...messages.map(m=>m.id))+1:1;
          renderMessages();
        }
        let changed=false;
        changed=_adoptIfChanged(d.families||[],()=>families,v=>families=v,
          ()=>{nxtFam=families.length?Math.max(...families.map(f=>f.id))+1:1;})||changed;
        changed=_adoptIfChanged(d.events||[],()=>events,v=>events=v,
          ()=>{nxtId=events.length?Math.max(...events.map(e=>e.id))+1:1;})||changed;
        changed=_adoptIfChanged(d.fund||{famBalances:{},transactions:[]},()=>fund,v=>fund=v,
          ()=>{if(!fund.famBalances)fund.famBalances={};nxtTx=(fund.transactions||[]).length?Math.max(...fund.transactions.map(t=>t.id))+1:1;})||changed;
        changed=_adoptIfChanged(d.goalFunds||[],()=>goalFunds,v=>goalFunds=v,
          ()=>{nxtGoal=goalFunds.length?Math.max(...goalFunds.map(g=>g.id))+1:1;})||changed;
        changed=_adoptIfChanged(d.savingsPot||{expenses:[],nxtExpId:1},()=>savingsPot,v=>savingsPot=v,
          ()=>{if(!savingsPot.nxtExpId)savingsPot.nxtExpId=(savingsPot.expenses||[]).length?Math.max(...savingsPot.expenses.map(e=>e.id))+1:1;})||changed;
        changed=_adoptIfChanged(d.calItems||[],()=>calItems,v=>calItems=v,
          ()=>{nxtCal=calItems.length?Math.max(...calItems.map(c=>c.id))+1:1;})||changed;
        changed=_adoptIfChanged(d.paymentClaims||[],()=>paymentClaims,v=>paymentClaims=v,
          ()=>{nxtClaim=paymentClaims.length?Math.max(...paymentClaims.map(c=>c.id))+1:1;})||changed;
        changed=_adoptIfChanged(d.globalSettled||[],()=>globalSettled,v=>globalSettled=v)||changed;
        changed=_adoptIfChanged(d.visits||[],()=>visits,v=>visits=v)||changed;
        changed=_adoptIfChanged(d.notifications||[],()=>notifications,v=>notifications=v,
          ()=>{nxtNotif=notifications.length?Math.max(...notifications.map(n=>n.id))+1:1;})||changed;
        changed=_adoptIfChanged(d.polls||[],()=>polls,v=>polls=v,
          ()=>{polls.forEach(_migratePoll);nxtPoll=polls.length?Math.max(...polls.map(p=>p.id))+1:1;})||changed;
        changed=_adoptIfChanged(d.countdowns||[],()=>countdowns,v=>countdowns=v,
          ()=>{nxtCountdown=countdowns.length?Math.max(...countdowns.map(c=>c.id))+1:1;})||changed;
        changed=_adoptIfChanged(d.yahrzeits||[],()=>yahrzeits,v=>yahrzeits=v,
          ()=>{nxtYahrzeit=yahrzeits.length?Math.max(...yahrzeits.map(y=>y.id))+1:1;})||changed;
        changed=_adoptIfChanged(d.familyTree||[],()=>familyTree,v=>familyTree=v,
          ()=>{nxtTreePerson=familyTree.length?Math.max(...familyTree.map(p=>p.id))+1:1;})||changed;
        changed=_adoptIfChanged(d.treeScores||{},()=>treeScores,v=>treeScores=v)||changed;
        if((d.adminPass||'')!==adminPass){adminPass=d.adminPass||'';}
        if(changed)render();
      }
      _initialSync=false;
    });
  }catch(e){console.warn('realtime sync:',e);}
}

// Auto-import expenses submitted through the shared expense form (form.html).
// Each unimported doc in `formExpenses` is added to its event as an expense
// item (attributed to the chosen family, exactly like the in-app add), then
// marked imported so it is not processed again.
let _formImportUnsub=null,_importingForms=false;
async function startFormImportSync(){
  if(_formImportUnsub)return;
  try{
    const {db,doc,setDoc,collection,onSnapshot}=await fbInit();
    _formImportUnsub=onSnapshot(collection(db,'formExpenses'),async snap=>{
      if(_importingForms)return;
      const pending=[];
      snap.forEach(dref=>{const s=dref.data();if(s&&!s.imported)pending.push({_id:dref.id,...s});});
      if(!pending.length)return;
      _importingForms=true;
      try{
        let changed=false;
        for(const sub of pending){
          const ev=events.find(e=>e.id===sub.eventId);
          if(!ev)continue; // event not loaded/deleted — leave pending, retry later
          if(!ev.expenseItems)ev.expenseItems=[];
          let added=0;
          (sub.items||[]).forEach(it=>{
            const amt=Math.round(it.amt||0);const nm=(it.name||'').toString().trim();
            if(!nm||amt<=0)return;
            ev.expItemId=(ev.expItemId||0)+1;
            const item={id:ev.expItemId,name:nm,amt,famId:sub.famId,fromForm:true};
            if(it.note)item.note=String(it.note);
            ev.expenseItems.push(item);
            _creditItemPayers(ev,item);
            added++;
          });
          if(added){changed=true;addNotif('📋',`${sub.famName||'משפחה'} שלח/ה ${added} הוצאה${added===1?'':'ות'} דרך הטופס ל"${ev.name}"`,undefined,undefined,'expense',ev.participants);}
          await setDoc(doc(db,'formExpenses',sub._id),{imported:true,importedAt:new Date().toISOString()},{merge:true});
        }
        if(changed){save();render();}
      }finally{_importingForms=false;}
    });
  }catch(e){console.warn('form import sync:',e);}
}

// Unread-count badge on the chat button, WhatsApp-style: counts messages
// from OTHERS newer than the last time the chat sheet was opened (set in
// openChatSheet), hidden entirely while the sheet is currently open.
function renderChatBadge(){
  const badge=document.getElementById('chatUnreadBadge');if(!badge)return;
  const sheetOpen=document.getElementById('chatSheet')?.classList.contains('open');
  if(sheetOpen){badge.style.display='none';return;}
  const lastSeen=parseInt(localStorage.getItem('chatLastSeen')||'0');
  const myName=_myChatName();
  const unread=messages.filter(m=>m.ts>lastSeen&&m.author!==myName).length;
  if(unread>0){badge.style.display='flex';badge.textContent=unread>99?'99+':String(unread);}
  else badge.style.display='none';
}
function renderMessages(){
  renderChatBadge();
  const el=document.getElementById('msgList');if(!el)return;
  if(!messages.length){
    el.innerHTML='<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px">עדיין אין הודעות — שלח את הראשון 💬</div>';
    return;
  }
  const myName=_myChatName();
  const timeFmt=new Intl.DateTimeFormat('he-IL',{hour:'2-digit',minute:'2-digit'});
  const dateFmt=new Intl.DateTimeFormat('he-IL',{day:'2-digit',month:'2-digit'});
  let lastDate='';
  el.innerHTML=messages.map(m=>{
    const ts=new Date(m.ts);
    const dateStr=dateFmt.format(ts);
    const timeStr=timeFmt.format(ts);
    const dateSep=dateStr!==lastDate?`<div style="text-align:center;margin:6px 0;font-size:10px;color:var(--text3)">${dateStr}</div>`:'';
    lastDate=dateStr;
    const mine=myName&&m.author===myName;
    const initials=m.author?(m.author.trim().split(' ').map(w=>w[0]||'').join('').slice(0,2).toUpperCase()):'?';
    const hue=m.author?[...m.author].reduce((h,c)=>h+c.charCodeAt(0),0)%360:180;
    const av=`<div style="width:28px;height:28px;border-radius:50%;background:hsl(${hue},45%,45%);color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0">${initials}</div>`;
    const del=mine?`<button onclick="deleteMsg(${m.id})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:11px;padding:0;opacity:.45;line-height:1">🗑</button>`:'';
    if(mine)return dateSep+`<div style="display:flex;flex-direction:column;align-items:flex-end;margin-bottom:8px">
      <div style="display:flex;align-items:flex-end;gap:6px">${av}<div style="background:var(--blue-mid);color:#fff;border-radius:14px 14px 4px 14px;padding:8px 12px;max-width:78%;word-break:break-word;font-size:14px;direction:rtl;line-height:1.4">${esc(m.text)}</div></div>
      <div style="display:flex;align-items:center;gap:4px;margin-top:2px;padding-left:34px;font-size:10px;color:var(--text3)">${timeStr} ${del}</div>
    </div>`;
    return dateSep+`<div style="display:flex;flex-direction:column;align-items:flex-start;margin-bottom:8px">
      <div style="display:flex;align-items:flex-end;gap:6px">${av}<div>${m.author?`<div style="font-size:10px;color:var(--text3);margin-bottom:2px">${esc(m.author)}</div>`:''}<div style="background:var(--surface);border:1px solid var(--border);border-radius:14px 14px 14px 4px;padding:8px 12px;max-width:78%;word-break:break-word;font-size:14px;direction:rtl;line-height:1.4">${esc(m.text)}</div></div></div>
      <div style="display:flex;align-items:center;gap:4px;margin-top:2px;padding-right:34px;font-size:10px;color:var(--text3)">${timeStr} ${del}</div>
    </div>`;
  }).join('');
  setTimeout(()=>{el.scrollTop=el.scrollHeight;},30);
}

function prevCalMonth(){
  if(calHebrew){calHebRefDate=new Date(calHebRefDate);calHebRefDate.setDate(calHebRefDate.getDate()-29);}
  else{calMonth--;if(calMonth<0){calMonth=11;calYear--;}}
  renderCalendar();
}
function nextCalMonth(){
  if(calHebrew){calHebRefDate=new Date(calHebRefDate);calHebRefDate.setDate(calHebRefDate.getDate()+29);}
  else{calMonth++;if(calMonth>11){calMonth=0;calYear++;}}
  renderCalendar();
}
function goToTodayCal(){
  const now=new Date();
  calYear=now.getFullYear();calMonth=now.getMonth();
  calHebRefDate=new Date();
  calSelDay=null;
  renderCalendar();
}

function setCalMode(hebrew){
  if(hebrew&&!calHebrew) calHebRefDate=new Date(calYear,calMonth,15);
  else if(!hebrew&&calHebrew){calYear=calHebRefDate.getFullYear();calMonth=calHebRefDate.getMonth();}
  calHebrew=hebrew;
  renderCalendar();
}

function getHebMonthDays(refDate){
  const mFmt=new Intl.DateTimeFormat('he-IL-u-ca-hebrew',{month:'long'});
  const target=mFmt.format(refDate);
  let start=new Date(refDate);
  for(let i=0;i<32;i++){
    const prev=new Date(start);prev.setDate(prev.getDate()-1);
    if(mFmt.format(prev)!==target)break;
    start=prev;
  }
  const days=[];
  let cur=new Date(start);
  while(mFmt.format(cur)===target){days.push(new Date(cur));cur=new Date(cur);cur.setDate(cur.getDate()+1);}
  return days;
}
function toHebrewYear(hy){
  const y=hy%1000;
  const ONES=['','א','ב','ג','ד','ה','ו','ז','ח','ט'];
  const TENS=['','י','כ','ל','מ','נ','ס','ע','פ','צ'];
  let s='',r=y;
  while(r>=400){s+='ת';r-=400;}
  if(r>=300){s+='ש';r-=300;}
  if(r>=200){s+='ר';r-=200;}
  if(r>=100){s+='ק';r-=100;}
  const t=Math.floor(r/10),o=r%10;
  if(t===1&&o===5)s+='טו';
  else if(t===1&&o===6)s+='טז';
  else{if(t)s+=TENS[t];if(o)s+=ONES[o];}
  return s.length===1?s+'׳':s.slice(0,-1)+'״'+s.slice(-1);
}
// Intl renders Adar as plain "אדר" in a regular year but "אדר א׳"/"אדר ב׳" in a
// leap year (which has two Adars) — a birthday/anniversary/yahrzeit saved in one
// kind of year never string-equals today's month name in the other kind, so it
// silently never matches that year. Treat any Adar variant as interchangeable:
// occasionally matching twice in a leap year is a far better failure mode than
// silently skipping the occasion for years at a time.
const _hebMonthEq=(a,b)=>a===b||(!!a&&!!b&&a.startsWith('אדר')&&b.startsWith('אדר'));
function hebrewToGregorian(hebYear,hebMonthName,hebDay){
  if(!hebYear||!hebMonthName||!hebDay)return null;
  const dayFmt=new Intl.DateTimeFormat('he-IL-u-ca-hebrew-nu-latn',{day:'numeric'});
  const monthFmt=new Intl.DateTimeFormat('he-IL-u-ca-hebrew',{month:'long'});
  const yearFmt=new Intl.DateTimeFormat('he-IL-u-ca-hebrew-nu-latn',{year:'numeric'});
  const gregYearGuess=hebYear-3760;
  const cur=new Date(gregYearGuess,0,1);
  // A Hebrew year runs 353-385 days and 1 Tishrei can fall anywhere from
  // early September to early October — a leap year (13 months, so a late
  // month like Elul lands especially late) starting on the early side of
  // that range pushes its last days past a narrower window. 200 back /
  // 600 forward comfortably covers every real case (was 150/400, which
  // silently missed some late-Elul dates in leap years — returning null
  // and quietly hiding that kid's age badge).
  cur.setDate(cur.getDate()-200);
  for(let i=0;i<600;i++){
    if(parseInt(yearFmt.format(cur))===hebYear&&monthFmt.format(cur)===hebMonthName&&parseInt(dayFmt.format(cur))===hebDay)return new Date(cur);
    cur.setDate(cur.getDate()+1);
  }
  return null;
}
function kidAge(k){
  if(!k.hebYear||!k.hebMonth||!k.hebDay)return null;
  const bd=hebrewToGregorian(k.hebYear,k.hebMonth,k.hebDay);
  if(!bd)return null;
  const today=new Date();
  let age=today.getFullYear()-bd.getFullYear();
  const m=today.getMonth()-bd.getMonth();
  if(m<0||(m===0&&today.getDate()<bd.getDate()))age--;
  return age;
}
function famAge3PlusChildCount(f){
  if(!f.kids||!f.kids.length)return f.children||0;
  return f.kids.filter(k=>{const age=kidAge(k);return age==null||age>=3;}).length;
}
function _applyCalToggleStyle(){
  const hBtn=document.getElementById('calToggleHeb');
  const lBtn=document.getElementById('calToggleLat');
  if(!hBtn||!lBtn)return;
  hBtn.style.background=calHebrew?'var(--blue-mid)':'transparent';
  hBtn.style.color=calHebrew?'#fff':'var(--text2)';
  lBtn.style.background=!calHebrew?'var(--blue-mid)':'transparent';
  lBtn.style.color=!calHebrew?'#fff':'var(--text2)';
}
function renderCalendar(){
  const gridEl=document.getElementById('calGrid');
  const titleEl=document.getElementById('calTitle');
  if(!gridEl)return;
  _applyCalToggleStyle();
  const todayStr=new Date().toISOString().slice(0,10);
  const _allBdays=allBirthdays();
  const _allYahr=allYahrzeits();
  const _allAnniv=allAnniversaries();
  const bdayByDate={};
  const yahrByDate={};
  const annivByDate={};
  let html='';
  let hebDays=null;
  if(calHebrew){
    hebDays=getHebMonthDays(calHebRefDate);
    const first=hebDays[0];
    const hebMonth=new Intl.DateTimeFormat('he-IL-u-ca-hebrew',{month:'long'}).format(first);
    const hebYearNum=parseInt(new Intl.DateTimeFormat('he-IL-u-ca-hebrew-nu-latn',{year:'numeric'}).format(first));
    titleEl.textContent=hebMonth+' '+toHebrewYear(hebYearNum);
    html=HEB_DAYS_SHORT.map(d=>`<div class="fh-cal-dow">${d}</div>`).join('');
    for(let i=0;i<first.getDay();i++)html+=`<div class="fh-cal-day other-m empty"></div>`;
    for(const dayDate of hebDays){
      const ds=dayDate.toISOString().slice(0,10);
      const hebDayNumInt=parseInt(new Intl.DateTimeFormat('he-IL-u-ca-hebrew-nu-latn',{day:'numeric'}).format(dayDate));
      const label=HEB_DAY_NUM[hebDayNumInt]||String(hebDayNumInt);
      const hebMonthName=new Intl.DateTimeFormat('he-IL-u-ca-hebrew',{month:'long'}).format(dayDate);
      const isToday=ds===todayStr;
      const isSel=calSelDay===ds&&!isToday;
      const evOnDay=calItems.filter(c=>c.date===ds);
      const bdayOnDay=_allBdays.filter(b=>b.hebDay===hebDayNumInt&&_hebMonthEq(b.hebMonth,hebMonthName));
      const yahrOnDay=_allYahr.filter(y=>y.hebDay===hebDayNumInt&&_hebMonthEq(y.hebMonth,hebMonthName));
      const annivOnDay=_allAnniv.filter(a=>a.hebDay===hebDayNumInt&&_hebMonthEq(a.hebMonth,hebMonthName));
      if(bdayOnDay.length)bdayByDate[ds]=bdayOnDay;
      if(yahrOnDay.length)yahrByDate[ds]=yahrOnDay;
      if(annivOnDay.length)annivByDate[ds]=annivOnDay;
      const hasEv=evOnDay.length>0;const hasBday=bdayOnDay.length>0;const hasYahr=yahrOnDay.length>0;const hasAnniv=annivOnDay.length>0;
      const cls=['fh-cal-day',isToday?'today':'',isSel?'sel':'',hasEv?'has-ev':(hasBday?'has-bday':(hasYahr?'has-yahrzeit':(hasAnniv?'has-anniv':'')))].filter(Boolean).join(' ');
      html+=`<div class="${cls}" onclick="selectCalDay('${ds}')">
        <span style="font-size:10px;line-height:1">${label}</span>
        ${hasEv?`<span class="fh-cal-day-ev">${evOnDay.map(c=>c.title.slice(0,5)).join(',')}</span>`:''}
        ${!hasEv&&hasBday?`<span class="fh-cal-day-ev" style="color:#c0392b">🎂${bdayOnDay.map(b=>b.name.slice(0,4)).join(',')}</span>`:''}
        ${!hasEv&&!hasBday&&hasYahr?`<span class="fh-cal-day-ev" style="color:#555">🕯️${yahrOnDay.map(y=>y.name.slice(0,4)).join(',')}</span>`:''}
        ${!hasEv&&!hasBday&&!hasYahr&&hasAnniv?`<span class="fh-cal-day-ev" style="color:#B8860B">💍${annivOnDay.map(a=>a.name.slice(0,4)).join(',')}</span>`:''}
      </div>`;
    }
  } else {
    titleEl.textContent=HEB_MONTHS[calMonth]+' '+calYear;
    html=LAT_DAYS_SHORT.map(d=>`<div class="fh-cal-dow">${d}</div>`).join('');
    const firstDay=new Date(calYear,calMonth,1).getDay();
    const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
    for(let i=0;i<firstDay;i++)html+=`<div class="fh-cal-day other-m empty"></div>`;
    for(let d=1;d<=daysInMonth;d++){
      const ds=`${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayDate=new Date(calYear,calMonth,d);
      const hebDayNumInt=parseInt(new Intl.DateTimeFormat('he-IL-u-ca-hebrew-nu-latn',{day:'numeric'}).format(dayDate));
      const hebMonthName=new Intl.DateTimeFormat('he-IL-u-ca-hebrew',{month:'long'}).format(dayDate);
      const isToday=ds===todayStr;
      const isSel=calSelDay===ds&&!isToday;
      const evOnDay=calItems.filter(c=>c.date===ds);
      const bdayOnDay=_allBdays.filter(b=>b.hebDay===hebDayNumInt&&_hebMonthEq(b.hebMonth,hebMonthName));
      const yahrOnDay=_allYahr.filter(y=>y.hebDay===hebDayNumInt&&_hebMonthEq(y.hebMonth,hebMonthName));
      const annivOnDay=_allAnniv.filter(a=>a.hebDay===hebDayNumInt&&_hebMonthEq(a.hebMonth,hebMonthName));
      if(bdayOnDay.length)bdayByDate[ds]=bdayOnDay;
      if(yahrOnDay.length)yahrByDate[ds]=yahrOnDay;
      if(annivOnDay.length)annivByDate[ds]=annivOnDay;
      const hasEv=evOnDay.length>0;const hasBday=bdayOnDay.length>0;const hasYahr=yahrOnDay.length>0;const hasAnniv=annivOnDay.length>0;
      const cls=['fh-cal-day',isToday?'today':'',isSel?'sel':'',hasEv?'has-ev':(hasBday?'has-bday':(hasYahr?'has-yahrzeit':(hasAnniv?'has-anniv':'')))].filter(Boolean).join(' ');
      html+=`<div class="${cls}" onclick="selectCalDay('${ds}')">
        <span style="font-size:12px;line-height:1">${d}</span>
        ${hasEv?`<span class="fh-cal-day-ev">${evOnDay.map(c=>c.title.slice(0,5)).join(',')}</span>`:''}
        ${!hasEv&&hasBday?`<span class="fh-cal-day-ev" style="color:#c0392b">🎂${bdayOnDay.map(b=>b.name.slice(0,4)).join(',')}</span>`:''}
        ${!hasEv&&!hasBday&&hasYahr?`<span class="fh-cal-day-ev" style="color:#555">🕯️${yahrOnDay.map(y=>y.name.slice(0,4)).join(',')}</span>`:''}
        ${!hasEv&&!hasBday&&!hasYahr&&hasAnniv?`<span class="fh-cal-day-ev" style="color:#B8860B">💍${annivOnDay.map(a=>a.name.slice(0,4)).join(',')}</span>`:''}
      </div>`;
    }
  }
  gridEl.innerHTML=html;
  renderCalEvList(hebDays,bdayByDate,yahrByDate,annivByDate);
}

function selectCalDay(ds){
  calSelDay=calSelDay===ds?null:ds;
  renderCalendar();
}

function renderCalEvList(hebDays,bdayByDate,yahrByDate,annivByDate){
  const el=document.getElementById('calEvList');if(!el)return;
  bdayByDate=bdayByDate||{};
  yahrByDate=yahrByDate||{};
  annivByDate=annivByDate||{};
  let dateFilter;
  if(calSelDay){
    dateFilter=ds=>ds===calSelDay;
  } else if(hebDays){
    const ds=new Set(hebDays.map(d=>d.toISOString().slice(0,10)));
    dateFilter=d=>ds.has(d);
  } else {
    const monthStr=`${calYear}-${String(calMonth+1).padStart(2,'0')}`;
    dateFilter=d=>d.startsWith(monthStr);
  }
  const evList=calItems.filter(c=>dateFilter(c.date)).map(c=>({type:'ev',date:c.date,item:c}));
  const bdayList=Object.entries(bdayByDate).filter(([ds])=>dateFilter(ds))
    .flatMap(([ds,bdays])=>bdays.map(b=>({type:'bday',date:ds,item:b})));
  const yahrList=Object.entries(yahrByDate).filter(([ds])=>dateFilter(ds))
    .flatMap(([ds,yahrs])=>yahrs.map(y=>({type:'yahrzeit',date:ds,item:y})));
  const annivList=Object.entries(annivByDate).filter(([ds])=>dateFilter(ds))
    .flatMap(([ds,annivs])=>annivs.map(a=>({type:'anniversary',date:ds,item:a})));
  const list=[...evList,...bdayList,...yahrList,...annivList].sort((a,b)=>a.date.localeCompare(b.date));
  if(!list.length){el.innerHTML='';return;}
  el.innerHTML=list.map(({type,date,item})=>{
    const d=new Date(date+'T00:00:00');
    const latDayFmt=new Intl.DateTimeFormat('he-IL-u-ca-hebrew-nu-latn',{day:'numeric'});
    const monthFmt=new Intl.DateTimeFormat('he-IL-u-ca-hebrew',{month:'long'});
    const latF=new Intl.DateTimeFormat('he-IL-u-ca-hebrew-nu-latn',{year:'numeric'});
    const hebYNum=parseInt(latF.format(d));
    const lbl=calHebrew
      ?HEB_DAY_NUM[parseInt(latDayFmt.format(d))]+' ב'+monthFmt.format(d)+' '+toHebrewYear(hebYNum)
      :d.toLocaleDateString('he-IL',{day:'numeric',month:'long'});
    if(type==='bday'){
      const age=item.hebYear?(hebYNum-item.hebYear):null;
      const balloon=(age!=null&&age>0&&age<=18)?`<span class="bday-balloon">${esc(item.gender==='boy'?'בן '+age:item.gender==='girl'?'בת '+age:String(age))}</span>`:'';
      return`<div class="fh-cal-ev">
        <div class="fh-cal-ev-dot" style="background:#c0392b"></div>
        <div class="fh-cal-ev-info">
          <div class="fh-cal-ev-name">🎂 ${esc(item.name)}${balloon} — יום הולדת</div>
          <div class="fh-cal-ev-date">${lbl}</div>
        </div>
      </div>`;
    }
    if(type==='yahrzeit'){
      const years=item.hebYear?(_currentHebYear()-item.hebYear):null;
      // Deliberately open to everyone, not just admins — unlike the
      // anniversary button below, this only ever touches the yahrzeit
      // entry itself (never a whole family's details).
      return`<div class="fh-cal-ev">
        <div class="fh-cal-ev-dot" style="background:#555"></div>
        <div class="fh-cal-ev-info">
          <div class="fh-cal-ev-name">🕯️ ${esc(item.name)} — יארצייט${years!=null&&years>0?' ('+years+' שנים)':''}</div>
          <div class="fh-cal-ev-date">${lbl}</div>
        </div>
        <button onclick="openYahrzeitModal(${item.id})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:13px;padding:0 4px;opacity:.5">✏️</button>
        <button onclick="deleteYahrzeit(${item.id})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:16px;padding:0 4px;opacity:.5">✕</button>
      </div>`;
    }
    if(type==='anniversary'){
      const years=item.hebYear?(_currentHebYear()-item.hebYear):null;
      // item.id is the family's own id (see allAnniversaries) — this button
      // opens the FULL family edit sheet, not just the anniversary, so it's
      // admin-or-own-family only, same as everywhere else that link appears.
      const canEdit=editMode||_myFamId()===item.id;
      return`<div class="fh-cal-ev">
        <div class="fh-cal-ev-dot" style="background:#B8860B"></div>
        <div class="fh-cal-ev-info">
          <div class="fh-cal-ev-name">💍 ${esc(item.name)} — יום נישואין${years!=null&&years>0?' ('+years+' שנים)':''}</div>
          <div class="fh-cal-ev-date">${lbl}</div>
        </div>
        ${canEdit?`<button onclick="openFamEditSheet(${item.id})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:13px;padding:0 4px;opacity:.5">✏️</button>`:''}
      </div>`;
    }
    return`<div class="fh-cal-ev">
      <div class="fh-cal-ev-dot" style="background:${item.color||'var(--blue-mid)'}"></div>
      <div class="fh-cal-ev-info">
        <div class="fh-cal-ev-name">${esc(item.title)}</div>
        <div class="fh-cal-ev-date">${lbl}</div>
      </div>
      <button onclick="deleteCalItem(${item.id})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:16px;padding:0 4px;opacity:.5">✕</button>
    </div>`;
  }).join('');
}

function addCalItem(){
  const tEl=document.getElementById('calAddTitle');
  const dEl=document.getElementById('calAddDate');
  const title=tEl.value.trim();
  const date=dEl.value;
  if(!title||!date)return;
  const colors=['#1E88D8','#1D9E75','#E53935','#8E24AA','#F4511E','#F6BF26'];
  const color=colors[calItems.length%colors.length];
  calItems.push({id:nxtCal++,title,date,color});
  save();renderCalendar();
  closeCalModal();
}

function deleteCalItem(id){
  if(!confirm('למחוק אירוע זה?'))return;
  calItems=calItems.filter(c=>c.id!==id);
  save();renderCalendar();
}

function startEditCost(evId){
  const ev=events.find(e=>e.id===evId);if(!ev||ev.totalCost==null)return;
  const dispEl=document.getElementById('costdisp-'+evId);if(!dispEl)return;
  const inp=document.createElement('input');
  inp.type='number';inp.value=ev.totalCost;
  inp.style.cssText='width:90px;font-size:15px;font-weight:700;color:var(--green-mid);border:1.5px solid var(--blue-mid);border-radius:6px;padding:2px 6px;font-family:var(--font);background:var(--bg);direction:ltr';
  inp.onblur=()=>saveCostEdit(evId,inp.value);
  inp.onkeydown=e=>{if(e.key==='Enter')inp.blur();if(e.key==='Escape'){inp.replaceWith(dispEl);}};
  dispEl.replaceWith(inp);
  inp.focus();inp.select();
}
function saveCostEdit(evId,val){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  const newCost=parseFloat(val)||0;
  ev.totalCost=newCost;
  save();render();
}

function _myFamId(){
  const id=localStorage.getItem('deviceFamId3');
  return id?parseInt(id):null;
}
// A goal fund created with families picked to keep it a surprise (e.g. a
// gift) — those specific families see nothing about it anywhere, including
// in aggregate totals, while everyone else (and always the admin) sees it
// normally.
const _visibleGoalFunds=list=>{
  if(editMode)return list;
  const myId=_myFamId();
  return list.filter(g=>!(g.hiddenFrom||[]).includes(myId));
};
// A poll created with families picked to stay out of it entirely (mirrors
// goal funds' hiddenFrom above) — those specific families see nothing about
// it anywhere, including the home "poll waiting" banner, while everyone
// else (and always the admin) sees it normally.
const _visiblePolls=list=>{
  if(editMode)return list;
  const myId=_myFamId();
  return list.filter(p=>!(p.hiddenFrom||[]).includes(myId));
};
// A question with a showIf only appears for a given family once they've
// answered its condition question with the matching option — everyone else
// (and a question with no showIf at all) just sees it normally.
function _pollVisibleQuestions(p,famId){
  const myVotes=(famId!=null&&p.votes[String(famId)])||{};
  return p.questions.filter(q=>!q.showIf||myVotes[q.showIf.qId]===q.showIf.optIdx);
}
// Families who owe an equal share of this goal fund: everyone who can see
// it (not in hiddenFrom) MINUS anyone marked as not participating in the
// payment (g.nonPayers) — those still see the fund and its progress
// normally, they're just left out of the split and the "who paid"/reminder
// flows, unlike hiddenFrom which hides the fund's existence entirely.
const _goalPayers=g=>families.filter(f=>!(g.hiddenFrom||[]).includes(f.id)&&!(g.nonPayers||[]).includes(f.id));
// How much a family still owes toward its equal share of a goal fund (0 if
// the fund has no target, the family isn't a payer, or it already covered
// its share) — used to cap the deposit sheet's wallet-transfer suggestion
// so it doesn't default to the family's ENTIRE wallet balance regardless
// of what the fund actually still needs from them.
function _goalOwedAmt(g,famId){
  // A family that already bought the gift itself owes nothing further —
  // and deliberately isn't removed from the payer pool for this (see
  // renderGoalPayModal), so everyone ELSE's per-family share stays exactly
  // what it would've been regardless of who bought the gift.
  if(famId===g.boughtBy)return 0;
  const eligible=_goalPayers(g);
  if(!eligible.some(f=>f.id===famId))return 0;
  const perFamily=g.target>0&&eligible.length?Math.ceil(g.target/eligible.length):0;
  if(perFamily<=0)return 0;
  return Math.max(0,perFamily-(g.contributions[famId]||0));
}
// Once a family is marked as having bought the gift itself, their own equal
// share is permanently exempted (see _goalOwedAmt) — so the fund can never
// actually collect g.target itself, only target-minus-their-share. This is
// purely a DISPLAY figure (progress bar / "collected out of" / reached%),
// never used for the real perFamily split, which must keep using the full
// g.target so everyone else's share stays exactly what it always was.
function _goalDisplayTarget(g){
  if(!g.boughtBy||!g.target)return g.target;
  const eligible=_goalPayers(g);
  if(!eligible.some(f=>f.id===g.boughtBy))return g.target;
  const perFamily=eligible.length?Math.ceil(g.target/eligible.length):0;
  return Math.max(0,g.target-perFamily);
}
// Shared by the goal fund's own detail view (goalPayGiftInfo) and its
// deposit sheet — a small card of whichever gift-detail fields were filled
// in when the fund was created (all optional), or nothing at all.
function _goalGiftInfoHtml(g){
  const rows=[
    g.recipient?['🎁 מי מקבל',g.recipient]:null,
    g.gift?['🎀 מה המתנה',g.gift]:null,
    g.notes?['📝 הערות',g.notes]:null,
  ].filter(Boolean);
  if(!rows.length)return'';
  return`<div style="background:var(--surface2);border-radius:var(--r2);padding:10px 12px;margin-bottom:12px">
    ${rows.map(([lbl,val])=>`<div style="font-size:12px;margin-bottom:4px"><span style="color:var(--text2);font-weight:700">${lbl}:</span> <span style="color:var(--text)">${esc(val)}</span></div>`).join('')}
  </div>`;
}
function _fundTxForDisplay(){
  if(_isAdminPage())return fund.transactions;
  const fid=_myFamId();
  if(fid==null)return fund.transactions;
  return fund.transactions.filter(t=>Number(t.famId)===fid);
}
function renderPollBanner(){
  const btn=document.getElementById('pollBannerBtn');if(!btn)return;
  const openPolls=_visiblePolls(polls).filter(p=>!p.closed);
  if(!openPolls.length){btn.style.display='none';return;}
  const fid=_myFamId();
  // "Waiting to be filled" if any currently-visible question (including one
  // just revealed by an earlier answer) hasn't been answered yet.
  const myVotes=v=>(fid!=null&&v.votes[String(fid)])||{};
  const unanswered=p=>fid==null||_pollVisibleQuestions(p,fid).some(q=>myVotes(p)[q.id]==null);
  const poll=openPolls.find(unanswered)||openPolls[0];
  const voted=fid!=null&&!unanswered(poll);
  const lbl=document.getElementById('pollBannerLbl');
  if(lbl)lbl.textContent=voted?'תוצאות הסקר (בינתיים)':'סקר ממתין למילוי';
  btn.style.display='flex';
}
function openPollSheet(){
  const s=document.getElementById('pollSheet');if(!s)return;
  s.classList.add('open');
  renderPollList();
}
function closePollSheet(){
  const s=document.getElementById('pollSheet');if(s)s.classList.remove('open');
}
let _pollEditId=null;
let _pollHideFamIds=new Set();
// The in-progress question list while the poll form is open — each item is
// {text, options:[...], showIf:null|{qIdx,optIdx}} where qIdx/optIdx are
// plain array INDEXES into _pollFormQuestions (not yet the saved question
// ids), since questions can be reordered/removed while editing. Resolved to
// real {qId,optIdx} pairs only in saveNewPoll(). Only a question ABOVE a
// given one in the list can be picked as its condition, so a poll always
// reads top-to-bottom with no forward/circular references.
let _pollFormQuestions=[];
function openNewPollModal(id){
  _pollEditId=id??null;
  const p=id!=null?polls.find(x=>x.id===id):null;
  _pollFormQuestions=p?p.questions.map(q=>({
    text:q.text,options:[...q.options],
    showIf:q.showIf?{qIdx:p.questions.findIndex(x=>x.id===q.showIf.qId),optIdx:q.showIf.optIdx}:null
  })):[{text:'',options:['',''],showIf:null}];
  _renderPollFormQuestions();
  document.getElementById('pollErr').style.display='none';
  const anonEl=document.getElementById('pollAnon');
  if(anonEl)anonEl.checked=p?!!p.anonymous:false;
  _pollHideFamIds=new Set(p?.hiddenFrom||[]);
  _updatePollHideCount();
  const titleEl=document.getElementById('newPollModalTitle');
  if(titleEl)titleEl.textContent=p?'✏️ עריכת סקר':'🗳 סקר חדש';
  const btnEl=document.getElementById('pollSaveBtn');
  if(btnEl)btnEl.textContent=p?'✓ שמור שינויים':'✓ צור סקר';
  document.getElementById('newPollModal').style.display='flex';
}
function closeNewPollModal(){
  document.getElementById('newPollModal').style.display='none';
  _pollEditId=null;
}
function _renderPollFormQuestions(){
  const wrap=document.getElementById('pollQuestionsWrap');if(!wrap)return;
  wrap.innerHTML=_pollFormQuestions.map((q,qi)=>{
    const priorQs=_pollFormQuestions.slice(0,qi);
    const condSection=qi===0?'':`
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:10px;font-size:12px;color:var(--text2)">
        <input type="checkbox" ${q.showIf?'checked':''} onchange="togglePollFormCond(${qi},this.checked)">
        <span>הצג שאלה זו רק אם ענו תשובה מסוימת בשאלה קודמת</span>
      </label>
      ${q.showIf?`<div style="display:flex;gap:6px;margin-top:6px">
        <select onchange="setPollFormCondQ(${qi},this.value)" style="flex:1;border:1.5px solid var(--border);border-radius:var(--r2);padding:6px 8px;font-size:12px;font-family:var(--font);background:var(--bg);color:var(--text)">
          ${priorQs.map((pq,pi)=>`<option value="${pi}" ${q.showIf.qIdx===pi?'selected':''}>${esc(pq.text||'שאלה '+(pi+1))}</option>`).join('')}
        </select>
        <select onchange="setPollFormCondOpt(${qi},this.value)" style="flex:1;border:1.5px solid var(--border);border-radius:var(--r2);padding:6px 8px;font-size:12px;font-family:var(--font);background:var(--bg);color:var(--text)">
          ${(_pollFormQuestions[q.showIf.qIdx]?.options||[]).map((opt,oi)=>`<option value="${oi}" ${q.showIf.optIdx===oi?'selected':''}>${esc(opt||'אפשרות '+(oi+1))}</option>`).join('')}
        </select>
      </div>`:''}`;
    return`<div style="border:1.5px solid var(--border);border-radius:var(--r2);padding:10px;margin-bottom:10px">
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
        <input type="text" value="${esc(q.text)}" placeholder="שאלה ${qi+1}" oninput="setPollFormQText(${qi},this.value)" style="flex:1;border:1.5px solid var(--border);border-radius:var(--r2);padding:8px 10px;font-size:14px;font-family:var(--font);background:var(--bg);color:var(--text);box-sizing:border-box">
        ${_pollFormQuestions.length>1?`<button type="button" onclick="removePollFormQuestion(${qi})" style="background:none;border:none;color:var(--red-mid,#c33);cursor:pointer;font-size:16px;padding:4px;flex-shrink:0">🗑</button>`:''}
      </div>
      ${q.options.map((opt,oi)=>`<input type="text" value="${esc(opt)}" placeholder="אפשרות ${oi+1}" oninput="setPollFormOptText(${qi},${oi},this.value)" style="width:100%;border:1.5px solid var(--border);border-radius:var(--r2);padding:8px 10px;font-size:13px;font-family:var(--font);background:var(--bg);color:var(--text);box-sizing:border-box;margin-bottom:6px">`).join('')}
      <button type="button" onclick="addPollFormOption(${qi})" style="width:100%;padding:7px;border-radius:var(--r2);border:1.5px dashed var(--border);background:transparent;color:var(--text2);font-size:12px;font-weight:600;font-family:var(--font);cursor:pointer">➕ הוסף אפשרות</button>
      ${condSection}
    </div>`;
  }).join('');
}
function setPollFormQText(qi,v){_pollFormQuestions[qi].text=v;}
function setPollFormOptText(qi,oi,v){_pollFormQuestions[qi].options[oi]=v;}
function addPollFormOption(qi){_pollFormQuestions[qi].options.push('');_renderPollFormQuestions();}
function addPollFormQuestion(){_pollFormQuestions.push({text:'',options:['',''],showIf:null});_renderPollFormQuestions();}
function removePollFormQuestion(qi){
  _pollFormQuestions.splice(qi,1);
  // Any later question's condition pointing at the removed one (or shifted
  // by the removal) needs fixing up so indexes stay valid.
  _pollFormQuestions.forEach(q=>{
    if(!q.showIf)return;
    if(q.showIf.qIdx===qi)q.showIf=null;
    else if(q.showIf.qIdx>qi)q.showIf.qIdx--;
  });
  _renderPollFormQuestions();
}
function togglePollFormCond(qi,on){
  _pollFormQuestions[qi].showIf=on?{qIdx:0,optIdx:0}:null;
  _renderPollFormQuestions();
}
function setPollFormCondQ(qi,val){
  _pollFormQuestions[qi].showIf.qIdx=parseInt(val);
  _pollFormQuestions[qi].showIf.optIdx=0;
  _renderPollFormQuestions();
}
function setPollFormCondOpt(qi,val){
  _pollFormQuestions[qi].showIf.optIdx=parseInt(val);
}
// Picks which families won't see this poll at all (mirrors the goal fund's
// own hide picker) — a small dedicated chip popup rather than the goal
// fund's, since that one is scoped to its own two hide/non-payer targets.
function openPollHidePicker(){
  _renderPollHideChips();
  document.getElementById('pollHideFamModal').style.display='flex';
}
function closePollHidePicker(){
  document.getElementById('pollHideFamModal').style.display='none';
  _updatePollHideCount();
}
function _renderPollHideChips(){
  const el=document.getElementById('pollHideFamChips');if(!el)return;
  el.innerHTML=families.map(f=>
    `<button type="button" class="chip ${_pollHideFamIds.has(f.id)?'on':''}" onclick="togglePollHideFam(${f.id})">${esc(f.name.replace('משפחת','').trim())}</button>`
  ).join('');
}
function togglePollHideFam(fid){
  if(_pollHideFamIds.has(fid))_pollHideFamIds.delete(fid);else _pollHideFamIds.add(fid);
  _renderPollHideChips();
}
function _updatePollHideCount(){
  const el=document.getElementById('pollHideCount');
  if(el)el.textContent=_pollHideFamIds.size?` (${_pollHideFamIds.size})`:'';
}
function saveNewPoll(){
  const err=document.getElementById('pollErr');
  const cleaned=_pollFormQuestions.map(q=>({
    text:q.text.trim(),
    options:q.options.map(o=>o.trim()).filter(Boolean),
    showIf:q.showIf
  }));
  if(!cleaned.length||cleaned.some(q=>!q.text||q.options.length<2)){err.style.display='block';return;}
  err.style.display='none';
  const anonymous=!!document.getElementById('pollAnon')?.checked;
  const hiddenFrom=[..._pollHideFamIds];
  // Assign stable sequential ids, then resolve each showIf's array index
  // into the actual id of the question it points at.
  const questions=cleaned.map((q,i)=>({id:i+1,text:q.text,options:q.options,showIf:null}));
  cleaned.forEach((q,i)=>{if(q.showIf)questions[i].showIf={qId:questions[q.showIf.qIdx].id,optIdx:q.showIf.optIdx};});
  if(_pollEditId!=null){
    const p=polls.find(x=>x.id===_pollEditId);
    if(p){p.questions=questions;p.anonymous=anonymous;p.hiddenFrom=hiddenFrom;}
    _pollEditId=null;
    save();closeNewPollModal();renderPollList();
    return;
  }
  polls.unshift({id:nxtPoll++,questions,votes:{},createdAt:Date.now(),closed:false,anonymous,hiddenFrom});
  addNotif('🗳','נוצר סקר חדש: "'+questions[0].text+'"',undefined,hiddenFrom,'poll');
  save();closeNewPollModal();renderPollList();
}
function votePoll(pollId,qId,optIdx){
  const p=polls.find(x=>x.id===pollId);if(!p||p.closed)return;
  const fid=_myFamId();if(fid==null){alert('לא זוהתה משפחה במכשיר זה');return;}
  if(!p.votes[String(fid)])p.votes[String(fid)]={};
  p.votes[String(fid)][qId]=optIdx;
  save();renderPollList();
}
function togglePollClosed(pollId){
  const p=polls.find(x=>x.id===pollId);if(!p)return;
  p.closed=!p.closed;
  save();renderPollList();
}
function deletePoll(pollId){
  if(!confirm('למחוק סקר זה?'))return;
  polls=polls.filter(p=>p.id!==pollId);
  save();renderPollList();
}
function renderPollList(){
  const el=document.getElementById('pollList');if(!el)return;
  const list=_visiblePolls(polls);
  if(!list.length){
    el.innerHTML='<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px">עדיין אין סקרים — צור את הראשון 🗳</div>';
    return;
  }
  const myFid=_myFamId();
  el.innerHTML=list.map(p=>{
    const myVotes=(myFid!=null&&p.votes[String(myFid)])||{};
    const visibleQs=_pollVisibleQuestions(p,myFid);
    const isMulti=p.questions.length>1;
    // Anonymous polls hide who-voted-what from everyone except the admin —
    // regular viewers still see the aggregate counts/percentages, just not
    // the per-option voter names.
    const canSeeVoters=!p.anonymous||editMode;
    // "Respondents" for the footer count is measured against the first
    // question — every family that got this far answered it, regardless of
    // how many later (possibly conditional) questions they reached.
    const respondents=Object.values(p.votes).filter(v=>v[p.questions[0].id]!=null).length;
    const questionsHtml=visibleQs.map(q=>{
      const totalVotes=Object.values(p.votes).filter(v=>v[q.id]!=null).length;
      const myVote=myVotes[q.id];
      const showResults=p.closed||myVote!=null;
      const votersFor=i=>Object.entries(p.votes).filter(([,v])=>v[q.id]===i)
        .map(([fid])=>{const f=getFam(parseInt(fid));return f?f.name.replace('משפחת','').trim():'?';});
      const optsHtml=q.options.map((opt,i)=>{
        const count=Object.values(p.votes).filter(v=>v[q.id]===i).length;
        const pct=totalVotes?Math.round(count/totalVotes*100):0;
        if(showResults){
          const mine=myVote===i;
          const voterNames=canSeeVoters&&count>0?`<div style="font-size:11px;color:var(--text3);margin-top:2px">${votersFor(i).map(esc).join(', ')}</div>`:'';
          return`<div style="margin-bottom:6px">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px">
              <span style="font-weight:${mine?'800':'600'};color:${mine?'#7C3AED':'var(--text)'}">${esc(opt)}${mine?' ✓':''}</span>
              <span style="color:var(--text2)">${pct}% (${count})</span>
            </div>
            <div style="background:var(--surface2);border-radius:6px;height:8px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${mine?'#7C3AED':'#C4B5FD'}"></div></div>
            ${voterNames}
          </div>`;
        }
        return`<button onclick="votePoll(${p.id},${q.id},${i})" style="display:block;width:100%;text-align:right;padding:8px 10px;margin-bottom:6px;border-radius:var(--r2);border:1.5px solid var(--border);background:transparent;color:var(--text);font-size:13px;font-weight:600;font-family:var(--font);cursor:pointer">${esc(opt)}</button>`;
      }).join('');
      return`<div style="margin-bottom:12px">
        ${isMulti?`<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:6px">${esc(q.text)}</div>`:''}
        ${optsHtml}
      </div>`;
    }).join('');
    return`<div style="background:var(--surface2);border-radius:var(--r2);padding:12px;margin-bottom:10px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px">
        <div style="font-size:14px;font-weight:800;color:var(--text);flex:1">${isMulti?'🗳 סקר':esc(p.questions[0].text)}${isMulti?` <span style="font-size:10px;font-weight:700;color:var(--text3);background:var(--bg);padding:1px 7px;border-radius:10px">${p.questions.length} שאלות</span>`:''}${p.anonymous?' <span style="font-size:10px;font-weight:700;color:var(--text3);background:var(--bg);padding:1px 7px;border-radius:10px">🕶️ אנונימי</span>':''}${p.closed?' <span style="font-size:10px;font-weight:700;color:var(--text3);background:var(--bg);padding:1px 7px;border-radius:10px">סגור</span>':''}</div>
      </div>
      ${questionsHtml}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
        <div style="font-size:11px;color:var(--text3)">${respondents} הצביעו</div>
        <div style="display:flex;gap:10px">
          <button class="edit-only" onclick="togglePollClosed(${p.id})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:11px;font-family:var(--font)">${p.closed?'↻ פתח מחדש':'✓ סגור סקר'}</button>
          <button onclick="openNewPollModal(${p.id})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:11px;font-family:var(--font)">✏️ ערוך</button>
          <button onclick="deletePoll(${p.id})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:11px;font-family:var(--font)">🗑 מחק</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderHome(){
  const open=events.filter(e=>e.open);

  // ── Banner ──
  const mainBal=fundTotal();
  const goalBal=_visibleGoalFunds(goalFunds.filter(g=>!g.archived)).reduce((s,g)=>s+goalTotal(g),0);
  const evPotsBal=open.reduce((s,ev)=>s+evNetPotBal(ev),0);
  const savBal=savingsPotBal();
  // Savings still shows as its own stat below, just left out of the total —
  // it's money already set aside for something specific, not spare balance.
  const allBal=mainBal+goalBal+evPotsBal;
  const bannerStats=[
    {label:'ארנק',amt:mainBal},
    ...(goalBal>0?[{label:'קופות מטרה',amt:goalBal}]:[]),
    ...(evPotsBal>0?[{label:'קופות אירועים',amt:evPotsBal}]:[]),
    ...(savBal>0?[{label:'קופת חיסכון',amt:savBal}]:[]),
  ];
  document.getElementById('homeBanner').innerHTML=`
    <div class="home-banner" onclick="openFundDetail()" style="cursor:pointer">
      <div class="home-banner-lbl">סך כל הקופות</div>
      <div class="home-banner-amt">₪${allBal.toLocaleString()}</div>
      ${bannerStats.length>1?`<div class="home-banner-row">${bannerStats.map(s=>`
        <div class="home-bstat">
          <div class="home-bstat-val">₪${s.amt.toLocaleString()}</div>
          <div class="home-bstat-lbl">${s.label}</div>
        </div>`).join('')}</div>`:''}
    </div>`;

  // ── Families strip ──
  const famNet={};
  families.forEach(f=>{ famNet[f.id]=0; });
  open.forEach(ev=>{
    const bal=evAdjBalance(ev);
    ev.participants.forEach(fid=>{ const b=bal[fid]||0; if(Math.abs(b)>0.5) famNet[fid]=(famNet[fid]||0)+b; });
  });
  // An unpaid goal-fund share is a debt too — fold it in the same way an
  // event debt is, so a family that's "מסודר" on every event but still
  // owes a goal fund doesn't wrongly show as fully settled. An event debt
  // the treasurer already fronted stays counted here on its own (evAdjBalance
  // deliberately doesn't credit the debtor for it), but a goal-fund advance
  // DOES credit g.contributions immediately (so the fund total is real money
  // for payout) — so without this it would silently disappear from the
  // family's net the moment the treasurer fronts it. Add it back explicitly.
  const openGoalsForNet=goalFunds.filter(g=>!g.closed&&!g.archived);
  families.forEach(f=>{
    openGoalsForNet.forEach(g=>{
      const owed=_goalOwedAmt(g,f.id);
      if(owed>0.5)famNet[f.id]=(famNet[f.id]||0)-owed;
      const tOwed=goalTreasurerOwed(g,f.id);
      if(tOwed>0.5)famNet[f.id]=(famNet[f.id]||0)-tOwed;
    });
  });
  const famStripEl=document.getElementById('homeFamStrip');
  famStripEl.innerHTML=families.length?`
    <div style="font-size:13px;font-weight:700;color:var(--text2);margin-bottom:10px">👥 משפחות</div>
    <div class="home-fam-strip">${families.map(f=>{
      const cl=col(f.id);
      const netRaw=famNet[f.id]||0;
      const net=Math.round(netRaw);
      const cls=netRaw>0.5?'pill-get':netRaw<-0.5?'pill-owe':'';
      const amtColor=netRaw>0.5?'var(--green-mid)':netRaw<-0.5?'var(--red-mid)':'var(--text3)';
      const amtText=netRaw>0.5?'+₪'+net.toLocaleString():netRaw<-0.5?'-₪'+Math.abs(net).toLocaleString():'מסודר';
      const fundBal=Math.round(famFundBal(f.id));
      return`<div class="home-fam-pill ${cls}" data-famid="${f.id}" style="cursor:pointer;touch-action:manipulation">
        ${famAva(f, 36)}
        <div style="font-size:11px;font-weight:700;color:var(--text)">${esc(f.name.replace('משפחת','').trim())}</div>
        <div style="font-size:11px;font-weight:700;color:${amtColor}">${amtText}</div>
        ${fundBal!==0?`<div style="font-size:10px;font-weight:600;color:${fundBal>0?'var(--green-mid)':'var(--text3)'}">🏦 ₪${Math.abs(fundBal).toLocaleString()}</div>`:''}
      </div>`;
    }).join('')}</div>`:'';
  famStripEl.onclick=e=>{const p=e.target.closest('[data-famid]');if(p)openFamDetail(parseInt(p.dataset.famid));};

  // ── Event cards ──
  const splitShort={equal:'שווה',percapita:'לפי נפשות',weighted:'ילד 50%'};
  document.getElementById('homeEvSection').innerHTML=`
    <div style="font-size:13px;font-weight:700;color:var(--text2);margin-bottom:10px;display:flex;align-items:center;justify-content:space-between">
      <span>📅 אירועים פעילים</span>
      ${open.length?`<span style="font-size:11px;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:2px 9px;color:var(--text2);font-weight:600">${open.length}</span>`:''}
    </div>
    ${open.length?open.map(ev=>{
      const cl=col(ev.id);
      const cost=evCost(ev);
      const pendingSavings=calcTransfers(ev).filter(t=>t.toFid==='__savings__'&&!t.coveredByPot);
      const adjBals=evAdjBalance(ev);
      const settledFams=ev.participants.filter(fid=>Math.abs(adjBals[fid]||0)<=0.5).length;
      const total=ev.participants.length;
      const pct=total?Math.round(settledFams/total*100):100;
      const hasPot=evPotTotal(ev)>0;
      const balanced=settledFams===total;
      const tags=[
        !balanced?`<span class="badge badge-amber">⏳ פעיל</span>`:`<span class="badge badge-green">✅ מאוזן</span>`,
        pendingSavings.length?`<span class="badge" style="background:var(--green-bg);color:var(--green-mid)">💎 ${pendingSavings.length}</span>`:'',
        hasPot?`<span class="badge" style="background:var(--amber-bg);color:var(--amber)">💰 ₪${evNetPotBal(ev).toLocaleString()}</span>`:''
      ].filter(Boolean).join('');
      const meta=[ev.date&&ev.date!=='לא צוין'?esc(ev.date):'',ev.participants.length+' משפחות',splitShort[ev.splitMethod||'equal']].filter(Boolean).join(' · ');
      return`<div class="hev" onclick="openEventDash(${ev.id})">
        <div class="hev-top">
          <div class="hev-bar" style="background:${cl.c}"></div>
          <div class="hev-body">
            <div class="hev-name">${esc(ev.name)}</div>
            <div class="hev-sub">${meta}</div>
            <div class="hev-tags">${tags}</div>
            <div class="pbar" style="margin-top:8px"><div class="pfill ${balanced?'full':'part'}" style="width:${pct}%"></div></div>
          </div>
        </div>
        <div class="hev-foot">
          <span style="font-size:12px;color:var(--text2)">עלות כוללת <b style="color:var(--text)">₪${cost.toLocaleString()}</b></span>
          <span style="font-size:14px;color:var(--text3)">‹</span>
        </div>
      </div>`;
    }).join(''):`<div class="empty"><span class="empty-ico">📅</span>אין אירועים פעילים</div>`}`;

  const openGoals=_visibleGoalFunds(goalFunds.filter(g=>!g.closed&&!g.archived));
  const goalSection=document.getElementById('homeGoalSection');
  goalSection.style.display=openGoals.length?'block':'none';
  document.getElementById('homeGoalList').innerHTML=openGoals.map(g=>{
    const total=goalTotal(g);
    const dispTarget=_goalDisplayTarget(g);
    const pct=dispTarget>0?Math.min(100,Math.round(total/dispTarget*100)):0;
    const reached=dispTarget>0&&total>=dispTarget;
    const remaining=dispTarget>0?Math.max(0,Math.round(dispTarget-total)):0;
    const subText=dispTarget>0?`נאסף ₪${total.toLocaleString()} מתוך ₪${dispTarget.toLocaleString()}`:`נאסף ₪${total.toLocaleString()}`;
    const giftLine=[g.gift,g.recipient?'עבור '+g.recipient:null].filter(Boolean).join(' · ');
    return`<div class="home-row home-row-col" onclick="goToGoalFund(${g.id})">
      <div class="home-goal-top">
        <div class="home-row-icon" style="background:var(--amber-bg);color:var(--amber)">🎯</div>
        <div class="home-row-body">
          <div class="home-row-title">${esc(g.name)}</div>
          ${giftLine?`<div class="home-row-sub">🎁 ${esc(giftLine)}</div>`:''}
          <div class="home-row-sub">${subText}</div>
        </div>
        ${reached?'<span class="badge badge-green">✅ הושלם</span>':remaining>0?`<span class="badge badge-amber">חוב ₪${remaining.toLocaleString()}</span>`:''}
      </div>
      ${dispTarget>0?`<div class="pbar" style="margin-top:10px"><div class="pfill ${reached?'full':'part'}" style="width:${pct}%"></div></div>`:''}
    </div>`;
  }).join('');
}
function goToEvent(evId){
  goTab('events',document.getElementById('nb-events'));
  setTimeout(()=>{
    const el=document.getElementById('ecard-'+evId);
    if(el) el.scrollIntoView({behavior:'smooth',block:'start'});
  },50);
}
function goToGoalFund(goalId){
  openGoalPayModal(goalId);
}
function stepChild(id,delta){
  const inp=document.getElementById(id);
  if(!inp)return;
  inp.value=Math.max(0,(parseInt(inp.value)||0)+delta);
  if(expMode==='total')updateTotalPreview();
  updateChildPickSummary();
}
function calcTransfers(ev){
  const adjBal={...evAdjBalance(ev)};
  // Pre-apply pot releases to creditors so direct transfers only show the remaining gap
  if((ev.potPayments||[]).length>0){
    calcPotTransfers(ev).forEach(t=>{ adjBal[t.toFid]=(adjBal[t.toFid]||0)-t.amt; });
    // Subtract each pot payer's excess from their adjBal so it doesn't create spurious
    // direct transfers — the excess is returned to them from the pot separately
    const excess=calcPotExcessByFamily(ev);
    Object.entries(excess).forEach(([fid,exc])=>{
      const fidNum=parseInt(fid);const adj=adjBal[fidNum]||0;
      if(adj>0.5) adjBal[fidNum]=Math.max(0,adj-exc);
    });
  }
  const pos=[],neg=[];
  ev.participants.forEach(fid=>{
    const f=getFam(fid);if(!f)return;
    const name=f.name.replace('משפחת','').trim();
    if(adjBal[fid]>0.5) pos.push({name,fid,amt:adjBal[fid]});
    else if(adjBal[fid]<-0.5) neg.push({name,fid,amt:-adjBal[fid]});
  });
  // Add savings pot as virtual creditor (collects savings + ceiling-rounding surplus from debtors)
  const _savingsTotal=ev.savingsTotal||0;
  const _savingsPaidTotal=(ev.savingsPaid||[]).reduce((s,p)=>s+p.amt,0);
  const _pot2savTotal=(ev.potToSavings||[]).reduce((s,p)=>s+p.amt,0);
  // Don't subtract pot2sav here — savings still owed by families even if pot already covered it
  const _savingsOwed=Math.round(_savingsTotal+evSavingsSurplus(ev)-_savingsPaidTotal);
  // If pot already transferred enough to savings, mark resulting transfers as auto-settled
  const _savCoveredByPot=_savingsOwed>0.5&&_pot2savTotal>=_savingsOwed;
  if(_savingsOwed>0.5) pos.push({name:'קופת חיסכון',fid:'__savings__',amt:_savingsOwed,isSavings:true});
  const transfers=[];
  // Sort largest first so big debtors match big creditors → fewer splits per person
  const pCopy=pos.map(x=>({...x})).sort((a,b)=>b.amt-a.amt);
  const nCopy=neg.map(x=>({...x})).sort((a,b)=>b.amt-a.amt);
  let pi=0,ni=0;
  while(pi<pCopy.length&&ni<nCopy.length){
    const give=Math.min(pCopy[pi].amt,nCopy[ni].amt);
    if(give>0.5) transfers.push({from:nCopy[ni].name,fromFid:nCopy[ni].fid,to:pCopy[pi].name,toFid:pCopy[pi].fid,amt:Math.round(give)});
    pCopy[pi].amt-=give; nCopy[ni].amt-=give;
    if(pCopy[pi].amt<=0.5)pi++;
    if(nCopy[ni].amt<=0.5)ni++;
  }
  if(_savCoveredByPot) transfers.forEach(t=>{if(t.toFid==='__savings__')t.coveredByPot=true;});
  return transfers;
}
// A family's total net balance across every currently-open event combined.
// Positive = owed money overall, negative = owes money overall. Feeds the
// standalone "העברות איזון" (balance transfers) tool — the optional direct
// alternative to everyone just paying the treasurer. Savings-pot obligations
// are deliberately excluded — they're owed to that specific event's own
// savings goal, not to another family.
function famGlobalBalances(){
  const net={};
  events.filter(e=>e.open).forEach(ev=>{
    const bal={...evAdjBalance(ev)};
    // Pre-apply pot releases to creditors so the net position only reflects
    // the remaining gap — money already sitting in the event's own pot gets
    // released to them separately, not via a family-to-family transfer.
    if((ev.potPayments||[]).length>0){
      calcPotTransfers(ev).forEach(t=>{ bal[t.toFid]=(bal[t.toFid]||0)-t.amt; });
      const excess=calcPotExcessByFamily(ev);
      Object.entries(excess).forEach(([fid,exc])=>{
        const fidNum=parseInt(fid);const adj=bal[fidNum]||0;
        if(adj>0.5) bal[fidNum]=Math.max(0,adj-exc);
      });
    }
    ev.participants.forEach(fid=>{
      let v=bal[fid]||0;
      // Whatever slice of this family's debt the treasurer already fronted
      // (method:'treasurer') isn't owed to a fellow family anymore — it's
      // owed straight to the treasurer (see evCard's own "טרם הוחזר" line +
      // markTreasurerRepaid) — so it's excluded here, or this tool would
      // pair the family with some unrelated creditor for money that's
      // actually earmarked for a treasurer repayment.
      if(v<-0.5) v+=Math.min(evTreasurerOwed(ev,fid),-v);
      net[fid]=(net[fid]||0)+v;
    });
  });
  (globalSettled||[]).forEach(s=>{
    if(s.method!=='treasurer') net[s.fromFid]=(net[s.fromFid]||0)+s.amt;
    net[s.toFid]=(net[s.toFid]||0)-s.amt;
  });
  return net;
}
// Minimal set of family-to-family transfers to settle every open event at
// once, computed from each family's combined net position — so a debt in one
// event that's already covered by a credit in another doesn't need a
// (redundant) payment, and money routes directly between the two families
// that actually end up owing each other instead of via a third family who
// happens to link the two events.
function calcGlobalTransfers(){
  const net=famGlobalBalances();
  const pos=[],neg=[];
  Object.keys(net).forEach(fidStr=>{
    const fid=parseInt(fidStr);
    const f=getFam(fid);if(!f)return;
    const name=f.name.replace('משפחת','').trim();
    const amt=net[fid];
    if(amt>0.5) pos.push({name,fid,amt});
    else if(amt<-0.5) neg.push({name,fid,amt:-amt});
  });
  const transfers=[];
  const pCopy=pos.sort((a,b)=>b.amt-a.amt);
  const nCopy=neg.sort((a,b)=>b.amt-a.amt);
  let pi=0,ni=0;
  while(pi<pCopy.length&&ni<nCopy.length){
    const give=Math.min(pCopy[pi].amt,nCopy[ni].amt);
    if(give>0.5) transfers.push({from:nCopy[ni].name,fromFid:nCopy[ni].fid,to:pCopy[pi].name,toFid:pCopy[pi].fid,amt:Math.round(give)});
    pCopy[pi].amt-=give; nCopy[ni].amt-=give;
    if(pCopy[pi].amt<=0.5)pi++;
    if(nCopy[ni].amt<=0.5)ni++;
  }
  return transfers;
}
// A global (cross-event) settle-up payment — from the "העברות איזון" tool —
// is computed from a family's NET position across every open event, so it
// doesn't correspond to any single event's own ledger. Recording it only in
// the standalone globalSettled array (as this used to do) meant every other
// consumer of a family's balance — the event card's own settled/active
// badge, the close-summary email, the debtor-reminder email — kept using the
// per-event evAdjBalance(ev), which never saw this payment and kept showing
// the family as still owing. Waterfall the payment into the real events it
// actually covers instead, so evAdjBalance reflects it everywhere. Any
// leftover (shouldn't normally happen, since callers derive amt from the same
// net calc) falls back to the old event-less record so nothing is lost.
function _distributeGlobalSettle(fromFid,toFid,from,to,amt,method){
  let remaining=amt;
  events.filter(e=>e.open&&e.participants.includes(fromFid)).forEach(ev=>{
    if(remaining<=0.5)return;
    const totalOwe=Math.round(Math.max(0,-(evAdjBalance(ev)[fromFid]||0)));
    // Exclude whatever's already earmarked for a direct treasurer repayment
    // (see famGlobalBalances) — otherwise a second global settle targeting a
    // different creditor could route into the same already-covered slice.
    const owe=Math.round(totalOwe-Math.min(evTreasurerOwed(ev,fromFid),totalOwe));
    if(owe<=0.5)return;
    const portion=Math.min(owe,remaining);
    if(!ev.settled)ev.settled=[];
    ev.settled.push({from,fromFid,to,toFid,amt:portion,method,global:true});
    remaining-=portion;
  });
  if(remaining>0.5){
    globalSettled.push({from,fromFid,to,toFid,amt:remaining,method,date:new Date().toLocaleDateString('he-IL')});
  }
}
function markTransferFromFund(evId, from, fromFid, to, toFid, amt){
  const ev=evId!=null?events.find(e=>e.id===evId):null;
  if(evId!=null&&!ev)return;
  const key=String(fromFid);
  const bal=fund.famBalances[key]||0;
  if(bal<amt){ alert('אין מספיק יתרה בקופה עבור '+from+' (יתרה: ₪'+bal.toLocaleString()+')'); return; }
  if(ev){
    if(!ev.settled)ev.settled=[];
    ev.settled.push({from,fromFid,to,toFid,amt,method:'fund'});
  } else {
    _distributeGlobalSettle(fromFid,toFid,from,to,amt,'fund');
  }
  fund.famBalances[key]=bal-amt;
  fund.transactions.push({id:nxtTx++,type:'payout',famId:fromFid,amount:amt,
    desc:'תשלום של '+from+' ל'+to+(ev?' · '+ev.name:''),
    date:new Date().toLocaleDateString('he-IL')});
  // credit the creditor's fund balance
  const toKey2=String(toFid);
  fund.famBalances[toKey2]=(fund.famBalances[toKey2]||0)+amt;
  fund.transactions.push({id:nxtTx++,type:'deposit',famId:toFid,amount:amt,
    desc:'קיבלת מ'+from+(ev?' עבור "'+ev.name+'"':'')+' (מהארנק)',
    date:new Date().toLocaleDateString('he-IL')});
  save();render();
}
// The treasurer personally fronts a pending transfer instead of the debtor
// family paying it (directly or from their own wallet balance) — e.g. the
// debtor hasn't paid yet but the creditor needs the money now. The
// creditor's wallet is credited exactly like markTransferFromFund does,
// but nothing is drawn from any family's balance; instead fund.deficit
// tracks how much the shared fund now owes the treasurer back. Supports
// both a specific event (evId given) and the global "העברות איזון" tool
// (evId null), mirroring markTransferFromFund's own dual handling.
function markTransferFromTreasurer(evId, from, fromFid, to, toFid, amt){
  const ev=evId!=null?events.find(e=>e.id===evId):null;
  if(evId!=null&&!ev)return;
  if(ev){
    if(!ev.settled)ev.settled=[];
    ev.settled.push({from,fromFid,to,toFid,amt,method:'treasurer'});
  } else {
    _distributeGlobalSettle(fromFid,toFid,from,to,amt,'treasurer');
  }
  const toKey=String(toFid);
  fund.famBalances[toKey]=(fund.famBalances[toKey]||0)+amt;
  fund.transactions.push({id:nxtTx++,type:'deposit',famId:toFid,amount:amt,
    desc:'קיבלת מהגזבר'+(ev?' עבור "'+ev.name+'"':'')+' (מקדמה, במקום '+from+')',
    date:new Date().toLocaleDateString('he-IL')});
  fund.deficit=(fund.deficit||0)+amt;
  save();render();
}
// How much of THIS family's debt in THIS event the treasurer fronted and is
// still outstanding — 'treasurer' entries add to it (whether pushed directly
// for this event or waterfalled in via _distributeGlobalSettle, both look
// the same in ev.settled), 'treasurer-repay' entries (the family actually
// paying the treasurer back) subtract from it.
function evTreasurerOwed(ev,fid){
  let owed=0;
  (ev.settled||[]).forEach(s=>{
    if(Number(s.fromFid)!==Number(fid))return;
    if(s.method==='treasurer')owed+=s.amt;
    else if(s.method==='treasurer-repay')owed-=s.amt;
  });
  return Math.max(0,owed);
}
// The family actually pays the treasurer back (in cash, bit, etc. — outside
// the app) for an amount the treasurer fronted on their behalf in this
// event. Unlike markTransferFromTreasurer, no one's wallet is credited here
// — the creditor was already paid when the treasurer originally fronted the
// money; this only clears the debtor's own remaining obligation (via a
// settled entry with no toFid, so evAdjBalance resolves just their side)
// and reduces the shared deficit.
function markTreasurerRepaid(evId,famId){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  const f=getFam(famId);if(!f)return;
  const adj=evAdjBalance(ev);
  const amt=Math.round(Math.min(evTreasurerOwed(ev,famId),Math.max(0,-(adj[famId]||0))));
  if(amt<=0)return;
  const name=f.name.replace('משפחת','').trim();
  if(!confirm(name+' החזירה לגזבר ₪'+amt.toLocaleString()+'?'))return;
  if(!ev.settled)ev.settled=[];
  ev.settled.push({from:name,fromFid:famId,to:'הגזבר',toFid:null,amt,method:'treasurer-repay'});
  fund.deficit=Math.max(0,(fund.deficit||0)-amt);
  fund.transactions.push({id:nxtTx++,type:'payout',famId:null,amount:amt,
    desc:name+' החזירה לגזבר עבור "'+ev.name+'"',
    date:new Date().toLocaleDateString('he-IL')});
  save();render();
  if(ev.closed){const nb=evAdjBalance(ev)[famId]||0;if(nb>=-0.5)_sendCloseEvEmailOne(ev,famId);}
  _refreshTreasurerDeficitModalIfOpen();
}
// Keeps the itemized deficit list current if the admin repays several
// lines in a row without closing the modal between clicks.
function _refreshTreasurerDeficitModalIfOpen(){
  const modal=document.getElementById('treasurerDeficitModal');
  if(modal&&modal.style.display==='flex')renderTreasurerDeficitModal();
}
function openPartPayModal(evId,from,fromFid,to,toFid,amt,isFund,fromSettle){
  _ppEvId=evId;_ppFrom=from;_ppFromFid=fromFid;_ppTo=to;_ppToFid=toFid;
  _ppMax=amt;_ppFund=isFund||false;_ppSettle=fromSettle||false;_ppPot=false;
  let fundLine='';
  if(!isFund&&fromFid!=null){
    const fundBal=fund.famBalances[String(fromFid)]||0;
    if(fundBal>0){
      const fromFundAmt=Math.min(amt,fundBal);
      fundLine=`<br><span style="color:var(--blue-mid);font-size:11px">🏦 ${fromFundAmt<amt?`₪${fromFundAmt.toLocaleString()} מהארנק + ₪${(amt-fromFundAmt).toLocaleString()} ישיר`:`₪${fromFundAmt.toLocaleString()} מהארנק (כולו)`}</span>`;
    }
  }
  document.getElementById('partPayInfo').innerHTML=`<b>${esc(from)}</b> → <b>${esc(to)}</b><br>נדרש: <b style="color:var(--blue-mid)">₪${amt.toLocaleString()}</b>${fundLine}`;
  const amtEl=document.getElementById('partPayAmt');
  amtEl.value=amt;amtEl.max=amt;
  updatePartPayRemain();
  document.getElementById('partPayModal').style.display='flex';
  setTimeout(()=>{amtEl.focus();amtEl.select();},50);
}
function updatePartPayRemain(){
  const paid=parseFloat(document.getElementById('partPayAmt').value)||0;
  const rem=Math.round(_ppMax-paid);
  const el=document.getElementById('partPayRemain');
  if(paid<=0){el.textContent='';return;}
  if(paid>_ppMax+0.5){el.style.color='var(--red-mid)';el.textContent='הסכום גבוה מהנדרש';return;}
  if(!_ppFund&&!_ppPot&&_ppFromFid!=null){
    const fundBal=fund.famBalances[String(_ppFromFid)]||0;
    if(fundBal>0){
      const fromFund=Math.min(Math.round(paid),fundBal);
      const fromDirect=Math.round(paid)-fromFund;
      let breakdown='';
      if(fromFund>0) breakdown+=`🏦 ₪${fromFund.toLocaleString()} מהארנק`;
      if(fromDirect>0) breakdown+=(breakdown?' + ':'')+`✓ ₪${fromDirect.toLocaleString()} ישיר`;
      el.style.color='var(--text2)';
      el.innerHTML=breakdown+(rem>0.5?`<br><span style="color:var(--amber)">נשאר: ₪${rem.toLocaleString()}</span>`:'<br><span style="color:var(--green-mid)">תשלום מלא ✓</span>');
      return;
    }
  }
  if(rem>0.5){el.style.color='var(--amber)';el.textContent='נשאר לתשלום: ₪'+rem.toLocaleString();}
  else{el.style.color='var(--green-mid)';el.textContent='תשלום מלא ✓';}
}
function closePartPayModal(){document.getElementById('partPayModal').style.display='none';}
function confirmPartPay(){
  const paid=Math.round(parseFloat(document.getElementById('partPayAmt').value)||0);
  if(paid<=0)return;
  if(paid>_ppMax+0.5){alert('הסכום גבוה מהנדרש');return;}
  if(_ppPot) payToPot(_ppEvId,_ppFromFid,paid);
  else if(_ppFund) markTransferFromFund(_ppEvId,_ppFrom,_ppFromFid,_ppTo,_ppToFid,paid);
  else if(_ppEvId==null){
    // Global settle-up transfer (the "העברות איזון" tool) — not tied to any
    // single event's ledger.
    const key=String(_ppFromFid);
    const fundBal=fund.famBalances[key]||0;
    const fromFund=Math.min(paid,fundBal);
    const fromDirect=paid-fromFund;
    if(fromFund>0){
      _distributeGlobalSettle(_ppFromFid,_ppToFid,_ppFrom,_ppTo,fromFund,'fund');
      fund.famBalances[key]=fundBal-fromFund;
      fund.transactions.push({id:nxtTx++,type:'payout',famId:_ppFromFid,amount:fromFund,
        desc:'תשלום של '+_ppFrom+' ל'+_ppTo+' (מהארנק)',
        date:new Date().toLocaleDateString('he-IL')});
      const toKey=String(_ppToFid);
      fund.famBalances[toKey]=(fund.famBalances[toKey]||0)+fromFund;
      fund.transactions.push({id:nxtTx++,type:'deposit',famId:_ppToFid,amount:fromFund,
        desc:'קיבלת מ'+_ppFrom+' (מהארנק)',
        date:new Date().toLocaleDateString('he-IL')});
    }
    if(fromDirect>0) _distributeGlobalSettle(_ppFromFid,_ppToFid,_ppFrom,_ppTo,fromDirect,'direct');
    addNotif('✓',_ppFrom+' העביר ל'+_ppTo+' ₪'+paid.toLocaleString(),'admin');
    save();render();
  }
  else {
    const ev=events.find(e=>e.id===_ppEvId);if(!ev)return;
    const key=String(_ppFromFid);
    const fundBal=fund.famBalances[key]||0;
    const fromFund=Math.min(paid,fundBal);
    const fromDirect=paid-fromFund;
    if(!ev.settled)ev.settled=[];
    if(fromFund>0){
      ev.settled.push({from:_ppFrom,fromFid:_ppFromFid,to:_ppTo,toFid:_ppToFid,amt:fromFund,method:'fund'});
      fund.famBalances[key]=fundBal-fromFund;
      fund.transactions.push({id:nxtTx++,type:'payout',famId:_ppFromFid,amount:fromFund,
        desc:'תשלום של '+_ppFrom+' ל'+_ppTo+' (מהארנק) · '+ev.name,
        date:new Date().toLocaleDateString('he-IL')});
      // credit the creditor's fund balance
      const toKey=String(_ppToFid);
      fund.famBalances[toKey]=(fund.famBalances[toKey]||0)+fromFund;
      fund.transactions.push({id:nxtTx++,type:'deposit',famId:_ppToFid,amount:fromFund,
        desc:'קיבלת מ'+_ppFrom+' עבור "'+ev.name+'" (מהארנק)',
        date:new Date().toLocaleDateString('he-IL')});
    }
    if(fromDirect>0) ev.settled.push({from:_ppFrom,fromFid:_ppFromFid,to:_ppTo,toFid:_ppToFid,amt:fromDirect,method:'direct'});
    addNotif('✓',_ppFrom+' העביר ל'+_ppTo+' ₪'+paid.toLocaleString()+' עבור "'+ev.name+'"','admin');
    save();render();
    if(ev.closed){
      const adjAfter=evAdjBalance(ev);
      if((adjAfter[_ppFromFid]||0)>=-0.5)_sendCloseEvEmailOne(ev,_ppFromFid);
      if((adjAfter[_ppToFid]||0)<=0.5)_sendCloseEvEmailOne(ev,_ppToFid);
    }
  }
  if(_ppSettle){
    if(_ppEvId==null) renderGlobalSettleModal();
    else{const ev=events.find(e=>e.id===_ppEvId);if(ev)renderSettleModal(ev);}
  }
  closePartPayModal();
}
function openPotPayModal(evId,famId){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  const f=getFam(famId);if(!f)return;
  const adj=evAdjBalance(ev);
  // Exclude whatever portion of this debt the treasurer already fronted —
  // that part isn't paid into the event pot, it's repaid straight to the
  // treasurer (see markTreasurerRepaid / the evCard row's own button).
  const treasurerOwed=Math.min(evTreasurerOwed(ev,famId),Math.max(0,-(adj[famId]||0)));
  const owed=Math.round(Math.max(0,-(adj[famId]||0))-treasurerOwed);
  if(owed<=0)return;
  _ppEvId=evId;_ppFromFid=famId;_ppMax=owed;_ppPot=true;_ppFund=false;_ppSettle=false;
  const name=f.name.replace('משפחת','').trim();
  document.getElementById('partPayInfo').innerHTML=`<b>${esc(name)}</b> משלם לקופת האירוע<br>נדרש: <b style="color:var(--blue-mid)">₪${owed.toLocaleString()}</b>`;
  const amtEl=document.getElementById('partPayAmt');
  amtEl.value=owed;amtEl.max=owed;
  updatePartPayRemain();
  document.getElementById('partPayModal').style.display='flex';
  setTimeout(()=>{amtEl.focus();amtEl.select();},50);
}

function evCard(ev){
  const cost=evCost(ev);
  const excl=families.filter(f=>ev.excluded.includes(f.id));
  const adjBal=evAdjBalance(ev);
  // Family-to-family "who pays whom" suggestions were removed from the event
  // window — everyone pays the treasurer directly instead (see
  // openGlobalSettleModal for the optional direct-transfer alternative).
  // Only the event's own savings-pot transfers still show here.
  const transfers=calcTransfers(ev).filter(t=>t.toFid==='__savings__'&&!t.coveredByPot);
  const hasSavingsInfo=transfers.length>0||(ev.savingsPaid||[]).length>0||(ev.savingsTotal||0)>0;
  const potPayments=ev.potPayments||[];
  const potOrigByFam=evPotOrigByFam(ev);
  const potTransByFam=evPotTransByFam(ev);
  const potRefundByFam=evPotRefundByFam(ev);
  const potTotal=evPotBal(ev);
  const potExpTotalCard=evPotExpTotal(ev);
  const hasPot=potTotal>0;
  // Keep the pot button visible even once the balance hits zero, as long as anything
  // ever passed through it, so its history (deposits, transfers, expenses) stays reachable.
  const hasPotHistory=hasPot||(ev.settled||[]).some(s=>s.method==='pot'||s.method==='pot-refund')||(ev.potExpItems||[]).length>0||(ev.potToSavings||[]).length>0;
  const potByFam={};
  potPayments.forEach(p=>{if(!potByFam[p.famId])potByFam[p.famId]=[];potByFam[p.famId].push(p);});
  const balanced=cost>0&&!ev.participants.some(fid=>(adjBal[fid]||0)<-0.5);
  const shares=evShares(ev);
  const _sMethod=ev.splitMethod||'equal';
  let _sTotalW=0;const _sW={};
  ev.participants.forEach(fid=>{_sW[fid]=famWeight(getFam(fid),_sMethod,ev.childOverrides?.[fid],ev.parentOverrides?.[fid]);_sTotalW+=_sW[fid];});
  const famItemBreakdown=fid=>{
    if(!ev.expenseItems||!ev.expenseItems.length)return[];
    return ev.expenseItems.flatMap(it=>{
      if(it.customSplit){const a=it.customSplit[String(fid)]||0;return a>0?[{name:it.name,amt:a}]:[];}
      if(it.sharedWith&&it.sharedWith.length>0&&it.sharedWith.length<ev.participants.length){
        const sw=it.sharedWith.filter(id=>ev.participants.includes(id));
        return sw.includes(fid)?[{name:it.name,amt:Math.round(it.amt/sw.length)}]:[];
      }
      return [];
    });
  };
  const cumRows=ev.participants.map(fid=>{
    const f=getFam(fid);if(!f)return'';
    const cl=col(fid);
    const items=(ev.expenseItems||[]).filter(it=>itemPayerAmt(it,fid)>0);
    const spent=ev.expenses[fid]||0;
    const b=adjBal[fid];
    const share=shares[fid]||0;
    const tagClass=b>0.5?'exp-tag-neg':b<-0.5?'exp-tag-pos':'exp-tag-zero';
    const tagText=b>0.5?'מקבל ₪'+Math.round(b).toLocaleString():b<-0.5?'מחזיר ₪'+Math.round(Math.abs(b)).toLocaleString():'מסודר ✓';
    const isDebtor=b<-0.5;
    const tagTag=isDebtor?'button':'span';
    // Whatever slice of this family's debt the treasurer already fronted
    // (see markTransferFromTreasurer) can't be paid into the event pot —
    // there's no creditor left to route it to — so it's repaid straight to
    // the treasurer instead; only the remainder, if any, still goes through
    // the normal pot-pay flow.
    const treasurerOwedAmt=Math.round(Math.min(evTreasurerOwed(ev,fid),Math.max(0,-b)));
    const potPayableAmt=Math.round(Math.max(0,-b)-treasurerOwedAmt);
    const tagClick=potPayableAmt>0.5?` onclick="openPotPayModal(${ev.id},${fid})"`:treasurerOwedAmt>0.5?` onclick="markTreasurerRepaid(${ev.id},${fid})"`:'';
    const tagCls='exp-tag '+tagClass+(isDebtor?' exp-tag-clickable':'');
    const treasurerOwedLine=treasurerOwedAmt>0.5?`<div class="edit-only" style="font-size:11px;color:var(--amber);margin-top:1px;display:flex;align-items:center;gap:6px">💼 הגזבר שילם על חשבונכם ₪${treasurerOwedAmt.toLocaleString()} — טרם הוחזר<button onclick="markTreasurerRepaid(${ev.id},${fid})" style="border:1px solid var(--amber);border-radius:10px;background:none;color:var(--amber);font-size:10px;font-weight:700;font-family:var(--font);cursor:pointer;padding:1px 7px">✓ הוחזר</button></div>`:'';
    const famPotAmt=potOrigByFam[fid]||0;
    const famPotTransAmt=potTransByFam[fid]||0;
    const famPotRefundAmt=potRefundByFam[fid]||0;
    const famPotFromWallet=famPotAmt>0?evPotFromWallet(ev,fid):0;
    const key=ev.id+'-'+fid;
    const isExpanded=expandedCumFamilies.has(key);
    const shareKey=ev.id+'-share-'+fid;
    const isShareExpanded=expandedFamShares.has(shareKey);
    const shareItems=cost>0&&share>0?famItemBreakdown(fid):[];
    const hasShareDetail=shareItems.length>0;
    const shareBreakdownHtml=hasShareDetail&&isShareExpanded?`<div style="margin-top:3px;padding:4px 8px;background:var(--surface2);border-radius:6px">${shareItems.map(b=>`<div style="display:flex;align-items:center;gap:5px;padding:1px 0"><span style="flex:1;font-size:11px;color:var(--text2)">${esc(b.name)}</span><span style="font-size:11px;font-weight:700">₪${b.amt.toLocaleString()}</span></div>`).join('')}</div>`:'';
    const detailList=items.length&&isExpanded?`<div style="padding:4px 0 2px;border-top:1px solid var(--border);margin-top:4px">
      ${items.map(it=>{
        const swNames=it.sharedWith?it.sharedWith.map(sid=>{const sf=getFam(sid);return sf?sf.name.replace('משפחת','').trim():'';}).filter(Boolean).join(', '):'';
        const itemKey=ev.id+'-item-'+it.id;
        const isItemExpanded=expandedExpItems.has(itemKey);
        const payerNames=itemPayerNames(it);
        const isMultiPayer=payerNames.length>1;
        const itSubLabel=(it.customSplit?
          `<span style="display:block;font-size:10px;color:var(--blue);margin-top:1px">⚖️ ידנית</span>`:
          (swNames?`<span style="display:block;font-size:10px;color:var(--blue);margin-top:1px">👥 ${esc(swNames)}</span>`:''))+
          (isMultiPayer?`<span style="display:block;font-size:10px;color:var(--amber);margin-top:1px">🧾 שולם ע"י ${esc(payerNames.join(' + '))}</span>`:'');
        const breakdownHtml=it.customSplit&&isItemExpanded?
          `<div style="margin-top:4px;padding:4px 8px;background:var(--surface2);border-radius:6px">${
            Object.entries(it.customSplit).map(([sfid,a])=>{const sf=getFam(parseInt(sfid));if(!sf)return'';return`<div style="display:flex;align-items:center;gap:5px;padding:1px 0"><span style="flex:1;font-size:11px;color:var(--text2)">${esc(sf.name.replace('משפחת','').trim())}</span><span style="font-size:11px;font-weight:700">₪${a.toLocaleString()}</span></div>`;}).join('')
          }</div>`:'';
        const myPaidAmt=itemPayerAmt(it,fid);
        return`<div style="padding:3px 0;font-size:11px">
          <div style="display:flex;align-items:center;gap:6px">
            <div style="flex:1;min-width:0"><span style="color:var(--text2)">${esc(it.name)}</span>${itSubLabel}</div>
            <span style="font-weight:600;color:var(--text);flex-shrink:0">₪${myPaidAmt.toLocaleString()}${!isMultiPayer&&it.origAmt&&it.origCur?'<span style="font-size:10px;color:var(--text2);font-weight:400"> ('+it.origAmt+it.origCur+')</span>':''}</span>
            ${it.customSplit?`<button onclick="toggleExpItem(${ev.id},${it.id})" style="flex-shrink:0;padding:1px 5px;border-radius:4px;border:1px solid var(--border);background:none;font-size:10px;color:var(--text2);font-family:var(--font);cursor:pointer">${isItemExpanded?'▲':'▼'}</button>`:''}
            <button onclick="editExpItem(${ev.id},${it.id})" class="edit-only" style="flex-shrink:0;width:18px;height:18px;border-radius:50%;border:none;background:var(--blue-bg);color:var(--blue);font-size:10px;font-family:var(--font);cursor:pointer;padding:0;line-height:18px;text-align:center">✏</button>
            <button onclick="deleteExpItem(${ev.id},${it.id})" class="edit-only" style="flex-shrink:0;width:18px;height:18px;border-radius:50%;border:none;background:var(--red-bg);color:var(--red);font-size:10px;font-weight:700;font-family:var(--font);cursor:pointer;padding:0;line-height:18px;text-align:center">✕</button>
          </div>
          ${breakdownHtml}
        </div>`;}).join('')}
    </div>`:'';
    return`<div class="exp-input-row" style="flex-direction:column;align-items:stretch">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="flex:1;display:flex;align-items:center;gap:8px;min-width:0">
          ${famAva(f)}
          <div style="flex:1;min-width:0">
            <div class="mname" style="margin-bottom:1px">${esc(f.name.replace('משפחת','').trim())}</div>
            ${cost>0&&share>0?hasShareDetail?`<button onclick="toggleFamShare(${ev.id},${fid})" style="background:none;border:none;padding:0;cursor:pointer;font-family:var(--font);display:flex;align-items:center;gap:3px"><span style="font-size:13px;font-weight:700;color:var(--text)">חלק: ₪${share.toLocaleString()}</span><span style="font-size:10px;color:var(--text3)">${isShareExpanded?'▲':'▼'}</span></button>${shareBreakdownHtml}`:`<div style="font-size:13px;font-weight:700;color:var(--text)">חלק: ₪${share.toLocaleString()}</div>`:''}
            ${ev.savingsTotal?`<div style="font-size:11px;color:var(--green-mid);margin-top:1px">מתוכם ₪${evSavingsPerFam(ev).toLocaleString()} לקופת חיסכון 💎</div>`:''}
            ${famPotAmt>0?(famPotFromWallet>0.5&&famPotFromWallet>=famPotAmt-0.5?
              `<div style="font-size:11px;color:var(--amber);margin-top:1px">🏦 הועבר מהארנק ₪${famPotAmt.toLocaleString()} לקופת האירוע</div>`
              :famPotFromWallet>0.5?
              `<div style="font-size:11px;color:var(--amber);margin-top:1px">💰 הפקיד לקופה ₪${famPotAmt.toLocaleString()}</div><div style="font-size:11px;color:var(--amber);margin-top:1px">🏦 מתוכם ₪${famPotFromWallet.toLocaleString()} מהארנק</div>`
              :`<div style="font-size:11px;color:var(--amber);margin-top:1px">💰 הפקיד לקופה ₪${famPotAmt.toLocaleString()}</div>`
            ):''}
            ${famPotRefundAmt>0?`<div style="font-size:11px;color:var(--blue-mid);margin-top:1px">↩ הוחזר עודף ₪${famPotRefundAmt.toLocaleString()}</div>`:''}
            ${treasurerOwedLine}
          </div>
        </div>
        <div style="width:64px;flex-shrink:0;text-align:center">
          ${spent>0?`<div style="font-size:13px;font-weight:700;color:var(--text)">₪${spent.toLocaleString()}</div><div style="font-size:10px;color:var(--text2)">הוצאות</div>`:''}
          ${items.length?`<button onclick="toggleCumFamily(${ev.id},${fid})" style="margin-top:${spent>0?'2':'0'}px;padding:2px 6px;border-radius:4px;border:1px solid var(--border);background:none;font-size:10px;color:var(--text2);font-family:var(--font);cursor:pointer">${isExpanded?'▲':'▼ '+items.length}</button>`:''}
        </div>
        <div style="flex:1;display:flex;align-items:center;justify-content:flex-end">
          <${tagTag} class="${tagCls}"${tagClick}>${tagText}</${tagTag}>
        </div>
      </div>
      ${detailList}
    </div>`;
  }).join('');
  const addExpBtn=`<div style="padding:8px 14px 10px;display:flex;gap:8px" class="edit-only">
    <button onclick="openAddExpItem(${ev.id})" style="flex:1;padding:9px;border-radius:var(--r2);border:1.5px dashed var(--border);background:transparent;color:var(--text2);font-size:13px;font-weight:600;font-family:var(--font);cursor:pointer">➕ הוצאה</button>
    <button onclick="openCumPot(${ev.id})" style="flex:1;padding:9px;border-radius:var(--r2);border:1.5px dashed var(--amber);background:var(--amber-bg);color:var(--amber);font-size:13px;font-weight:600;font-family:var(--font);cursor:pointer">💰 הפקד לקופה</button>
  </div>`;
  const exclLine=excl.length?`<div class="excl">לא משתתפים: ${excl.map(f=>esc(f.name.replace('משפחת','').trim())).join(', ')}</div>`:'';
  const settleLines=transfers.map(t=>{
    return`<div class="settle-row" style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;padding:6px 0">
      <span style="font-size:12px">💎 <b>${esc(t.from)}</b> מעביר לקופת חיסכון &nbsp;₪${t.amt.toLocaleString()}</span>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button style="padding:5px 10px;border-radius:6px;border:none;background:var(--green-mid);color:#fff;font-size:11px;font-weight:700;font-family:var(--font);cursor:pointer;white-space:nowrap" onclick="confirmSavingsTransfer(${ev.id},${t.fromFid},${t.amt})">💎 שולם</button>
      </div>
    </div>`;
  }).join('');
  const settledList=(ev.settled||[]);
  const _dPotByTo={};const _dNonPot=[];
  settledList.forEach(s=>{if(s.method==='pot'){const k=s.toFid!=null?String(s.toFid):s.to;if(!_dPotByTo[k])_dPotByTo[k]={to:s.to,amt:0};_dPotByTo[k].amt+=s.amt;}else _dNonPot.push(s);});
  const _dRow=(icon,badge,from,to,amt)=>'<div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-top:1px solid var(--border);font-size:12px;color:var(--text2)"><span style="color:var(--green-mid)">'+icon+'</span><span><b style="color:var(--text)">'+esc(from)+'</b> העביר ל<b style="color:var(--text)">'+esc(to)+'</b> ₪'+Math.round(amt).toLocaleString()+'</span>'+badge+'</div>';
  const _dPotBadge='<span style="font-size:10px;background:var(--amber-bg);color:var(--amber);padding:1px 7px;border-radius:10px">קופת אירוע</span>';
  const _dPotRows=Object.values(_dPotByTo).map(p=>_dRow('💰',_dPotBadge,'קופת האירוע',p.to,p.amt));
  const _dNonPotRows=_dNonPot.map(s=>{const icon=s.method==='fund'?'🏦':'✓';const badge=s.method==='fund'?'<span style="font-size:10px;background:var(--blue-bg);color:var(--blue);padding:1px 7px;border-radius:10px">קופה</span>':'<span style="font-size:10px;background:var(--green-bg);color:var(--green);padding:1px 7px;border-radius:10px">ישיר</span>';return _dRow(icon,badge,s.from,s.to,s.amt);});
  const doneHtml=settledList.length?'<div style="margin-top:8px;padding-top:4px">'+[..._dNonPotRows,..._dPotRows].join('')+'</div>':'';
  const creditorFids=ev.participants.filter(fid=>(adjBal[fid]||0)>0.5);
  const potTransfers=calcPotTransfers(ev);
  const potByCreditor={};
  potTransfers.forEach(t=>{if(!potByCreditor[t.toFid])potByCreditor[t.toFid]={name:t.to,fid:t.toFid,amt:0};potByCreditor[t.toFid].amt+=t.amt;});
  const creditorRowsHtml=Object.values(potByCreditor).map(c=>`<div style="display:flex;align-items:center;gap:5px;margin-bottom:4px">
    <div style="font-size:11px;color:var(--text);flex:1">👈 <b>${esc(c.name)}</b> ₪${c.amt.toLocaleString()}</div>
    <button onclick="releasePotToOne(${ev.id},${c.fid},false)" style="padding:3px 7px;border-radius:5px;border:none;background:var(--blue-mid);color:#fff;font-size:10px;font-weight:700;font-family:var(--font);cursor:pointer">↗ העבר</button>
    <button onclick="releasePotToOne(${ev.id},${c.fid},true)" style="padding:3px 7px;border-radius:5px;border:none;background:var(--green-mid);color:#fff;font-size:10px;font-weight:700;font-family:var(--font);cursor:pointer">🏦 לקופה</button>
  </div>`).join('');
  const famPayRows=families.filter(f=>(potOrigByFam[f.id]||0)>0).map(f=>{
    const fid=f.id;const pf=getFam(fid);if(!pf)return'';
    const name=pf.name.replace('משפחת','').trim();
    const origAmt=potOrigByFam[fid]||0;
    const transAmt=potTransByFam[fid]||0;
    const refundAmt=potRefundByFam[fid]||0;
    const payments=potByFam[fid]||[];
    const multi=payments.length>1;
    const key=ev.id+'-pot-'+fid;
    const isExp=expandedPotFamilies.has(key);
    const delBtn=(i)=>`<button class="edit-only" onclick="deletePotDeposit(${ev.id},${fid},${i})" style="background:none;border:none;color:var(--red-mid);cursor:pointer;font-size:11px;padding:0 2px;font-family:var(--font)" title="מחק הפקדה">🗑</button>`;
    const details=multi&&isExp?'<div style="padding:4px 0 2px 14px;border-top:1px solid rgba(180,130,0,.15);margin-top:3px">'
      +payments.map((p,i)=>`<div style="font-size:10px;color:var(--text2);padding:1px 0;display:flex;align-items:center;justify-content:space-between"><span>תשלום ${i+1}: ₪${p.amt.toLocaleString()}</span>${delBtn(i)}</div>`).join('')
      +'</div>':'';
    return`<div style="margin-bottom:2px">
      <div style="display:flex;align-items:center;gap:4px;font-size:11px">
        <span style="color:var(--green-mid)">✓</span>
        <span style="flex:1;color:var(--text2)"><b style="color:var(--text)">${esc(name)}</b> שילם ₪${origAmt.toLocaleString()}</span>
        ${payments.length===1?delBtn(0):payments.length>1?`<button onclick="togglePotFamily(${ev.id},${fid})" style="background:none;border:none;font-size:10px;color:var(--amber);cursor:pointer;padding:0 3px;font-weight:700;font-family:var(--font)">${isExp?'▲':'▼ '+payments.length}</button>`:''}
      </div>
      ${refundAmt>0?`<div style="font-size:10px;color:var(--blue-mid);padding-right:14px">↩ הוחזר עודף ₪${refundAmt.toLocaleString()}</div>`:''}
      ${details}
    </div>`;
  }).join('');
  const evExcessByFam=calcPotExcessByFamily(ev);
  const excessRowsCard=Object.entries(evExcessByFam).map(([fidStr,exc])=>{
    const fid=parseInt(fidStr);const pf=getFam(fid);if(!pf)return'';
    return`<div style="display:flex;align-items:center;gap:4px;font-size:11px;margin-bottom:2px">
      <span style="color:var(--blue-mid)">↩</span>
      <span style="flex:1;color:var(--text2)"><b style="color:var(--text)">${esc(pf.name.replace('משפחת','').trim())}</b> החזר ₪${exc.toLocaleString()}</span>
    </div>`;
  }).join('');
  const _potHasPending=potTransfers.length>0||Object.keys(evExcessByFam).length>0;
  const potHtml=hasPot?`<div style="margin:8px 0 0;background:var(--amber-bg);border-radius:var(--r2);padding:8px 10px">
    <div style="font-size:11px;font-weight:700;color:var(--amber);margin-bottom:4px">💰 קופת האירוע · ₪${potTotal.toLocaleString()}</div>
    ${famPayRows}
    ${_potHasPending?`<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(180,130,0,0.2)">
      <button class="edit-only" onclick="openPotModal(${ev.id})" style="width:100%;padding:7px 10px;border-radius:6px;border:none;background:var(--amber);color:#fff;font-size:12px;font-weight:700;font-family:var(--font);cursor:pointer">↗ העבר לזכאים${creditorFids.length>1?' ('+creditorFids.length+')':''}</button>
    </div>`:''}
    ${!_potHasPending&&potPayments.length?`<button onclick="releasePot(${ev.id})" style="margin-top:6px;padding:5px 10px;border-radius:6px;border:none;background:var(--blue-mid);color:#fff;font-size:11px;font-weight:700;font-family:var(--font);cursor:pointer">✓ סמן כהועבר</button>`:''}
  </div>`:'';
  const collapsed=collapsedEvents.has(ev.id);
  return`<div class="ecard" id="ecard-${ev.id}">
    <div class="ecard-head" onclick="openEventDash(${ev.id})" style="cursor:pointer" title="לחצו לפרטי האירוע">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:4px">
        <div class="ecard-title">${esc(ev.name)}</div>
        <span class="badge ${balanced&&cost>0?'badge-green':'badge-amber'}">${balanced&&cost>0?'מאוזן':'פעיל'}</span>
      </div>
      ${ev.date&&ev.date!=='לא צוין'?`<div class="ecard-meta">${esc(ev.date)}</div>`:''}
    </div>
    <div class="total-cost-bar" id="totalbar-${ev.id}" onclick="openEventDash(${ev.id})" style="cursor:pointer" title="לחצו לפרטי האירוע">
      <span>📊 סה"כ עלות האירוע</span>
      <span style="display:flex;align-items:center;gap:4px">
        <span id="costdisp-${ev.id}" style="color:var(--green-mid);font-size:16px">₪${cost.toLocaleString()}</span>
        ${ev.totalCost!=null?`<button class="edit-only" onclick="event.stopPropagation();startEditCost(${ev.id})" style="background:none;border:none;padding:2px 3px;cursor:pointer;font-size:12px;color:var(--text3);line-height:1;opacity:.55">✏️</button>`:''}
        <span style="font-size:13px;color:var(--text3);opacity:.7">›</span>
      </span>
    </div>
    <button class="exp-btn" onclick="toggleEvCollapse(${ev.id})">${collapsed?'▼ פרטים':'▲ סגור'}</button>
    ${collapsed?'':`
    <div class="members-list" id="mlist-${ev.id}">${cumRows}</div>
    ${addExpBtn}
    ${exclLine}
    <div class="card-actions">
      <button class="action-btn edit-only" onclick="editEv(${ev.id})">✏️ ערוך</button>
      ${hasSavingsInfo?`<button class="action-btn" onclick="openSettleModal(${ev.id})" style="${transfers.length?'background:var(--green-bg);border-color:var(--green-mid);color:var(--green-mid)':''}">💎 ${transfers.length?`<b>(${transfers.length})</b> `:''} קופת חיסכון</button>`:''}
      ${hasPotHistory?(hasPot?`<button class="action-btn" onclick="openPotModal(${ev.id})" style="background:var(--amber-bg);border-color:var(--amber);color:var(--amber)">💰 ₪${(potTotal-potExpTotalCard).toLocaleString()}${potExpTotalCard>0?` <span style="font-size:10px;opacity:.7">(הוצאות ₪${potExpTotalCard.toLocaleString()})</span>`:''}</button>`:`<button class="action-btn" onclick="openPotModal(${ev.id})" style="background:var(--surface2);border-color:var(--border);color:var(--text2)">💰 קופת האירוע (₪0)</button>`):''}
      ${ev.cumulative&&cost>0?ev.closed?`<span style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:6px;background:var(--surface2);border:1.5px solid var(--border);font-size:12px;color:var(--text2);font-weight:600">🏁 הסתיים</span>${balanced?`<button class="action-btn edit-only" onclick="archiveEv(${ev.id})" style="background:var(--surface2);border-color:var(--border);color:var(--text2)">🗂 לארכיון</button>`:''}` :`<button class="action-btn blue edit-only" onclick="openCloseEvModal(${ev.id})">🏁 סיים אירוע</button>${balanced?`<button class="action-btn edit-only" onclick="archiveEv(${ev.id})" style="background:var(--surface2);border-color:var(--border);color:var(--text2)">🗂 לארכיון</button>`:''}`:balanced&&cost>0?`<button class="action-btn edit-only" onclick="archiveEv(${ev.id})" style="background:var(--surface2);border-color:var(--border);color:var(--text2)">🗂 לארכיון</button>`:''}
      ${cost>0?`<button class="action-btn edit-only" onclick="openEmailModal(${ev.id})" style="background:var(--amber-bg);border-color:var(--amber);color:var(--amber)">📧 מיילים</button>`:''}
      <button class="action-btn red edit-only" onclick="delEv(${ev.id})">🗑 מחק</button>
    </div>`}
  </div>`;
}
function payToPot(evId,famId,amt){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  const adj=evAdjBalance(ev);
  const owed=Math.round(Math.max(0,-(adj[famId]||0)));
  if(owed<=0)return;
  const payment=amt!=null?Math.min(Math.round(amt),owed):owed;
  if(!ev.potPayments)ev.potPayments=[];
  ev.potPayments.push({famId,amt:payment});
  const _pf=getFam(famId);
  addNotif('💰',(_pf?_pf.name.replace('משפחת','').trim():'')+' הפקיד/ה ₪'+payment.toLocaleString()+' לקופת "'+ev.name+'"',undefined,undefined,'deposit',ev.participants);
  save();render();
  if(ev.closed){const nb=evAdjBalance(ev)[famId]||0;if(nb>=-0.5)_sendCloseEvEmailOne(ev,famId);}
}

function calcPotTransfers(ev){
  const pots=evEffectivePotPayments(ev);if(!pots.length)return[];
  const adjBal=evAdjBalance(ev);
  const effByFam={};
  pots.forEach(p=>{effByFam[p.famId]=(effByFam[p.famId]||0)+p.amt;});
  const credFids=new Set(ev.participants.filter(fid=>(adjBal[fid]||0)>0.5));
  // Each creditor's amount = what they still need from non-creditors beyond their own effective pot
  const creds=ev.participants.filter(fid=>credFids.has(fid))
    .map(fid=>({name:getFam(fid).name.replace('משפחת','').trim(),fid,
      amt:Math.max(0,Math.round((adjBal[fid]||0)-(effByFam[fid]||0)))}))
    .filter(c=>c.amt>0.5);
  if(!creds.length)return[];
  const potByFam={};
  pots.forEach(p=>{potByFam[p.famId]=(potByFam[p.famId]||0)+p.amt;});
  const nCopy=Object.entries(potByFam).map(([fidStr,potAmt])=>{
    const fid=parseInt(fidStr);
    if(potAmt<=0.5)return null;
    const f=getFam(fid);if(!f)return null;
    // Creditors who over-deposited (potAmt > adjBal) contribute only the surplus;
    // creditors who under/exact-deposited contribute their full deposit so other
    // creditors get maximally covered from the pot (they collect their adjBal via direct).
    const adj=adjBal[fid]||0;
    const contrib=credFids.has(fid)?(potAmt>adj?Math.round(potAmt-adj):Math.round(potAmt)):Math.round(potAmt);
    if(contrib<=0.5)return null;
    return {name:f.name.replace('משפחת','').trim(),fid,amt:contrib};
  }).filter(n=>n);
  if(!nCopy.length)return[];
  const out=[],pCopy=creds.map(x=>({...x}));
  let pi=0,ni=0;
  while(pi<pCopy.length&&ni<nCopy.length){
    if(nCopy[ni].fid===pCopy[pi].fid){ni++;continue;} // skip self-routing
    const give=Math.min(pCopy[pi].amt,nCopy[ni].amt);
    if(give>0.5) out.push({from:nCopy[ni].name,fromFid:nCopy[ni].fid,to:pCopy[pi].name,toFid:pCopy[pi].fid,amt:Math.round(give)});
    pCopy[pi].amt-=give; nCopy[ni].amt-=give;
    if(pCopy[pi].amt<=0.5)pi++;
    if(nCopy[ni].amt<=0.5)ni++;
  }
  return out;
}
function calcPotExcessByFamily(ev){
  const pots=evEffectivePotPayments(ev);if(!pots.length)return{};
  // Group total pot per family
  const potByFam={};
  pots.forEach(p=>{potByFam[p.famId]=(potByFam[p.famId]||0)+p.amt;});
  // What was actually distributed from each family to creditors
  const distributed={};
  calcPotTransfers(ev).forEach(t=>{distributed[t.fromFid]=(distributed[t.fromFid]||0)+t.amt;});
  // Excess = what they put in - what actually went to creditors
  const result={};
  Object.entries(potByFam).forEach(([fidStr,potAmt])=>{
    const fid=parseInt(fidStr);
    const exc=Math.round(potAmt-(distributed[fid]||0));
    if(exc>0.5) result[fid]=exc;
  });
  return result;
}
function releasePot(evId){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  const pots=evEffectivePotPayments(ev);if(!pots.length)return;
  const baseBal=evAdjBalance({...ev,potPayments:[]});
  const creditors=ev.participants.filter(fid=>(baseBal[fid]||0)>0.5)
    .map(fid=>({name:getFam(fid).name.replace('משפחת','').trim(),fid,amt:baseBal[fid]}));
  if(!creditors.length){
    // No one to route the pot money to, so it counts toward each depositor's own
    // share — but it's a deposit, not something they bought. Track it separately
    // so displays (e.g. the closing-email family table) can tell the two apart
    // instead of silently showing it as a regular item expense.
    if(!ev.potFoldedExpenses)ev.potFoldedExpenses={};
    pots.forEach(p=>{
      ev.expenses[p.famId]=(ev.expenses[p.famId]||0)+p.amt;
      ev.potFoldedExpenses[p.famId]=(ev.potFoldedExpenses[p.famId]||0)+p.amt;
    });
  } else {
    if(!ev.settled)ev.settled=[];
    calcPotTransfers(ev).forEach(t=>{
      ev.settled.push({from:t.from,fromFid:t.fromFid,to:t.to,toFid:t.toFid,amt:t.amt,method:'pot'});
    });
  }
  ev.potPayments=[];
  save();render();
  if(ev.closed){const adjA=evAdjBalance(ev);ev.participants.forEach(fid=>{if(Math.abs(adjA[fid]||0)<=0.5)_sendCloseEvEmailOne(ev,fid);});}
}
function releasePotToOne(evId,creditorFid,toFund){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  if(!(ev.potPayments||[]).length)return;
  const transfers=calcPotTransfers(ev).filter(t=>t.toFid===creditorFid);
  // A creditor who also deposited into the pot themselves has that deposit skipped by
  // calcPotTransfers (it only routes between *different* families) — without adding it
  // back here, that portion of their own money would just sit stuck in the pot forever.
  const adjBal=evAdjBalance(ev);
  const ownExcess=Math.round(calcPotExcessByFamily(ev)[creditorFid]||0);
  const totalAmt=Math.min(
    transfers.reduce((s,t)=>s+t.amt,0)+ownExcess,
    Math.round(adjBal[creditorFid]||0)
  );
  if(totalAmt<=0.5)return;
  if(!ev.settled)ev.settled=[];
  transfers.forEach(t=>{
    ev.settled.push({from:t.from,fromFid:t.fromFid,to:t.to,toFid:t.toFid,amt:t.amt,method:'pot'});
  });
  if(ownExcess>0.5){
    const credFam=getFam(creditorFid);
    const credName=credFam?credFam.name.replace('משפחת','').trim():'';
    ev.settled.push({from:credName,fromFid:creditorFid,to:credName,toFid:creditorFid,amt:ownExcess,method:'pot'});
  }
  if(toFund){
    const fam=getFam(creditorFid);if(!fam)return;
    const key=String(creditorFid);
    fund.famBalances[key]=(fund.famBalances[key]||0)+totalAmt;
    const famName=fam.name.replace('משפחת','').trim();
    fund.transactions.push({id:nxtTx++,type:'deposit',famId:creditorFid,amount:totalAmt,evId:ev.id,
      desc:'מקופת אירוע · '+ev.name+' → '+famName,
      date:new Date().toLocaleDateString('he-IL')});
  }
  const potMap={};
  ev.potPayments.forEach(p=>{potMap[p.famId]=(potMap[p.famId]||0)+p.amt;});
  transfers.forEach(t=>{potMap[t.fromFid]=(potMap[t.fromFid]||0)-t.amt;});
  if(ownExcess>0.5)potMap[creditorFid]=(potMap[creditorFid]||0)-ownExcess;
  ev.potPayments=Object.entries(potMap).filter(([,a])=>a>0.5).map(([fid,amt])=>({famId:+fid,amt:Math.round(amt)}));
  save();render();
  if(ev.closed){const adjA=evAdjBalance(ev);ev.participants.forEach(fid=>{if(Math.abs(adjA[fid]||0)<=0.5)_sendCloseEvEmailOne(ev,fid);});}
}
// Manual override: let the treasurer pick who gets pot money the automatic
// allocation didn't route to them (e.g. two creditors tied for more than the pot holds)
function releasePotManual(evId,creditorFid,amt,toFund){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  amt=Math.round(amt);if(amt<=0)return;
  const adjBal=evAdjBalance(ev);
  const pots=evEffectivePotPayments(ev);
  const totalAvail=pots.reduce((s,p)=>s+p.amt,0);
  amt=Math.min(amt,totalAvail,Math.round(adjBal[creditorFid]||0));
  if(amt<=0)return;
  const cred=getFam(creditorFid);if(!cred)return;
  const credName=cred.name.replace('משפחת','').trim();
  // Include the creditor's own pot deposit as an eligible source too — otherwise
  // their own money just sits stuck in the pot, unreleasable to anyone (see releasePotToOne).
  const potByFam={};
  pots.forEach(p=>{potByFam[p.famId]=(potByFam[p.famId]||0)+p.amt;});
  if(!ev.settled)ev.settled=[];
  const potMap={};
  ev.potPayments.forEach(p=>{potMap[p.famId]=(potMap[p.famId]||0)+p.amt;});
  let rem=amt;
  Object.entries(potByFam).forEach(([fidStr,avail])=>{
    if(rem<=0.5)return;
    const fid=parseInt(fidStr);
    const take=Math.min(avail,rem);
    if(take<=0.5)return;
    const fromFam=getFam(fid);if(!fromFam)return;
    ev.settled.push({from:fromFam.name.replace('משפחת','').trim(),fromFid:fid,to:credName,toFid:creditorFid,amt:Math.round(take),method:'pot'});
    potMap[fid]=(potMap[fid]||0)-take;
    rem-=take;
  });
  const given=amt-rem;
  if(given<=0.5)return;
  if(toFund){
    const key=String(creditorFid);
    fund.famBalances[key]=(fund.famBalances[key]||0)+given;
    fund.transactions.push({id:nxtTx++,type:'deposit',famId:creditorFid,amount:given,evId:ev.id,
      desc:'מקופת אירוע · '+ev.name+' → '+credName,
      date:new Date().toLocaleDateString('he-IL')});
  }
  ev.potPayments=Object.entries(potMap).filter(([,a])=>a>0.5).map(([fid,amt])=>({famId:+fid,amt:Math.round(amt)}));
  save();render();
  if(ev.closed){const adjA=evAdjBalance(ev);ev.participants.forEach(fid=>{if(Math.abs(adjA[fid]||0)<=0.5)_sendCloseEvEmailOne(ev,fid);});}
}
function releasePotToSavings(evId,amt){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  amt=Math.round(amt);if(amt<=0)return;
  if(!ev.potToSavings)ev.potToSavings=[];
  ev.potToSavings.push({amt,date:new Date().toLocaleDateString('he-IL')});
  save();render();
  if(potModalEvId===evId){const te=events.find(e=>e.id===evId);if(te)renderPotModal(te);}
  if(potTrModalEvId===evId){const te=events.find(e=>e.id===evId);if(te&&evPotTotal(te)>0)renderPotTransferModal(te);else closePotTransferModal();}
}
function renderArchiveGoals(){
  const el=document.getElementById('archGoalList');
  if(!el)return;
  const archived=_visibleGoalFunds(goalFunds.filter(g=>g.archived));
  if(!archived.length){el.innerHTML='';return;}
  el.innerHTML=`<div class="sec-ttl" style="margin-top:18px">קופות מטרה בארכיון</div>`+archived.map(g=>{
    const total=goalTotal(g);
    const isExp=expandedArchGoals.has(g.id);
    const rows=families.map(f=>{
      const cl=col(f.id);
      const c=g.contributions[f.id]||0;
      return`<div class="amrow">
        ${famAva(f, 30)}
        <span style="font-size:13px;font-weight:600;flex:1">${esc(f.name.replace('משפחת','').trim())}</span>
        <span style="font-size:12px;color:var(--text2)">הפקיד ₪${c.toLocaleString()}</span>
      </div>`;
    }).join('');
    return`<div class="acard">
      <div class="acard-head">
        <div style="flex:1">
          <div class="acard-title">🔒 🎯 ${esc(g.name)}</div>
          <div class="acard-meta">${g.target>0?`נאסף ₪${total.toLocaleString()} מתוך ₪${g.target.toLocaleString()}`:`נאסף ₪${total.toLocaleString()}`}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
          <span class="total-chip">₪${total.toLocaleString()}</span>
          <button class="exp-btn" onclick="toggleArchGoalExp(${g.id})">${isExp?'▲ סגור':'▼ פרטים'}</button>
        </div>
      </div>
      ${isExp?`<div class="acard-body">${rows}
        <div class="card-actions">
          <button class="action-btn edit-only" onclick="reopenGoalFund(${g.id})">🔓 פתח מחדש</button>
          <button class="action-btn red edit-only" onclick="delGoalFund(${g.id})">🗑 מחק</button>
        </div></div>`:''}
    </div>`;
  }).join('');
}
function renderArchive(){
  renderArchiveGoals();
  const closed=events.filter(e=>!e.open);
  const years=[...new Set(closed.map(e=>e.date.split(' ').pop()))].sort((a,b)=>b-a);
  document.getElementById('yearRow').innerHTML=['all',...years].map(y=>
    `<button class="ypill ${actYear===y?'active':''}" onclick="setYear('${esc(y)}')">${y==='all'?'הכל':esc(y)}</button>`).join('');
  const filtered=actYear==='all'?closed:closed.filter(e=>e.date.includes(actYear));
  if(!filtered.length){document.getElementById('archList').innerHTML=`<div class="empty"><span class="empty-ico">🗂️</span>${closed.length?'אין אירועים לשנה זו':'הארכיון ריק'}</div>`;return;}
  document.getElementById('archList').innerHTML=filtered.map(ev=>{
    const cost=evCost(ev);const isExp=expanded.has(ev.id);
    const excl=families.filter(f=>ev.excluded.includes(f.id));
    const mems=ev.participants.map(fid=>{
      const f=getFam(fid);if(!f)return'';const cl=col(fid);
      const spent=ev.expenses[fid]||0;
      const b=evBalance(ev)[fid];
      return`<div class="amrow">
        ${famAva(f, 30)}
        <span style="font-size:13px;font-weight:600;flex:1">${esc(f.name.replace('משפחת','').trim())}</span>
        <span style="font-size:12px;color:var(--text2)">שילם ₪${spent.toLocaleString()}</span>
        <span class="badge ${b>=0?'badge-green':'badge-amber'}" style="font-size:10px">${b>=0?'קיבל ₪'+b:'החזיר ₪'+Math.abs(b)}</span>
      </div>`;
    }).join('');
    const exclLine=excl.length?`<div class="excl">לא השתתפו: ${excl.map(f=>esc(f.name.replace('משפחת','').trim())).join(', ')}</div>`:'';
    return`<div class="acard">
      <div class="acard-head">
        <div style="flex:1">
          <div class="acard-title">🔒 ${esc(ev.name)}</div>
          <div class="acard-meta">${ev.date&&ev.date!=='לא צוין'?esc(ev.date)+' · ':''}${ev.participants.length} משפחות · ${shareLabel(ev)}</div>
          ${ev.closedOn?`<div class="acard-closed">נסגר: ${ev.closedOn}</div>`:''}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
          <span class="total-chip">₪${cost.toLocaleString()}</span>
          <button class="exp-btn" onclick="toggleExp(${ev.id})">${isExp?'▲ סגור':'▼ פרטים'}</button>
        </div>
      </div>
      ${isExp?`<div class="acard-body">${mems}${exclLine}
        <div class="card-actions">
          <button class="action-btn edit-only" onclick="editEv(${ev.id})">✏️ ערוך</button>
          <button class="action-btn edit-only" onclick="reopenEv(${ev.id})">🔓 פתח מחדש</button>
          <button class="action-btn red edit-only" onclick="delEv(${ev.id})">🗑 מחק</button>
        </div></div>`:''}
    </div>`;
  }).join('');
}
function renderFamilies(){
  const html=families.map(f=>{
    const cl=col(f.id);const cnt=events.filter(e=>e.participants.includes(f.id)).length;
    return`<div class="fcard" onclick="openFamDetail(${f.id})" style="cursor:pointer">
      ${famAva(f, 38)}
      <div style="flex:1"><div class="fname">${esc(f.name)}</div><div class="fevents">${cnt} אירועים${f.children?' · '+f.children+' ילדים':''}<span class="edit-only">${(()=>{const v=new Set(JSON.parse(localStorage.getItem('verifiedEmails')||'[]'));const hasEmail=f.email||f.email2;const allOk=(f.email?v.has(f.email):true)&&(f.email2?v.has(f.email2):true);return hasEmail?(allOk?' · ✅':'· 📧'):'';})()}</span></div></div>
      ${(editMode||f.id===_myFamId())?`<button class="action-btn" onclick="event.stopPropagation();openFamEditSheet(${f.id})">✏️ ערוך</button>`:''}
    </div>`;
  }).join('');
  // Rendered into both the admin "ניהול משפחות" tab list and the
  // lightweight home-screen overlay (familiesHomeOverlay) — whichever of
  // the two is currently in the DOM/open, this keeps it in sync.
  const el1=document.getElementById('famList');if(el1)el1.innerHTML=html;
  const el2=document.getElementById('famListHome');if(el2)el2.innerHTML=html;
}
function _extractYear(str){
  if(!str)return null;
  const m=String(str).match(/(19|20)\d{2}/);
  return m?parseInt(m[0]):null;
}
function _heILDateYear(str){
  if(!str)return null;
  const parts=String(str).split('.');
  if(parts.length===3){const y=parseInt(parts[2]);if(y>1900)return y;}
  return _extractYear(str);
}
function _reportYears(){
  const ys=new Set();
  events.forEach(ev=>{const y=_extractYear(ev.date);if(y)ys.add(y);});
  (fund.transactions||[]).forEach(t=>{const y=_heILDateYear(t.date);if(y)ys.add(y);});
  (savingsPot.expenses||[]).forEach(e=>{const y=_heILDateYear(e.date);if(y)ys.add(y);});
  const cur=new Date().getFullYear();
  ys.add(cur);
  return [...ys].sort((a,b)=>b-a);
}
let _reportView='family';
function openAnnualReport(){
  const modal=document.getElementById('annualReportModal');if(!modal)return;
  const sel=document.getElementById('reportYearSel');
  const years=_reportYears();
  sel.innerHTML=years.map(y=>`<option value="${y}">${y}</option>`).join('');
  sel.value=String(years[0]);
  _reportView='family';
  modal.style.display='flex';
  renderAnnualReport();
}
function closeAnnualReport(){
  const modal=document.getElementById('annualReportModal');if(modal)modal.style.display='none';
}
function setReportView(v){
  _reportView=v;
  renderAnnualReport();
}
function renderAnnualReport(){
  const el=document.getElementById('annualReportBody');if(!el)return;
  const year=parseInt(document.getElementById('reportYearSel').value);
  const yearEvs=events.filter(ev=>_extractYear(ev.date)===year);
  const undatedCount=events.length-events.filter(ev=>_extractYear(ev.date)!=null).length;
  const totalCost=yearEvs.reduce((s,ev)=>s+evCost(ev),0);
  const totalSavings=yearEvs.reduce((s,ev)=>s+(ev.savingsTotal||0),0);
  const famTotals={};
  families.forEach(f=>{famTotals[f.id]={paid:0,share:0};});
  yearEvs.forEach(ev=>{
    const shares=evShares(ev);
    ev.participants.forEach(fid=>{
      if(!famTotals[fid])famTotals[fid]={paid:0,share:0};
      famTotals[fid].paid+=(ev.expenses[fid]||0);
      famTotals[fid].share+=(shares[fid]||0);
    });
  });
  const famRows=families.map(f=>{
    const t=famTotals[f.id]||{paid:0,share:0};
    if(!t.paid&&!t.share)return'';
    const net=Math.round(t.paid-t.share);
    return`<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">
      ${famAva(f,26)}
      <span style="flex:1;font-size:13px;font-weight:600">${esc(f.name.replace('משפחת','').trim())}</span>
      <span style="font-size:12px;color:var(--text2)">עלות: ₪${Math.round(t.share).toLocaleString()}</span>
      <span style="font-size:12px;font-weight:700;color:${net>=0?'var(--green-mid)':'var(--red-mid)'}">${net>=0?'+':''}₪${net.toLocaleString()}</span>
    </div>`;
  }).join('');
  const allEvsSorted=[...yearEvs].sort((a,b)=>evCost(b)-evCost(a));
  const evRows=allEvsSorted.length?allEvsSorted.map(ev=>`<div style="padding:8px 0;border-bottom:1px solid var(--border)">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
      <span style="font-size:13px;font-weight:700;color:var(--text)">${esc(ev.name)}</span>
      <span style="font-size:13px;font-weight:800;flex-shrink:0">₪${evCost(ev).toLocaleString()}</span>
    </div>
    <div style="font-size:11px;color:var(--text2);margin-top:2px">${ev.date&&ev.date!=='לא צוין'?esc(ev.date)+' · ':''}${ev.participants.length} משפחות</div>
  </div>`).join(''):'<div style="font-size:12px;color:var(--text3)">אין אירועים בשנה זו</div>';
  const fundTx=(fund.transactions||[]).filter(t=>_heILDateYear(t.date)===year);
  const fundDeposits=fundTx.filter(t=>t.type==='deposit').reduce((s,t)=>s+t.amount,0);
  const fundPayouts=fundTx.filter(t=>t.type==='payout').reduce((s,t)=>s+t.amount,0);
  const savExpYear=(savingsPot.expenses||[]).filter(e=>_heILDateYear(e.date)===year).reduce((s,e)=>s+e.amt,0);
  const _famActive=_reportView==='family';
  const toggleHtml=`<div style="display:flex;gap:6px;margin-bottom:14px">
    <button onclick="setReportView('family')" style="flex:1;padding:8px;border-radius:var(--r2);border:1.5px solid ${_famActive?'var(--blue-mid)':'var(--border)'};background:${_famActive?'var(--blue-mid)':'transparent'};color:${_famActive?'#fff':'var(--text2)'};font-size:12px;font-weight:700;font-family:var(--font);cursor:pointer">👨‍👩‍👧‍👦 לפי משפחות</button>
    <button onclick="setReportView('events')" style="flex:1;padding:8px;border-radius:var(--r2);border:1.5px solid ${!_famActive?'var(--blue-mid)':'var(--border)'};background:${!_famActive?'var(--blue-mid)':'transparent'};color:${!_famActive?'#fff':'var(--text2)'};font-size:12px;font-weight:700;font-family:var(--font);cursor:pointer">📅 לפי אירועים</button>
  </div>`;
  el.innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div style="background:var(--surface2);border-radius:var(--r2);padding:12px;text-align:center">
        <div style="font-size:11px;color:var(--text2)">אירועים</div>
        <div style="font-size:22px;font-weight:800">${yearEvs.length}</div>
      </div>
      <div style="background:var(--surface2);border-radius:var(--r2);padding:12px;text-align:center">
        <div style="font-size:11px;color:var(--text2)">סה"כ הוצאות</div>
        <div style="font-size:22px;font-weight:800">₪${totalCost.toLocaleString()}</div>
      </div>
      ${totalSavings?`<div style="background:var(--surface2);border-radius:var(--r2);padding:12px;text-align:center">
        <div style="font-size:11px;color:var(--text2)">💎 יעד חיסכון</div>
        <div style="font-size:22px;font-weight:800;color:var(--green-mid)">₪${totalSavings.toLocaleString()}</div>
      </div>`:''}
      ${savExpYear?`<div style="background:var(--surface2);border-radius:var(--r2);padding:12px;text-align:center">
        <div style="font-size:11px;color:var(--text2)">💎 הוצא מהחיסכון</div>
        <div style="font-size:22px;font-weight:800">₪${savExpYear.toLocaleString()}</div>
      </div>`:''}
    </div>
    ${fundTx.length?`<div style="font-size:12px;color:var(--text2);margin-bottom:14px">🏦 ארנק: הופקדו ₪${fundDeposits.toLocaleString()} · שולמו ₪${fundPayouts.toLocaleString()}</div>`:''}
    ${toggleHtml}
    ${_famActive?`
    <div style="font-size:13px;font-weight:800;margin-bottom:6px">👨‍👩‍👧‍👦 לפי משפחה</div>
    <div>${famRows||'<div style="font-size:12px;color:var(--text3)">אין נתונים</div>'}</div>
    `:`
    <div style="font-size:13px;font-weight:800;margin-bottom:6px">📅 כל האירועים</div>
    <div>${evRows}</div>
    `}
    ${undatedCount?`<div style="font-size:11px;color:var(--text3);margin-top:12px">* ${undatedCount} אירועים ללא תאריך שנה מזוהה אינם כלולים בדוח</div>`:''}
  `;
}
function famAva(f, size=34, extra=''){
  const cl=col(f.id);
  const fs=size<=24?'9px':size<=28?'10px':size<=32?'11px':'12px';
  if(f.photo) return `<img src="${f.photo}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;${extra}" alt="">`;
  return `<div class="ava" style="background:${cl.bg};color:${cl.c};width:${size}px;height:${size}px;font-size:${fs};${extra}">${ini(f.name)}</div>`;
}
let _famEditId=null;
let _famEditPhoto=undefined;
// The photo repos (crop/zoom) modal is one shared instance used by both the
// family-photo flow and the tree-person-photo flow below — this flag says
// which staging variable/preview elements confirmPhotoRepos() should write
// into once the user finishes cropping.
let _photoReposTarget='fam';
let _treePersonEditPhoto=undefined;
// undefined = untouched this sheet-open (don't overwrite f.anniversary*),
// null = explicitly cleared, {hebYear,hebMonth,hebDay} = a new pick. Kept
// separate from the shared _kidPickedDate/_kidLegacyDate (which the same
// picker also uses for kid/parent birthdays and yahrzeits) so editing a
// kid's birthday partway through the sheet can never leak into — or wipe —
// the family's own anniversary date.
let _famAnniversaryPending=undefined;
let _reposImgSize=null,_reposOffset={x:0,y:0},_reposDragging=false,_reposStart=null;
let _reposZoom=1,_reposBaseW=0,_reposBaseH=0,_pinchStartDist=null,_pinchStartZoom=1;
function previewFamPhoto(inp){
  if(!inp.files||!inp.files[0])return;
  _photoReposTarget='fam';
  const reader=new FileReader();
  reader.onload=e=>openPhotoRepos(e.target.result);
  reader.readAsDataURL(inp.files[0]);
}
function previewTreePersonPhoto(inp){
  if(!inp.files||!inp.files[0])return;
  _photoReposTarget='treePerson';
  const reader=new FileReader();
  reader.onload=e=>openPhotoRepos(e.target.result);
  reader.readAsDataURL(inp.files[0]);
}
function getPinchDist(e){
  const dx=e.touches[0].clientX-e.touches[1].clientX;
  const dy=e.touches[0].clientY-e.touches[1].clientY;
  return Math.sqrt(dx*dx+dy*dy);
}
function updateReposZoom(z){
  const imgEl=document.getElementById('photoReposImg');
  if(!_reposBaseW)return;
  const sz=200;
  z=Math.min(4,Math.max(1,z));
  _reposZoom=z;
  const dw=_reposBaseW*z,dh=_reposBaseH*z;
  _reposImgSize={w:dw,h:dh,sz};
  imgEl.style.width=dw+'px';imgEl.style.height=dh+'px';
  let nx=Math.min(0,Math.max(sz-dw,_reposOffset.x));
  let ny=Math.min(0,Math.max(sz-dh,_reposOffset.y));
  _reposOffset={x:nx,y:ny};
  imgEl.style.transform=`translate(${nx}px,${ny}px)`;
  const zoomLbl=document.getElementById('reposZoomLbl');
  if(zoomLbl)zoomLbl.textContent=Math.round(z*100)+'%';
}
function openPhotoRepos(rawUrl){
  const modal=document.getElementById('photoReposModal');
  const imgEl=document.getElementById('photoReposImg');
  const circle=document.getElementById('photoReposCircle');
  const sz=200;
  _reposZoom=1;_reposBaseW=0;_reposBaseH=0;_pinchStartDist=null;
  imgEl.onload=()=>{
    const nw=imgEl.naturalWidth,nh=imgEl.naturalHeight;
    const scale=Math.max(sz/nw,sz/nh);
    _reposBaseW=nw*scale;_reposBaseH=nh*scale;
    const dw=_reposBaseW,dh=_reposBaseH;
    imgEl.style.width=dw+'px';imgEl.style.height=dh+'px';
    _reposOffset={x:(sz-dw)/2,y:(sz-dh)/2};
    imgEl.style.transform=`translate(${_reposOffset.x}px,${_reposOffset.y}px)`;
    _reposImgSize={w:dw,h:dh,sz};
    const zoomLbl=document.getElementById('reposZoomLbl');
    if(zoomLbl)zoomLbl.textContent='100%';
  };
  imgEl.src=rawUrl;
  modal.style.display='flex';
  const onDown=e=>{
    if(e.touches&&e.touches.length===2){
      _pinchStartDist=getPinchDist(e);
      _pinchStartZoom=_reposZoom;
      e.preventDefault();return;
    }
    _reposDragging=true;
    const p=e.touches?e.touches[0]:e;
    _reposStart={x:p.clientX-_reposOffset.x,y:p.clientY-_reposOffset.y};
    e.preventDefault();
  };
  const onMove=e=>{
    if(e.touches&&e.touches.length===2&&_pinchStartDist){
      const dist=getPinchDist(e);
      updateReposZoom(_pinchStartZoom*(dist/_pinchStartDist));
      e.preventDefault();return;
    }
    if(!_reposDragging||!_reposImgSize)return;
    const p=e.touches?e.touches[0]:e;
    const s=_reposImgSize;
    let nx=p.clientX-_reposStart.x,ny=p.clientY-_reposStart.y;
    nx=Math.min(0,Math.max(s.sz-s.w,nx));
    ny=Math.min(0,Math.max(s.sz-s.h,ny));
    _reposOffset={x:nx,y:ny};
    imgEl.style.transform=`translate(${nx}px,${ny}px)`;
    e.preventDefault();
  };
  const onUp=e=>{
    if(e&&e.touches&&e.touches.length<2)_pinchStartDist=null;
    _reposDragging=false;
  };
  circle.onmousedown=circle.ontouchstart=onDown;
  document.onmousemove=document.ontouchmove=onMove;
  document.onmouseup=document.ontouchend=onUp;
  circle.onwheel=e=>{
    e.preventDefault();
    updateReposZoom(_reposZoom*(e.deltaY<0?1.1:0.9));
  };
}
function confirmPhotoRepos(){
  const imgEl=document.getElementById('photoReposImg');
  const s=_reposImgSize;if(!s)return;
  const canvas=document.createElement('canvas');
  canvas.width=160;canvas.height=160;
  const ratio=160/s.sz;
  canvas.getContext('2d').drawImage(imgEl,_reposOffset.x*ratio,_reposOffset.y*ratio,s.w*ratio,s.h*ratio);
  const dataUrl=canvas.toDataURL('image/jpeg',0.75);
  const previewId=_photoReposTarget==='treePerson'?'treePersonPhotoPreview':'famEditPhotoPreview';
  const clearBtnId=_photoReposTarget==='treePerson'?'treePersonPhotoClear':'famEditPhotoClear';
  if(_photoReposTarget==='treePerson') _treePersonEditPhoto=dataUrl;
  else _famEditPhoto=dataUrl;
  const preview=document.getElementById(previewId);
  const clearBtn=document.getElementById(clearBtnId);
  if(preview) preview.innerHTML=`<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover">`;
  if(clearBtn) clearBtn.style.display='inline-block';
  closePhotoRepos();
}
function closePhotoRepos(){
  document.getElementById('photoReposModal').style.display='none';
  _reposDragging=false;_pinchStartDist=null;
  document.onmousemove=document.ontouchmove=null;
  document.onmouseup=document.ontouchend=null;
}
function clearFamPhoto(){
  _famEditPhoto=null;
  const f=families.find(x=>x.id===_famEditId);
  const cl=f?col(f.id):{bg:'var(--surface2)',c:'var(--text2)'};
  const preview=document.getElementById('famEditPhotoPreview');
  const clearBtn=document.getElementById('famEditPhotoClear');
  const inp=document.getElementById('famEditPhoto');
  if(inp) inp.value='';
  if(preview) preview.innerHTML=f?`<span style="background:${cl.bg};color:${cl.c};width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700">${ini(f.name)}</span>`:'';
  if(clearBtn) clearBtn.style.display='none';
}
function clearTreePersonPhoto(){
  _treePersonEditPhoto=null;
  const preview=document.getElementById('treePersonPhotoPreview');
  const clearBtn=document.getElementById('treePersonPhotoClear');
  const inp=document.getElementById('treePersonPhoto');
  if(inp) inp.value='';
  if(preview) preview.innerHTML='<span style="font-size:22px">👤</span>';
  if(clearBtn) clearBtn.style.display='none';
}
function openFamEditSheet(fid){
  const f=families.find(x=>x.id===fid);if(!f)return;
  _famEditId=fid;
  document.getElementById('famEditName').value=f.name.replace('משפחת','').trim();
  const cl=col(f.id);
  const preview=document.getElementById('famEditPhotoPreview');
  const clearBtn=document.getElementById('famEditPhotoClear');
  const inp=document.getElementById('famEditPhoto');
  if(inp)inp.value='';
  _famEditPhoto=undefined;
  if(preview){
    if(f.photo){ preview.innerHTML=`<img src="${f.photo}" style="width:100%;height:100%;object-fit:cover">`; }
    else { preview.innerHTML=`<span style="background:${cl.bg};color:${cl.c};width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700">${ini(f.name)}</span>`; }
  }
  if(clearBtn) clearBtn.style.display=f.photo?'inline-block':'none';
  _famAnniversaryPending=undefined;
  renderFamPeopleGrid();
  document.getElementById('famEditOverlay').style.display='flex';
}
function openFamAnniversaryPicker(){
  const f=families.find(x=>x.id===_famEditId);if(!f)return;
  _dateBtnTargetId='famAnniversaryDateBtn';_dateBtnPlaceholder='📅 בחר תאריך נישואין';
  if(f.anniversaryDay&&f.anniversaryMonth&&f.anniversaryYear){_kidPickedDate={hebYear:f.anniversaryYear,hebMonth:f.anniversaryMonth,hebDay:f.anniversaryDay};_kidLegacyDate=null;}
  else if(f.anniversaryDay&&f.anniversaryMonth){_kidPickedDate=null;_kidLegacyDate={hebMonth:f.anniversaryMonth,hebDay:f.anniversaryDay};}
  else{_kidPickedDate=null;_kidLegacyDate=null;}
  openKidDatePicker();
}
function renderFamPeopleGrid(){
  const el=document.getElementById('famPeopleGrid');if(!el)return;
  const f=families.find(x=>x.id===_famEditId);if(!f)return;
  const circle=(idx,label,icon,onclick,dashed)=>{
    const cl=COLORS[idx%COLORS.length];
    return`<div onclick="${onclick}" style="display:flex;flex-direction:column;align-items:center;gap:5px;cursor:pointer">
      <div style="width:56px;height:56px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;${dashed?'border:2px dashed var(--border);color:var(--text3);background:transparent':'background:'+cl.bg+';color:'+cl.c}">${icon}</div>
      <div style="font-size:11px;font-weight:600;color:${dashed?'var(--text3)':'var(--text)'};text-align:center;max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label)}</div>
    </div>`;
  };
  const parentsHtml=`<div style="display:flex;gap:20px;justify-content:center;margin-bottom:18px">
    ${circle(0,f.emailName||'הורה 1','👤',"openPersonModal('p1')")}
    ${circle(1,f.emailName2||'הורה 2','👤',"openPersonModal('p2')")}
  </div>`;
  // _famAnniversaryPending (undefined = untouched this sheet-open, null =
  // cleared, object = newly picked) reflects an in-progress edit that
  // hasn't been saved to the family yet — see selectKidPickerDay/saveFamEdit.
  const annivSrc=_famAnniversaryPending!==undefined?_famAnniversaryPending:{hebDay:f.anniversaryDay,hebMonth:f.anniversaryMonth};
  const hasAnniv=!!(annivSrc&&annivSrc.hebDay&&annivSrc.hebMonth);
  const annivLabel=hasAnniv?(HEB_DAY_NUM[annivSrc.hebDay]+' ב'+annivSrc.hebMonth):'הוסף יום נישואין';
  const annivHtml=`<div style="display:flex;justify-content:center;margin-bottom:18px">
    ${hasAnniv?circle(2,annivLabel,'💍','openFamAnniversaryPicker()'):circle(2,annivLabel,'+','openFamAnniversaryPicker()',true)}
  </div>`;
  let kidsHtml=(f.kids||[]).map((k,i)=>{
    const icon=k.gender==='boy'?'👦':k.gender==='girl'?'👧':'👶';
    return circle(i+2,k.name||'ילד/ה',icon,`openPersonModal('kid',${k.id})`);
  }).join('');
  kidsHtml+=circle(0,'הוסף ילד','+',"openPersonModal('kid')",true);
  el.innerHTML=parentsHtml+annivHtml
    +'<div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.3px;margin-bottom:8px">👶 ילדים</div>'
    +'<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px 8px">'+kidsHtml+'</div>';
}
function openFamDetail(famId){
  const f=getFam(famId);if(!f)return;
  const name=f.name.replace('משפחת','').trim();
  const openEvs=events.filter(e=>e.open&&e.participants.includes(famId));
  const mainBal=Math.round(famFundBal(famId));
  const myGoals=_visibleGoalFunds(goalFunds.filter(g=>!g.archived&&((g.contributions[famId]||0)>0||_goalOwedAmt(g,famId)>0.5)));

  let html=`<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
    ${famAva(f,52)}
    <div>
      <div style="font-size:17px;font-weight:800;color:var(--text)">משפחת ${esc(name)}</div>
      ${f.children?`<div style="font-size:12px;color:var(--text2);margin-top:2px">👶 ${f.children} ילדים</div>`:'<div style="font-size:12px;color:var(--text3);margin-top:2px">ללא ילדים רשומים</div>'}
    </div>
  </div>`;

  // ילדים ותאריכי לידה
  if(f.kids&&f.kids.length){
    html+=`<div style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:6px">👶 ילדים</div>
      ${f.kids.map(k=>{
        const icon=k.gender==='boy'?'👦':k.gender==='girl'?'👧':'👶';
        let dateTxt='',ageBadge='';
        if(k.hebDay&&k.hebMonth){
          dateTxt=HEB_DAY_NUM[k.hebDay]+' ב'+k.hebMonth+(k.hebYear?' '+toHebrewYear(k.hebYear):'');
          const age=kidAge(k);
          if(age!=null){
            const txt=k.gender==='boy'?'בן '+age:k.gender==='girl'?'בת '+age:String(age);
            ageBadge=`<span class="bday-balloon">${esc(txt)}</span>`;
          }
        }
        return`<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:13px;color:var(--text)">${icon} ${esc(k.name||'ילד/ה')}</span>
          <span style="font-size:12px;color:var(--text2)">${dateTxt||'אין תאריך לידה'}${ageBadge}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  // מיילים
  const emails=[f.email,f.email2].filter(Boolean);
  if(emails.length){
    html+=`<div style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:6px">📧 כתובות מייל</div>
      ${emails.map(e=>`<div style="font-size:13px;color:var(--text);padding:5px 0;border-bottom:1px solid var(--border)">${esc(e)}</div>`).join('')}
    </div>`;
  }

  // יתרת ארנק
  html+=`<div style="margin-bottom:14px;padding:12px;background:var(--surface2);border-radius:var(--r2);display:flex;justify-content:space-between;align-items:center">
    <span style="font-size:13px;font-weight:600;color:var(--text2)">🏦 ארנק</span>
    <span style="font-size:15px;font-weight:800;color:${mainBal>=0?'var(--green-mid)':'var(--red-mid)'}">₪${mainBal.toLocaleString()}</span>
  </div>`;

  // קופות מטרה
  if(myGoals.length){
    html+=`<div style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:6px">🎯 קופות מטרה</div>
      ${myGoals.map(g=>{
        const contrib=Math.round(g.contributions[famId]||0);
        const owed=Math.round(_goalOwedAmt(g,famId));
        const tOwed=Math.round(goalTreasurerOwed(g,famId));
        // A fund they still owe money on is worth flagging here (red, like
        // an event debt) even if they've partially contributed — otherwise
        // it only ever showed up once they'd already paid something. And a
        // contribution the treasurer fronted for them (markGoalContribFromTreasurer)
        // isn't a real payment either — _goalOwedAmt already reads 0 once
        // it's credited, so without this it looked fully settled; show it
        // as still owed, just to the treasurer instead of the fund.
        const amtHtml=owed>0.5
          ?`<span style="font-size:13px;font-weight:700;color:var(--red-mid)">חוב ₪${owed.toLocaleString()}</span>`
          :tOwed>0.5
          ?`<span style="font-size:13px;font-weight:700;color:var(--amber)">💼 חוב לגזבר ₪${tOwed.toLocaleString()}</span>`
          :`<span style="font-size:13px;font-weight:700;color:var(--green-mid)">₪${contrib.toLocaleString()}</span>`;
        return`<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:13px;color:var(--text)">${esc(g.name)}</span>
          ${amtHtml}
        </div>`;
      }).join('')}
    </div>`;
  }

  // אירועים פתוחים
  if(openEvs.length){
    html+=`<div style="margin-bottom:6px">
      <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:6px">📅 אירועים פעילים</div>
      ${openEvs.map(ev=>{
        const bal=evAdjBalance(ev)[famId]||0;
        const balRound=Math.round(bal);
        const balColor=bal>0.5?'var(--green-mid)':bal<-0.5?'var(--red-mid)':'var(--text3)';
        const balText=bal>0.5?`+₪${balRound.toLocaleString()}`:bal<-0.5?`-₪${Math.abs(balRound).toLocaleString()}`:'מסודר';
        return`<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:13px;color:var(--text)">${esc(ev.name)}</span>
          <span style="font-size:13px;font-weight:700;color:${balColor}">${balText}</span>
        </div>`;
      }).join('')}
    </div>`;
  }else{
    html+=`<div style="font-size:12px;color:var(--text3);text-align:center;padding:8px 0">אין אירועים פעילים</div>`;
  }

  document.getElementById('famDetailContent').innerHTML=html;
  document.getElementById('famDetailOverlay').style.display='flex';
}
function closeFamDetail(){
  document.getElementById('famDetailOverlay').style.display='none';
}

function closeFamEditSheet(){
  document.getElementById('famEditOverlay').style.display='none';
  _famEditId=null;
}
let _personMode=null,_personKidId=null,_kidGender='',_kidPickedDate=null,_kidPickerRefDate=new Date(),_kidLegacyDate=null;
// The Hebrew date picker (kidDatePickerModal) is shared by whichever modal
// opened it last — personModal (birthdays) or yahrzeitModal (memorial
// dates) — since only one can be open at a time. This tracks which
// trigger button's label to update when a date is picked.
let _dateBtnTargetId='personDateBtn',_dateBtnPlaceholder='📅 בחר תאריך לידה';
function setKidGender(g){
  _kidGender=g;
  const b1=document.getElementById('personGenderBoy'),b2=document.getElementById('personGenderGirl');
  if(b1){b1.style.background=g==='boy'?'var(--blue-mid)':'transparent';b1.style.color=g==='boy'?'#fff':'var(--text2)';b1.style.borderColor=g==='boy'?'var(--blue-mid)':'var(--border)';}
  if(b2){b2.style.background=g==='girl'?'var(--blue-mid)':'transparent';b2.style.color=g==='girl'?'#fff':'var(--text2)';b2.style.borderColor=g==='girl'?'var(--blue-mid)':'var(--border)';}
}
function updateKidDateBtn(){
  const btn=document.getElementById(_dateBtnTargetId);if(!btn)return;
  if(_kidPickedDate)btn.textContent='📅 '+HEB_DAY_NUM[_kidPickedDate.hebDay]+' ב'+_kidPickedDate.hebMonth+' '+toHebrewYear(_kidPickedDate.hebYear);
  else if(_kidLegacyDate)btn.textContent='📅 '+HEB_DAY_NUM[_kidLegacyDate.hebDay]+' ב'+_kidLegacyDate.hebMonth+' (לחצו לבחירת שנה)';
  else btn.textContent=_dateBtnPlaceholder;
}
function clearKidDate(){
  _kidPickedDate=null;
  _kidLegacyDate=null;
  if(_dateBtnTargetId==='famAnniversaryDateBtn'){_famAnniversaryPending=null;renderFamPeopleGrid();}
  updateKidDateBtn();
}
// A legacy day+month (no year yet) has no Gregorian date of its own — pick
// whichever nearby Hebrew year actually has that day/month combo (not every
// year does, e.g. day 30 of a month that's sometimes 29 days) just to land
// the picker's calendar view on the right month, so adding the year doesn't
// also force re-finding the day from scratch.
function _legacyDateRefDate(legacy){
  const y0=parseInt(new Intl.DateTimeFormat('he-IL-u-ca-hebrew-nu-latn',{year:'numeric'}).format(new Date()));
  for(let dy=0;dy<=3;dy++){
    for(const y of dy===0?[y0]:[y0-dy,y0+dy]){
      const d=hebrewToGregorian(y,legacy.hebMonth,legacy.hebDay);
      if(d)return d;
    }
  }
  return null;
}
function openKidDatePicker(){
  _kidPickerRefDate=_kidPickedDate?(hebrewToGregorian(_kidPickedDate.hebYear,_kidPickedDate.hebMonth,_kidPickedDate.hebDay)||new Date())
    :_kidLegacyDate?(_legacyDateRefDate(_kidLegacyDate)||new Date())
    :new Date();
  closeKidYearList();
  renderKidDatePicker();
  document.getElementById('kidDatePickerModal').style.display='flex';
}
function closeKidDatePicker(){
  document.getElementById('kidDatePickerModal').style.display='none';
  closeKidYearList();
}
function kidPickerPrevMonth(){
  closeKidYearList();
  const days=getHebMonthDays(_kidPickerRefDate);
  const prev=new Date(days[0]);prev.setDate(prev.getDate()-1);
  _kidPickerRefDate=prev;
  renderKidDatePicker();
}
function kidPickerNextMonth(){
  closeKidYearList();
  const days=getHebMonthDays(_kidPickerRefDate);
  const next=new Date(days[days.length-1]);next.setDate(next.getDate()+1);
  _kidPickerRefDate=next;
  renderKidDatePicker();
}
function toggleKidYearList(){
  const el=document.getElementById('kidYearList');if(!el)return;
  if(el.style.display==='block'){closeKidYearList();return;}
  renderKidYearList();
  el.style.display='block';
}
function closeKidYearList(){
  const el=document.getElementById('kidYearList');if(el)el.style.display='none';
}
function renderKidYearList(){
  const el=document.getElementById('kidYearList');if(!el)return;
  const days=getHebMonthDays(_kidPickerRefDate);
  const curYear=parseInt(new Intl.DateTimeFormat('he-IL-u-ca-hebrew-nu-latn',{year:'numeric'}).format(days[0]));
  let html='';
  for(let y=curYear+2;y>=curYear-100;y--){
    const active=y===curYear;
    html+=`<button type="button" onclick="jumpKidPickerYear(${y})" style="display:block;width:100%;padding:7px 10px;border:none;background:${active?'var(--blue-bg)':'transparent'};color:${active?'var(--blue-mid)':'var(--text)'};font-size:13px;font-weight:${active?'700':'500'};font-family:var(--font);cursor:pointer;text-align:center">${toHebrewYear(y)}</button>`;
  }
  el.innerHTML=html;
}
function jumpKidPickerYear(y){
  // Picking a year while the day/month is already known (editing an
  // existing date, or filling in the missing year on a legacy one) really
  // means "just change the year" — commit that same day/month in the new
  // year immediately instead of making them re-find and re-click the day
  // cell they already had. Falls through to a plain navigate when that
  // day doesn't exist in the target year (e.g. it's the 30th of a month
  // that isn't always 30 days) so they can pick the nearest valid day.
  const knownDay=_kidPickedDate?{hebDay:_kidPickedDate.hebDay,hebMonth:_kidPickedDate.hebMonth}
    :_kidLegacyDate?{hebDay:_kidLegacyDate.hebDay,hebMonth:_kidLegacyDate.hebMonth}:null;
  if(knownDay&&hebrewToGregorian(y,knownDay.hebMonth,knownDay.hebDay)){
    selectKidPickerDay(y,knownDay.hebMonth,knownDay.hebDay);
    return;
  }
  const days=getHebMonthDays(_kidPickerRefDate);
  const curMonthName=new Intl.DateTimeFormat('he-IL-u-ca-hebrew',{month:'long'}).format(days[0]);
  const target=hebrewToGregorian(y,curMonthName,1)||hebrewToGregorian(y,'תשרי',1);
  if(target)_kidPickerRefDate=target;
  closeKidYearList();
  renderKidDatePicker();
}
function renderKidDatePicker(){
  const days=getHebMonthDays(_kidPickerRefDate);
  const first=days[0];
  const hebMonth=new Intl.DateTimeFormat('he-IL-u-ca-hebrew',{month:'long'}).format(first);
  const hebYearNum=parseInt(new Intl.DateTimeFormat('he-IL-u-ca-hebrew-nu-latn',{year:'numeric'}).format(first));
  document.getElementById('kidPickerTitle').textContent=hebMonth+' '+toHebrewYear(hebYearNum);
  const todayStr=new Date().toISOString().slice(0,10);
  let html=HEB_DAYS_SHORT.map(d=>`<div class="fh-cal-dow">${d}</div>`).join('');
  for(let i=0;i<first.getDay();i++)html+=`<div class="fh-cal-day other-m empty"></div>`;
  days.forEach(dayDate=>{
    const ds=dayDate.toISOString().slice(0,10);
    const hebDayNumInt=parseInt(new Intl.DateTimeFormat('he-IL-u-ca-hebrew-nu-latn',{day:'numeric'}).format(dayDate));
    const label=HEB_DAY_NUM[hebDayNumInt]||String(hebDayNumInt);
    const isToday=ds===todayStr;
    const isSel=_kidPickedDate&&_kidPickedDate.hebYear===hebYearNum&&_kidPickedDate.hebMonth===hebMonth&&_kidPickedDate.hebDay===hebDayNumInt;
    const cls=['fh-cal-day',isToday?'today':'',isSel?'sel':''].filter(Boolean).join(' ');
    html+=`<div class="${cls}" onclick="selectKidPickerDay(${hebYearNum},'${hebMonth}',${hebDayNumInt})"><span style="font-size:10px;line-height:1">${label}</span></div>`;
  });
  document.getElementById('kidPickerGrid').innerHTML=html;
}
function selectKidPickerDay(hebYear,hebMonth,hebDay){
  _kidPickedDate={hebYear,hebMonth,hebDay};
  _kidLegacyDate=null;
  if(_dateBtnTargetId==='famAnniversaryDateBtn'){
    _famAnniversaryPending={hebYear,hebMonth,hebDay};
    // The anniversary date button was replaced by a circle in the people
    // grid (see renderFamPeopleGrid, which reads _famAnniversaryPending
    // when set) — refresh it now so picking a date shows up immediately,
    // same as Steinhart's circle does, without writing to the family
    // object itself before the edit sheet is actually saved.
    renderFamPeopleGrid();
  }
  updateKidDateBtn();
  closeKidDatePicker();
}
function _currentBdayValue(){
  if(_kidPickedDate)return{hebMonth:_kidPickedDate.hebMonth,hebDay:_kidPickedDate.hebDay,hebYear:_kidPickedDate.hebYear};
  if(_kidLegacyDate)return{hebMonth:_kidLegacyDate.hebMonth,hebDay:_kidLegacyDate.hebDay,hebYear:null};
  return null;
}
function openPersonModal(mode,kidId){
  if(_famEditId==null)return;
  const f=families.find(x=>x.id===_famEditId);if(!f)return;
  _personMode=mode;
  _personKidId=kidId??null;
  _dateBtnTargetId='personDateBtn';_dateBtnPlaceholder='📅 בחר תאריך לידה';
  const emailWrap=document.getElementById('personEmailWrap');
  const genderWrap=document.getElementById('personGenderWrap');
  const deleteBtn=document.getElementById('personDeleteBtn');
  const title=document.getElementById('personModalTitle');
  const nameInp=document.getElementById('personName');
  if(mode==='p1'||mode==='p2'){
    emailWrap.style.display='block';
    genderWrap.style.display='none';
    const isP1=mode==='p1';
    const email=isP1?f.email:f.email2;
    const bday=isP1?f.parent1Bday:f.parent2Bday;
    nameInp.value=isP1?(f.emailName||''):(f.emailName2||'');
    document.getElementById('personEmail').value=email||'';
    title.textContent=isP1?'👤 הורה 1':'👤 הורה 2';
    const verified=new Set(JSON.parse(localStorage.getItem('verifiedEmails')||'[]'));
    const tb=document.getElementById('personTestBtn');
    if(tb){tb.textContent=email&&verified.has(email)?'✓':'בדוק';tb.style.color=email&&verified.has(email)?'var(--green)':'var(--text2)';tb.style.fontWeight=email&&verified.has(email)?'700':'';}
    if(bday&&bday.hebDay&&bday.hebMonth&&bday.hebYear){_kidPickedDate={hebYear:bday.hebYear,hebMonth:bday.hebMonth,hebDay:bday.hebDay};_kidLegacyDate=null;}
    else if(bday&&bday.hebDay&&bday.hebMonth){_kidPickedDate=null;_kidLegacyDate={hebMonth:bday.hebMonth,hebDay:bday.hebDay};}
    else{_kidPickedDate=null;_kidLegacyDate=null;}
    deleteBtn.style.display=(email||nameInp.value||bday)?'block':'none';
  }else{
    emailWrap.style.display='none';
    genderWrap.style.display='flex';
    const k=kidId!=null?(f.kids||[]).find(x=>x.id===kidId):null;
    nameInp.value=k?.name||'';
    setKidGender(k?.gender||'');
    if(k&&k.hebDay&&k.hebMonth&&k.hebYear){_kidPickedDate={hebYear:k.hebYear,hebMonth:k.hebMonth,hebDay:k.hebDay};_kidLegacyDate=null;}
    else if(k&&k.hebDay&&k.hebMonth){_kidPickedDate=null;_kidLegacyDate={hebMonth:k.hebMonth,hebDay:k.hebDay};}
    else{_kidPickedDate=null;_kidLegacyDate=null;}
    title.textContent=k?'✏️ ערוך ילד':'👶 הוסף ילד';
    deleteBtn.style.display=k?'block':'none';
  }
  updateKidDateBtn();
  document.getElementById('personModal').style.display='flex';
  setTimeout(()=>{if(nameInp)nameInp.focus();},50);
}
function closePersonModal(){
  document.getElementById('personModal').style.display='none';
  _personMode=null;_personKidId=null;
}
function savePerson(){
  const f=families.find(x=>x.id===_famEditId);if(!f)return;
  const name=(document.getElementById('personName').value||'').trim();
  const bday=_currentBdayValue();
  if(_personMode==='p1'||_personMode==='p2'){
    const isP1=_personMode==='p1';
    const email=_cleanEmail(document.getElementById('personEmail').value)||'';
    const prevEmail=isP1?f.email:f.email2;
    if(isP1){f.email=email;f.emailName=name;}else{f.email2=email;f.emailName2=name;}
    if(prevEmail&&prevEmail!==email){
      const verified=new Set(JSON.parse(localStorage.getItem('verifiedEmails')||'[]'));
      verified.delete(prevEmail);
      localStorage.setItem('verifiedEmails',JSON.stringify([...verified]));
    }
    const bdayField=isP1?'parent1Bday':'parent2Bday';
    if(bday)f[bdayField]={...bday};else delete f[bdayField];
  }else{
    if(!f.kids)f.kids=[];
    if(_personKidId!=null){
      const k=f.kids.find(x=>x.id===_personKidId);
      if(k){k.name=name;k.gender=_kidGender;k.hebMonth=bday?bday.hebMonth:'';k.hebDay=bday?bday.hebDay:null;k.hebYear=bday?bday.hebYear:null;}
    }else{
      const nid=f.kids.length?Math.max(...f.kids.map(k=>k.id))+1:1;
      f.kids.push({id:nid,name,gender:_kidGender,hebMonth:bday?bday.hebMonth:'',hebDay:bday?bday.hebDay:null,hebYear:bday?bday.hebYear:null});
    }
    f.children=f.kids.length;
  }
  f.namesConfirmed=true;
  if(!editMode)addNotif('👪',f.name+' עדכנ/ה פרטים אישיים','admin',undefined,'familyEdit');
  save();renderFamPeopleGrid();render();closePersonModal();
}
function deletePerson(){
  const f=families.find(x=>x.id===_famEditId);if(!f)return;
  if(_personMode==='p1'||_personMode==='p2'){
    if(!confirm('למחוק את פרטי ההורה?'))return;
    const isP1=_personMode==='p1';
    // Email is admin-managed (see personEmailWrap's edit-only gate) — a family
    // member deleting their own name/birthday here must not silently wipe out
    // the notification email the admin set up for them.
    if(isP1){if(editMode)f.email='';f.emailName='';delete f.parent1Bday;}else{if(editMode)f.email2='';f.emailName2='';delete f.parent2Bday;}
  }else{
    if(_personKidId==null)return;
    if(!confirm('למחוק ילד זה?'))return;
    f.kids=(f.kids||[]).filter(k=>k.id!==_personKidId);
    f.children=f.kids.length;
  }
  save();renderFamPeopleGrid();render();closePersonModal();
}

// ── Yahrzeits (memorial dates on the family calendar) ──────────────────────
let _editYahrzeitId=null;
function openYahrzeitModal(id){
  _editYahrzeitId=id!=null?id:null;
  const y=id!=null?yahrzeits.find(x=>x.id===id):null;
  document.getElementById('yahrzeitName').value=y?y.name:'';
  _dateBtnTargetId='yahrzeitDateBtn';_dateBtnPlaceholder='📅 בחר תאריך פטירה';
  if(y&&y.hebDay&&y.hebMonth&&y.hebYear){_kidPickedDate={hebYear:y.hebYear,hebMonth:y.hebMonth,hebDay:y.hebDay};_kidLegacyDate=null;}
  else if(y&&y.hebDay&&y.hebMonth){_kidPickedDate=null;_kidLegacyDate={hebMonth:y.hebMonth,hebDay:y.hebDay};}
  else{_kidPickedDate=null;_kidLegacyDate=null;}
  updateKidDateBtn();
  const err=document.getElementById('yahrzeitErr');if(err)err.style.display='none';
  document.getElementById('yahrzeitModalTitle').textContent=y?'✏️ עריכת יארצייט':'🕯 הוספת יארצייט';
  document.getElementById('yahrzeitSaveBtn').textContent=y?'✓ שמור שינויים':'✓ הוסף';
  document.getElementById('yahrzeitDeleteBtn').style.display=y?'block':'none';
  document.getElementById('yahrzeitModal').style.display='flex';
  setTimeout(()=>{const i=document.getElementById('yahrzeitName');if(i)i.focus();},50);
}
function closeYahrzeitModal(){
  document.getElementById('yahrzeitModal').style.display='none';
  _editYahrzeitId=null;
}
function saveYahrzeit(){
  const name=(document.getElementById('yahrzeitName').value||'').trim();
  const bday=_currentBdayValue();
  const err=document.getElementById('yahrzeitErr');
  if(!name||!bday||!bday.hebDay||!bday.hebMonth){if(err){err.textContent='נא למלא שם ותאריך פטירה';err.style.display='block';}return;}
  if(err)err.style.display='none';
  if(_editYahrzeitId!=null){
    const y=yahrzeits.find(x=>x.id===_editYahrzeitId);
    if(y){y.name=name;y.hebDay=bday.hebDay;y.hebMonth=bday.hebMonth;y.hebYear=bday.hebYear;}
  }else{
    yahrzeits.push({id:nxtYahrzeit++,name,hebDay:bday.hebDay,hebMonth:bday.hebMonth,hebYear:bday.hebYear});
  }
  closeYahrzeitModal();
  save();renderCalendar();
}
function deleteYahrzeit(id){
  const targetId=id??_editYahrzeitId;if(targetId==null)return;
  if(!confirm('למחוק יארצייט זה?'))return;
  yahrzeits=yahrzeits.filter(y=>y.id!==targetId);
  save();renderCalendar();
  closeYahrzeitModal();
}
function allYahrzeits(){
  return yahrzeits;
}
function allAnniversaries(){
  return families.filter(f=>f.anniversaryDay&&f.anniversaryMonth).map(f=>({
    id:f.id,name:f.name.replace('משפחת','').trim(),
    hebDay:f.anniversaryDay,hebMonth:f.anniversaryMonth,hebYear:f.anniversaryYear
  }));
}
function _currentHebYear(){
  return parseInt(new Intl.DateTimeFormat('he-IL-u-ca-hebrew-nu-latn',{year:'numeric'}).format(new Date()));
}

function saveFamEdit(){
  if(_famEditId==null)return;
  const f=families.find(x=>x.id===_famEditId);if(!f)return;
  let name=document.getElementById('famEditName').value.trim();
  if(!name){ alert('נא להזין שם'); return; }
  if(!name.startsWith('משפחת'))name='משפחת '+name;
  f.name=name;
  if(_famEditPhoto!==undefined) f.photo=_famEditPhoto||undefined;
  _famEditPhoto=undefined;
  if(_famAnniversaryPending!==undefined){
    if(_famAnniversaryPending){f.anniversaryDay=_famAnniversaryPending.hebDay;f.anniversaryMonth=_famAnniversaryPending.hebMonth;f.anniversaryYear=_famAnniversaryPending.hebYear;}
    else{delete f.anniversaryDay;delete f.anniversaryMonth;delete f.anniversaryYear;}
  }
  _famAnniversaryPending=undefined;
  f.namesConfirmed=true;
  if(!editMode)addNotif('👪',f.name+' עדכנ/ה את פרטי המשפחה','admin',undefined,'familyEdit');
  closeFamEditSheet();
  save();render();
}
function delFamFromEdit(){
  if(_famEditId==null)return;
  if(events.some(e=>e.participants.includes(_famEditId))){alert('לא ניתן למחוק משפחה שמשתתפת באירועים');return;}
  if(!confirm('להסיר את המשפחה?'))return;
  families=families.filter(f=>f.id!==_famEditId);
  closeFamEditSheet();
  save();render();
}

// Form
let expMode='total';
let editingId=null;
let splitMethod='equal';
let _custItems={};
let _custItemSeq=1;
function setSplitMethod(method){
  splitMethod=method;
  ['splitEqual','splitPercapita','splitWeighted'].forEach(id=>document.getElementById(id).classList.remove('active'));
  const ids={equal:'splitEqual',percapita:'splitPercapita',weighted:'splitWeighted'};
  document.getElementById(ids[method]).classList.add('active');
  updateChildOverrideInputs();
  if(expMode==='total') updateTotalPreview();
}
function formChildOverride(fid){
  const inp=document.getElementById('fchild-'+fid);
  if(inp&&inp.value!=='') return Math.max(0,parseInt(inp.value)||0);
  return undefined;
}
function formParentOverride(fid){
  const inp=document.getElementById('fparent-'+fid);
  if(inp&&inp.value!=='') return Math.min(2,Math.max(0,parseInt(inp.value)||0));
  return undefined;
}
function stepParent(id,delta){
  const inp=document.getElementById(id);if(!inp)return;
  inp.value=Math.min(2,Math.max(0,(parseInt(inp.value)||0)+delta));
  if(expMode==='total')updateTotalPreview();updateChildPickSummary();
}
// Cumulative events pick their split method per expense item, not once for the whole
// event — but the family composition (used as the default headcount for any item split
// "לפי נפשות"/"weighted") is still set once, at event level, same as percapita/weighted.
const _wantsFamComposition=()=>splitMethod==='percapita'||splitMethod==='weighted'||expMode==='cumulative';
function updateChildOverrideInputs(){
  const sec=document.getElementById('childOverrideSection');
  const selected=families.filter(f=>{ const c=document.getElementById('chip-'+f.id); return c&&c.classList.contains('on'); });
  if(!_wantsFamComposition()||!selected.length){ sec.style.display='none'; return; }
  sec.style.display='block';
  const ev=editingId!=null?events.find(e=>e.id===editingId):null;
  const btnStyle='width:30px;height:30px;border:none;background:var(--bg);color:var(--text);font-size:17px;font-weight:300;cursor:pointer;font-family:var(--font)';
  const inpStyle='border:none;border-right:1.5px solid var(--border);border-left:1.5px solid var(--border);border-radius:0;width:36px;height:30px;padding:0';
  const stepperWrap='display:flex;align-items:center;border:1.5px solid var(--border);border-radius:var(--r2);overflow:hidden';
  document.getElementById('childOverrideInputs').innerHTML=selected.map(f=>{
    const valCh=ev&&ev.childOverrides&&ev.childOverrides[f.id]!=null?ev.childOverrides[f.id]:(_wantsFamComposition()?famAge3PlusChildCount(f):(f.children||0));
    const valPa=ev&&ev.parentOverrides&&ev.parentOverrides[f.id]!=null?ev.parentOverrides[f.id]:FAM_ADULTS;
    return`<div style="margin-bottom:10px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--r2)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        ${famAva(f, 28, 'flex-shrink:0')}
        <span style="flex:1;font-size:13px;font-weight:700">${esc(f.name.replace('משפחת','').trim())}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:12px;color:var(--text2);width:44px">הורים</span>
        <div style="${stepperWrap}">
          <button type="button" onclick="stepParent('fparent-${f.id}',-1)" style="${btnStyle}">−</button>
          <input class="children-inp" type="number" min="0" max="2" inputmode="numeric" id="fparent-${f.id}" value="${valPa}" oninput="if(expMode==='total')updateTotalPreview();updateChildPickSummary()" style="${inpStyle}">
          <button type="button" onclick="stepParent('fparent-${f.id}',1)" style="${btnStyle}">+</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:12px;color:var(--text2);width:44px">ילדים</span>
        <div style="${stepperWrap}">
          <button type="button" onclick="stepChild('fchild-${f.id}',-1)" style="${btnStyle}">−</button>
          <input class="children-inp" type="number" min="0" inputmode="numeric" id="fchild-${f.id}" value="${valCh}" oninput="if(expMode==='total')updateTotalPreview();updateChildPickSummary()" style="${inpStyle}">
          <button type="button" onclick="stepChild('fchild-${f.id}',1)" style="${btnStyle}">+</button>
        </div>
      </div>
    </div>`;
  }).join('');
  updateChildPickSummary();
}
function openChildOverridePicker(){
  document.getElementById('childOverrideOverlay').style.display='flex';
}
function closeChildOverridePicker(){
  document.getElementById('childOverrideOverlay').style.display='none';
  updateChildPickSummary();
  if(expMode==='total')updateTotalPreview();
}
function updateChildPickSummary(){
  const el=document.getElementById('childPickSummary');if(!el)return;
  const selected=families.filter(f=>{ const c=document.getElementById('chip-'+f.id); return c&&c.classList.contains('on'); });
  if(!selected.length){el.textContent='הגדר הרכב לפי משפחה';return;}
  const totalCh=selected.reduce((s,f)=>{ const v=formChildOverride(f.id); return s+(v!=null?v:(_wantsFamComposition()?famAge3PlusChildCount(f):(f.children||0))); },0);
  const totalPa=selected.reduce((s,f)=>{ const v=formParentOverride(f.id); return s+(v!=null?v:FAM_ADULTS); },0);
  el.textContent=`${totalPa} הורים · ${totalCh} ילדים`;
}
function openExpensePicker(){
  document.getElementById('expenseOverlay').style.display='flex';
}
function closeExpensePicker(){
  document.getElementById('expenseOverlay').style.display='none';
  updateExpensePickSummary();
}
function updateExpensePickSummary(){
  const el=document.getElementById('expensePickSummary');if(!el)return;
  const selected=families.filter(f=>{ const c=document.getElementById('chip-'+f.id); return c&&c.classList.contains('on'); });
  let total=0;
  selected.forEach(f=>{ total+=_custFamTotal(f.id); });
  el.textContent=total>0?`הוזן ₪${total.toLocaleString()}`:'כמה כל משפחה שילמה';
}
function _custFamTotal(fid){
  return (_custItems[fid]||[]).reduce((s,r)=>s+(parseFloat(r.amt)||0),0);
}
function _custItemAdd(fid){
  if(!_custItems[fid])_custItems[fid]=[];
  _custItems[fid].push({id:_custItemSeq++,name:'',amt:''});
  updateExpenseInputs();
}
function _custItemRemove(fid,rowId){
  if(!_custItems[fid])return;
  _custItems[fid]=_custItems[fid].filter(r=>r.id!==rowId);
  if(!_custItems[fid].length)_custItems[fid]=[{id:_custItemSeq++,name:'',amt:''}];
  updateExpenseInputs();
}
function _custItemEdit(fid,rowId,field,val){
  const row=(_custItems[fid]||[]).find(r=>r.id===rowId);if(!row)return;
  row[field]=val;
  if(field==='amt'){
    const el=document.getElementById('fexpfamtot-'+fid);
    if(el)el.textContent='₪'+Math.round(_custFamTotal(fid)).toLocaleString();
    _updateCustomTotal();
  }
}
function setExpMode(mode){
  expMode=mode;
  const isTotal=mode==='total';
  const isCumulative=mode==='cumulative';
  document.getElementById('totalModeDiv').style.display=isTotal?'block':'none';
  document.getElementById('customModeDiv').style.display=(!isTotal&&!isCumulative)?'block':'none';
  document.getElementById('cumulativeModeDiv').style.display=isCumulative?'block':'none';
  // Cumulative events decide the split per expense item instead of once for the whole event.
  const smField=document.getElementById('splitMethodField');
  if(smField)smField.style.display=isCumulative?'none':'block';
  if(isCumulative)setSplitMethod('equal');
  ['modeTotal','modeCustom','modeCumulative'].forEach(btnId=>{
    const btn=document.getElementById(btnId);if(!btn)return;
    const active=(btnId==='modeTotal'&&isTotal)||(btnId==='modeCustom'&&mode==='custom')||(btnId==='modeCumulative'&&isCumulative);
    btn.style.background=active?'var(--blue-mid)':'transparent';
    btn.style.color=active?'#fff':'var(--text2)';
    btn.style.borderColor=active?'var(--blue-mid)':'var(--border)';
  });
  if(isTotal) updateTotalPreview();
  updateChildOverrideInputs();
}
function updateTotalPreview(){
  const total=parseFloat(document.getElementById('f-total')?.value)||0;
  const selected=families.filter(f=>{ const c=document.getElementById('chip-'+f.id); return c&&c.classList.contains('on'); });
  if(!selected.length||!total){ document.getElementById('totalPreview').innerHTML=''; return; }
  let totalW=0; const w={};
  selected.forEach(f=>{ w[f.id]=famWeight(f,splitMethod,formChildOverride(f.id),formParentOverride(f.id)); totalW+=w[f.id]; });
  document.getElementById('totalPreview').innerHTML=
    '<div style="background:var(--surface2);border-radius:var(--r2);padding:10px 12px">'
    +'<div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:6px">'+SPLIT_LABELS[splitMethod]+'</div>'
    +selected.map(f=>{ const cl=col(f.id); const share=totalW?Math.round(total*w[f.id]/totalW):0; return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0">'
      +famAva(f, 26, 'flex-shrink:0')
      +'<span style="font-size:13px;flex:1">'+esc(f.name.replace('משפחת','').trim())+'</span>'
      +'<span style="font-size:13px;font-weight:700;color:var(--green-mid)">₪'+share.toLocaleString()+'</span>'
      +'</div>'; }).join('')
    +'</div>';
}
function showForm(){
  editingId=null;
  _custItems={};
  document.getElementById('formTitle').textContent='➕ אירוע חדש';
  document.getElementById('formSaveBtn').textContent='✓ צור אירוע';
  document.getElementById('f-name').value='';
  document.getElementById('f-date').value='';
  ['e-name','e-cost','e-fams'].forEach(id=>{ const el=document.getElementById(id); if(el) el.classList.remove('show'); });
  document.getElementById('famChips').innerHTML=families.map(f=>
    `<button class="chip on" id="chip-${f.id}" onclick="toggleChip(${f.id})">${esc(f.name.replace('משפחת','').trim())}</button>`
  ).join('');
  updateFamPickSummary();
  setSplitMethod('equal');
  expMode='total';
  setExpMode('total');
  if(document.getElementById('f-total')) document.getElementById('f-total').value='';
  document.getElementById('expensesSection').style.display='none';
  updateExpenseInputs();updateExpensePickSummary();
  document.getElementById('newFormOverlay').style.display='flex';
  goTab('events',document.getElementById('nb-events'));
}
function editEv(evId){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  editingId=evId;
  _custItems={};
  document.getElementById('formTitle').textContent='✏️ עריכת אירוע';
  document.getElementById('formSaveBtn').textContent='✓ שמור שינויים';
  document.getElementById('f-name').value=ev.name;
  document.getElementById('f-date').value=ev.dateISO||'';
  ['e-name','e-cost','e-fams'].forEach(id=>{ const el=document.getElementById(id); if(el) el.classList.remove('show'); });
  document.getElementById('famChips').innerHTML=families.map(f=>
    `<button class="chip ${ev.participants.includes(f.id)?'on':''}" id="chip-${f.id}" onclick="toggleChip(${f.id})">${esc(f.name.replace('משפחת','').trim())}</button>`
  ).join('');
  updateFamPickSummary();
  setSplitMethod(ev.splitMethod||'equal');
  if(ev.cumulative){
    expMode='cumulative';
    setExpMode('cumulative');
  } else if(ev.totalCost!=null){
    expMode='total';
    setExpMode('total');
    document.getElementById('f-total').value=ev.totalCost;
    updateTotalPreview();
  } else {
    expMode='custom';
    setExpMode('custom');
    ev.participants.forEach(fid=>{
      const plainItems=(ev.expenseItems||[]).filter(it=>it.famId===fid&&!it.customSplit&&(!it.sharedWith||it.sharedWith.length===ev.participants.length));
      const anyItems=(ev.expenseItems||[]).some(it=>it.famId===fid);
      if(plainItems.length){
        _custItems[fid]=plainItems.map(it=>({id:_custItemSeq++,name:it.name||'',amt:it.amt||0}));
      } else if(!anyItems&&ev.expenses[fid]){
        _custItems[fid]=[{id:_custItemSeq++,name:'',amt:ev.expenses[fid]}];
      }
    });
    updateExpenseInputs();
    updateFormTotal();
  }
  const savEl=document.getElementById('f-savings');
  const savTotal=ev.savingsTotal||0;
  if(savEl)savEl.value=savTotal||'';
  const savHint=document.getElementById('savingsHint');
  if(savHint)savHint.textContent=savTotal&&ev.participants.length?'≈ ₪'+Math.round(savTotal/ev.participants.length)+' לכל משפחה':'';
  document.getElementById('newFormOverlay').style.display='flex';
  goTab('events',document.getElementById('nb-events'));
}
function hideForm(){
  document.getElementById('newFormOverlay').style.display='none';
  closeFamPicker();closeChildOverridePicker();closeExpensePicker();
  editingId=null;
  _custItems={};
  document.getElementById('formTitle').textContent='➕ אירוע חדש';
  document.getElementById('formSaveBtn').textContent='✓ צור אירוע';
  const savEl=document.getElementById('f-savings');if(savEl)savEl.value='';
  const savHint=document.getElementById('savingsHint');if(savHint)savHint.textContent='';
}
function toggleChip(fid){
  const el=document.getElementById('chip-'+fid);
  if(el){ el.classList.toggle('on'); updateFamPickSummary(); updateChildOverrideInputs(); if(expMode==='total') updateTotalPreview(); else updateExpenseInputs(); }
}
function openFamPicker(){
  document.getElementById('famPickOverlay').style.display='flex';
}
function closeFamPicker(){
  document.getElementById('famPickOverlay').style.display='none';
}
function updateFamPickSummary(){
  const el=document.getElementById('famPickSummary');if(!el)return;
  const selected=families.filter(f=>{ const c=document.getElementById('chip-'+f.id); return c&&c.classList.contains('on'); });
  el.textContent=selected.length?selected.length+' מתוך '+families.length+' משפחות נבחרו':'מי משתתף';
}
function updateExpenseInputs(){
  const selected=families.filter(f=>{ const c=document.getElementById('chip-'+f.id); return c&&c.classList.contains('on'); });
  if(!selected.length){ document.getElementById('expensesSection').style.display='none'; return; }
  document.getElementById('expensesSection').style.display='block';
  selected.forEach(f=>{ if(!_custItems[f.id]||!_custItems[f.id].length)_custItems[f.id]=[{id:_custItemSeq++,name:'',amt:''}]; });
  document.getElementById('expenseInputs').innerHTML=selected.map(f=>{
    const rows=_custItems[f.id]||[];
    const tot=_custFamTotal(f.id);
    return`<div style="margin-bottom:12px;padding:10px;background:var(--surface2);border-radius:var(--r2)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        ${famAva(f, 28, 'flex-shrink:0')}
        <span style="flex:1;font-size:13px;font-weight:700">${esc(f.name.replace('משפחת','').trim())}</span>
        <span style="font-size:13px;font-weight:700;color:var(--green-mid)" id="fexpfamtot-${f.id}">₪${Math.round(tot).toLocaleString()}</span>
      </div>
      ${rows.map(r=>`<div style="display:flex;gap:6px;margin-bottom:6px">
        <input type="text" placeholder="תיאור (אופציונלי)" value="${esc(r.name)}" oninput="_custItemEdit(${f.id},${r.id},'name',this.value)" style="flex:2;min-width:0;border:1.5px solid var(--border);border-radius:var(--r2);padding:7px 8px;font-size:12px;font-family:var(--font);background:var(--bg);color:var(--text);box-sizing:border-box">
        <input type="number" min="0" inputmode="numeric" placeholder="0" value="${esc(String(r.amt))}" oninput="_custItemEdit(${f.id},${r.id},'amt',this.value)" style="flex:1;min-width:0;border:1.5px solid var(--border);border-radius:var(--r2);padding:7px 8px;font-size:12px;font-family:var(--font);background:var(--bg);color:var(--text);direction:ltr;text-align:center;box-sizing:border-box">
        <button type="button" onclick="_custItemRemove(${f.id},${r.id})" style="flex-shrink:0;width:26px;border-radius:6px;border:none;background:none;color:var(--text3);font-size:14px;cursor:pointer">✕</button>
      </div>`).join('')}
      <button type="button" onclick="_custItemAdd(${f.id})" style="width:100%;padding:6px;border-radius:6px;border:1.5px dashed var(--border);background:transparent;color:var(--text2);font-size:11px;font-weight:600;font-family:var(--font);cursor:pointer">+ הוסף פריט</button>
    </div>`;
  }).join('');
  updateFormTotal();
}
function updateFormTotal(){_updateCustomTotal();}
async function doCreate(){
  const name=document.getElementById('f-name').value.trim();
  const _dateISORaw=document.getElementById('f-date').value||'';
  let date='',dateISO=null;
  if(_dateISORaw){
    dateISO=_dateISORaw;
    date=new Date(_dateISORaw+'T00:00:00').toLocaleDateString('he-IL',{day:'numeric',month:'long',year:'numeric'});
  } else if(editingId!=null){
    const _existingEv=events.find(e=>e.id===editingId);
    if(_existingEv){ date=_existingEv.date==='לא צוין'?'':(_existingEv.date||''); dateISO=_existingEv.dateISO||null; }
  }
  let ok=true;
  if(!name){document.getElementById('e-name').classList.add('show');ok=false;}
  else document.getElementById('e-name').classList.remove('show');
  const participants=[],excluded=[];
  families.forEach(f=>{
    const ch=document.getElementById('chip-'+f.id);
    if(ch){if(ch.classList.contains('on'))participants.push(f.id);else excluded.push(f.id);}
  });
  if(!participants.length){document.getElementById('e-fams').classList.add('show');ok=false;}
  else document.getElementById('e-fams').classList.remove('show');
  const expenses={};
  let anyExpense=false;
  let formExpenseItems=null;
  if(expMode==='total'){
    const total=parseFloat(document.getElementById('f-total')?.value)||0;
    if(!total){document.getElementById('e-cost').classList.add('show');ok=false;}
    else{
      document.getElementById('e-cost').classList.remove('show');
      participants.forEach(fid=>{ expenses[fid]=0; });
      anyExpense=true;
    }
  } else if(expMode==='cumulative'){
    participants.forEach(fid=>{ expenses[fid]=0; });
    document.getElementById('e-cost').classList.remove('show');
    anyExpense=true;
  } else {
    const _cSym=document.getElementById('customCur')?.value||'₪';
    const _cRate=_cSym==='₪'?1:((await _getRate(_cSym))||1);
    formExpenseItems=[];
    for(const fid of participants){
      const rows=(_custItems[fid]||[]).filter(r=>Math.round((parseFloat(r.amt)||0)*_cRate)>0);
      let famSum=0;
      rows.forEach(r=>{
        const amt=Math.round((parseFloat(r.amt)||0)*_cRate);
        famSum+=amt;
        formExpenseItems.push({famId:fid,name:(r.name||'').trim()||'הוצאה',amt});
      });
      expenses[fid]=famSum;
      if(famSum>0)anyExpense=true;
    }
    if(!anyExpense){document.getElementById('e-cost').classList.add('show');ok=false;}
    else document.getElementById('e-cost').classList.remove('show');
  }
  if(!ok)return;
  const totalCost=expMode==='total'?(await _toILS('f-total','fTotalCur')):null;
  const isCumulative=expMode==='cumulative';
  const savingsTotal=Math.round(parseFloat(document.getElementById('f-savings')?.value)||0);
  const childOverrides={};const parentOverrides={};
  if(splitMethod!=='equal'||isCumulative) participants.forEach(fid=>{
    childOverrides[fid]=formChildOverride(fid)??(_wantsFamComposition()?famAge3PlusChildCount(getFam(fid)||{}):(getFam(fid)?.children||0));
    parentOverrides[fid]=formParentOverride(fid)??FAM_ADULTS;
  });
  if(editingId!=null){
    const ev=events.find(e=>e.id===editingId);
    if(ev){
      ev.name=name; ev.date=date; if(dateISO)ev.dateISO=dateISO;else delete ev.dateISO; ev.participants=participants; ev.excluded=excluded;
      ev.splitMethod=splitMethod; ev.childOverrides=childOverrides; ev.parentOverrides=parentOverrides;
      if(!ev.cumulative){
        ev.totalCost=totalCost;
        if(expMode==='custom'){
          // A partial item (sharedWith a subset) whose entire subset was removed from
          // the event has nobody left to charge — itemShareFor() would silently assign
          // its cost to no one while the payer's expense entry (added back below) still
          // counted it as paid, leaking that amount out of the balance sheet. Drop it
          // along with its cost together instead, so the sheet stays consistent.
          const preserved=(ev.expenseItems||[]).filter(it=>it.customSplit||(it.sharedWith&&it.sharedWith.length<participants.length&&it.sharedWith.some(fid=>participants.includes(fid))));
          const finalExpenses={...expenses};
          preserved.forEach(it=>{ finalExpenses[it.famId]=(finalExpenses[it.famId]||0)+it.amt; });
          let seq=Math.max(0,...preserved.map(it=>it.id||0))+1;
          const freshItems=(formExpenseItems||[]).map(it=>({...it,id:seq++}));
          ev.expenses=finalExpenses;
          ev.expenseItems=[...preserved,...freshItems];
          ev.expItemId=Math.max(seq-1,ev.expItemId||0);
        } else if(!(ev.expenseItems&&ev.expenseItems.length)){
          ev.expenses=expenses;
        }
      }
      if(savingsTotal>0){ev.savingsTotal=savingsTotal;}else{delete ev.savingsTotal;}
    }
  } else {
    const newEv={id:nxtId++,name,date,open:true,closedOn:null,participants,excluded,expenses,totalCost:isCumulative?null:totalCost,splitMethod,childOverrides,parentOverrides};
    if(dateISO)newEv.dateISO=dateISO;
    if(isCumulative){newEv.cumulative=true;newEv.expenseItems=[];newEv.expItemId=0;}
    else if(expMode==='custom'&&formExpenseItems&&formExpenseItems.length){
      let seq=1;
      newEv.expenseItems=formExpenseItems.map(it=>({...it,id:seq++}));
      newEv.expItemId=seq-1;
    }
    if(savingsTotal>0)newEv.savingsTotal=savingsTotal;
    events.unshift(newEv);
    addNotif('📅','נוסף אירוע חדש: "'+newEv.name+'"',undefined,undefined,'event',newEv.participants);
    // notify participants only for non-cumulative events (personalized per family)
    (()=>{
      if(newEv.cumulative) return;
      const cost=evCost(newEv);
      const shares=evShares(newEv);
      newEv.participants.forEach(fid=>{
        const f=getFam(fid);if(!f||((!f.email)&&(!f.email2)))return;
        const share=Math.round(shares[fid]||0);
        const msg=`משפחת ${f.name.replace('משפחת','').trim()} רשומה לאירוע "${newEv.name}".\n\nעלות כוללת: ₪${cost.toLocaleString()}\nהחלק שלכם: ₪${share.toLocaleString()}`;
        sendEmailNotif([{email:f.email,email2:f.email2,name:f.name.replace('משפחת','').trim()}],'📅 אירוע חדש · ינקלביץ',msg);
      });
    })();
  }
  hideForm();save();render();
}

// Actions
let _closeEvPendingId=null;
function openCloseEvModal(evId){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  _closeEvPendingId=evId;
  const adjBal=evAdjBalance(ev);
  const settled=ev.participants.filter(fid=>{const f=getFam(fid);return f&&(f.email||f.email2)&&Math.abs(adjBal[fid]||0)<=0.5;});
  const info=document.getElementById('closeEvInfo');
  if(info){
    const rows=settled.map(fid=>{
      const f=getFam(fid);
      const name=f.name.replace('משפחת','').trim();
      const alreadySent=!!localStorage.getItem('closemail-'+ev.id+'-'+fid);
      return`<label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;border-bottom:1px solid var(--border)">
        <input type="checkbox" id="closeev-chk-${fid}" ${alreadySent?'':'checked'} style="width:16px;height:16px;cursor:pointer;flex-shrink:0">
        <span style="flex:1;font-size:13px">${esc(name)}</span>
        ${alreadySent?`<span style="font-size:11px;color:var(--text3)">נשלח</span>`:''}
      </label>`;
    }).join('');
    info.innerHTML=`<div style="font-weight:700;margin-bottom:8px">${esc(ev.name)}</div>`
      +(settled.length?`<div style="font-size:12px;color:var(--text2);margin-bottom:8px">בחר למי לשלוח מייל סיכום:</div>${rows}`
      :`<div style="color:var(--text2);font-size:12px">אין משפחות מסודרות עם כתובת מייל.</div>`);
  }
  const modal=document.getElementById('closeEvModal');
  if(modal)modal.style.display='flex';
}
function closeCloseEvModal(){
  _closeEvPendingId=null;
  const modal=document.getElementById('closeEvModal');
  if(modal)modal.style.display='none';
}
function confirmCloseEv(){
  const evId=_closeEvPendingId;
  closeCloseEvModal();
  if(evId==null)return;
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  ev.closed=true;
  const adjBal=evAdjBalance(ev);
  ev.participants.forEach(fid=>{
    if(Math.abs(adjBal[fid]||0)>0.5)return;
    const chk=document.getElementById('closeev-chk-'+fid);
    if(chk&&chk.checked){
      localStorage.removeItem('closemail-'+ev.id+'-'+fid);
      _sendCloseEvEmailOne(ev,fid);
    } else {
      localStorage.setItem('closemail-'+ev.id+'-'+fid,'1');
    }
  });
  save();render();
}
function _sendCloseEvEmailOne(ev,fid){
  const notifKey='closemail-'+ev.id+'-'+fid;
  if(localStorage.getItem(notifKey))return;
  const f=getFam(fid);if(!f||(!f.email&&!f.email2))return;
  const adjBal=evAdjBalance(ev);
  if(Math.abs(adjBal[fid]||0)>0.5)return;
  localStorage.setItem(notifKey,'1');
  const cost=evCost(ev);
  const shares=evShares(ev);
  const share=Math.round(shares[fid]||0);
  const _totalNfashot=ev.cumulative?ev.participants.reduce((s,fid2)=>{
    const pf=getFam(fid2);if(!pf)return s;
    const ch=ev.childOverrides?.[fid2]!=null?ev.childOverrides[fid2]:famAge3PlusChildCount(pf);
    const pa=ev.parentOverrides?.[fid2]!=null?ev.parentOverrides[fid2]:FAM_ADULTS;
    return s+ch+pa;
  },0):0;
  const name=f.name.replace('משפחת','').trim();
  const myItems=(ev.expenseItems||[]).filter(it=>itemPayerAmt(it,fid)>0);
  const mySpent=Math.round(myItems.reduce((s,it)=>s+itemPayerAmt(it,fid),0));
  const settleLines=[];
  if(mySpent>0) settleLines.push(`הוצאות שלך באירוע: ₪${mySpent.toLocaleString()}`);
  const _myPotPend=Math.round((ev.potPayments||[]).filter(p=>Number(p.famId)===Number(fid)).reduce((s,p)=>s+p.amt,0));
  const _myPotDist=Math.round((ev.settled||[]).filter(s=>s.method==='pot'&&Number(s.fromFid)===Number(fid)).reduce((s,t)=>s+t.amt,0));
  const _excessToFund=Math.round((fund.transactions||[]).filter(t=>t.famId===fid&&t.type==='deposit'&&(t.desc||'').includes('החזר עודף מקופת האירוע')&&(t.evId!=null?t.evId===ev.id:(t.desc||'').includes(ev.name))).reduce((s,t)=>s+t.amount,0));
  const _myTotalPot=_myPotPend+_myPotDist+_excessToFund;
  const _fromFundToPot=Math.round((fund.transactions||[])
    .filter(t=>Number(t.famId)===Number(fid)&&t.type==='payout'&&(t.desc||'').includes('העברה לקופת האירוע')&&(t.evId!=null?t.evId===ev.id:(t.desc||'').includes(ev.name)))
    .reduce((s,t)=>s+t.amount,0));
  if(_myTotalPot>0.5){
    if(_fromFundToPot>0.5&&_fromFundToPot===_myTotalPot){
      settleLines.push(`העברת מהארנק ₪${_myTotalPot.toLocaleString()} לקופת האירוע`);
    } else {
      settleLines.push(`הפקדת לקופת האירוע: ₪${_myTotalPot.toLocaleString()}`);
      if(_fromFundToPot>0.5) settleLines.push(`מתוכם ₪${_fromFundToPot.toLocaleString()} הועברו מהארנק`);
    }
    if(_excessToFund>0.5) settleLines.push(`היתרה ₪${_excessToFund.toLocaleString()} עברה לארנק`);
  } else if(_fromFundToPot>0.5){
    settleLines.push(`העברת מהארנק ₪${_fromFundToPot.toLocaleString()} לתשלום האירוע`);
  }
  const _myPotRec=Math.round((ev.settled||[]).filter(s=>s.method==='pot'&&Number(s.toFid)===Number(fid)).reduce((s,t)=>s+t.amt,0));
  const _toFundFromPot=Math.round((fund.transactions||[])
    .filter(t=>Number(t.famId)===Number(fid)&&t.type==='deposit'&&(t.desc||'').includes('מקופת אירוע')&&(t.evId!=null?t.evId===ev.id:(t.desc||'').includes(ev.name)))
    .reduce((s,t)=>s+t.amount,0));
  if(_myPotRec>0.5){
    if(_toFundFromPot>0.5&&_toFundFromPot===_myPotRec) settleLines.push(`הועבר מקופת האירוע ₪${_myPotRec.toLocaleString()} לארנק שלכם`);
    else{
      settleLines.push(`קיבלת ₪${_myPotRec.toLocaleString()} מקופת האירוע`);
      if(_toFundFromPot>0.5) settleLines.push(`מתוכם ₪${_toFundFromPot.toLocaleString()} הועברו לארנק שלך`);
    }
  }
  const _sfByName=n=>families.find(x=>x.name===n||x.name.replace(/^משפחת\s*/,'')===n);
  (ev.settled||[]).forEach(s=>{
    if(s.method==='pot') return;
    const isFrom=s.fromFid!=null?Number(s.fromFid)===Number(fid):(_sfByName(s.from)||{}).id===fid;
    const isTo=s.toFid!=null?Number(s.toFid)===Number(fid):(_sfByName(s.to)||{}).id===fid;
    const sFrom=(getFam(s.fromFid)||{}).name?(getFam(s.fromFid).name.replace('משפחת','').trim()):s.from;
    const sTo=(getFam(s.toFid)||{}).name?(getFam(s.toFid).name.replace('משפחת','').trim()):s.to;
    if(isFrom){
      if(s.method==='fund') settleLines.push(`₪${s.amt.toLocaleString()} שולמו מהארנק שלך ל${sTo}`);
      else settleLines.push(`העברה ישירה של ₪${s.amt.toLocaleString()} ל${sTo}`);
    } else if(isTo){
      if(s.method==='fund') settleLines.push(`₪${s.amt.toLocaleString()} מ${sFrom} – הועבר לארנק שלך`);
      else settleLines.push(`קיבלת ₪${s.amt.toLocaleString()} ישירות מ${sFrom}`);
    }
  });
  const fundBal=Math.round(fund.famBalances[String(fid)]||0);
  const _savingsPerFam=evSavingsPerFam(ev);
  let msg=`האירוע "${ev.name}" הסתיים!\n\nעלות כוללת: ₪${cost.toLocaleString()}${_totalNfashot>0?`\n👥 נפשות שהשתתפו: ${_totalNfashot}`:''}\nהחלק שלך: ₪${share.toLocaleString()}${_savingsPerFam>0?`\n💎 לקופת חיסכון: ₪${_savingsPerFam.toLocaleString()}`:''}
`;
  if(mySpent>0){
    const itemLines=myItems.map(it=>`  - ${it.name}: ₪${itemPayerAmt(it,fid).toLocaleString()}`).join('\n');
    msg+=`\n💳 ההוצאות שלך (${name}):\n${itemLines}\n  סה"כ: ₪${mySpent.toLocaleString()}`;
  }
  if(settleLines.length) msg+=`\n\nאיך סודר:\n${settleLines.map(l=>'• '+l).join('\n')}`;
  if(fundBal>0) msg+=`\n\nיתרתך בארנק: ₪${fundBal.toLocaleString()}`;
  msg+=`\n\n✅ החשבון שלך מסודר.`;
  const _cRows=[['עלות כוללת האירוע',`₪${cost.toLocaleString()}`],['החלק שלך',`₪${share.toLocaleString()}`,true]];
  if(_totalNfashot>0) _cRows.push(['👥 נפשות שהשתתפו',String(_totalNfashot)]);
  if(_savingsPerFam>0) _cRows.push(['💎 לקופת חיסכון',`₪${_savingsPerFam.toLocaleString()}`]);
  if(fundBal>0) _cRows.push(['💰 יתרה בארנק',`₪${fundBal.toLocaleString()}`]);
  let bodyHtml=_eCard(_cRows);
  const _isPerFam=!ev.cumulative&&ev.totalCost==null;
  if(_isPerFam){
    const _famExpRows=ev.participants.map(fid2=>{
      const amt=Math.round((ev.expenses||{})[fid2]||0);if(!amt)return'';
      const pf=getFam(fid2);if(!pf)return'';
      const pname=_esc(pf.name.replace('משפחת','').trim());
      const isMine=fid2===fid;
      const potFolded=Math.round((ev.potFoldedExpenses||{})[fid2]||0);
      const potNote=potFolded>0?`<div style="font-size:9px;font-weight:400;color:#94a3b8">מתוכם ₪${potFolded.toLocaleString()} מהפקדה לקופה</div>`:'';
      return`<tr style="border-bottom:1px solid #f0f0f6${isMine?';background:#FEFCE8':''}"><td style="padding:7px 10px${isMine?';font-weight:700':''}">${pname}</td><td style="padding:7px 10px;font-weight:700;text-align:left${isMine?';color:#D97706':''}">₪${amt.toLocaleString()}${potNote}</td></tr>`;
    }).join('');
    if(_famExpRows)bodyHtml+=`<p style="font-weight:700;margin:0 0 8px;color:#333">💳 הוצאות לפי משפחה:</p><table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px"><tr style="background:#E0F2FE"><th style="padding:8px 10px;text-align:right;color:#555;font-weight:700;border-bottom:2px solid #7DD3FC">משפחה</th><th style="padding:8px 10px;text-align:left;color:#555;font-weight:700;border-bottom:2px solid #7DD3FC">הוצאה</th></tr>${_famExpRows}</table>`;
  } else if(!ev.cumulative){
    // Cumulative events split per-item, so a single global method badge isn't accurate here
    bodyHtml+=_splitMethodBlock(ev,fid);
  }
  const allItems=ev.expenseItems||[];
  if(ev.cumulative){
    // Cumulative events itemize expenses one-by-one during the event, but the closing
    // summary is clearer grouped by family — how much each family actually paid out
    // (ev.expenses, kept in sync by itemPayers as items are added), same shape as the
    // per-family table above. Each family's fair SHARE of the total is a different
    // number (shown separately in the top card as "החלק שלך") and doesn't belong under
    // an "expense" heading.
    const _famExpRows=ev.participants.map(fid2=>{
      const amt=Math.round((ev.expenses||{})[fid2]||0);if(!amt)return'';
      const pf=getFam(fid2);if(!pf)return'';
      const pname=_esc(pf.name.replace('משפחת','').trim());
      const isMine=fid2===fid;
      const potFolded=Math.round((ev.potFoldedExpenses||{})[fid2]||0);
      const potNote=potFolded>0?`<div style="font-size:9px;font-weight:400;color:#94a3b8">מתוכם ₪${potFolded.toLocaleString()} מהפקדה לקופה</div>`:'';
      return`<tr style="border-bottom:1px solid #f0f0f6${isMine?';background:#FEFCE8':''}"><td style="padding:7px 10px${isMine?';font-weight:700':''}">${pname}</td><td style="padding:7px 10px;font-weight:700;text-align:left${isMine?';color:#D97706':''}">₪${amt.toLocaleString()}${potNote}</td></tr>`;
    }).join('');
    if(_famExpRows)bodyHtml+=`<p style="font-weight:700;margin:0 0 8px;color:#333">💳 הוצאות לפי משפחה:</p><table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px"><tr style="background:#E0F2FE"><th style="padding:8px 10px;text-align:right;color:#555;font-weight:700;border-bottom:2px solid #7DD3FC">משפחה</th><th style="padding:8px 10px;text-align:left;color:#555;font-weight:700;border-bottom:2px solid #7DD3FC">הוצאה</th></tr>${_famExpRows}</table>`;
  } else if(!_isPerFam&&(allItems.length||(ev.potExpItems||[]).length)){
    bodyHtml+=`<p style="font-weight:700;margin:0 0 8px;color:#333">💳 פירוט כל ההוצאות:</p>`;
    const _itemShare=(it,rfid)=>Math.round(itemShareFor(ev,it,rfid));
    // Group same-named items into one row (e.g. several separate "כרטיסים" purchases),
    // summing amounts/shares instead of listing each purchase as its own row.
    const _iGroups={};
    allItems.forEach(it=>{
      const myShare=_itemShare(it,fid);
      const isMine=itemPayerAmt(it,fid)>0;
      if(!isMine&&myShare<=0)return;
      const g=_iGroups[it.name]||(_iGroups[it.name]={amt:0,share:0,payers:new Set(),isMine:false});
      g.amt+=it.amt;g.share+=myShare;g.isMine=g.isMine||isMine;
      itemPayerNames(it).forEach(n=>g.payers.add(n));
    });
    let itemRows=Object.entries(_iGroups).map(([name,g])=>{
      const payerLbl=g.payers.size>2?`${g.payers.size} משפחות`:[...g.payers].join(' + ');
      return`<tr style="border-bottom:1px solid #f0f0f6${g.isMine?';background:#FEFCE8':''}">
        <td style="padding:5px 6px">${_esc(name)}</td>
        <td style="padding:5px 6px;font-size:11px;color:#666">${_esc(payerLbl)}</td>
        <td style="padding:5px 6px;font-weight:600;${g.isMine?'color:#D97706':''}">₪${g.amt.toLocaleString()}</td>
        <td style="padding:5px 6px;font-weight:700;color:#D97706">${g.share?'₪'+g.share.toLocaleString():'—'}</td>
      </tr>`;
    }).join('');
    const _potExpItems=ev.potExpItems||[];
    if(_potExpItems.length){
      const _pMethod=ev.splitMethod||'equal';
      let _pTotalW=0; const _pW={};
      ev.participants.forEach(p=>{ _pW[p]=famWeight(getFam(p),_pMethod,ev.childOverrides?.[p]); _pTotalW+=_pW[p]; });
      const _pGroups={};
      _potExpItems.forEach(it=>{
        const myShare=_pTotalW>0?Math.round(it.amt*(_pW[fid]||0)/_pTotalW):0;
        const g=_pGroups[it.name]||(_pGroups[it.name]={amt:0,share:0});
        g.amt+=it.amt;g.share+=myShare;
      });
      itemRows+=Object.entries(_pGroups).map(([name,g])=>`<tr style="border-bottom:1px solid #EDE9FE;background:#F5F3FF">
        <td style="padding:5px 6px">${_esc(name)}</td>
        <td style="padding:5px 6px;font-size:11px;color:#7C3AED">קופת האירוע</td>
        <td style="padding:5px 6px;font-weight:600;color:#7C3AED">₪${g.amt.toLocaleString()}</td>
        <td style="padding:5px 6px;font-weight:700;color:#6D28D9">₪${g.share.toLocaleString()}</td>
      </tr>`).join('');
    }
    bodyHtml+=`<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px"><tr style="background:#E0F2FE"><th style="padding:6px;text-align:right;color:#555;font-weight:700;border-bottom:2px solid #7DD3FC">פריט</th><th style="padding:6px;text-align:right;color:#555;font-weight:700;border-bottom:2px solid #7DD3FC">שילם</th><th style="padding:6px;text-align:right;color:#555;font-weight:700;border-bottom:2px solid #7DD3FC">סכום</th><th style="padding:6px;text-align:right;color:#D97706;font-weight:700;border-bottom:2px solid #7DD3FC">החלק שלך</th></tr>${itemRows}</table>`;
    if(mySpent>0) bodyHtml+=`<p style="font-size:11px;color:#888;margin:0 0 12px;text-align:center">שורות בסגול = הוצאות שלך</p>`;
  }
  if(settleLines.length){
    bodyHtml+=`<p style="font-weight:700;margin:16px 0 8px;color:#333">⚖️ איך סודר:</p><ul style="margin:0 0 16px;padding-right:20px;color:#444">${settleLines.map(l=>`<li style="margin-bottom:5px">${_esc(l)}</li>`).join('')}</ul>`;
  }
  bodyHtml+=`<div style="text-align:center;margin-top:4px">${_eBadge('✅ החשבון שלך מסודר','#16a34a')}</div>`;
  const html=_emailWrap(bodyHtml,ev.name,'🏁',_ejsUrl()+'#archive-'+ev.id,f.name);
  sendEmailNotif([{email:f.email,email2:f.email2,name}],'🏁 האירוע הסתיים · ינקלביץ',msg,html);
}
function archiveEv(evId){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  ev.open=false;ev.closedOn='היום';
  addNotif('🔒','האירוע "'+ev.name+'" נסגר',undefined,undefined,'event',ev.participants);
  save();render();
  goTab('archive',null);
}
function sendEmailToFam(evId,fid){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  const f=getFam(fid);if(!f||(!f.email&&!f.email2))return;
  const adjBal=evAdjBalance(ev);
  const b=adjBal[fid]||0;
  if(b<-0.5){
    // debtor — send reminder
    const cost=evCost(ev);
    const shares=evShares(ev);
    const name=f.name.replace('משפחת','').trim();
    const share=Math.round(shares[fid]||0);
    const spent=Math.round(ev.expenses[fid]||0);
    const owe=Math.round(Math.abs(b));
    const potDep=Math.round((ev.potPayments||[]).filter(p=>Number(p.famId)===Number(fid)).reduce((s,p)=>s+p.amt,0)+(ev.settled||[]).filter(s=>s.method==='pot'&&Number(s.fromFid)===Number(fid)).reduce((s,t)=>s+t.amt,0));
    const _fromFundToPot1=potDep>0.5?Math.round((fund.transactions||[]).filter(t=>Number(t.famId)===Number(fid)&&t.type==='payout'&&(t.desc||'').includes('העברה לקופת האירוע')&&(t.evId!=null?t.evId===ev.id:(t.desc||'').includes(ev.name))).reduce((s,t)=>s+t.amount,0)):0;
    const _potIsFromFund1=_fromFundToPot1>0.5&&Math.abs(_fromFundToPot1-potDep)<1;
    const msgPot=potDep>0.5?(_potIsFromFund1?`\nהעברת מהארנק ₪${potDep.toLocaleString()} לקופת האירוע`:`\nהפקדת לקופת האירוע: ₪${potDep.toLocaleString()}`):'';
    const _savPerFam1=evSavingsPerFam(ev);
    const msg=`תזכורת: האירוע "${ev.name}"\n\nעלות כוללת: ₪${cost.toLocaleString()}\nהחלק שלך: ₪${share.toLocaleString()}${spent>0?`\nשילמת: ₪${spent.toLocaleString()}`:''}${msgPot}${_savPerFam1>0?`\n💎 לקופת חיסכון: ₪${_savPerFam1.toLocaleString()}`:''}\n\n⚠️ יתרת חוב: ₪${owe.toLocaleString()}\n\nכבר שילמת? סמן כאן: ${_ejsUrl()}#confirm-${ev.id}-${fid}-${owe}`;
    const cardRows=[['עלות כוללת האירוע',`₪${cost.toLocaleString()}`],['החלק שלך',`₪${share.toLocaleString()}`,true]];
    if(spent>0) cardRows.push(['שילמת',`₪${spent.toLocaleString()}`]);
    if(_savPerFam1>0) cardRows.push(['💎 לקופת חיסכון',`₪${_savPerFam1.toLocaleString()}`]);
    if(potDep>0.5) cardRows.push([_potIsFromFund1?'העברת מהארנק':'הפקדת לקופת האירוע',`₪${potDep.toLocaleString()}`]);
    let bodyHtml=_eCard(cardRows);
    bodyHtml+=_splitMethodBlock(ev,fid);
    // Expense breakdown table
    const _rAllItems=ev.expenseItems||[];
    const _rPotExpItems=ev.potExpItems||[];
    if(_rAllItems.length||_rPotExpItems.length){
      bodyHtml+=`<p style="font-weight:700;margin:12px 0 8px;color:#333">💳 פירוט הוצאות:</p>`;
      const _rM=ev.splitMethod||'equal';let _rTW=0;const _rW={};
      ev.participants.forEach(p=>{_rW[p]=famWeight(getFam(p),_rM,ev.childOverrides?.[p]);_rTW+=_rW[p];});
      const _rShare=(it,rfid)=>Math.round(itemShareFor(ev,it,rfid));
      // Group same-named items into one row (e.g. several separate "כרטיסים" purchases),
      // summing amounts/shares instead of listing each purchase as its own row.
      const _rGroups={};
      _rAllItems.forEach(it=>{
        const ms=_rShare(it,fid);
        const isMine=itemPayerAmt(it,fid)>0;
        if(!isMine&&ms<=0)return;
        const g=_rGroups[it.name]||(_rGroups[it.name]={amt:0,share:0,payers:new Set(),isMine:false});
        g.amt+=it.amt;g.share+=ms;g.isMine=g.isMine||isMine;
        itemPayerNames(it).forEach(n=>g.payers.add(n));
      });
      let _rRows=Object.entries(_rGroups).map(([name,g])=>{
        const payerLbl=g.payers.size>2?`${g.payers.size} משפחות`:[...g.payers].join(' + ');
        return`<tr style="border-bottom:1px solid #f0f0f6${g.isMine?';background:#FEFCE8':''}"><td style="padding:5px 6px">${_esc(name)}</td><td style="padding:5px 6px;font-size:11px;color:#666">${_esc(payerLbl)}</td><td style="padding:5px 6px;font-weight:600;${g.isMine?'color:#D97706':''}">₪${g.amt.toLocaleString()}</td><td style="padding:5px 6px;font-weight:700;color:#D97706">${g.share?'₪'+g.share.toLocaleString():'—'}</td></tr>`;
      }).join('');
      const _rPotGroups={};
      _rPotExpItems.forEach(it=>{const ms=_rTW>0?Math.round(it.amt*(_rW[fid]||0)/_rTW):0;const g=_rPotGroups[it.name]||(_rPotGroups[it.name]={amt:0,share:0});g.amt+=it.amt;g.share+=ms;});
      _rRows+=Object.entries(_rPotGroups).map(([name,g])=>`<tr style="border-bottom:1px solid #EDE9FE;background:#F5F3FF"><td style="padding:5px 6px">${_esc(name)}</td><td style="padding:5px 6px;font-size:11px;color:#7C3AED">קופת האירוע</td><td style="padding:5px 6px;font-weight:600;color:#7C3AED">₪${g.amt.toLocaleString()}</td><td style="padding:5px 6px;font-weight:700;color:#6D28D9">₪${g.share.toLocaleString()}</td></tr>`).join('');
      if(_rRows) bodyHtml+=`<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px"><tr style="background:#E0F2FE"><th style="padding:6px;text-align:right;color:#555;font-weight:700;border-bottom:2px solid #7DD3FC">פריט</th><th style="padding:6px;text-align:right;color:#555;font-weight:700;border-bottom:2px solid #7DD3FC">שילם</th><th style="padding:6px;text-align:right;color:#555;font-weight:700;border-bottom:2px solid #7DD3FC">סכום</th><th style="padding:6px;text-align:right;color:#D97706;font-weight:700;border-bottom:2px solid #7DD3FC">החלק שלך</th></tr>${_rRows}</table>`;
    }
    bodyHtml+=`<div style="text-align:center;margin-top:4px">${_eBadge('⚠️ יתרת חוב ₪'+owe.toLocaleString(),'#ef4444')}</div>`;
    bodyHtml+=_paymentBlock(owe,ev.name,ev.id,fid);
    // Other debts
    const _otherDebts=events.filter(e=>e.id!==ev.id&&e.open&&(e.participants||[]).includes(fid)).map(e=>{const _d=Math.round(-(evAdjBalance(e)[fid]||0));return _d>0.5?{name:e.name,owe:_d}:null;}).filter(Boolean);
    if(_otherDebts.length){bodyHtml+=`<div style="margin-top:14px;padding:10px 14px;background:#FEF2F2;border-radius:8px;border:1px solid #FECACA">${_otherDebts.map(d=>`<div style="font-size:12px;color:#991B1B;margin-bottom:2px">⚠️ תזכורת: קיים גם חוב של ₪${d.owe.toLocaleString()} עבור "${_esc(d.name)}"</div>`).join('')}</div>`;}
    const html=_emailWrap(bodyHtml,ev.name,'⚠️',_ejsUrl()+'#'+(ev.open?'event-':'archive-')+ev.id,f.name);
    sendEmailNotif([{email:f.email,email2:f.email2,name}],`⚠️ תזכורת: חוב ב"${ev.name}" · ינקלביץ`,msg,html);
  } else if(Math.abs(b)<=0.5){
    // settled — send summary
    if(ev.cumulative){
      localStorage.removeItem('closemail-'+ev.id+'-'+fid);
      _sendCloseEvEmailOne(ev,fid);
    } else {
      localStorage.removeItem('settled-'+ev.id+'-'+fid);
      sendSettledEmail(ev,fid);
    }
  }
}
let _emailModalEvId=null;
function openEmailModal(evId){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  _emailModalEvId=evId;
  const adjBal=evAdjBalance(ev);
  const debtors=ev.participants.filter(fid=>{const f=getFam(fid);return f&&(f.email||f.email2)&&(adjBal[fid]||0)<-0.5;});
  const settled=ev.participants.filter(fid=>{const f=getFam(fid);return f&&(f.email||f.email2)&&Math.abs(adjBal[fid]||0)<=0.5;});
  const btnStyle=`padding:4px 10px;border-radius:6px;border:none;background:var(--blue-mid);color:#fff;font-size:12px;font-weight:700;font-family:var(--font);cursor:pointer;flex-shrink:0`;
  let html=`<div style="font-weight:700;margin-bottom:12px;font-size:14px">${esc(ev.name)}</div>`;
  if(debtors.length){
    html+=`<div style="font-size:12px;font-weight:700;color:var(--amber);margin-bottom:4px">⚠️ חייבים:</div>`;
    debtors.forEach(fid=>{
      const f=getFam(fid);
      const name=f.name.replace('משפחת','').trim();
      const owe=Math.round(Math.abs(adjBal[fid]||0));
      html+=`<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)"><button id="em-btn-${fid}" style="${btnStyle}" onclick="sendEmailFromModal(${evId},${fid},this)">שלח</button><span style="flex:1;font-size:13px">${esc(name)}</span><span style="font-size:11px;color:var(--amber);font-weight:700">₪${owe.toLocaleString()}</span></div>`;
    });
  }
  if(settled.length){
    html+=`<div style="font-size:12px;font-weight:700;color:#16a34a;margin:${debtors.length?'12px':'0'} 0 4px">✅ מסודרים:</div>`;
    settled.forEach(fid=>{
      const f=getFam(fid);
      const name=f.name.replace('משפחת','').trim();
      const notifKey=ev.cumulative?'closemail-'+ev.id+'-'+fid:'settled-'+ev.id+'-'+fid;
      const alreadySent=!!localStorage.getItem(notifKey);
      html+=`<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)"><button id="em-btn-${fid}" style="${btnStyle}" onclick="sendEmailFromModal(${evId},${fid},this)">שלח</button><span style="flex:1;font-size:13px">${esc(name)}</span>${alreadySent?`<span style="font-size:11px;color:var(--text3)">נשלח</span>`:''}</div>`;
    });
  }
  if(!debtors.length&&!settled.length) html+=`<div style="color:var(--text2);font-size:12px">אין משפחות עם כתובת מייל.</div>`;
  document.getElementById('emailModalContent').innerHTML=html;
  document.getElementById('emailModal').style.display='flex';
}
function closeEmailModal(){
  _emailModalEvId=null;
  document.getElementById('emailModal').style.display='none';
}
function sendEmailFromModal(evId,fid,btnEl){
  sendEmailToFam(evId,fid);
  if(btnEl){btnEl.textContent='✓';btnEl.disabled=true;btnEl.style.background='var(--surface2)';btnEl.style.color='var(--text3)';btnEl.style.border='1px solid var(--border)';}
}
function reopenEv(evId){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  ev.open=true;ev.closedOn=null;expanded.delete(evId);save();render();
  goTab('events',document.getElementById('nb-events'));
}
function delEv(evId){
  if(!confirm('למחוק את האירוע?'))return;
  events=events.filter(e=>e.id!==evId);expanded.delete(evId);save();render();
}
function toggleExp(evId){
  if(expanded.has(evId)){expanded.delete(evId);history.replaceState(null,'','#archive');}
  else{expanded.add(evId);history.replaceState(null,'','#archive-'+evId);}
  renderArchive();
}
function setYear(y){actYear=y;renderArchive();}
function addFam(inputId){
  const inp=document.getElementById(inputId||'famInput');
  let name=inp.value.trim();if(!name)return;
  if(!name.startsWith('משפחת'))name='משפחת '+name;
  families.push({id:nxtFam++,name,children:0});inp.value='';save();render();
}
function goTab(tab,el,skipHash,swipeDir){
  const next=document.getElementById('view-'+tab);if(!next)return;
  const prev=document.querySelector('.view.active');
  // abort any in-progress transition
  document.querySelectorAll('.view.sv-out').forEach(v=>{v.classList.remove('sv-out');v.style.cssText='';});
  document.querySelectorAll('.view').forEach(v=>{v.classList.remove('active');v.style.cssText='';});
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  if(el)el.classList.add('active');
  if(tab==='families'){loadEjsSettings();loadPaymentSettings();}
  if(!skipHash) history.replaceState(null,'','#'+tab);
  if(!swipeDir||!prev||prev===next){next.classList.add('active');return;}
  const DUR=260,EASE='cubic-bezier(0.4,0,0.2,1)';
  const right=swipeDir==='right'; // finger went right → new view from left
  // outgoing: stays in flow position → slide out
  prev.classList.add('sv-out');
  prev.style.willChange='transform';
  // incoming: starts off-screen
  next.style.transform=`translateX(${right?'-100%':'100%'})`;
  next.style.willChange='transform';
  next.classList.add('active');
  next.getBoundingClientRect(); // force reflow
  const tr=`transform ${DUR}ms ${EASE}`;
  prev.style.transition=tr;prev.style.transform=`translateX(${right?'100%':'-100%'})`;
  next.style.transition=tr;next.style.transform='translateX(0)';
  setTimeout(()=>{prev.classList.remove('sv-out');prev.style.cssText='';next.style.cssText='';},DUR+20);
}
function _enterPayShell(){
  if(currentShell==='pay')return;
  currentShell='pay';
  document.body.classList.remove('at-home');
  document.getElementById('mn-home').classList.remove('mn-active');
  document.getElementById('mn-pay').classList.add('mn-active');
}
function handleHash(){
  const h=(window.location.hash||'').replace('#','');
  if(!h||h==='home'){goTab('home',document.getElementById('nb-home'),true);return;}
  if(h==='fund'){_enterPayShell();openFundDetail();return;}
  const tabMap={events:'nb-events',families:'nb-families'};
  if(tabMap[h]){_enterPayShell();goTab(h,document.getElementById(tabMap[h]),true);return;}
  if(h.startsWith('event-')){
    const id=parseInt(h.slice(6));if(isNaN(id))return;
    _enterPayShell();
    const _hEv=events.find(e=>e.id===id);
    if(_hEv&&!_hEv.open){
      goTab('archive',null,true);
      expanded.add(id);renderArchive();
    } else {
      goTab('events',document.getElementById('nb-events'),true);
      collapsedEvents.delete(id);renderOpenList();
    }
    setTimeout(()=>{const el=document.getElementById('ecard-'+id);if(el)el.scrollIntoView({behavior:'smooth',block:'center'});},150);
  } else if(h.startsWith('archive-')){
    const id=parseInt(h.slice(8));if(isNaN(id))return;
    _enterPayShell();
    goTab('archive',null);
    expanded.add(id);renderArchive();
    setTimeout(()=>{const el=document.getElementById('ecard-'+id);if(el)el.scrollIntoView({behavior:'smooth',block:'center'});},150);
  } else if(h.startsWith('confirm-')){
    const parts=h.slice(8).split('-').map(Number);
    const [evId,famId,amt]=parts;
    history.replaceState(null,'',window.location.pathname);
    if(parts.length===3&&!parts.some(isNaN)) openClaimConfirmModal(evId,famId,amt);
  }
}
function openEmailGateModal(){
  const modal=document.getElementById('emailGateModal');const el=document.getElementById('emailGateContent');
  if(!modal||!el)return;
  modal.onclick=null;
  el.innerHTML=`
    <div style="padding:26px 22px;text-align:center">
      <div style="font-size:34px;margin-bottom:8px">👋</div>
      <div style="font-size:15px;font-weight:700;margin-bottom:6px">ברוכים הבאים</div>
      <div style="font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:18px">האפליקציה מיועדת למשפחות המשתתפות בלבד — הזינו את כתובת המייל שלכם כדי להיכנס</div>
      <input id="emailGateInput" type="email" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="you@example.com" style="width:100%;border:1.5px solid var(--border);border-radius:var(--r2);padding:11px 12px;font-size:14px;font-family:var(--font);background:var(--bg);color:var(--text);direction:ltr;text-align:center;box-sizing:border-box;margin-bottom:6px" onkeydown="if(event.key==='Enter')submitEmailGate()">
      <div id="emailGateError" style="font-size:12px;color:var(--red-mid);min-height:16px;margin-bottom:8px"></div>
      <button onclick="submitEmailGate()" style="width:100%;padding:12px;border-radius:var(--r2);border:none;background:var(--blue-mid);color:#fff;font-size:14px;font-weight:700;font-family:var(--font);cursor:pointer">המשך</button>
    </div>`;
  modal.style.display='flex';
  setTimeout(()=>{const i=document.getElementById('emailGateInput');if(i)i.focus();},50);
}
function closeEmailGateModal(){
  const modal=document.getElementById('emailGateModal');if(modal)modal.style.display='none';
  maybePromptFamilyUpdate();
}
// Nudge for a regular, non-edit-mode visitor to confirm/update their own family's
// names and birthdates — reuses the existing family-edit sheet, which already covers
// exactly that. Fires right after the email gate confirms who they are, on every
// device/visit, until the family (from any device) actually saves — f.namesConfirmed
// is part of the synced `families` data, not a per-device localStorage flag, so once
// saved it stays done everywhere. Saving is the actual "done" signal (set in
// saveFamEdit/savePerson), not merely opening or closing the sheet.
function maybePromptFamilyUpdate(){
  if(editMode)return;
  const fid=_myFamId();if(fid==null)return;
  const f=getFam(fid);if(!f||f.namesConfirmed)return;
  openFamEditSheet(fid);
  showToast('📋 רגע — כדאי לוודא ששמות וימי הולדת מעודכנים, ולשמור',5000);
}
function submitEmailGate(){
  const email=_cleanEmail(document.getElementById('emailGateInput')?.value||'');
  const errEl=document.getElementById('emailGateError');
  if(!_validEmail(email)){ if(errEl)errEl.textContent='כתובת מייל לא תקינה'; return; }
  const fam=families.find(f=>_cleanEmail(f.email)===email||_cleanEmail(f.email2)===email);
  if(!fam){ if(errEl)errEl.textContent='לא נמצאה משפחה עם המייל הזה'; return; }
  const slot=_cleanEmail(fam.email)===email?1:2;
  localStorage.setItem('deviceFamId3',String(fam.id));
  localStorage.setItem('deviceEmailSlot3',String(slot));
  showEmailGateWelcome(fam,slot);
}
function resetDeviceIdentity(){
  localStorage.removeItem('deviceFamId3');
  localStorage.removeItem('deviceEmailSlot3');
  openEmailGateModal();
}
function logVisit(famId,slot,name){
  const existing=visits.find(v=>v.famId===famId&&v.slot===slot);
  if(existing){ existing.name=name; existing.lastSeen=Date.now(); existing.count=(existing.count||1)+1; }
  else{ visits.push({famId,slot,name,lastSeen:Date.now(),count:1}); }
  save();
  renderVisitLog();
}
function _relTime(ts){
  const diff=Date.now()-ts;
  const mins=Math.round(diff/60000);
  if(mins<1)return'ממש עכשיו';
  if(mins<60)return`לפני ${mins} דק'`;
  const hrs=Math.round(mins/60);
  if(hrs<24)return`לפני ${hrs} שע'`;
  const days=Math.round(hrs/24);
  if(days<30)return`לפני ${days} ימים`;
  return new Date(ts).toLocaleDateString('he-IL');
}
function openVisitLogModal(){
  renderVisitLog();
  document.getElementById('visitLogModal').style.display='flex';
}
function closeVisitLogModal(){
  document.getElementById('visitLogModal').style.display='none';
}
function renderVisitLog(){
  const el=document.getElementById('visitLogModalContent');if(!el)return;
  if(!visits.length){el.innerHTML='<div class="empty" style="padding:20px 0"><span class="empty-ico">👥</span>אין עדיין כניסות רשומות</div>';return;}
  el.innerHTML=[...visits].sort((a,b)=>b.lastSeen-a.lastSeen).map(v=>{
    const f=getFam(v.famId);
    const famName=f?f.name.replace('משפחת','').trim():'משפחה שנמחקה';
    return`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:13px;font-weight:700">${esc(v.name||famName)}</div>
        <div style="font-size:11px;color:var(--text2)">${esc(famName)} · ${v.count||1} כניסות</div>
      </div>
      <div style="font-size:12px;color:var(--text2)">${_relTime(v.lastSeen)}</div>
    </div>`;
  }).join('');
}
// pushTarget: 'all' (default) reaches every registered device; 'admin'
// reaches only devices registered from admin.html — for events that matter
// to the admin (money movement, family self-edits) but would just be noise
// for every other family member's phone.
// hiddenFromFamIds: families that shouldn't see this notification at all —
// neither the in-app bell/list nor the device push — e.g. a surprise-gift
// goal fund announced to everyone except the family it's for.
// kind: 'chat'|'poll'|'important' (default) — lets each family device's own
// notifPref (set via the 🔔 button, see notifPrefModal) filter what actually
// pushes to it; the in-app notification center itself is never filtered by
// this, only real device pushes are. relatedFamIds: which families this is
// actually about, for the "רק מה שקשור אליי" pref tier — e.g. an event's
// participants, or an expense's event's participants.
function addNotif(icon,text,pushTarget,hiddenFromFamIds,kind,relatedFamIds){
  notifications.unshift({id:nxtNotif++,icon,text,ts:Date.now(),hiddenFrom:hiddenFromFamIds&&hiddenFromFamIds.length?hiddenFromFamIds:undefined});
  if(notifications.length>200)notifications.length=200;
  renderNotifCenterBadge();
  const emailOptedSlots=_sendCategoryEmails(icon,text,kind,hiddenFromFamIds,relatedFamIds);
  _sendPush(icon+' ינקלביץ',text,pushTarget,hiddenFromFamIds,kind,relatedFamIds,emailOptedSlots);
}
// Each registered email (family+slot) with the 📧 "email instead of push"
// toggle on (see notifEmailSection in the notifPrefModal) is fully out of
// push from here on — regardless of whether THIS notification's kind is one
// they picked — so "famId:slot" strings for those are returned for addNotif
// to pass along as a separate excludeSlots list (kept apart from the
// family-wide excludeFamIds/hiddenFromFamIds mechanism, which still needs to
// exclude a whole family regardless of which slot). Among those, only the
// slots that actually checked this specific kind get an email for it; an
// unrecognized/missing kind (calls that don't pass one) never emails anyone,
// same as an unchecked category. For the kinds in NOTIF_EMAIL_SCOPED_CATS a
// slot can further narrow that to "רק שלי" — only when their family is in
// this notification's own relatedFamIds — same relatedFamIds the push
// side's 'mine' tier already filters by.
function _sendCategoryEmails(icon,text,kind,hiddenFromFamIds,relatedFamIds){
  // A family editing their own info is admin-only news (see addNotif's
  // pushTarget:'admin' calls) — never emailed out to other families, even
  // for someone who opted into this category back when it was still offered.
  if(kind==='familyEdit')return[];
  const hidden=new Set(hiddenFromFamIds||[]);
  const optedOutSlots=[];
  // The header banner used to repeat the full notification text as its
  // title (same text as the body paragraph right below it) — for a short
  // one-liner that read fine, but for a longer message (e.g. a site-update
  // broadcast) the whole thing visibly appeared twice in the same email.
  // Use the category's own short label as the header instead, so the
  // actual text only shows once, in the body.
  const catLabel=(NOTIF_EMAIL_CATS.find(c=>c.id===kind)||{}).label||'התראה חדשה';
  families.forEach(f=>{
    if(!f.notifEmailPref)return;
    [1,2].forEach(slot=>{
      const pref=f.notifEmailPref[slot];if(!pref)return;
      optedOutSlots.push(f.id+':'+slot);
      if(hidden.has(f.id))return;
      if(!kind||!pref.cats[kind])return;
      if(NOTIF_EMAIL_SCOPED_CATS.has(kind)&&pref.scopes?.[kind]==='mine'){
        if(!Array.isArray(relatedFamIds)||!relatedFamIds.includes(f.id))return;
      }
      const email=slot===2?f.email2:f.email;
      if(!email)return;
      const name=f.name.replace('משפחת','').trim();
      const html=_emailWrap(`<p style="margin:0;font-size:14px">${_esc(text)}</p>`,catLabel,icon);
      sendEmailNotif([{email,name}],icon+' '+text+' · ינקלביץ',text,html);
    });
  });
  return optedOutSlots;
}
const _visibleNotifs=()=>{
  if(editMode)return notifications;
  const myId=_myFamId();
  return notifications.filter(n=>!(n.hiddenFrom||[]).includes(myId));
};
// Fires a real device push (via the /api/notify Vercel function → FCM) for
// every in-app notification-center event, so family members get it even
// when the app is closed — not just the in-app bell. Best-effort: silently
// ignored if it fails (e.g. offline, or the API route isn't deployed yet).
function _sendPush(title,body,target,excludeFamIds,kind,relatedFamIds,excludeSlots){
  fetch('/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adminPass,title,body,target:target||'all',excludeFamIds,kind,relatedFamIds,excludeSlots})}).catch(()=>{});
}
function _notifLastSeen(){return parseInt(localStorage.getItem('notifLastSeen')||'0');}
function renderNotifCenterBadge(){
  const badge=document.getElementById('notifCenterBadge');if(!badge)return;
  const btn=document.getElementById('floatingNotifBtn');
  const seen=_notifLastSeen();
  const unread=_visibleNotifs().filter(n=>n.ts>seen).length;
  if(unread>0){
    badge.style.display='flex';badge.textContent=unread>99?'99+':String(unread);
    if(btn)btn.style.display='flex';
  }else{
    badge.style.display='none';
    if(btn)btn.style.display='none';
  }
}
function openNotifCenter(){
  const modal=document.getElementById('notifCenterModal');if(!modal)return;
  const list=document.getElementById('notifCenterList');
  if(list){
    const visible=_visibleNotifs();
    list.innerHTML=visible.length?visible.map(n=>`
      <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:18px;flex-shrink:0">${n.icon||'🔔'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;color:var(--text)">${esc(n.text)}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:2px">${_relTime(n.ts)}</div>
        </div>
      </div>`).join('') : '<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px">אין עדיין התראות</div>';
  }
  modal.style.display='flex';
  localStorage.setItem('notifLastSeen',String(Date.now()));
  renderNotifCenterBadge();
}
function closeNotifCenter(){
  const modal=document.getElementById('notifCenterModal');if(modal)modal.style.display='none';
}
function showEmailGateWelcome(fam,slot){
  const el=document.getElementById('emailGateContent');const modal=document.getElementById('emailGateModal');
  if(!el)return;
  if(modal){ modal.style.display='flex'; modal.onclick=e=>{if(e.target===modal)closeEmailGateModal();}; }
  const firstName=slot===2?fam.emailName2:fam.emailName;
  const surname=fam.name.replace('משפחת','').trim();
  const name=firstName?`${firstName} ${surname}`:surname;
  logVisit(fam.id,slot,name);
  const fundBal=Math.round(famFundBal(fam.id));
  const evBals=events.filter(ev=>ev.open&&(ev.participants||[]).includes(fam.id))
    .map(ev=>({name:ev.name,bal:Math.round(evAdjBalance(ev)[fam.id]||0)}))
    .filter(d=>Math.abs(d.bal)>0.5);
  const totalEvBal=evBals.reduce((s,d)=>s+d.bal,0);
  el.innerHTML=`
    <div style="padding:26px 22px;text-align:center">
      <div style="font-size:34px;margin-bottom:8px">👋</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:16px">ברוכים הבאים, ${esc(name)}!</div>
      <div style="background:var(--surface2);border-radius:var(--r2);padding:12px 14px;margin-bottom:12px;text-align:right">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:13px;color:var(--text2)">יתרתך בארנק</span>
          <span style="font-size:14px;font-weight:700;color:${fundBal>=0?'var(--green-mid)':'var(--red-mid)'}">₪${fundBal.toLocaleString()}</span>
        </div>
      </div>
      ${evBals.length?`
      <div style="background:${totalEvBal<-0.5?'var(--red-bg)':'var(--surface2)'};border-radius:var(--r2);padding:12px 14px;margin-bottom:16px;text-align:right">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:13px;color:var(--text2)">יתרתך באירועים</span>
          <span style="font-size:14px;font-weight:700;color:${totalEvBal>=0?'var(--green-mid)':'var(--red-mid)'}">${totalEvBal>=0?'+':'-'}₪${Math.abs(totalEvBal).toLocaleString()}</span>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:6px">
          ${evBals.map(d=>`<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0">
            <span style="color:var(--text2)">${esc(d.name)}</span>
            <span style="font-weight:700;color:${d.bal>=0?'var(--green-mid)':'var(--red-mid)'}">${d.bal>=0?'+':'-'}₪${Math.abs(d.bal).toLocaleString()}</span>
          </div>`).join('')}
        </div>
      </div>`:`
      <div style="background:var(--green-bg);border-radius:var(--r2);padding:10px 14px;margin-bottom:16px;font-size:13px;font-weight:700;color:var(--green-mid)">✅ מסודר בכל האירועים</div>`}
      <button onclick="closeEmailGateModal()" style="width:100%;padding:12px;border-radius:var(--r2);border:none;background:var(--blue-mid);color:#fff;font-size:14px;font-weight:700;font-family:var(--font);cursor:pointer;margin-bottom:8px">המשך לאפליקציה</button>
      <button onclick="resetDeviceIdentity()" style="width:100%;padding:6px;border:none;background:none;color:var(--text3);font-size:11px;font-family:var(--font);cursor:pointer;text-decoration:underline">לא אני? החלף מייל</button>
    </div>`;
}
function openClaimConfirmModal(evId,famId,amt){
  const ev=events.find(e=>e.id===evId);const f=getFam(famId);
  const modal=document.getElementById('claimConfirmModal');const el=document.getElementById('claimConfirmContent');
  if(!modal||!el)return;
  if(!ev||!f){
    el.innerHTML=`<div style="padding:24px 20px;text-align:center;color:var(--text2)">הקישור לא תקין או שהאירוע כבר לא קיים.</div>`;
    modal.style.display='flex';return;
  }
  el.innerHTML=`
    <div style="padding:24px 20px;text-align:center">
      <div style="font-size:32px;margin-bottom:8px">💸</div>
      <div style="font-size:15px;font-weight:700;margin-bottom:6px">לאשר תשלום?</div>
      <div style="font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:20px">
        ${esc(f.name.replace('משפחת','').trim())} מאשר/ת ששילם/ה <b>₪${amt.toLocaleString()}</b><br>עבור "${esc(ev.name)}"
      </div>
      <button onclick="submitPaymentClaim(${evId},${famId},${amt})" style="width:100%;padding:12px;border-radius:var(--r2);border:none;background:var(--green-mid);color:#fff;font-size:14px;font-weight:700;font-family:var(--font);cursor:pointer;margin-bottom:8px">✓ כן, שילמתי</button>
      <button onclick="closeClaimConfirmModal()" style="width:100%;padding:12px;border-radius:var(--r2);border:1.5px solid var(--border);background:transparent;color:var(--text2);font-size:14px;font-weight:600;font-family:var(--font);cursor:pointer">ביטול</button>
    </div>`;
  modal.style.display='flex';
}
function closeClaimConfirmModal(){
  const modal=document.getElementById('claimConfirmModal');if(modal)modal.style.display='none';
}
function submitPaymentClaim(evId,famId,amt){
  paymentClaims.push({id:nxtClaim++,evId,famId,amt,date:new Date().toLocaleDateString('he-IL'),ts:Date.now()});
  _sendPush('💸 אישור תשלום חדש','₪'+amt.toLocaleString()+' · לבדיקה באפליקציה','admin');
  save();
  const el=document.getElementById('claimConfirmContent');
  if(el) el.innerHTML=`
    <div style="padding:24px 20px;text-align:center">
      <div style="font-size:32px;margin-bottom:8px">✅</div>
      <div style="font-size:15px;font-weight:700;margin-bottom:6px">תודה!</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:20px">האישור נשלח, מי שמנהל את הקופה יבדוק ויעדכן.</div>
      <button onclick="closeClaimConfirmModal()" style="width:100%;padding:12px;border-radius:var(--r2);border:none;background:var(--blue-mid);color:#fff;font-size:14px;font-weight:700;font-family:var(--font);cursor:pointer">סגור</button>
    </div>`;
  renderClaimsBanner();
}
function renderClaimsBanner(){
  const el=document.getElementById('claimsBanner');if(!el)return;
  if(!paymentClaims.length){el.innerHTML='';return;}
  el.innerHTML=`
    <div onclick="openClaimsModal()" style="cursor:pointer;margin:0 16px 12px;padding:12px 14px;border-radius:var(--r2);background:var(--green-bg);border:1px solid var(--green-mid);display:flex;align-items:center;gap:10px">
      <div style="font-size:20px">💸</div>
      <div style="flex:1;font-size:13px;font-weight:700;color:var(--green-mid)">${paymentClaims.length} אישור${paymentClaims.length>1?'י':''} תשלום ממתין${paymentClaims.length>1?'ים':''} לבדיקה</div>
      <div style="font-size:16px;color:var(--green-mid)">›</div>
    </div>`;
}
function openClaimsModal(){
  const modal=document.getElementById('claimsModal');const el=document.getElementById('claimsModalContent');
  if(!modal||!el)return;
  if(!paymentClaims.length){closeClaimsModal();return;}
  const rows=[...paymentClaims].sort((a,b)=>b.ts-a.ts).map(c=>{
    const ev=events.find(e=>e.id===c.evId);const f=getFam(c.famId);
    const evName=ev?esc(ev.name):(c.kind==='transfer'&&c.evId==null?'העברות איזון':'אירוע שנמחק');
    const famName=f?esc(f.name.replace('משפחת','').trim()):'משפחה שנמחקה';
    if(c.kind==='transfer'){
      const tf=getFam(c.toFid);
      const toName=tf?esc(tf.name.replace('משפחת','').trim()):'משפחה שנמחקה';
      return`<div style="padding:12px 16px;border-bottom:1px solid var(--border)">
        <div style="font-size:13px;margin-bottom:2px">👈 <b>${famName}</b> מעביר ל<b>${toName}</b></div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:12px;color:var(--text2)">${evName} · ${esc(c.date||'')}</div>
          <div style="font-size:14px;font-weight:700;color:var(--green-mid)">₪${c.amt.toLocaleString()}</div>
        </div>
        <div style="display:flex;gap:6px">
          ${(ev||c.evId==null)&&f&&tf?`<button onclick="goToClaimTransfer(${c.id})" style="flex:1;padding:7px;border-radius:8px;border:none;background:var(--green-mid);color:#fff;font-size:12px;font-weight:700;font-family:var(--font);cursor:pointer">✓ אשר</button>`:''}
          <button onclick="dismissClaim(${c.id})" style="flex:1;padding:7px;border-radius:8px;border:1.5px solid var(--border);background:transparent;color:var(--text2);font-size:12px;font-weight:600;font-family:var(--font);cursor:pointer">✗ בטל</button>
        </div>
      </div>`;
    }
    return`<div style="padding:12px 16px;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
        <div style="font-size:13px;font-weight:700">${famName}</div>
        <div style="font-size:14px;font-weight:700;color:var(--green-mid)">₪${c.amt.toLocaleString()}</div>
      </div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:8px">${evName} · ${esc(c.date||'')}</div>
      <div style="display:flex;gap:6px">
        ${ev?`<button onclick="goToClaimEvent(${c.id},${c.evId})" style="flex:1;padding:7px;border-radius:8px;border:none;background:var(--blue-mid);color:#fff;font-size:12px;font-weight:700;font-family:var(--font);cursor:pointer">↗ פתח אירוע</button>`:''}
        <button onclick="dismissClaim(${c.id})" style="flex:1;padding:7px;border-radius:8px;border:1.5px solid var(--border);background:transparent;color:var(--text2);font-size:12px;font-weight:600;font-family:var(--font);cursor:pointer">✓ טופל</button>
      </div>
    </div>`;
  }).join('');
  el.innerHTML=rows;
  modal.style.display='flex';
}
function closeClaimsModal(){
  const modal=document.getElementById('claimsModal');if(modal)modal.style.display='none';
}
function dismissClaim(claimId){
  paymentClaims=paymentClaims.filter(c=>c.id!==claimId);
  save();renderClaimsBanner();openClaimsModal();
}
function goToClaimEvent(claimId,evId){
  dismissClaim(claimId);
  closeClaimsModal();
  window.location.hash='event-'+evId;
}
function claimTransfer(evId,fromFid,toFid,amt){
  paymentClaims.push({id:nxtClaim++,kind:'transfer',evId,famId:fromFid,toFid,amt,date:new Date().toLocaleDateString('he-IL'),ts:Date.now()});
  _sendPush('💸 אישור תשלום חדש','₪'+amt.toLocaleString()+' · לבדיקה באפליקציה','admin');
  save();
  renderClaimsBanner();
  // Real (family-to-family) transfer claims are global now (evId==null) —
  // refresh the standalone "העברות איזון" modal if it's open.
  if(evId==null){
    const modal=document.getElementById('globalSettleModal');
    if(modal&&modal.style.display==='flex')renderGlobalSettleModal();
  } else {
    const ev=events.find(e=>e.id===evId);
    if(settleModalEvId===evId&&ev)renderSettleModal(ev);
  }
}
function goToClaimTransfer(claimId){
  const c=paymentClaims.find(x=>x.id===claimId);if(!c)return;
  const ev=events.find(e=>e.id===c.evId);const f=getFam(c.famId);const tf=getFam(c.toFid);
  if((!ev&&c.evId!=null)||!f||!tf){dismissClaim(claimId);return;}
  paymentClaims=paymentClaims.filter(x=>x.id!==claimId);
  save();renderClaimsBanner();closeClaimsModal();
  openPartPayModal(ev?ev.id:null,f.name.replace('משפחת','').trim(),c.famId,tf.name.replace('משפחת','').trim(),c.toFid,c.amt,false,false);
}

// Small summary row on the funds page — tapping it opens savingsPotModal
// with the full balance/expenses/event-contributions breakdown, same
// click-to-expand pattern as the goal funds above (instead of always
// showing that full card open on the funds page).
function renderSavingsPot(){
  const el=document.getElementById('savingsPotSection');
  if(!el)return;
  const contrib=savingsPotContrib();
  const expTotal=savingsPotExpTotal();
  const bal=contrib-expTotal;
  const contribEvs=events.map(ev=>({ev,amt:(ev.savingsPaid||[]).reduce((s,p)=>s+p.amt,0)+(ev.potToSavings||[]).reduce((s,p)=>s+p.amt,0)})).filter(x=>x.amt>0.5);
  if(!contrib&&!expTotal&&!contribEvs.length){el.innerHTML='';return;}
  el.innerHTML=`<div class="fund-settle-card" style="margin-bottom:10px">
    <div class="home-row home-row-col" onclick="openSavingsPotModal()">
      <div class="home-goal-top">
        <div class="home-row-icon" style="background:var(--blue-bg);color:var(--blue)">💎</div>
        <div class="home-row-body">
          <div class="home-row-title">קופת חיסכון</div>
          <div class="home-row-sub">יתרה ₪${bal.toLocaleString()}</div>
        </div>
      </div>
    </div>
  </div>`;
  renderSavingsPotModal();
}
function openSavingsPotModal(){
  renderSavingsPotModal();
  document.getElementById('savingsPotModal').style.display='flex';
}
function closeSavingsPotModal(){
  document.getElementById('savingsPotModal').style.display='none';
}
function renderSavingsPotModal(){
  const el=document.getElementById('savingsPotModalContent');
  if(!el)return;
  const contrib=savingsPotContrib();
  const expTotal=savingsPotExpTotal();
  const bal=contrib-expTotal;
  const contribEvs=events.map(ev=>({ev,amt:(ev.savingsPaid||[]).reduce((s,p)=>s+p.amt,0)+(ev.potToSavings||[]).reduce((s,p)=>s+p.amt,0)})).filter(x=>x.amt>0.5);
  const expRows=(savingsPot.expenses||[]).map(e=>
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600">${esc(e.name)}</div>
        ${e.date?`<div style="font-size:11px;color:var(--text2)">${esc(e.date)}</div>`:''}
      </div>
      <div style="font-size:13px;font-weight:700;color:var(--red-mid)">-₪${e.amt.toLocaleString()}</div>
      <button class="edit-only" onclick="delSavingsPotExp(${e.id})" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:16px;padding:2px 4px;line-height:1">🗑</button>
    </div>`
  ).join('');
  const addForm=`<div class="edit-only" style="display:flex;gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
    <input id="savExpName" type="text" placeholder="שם ההוצאה" style="flex:2;min-width:0;border:1.5px solid var(--border);border-radius:var(--r2);padding:8px 10px;font-size:13px;font-family:var(--font);background:var(--bg);color:var(--text)">
    <input id="savExpAmt" type="number" min="0" inputmode="numeric" placeholder="₪" style="flex:1;min-width:0;border:1.5px solid var(--border);border-radius:var(--r2);padding:8px 10px;font-size:13px;font-family:var(--font);background:var(--bg);color:var(--text);direction:ltr;text-align:center">
    <button onclick="addSavingsPotExp()" style="padding:8px 12px;border-radius:var(--r2);border:none;background:var(--green-mid);color:#fff;font-size:13px;font-weight:700;font-family:var(--font);cursor:pointer">+</button>
  </div>`;
  const evList=contribEvs.length?`<div style="border-top:1px solid var(--border);padding-top:10px;margin-top:10px">
    <div style="font-size:11px;color:var(--text2);margin-bottom:6px">תרומות מאירועים</div>
    ${contribEvs.map(({ev,amt})=>`<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
      <span style="color:var(--text)">${esc(ev.name)}</span>
      <span style="font-weight:700;color:var(--green-mid)">+₪${Math.round(amt).toLocaleString()}</span>
    </div>`).join('')}
  </div>`:'';
  el.innerHTML=`<div style="text-align:center;margin-bottom:4px">
      <div style="font-size:11px;color:var(--text2);margin-bottom:2px">יתרה</div>
      <div style="font-size:32px;font-weight:800;color:var(--text);letter-spacing:-0.5px">₪${bal.toLocaleString()}</div>
    </div>
    ${contrib>0?`<div style="font-size:12px;color:var(--text2);text-align:center;margin-top:4px">נאסף: ₪${contrib.toLocaleString()} · הוצא: ₪${expTotal.toLocaleString()}</div>`:''}
    ${expTotal>0?`<div style="border-top:1px solid var(--border);padding-top:10px;margin-top:12px">${expRows}</div>`:''}
    ${evList}
    ${addForm}`;
}
function renderFund(){
  const mainTotal=fundTotal();
  const goalTotal2=_visibleGoalFunds(goalFunds.filter(g=>!g.archived&&!g.closed)).reduce((s,g)=>s+goalTotal(g),0);
  const evPotsTotal=events.filter(e=>e.open).reduce((s,ev)=>s+evNetPotBal(ev),0);
  const savTotal=savingsPotBal();
  // Savings is shown in the breakdown below but left out of the grand
  // total itself — it's money already set aside for something specific,
  // not spare balance sitting in the other funds.
  const grandTotal=mainTotal+goalTotal2+evPotsTotal;

  // Grand total card
  document.getElementById('grandTotalAmt').textContent='₪'+grandTotal.toLocaleString();
  document.getElementById('grandTotalBreakdown').innerHTML=[
    {label:'ארנק',amt:mainTotal,color:'rgba(255,255,255,0.8)'},
    {label:'מטרה',amt:goalTotal2,color:'#6ee7b7'},
    {label:'אירועים',amt:evPotsTotal,color:'#fbbf24'},
    {label:'חיסכון',amt:savTotal,color:'#93c5fd'},
  ].map(({label,amt,color})=>`<div style="text-align:center">
    <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:2px">${label}</div>
    <div style="font-size:15px;font-weight:700;color:${color}">₪${amt.toLocaleString()}</div>
  </div>`).join('');

  // Main fund balance
  document.getElementById('fundBalAmt').textContent='₪'+mainTotal.toLocaleString();

  // Treasurer deficit — how much the shared fund owes back the treasurer
  // for transfers they fronted personally (see markTransferFromTreasurer),
  // instead of drawing on any specific family's own wallet balance.
  const deficitEl=document.getElementById('treasurerDeficitSection');
  if(deficitEl){
    const deficit=Math.round(fund.deficit||0);
    deficitEl.innerHTML=deficit>0?`<div class="edit-only" style="display:flex;align-items:center;gap:10px;background:var(--amber-bg);border-radius:var(--r2);padding:11px 14px;margin-bottom:8px;cursor:pointer" onclick="openTreasurerDeficitModal()">
      <span style="font-size:18px;flex-shrink:0">💼</span>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700;color:var(--amber)">מגיע לגזבר</div>
        <div style="font-size:11px;color:var(--text2)">שולם מהכיס עבור אירועים וקופות מטרה — הקש לפירוט</div>
      </div>
      <div style="font-size:15px;font-weight:800;color:var(--amber)">₪${deficit.toLocaleString()}</div>
    </div>
    <div class="view-only" style="display:flex;align-items:center;gap:10px;background:var(--amber-bg);border-radius:var(--r2);padding:11px 14px;margin-bottom:8px">
      <span style="font-size:18px;flex-shrink:0">💼</span>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700;color:var(--amber)">מגיע לגזבר</div>
        <div style="font-size:11px;color:var(--text2)">שולם מהכיס עבור אירועים וקופות מטרה</div>
      </div>
      <div style="font-size:15px;font-weight:800;color:var(--amber)">₪${deficit.toLocaleString()}</div>
    </div>`:'';
  }

  const famSumEl=document.getElementById('fundFamSummary');
  if(famSumEl){
    const withBal=families.filter(f=>famFundBal(f.id)>0);
    if(!withBal.length){
      famSumEl.innerHTML='';
    } else {
      famSumEl.innerHTML=withBal.map(f=>{
        const cl=col(f.id);
        const bal=famFundBal(f.id);
        return`<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          ${famAva(f, 28, 'flex-shrink:0')}
          <div style="flex:1;font-size:13px;font-weight:600">${esc(f.name.replace('משפחת','').trim())}</div>
          <div style="font-size:13px;font-weight:700;color:var(--green-mid)">₪${bal.toLocaleString()}</div>
        </div>`;
      }).join('');
    }
  }

  // Event pots section
  const evPotsEl=document.getElementById('eventPotsSection');
  if(evPotsEl){
    const potsWithFunds=events.filter(e=>e.open&&evPotBal(e)>0);
    if(!potsWithFunds.length){
      evPotsEl.innerHTML='';
    } else {
      evPotsEl.innerHTML=`<div class="fund-section-title">📅 קופות אירועים</div>`+
        potsWithFunds.map(ev=>{
          const pot=evNetPotBal(ev);
          const cl=col(ev.id);
          return`<div style="background:var(--surface);border-radius:var(--r);border:1px solid var(--amber);padding:11px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px;cursor:pointer" onclick="openPotModal(${ev.id})">
            <div class="ava" style="background:${cl.bg};color:${cl.c};width:32px;height:32px;font-size:11px;flex-shrink:0">📅</div>
            <div style="flex:1">
              <div style="font-size:14px;font-weight:700">${esc(ev.name)}</div>
              ${ev.date&&ev.date!=='לא צוין'?`<div style="font-size:11px;color:var(--text2);margin-top:1px">${esc(ev.date)}</div>`:''}
            </div>
            <div style="font-size:15px;font-weight:800;color:var(--amber)">₪${pot.toLocaleString()}</div>
          </div>`;
        }).join('');
    }
  }

  renderSavingsPot();

  // היסטוריית תנועות
  const txEl=document.getElementById('fundTxList');
  const arrow=document.getElementById('fundTxArrow');
  if(txEl) txEl.style.display=fundTxOpen?'block':'none';
  if(arrow) arrow.textContent=fundTxOpen?'▲':'▼';
  if(!fundTxOpen||!txEl) return;
  const _txList=_fundTxForDisplay();
  if(!_txList.length){
    txEl.innerHTML=`<div class="empty"><span class="empty-ico">📋</span>אין תנועות עדיין</div>`;
    return;
  }
  txEl.innerHTML=`<div class="fund-tx-card" style="margin-top:6px">${[..._txList].reverse().map(tx=>{
    const isDeposit=tx.type==='deposit';const isWithdraw=tx.type==='withdraw';
    return`<div class="fund-tx-row">
      <span class="fund-tx-type ${isDeposit?'fund-tx-dep':isWithdraw?'fund-tx-with':'fund-tx-pay'}">${isDeposit?'הפקדה':isWithdraw?'משיכה':'תשלום'}</span>
      <span class="fund-tx-desc"><span>${esc(tx.desc)}</span>${tx.note?`<span class="fund-tx-note">📝 ${esc(tx.note)}</span>`:''}${tx.date?`<span class="fund-tx-date">${esc(tx.date)}</span>`:''}</span>
      <span class="fund-tx-amt ${isDeposit?'':'neg'}">${isDeposit?'+':'-'}₪${tx.amount.toLocaleString()}</span>
    </div>`;
  }).join('')}</div>`;
}
// Every outstanding treasurer advance, itemized by who owes it and what for
// — combines event-side fronts (evTreasurerOwed) and goal-fund-side fronts
// (goalTreasurerOwed) into one flat list for the deficit modal.
function allTreasurerDebts(){
  const list=[];
  events.forEach(ev=>{
    families.forEach(f=>{
      const owed=Math.round(evTreasurerOwed(ev,f.id));
      if(owed>0.5)list.push({famId:f.id,famName:f.name.replace('משפחת','').trim(),amt:owed,source:'event',sourceId:ev.id,sourceName:ev.name});
    });
  });
  goalFunds.forEach(g=>{
    families.forEach(f=>{
      const owed=Math.round(goalTreasurerOwed(g,f.id));
      if(owed>0.5)list.push({famId:f.id,famName:f.name.replace('משפחת','').trim(),amt:owed,source:'goal',sourceId:g.id,sourceName:g.name});
    });
  });
  return list;
}
// Admin-only way to record that the treasurer got some (or all) of their
// fronted money back. The itemized list at the top repays a specific
// family+source line exactly (markTreasurerRepaid/markGoalTreasurerRepaid);
// the manual amount below is for money that isn't tied to any one of
// those — outside the app, so there's nothing to draw it from
// automatically. Either way it just lowers fund.deficit and logs it.
function openTreasurerDeficitModal(){
  if(!editMode)return;
  renderTreasurerDeficitModal();
  document.getElementById('treasurerDeficitModal').style.display='flex';
}
function renderTreasurerDeficitModal(){
  const el=document.getElementById('treasurerDeficitAmt');
  if(el)el.value='';
  const infoEl=document.getElementById('treasurerDeficitInfo');
  if(infoEl)infoEl.textContent='מגיע לגזבר כרגע (סה"כ): ₪'+Math.round(fund.deficit||0).toLocaleString();
  const listEl=document.getElementById('treasurerDebtsList');
  if(listEl){
    const debts=allTreasurerDebts();
    listEl.innerHTML=debts.length?debts.map(d=>`<div style="display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:var(--r2);border:1px solid var(--border);margin-bottom:6px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700">${esc(d.famName)}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:1px">${d.source==='event'?'📅':'🎯'} ${esc(d.sourceName)}</div>
      </div>
      <div style="font-size:13px;font-weight:800;color:var(--amber);flex-shrink:0">₪${d.amt.toLocaleString()}</div>
      <button onclick="${d.source==='event'?`markTreasurerRepaid(${d.sourceId},${d.famId})`:`markGoalTreasurerRepaid(${d.sourceId},${d.famId})`}" style="border:1px solid var(--amber);border-radius:8px;background:none;color:var(--amber);font-size:11px;font-weight:700;font-family:var(--font);cursor:pointer;padding:5px 9px;flex-shrink:0">✓ הוחזר</button>
    </div>`).join(''):`<div style="font-size:12px;color:var(--text2);text-align:center;padding:8px 0">אין חובות פרטניים רשומים</div>`;
  }
}
function closeTreasurerDeficitModal(){
  document.getElementById('treasurerDeficitModal').style.display='none';
}
function confirmTreasurerRepay(){
  const amt=Math.round(parseFloat(document.getElementById('treasurerDeficitAmt')?.value)||0);
  const current=Math.round(fund.deficit||0);
  if(amt<=0){alert('נא להזין סכום');return;}
  if(amt>current){alert('הסכום גבוה ממה שמגיע לגזבר (₪'+current.toLocaleString()+')');return;}
  fund.deficit=current-amt;
  fund.transactions.push({id:nxtTx++,type:'payout',famId:null,amount:amt,
    desc:'החזר לגזבר עבור מקדמות שהוא שילם',
    date:new Date().toLocaleDateString('he-IL')});
  closeTreasurerDeficitModal();
  save();render();
}
function addSavingsPotExp(){
  const name=document.getElementById('savExpName')?.value.trim();
  const amt=Math.round(parseFloat(document.getElementById('savExpAmt')?.value)||0);
  if(!name||!amt)return;
  if(!savingsPot.expenses)savingsPot.expenses=[];
  if(!savingsPot.nxtExpId)savingsPot.nxtExpId=1;
  const d=new Date();
  savingsPot.expenses.push({id:savingsPot.nxtExpId++,name,amt,date:d.toLocaleDateString('he-IL',{day:'2-digit',month:'2-digit',year:'numeric'})});
  save();renderFund();
}
function delSavingsPotExp(id){
  savingsPot.expenses=(savingsPot.expenses||[]).filter(e=>e.id!==id);
  save();renderFund();
}
function toggleFundTx(){
  fundTxOpen=!fundTxOpen;
  const txEl=document.getElementById('fundTxList');
  const arrow=document.getElementById('fundTxArrow');
  if(txEl) txEl.style.display=fundTxOpen?'block':'none';
  if(arrow) arrow.textContent=fundTxOpen?'▲':'▼';
  if(fundTxOpen){
    const _txList=_fundTxForDisplay();
    if(!_txList.length){
      txEl.innerHTML=`<div class="empty"><span class="empty-ico">📋</span>אין תנועות עדיין</div>`;
    } else {
      txEl.innerHTML=`<div class="fund-tx-card" style="margin-top:6px">${[..._txList].reverse().map(tx=>{
        const isDeposit=tx.type==='deposit';const isWithdraw=tx.type==='withdraw';
        return`<div class="fund-tx-row">
          <span class="fund-tx-type ${isDeposit?'fund-tx-dep':isWithdraw?'fund-tx-with':'fund-tx-pay'}">${isDeposit?'הפקדה':isWithdraw?'משיכה':'תשלום'}</span>
          <span class="fund-tx-desc"><span>${esc(tx.desc)}</span>${tx.note?`<span class="fund-tx-note">📝 ${esc(tx.note)}</span>`:''}${tx.date?`<span class="fund-tx-date">${esc(tx.date)}</span>`:''}</span>
          <span class="fund-tx-amt ${isDeposit?'':'neg'}">${isDeposit?'+':'-'}₪${tx.amount.toLocaleString()}</span>
        </div>`;
      }).join('')}</div>`;
    }
  }
}

let _goalHideFamIds=new Set();
let _goalNonPayFamIds=new Set();
function openGoalForm(){
  _goalHideFamIds=new Set();
  _goalNonPayFamIds=new Set();
  _updateGoalFamPickCounts();
  document.getElementById('goalFormOverlay').style.display='flex';
}
// Both "who can't see this fund" (_goalHideFamIds) and "who doesn't pay a
// share" (_goalNonPayFamIds) are picked through the SAME popup — which set
// it's editing is just which button opened it — so the create form itself
// stays two short buttons instead of two whole family grids stacked on top
// of it. openGoalPayersModal (a separate, existing popup) still covers
// changing the non-payer set after the fund already exists.
let _goalFamPickTarget=null;
function openGoalFamPick(which){
  _goalFamPickTarget=which;
  const titleEl=document.getElementById('goalFamPickTitle');
  if(titleEl)titleEl.textContent=which==='hide'?'🙈 מי לא יראה את הקופה הזו?':'🚫 מי לא ישתתף בתשלום?';
  _renderGoalFamPickChips();
  document.getElementById('goalFamPickModal').style.display='flex';
}
function _goalFamPickSet(){
  return _goalFamPickTarget==='hide'?_goalHideFamIds:_goalNonPayFamIds;
}
function _renderGoalFamPickChips(){
  const el=document.getElementById('goalFamPickChips');if(!el)return;
  const set=_goalFamPickSet();
  el.innerHTML=families.map(f=>
    `<button type="button" class="chip ${set.has(f.id)?'on':''}" onclick="toggleGoalFamPick(${f.id})">${esc(f.name.replace('משפחת','').trim())}</button>`
  ).join('');
}
function toggleGoalFamPick(fid){
  const set=_goalFamPickSet();
  if(set.has(fid))set.delete(fid);else set.add(fid);
  _renderGoalFamPickChips();
}
function closeGoalFamPick(){
  document.getElementById('goalFamPickModal').style.display='none';
  _goalFamPickTarget=null;
  _updateGoalFamPickCounts();
}
function _updateGoalFamPickCounts(){
  const hideEl=document.getElementById('goalHideCount');
  if(hideEl)hideEl.textContent=_goalHideFamIds.size?` (${_goalHideFamIds.size})`:'';
  const payEl=document.getElementById('goalNonPayCount');
  if(payEl)payEl.textContent=_goalNonPayFamIds.size?` (${_goalNonPayFamIds.size})`:'';
}
function closeGoalForm(){
  document.getElementById('goalFormOverlay').style.display='none';
  document.getElementById('goalName').value='';
  document.getElementById('goalTarget').value='';
  document.getElementById('goalRecipient').value='';
  document.getElementById('goalGift').value='';
  document.getElementById('goalNotes').value='';
}
function addGoalFund(){
  const name=document.getElementById('goalName').value.trim();
  if(!name){ alert('נא להזין שם לקופה'); return; }
  const target=Math.max(0,parseFloat(document.getElementById('goalTarget').value)||0);
  const recipient=document.getElementById('goalRecipient').value.trim();
  const gift=document.getElementById('goalGift').value.trim();
  const notes=document.getElementById('goalNotes').value.trim();
  goalFunds.push({id:nxtGoal++,name,target,contributions:{},closed:false,archived:false,hiddenFrom:[..._goalHideFamIds],nonPayers:[..._goalNonPayFamIds],recipient:recipient||undefined,gift:gift||undefined,notes:notes||undefined});
  const giftInfo=gift?(' — מתנה: '+gift+(recipient?' עבור '+recipient:'')):'';
  addNotif('🎯','נוצרה קופה חדשה: '+name+giftInfo,'all',[..._goalHideFamIds],'goalFund',families.filter(f=>!_goalHideFamIds.has(f.id)).map(f=>f.id));
  closeGoalForm();
  save();render();
}
let _goalDepositGoalId=null;
let _goalDepositFamId=null;
let _goalDepositFromFund=false;
function openGoalDepositSheet(goalId){
  _goalDepositGoalId=goalId;
  _goalDepositFamId=null;
  _goalDepositFromFund=false;
  const g=goalFunds.find(x=>x.id===goalId);if(!g)return;
  const titleEl=document.getElementById('goalDepositTitle');
  if(titleEl) titleEl.textContent='הפקדה ל"'+g.name+'"';
  document.getElementById('goalDepositFields').innerHTML=`
    ${_goalGiftInfoHtml(g)}
    <input type="number" min="0" inputmode="numeric" id="goalDepositAmt" placeholder="סכום להפקדה (₪)"
      style="width:100%;border:1.5px solid var(--blue-mid);border-radius:var(--r2);padding:12px;font-size:18px;font-family:var(--font);background:var(--bg);color:var(--text);direction:ltr;text-align:center;margin-bottom:8px;box-sizing:border-box">
    <div id="goalDepFundLine" style="display:none;align-items:center;background:var(--blue-bg);border-radius:var(--r2);padding:8px 12px;margin-bottom:14px;cursor:pointer" onclick="useFundForGoalDeposit()">
      <span id="goalDepFundText" style="font-size:12px;font-weight:700;color:var(--blue-mid)"></span>
    </div>
    <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px">מי מפקיד?</div>
    ${families.map(f=>{
      const cl=col(f.id);
      const c=g.contributions[f.id]||0;
      return`<div id="gdepfam-${f.id}" onclick="selectGoalDepFam(${f.id})" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--r2);border:1.5px solid var(--border);margin-bottom:6px;cursor:pointer;box-sizing:border-box">
        ${famAva(f, 32, 'flex-shrink:0')}
        <div style="flex:1">
          <div style="font-size:13px;font-weight:700">${esc(f.name.replace('משפחת','').trim())}</div>
          <div style="font-size:11px;color:var(--blue-mid);margin-top:1px">הפקיד עד כה: ₪${c.toLocaleString()}</div>
        </div>
      </div>`;
    }).join('')}
  `;
  document.getElementById('goalDepositOverlay').style.display='flex';
  setTimeout(()=>{ const el=document.getElementById('goalDepositAmt'); if(el)el.focus(); },100);
}
function selectGoalDepFam(famId){
  _goalDepositFamId=famId;
  _goalDepositFromFund=false;
  families.forEach(f=>{
    const el=document.getElementById('gdepfam-'+f.id);
    if(el){
      const sel=f.id===famId;
      el.style.borderColor=sel?'var(--blue-mid)':'var(--border)';
      el.style.background=sel?'var(--blue-bg)':'transparent';
    }
  });
  const g=goalFunds.find(x=>x.id===_goalDepositGoalId);
  const owed=g?_goalOwedAmt(g,famId):0;
  const fundBal=Math.round(famFundBal(famId));
  const fundLine=document.getElementById('goalDepFundLine');
  const fundText=document.getElementById('goalDepFundText');
  if(fundLine&&fundText){
    if(fundBal>0){
      const suggested=owed>0?Math.min(fundBal,owed):fundBal;
      const extra=fundBal>suggested?` (יתרה: ₪${fundBal.toLocaleString()})`:'';
      fundText.textContent=`🏦 יועבר מהארנק: ₪${suggested.toLocaleString()}${extra}`;
      fundLine.style.display='flex';
    }else{
      fundLine.style.display='none';
    }
  }
}
// Pre-fills the deposit amount from the family's own wallet balance and
// marks this deposit as wallet-sourced — mirrors useFundForCumPot() for
// event pots. Suggests only what the family still owes toward its equal
// share (g.target split evenly among _goalPayers), capped at the wallet
// balance — not the full balance regardless of what's actually owed, which
// would silently drain the wallet by more than the family needs to give.
// The amount can still be edited afterward; confirmGoalDeposit() re-
// validates against the live balance either way.
function useFundForGoalDeposit(){
  if(_goalDepositFamId==null)return;
  const fundBal=Math.round(famFundBal(_goalDepositFamId));
  if(fundBal<=0)return;
  const g=goalFunds.find(x=>x.id===_goalDepositGoalId);
  const owed=g?_goalOwedAmt(g,_goalDepositFamId):0;
  const suggested=owed>0?Math.min(fundBal,owed):fundBal;
  const el=document.getElementById('goalDepositAmt');
  if(el)el.value=suggested;
  _goalDepositFromFund=true;
  const fundText=document.getElementById('goalDepFundText');
  if(fundText)fundText.textContent=`🏦 יועבר מהארנק: ₪${suggested.toLocaleString()} ✓`;
}
function closeGoalDepositSheet(){
  document.getElementById('goalDepositOverlay').style.display='none';
  _goalDepositGoalId=null;_goalDepositFamId=null;_goalDepositFromFund=false;
}
function confirmGoalDeposit(){
  if(_goalDepositGoalId==null){ return; }
  if(_goalDepositFamId==null){ alert('נא לבחור משפחה'); return; }
  const amt=parseFloat(document.getElementById('goalDepositAmt')?.value)||0;
  if(amt<=0){ alert('נא להזין סכום'); return; }
  const g=goalFunds.find(x=>x.id===_goalDepositGoalId);if(!g)return;
  const depName=(getFam(_goalDepositFamId)||{}).name?.replace('משפחת','').trim()||'';
  if(_goalDepositFromFund){
    const key=String(_goalDepositFamId);
    const bal=fund.famBalances[key]||0;
    if(bal<amt){alert('אין מספיק יתרה בארנק (₪'+Math.round(bal).toLocaleString()+')');return;}
    fund.famBalances[key]=bal-amt;
    fund.transactions.push({id:nxtTx++,type:'payout',famId:_goalDepositFamId,amount:amt,
      desc:'העברה לקופת מטרה · '+g.name+' → '+depName,
      date:new Date().toLocaleDateString('he-IL')});
  }
  g.contributions[_goalDepositFamId]=(g.contributions[_goalDepositFamId]||0)+amt;
  // Same "notify + direct email" pairing confirmDeposit() already uses for
  // plain wallet deposits — the notification center/bell entry (and any
  // opted-in "email instead of push" family for the 'deposit' category)
  // gets the gift's own details baked into the text, on top of the direct
  // confirmation email sendGoalDepositEmail always sends the depositor.
  const giftInfo=g.gift?(' — מתנה: '+g.gift+(g.recipient?' עבור '+g.recipient:'')):'';
  const walletNote=_goalDepositFromFund?' (מהארנק)':'';
  addNotif('🎯',depName+' הפקיד/ה ₪'+Math.round(amt).toLocaleString()+' לקופת "'+g.name+'"'+walletNote+giftInfo,undefined,g.hiddenFrom,'deposit',[_goalDepositFamId]);
  sendGoalDepositEmail(_goalDepositFamId,amt,g,_goalDepositFromFund);
  closeGoalDepositSheet();
  save();render();
}
function toggleGoalClosed(goalId){
  const g=goalFunds.find(x=>x.id===goalId);if(!g)return;
  g.closed=!g.closed;
  save();render();
  if(_goalPayGoalId===goalId)renderGoalPayModal();
}
function delGoalFund(goalId){
  if(!confirm('למחוק את הקופה? כל ההפקדות יימחקו'))return;
  goalFunds=goalFunds.filter(g=>g.id!==goalId);
  if(_goalPayGoalId===goalId)closeGoalPayModal();
  save();render();
}
function archiveGoalFund(goalId){
  const g=goalFunds.find(x=>x.id===goalId);if(!g)return;
  g.archived=true;
  if(_goalPayGoalId===goalId)closeGoalPayModal();
  save();render();
  goTab('archive',null);
}
function reopenGoalFund(goalId){
  const g=goalFunds.find(x=>x.id===goalId);if(!g)return;
  g.archived=false;expandedArchGoals.delete(goalId);
  save();render();
  openFundDetail();
}
function toggleArchGoalExp(goalId){
  if(expandedArchGoals.has(goalId))expandedArchGoals.delete(goalId);else expandedArchGoals.add(goalId);
  renderArchive();
}
function renderGoalFunds(){
  const el=document.getElementById('goalFundsList');
  if(!el)return;
  const activeGoals=_visibleGoalFunds(goalFunds.filter(g=>!g.archived));
  if(!activeGoals.length){
    el.innerHTML=`<div class="empty" style="padding:30px 20px"><span class="empty-ico">🎯</span>אין קופות למטרה<br><span style="font-size:12px">לדוגמה: קופה למתנה לסבא</span></div>`;
    return;
  }
  el.innerHTML=activeGoals.map(g=>{
    const total=goalTotal(g);
    const dispTarget=_goalDisplayTarget(g);
    const pct=dispTarget>0?Math.min(100,Math.round(total/dispTarget*100)):0;
    const reached=dispTarget>0&&total>=dispTarget;
    const remaining=dispTarget>0?Math.max(0,Math.round(dispTarget-total)):0;
    const subText=dispTarget>0?`נאסף ₪${total.toLocaleString()} מתוך ₪${dispTarget.toLocaleString()} · ${pct}%`:`נאסף ₪${total.toLocaleString()}`;
    const giftLine=[g.gift,g.recipient?'עבור '+g.recipient:null].filter(Boolean).join(' · ');
    // Small summary row (same shape as the home page's event/goal rows) —
    // the full "who paid" breakdown and the admin menu used to sit always
    // open on this card; they now live inside openGoalPayModal, opened by
    // tapping the row, so the funds list itself stays scannable.
    return`<div class="fund-settle-card" id="gfund-${g.id}" style="margin-bottom:10px;${g.closed?'opacity:.6':''}">
      <div class="home-row home-row-col" onclick="openGoalPayModal(${g.id})">
        <div class="home-goal-top">
          <div class="home-row-icon" style="background:var(--amber-bg);color:var(--amber)">🎯</div>
          <div class="home-row-body">
            <div class="home-row-title">${esc(g.name)}</div>
            ${giftLine?`<div class="home-row-sub">🎁 ${esc(giftLine)}</div>`:''}
            <div class="home-row-sub">${subText}</div>
          </div>
          ${g.transferred?'<span class="badge badge-green">✅ הועבר</span>':g.boughtBy?'<span class="badge badge-amber">🛍️ נקנה</span>':reached?'<span class="badge badge-green">✅ הושלם</span>':g.closed?'<span class="badge badge-gray">סגור</span>':remaining>0?`<span class="badge badge-amber">חוב ₪${remaining.toLocaleString()}</span>`:''}
        </div>
        ${dispTarget>0?`<div class="pbar" style="margin-top:10px"><div class="pfill ${reached?'full':'part'}" style="width:${pct}%"></div></div>`:''}
      </div>
    </div>`;
  }).join('');
}

// Quick "who paid" checklist for a goal fund — clicking a family toggles
// their contribution between 0 and their equal share (perFamily), instead
// of typing an amount every time. The manual "↓ הפקדה" sheet still exists
// for custom/partial amounts; this is the fast path for the common case.
let _goalPayGoalId=null;
let _goalBoughtPickerOpen=false;
function openGoalPayModal(goalId){
  _goalPayGoalId=goalId;
  _goalBoughtPickerOpen=false;
  renderGoalPayModal();
  document.getElementById('goalPayModal').style.display='flex';
}
function closeGoalPayModal(){
  document.getElementById('goalPayModal').style.display='none';
  _goalPayGoalId=null;
}
function renderGoalPayModal(){
  const g=goalFunds.find(x=>x.id===_goalPayGoalId);if(!g)return;
  const titleEl=document.getElementById('goalPayTitle');
  if(titleEl)titleEl.textContent='🎯 מי שילם? — '+g.name;
  const eligible=_goalPayers(g);
  const perFamily=g.target>0&&eligible.length?Math.ceil(g.target/eligible.length):0;
  const total=goalTotal(g);
  const dispTarget=_goalDisplayTarget(g);
  const progEl=document.getElementById('goalPayProgress');
  if(progEl){
    const pct=dispTarget>0?Math.min(100,Math.round(total/dispTarget*100)):0;
    progEl.innerHTML=`<div style="font-size:11px;color:var(--text2);margin-bottom:3px">נאסף עד כה</div>
      <div style="font-size:24px;font-weight:800;color:var(--text);letter-spacing:-0.5px">₪${total.toLocaleString()}${dispTarget>0?` <span style="font-size:13px;font-weight:600;color:var(--text2)">מתוך ₪${dispTarget.toLocaleString()}</span>`:''}</div>
      ${dispTarget>0?`<div class="pbar" style="margin:8px 0 2px"><div class="pfill ${pct>=100?'full':'part'}" style="width:${pct}%"></div></div><div style="font-size:11px;color:var(--text2)">${pct}%</div>`:''}`;
  }
  const giftEl=document.getElementById('goalPayGiftInfo');
  if(giftEl)giftEl.innerHTML=_goalGiftInfoHtml(g);
  const noteEl=document.getElementById('goalPayNote');
  if(noteEl)noteEl.textContent=perFamily>0?'חלוקה שווה: ₪'+perFamily.toLocaleString()+' למשפחה':'לא הוגדר סכום מטרה לקופה הזו — אין לפי מה לחשב חלק שווה';
  // A family that already bought the gift is excluded from this list (they
  // owe nothing — see _goalOwedAmt), but NOT from `eligible` itself, so
  // perFamily above still reflects the original full split.
  document.getElementById('goalPayList').innerHTML=eligible.filter(f=>f.id!==g.boughtBy).map(f=>{
    const paid=perFamily>0&&(g.contributions[f.id]||0)>=perFamily;
    const name=f.name.replace('משפחת','').trim();
    // The treasurer can front an unpaid family's share so the fund reaches
    // its target (and can be paid out to the gift-buyer) without waiting
    // for everyone to actually pay — same "advance, track as deficit"
    // mechanism as markTransferFromTreasurer for events.
    const treasurerBtn=!paid?`<button onclick="event.stopPropagation();markGoalContribFromTreasurer(${g.id},${f.id})" title="הגזבר משלם עבור ${esc(name)}" style="border:1px solid var(--amber);border-radius:8px;background:none;color:var(--amber);font-size:11px;font-weight:700;font-family:var(--font);cursor:pointer;padding:3px 7px;flex-shrink:0">💼</button>`:'';
    // A family shown ✅ here may only be "paid" because the treasurer
    // fronted their share (markGoalContribFromTreasurer) — their
    // contribution is credited immediately so the fund total is real money
    // that can be paid out to the buyer, but THEY still owe that amount
    // back to the treasurer, not the fund. Flag it here too, not only in
    // the separate "מגיע לגזבר" modal, so it isn't mistaken for a real
    // payment (mirrors the event card's own treasurerOwedLine).
    const tOwed=goalTreasurerOwed(g,f.id);
    const treasurerOwedLine=tOwed>0.5?`<div class="edit-only" style="font-size:11px;color:var(--amber);margin-top:2px;display:flex;align-items:center;gap:6px">💼 הגזבר שילם על חשבונכם — טרם הוחזר<button onclick="event.stopPropagation();markGoalTreasurerRepaid(${g.id},${f.id})" style="border:1px solid var(--amber);border-radius:10px;background:none;color:var(--amber);font-size:10px;font-weight:700;font-family:var(--font);cursor:pointer;padding:1px 7px">✓ הוחזר</button></div>`:'';
    const viewTreasurerOwedLine=tOwed>0.5?`<div class="view-only" style="font-size:11px;color:var(--amber);margin-top:2px">💼 הגזבר שילם על חשבונכם — טרם הוחזר</div>`:'';
    return`<div class="edit-only" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--r2);border:1.5px solid ${paid?'var(--green-mid)':'var(--border)'};margin-bottom:6px;box-sizing:border-box;background:${paid?'var(--green-bg)':'transparent'}">
      <div onclick="toggleGoalPaid(${f.id})" style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;cursor:pointer">
        <span style="font-size:18px;flex-shrink:0">${paid?'✅':'⬜'}</span>
        ${famAva(f, 32, 'flex-shrink:0')}
        <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:700">${esc(name)}</div>${treasurerOwedLine}</div>
      </div>
      ${treasurerBtn}
      <div style="font-size:13px;font-weight:700;color:${paid?'var(--green-mid)':'var(--text2)'}">₪${perFamily.toLocaleString()}</div>
    </div>
    <div class="view-only" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--r2);border:1.5px solid ${paid?'var(--green-mid)':'var(--border)'};margin-bottom:6px;box-sizing:border-box;background:${paid?'var(--green-bg)':'transparent'}">
      <span style="font-size:18px;flex-shrink:0">${paid?'✅':'⬜'}</span>
      ${famAva(f, 32, 'flex-shrink:0')}
      <div style="flex:1"><div style="font-size:13px;font-weight:700">${esc(name)}</div>${viewTreasurerOwedLine}</div>
      <div style="font-size:13px;font-weight:700;color:${paid?'var(--green-mid)':'var(--text2)'}">₪${perFamily.toLocaleString()}</div>
    </div>`;
  }).join('');
  // Real (possibly custom/partial) deposit amounts — visible to everyone,
  // like the checklist above, unlike the admin-only menu below.
  const contribEl=document.getElementById('goalPayContrib');
  if(contribEl){
    const contributors=families.filter(f=>(g.contributions[f.id]||0)>0);
    contribEl.innerHTML=contributors.length?`<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:7px">💳 הפקדות בפועל</div>
      ${contributors.map(f=>{
        const c=g.contributions[f.id]||0;
        return`<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
          ${famAva(f, 24, 'flex-shrink:0')}
          <div style="flex:1;font-size:12px;font-weight:600">${esc(f.name.replace('משפחת','').trim())}</div>
          <div style="font-size:12px;font-weight:700;color:var(--green-mid)">₪${c.toLocaleString()}</div>
        </div>`;
      }).join('')}
    </div>`:'';
  }
  // "Already bought it" — lets the admin record which family fronted the
  // actual purchase (outside the app) so the fund's collected money can be
  // paid out to them afterward, instead of the fund just sitting there once
  // its purpose is done. Separate from the regular per-family deposit flow:
  // this pays money OUT to one family, not in from one.
  const boughtF=g.boughtBy?getFam(g.boughtBy):null;
  const boughtName=boughtF?boughtF.name.replace('משפחת','').trim():'';
  const totalNow=Math.round(goalTotal(g));
  const boughtSection=g.transferred?
    `<div class="edit-only" style="display:flex;align-items:center;gap:8px;background:var(--green-bg);border-radius:var(--r2);padding:10px 12px;margin-bottom:8px">
      <span style="font-size:16px">✅</span>
      <div style="flex:1;font-size:12px;font-weight:700;color:var(--green-mid)">הועברו ₪${Math.round(g.transferredAmt||0).toLocaleString()} ל${esc(boughtName)}</div>
    </div>`
    :(_goalBoughtPickerOpen&&!g.boughtBy)?
    `<div class="edit-only" style="margin-bottom:8px">
      <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:6px">מי קנה את המתנה?</div>
      ${families.map(f=>`<div onclick="markGoalBought(${f.id})" style="display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:var(--r2);border:1.5px solid var(--border);margin-bottom:5px;cursor:pointer;box-sizing:border-box">${famAva(f,28,'flex-shrink:0')}<div style="flex:1;font-size:13px;font-weight:700">${esc(f.name.replace('משפחת','').trim())}</div></div>`).join('')}
      <button onclick="closeGoalBoughtPicker()" style="width:100%;padding:8px;border-radius:var(--r2);border:1px solid var(--border);background:transparent;color:var(--text2);font-size:12px;font-weight:700;font-family:var(--font);cursor:pointer">ביטול</button>
    </div>`
    :g.boughtBy?
    `<div class="edit-only" style="margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:8px;background:var(--amber-bg);border-radius:var(--r2);padding:10px 12px;margin-bottom:6px">
        <span style="font-size:16px">🛍️</span>
        <div style="flex:1;font-size:12px;font-weight:700;color:var(--amber)">המתנה נקנתה ע"י ${esc(boughtName)}</div>
        <button onclick="unmarkGoalBought()" style="border:none;background:none;color:var(--text3);cursor:pointer;font-size:13px;padding:0 4px">✕</button>
      </div>
      ${totalNow>0?`<button onclick="confirmGoalPayout()" style="width:100%;padding:11px;border-radius:var(--r2);border:none;background:var(--amber);color:#fff;font-size:14px;font-weight:700;font-family:var(--font);cursor:pointer">💰 העבירו ₪${totalNow.toLocaleString()} ל${esc(boughtName)}</button>`:''}
    </div>`
    :`<button class="edit-only" onclick="openGoalBoughtPicker()" style="width:100%;padding:10px;border-radius:var(--r2);border:1.5px dashed var(--amber);background:transparent;color:var(--amber);font-size:13px;font-weight:700;font-family:var(--font);cursor:pointer;margin-bottom:8px">🛍️ סמנו שהמתנה כבר נקנתה</button>`;
  // Admin menu — used to sit always-open on the funds-list card; now it
  // only renders once this specific fund's modal is open.
  const menuEl=document.getElementById('goalPayMenu');
  if(menuEl){
    menuEl.innerHTML=(!g.closed?`<button onclick="openGoalDepositSheet(${g.id})" style="width:100%;padding:11px;border-radius:var(--r2);border:none;background:var(--blue-mid);color:#fff;font-size:14px;font-weight:700;font-family:var(--font);cursor:pointer;margin-bottom:8px">↓ הפקדה</button>`:'')+
      boughtSection+
      `<div class="card-actions" style="margin:0">
        <button class="action-btn" onclick="openGoalPayersModal(${g.id})">👥 השתתפות</button>
        <button class="action-btn" onclick="toggleGoalClosed(${g.id})">${g.closed?'↩️ פתח מחדש':'✓ סגור קופה'}</button>
        <button class="action-btn blue" onclick="archiveGoalFund(${g.id})">🗂 לארכיון</button>
        <button class="action-btn red" onclick="delGoalFund(${g.id})">🗑 מחק</button>
      </div>`;
  }
}
function toggleGoalPaid(famId){
  if(!editMode)return;
  const g=goalFunds.find(x=>x.id===_goalPayGoalId);if(!g)return;
  const eligible=_goalPayers(g);
  const perFamily=g.target>0&&eligible.length?Math.ceil(g.target/eligible.length):0;
  if(perFamily<=0)return;
  const prevAmt=g.contributions[famId]||0;
  const paid=prevAmt>=perFamily;
  g.contributions[famId]=paid?0:perFamily;
  save();render();
  renderGoalPayModal();
  if(!paid){
    // Just marked as paid (not un-marking) — treated exactly like a regular
    // manual deposit of the delta (same notify+email pairing
    // confirmGoalDeposit uses), never leaking that this fund exists to
    // anyone it's deliberately hidden from (e.g. a surprise-gift
    // collection).
    const addedAmt=perFamily-prevAmt;
    const f=getFam(famId);
    const name=f?f.name.replace('משפחת','').trim():'';
    const giftInfo=g.gift?(' — מתנה: '+g.gift+(g.recipient?' עבור '+g.recipient:'')):'';
    addNotif('🎯',name+' סומן/ה כמי ששילם/ה עבור "'+g.name+'"'+giftInfo,undefined,g.hiddenFrom,'deposit',[famId]);
    sendGoalDepositEmail(famId,addedAmt,g,false);
  }
}
function openGoalBoughtPicker(){
  if(!editMode)return;
  _goalBoughtPickerOpen=true;
  renderGoalPayModal();
}
function closeGoalBoughtPicker(){
  _goalBoughtPickerOpen=false;
  renderGoalPayModal();
}
function markGoalBought(famId){
  if(!editMode)return;
  const g=goalFunds.find(x=>x.id===_goalPayGoalId);if(!g)return;
  g.boughtBy=famId;
  // Deliberately NOT added to g.nonPayers — everyone else's equal share
  // must stay exactly what it was (see _goalOwedAmt/renderGoalPayModal),
  // not get recalculated over a smaller payer pool.
  _goalBoughtPickerOpen=false;
  save();render();
  renderGoalPayModal();
}
function unmarkGoalBought(){
  if(!editMode)return;
  const g=goalFunds.find(x=>x.id===_goalPayGoalId);if(!g||g.transferred)return;
  delete g.boughtBy;
  save();render();
  renderGoalPayModal();
}
// Pays the fund's entire collected balance out to whichever family already
// bought the gift (outside the app) — the reverse of a normal deposit:
// money leaves the fund and lands in their wallet, once, tracked by
// g.transferred so it can't be paid out twice.
function confirmGoalPayout(){
  if(!editMode)return;
  const g=goalFunds.find(x=>x.id===_goalPayGoalId);if(!g||!g.boughtBy||g.transferred)return;
  const amt=Math.round(goalTotal(g));
  if(amt<=0){alert('אין כסף בקופה להעברה');return;}
  const f=getFam(g.boughtBy);if(!f)return;
  const name=f.name.replace('משפחת','').trim();
  if(!confirm('להעביר ₪'+amt.toLocaleString()+' מ"'+g.name+'" לארנק של '+name+'?'))return;
  const key=String(g.boughtBy);
  fund.famBalances[key]=(fund.famBalances[key]||0)+amt;
  fund.transactions.push({id:nxtTx++,type:'deposit',famId:g.boughtBy,amount:amt,
    desc:'מקופת מטרה "'+g.name+'"'+(g.gift?' — עבור '+g.gift:''),
    date:new Date().toLocaleDateString('he-IL')});
  g.transferred=true;
  g.transferredAmt=amt;
  addNotif('💰',name+' קיבל/ה ₪'+amt.toLocaleString()+' לארנק מקופת "'+g.name+'"',undefined,g.hiddenFrom,'deposit',[g.boughtBy]);
  sendGoalPayoutEmail(g.boughtBy,amt,g);
  save();render();
  renderGoalPayModal();
}
// How much of THIS family's contribution to THIS goal fund the treasurer
// fronted and is still outstanding — mirrors evTreasurerOwed's own
// running-total pattern (a log of 'treasurer'/'treasurer-repay' entries)
// so the same "itemized debts to the treasurer" view can read both.
function goalTreasurerOwed(g,famId){
  let owed=0;
  (g.treasurerLog||[]).forEach(e=>{
    if(e.famId!==famId)return;
    if(e.method==='treasurer')owed+=e.amt;
    else if(e.method==='treasurer-repay')owed-=e.amt;
  });
  return Math.max(0,owed);
}
// The treasurer personally covers a family's still-unpaid share so the fund
// can be paid out to the gift-buyer without waiting for every family to
// actually pay — the goal-fund equivalent of markTransferFromTreasurer for
// events. The family's contribution is credited immediately (as if they'd
// paid), nothing is drawn from any wallet, and fund.deficit tracks the
// advance the same way an event-side treasurer front does.
function markGoalContribFromTreasurer(goalId,famId){
  if(!editMode)return;
  const g=goalFunds.find(x=>x.id===goalId);if(!g)return;
  const owed=_goalOwedAmt(g,famId);
  if(owed<=0)return;
  const f=getFam(famId);if(!f)return;
  const name=f.name.replace('משפחת','').trim();
  if(!confirm('הגזבר ישלם ₪'+owed.toLocaleString()+' עבור '+name+' בקופת "'+g.name+'"?'))return;
  g.contributions[famId]=(g.contributions[famId]||0)+owed;
  if(!g.treasurerLog)g.treasurerLog=[];
  g.treasurerLog.push({famId,amt:owed,method:'treasurer',date:new Date().toLocaleDateString('he-IL')});
  fund.deficit=(fund.deficit||0)+owed;
  addNotif('💼',name+' — הגזבר שילם ₪'+owed.toLocaleString()+' עבורה בקופת "'+g.name+'" (מקדמה, טרם הוחזר)',undefined,g.hiddenFrom,'deposit',[famId]);
  save();render();
  renderGoalPayModal();
}
// The family actually pays the treasurer back for a goal-fund advance —
// same idea as markTreasurerRepaid for events, just against g.treasurerLog
// instead of ev.settled.
function markGoalTreasurerRepaid(goalId,famId){
  if(!editMode)return;
  const g=goalFunds.find(x=>x.id===goalId);if(!g)return;
  const owed=goalTreasurerOwed(g,famId);
  if(owed<=0)return;
  const f=getFam(famId);if(!f)return;
  const name=f.name.replace('משפחת','').trim();
  if(!confirm(name+' החזירה לגזבר ₪'+owed.toLocaleString()+' עבור קופת "'+g.name+'"?'))return;
  if(!g.treasurerLog)g.treasurerLog=[];
  g.treasurerLog.push({famId,amt:owed,method:'treasurer-repay',date:new Date().toLocaleDateString('he-IL')});
  fund.deficit=Math.max(0,(fund.deficit||0)-owed);
  fund.transactions.push({id:nxtTx++,type:'payout',famId:null,amount:owed,
    desc:name+' החזירה לגזבר עבור קופת מטרה "'+g.name+'"',
    date:new Date().toLocaleDateString('he-IL')});
  save();render();
  _refreshTreasurerDeficitModalIfOpen();
}
// Popup for picking which families are exempt from paying their share of
// this goal fund while still seeing it normally — separate from
// hiddenFrom, which hides the fund's existence entirely (a surprise gift).
// Only offers families who can see the fund in the first place.
let _goalPayersGoalId=null;
function openGoalPayersModal(goalId){
  if(!editMode)return;
  _goalPayersGoalId=goalId;
  renderGoalPayersModal();
  document.getElementById('goalPayersModal').style.display='flex';
}
function closeGoalPayersModal(){
  document.getElementById('goalPayersModal').style.display='none';
  _goalPayersGoalId=null;
}
function renderGoalPayersModal(){
  const g=goalFunds.find(x=>x.id===_goalPayersGoalId);if(!g)return;
  const titleEl=document.getElementById('goalPayersTitle');
  if(titleEl)titleEl.textContent='👥 השתתפות בתשלום — '+g.name;
  const visible=families.filter(f=>!(g.hiddenFrom||[]).includes(f.id));
  document.getElementById('goalPayersList').innerHTML=visible.map(f=>{
    const excluded=(g.nonPayers||[]).includes(f.id);
    return`<div onclick="toggleGoalNonPayer(${f.id})" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--r2);border:1.5px solid ${excluded?'var(--border)':'var(--green-mid)'};margin-bottom:6px;cursor:pointer;box-sizing:border-box;background:${excluded?'transparent':'var(--green-bg)'}">
      ${famAva(f, 32, 'flex-shrink:0')}
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700">${esc(f.name.replace('משפחת','').trim())}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:1px">${excluded?'לא משתתף/ת בתשלום — עדיין רואה את הקופה':'משתתף/ת בתשלום'}</div>
      </div>
      <span style="font-size:18px;flex-shrink:0">${excluded?'🚫':'✅'}</span>
    </div>`;
  }).join('');
}
function toggleGoalNonPayer(famId){
  if(!editMode)return;
  const g=goalFunds.find(x=>x.id===_goalPayersGoalId);if(!g)return;
  g.nonPayers=g.nonPayers||[];
  const idx=g.nonPayers.indexOf(famId);
  if(idx>=0)g.nonPayers.splice(idx,1);else g.nonPayers.push(famId);
  save();render();
  renderGoalPayersModal();
}
// Opens a per-EMAIL-ADDRESS picker (not per-family — a family with two
// saved addresses gets two separate rows) for everyone who still owes
// toward this goal fund. Skips families hidden from it (g.hiddenFrom,
// e.g. a surprise-gift collection) and anyone who's already paid their
// equal share, same eligibility/split logic as the "who paid" checklist.
let _goalReminderGoalId=null;
function openGoalReminderModal(goalId){
  if(!editMode)return;
  const g=goalFunds.find(x=>x.id===goalId);if(!g)return;
  const eligible=_goalPayers(g);
  const perFamily=g.target>0&&eligible.length?Math.ceil(g.target/eligible.length):0;
  if(perFamily<=0){alert('לא הוגדר סכום מטרה לקופה הזו — אין לפי מה לחשב חלק שווה ולשלוח תזכורת.');return;}
  const unpaid=eligible.filter(f=>(f.email||f.email2)&&(g.contributions[f.id]||0)<perFamily);
  if(!unpaid.length){alert('כל מי שיש לו כתובת מייל כבר שילם, או שאין למי לשלוח.');return;}
  _goalReminderGoalId=goalId;
  const titleEl=document.getElementById('goalReminderTitle');
  if(titleEl)titleEl.textContent='📧 שלח תזכורת — '+g.name;
  const rows=[];
  unpaid.forEach(f=>{
    const name=f.name.replace('משפחת','').trim();
    if(_validEmail(f.email))rows.push({famId:f.id,email:f.email,name});
    if(_validEmail(f.email2))rows.push({famId:f.id,email:f.email2,name});
  });
  document.getElementById('goalReminderList').innerHTML=rows.map(r=>`
    <label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:var(--r2);border:1.5px solid var(--border);margin-bottom:6px;cursor:pointer;box-sizing:border-box">
      <input type="checkbox" class="goalReminderChk" data-fam="${r.famId}" data-email="${esc(r.email)}" checked onchange="_updateGoalReminderCount()" style="width:18px;height:18px;flex-shrink:0">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700">${esc(r.name)}</div>
        <div style="font-size:11px;color:var(--text2);direction:ltr;text-align:right">${esc(r.email)}</div>
      </div>
    </label>`).join('');
  _updateGoalReminderCount();
  document.getElementById('goalReminderModal').style.display='flex';
}
function closeGoalReminderModal(){
  document.getElementById('goalReminderModal').style.display='none';
  _goalReminderGoalId=null;
}
function toggleAllGoalReminders(checked){
  document.querySelectorAll('.goalReminderChk').forEach(cb=>cb.checked=checked);
  _updateGoalReminderCount();
}
function _updateGoalReminderCount(){
  const n=document.querySelectorAll('.goalReminderChk:checked').length;
  const el=document.getElementById('goalReminderCount');
  if(el)el.textContent=n+' נבחרו';
}
function sendSelectedGoalReminders(){
  const g=goalFunds.find(x=>x.id===_goalReminderGoalId);if(!g)return;
  const checked=[...document.querySelectorAll('.goalReminderChk:checked')];
  if(!checked.length){alert('לא נבחרו נמענים.');return;}
  const byFam=new Map();
  checked.forEach(cb=>{
    const fid=Number(cb.dataset.fam);
    if(!byFam.has(fid))byFam.set(fid,[]);
    byFam.get(fid).push(cb.dataset.email);
  });
  const eligible=_goalPayers(g);
  const perFamily=g.target>0&&eligible.length?Math.ceil(g.target/eligible.length):0;
  const famIds=[...byFam.keys()];
  closeGoalReminderModal();
  // sendEmailNotif staggers a single call's own email/email2 pair by
  // 600ms internally, but calling it back-to-back for every family here
  // would still fire ALL families' first address at once (and all their
  // second address 600ms later) — a burst EmailJS can silently throttle.
  // Space each family's own call out too, well past that internal 600ms,
  // so no two families' sends land in the same window.
  famIds.forEach((fid,idx)=>{
    setTimeout(()=>{
      const f=getFam(fid);if(!f)return;
      const selectedEmails=byFam.get(fid);
      const name=f.name.replace('משפחת','').trim();
      const paidSoFar=Math.round(g.contributions[fid]||0);
      const owe=Math.round(perFamily-paidSoFar);
      const giftLines=[g.recipient?'🎁 עבור: '+g.recipient:null,g.gift?'🎀 מתנה: '+g.gift:null,g.notes?'📝 '+g.notes:null].filter(Boolean);
      const msg=`תזכורת תשלום: ${g.name}\n\nסכום המטרה הכולל: ₪${g.target.toLocaleString()}\nהחלק שלך: ₪${perFamily.toLocaleString()}${paidSoFar>0?`\nשילמת עד כה: ₪${paidSoFar.toLocaleString()}`:''}${giftLines.length?'\n'+giftLines.join('\n'):''}\n\n⚠️ יתרה לתשלום: ₪${owe.toLocaleString()}`;
      const cardRows=[['סכום המטרה הכולל',`₪${g.target.toLocaleString()}`],['החלק שלך',`₪${perFamily.toLocaleString()}`,true]];
      if(paidSoFar>0)cardRows.push(['שילמת עד כה',`₪${paidSoFar.toLocaleString()}`]);
      if(g.recipient)cardRows.push(['🎁 עבור',_esc(g.recipient)]);
      if(g.gift)cardRows.push(['🎀 מתנה',_esc(g.gift)]);
      let bodyHtml=_eCard(cardRows);
      bodyHtml+=`<div style="text-align:center;margin-top:4px">${_eBadge('⚠️ יתרה לתשלום ₪'+owe.toLocaleString(),'#ef4444')}</div>`;
      if(g.notes)bodyHtml+=`<div style="margin-top:10px;padding:8px 12px;background:#F9FAFB;border-radius:8px;font-size:12px;color:#555">📝 ${_esc(g.notes)}</div>`;
      bodyHtml+=_paymentBlock(owe,g.name,null,null);
      const html=_emailWrap(bodyHtml,g.name,'🎯','',name);
      const recipient={name};
      if(selectedEmails.includes(f.email))recipient.email=f.email;
      if(selectedEmails.includes(f.email2))recipient.email2=f.email2;
      sendEmailNotif([recipient],`🎯 תזכורת תשלום: ${g.name} · ינקלביץ`,msg,html);
    },idx*1500);
  });
  showToast(`📧 שולח תזכורת ל-${famIds.length} משפחות...`);
}

let _depositFamId=null;
let _depositMode='deposit';
function openDepositSheet(mode){
  _depositFamId=null;
  _depositMode=mode||'deposit';
  const isDeposit=_depositMode==='deposit';
  const acc=isDeposit?'var(--blue-mid)':'var(--red-mid)';
  const titleEl=document.getElementById('depositTitle');
  if(titleEl) titleEl.textContent=isDeposit?'הפקדה לארנק':'משיכה מהארנק';
  document.getElementById('depositFields').innerHTML=`
    <input type="number" min="0" inputmode="numeric" id="depositAmt" placeholder="${isDeposit?'סכום להפקדה':'סכום למשיכה'} (₪)"
      style="width:100%;border:1.5px solid ${acc};border-radius:var(--r2);padding:12px;font-size:18px;font-family:var(--font);background:var(--bg);color:var(--text);direction:ltr;text-align:center;margin-bottom:14px;box-sizing:border-box">
    <textarea id="depositNote" rows="2" placeholder="הערה (אופציונלי — תופיע גם במייל שיישלח)"
      style="width:100%;border:1.5px solid var(--border);border-radius:var(--r2);padding:10px 12px;font-size:13px;font-family:var(--font);background:var(--bg);color:var(--text);margin-bottom:14px;box-sizing:border-box;resize:vertical"></textarea>
    <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px">${isDeposit?'מי מפקיד?':'מי מושך?'}</div>
    ${families.map(f=>{
      const cl=col(f.id);
      const bal=famFundBal(f.id);
      const balColor=bal>0?'var(--green-mid)':bal===0?'var(--text3)':'var(--red-mid)';
      const balText=bal>0?'₪'+bal.toLocaleString():bal===0?'₪0':'חוב ₪'+Math.abs(bal).toLocaleString();
      return`<div id="depfam-${f.id}" onclick="selectDepFam(${f.id})" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--r2);border:1.5px solid var(--border);margin-bottom:6px;cursor:pointer;box-sizing:border-box">
        ${famAva(f, 32, 'flex-shrink:0')}
        <div style="flex:1">
          <div style="font-size:13px;font-weight:700">${esc(f.name.replace('משפחת','').trim())}</div>
          <div style="font-size:11px;color:${balColor};margin-top:1px">יתרה: ${balText}</div>
        </div>
      </div>`;
    }).join('')}
  `;
  const btn=document.querySelector('#depositSheet .fund-dep-btn');
  if(btn){
    btn.textContent=isDeposit?'✓ אשר הפקדה':'✓ אשר משיכה';
    btn.style.background=acc;
  }
  document.getElementById('depositOverlay').style.display='flex';
  setTimeout(()=>{ const el=document.getElementById('depositAmt'); if(el)el.focus(); },100);
}
function selectDepFam(famId){
  _depositFamId=famId;
  const isDeposit=_depositMode==='deposit';
  const acc=isDeposit?'var(--blue-mid)':'var(--red-mid)';
  const accBg=isDeposit?'var(--blue-bg)':'var(--red-bg)';
  families.forEach(f=>{
    const el=document.getElementById('depfam-'+f.id);
    if(el){
      const sel=f.id===famId;
      el.style.borderColor=sel?acc:'var(--border)';
      el.style.background=sel?accBg:'transparent';
    }
  });
}
function closeDepositSheet(){
  document.getElementById('depositOverlay').style.display='none';
  _depositFamId=null;
}
function confirmDeposit(){
  if(!_depositFamId){ alert('נא לבחור משפחה'); return; }
  const amt=parseFloat(document.getElementById('depositAmt')?.value)||0;
  if(amt<=0){ alert('נא להזין סכום'); return; }
  const note=(document.getElementById('depositNote')?.value||'').trim();
  const f=getFam(_depositFamId);
  const key=String(_depositFamId);
  const name=f.name.replace('משפחת','').trim();
  if(!fund.famBalances) fund.famBalances={};
  const isDeposit=_depositMode==='deposit';
  if(!isDeposit){
    const bal=fund.famBalances[key]||0;
    if(amt>bal){ alert('לא ניתן למשוך יותר מהיתרה (₪'+bal.toLocaleString()+')'); return; }
  }
  const delta=isDeposit?amt:-amt;
  fund.famBalances[key]=(fund.famBalances[key]||0)+delta;
  fund.transactions.push({id:nxtTx++,
    type:isDeposit?'deposit':'withdraw',
    famId:_depositFamId,amount:amt,
    desc:isDeposit?name+' הפקיד לארנק':name+' משך מהארנק',
    note:note||undefined,
    date:new Date().toLocaleDateString('he-IL')});
  const _notifyFamId=_depositFamId;
  closeDepositSheet();
  save();render();
  addNotif(isDeposit?'💰':'💸',name+(isDeposit?' הפקיד/ה ₪':' משך/ה ₪')+amt.toLocaleString()+(isDeposit?' לארנק':' מהארנק'),undefined,undefined,'deposit',[_notifyFamId]);
  sendFundUpdateEmail(_notifyFamId,amt,isDeposit?'הפקדה לארנק':'משיכה מהארנק',note);
}



function openAddExpItem(evId){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  addExpItemEvId=evId; addExpItemFamId=null;
  addExpItemSharedWith=new Set(ev.participants);
  addExpItemSplitMode='equal'; addExpItemMethod='equal'; _editExpItemId=null; addExpItemFromPot=false;
  const payMultiInps=document.getElementById('expItemPayMultiInputs');
  if(payMultiInps){
    payMultiInps.innerHTML=ev.participants.map(fid=>{
      const f=getFam(fid);if(!f)return'';
      return`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        ${famAva(f,30,'flex-shrink:0')}
        <span style="flex:1;font-size:13px;font-weight:600">${esc(f.name.replace('משפחת','').trim())}</span>
        <input type="number" min="0" inputmode="numeric" placeholder="0" id="payamt-${fid}" oninput="_updateExpItemPayTotal()" style="width:72px;border:1.5px solid var(--border);border-radius:var(--r2);padding:7px 8px;font-size:14px;font-family:var(--font);background:var(--bg);color:var(--text);text-align:center;direction:ltr;box-sizing:border-box">
      </div>`;
    }).join('');
  }
  setExpItemPayMode('single');
  const potWrap=document.getElementById('expFromPotToggleWrap');
  if(potWrap)potWrap.style.display=evPotTotal(ev)>0?'block':'none';
  const potBtn=document.getElementById('expFromPotToggle');
  if(potBtn){potBtn.style.background='transparent';potBtn.style.color='var(--text2)';potBtn.style.borderColor='var(--border)';}
  const famSec=document.getElementById('expItemFamSection');if(famSec)famSec.style.display='block';
  const splitSec=document.getElementById('expItemSplitSection');if(splitSec)splitSec.style.display='block';
  const titleEl=document.getElementById('addExpItemTitle');
  if(titleEl)titleEl.textContent='➕ הוסף הוצאה';
  document.getElementById('expItemName').value='';
  document.getElementById('expItemAmt').value='';
  const errEl=document.getElementById('expItemErr');if(errEl)errEl.style.display='none';
  const picker=document.getElementById('expItemFamPicker');
  picker.innerHTML=ev.participants.map(fid=>{
    const f=getFam(fid);if(!f)return'';
    return`<button onclick="selectAddExpFam(${fid})" id="expfam-${fid}" style="padding:5px 12px;border-radius:20px;border:1.5px solid var(--border);background:transparent;color:var(--text2);font-size:13px;font-weight:600;font-family:var(--font);cursor:pointer">${esc(f.name.replace('משפחת','').trim())}</button>`;
  }).join('');
  const sharePicker=document.getElementById('expItemSharePicker');
  sharePicker.innerHTML=ev.participants.map(fid=>{
    const f=getFam(fid);if(!f)return'';
    return`<button onclick="toggleExpShareFam(${fid})" id="expshare-${fid}" style="padding:5px 12px;border-radius:20px;border:1.5px solid var(--blue-mid);background:var(--blue-bg);color:var(--blue);font-size:13px;font-weight:600;font-family:var(--font);cursor:pointer">${esc(f.name.replace('משפחת','').trim())}</button>`;
  }).join('');
  const custInps=document.getElementById('expItemCustomInputs');
  if(custInps){
    custInps.innerHTML=ev.participants.map(fid=>{
      const f=getFam(fid);if(!f)return'';
      return`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        ${famAva(f,30,'flex-shrink:0')}
        <span style="flex:1;font-size:13px;font-weight:600">${esc(f.name.replace('משפחת','').trim())}</span>
        <input type="number" min="0" inputmode="numeric" placeholder="0" id="csplit-${fid}" oninput="_updateExpItemCustomTotal()" style="width:72px;border:1.5px solid var(--border);border-radius:var(--r2);padding:7px 8px;font-size:14px;font-family:var(--font);background:var(--bg);color:var(--text);text-align:center;direction:ltr;box-sizing:border-box">
      </div>`;
    }).join('');
  }
  setExpItemMethod('equal');
  _updateExpItemCustomTotal();
  document.getElementById('addExpItemOverlay').style.display='flex';
}
function toggleExpShareFam(famId){
  if(addExpItemSharedWith.has(famId))addExpItemSharedWith.delete(famId);
  else addExpItemSharedWith.add(famId);
  const btn=document.getElementById('expshare-'+famId);if(!btn)return;
  if(addExpItemSharedWith.has(famId)){btn.style.background='var(--blue-bg)';btn.style.color='var(--blue)';btn.style.borderColor='var(--blue-mid)';}
  else{btn.style.background='transparent';btn.style.color='var(--text2)';btn.style.borderColor='var(--border)';}
}
function selectAddExpFam(famId){
  addExpItemFamId=famId;
  const ev=events.find(e=>e.id===addExpItemEvId);if(!ev)return;
  ev.participants.forEach(fid=>{
    const btn=document.getElementById('expfam-'+fid);if(!btn)return;
    const cl=col(fid);
    if(fid===famId){btn.style.background=cl.bg;btn.style.color=cl.c;btn.style.borderColor=cl.c;}
    else{btn.style.background='transparent';btn.style.color='var(--text2)';btn.style.borderColor='var(--border)';}
  });
}
function toggleExpFromPot(){
  addExpItemFromPot=!addExpItemFromPot;
  const btn=document.getElementById('expFromPotToggle');
  const famSec=document.getElementById('expItemFamSection');
  const splitSec=document.getElementById('expItemSplitSection');
  const shareWrap=document.getElementById('expItemSharePickerWrap');
  if(btn){btn.style.background=addExpItemFromPot?'var(--amber-mid)':'transparent';btn.style.color=addExpItemFromPot?'#fff':'var(--text2)';btn.style.borderColor=addExpItemFromPot?'var(--amber-mid)':'var(--border)';}
  if(famSec)famSec.style.display=addExpItemFromPot?'none':'block';
  if(splitSec)splitSec.style.display=addExpItemFromPot?'none':'block';
  if(shareWrap)shareWrap.style.display=addExpItemFromPot?'none':'block';
  if(addExpItemFromPot){
    document.getElementById('expItemSplitEqualDiv').style.display='block';
    document.getElementById('expItemSplitCustomDiv').style.display='none';
  }
}
function closeAddExpItem(){
  document.getElementById('addExpItemOverlay').style.display='none';
  addExpItemEvId=null; addExpItemFamId=null; addExpItemSplitMode='equal'; addExpItemMethod='equal'; addExpItemPayMode='single'; _editExpItemId=null; addExpItemFromPot=false;
}
function setExpItemSplitMode(mode){
  addExpItemSplitMode=mode;
  const isCustom=mode==='custom';
  document.getElementById('expItemSplitEqualDiv').style.display=isCustom?'none':'block';
  document.getElementById('expItemSplitCustomDiv').style.display=isCustom?'block':'none';
  _refreshExpItemMethodBtns();
}
function setExpItemMethod(method){
  addExpItemMethod=method;
  addExpItemSplitMode='equal';
  document.getElementById('expItemSplitEqualDiv').style.display='block';
  document.getElementById('expItemSplitCustomDiv').style.display='none';
  _refreshExpItemMethodBtns();
}
function _refreshExpItemMethodBtns(){
  const isCustom=addExpItemSplitMode==='custom';
  const ids={equal:'expSplitEqualBtn',percapita:'expSplitPercapitaBtn',weighted:'expSplitWeightedBtn'};
  Object.entries(ids).forEach(([m,id])=>{
    const b=document.getElementById(id);if(!b)return;
    const active=!isCustom&&addExpItemMethod===m;
    b.style.background=active?'var(--blue-mid)':'transparent';
    b.style.color=active?'#fff':'var(--text2)';
    b.style.borderColor=active?'var(--blue-mid)':'var(--border)';
  });
  const cb=document.getElementById('expSplitCustomBtn');
  if(cb){cb.style.background=isCustom?'var(--blue-mid)':'transparent';cb.style.color=isCustom?'#fff':'var(--text2)';cb.style.borderColor=isCustom?'var(--blue-mid)':'var(--border)';}
}
function _updateExpItemCustomTotal(){
  const ev=events.find(e=>e.id===addExpItemEvId);if(!ev)return;
  let total=0;
  ev.participants.forEach(fid=>{const inp=document.getElementById('csplit-'+fid);if(inp)total+=parseFloat(inp.value)||0;});
  const el=document.getElementById('expItemCustomTotal');
  if(el)el.textContent='₪'+Math.round(total).toLocaleString();
}
function setExpItemPayMode(mode){
  addExpItemPayMode=mode;
  const isMulti=mode==='multi';
  const picker=document.getElementById('expItemFamPicker');if(picker)picker.style.display=isMulti?'none':'flex';
  const multiWrap=document.getElementById('expItemPayMultiWrap');if(multiWrap)multiWrap.style.display=isMulti?'block':'none';
  const b1=document.getElementById('expPaySingleBtn');
  const b2=document.getElementById('expPayMultiBtn');
  if(b1){b1.style.background=isMulti?'transparent':'var(--blue-mid)';b1.style.color=isMulti?'var(--text2)':'#fff';b1.style.borderColor=isMulti?'var(--border)':'var(--blue-mid)';}
  if(b2){b2.style.background=isMulti?'var(--blue-mid)':'transparent';b2.style.color=isMulti?'#fff':'var(--text2)';b2.style.borderColor=isMulti?'var(--blue-mid)':'var(--border)';}
  const amtField=document.getElementById('expItemAmtField');if(amtField)amtField.style.display=isMulti?'none':'block';
  const amtNote=document.getElementById('expItemAmtFromPayNote');if(amtNote)amtNote.style.display=isMulti?'block':'none';
  if(isMulti)_updateExpItemPayTotal();
}
function _updateExpItemPayTotal(){
  const ev=events.find(e=>e.id===addExpItemEvId);if(!ev)return;
  let total=0;
  ev.participants.forEach(fid=>{const inp=document.getElementById('payamt-'+fid);if(inp)total+=parseFloat(inp.value)||0;});
  const el=document.getElementById('expItemPayTotal');
  if(el)el.textContent='₪'+Math.round(total).toLocaleString();
  const note=document.getElementById('expItemAmtFromPayNote');
  if(note)note.textContent='הסכום נקבע לפי סה"כ המשלמים: ₪'+Math.round(total).toLocaleString();
}
async function doAddExpItem(){
  const name=document.getElementById('expItemName').value.trim();
  const errEl=document.getElementById('expItemErr');
  const ev=events.find(e=>e.id===addExpItemEvId);if(!ev)return;
  if(addExpItemFromPot){
    const rawAmt=parseFloat(document.getElementById('expItemAmt').value)||0;
    if(!name||rawAmt<=0){if(errEl)errEl.style.display='block';return;}
    if(errEl)errEl.style.display='none';
    const amt=await _toILS('expItemAmt','expItemCurHint','expItemCur');
    if(!ev.potExpItems)ev.potExpItems=[];
    ev.potExpItemId=(ev.potExpItemId||0)+1;
    ev.potExpItems.push({id:ev.potExpItemId,name,amt:Math.round(amt),date:new Date().toLocaleDateString('he-IL')});
    closeAddExpItem();save();render();
    return;
  }
  const isMultiPay=addExpItemPayMode==='multi';
  let payers=null,payersTotal=0;
  if(isMultiPay){
    payers={};
    ev.participants.forEach(fid=>{
      const inp=document.getElementById('payamt-'+fid);
      const v=Math.round(parseFloat(inp&&inp.value)||0);
      if(v>0){payers[String(fid)]=v;payersTotal+=v;}
    });
  }
  const payFamId=isMultiPay?null:addExpItemFamId;
  if(addExpItemSplitMode==='custom'){
    if(!name||(isMultiPay?!payersTotal:!payFamId)){if(errEl)errEl.style.display='block';return;}
    const customSplit={};let total=0;
    ev.participants.forEach(fid=>{
      const inp=document.getElementById('csplit-'+fid);
      const v=Math.round(parseFloat(inp&&inp.value)||0);
      if(v>0){customSplit[String(fid)]=v;total+=v;}
    });
    if(!total){if(errEl)errEl.style.display='block';return;}
    if(errEl)errEl.style.display='none';
    if(_editExpItemId!=null){
      const old=(ev.expenseItems||[]).find(it=>it.id===_editExpItemId);
      if(old){
        _uncreditItemPayers(ev,old);
        old.name=name;old.amt=total;old.customSplit=customSplit;delete old.sharedWith;delete old.origAmt;delete old.origCur;delete old.splitMethod;
        if(payers){old.payers=payers;delete old.famId;}else{old.famId=payFamId;delete old.payers;}
        _creditItemPayers(ev,old);
      }
    }else{
      if(!ev.expenseItems)ev.expenseItems=[];
      ev.expItemId=(ev.expItemId||0)+1;
      const item={id:ev.expItemId,name,amt:total,customSplit};
      if(payers)item.payers=payers;else item.famId=payFamId;
      ev.expenseItems.push(item);
      _creditItemPayers(ev,item);
      const _payNames=itemPayerNames(item).join(' + ');
      addNotif('💳',(_payNames||'')+' הוסיפ/ה הוצאה "'+name+'" ₪'+total.toLocaleString()+' ל"'+ev.name+'"',undefined,undefined,'expense',ev.participants);
    }
    closeAddExpItem();save();render();
    return;
  }
  let amt,origCur='₪',rawAmt=0;
  if(isMultiPay){
    if(!name||!payersTotal){if(errEl)errEl.style.display='block';return;}
    amt=payersTotal;
  }else{
    rawAmt=parseFloat(document.getElementById('expItemAmt').value)||0;
    if(!name||!payFamId||rawAmt<=0){if(errEl)errEl.style.display='block';return;}
    amt=await _toILS('expItemAmt','expItemCur');
    origCur=document.getElementById('expItemCur')?.value||'₪';
  }
  if(errEl)errEl.style.display='none';
  const sw=[...(addExpItemSharedWith||new Set(ev.participants))].filter(fid=>ev.participants.includes(fid));
  const isPartial=sw.length>0&&sw.length<ev.participants.length;
  if(_editExpItemId!=null){
    const old=(ev.expenseItems||[]).find(it=>it.id===_editExpItemId);
    if(old){
      _uncreditItemPayers(ev,old);
      old.name=name;old.amt=amt;old.splitMethod=addExpItemMethod;delete old.customSplit;
      if(origCur!=='₪'){old.origAmt=rawAmt;old.origCur=origCur;}else{delete old.origAmt;delete old.origCur;}
      if(isPartial)old.sharedWith=sw;else delete old.sharedWith;
      delete old.nfashotOverride;
      if(payers){old.payers=payers;delete old.famId;}else{old.famId=payFamId;delete old.payers;}
      _creditItemPayers(ev,old);
    }
  }else{
    if(!ev.expenseItems)ev.expenseItems=[];
    ev.expItemId=(ev.expItemId||0)+1;
    const item={id:ev.expItemId,name,amt,splitMethod:addExpItemMethod};
    if(payers)item.payers=payers;else item.famId=payFamId;
    if(origCur!=='₪'){item.origAmt=rawAmt;item.origCur=origCur;}
    if(isPartial)item.sharedWith=sw;
    ev.expenseItems.push(item);
    _creditItemPayers(ev,item);
    const _payNames=itemPayerNames(item).join(' + ');
    addNotif('💳',(_payNames||'')+' הוסיפ/ה הוצאה "'+name+'" ₪'+Math.round(amt).toLocaleString()+' ל"'+ev.name+'"',undefined,undefined,'expense',ev.participants);
  }
  closeAddExpItem();
  save();render();
}
function deleteExpItem(evId,itemId){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  const item=(ev.expenseItems||[]).find(it=>it.id===itemId);if(!item)return;
  _uncreditItemPayers(ev,item);
  ev.expenseItems=ev.expenseItems.filter(it=>it.id!==itemId);
  save();render();
}
function toggleExpItem(evId,itemId){
  const key=evId+'-item-'+itemId;
  if(expandedExpItems.has(key))expandedExpItems.delete(key);else expandedExpItems.add(key);
  const el=document.getElementById('ecard-'+evId);
  const ev=events.find(e=>e.id===evId);
  if(el&&ev)el.outerHTML=evCard(ev);
}
function toggleFamShare(evId,famId){
  const key=evId+'-share-'+famId;
  if(expandedFamShares.has(key))expandedFamShares.delete(key);else expandedFamShares.add(key);
  const el=document.getElementById('ecard-'+evId);
  const ev=events.find(e=>e.id===evId);
  if(el&&ev)el.outerHTML=evCard(ev);
}
function editExpItem(evId,itemId){
  openAddExpItem(evId);
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  const item=(ev.expenseItems||[]).find(it=>it.id===itemId);if(!item)return;
  _editExpItemId=itemId;
  const titleEl=document.getElementById('addExpItemTitle');
  if(titleEl)titleEl.textContent='✏️ ערוך הוצאה';
  document.getElementById('expItemName').value=item.name;
  if(item.payers){
    setExpItemPayMode('multi');
    Object.entries(item.payers).forEach(([fid,amt])=>{const inp=document.getElementById('payamt-'+fid);if(inp)inp.value=amt;});
    _updateExpItemPayTotal();
  }else{
    setExpItemPayMode('single');
    selectAddExpFam(item.famId);
  }
  if(item.customSplit){
    setExpItemSplitMode('custom');
    ev.participants.forEach(fid=>{
      const inp=document.getElementById('csplit-'+fid);
      if(inp)inp.value=item.customSplit[String(fid)]||'';
    });
    _updateExpItemCustomTotal();
  } else {
    setExpItemMethod(item.splitMethod||'equal');
    addExpItemSharedWith=new Set(item.sharedWith||ev.participants);
    ev.participants.forEach(fid=>{
      const btn=document.getElementById('expshare-'+fid);if(!btn)return;
      if(addExpItemSharedWith.has(fid)){btn.style.background='var(--blue-bg)';btn.style.color='var(--blue)';btn.style.borderColor='var(--blue-mid)';}
      else{btn.style.background='transparent';btn.style.color='var(--text2)';btn.style.borderColor='var(--border)';}
    });
    document.getElementById('expItemAmt').value=item.origAmt||item.amt;
    const curEl=document.getElementById('expItemCur');
    if(curEl)curEl.value=item.origCur||'₪';
  }
}
function toggleCumFamily(evId,famId){
  const key=evId+'-'+famId;
  if(expandedCumFamilies.has(key))expandedCumFamilies.delete(key);
  else expandedCumFamilies.add(key);
  const el=document.getElementById('ecard-'+evId);
  const ev=events.find(e=>e.id===evId);
  if(el&&ev)el.outerHTML=evCard(ev);
}
function togglePotFamily(evId,famId){
  const key=evId+'-pot-'+famId;
  if(expandedPotFamilies.has(key))expandedPotFamilies.delete(key);
  else expandedPotFamilies.add(key);
  const el=document.getElementById('ecard-'+evId);
  const ev=events.find(e=>e.id===evId);
  if(el&&ev)el.outerHTML=evCard(ev);
}
function togglePotModalFamily(evId,famId){
  const key=evId+'-pot-'+famId;
  if(expandedPotFamilies.has(key))expandedPotFamilies.delete(key);
  else expandedPotFamilies.add(key);
  const ev=events.find(e=>e.id===evId);
  if(ev)renderPotModal(ev);
}
// ── Settle modal ──────────────────────────────
function openSettleModal(evId){
  settleModalEvId=evId;
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  renderSettleModal(ev);
  document.getElementById('settleModal').style.display='flex';
}
function confirmSavingsTransfer(evId,famId,amt){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  if(!ev.savingsPaid)ev.savingsPaid=[];
  ev.savingsPaid.push({famId,amt});
  save();render();
  if(settleModalEvId===evId)renderSettleModal(ev);
}
function closeSettleModal(){
  document.getElementById('settleModal').style.display='none';
  settleModalEvId=null;
}
// This modal is now savings-pot only — family-to-family "who pays whom"
// suggestions were removed from the per-event window (everyone just pays the
// treasurer directly instead); see openGlobalSettleModal for the standalone
// direct-transfer alternative that nets across all open events at once.
function renderSettleModal(ev){
  const el=document.getElementById('settleModalContent');if(!el)return;
  const _allTransfers=calcTransfers(ev);
  const transfers=_allTransfers.filter(t=>t.toFid==='__savings__'&&!t.coveredByPot);
  const _potCoveredTransfers=_allTransfers.filter(t=>t.toFid==='__savings__'&&t.coveredByPot);
  const settledList=ev.settled||[];
  const settleLines=transfers.map(t=>
    `<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--border)">
      <span style="font-size:13px">💎 <b>${esc(t.from)}</b> מעביר לקופת חיסכון ₪${t.amt.toLocaleString()}</span>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="edit-only" style="padding:6px 12px;border-radius:6px;border:none;background:var(--green-mid);color:#fff;font-size:12px;font-weight:700;font-family:var(--font);cursor:pointer" onclick="confirmSavingsTransfer(${ev.id},${t.fromFid},${t.amt})">💎 שולם</button>
      </div>
    </div>`
  ).join('');
  const _rowHtml=(icon,badge,from,to,amt)=>`<div style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;color:var(--text2)"><span style="color:var(--green-mid)">${icon}</span><span><b style="color:var(--text)">${esc(from)}</b> העביר ל<b style="color:var(--text)">${esc(to)}</b> ₪${Math.round(amt).toLocaleString()}</span>${badge}</div>`;
  const _savBadge='<span style="font-size:10px;background:var(--green-bg);color:var(--green);padding:1px 6px;border-radius:10px">חיסכון</span>';
  const _savPaidRows=(ev.savingsPaid||[]).map(p=>{const f=getFam(p.famId);if(!f)return'';return _rowHtml('💎',_savBadge,f.name.replace('משפחת','').trim(),'קופת חיסכון',p.amt);}).join('');
  const _potCovBadge='<span style="font-size:10px;background:var(--amber-bg);color:var(--amber);padding:1px 6px;border-radius:10px">הוסדר ע"י הקופה</span>';
  const _potCovRows=_potCoveredTransfers.map(t=>_rowHtml('💰',_potCovBadge,t.from,'קופת חיסכון',t.amt));
  const _hasDone=(ev.savingsPaid||[]).length||_potCoveredTransfers.length;
  const doneRows=_hasDone?
    `<div style="padding:12px 16px 4px;border-top:2px solid var(--border);margin-top:${transfers.length?'8':'0'}px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:6px">✅ בוצעו</div>
      ${_potCovRows.join('')}${_savPaidRows}
    </div>`:'';
  el.innerHTML=`
    <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
      <div><div style="font-size:14px;font-weight:700">💎 קופת חיסכון</div><div style="font-size:11px;color:var(--text2);margin-top:2px">${esc(ev.name)}</div></div>
      <button onclick="closeSettleModal()" style="border:none;background:none;font-size:20px;color:var(--text2);cursor:pointer;font-family:var(--font);padding:0">✕</button>
    </div>
    ${transfers.length?`<div style="padding:4px 0 4px">${settleLines}</div>`:`<div style="padding:20px;text-align:center;font-size:15px;color:var(--green)">✅ כולם מסודרים!</div>`}
    ${doneRows}
    <div style="padding:10px 16px">
      <button onclick="closeSettleModal()" style="width:100%;padding:10px;border-radius:var(--r2);border:1.5px solid var(--border);background:transparent;color:var(--text2);font-size:13px;font-weight:700;font-family:var(--font);cursor:pointer">סגור</button>
    </div>`;
}
// Standalone "העברות איזון" tool — direct family-to-family settle-up,
// netted across every open event at once. Optional alternative to the
// default flow of everyone paying the treasurer.
function openGlobalSettleModal(){
  renderGlobalSettleModal();
  document.getElementById('globalSettleModal').style.display='flex';
}
function closeGlobalSettleModal(){
  document.getElementById('globalSettleModal').style.display='none';
}
function renderGlobalSettleModal(){
  const el=document.getElementById('globalSettleModalContent');if(!el)return;
  const transfers=calcGlobalTransfers();
  const _myFid=_myFamId();
  const _hasTransferClaim=(fromFid,toFid)=>paymentClaims.some(c=>c.kind==='transfer'&&c.evId==null&&c.famId===fromFid&&c.toFid===toFid);
  const settleLines=transfers.map(t=>{
    const _claimBtn=t.fromFid===_myFid?(_hasTransferClaim(t.fromFid,t.toFid)?
      `<span style="padding:6px 12px;border-radius:6px;font-size:12px;font-weight:700;color:var(--text2)">⏳ ממתין לאישור</span>`:
      `<button style="padding:6px 12px;border-radius:6px;border:1.5px solid var(--green-mid);background:var(--green-bg);color:var(--green-mid);font-size:12px;font-weight:700;font-family:var(--font);cursor:pointer" onclick="claimTransfer(null,${t.fromFid},${t.toFid},${t.amt})">✓ העברתי</button>`):'';
    return`<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--border)">
      <span style="font-size:13px">👈 <b>${esc(t.from)}</b> מעביר ל<b>${esc(t.to)}</b> ₪${t.amt.toLocaleString()}</span>
      <div style="display:flex;gap:6px;flex-shrink:0">
        ${_claimBtn}
        <button class="edit-only" style="padding:6px 12px;border-radius:6px;border:1.5px solid var(--amber);background:transparent;color:var(--amber);font-size:12px;font-weight:700;font-family:var(--font);cursor:pointer" onclick="markTransferFromTreasurer(null,'${esc(t.from)}',${t.fromFid},'${esc(t.to)}',${t.toFid},${t.amt})" title="הגזבר משלם ל${esc(t.to)} מכיסו, במקום ${esc(t.from)}">💼 שילם הגזבר</button>
        <button class="edit-only" style="padding:6px 12px;border-radius:6px;border:none;background:var(--blue-mid);color:#fff;font-size:12px;font-weight:700;font-family:var(--font);cursor:pointer" onclick="openPartPayModal(null,'${esc(t.from)}',${t.fromFid},'${esc(t.to)}',${t.toFid},${t.amt},false,true)">✓ שולם</button>
      </div>
    </div>`;
  }).join('');
  const _rowHtml=(icon,badge,from,to,amt)=>`<div style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;color:var(--text2)"><span style="color:var(--green-mid)">${icon}</span><span><b style="color:var(--text)">${esc(from)}</b> העביר ל<b style="color:var(--text)">${esc(to)}</b> ₪${Math.round(amt).toLocaleString()}</span>${badge}</div>`;
  const _nonPotBadge=method=>method==='fund'?'<span style="font-size:10px;background:var(--blue-bg);color:var(--blue);padding:1px 6px;border-radius:10px">קופה</span>'
    :method==='treasurer'?'<span style="font-size:10px;background:var(--amber-bg);color:var(--amber);padding:1px 6px;border-radius:10px">גזבר</span>'
    :'<span style="font-size:10px;background:var(--green-bg);color:var(--green);padding:1px 6px;border-radius:10px">ישיר</span>';
  // Combine legacy event-less records with the per-event entries new global
  // settlements are now written into (tagged `global:true` by
  // _distributeGlobalSettle) so this history list still shows them all.
  const _globalDoneEntries=[...(globalSettled||[]),...events.flatMap(ev=>(ev.settled||[]).filter(s=>s.global))];
  const doneRowsList=_globalDoneEntries.map(s=>_rowHtml(
    s.method==='fund'?'🏦':s.method==='treasurer'?'💼':'✓',
    _nonPotBadge(s.method),
    s.method==='treasurer'?'הגזבר':s.from,
    s.to,s.amt));
  const doneRows=doneRowsList.length?
    `<div style="padding:12px 16px 4px;border-top:2px solid var(--border);margin-top:${transfers.length?'8':'0'}px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:6px">✅ בוצעו</div>
      ${doneRowsList.join('')}
    </div>`:'';
  el.innerHTML=`
    <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
      <div><div style="font-size:14px;font-weight:700">⚖️ העברות איזון</div><div style="font-size:11px;color:var(--text2);margin-top:2px">חלופה ישירה לתשלום דרך הגזבר — מחושב על כל האירועים הפתוחים יחד</div></div>
      <button onclick="closeGlobalSettleModal()" style="border:none;background:none;font-size:20px;color:var(--text2);cursor:pointer;font-family:var(--font);padding:0">✕</button>
    </div>
    ${transfers.length?`<div style="padding:4px 0 4px">${settleLines}</div>`:`<div style="padding:20px;text-align:center;font-size:15px;color:var(--green)">✅ כולם מסודרים!</div>`}
    ${doneRows}
    <div style="padding:10px 16px">
      <button onclick="closeGlobalSettleModal()" style="width:100%;padding:10px;border-radius:var(--r2);border:1.5px solid var(--border);background:transparent;color:var(--text2);font-size:13px;font-weight:700;font-family:var(--font);cursor:pointer">סגור</button>
    </div>`;
}
// Human-readable "how was it settled" lines for one family in an event —
// direct transfers, wallet (קופה ראשית) payments, and event-pot movements.
// Ported from the settled-email logic so the dashboard can explain the gap
// between what a family paid and its fair share.
function evSettleLines(ev,famId){
  const lines=[];
  const _sfByName=n=>families.find(x=>x.name===n||x.name.replace(/^משפחת\s*/,'')===n);
  const _potTotal=Math.round((ev.potPayments||[]).filter(p=>Number(p.famId)===Number(famId)).reduce((s,p)=>s+p.amt,0));
  const _fromFundToPot=Math.round((fund.transactions||[])
    .filter(t=>Number(t.famId)===Number(famId)&&t.type==='payout'&&(t.desc||'').includes('העברה לקופת האירוע')&&(t.evId!=null?t.evId===ev.id:(t.desc||'').includes(ev.name)))
    .reduce((s,t)=>s+t.amount,0));
  if(_potTotal>0.5){
    if(_fromFundToPot>0.5&&_fromFundToPot===_potTotal) lines.push(`העברתם מהארנק ₪${_potTotal.toLocaleString()} לקופת האירוע`);
    else{ lines.push(`הפקדתם לקופת האירוע ₪${_potTotal.toLocaleString()}`); if(_fromFundToPot>0.5) lines.push(`מתוכם ₪${_fromFundToPot.toLocaleString()} מהארנק`); }
  }
  const _potRec=Math.round((ev.settled||[]).filter(s=>s.method==='pot'&&Number(s.toFid)===Number(famId)).reduce((s,t)=>s+t.amt,0));
  const _toFundFromPot=Math.round((fund.transactions||[])
    .filter(t=>Number(t.famId)===Number(famId)&&t.type==='deposit'&&(t.desc||'').includes('מקופת אירוע')&&(t.evId!=null?t.evId===ev.id:(t.desc||'').includes(ev.name)))
    .reduce((s,t)=>s+t.amount,0));
  if(_potRec>0.5){
    if(_toFundFromPot>0.5&&_toFundFromPot===_potRec) lines.push(`הועבר מקופת האירוע ₪${_potRec.toLocaleString()} לארנק שלכם`);
    else{ lines.push(`קיבלתם ₪${_potRec.toLocaleString()} מקופת האירוע`); if(_toFundFromPot>0.5) lines.push(`מתוכם ₪${_toFundFromPot.toLocaleString()} לארנק`); }
  }
  (ev.settled||[]).forEach(s=>{
    if(s.method==='pot') return;
    const isFrom=s.fromFid!=null?Number(s.fromFid)===Number(famId):(_sfByName(s.from)||{}).id===famId;
    const isTo=s.toFid!=null?Number(s.toFid)===Number(famId):(_sfByName(s.to)||{}).id===famId;
    const sTo=(getFam(s.toFid)||{}).name?(getFam(s.toFid).name.replace('משפחת','').trim()):s.to;
    const sFrom=(getFam(s.fromFid)||{}).name?(getFam(s.fromFid).name.replace('משפחת','').trim()):s.from;
    if(isFrom){
      if(s.method==='fund') lines.push(`₪${s.amt.toLocaleString()} שולמו מהארנק ל${sTo}`);
      else if(s.method==='treasurer') lines.push(`הגזבר שילם ל${sTo} ₪${s.amt.toLocaleString()} במקומכם — טרם הוחזר לו`);
      else if(s.method==='treasurer-repay') lines.push(`החזרתם לגזבר ₪${s.amt.toLocaleString()}`);
      else lines.push(`העברה ישירה של ₪${s.amt.toLocaleString()} ל${sTo}`);
    } else if(isTo){
      if(s.method==='fund') lines.push(`₪${s.amt.toLocaleString()} מ${sFrom} – הועברו לארנק`);
      else if(s.method==='treasurer') lines.push(`קיבלתם ₪${s.amt.toLocaleString()} מהגזבר לארנק שלכם`);
      else lines.push(`קיבלתם ₪${s.amt.toLocaleString()} ישירות מ${sFrom}`);
    }
  });
  const _savPaid=Math.round((ev.savingsPaid||[]).filter(p=>Number(p.famId)===Number(famId)).reduce((s,p)=>s+p.amt,0));
  if(_savPaid>0.5) lines.push(`שולם לקופת חיסכון ₪${_savPaid.toLocaleString()}`);
  return lines;
}
// Signed breakdown of everything already settled for a family, mirroring
// evAdjBalance's credit sources exactly (name-matched settlements, pot deposits,
// savings) so the lines always add up to the amount that was settled.
function evCoverLines(ev,fid){
  const lines=[];
  const trim=f=>{const g=getFam(f);return g?g.name.replace('משפחת','').trim():'';};
  const byName=n=>ev.participants.find(pid=>{const f=getFam(pid);return f&&f.name.replace('משפחת','').trim()===n;});
  // Money routed through the event's own pot is split per creditor/depositor
  // in ev.settled (one 'pot' entry per pairing), which would otherwise list
  // every single family that happened to share the pot — not useful to this
  // family, who only cares that it came from the pot. Collapse all of those
  // into one line each; a genuinely direct (non-pot) transfer still gets its
  // own line naming the specific family, same as before.
  let potPaid=0,potReceived=0;
  (ev.settled||[]).forEach(s=>{
    const fromFid=byName(s.from),toFid=byName(s.to),amt=Math.round(s.amt);
    if(fromFid===Number(fid)){
      if(s.method==='pot'){ potPaid+=amt; }
      else{
        const to=toFid!=null?trim(toFid):(s.to||'');
        if(s.method==='treasurer'){
          // Only the creditor's side actually resolved — the family itself
          // hasn't paid anything yet, so this doesn't count toward "covered".
          lines.push({t:`הגזבר שילם ₪${amt.toLocaleString()}${to?' ל'+to:''} במקומכם — טרם הוחזר לו`,a:0});
        } else if(s.method==='treasurer-repay'){
          lines.push({t:`החזרתם לגזבר ₪${amt.toLocaleString()}`,a:amt});
        } else {
          const via=s.method==='fund'?'מהארנק':'ישירות';
          lines.push({t:`שילמתם ₪${amt.toLocaleString()} ${via}${to?` ל${to}`:''}`,a:amt});
        }
      }
    }
    if(toFid===Number(fid)){
      if(s.method==='pot'){ potReceived+=amt; }
      else{
        const from=fromFid!=null?trim(fromFid):(s.from||'');
        lines.push({t:`קיבלתם ₪${amt.toLocaleString()}${from?` מ${from}`:''} (החזר על מה ששילמתם)`,a:-amt});
      }
    }
  });
  if(potPaid>0.5){
    // Trace this back to its real origin: if their pot deposit was itself
    // funded from the wallet, say so — "paid from the pot" is technically
    // true but hides that no separate cash ever changed hands, just a
    // wallet-to-pot transfer that then covered their share.
    const fromWallet=Math.min(evPotFromWallet(ev,fid),potPaid);
    if(fromWallet>=potPaid-0.5){
      lines.push({t:`הועבר מהארנק ₪${potPaid.toLocaleString()} לקופת האירוע`,a:potPaid});
    } else {
      lines.push({t:`שילמתם ₪${potPaid.toLocaleString()} לקופת האירוע`,a:potPaid});
      if(fromWallet>0.5)lines.push({t:`מתוכם ₪${fromWallet.toLocaleString()} מהארנק`,a:0});
    }
  }
  if(potReceived>0.5)lines.push({t:`קיבלתם ₪${potReceived.toLocaleString()} מקופת האירוע (החזר על מה ששילמתם)`,a:-potReceived});
  const pot=Math.round((ev.potPayments||[]).filter(p=>Number(p.famId)===Number(fid)).reduce((s,p)=>s+p.amt,0));
  if(pot>0.5)lines.push({t:`הפקדתם לקופת האירוע ₪${pot.toLocaleString()}`,a:pot});
  const sav=Math.round((ev.savingsPaid||[]).filter(p=>Number(p.famId)===Number(fid)).reduce((s,p)=>s+p.amt,0));
  if(sav>0.5)lines.push({t:`שילמתם לקופת חיסכון ₪${sav.toLocaleString()}`,a:sav});
  return lines;
}
// Family-to-family transfers for one family in an event: both the moves that
// already happened (from ev.settled, direct or wallet) and the ones still
// already happened (from ev.settled). Family-to-family "pending" suggestions
// were removed — everyone pays the treasurer directly now (see
// openGlobalSettleModal for the optional direct-transfer alternative).
function evFamTransfers(ev,famId){
  const out=[];
  const _sfByName=n=>families.find(x=>x.name===n||x.name.replace(/^משפחת\s*/,'')===n);
  const nm=(fid,fallback)=>{const f=getFam(fid);return f?f.name.replace('משפחת','').trim():(fallback||'');};
  (ev.settled||[]).forEach(s=>{
    if(s.method==='pot') return; // pot moves aren't family-to-family
    const isFrom=s.fromFid!=null?Number(s.fromFid)===Number(famId):(_sfByName(s.from)||{}).id===famId;
    const isTo=s.toFid!=null?Number(s.toFid)===Number(famId):(_sfByName(s.to)||{}).id===famId;
    // A 'treasurer' entry didn't actually involve the debtor transferring
    // anything — the treasurer fronted it on their behalf — so it shouldn't
    // show as a completed "out" transfer for them (see evCard's own
    // dedicated "טרם הוחזר" line + button for that instead). The creditor
    // really did receive the money, but from the treasurer, not the debtor —
    // label it that way instead of naming the (still-owing) debtor.
    if(isFrom&&s.method!=='treasurer') out.push({dir:'out',pending:false,amt:Math.round(s.amt),other:nm(s.toFid,s.to)});
    else if(isTo) out.push({dir:'in',pending:false,amt:Math.round(s.amt),other:s.method==='treasurer'?'הגזבר':nm(s.fromFid,s.from)});
  });
  return out;
}
// Shareable expense-form link for an event (form.html?ev=<id>), resolved
// relative to wherever the app is currently served.
function expenseFormLink(evId){
  return location.origin+location.pathname.replace(/[^/]*$/,'form.html')+'?ev='+evId;
}
function shareExpenseForm(evId){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  const url=expenseFormLink(evId);
  const recipients=ev.participants.map(fid=>getFam(fid)).filter(f=>f&&(f.email||f.email2))
    .map(f=>({email:f.email,email2:f.email2,name:f.name.replace('משפחת','').trim()}));
  if(!recipients.length){alert('לאף אחת מהמשפחות המשתתפות אין כתובת מייל שמורה.');return;}
  const msg=`שילמתם משהו עבור "${ev.name}"? אפשר לדווח על ההוצאה בקישור:\n${url}`;
  const bodyHtml=`<p style="margin:0 0 16px">שילמתם משהו עבור האירוע? דווחו על ההוצאה בקלות דרך הטופס:</p>`+
    `<div style="text-align:center;margin:0"><a href="${_esc(url)}" style="display:inline-block;background:#1E88D8;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700">📋 פתיחת טופס הוצאות ←</a></div>`;
  const html=_emailWrap(bodyHtml,ev.name,'📋','',ev.name);
  sendEmailNotif(recipients,`📋 טופס הוצאות · ${ev.name}`,msg,html);
  showToast('📧 נשלח לכל המשתתפים');
}
// ── Per-family detail popup (opened from a family card in the dashboard) ──
// Shows what the family actually paid (their expense items) and how their fair
// share in the event breaks down, plus their balance and transfers.
let famExpModalKey=null;
function openEventFamDetail(evId,fid){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  famExpModalKey=evId+'-'+fid;
  renderEventFamDetail(ev,fid);
  document.getElementById('famExpModal').style.display='flex';
}
function closeEventFamDetail(){
  document.getElementById('famExpModal').style.display='none';
  famExpModalKey=null;
}
function renderEventFamDetail(ev,fid){
  const el=document.getElementById('famExpModalContent');if(!el)return;
  const f=getFam(fid);if(!f){el.innerHTML='';return;}
  const c=col(fid).c;
  const name=esc(f.name.replace('משפחת','').trim());
  const shares=evShares(ev),adjBal=evAdjBalance(ev);
  const share=Math.round(shares[fid]||0);
  const b=adjBal[fid]||0;
  const paidItems=(ev.expenseItems||[]).map(it=>({name:it.name,amt:Math.round(itemPayerAmt(it,fid))})).filter(x=>x.amt>0);
  const paidTotal=paidItems.reduce((s,x)=>s+x.amt,0);
  const paidBal=Math.round(ev.expenses[fid]||0); // authoritative "spent" used by the balance
  const partial=(ev.expenseItems||[]).flatMap(it=>{
    if(it.customSplit){const a=Math.round(it.customSplit[String(fid)]||0);return a>0?[{name:it.name,amt:a}]:[];}
    if(it.sharedWith&&it.sharedWith.length>0&&it.sharedWith.length<ev.participants.length){
      const sw=it.sharedWith.filter(id=>ev.participants.includes(id));
      return sw.includes(fid)?[{name:it.name,amt:Math.round(it.amt/sw.length)}]:[];
    }
    return [];
  });
  const partialSum=partial.reduce((s,x)=>s+x.amt,0);
  const savings=evSavingsPerFam(ev);
  const globalPortion=Math.max(0,share-partialSum-savings);
  // Itemize the shared-cost portion: the family pays a weight-based fraction of
  // each non-partial expense item, so show e.g. "כרטיסים ₪50 · פיצה ₪30".
  // Each expense item can have its own split method (cumulative events decide it
  // per item), so its exact share comes from itemShareFor — not a single blanket
  // fraction for the whole event. Pot-expense items have no per-item method of
  // their own; they fall into evShares' "remainder" bucket, split by the event's
  // overall default method, so they still use that blanket fraction here.
  const method=ev.splitMethod||'equal';
  let totalW=0;const wmap={};
  ev.participants.forEach(pid=>{wmap[pid]=famWeight(getFam(pid),method,ev.childOverrides?.[pid],ev.parentOverrides?.[pid]);totalW+=wmap[pid];});
  const frac=totalW?wmap[fid]/totalW:0;
  const isPartialItem=it=>it.customSplit||(it.sharedWith&&it.sharedWith.length>0&&it.sharedWith.length<ev.participants.length);
  const globalSrc=[...(ev.expenseItems||[]).filter(it=>!isPartialItem(it)&&it.amt>0).map(it=>({name:it.name,pot:false,raw:itemShareFor(ev,it,fid)})),
                   ...(ev.potExpItems||[]).filter(it=>it.amt>0).map(it=>({name:it.name,pot:true,raw:it.amt*frac}))];
  let sharedRows=[];
  if(globalSrc.length&&globalPortion>0){
    const raws=globalSrc.map(x=>x.raw);
    const floors=raws.map(v=>Math.floor(v));
    let rem=Math.round(globalPortion-floors.reduce((s,v)=>s+v,0));
    const ord=raws.map((v,i)=>({i,f:v-Math.floor(v)})).sort((a,b)=>b.f-a.f);
    for(let k=0;rem>0&&k<ord.length;k++){floors[ord[k].i]++;rem--;}
    sharedRows=globalSrc.map((x,i)=>({name:x.name,pot:x.pot,amt:floors[i]})).filter(x=>x.amt>0);
  }
  const pillBase='font-family:var(--font-head);font-size:13px;font-weight:700;padding:5px 14px;border-radius:20px;white-space:nowrap';
  const pill=b>0.5?`<span style="${pillBase};background:var(--green-bg);color:var(--green)">יקבלו ₪${Math.round(b).toLocaleString()}</span>`
    :b<-0.5?`<span style="${pillBase};background:var(--red-bg);color:var(--red)">צריכים לשלם ₪${Math.round(-b).toLocaleString()}</span>`
    :`<span style="${pillBase};background:var(--surface2);color:var(--text2)">מסודרים ✓</span>`;
  const row=(l,v,strong)=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)"><span style="font-size:12.5px;color:var(--text2)">${l}</span><span style="font-family:var(--font-head);font-size:13px;font-weight:700${strong?';color:var(--green-mid)':''}">${v}</span></div>`;
  const sec=(title,inner)=>`<div style="padding:13px 16px;border-top:7px solid var(--surface2)"><div style="font-family:var(--font-head);font-size:12.5px;font-weight:700;color:var(--text2);margin-bottom:8px">${title}</div>${inner}</div>`;
  const paidInner=paidItems.length?paidItems.map(x=>row(esc(x.name),'₪'+x.amt.toLocaleString())).join('')+row('סה"כ הוציאו','₪'+paidTotal.toLocaleString(),true)
    :`<div style="font-size:12.5px;color:var(--text3);text-align:center;padding:4px 0">לא שילמו הוצאות ישירות באירוע.</div>`;
  const shareInner=(sharedRows.length
      ?sharedRows.map(x=>row((x.pot?'💰 ':'')+esc(x.name),'₪'+x.amt.toLocaleString())).join('')
      :(globalPortion>0?row('עלות כללית','₪'+globalPortion.toLocaleString()):''))
    +partial.map(x=>row('👥 '+esc(x.name)+' <span style="font-size:10px;color:var(--text3)">(חלקי)</span>','₪'+x.amt.toLocaleString())).join('')
    +(savings>0?row('💎 קופת חיסכון','₪'+savings.toLocaleString()):'')
    +row('סה"כ החלק ההוגן','₪'+share.toLocaleString(),true)
    +`<div style="font-size:11px;color:var(--text3);margin-top:6px">שיטת חלוקה: ${esc(SPLIT_LABELS[ev.splitMethod||'equal']||'')}</div>`;
  const trChip=t=>{
    const amt='₪'+t.amt.toLocaleString();const other=esc(t.other||'');let txt,bg,color;
    if(t.dir==='out'){txt=`${t.pending?'להעביר':'העבירו'} ${amt} ל${other}`;bg=t.pending?'var(--red-bg)':'var(--surface2)';color=t.pending?'var(--red)':'var(--text2)';}
    else{txt=`${t.pending?'לקבל':'קבלו'} ${amt} מ${other}`;bg='var(--green-bg)';color='var(--green)';}
    return`<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;background:${bg};color:${color};padding:3px 9px;border-radius:20px;white-space:nowrap">⇄ ${txt}</span>`;
  };
  const transfers=evFamTransfers(ev,fid);
  // Reconciliation: explain how the fair share turns into what's left to pay —
  // minus what they paid out of pocket and minus what was already settled
  // (from the wallet / event pot / direct transfers / savings).
  const owe=b<-0.5?Math.round(-b):0;
  const getBack=b>0.5?Math.round(b):0;
  const covered=Math.round((share-paidBal)-owe);
  const settleLines=evCoverLines(ev,fid).map(x=>x.t);
  const pend=transfers.filter(t=>t.pending);
  let reconInner=row('החלק ההוגן','₪'+share.toLocaleString());
  if(paidBal>0)reconInner+=row('בניכוי ששילמו מהכיס','−₪'+paidBal.toLocaleString());
  if(settleLines.length)reconInner+=`<div style="padding:7px 0 3px;font-size:11.5px;font-weight:700;color:var(--text2)">כבר סודר:</div><ul style="margin:0 0 4px;padding-inline-start:18px;font-size:12px;color:var(--text2);line-height:1.7">${settleLines.map(l=>`<li>${esc(l)}</li>`).join('')}</ul>`;
  if(covered>0)reconInner+=row('סה"כ סודר עד כה','−₪'+covered.toLocaleString());
  reconInner+= owe>0?row('נשאר לשלם','<span style="color:var(--red)">₪'+owe.toLocaleString()+'</span>',true)
    :getBack>0?row('מגיע לכם בחזרה','<span style="color:var(--green)">₪'+getBack.toLocaleString()+'</span>',true)
    :row('הסטטוס','<span style="color:var(--green)">מסודרים ✓</span>',true);
  if(pend.length)reconInner+=`<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:9px">${pend.map(trChip).join('')}</div>`;
  el.innerHTML=`
    <div style="padding:13px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:9px">
      <span style="width:12px;height:12px;border-radius:50%;background:${c};flex-shrink:0"></span>
      <span style="flex:1;font-family:var(--font-head);font-size:16px;font-weight:700">${name}</span>
      ${pill}
      <button onclick="closeEventFamDetail()" style="border:none;background:none;font-size:20px;color:var(--text2);cursor:pointer;font-family:var(--font);padding:0;line-height:1;margin-right:2px">✕</button>
    </div>
    ${sec('💸 ההוצאות ששילמו',paidInner)}
    ${sec('⚖️ פירוט החלק שלהם באירוע',shareInner)}
    ${sec('💳 חישוב מה נשאר לשלם',reconInner)}
    <div style="padding:12px 16px;border-top:7px solid var(--surface2)"><button onclick="closeEventFamDetail()" style="width:100%;padding:10px;border-radius:var(--r2);border:1.5px solid var(--border);background:transparent;color:var(--text2);font-size:13px;font-weight:700;font-family:var(--font);cursor:pointer">סגור</button></div>`;
}
// ── Event dashboard modal ──────────────────
// Full-event popup opened from the total-cost bar: a "dashboard" that shows
// general info about the event plus a personal card for the viewing family,
// a per-family balance, an expense breakdown BY TYPE (item name), the balancing
// transfers, and pot/savings details when relevant.
let eventDashEvId=null;
function openEventDash(evId){
  eventDashEvId=evId;
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  renderEventDash(ev);
  document.getElementById('eventDashModal').style.display='flex';
}
function closeEventDash(){
  document.getElementById('eventDashModal').style.display='none';
  eventDashEvId=null;
}
function _dashSection(title,inner){
  return`<div style="padding:16px;border-top:10px solid var(--surface2)"><div style="font-family:var(--font-head);font-size:13.5px;font-weight:700;color:var(--text2);margin-bottom:12px;letter-spacing:.2px">${title}</div>${inner}</div>`;
}
function renderEventDash(ev){
  const el=document.getElementById('eventDashContent');if(!el)return;
  const cost=evCost(ev);
  const shares=evShares(ev);
  const adjBal=evAdjBalance(ev);
  const method=ev.splitMethod||'equal';
  const potBal=evPotBal(ev);
  const potExpTotal=evPotExpTotal(ev);
  const hasPot=potBal>0||potExpTotal>0||(ev.potPayments||[]).length>0;
  const savPerFam=evSavingsPerFam(ev);
  const balanced=cost>0&&!ev.participants.some(fid=>(adjBal[fid]||0)<-0.5);
  const myFid=_myFamId();
  // In edit mode this is the admin's device, not a specific participating family —
  // the device's stored identity (from an earlier public-site visit) isn't relevant here.
  const iAmIn=!editMode&&myFid!=null&&ev.participants.includes(myFid);

  // ── Personal card (viewing family) ──
  let meCard='';
  if(iAmIn){
    const mf=getFam(myFid);
    const mc=col(myFid).c, mbg=col(myFid).bg;
    const myPaid=Math.round(ev.expenses[myFid]||0);
    const myShare=Math.round(shares[myFid]||0);
    const mb=adjBal[myFid]||0;
    const gap=myShare-myPaid; // >0: still needed to cover; <0: paid extra
    const statLine=mb>0.5
      ?`<span style="color:var(--green)">מגיע לכם החזר ₪${Math.round(mb).toLocaleString()} 💰</span>`
      :mb<-0.5
      ?`<span style="color:var(--red)">עליכם לשלם ₪${Math.round(-mb).toLocaleString()}</span>`
      :`<span style="color:var(--green)">מסודרים ✓</span>`;
    const myLines=evSettleLines(ev,myFid);
    const howHtml=myLines.length
      ?`<div style="margin-top:10px;padding-top:10px;border-top:1px dashed ${mc}55">
          <div style="font-family:var(--font-head);font-size:11.5px;font-weight:700;color:${mc};margin-bottom:5px">⚖️ איך סודר${gap>0.5?` ההפרש (₪${Math.round(gap).toLocaleString()})`:''}</div>
          <ul style="margin:0;padding-inline-start:18px;font-size:12px;color:var(--text);line-height:1.7">${myLines.map(l=>`<li>${esc(l)}</li>`).join('')}</ul>
        </div>`
      :(mb<-0.5?`<div style="margin-top:9px;font-size:11.5px;color:var(--red);font-weight:600">⚠️ טרם שולם — נותרו ₪${Math.round(-mb).toLocaleString()} להסדרה.</div>`:'');
    const meRow=(lbl,sub,val)=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="font-size:12.5px;color:var(--text2)">${lbl}${sub?` <span style="font-size:10px;color:var(--text3)">${sub}</span>`:''}</span><span style="font-family:var(--font-head);font-size:15px;font-weight:700">₪${val.toLocaleString()}</span></div>`;
    meCard=`<div style="margin:12px 16px 0;background:${mbg};border:1px solid ${mc}33;border-radius:12px;padding:12px 14px">
      <div style="font-family:var(--font-head);font-size:12px;font-weight:700;color:${mc};margin-bottom:9px">👤 ${esc(mf?mf.name.replace('משפחת','').trim():'המשפחה שלכם')} · המצב שלכם</div>
      <div style="display:flex;flex-direction:column;gap:7px">
        ${meRow('💸 שילמתם בפועל','(מהכיס)',myPaid)}
        ${meRow('⚖️ החלק שלכם','(כמה מגיע לשלם)',myShare)}
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid ${mc}33;padding-top:8px;margin-top:1px">
          <span style="font-size:12.5px;font-weight:700">המצב שלכם</span>
          <span style="font-family:var(--font-head);font-size:15px;font-weight:700;text-align:left">${statLine}</span>
        </div>
      </div>
      ${howHtml}
    </div>`;
  }

  // ── Overview tiles ──
  const tile=(label,val,color)=>`<div style="flex:1;min-width:96px;background:var(--surface2);border-radius:10px;padding:9px 11px"><div style="font-size:10.5px;color:var(--text2);margin-bottom:3px">${label}</div><div style="font-family:var(--font-head);font-size:15px;font-weight:700;color:${color||'var(--text)'}">${val}</div></div>`;
  const tiles=[
    tile('סה"כ עלות','₪'+cost.toLocaleString(),'var(--green-mid)'),
    tile('חלוקה',SPLIT_LABELS[method]||method),
    tile('משפחות',String(ev.participants.length)),
  ];
  if(hasPot)tiles.push(tile('קופת אירוע','₪'+Math.round(potBal).toLocaleString(),'var(--amber)'));
  if(ev.savingsTotal)tiles.push(tile('חיסכון','₪'+Math.round(ev.savingsTotal).toLocaleString(),'var(--blue)'));
  const tilesHtml=`<div style="display:flex;flex-wrap:wrap;gap:8px;padding:14px 16px 8px">${tiles.join('')}</div>`;

  // ── Family balance ──
  // Each family is a clear card: "הוציאו" = what they actually spent,
  // "החלק ההוגן" = what they should pay, and a status pill with the difference
  // (לשלם / יקבלו / מסודרים). The viewing family's card is tinted + labelled "אתם".
  const famRows=ev.participants.map(fid=>{
    const f=getFam(fid);if(!f)return'';
    const c=col(fid).c, bg=col(fid).bg;
    const isMe=fid===myFid;
    const name=esc(f.name.replace('משפחת','').trim());
    const paid=Math.round(ev.expenses[fid]||0);
    const share=Math.round(shares[fid]||0);
    const b=adjBal[fid]||0;
    const pillBase='font-family:var(--font-head);font-size:12.5px;font-weight:700;padding:4px 11px;border-radius:20px;white-space:nowrap';
    const pill=b>0.5?`<span style="${pillBase};background:var(--green-bg);color:var(--green)">${isMe?'תקבלו':'יקבלו'} ₪${Math.round(b).toLocaleString()}</span>`
      :b<-0.5?`<span style="${pillBase};background:var(--red-bg);color:var(--red)">${isMe?'עליכם':'צריכים'} לשלם ₪${Math.round(-b).toLocaleString()}</span>`
      :`<span style="${pillBase};background:var(--surface2);color:var(--text2)">מסודרים ✓</span>`;
    const trChip=t=>{
      const amt='₪'+t.amt.toLocaleString();const other=esc(t.other||'');
      let txt,bg,color;
      if(t.dir==='out'){txt=`${t.pending?'להעביר':'העבירו'} ${amt} ל${other}`;bg=t.pending?'var(--red-bg)':'var(--surface2)';color=t.pending?'var(--red)':'var(--text2)';}
      else{txt=`${t.pending?'לקבל':'קבלו'} ${amt} מ${other}`;bg='var(--green-bg)';color='var(--green)';}
      return`<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;background:${bg};color:${color};padding:3px 9px;border-radius:20px;white-space:nowrap">⇄ ${txt}</span>`;
    };
    const fTransfers=evFamTransfers(ev,fid);
    const trRow=fTransfers.length?`<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${fTransfers.map(trChip).join('')}</div>`:'';
    return`<div onclick="openEventFamDetail(${ev.id},${fid})" title="לחצו לפירוט המשפחה" style="border:1px solid ${isMe?c+'22':'var(--border)'};background:${isMe?bg:'transparent'};border-radius:12px;padding:11px 13px;cursor:pointer">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
        <span style="width:11px;height:11px;border-radius:50%;background:${c};flex-shrink:0"></span>
        <span style="flex:1;font-family:var(--font-head);font-size:14px;font-weight:700">${name}${isMe?' <span style="font-family:var(--font);font-size:10px;color:var(--text3);font-weight:600">· אתם</span>':''}</span>
        ${pill}
        <span style="font-size:13px;color:var(--text3);opacity:.6;margin-right:1px">›</span>
      </div>
      <div style="display:flex;gap:18px;font-size:11.5px;color:var(--text2)">
        <span>💸 הוציאו <b style="color:var(--text)">₪${paid.toLocaleString()}</b></span>
        <span>⚖️ החלק ההוגן <b style="color:var(--text)">₪${share.toLocaleString()}</b></span>
      </div>
      ${trRow}
    </div>`;
  }).join('');
  const famSection=_dashSection('👨‍👩‍👧 מאזן משפחות',`<div style="display:flex;flex-direction:column;gap:9px">${famRows}</div>`);

  // ── Breakdown by expense type (item name) ──
  const groups={};
  const add=(name,amt,fromPot)=>{const k=(name||'').trim()||'ללא שם';if(!groups[k])groups[k]={name:k,amt:0,fromPot:false,count:0};groups[k].amt+=amt||0;groups[k].count++;if(fromPot)groups[k].fromPot=true;};
  (ev.expenseItems||[]).forEach(it=>add(it.name,it.amt,false));
  (ev.potExpItems||[]).forEach(it=>add(it.name,it.amt,true));
  const typeRows=Object.values(groups).map(g=>({...g,amt:Math.round(g.amt)})).filter(g=>g.amt>0).sort((a,b)=>b.amt-a.amt);
  const typeTotal=typeRows.reduce((s,g)=>s+g.amt,0);
  const typeMax=typeRows.length?typeRows[0].amt:0;
  // Column (bar) chart: one vertical bar per expense type, height ∝ amount.
  // Scrolls horizontally when there are many types so bars never get too thin.
  const typeCols=typeRows.map((g,i)=>{
    const c=COLORS[i%COLORS.length].c;
    const h=typeMax?Math.max(6,Math.round(g.amt/typeMax*100)):0;
    const pct=typeTotal?Math.round(g.amt/typeTotal*100):0;
    return`<div style="flex:1;min-width:54px;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end">
      <span style="font-family:var(--font-head);font-size:12px;font-weight:700;white-space:nowrap">₪${g.amt.toLocaleString()}</span>
      <span style="font-size:9.5px;color:var(--text3);margin-bottom:4px">${pct}%</span>
      <div style="width:100%;max-width:42px;height:${h}%;background:${c};border-radius:6px 6px 0 0"></div>
      <span style="font-size:10.5px;margin-top:6px;color:var(--text2);text-align:center;line-height:1.15;max-width:66px">${g.fromPot?'💰 ':''}${esc(g.name)}${g.count>1?` <span style="color:var(--text3)">×${g.count}</span>`:''}</span>
    </div>`;
  }).join('');
  const typeInner=typeRows.length?
    `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch"><div style="display:flex;align-items:flex-end;justify-content:${typeRows.length>5?'flex-start':'space-around'};gap:10px;height:158px;padding-top:20px;max-width:640px;margin:0 auto;${typeRows.length>5?'min-width:'+(typeRows.length*64)+'px':''}">${typeCols}</div></div>
     <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;padding-top:10px;border-top:1px solid var(--border)"><span style="font-size:12.5px;font-weight:700">סה"כ פריטים</span><span style="font-family:var(--font-head);font-size:15px;font-weight:700;color:var(--green-mid)">₪${typeTotal.toLocaleString()}</span></div>`
    :`<div style="text-align:center;color:var(--text3);font-size:12.5px;padding:6px 0">אין פריטי הוצאה — העלות מחולקת לפי משפחות בלבד.</div>`;
  const typeSection=_dashSection('📊 פירוט לפי סוג הוצאה',typeInner);

  // ── Savings-pot transfers (read-only summary) — family-to-family "who
  // pays whom" suggestions were removed; everyone pays the treasurer
  // directly now (see openGlobalSettleModal for the direct alternative). ──
  const savingsTransfers=calcTransfers(ev).filter(t=>t.toFid==='__savings__'&&!t.coveredByPot);
  const hasSavingsGoal=savingsTransfers.length>0||(ev.savingsPaid||[]).length>0||(ev.savingsTotal||0)>0;
  const trSection=hasSavingsGoal?_dashSection('💎 קופת חיסכון',savingsTransfers.length?savingsTransfers.map(t=>
    `<div style="font-size:12.5px;padding:6px 0;border-bottom:1px solid var(--border)">💎 <b>${esc(t.from)}</b> משלמים לקופת חיסכון · <b style="color:var(--blue)">₪${t.amt.toLocaleString()}</b></div>`
  ).join(''):`<div style="text-align:center;color:var(--green);font-size:13px;padding:6px 0;font-weight:700">✅ כולם מסודרים!</div>`):'';

  // ── Pot (conditional) ──
  let potSection='';
  if(hasPot){
    const potDeposits=Math.round((ev.potPayments||[]).reduce((s,p)=>s+p.amt,0));
    const kv=(l,v,color)=>`<div style="flex:1;min-width:92px;background:var(--surface2);border-radius:9px;padding:8px 10px"><div style="font-size:10px;color:var(--text2)">${l}</div><div style="font-size:13px;font-weight:800;margin-top:2px;color:${color||'var(--text)'}">${v}</div></div>`;
    potSection=_dashSection('💰 קופת אירוע',
      `<div style="display:flex;flex-wrap:wrap;gap:8px">${kv('יתרה בקופה','₪'+Math.round(potBal).toLocaleString(),'var(--amber)')}${potDeposits?kv('הופקד','₪'+potDeposits.toLocaleString()):''}${potExpTotal?kv('הוצא מהקופה','₪'+Math.round(potExpTotal).toLocaleString()):''}</div>`);
  }

  // ── Savings (conditional) ──
  let savSection='';
  if(ev.savingsTotal){
    savSection=_dashSection('💎 קופת חיסכון',
      `<div style="font-size:12.5px;color:var(--text)">סה"כ <b>₪${Math.round(ev.savingsTotal).toLocaleString()}</b> · <b>₪${savPerFam.toLocaleString()}</b> לכל משפחה</div>`);
  }

  el.innerHTML=`
    <div style="padding:13px 16px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between;gap:8px;position:sticky;top:0;background:var(--surface);z-index:2">
      <div style="min-width:0">
        <div style="font-family:var(--font-head);font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px;flex-wrap:wrap">${esc(ev.name)}<span style="font-family:var(--font);font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:${balanced&&cost>0?'var(--green-bg)':'var(--amber-bg)'};color:${balanced&&cost>0?'var(--green)':'var(--amber)'}">${balanced&&cost>0?'מאוזן':'פעיל'}</span></div>
        ${ev.date&&ev.date!=='לא צוין'?`<div style="font-size:11px;color:var(--text2);margin-top:3px">📅 ${esc(ev.date)}</div>`:''}
      </div>
      <button onclick="closeEventDash()" style="border:none;background:none;font-size:20px;color:var(--text2);cursor:pointer;font-family:var(--font);padding:0;flex-shrink:0;line-height:1">✕</button>
    </div>
    ${meCard}
    ${tilesHtml}
    <div style="padding:4px 16px 14px" class="edit-only"><button onclick="shareExpenseForm(${ev.id})" style="width:100%;padding:11px;border-radius:var(--r2);border:1.5px solid var(--blue-mid);background:var(--blue-bg);color:var(--blue);font-size:13px;font-weight:700;font-family:var(--font);cursor:pointer">📋 שתף טופס הוצאות למשתתפים</button></div>
    ${typeSection}
    ${trSection}
    ${potSection}
    ${savSection}
    ${famSection}
    <div style="padding:14px 16px;border-top:10px solid var(--surface2)">
      <button onclick="closeEventDash()" style="width:100%;padding:11px;border-radius:var(--r2);border:1.5px solid var(--border);background:transparent;color:var(--text2);font-size:13px;font-weight:700;font-family:var(--font);cursor:pointer">סגור</button>
    </div>`;
}
// ── Pot modal ──────────────────────────────
function openPotModal(evId){
  potModalEvId=evId;
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  renderPotModal(ev);
  document.getElementById('potModal').style.display='flex';
}
function closePotModal(){
  document.getElementById('potModal').style.display='none';
  potModalEvId=null;
}
function openPotTransferModal(evId){
  potTrModalEvId=evId;
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  renderPotTransferModal(ev);
  document.getElementById('potTrModal').style.display='flex';
}
function closePotTransferModal(){
  document.getElementById('potTrModal').style.display='none';
  potTrModalEvId=null;
}
function _refreshPotTransferModal(evId){
  if(potTrModalEvId!==evId)return;
  const te=events.find(e=>e.id===evId);if(!te||evPotBal(te)<=0)return closePotTransferModal();
  const adjBal=evAdjBalance(te);
  if(te.participants.some(fid=>(adjBal[fid]||0)>0.5))renderPotTransferModal(te);else closePotTransferModal();
}
function renderPotTransferModal(ev){
  const el=document.getElementById('potTrModalContent');if(!el)return;
  const adjBal=evAdjBalance(ev);
  const potTransfers=calcPotTransfers(ev);
  const excessByFam=calcPotExcessByFamily(ev);
  const creditorFids=ev.participants.filter(fid=>(adjBal[fid]||0)>0.5);
  if(!creditorFids.length){closePotTransferModal();return;}
  const potByCreditor={};
  potTransfers.forEach(t=>{if(!potByCreditor[t.toFid])potByCreditor[t.toFid]={amt:0};potByCreditor[t.toFid].amt+=t.amt;});
  const _sug=fid=>{const fromOthers=(potByCreditor[fid]||{amt:0}).amt;const ownExc=excessByFam[fid]||0;return Math.min(Math.round(adjBal[fid]||0),Math.round(fromOthers+ownExc));};
  const potAvail=Math.round(evNetPotBal(ev));
  const creditorRows=creditorFids.map(fid=>{
    const pf=getFam(fid);if(!pf)return'';
    const name=pf.name.replace('משפחת','').trim();
    const sug=_sug(fid);
    const owed=Math.round(adjBal[fid]||0);
    if(sug<=0.5){
      if(potAvail<=0.5){
        return`<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--border);opacity:0.55">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:700">${esc(name)}</div>
            <div style="font-size:11px;color:var(--text2)">מגיע לו ₪${owed.toLocaleString()} · אין כרגע יתרה בקופה</div>
          </div>
        </div>`;
      }
      const manualMax=Math.min(owed,potAvail);
      const inpId='pot-manual-'+ev.id+'-'+fid;
      return`<div style="padding:10px 16px;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:700">${esc(name)}</div>
            <div style="font-size:11px;color:var(--text2)">מגיע לו ₪${owed.toLocaleString()} · הקופה כרגע הוקצתה למישהו אחר, אפשר להעביר לו ידנית</div>
          </div>
        </div>
        <div style="display:flex;gap:6px">
          <input id="${inpId}" type="number" min="1" max="${manualMax}" value="${manualMax}" inputmode="numeric" style="width:80px;flex-shrink:0;border:1.5px solid var(--border);border-radius:8px;padding:6px 8px;font-size:13px;font-family:var(--font);background:var(--bg);color:var(--text);direction:ltr;text-align:center">
          <button onclick="releasePotManualM(${ev.id},${fid},'${inpId}',false)" style="flex:1;padding:7px 10px;border-radius:8px;border:none;background:var(--blue-mid);color:#fff;font-size:12px;font-weight:700;font-family:var(--font);cursor:pointer;white-space:nowrap">↗ העבר ידנית</button>
          <button onclick="releasePotManualM(${ev.id},${fid},'${inpId}',true)" style="flex:1;padding:7px 10px;border-radius:8px;border:none;background:var(--green-mid);color:#fff;font-size:12px;font-weight:700;font-family:var(--font);cursor:pointer;white-space:nowrap">🏦 קופה</button>
        </div>
      </div>`;
    }
    return`<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700">${esc(name)}</div>
        <div style="font-size:11px;color:var(--text2)">מגיע לו ₪${sug.toLocaleString()}</div>
      </div>
      <button onclick="releasePotToOneM(${ev.id},${fid},false)" style="padding:7px 12px;border-radius:8px;border:none;background:var(--blue-mid);color:#fff;font-size:12px;font-weight:700;font-family:var(--font);cursor:pointer;white-space:nowrap">↗ העבר</button>
      <button onclick="releasePotToOneM(${ev.id},${fid},true)" style="padding:7px 12px;border-radius:8px;border:none;background:var(--green-mid);color:#fff;font-size:12px;font-weight:700;font-family:var(--font);cursor:pointer;white-space:nowrap">🏦 ארנק</button>
    </div>`;
  }).join('');
  el.innerHTML=`
    <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
      <div>
        <div style="font-size:14px;font-weight:700">↗ העברה מהקופה</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">${esc(ev.name)}</div>
      </div>
      <button onclick="closePotTransferModal()" style="border:none;background:none;font-size:20px;color:var(--text2);cursor:pointer;font-family:var(--font);padding:0">✕</button>
    </div>
    <div style="padding:8px 16px 0"><div style="font-size:11px;font-weight:700;color:var(--text2)">זכאים לקבל</div></div>
    ${creditorRows}
    <div style="padding:8px 16px 12px">
      <button onclick="closePotTransferModal()" style="width:100%;padding:10px;border-radius:var(--r2);border:1.5px solid var(--border);background:transparent;color:var(--text2);font-size:13px;font-weight:700;font-family:var(--font);cursor:pointer">סגור</button>
    </div>`;
}
function renderPotModal(ev){
  const el=document.getElementById('potModalContent');if(!el)return;
  const potPayments=ev.potPayments||[];
  const potTotal=evPotBal(ev);
  const potExpItems=ev.potExpItems||[];
  const potExpTot=evPotExpTotal(ev);
  const effBal=Math.round(potTotal-potExpTot);
  const potTransfers=calcPotTransfers(ev);
  const adjBal=evAdjBalance(ev);
  const creditorFids=ev.participants.filter(fid=>(adjBal[fid]||0)>0.5);
  const potByCreditor={};
  potTransfers.forEach(t=>{if(!potByCreditor[t.toFid])potByCreditor[t.toFid]={name:t.to,fid:t.toFid,amt:0};potByCreditor[t.toFid].amt+=t.amt;});
  const excessByFam=calcPotExcessByFamily(ev);
  const potTransferBtn=creditorFids.length?`<div class="edit-only" style="padding:10px 16px;border-bottom:1px solid var(--border)">
    <button onclick="openPotTransferModal(${ev.id})" style="width:100%;padding:10px;border-radius:var(--r2);border:none;background:var(--blue-mid);color:#fff;font-size:13px;font-weight:700;font-family:var(--font);cursor:pointer">↗ העברה לזכאים${creditorFids.length>1?' ('+creditorFids.length+')':''}</button>
  </div>`:'';

  const potDistributed=potTransfers.reduce((s,t)=>s+t.amt,0)+Object.entries(excessByFam).filter(([fidStr])=>(adjBal[parseInt(fidStr)]||0)>0.5).reduce((s,[,e])=>s+e,0);
  const potExcess=Math.round(potTotal-potDistributed);
  const settledList=ev.settled||[];
  const _potByTo={};const _nonPot=[];
  settledList.forEach(s=>{
    if(s.method==='pot'){const k=s.toFid!=null?String(s.toFid):s.to;if(!_potByTo[k])_potByTo[k]={to:s.to,amt:0};_potByTo[k].amt+=s.amt;}
    else _nonPot.push(s);
  });
  const _savingsXfers=(ev.potToSavings||[]).map(p=>({method:'pot-savings',to:'קופת חיסכון',amt:p.amt,date:p.date}));
  const _mergedDone=[...Object.values(_potByTo).map(p=>({method:'pot',to:p.to,amt:p.amt})),..._nonPot,..._savingsXfers];
  const doneRows=_mergedDone.length?`<div style="border-top:1px solid var(--border)"><div style="font-size:11px;font-weight:700;color:var(--text2);padding:8px 16px 4px">העברות שבוצעו:</div><div style="padding:0 16px 4px">`+_mergedDone.map(s=>{
    const icon=s.method==='fund'?'🏦':s.method==='pot'?'💰':s.method==='pot-savings'?'💎':'✓';
    const badge=s.method==='fund'?`<span style="font-size:10px;background:var(--blue-bg);color:var(--blue);padding:1px 6px;border-radius:10px">קופה</span>`:s.method==='pot'?`<span style="font-size:10px;background:var(--amber-bg);color:var(--amber);padding:1px 6px;border-radius:10px">קופת אירוע</span>`:s.method==='pot-savings'?`<span style="font-size:10px;background:var(--green-bg);color:var(--green-mid);padding:1px 6px;border-radius:10px">חיסכון</span>`:`<span style="font-size:10px;background:var(--green-bg);color:var(--green);padding:1px 6px;border-radius:10px">ישיר</span>`;
    const fromLabel=(s.method==='pot'||s.method==='pot-savings')?'קופת האירוע':s.from;
    return`<div style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;color:var(--text2)"><span style="color:var(--green-mid)">${icon}</span><span style="flex:1"><b style="color:var(--text)">${esc(fromLabel)}</b> הועבר ל<b style="color:var(--text)">${esc(s.to)}</b> ₪${s.amt.toLocaleString()}</span>${badge}</div>`;
  }).join('')+'</div></div>':'';
  const expRows=potExpItems.length?`<div style="border-bottom:1px solid var(--border)">
    <div style="font-size:11px;font-weight:700;color:var(--text2);padding:8px 16px 4px">הוצאות מהקופה:</div>
    ${potExpItems.map(it=>`<div style="border-top:1px solid var(--border);display:flex;align-items:center;gap:10px;padding:10px 16px">
      <div style="width:32px;height:32px;border-radius:50%;background:var(--amber-bg);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">🛒</div>
      <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:700">${esc(it.name)}</div>${it.date?`<div style="font-size:11px;color:var(--text2);margin-top:1px">${esc(it.date)}</div>`:''}</div>
      <div style="font-size:14px;font-weight:700;color:var(--amber)">₪${it.amt.toLocaleString()}</div>
      <button class="edit-only" onclick="deletePotExpItem(${ev.id},${it.id})" style="background:none;border:none;color:var(--red-mid);cursor:pointer;font-size:14px;padding:0 4px;font-family:var(--font)" title="מחק">🗑</button>
    </div>`).join('')}
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 16px;border-top:1px solid var(--border);background:var(--surface2)">
      <span style="font-size:12px;font-weight:700;color:var(--text2)">יתרה אחרי הוצאות</span>
      <span style="font-size:13px;font-weight:700;color:var(--amber)">₪${effBal.toLocaleString()}</span>
    </div>
  </div>`:'';
  el.innerHTML=`
    <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
      <div><div style="font-size:14px;font-weight:700">💰 קופת האירוע</div><div style="font-size:11px;color:var(--text2);margin-top:2px">₪${potTotal.toLocaleString()}${potExpTot>0?` · הוצאות ₪${potExpTot.toLocaleString()} · יתרה ₪${effBal.toLocaleString()}`:''} · ${esc(ev.name)}</div></div>
      <button onclick="closePotModal()" style="border:none;background:none;font-size:20px;color:var(--text2);cursor:pointer;font-family:var(--font);padding:0">✕</button>
    </div>
    <div style="border-bottom:1px solid var(--border)">
      <div style="font-size:11px;font-weight:700;color:var(--text2);padding:8px 16px 4px">הפקדות:</div>
      ${(()=>{const byFam={};potPayments.forEach(p=>{if(!byFam[p.famId])byFam[p.famId]=[];byFam[p.famId].push(p);});(ev.settled||[]).filter(s=>(s.method==='pot'||s.method==='pot-refund')&&s.fromFid!=null).forEach(s=>{if(!byFam[s.fromFid])byFam[s.fromFid]=[];});const ord=families.map(f=>f.id).filter(fid=>byFam[fid]);return ord.map(fid=>{const pmnts=byFam[fid]||[];const pf=getFam(fid);if(!pf)return'';const name=pf.name.replace('משפחת','').trim();const distFromThis=(ev.settled||[]).filter(s=>s.method==='pot'&&s.fromFid===fid).reduce((s,t)=>s+t.amt,0);const refundFromThis=(ev.settled||[]).filter(s=>s.method==='pot-refund'&&s.fromFid===fid).reduce((s,t)=>s+t.amt,0);const tot=pmnts.reduce((s,p)=>s+p.amt,0)+distFromThis+refundFromThis;const multi=pmnts.length>1;const key=ev.id+'-pot-'+fid;const isExp=expandedPotFamilies.has(key);const fromWallet=tot>0?evPotFromWallet(ev,fid):0;const walletNote=fromWallet>0.5&&fromWallet>=tot-0.5?`<div style="font-size:11px;color:var(--amber);margin-top:1px">🏦 הועבר מהארנק ₪${tot.toLocaleString()} לקופת האירוע</div>`:fromWallet>0.5?`<div style="font-size:11px;color:var(--amber);margin-top:1px">🏦 מתוכם ₪${fromWallet.toLocaleString()} מהארנק</div>`:'';const delBtn=(i)=>`<button class="edit-only" onclick="deletePotDeposit(${ev.id},${fid},${i})" style="background:none;border:none;color:var(--red-mid);cursor:pointer;font-size:14px;padding:0 4px;font-family:var(--font)" title="מחק">🗑</button>`;const details=multi&&isExp?'<div style="background:var(--surface2);padding:6px 16px 6px 32px">'+pmnts.map((p,i)=>`<div style="font-size:12px;color:var(--text2);padding:3px 0;display:flex;justify-content:space-between;align-items:center"><span>תשלום ${i+1} · ₪${p.amt.toLocaleString()}</span>${delBtn(i)}</div>`).join('')+'</div>':'';return`<div style="border-top:1px solid var(--border)"><div style="display:flex;align-items:center;gap:10px;padding:10px 16px"><div style="width:32px;height:32px;border-radius:50%;background:var(--green-bg);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">✓</div><div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:700;color:var(--text)">${esc(name)}</div><div style="font-size:12px;color:var(--green-mid);font-weight:600;margin-top:1px">₪${tot.toLocaleString()}</div>${walletNote}${refundFromThis>0.5?`<div style="font-size:11px;color:var(--blue-mid);margin-top:1px">↩ הוחזר עודף ₪${refundFromThis.toLocaleString()}</div>`:''}</div>${multi?`<button onclick="togglePotModalFamily(${ev.id},${fid})" style="background:var(--surface2);border:1px solid var(--border);border-radius:20px;font-size:11px;color:var(--text2);cursor:pointer;padding:3px 8px;font-weight:700;font-family:var(--font)">${isExp?'▲ סגור':'▼ '+pmnts.length+' תשלומים'}</button>`:delBtn(0)}</div>${details}</div>`;}).join('');})()}
    </div>
    ${expRows}
    ${potTransferBtn}
    ${(()=>{const _sTotal=(ev.savingsTotal||0);const _sPaid=(ev.savingsPaid||[]).reduce((s,p)=>s+p.amt,0);const _sPot2Sav=(ev.potToSavings||[]).reduce((s,p)=>s+p.amt,0);const _sOwed=Math.round(_sTotal+evSavingsSurplus(ev)-_sPaid-_sPot2Sav);const _sAmt=Math.min(effBal,Math.max(0,_sOwed));return _sAmt>0?`<div class="edit-only" style="padding:10px 16px;border-bottom:1px solid var(--border)"><button onclick="releasePotToSavings(${ev.id},${_sAmt})" style="width:100%;padding:10px;border-radius:var(--r2);border:none;background:var(--green-mid);color:#fff;font-size:13px;font-weight:700;font-family:var(--font);cursor:pointer">💎 העבר לקופת חיסכון (₪${_sAmt.toLocaleString()})</button></div>`:'';})()}
    ${!creditorFids.length&&potPayments.length&&potExcess<=0.5?`<div style="padding:10px 16px"><button class="edit-only" onclick="releasePotM(${ev.id})" style="width:100%;padding:10px;border-radius:var(--r2);border:none;background:var(--blue-mid);color:#fff;font-size:13px;font-weight:700;font-family:var(--font);cursor:pointer">✓ סמן כהועבר</button></div>`:''}
    ${doneRows}
    <div style="padding:4px 16px 10px">
      <button onclick="closePotModal()" style="width:100%;padding:10px;border-radius:var(--r2);border:1.5px solid var(--border);background:transparent;color:var(--text2);font-size:13px;font-weight:700;font-family:var(--font);cursor:pointer">סגור</button>
    </div>`;
}
function releasePotToOneM(evId,creditorFid,toFund){
  releasePotToOne(evId,creditorFid,toFund);
  const ev=events.find(e=>e.id===evId);
  if(ev&&evPotTotal(ev)>0)renderPotModal(ev);else closePotModal();
  _refreshPotTransferModal(evId);
}
function releasePotManualM(evId,creditorFid,inpId,toFund){
  const amt=parseFloat(document.getElementById(inpId)?.value||'0');
  if(!amt||amt<=0){showToast('הזן סכום');return;}
  releasePotManual(evId,creditorFid,amt,toFund);
  const ev=events.find(e=>e.id===evId);
  if(ev&&evPotTotal(ev)>0)renderPotModal(ev);else closePotModal();
  _refreshPotTransferModal(evId);
}
function releasePotM(evId){
  releasePot(evId);
  closePotModal();
  closePotTransferModal();
}
function deletePotDeposit(evId,famId,localIdx){
  const ev=events.find(e=>e.id===evId);if(!ev||!ev.potPayments)return;
  let count=0;
  const gi=ev.potPayments.findIndex(p=>{
    if(p.famId===famId){if(count===localIdx)return true;count++;}
    return false;
  });
  if(gi<0)return;
  const removed=ev.potPayments[gi];
  ev.potPayments.splice(gi,1);
  // A deposit made "from wallet" (useFundForCumPot) already debited fund.famBalances
  // and logged a payout — undo both here, or the money just disappears (not in the
  // event pot anymore, never credited back to the wallet either).
  if(removed.fromFund){
    const key=String(famId);
    fund.famBalances[key]=(fund.famBalances[key]||0)+removed.amt;
    const famName=(getFam(famId)||{}).name?.replace('משפחת','').trim()||'';
    fund.transactions.push({id:nxtTx++,type:'deposit',famId,amount:removed.amt,evId:ev.id,
      desc:'ביטול הפקדה לקופת האירוע · '+ev.name+' → '+famName,
      date:new Date().toLocaleDateString('he-IL')});
  }
  save();render();
  // refresh pot modal if open
  const modal=document.getElementById('potModal');
  if(modal&&modal.style.display==='flex'){
    if(evPotTotal(ev)>0)renderPotModal(ev);else closePotModal();
  }
}
function deletePotExpItem(evId,itemId){
  const ev=events.find(e=>e.id===evId);if(!ev||!ev.potExpItems)return;
  ev.potExpItems=ev.potExpItems.filter(it=>it.id!==itemId);
  save();render();
  const modal=document.getElementById('potModal');
  if(modal&&modal.style.display==='flex'){
    if(evPotTotal(ev)>0)renderPotModal(ev);else closePotModal();
  }
}
// ──────────────────────────────────────────
function openCumPot(evId){
  const ev=events.find(e=>e.id===evId);if(!ev)return;
  cumPotEvId=evId; cumPotFamId=null;
  document.getElementById('cumPotAmt').value='';
  const errEl=document.getElementById('cumPotErr');if(errEl)errEl.style.display='none';
  const picker=document.getElementById('cumPotFamPicker');
  picker.innerHTML=ev.participants.map(fid=>{
    const f=getFam(fid);if(!f)return'';
    return`<button onclick="selectCumPotFam(${fid})" id="cumpotfam-${fid}" style="padding:5px 12px;border-radius:20px;border:1.5px solid var(--border);background:transparent;color:var(--text2);font-size:13px;font-weight:600;font-family:var(--font);cursor:pointer">${esc(f.name.replace('משפחת','').trim())}</button>`;
  }).join('');
  document.getElementById('cumPotOverlay').style.display='flex';
}
function selectCumPotFam(famId){
  cumPotFamId=famId;
  _cumPotFromFund=false;
  const ev=events.find(e=>e.id===cumPotEvId);if(!ev)return;
  ev.participants.forEach(fid=>{
    const btn=document.getElementById('cumpotfam-'+fid);if(!btn)return;
    const cl=col(fid);
    if(fid===famId){btn.style.background=cl.bg;btn.style.color=cl.c;btn.style.borderColor=cl.c;}
    else{btn.style.background='transparent';btn.style.color='var(--text2)';btn.style.borderColor='var(--border)';}
  });
  const owed=Math.round(Math.max(0,-(evAdjBalance(ev)[famId]||0)));
  const amtEl=document.getElementById('cumPotAmt');
  if(amtEl)amtEl.value=owed>0?owed:'';
  const fundBal=Math.round(famFundBal(famId));
  const fundLine=document.getElementById('cumPotFundLine');
  const fundText=document.getElementById('cumPotFundText');
  if(fundLine&&fundText){
    if(fundBal>0){
      const suggested=owed>0?Math.min(fundBal,owed):fundBal;
      const extra=fundBal>suggested?` (יתרה: ₪${fundBal.toLocaleString()})` :'';
      fundText.textContent=`🏦 יועבר מהארנק: ₪${suggested.toLocaleString()}${extra}`;
      fundLine.style.display='flex';
    } else {
      fundLine.style.display='none';
    }
  }
}
function closeCumPot(){
  document.getElementById('cumPotOverlay').style.display='none';
  cumPotEvId=null; cumPotFamId=null; _cumPotFromFund=false;
  const fl=document.getElementById('cumPotFundLine');if(fl)fl.style.display='none';
}
function useFundForCumPot(){
  if(!cumPotFamId)return;
  const fundBal=Math.round(famFundBal(cumPotFamId));
  if(fundBal<=0)return;
  const ev=events.find(e=>e.id===cumPotEvId);
  const owed=ev?Math.round(Math.max(0,-(evAdjBalance(ev)[cumPotFamId]||0))):0;
  const suggested=owed>0?Math.min(fundBal,owed):fundBal;
  const el=document.getElementById('cumPotAmt');
  if(el)el.value=suggested>0?suggested:fundBal;
  _cumPotFromFund=true;
  const fundText=document.getElementById('cumPotFundText');
  if(fundText)fundText.textContent=`🏦 יועבר מהארנק: ₪${(suggested>0?suggested:fundBal).toLocaleString()} ✓`;
}
function doDepositToCumPot(){
  const amt=parseFloat(document.getElementById('cumPotAmt').value)||0;
  const errEl=document.getElementById('cumPotErr');
  if(!cumPotFamId||amt<=0){if(errEl)errEl.style.display='block';return;}
  if(errEl)errEl.style.display='none';
  const ev=events.find(e=>e.id===cumPotEvId);if(!ev)return;
  if(!ev.potPayments)ev.potPayments=[];
  const roundAmt=Math.round(amt);
  const savedFamId=cumPotFamId;
  const savedEvId=cumPotEvId;
  const fromFund=_cumPotFromFund;
  if(fromFund){
    const key=String(savedFamId);
    const bal=fund.famBalances[key]||0;
    if(bal<roundAmt){alert('אין מספיק יתרה בארנק (₪'+Math.round(bal).toLocaleString()+')');return;}
    fund.famBalances[key]=bal-roundAmt;
    const _cumPotFamName=(getFam(savedFamId)||{}).name?.replace('משפחת','').trim()||'';
    fund.transactions.push({id:nxtTx++,type:'payout',famId:savedFamId,amount:roundAmt,evId:ev.id,
      desc:'העברה לקופת האירוע · '+ev.name+' → '+_cumPotFamName,
      date:new Date().toLocaleDateString('he-IL')});
  }
  ev.potPayments.push({famId:savedFamId,amt:roundAmt,fromFund});
  closeCumPot();
  save();render();
  const _potF=getFam(savedFamId);
  const _potEv=events.find(e=>e.id===savedEvId);
  // If deposit settles the family's balance, skip deposit email — the close email covers it
  const _isSettled=_potEv&&(evAdjBalance(_potEv)[savedFamId]||0)>=-0.5;
  if(!fromFund&&!_isSettled&&_potEv&&_potF&&(_potF.email||_potF.email2)){
    const _potTotal=(_potEv.potPayments||[]).filter(p=>Number(p.famId)===Number(savedFamId)).reduce((s,p)=>s+p.amt,0);
    const _potShare=Math.round(evShares(_potEv)[savedFamId]||0);
    const _potMsg=`הפקדה של ₪${roundAmt.toLocaleString()} לקופת האירוע "${_potEv.name}" נרשמה.\n\nסה"כ הפקדות שלך לקופה זו: ₪${_potTotal.toLocaleString()}\n\n💓 נכון להיום, החלק שלך לפי ההוצאות הנוכחיות: ₪${_potShare.toLocaleString()}`;
    const _potBody=_eCard([['הפקדה',`<span style="color:#1E88D8;font-weight:700">₪${roundAmt.toLocaleString()}</span>`,false],['סה"כ הפקדות שלך',`₪${_potTotal.toLocaleString()}`,true]])+`<p style="text-align:center;margin:4px 0 0;font-size:14px;color:#555">💓 נכון להיום, החלק שלך לפי ההוצאות הנוכחיות: <strong>₪${_potShare.toLocaleString()}</strong></p>`;
    const _potHtml=_emailWrap(_potBody,_potEv.name,'💰',_ejsUrl()+'#event-'+savedEvId,_potF.name);
    sendEmailNotif([{email:_potF.email,email2:_potF.email2,name:_potF.name.replace('משפחת','').trim()}],'💰 הפקדה לקופת האירוע · ינקלביץ',_potMsg,_potHtml);
  }
}

function applyEditMode(){
  document.body.classList.toggle('edit-mode',editMode);
  const icon=document.getElementById('lockIcon');
  if(icon)icon.textContent=editMode?'🔓':'🔒';
  if(currentShell==='home')renderFamilyHome();
}
// Called only at the moment edit mode is actually unlocked (not on every render(),
// which also calls applyEditMode()) — otherwise this would reopen the modal on top
// of the admin every time anything saves, even right after they closed it.
function _checkPendingTransferClaims(){
  if(paymentClaims.some(c=>c.kind==='transfer'))openClaimsModal();
}
function openLockModal(){
  renderLockModal(editMode?'lock':adminPass?'unlock':'set');
  document.getElementById('lockModal').style.display='flex';
}
function closeLockModal(){document.getElementById('lockModal').style.display='none';}
function renderLockModal(mode){
  const el=document.getElementById('lockModalContent');if(!el)return;
  if(mode==='lock'){
    const hasBio=!!localStorage.getItem('biometricCredId');
    el.innerHTML=`<div style="font-size:15px;font-weight:700;margin-bottom:12px;text-align:center">🔓 מצב עריכה פעיל</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:16px;text-align:center">רוצה לנעול את האפליקציה?</div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button onclick="lockApp()" style="flex:1;padding:12px;border-radius:var(--r2);border:none;background:var(--text);color:#fff;font-size:14px;font-weight:700;font-family:var(--font);cursor:pointer">🔒 נעל</button>
        <button onclick="closeLockModal()" style="flex:1;padding:12px;border-radius:var(--r2);border:1.5px solid var(--border);background:transparent;color:var(--text2);font-size:14px;font-weight:700;font-family:var(--font);cursor:pointer">ביטול</button>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:12px">
        <button id="biometricToggleBtn" onclick="${hasBio?'disableBiometric':'enableBiometric'}()" style="width:100%;padding:10px;border-radius:var(--r2);border:1.5px solid var(--border);background:transparent;color:var(--text2);font-size:13px;font-weight:600;font-family:var(--font);cursor:pointer">${hasBio?'🗑️ בטל טביעת אצבע':'👆 הפעל טביעת אצבע'}</button>
        <div id="biometricStatus" style="font-size:11px;color:var(--green);text-align:center;margin-top:5px">${hasBio?'✓ טביעת אצבע פעילה':''}</div>
      </div>`;
  } else if(mode==='set'){
    el.innerHTML=`<div style="font-size:15px;font-weight:700;margin-bottom:8px;text-align:center">🔐 הגדר סיסמה</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:14px;text-align:center">רק מי שיש לו סיסמה יוכל לשנות נתונים. כולם יוכלו לראות הכל.</div>
      <input id="newPassInp" type="password" placeholder="סיסמה חדשה" style="width:100%;border:1.5px solid var(--border);border-radius:var(--r2);padding:10px 12px;font-size:15px;font-family:var(--font);background:var(--bg);color:var(--text);margin-bottom:8px;box-sizing:border-box;direction:ltr;text-align:center">
      <input id="newPassConf" type="password" placeholder="אשר סיסמה" style="width:100%;border:1.5px solid var(--border);border-radius:var(--r2);padding:10px 12px;font-size:15px;font-family:var(--font);background:var(--bg);color:var(--text);margin-bottom:8px;box-sizing:border-box;direction:ltr;text-align:center" onkeydown="if(event.key==='Enter')setAdminPass()">
      <div id="passSetErr" style="font-size:12px;color:var(--red-mid);margin-bottom:8px;display:none;text-align:center"></div>
      <div style="display:flex;gap:8px">
        <button onclick="setAdminPass()" style="flex:1;padding:12px;border-radius:var(--r2);border:none;background:var(--text);color:#fff;font-size:14px;font-weight:700;font-family:var(--font);cursor:pointer">✓ הגדר</button>
        <button onclick="closeLockModal()" style="flex:1;padding:12px;border-radius:var(--r2);border:1.5px solid var(--border);background:transparent;color:var(--text2);font-size:14px;font-weight:700;font-family:var(--font);cursor:pointer">ביטול</button>
      </div>`;
    setTimeout(()=>{const i=document.getElementById('newPassInp');if(i)i.focus();},50);
  } else {
    const hasBio=!!localStorage.getItem('biometricCredId');
    el.innerHTML=`<div style="font-size:15px;font-weight:700;margin-bottom:14px;text-align:center">🔒 הזן סיסמה</div>
      ${hasBio?`<button id="biometricBtn" onclick="doBiometricUnlock()" style="width:100%;padding:14px;border-radius:var(--r2);border:none;background:var(--blue-mid);color:#fff;font-size:15px;font-weight:700;font-family:var(--font);cursor:pointer;margin-bottom:10px">👆 כניסה עם טביעת אצבע</button><div style="text-align:center;font-size:11px;color:var(--text2);margin-bottom:10px">— או עם סיסמה —</div>`:''}
      <input id="unlockInp" type="password" placeholder="סיסמה" style="width:100%;border:1.5px solid var(--border);border-radius:var(--r2);padding:10px 12px;font-size:15px;font-family:var(--font);background:var(--bg);color:var(--text);margin-bottom:8px;box-sizing:border-box;direction:ltr;text-align:center" onkeydown="if(event.key==='Enter')submitUnlock()">
      <div id="passErr" style="font-size:12px;color:var(--red-mid);margin-bottom:8px;display:none;text-align:center">סיסמה שגויה ❌</div>
      <div style="display:flex;gap:8px">
        <button onclick="submitUnlock()" style="flex:1;padding:12px;border-radius:var(--r2);border:none;background:var(--text);color:#fff;font-size:14px;font-weight:700;font-family:var(--font);cursor:pointer">כניסה</button>
        <button onclick="closeLockModal()" style="flex:1;padding:12px;border-radius:var(--r2);border:1.5px solid var(--border);background:transparent;color:var(--text2);font-size:14px;font-weight:700;font-family:var(--font);cursor:pointer">ביטול</button>
      </div>`;
    if(hasBio) setTimeout(()=>doBiometricUnlock(),300);
    else setTimeout(()=>{const i=document.getElementById('unlockInp');if(i)i.focus();},50);
  }
}
function setAdminPass(){
  const p1=(document.getElementById('newPassInp')||{}).value||'';
  const p2=(document.getElementById('newPassConf')||{}).value||'';
  const err=document.getElementById('passSetErr');
  if(!p1){if(err){err.textContent='נא להזין סיסמה';err.style.display='block';}return;}
  if(p1!==p2){if(err){err.textContent='הסיסמאות אינן תואמות';err.style.display='block';}return;}
  adminPass=p1;editMode=true;
  if(_isAdminPage())localStorage.setItem('adminRemembered','1');
  applyEditMode();_checkPendingTransferClaims();_refreshAdminPushFlag();save();closeLockModal();
}
function submitUnlock(){
  const val=(document.getElementById('unlockInp')||{}).value||'';
  if(val===adminPass){
    editMode=true;
    if(_isAdminPage())localStorage.setItem('adminRemembered','1');
    applyEditMode();_checkPendingTransferClaims();_refreshAdminPushFlag();closeLockModal();
  } else {
    const err=document.getElementById('passErr');if(err)err.style.display='block';
    const inp=document.getElementById('unlockInp');if(inp){inp.value='';inp.focus();}
  }
}
function lockApp(){
  editMode=false;
  applyEditMode();closeLockModal();
}
function _ab2b64(buf){return btoa(String.fromCharCode(...new Uint8Array(buf)));}
function _b642ab(b64){const bin=atob(b64);const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);return arr.buffer;}
async function registerBiometric(){
  try{
    const cred=await navigator.credentials.create({publicKey:{
      challenge:crypto.getRandomValues(new Uint8Array(32)),
      rp:{name:'ינקלביץ',id:location.hostname},
      user:{id:crypto.getRandomValues(new Uint8Array(16)),name:'admin',displayName:'מנהל'},
      pubKeyCredParams:[{alg:-7,type:'public-key'},{alg:-257,type:'public-key'}],
      authenticatorSelection:{authenticatorAttachment:'platform',userVerification:'required'},
      timeout:60000
    }});
    localStorage.setItem('biometricCredId',_ab2b64(cred.rawId));
    return true;
  }catch(e){return false;}
}
async function enableBiometric(){
  if(!window.PublicKeyCredential){alert('הדפדפן שלך לא תומך באימות ביומטרי');return;}
  const btn=document.getElementById('biometricToggleBtn');
  if(btn){btn.disabled=true;btn.textContent='⏳...';}
  const ok=await registerBiometric();
  if(btn){btn.disabled=false;}
  if(ok){
    if(btn){btn.textContent='🗑️ בטל טביעת אצבע';btn.onclick=disableBiometric;}
    const st=document.getElementById('biometricStatus');if(st){st.textContent='✓ טביעת אצבע פעילה';st.style.color='var(--green)';}
  } else {
    if(btn){btn.textContent='👆 הפעל טביעת אצבע';btn.onclick=enableBiometric;}
  }
}
function disableBiometric(){
  localStorage.removeItem('biometricCredId');
  const btn=document.getElementById('biometricToggleBtn');
  if(btn){btn.textContent='👆 הפעל טביעת אצבע';btn.onclick=enableBiometric;}
  const st=document.getElementById('biometricStatus');if(st)st.textContent='';
}
async function tryBiometric(){
  const b64=localStorage.getItem('biometricCredId');
  if(!b64||!window.PublicKeyCredential)return false;
  try{
    await navigator.credentials.get({publicKey:{
      challenge:crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials:[{id:_b642ab(b64),type:'public-key'}],
      userVerification:'required',
      timeout:60000
    }});
    return true;
  }catch(e){return false;}
}
async function doBiometricUnlock(){
  const btn=document.getElementById('biometricBtn');
  if(btn){btn.disabled=true;btn.textContent='⏳ מאמת...';}
  const ok=await tryBiometric();
  if(ok){editMode=true;applyEditMode();_checkPendingTransferClaims();_refreshAdminPushFlag();closeLockModal();}
  else if(btn){btn.disabled=false;btn.textContent='👆 כניסה עם טביעת אצבע';}
}
async function autoUnlockAdmin(){
  if(!_isAdminPage()||editMode)return;
  if(adminPass&&localStorage.getItem('adminRemembered')==='1'){
    editMode=true;
    applyEditMode();_checkPendingTransferClaims();
    return;
  }
  if(adminPass&&localStorage.getItem('biometricCredId')){
    const ok=await tryBiometric();
    if(ok){editMode=true;localStorage.setItem('adminRemembered','1');applyEditMode();_checkPendingTransferClaims();return;}
  }
  openLockModal();
}
const _CURMAP={'₪':'ILS','$':'USD','€':'EUR','£':'GBP'};
let _rateCache={};
async function _getRate(sym){
  if(!sym||sym==='₪')return 1;
  const today=new Date().toISOString().slice(0,10);
  if(_rateCache[sym]?.date===today)return _rateCache[sym].rate;
  try{
    const code=_CURMAP[sym]||sym;
    const r=await fetch('https://open.er-api.com/v6/latest/'+code);
    const d=await r.json();
    const rate=d.rates?.ILS;
    if(rate)_rateCache[sym]={rate,date:today};
    return rate||null;
  }catch(e){return null;}
}
async function _updateCurHint(amtId,hintId,curId){
  const amt=parseFloat(document.getElementById(amtId)?.value)||0;
  const sym=document.getElementById(curId)?.value||'₪';
  const hint=document.getElementById(hintId);
  if(!hint)return;
  if(!amt||sym==='₪'){hint.textContent='';return;}
  hint.textContent='מחשב שער...';
  const rate=await _getRate(sym);
  if(!rate){hint.textContent='לא ניתן לקבל שער';return;}
  hint.textContent=amt+sym+' = ₪'+Math.round(amt*rate).toLocaleString()+' (שער '+rate.toFixed(3)+')';
}
async function _toILS(amtId,curId){
  const amt=parseFloat(document.getElementById(amtId)?.value)||0;
  const sym=document.getElementById(curId)?.value||'₪';
  if(sym==='₪'||!amt)return amt;
  const rate=await _getRate(sym);
  return rate?Math.round(amt*rate):amt;
}
async function _updateCustomTotal(){
  const sym=document.getElementById('customCur')?.value||'₪';
  const rate=sym==='₪'?1:((await _getRate(sym))||1);
  let total=0;
  const selected=families.filter(f=>{ const c=document.getElementById('chip-'+f.id); return c&&c.classList.contains('on'); });
  selected.forEach(f=>{total+=Math.round(_custFamTotal(f.id)*rate);});
  const el=document.getElementById('formTotalCost');
  if(el)el.textContent='₪'+total.toLocaleString();
  updateExpensePickSummary();
}

applyEditMode();
load().then(async()=>{await autoUnlockAdmin();if(window.location.hash)handleHash();startRealtimeSync();startFormImportSync();renderNotifBtn();if(_notifOk()){registerFCMToken();}});
loadEjsSettings();
loadPaymentSettings();
window.addEventListener('hashchange',handleHash);

// Swipe between tabs
(function(){
  const TABS=['home','events','archive'];
  const NAV={home:'nb-home',events:'nb-events'};
  const OVERLAYS=['newFormOverlay','famPickOverlay','childOverrideOverlay','expenseOverlay','famEditOverlay','depositOverlay','goalFormOverlay','goalDepositOverlay','addExpItemOverlay','cumPotOverlay'];
  let sx=0,sy=0,st=0,hBlocked=false;
  function _isHScroll(el){while(el&&el!==document.body){const ox=getComputedStyle(el).overflowX;if((ox==='auto'||ox==='scroll')&&el.scrollWidth>el.clientWidth+2)return true;el=el.parentElement;}return false;}
  document.addEventListener('touchstart',e=>{
    if(e.touches.length!==1)return;
    sx=e.touches[0].clientX;sy=e.touches[0].clientY;st=Date.now();
    hBlocked=_isHScroll(e.target);
  },{passive:true});
  document.addEventListener('touchend',e=>{
    if(e.changedTouches.length!==1)return;
    const dx=e.changedTouches[0].clientX-sx;
    const dy=e.changedTouches[0].clientY-sy;
    if(Date.now()-st>600||Math.abs(dx)<50||Math.abs(dx)<Math.abs(dy)*1.3)return;
    if(hBlocked&&Math.abs(dx)>Math.abs(dy))return;
    if(OVERLAYS.some(id=>{const o=document.getElementById(id);return o&&o.style.display==='flex';}))return;
    if(document.getElementById('chatSheet')?.classList.contains('open'))return;
    // Home shell ↔ pay shell
    if(document.body.classList.contains('at-home')){
      if(dx>0){switchShell('pay');goTab('home',document.getElementById('nb-home'));}
      return;
    }
    // Swipe between tabs
    const cur=TABS.findIndex(t=>document.getElementById('view-'+t)?.classList.contains('active'));
    if(cur<0)return;
    // swipe right → next tab (higher index), swipe left → previous tab (lower index)
    const next=dx>0?Math.min(cur+1,TABS.length-1):Math.max(cur-1,0);
    if(next===cur){
      // At left boundary of home tab → back to home shell
      if(dx<0&&cur===0)switchShell('home');
      return;
    }
    goTab(TABS[next],document.getElementById(NAV[TABS[next]]),false,dx<0?'left':'right');
  },{passive:true});
})();

// ──────────────────────────────────────────────────────────────────────────


if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
  // If an update activates while this page is already open (e.g. it loaded under
  // an older worker), reload once to actually get the new page instead of leaving
  // the user stuck on stale content until their next visit.
  let _swRefreshed=false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if(_swRefreshed)return;
    _swRefreshed=true;
    window.location.reload();
  });
}
history.scrollRestoration = 'manual';
window.addEventListener('load', () => {
  const sh = document.getElementById('shell-home');
  if (sh) sh.scrollTop = 0;
  window.scrollTo(0, 0);
});
