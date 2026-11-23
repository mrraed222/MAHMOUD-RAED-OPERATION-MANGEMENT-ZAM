(function (global) {
  'use strict';

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const usableBranches = (account) => (Array.isArray(account.authorized_branches) ? account.authorized_branches : [])
    .filter((branch) => branch && branch.id && branch.lifecycle_status !== 'planned');

  function render({ status = 'ready', accounts = [], primaryId = '', error = '' } = {}) {
    if (status === 'loading') return '<p role="status" aria-live="polite">جارٍ تحميل الحسابات المصرح لها…</p>';
    if (status === 'error') return `<div class="error-box" role="alert">${escapeHtml(error || 'تعذر تحميل مستلمي التقارير. أعد المحاولة.')}</div>`;
    if (!Array.isArray(accounts) || !accounts.length) {
      return '<div class="empty-box" role="status">لا توجد حسابات نشطة تملك صلاحية قراءة تقارير الفروع.</div>';
    }

    const defaultPrimary = primaryId || accounts.find((account) => account.is_primary)?.profile_id
      || accounts.find((account) => account.role === 'Owner' && account.can_be_primary)?.profile_id || '';
    return accounts.map((account) => {
      const id = escapeHtml(account.profile_id);
      const isOwner = account.role === 'Owner';
      const selected = isOwner || account.is_selected === true;
      const allowedBranches = usableBranches(account);
      const savedBranches = new Set(Array.isArray(account.selected_branch_ids) ? account.selected_branch_ids.map(String) : []);
      const scopeMode = isOwner ? 'all_authorized' : account.scope_mode === 'selected' ? 'selected' : 'all_authorized';
      const supervisorNote = account.role === 'Supervisor'
        ? '<p class="recipient-note">مشرف الوردية يتلقى التقرير الذي سجّله بنفسه فقط.</p>'
        : '';
      const branches = allowedBranches.map((branch) => {
        const branchId = escapeHtml(branch.id);
        const checked = savedBranches.has(String(branch.id)) ? ' checked' : '';
        return `<label class="recipient-branch"><input type="checkbox" data-recipient-branch="${branchId}"${checked}><span>${escapeHtml(branch.name || 'فرع بدون اسم')}</span></label>`;
      }).join('');
      const scopeOptions = `<option value="all_authorized"${scopeMode === 'all_authorized' ? ' selected' : ''}>كل الفروع المصرح بها</option><option value="selected"${scopeMode === 'selected' ? ' selected' : ''}>فروع محددة</option>`;
      return `<article class="recipient-row" data-recipient-row="${id}">
        <div class="recipient-account">
          <label class="recipient-pick"><input type="checkbox" data-recipient-select="${id}"${selected ? ' checked' : ''}${isOwner ? ' disabled' : ''} aria-label="${isOwner ? 'مالك النظام — محدد دائمًا' : `اختيار ${escapeHtml(account.full_name || account.email)}`}"><span>${isOwner ? 'مالك النظام — مستلم ثابت' : 'إضافة كمستلم'}</span></label>
          <div><strong>${escapeHtml(account.full_name || 'حساب بدون اسم')}</strong><p>${escapeHtml(account.role)} · ${escapeHtml(account.email)}</p>${supervisorNote}</div>
          <label class="recipient-primary"><input type="radio" name="primary-recipient" data-recipient-primary="${id}" data-can-primary="${account.can_be_primary === true}" data-owner="${isOwner}" value="${id}"${defaultPrimary === account.profile_id ? ' checked' : ''}${!selected || account.can_be_primary !== true ? ' disabled' : ''}> مستلم التشغيل الإلزامي</label>
        </div>
        ${isOwner ? '' : `<div class="recipient-options" data-recipient-options="${id}"${selected ? '' : ' hidden'}>
          <label for="recipient-scope-${id}">نطاق الفروع</label><select id="recipient-scope-${id}" data-recipient-scope="${id}">${scopeOptions}</select>
          <fieldset data-recipient-branches="${id}"${scopeMode === 'selected' ? '' : ' hidden'}><legend>اختر من الفروع المصرح بها لهذا الحساب</legend>${branches || '<p class="note">لا توجد فروع نشطة متاحة لهذا الحساب.</p>'}</fieldset>
        </div>`}
      </article>`;
    }).join('');
  }

  function buildPayload(accounts, selection) {
    if (!Array.isArray(accounts) || !accounts.length) throw new Error('recipient_candidates_missing');
    const selectedIds = new Set((selection?.selectedIds || []).map(String));
    const knownIds = new Set(accounts.map((account) => String(account.profile_id)));
    for (const id of selectedIds) if (!knownIds.has(id)) throw new Error('unknown_recipient');
    const owners = accounts.filter((account) => account.role === 'Owner');
    if (!owners.length) throw new Error('owner_recipient_missing');
    for (const owner of owners) selectedIds.add(String(owner.profile_id));
    const primaryId = String(selection?.primaryId || '');
    if (!primaryId || !selectedIds.has(primaryId)) throw new Error('primary_recipient_required');

    const recipients = accounts.filter((account) => selectedIds.has(String(account.profile_id))).map((account) => {
      const id = String(account.profile_id);
      const isOwner = account.role === 'Owner';
      const scope = selection?.scopes?.[id] || {};
      const scopeMode = isOwner ? 'all_authorized' : scope.scope_mode || account.scope_mode || 'all_authorized';
      if (!['all_authorized', 'selected'].includes(scopeMode)) throw new Error('invalid_scope_mode');
      const authorizedIds = new Set(usableBranches(account).map((branch) => String(branch.id)));
      const branchIds = isOwner || scopeMode === 'all_authorized' ? [] : (scope.branch_ids || []).map(String);
      if (scopeMode === 'selected' && (!branchIds.length || new Set(branchIds).size !== branchIds.length)) {
        throw new Error('selected_branches_required');
      }
      if (branchIds.some((branchId) => !authorizedIds.has(branchId))) throw new Error('branch_outside_authorized_scope');
      if (id === primaryId && account.can_be_primary !== true) throw new Error('primary_not_authorized');
      return { profile_id: id, scope_mode: scopeMode, branch_ids: branchIds };
    });
    return { recipients, p_primary_profile_id: primaryId };
  }

  global.ZamReportRecipientSettings = Object.freeze({ render, buildPayload, usableBranches });
})(typeof window !== 'undefined' ? window : globalThis);
