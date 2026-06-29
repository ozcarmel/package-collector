# חבילות להב

אפליקציית PWA לניהול איסוף ומסירת חבילות בקיבוץ להב.

## הרצה מקומית

```powershell
npm install
npm run dev
```

האפליקציה תרוץ כברירת מחדל על `http://localhost:3000`.

## מצב נוכחי

- Next.js App Router
- React + TypeScript
- UI מובייל RTL בעברית
- מצב demo עם `localStorage`
- מבנה נתונים התואם Firebase
- קבצי `firestore.rules` ו-`storage.rules` ראשוניים

## חיבור Firebase

1. צרו פרויקט Firebase.
2. הפעילו Phone Authentication.
3. צרו Firestore ו-Storage.
4. העתיקו `.env.example` אל `.env.local`.
5. מלאו את משתני `NEXT_PUBLIC_FIREBASE_*`.
6. פרסו את חוקי Firestore/Storage.

בשלב הבא נחליף את שכבת ה-demo repository בקריאות Firestore אמיתיות ו-Cloud Functions לפרטים מוגנים.
