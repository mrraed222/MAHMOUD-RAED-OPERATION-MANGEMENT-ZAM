# 🚀 ابدأ من هنا — التقرير الأسبوعي في نظام زام

**التاريخ:** 26 / 10 / 2026 &nbsp;·&nbsp; **الموعد:** التقرير الأول يوم الخميس 29 / 10 / 2026

---

## 📌 ملخص سريع: إيه اللي في الحزمة

| الملف | إيه بتعمله |
|---|---|
| `INSTALL.ps1` | تنسخ صفحة التقرير الأسبوعي داخل مشروع نظام زام + تضيفها للقائمة + تصلّح باج `zamClient` |
| `README-INSTALL.md` | **الدليل الكامل خطوة بخطوة** (اقرأه قبل ما تبدأ) |
| `weekly-report/index.html` | الصفحة نفسها (تنسخها جوه المشروع) |
| `assets/weekly-report-core.js` | محرك الداشبورد (فلاتر + رسوم + تبويبات + drill-down) |
| `apps-script-supabase-sync.js` | كود المزامنة — **تلصقه في Google Apps Script** |
| `supabase-sync-schema.sql` | SQL لمرة واحدة (أعمدة `sheet_key` + فهارس) |
| `supabase-v2-schema.sql` | SQL لمرة واحدة (**الجداول الجديدة + دوال الحفظ**) — ضروري للمحاور 1-6 |
| `standalone/` | النسخة المستقلة (بدون النظام) + قالب Word — للاستخدام الاختياري |
| `preview-integrated.png` | صورة الشكل النهائي بعد الدمج |

---

## ⚡ الترتيب — 5 خطوات

### ① تثبيت الصفحة (PowerShell)
```powershell
cd <مجلد الحزمة>
.\INSTALL.ps1 -RepoPath "C:\path\to\MAHMOUD-RAED-OPERATION-MANGEMENT-ZAM"
```
> بيضيف الصفحة، ويضيف عنصر «التقرير الأسبوعي» للقائمة، **ويصلّح باج `zamClient`**، ويعمل commit/push.

### ② SQL في Supabase (مرة واحدة)
**Supabase → SQL Editor** → الصق الملفين بالترتيب → **Run**:
1. `supabase-sync-schema.sql`
2. `supabase-v2-schema.sql` ← **مهم**

الملف التاني بيضيف:
| العنصر | الغرض |
|---|---|
| `supervisory_visits` | محور 2 — نتائج الزيارات الإشرافية |
| `attendance_records` | محور 5 — الحضور والغياب |
| `weekly_plans` | محور 6 — خطة الأسبوع القادم والاعتماد |
| `weekly_report_notes` | حفظ السبب/الإجراء/المسؤول/الموعد (عبر RPC) |
| حقول `waste_logs` الجديدة | السبب الجذري، الإجراء التصحيحي، التكلفة، `sheet_key` |
| حقول `negative_reviews` الجديدة | الحالة، المسؤول، الإجراء، تقييم العميل، تاريخ الإغلاق |
| `daily_reports.sheet_key` | مفتاح منع التكرار في التقارير |
| دوال `save_weekly_note` / `save_weekly_plan` / `approve_weekly_plan` | حفظ واعتماد الخطة بأمان |

### ③ تفعيل المزامنة (مرة واحدة)
1. **Supabase → Settings → API** → انسخ مفتاح **`service_role`**
2. **Apps Script → Project Settings → Script Properties** → أضف 3 مفاتيح:

| Property | Value |
|---|---|
| `SUPABASE_URL` | `https://uuphgpncmiwyigtqhjmd.supabase.co` |
| `SUPABASE_SERVICE_KEY` | مفتاح `service_role` |
| `SYNC_TOKEN` | أي نص عشوائي طويل (مثال: `zam-wr-9f3a7c...`) |

> لتوليد مفتاح عشوائي: شغّل `printSyncToken()` من محرر Apps Script، أو اكتب نصاً من 32 حرفاً.

3. **Apps Script** → الصق `apps-script-supabase-sync.js` في **ملف جديد** (**لا تلصق فوق `doPost`**)
4. **Deploy → New version** → Execute as: **Me** · Who has access: **Anyone**

> لا تضع `SYNC_TOKEN` في `weekly-report/index.html` أو أي ملف يصل إلى المتصفح؛
> يبقى داخل Script Properties فقط.

### ④ تشغيل المزامنة — 4 طرق
| # | الطريقة | متى |
|---|---|---|
| A | `runSyncNow()` من محرر Apps Script | أسرع طريقة للتشغيل الأول |
| B | المشغل اليومي `installDailySync()` | التشغيل التلقائي |
| C | `installDailySync()` مرة واحدة | مزامنة يومية تلقائية 06:00 |
| D | `syncToSupabase()` في آخر `doPost` | مزامنة فورية مع كل تسجيل شفت |

### ⑤ تحقّق سريع
افتح صفحة التقرير وتأكد من:

| الفحص | المتوقع |
|---|---|
| الشريط الجانبي | «التقرير الأسبوعي» ظاهر |
| كورة حالة المصدر | «مباشر من Supabase (نظام زام)» |
| شرائح الفروع | **6 فروع حقيقية** مقروءة من جدول `branches` (ديناميكي) |
| التبويبات | 6 تبويبات مطابقة لمحاور التوجيه الإداري |
| زر «مزامنة الآن» | «تمت المزامنة — N سجل» |
| جدول `daily_reports` | عدد أكبر من صفر |
| الترويسة | `operations@zam.sa` · `0563505653` |

---

## 🔴 باج مهم لازم يتصلّح

سطر واحد في `assets/supabase-config.js`:
```js
// قبل
const zamClient = window.supabase || supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// بعد
const zamClient = (window.supabase && typeof window.supabase.from === 'function')
    ? window.supabase
    : supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```
**السبب:** `window.supabase` من الـ CDN هي **المكتبة** مش **العميل** → `zamClient.from()` مش موجودة
→ كل استعلام في النظام يفشل بصمت. الـ `INSTALL.ps1` بيصلّحه تلقائياً، بس **راجعه** بعد التثبيت.

---

## 🔐 تحذير أمني

| المفتاح | مكانه |
|---|---|
| `service_role` | **Script Properties فقط** — لا في HTML ولا في الداشبورد |
| `SYNC_TOKEN` | **Script Properties فقط** — لا يُرسل إلى المتصفح |

**لا ترسل `service_role` لأي حد.** الـ endpoint المنشور «Anyone» بيقرأ فقط لما يكون المفتاح غلط.

---

## 🗓️ خطة الأسابيع

| المرحلة | إيه | لما |
|---|---|---|
| **1** ✅ جاهزة | الصفحة داخل النظام + المزامنة + الجداول الجديدة | **قبل 29/10** |
| **2** | نموذج الشفت يقرأ `checklist_templates` (19 مهمة) بدل الـ 6 الثابتة | بعد 29/10 |
| **3** | إرسال التقرير بالإيميل للإدارة كل خميس أوتوماتيك | بعد 29/10 |
| **4** | إيقاف الشيت نهائياً | بعد استقرار المرحلة 2 |

**نموذج تسجيل الشفت (`zam-end-shift-log`) يفضل زي ما هو لحد يوم الخميس** — المزامنة تنقله
للداتابيز في الخلفية من غير ما تكسر شيئ.


