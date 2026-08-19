# خطة معالجة أمان Supabase

## نطاق هذه الخطة

هذه الخطة تستند إلى مراجعة قراءة فقط لجداول `daily_reports` و`waste_logs` و`shift_issues` و`negative_reviews`، وإلى تحذيرات المراجع الأمني في Supabase بتاريخ 2026-08-19. لا ينفذ هذا المستند أي تغيير في قاعدة البيانات أو Auth أو Storage.

## الأولويات

| الأولوية | الإجراء المقترح | سبب الأولوية | أثره المتوقع |
|---|---|---|---|
| P0 | سحب `EXECUTE` من دور `anon` للدوال المساعدة التي لا تحتاج الوصول العام | خمس دوال `SECURITY DEFINER` قابلة للاستدعاء قبل تسجيل الدخول | تقليل سطح API العام فوراً |
| P0 | مراجعة وعزل `rls_auto_enable()` و`prevent_profile_privilege_escalation()` | لا ينبغي أن تكون الدوال الإدارية أو دوال trigger متاحة عبر RPC عام | منع استدعاءات إدارية غير لازمة |
| P1 | تقييد عمليات Supervisor في الهدر والمشاكل والمراجعات بفرعه فقط | السياسة الحالية تمنح الدور التشغيلي وصولاً إلى جميع الفروع | فصل بيانات الفروع ومنع التعديل العرضي أو المتعمد عبر الفروع |
| P1 | الإبقاء على المالك بوصول قراءة فقط | يتوافق مع نموذج المتابعة والإدارة دون تنفيذ تشغيلي | تقليل خطر التعديل غير المقصود من حساب المالك |
| P2 | تفعيل حماية كلمات المرور المسرّبة في Supabase Auth | الإعداد معطّل حالياً | منع استخدام كلمات المرور المعروفة بأنها مخترقة |
| P2 | تنفيذ اختبار صلاحيات قبل وبعد كل migration | سياسات RLS قد تتأثر بتغييرات الدوال أو الجداول | منع كسر التطبيق أو فتح صلاحيات غير مقصودة |

## تنفيذ مقترح على مراحل

### المرحلة الأولى: تقليل الوصول العام إلى الدوال

يجب تحديد الدوال التي تستخدمها سياسات RLS فعلياً، ثم تطبيق أقل صلاحية لازمة لكل منها. دوال الدور والفرع قد تحتاج التنفيذ من `authenticated` كي تعمل سياسات RLS، لكن لا تحتاج عادةً إلى `anon`. أما دالة `rls_auto_enable()` ودالة trigger لمنع تصعيد الصلاحيات فلا يجب عرضهما كـ RPC عام؛ يمكن سحب صلاحية التنفيذ منهما من `anon` و`authenticated` أو نقلهما إلى schema غير مكشوفة حسب طريقة الاستخدام.

> لا ينبغي سحب صلاحية `authenticated` من دالة تعتمد عليها سياسة RLS قبل اختبارها، لأن ذلك قد يمنع التطبيق من قراءة بياناته المشروعة.

### المرحلة الثانية: عزل بيانات الفروع

تستبدل سياسة `Operational roles manage waste` والسياسات المكافئة لها بسياسات منفصلة. يسمح Admin وManager بإدارة السجلات حسب الصلاحيات المعتمدة، بينما يمر Supervisor بفحص يربط `report_id` بسجل `daily_reports` ويقارن `branch_id` بفرع المستخدم الحالي. يجب تطبيق هذا الفحص في `USING` و`WITH CHECK` معاً، حتى لا يستطيع Supervisor تعديل سجل موجود أو إدراج سجل مرتبط بفرع مختلف.

### المرحلة الثالثة: حماية الهوية والتأكد

يُفعّل خيار **Leaked Password Protection** في Supabase Auth. ثم تجرى اختبارات حسابات تمثل Owner وAdmin وManager وSupervisor وموظفاً عادياً وanon، تشمل القراءة والإدراج والتعديل والحذف في جداول التقارير والهدر والمشاكل والمراجعات.

## معايير قبول التغيير

| السيناريو | النتيجة المطلوبة |
|---|---|
| Owner يقرأ تقريراً أو هدراً | مسموح |
| Owner يدرج أو يعدل أو يحذف | مرفوض |
| Supervisor يقرأ أو يكتب في فرعه | مسموح وفق قواعد التقرير |
| Supervisor يحاول قراءة أو تعديل سجل فرع آخر | مرفوض |
| `anon` يستدعي دالة إدارية أو دالة trigger | مرفوض |
| Admin وManager ينفذان مهام الإدارة المعتمدة | مسموح |
| المستخدم بكلمة مرور مسرّبة | مرفوض عند ضبط Auth |

## المراجع

[1]: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable "Supabase: Public execution of SECURITY DEFINER functions"
[2]: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable "Supabase: Authenticated execution of SECURITY DEFINER functions"
[3]: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection "Supabase: Leaked password protection"
