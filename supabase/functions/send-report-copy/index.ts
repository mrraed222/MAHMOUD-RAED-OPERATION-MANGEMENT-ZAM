import { createClient } from 'jsr:@supabase/supabase-js@2'
import { jsPDF } from 'npm:jspdf@4.2.1'
import { buildDailyReportPdf } from './report-pdf.mjs'
import { sendEmailWithResend } from './email-provider.mjs'
import { sendReportEmailOnce } from './email-send-once.mjs'
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
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
function emailHtml(report: DailyReportRow, branchName: string) {
  const shift = report.shift_type === 'Morning' ? 'صباحية' : report.shift_type === 'Evening' ? 'مسائية' : clean(report.shift_type)
  return `<div dir="rtl" lang="ar" style="font-family:Arial,sans-serif;background:#f5f7f5;padding:24px;color:#1e2922"><div style="max-width:640px;margin:auto;background:#fff;border:1px solid #dbe4dc;border-radius:12px;padding:24px"><h2 style="color:#145238;margin-top:0">تقرير الوردية اليومية</h2><p>الفرع: <b>${escapeHtml(branchName)}</b></p><p>التاريخ: <b>${escapeHtml(report.report_date)}</b> · الوردية: <b>${escapeHtml(shift)}</b></p><p>المشرف: <b>${escapeHtml(report.supervisor_name)}</b></p><p>إجمالي المبيعات: <b>${escapeHtml(formatAmount(report.total_sales))} ر.س</b> · عدد الطلبات: <b>${escapeHtml(report.orders_count ?? '—')}</b></p><p>أُرفقت نسخة PDF من التقرير بعد حفظه.</p></div></div>`
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
      .select('*,branches(name)')
      .eq('id', reportId)
      .maybeSingle()
    if (reportError) throw new FunctionError(500, 'report_lookup_failed')
    if (!report) return json({ ok: false, message: 'التقرير غير موجود.' }, 404)

    const [waste, issues, reviews, technicalIssues] = await Promise.all([
      fetchAllPages((from, to) => admin.from('waste_logs').select('*')
        .eq('report_id', reportId).order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
      fetchAllPages((from, to) => admin.from('shift_issues').select('*')
        .eq('report_id', reportId).order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
      fetchAllPages((from, to) => admin.from('negative_reviews').select('*')
        .eq('report_id', reportId).order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
      fetchAllPages((from, to) => admin.from('technical_issues')
        .select('id,report_id,title,description,source,priority,status,created_at,resolved_at')
        .eq('report_id', reportId).order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
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

    const arabicLatinFontBytes = await loadArabicLatinFontBytes()
    const branchName = clean(report.branches?.name || 'فرع غير محدد', 160)
    const pdfBytes = await buildDailyReportPdf({
      jsPDF, fontBase64: base64(arabicLatinFontBytes),
      report,
      branchName,
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
    const payload = {
      from: FROM,
      to: 'operations@zam.sa',
      bcc: recipients.filter((email) => email !== 'operations@zam.sa'),
      subject: `تقرير الوردية اليومية - ${branchName} - ${reportDate}`,
      html: emailHtml(report, branchName),
      attachments: [{ filename: pdfFilename, content: pdfBase64 }],
    }
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
