// ── Family recipes ("מתכונים") ──────────────────────────────────────────────
// A self-contained screen: builds its own overlay (#recipesOverlay) on first
// open, so index.html and admin.html only need the script tag + a button
// calling openRecipesOverlay().
//
// Storage: one Firestore doc per recipe in the `recipes` collection — NOT in
// appData/familyPayments, since recipe photos would quickly push that single
// doc past Firestore's 1MB limit. Favorites and the shopping list are
// per-device (localStorage); everything else is shared with the family.
(function(){
'use strict';

const FS_URL='https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';
// Scan-a-photo needs /api/recipe-scan plus an AI key on the server; the box
// shows only once the server says it's set up (checked on first open).
let SCAN_ENABLED=!!window.RECIPES_SCAN_MOCK;
function checkScan(){
  if(SCAN_ENABLED||checkScan.done)return;checkScan.done=true;
  fetch('/api/recipe-scan').then(r=>r.ok?r.json():{}).then(d=>{SCAN_ENABLED=!!d.enabled;}).catch(()=>{});
}
const CATS=[
  {id:'main',lbl:'עיקריות',ico:'🍗'},{id:'side',lbl:'תוספות',ico:'🍚'},{id:'salad',lbl:'סלטים',ico:'🥗'},
  {id:'soup',lbl:'מרקים',ico:'🍲'},{id:'bake',lbl:'מאפים ולחמים',ico:'🥖'},{id:'cake',lbl:'עוגות',ico:'🎂'},
  {id:'cookie',lbl:'עוגיות',ico:'🍪'},{id:'dessert',lbl:'קינוחים',ico:'🍮'},{id:'spread',lbl:'ממרחים ורטבים',ico:'🫙'},
  {id:'drink',lbl:'משקאות',ico:'🍹'},{id:'other',lbl:'אחר',ico:'🍽'}
];
const KOSHER=[{id:'meat',lbl:'בשרי'},{id:'dairy',lbl:'חלבי'},{id:'parve',lbl:'פרווה'}];
const HOLIDAYS=[
  {id:'shabbat',lbl:'שבת',ico:'🕯'},{id:'rosh',lbl:'ראש השנה',ico:'🍎'},{id:'sukkot',lbl:'סוכות',ico:'🌿'},
  {id:'chanuka',lbl:'חנוכה',ico:'🕎'},{id:'tubshvat',lbl:'ט״ו בשבט',ico:'🌳'},{id:'purim',lbl:'פורים',ico:'🎭'},
  {id:'pesach',lbl:'פסח',ico:'🍷'},{id:'shavuot',lbl:'שבועות',ico:'🧀'}
];
// Hebrew-calendar dates (Intl's English month names) of each holiday's
// first day — used to surface "<holiday> is coming" on the list page.
const HOLIDAY_DATES=[
  {id:'rosh',m:['Tishri'],d:1},{id:'sukkot',m:['Tishri'],d:15},{id:'chanuka',m:['Kislev'],d:25},
  {id:'tubshvat',m:['Shevat'],d:15},{id:'purim',m:['Adar','Adar II'],d:14},{id:'pesach',m:['Nisan'],d:15},{id:'shavuot',m:['Sivan'],d:6}
];
const EMOJIS=['🍲','🍗','🥩','🐟','🍝','🥘','🍚','🥗','🥔','🍳','🥖','🥯','🍕','🥟','🎂','🍰','🧁','🍪','🍩','🥧','🍮','🍫','🍎','🍋','🍯','🧀','🥛','🍹','☕','🫙'];
const GRADS=[['#FDE68A','#F59E0B'],['#FECACA','#F87171'],['#BBF7D0','#34D399'],['#BFDBFE','#60A5FA'],['#DDD6FE','#A78BFA'],['#FBCFE8','#F472B6'],['#FED7AA','#FB923C'],['#A5F3FC','#22D3EE']];
const AV_COLORS=['#E2711D','#2E7D4F','#1D6FB8','#9333EA','#DB2777','#0891B2','#B45309','#4F46E5'];
const NUM_WORDS={'חצי':0.5,'רבע':0.25,'שליש':1/3};
const FRAC_GLYPH={'½':.5,'⅓':1/3,'⅔':2/3,'¼':.25,'¾':.75,'⅛':.125};

let S={
  recipes:[],loaded:false,unsub:null,store:null,
  q:'',cat:'all',kosher:'',holiday:'',cook:'',sort:'new',
  openId:null,scale:1,ingDone:new Set(),stepDone:new Set(),
  edit:null,editPhoto:null,editScan:null,scanning:false,
  cookIdx:0,wake:null,
  timers:[],tick:null,
  randId:null
};

// ── helpers ────────────────────────────────────────────────────────────────
const $=id=>document.getElementById(id);
const E=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function lsGet(k,def){try{const v=localStorage.getItem(k);return v==null?def:JSON.parse(v);}catch(e){return def;}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
function toast(m,ms){if(typeof showToast==='function')showToast(m,ms);else console.log(m);}
function hash(s){let h=0;for(const c of String(s))h=(h*31+c.charCodeAt(0))|0;return Math.abs(h);}
function grad(r){const g=GRADS[hash(r.id||r.title)%GRADS.length];return `background:linear-gradient(135deg,${g[0]},${g[1]})`;}
function avColor(n){return AV_COLORS[hash(n)%AV_COLORS.length];}
function deviceId(){let d=lsGet('rcDevice',null);if(!d){d='d'+Math.random().toString(36).slice(2,10);lsSet('rcDevice',d);}return d;}
function myName(){
  let n=lsGet('rcMyName','');
  if(!n){try{n=(typeof _fcmRegistrantName==='function'&&_fcmRegistrantName())||localStorage.getItem('chatName')||'';}catch(e){}}
  return (n||'').trim();
}
function askName(){
  let n=myName();
  if(n)return n;
  n=(prompt('איך קוראים לך? (יופיע ליד מה שתוסיפו)')||'').trim();
  if(n)lsSet('rcMyName',n);
  return n;
}
function isAdmin(){try{return typeof editMode!=='undefined'&&!!editMode;}catch(e){return false;}}
function canDelete(r){return isAdmin()||r.deviceId===deviceId();}
function catOf(id){return CATS.find(c=>c.id===id)||(id?{id,lbl:id,ico:'🏷️'}:CATS[CATS.length-1]);}
// Recipes saved before multi-category support have only `category`.
function catsOf(r){return Array.isArray(r.categories)&&r.categories.length?r.categories:[r.category||'other'];}
function catLabels(r){return catsOf(r).map(c=>catOf(c).lbl).join(', ');}
const byLabel=(a,b)=>String(a).localeCompare(String(b),'he');
function allCats(extra){
  const custom=new Set();
  S.recipes.forEach(r=>catsOf(r).forEach(c=>{if(!CATS.some(x=>x.id===c))custom.add(c);}));
  (extra||[]).forEach(c=>{if(c&&!CATS.some(x=>x.id===c))custom.add(c);});
  return [...CATS,...[...custom].sort(byLabel).map(catOf)];
}
function allTags(extra){
  const custom=new Set();
  S.recipes.forEach(r=>(r.tags||[]).forEach(t=>{if(!HOLIDAYS.some(x=>x.id===t))custom.add(t);}));
  (extra||[]).forEach(t=>{if(t&&!HOLIDAYS.some(x=>x.id===t))custom.add(t);});
  return [...HOLIDAYS,...[...custom].sort(byLabel).map(holOf)];
}
function kosherOf(id){return KOSHER.find(k=>k.id===id);}
function holOf(id){return HOLIDAYS.find(h=>h.id===id)||(id?{id,lbl:id,ico:'✨'}:undefined);}
function fmtMin(m){m=+m||0;if(!m)return'';if(m<60)return m+' דק׳';const h=Math.floor(m/60),r=m%60;return (h===1?'שעה':h===2?'שעתיים':h+' שעות')+(r?` ו-${r} דק׳`:'');}
function totalMin(r){return (+r.prepMin||0)+(+r.cookMin||0);}
function ago(ts){
  if(!ts)return'';const d=(Date.now()-ts)/1000;
  if(d<60)return'עכשיו';if(d<3600)return`לפני ${Math.floor(d/60)} דק׳`;if(d<86400)return`לפני ${Math.floor(d/3600)} שע׳`;
  if(d<86400*30)return`לפני ${Math.floor(d/86400)} ימים`;
  return new Date(ts).toLocaleDateString('he-IL');
}
const DIFF=['','קל','בינוני','מאתגר'];
function favs(){return new Set(lsGet('rcFavs',[]));}
function toggleFav(id){const f=favs();f.has(id)?f.delete(id):f.add(id);lsSet('rcFavs',[...f]);return f.has(id);}
function shop(){return lsGet('rcShop',[]);}
function setShop(a){lsSet('rcShop',a);updateShopBadge();}

// ── quantities: parse the amount at the start of an ingredient line and
// scale it with the servings control ──────────────────────────────────────
const QTY_RE=/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?\s*[½⅓⅔¼¾⅛]?|[½⅓⅔¼¾⅛])(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?/;
function parseNum(s){
  s=s.trim().replace(',','.');
  let m;
  if((m=s.match(/^(\d+)\s+(\d+)\/(\d+)$/)))return +m[1]+ +m[2]/ +m[3];
  if((m=s.match(/^(\d+)\/(\d+)$/)))return +m[1]/ +m[2];
  if((m=s.match(/^(\d+(?:\.\d+)?)\s*([½⅓⅔¼¾⅛])$/)))return +m[1]+FRAC_GLYPH[m[2]];
  if(FRAC_GLYPH[s]!=null)return FRAC_GLYPH[s];
  return parseFloat(s);
}
function fmtNum(n){
  if(Math.abs(n-Math.round(n))<0.04)return String(Math.round(n));
  const w=Math.floor(n),f=n-w;
  for(const [g,v] of Object.entries(FRAC_GLYPH)){if(Math.abs(f-v)<0.04)return (w?w:'')+g;}
  return String(Math.round(n*10)/10);
}
// "2 1/2" → "2½": typed fractions shown as the glyphs fmtNum produces.
function prettyQty(q){
  const G={'1/2':'½','1/4':'¼','3/4':'¾','1/3':'⅓','2/3':'⅔','1/8':'⅛'};
  return q.replace(/\b([123])\/([2348])\b/g,(m)=>G[m]||m).replace(/(\d)\s+(?=[½¼¾⅓⅔⅛])/,'$1');
}
function scaleLine(line,k){
  const m=line.match(QTY_RE);
  if(m){
    const a=parseNum(m[1]),b=m[2]?parseNum(m[2]):null;
    if(!isNaN(a)){
      const q=k===1?prettyQty(m[0].trim()):fmtNum(a*k)+(b!=null?'–'+fmtNum(b*k):'');
      const rest=line.slice(m[0].length);
      return {q,rest:rest&&!/^\s/.test(rest)?' '+rest:rest};
    }
  }
  const w=line.match(/^(חצי|רבע|שליש)(?=\s)/);
  if(w&&k!==1)return {q:fmtNum(NUM_WORDS[w[1]]*k),rest:line.slice(w[0].length)};
  if(w)return {q:w[1],rest:line.slice(w[0].length)};
  return {q:'',rest:line};
}
function ingLines(r){
  return String(r.ingredients||'').split('\n').map(s=>s.trim()).filter(Boolean).map(s=>{
    if(/^#/.test(s)||/[:：]$/.test(s))return {sec:true,text:s.replace(/^#+\s*/,'').replace(/[:：]$/,'')};
    return {sec:false,text:s.replace(/^[-•*]\s*/,'')};
  });
}
// The method, with headings: like the ingredients, a line ending in ":"
// (or starting with "#") titles the steps below it ("לבצק:", "להרכבה:").
function stepItems(r){
  return String(r.steps||'').split('\n').map(s=>s.trim()).filter(Boolean).map(s=>{
    if(/^#/.test(s)||/[:：]$/.test(s))return {sec:true,text:s.replace(/^#+\s*/,'').replace(/[:：]$/,'').trim()};
    return {sec:false,text:s.replace(/^(\d+[.)]|[-•*])\s*/,'')};
  }).filter(x=>x.text);
}
// Just the steps themselves — numbering, cook mode and timers count these.
function stepLines(r){return stepItems(r).filter(x=>!x.sec).map(x=>x.text);}
// The heading the i-th step falls under, if any.
function stepSection(r,i){
  let sec='',n=-1;
  for(const x of stepItems(r)){if(x.sec)sec=x.text;else if(++n===i)return sec;}
  return '';
}

// ── timers found inside step text ("אופים 40 דקות", "חצי שעה"...) ──────────
const TM_RE=/(\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+)?)\s*(דקות|דקה|דק['׳]|שעות|שעה)(\s+וחצי)?|(כשעה וחצי|שעה וחצי|שעתיים וחצי|חצי שעה|רבע שעה|שלושת רבעי שעה|שעתיים|כשעה|שעה)/g;
function tmSeconds(m){
  if(m[4]){
    const map={'כשעה וחצי':90,'שעה וחצי':90,'שעתיים וחצי':150,'חצי שעה':30,'רבע שעה':15,'שלושת רבעי שעה':45,'שעתיים':120,'כשעה':60,'שעה':60};
    return map[m[4]]*60;
  }
  const n=parseFloat(m[1].replace(',','.').split(/[-–]/).pop())+(m[3]?0.5:0);
  return Math.round(/שע/.test(m[2])?n*3600:n*60);
}
function stepHtml(text,stepNo){
  let out='',last=0;TM_RE.lastIndex=0;let m;
  while((m=TM_RE.exec(text))){
    const sec=tmSeconds(m);if(!sec||sec>86400){continue;}
    out+=E(text.slice(last,m.index))+`<button class="rc-tm" onclick="event.stopPropagation();rcStartTimer(${sec},${stepNo})">⏲ ${E(m[0])}</button>`;
    last=m.index+m[0].length;
  }
  return out+E(text.slice(last));
}

// ── storage backends ───────────────────────────────────────────────────────
// Firestore in the real app; an in-memory mock when window.RECIPES_MOCK is
// set (the preview harness), so the screen can be exercised without
// touching live family data.
function firestoreStore(){
  let fs=null,db=null;
  async function init(){
    if(fs)return;
    const fb=await fbInit();db=fb.db;fs=await import(FS_URL);
  }
  const ref=id=>fs.doc(db,'recipes',id);
  return {
    async subscribe(cb){
      await init();
      return fs.onSnapshot(fs.collection(db,'recipes'),snap=>{
        cb(snap.docs.map(d=>({...d.data(),id:d.id})));
      },err=>{console.warn('recipes listener failed:',err);toast('⚠️ טעינת המתכונים נכשלה: '+(err.code||err.message));cb(null);});
    },
    // An edit merges, leaving out the fields others may have changed since
    // the editor opened (comments, "I made it") — a new recipe writes whole.
    async put(r,isNew){await init();const {id,...data}=r;
      if(isNew){await fs.setDoc(ref(id),data);return;}
      delete data.madeBy;delete data.madeCount;delete data.comments;
      await fs.setDoc(ref(id),data,{merge:true});},
    async remove(id){await init();await fs.deleteDoc(ref(id));},
    async addMade(id,entry){await init();await fs.updateDoc(ref(id),{madeBy:fs.arrayUnion(entry),madeCount:fs.increment(1)});},
    async addComment(id,c){await init();await fs.updateDoc(ref(id),{comments:fs.arrayUnion(c)});},
    async removeComment(id,c){await init();await fs.updateDoc(ref(id),{comments:fs.arrayRemove(c)});}
  };
}
function mockStore(){
  let items=(window.RECIPES_MOCK||[]).map(r=>JSON.parse(JSON.stringify(r))),cb=null;
  const emit=()=>setTimeout(()=>cb&&cb(JSON.parse(JSON.stringify(items))),60);
  const get=id=>items.find(r=>r.id===id);
  return {
    async subscribe(f){cb=f;emit();return ()=>{cb=null;};},
    async put(r,isNew){const i=items.findIndex(x=>x.id===r.id);if(i<0||isNew){items.push(r);}else{const {madeBy,madeCount,comments,...rest}=r;Object.assign(items[i],rest);}emit();},
    async remove(id){items=items.filter(r=>r.id!==id);emit();},
    async addMade(id,e){const r=get(id);r.madeBy=(r.madeBy||[]).concat(e);r.madeCount=(r.madeCount||0)+1;emit();},
    async addComment(id,c){const r=get(id);r.comments=(r.comments||[]).concat(c);emit();},
    async removeComment(id,c){const r=get(id);r.comments=(r.comments||[]).filter(x=>x.id!==c.id);emit();}
  };
}

// ── shell ──────────────────────────────────────────────────────────────────
function build(){
  if($('recipesOverlay'))return;
  const el=document.createElement('div');
  el.id='recipesOverlay';
  el.innerHTML=`
  <div class="rc-top">
    <button class="rc-ibtn" onclick="closeRecipesOverlay()" title="סגור">✕</button>
    <div class="rc-top-title"><span style="font-size:24px">🍲</span><div>מתכונים<small id="rcSub"></small></div></div>
    <button class="rc-ibtn" onclick="rcOpenShop()" title="רשימת קניות">🛒<span class="rc-badge" id="rcShopBadge" style="display:none"></span></button>
    <button class="rc-add-btn" onclick="rcOpenEditor()">+ מתכון</button>
  </div>
  <div class="rc-scroll" id="rcListScroll"><div class="rc-wrap" id="rcList"></div></div>

  <div class="rc-page" id="rcPage"><div class="rc-scroll" id="rcPageScroll"></div></div>

  <div class="rc-cook-mode" id="rcCook"></div>

  <div class="rc-modal" id="rcEditModal" onclick="if(event.target===this)rcCloseEditor()">
    <div class="rc-sheet">
      <div class="rc-sheet-hd"><b id="rcEditTtl">מתכון חדש</b><button class="rc-x" onclick="rcCloseEditor()">✕</button></div>
      <div class="rc-sheet-bd" id="rcEditBody"></div>
      <div class="rc-sheet-ft">
        <button class="rc-btn danger" id="rcEditDel" onclick="rcDeleteRecipe()">🗑</button>
        <button class="rc-btn ghost" onclick="rcCloseEditor()">ביטול</button>
        <button class="rc-btn" id="rcEditSave" onclick="rcSaveRecipe()">שמירה</button>
      </div>
    </div>
  </div>

  <div class="rc-modal" id="rcShopModal" onclick="if(event.target===this)rcCloseModal('rcShopModal')">
    <div class="rc-sheet">
      <div class="rc-sheet-hd"><b>🛒 רשימת קניות</b><button class="rc-x" onclick="rcCloseModal('rcShopModal')">✕</button></div>
      <div class="rc-sheet-bd" id="rcShopBody"></div>
      <div class="rc-sheet-ft">
        <button class="rc-btn ghost" onclick="rcShopClear(true)">נקה מסומנים</button>
        <button class="rc-btn" onclick="rcShopShare()">📤 שליחה</button>
      </div>
    </div>
  </div>

  <div class="rc-modal" id="rcBookModal" onclick="if(event.target===this)rcCloseModal('rcBookModal')">
    <div class="rc-sheet">
      <div class="rc-sheet-hd"><b>📚 חוברת מתכונים להדפסה</b><button class="rc-x" onclick="rcCloseModal('rcBookModal')">✕</button></div>
      <div class="rc-sheet-bd" id="rcBookBody"></div>
      <div class="rc-sheet-ft">
        <button class="rc-btn ghost" onclick="rcCloseModal('rcBookModal')">ביטול</button>
        <button class="rc-btn" onclick="rcMakeBook()">📚 יצירת החוברת</button>
      </div>
    </div>
  </div>

  <div class="rc-modal" id="rcRandModal" onclick="if(event.target===this)rcCloseModal('rcRandModal')">
    <div class="rc-sheet">
      <div class="rc-sheet-hd"><b>🎲 מה נבשל היום?</b><button class="rc-x" onclick="rcCloseModal('rcRandModal')">✕</button></div>
      <div class="rc-sheet-bd" id="rcRandBody"></div>
      <div class="rc-sheet-ft">
        <button class="rc-btn ghost" onclick="rcRandom()">🎲 עוד הגרלה</button>
        <button class="rc-btn" onclick="rcCloseModal('rcRandModal');rcOpenRecipe(window._rcRandId)">פתח מתכון</button>
      </div>
    </div>
  </div>

  <div class="rc-modal" id="rcImportModal" onclick="if(event.target===this)rcCloseModal('rcImportModal')">
    <div class="rc-sheet">
      <div class="rc-sheet-hd"><b>📚 ייבוא מתכונים מ-PDF</b><button class="rc-x" onclick="rcCloseModal('rcImportModal')">✕</button></div>
      <div class="rc-sheet-bd" id="rcImportBody"></div>
      <div class="rc-sheet-ft" id="rcImportFt"></div>
    </div>
  </div>

  <div class="rc-zoom" id="rcZoom" onclick="this.classList.remove('open')"><img id="rcZoomImg" alt=""></div>
  <div class="rc-timers" id="rcTimers"></div>
  <input type="file" accept="image/*" id="rcPhotoInp" style="display:none" onchange="rcPickPhoto(this)">
  <input type="file" accept="image/*" multiple id="rcScanInp" style="display:none" onchange="rcScanFiles(this)">
  <input type="file" accept="application/pdf,.pdf" id="rcPdfInp" style="display:none" onchange="rcImportPdf(this)">`;
  document.body.appendChild(el);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&$('rcCook')&&$('rcCook').classList.contains('open'))acquireWake();});
}

window.openRecipesOverlay=function(){
  build();
  $('recipesOverlay').classList.add('open');
  document.body.style.overflow='hidden';
  updateShopBadge();
  checkScan();
  if(!S.store){
    S.store=window.RECIPES_MOCK?mockStore():firestoreStore();
    renderList();
    S.store.subscribe(list=>{
      if(list){S.recipes=list;S.err=false;}else S.err=true;
      S.loaded=true;
      renderList();
      if(S.openId){if(S.recipes.some(r=>r.id===S.openId))renderPage();else rcClosePage();}
    }).then(u=>S.unsub=u).catch(e=>{console.warn(e);S.loaded=true;renderList();toast('⚠️ לא ניתן להתחבר למאגר המתכונים');});
  }else renderList();
};
window.closeRecipesOverlay=function(){
  const o=$('recipesOverlay');if(!o)return;
  if($('rcCook').classList.contains('open')){rcCloseCook();return;}
  if($('rcPage').classList.contains('open')){rcClosePage();return;}
  o.classList.remove('open');
  document.body.style.overflow='';
};

// ── list page ──────────────────────────────────────────────────────────────
function upcomingHoliday(){
  try{
    const fmt=new Intl.DateTimeFormat('en-u-ca-hebrew',{month:'long',day:'numeric'});
    const now=new Date();now.setHours(12,0,0,0);
    for(let i=0;i<=40;i++){
      const d=new Date(now.getTime()+i*86400000);
      const parts=fmt.formatToParts(d);
      const mo=(parts.find(p=>p.type==='month')||{}).value,dy=+((parts.find(p=>p.type==='day')||{}).value);
      const h=HOLIDAY_DATES.find(x=>x.d===dy&&x.m.includes(mo));
      if(h)return {...holOf(h.id),days:i};
    }
  }catch(e){}
  const wd=new Date().getDay();
  if(wd===4||wd===5)return {...holOf('shabbat'),days:wd===4?2:1,shabbat:true};
  return null;
}
function cooks(){
  const m=new Map();
  S.recipes.forEach(r=>{const n=(r.origin||'').trim();if(n)m.set(n,(m.get(n)||0)+1);});
  return [...m.entries()].sort((a,b)=>b[1]-a[1]);
}
function personPhoto(name){
  try{
    if(typeof familyTree==='undefined')return null;
    const n=name.replace(/^(סבתא|סבא|דודה|דוד|אמא|אבא)\s+/,'').trim();
    const p=familyTree.find(p=>p.photo&&p.name&&(p.name===name||p.name===n||p.name.startsWith(n+' ')));
    return p?p.photo:null;
  }catch(e){return null;}
}
function filtered(){
  const q=S.q.trim().toLowerCase(),f=favs();
  let list=S.recipes.filter(r=>{
    if(S.cat==='fav'&&!f.has(r.id))return false;
    if(S.cat!=='all'&&S.cat!=='fav'&&!catsOf(r).includes(S.cat))return false;
    if(S.kosher&&r.kosher!==S.kosher)return false;
    if(S.holiday&&!(r.tags||[]).includes(S.holiday))return false;
    if(S.cook&&(r.origin||'').trim()!==S.cook)return false;
    if(q){
      const hay=[r.title,r.ingredients,r.origin,r.story,r.createdBy,catLabels(r),...(r.tags||[]).map(t=>(holOf(t)||{}).lbl)].join(' ').toLowerCase();
      if(!q.split(/\s+/).every(w=>hay.includes(w)))return false;
    }
    return true;
  });
  const by={
    new:(a,b)=>(b.createdAt||0)-(a.createdAt||0),
    made:(a,b)=>(b.madeCount||0)-(a.madeCount||0)||(b.createdAt||0)-(a.createdAt||0),
    az:(a,b)=>String(a.title).localeCompare(String(b.title),'he'),
    quick:(a,b)=>(totalMin(a)||9999)-(totalMin(b)||9999)
  };
  return list.sort(by[S.sort]||by.new);
}
function cardHtml(r,f,i){
  const k=kosherOf(r.kosher),t=totalMin(r);
  return `<button class="rc-card" style="animation-delay:${Math.min(i,12)*25}ms" onclick="rcOpenRecipe('${E(r.id)}')">
    <div class="rc-card-img" style="${r.photo?'':grad(r)}">${r.photo?`<img src="${r.photo}" alt="" loading="lazy">`:E(r.emoji||catOf(catsOf(r)[0]).ico)}
      ${f.has(r.id)?'<span class="rc-card-fav">⭐</span>':''}
      ${k?`<span class="rc-card-k k-${k.id}">${k.lbl}</span>`:''}
    </div>
    <div class="rc-card-body">
      <div class="rc-card-ttl">${E(r.title)}</div>
      ${r.origin?`<div class="rc-card-by">👵 ${E(r.origin)}</div>`:''}
      <div class="rc-card-meta">${t?`<span>⏱ ${fmtMin(t)}</span>`:''}${r.madeCount?`<span>👩‍🍳 ${r.madeCount}</span>`:''}${(r.comments||[]).length?`<span>💬 ${r.comments.length}</span>`:''}</div>
    </div>
  </button>`;
}
function renderList(){
  const box=$('rcList');if(!box)return;
  const nCooks=cooks().length;
  $('rcSub').textContent=S.loaded?`${S.recipes.length} מתכונים${nCooks?` · ${nCooks} בשלנים`:''}`:'טוען...';
  if(!S.loaded){box.innerHTML='<div class="rc-loading">🍲</div>';return;}
  if(S.err&&!S.recipes.length){box.innerHTML='<div class="rc-empty"><span class="rc-empty-ico">⚠️</span><b>לא הצלחנו לטעון את המתכונים</b>בדקו את החיבור לאינטרנט ונסו שוב בעוד רגע</div>';return;}
  if(!S.recipes.length){
    box.innerHTML=`<div class="rc-empty"><span class="rc-empty-ico">👩‍🍳</span><b>ספר המתכונים של המשפחה מחכה לכם</b>
      העוגה של סבתא, החמין של שבת, הסלט שכולם מבקשים —<br>כל מתכון שתוסיפו יישמר כאן לדורות.
      <br><button onclick="rcOpenEditor()">+ הוסיפו את המתכון הראשון</button></div>`;
    return;
  }
  const f=favs(),list=filtered(),hol=upcomingHoliday(),cs=cooks();
  let h=`<div class="rc-search-row">
      <div class="rc-search"><span>🔍</span><input id="rcQ" type="search" placeholder="חיפוש מתכון, מצרך או בשלן..." value="${E(S.q)}" oninput="rcSetQ(this.value)"></div>
      <button class="rc-dice" onclick="rcRandom()">🎲 <span>מה נבשל?</span></button>
    </div>`;
  if(hol&&!S.holiday){
    const n=S.recipes.filter(r=>(r.tags||[]).includes(hol.id)).length;
    const when=hol.days===0?'היום!':hol.days===1?'מחר':`בעוד ${hol.days} ימים`;
    h+=`<button class="rc-banner" onclick="rcSet('holiday','${hol.id}')"><span class="rc-banner-ico">${hol.ico}</span><div><b>${hol.lbl} ${when}</b><span>${n?`${n} מתכונים מחכים לכם — לחצו לצפייה`:`עדיין אין מתכונים ל${hol.lbl} — זה הזמן להוסיף!`}</span></div></button>`;
  }
  if(cs.length>1){
    h+=`<div class="rc-sec-ttl">מהמטבח של...</div><div class="rc-cooks">${cs.map(([n,c])=>{
      const ph=personPhoto(n);
      return `<button class="rc-cook${S.cook===n?' on':''}" onclick="rcSet('cook',${E(JSON.stringify(n))})">
        <span class="rc-cook-av" style="background:${avColor(n)}">${ph?`<img src="${ph}" alt="">`:E(n.replace(/^(סבתא|סבא|דודה|דוד)\s+/,'').charAt(0))}</span>
        <span class="rc-cook-nm">${E(n)}</span><span class="rc-cook-ct">${c} מתכונים</span></button>`;}).join('')}</div>`;
  }
  const used=new Set(S.recipes.flatMap(catsOf)),usedTags=new Set(S.recipes.flatMap(r=>r.tags||[]));
  h+=`<div class="rc-chips">
    <button class="rc-chip${S.cat==='all'?' on':''}" onclick="rcSet('cat','all')">הכל</button>
    <button class="rc-chip${S.cat==='fav'?' on':''}" onclick="rcSet('cat','fav')">⭐ מועדפים</button>
    ${allCats().filter(c=>used.has(c.id)).map(c=>`<button class="rc-chip${S.cat===c.id?' on':''}" data-v="${E(c.id)}" onclick="rcSet('cat',this.dataset.v)">${c.ico} ${E(c.lbl)}</button>`).join('')}
  </div>
  <div class="rc-chips">
    ${KOSHER.map(k=>`<button class="rc-chip k-${k.id}${S.kosher===k.id?' on':''}" onclick="rcSet('kosher','${k.id}')">${k.lbl}</button>`).join('')}
    ${allTags().filter(x=>usedTags.has(x.id)).map(x=>`<button class="rc-chip${S.holiday===x.id?' on':''}" data-v="${E(x.id)}" onclick="rcSet('holiday',this.dataset.v)">${x.ico} ${E(x.lbl)}</button>`).join('')}
  </div>
  <div class="rc-toolbar">
    <span class="rc-count">${list.length===S.recipes.length?`${list.length} מתכונים`:`נמצאו ${list.length} מתוך ${S.recipes.length}`}${(S.cook||S.holiday||S.kosher||S.cat!=='all'||S.q)?' · <a href="#" onclick="rcResetFilters();return false" style="color:var(--rc-accent2);font-weight:800">נקה סינון</a>':''}</span>
    <span style="display:flex;gap:6px;align-items:center"><button class="rc-sort" style="cursor:pointer" onclick="rcOpenBook()">📚 חוברת להדפסה</button>
    <select class="rc-sort" onchange="rcSet('sort',this.value)">
      ${[['new','🆕 חדשים'],['made','👩‍🍳 הכי מבושלים'],['az','א–ב'],['quick','⚡ הכי מהירים']].map(([v,l])=>`<option value="${v}"${S.sort===v?' selected':''}>${l}</option>`).join('')}
    </select></span>
  </div>`;
  h+=list.length?`<div class="rc-grid">${list.map((r,i)=>cardHtml(r,f,i)).join('')}</div>`
    :`<div class="rc-empty"><span class="rc-empty-ico">🔍</span><b>לא נמצאו מתכונים</b>נסו חיפוש אחר או נקו את הסינון</div>`;
  box.innerHTML=h;
}
let _qT=null;
window.rcSetQ=function(v){
  S.q=v;clearTimeout(_qT);
  _qT=setTimeout(()=>{
    const el=$('rcQ'),pos=el?el.selectionStart:null;
    renderList();
    const n=$('rcQ');if(n&&pos!=null){n.focus();n.setSelectionRange(pos,pos);}
  },180);
};
window.rcSet=function(k,v){
  if(k==='sort')S.sort=v;
  else if(k==='cat')S.cat=v;
  else S[k]=S[k]===v?'':v;
  renderList();
};
window.rcResetFilters=function(){S.q='';S.cat='all';S.kosher='';S.holiday='';S.cook='';renderList();};

// ── recipe page ────────────────────────────────────────────────────────────
function cur(){return S.recipes.find(r=>r.id===S.openId);}
window.rcOpenRecipe=function(id){
  if(!S.recipes.some(r=>r.id===id))return;
  if(S.openId!==id){S.openId=id;S.scale=1;S.ingDone=new Set();S.stepDone=new Set();}
  renderPage();
  $('rcPage').classList.add('open');
  $('rcPageScroll').scrollTop=0;
};
window.rcClosePage=function(){
  $('rcPage').classList.remove('open');
  S.openId=null;
  renderList();
};
function ingListHtml(r){
  const k=S.scale;let i=0;
  return `<ul class="rc-ing">${ingLines(r).map(l=>{
    if(l.sec)return `<li class="rc-ing-sec">${E(l.text)}</li>`;
    const idx=i++,s=scaleLine(l.text,k);
    return `<li class="${S.ingDone.has(idx)?'done':''}" onclick="rcToggleIng(${idx},this)"><span class="rc-ck">✓</span><span class="rc-ing-tx">${s.q?`<b>${E(s.q)}</b>`:''}${E(s.rest)}</span></li>`;
  }).join('')}</ul>`;
}
function renderPage(){
  const r=cur(),box=$('rcPageScroll');if(!r||!box)return;
  const k=kosherOf(r.kosher),f=favs(),steps=stepLines(r),base=+r.servings||0;
  const comments=(r.comments||[]).slice().sort((a,b)=>(a.ts||0)-(b.ts||0));
  const made=r.madeBy||[];
  const madeNames=[...new Set(made.map(m=>m.name).filter(Boolean))];
  box.innerHTML=`
  <div class="rc-hero" style="${r.photo?'':grad(r)}">${r.photo?`<img src="${r.photo}" alt="" onclick="rcZoom(this.src)" style="cursor:zoom-in">`:E(r.emoji||catOf(catsOf(r)[0]).ico)}
    <div class="rc-hero-bar"><button class="rc-ibtn" onclick="rcClosePage()" title="חזרה">→</button><button class="rc-ibtn" onclick="rcOpenEditor('${E(r.id)}')" title="עריכה">✏️</button></div>
    <div class="rc-hero-ttl"><h1>${E(r.title)}</h1>
      <div>${r.origin?`מהמטבח של <button onclick="rcFilterCook()">${E(r.origin)}</button> · `:''}${catOf(catsOf(r)[0]).ico} ${E(catLabels(r))}</div></div>
  </div>
  <div class="rc-detail">
    <div class="rc-metas">
      ${+r.prepMin?`<div class="rc-meta"><b>${fmtMin(r.prepMin)}</b><span>הכנה</span></div>`:''}
      ${+r.cookMin?`<div class="rc-meta"><b>${fmtMin(r.cookMin)}</b><span>בישול / אפייה</span></div>`:''}
      ${base?`<div class="rc-meta"><b>${base}</b><span>מנות</span></div>`:''}
      ${r.difficulty?`<div class="rc-meta"><b>${'🔥'.repeat(r.difficulty)}</b><span>${DIFF[r.difficulty]}</span></div>`:''}
      ${k?`<div class="rc-meta"><b class="k-${k.id}" style="padding:1px 10px;border-radius:10px">${k.lbl}</b><span>כשרות</span></div>`:''}
      ${(r.tags||[]).length?`<div class="rc-meta"><b>${r.tags.map(t=>(holOf(t)||{}).ico||'').join(' ')}</b><span>${E(r.tags.map(t=>(holOf(t)||{}).lbl||'').join(', '))}</span></div>`:''}
    </div>
    <div class="rc-actions">
      <button class="rc-act${f.has(r.id)?' on':''}" onclick="rcFav(this)"><i>${f.has(r.id)?'⭐':'☆'}</i>מועדף</button>
      <button class="rc-act" onclick="rcAddToShop()"><i>🛒</i>לקניות</button>
      <button class="rc-act" onclick="rcShare()"><i>📤</i>שיתוף</button>
      <button class="rc-act" onclick="rcPrint()"><i>🖨</i>הדפסה</button>
      <button class="rc-act" onclick="rcSaveImage()"><i>🖼</i>כתמונה</button>
      <button class="rc-act" onclick="rcOpenEditor('${E(r.id)}')"><i>✏️</i>עריכה</button>
    </div>
    ${steps.length?`<button class="rc-cookmode-btn" onclick="rcOpenCook()">👩‍🍳 מצב בישול — צעד אחר צעד</button>`:''}
    ${r.story?`<div class="rc-story"><b>הסיפור מאחורי המתכון</b>${E(r.story)}</div>`:''}
    ${ingLines(r).length?`<div class="rc-box">
      <div class="rc-box-hd"><h3>🧺 מצרכים</h3>
        <div class="rc-scaler"><button onclick="rcScale(-1)">−</button><span id="rcScaleLbl">${scaleLabel(base)}</span><button onclick="rcScale(1)">+</button></div>
      </div>
      <div id="rcIngBox">${ingListHtml(r)}</div>
    </div>`:''}
    ${steps.length?`<div class="rc-box"><div class="rc-box-hd"><h3>📝 אופן ההכנה</h3><span style="font-size:11px;color:var(--rc-ink2)">לחצו על שלב כדי לסמן</span></div>
      ${(()=>{let i=-1;return stepItems(r).map(x=>{if(x.sec)return `<div class="rc-step-sec">${E(x.text)}</div>`;i++;
        return `<div class="rc-step${S.stepDone.has(i)?' done':''}" onclick="rcToggleStep(${i},this)"><span class="rc-step-n">${S.stepDone.has(i)?'✓':i+1}</span><div class="rc-step-tx">${stepHtml(x.text,i+1)}</div></div>`;}).join('');})()}
    </div>`:''}
    ${r.tips?`<div class="rc-box"><div class="rc-box-hd"><h3>💡 טיפים וסודות</h3></div><div class="rc-tips">${E(r.tips)}</div></div>`:''}
    ${r.scan?`<div class="rc-box"><div class="rc-box-hd"><h3>📜 המתכון המקורי</h3><span style="font-size:11px;color:var(--rc-ink2)">לחצו להגדלה</span></div><img class="rc-scan" src="${r.scan}" alt="" onclick="rcZoom(this.src)"></div>`:''}
    <div class="rc-box">
      <button class="rc-made-btn" onclick="rcMadeIt()">👩‍🍳 הכנתי את זה!${r.madeCount?` · ${r.madeCount}`:''}</button>
      ${madeNames.length?`<div class="rc-made-who">${madeNames.slice(-12).map(n=>`<span>${E(n)}</span>`).join('')}</div>`:''}
    </div>
    <div class="rc-box">
      <div class="rc-box-hd"><h3>💬 תגובות וטיפים מהמשפחה${comments.length?` (${comments.length})`:''}</h3></div>
      ${comments.map(c=>`<div class="rc-cm"><span class="rc-cm-av" style="background:${avColor(c.name||'?')}">${E((c.name||'?').charAt(0))}</span>
        <div class="rc-cm-b"><div class="rc-cm-hd"><b>${E(c.name||'')}</b><span>${ago(c.ts)}</span>${(isAdmin()||c.deviceId===deviceId())?`<button onclick="rcDelComment('${E(c.id)}')" title="מחיקה">🗑</button>`:''}</div>
        <div class="rc-cm-tx">${E(c.text)}</div></div></div>`).join('')||'<div style="font-size:13px;color:var(--rc-ink2)">עדיין אין תגובות. הכנתם? ספרו איך יצא!</div>'}
      <div class="rc-cm-form">
        ${myName()?'':'<input id="rcCmName" placeholder="השם שלך">'}
        <textarea id="rcCmText" rows="2" placeholder="איך יצא? יש לך טיפ או שינוי?"></textarea>
        <button onclick="rcAddComment()">שליחה</button>
      </div>
    </div>
    <div class="rc-foot">${r.createdBy?`נוסף ע״י ${E(r.createdBy)} · `:''}${r.createdAt?new Date(r.createdAt).toLocaleDateString('he-IL'):''}${r.updatedBy&&r.updatedAt&&r.updatedAt!==r.createdAt?` · עודכן ע״י ${E(r.updatedBy)}`:''}</div>
  </div>`;
}
function scaleLabel(base){
  if(base)return `${fmtNum(base*S.scale)} מנות`;
  return S.scale===1?'כמות רגילה':`×${fmtNum(S.scale)}`;
}
const SCALES=[0.25,0.5,0.75,1,1.5,2,3,4];
window.rcScale=function(d){
  const r=cur();if(!r)return;
  const base=+r.servings||0;
  if(base){S.scale=Math.max(1/base,(Math.round(base*S.scale)+d)/base);}
  else{const i=SCALES.indexOf(S.scale);S.scale=SCALES[Math.max(0,Math.min(SCALES.length-1,(i<0?3:i)+d))];}
  $('rcScaleLbl').textContent=scaleLabel(base);
  $('rcIngBox').innerHTML=ingListHtml(r);
};
window.rcToggleIng=function(i,el){
  S.ingDone.has(i)?S.ingDone.delete(i):S.ingDone.add(i);
  el.classList.toggle('done',S.ingDone.has(i));
};
window.rcToggleStep=function(i,el){
  S.stepDone.has(i)?S.stepDone.delete(i):S.stepDone.add(i);
  el.classList.toggle('done',S.stepDone.has(i));
  el.querySelector('.rc-step-n').textContent=S.stepDone.has(i)?'✓':i+1;
};
window.rcFav=function(btn){
  const on=toggleFav(S.openId);
  btn.classList.toggle('on',on);btn.querySelector('i').textContent=on?'⭐':'☆';
  toast(on?'⭐ נוסף למועדפים':'הוסר מהמועדפים');
};
window.rcFilterCook=function(){const r=cur();if(!r)return;S.cook=(r.origin||'').trim();S.cat='all';rcClosePage();};
window.rcZoom=function(src){$('rcZoomImg').src=src;$('rcZoom').classList.add('open');};

function recipeText(r){
  const ing=ingLines(r).map(l=>l.sec?`\n${l.text}:`:'• '+(s=>s.q+s.rest)(scaleLine(l.text,S.scale))).join('\n');
  let n=0;const st=stepItems(r).map(x=>x.sec?`\n${x.text}:`:`${++n}. ${x.text}`).join('\n').replace(/^\n/,'');
  return `🍲 *${r.title}*${r.origin?`\nמהמטבח של ${r.origin}`:''}\n\n🧺 *מצרכים*${S.scale!==1?` (×${fmtNum(S.scale)})`:''}\n${ing}\n\n📝 *אופן ההכנה*\n${st}${r.tips?`\n\n💡 ${r.tips}`:''}\n\n— מספר המתכונים של משפחת ינקלביץ`;
}
window.rcShare=async function(){
  const r=cur();if(!r)return;
  const text=recipeText(r);
  if(navigator.share){try{await navigator.share({title:r.title,text});return;}catch(e){if(e.name==='AbortError')return;}}
  window.open('https://wa.me/?text='+encodeURIComponent(text),'_blank');
};
// ── printing: every recipe becomes one fixed-size card (A5 page, or two per
// A4 sheet for cutting). The print window lays itself out: each recipe gets
// the largest font that fits its card, and only a recipe too long even at
// the smallest font continues onto a second card. The booklet adds a cover
// and a table of contents whose page numbers come from that same layout.
const BOOK_TITLE='ספר המתכונים של משפחת ינקלביץ';
const BOOK_SUB='הכי טעים בבית';
function printData(r,scale){
  return {
    title:r.title||'',origin:r.origin||'',photo:r.photo||null,cat:catOf(catsOf(r)[0]).lbl,
    ings:ingLines(r).map(l=>l.sec?{sec:l.text}:scaleLine(l.text,scale)),
    steps:stepItems(r),note:r.tips||''
  };
}
const PRINT_CSS=`
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#8E8A85}
body{font-family:"Varela Round",Arial,sans-serif;color:#1F1B17;direction:rtl;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{display:flex;justify-content:flex-start;background:#fff;margin:0 auto}
.page{width:99mm;height:210mm;display:flex;align-items:center;justify-content:center;flex:none;position:relative}
.card{width:91mm;height:196mm;border-radius:9mm;position:relative;overflow:hidden;
 background:#F4F1EC url(__BG__) left top/cover no-repeat;
 box-shadow:0 0 0 .35mm #DDD6CC inset}
.body{position:absolute;top:19mm;bottom:13mm;right:7mm;left:8mm;overflow:hidden;font-size:var(--fs,13pt);line-height:1.42;z-index:1}
.pno{position:absolute;bottom:5mm;left:0;right:0;text-align:center;font-size:9pt;color:#8A8178;z-index:1}
.ttl{text-align:center;font-weight:700;font-size:1.6em;line-height:1.2;margin-bottom:.5em}
/* photo back & plain back */
.photo img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ph-cap{position:absolute;left:0;right:0;bottom:0;padding:8mm 6mm 7mm;text-align:center;font-size:15pt;font-weight:700;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.55));text-shadow:0 .5mm 2mm rgba(0,0,0,.4)}
.bl{position:absolute;left:0;right:0;bottom:16mm;text-align:center;font-size:13pt;color:#9A8F84;letter-spacing:.05em}
.cont{text-align:center;font-size:.85em;color:#7A6F64;margin-bottom:.4em}
.ing{position:relative;padding-right:1.15em;margin-bottom:.12em}
.ing::before{content:"";position:absolute;right:.15em;top:.58em;width:.42em;height:.42em;border-radius:50%;background:#1F1B17}
.ing b{font-weight:500}
.sec{font-weight:700;margin:.45em 0 .1em}
.hd{font-weight:700;text-decoration:underline;text-underline-offset:.18em;margin:.85em 0 .25em;padding-right:1.4em}
.st{margin-bottom:.18em}
.note{font-weight:700;margin-top:1em}
/* cover */
.cover .body{top:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.cv-big{font-size:36pt;font-weight:700;line-height:1.15}
.cv-line{width:30mm;height:.8mm;background:#1F1B17;margin:7mm auto;border-radius:1mm}
.cv-ttl{font-size:14pt;font-weight:700;line-height:1.35;max-width:74mm}
.cv-yr{font-size:10pt;color:#7A6F64;margin-top:5mm}
/* table of contents */
.toc-h{text-align:center;font-weight:700;font-size:1.6em;margin-bottom:.5em}
.toc-c{font-weight:700;font-size:.95em;margin:.6em 0 .15em;color:#5B4C3E}
.toc-r{display:flex;align-items:baseline;gap:.3em;font-size:.95em;margin-bottom:.12em}
.toc-r span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:82%}
.toc-r i{flex:1;border-bottom:.3mm dotted #8A8178;transform:translateY(-.25em)}
.toc-r b{font-weight:700;min-width:1.4em;text-align:left}
/* screen preview */
@media screen{
 body{padding:64px 0 20px}
 #book{zoom:var(--z,1)}
 .sheet{margin:0 auto 14px;box-shadow:0 4px 18px rgba(0,0,0,.35)}
 .bar{position:fixed;top:0;left:0;right:0;z-index:9;background:#2B2118;color:#fff;display:flex;align-items:center;gap:10px;padding:10px 14px;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,.3)}
 .bar button.alt{background:#fff}
 .bar button{border:none;border-radius:18px;padding:9px 16px;font:700 14px "Varela Round",Arial;background:#F59E0B;color:#2B2118;cursor:pointer;white-space:nowrap}
 .bar span{opacity:.8;line-height:1.35}
}
@media print{.bar{display:none}.sheet{page-break-after:always;break-after:page}}
`;
// Runs inside the print window: lays out the cards, then numbers them.
function printScript(){
  const D=window.__RC,three=D.layout==='a4',duplex=!!D.photos;
  const book=document.getElementById('book');
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  // Cards are laid out in reading order in a staging area first (measuring
  // only needs the card's own size), then dealt onto sheets at the end.
  const stage=document.createElement('div');book.appendChild(stage);
  const pages=[];
  function newPage(cls,html){
    const page=document.createElement('div');page.className='page';
    page.innerHTML=`<div class="card ${cls||''}">${html||'<div class="body"></div><div class="pno"></div>'}</div>`;
    stage.appendChild(page);pages.push(page);
    return page;
  }
  const newCard=cls=>newPage(cls).querySelector('.body');
  // Double-sided: every section starts on a front side, so a back left
  // empty gets a plain card (the background alone).
  const padToFront=()=>{if(duplex&&pages.length%2)newPage('blank','<div class="bl">בתיאבון</div>');};
  const fits=b=>b.scrollHeight<=b.clientHeight+1;
  if(D.cover){
    const b=newCard('cover');
    b.innerHTML=`<div class="cv-big">${esc(D.sub).replace(/ /g,'<br>')}</div><div class="cv-line"></div><div class="cv-ttl">${esc(D.title)}</div><div class="cv-yr">${esc(D.year)}</div>`;
    padToFront();
  }
  // Table of contents — rows go in with placeholder numbers (filled in once
  // the recipes are laid out), spilling onto more cards as needed.
  const tocRows=[];
  if(D.toc){
    let b=newCard();b.style.setProperty('--fs','12pt');b.innerHTML='<div class="toc-h">תוכן העניינים</div>';
    let lastCat=null;
    D.recipes.forEach((r,i)=>{
      const add=html=>{const t=document.createElement('div');t.innerHTML=html;const el=t.firstChild;b.appendChild(el);
        if(!fits(b)){el.remove();b=newCard();b.style.setProperty('--fs','12pt');b.appendChild(el);}return el;};
      if(r.cat!==lastCat){lastCat=r.cat;add(`<div class="toc-c">${esc(r.cat)}</div>`);}
      tocRows[i]=add(`<div class="toc-r"><span>${esc(r.title)}</span><i></i><b>00</b></div>`);
    });
    padToFront();
  }
  // Recipes
  const starts=[];
  const blocks=r=>{
    const out=[`<div class="ttl">${esc(r.title)}</div>`];
    r.ings.forEach(x=>out.push(x.sec?`<div class="sec">${esc(x.sec)}:</div>`:`<div class="ing">${x.q?`<b><bdi dir="ltr">${esc(x.q)}</bdi></b>`:''}${esc(x.rest)}</div>`));
    if(r.steps.length){out.push('<div class="hd">אופן הכנה:</div>');r.steps.forEach(x=>out.push(x.sec?`<div class="sec">${esc(x.text)}:</div>`:`<div class="st">${esc(x.text)}</div>`));}
    if(r.note)out.push(`<div class="note">${esc(r.note).replace(/\n/g,'<br>')}</div>`);
    return out;
  };
  const SIZES=[15,14.5,14,13.5,13,12.5,12,11.5,11,10.5,10];
  const layRecipe=r=>{
    const bl=blocks(r);
    let b=newCard();
    for(const fs of SIZES){b.style.setProperty('--fs',fs+'pt');b.innerHTML=bl.join('');if(fits(b))return;}
    // Too long for one card even at the smallest size: continue on the next.
    b.innerHTML='';
    bl.forEach(h=>{
      const t=document.createElement('div');t.innerHTML=h;const nodes=[...t.childNodes];
      nodes.forEach(n=>b.appendChild(n));
      if(!fits(b)){nodes.forEach(n=>n.remove());b=newCard();b.style.setProperty('--fs',SIZES[SIZES.length-1]+'pt');
        b.innerHTML=`<div class="cont">${esc(r.title)} — המשך</div>`;nodes.forEach(n=>b.appendChild(n));}
    });
  };
  D.recipes.forEach(r=>{
    starts.push(pages.length);
    layRecipe(r);
    // The dish photo goes on its own card — the back of the recipe when
    // printed double-sided.
    if(duplex&&r.photo)newPage('photo',`<img src="${r.photo}" alt=""><div class="ph-cap">${esc(r.title)}</div>`);
    padToFront();
  });
  if(D.toc)pages.forEach((p,i)=>{const n=p.querySelector('.pno');if(n&&!p.querySelector('.cover'))n.textContent=i+1;});
  tocRows.forEach((row,i)=>{row.querySelector('b').textContent=starts[i]+1;});
  // Deal onto sheets: one card per page, or three across a landscape A4.
  // Double-sided A4: the back sheet holds the same three cards' backs in
  // reverse order, so each lands behind its front after a short-edge flip.
  const sheets=[];
  const sheetOf=list=>{const s=document.createElement('div');s.className='sheet';list.forEach(p=>s.appendChild(p||Object.assign(document.createElement('div'),{className:'page'})));sheets.push(s);};
  if(!three)pages.forEach(p=>sheetOf([p]));
  else if(!duplex)for(let i=0;i<pages.length;i+=3)sheetOf([pages[i],pages[i+1],pages[i+2]]);
  else for(let i=0;i<pages.length;i+=6){sheetOf([pages[i],pages[i+2],pages[i+4]]);sheetOf([pages[i+5],pages[i+3],pages[i+1]]);}
  stage.remove();sheets.forEach(s=>book.appendChild(s));
  const fit=()=>book.style.setProperty('--z',Math.min(three?1:1.6,(innerWidth-16)/(three?1123:375)));
  fit();addEventListener('resize',fit);
  document.getElementById('rcCount').textContent=`${pages.length} עמודים · ${sheets.length} דפים`;
  if(D.autoPrint)setTimeout(()=>print(),400);
  if(D.imageMode)document.getElementById('rcImgBtn').focus();
}
// Runs inside the print window: saves each card as a PNG (blank backs
// skipped), rendered by the browser itself via html-to-image so Hebrew and
// the rounded font come out exactly as on screen.
async function saveCardImages(){
  const btn=document.getElementById('rcImgBtn'),label=btn.textContent;
  btn.disabled=true;btn.textContent='מכין תמונה...';
  try{
    if(!window.htmlToImage)await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js';sc.onload=res;sc.onerror=rej;document.head.appendChild(sc);});
    const book=document.getElementById('book'),z=book.style.getPropertyValue('--z');
    book.style.setProperty('--z','1');
    const cards=[...document.querySelectorAll('.card')].filter(c=>!c.classList.contains('blank'));
    const name=(window.__RC.recipes.length===1?window.__RC.recipes[0].title:window.__RC.title).replace(/[\\/:*?"<>|]/g,'').trim()||'מתכון';
    const files=[];
    for(let i=0;i<cards.length;i++){
      const blob=await htmlToImage.toBlob(cards[i],{pixelRatio:3,backgroundColor:'#ffffff'});
      files.push(new File([blob],name+(cards.length>1?' '+(i+1):'')+'.png',{type:'image/png'}));
    }
    book.style.setProperty('--z',z);
    // Phones: the share sheet (save to gallery / send on WhatsApp). Computers: plain downloads.
    if(matchMedia('(pointer:coarse)').matches&&navigator.canShare&&navigator.canShare({files})){
      try{await navigator.share({files});return;}catch(e){if(e.name==='AbortError')return;}
    }
    for(const f of files){const a=document.createElement('a');a.href=URL.createObjectURL(f);a.download=f.name;document.body.appendChild(a);a.click();a.remove();await new Promise(r=>setTimeout(r,300));}
  }catch(e){console.error(e);alert('לא הצלחנו ליצור את התמונה: '+(e&&e.message||e));}
  finally{btn.disabled=false;btn.textContent=label;}
}
// Current Hebrew year in letters (תשפ״ז) for the booklet cover.
function hebYear(){
  try{
    const n=+new Intl.DateTimeFormat('en-u-ca-hebrew',{year:'numeric'}).format(new Date()).replace(/\D/g,'')%1000;
    const L=[[400,'ת'],[300,'ש'],[200,'ר'],[100,'ק'],[90,'צ'],[80,'פ'],[70,'ע'],[60,'ס'],[50,'נ'],[40,'מ'],[30,'ל'],[20,'כ'],[10,'י'],[9,'ט'],[8,'ח'],[7,'ז'],[6,'ו'],[5,'ה'],[4,'ד'],[3,'ג'],[2,'ב'],[1,'א']];
    let r=n,out='';
    for(const [v,c] of L){while(r>=v){if(r===15){out+='טו';r=0;break;}if(r===16){out+='טז';r=0;break;}out+=c;r-=v;}}
    return 'שנת '+(out.length>1?out.slice(0,-1)+'״'+out.slice(-1):out+'׳');
  }catch(e){return '';}
}
function openPrint(recipes,o){
  const w=window.open('','_blank');
  if(!w){toast('הדפדפן חסם את חלון ההדפסה — אפשרו חלונות קופצים');return;}
  const layout=o.layout==='a4'?'a4':'single';
  const data={recipes,layout,photos:o.photos!==false,cover:!!o.cover,toc:!!o.toc,autoPrint:!!o.autoPrint,imageMode:!!o.imageMode,
    title:o.title||BOOK_TITLE,sub:o.sub||BOOK_SUB,
    year:hebYear()};
  const page=layout==='a4'?'A4 landscape':'99mm 210mm';
  const json=JSON.stringify(data).replace(/</g,'\\u003c');
  w.document.write(`<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${E(o.docTitle||data.title)}</title><link rel="stylesheet" crossorigin="anonymous" href="https://fonts.googleapis.com/css2?family=Varela+Round&display=swap"><style>@page{size:${page};margin:0}${PRINT_CSS.replace("__BG__",new URL("recipe-card-bg.jpg",location.href).href)}${layout==='a4'?'.sheet{width:297mm;height:210mm}':'.sheet{width:99mm;height:210mm}'}</style></head><body>
<div class="bar">${o.imageMode?'<button id="rcImgBtn" onclick="saveCardImages()">🖼 שמירה כתמונה</button><button class="alt" onclick="print()">🖨 הדפסה</button>':'<button onclick="print()">🖨 הדפסה / PDF</button><button class="alt" id="rcImgBtn" onclick="saveCardImages()">🖼 כתמונה</button>'}<span><b id="rcCount"></b>${layout==='a4'?' · נייר A4 לרוחב':''}</span></div>
<div id="book"></div>
<script>window.__RC=${json};${saveCardImages.toString()}
function run(){(${printScript.toString()})();}
(document.fonts?Promise.race([document.fonts.load('16px "Varela Round"','אבג').then(()=>document.fonts.ready),new Promise(r=>setTimeout(r,4000))]):new Promise(r=>setTimeout(r,800))).then(()=>setTimeout(run,30));<\/script>
</body></html>`);
  w.document.close();
}
window.rcPrint=function(){
  const r=cur();if(!r)return;
  openPrint([printData(r,S.scale)],{autoPrint:true,docTitle:r.title,photos:!!r.photo});
};
window.rcSaveImage=function(){
  const r=cur();if(!r)return;
  openPrint([printData(r,S.scale)],{imageMode:true,docTitle:r.title,photos:false});
};
// Booklet: pick which recipes and the paper layout, then open the book.
window.rcOpenBook=function(){
  if(!S.recipes.length){toast('אין עדיין מתכונים לחוברת');return;}
  const nF=filtered().length,o=lsGet('rcBookOpts',{});
  $('rcBookBody').innerHTML=`
    <div class="rc-f"><label>שם החוברת</label><input type="text" id="rcBkTitle" value="${E(o.title||BOOK_TITLE)}"></div>
    <div class="rc-f"><label>כותרת השער</label><input type="text" id="rcBkSub" value="${E(o.sub||BOOK_SUB)}"></div>
    <div class="rc-f"><label>אילו מתכונים?</label><div class="rc-pick">
      <button type="button" class="on" data-v="all" onclick="rcBkPick(this)">כל המתכונים (${S.recipes.length})</button>
      ${nF!==S.recipes.length?`<button type="button" data-v="filtered" onclick="rcBkPick(this)">רק המסוננים כרגע (${nF})</button>`:''}
      ${favs().size?`<button type="button" data-v="fav" onclick="rcBkPick(this)">⭐ המועדפים שלי (${S.recipes.filter(r=>favs().has(r.id)).length})</button>`:''}
    </div></div>
    <div class="rc-f"><label>פריסת הדפים</label><div class="rc-pick" id="rcBkLayout">
      <button type="button" class="${o.layout!=='single'?'on':''}" data-v="a4" onclick="rcBkPick(this)">✂️ 3 מתכונים בדף A4</button>
      <button type="button" class="${o.layout==='single'?'on':''}" data-v="single" onclick="rcBkPick(this)">📄 כרטיס בכל עמוד</button>
    </div><small>3 בדף A4 לרוחב — מדפיסים בבית וגוזרים לשלושה כרטיסים. כרטיס בכל עמוד — לבית דפוס או לקובץ PDF.</small></div>
    <div class="rc-f"><label style="display:flex;align-items:center;gap:8px;font-size:14px;color:var(--rc-ink)"><input type="checkbox" id="rcBkPhotos" ${o.photos===false?'':'checked'} style="width:18px;height:18px"> תמונת המנה בגב כל מתכון</label><small>להדפסה דו-צדדית: מתכון מקדימה ותמונה מאחורה. כל מתכון מתחיל בצד הקדמי של דף, ומתכון בלי תמונה מקבל גב ריק. בחלון ההדפסה בחרו הדפסה דו-צדדית: ל-3 בדף A4 — היפוך בצד הקצר; לכרטיס בכל עמוד — היפוך בצד הארוך.</small></div>`;
  $('rcBookModal').classList.add('open');
};
window.rcBkPick=function(btn){btn.parentNode.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===btn));};
window.rcMakeBook=function(){
  const which=($('rcBookBody').querySelector('.rc-pick button.on')||{}).dataset.v||'all';
  const layout=($('rcBkLayout').querySelector('button.on')||{}).dataset.v||'a4';
  const o={title:$('rcBkTitle').value.trim()||BOOK_TITLE,sub:$('rcBkSub').value.trim()||BOOK_SUB,layout,photos:$('rcBkPhotos').checked};
  lsSet('rcBookOpts',o);
  let list=which==='filtered'?filtered():which==='fav'?S.recipes.filter(r=>favs().has(r.id)):S.recipes.slice();
  if(!list.length){toast('אין מתכונים בבחירה הזו');return;}
  const ord=new Map(CATS.map((c,i)=>[c.id,i]));
  const c0=r=>catsOf(r)[0];
  list=list.slice().sort((a,b)=>(ord.get(c0(a))??99)-(ord.get(c0(b))??99)||byLabel(catOf(c0(a)).lbl,catOf(c0(b)).lbl)||byLabel(a.title,b.title));
  rcCloseModal('rcBookModal');
  openPrint(list.map(r=>printData(r,1)),{...o,cover:true,toc:true});
};
window.rcMadeIt=async function(){
  const r=cur();if(!r)return;
  const name=askName();if(!name)return;
  try{await S.store.addMade(r.id,{name,ts:Date.now(),d:deviceId()});toast('👏 כל הכבוד! בתיאבון');celebrate();}
  catch(e){console.warn(e);toast('⚠️ השמירה נכשלה');}
};
function celebrate(){
  const o=$('recipesOverlay');
  for(let i=0;i<18;i++){
    const s=document.createElement('span');
    s.textContent=['🎉','👏','😋','⭐','❤️'][i%5];
    s.style.cssText=`position:absolute;z-index:60;font-size:${18+Math.random()*16}px;left:${10+Math.random()*80}%;bottom:-30px;pointer-events:none;transition:transform 1.6s cubic-bezier(.2,.8,.3,1),opacity 1.6s`;
    o.appendChild(s);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{s.style.transform=`translateY(-${50+Math.random()*45}vh) rotate(${Math.random()*360-180}deg)`;s.style.opacity='0';}));
    setTimeout(()=>s.remove(),1700);
  }
}
window.rcAddComment=async function(){
  const r=cur();if(!r)return;
  const t=($('rcCmText').value||'').trim();if(!t)return;
  const ni=$('rcCmName');
  if(ni){const n=ni.value.trim();if(!n){ni.focus();return;}lsSet('rcMyName',n);}
  const c={id:'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),name:myName(),text:t,ts:Date.now(),deviceId:deviceId()};
  try{await S.store.addComment(r.id,c);$('rcCmText').value='';toast('💬 התגובה נוספה');}
  catch(e){console.warn(e);toast('⚠️ השמירה נכשלה');}
};
window.rcDelComment=async function(cid){
  const r=cur();if(!r)return;
  const c=(r.comments||[]).find(x=>x.id===cid);if(!c||!confirm('למחוק את התגובה?'))return;
  try{await S.store.removeComment(r.id,c);}catch(e){console.warn(e);toast('⚠️ המחיקה נכשלה');}
};

// ── cook mode ──────────────────────────────────────────────────────────────
async function acquireWake(){try{if('wakeLock' in navigator)S.wake=await navigator.wakeLock.request('screen');}catch(e){S.wake=null;}}
window.rcOpenCook=function(){S.cookIdx=0;renderCook();$('rcCook').classList.add('open');acquireWake();};
window.rcCloseCook=function(){$('rcCook').classList.remove('open');try{S.wake&&S.wake.release();}catch(e){}S.wake=null;};
function renderCook(){
  const r=cur();if(!r)return;
  const steps=stepLines(r),i=S.cookIdx,last=i===steps.length-1;
  $('rcCook').innerHTML=`
    <div class="rc-cm-top"><button class="rc-ibtn" onclick="rcCloseCook()">✕</button><div class="rc-cm-ttl">${E(r.title)}</div>
      <button class="rc-ibtn" style="width:auto;padding:0 14px;border-radius:19px;font-size:13px;font-weight:800" onclick="$rcIngs(true)">🧺 מצרכים</button></div>
    <div class="rc-dots">${steps.map((_,j)=>`<i class="${j===i?'on':j<i?'past':''}"></i>`).join('')}</div>
    <div class="rc-cm-body"><div class="rc-cm-n">שלב ${i+1} מתוך ${steps.length}${stepSection(r,i)?` · ${E(stepSection(r,i))}`:''}</div><div class="rc-cm-step">${stepHtml(steps[i],i+1)}</div></div>
    <div class="rc-wake">${S.wake||('wakeLock' in navigator)?'☀️ המסך יישאר דלוק בזמן הבישול':''}</div>
    <div class="rc-cm-nav"><button onclick="rcCookGo(-1)" ${i===0?'disabled':''}>→ הקודם</button>
      <button class="pri" onclick="${last?'rcCookDone()':'rcCookGo(1)'}">${last?'🎉 סיימתי!':'הבא ←'}</button></div>
    <div class="rc-cm-ings" id="rcCmIngs" onclick="if(event.target===this)$rcIngs(false)"><div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><b style="font-size:18px">🧺 מצרכים</b><button class="rc-ibtn" onclick="$rcIngs(false)">✕</button></div>
      <div id="rcCmIngList">${ingListHtml(r)}</div></div></div>`;
}
window.$rcIngs=function(open){
  const el=$('rcCmIngs');if(!el)return;
  if(open){const r=cur();$('rcCmIngList').innerHTML=ingListHtml(r);}
  el.classList.toggle('open',open);
};
window.rcCookGo=function(d){const n=stepLines(cur()).length;S.cookIdx=Math.max(0,Math.min(n-1,S.cookIdx+d));renderCook();};
window.rcCookDone=function(){rcCloseCook();celebrate();setTimeout(()=>{if(confirm('בתיאבון! 😋 לסמן ש"הכנתי את זה"?'))rcMadeIt();},700);};
document.addEventListener('keydown',e=>{
  const c=$('rcCook');if(!c||!c.classList.contains('open'))return;
  if(e.key==='ArrowLeft'||e.key===' '){e.preventDefault();rcCookGo(1);}
  else if(e.key==='ArrowRight')rcCookGo(-1);
  else if(e.key==='Escape')rcCloseCook();
});

// ── kitchen timers ─────────────────────────────────────────────────────────
let _audio=null;
function beep(){
  try{
    _audio=_audio||new (window.AudioContext||window.webkitAudioContext)();
    const t0=_audio.currentTime;
    [0,.25,.5,1,1.25,1.5].forEach(o=>{
      const osc=_audio.createOscillator(),g=_audio.createGain();
      osc.frequency.value=880;osc.type='sine';
      g.gain.setValueAtTime(0.0001,t0+o);g.gain.exponentialRampToValueAtTime(0.35,t0+o+0.02);g.gain.exponentialRampToValueAtTime(0.0001,t0+o+0.2);
      osc.connect(g).connect(_audio.destination);osc.start(t0+o);osc.stop(t0+o+0.22);
    });
  }catch(e){}
  try{navigator.vibrate&&navigator.vibrate([300,150,300,150,600]);}catch(e){}
}
window.rcStartTimer=function(sec,stepNo){
  const r=cur();
  try{_audio=_audio||new (window.AudioContext||window.webkitAudioContext)();_audio.resume&&_audio.resume();}catch(e){}
  S.timers.push({id:Date.now()+Math.random(),label:(r?r.title:'')+(stepNo?` · שלב ${stepNo}`:''),end:Date.now()+sec*1000,ring:false});
  toast(`⏲ טיימר הופעל ל-${fmtClock(sec)}`);
  if(!S.tick)S.tick=setInterval(tickTimers,500);
  tickTimers();
};
function fmtClock(s){s=Math.max(0,Math.round(s));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(x).padStart(2,'0');}
function tickTimers(){
  const box=$('rcTimers');if(!box)return;
  const now=Date.now();
  S.timers.forEach(t=>{if(!t.ring&&t.end<=now){t.ring=true;beep();toast('⏰ הטיימר הסתיים! '+t.label,5000);}});
  if(S.timers.some(t=>t.ring)&&now%3000<500)beep();
  // Each timer's box is built once (and again only when it starts ringing);
  // every tick just updates its digits, so it stays put instead of
  // re-playing its entrance animation twice a second.
  const live=new Set(S.timers.map(t=>String(t.id)));
  [...box.children].forEach(el=>{if(!live.has(el.dataset.id))el.remove();});
  S.timers.forEach(t=>{
    let el=box.querySelector(`[data-id="${t.id}"]`);
    if(!el||el.classList.contains('ring')!==t.ring){
      const fresh=document.createElement('div');
      fresh.className='rc-timer'+(t.ring?' ring':'');fresh.dataset.id=t.id;
      fresh.innerHTML=`<div><div class="rc-timer-t"></div><div class="rc-timer-l">${E(t.label)}</div></div>
    ${t.ring?'':`<button onclick="rcTimerAdd(${t.id})" title="דקה נוספת">+1</button>`}
    <button onclick="rcTimerStop(${t.id})" title="${t.ring?'סיום':'ביטול'}">${t.ring?'✓':'✕'}</button>`;
      if(el)el.replaceWith(fresh);else box.appendChild(fresh);
      el=fresh;
    }
    const txt=t.ring?'⏰ 0:00':fmtClock((t.end-now)/1000),tEl=el.querySelector('.rc-timer-t');
    if(tEl.textContent!==txt)tEl.textContent=txt;
  });
  if(!S.timers.length&&S.tick){clearInterval(S.tick);S.tick=null;}
}
window.rcTimerAdd=function(id){const t=S.timers.find(x=>x.id===id);if(t)t.end+=60000;tickTimers();};
window.rcTimerStop=function(id){S.timers=S.timers.filter(x=>x.id!==id);tickTimers();};

// ── shopping list ──────────────────────────────────────────────────────────
// The list keeps every recipe's ingredients as added (so each line can say
// where it came from); what's shown merges them: same ingredient in the same
// unit is summed — 4 כפות סוכר + 2 כפות סוכר = 6 כפות סוכר. Grams/kilos and
// ml/liters are combined too; cups and spoons stay apart.
const UNITS=[
  {k:'cup',one:'כוס',many:'כוסות',w:['כוס','כוסות','כוסות']},
  {k:'tbsp',one:'כף',many:'כפות',w:['כף','כפות']},
  {k:'tsp',one:'כפית',many:'כפיות',w:['כפית','כפיות']},
  {k:'g',one:'גרם',many:'גרם',w:['גרם','גר\'','גר׳','גר','ג\'','ג׳','ג']},
  {k:'g',f:1000,w:['קילו','ק"ג','ק״ג','קג','קילוגרם']},
  {k:'ml',one:'מ״ל',many:'מ״ל',w:['מ"ל','מ״ל','מל','מיליליטר']},
  {k:'ml',f:1000,w:['ליטר','ליטרים']},
  {k:'pkt',one:'חבילה',many:'חבילות',w:['חבילה','חבילות','חבילת']},
  {k:'bag',one:'שקית',many:'שקיות',w:['שקית','שקיות']},
  {k:'jar',one:'צנצנת',many:'צנצנות',w:['צנצנת','צנצנות']},
  {k:'can',one:'קופסה',many:'קופסאות',w:['קופסה','קופסא','קופסאות','קופסת','פחית','פחיות']},
  {k:'clove',one:'שן',many:'שיני',w:['שן','שיני','שיניים']},
  {k:'slice',one:'פרוסה',many:'פרוסות',w:['פרוסה','פרוסות']},
  {k:'bunch',one:'צרור',many:'צרורות',w:['צרור','צרורות']},
  {k:'unit',one:'יחידה',many:'יחידות',w:['יחידה','יחידות']}
];
// counted items written in the singular ("ביצה אחת") merge with the plural
const SHOP_PLURAL={'ביצה':'ביצים','בצל':'בצלים','עגבניה':'עגבניות','עגבנייה':'עגבניות','תפוח אדמה':'תפוחי אדמה','גזר':'גזרים','לימון':'לימונים','מלפפון':'מלפפונים','תפוח':'תפוחים','בננה':'בננות','פלפל':'פלפלים','חלמון':'חלמונים','חלבון':'חלבונים'};
function parseShopItem(text){
  let t=String(text||'').trim(),qty=null;
  const s1=scaleLine(t,1);
  if(s1.q){
    const q=String(s1.q).split(/[-–]/).pop().trim();
    qty=NUM_WORDS[q]!=null?NUM_WORDS[q]:parseNum(q);
    if(!isFinite(qty))qty=null;
    t=s1.rest.trim();
  }
  // "ביצה אחת", "שן שום אחת": the count written after the name
  if(qty==null&&/\s(אחת|אחד)$/.test(t)){qty=1;t=t.replace(/\s(אחת|אחד)$/,'');}
  let unit=null,f=1;
  for(const u of UNITS){
    const w=u.w.find(w=>t===w||t.startsWith(w+' '));
    // a unit with no number before it means one: "קילו קמח", "כוס סוכר"
    if(w&&t!==w){unit=u.k;f=u.f||1;t=t.slice(w.length).trim();if(qty==null)qty=1;break;}
  }
  let name=t.replace(/^של\s+/,'').replace(/[.,;]+$/,'').replace(/\s+/g,' ').trim();
  if(!unit&&SHOP_PLURAL[name])name=SHOP_PLURAL[name];
  return {qty:qty!=null?qty*f:null,unit,name:name||String(text||'').trim()};
}
function unitLabel(k,n){
  if(k==='g')return n>=1000?['קילו',n/1000]:['גרם',n];
  if(k==='ml')return n>=1000?['ליטר',n/1000]:['מ״ל',n];
  const u=UNITS.find(u=>u.k===k&&u.one);
  return [u?(n>1?u.many:u.one):'',n];
}
function shopMerged(){
  const map=new Map();
  shop().forEach(x=>{
    const p=parseShopItem(x.text);
    const key=(p.qty!=null?(p.unit||'#'):'-')+'|'+p.name.toLowerCase();
    if(!map.has(key))map.set(key,{key,name:p.name,unit:p.unit,qty:p.qty!=null?0:null,ids:[],from:new Set(),done:true});
    const m=map.get(key);
    if(p.qty!=null)m.qty+=p.qty;
    m.ids.push(x.id);if(x.from)m.from.add(x.from);
    if(!x.done)m.done=false;
  });
  return [...map.values()].map(m=>{
    let text=m.name;
    if(m.qty!=null){const [u,n]=m.unit?unitLabel(m.unit,m.qty):['',m.qty];text=fmtNum(n)+' '+(u?u+' ':'')+m.name;}
    return {...m,text,from:[...m.from]};
  });
}
function updateShopBadge(){
  const b=$('rcShopBadge');if(!b)return;
  const n=shopMerged().filter(x=>!x.done).length;
  b.textContent=n;b.style.display=n?'flex':'none';
}
window.rcAddToShop=function(){
  const r=cur();if(!r)return;
  const list=shop(),have=new Set(list.filter(x=>x.from===r.title&&!x.done).map(x=>x.text));
  let n=0;
  ingLines(r).filter(l=>!l.sec).forEach(l=>{
    const s=scaleLine(l.text,S.scale),text=(s.q+s.rest).trim();
    if(have.has(text))return;
    list.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),text,from:r.title,done:false});n++;
  });
  setShop(list);
  toast(n?`🛒 ${n} מצרכים נוספו לרשימת הקניות`:'המצרכים כבר ברשימה');
};
window.rcOpenShop=function(){renderShop();$('rcShopModal').classList.add('open');};
window.rcCloseModal=function(id){$(id).classList.remove('open');};
function renderShop(){
  const items=shopMerged(),recipes=[...new Set(shop().map(x=>x.from).filter(Boolean))];
  // not-yet-bought first; the rest sink to the bottom, crossed out
  items.sort((a,b)=>a.done-b.done);
  $('rcShopBody').innerHTML=`<div class="rc-shop-add"><input id="rcShopInp" placeholder="הוספת פריט..." onkeydown="if(event.key==='Enter')rcShopAdd()"><button onclick="rcShopAdd()">+</button></div>`+
    (items.length?(recipes.length?`<div class="rc-shop-from">🍲 ${recipes.map(E).join(' · ')}</div>`:'')
      +`<ul class="rc-ing">${items.map(x=>`<li class="${x.done?'done':''}" data-k="${E(x.key)}" onclick="rcShopToggle(this.dataset.k)"><span class="rc-ck">✓</span><span class="rc-ing-tx">${E(x.text)}${x.from.length>1||(x.from.length&&recipes.length>1)?`<small class="rc-shop-src">${x.from.map(E).join(' · ')}</small>`:''}</span><button class="rc-shop-x" onclick="event.stopPropagation();rcShopDel(this.parentNode.dataset.k)">✕</button></li>`).join('')}</ul>`
      +`<button onclick="if(confirm('לרוקן את כל הרשימה?'))rcShopClear(false)" style="border:none;background:none;color:var(--rc-meat);font-size:12px;font-weight:700;padding:4px 0">🗑 ריקון הרשימה</button>`
    :'<div class="rc-empty" style="padding:30px 10px"><span class="rc-empty-ico" style="font-size:48px">🛒</span>הרשימה ריקה.<br>בדף של מתכון לחצו "לקניות" כדי להוסיף את המצרכים שלו.</div>');
}
window.rcShopAdd=function(){const i=$('rcShopInp'),t=(i.value||'').trim();if(!t)return;const l=shop();l.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2,5),text:t,from:'',done:false});setShop(l);renderShop();$('rcShopInp').focus();};
// toggling / deleting a merged line acts on every entry behind it
function idsOf(key){const m=shopMerged().find(x=>x.key===key);return m?new Set(m.ids):new Set();}
window.rcShopToggle=function(key){const m=shopMerged().find(x=>x.key===key);if(!m)return;const ids=new Set(m.ids),l=shop();l.forEach(x=>{if(ids.has(x.id))x.done=!m.done;});setShop(l);renderShop();};
window.rcShopDel=function(key){const ids=idsOf(key);setShop(shop().filter(x=>!ids.has(x.id)));renderShop();};
window.rcShopClear=function(onlyDone){setShop(onlyDone?shop().filter(x=>!x.done):[]);renderShop();};
window.rcShopShare=async function(){
  const items=shopMerged().filter(x=>!x.done);if(!items.length){toast('אין פריטים לשליחה');return;}
  const text='🛒 *רשימת קניות*\n'+items.map(x=>'▫️ '+x.text).join('\n');
  if(navigator.share){try{await navigator.share({text});return;}catch(e){if(e.name==='AbortError')return;}}
  window.open('https://wa.me/?text='+encodeURIComponent(text),'_blank');
};

// ── random pick ────────────────────────────────────────────────────────────
window.rcRandom=function(){
  const pool=filtered().length?filtered():S.recipes;
  if(!pool.length){toast('אין עדיין מתכונים להגרלה');return;}
  const modal=$('rcRandModal'),body=$('rcRandBody');
  modal.classList.add('open');
  let n=0;const spins=pool.length>1?9:1;
  body.classList.add('rc-spin');
  const show=r=>{window._rcRandId=r.id;body.innerHTML=`<div class="rc-rand"><div class="rc-rand-card"><div class="rc-rand-img" style="${r.photo?'':grad(r)}">${r.photo?`<img src="${r.photo}" alt="">`:E(r.emoji||catOf(catsOf(r)[0]).ico)}</div>
    <div class="rc-rand-ttl">${E(r.title)}</div><div class="rc-rand-sub">${[r.origin&&('👵 '+E(r.origin)),totalMin(r)&&('⏱ '+fmtMin(totalMin(r))),E(catLabels(r))].filter(Boolean).join(' · ')}</div></div></div>`;};
  let prev=null;
  const step=()=>{
    let r;do{r=pool[Math.floor(Math.random()*pool.length)];}while(pool.length>1&&r===prev);
    prev=r;show(r);
    if(++n<spins)setTimeout(step,60+n*22);else body.classList.remove('rc-spin');
  };
  step();
};

// ── editor ─────────────────────────────────────────────────────────────────
window.rcOpenEditor=function(id){
  const r=id?S.recipes.find(x=>x.id===id):null;
  S.edit=r?{...JSON.parse(JSON.stringify(r)),categories:catsOf(r).filter(c=>c!=='other'||catsOf(r).length===1)}:{id:null,title:'',emoji:'',categories:[],kosher:'',tags:[],prepMin:'',cookMin:'',servings:'',difficulty:0,ingredients:'',steps:'',story:'',origin:'',tips:''};
  S.editPhoto=r?r.photo||null:null;S.editScan=r?r.scan||null:null;
  $('rcEditTtl').textContent=r?'עריכת מתכון':'✨ מתכון חדש';
  $('rcEditDel').style.display=r&&canDelete(r)?'':'none';
  renderEditor();
  $('rcEditModal').classList.add('open');
  $('rcEditBody').scrollTop=0;
};
window.rcCloseEditor=function(){$('rcEditModal').classList.remove('open');S.edit=null;};
function treeNames(){
  try{return typeof familyTree!=='undefined'?[...new Set(familyTree.map(p=>p.name).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'he')):[];}catch(e){return [];}
}
function renderEditor(){
  const e=S.edit;
  const pick=(key,opts,multi)=>`<div class="rc-pick">${opts.map(o=>{
    const on=multi?(e[key]||[]).includes(o.id):e[key]===o.id;
    return `<button type="button" class="${on?'on':''}" data-v="${E(o.id)}" onclick="rcEdPick('${key}',this.dataset.v,${multi?1:0})">${o.ico?o.ico+' ':''}${E(o.lbl)}</button>`;}).join('')}${multi?`<button type="button" class="rc-pick-add" onclick="rcEdAdd('${key}')">＋ חדש</button>`:''}</div>`;
  const names=[...new Set([...treeNames(),...cooks().map(c=>c[0])])];
  $('rcEditBody').innerHTML=`
    ${SCAN_ENABLED?`<div class="rc-scanbox${S.scanning?' busy':''}">
      ${S.scanning?`<div class="rc-scan-spin">📖</div><b>קוראים את המתכון...</b><small>זה לוקח בדרך כלל 10–30 שניות</small>`
      :`<button type="button" onclick="rcScanPick()"><span>📸</span><div><b>סריקת מתכון מתמונה</b><small>צלמו את הפתק, הדף מהספר או צילום מסך — והשדות יתמלאו לבד</small></div></button>${e.id?'':`<button type="button" class="rc-scan-pdf" onclick="rcImportPick()"><span>📚</span><div><b>ייבוא ספר מתכונים מקובץ PDF</b><small>כל המתכונים שבקובץ נקראים בבת אחת — בודקים ושומרים</small></div></button>`}`}
    </div>`:''}
    <div class="rc-f"><label>שם המתכון *</label><input type="text" id="rcEdTitle" value="${E(e.title)}" placeholder="לדוגמה: עוגת השמרים של סבתא"><div class="rc-err" id="rcEdTitleErr">צריך לתת למתכון שם</div></div>
    <div class="rc-f"><label>תמונות</label>
      <div class="rc-photo-pick">
        <button type="button" class="rc-photo-slot" onclick="rcChoosePhoto('photo')">${S.editPhoto?`<img src="${S.editPhoto}" alt=""><span class="rc-photo-rm" onclick="event.stopPropagation();rcClearPhoto('photo')">✕</span>`:'<i>📷</i>תמונת המנה'}</button>
        <button type="button" class="rc-photo-slot" onclick="rcChoosePhoto('scan')">${S.editScan?`<img src="${S.editScan}" alt=""><span class="rc-photo-rm" onclick="event.stopPropagation();rcClearPhoto('scan')">✕</span>`:'<i>📜</i>כתב היד המקורי'}</button>
      </div>
      <small>יש לכם את הפתק של סבתא בכתב יד? צלמו אותו — הוא יישמר לצד המתכון.</small></div>
    <div class="rc-f"><label>אייקון ${S.editPhoto?'(מוצג כשאין תמונה)':''}</label><div class="rc-emojis">${EMOJIS.map(x=>`<button type="button" class="${e.emoji===x?'on':''}" onclick="rcEdPick('emoji','${x}',0)">${x}</button>`).join('')}</div></div>
    <div class="rc-f"><label>מהמטבח של...</label><input type="text" id="rcEdOrigin" list="rcNames" value="${E(e.origin)}" placeholder="סבתא רחל, דודה מירי, אמא...">
      <datalist id="rcNames">${names.map(n=>`<option value="${E(n)}">`).join('')}</datalist><small>של מי המתכון במקור? כך אפשר לראות את כל המתכונים של כל אחד.</small></div>
    <div class="rc-f"><label>קטגוריה <span class="rc-hint">(אפשר לבחור כמה)</span></label>${pick('categories',allCats(e.categories),true)}</div>
    <div class="rc-f"><label>כשרות</label>${pick('kosher',KOSHER,false)}</div>
    <div class="rc-f"><label>מתאים ל... <span class="rc-hint">(אפשר לבחור כמה)</span></label>${pick('tags',allTags(e.tags),true)}</div>
    <div class="rc-row">
      <div class="rc-f"><label>הכנה (דק׳)</label><input type="number" min="0" inputmode="numeric" id="rcEdPrep" value="${E(e.prepMin||'')}"></div>
      <div class="rc-f"><label>בישול (דק׳)</label><input type="number" min="0" inputmode="numeric" id="rcEdCook" value="${E(e.cookMin||'')}"></div>
      <div class="rc-f"><label>מנות</label><input type="number" min="0" inputmode="numeric" id="rcEdServ" value="${E(e.servings||'')}"></div>
    </div>
    <div class="rc-f"><label>רמת קושי</label>${pick('difficulty',[{id:1,lbl:'🔥 קל'},{id:2,lbl:'🔥🔥 בינוני'},{id:3,lbl:'🔥🔥🔥 מאתגר'}],false)}</div>
    <div class="rc-f"><label>מצרכים</label><textarea id="rcEdIng" rows="7" placeholder="3 כוסות קמח&#10;1/2 כוס סוכר&#10;2 ביצים&#10;&#10;לציפוי:&#10;100 גרם שוקולד">${E(e.ingredients)}</textarea>
      <small>מצרך בכל שורה, עם הכמות בהתחלה — כך אפשר להגדיל ולהקטין את הכמויות אוטומטית. שורה שמסתיימת בנקודתיים (":") היא כותרת.</small></div>
    <div class="rc-f"><label>אופן ההכנה</label><textarea id="rcEdSteps" rows="7" placeholder="מערבבים את כל היבשים בקערה&#10;מוסיפים את הביצים ולשים בצק רך&#10;אופים 40 דקות ב-180 מעלות">${E(e.steps)}</textarea>
      <small>שלב בכל שורה. שורה שמסתיימת בנקודתיים (":") היא כותרת. זמנים כמו "40 דקות" או "חצי שעה" יהפכו אוטומטית לטיימר שאפשר להפעיל.</small></div>
    <div class="rc-f"><label>הסיפור מאחורי המתכון</label><textarea id="rcEdStory" rows="3" placeholder="סבתא הייתה מכינה את זה כל ערב שבת...">${E(e.story)}</textarea></div>
    <div class="rc-f"><label>טיפים וסודות</label><textarea id="rcEdTips" rows="2" placeholder="הסוד הוא...">${E(e.tips)}</textarea></div>
    <div class="rc-f"><label>השם שלך</label><input type="text" id="rcEdMe" value="${E(myName())}" placeholder="מי מוסיף/ה את המתכון?"></div>`;
}
function readEditor(){
  const e=S.edit;
  e.title=$('rcEdTitle').value.trim();e.origin=$('rcEdOrigin').value.trim();
  e.prepMin=$('rcEdPrep').value;e.cookMin=$('rcEdCook').value;e.servings=$('rcEdServ').value;
  e.ingredients=$('rcEdIng').value;e.steps=$('rcEdSteps').value;e.story=$('rcEdStory').value.trim();e.tips=$('rcEdTips').value.trim();
  const me=$('rcEdMe').value.trim();if(me)lsSet('rcMyName',me);
}
window.rcEdPick=function(key,val,multi){
  readEditor();
  const e=S.edit;
  if(key==='difficulty')val=+val;
  if(multi){const a=e[key]||[];e[key]=a.includes(val)?a.filter(x=>x!==val):a.concat(val);}
  else e[key]=e[key]===val?(key==='difficulty'?0:''):val;
  const st=$('rcEditBody').scrollTop;renderEditor();$('rcEditBody').scrollTop=st;
};
// "+ new" next to categories / tags: the typed name becomes a selectable
// option for this recipe, and from then on for every recipe that uses it.
window.rcEdAdd=function(key){
  readEditor();
  const isCat=key==='categories';
  let name=(prompt(isCat?'שם הקטגוריה החדשה (למשל: פשטידות)':'מתאים ל... (למשל: יום הולדת, ארוחת בוקר)')||'').trim().replace(/\s+/g,' ').slice(0,30);
  if(!name)return;
  const known=(isCat?CATS:HOLIDAYS).find(x=>x.lbl===name);
  if(known)name=known.id;
  const e=S.edit,a=e[key]||[];
  if(!a.includes(name))e[key]=a.concat(name);
  const st=$('rcEditBody').scrollTop;renderEditor();$('rcEditBody').scrollTop=st;
};
let _photoSlot='photo';
window.rcChoosePhoto=function(slot){_photoSlot=slot;$('rcPhotoInp').value='';$('rcPhotoInp').click();};
window.rcClearPhoto=function(slot){readEditor();if(slot==='photo')S.editPhoto=null;else S.editScan=null;const st=$('rcEditBody').scrollTop;renderEditor();$('rcEditBody').scrollTop=st;};
// Photos are stored inline in the recipe doc, so they're shrunk hard here:
// Firestore caps a document at 1MB, and the dish photo + handwritten scan
// together must fit well under that.
function compress(file,maxSide,quality){
  return new Promise((res,rej)=>{
    const img=new Image(),url=URL.createObjectURL(file);
    img.onload=()=>{
      let w=img.naturalWidth,h=img.naturalHeight;const k=Math.min(1,maxSide/Math.max(w,h));w=Math.round(w*k);h=Math.round(h*k);
      const c=document.createElement('canvas');c.width=w;c.height=h;
      const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
      URL.revokeObjectURL(url);
      let q=quality,out=c.toDataURL('image/jpeg',q);
      while(out.length>330000&&q>0.4){q-=0.08;out=c.toDataURL('image/jpeg',q);}
      res(out);
    };
    img.onerror=()=>{URL.revokeObjectURL(url);rej(new Error('bad image'));};
    img.src=url;
  });
}
window.rcPickPhoto=async function(inp){
  const f=inp.files&&inp.files[0];if(!f)return;
  readEditor();
  try{
    const data=await compress(f,_photoSlot==='scan'?1400:1000,_photoSlot==='scan'?0.7:0.75);
    if(_photoSlot==='photo')S.editPhoto=data;else S.editScan=data;
    const st=$('rcEditBody').scrollTop;renderEditor();$('rcEditBody').scrollTop=st;
  }catch(e){toast('⚠️ לא הצלחנו לקרוא את התמונה');}
};
// ── scan a photographed recipe into the form (/api/recipe-scan) ─────────────
window.rcScanPick=function(){$('rcScanInp').value='';$('rcScanInp').click();};
async function scanRequest(images){
  if(window.RECIPES_SCAN_MOCK)return window.RECIPES_SCAN_MOCK(images);
  const r=await fetch('/api/recipe-scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({images})});
  let d={};try{d=await r.json();}catch(e){}
  if(!r.ok){
    const msg={'no recipe found':'לא מצאנו מתכון בתמונה — נסו צילום ברור יותר','not configured':'סריקת מתכונים עדיין לא הופעלה באתר','image too large':'התמונה גדולה מדי','busy, try again':'השירות עמוס, נסו שוב בעוד רגע'}[d.error];
    throw new Error(msg||'הסריקה נכשלה ('+(d.error||r.status)+')');
  }
  return d.recipe;
}
window.rcScanFiles=async function(inp){
  const files=[...(inp.files||[])].slice(0,3);if(!files.length||!S.edit)return;
  if((inp.files||[]).length>3)toast('נסרקות 3 התמונות הראשונות');
  readEditor();
  S.scanning=true;renderEditor();$('rcEditBody').scrollTop=0;
  try{
    const images=await Promise.all(files.map(f=>compress(f,1600,0.82)));
    const x=await scanRequest(images);
    if(!S.edit)return;
    const e=S.edit,lines=a=>(a||[]).map(t=>String(t).trim()).filter(Boolean).join('\n');
    if(x.title)e.title=x.title;
    if((x.ingredients||[]).length)e.ingredients=lines(x.ingredients);
    if((x.steps||[]).length)e.steps=lines(x.steps);
    if(x.servings)e.servings=x.servings;
    if(x.prepMin)e.prepMin=x.prepMin;
    if(x.cookMin)e.cookMin=x.cookMin;
    if(x.category&&CATS.some(c=>c.id===x.category)&&!(e.categories||[]).includes(x.category))e.categories=(e.categories||[]).concat(x.category);
    if(x.kosher)e.kosher=x.kosher;
    if((x.tags||[]).length)e.tags=[...new Set([...(e.tags||[]),...x.tags.filter(t=>holOf(t))])];
    if(x.tips)e.tips=e.tips?e.tips+'\n'+x.tips:x.tips;
    if(!S.editScan)S.editScan=images[0];
    S.scanning=false;renderEditor();
    document.querySelectorAll('#rcEdTitle,#rcEdIng,#rcEdSteps').forEach(el=>{el.classList.add('rc-filled');});
    toast('✨ המתכון נקרא! בדקו שהכל נכון ושמרו');
  }catch(err){
    console.warn(err);
    S.scanning=false;if(S.edit)renderEditor();
    toast('⚠️ '+err.message,4500);
  }
};
// ── import a whole cookbook PDF ─────────────────────────────────────────────
// pdf.js (cdnjs) draws each page as a picture, and every page goes through
// /api/recipe-scan in multi mode — a page can hold several recipes, or the
// end of one that started on the page before. The family then ticks which
// recipes to keep and saves them all at once.
const PDFJS='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
let _pdfJs=null;
function loadPdfJs(){
  if(window.pdfjsLib)return Promise.resolve(window.pdfjsLib);
  if(_pdfJs)return _pdfJs;
  _pdfJs=new Promise((res,rej)=>{
    const sc=document.createElement('script');sc.src=PDFJS+'pdf.min.js';
    sc.onload=()=>{window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS+'pdf.worker.min.js';res(window.pdfjsLib);};
    sc.onerror=()=>{_pdfJs=null;rej(new Error('pdf.js'));};
    document.head.appendChild(sc);
  });
  return _pdfJs;
}
function canvasJpeg(c,maxLen,q){let out=c.toDataURL('image/jpeg',q);while(out.length>maxLen&&q>0.4){q-=0.08;out=c.toDataURL('image/jpeg',q);}return out;}
async function renderPdfPage(pdf,n){
  const page=await pdf.getPage(n);
  const v1=page.getViewport({scale:1});
  const k=Math.min(3,1600/Math.max(v1.width,v1.height));
  const v=page.getViewport({scale:k});
  const c=document.createElement('canvas');c.width=Math.round(v.width);c.height=Math.round(v.height);
  const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
  await page.render({canvasContext:ctx,viewport:v}).promise;
  const scanImg=canvasJpeg(c,1500000,0.85);
  // A smaller copy is kept with each recipe as its "original page" picture;
  // the recipe doc must stay well under Firestore's 1MB.
  const s=Math.min(1,1100/Math.max(c.width,c.height));
  const c2=document.createElement('canvas');c2.width=Math.round(c.width*s);c2.height=Math.round(c.height*s);
  const x2=c2.getContext('2d');x2.fillStyle='#fff';x2.fillRect(0,0,c2.width,c2.height);x2.drawImage(c,0,0,c2.width,c2.height);
  return {scanImg,keepImg:canvasJpeg(c2,300000,0.7)};
}
async function scanPage(img){
  if(window.RECIPES_SCAN_MOCK)return window.RECIPES_SCAN_MOCK([img],true);
  // Gemini's free tier allows only a few requests a minute — when it says
  // "busy", wait and retry rather than skipping the page.
  for(let i=0;;i++){
    const r=await fetch('/api/recipe-scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({images:[img],multi:true})});
    let d={};try{d=await r.json();}catch(e){}
    if(r.ok)return d.recipes||[];
    if(r.status===429&&i<4&&!(S.imp&&S.imp.stop)){await new Promise(z=>setTimeout(z,[10,20,40,60][i]*1000));continue;}
    throw new Error(d.error||String(r.status));
  }
}
window.rcImportPick=function(){if(S.imp&&S.imp.running){rcCloseEditor();openImport();return;}$('rcPdfInp').value='';$('rcPdfInp').click();};
function openImport(){renderImport();$('rcImportModal').classList.add('open');}
window.rcImportPdf=async function(inp){
  const file=inp.files&&inp.files[0];if(!file)return;
  rcCloseEditor();
  S.imp={running:true,stop:false,page:0,pages:0,items:[],failed:[],name:file.name};
  openImport();
  try{
    const lib=await loadPdfJs();
    const pdf=await lib.getDocument({data:await file.arrayBuffer()}).promise;
    S.imp.pages=pdf.numPages;renderImport();
    const have=new Set(S.recipes.map(r=>String(r.title||'').trim()));
    for(let n=1;n<=pdf.numPages&&!S.imp.stop;n++){
      S.imp.page=n;renderImport();
      try{
        const {scanImg,keepImg}=await renderPdfPage(pdf,n);
        const found=await scanPage(scanImg);
        found.forEach(x=>{
          const last=S.imp.items[S.imp.items.length-1];
          if(x.continuesPrevious&&last){
            last.ingredients=last.ingredients.concat(x.ingredients);last.steps=last.steps.concat(x.steps);
            if(x.tips)last.tips=last.tips?last.tips+'\n'+x.tips:x.tips;
            if(!last.cookMin&&x.cookMin)last.cookMin=x.cookMin;
            last.pageTo=n;return;
          }
          const title=x.title||'מתכון מעמוד '+n;
          S.imp.items.push({...x,title,page:n,pageTo:n,img:keepImg,dup:have.has(title),on:!have.has(title)});
        });
      }catch(err){console.warn('page',n,err);S.imp.failed.push(n);}
      renderImport();
    }
  }catch(err){
    console.warn(err);S.imp.error=err.message==='pdf.js'?'לא הצלחנו לטעון את קורא ה-PDF — בדקו את החיבור לאינטרנט':'לא הצלחנו לפתוח את הקובץ';
  }
  S.imp.running=false;renderImport();
};
window.rcImportStop=function(){if(S.imp)S.imp.stop=true;renderImport();};
window.rcImportToggle=function(i){const it=S.imp.items[i];it.on=!it.on;renderImport();};
window.rcImportAll=function(on){S.imp.items.forEach(it=>it.on=on);renderImport();};
window.rcImportTitle=function(i,v){S.imp.items[i].title=v.trim()||S.imp.items[i].title;};
function renderImport(){
  const b=$('rcImportBody'),ft=$('rcImportFt'),m=S.imp;if(!b||!m)return;
  const sel=m.items.filter(it=>it.on).length;
  const pct=m.pages?Math.round((m.running?m.page-1:m.pages)/m.pages*100):0;
  b.innerHTML=`
    <div class="rc-imp-file">📄 ${E(m.name)}${m.pages?` · ${m.pages} עמודים`:''}</div>
    ${m.error?`<div class="rc-imp-err">⚠️ ${E(m.error)}</div>`:''}
    ${m.running?`<div class="rc-imp-prog"><div><span>${m.pages?`קוראים עמוד ${m.page} מתוך ${m.pages}`:'פותחים את הקובץ...'}</span><b>${pct}%</b></div><i style="width:${pct}%"></i>
      <small>${m.stop?'עוצרים אחרי העמוד הזה...':'זה לוקח כ-10–30 שניות לעמוד. אפשר להשאיר את החלון פתוח ולחכות.'}</small></div>`
      :m.pages&&!m.error?`<div class="rc-imp-done">✓ ${m.stop?'נעצר אחרי עמוד '+m.page:'כל העמודים נקראו'} · נמצאו ${m.items.length} מתכונים${m.failed.length?` · לא הצלחנו לקרוא את עמודים ${m.failed.join(', ')}`:''}</div>`:''}
    ${m.items.length?`<div class="rc-imp-bar"><span>${sel} מתוך ${m.items.length} מסומנים</span><button type="button" onclick="rcImportAll(true)">סמן הכל</button><button type="button" onclick="rcImportAll(false)">נקה</button></div>`:''}
    <div class="rc-imp-list">${m.items.map((it,i)=>`
      <div class="rc-imp-item${it.on?' on':''}">
        <button type="button" class="rc-imp-chk" onclick="rcImportToggle(${i})" aria-label="בחירה">${it.on?'✓':''}</button>
        <img src="${it.img}" alt="" onclick="rcZoom(this.src)">
        <div><input type="text" value="${E(it.title)}" onchange="rcImportTitle(${i},this.value)" aria-label="שם המתכון">
          <small>עמוד ${it.page}${it.pageTo>it.page?'–'+it.pageTo:''} · ${it.ingredients.length} מצרכים · ${it.steps.length} שלבים${it.dup?' · <b>כבר קיים בספר</b>':''}</small></div>
      </div>`).join('')}</div>`;
  ft.innerHTML=m.running
    ?`<button class="rc-btn ghost" onclick="rcImportStop()"${m.stop?' disabled':''}>⏹ עצירה</button><button class="rc-btn ghost" onclick="rcCloseModal('rcImportModal')">הסתר</button>`
    :`<button class="rc-btn ghost" onclick="rcCloseModal('rcImportModal')">סגירה</button><button class="rc-btn" id="rcImportSave" onclick="rcImportSave()"${sel?'':' disabled'}>שמירת ${sel} מתכונים</button>`;
}
window.rcImportSave=async function(){
  const m=S.imp;if(!m||m.running)return;
  const list=m.items.filter(it=>it.on);if(!list.length)return;
  const btn=$('rcImportSave');btn.disabled=true;
  const me=myName();let ok=0;
  for(const it of list){
    btn.textContent=`שומר ${ok+1} מתוך ${list.length}...`;
    const now=Date.now(),cat=CATS.some(c=>c.id===it.category)?it.category:'other';
    const r={
      id:'r'+now.toString(36)+Math.random().toString(36).slice(2,6),
      title:it.title,emoji:'',categories:[cat],category:cat,kosher:it.kosher||'',tags:(it.tags||[]).filter(t=>holOf(t)),
      prepMin:+it.prepMin||0,cookMin:+it.cookMin||0,servings:+it.servings||0,difficulty:0,
      ingredients:it.ingredients.join('\n'),steps:it.steps.join('\n'),story:'',origin:'',tips:it.tips||'',
      photo:null,scan:it.img||null,
      createdBy:me,createdAt:now,deviceId:deviceId(),updatedAt:now,updatedBy:me,
      madeCount:0,madeBy:[],comments:[]
    };
    try{await S.store.put(r,true);ok++;it.on=false;it.dup=true;if(!S.recipes.some(x=>x.id===r.id))S.recipes.push(r);}
    catch(err){console.warn(err);toast('⚠️ השמירה של "'+it.title+'" נכשלה: '+(err.code||err.message||''),4500);break;}
  }
  renderImport();
  if(ok){toast('🎉 '+ok+' מתכונים נוספו לספר המשפחתי!');celebrate();}
};
window.rcSaveRecipe=async function(){
  if(S.scanning){toast('רגע, הסריקה עוד לא הסתיימה');return;}
  readEditor();
  const e=S.edit;
  if(!e.title){$('rcEdTitleErr').classList.add('show');$('rcEdTitle').focus();$('rcEditBody').scrollTop=0;return;}
  const now=Date.now(),me=myName();
  const isNew=!e.id;
  // Firestore rejects `undefined` anywhere in a doc, so every optional field
  // is normalised to '' / 0 / null / [] here.
  const r={
    id:e.id||('r'+now.toString(36)+Math.random().toString(36).slice(2,6)),
    title:e.title,emoji:e.emoji||'',categories:(e.categories||[]).length?e.categories:['other'],category:(e.categories||[])[0]||'other',kosher:e.kosher||'',tags:e.tags||[],
    prepMin:+e.prepMin||0,cookMin:+e.cookMin||0,servings:+e.servings||0,difficulty:+e.difficulty||0,
    ingredients:e.ingredients||'',steps:e.steps||'',story:e.story||'',origin:e.origin||'',tips:e.tips||'',
    photo:S.editPhoto||null,scan:S.editScan||null,
    createdBy:isNew?me:(e.createdBy||''),createdAt:isNew?now:(e.createdAt||now),deviceId:isNew?deviceId():(e.deviceId||''),
    updatedAt:now,updatedBy:me,
    madeCount:e.madeCount||0,madeBy:e.madeBy||[],comments:e.comments||[]
  };
  const btn=$('rcEditSave');btn.disabled=true;btn.textContent='שומר...';
  try{
    await S.store.put(r,isNew);
    rcCloseEditor();
    toast(isNew?'🎉 המתכון נוסף לספר המשפחתי!':'✓ המתכון עודכן');
    if(isNew){if(!S.recipes.some(x=>x.id===r.id))S.recipes.push(r);celebrate();}
    rcOpenRecipe(r.id);
  }catch(err){console.warn(err);toast('⚠️ השמירה נכשלה: '+(err.code||err.message||''));}
  finally{btn.disabled=false;btn.textContent='שמירה';}
};
window.rcDeleteRecipe=async function(){
  const e=S.edit;if(!e||!e.id)return;
  if(!confirm(`למחוק את "${e.title}" לצמיתות?`))return;
  try{await S.store.remove(e.id);rcCloseEditor();rcClosePage();toast('המתכון נמחק');}
  catch(err){console.warn(err);toast('⚠️ המחיקה נכשלה');}
};

})();
