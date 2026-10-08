// ── Shabbat-prep contest ("תחרות הכנות לשבת") ──────────────────────────────
// A self-contained screen: builds its own overlay (#contestOverlay) on first
// open, so index.html and admin.html only need the script tag + a button
// calling openContestOverlay().
//
// Each week runs Sunday → Friday 10:00 (then it locks and shows the results).
// The week's tasks, quiz questions and bingo card are drawn from the banks
// below with a seed of the week's date, so every device sees the same ones.
//
// Storage: one doc per week, appData/contest_<Saturday's date> — so no doc
// grows without bound — plus appData/contestHall with each week's final
// scores for the hall of fame. Everything sits under appData/*, which the
// Firestore rules already open to the client.
(function(){
'use strict';

const FS_URL='https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';
const LOCK_HOUR=10; // Friday 10:00 — editing closes

// ── the banks ──────────────────────────────────────────────────────────────
const CATS={
  laundry:{lbl:'כביסות',ico:'🧺',c:'#3B82F6'},
  clean:{lbl:'נקיון',ico:'🧽',c:'#14B8A6'},
  shop:{lbl:'קניות',ico:'🛒',c:'#F59E0B'},
  food:{lbl:'אוכל',ico:'🍲',c:'#EF4444'},
  home:{lbl:'הבית מוכן',ico:'🕯️',c:'#A855F7'},
  chesed:{lbl:'חסד',ico:'💛',c:'#EAB308'},
  kids:{lbl:'ילדים',ico:'🧒',c:'#EC4899'},
  table:{lbl:'שולחן השבת',ico:'🍽️',c:'#0EA5E9'},
  torah:{lbl:'פירוש ופרשה',ico:'📖',c:'#1D4ED8'},
  bonus:{lbl:'משימת בונוס',ico:'⭐',c:'#D97706'}
};
const BANK={
  laundry:[
    ['l1','להפעיל ולסיים מכונת כביסה לבנה',10],['l2','לתלות / לייבש את כל הכביסה',10],
    ['l3','לקפל ולסדר בארונות את כל הכביסה',15],['l4','לגהץ את בגדי השבת של כל המשפחה',20],
    ['l5','להכין לכל אחד סט בגדי שבת מוכן',15],['l6','לכבס מפות שבת ומגבות',10],
    ['l7','לרוקן את סל הכביסה עד הסוף',15],['l8','לצחצח נעלי שבת לכל המשפחה',15],
    ['l9','להכין מגבות נקיות לכל המשפחה לשבת',5],['l10','לתקן כפתור / תפר שנפרם בבגדי השבת',10]
  ],
  clean:[
    ['c1','לנקות שירותים ואמבטיה',20],['c2','לשטוף את כל הבית',20],
    ['c3','לנקות את המקרר ולזרוק מה שפג תוקף',15],['c4','לנקות את התנור והכיריים',15],
    ['c5','לסדר את חדרי הילדים',10],['c6','לנקות חלונות ומראות',15],
    ['c7','להבריק את הפמוטים',10],['c8','לאבק רהיטים ומדפים',10],
    ['c9','להוציא את כל הזבל ולשטוף פחים',10],['c10','לנקות מרפסת / חצר',10],
    ['c11','להחליף מצעים ולהציע את המיטות לשבת',15],['c12','להשאיר כיור ריק — כל הכלים שטופים',10],
    ['c13','לנקות את הכניסה לבית ואת השטיחון',10],['c14','לנקות את השיש ואת ארונות המטבח מבחוץ',10]
  ],
  shop:[
    ['s1','לכתוב רשימת קניות מלאה לשבת',10],['s2','לעשות את הקנייה הגדולה',20],
    ['s3','לקנות פרחים לשבת',10],['s4','לקנות יין / מיץ ענבים לקידוש',5],
    ['s5','לבדוק מלאי נרות, פתילות וגפרורים',10],['s6','לסדר את הקניות במקרר ובמזווה',10],
    ['s7','לקנות חלות או קמח ושמרים לאפייה',10],['s8','קנייה בלי לשכוח כלום — בלי לחזור לסופר!',15],
    ['s9','לקנות דגים לשבת',10],['s10','לקנות פירות ומגדנות לשבת',10],
    ['s11','לקנות משהו מיוחד ולומר "לכבוד שבת"',10],['s12','לבדוק מבצעים ולחסוך בקנייה',10]
  ],
  food:[
    ['f1','לבנות תפריט מלא לשבת',10],['f2','לאפות חלות (ולהפריש חלה)',25],
    ['f3','לבשל את המנה העיקרית',20],['f4','להכין סלטים',15],
    ['f5','להכין קינוח / עוגה',15],['f6','להכין חמין / צ׳ולנט',20],
    ['f7','להכין דגים / מנה ראשונה',15],['f8','להכין מרק',15],
    ['f9','לנסות מתכון חדש מ"מתכונים" באתר',20],['f10','להכין קוגל / פשטידה',15],
    ['f11','להכין ממרחים ומטבלים',10],['f12','להכין את האוכל לסעודה שלישית',10],
    ['f13','להכין תוספת (אורז / תפוחי אדמה / ירקות)',10]
  ],
  table:[
    ['tb1','לפרוס מפה ולערוך את שולחן השבת',15],['tb2','להכין גביע קידוש, יין ומגש',5],
    ['tb3','להכין קרש חלה, סכין וכיסוי חלה',5],['tb4','לקפל מפיות בצורה מיוחדת',10],
    ['tb5','להכין כרטיסי שמות למקומות הישיבה',10],['tb6','לשים זמירונים / ספרי זמירות על השולחן',5],
    ['tb7','להשחיז את הסכין לשבת',5],['tb8','לסדר פרחים במרכז השולחן',5]
  ],
  home:[
    ['h1','לכוון שעון שבת',10],['h2','להכין פלטה ומיחם',10],
    ['h4','להכין נייר טואלט חתוך / טישו',5],['h5','להכין פמוטים ונרות מוכנים להדלקה',10],
    ['h6','לסדר את הסלון והכניסה',10],['h7','להחליט אילו אורות יישארו דולקים בשבת',5],
    ['h8','לנתק את נורת המקרר / להעביר למצב שבת',5],['h9','להכין מראש את כל מה שצריך לשבת בהישג יד',10]
  ],
  chesed:[
    ['k1','להתקשר לסבא וסבתא ולשאול מה צריך לשבת',10],['k2','לעזור לשכן/ה בהכנות לשבת',15],
    ['k3','להביא עוגה או מאכל למישהו',15],['k4','לתת צדקה לפני שבת',10],
    ['k5','להזמין מישהו לסעודת שבת',15],['k6','לשלוח "שבת שלום" למישהו שגר לבד',10],
    ['k7','להכין אוכל לשבת למשפחה עם תינוק / חולה',20]
  ],
  kids:[
    ['y1','הילדים מסדרים את הצעצועים לבד',10],['y2','הילדים מכינים קישוט לשולחן השבת',10],
    ['y3','הילדים עוזרים בבישול',10],['y4','הילדים מקפלים כביסה',10],
    ['y5','הילדים מכינים דף פרשה לשולחן השבת',10],['y6','הילדים מסדרים את הנעליים בכניסה',5],
    ['y7','הילדים כותבים ברכה לאבא ולאמא לשבת',10]
  ]
};
// Weekly, any day. `txt` tasks are done by writing something — shown to all
// families on the "דברי תורה" tab, ready to be read at the Shabbat table.
const TORAH=[
  {id:'t1',cat:'torah',title:'פירוש / דבר תורה קצר על הפרשה',pts:25,txt:'כתבו כאן את הפירוש או הרעיון מהפרשה…'},
  {id:'t2',cat:'torah',title:'שאלה מעניינת על הפרשה לשולחן השבת',pts:10,txt:'מה השאלה? (אפשר גם את התשובה)'},
  {id:'t5',cat:'torah',title:'קוראים את הפרשה "שניים מקרא ואחד תרגום"',pts:20},
  {id:'t3',cat:'torah',title:'הילדים מספרים את סיפור הפרשה',pts:10},
  {id:'t4',cat:'torah',title:'לומדים שיר שבת חדש',pts:10,txt:'איזה שיר למדתם?'}
];
// Day themes, Sunday → Thursday: [category, how many] pairs.
const DAYS=[
  {name:'ראשון',ttl:'יום הכביסות',ico:'🧺',mix:[['laundry',3],['kids',1],['chesed',1]]},
  {name:'שני',ttl:'יום הסדר',ico:'🧽',mix:[['clean',3],['kids',1],['home',1]]},
  {name:'שלישי',ttl:'יום הקניות',ico:'🛒',mix:[['shop',4],['chesed',1]]},
  {name:'רביעי',ttl:'יום הנקיון הגדול',ico:'✨',mix:[['clean',3],['laundry',1],['kids',1]]},
  {name:'חמישי',ttl:'יום הבישולים והשולחן',ico:'🍲',mix:[['food',3],['table',2],['home',1]]}
];
const BINGO=[
  'שרנו שירי שבת בזמן הנקיון','כל הילדים עזרו בבישול','הכביסה גמורה עד רביעי',
  'קנינו פרחים לשבת','הבית מוכן כבר ביום חמישי בלילה','יש לנו אורחים לשבת',
  'ניסינו מתכון חדש','אף אחד לא רב בזמן ההכנות 😅','הכנו הפתעה לאבא / לאמא',
  'שלחנו "שבת שלום" למשפחה בצ׳אט','ילד קטן עשה משימה לגמרי לבד','עשינו מסיבת נקיון עם מוזיקה',
  'סידרנו את ארון הספרים','התקשרנו לסבא וסבתא','קיפלנו כביסה במירוץ על זמן',
  'הזמנו מישהו לשבת','אפינו משהו בפעם הראשונה','סידרנו את כל המגירות במטבח'
];
// Two quiz questions a day: one on the laws of Shabbat, one on Shabbat in
// the sources. Every law question quotes its source — the answer is checked
// against that text, nothing is made up. `k` = [siman, se'if] in Kitzur
// Shulchan Aruch; `s` = any other source.
const QUIZ_H=[
  {q:'לפי תקנת עזרא, באיזה יום מכבסים את הבגדים לכבוד שבת?',a:['ראשון','רביעי','חמישי','שישי'],c:2,k:[72,4]},
  {q:'מדוע לא מכבסים בערב שבת, לפי תקנת עזרא?',a:['כי הבגדים לא יספיקו להתייבש','כי בערב שבת צריך להתעסק בצרכי שבת','כי זו מלאכה גדולה','כי אסור לכבס ביום שישי'],c:1,k:[72,4]},
  {q:'דבר שצריך הכנה לשבת — מתי יקנה אותו?',a:['ביום ראשון','ביום חמישי','בערב שבת בבוקר','במוצאי שבת הקודמת'],c:1,k:[72,4]},
  {q:'מה עשה רב חסדא בעצמו לכבוד שבת?',a:['ביקע עצים','הדליק את האש','חתך את הירק דק דק','תיקן את הבית'],c:2,k:[72,5]},
  {q:'לפי המנהג בקיצור, משלושת הלחמים — הגדול מיועד ל…',a:['סעודת ליל שבת','סעודת היום','סעודה שלישית','מלווה מלכה'],c:1,k:[72,6]},
  {q:'מי שדגים מזיקים לו או שאינם טעימים לו —',a:['יאכל לפחות כזית','יאכל רק בליל שבת','לא יאכלם, כי השבת לעונג ניתנה','יחליף אותם בבשר דווקא'],c:2,k:[72,7]},
  {q:'הפשטידה שעושים בקצת מקומות לליל שבת היא זכר ל…',a:['לחם הפנים','המן','קרבן התמיד','יציאת מצרים'],c:1,k:[72,7]},
  {q:'מאיזו שעה בערב שבת אין לעשות מלאכה בדרך קבע?',a:['מחצות היום','ממנחה גדולה','ממנחה קטנה','מהשקיעה'],c:2,k:[72,9]},
  {q:'מאיזו שעה בערב שבת מצוה להימנע מסעודה, אפילו רגילה?',a:['מחצות היום','משש שעות זמניות','מתשע שעות זמניות','משעה לפני השקיעה'],c:2,k:[72,10]},
  {q:'מתי המצוה מן המובחר לקרוא "שניים מקרא ואחד תרגום"?',a:['ביום ראשון בבוקר','בערב שבת אחר חצות היום','בליל שבת','בשבת אחרי מנחה'],c:1,k:[72,11]},
  {q:'מה כתוב בקיצור על קציצת ציפורני הידיים והרגליים?',a:['קוצצים את כולן יחד','אין לקוץ ציפורני ידיו ורגליו ביום אחד','קוצצים רק את ציפורני הידיים','קוצצים רק ביום חמישי'],c:1,k:[72,14]},
  {q:'מה שואלים את בני הבית סמוך לחשכה, לפי הקיצור?',a:['"עישרתם? הדליקו את הנר"','"הפרשתם חלה? הדליקו את הנר"','"ערכתם את השולחן?"','"כיוונתם את השעון?"'],c:1,k:[72,22]},
  {q:'למה ממשמשים בבגדים ובכיסים בערב שבת לפני חשכה?',a:['שמא יש בהם דבר מוקצה','כדי לבדוק שהם נקיים','כדי למצוא כסף לצדקה','רק אם אין עירוב'],c:0,k:[72,23]},
  {q:'שתי נרות השבת הן כנגד…',a:['שני הלוחות','זכור ושמור','אברהם ושרה','יום ולילה'],c:1,k:[75,2]},
  {q:'מדוע בנרות שבת מדליקים קודם ומברכים אחר כך?',a:['כך עושים בכל המצוות','כי בהדלקה מקבלת שבת, ואם תברך קודם לא תוכל להדליק','כדי לראות את האור בזמן הברכה','זה מנהג בלבד בלי טעם'],c:1,k:[75,4]},
  {q:'איפה צריך להדליק את נרות השבת?',a:['ליד החלון','בכניסה לבית','במקום שאוכלים','בכל מקום בבית'],c:2,k:[75,8]},
  {q:'אשה ששכחה פעם אחת להדליק נרות שבת (שלא באונס) —',a:['אין בזה שום דין','תדליק כל ימיה נר אחד יותר','תתענה יום אחד','תדליק פעמיים בשבת הבאה'],c:1,k:[75,14]},
  {q:'אין יין לקידוש בליל שבת. על מה מקדשים?',a:['על מיץ פירות','על מים','על הפת','לא מקדשים'],c:2,k:[77,3]},
  {q:'למה החלות מכוסות בשעת הקידוש, לפי הקיצור?',a:['כדי שלא יתייבשו','זכר למן שהיה מכוסה בטל מלמטה ומלמעלה','כדי שלא יראו את הנרות','כדי שלא ייגעו בהן'],c:1,k:[77,8]},
  {q:'מאיזה זמן מתחיל זמן סעודה שלישית?',a:['מחצות היום','ממנחה גדולה — שש שעות ומחצה','ממנחה קטנה','מהשקיעה'],c:1,k:[77,16]},
  {q:'בורר בשבת — מה מותר לפי הקיצור?',a:['לברור את הפסולת מתוך האוכל, ביד','לברור את האוכל מתוך הפסולת, ביד, למה שצריך לאכול מיד','לברור בכלי, אם אוכלים מיד','לברור עכשיו לסעודה הבאה'],c:1,k:[80,15]},
  {q:'זבוב נפל לכוס בשבת. מה עושים?',a:['מוציאים את הזבוב לבדו','מוציאים אותו יחד עם קצת מהמשקה','שופכים את כל הכוס','מסננים במסננת'],c:1,k:[80,19]},
  {q:'מותר לסחוט לימון לתוך מים כדי להכין לימונדה בשבת?',a:['מותר','אסור','מותר רק בבוקר','מותר רק בכוס חד-פעמית'],c:1,k:[80,12]},
  {q:'עוגה שכתובות עליה אותיות — מותר לשבור ולאכול בשבת?',a:['מותר','אסור משום מוחק','מותר רק אחרי מנחה','אסור משום כותב'],c:0,k:[80,63]},
  {q:'מותר להציע מיטה בשבת כדי לישון בה במוצאי שבת?',a:['מותר','אסור — הוא מכין משבת לחול','מותר אם נשאר זמן','מותר רק לאורחים'],c:1,k:[80,93]},
  {q:'בוץ יבש על הבגד בשבת —',a:['מגרדים אותו בציפורן','אסור לגרד אותו, משום טוחן','שוטפים אותו במים','מנערים את הבגד'],c:1,k:[80,38]},
  {q:'לצייר באצבע על האדים שבחלון בשבת —',a:['מותר, כי זה לא מתקיים','אסור','מותר רק לילדים','מותר רק ציור בלי אותיות'],c:1,k:[80,62]}
];
const QUIZ_G=[
  {q:'מי היה אומר "בואי כלה, בואי כלה" בכניסת השבת?',a:['רבי חנינא','רבי ינאי','רבי עקיבא','הלל הזקן'],c:1,s:'שבת קיט ע״א'},
  {q:'כמה מלאכי השרת מלווים את האדם מבית הכנסת לביתו בליל שבת?',a:['אחד','שניים','שלושה','שבעה'],c:1,s:'שבת קיט ע״ב'},
  {q:'מה מצא יוסף מוקיר שבי בדג שקנה לכבוד שבת?',a:['טבעת זהב','מרגלית','מטבע עתיק','מגילה'],c:1,s:'שבת קיט ע״א'},
  {q:'"כל המענג את השבת נותנין לו נחלה בלי מצרים" — כנחלתו של…',a:['אברהם','יצחק','יעקב','דוד'],c:2,s:'שבת קיח ע״א'},
  {q:'מהי המלאכה הראשונה ברשימת ל״ט אבות מלאכה במשנה?',a:['החורש','הזורע','הקוצר','הטוחן'],c:1,s:'משנה שבת ז, ב'},
  {q:'מהי המלאכה האחרונה ברשימת ל״ט אבות מלאכה?',a:['המבעיר','המכה בפטיש','המוציא מרשות לרשות','הכותב'],c:2,s:'משנה שבת ז, ב'},
  {q:'באיזה פרק במסכת שבת מופיעה רשימת ל״ט אבות המלאכה?',a:['פרק ב׳ — במה מדליקין','פרק ז׳ — כלל גדול','פרק י״ב','פרק כ״ד'],c:1,s:'משנה שבת ז, ב'},
  {q:'ל״ט המלאכות הן כנגד…',a:['מלאכות המשכן','ימי הבריאה','עשרת הדיברות','שבטי ישראל'],c:0,s:'שבת מט ע״ב'},
  {q:'"וקראת לשבת עונג" — באיזה ספר?',a:['תהילים','ישעיהו','ירמיהו','משלי'],c:1,s:'ישעיהו נח, יג'},
  {q:'באיזה ספר בתורה מסופר על המקושש עצים בשבת?',a:['שמות','ויקרא','במדבר','דברים'],c:2,s:'במדבר טו, לב'},
  {q:'"לא תבערו אש בכל משבותיכם ביום השבת" — באיזו פרשה?',a:['כי תשא','ויקהל','פקודי','תרומה'],c:1,s:'שמות לה, ג'},
  {q:'כמה מן לקטו לכל אחד ביום השישי במדבר?',a:['עומר אחד','שני עומרים','שלושה עומרים','חצי עומר'],c:1,s:'שמות טז, כב'},
  {q:'לפי המדרש, מי אמר לראשונה "מזמור שיר ליום השבת"?',a:['דוד המלך','משה רבנו','אדם הראשון','שלמה המלך'],c:2,s:'בראשית רבה כב, יג'},
  {q:'מי חיבר את הזמר "יה ריבון עלם"?',a:['רבי ישראל נג׳ארה','רבי יהודה הלוי','האר״י','רבי אברהם אבן עזרא'],c:0,s:'חתימת השם בזמר: ישראל'},
  {q:'מי חיבר את הזמר "צמאה נפשי"?',a:['רבי אברהם אבן עזרא','רבי שלמה אלקבץ','רבי ישראל נג׳ארה','רבי אלעזר אזכרי'],c:0,s:'חתימת השם בזמר: אברהם'},
  {q:'מי חיבר את הפיוט "לכה דודי"?',a:['רבי יהודה הלוי','הרמב״ם','רבי שלמה אלקבץ','האר״י'],c:2,s:'חתימת השם בפיוט: שלמה הלוי'},
  {q:'מי חיבר את "ידיד נפש"?',a:['רבי אלעזר אזכרי','רבי שלמה אלקבץ','רבי עקיבא','דוד המלך'],c:0,s:'ספר חרדים'},
  {q:'"מזמור שיר ליום השבת" הוא פרק ___ בתהילים',a:['כג','סז','צב','קכא'],c:2,s:'תהילים צב'},
  {q:'מתי לא אומרים בליל שבת "ברכה מעין שבע"?',a:['בשבת ראש חודש','כשיום טוב ראשון של פסח חל בשבת','בשבת חנוכה','בשבת חול המועד'],c:1,k:[76,6]},
  {q:'בקידוש של סעודת שחרית בשבת — על מה מברכים?',a:['רק "בורא פרי הגפן"','"בורא פרי הגפן" ו"אשר קדשנו"','רק "המוציא"','"שהכל"'],c:0,k:[77,13]}
];
// A short law a day, quoted word for word from Kitzur Shulchan Aruch
// (Rabbi Shlomo Ganzfried) — only the spelling is in full Hebrew.
const HALACHOT=[
  {t:'לזכור את השבת כל השבוע',k:[72,4],x:'כתיב זכור את יום השבת לקדשו. פירוש שיזכור בכל יום ויום את יום השבת לקדשו, שאם נזדמן לו דבר מאכל חשוב שאינו שכיח בכל יום והוא דבר שאינו מתקלקל, יקנהו לכבוד שבת.'},
  {t:'מה קונים ומתי',k:[72,4],x:'וטוב יותר לקנות בערב שבת לכבוד שבת, מלקנות ביום ה׳. אך דבר שצריך הכנה, יקנה ביום ה׳. ועל כל דבר שהוא קונה, יאמר לכבוד שבת.'},
  {t:'כביסה ביום חמישי',k:[72,4],x:'מתקנת עזרא, שיהיו מכבסין הבגדים בחמישי בשבת לכבוד שבת. ולא בערב שבת, מפני שבערב שבת צריך להתעסק בצרכי שבת.'},
  {t:'כל אחד עושה משהו בעצמו',k:[72,5],x:'מצוה על כל אדם שאף על פי שיש לו כמה משרתים, מכל מקום יעשה גם הוא בעצמו איזה דבר לכבוד שבת כדי לכבדו, כדמצינו באמוראים, רב חסדא היה מחתך את הירק דק דק, ורבה ורב יוסף היו מבקעים עצים, ור׳ זירא היה מדליק את האש, ורב נחמן היה מתקן את הבית ומכניס כלים הצריכים לשבת, ומפנה כלי החול. ומהם ילמד כל אדם ולא יאמר לא אפגם בכבודי, כי זהו כבודו שהוא מכבד את השבת.'},
  {t:'אופים לחם לכבוד שבת',k:[72,6],x:'המנהג בכל ישראל לאפות בבתיהם לחמים לכבוד שבת… כדי שתקיים האשה מצות הפרשת חלה.'},
  {t:'דגים — לעונג, לא לצער',k:[72,7],x:'כי מצוה לאכול בכל סעודה מסעודות שבת דגים, אם אינם מזיקין לו. אבל אם מזיקין לו או שאינם ערבים לו, לא יאכלם, כי השבת לעונג נתן ולא לצער.'},
  {t:'מכינים את הבית כמו לאורח חשוב',k:[72,7],x:'וישחיז את הסכין, שזהו גם כן מכבוד השבת, ויתקן את הבית, ויציע את המטות, ויפרוס מפה על השלחן, ותהא פרוסה כל יום השבת… וישמח בביאת השבת. ויחשוב בדעתו, אלו היה מצפה שיבוא אליו איזה אדם יקר וחשוב, איך היה מתקן את הבית לכבודו, ומכל שכן לכבוד שבת מלכתא.'},
  {t:'טועמים מהתבשילים',k:[72,7],x:'יש לטעום בערב שבת את התבשילין שנעשו לשבת.'},
  {t:'גם כשהתקציב מצומצם',k:[72,8],x:'וכל מזונותיו של אדם, קצובים לו מראש השנה, חוץ מהוצאות שבת ויום טוב שאם מוסיף מוסיפין לו… ומכל מקום אם אפשר לו, יראה על כל פנים לעשות לכבוד שבת איזה דבר מעט, כגון דגים קטנים וכדומה.'},
  {t:'מגיעים לסעודת שבת עם תיאבון',k:[72,10],x:'מתשע שעות זמניות ולמעלה, מצוה להמנע מסעודה, אפילו מה שהוא רגיל בחול… ומכל שכן שלא לאכול אכילה גסה, כדי שיאכלו סעודת שבת לתיאבון.'},
  {t:'שניים מקרא ואחד תרגום',k:[72,11],x:'חייב כל אדם להשלים פרשיותיו עם הציבור, דהיינו שיקרא בכל שבוע פרשת השבוע שנים מקרא ואחד תרגום… אבל המצוה מן המובחר היא לקרותה בערב שבת אחר חצות היום.'},
  {t:'רחיצה לכבוד שבת',k:[72,12],x:'מצוה על כל אדם לרחוץ בכל ערב שבת פניו ידיו ורגליו בחמין. ואם אפשר, ירחוץ כל גופו בחמין.'},
  {t:'ציפורניים ותספורת',k:[72,14],x:'ומצוה לחוף את הראש ולקוץ את הצפרנים, וכן לגלח שערות ראשו אם היו גדולות. ואין לקוץ צפרני ידיו ורגליו ביום אחד.'},
  {t:'חשבון נפש של ערב שבת',k:[72,15],x:'בכל ערב שבת יפשפש במעשיו, ויתעורר בתשובה לתקן כל הקלקולים שעשה בששת ימי המעשה, כי ערב שבת כולל כל ימי השבוע.'},
  {t:'בגדי שבת',k:[72,16],x:'ישתדל שיהיו לו בגדים נאים… לכבוד שבת, דכתיב וכבדתו, ודרשינן, שלא יהא מלבושך של שבת כמלבושך של חול.'},
  {t:'"הפרשתם חלה? הדליקו את הנר"',k:[72,22],x:'סמוך לחשכה ישאל לאנשי ביתו בלשון רכה, הפרשתם חלה. ויאמר להם, הדליקו את הנר.'},
  {t:'בודקים את הכיסים',k:[72,23],x:'חייב אדם למשמש בבגדיו בערב שבת קודם חשכה אם אין מחט תחובה בהם או אם אין איזה דבר בכיסים, ואפילו במקום שיש עירוב, שמא יש בהם איזה דבר מוקצה.'},
  {t:'שתי נרות לפחות',k:[75,2],x:'מצוה להרבות בנרות לכבוד שבת… ועל כל פנים ראוי שלא לפחות משתי נרות, נגד זכור ושמור… ויהיו ארוכים שידלקו לכל הפחות עד לאחר האכילה.'},
  {t:'מדליקים ואחר כך מברכים',k:[75,4],x:'בהדלקת הנרות לשבת, כיון שבהדלקה מקבלת האשה שבת על עצמה… על כן היא מדלקת תחלה. וכדי שתהא הברכה עובר לעשייתן, פורשת ידיה כנגד פניה שלא תראה הנרות, ומברכת ומסירה את הידים ורואה את הנרות.'},
  {t:'גם האיש מסייע בנרות',k:[75,5],x:'ומכל מקום יש לו להאיש גם כן לסייע במצוה ויתקן את הנרות ויהבהב אותן, דהיינו שידליקן ויכבן, כדי שיהיו נוחים אחר כך להדלק.'},
  {t:'מדליקים במקום הסעודה',k:[75,8],x:'צריכין להדליק במקום שיאכלו, שיהא ניכר שמדליקן לכבוד שבת, ולא להדליק במקום אחר ולהניחם אחר כך במקום אחר.'},
  {t:'החלות על השולחן לפני ההדלקה',k:[75,12],x:'טוב להניח את החלות על השלחן קודם שמדליקין את הנרות.'},
  {t:'מכסים את החלות בקידוש',k:[77,8],x:'החלות תהיינה מכוסות בשעת קידוש. ואפילו הוא מקדש עליהן, תהיינה מכוסות בשעת קידוש זכר למן שהיה מכוסה בטל מלמטה ומלמעלה.'},
  {t:'שלוש סעודות',k:[77,16],x:'כל אדם מישראל בין איש או אשה, חייבים לאכול בשבת שלש סעודות, אחת בלילה ושתים ביום… לכן יזהר כל אדם, שלא למלאות כרסו בסעודת שחרית, כדי שיוכל לקיים מצות שלש סעודות.'},
  {t:'פירות ומגדנות',k:[77,22],x:'מצוה להרבות בפירות ומגדנות ומיני ריח, כדי להשלים מאה ברכות ומצוה לענגו בכל דבר שהוא לו לעונג, שנאמר, וקראת לשבת עונג.'},
  {t:'בורר',k:[80,15],x:'אוכל המעורב עם פסולת, מותר לברור את האוכל מתוך הפסולת, אבל לא את הפסולת מתוך האוכל. וגם את האוכל, אסור לברור על ידי כלי, אלא דוקא ביד. ודוקא מה שהוא צריך לאכול מיד.'},
  {t:'זבוב בכוס',k:[80,19],x:'אם נפל זבוב וכדומה לתוך המאכל או המשקה, לא יסיר את הזבוב לבדו, אלא יקח גם קצת מהמאכל או מהמשקה ויזרוק עמו.'},
  {t:'עוגה עם אותיות',k:[80,63],x:'כשם שאסור לכתוב, כך אסור למחוק כל מה שנכתב. ומכל מקום אותן עוגות שעשו עליהן אותיות וציורים, מותר לשברן ולאכלן בשבת.'},
  {t:'לא מכינים משבת לחול',k:[80,93],x:'אין מציעין את המטה משבת למוצאי שבת. אף על פי שיש שהות ביום שיוכל לישן עליה בשבת עצמו, מכל מקום כיון שאין דעתו לישן עליה עד למוצאי שבת, הרי הוא מכין משבת לחול ואסור.'},
  {t:'ציור על אדים בחלון',k:[80,62],x:'אסור לכתוב או לעשות איזה ציור אפילו באצבעו עם המשקין שעל השלחן או על ההבל שעל חלון זכוכית… וכן בכל דבר, אף על פי שאינו מתקיים.'}
];
// Hebrew numerals for the source line: 72 → עב, 15 → טו.
function gem(n){
  const ones=['','א','ב','ג','ד','ה','ו','ז','ח','ט'],tens=['','י','כ','ל','מ','נ','ס','ע','פ','צ'];
  if(n===15)return 'טו';if(n===16)return 'טז';
  let s=(n>=100?'ק':'')+tens[Math.floor(n%100/10)]+ones[n%10];
  if(n%100===15)s=(n>=100?'ק':'')+'טו';if(n%100===16)s=(n>=100?'ק':'')+'טז';
  return s.length>1?s.slice(0,-1)+'״'+s.slice(-1):s+'׳';
}
function srcTxt(o){return o.k?'קיצור שולחן ערוך, סימן '+gem(o.k[0])+' סעיף '+gem(o.k[1]):o.s;}
function srcUrl(o){return o.k?'https://www.sefaria.org.il/Kitzur_Shulchan_Arukh.'+o.k[0]+'.'+o.k[1]:'';}
const PTS={quiz:5,halacha:3,bingoSq:3,bingoLine:15,bingoFull:30,streak:20,goal:10,report:5,earliest:10,improved:10};
// "Ready for Shabbat" means all of it — reported after Shabbat, so it counts
// the real moment, not a guess before the Friday lock.
const READY_LIST=['הפלטה והמיחם דולקים','כל האוכל מוכן','השולחן ערוך','כולם רחוצים ולבושים בגדי שבת','הבית מסודר','הנרות מוכנים להדלקה'];
// The family goal: all families together, this many points each on average.
const GOAL_PER_FAM=150;
const LINES=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

// ── state ──────────────────────────────────────────────────────────────────
let S={wk:null,W:{},hall:{},tab:'tasks',day:null,fid:null,unsubW:null,unsubH:null,fs:null,tick:null,spinning:false,openTxt:null,showHelp:false,openFam:null};

// ── helpers ────────────────────────────────────────────────────────────────
const $=id=>document.getElementById(id);
const E=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function lsGet(k,def){try{const v=localStorage.getItem(k);return v==null?def:JSON.parse(v);}catch(e){return def;}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
function toast(m,ms){if(typeof showToast==='function')showToast(m,ms);else console.log(m);}
function hash(s){let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function rng(seed){let a=hash(seed);return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function shuffle(arr,r){const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function isAdmin(){try{return typeof editMode!=='undefined'&&!!editMode;}catch(e){return false;}}
function allFams(){try{return typeof families!=='undefined'?families:[];}catch(e){return [];}}
function fam(id){return allFams().find(f=>f.id===id)||null;}
function short(f){return f?String(f.name||'').replace('משפחת','').trim():'';}
function host(){return allFams().find(f=>/אבא ואמא/.test(f.name||''))||null;}
// The parents host Shabbat and judge; married children's sub-families
// compete as part of their parents' family (as on the Shabbat card).
function players(){const h=host();return allFams().filter(f=>!f.subFamily&&(!h||f.id!==h.id));}
function ava(f,size){
  if(typeof famAva==='function')return famAva(f,size);
  return `<span class="sc-ava" style="width:${size}px;height:${size}px">${E(short(f).slice(0,1))}</span>`;
}
function whoAmI(){
  try{return (typeof _fcmRegistrantName==='function'&&_fcmRegistrantName())||'';}catch(e){return '';}
}

// ── the week clock ─────────────────────────────────────────────────────────
function satOf(t){const d=new Date(t);d.setHours(12,0,0,0);d.setDate(d.getDate()+((6-d.getDay()+7)%7));return d;}
function keyOf(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function satFromKey(k){const [y,m,d]=k.split('-').map(Number);return new Date(y,m-1,d,12);}
function weekStart(k){const s=satFromKey(k);return new Date(s.getFullYear(),s.getMonth(),s.getDate()-6,0,0,0).getTime();}
function lockAt(k){const s=satFromKey(k);return new Date(s.getFullYear(),s.getMonth(),s.getDate()-1,LOCK_HOUR,0,0).getTime();}
function now(){return window.CONTEST_NOW?window.CONTEST_NOW():Date.now();}
// 0 = Sunday … 6 = Saturday, relative to the week's own Sunday.
function dayOf(t,k){return Math.max(0,Math.min(6,Math.floor((t-weekStart(k))/864e5)));}
function locked(){return now()>=lockAt(S.wk);}
function today(){return dayOf(now(),S.wk);}
function parshaTitle(k){
  const d=satFromKey(k);
  try{if(typeof _shbTitle==='function')return _shbTitle(d);}catch(e){}
  return 'שבת '+d.getDate()+'.'+(d.getMonth()+1);
}
function left(ms){
  if(ms<=0)return 'נגמר';
  const m=Math.floor(ms/6e4),d=Math.floor(m/1440),h=Math.floor(m%1440/60),mi=m%60;
  if(d)return d+(d===1?' יום ':' ימים ')+(h?'ו-'+h+' שע׳':'');
  if(h)return h+' שע׳ ו-'+mi+' דק׳';
  return mi+' דקות';
}

// ── this week's plan (same on every device) ────────────────────────────────
const _planCache={};
function plan(k){
  if(_planCache[k])return _planCache[k];
  const r=rng('contest'+k);
  const pools={};Object.keys(BANK).forEach(c=>pools[c]=shuffle(BANK[c],r));
  const days=DAYS.map((d,i)=>({...d,tasks:d.mix.flatMap(([c,n])=>pools[c].splice(0,n).map(([id,title,pts])=>({id,cat:c,title,pts,day:i})))}));
  const bingo=shuffle(BINGO,r).slice(0,9);
  const quiz={h:shuffle(QUIZ_H.map((_,i)=>i),r).slice(0,5),g:shuffle(QUIZ_G.map((_,i)=>i),r).slice(0,5)};
  // The daily law runs through the list in order, five a week, so a family
  // that plays every week meets each one before any repeats.
  const wn=Math.round((weekStart(k)-new Date(2026,0,4).getTime())/(7*864e5));
  const halacha=[0,1,2,3,4].map(i=>(((wn*5+i)%HALACHOT.length)+HALACHOT.length)%HALACHOT.length);
  return _planCache[k]={days,bingo,quiz,halacha};
}
function customTasks(){
  const c=S.W.custom||{};
  return Object.keys(c).sort((a,b)=>(c[a].ts||0)-(c[b].ts||0)).map(id=>({id,cat:'bonus',title:c[id].title,pts:c[id].pts||10,mine:true}));
}
function weeklyTasks(){return TORAH.concat(customTasks());}
function allTasks(){return plan(S.wk).days.flatMap(d=>d.tasks).concat(weeklyTasks());}

// ── scoring ────────────────────────────────────────────────────────────────
function F(fid){return ((S.W.fams||{})[fid])||{};}
// Points a done task is worth: its own day (or earlier) = full, later = half;
// the task the wheel landed on for that day = double, if done on time.
function taskPts(t,rec,fd){
  let p=t.pts;
  if(t.day!=null){
    const d=dayOf(rec.ts,S.wk);
    if(d>t.day)return Math.ceil(p/2);
    if((fd.spin||{})[t.day]===t.id)p*=2;
  }
  return p;
}
function baseScore(fid){
  const fd=F(fid),done=fd.t||{};
  let tasks=0,n=0;const days=new Set();
  allTasks().forEach(t=>{const rec=done[t.id];if(rec&&rec.ts){tasks+=taskPts(t,rec,fd);n++;days.add(dayOf(rec.ts,S.wk));}});
  let quiz=0;Object.values(fd.q||{}).forEach(a=>{if(a&&a.ok)quiz+=PTS.quiz;if(a&&a.ts)days.add(dayOf(a.ts,S.wk));});
  let halacha=0;Object.values(fd.h||{}).forEach(ts=>{if(ts){halacha+=PTS.halacha;days.add(dayOf(ts,S.wk));}});
  const rb=readyBonus(fid),ready=rb.total;
  const b=fd.b||{},sq=Object.keys(b).filter(i=>b[i]).map(Number);
  sq.forEach(i=>days.add(dayOf(b[i],S.wk)));
  const lines=LINES.filter(l=>l.every(i=>sq.includes(i))).length;
  const bingo=sq.length*PTS.bingoSq+lines*PTS.bingoLine+(sq.length===9?PTS.bingoFull:0);
  const active=[0,1,2,3,4].filter(d=>days.has(d));
  const streak=active.length===5?PTS.streak:0;
  return {fid,total:tasks+quiz+halacha+bingo+streak+ready,tasks,quiz,halacha,bingo,streak,ready,readyB:rb,n,active,lines,goal:0};
}
// ── last week's "ready for Shabbat" time ──
// Stored on LAST week's doc as readyAt: minutes from Friday 00:00 (Thursday
// evening is negative), or 'late' when they didn't make it before candles.
function prevKey(k,n){const d=satFromKey(k);d.setDate(d.getDate()-7*(n||1));return keyOf(d);}
function readyAtOf(W,fid){const v=(((W||{}).fams||{})[fid]||{}).readyAt;return v==null?null:v;}
function readyMin(v){return v==null?null:v==='late'?1e6:v;}
function fmtReady(v){
  if(v==='late')return 'ברגע האחרון 😅';
  const m=v<0?v+1440:v,h=Math.floor(m/60),mi=m%60;
  return (v<0?'חמישי ':'שישי ')+String(h).padStart(2,'0')+':'+String(mi).padStart(2,'0');
}
function fmtDelta(m){m=Math.abs(m);return m<60?m+' דק׳':Math.floor(m/60)+':'+String(m%60).padStart(2,'0')+' שע׳';}
function readyStats(){
  const W1=(S.prev||{}).W,W2=(S.prev2||{}).W;
  const rows=players().map(f=>{
    const v=readyAtOf(W1,f.id),v0=readyAtOf(W2,f.id);
    const delta=(typeof v==='number'&&typeof v0==='number')?v0-v:null; // + = earlier than the week before
    return {f,v,v0,delta};
  });
  const nums=rows.filter(r=>typeof r.v==='number');
  const best=nums.length?Math.min(...nums.map(r=>r.v)):null;
  const imp=rows.filter(r=>r.delta!=null&&r.delta>0);
  const bestImp=imp.length?Math.max(...imp.map(r=>r.delta)):null;
  rows.forEach(r=>{r.earliest=best!=null&&r.v===best;r.improved=bestImp!=null&&r.delta===bestImp;});
  rows.sort((a,b)=>(readyMin(a.v)==null?2e6:readyMin(a.v))-(readyMin(b.v)==null?2e6:readyMin(b.v)));
  return rows;
}
function readyBonus(fid){
  const r=readyStats().find(x=>x.f.id===fid);
  const o={report:0,earliest:0,improved:0};
  if(r&&r.v!=null){o.report=PTS.report;if(r.earliest)o.earliest=PTS.earliest;if(r.improved)o.improved=PTS.improved;}
  o.total=o.report+o.earliest+o.improved;return o;
}
function goalState(){
  const all=players().map(f=>baseScore(f.id));
  const target=GOAL_PER_FAM*Math.max(1,all.length),sum=all.reduce((s,r)=>s+r.total,0);
  return {sum,target,done:sum>=target};
}
function score(fid){const r=baseScore(fid);if(goalState().done){r.goal=PTS.goal;r.total+=PTS.goal;}return r;}
function ranking(){const g=goalState().done;return players().map(f=>{const r=baseScore(f.id);if(g){r.goal=PTS.goal;r.total+=PTS.goal;}return r;}).sort((a,b)=>b.total-a.total||b.n-a.n);}
// Category crowns: the family with the most done tasks in each category.
function crowns(){
  const out={};
  Object.keys(CATS).filter(c=>c!=='bonus').forEach(c=>{
    const ts=allTasks().filter(t=>t.cat===c);let best=null,bn=0,tie=false;
    players().forEach(f=>{const n=ts.filter(t=>((F(f.id).t||{})[t.id]||{}).ts).length;if(n>bn){bn=n;best=f.id;tie=false;}else if(n===bn&&n>0)tie=true;});
    if(best!=null&&!tie)(out[best]=out[best]||[]).push(c);
  });
  return out;
}

// ── storage ────────────────────────────────────────────────────────────────
const DEL={__del:1};
function applyPatch(obj,patch){
  Object.keys(patch).forEach(k=>{
    const v=patch[k];
    if(v===DEL){delete obj[k];return;}
    if(v&&typeof v==='object'&&!Array.isArray(v)){if(!obj[k]||typeof obj[k]!=='object')obj[k]={};applyPatch(obj[k],v);}
    else obj[k]=v;
  });
}
function toFs(patch,fs){
  const o={};
  Object.keys(patch).forEach(k=>{const v=patch[k];o[k]=v===DEL?fs.deleteField():(v&&typeof v==='object'&&!Array.isArray(v))?toFs(v,fs):v;});
  return o;
}
async function fsCtx(){
  if(S.fs)return S.fs;
  const fb=await fbInit();const mod=await import(FS_URL);
  return S.fs={db:fb.db,doc:fb.doc,setDoc:fb.setDoc,onSnapshot:fb.onSnapshot,deleteField:mod.deleteField};
}
function hallScores(){const o={};ranking().forEach(r=>o[r.fid]=r.total);return o;}
async function write(patch){
  if(locked()&&!isAdmin()){toast('🔒 התחרות של השבוע ננעלה');return;}
  applyPatch(S.W,patch);render();
  const wk=S.wk,hall=hallScores();S.hall[wk]=hall;
  if(window.CONTEST_MOCK){lsSet('scMock_'+wk,S.W);lsSet('scMockHall',S.hall);return;}
  try{
    const fs=await fsCtx();
    await fs.setDoc(fs.doc(fs.db,'appData','contest_'+wk),toFs(patch,fs),{merge:true});
    await fs.setDoc(fs.doc(fs.db,'appData','contestHall'),{weeks:{[wk]:hall}},{merge:true});
  }catch(e){console.warn('contest save:',e);toast('⚠️ השמירה נכשלה — בדקו את החיבור ונסו שוב',4000);}
}
async function subscribe(){
  stopSync();
  const wk=S.wk,p1=prevKey(wk,1),p2=prevKey(wk,2);
  S.prev={wk:p1,W:{}};S.prev2={wk:p2,W:{}};
  if(window.CONTEST_MOCK){
    const m=k=>lsGet('scMock_'+k,null)||window.CONTEST_MOCK(k)||{};
    S.W=m(wk);S.prev.W=m(p1);S.prev2.W=m(p2);S.hall=lsGet('scMockHall',null)||window.CONTEST_MOCK_HALL||{};
    render();maybeAskReady();return;
  }
  try{
    const fs=await fsCtx();
    S.unsubW=fs.onSnapshot(fs.doc(fs.db,'appData','contest_'+wk),snap=>{if(S.wk!==wk)return;S.W=snap.exists()?snap.data():{};render();},e=>console.warn('contest sync:',e));
    S.unsubH=fs.onSnapshot(fs.doc(fs.db,'appData','contestHall'),snap=>{S.hall=(snap.exists()&&snap.data().weeks)||{};if(S.tab==='board')render();},e=>console.warn('contest hall:',e));
    S.unsubP=[[S.prev,p1],[S.prev2,p2]].map(([slot,k],i)=>fs.onSnapshot(fs.doc(fs.db,'appData','contest_'+k),snap=>{if(S.wk!==wk)return;slot.W=snap.exists()?snap.data():{};slot.loaded=true;render();if(i===0)maybeAskReady();},e=>console.warn('contest prev:',e)));
  }catch(e){console.warn('contest sync:',e);}
}
function stopSync(){if(S.unsubW){S.unsubW();S.unsubW=null;}if(S.unsubH){S.unsubH();S.unsubH=null;}(S.unsubP||[]).forEach(u=>u());S.unsubP=null;}
// The ready-time report goes on last week's doc — allowed while this week is open.
async function writePrev(patch){
  if(locked()){toast('🔒 הדיווח נסגר עם נעילת השבוע');return;}
  const k=S.prev.wk;applyPatch(S.prev.W,patch);
  const hall=hallScores();S.hall[S.wk]=hall;render();
  if(window.CONTEST_MOCK){lsSet('scMock_'+k,S.prev.W);lsSet('scMockHall',S.hall);return;}
  try{
    const fs=await fsCtx();
    await fs.setDoc(fs.doc(fs.db,'appData','contest_'+k),toFs(patch,fs),{merge:true});
    await fs.setDoc(fs.doc(fs.db,'appData','contestHall'),{weeks:{[S.wk]:hall}},{merge:true});
  }catch(e){console.warn('contest save:',e);toast('⚠️ השמירה נכשלה — בדקו את החיבור ונסו שוב',4000);}
}

// ── actions ────────────────────────────────────────────────────────────────
function needFam(){if(S.fid==null||!fam(S.fid)){S.tab='tasks';render();toast('בחרו קודם את המשפחה שלכם');return true;}return false;}
function pop(el,txt){
  if(!el)return;const r=el.getBoundingClientRect();
  const p=document.createElement('div');p.className='sc-pop';p.textContent=txt;
  p.style.left=(r.left+r.width/2)+'px';p.style.top=(r.top)+'px';
  document.body.appendChild(p);setTimeout(()=>p.remove(),1100);
}
function toggleTask(id,el){
  if(needFam())return;
  const t=allTasks().find(x=>x.id===id);if(!t)return;
  if(t.txt){S.openTxt=S.openTxt===id?null:id;render();return;}
  const rec=(F(S.fid).t||{})[id];
  if(rec){write({fams:{[S.fid]:{t:{[id]:DEL}}}});return;}
  const r={ts:now()};const by=whoAmI();if(by)r.by=by;
  const p=taskPts(t,r,F(S.fid));pop(el,'+'+p);S.justDone=id;
  write({fams:{[S.fid]:{t:{[id]:r}}}});
}
function saveTxt(id){
  if(needFam())return;
  const v=(($('scTxt_'+id)||{}).value||'').trim().slice(0,800);
  const t=allTasks().find(x=>x.id===id);
  if(!v){
    if((F(S.fid).t||{})[id]&&confirm('למחוק את מה שכתבתם?'))write({fams:{[S.fid]:{t:{[id]:DEL}}}});
    S.openTxt=null;render();return;
  }
  const old=(F(S.fid).t||{})[id];
  const r={ts:old?old.ts:now(),txt:v};const by=whoAmI();if(by)r.by=by;
  if(!old)pop($('scTxtBtn_'+id),'+'+t.pts);
  S.openTxt=null;write({fams:{[S.fid]:{t:{[id]:r}}}});
}
function setFam(id){S.fid=id;S.switchOpen=false;S.shownPts=null;S.asked=false;lsSet('scFam',id);render();maybeAskReady();}
function switchToggle(o){S.switchOpen=o;}
function pickDay(d){S.day=d;S.openTxt=null;S.enter=true;render();}
function toggleSide(v){S.sideOpen=v==null?!S.sideOpen:v;render();}
function pickHal(d){S.halDay=d;render();}
function setTab(t){S.tab=t;S.openTxt=null;S.enter=true;render();const b=$('scBody');if(b)b.scrollTop=0;}
// kind: 'h' = the law question, 'g' = the general one. Stored as q['2h'].
function quizQ(d,kind){const P=plan(S.wk);return kind==='h'?QUIZ_H[P.quiz.h[d]]:QUIZ_G[P.quiz.g[d]];}
function answer(d,kind,i){
  if(needFam())return;
  const key=d+kind,fd=F(S.fid);if((fd.q||{})[key])return;
  if(d!==today()){toast('אפשר לענות רק על השאלות של היום');return;}
  const ok=quizQ(d,kind).c===i;
  if(ok)pop($('scQ_'+key+'_'+i),'+'+PTS.quiz);
  write({fams:{[S.fid]:{q:{[key]:{a:i,ok,ts:now()}}}}});
}
function readHalacha(d,el){
  if(needFam())return;
  const h=F(S.fid).h||{};
  if(h[d]){write({fams:{[S.fid]:{h:{[d]:DEL}}}});return;}
  if(d>today()){toast('ההלכה של יום '+DAYS[d].name+' תיפתח ביום '+DAYS[d].name);return;}
  pop(el,'+'+PTS.halacha);
  write({fams:{[S.fid]:{h:{[d]:now()}}}});
}
function askReady(){
  if(needFam())return;
  if(locked()){toast('🔒 הדיווח נסגר עם נעילת השבוע');return;}
  closeAsk();
  const cur=readyAtOf(S.prev.W,S.fid);
  const isThu=typeof cur==='number'&&cur<0,m=typeof cur==='number'?(cur<0?cur+1440:cur):14*60;
  const hh=String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
  const el=document.createElement('div');el.id='scAsk';el.className='sc-ask';
  el.innerHTML=`<div class="sc-ask-card" role="dialog" aria-modal="true" aria-labelledby="scAskTtl">
    <div class="sc-ask-candles"><span class="sc-candle"><i></i></span><span class="sc-candle"><i></i></span></div>
    <div class="sc-ask-ttl" id="scAskTtl">שבוע טוב, משפחת ${E(short(fam(S.fid)))}!</div>
    <div class="sc-ask-sub">באיזו שעה הייתם <b>מוכנים לגמרי</b> ל${E(parshaTitle(S.prev.wk))}?</div>
    <div class="sc-ask-list">${READY_LIST.map((x,i)=>`<label><input type="checkbox" id="scAskC${i}" ${cur!=null?'checked':''} onchange="contestUI.askCheck()"><span>${E(x)}</span></label>`).join('')}</div>
    <div class="sc-ask-when">
      <div class="sc-seg"><button type="button" id="scAskThu" class="${isThu?'on':''}" onclick="contestUI.askDay(true)">חמישי</button><button type="button" id="scAskFri" class="${isThu?'':'on'}" onclick="contestUI.askDay(false)">שישי</button></div>
      <input type="time" id="scAskTime" value="${hh}" step="300" aria-label="שעה">
    </div>
    <div class="sc-ask-act">
      <button class="sc-btn" id="scAskSave" onclick="contestUI.saveReady()">שמירה</button>
      <button class="sc-btn ghost" onclick="contestUI.saveReady('late')">לא הספקנו לפני הדלקת נרות</button>
    </div>
    <button class="sc-ask-later" onclick="contestUI.closeAsk(true)">אחר כך</button>
  </div>`;
  el.addEventListener('click',e=>{if(e.target===el)closeAsk(true);});
  $('contestOverlay').appendChild(el);askCheck();
}
function askCheck(){const all=READY_LIST.every((_,i)=>($('scAskC'+i)||{}).checked),b=$('scAskSave');if(b){b.disabled=!all;b.textContent=all?'שמירה':'מסמנים קודם הכל ✓';}}
function askDay(thu){$('scAskThu').classList.toggle('on',thu);$('scAskFri').classList.toggle('on',!thu);}
function closeAsk(later){const el=$('scAsk');if(el)el.remove();if(later)lsSet('scAskLater_'+S.prev.wk,new Date().toDateString());}
function saveReady(late){
  let v='late';
  if(!late){
    const t=($('scAskTime')||{}).value||'';if(!/^\d\d:\d\d$/.test(t)){toast('בחרו שעה');return;}
    const [h,m]=t.split(':').map(Number);v=h*60+m;if($('scAskThu').classList.contains('on'))v-=1440;
  }
  const first=readyAtOf(S.prev.W,S.fid)==null;
  closeAsk();if(first){confetti(40);toast('תודה! +'+PTS.report+' נקודות על הדיווח',3000);}
  writePrev({fams:{[S.fid]:{readyAt:v,readyTs:now()}}});
}
// Pops once a day after Shabbat until the family reports last week's time.
function maybeAskReady(){
  if(S.asked||S.fid==null||locked()||!$('contestOverlay')||!$('contestOverlay').classList.contains('open'))return;
  if(readyAtOf(S.prev.W,S.fid)!=null)return;
  if(lsGet('scAskLater_'+S.prev.wk,'')===new Date().toDateString())return;
  if(!window.CONTEST_MOCK&&!S.prev.loaded)return;
  S.asked=true;setTimeout(askReady,500);
}
function cheer(fid,ev){
  if(ev)ev.stopPropagation();
  if(needFam()||fid===S.fid)return;
  const c=F(S.fid).cheer||{};
  write({fams:{[S.fid]:{cheer:{[fid]:c[fid]?DEL:now()}}}});
}
function cheersFor(fid){return players().filter(f=>f.id!==fid&&(F(f.id).cheer||{})[fid]);}
function toggleBingo(i){
  if(needFam())return;
  const b=F(S.fid).b||{};
  if(b[i]){write({fams:{[S.fid]:{b:{[i]:DEL}}}});return;}
  const sq=Object.keys(b).filter(k=>b[k]).map(Number).concat(i);
  const newLines=LINES.filter(l=>l.includes(i)&&l.every(x=>sq.includes(x))).length;
  pop($('scB_'+i),newLines?'בינגו! +'+(PTS.bingoSq+newLines*PTS.bingoLine):'+'+PTS.bingoSq);
  if(newLines)confetti(40);
  write({fams:{[S.fid]:{b:{[i]:now()}}}});
}
function spin(){
  if(needFam()||S.spinning)return;
  const d=today();if(d>4){toast('הגלגל מסתובב רק בימים ראשון–חמישי');return;}
  const fd=F(S.fid);if((fd.spin||{})[d])return;
  const tasks=plan(S.wk).days[d].tasks,idx=Math.floor(Math.random()*tasks.length);
  const wheel=$('scWheel');S.spinning=true;
  if(wheel){
    const seg=360/tasks.length,target=360*6+(360-(idx*seg+seg/2));
    wheel.style.transition='transform 3.2s cubic-bezier(.17,.67,.2,1)';wheel.style.transform='rotate('+target+'deg)';
  }
  setTimeout(()=>{S.spinning=false;confetti(25);toast('⚡ '+tasks[idx].title+' — שווה כפול היום!',3500);write({fams:{[S.fid]:{spin:{[d]:tasks[idx].id}}}});},wheel?3300:0);
}
function addCustom(){
  const title=(prompt('משימת הבונוס של השבוע (לכל המשפחות):')||'').trim();if(!title)return;
  const pts=parseInt(prompt('כמה נקודות?','15'),10)||15;
  write({custom:{['x'+Date.now().toString(36)]:{title:title.slice(0,120),pts:Math.max(1,Math.min(100,pts)),ts:now()}}});
}
function delCustom(id){if(confirm('למחוק את משימת הבונוס?'))write({custom:{[id]:DEL}});}
function toggleHelp(){S.showHelp=!S.showHelp;render();}
function toggleFamDetail(id){S.openFam=S.openFam===id?null:id;render();}

function confetti(n){
  const cols=['#F59E0B','#E76F51','#0E7490','#2A9D8F','#E9C46A','#FDE68A'];
  for(let i=0;i<n;i++){
    const c=document.createElement('div');c.className='sc-conf';
    c.style.left=Math.random()*100+'vw';c.style.background=cols[i%cols.length];
    c.style.animationDelay=Math.random()*.4+'s';c.style.animationDuration=(1.6+Math.random()*1.4)+'s';
    c.style.transform='rotate('+Math.random()*360+'deg)';
    document.body.appendChild(c);setTimeout(()=>c.remove(),3400);
  }
}

// ── rendering ──────────────────────────────────────────────────────────────
function ensureOverlay(){
  let o=$('contestOverlay');if(o)return o;
  o=document.createElement('div');o.id='contestOverlay';o.setAttribute('dir','rtl');
  o.innerHTML=`<div class="sc-top">
      <button class="sc-x" onclick="closeContestOverlay()" aria-label="סגירה">✕</button>
      <div class="sc-top-title"><span class="sc-candles" aria-hidden="true"><span class="sc-candle"><i></i></span><span class="sc-candle"><i></i></span></span><span>תחרות הכנות לשבת<small id="scSub"></small></span></div>
      <button class="sc-music-btn" id="scMusic" onclick="contestUI.toggleMusic()" aria-label="השתקת המוזיקה"><span class="ic">🔊</span><span class="eq"><i></i><i></i><i></i></span></button>
      <button class="sc-help-btn" onclick="contestUI.toggleHelp()" aria-label="איך משחקים">?</button>
    </div>
    <div class="sc-tabs" id="scTabs"></div>
    <div class="sc-wrap"><div class="sc-body" id="scBody"></div>
      <div class="sc-side-dim" onclick="contestUI.toggleSide(false)"></div>
      <aside class="sc-side" id="scSide" aria-label="הלכה יומית"></aside>
      <button class="sc-side-tab" id="scSideTab" onclick="contestUI.toggleSide()" aria-label="הלכה יומית"><span>📜</span><b>הלכה יומית</b></button>
    </div>`;
  o.addEventListener('pointermove',tilt);o.addEventListener('pointerleave',untilt,true);o.addEventListener('pointerout',untilt);
  document.body.appendChild(o);return o;
}
function render(){
  const o=$('contestOverlay');if(!o||!o.classList.contains('open')||S.spinning)return;
  $('scSub').textContent=parshaTitle(S.wk);
  const tb=(id,l)=>`<button class="${S.tab===id?'on':''}" onclick="contestUI.setTab('${id}')">${l}</button>`;
  $('scTabs').innerHTML=tb('tasks','📋 משימות')+tb('games','🎮 משחקים')+tb('board','🏆 טבלה')+tb('torah','📖 דברי תורה');
  const body=$('scBody'),st=body.scrollTop;
  // Live updates re-render everything — keep a half-written text and its focus.
  const old=S.openTxt&&$('scTxt_'+S.openTxt),val=old?old.value:null,foc=!old||document.activeElement===old;
  o.classList.toggle('side-open',!!S.sideOpen);
  $('scSide').innerHTML=S.fid!=null?sidePanel():'';
  $('scSideTab').hidden=S.fid==null;
  $('scSideTab').classList.toggle('todo',S.fid!=null&&today()<=4&&!(F(S.fid).h||{})[today()]&&!locked());
  body.innerHTML=hero()+(S.showHelp?help():'')+(S.tab==='tasks'?tasksTab():S.tab==='games'?gamesTab():S.tab==='board'?boardTab():torahTab());
  body.scrollTop=st;
  const ta=S.openTxt&&$('scTxt_'+S.openTxt);
  if(ta){if(val!=null)ta.value=val;if(foc)ta.focus({preventScroll:true});}
  // Cards rise in only when the view changes, not on every live update.
  if(S.enter){S.enter=false;body.classList.remove('sc-enter');void body.offsetWidth;body.classList.add('sc-enter');clearTimeout(S.enterT);S.enterT=setTimeout(()=>body.classList.remove('sc-enter'),900);}
  S.justDone=null;
  countUp();
}
// The hero score rolls up to its new value.
function countUp(){
  const el=$('scPts');if(!el)return;
  const to=+el.dataset.v,from=S.shownPts==null?to:S.shownPts;S.shownPts=to;
  if(from===to||matchMedia('(prefers-reduced-motion: reduce)').matches){el.textContent=to;return;}
  const t0=performance.now(),dur=700;el.textContent=from;el.parentNode.classList.add('bump');
  const step=t=>{const k=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-k,3);el.textContent=Math.round(from+(to-from)*e);if(k<1)requestAnimationFrame(step);else el.parentNode.classList.remove('bump');};
  requestAnimationFrame(step);
}
// 3D tilt of the hero card under the finger / mouse.
function tilt(e){
  const h=e.target.closest&&e.target.closest('.sc-hero');if(!h)return;
  const r=h.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;
  h.style.setProperty('--rx',(-y*8).toFixed(2)+'deg');h.style.setProperty('--ry',(x*10).toFixed(2)+'deg');
  h.style.setProperty('--gx',((x+.5)*100).toFixed(0)+'%');h.style.setProperty('--gy',((y+.5)*100).toFixed(0)+'%');
}
function untilt(e){const h=e.target.closest&&e.target.closest('.sc-hero');if(h){h.style.setProperty('--rx','0deg');h.style.setProperty('--ry','0deg');}}
function hero(){
  const lk=locked(),ms=lockAt(S.wk)-now(),me=fam(S.fid);
  const rk=ranking(),pos=rk.findIndex(r=>r.fid===S.fid),mine=pos>=0?rk[pos]:null;
  const clock=lk
    ?`<div class="sc-clock lk">🔒 התחרות ננעלה · שבת שלום!</div>`
    :`<div class="sc-clock${ms<864e5?' hot':''}">⏳ נשארו <b>${left(ms)}</b> עד שנועלים (שישי ${LOCK_HOUR}:00)</div>`;
  if(!me){
    return `<div class="sc-hero">${clock}
      <div class="sc-pick-ttl">מי אתם? בחרו את המשפחה שלכם כדי להתחיל לצבור נקודות</div>
      <div class="sc-pick">${players().map(f=>`<button onclick="contestUI.setFam(${f.id})">${ava(f,26)}<span>${E(short(f))}</span></button>`).join('')}</div></div>`;
  }
  return `<div class="sc-hero">${clock}
    <div class="sc-me">
      ${ava(me,44)}
      <div class="sc-me-txt"><div class="sc-me-name">משפחת ${E(short(me))}</div>
        <div class="sc-me-sub">${pos===0&&mine.total>0?'👑 במקום הראשון!':pos>=0?'מקום '+(pos+1)+' מתוך '+rk.length:''}${mine&&mine.active.length?' · 🔥 '+mine.active.length+'/5 ימים':''}</div></div>
      <div class="sc-me-pts"><b id="scPts" data-v="${mine?mine.total:0}">${S.shownPts==null?(mine?mine.total:0):S.shownPts}</b><small>נקודות</small></div>
    </div>
    <details class="sc-switch"${S.switchOpen?' open':''} ontoggle="contestUI.switchToggle(this.open)"><summary>לא אתם? החליפו משפחה</summary>
      <div class="sc-pick">${players().map(f=>`<button class="${f.id===S.fid?'on':''}" onclick="contestUI.setFam(${f.id})">${ava(f,22)}<span>${E(short(f))}</span></button>`).join('')}</div></details>
  </div>`;
}
function help(){
  return `<div class="sc-card sc-help">
    <b>איך משחקים?</b>
    <ul>
      <li>כל יום מראשון עד חמישי יש משימות משלו. מסמנים ✓ כשסיימתם — הנקודות נכנסות מיד לטבלה.</li>
      <li>משימה שנעשית ביום שלה (או מוקדם) — כל הנקודות. באיחור — חצי.</li>
      <li>🎡 גלגל ההפתעות: מסובבים פעם ביום — המשימה שיוצאת שווה <b>כפול</b> אם עושים אותה היום.</li>
      <li>❓ חידון יומי: שתי שאלות ביום — אחת בהלכות שבת ואחת מהמקורות. ${PTS.quiz} נקודות לכל תשובה נכונה, ניסיון אחד.</li>
      <li>📜 הלכה יומית מקיצור שולחן ערוך: קראתם ולמדתם? ${PTS.halacha} נקודות.</li>
      <li>⏰ אחרי שבת מדווחים באיזו שעה הייתם <b>מוכנים לגמרי</b> (פלטה, אוכל, שולחן, כולם רחוצים ולבושים, נרות). דיווח = ${PTS.report}, הכי מוקדמים = עוד ${PTS.earliest}, הכי השתפרו מהשבוע שלפני = עוד ${PTS.improved}.</li>
      <li>🤝 יעד משפחתי משותף: אם כולם יחד מגיעים ליעד — כל משפחה מקבלת עוד ${PTS.goal}.</li>
      <li>👏 בטבלה אפשר לשלוח מחיאת כפיים למשפחות אחרות.</li>
      <li>🎯 בינגו: ${PTS.bingoSq} לכל משבצת, ${PTS.bingoLine} לכל שורה, ${PTS.bingoFull} בונוס על לוח מלא.</li>
      <li>🔥 פעילים כל חמשת הימים? עוד ${PTS.streak} נקודות.</li>
      <li>📖 הפירוש על הפרשה שאתם כותבים מופיע לכל המשפחה — לקרוא בשולחן השבת.</li>
      <li>🔒 ביום שישי ב-${LOCK_HOUR}:00 הכל ננעל ומוכרזים המנצחים.</li>
    </ul></div>`;
}
function doneBy(id){return players().filter(f=>((F(f.id).t||{})[id]||{}).ts);}
function taskRow(t){
  const rec=(F(S.fid).t||{})[t.id],cat=CATS[t.cat],fd=F(S.fid);
  const dbl=t.day!=null&&(fd.spin||{})[t.day]===t.id;
  const late=rec&&t.day!=null&&dayOf(rec.ts,S.wk)>t.day;
  const others=doneBy(t.id).filter(f=>f.id!==S.fid);
  const pts=rec?taskPts(t,rec,fd):(dbl?t.pts*2:t.pts);
  const lk=locked()&&!isAdmin();
  let html=`<div class="sc-task${rec?' done':''}${dbl?' dbl':''}${S.justDone===t.id&&rec?' just':''}">
    <button class="sc-chk" id="scT_${t.id}" ${lk?'disabled':''} onclick="contestUI.toggleTask('${t.id}',this)" aria-pressed="${!!rec}" aria-label="${E(t.title)}">${rec?'✓':''}</button>
    <div class="sc-task-main" onclick="${lk?'':`contestUI.toggleTask('${t.id}',document.getElementById('scT_${t.id}'))`}">
      <div class="sc-task-ttl">${E(t.title)}</div>
      <div class="sc-task-meta"><span class="sc-cat" style="--c:${cat.c}">${cat.ico} ${cat.lbl}</span>
        ${dbl?'<span class="sc-x2">⚡ כפול היום</span>':''}${late?'<span class="sc-late">⏰ באיחור</span>':''}
        ${t.txt&&!rec?'<span class="sc-hint">✍️ לוחצים וכותבים</span>':''}
        ${rec&&rec.by?`<span class="sc-by">· ${E(rec.by)}</span>`:''}
        ${others.length?`<span class="sc-others" title="${E(others.map(short).join(', '))}">${others.slice(0,4).map(f=>ava(f,16)).join('')}${others.length>4?'+'+(others.length-4):''}</span>`:''}
      </div>
    </div>
    <div class="sc-pts">${pts}</div>
    ${t.mine&&isAdmin()?`<button class="sc-del" onclick="contestUI.delCustom('${t.id}')" aria-label="מחיקה">🗑</button>`:''}
  </div>`;
  if(t.txt&&S.openTxt===t.id){
    html+=`<div class="sc-txt"><textarea id="scTxt_${t.id}" rows="4" maxlength="800" placeholder="${E(t.txt)}">${E(rec&&rec.txt||'')}</textarea>
      <div class="sc-txt-act"><button class="sc-btn" id="scTxtBtn_${t.id}" onclick="contestUI.saveTxt('${t.id}')">${rec?'שמירה':'✓ סיימנו'}</button>
      <button class="sc-btn ghost" onclick="contestUI.toggleTask('${t.id}')">ביטול</button></div></div>`;
  }else if(t.txt&&rec&&rec.txt){
    html+=`<div class="sc-txt-view">“${E(rec.txt)}”</div>`;
  }
  return html;
}
function tasksTab(){
  const P=plan(S.wk),td=today();
  if(S.day==null)S.day=td<=4?td:'w';
  const doneIn=list=>list.filter(t=>((F(S.fid).t||{})[t.id]||{}).ts).length;
  const pills=P.days.map((d,i)=>{
    const n=doneIn(d.tasks),all=n===d.tasks.length&&n>0;
    return `<button class="${S.day===i?'on':''}${i===td?' today':''}" onclick="contestUI.pickDay(${i})">
      <span class="d">${d.name}</span><span class="i">${all?'✅':d.ico}</span><span class="n">${n}/${d.tasks.length}</span></button>`;
  }).join('')+`<button class="${S.day==='w'?'on':''}" onclick="contestUI.pickDay('w')"><span class="d">כל השבוע</span><span class="i">📖</span><span class="n">${doneIn(weeklyTasks())}/${weeklyTasks().length}</span></button>`;
  let sec;
  if(S.day==='w'){
    sec=`<div class="sc-day-hdr"><span class="ic">📖</span><div><b>משימות לכל השבוע</b><small>פירוש על הפרשה, שירים ובונוסים — אפשר בכל יום עד הנעילה</small></div></div>
      ${weeklyTasks().map(taskRow).join('')}
      ${isAdmin()&&!locked()?`<button class="sc-add" onclick="contestUI.addCustom()">➕ הוספת משימת בונוס לכל המשפחות</button>`:''}`;
  }else{
    const d=P.days[S.day],n=doneIn(d.tasks),pct=Math.round(n/d.tasks.length*100);
    const when=S.day===td?'היום':S.day<td?'עבר — עכשיו רק חצי נקודות':'אפשר כבר להקדים';
    sec=`<div class="sc-day-hdr"><span class="ic">${d.ico}</span><div><b>יום ${d.name} · ${d.ttl}</b><small>${when}</small></div>
        <div class="sc-ring" style="--p:${pct}"><span>${pct}%</span></div></div>
      ${d.tasks.map(taskRow).join('')}
      ${S.day===td&&!(F(S.fid).spin||{})[td]&&!locked()?`<button class="sc-add" onclick="contestUI.setTab('games')">🎡 עוד לא סובבתם את הגלגל היום — אחת המשימות תהיה שווה כפול!</button>`:''}`;
  }
  return `${S.fid!=null?readyCard():''}<div class="sc-days">${pills}</div>${S.fid!=null?sec:''}${feed()}`;
}
// The daily law lives in its own side panel: a column beside the page on a
// wide screen, a drawer pulled from the edge on a phone.
function sidePanel(){
  const td=Math.min(today(),4);
  if(S.halDay==null)S.halDay=td;
  const h=F(S.fid).h||{};
  const chips=DAYS.map((d,i)=>`<button class="${S.halDay===i?'on':''}${h[i]?' read':''}" onclick="contestUI.pickHal(${i})" aria-label="יום ${d.name}">${'אבגדה'[i]}${h[i]?'<i>✓</i>':''}</button>`).join('');
  const n=Object.keys(h).filter(k=>h[k]).length;
  return `<div class="sc-side-hdr"><b>📜 הלכה יומית</b><small>מקיצור שולחן ערוך · למדתם ${n}/5 השבוע</small>
      <button class="sc-side-x" onclick="contestUI.toggleSide(false)" aria-label="סגירה">✕</button></div>
    <div class="sc-side-days">${chips}</div>
    ${halachaCard(S.halDay)}`;
}
function halachaCard(d){
  const P=plan(S.wk),h=HALACHOT[P.halacha[d]],read=(F(S.fid).h||{})[d],lk=locked()&&!isAdmin();
  return `<div class="sc-hal">
    <div class="sc-hal-top">📜 הלכה יומית · יום ${DAYS[d].name}</div>
    <div class="sc-hal-ttl">${E(h.t)}</div>
    <p>${E(h.x)}</p>
    <div class="sc-hal-foot"><a href="${srcUrl(h)}" target="_blank" rel="noopener">${E(srcTxt(h))} ↗</a>
      <button class="sc-hal-btn${read?' on':''}" ${lk?'disabled':''} onclick="contestUI.readHalacha(${d},this)">${read?'✓ למדנו':'למדנו (+'+PTS.halacha+')'}</button></div>
    <div class="sc-hal-note">מתוך קיצור שולחן ערוך. למעשה — כל משפחה כמנהגה, ובשאלה שואלים רב.</div>
  </div>`;
}
function readyCard(){
  if(!S.prev)return '';
  const v=readyAtOf(S.prev.W,S.fid),lk=locked();
  if(v==null&&lk)return '';
  const r=readyStats().find(x=>x.f.id===S.fid)||{};
  const d=r.delta;
  const trend=d==null?'':d>0?`<span class="sc-up">⬆ ${fmtDelta(d)} מוקדם יותר מהשבוע שלפני</span>`:d<0?`<span class="sc-down">⬇ ${fmtDelta(d)} מאוחר יותר</span>`:'<span>כמו בשבוע שלפני</span>';
  return `<div class="sc-ready">
    <div class="sc-ready-ic">⏰</div>
    <div class="sc-ready-txt">${v==null
      ?`<b>באיזו שעה הייתם מוכנים לשבת שעברה?</b><small>מדווחים ומקבלים ${PTS.report} נקודות</small>`
      :`<b>הייתם מוכנים: ${E(fmtReady(v))}</b><small>${trend||'בשבוע הבא נראה אם השתפרתם'}</small>`}</div>
    ${lk?'':`<button class="sc-btn${v==null?'':' ghost'}" onclick="contestUI.askReady()">${v==null?'לדיווח':'עריכה'}</button>`}
  </div>`;
}
const WHEEL_COLS=['#0E7490','#F59E0B','#E76F51','#2A9D8F','#E9C46A','#8C5A3C'];
function wheelSvg(tasks,spunId){
  const n=tasks.length,R=100,seg=2*Math.PI/n;
  const paths=tasks.map((t,i)=>{
    const a0=i*seg-Math.PI/2,a1=a0+seg,large=seg>Math.PI?1:0;
    const x0=R+R*Math.cos(a0),y0=R+R*Math.sin(a0),x1=R+R*Math.cos(a1),y1=R+R*Math.sin(a1);
    const am=a0+seg/2,tx=R+R*.62*Math.cos(am),ty=R+R*.62*Math.sin(am);
    return `<path d="M${R},${R} L${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} Z" fill="${WHEEL_COLS[i%WHEEL_COLS.length]}" stroke="#fff" stroke-width="2" opacity="${spunId&&spunId!==t.id?.35:1}"/>
      <text x="${tx}" y="${ty}" font-size="26" text-anchor="middle" dominant-baseline="central">${CATS[t.cat].ico}</text>`;
  }).join('');
  // When already spun, rest the wheel with the chosen slice under the pointer.
  const idx=spunId?tasks.findIndex(t=>t.id===spunId):-1;
  const rot=idx>=0?360-(idx*(360/n)+180/n):0;
  return `<div class="sc-wheel-wrap"><div class="sc-pointer">▼</div>
    <svg id="scWheel" viewBox="0 0 200 200" style="transform:rotate(${rot}deg)">${paths}<circle cx="100" cy="100" r="16" fill="#fff"/></svg></div>`;
}
function gamesTab(){
  if(S.fid==null)return '';
  const P=plan(S.wk),td=today(),fd=F(S.fid),lk=locked();
  // wheel
  let wheel;
  if(td>4||lk){wheel=`<div class="sc-muted">הגלגל מסתובב בימים ראשון–חמישי. נתראה בשבוע הבא!</div>`;}
  else{
    const tasks=P.days[td].tasks,sp=(fd.spin||{})[td],t=tasks.find(x=>x.id===sp);
    wheel=wheelSvg(tasks,sp)+(t
      ?`<div class="sc-spun">⚡ היום שווה כפול: <b>${E(t.title)}</b> (${t.pts*2} נק׳)</div>`
      :`<button class="sc-btn big" onclick="contestUI.spin()">🎡 סובבו!</button>`);
  }
  // quiz
  const days=[0,1,2,3,4].filter(d=>d<=Math.min(td,4));
  const qBlock=(d,kind)=>{
    const q=quizQ(d,kind),key=d+kind,a=(fd.q||{})[key],isToday=d===td;
    const lbl=(kind==='h'?'⚖️ הלכות שבת':'📚 שבת במקורות')+' · '+(isToday?'היום':'יום '+DAYS[d].name);
    if(!a&&!isToday)return `<div class="sc-q past"><div class="sc-q-day">${lbl}</div><div class="sc-muted">לא נענתה</div></div>`;
    const url=srcUrl(q);
    return `<div class="sc-q"><div class="sc-q-day">${lbl}</div>
      <div class="sc-q-q">${E(q.q)}</div>
      <div class="sc-q-a">${q.a.map((x,i)=>{
        const cls=a?(i===q.c?'ok':i===a.a?'bad':''):'';
        return `<button id="scQ_${key}_${i}" class="${cls}" ${a||lk?'disabled':''} onclick="contestUI.answer(${d},'${kind}',${i})">${E(x)}</button>`;}).join('')}</div>
      ${a?`<div class="sc-q-res">${a.ok?'🎉 נכון! +'+PTS.quiz:'😅 לא הפעם — התשובה הנכונה בירוק'}
        <span class="sc-q-src">המקור: ${url?`<a href="${url}" target="_blank" rel="noopener">${E(srcTxt(q))} ↗</a>`:E(srcTxt(q))}</span></div>`:''}</div>`;
  };
  const quiz=days.reverse().map(d=>qBlock(d,'h')+qBlock(d,'g')).join('')||`<div class="sc-muted">השאלות מתחילות ביום ראשון</div>`;
  // bingo
  const b=fd.b||{},sq=Object.keys(b).filter(i=>b[i]).map(Number);
  const winSq=new Set(LINES.filter(l=>l.every(i=>sq.includes(i))).flat());
  const grid=P.bingo.map((txt,i)=>`<button id="scB_${i}" class="${b[i]?'on':''}${winSq.has(i)?' win':''}" ${lk&&!isAdmin()?'disabled':''} onclick="contestUI.toggleBingo(${i})">${b[i]?'<span class="st">⭐</span>':''}${E(txt)}</button>`).join('');
  const lines=LINES.filter(l=>l.every(i=>sq.includes(i))).length;
  return `<div class="sc-card"><div class="sc-card-ttl">🎡 גלגל ההפתעות <small>פעם ביום · משימה שווה כפול</small></div>${wheel}</div>
    <div class="sc-card"><div class="sc-card-ttl">❓ חידון שבת יומי <small>2 שאלות ביום · ${PTS.quiz} נק׳ לתשובה · ניסיון אחד</small></div>${quiz}</div>
    <div class="sc-card"><div class="sc-card-ttl">🎯 בינגו שבת <small>${sq.length}/9 · ${lines} שורות</small></div>
      <div class="sc-bingo">${grid}</div>
      <div class="sc-muted" style="margin-top:8px">מסמנים משבצת כשזה קרה אצלכם השבוע. שורה / טור / אלכסון = בינגו!</div></div>`;
}
function feed(){
  const items=[];
  players().forEach(f=>{
    const fd=F(f.id);
    Object.entries(fd.t||{}).forEach(([id,r])=>{const t=allTasks().find(x=>x.id===id);if(t&&r.ts)items.push({f,ts:r.ts,txt:CATS[t.cat].ico+' '+t.title,by:r.by});});
    Object.entries(fd.b||{}).forEach(([i,ts])=>{if(ts)items.push({f,ts,txt:'🎯 '+plan(S.wk).bingo[i]});});
  });
  items.sort((a,b)=>b.ts-a.ts);
  if(!items.length)return '';
  const when=ts=>{const d=dayOf(ts,S.wk),t=new Date(ts).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'});return (d===today()?'היום':'יום '+(['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'][d]))+' '+t;};
  return `<div class="sc-feed-ttl">⚡ מה קורה אצל כולם</div><div class="sc-feed">${items.slice(0,10).map(x=>`<div class="sc-feed-row">${ava(x.f,26)}
    <div><b>${E(short(x.f))}</b>${x.by?' <small>('+E(x.by)+')</small>':''} — ${E(x.txt)}<div class="sc-feed-t">${when(x.ts)}</div></div></div>`).join('')}</div>`;
}
function boardTab(){
  const rk=ranking(),lk=locked(),max=Math.max(1,...rk.map(r=>r.total));
  const top=rk.slice(0,3);
  const order=[1,0,2].filter(i=>top[i]);
  const podium=top.length&&top[0].total>0?`<div class="sc-podium">${order.map(i=>{const r=top[i],f=fam(r.fid);
    return `<div class="sc-pod p${i+1}">${i===0?'<div class="crown">👑</div>':''}${ava(f,i===0?56:44)}<div class="nm">${E(short(f))}</div><div class="pt">${r.total}</div><div class="blk">${i+1}</div></div>`;}).join('')}</div>`:'';
  const title=lk&&top[0]&&top[0].total>0
    ?`<div class="sc-winner">🎉 המנצחים של ${E(parshaTitle(S.wk))}: <b>משפחת ${E(short(fam(top[0].fid)))}</b>!</div>`
    :`<div class="sc-muted" style="text-align:center;margin-bottom:6px">הטבלה מתעדכנת בזמן אמת · ננעלת ביום שישי ב-${LOCK_HOUR}:00</div>`;
  const cr=crowns(),g=goalState(),gp=Math.min(100,Math.round(g.sum/g.target*100));
  const goal=`<div class="sc-card sc-goal"><div class="sc-card-ttl">🤝 היעד המשפחתי <small>כולם יחד</small></div>
    <div class="sc-goal-bar"><div style="width:${gp}%"></div></div>
    <div class="sc-goal-txt">${g.done?`🎉 הגענו ליעד! כל משפחה מקבלת עוד ${PTS.goal} נקודות`:`${g.sum} מתוך ${g.target} נקודות — אם כולם יחד מגיעים, כל משפחה מקבלת עוד ${PTS.goal}`}</div></div>`;
  const medal=i=>['🥇','🥈','🥉'][i]||'';
  const rows=rk.map((r,i)=>{const f=fam(r.fid),open=S.openFam===r.fid,ch=cheersFor(r.fid),mine=(F(S.fid).cheer||{})[r.fid];
    const badges=(cr[r.fid]||[]).map(c=>`<span class="sc-badge" title="הכי הרבה משימות ${CATS[c].lbl}">${CATS[c].ico}</span>`).join('');
    const parts=[['משימות',r.tasks],['חידון',r.quiz],['הלכה',r.halacha],['בינגו',r.bingo],['מוכנים לשבת',r.ready],['רצף',r.streak],['יעד',r.goal]].filter(p=>p[1]);
    return `<div class="sc-row${r.fid===S.fid?' me':''}" onclick="contestUI.toggleFamDetail(${r.fid})">
      <div class="sc-rank">${i+1}</div>${ava(f,32)}
      <div class="sc-row-main"><div class="sc-row-top"><span>${E(short(f))} ${r.readyB.earliest?'⏰':''}${r.readyB.improved?'📈':''} ${badges}</span><b>${r.total}</b></div>
        <div class="sc-bar"><div style="width:${Math.round(r.total/max*100)}%"></div></div>
        <div class="sc-dots">${[0,1,2,3,4].map(d=>`<span class="${r.active.includes(d)?'on':''}" title="יום ${DAYS[d].name}">${'אבגדה'[d]}</span>`).join('')}${r.streak?' 🔥':''}
          <button class="sc-cheer${mine?' on':''}" ${r.fid===S.fid||S.fid==null?'disabled':''} onclick="contestUI.cheer(${r.fid},event)" aria-label="מחיאת כפיים">👏${ch.length?' '+ch.length:''}</button></div>
        ${open?`<div class="sc-break">${parts.map(p=>p[0]+' '+p[1]).join(' · ')||'עוד אין נקודות'}${ch.length?'<br>👏 מ: '+ch.map(x=>E(short(x))).join(', '):''}</div>`:''}
      </div></div>`;}).join('');
  const crownCats=[...new Set(Object.keys(cr).flatMap(id=>cr[id]))];
  const legend=crownCats.length?`<div class="sc-muted" style="margin:-4px 4px 12px">סמל ליד השם = הכי הרבה משימות בתחום: ${crownCats.map(c=>CATS[c].ico+' '+CATS[c].lbl).join(' · ')}</div>`:'';
  // Hall of fame: past weeks only, from the stored final scores.
  const past=Object.keys(S.hall).filter(k=>k<S.wk).sort().reverse();
  const wins={};past.forEach(k=>{const s=S.hall[k]||{};const best=Object.keys(s).sort((a,b)=>s[b]-s[a])[0];if(best&&s[best]>0)wins[best]=(wins[best]||0)+1;});
  const hall=past.length?`<div class="sc-card"><div class="sc-card-ttl">🏅 היכל התהילה</div>
    <div class="sc-hall">${Object.keys(wins).sort((a,b)=>wins[b]-wins[a]).map(id=>{const f=fam(+id);return f?`<div>${ava(f,28)}<span>${E(short(f))}</span><b>${'🏆'.repeat(Math.min(wins[id],5))}${wins[id]>5?' ×'+wins[id]:''}</b></div>`:'';}).join('')}</div>
    <div class="sc-hall-weeks">${past.slice(0,6).map(k=>{const s=S.hall[k]||{};const best=Object.keys(s).sort((a,b)=>s[b]-s[a])[0];const f=best&&fam(+best);
      return `<div><span>${E(parshaTitle(k))}</span><span>${f&&s[best]>0?'🏆 '+E(short(f))+' · '+s[best]:'—'}</span></div>`;}).join('')}</div></div>`:'';
  const rs=readyStats(),anyR=rs.some(r=>r.v!=null);
  const readyBoard=S.prev?`<div class="sc-card"><div class="sc-card-ttl">⏰ מי היה מוכן ראשון? <small>${E(parshaTitle(S.prev.wk))}</small></div>
    ${anyR?rs.map((r,i)=>`<div class="sc-rt${r.v==null?' none':''}">${ava(r.f,28)}<span class="nm">${E(short(r.f))}</span>
      <span class="tm">${r.v==null?'עוד לא דיווחו':E(fmtReady(r.v))}</span>
      ${r.delta!=null?`<span class="${r.delta>0?'sc-up':r.delta<0?'sc-down':''}">${r.delta>0?'⬆ '+fmtDelta(r.delta):r.delta<0?'⬇ '+fmtDelta(r.delta):'= כמו קודם'}</span>`:''}
      ${r.earliest?'<span class="sc-tag">⏰ הכי מוקדמים</span>':''}${r.improved?'<span class="sc-tag">📈 הכי השתפרו</span>':''}</div>`).join('')
    :`<div class="sc-muted">עוד אף משפחה לא דיווחה. מדווחים מהלשונית "משימות".</div>`}
    <div class="sc-muted" style="margin-top:8px">מוכנים = ${READY_LIST.join(' · ')}</div></div>`:'';
  return title+podium+`<div class="sc-card sc-table">${rows}</div>`+legend+readyBoard+goal+hall;
}
function torahTab(){
  const ids=TORAH.filter(t=>t.txt);
  const blocks=ids.map(t=>{
    const list=players().map(f=>({f,r:(F(f.id).t||{})[t.id]})).filter(x=>x.r&&x.r.txt);
    return `<div class="sc-card"><div class="sc-card-ttl">${t.id==='t1'?'📖 פירושים על הפרשה':t.id==='t2'?'❔ שאלות לשולחן השבת':'🎵 שירים שלמדנו'}</div>
      ${list.length?list.map(x=>`<div class="sc-dt">${ava(x.f,28)}<div><b>משפחת ${E(short(x.f))}</b>${x.r.by?' <small>· '+E(x.r.by)+'</small>':''}<p>${E(x.r.txt)}</p></div></div>`).join('')
      :`<div class="sc-muted">עוד אין — היו הראשונים! (בלשונית משימות ← כל השבוע)</div>`}</div>`;
  }).join('');
  return `<div class="sc-muted" style="text-align:center;margin-bottom:8px">כל מה שהמשפחות כתבו השבוע על ${E(parshaTitle(S.wk))} — לקרוא בשולחן השבת 🕯️</div>${blocks}`;
}

// ── open / close ───────────────────────────────────────────────────────────
// ── background Shabbat songs ──
// Plays while the contest is open (opening it is a tap, so the browser allows
// sound), low and fading in; pauses when the page is hidden or closed. The
// mute choice is remembered per device.
const SONGS=window.CONTEST_SONGS||[{src:'contest-music/lekavod-shabbat.mp3',title:'לכבוד שבת',by:'שמילי אונגר'}];
const VOL=.35;
const M={a:null,i:0,fade:null,told:false};
function muted(){return !!lsGet('scMute',false);}
function musicUI(){
  const b=$('scMusic');if(!b)return;
  const on=!!(M.a&&!M.a.paused);
  b.classList.toggle('playing',on);b.classList.toggle('muted',muted());
  b.querySelector('.ic').textContent=muted()?'🔇':'🔊';
  b.setAttribute('aria-label',muted()?'הפעלת המוזיקה':'השתקת המוזיקה');
  const song=SONGS[M.i];b.title=muted()?'המוזיקה מושתקת':'🎵 '+song.title+(song.by?' — '+song.by:'');
}
function fadeTo(v,ms,done){
  clearInterval(M.fade);const a=M.a;if(!a)return;
  const from=a.volume,t0=Date.now();
  M.fade=setInterval(()=>{const k=Math.min(1,(Date.now()-t0)/ms);a.volume=Math.max(0,Math.min(1,from+(v-from)*k));if(k>=1){clearInterval(M.fade);if(done)done();}},50);
}
function musicPlay(){
  if(muted()||!SONGS.length)return;
  if(!M.a){
    M.a=new Audio();M.a.preload='auto';M.a.volume=0;
    M.a.addEventListener('ended',()=>{M.i=(M.i+1)%SONGS.length;M.a.src=SONGS[M.i].src;M.a.play().catch(()=>{});});
    ['play','pause'].forEach(ev=>M.a.addEventListener(ev,musicUI));
    M.a.src=SONGS[M.i].src;
  }
  if(!M.a.paused)return;
  M.a.volume=0;
  M.a.play().then(()=>{
    fadeTo(VOL,2500);
    if(!M.told){M.told=true;const s=SONGS[M.i];toast('🎵 '+s.title+(s.by?' — '+s.by:'')+' · 🔊 למעלה להשתקה',3500);}
  }).catch(()=>{musicUI();});
}
function musicPause(){if(M.a&&!M.a.paused)fadeTo(0,400,()=>M.a.pause());}
function toggleMusic(){
  if(muted()){lsSet('scMute',false);musicPlay();}
  else{lsSet('scMute',true);musicPause();}
  musicUI();
}
document.addEventListener('visibilitychange',()=>{
  const o=$('contestOverlay');if(!o||!o.classList.contains('open'))return;
  if(document.hidden)musicPause();else musicPlay();
});
function open(){
  const o=ensureOverlay();
  const wk=keyOf(satOf(now()));
  if(S.wk!==wk){S.wk=wk;S.W={};S.day=null;S.asked=false;}
  S.enter=true;
  if(S.fid==null){const saved=lsGet('scFam',null);let me=null;try{me=typeof _myFamId==='function'?_myFamId():null;}catch(e){}
    const f=fam(saved!=null?saved:me);S.fid=f?(f.subFamily&&f.parentFamilyId!=null?f.parentFamilyId:f.id):null;}
  o.classList.add('open');document.body.style.overflow='hidden';
  if(typeof _setHash==='function')_setHash('contest');
  render();subscribe();
  musicPlay();
  // If the browser refused (no tap yet), start on the first tap inside.
  o.addEventListener('pointerdown',()=>{if(o.classList.contains('open'))musicPlay();},{once:true});
  clearInterval(S.tick);
  const wasLocked=locked();
  S.tick=setInterval(()=>{
    if(keyOf(satOf(now()))!==S.wk){open();return;}
    if(!wasLocked&&locked()){S.tab='board';confetti(80);}
    render();
  },30000);
  if(wasLocked&&!lsGet('scSeen_'+wk,false)){lsSet('scSeen_'+wk,true);S.tab='board';render();setTimeout(()=>confetti(80),300);}
}
function close(){
  const o=$('contestOverlay');if(o)o.classList.remove('open');
  document.body.style.overflow='';clearInterval(S.tick);stopSync();musicPause();
  if(typeof _clearHash==='function')_clearHash('contest');
}
window.openContestOverlay=open;
window.closeContestOverlay=close;
window.contestUI={setTab,pickDay,toggleTask,saveTxt,setFam,answer,toggleBingo,spin,addCustom,delCustom,toggleHelp,toggleFamDetail,switchToggle,readHalacha,cheer,toggleSide,pickHal,askReady,askCheck,askDay,closeAsk,saveReady,toggleMusic};
})();
