(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZamChecklistSave = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VALID_SHIFTS = new Set(['Morning', 'Evening']);
  const VALID_PROFILE_SHIFTS = new Set(['Morning', 'Evening', 'Both']);
  const ELIGIBILITY_RPC = 'can_employee_execute_checklist_template';

  function scopedError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function normalizeError(error) {
    if (error instanceof Error) return error;
    const wrapped = new Error(String(error ?? 'Unknown error'));
    if (error && typeof error === 'object' && error.code) wrapped.code = error.code;
    return wrapped;
  }

  async function getLiveProfile(client, expectedProfile) {
    if (!client?.auth?.getUser) {
      throw scopedError('ZAM_AUTH_SESSION_INVALID', 'تعذر التحقق من جلسة الدخول الحالية.');
    }
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError) throw authError;
    const authUser = authData?.user;
    if (!authUser?.id) {
      throw scopedError('ZAM_AUTH_SESSION_INVALID', 'انتهت جلسة الدخول؛ سجّل الدخول من جديد.');
    }
    if (expectedProfile?.id && String(expectedProfile.id) !== String(authUser.id)) {
      throw scopedError('ZAM_AUTH_PROFILE_MISMATCH', 'لا يطابق ملف المستخدم جلسة الدخول الحالية.');
    }

    const { data: profile, error: profileError } = await client.from('profiles')
      .select('id,role,status,branch_id,shift_type')
      .eq('id', authUser.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || String(profile.id) !== String(authUser.id)) {
      throw scopedError('ZAM_AUTH_PROFILE_MISMATCH', 'تعذر تحميل ملف المستخدم المرتبط بجلسة الدخول.');
    }
    if (profile.status !== 'active') {
      throw scopedError('ZAM_PROFILE_INACTIVE', 'ملف المستخدم غير نشط؛ لم يتم رفع صورة أو حفظ سجل.');
    }
    if (!profile.branch_id) {
      throw scopedError('ZAM_BRANCH_SCOPE_MISSING', 'لا يوجد فرع محدد في ملف المستخدم الحالي.');
    }
    if (!VALID_PROFILE_SHIFTS.has(profile.shift_type)) {
      throw scopedError('ZAM_SHIFT_SCOPE_MISSING', 'لا توجد وردية صالحة محددة في ملف المستخدم الحالي.');
    }
    return { authUser, profile };
  }

  async function canExecuteTemplate(client, profile, templateId, shiftType) {
    if (!VALID_SHIFTS.has(shiftType)) {
      throw scopedError('ZAM_SHIFT_SCOPE_MISMATCH', 'اختر الوردية الصباحية أو المسائية.');
    }
    if (profile?.shift_type !== 'Both' && profile?.shift_type !== shiftType) {
      throw scopedError('ZAM_SHIFT_SCOPE_MISMATCH', 'الوردية المحددة لا تطابق الوردية المعيّنة لحسابك. لم يتم رفع الصورة أو حفظ السجل.');
    }
    if (!profile?.branch_id) {
      throw scopedError('ZAM_BRANCH_SCOPE_MISSING', 'لا يوجد فرع محدد في ملف المستخدم الحالي.');
    }
    const { data, error } = await client.rpc(ELIGIBILITY_RPC, {
      p_template_id: templateId,
      p_branch_id: profile.branch_id,
      p_shift_type: shiftType,
    });
    if (error) throw error;
    if (data !== true) {
      throw scopedError('CHECKLIST_EXECUTION_SCOPE_DENIED', 'هذه المهمة ليست مؤهلة لحسابك في الفرع والوردية الحالية، أو أن تكليفها غير نشط. لم يتم رفع الصورة أو حفظ السجل.');
    }
    return true;
  }

  async function filterEligibleTemplates({ client, profile, templates = [], shiftType }) {
    const checks = await Promise.all((templates || []).map(async template => {
      try {
        await canExecuteTemplate(client, profile, template.id, shiftType);
        return { template, allowed: true };
      } catch (error) {
        if (error?.code === 'CHECKLIST_EXECUTION_SCOPE_DENIED') return { template, allowed: false };
        throw error;
      }
    }));
    return checks.filter(result => result.allowed).map(result => result.template);
  }

  async function submitChecklistExecution({
    client,
    sessionProfile,
    templateId,
    shiftType,
    resolveShiftType,
    onProfile,
    notes = null,
    photoFile = null,
    uploadEvidence,
    saveLog,
  }) {
    const { authUser, profile } = await getLiveProfile(client, sessionProfile);
    if (typeof onProfile === 'function') await onProfile(profile);
    const selectedShift = typeof resolveShiftType === 'function' ? resolveShiftType(profile) : shiftType;
    await canExecuteTemplate(client, profile, templateId, selectedShift);

    let evidence = null;
    if (photoFile) {
      if (typeof uploadEvidence !== 'function') {
        throw scopedError('ZAM_EVIDENCE_UPLOAD_UNAVAILABLE', 'رفع صورة الإثبات غير متاح.');
      }
      try {
        evidence = await uploadEvidence(photoFile, authUser.id);
      } catch (error) {
        const failure = normalizeError(error);
        failure.checklistEvidenceUploadFailed = true;
        throw failure;
      }
      if (!evidence?.url) {
        const failure = scopedError('ZAM_EVIDENCE_UPLOAD_FAILED', 'لم يُرجع رفع صورة الإثبات رابطًا صالحًا.');
        failure.checklistEvidenceUploadFailed = true;
        throw failure;
      }
    }
    if (typeof saveLog !== 'function') {
      throw scopedError('ZAM_CHECKLIST_SAVE_UNAVAILABLE', 'حفظ سجل التنفيذ غير متاح.');
    }

    const payload = {
      template_id: templateId,
      branch_id: profile.branch_id,
      executed_by: authUser.id,
      status: 'Completed',
      notes: String(notes ?? '').trim() || null,
      shift_type: selectedShift,
    };
    if (evidence) payload.photo_url = evidence.url;

    try {
      const result = await saveLog(payload);
      return { result, profile, payload, evidence };
    } catch (error) {
      const failure = normalizeError(error);
      if (evidence) {
        failure.checklistEvidenceUploaded = true;
        failure.checklistEvidencePath = evidence.path || null;
      }
      throw failure;
    }
  }

  return Object.freeze({
    getLiveProfile,
    canExecuteTemplate,
    filterEligibleTemplates,
    submitChecklistExecution,
    ELIGIBILITY_RPC,
  });
});
