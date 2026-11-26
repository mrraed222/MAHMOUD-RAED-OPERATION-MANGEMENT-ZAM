function clean(value, max = 240) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[char] || char));
}

function shiftLabel(value) {
  if (value === 'Morning') return 'صباحية';
  if (value === 'Evening') return 'مسائية';
  return clean(value) || '—';
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function emailHtml({ report, branchName }) {
  const metadata = [
    ['الفرع', branchName],
    ['الوردية', shiftLabel(report.shift_type)],
    ['المشرف', report.supervisor_name],
    ['التاريخ', report.report_date],
  ];
  const rows = metadata.map(([label, value]) => `<tr><td style="padding:7px 0;color:#68746c">${escapeHtml(label)}</td><td style="padding:7px 0;text-align:left;font-weight:700;color:#26352c">${escapeHtml(value || '—')}</td></tr>`).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#f3f6f3;color:#26352c;font-family:Arial,Tahoma,sans-serif"><div style="max-width:620px;margin:24px auto;padding:20px"><div style="overflow:hidden;border:1px solid #dce5de;border-radius:14px;background:#fff"><div style="background:#145238;padding:20px 24px;color:#fff"><div style="font-size:11px;opacity:.85">ZAM Coffee Operations</div><h1 style="margin:6px 0 0;font-size:21px">تقرير مشرف الوردية</h1></div><div style="padding:18px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table><p style="margin:18px 0 0;padding-top:14px;border-top:1px solid #e5ebe6;color:#4d5b52;font-size:14px;line-height:1.8">تجدون التقرير المصمم كاملًا بصيغة PDF في المرفق.</p></div></div></div></body></html>`;
}

/** @param {{ from: string; report: import('./report-types.ts').DailyReportRow; branchName: string; recipients?: string[]; pdfFilename: string; pdfBytes: Uint8Array; html?: string }} input */
export function buildReportEmailPayload({
  from,
  report,
  branchName,
  recipients = [],
  html,
  pdfFilename,
  pdfBytes,
}) {
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength < 5 || new TextDecoder().decode(pdfBytes.subarray(0, 5)) !== '%PDF-') {
    throw new TypeError('report_pdf_bytes_invalid');
  }
  const normalizedBranch = clean(branchName, 160) || 'فرع غير محدد';
  const reportDate = clean(report?.report_date, 20) || 'date';
  const bcc = [...new Set(recipients.map((value) => clean(value, 254).toLowerCase()).filter(Boolean))]
    .filter((email) => email !== 'operations@zam.sa');
  return {
    from,
    to: 'operations@zam.sa',
    bcc,
    subject: `تقرير الوردية اليومية - ${normalizedBranch} - ${reportDate}`,
    html: typeof html === 'string' ? html : emailHtml({ report, branchName: normalizedBranch }),
    attachments: [{ filename: clean(pdfFilename, 180) || 'zam-shift-report.pdf', content: bytesToBase64(pdfBytes) }],
  };
}
