# תשלומים משפחתיים (yoo)

אפליקציית ווב חד-עמודית (Single Page) לניהול הוצאות ותשלומים בין משפחות - אירועים משותפים, חלוקת עלויות, מעקב חובות וקופה משותפת. הנתונים נשמרים ב-Firebase Firestore.

## הרצה מקומית

האפליקציה היא קובץ `index.html` יחיד, ללא תהליך build. אפשר לפתוח אותו ישירות בדפדפן, או להריץ שרת סטטי פשוט:

```bash
npx serve .
```

## הגדרת Firebase (חובה)

1. גש ל-[Firebase Console](https://console.firebase.google.com) וצור פרויקט חדש (חינמי).
2. בתפריט הצד: **Build → Firestore Database → Create database**. אפשר להתחיל ב-production mode (החוקים יוגדרו בשלב הבא).
3. **Project settings → General → Your apps → Add app → Web** (סימן `</>`), תן לאפליקציה שם, וקבל אובייקט `firebaseConfig`.
4. פתח את `index.html` וחפש את הבלוק:
   ```js
   const firebaseConfig = {
     apiKey: "YOUR_API_KEY",
     authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
     projectId: "YOUR_PROJECT_ID",
     storageBucket: "YOUR_PROJECT_ID.appspot.com",
     messagingSenderId: "YOUR_SENDER_ID",
     appId: "YOUR_APP_ID"
   };
   ```
   והחלף את הערכים בערכים שקיבלת מ-Firebase.
5. שמור, פתח את `index.html` בדפדפן - האפליקציה תתחבר ל-Firestore ותתחיל לשמור נתונים במסמך `appData/familyPayments`.

## ⚠️ הגדרת אבטחה ב-Firebase (חשוב!)

מפתח ה-API של Firebase מוגדר בקוד (`firebaseConfig` ב-`index.html`). זה תקין ומקובל עבור אפליקציות צד-לקוח - **אבל** האבטחה האמיתית של הנתונים נקבעת ע"י **Firestore Security Rules**, שמוגדרים בקונסולת Firebase ולא בקוד הזה.

כדאי לוודא בקונסולת Firebase (Firestore Database → Rules) שהחוקים אינם פתוחים לכל (`allow read, write: if true`), כדי שלא כל מי שיש לו את הקישור לאתר יוכל לקרוא או לשנות את הנתונים הפיננסיים. מומלץ להגדיר אימות משתמשים (Firebase Authentication) ולהגביל גישה למשתמשים מאומתים בלבד, לדוגמה:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /appData/{docId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## תכונות

- **אירועים**: יצירת אירוע משותף, חלוקת עלות שווה או הזנת תשלום בנפרד לכל משפחה
- **איזון**: חישוב אוטומטי של העברות הנדרשות בין משפחות, וסימון תשלום ישיר/מהקופה
- **ארכיון**: היסטוריית אירועים שנסגרו, מסונן לפי שנה
- **חובות**: תצוגת חובות פתוחים לכל משפחה
- **קופה משותפת**: הפקדות, משיכות והיסטוריית תנועות
- **PWA**: ניתן להוסיף למסך הבית במובייל

---

# מנגל בלהבות - ניהול עסק מנגלים לאירועים

האפליקציה עברה לריפו נפרד: **[0504131240/mangal](https://github.com/0504131240/mangal)**.
