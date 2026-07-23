# دليل إنشاء قاعدة بيانات "زام" (ZAM Operations) باستخدام Supabase

هذا المستند يوضح الهيكلية التقنية المطلوبة لربط شاشات نظام "زام" بقاعدة بيانات حقيقية لضمان حفظ البيانات، إدارة الصلاحيات، وتفعيل التنبيهات الذكية.

## 1. جداول قاعدة البيانات (Database Tables)

قمت بتصميم الجداول التالية لتغطي كافة احتياجات النظام:

### أ. جدول الفروع (`branches`)
يخزن بيانات الفروع الستة.
- `id`: (UUID) مفتاح فريد.
- `name`: اسم الفرع (زام 1، زام 2...).
- `location`: رابط الموقع أو العنوان.
- `manager_id`: مدير الفرع المرتبط.

### ب. جدول الموظفين (`profiles`)
يخزن بيانات الموظفين وصلاحياتهم.
- `id`: مرتبط بنظام الـ Auth في Supabase.
- `full_name`: الاسم الكامل.
- `email`: البريد الإلكتروني.
- `whatsapp`: رقم الواتساب.
- `role`: المسمى الوظيفي (Barista, Supervisor, Manager).
- `passcode`: الرمز السري (4-6 أرقام).
- `branch_id`: الفرع الذي يعمل فيه الموظف.
- `avatar_url`: رابط الصورة الشخصية.

### ج. جدول قوائم المهام (`checklists`)
يخزن المهام اليومية وحالة تنفيذها.
- `id`: مفتاح فريد.
- `task_name`: اسم المهمة.
- `category`: فئة المهمة (المطبخ، البار، الصالة).
- `status`: الحالة (Pending, Completed, Flagged).
- `assigned_to`: الموظف المسؤول.
- `evidence_url`: رابط الصورة المرفقة كدليل على التنفيذ.
- `created_at`: وقت الإنشاء.
- `completed_at`: وقت الإنجاز الفعلي.

### د. جدول التنبيهات والأتمتة (`automations`)
يخزن إعدادات التنبيهات التي قمنا بتصميمها.
- `id`: مفتاح فريد.
- `trigger_condition`: الشرط (مثلاً: تأخر تسجيل الدخول).
- `channel`: قناة الإرسال (WhatsApp, Email, Push).
- `message_template`: نص الرسالة.
- `is_active`: حالة التفعيل.

---

## 2. خطوات الربط البرمجي (Implementation Guide)

للربط بين شاشات الـ HTML وقاعدة البيانات، اتبع الخطوات التالية:

### الخطوة 1: إضافة مكتبة Supabase
في كل ملف HTML، أضف السطر التالي قبل نهاية وسم `</body>`:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

### الخطوة 2: تهيئة الاتصال
أنشئ ملف `supabase.js` وضع فيه بيانات مشروعك من لوحة تحكم Supabase:
```javascript
const supabaseUrl = 'YOUR_SUPABASE_URL';
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';
const supabase = supabase.createClient(supabaseUrl, supabaseKey);
```

### الخطوة 3: مثال لعملية تسجيل الدخول بالباسكود
في صفحة `login/code.html`:
```javascript
async function handleLogin(passcode) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('passcode', passcode)
    .single();

  if (data) {
    window.location.href = '../SCREEN_12/code.html'; // التوجه للوحة التحكم
  } else {
    alert('الرمز السري غير صحيح');
  }
}
```

---

## 3. ميزات متقدمة (Advanced Features)

1. **الصور (Supabase Storage):** عند إرفاق صورة في التشيك ليست، يتم رفعها إلى "Bucket" في Supabase، ويتم تخزين الرابط فقط في جدول `checklists`.
2. **التحديثات اللحظية (Real-time):** لوحة التحكم ستحدث الإحصائيات تلقائياً بمجرد أن يقوم موظف في أي فرع بإنهاء مهمة، دون الحاجة لإعادة تحميل الصفحة.
3. **الأمن (RLS):** تفعيل Row Level Security يضمن أن الموظف لا يمكنه رؤية بيانات الرواتب أو إعدادات النظام الحساسة.

هذا المخطط جاهز للتطبيق فور إنشائك للمشروع على Supabase. هل تود أن أقوم بتعديل أي شاشة محددة لتشمل أكواد الربط الأولية؟