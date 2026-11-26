import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { jsPDF } from 'npm:jspdf@4.2.1'
import { buildDailyReportPdf } from './report-pdf.mjs'
import { sendEmailWithResend } from './email-provider.mjs'
import { sendReportEmailOnce } from './email-send-once.mjs'
import { buildChecklistSummary, buildShiftWindow } from './checklist-summary.mjs'
import { buildReportEmailPayload } from './report-email-payload.mjs'
import { readPngResponseBytes } from './report-logo.mjs'
import type {
  DailyReportRow,
  SendReportDatabase,
} from './report-types.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const FROM = 'ZAM Operations <operations@zam.sa>'
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const FONT_ASSET_URL = 'https://raw.githubusercontent.com/mrraed222/MAHMOUD-RAED-OPERATION-MANGEMENT-ZAM/69c8cab2662f96eced304428b768c32c82e2d43f/supabase/functions/send-report-copy/assets/ZamArabicSans-Regular.ttf'
const FONT_ASSET_BYTES = 589944
const FONT_ASSET_SHA256 = '08ce8078eb76b5211f36c8f77418896c9f9e276e978461dd2f31cd47c3a52796'
const LOGO_ASSET_URL = 'https://raw.githubusercontent.com/mrraed222/MAHMOUD-RAED-OPERATION-MANGEMENT-ZAM/main/assets/logo/zam-logo.png'
let logoDataUriPromise: Promise<string | null> | null = null
let arabicLatinFontBytesPromise: Promise<Uint8Array> | null = null

class FunctionError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
})
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
}[char] || char))
const clean = (value: unknown, max = 240) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)

async function readBody(req: Request) {
  const declaredLength = Number(req.headers.get('Content-Length') || 0)
  if (declaredLength > 8192) throw new FunctionError(413, 'body_too_large')
  let body: unknown
  try { body = await req.json() } catch { throw new FunctionError(400, 'invalid_json') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new FunctionError(400, 'invalid_body')
  return body as Record<string, unknown>
}

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && emailPattern.test(value.trim())
}
function base64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)))
  }
  return btoa(binary)
}
async function loadLogoDataUri(): Promise<string | null> {
  if (!logoDataUriPromise) {
    logoDataUriPromise = (async () => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5_000)
      try {
        const response = await fetch(LOGO_ASSET_URL, { redirect: 'error', signal: controller.signal })
        const bytes = await readPngResponseBytes(response)
        if (!bytes) return null
        return `data:image/png;base64,${base64(bytes)}`
      } catch { return null }
      finally { clearTimeout(timeout) }
    })()
  }
  const logoDataUri = await logoDataUriPromise
  if (!logoDataUri) logoDataUriPromise = null
  return logoDataUri
}
async function loadArabicLatinFontBytes(): Promise<Uint8Array> {
  if (!arabicLatinFontBytesPromise) {
    arabicLatinFontBytesPromise = (async () => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10_000)
      try {
        const response = await fetch(FONT_ASSET_URL, {
          method: 'GET',
          redirect: 'error',
          signal: controller.signal,
        })
        if (!response.ok) throw new FunctionError(503, 'pdf_font_asset_unavailable')
        const declaredLength = Number(response.headers.get('Content-Length') || 0)
        if (declaredLength > FONT_ASSET_BYTES) throw new FunctionError(503, 'pdf_font_asset_invalid')
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.byteLength !== FONT_ASSET_BYTES) throw new FunctionError(503, 'pdf_font_asset_invalid')
        const digest = await crypto.subtle.digest('SHA-256', bytes)
        const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
        if (sha256 !== FONT_ASSET_SHA256) throw new FunctionError(503, 'pdf_font_asset_invalid')
        return bytes
      } catch (error) {
        if (error instanceof FunctionError) throw error
        throw new FunctionError(503, 'pdf_font_asset_unavailable')
      } finally {
        clearTimeout(timeout)
      }
    })()
  }
  try {
    return await arabicLatinFontBytesPromise
  } catch (error) {
    arabicLatinFontBytesPromise = null
    throw error
  }
}
function formatAmount(value: unknown) {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'
}
const DETAIL_PAGE_SIZE = 1000
async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += DETAIL_PAGE_SIZE) {
    const { data, error } = await fetchPage(offset, offset + DETAIL_PAGE_SIZE - 1)
    if (error) throw error
    const page = data || []
    rows.push(...page)
    if (page.length < DETAIL_PAGE_SIZE) return rows
  }
}
async function loadReportChecklistSummary(
  admin: SupabaseClient<SendReportDatabase>,
  report: DailyReportRow,
  branchName: string,
) {
  const branchId = report.branch_id
  if (!branchId || !report.report_date || (report.shift_type !== 'Morning' && report.shift_type !== 'Evening')) return null
  const shiftType = report.shift_type
  const branchHours = {
    opening_time: report.branches?.opening_time ?? null,
    closing_time: report.branches?.closing_time ?? null,
  }
  const window = buildShiftWindow(report.report_date, shiftType, branchHours)
  if (!window) return null

  // Template assignments are limited to the report's shift and relevant template IDs;
  // completion logs below are filtered by this report's branch, business-date window, and shift.
  const templateSelect = 'id,category,shift_type,task_type,branch_id,target_time,frequency,day_of_week,day_of_month,days_of_week,is_active,checklist_template_branches(branch_id)' as const
  const activeShiftTemplates = () => admin.from('checklist_templates')
    .select(templateSelect).eq('is_active', true).in('shift_type', [shiftType, 'Both'])
  const [branchTemplates, globalTemplates, selectedBranchLinks] = await Promise.all([
    fetchAllPages((from, to) => activeShiftTemplates().eq('branch_id', branchId).range(from, to)),
    fetchAllPages((from, to) => activeShiftTemplates().is('branch_id', null).range(from, to)),
    fetchAllPages((from, to) => admin.from('checklist_template_branches')
      .select('template_id,branch_id').eq('branch_id', branchId).range(from, to)),
  ])
  const linkedTemplateIds = [...new Set(selectedBranchLinks.map((row) => String(row.template_id)).filter(Boolean))]
  const linkedTemplates = linkedTemplateIds.length
    ? await fetchAllPages((from, to) => activeShiftTemplates().in('id', linkedTemplateIds).range(from, to))
    : []
  const templateById = new Map<string, typeof branchTemplates[number]>()
  for (const template of [...branchTemplates, ...globalTemplates, ...linkedTemplates]) {
    templateById.set(String(template.id), template)
  }
  const templates = [...templateById.values()]

  const logSelect = 'id,template_id,branch_id,status,execution_date,shift_type,created_at' as const
  const shiftOrUnspecified = `shift_type.eq.${shiftType},shift_type.is.null`
  const [logs, hourlyLogs] = await Promise.all([
    fetchAllPages((from, to) => admin.from('checklist_logs').select(logSelect)
      .eq('branch_id', branchId).gte('execution_date', window.dateFrom).lte('execution_date', window.dateTo)
      .or(shiftOrUnspecified).order('execution_date', { ascending: true })
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
    fetchAllPages((from, to) => admin.from('hourly_checklist_logs').select(logSelect)
      .eq('branch_id', branchId).gte('execution_date', window.dateFrom).lte('execution_date', window.dateTo)
      .eq('shift_type', shiftType).order('execution_date', { ascending: true })
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
  ])

  return buildChecklistSummary({
    templates, logs, hourlyLogs, branchId, branchName,
    reportDate: report.report_date, shiftType, branchHours,
  })
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
function emailHtml(
  report: DailyReportRow,
  branchName: string,
  waste: Array<{ item_name?: string | null; quantity?: number | null; unit?: string | null }>,
  issues: Array<{ description?: string | null; priority?: string | null }>,
  reviews: Array<{ comment_text?: string | null; customer_rating?: number | null }>,
  technicalIssues: Array<{ title?: string | null; status?: string | null }>,
) {
  const shift = report.shift_type === 'Morning' ? 'صباحية' : report.shift_type === 'Evening' ? 'مسائية' : clean(report.shift_type)
  const card = (label: string, value: unknown, tone = '#145238') => `<td style="width:25%;padding:6px;vertical-align:top"><div style="border:1px solid #dbe4dc;border-radius:12px;background:#ffffff;padding:14px 10px;text-align:center"><div style="font-size:24px;font-weight:800;color:${tone};line-height:1.2">${escapeHtml(value)}</div><div style="font-size:12px;color:#64736a;margin-top:7px">${escapeHtml(label)}</div></div></td>`
  const status = clean(report.team_status || 'غير محدد', 80) || 'غير محدد'
  const positiveReviews = report.positive_reviews == null ? '—' : formatAmount(report.positive_reviews)
  const issueTone = issues.length ? '#a34b35' : '#145238'
  const wasteTone = waste.length ? '#9b6a1f' : '#145238'
  const reviewTone = reviews.length ? '#6b4f9a' : '#145238'
  const detail = (title: string, value: unknown, tone: string) => `<div style="display:inline-block;min-width:28%;margin:4px 1%;padding:10px 12px;border-radius:10px;background:${tone};color:#ffffff;text-align:center"><strong style="display:block;font-size:20px">${escapeHtml(value)}</strong><span style="font-size:12px">${escapeHtml(title)}</span></div>`
  return `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#f2f6f3;color:#1e2922;font-family:Arial,Tahoma,sans-serif"><div style="max-width:720px;margin:0 auto;padding:22px 12px"><div style="overflow:hidden;border:1px solid #d4e0d6;border-radius:18px;background:#ffffff;box-shadow:0 8px 24px rgba(31,67,48,.08)"><div style="background:#145238;padding:22px 24px;color:#ffffff"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:middle"><img src="https://raw.githubusercontent.com/mrraed222/MAHMOUD-RAED-OPERATION-MANGEMENT-ZAM/main/assets/logo/zam-logo.png" width="64" height="64" alt="شعار زام" style="display:block;width:64px;height:64px;object-fit:contain;border-radius:12px;background:#ffffff;padding:4px"></td><td style="vertical-align:middle;text-align:right;padding-right:14px"><div style="font-size:12px;opacity:.82">ZAM Operations</div><h1 style="margin:5px 0 0;font-size:24px;line-height:1.35">لوحة تقرير الوردية</h1><div style="margin-top:5px;font-size:13px;opacity:.88">${escapeHtml(branchName)} · ${escapeHtml(report.report_date || '—')} · وردية ${escapeHtml(shift || '—')}</div></td></tr></table></div><div style="padding:22px 20px"><div style="border:1px solid #e0e8e1;border-radius:12px;background:#f8fbf8;padding:14px 16px;margin-bottom:16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="color:#64736a;font-size:13px">المشرف</td><td style="text-align:left;font-weight:700">${escapeHtml(report.supervisor_name || '—')}</td></tr><tr><td style="color:#64736a;font-size:13px;padding-top:8px">حالة الفريق</td><td style="text-align:left;font-weight:700;color:#145238;padding-top:8px">${escapeHtml(status)}</td></tr></table></div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 -6px;width:calc(100% + 12px)"><tr>${card('إجمالي المبيعات', `${formatAmount(report.total_sales)} ر.س`)}${card('عدد الطلبات', report.orders_count ?? '—')}${card('متوسط الفاتورة', `${formatAmount(report.avg_ticket)} ر.س`)}${card('التقييمات الإيجابية', positiveReviews)}</tr><tr>${card('سجلات الهدر', waste.length, wasteTone)}${card('مشاكل الشفت', issues.length, issueTone)}${card('تعليقات جوجل', reviews.length, reviewTone)}${card('مشاكل تقنية', technicalIssues.length, technicalIssues.length ? '#a34b35' : '#145238')}</tr></table><div style="margin-top:18px;padding:16px;border-radius:12px;background:#f8f3ea;text-align:center"><div style="font-size:13px;color:#6b604d;margin-bottom:5px">ملخص المتابعة التشغيلية</div>${detail('الهدر المسجل', waste.length, '#9b6a1f')}${detail('المشاكل المفتوحة', issues.length, '#a34b35')}${detail('مراجعات تحتاج متابعة', reviews.length, '#6b4f9a')}</div><div style="margin-top:18px;border-top:1px solid #e2e9e3;padding-top:14px;color:#64736a;font-size:13px;line-height:1.8"><strong style="color:#1e2922">ماذا ستجد في المرفق؟</strong><br>التقرير الكامل بصيغة PDF، متضمنًا تفاصيل التقرير والملاحظات والهدر ومشاكل الشفت والتعليقات المتاحة.</div></div><div style="padding:15px 20px;background:#f5f8f5;border-top:1px solid #e1e9e2;color:#708078;text-align:center;font-size:11px;line-height:1.7">ZAM Operations · هذه الرسالة ملخص بصري سريع، والمرجع الكامل هو ملف PDF المرفق.<br><a href="mailto:operation@zam.sa" style="color:#145238">operation@zam.sa</a></div></div></div></body></html>`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, message: 'طريقة الطلب غير مدعومة.' }, 405)

  try {
    const authorization = req.headers.get('Authorization') || ''
    if (!authorization.startsWith('Bearer ')) return json({ ok: false, message: 'تسجيل الدخول مطلوب.' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!supabaseUrl || !anonKey) throw new FunctionError(503, 'supabase_configuration_missing')

    const userClient = createClient<SendReportDatabase>(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
    const { data: authData, error: authError } = await userClient.auth.getUser()
    if (authError || !authData.user) return json({ ok: false, message: 'جلسة المستخدم غير صالحة.' }, 401)

    const body = await readBody(req)
    const reportId = clean(body.report_id, 80)
    if (!isValidUuid(reportId)) return json({ ok: false, message: 'معرّف التقرير غير صالح.' }, 400)

    // This single authenticated RPC enforces the exact report's branch/shift
    // scope and the Manager's analytics/detail capability before any service-role
    // client is created or profile data is read; this endpoint returns a full PDF.
    const { data: canGenerateCopy, error: copyPermissionError } = await userClient.rpc('can_generate_daily_report_copy', {
      p_report_id: reportId,
    })
    if (copyPermissionError) throw new FunctionError(403, 'report_copy_authorization_failed')
    if (canGenerateCopy !== true) {
      return json({ ok: false, message: 'التقرير غير موجود أو لا تملك صلاحية إرساله.' }, 404)
    }

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!serviceKey) throw new FunctionError(503, 'supabase_configuration_missing')
    const admin = createClient<SendReportDatabase>(supabaseUrl, serviceKey)
    const { data: actor, error: actorError } = await admin.from('profiles')
      .select('id,email,status,role')
      .eq('id', authData.user.id)
      .maybeSingle()
    if (actorError) throw new FunctionError(500, 'profile_lookup_failed')
    if (!actor || actor.status !== 'active') return json({ ok: false, message: 'الحساب غير نشط.' }, 403)

    const { data: report, error: reportError } = await admin.from('daily_reports')
      .select('*,branches(name,opening_time,closing_time)')
      .eq('id', reportId)
      .maybeSingle()
    if (reportError) throw new FunctionError(500, 'report_lookup_failed')
    if (!report) return json({ ok: false, message: 'التقرير غير موجود.' }, 404)
    const branchName = clean(report.branches?.name || 'فرع غير محدد', 160)

    const [waste, issues, reviews, technicalIssues, checklistSummary] = await Promise.all([
      fetchAllPages((from, to) => admin.from('waste_logs').select('*')
        .eq('report_id', reportId).order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
      fetchAllPages((from, to) => admin.from('shift_issues').select('*')
        .eq('report_id', reportId).order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
      fetchAllPages((from, to) => admin.from('negative_reviews').select('*')
        .eq('report_id', reportId).order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
      fetchAllPages((from, to) => admin.from('technical_issues')
        .select('id,report_id,title,description,source,priority,status,created_at,resolved_at')
        .eq('report_id', reportId).order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
      loadReportChecklistSummary(admin, report, branchName),
    ])

    const { data: configuredRecipients, error: recipientsError } = await admin
      .rpc('get_daily_report_copy_recipients', { p_report_id: reportId })
    if (recipientsError) throw new FunctionError(422, 'report_recipient_authorization_failed')
    const recipientRows = (configuredRecipients || []).filter((row) => isValidEmail(row.email))
    // A scoped primary need not receive reports outside their selected branches;
    // the server resolver returns only recipients authorized for this report.
    if (!recipientRows.length) {
      throw new FunctionError(422, 'report_recipient_configuration_invalid')
    }
    const managementEmails = [...new Set(recipientRows
      .map((row) => row.email.trim().toLowerCase())
      .filter(Boolean))]

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) throw new FunctionError(503, 'email_provider_not_configured')

    const [arabicLatinFontBytes, logoDataUri] = await Promise.all([
      loadArabicLatinFontBytes(), loadLogoDataUri(),
    ])
    const pdfBytes = await buildDailyReportPdf({
      jsPDF, fontBase64: base64(arabicLatinFontBytes), logoDataUri,
      report,
      branchName,
      checklistSummary,
      waste,
      issues,
      reviews,
      technicalIssues,
    })
    if (pdfBytes.length < 5 || new TextDecoder().decode(pdfBytes.subarray(0, 5)) !== '%PDF-') {
      throw new FunctionError(500, 'pdf_generation_failed')
    }
    if (pdfBytes.length > 15 * 1024 * 1024) throw new FunctionError(413, 'pdf_too_large')

    // Report visibility does not make the reader a mail recipient. Only the
    // supervisor who submitted this report receives an automatic copy.
    const ownReportSupervisorEmail = actor.role === 'Supervisor'
      && actor.id === report.submitted_by
      && isValidEmail(actor.email)
      ? actor.email.trim().toLowerCase()
      : null
    const recipients = [...new Set([
      ...(ownReportSupervisorEmail ? [ownReportSupervisorEmail] : []),
      ...managementEmails,
    ])]
    const reportDate = clean(report.report_date, 20) || 'date'
    const safeBranch = branchName.replace(/[^\p{L}\p{N}_-]/gu, '-').replace(/-+/g, '-').slice(0, 60) || 'branch'
    const pdfFilename = `zam-shift-report-${safeBranch}-${reportDate}.pdf`
    const pdfBase64 = base64(pdfBytes)
    const payload = buildReportEmailPayload({
      from: FROM,
      report,
      branchName,
      recipients,
      pdfFilename,
      pdfBytes,
      html: emailHtml(report, branchName, waste, issues, reviews, technicalIssues),
    })
    const payloadSha256 = await sha256Hex(JSON.stringify(payload))
    const delivery = await sendReportEmailOnce({
      claimSend: async () => {
        const { data, error } = await admin.rpc('claim_daily_report_email_send', {
          p_report_id: reportId,
          p_payload_sha256: payloadSha256,
        })
        if (error || !data) throw new FunctionError(503, 'report_send_ledger_unavailable')
        return data
      },
      finishSend: async ({ state, providerMessageId }: {
        state: 'sent' | 'unknown' | 'rejected';
        providerMessageId: string | null;
      }) => {
        const { error } = await admin.rpc('finish_daily_report_email_send', {
          p_report_id: reportId,
          p_payload_sha256: payloadSha256,
          p_state: state,
          p_provider_message_id: providerMessageId,
        })
        if (error) throw new Error('report_send_ledger_finalize_failed')
      },
      sendEmail: ({ payload: outgoingPayload, idempotencyKey }: {
        payload: typeof payload;
        idempotencyKey: string;
      }) => sendEmailWithResend({
        apiKey: resendKey,
        payload: outgoingPayload,
        idempotencyKey,
      }),
      payload,
    })

    if (delivery.decision === 'payload_changed') {
      throw new FunctionError(409, 'report_email_payload_changed')
    }
    if (delivery.decision === 'in_progress' || delivery.decision === 'reconciliation_required') {
      return json({
        ok: false,
        email_sent: false,
        email_status: delivery.decision,
        pdf_base64: pdfBase64,
        pdf_filename: pdfFilename,
        message: 'تم إنشاء PDF، لكن يلزم التحقق من حالة إرسال البريد قبل إعادة المحاولة.',
      }, 409)
    }
    if (delivery.decision === 'unknown' || delivery.decision === 'rejected') {
      return json({
        ok: false,
        email_sent: false,
        email_status: delivery.decision,
        pdf_base64: pdfBase64,
        pdf_filename: pdfFilename,
        message: 'تم إنشاء PDF، لكن تعذر تأكيد إرسال نسخة البريد.',
      }, 502)
    }
    if (delivery.decision !== 'sent' && delivery.decision !== 'already_sent') {
      throw new FunctionError(503, 'report_send_claim_invalid')
    }
    return json({
      ok: true,
      email_sent: true,
      already_sent: delivery.decision === 'already_sent',
      recipient_count: recipients.length,
      pdf_base64: pdfBase64,
      pdf_filename: pdfFilename,
      message: delivery.decision === 'already_sent'
        ? 'سبق تأكيد إرسال نسخة هذا التقرير؛ لم تُرسل نسخة أخرى.'
        : 'تم حفظ التقرير وإرسال نسخة البريد.',
    })
  } catch (error) {
    const status = error instanceof FunctionError ? error.status : 500
    const code = error instanceof FunctionError ? error.code : 'internal_error'
    console.error('send-report-copy failed', { code, status })
    return json({
      ok: false,
      email_sent: false,
      message: 'تم حفظ التقرير، لكن تعذر إرسال نسخة البريد. راجع سجل التقارير أو الإدارة.',
    }, status)
  }
})


