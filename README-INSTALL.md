# التقرير الأسبوعي — داخل نظام زام للعمليات

حزمة تضيف صفحة **«التقرير الأسبوعي»** إلى مشروع نظام زام، وتربط **Google Sheet ← → Supabase**
عبر Google Apps Script، مع زر **«مزامنة الآن»** داخل الصفحة.

الصفحة مبنية على **محاور التوجيه الإداري الستة** (22/10/2026):
أداء الفروع والمبيعات · الرقابة التشغيلية · شكاوى العملاء · الهدر والمخزون · الموظفون والمعدات · خطة الأسبوع القادم.

---

## 1) تثبيت الصفحة داخل المشروع (5 دقائق)

```powershell
# افتح PowerShell في مجلد هذه الحزمة
cd <مجلد الحزمة>

# شغّل السكربت مع مسار المستودع عندك
.\INSTALL.ps1 -RepoPath "C:\path\to\MAHMOUD-RAED-OPERATION-MANGEMENT-ZAM"
```

السكربت بيعمل 3 حاجات:

| # | إيه | النتيجة |
|---|---|---|
| 1 | ينسخ `weekly-report\index.html` | مجلد جديد في جذر المشروع |
| 2 | ينسخ `assets\weekly-report-core.js` | محرك الداشبورد (مشترك) |
| 3 | يضيف سطر واحد في `assets\supabase-config.js` | عنصر القائمة «التقرير الأسبوعي» + **إصلاح `zamClient`** |

> `-NoPush` لو تبي تنسخ بس بدون commit/push.

### ⚠️ إصلاح `zamClient` (مهم)
السكربت بيصلّح السطر ده في `assets/supabase-config.js`:

```js
// قبل
const zamClient = window.supabase || supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// بعد
const zamClient = (window.supabase && typeof window.supabase.from === 'function')
    ? window.supabase
    : supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

**السبب:** المكتبة المحمّلة من الـ CDN (`window.supabase`) هي **المكتبة نفسها** وليست عميلاً
متصلاً — فـ `zamClient.from()` مش موجودة، وكل استعلام في النظام يفشل بصمت.

**ملاحظة:** لو المستودع عندك مختلف عن الحزمة دي، جرّب السطر بعد التعديل من الـ console:
```js
console.log(typeof window.supabase?.from);   // لازم يطلع 'function'
```

---

## 2) SQL في Supabase (مرة واحدة — ترتيب مهم)

**Supabase Dashboard → SQL Editor** → الصق الملفات بالترتيب ده:

### 2أ) `supabase-sync-schema.sql`
أعمدة `sheet_key` و `issue_type` + الفهارس اللي تمنع تكرار البيانات.

### 2ب) `supabase-v2-schema.sql` ← **مهم جداً**
بيضيف الجداول والحقول اللي محاور التوجيه محتاجاها:

| الجدول / العنصر | المحور |
|---|---|
| `supervisory_visits` (فرع، تاريخ، مشرف، تقييم، ملاحظة، إجراء، مسؤول، موعد، حالة) | 2 — الرقابة التشغيلية |
| `attendance_records` (فرع، تاريخ، موظف، شفت، حالة، ملاحظات) | 5 — الموظفون |
| `weekly_plans` (هدف، مؤشر، فرع، مسؤول، موعد، حالة، اعتماد) | 6 — خطة الأسبوع القادم |
| `weekly_report_notes` (مفتاح التقرير + الحقل + النص) | كل المحاور — الحقول اليدوية |
| `waste_logs` + `root_cause`, `corrective_action`, `owner`, `unit_cost`, `sheet_key` | 4 — الهدر |
| `negative_reviews` + `status`, `owner`, `action_taken`, `customer_rating`, `closed_at` | 3 — الشكاوى |
| `daily_reports.sheet_key` | كل التقارير |

وبيضيف 3 دوال:
- `save_weekly_note(...)` — حفظ السبب/الإجراء/المسؤول/الموعد
- `save_weekly_plan(...)` — حفظ هدف الأسبوع القادم
- `approve_weekly_plan(...)` — اعتماد الخطة (تسجّل المعتمد والتاريخ)

> الملف آمن للتشغيل مرتين (كله `if not exists`).

---

## 3) تفعيل القراءة والكتابة (المزامنة) — مرة واحدة

### 3أ) مفاتيح Supabase (سري)
**Supabase Dashboard → Project Settings → API** → انسخ مفتاح **`service_role`** (اللي مكتوب تحته service_role — **مش** الـ anon)

**Apps Script → Project Settings → Script Properties** وأضف:

| Property | Value |
|---|---|
| `SUPABASE_URL` | `https://uuphgpncmiwyigtqhjmd.supabase.co` |
| `SUPABASE_SERVICE_KEY` | مفتاح `service_role` |
| `SYNC_TOKEN` | نص عشوائي طويل (32 حرفاً على الأقل) |

> **مهم:** مفتاح `service_role` سري تماماً. لازم يكون في Script Properties فقط —
> **لا تحطه في أي ملف HTML ولا في الداشبورد ولا ترسله لأي حد.**

### 3ب) إضافة كود المزامنة في Apps Script
1. افتح **Google Apps Script** الخاص بشيت زام (من داخل الشيت: «تطبيقات Google Apps Script»)
2. الصق محتوى ملف **`apps-script-supabase-sync.js`** في **ملف جديد** (لا تلصق فوق `doPost`)
3. احفظ

> `doGet` و `syncToSupabase()` و `runSyncNow()` و `installDailySync()` و `diagnose()` و `printSyncToken()`
> — كلها جوّه نفس الملف.
> **`doPost` الأصلي ما يتلمسش** — نموذج تسجيل الشفت بيعتمد عليه.

### 3ج) النشر
**Deploy → New version →**
- Execute as: **Me**
- Who has access: **Anyone**

> طلبات القراءة العامة معطّلة لأن بيانات التقرير حساسة.
> التشغيل `?action=sync` **محمي بمفتاح `SYNC_TOKEN`** + فترة تبريد 60 ثانية.
> لو حد نادا الرابط من غير مفتاح: بيرجع `BAD_TOKEN` ومفيش أي كتابة.

### 3د) مفتاح المزامنة يبقى داخل Apps Script فقط
ضع `SYNC_TOKEN` في **Script Properties** فقط. لا تضعه في `index.html` أو أي ملف
يُرسل للمتصفح؛ الصفحة لا تشغّل المزامنة يدوياً.

---

## 4) إزاي تشغّل المزامنة فعلياً؟ (4 طرق)

### الطريقة A — تشغيل داخلي من Apps Script ✅
شغّل `runSyncNow()` من محرر Apps Script أو فعّل المشغل اليومي. بعد نجاحه افتح
التقرير واضغط «تحديث»؛ لا يوجد زر مزامنة أو مفتاح داخل الصفحة.

### الطريقة B — من محرر Apps Script (أول مرة / تشخيص)
1. Apps Script → اختر دالة **`runSyncNow`** → **Run**
2. اضغط **«سجل التنفيذ» (Executions)** → شوف `startedAt` و `inserted` و `children`
3. لو فيه `errors` في الـ Log → انسخه وحلّه

### الطريقة C — تلقائي كل يوم (مستحسن)
شغّل دالة **`installDailySync`** مرة واحدة → مزامنة يومية الساعة **06:00**.

### الطريقة D — مزامنة فورية مع كل شفت
أضف السطر ده في آخر `doPost`:
```js
syncToSupabase();
```

### تشخيص سريع
شغّل **`diagnose()`** من محرر Apps Script → بيطبع حالة الإعدادات والقراءة من الشيت.

---

## 5) تغيير الـ 6 نقاط في نموذج الشفت (بعد أول تقرير)

**اقتراح:** قبل ما تغيّر الـ 6 نقاط، خلّي المزامنة تشتغل الأول واشوف البيانات
تتنزل صح، بعدين نعدّل نموذج الشفت (اللي قلت إنه يفضل زي ما هو لحد الخميس).

**عشان تغيير الـ 6 نقاط يبقى دائم:**
1. أضف عمود `show_in_shift_report` لـ `checklist_templates`:
```sql
alter table checklist_templates
  add column if not exists show_in_shift_report boolean default false;
```
2. في نموذج الشفت: ارسم القائمة ديناميكياً من الداتابيز بدل الـ 6 checkbox الثابتة
3. كل بند يُنفّذ يكتب سطر في `checklist_logs` (القيد الفريد
   `unique (template_id, execution_date, branch_id)` موجود أصلاً في schemas — يمنع التكرار)
4. نسبة الالتزام في التقرير الأسبوعي تتحسب: **منفّذ ÷ مستحق** (مش 6/6)
   — والدالة `complianceByTemplate()` في المحرك بتعملها من `checklist_templates` + `checklist_logs`

---

## 6) التحقق إن كل حاجة شغالة

| الفحص | المتوقع |
|---|---|
| الصفحة تفتح | الشريط الجانبي + «التقرير الأسبوعي» في القائمة |
| حالة المصدر (كورة فوق) | «مباشر من Supabase (نظام زام)» |
| شرائح الفروع | 6 فروع حقيقية (تُقرأ من جدول `branches`) |
| المزامنة | تُشغّل من `runSyncNow()` أو المشغل اليومي داخل Apps Script |
| `daily_reports` في Supabase | عدد أكبر من 0 |
| الحقول اليدوية | بتتحفظ في `weekly_report_notes` بعد تنفيذ SQL v2 |
| الترويسة | `operations@zam.sa` · `0563505653` |

---

## 7) ملاحظات

- **صلاحيات الصفحة:** `Owner` فقط. أي دور آخر يتحوّل لصفحته الرئيسية.
- **مصدر الصفحة:** Supabase فقط؛ لا تحتوي الصفحة على رابط Google Sheet أو endpoint للمزامنة.
- **التصدير PDF:** زر «تصدير PDF» في الصفحة يطبع A4 بتخطيط مخصص.
- **الحقول اليدوية** (السبب/الإجراء/المسؤول/الموعد) بتتحفظ في `weekly_report_notes`
  عبر دالة `save_weekly_note`، وبيبقى في **localStorage** كاحتياطي لو القاعدة مش متاحة.
- **الفروع والتشيك ليست ديناميكيين:** الفروع من `branches`، والمهام من `checklist_templates`
  + `checklist_logs` — مش قوائم ثابتة.
- **الملفات:**
  - `weekly-report/index.html` — الصفحة
  - `assets/weekly-report-core.js` — المحرك (فلاتر، رسوم SVG، تبويبات، تجميع، drill-down)
  - `apps-script-supabase-sync.js` — المزامنة (تلصقه في Apps Script)
  - `supabase-sync-schema.sql` — أعمدة `sheet_key` + الفهارس (مرة واحدة)
  - `supabase-v2-schema.sql` — الجداول الجديدة + الحقول + دوال الحفظ (مرة واحدة)
  - `standalone/` — النسخة المستقلة + قالب Word


