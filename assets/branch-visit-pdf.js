(function (global) {
  'use strict';

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[char]);

  async function loadAttachments(visitId) {
    const { data, error } = await global.zamClient
      .from('visit_evidence')
      .select('file_path,file_name,mime_type,action_item_id')
      .eq('visit_id', visitId)
      .order('created_at');
    if (error) throw error;

    return Promise.all((data || []).map(async item => {
      const bucket = item.action_item_id ? 'visit-action-evidence' : 'task-evidence';
      const { data: signed, error: urlError } = await global.zamClient.storage
        .from(bucket)
        .createSignedUrl(item.file_path, 600);
      return {
        name: item.file_name || 'مرفق',
        mime: String(item.mime_type || '').toLowerCase(),
        url: urlError ? null : (signed?.signedUrl || null)
      };
    }));
  }

  function buildPrintableHtml(visit, attachmentRows) {
    const results = (visit.supervisory_visit_results || []).map(result => {
      const subchecks = (result.subchecks || []).map(check =>
        `${escapeHtml(check.title || check.code || 'نقطة فرعية')} — ${escapeHtml(check.score)}/10`
      ).join('<br>');
      const title = result.visit_checklist_templates?.title || '—';
      const category = result.visit_checklist_templates?.category || '—';
      return `<tr><td>${escapeHtml(category)}</td><td>${escapeHtml(title)}</td><td class="score">${result.score == null ? 'لا ينطبق' : `${escapeHtml(result.score)}/10`}</td><td>${escapeHtml(result.result || '—')}</td><td>${escapeHtml(result.note || '—')}${subchecks ? `<div class="subchecks"><b>النقاط الفرعية:</b><br>${subchecks}</div>` : ''}</td></tr>`;
    }).join('');

    const actions = (visit.visit_action_items || []).map(action =>
      `<tr><td>${escapeHtml(action.title || '—')}</td><td>${escapeHtml(action.priority || '—')}</td><td>${escapeHtml(action.assigned_role || '—')}</td><td>${escapeHtml(action.due_date || '—')}</td><td>${escapeHtml(action.status || '—')}</td></tr>`
    ).join('');

    const attachments = attachmentRows.length ? attachmentRows.map(item => {
      if (!item.url) return `<p>${escapeHtml(item.name)} — تعذر تحميل المرفق.</p>`;
      if (item.mime === 'application/pdf' || !item.mime.startsWith('image/')) {
        return `<p><a href="${escapeHtml(item.url)}">فتح المرفق: ${escapeHtml(item.name)}</a></p>`;
      }
      return `<figure class="attachment"><img crossorigin="anonymous" src="${escapeHtml(item.url)}" alt="${escapeHtml(item.name)}"><figcaption>${escapeHtml(item.name)}</figcaption></figure>`;
    }).join('') : '<p>لا توجد مرفقات.</p>';

    const branchName = visit.branches?.name || 'فرع غير محدد';
    const logoUrl = new URL('../assets/logo/zam-logo.png', global.location.href).href;
    const shift = visit.shift_type === 'Morning' ? 'صباحي' : (visit.shift_type === 'Evening' ? 'مسائي' : 'غير محدد');
    const score = visit.score_percentage == null ? '—' : `${Number(visit.score_percentage).toFixed(0)}%`;

    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>تقرير زيارة ${escapeHtml(branchName)}</title><style>
      @page{size:A4;margin:14mm}*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Tahoma,Arial,sans-serif;color:#24170c;background:#f7f3ef}.sheet{width:100%;max-width:900px;margin:0 auto;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px #24170c18}.cover{background:linear-gradient(135deg,#24170c,#76583d);color:#fff;padding:26px 32px;display:flex;align-items:center;justify-content:space-between;gap:20px;print-color-adjust:exact;-webkit-print-color-adjust:exact}.logo{width:105px;height:72px;object-fit:contain;background:#fff;border-radius:12px;padding:5px}.eyebrow{opacity:.78;font-size:12px}.title{font-size:25px;font-weight:800;margin:5px 0}.meta{font-size:13px;opacity:.9}.content{padding:24px 30px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:18px 0}.stat{background:#f7f3ef;border:1px solid #eadfd6;border-radius:12px;padding:12px}.stat b{display:block;font-size:20px;color:#76583d}.stat span{font-size:11px;color:#71655c}.section{margin-top:22px}.section h2{font-size:16px;background:#33210d;color:#fff;border-radius:9px;padding:9px 12px;margin:0 0 10px;print-color-adjust:exact;-webkit-print-color-adjust:exact}.section h3{font-size:13px;color:#76583d;margin:12px 0 6px}table{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed}th{background:#f0e8e1;color:#33210d;print-color-adjust:exact;-webkit-print-color-adjust:exact}th,td{border:1px solid #dfd3c9;padding:8px;text-align:right;vertical-align:top;overflow-wrap:anywhere;line-height:1.55}.score{font-weight:800;color:#76583d;white-space:nowrap}.subchecks{margin-top:8px}.attachments{display:grid;grid-template-columns:1fr;gap:12px}.attachment{break-inside:avoid;page-break-inside:avoid;border:1px solid #dfd3c9;border-radius:10px;padding:10px;margin:0}.attachment img{display:block;width:auto;max-width:100%;max-height:240mm;object-fit:contain;margin:0 auto}.attachment figcaption{font-size:10px;color:#71655c;margin-top:6px}.footer{border-top:1px solid #eadfd6;padding:14px 30px;color:#71655c;font-size:10px;line-height:1.8}.footer b{color:#33210d}.subchecks,.section h2,tr,.attachment{break-inside:avoid;page-break-inside:avoid}@media(max-width:620px){.cover{padding:18px}.content{padding:16px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}table{font-size:9px}th,td{padding:5px}.title{font-size:20px}}@media print{body{background:#fff}.sheet{box-shadow:none;border-radius:0}.cover,.section h2,th{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
      </style></head><body><div class="sheet"><header class="cover"><div><div class="eyebrow">ZAM Operations · تقرير رقابة تشغيلية</div><div class="title">تقرير زيارة فرع</div><div class="meta">${escapeHtml(branchName)} · ${escapeHtml(visit.visit_date || '—')} · ${shift}</div></div><img class="logo" src="${escapeHtml(logoUrl)}" alt="شعار زام"></header><main class="content"><div class="grid"><div class="stat"><b>${score}</b><span>النتيجة العامة</span></div><div class="stat"><b>${escapeHtml(visit.score_total ?? '—')} / ${escapeHtml(visit.score_possible ?? '—')}</b><span>الدرجة</span></div><div class="stat"><b>${escapeHtml(visit.visitor_name || '—')}</b><span>المقيّم</span></div><div class="stat"><b>${escapeHtml(visit.status || '—')}</b><span>الحالة</span></div></div><section class="section"><h2>بنود التقييم ودرجاتها</h2><table><thead><tr><th>المحور</th><th>البند</th><th>الدرجة</th><th>النتيجة</th><th>الملاحظة</th></tr></thead><tbody>${results || '<tr><td colspan="5">لا توجد بنود تقييم.</td></tr>'}</tbody></table></section><section class="section"><h2>الإجراءات والمخالفات</h2><table><thead><tr><th>الإجراء</th><th>الأولوية</th><th>المسؤول</th><th>الموعد</th><th>الحالة</th></tr></thead><tbody>${actions || '<tr><td colspan="5">لا توجد إجراءات مسجلة.</td></tr>'}</tbody></table></section><section class="section"><h2>المرفقات</h2><div class="attachments">${attachments}</div></section><section class="section"><h2>الملاحظات العامة</h2><p>${escapeHtml(visit.observation || 'لا توجد ملاحظات عامة')}</p></section></main><footer class="footer">ZAM Operations · تم إنشاء التقرير من سجل الزيارات.<br><b>اعتماد إلكتروني — محمود شريف — إدارة التشغيل</b></footer></div></body></html>`;
  }

  function waitForAssets(doc) {
    const imagePromises = Array.from(doc.images || []).map(image => {
      if (image.complete) return Promise.resolve();
      return Promise.race([
        new Promise(resolve => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        }),
        new Promise(resolve => global.setTimeout(resolve, 10000))
      ]);
    });
    const fonts = doc.fonts?.ready || Promise.resolve();
    return Promise.all([fonts, ...imagePromises]);
  }

  async function buildHtml(visit) {
    const attachmentRows = await loadAttachments(visit.id);
    return buildPrintableHtml(visit, attachmentRows);
  }

  async function generatePdfBlob(visit) {
    if (typeof global.html2pdf !== 'function') throw new Error('تعذّر تحميل محرك إنشاء PDF؛ حدّث الصفحة وحاول مجددًا.');
    const html = await buildHtml(visit);
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.title = 'إنشاء PDF لتقرير الزيارة';
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;visibility:hidden;pointer-events:none';
    try {
      document.body.appendChild(frame);
      const loaded = new Promise((resolve, reject) => {
        const timer = global.setTimeout(() => reject(new Error('انتهت مهلة تجهيز تقرير PDF.')), 20000);
        frame.onload = () => { global.clearTimeout(timer); resolve(); };
      });
      frame.srcdoc = html;
      await loaded;
      const doc = frame.contentDocument;
      await waitForAssets(doc);
      const sheet = doc.querySelector('.sheet');
      if (!sheet) throw new Error('تعذّر تجهيز محتوى تقرير الزيارة.');
      const blob = await global.html2pdf().set({
        margin: [8, 8, 8, 8],
        filename: `visit-${visit.visit_date || 'report'}.pdf`,
        image: { type: 'jpeg', quality: 0.78 },
        html2canvas: { scale: 1.35, useCORS: true, allowTaint: false, backgroundColor: '#f7f3ef', logging: false, windowWidth: 794 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.attachment', '.section h2'] }
      }).from(sheet).outputPdf('blob');
      const bytes = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
      if (bytes.length < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
        throw new Error('لم ينتج محرك الطباعة ملف PDF صالحًا.');
      }
      return blob;
    } finally {
      frame.remove();
    }
  }

  async function generatePdfBase64(visit) {
    const blob = await generatePdfBlob(visit);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
    }
    return btoa(binary);
  }

  async function downloadPdf(visit) {
    const blob = await generatePdfBlob(visit);
    const url = global.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `visit-${String(visit.visit_date || 'report').replace(/[^0-9-]/g, '-')}.pdf`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    global.setTimeout(() => global.URL.revokeObjectURL(url), 1000);
  }

  global.ZamVisitPdf = { buildHtml, generatePdfBase64, downloadPdf, waitForAssets };
})(window);
