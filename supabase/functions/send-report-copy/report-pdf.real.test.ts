import { jsPDF } from 'npm:jspdf@4.2.1'
import { buildDailyReportPdf } from './report-pdf.mjs'
import { buildReportEmailPayload } from './report-email-payload.mjs'
import { sendEmailWithResend } from './email-provider.mjs'
import { sendReportEmailOnce } from './email-send-once.mjs'

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)))
  }
  return btoa(binary)
}

const reportFixture = {
  id: '30000000-0000-4000-8000-000000000001',
  branch_id: '10000000-0000-4000-8000-000000000001',
  submitted_by: '20000000-0000-4000-8000-000000000001',
  supervisor_name: 'محمود شريف',
  report_date: '2026-11-22',
  entry_time: '23:30',
  shift_type: 'Evening',
  total_sales: 1275.5,
  orders_count: 19,
  avg_ticket: 67.13,
  team_status: 'مكتمل',
  positive_reviews: 4,
  custom_fields: { 'ملاحظة إضافية': 'متابعة طلبات App A يوميًا' },
  created_at: '2026-11-22T20:30:00Z',
  branches: { name: 'زام الرئيسي' },
}

async function buildFixturePdf({ includeLogo = true, logoDataUriOverride }: {
  includeLogo?: boolean
  logoDataUriOverride?: string | null
} = {}) {
  const fontBytes = await Deno.readFile(new URL('./assets/ZamArabicSans-Regular.ttf', import.meta.url))
  const logoBytes = includeLogo ? await Deno.readFile(new URL('../../../assets/logo/zam-logo.png', import.meta.url)) : null
  return buildDailyReportPdf({
    jsPDF,
    fontBase64: base64(fontBytes),
    logoDataUri: logoDataUriOverride === undefined
      ? (logoBytes ? `data:image/png;base64,${base64(logoBytes)}` : null)
      : logoDataUriOverride,
    report: reportFixture,
    branchName: 'زام الرئيسي',
    checklistSummary: {
      nonHourly: { scheduled: 36, completed: 30, incomplete: 6 },
      hourly: { completed: 12, notPerformed: 2 },
    },
    waste: [{ item_name: 'حليب', quantity: 100, unit: 'جرام', reason: 'المعايرة', created_at: '2026-11-22T20:32:00Z', root_cause: null, corrective_action: null, owner: null, unit_cost: 1.2, shift_type: 'Evening' }],
    issues: [{ issue_type: 'تقنية', description: 'تأخر صيانة الثلاجة', priority: 'متوسطة', action_taken: 'تم فتح بلاغ', created_at: '23:45' }],
    reviews: [
      { review_type: 'negative', comment_text: 'تأخر الطلب', status: 'معلقة', owner: null, action_taken: 'التواصل مع العميل', customer_rating: 2, closed_at: null, created_at: '23:50' },
      { review_type: 'positive', comment_text: 'مراجعة إيجابية خارج النطاق', status: 'مغلقة', owner: null, action_taken: null, customer_rating: 5, closed_at: null, created_at: '23:55' },
    ],
    technicalIssues: [{ id: 'issue-1', report_id: reportFixture.id, title: 'عطل الشاشة', description: 'تحتاج إلى صيانة', source: 'manual', priority: 'high', status: 'open', created_at: '2026-11-22T20:35:00Z', resolved_at: null }],
  })
}

Deno.test('real jsPDF creates branded Arabic report sections with matching checklist summary', async () => {
  const pdfBytes = await buildFixturePdf()
  if (new TextDecoder().decode(pdfBytes.subarray(0, 5)) !== '%PDF-') throw new Error('jsPDF did not generate a valid PDF')
  const artifactPath = Deno.env.get('RIWAQ_REAL_PDF_OUTPUT')
  if (artifactPath) await Deno.writeFile(artifactPath, pdfBytes)

  const file = await Deno.makeTempFile({ suffix: '.pdf' })
  try {
    await Deno.writeFile(file, pdfBytes)
    const info = await new Deno.Command('pdfinfo', { args: [file], stdout: 'piped', stderr: 'piped' }).output()
    if (info.code !== 0) throw new Error(new TextDecoder().decode(info.stderr))
    const infoText = new TextDecoder().decode(info.stdout)
    const pageCount = Number(infoText.match(/^Pages:\s+(\d+)/m)?.[1] || 0)
    if (pageCount < 1) throw new Error(`expected a PDF page, got ${pageCount} page(s)`)

    const extracted = await new Deno.Command('pdftotext', { args: [file, '-'], stdout: 'piped', stderr: 'piped' }).output()
    if (extracted.code !== 0) throw new Error(new TextDecoder().decode(extracted.stderr))
    const text = new TextDecoder().decode(extracted.stdout).normalize('NFKC')
    for (const marker of [
      'ZAM Coffee Operations', 'تقرير مشرف الوردية', 'زام الرئيسي', 'محمود شريف',
      'إجمالي المبيعات', 'متوسط الفاتورة', 'ملخص الهدر', 'حليب',
      'ملخص التشيك ليست', '36', 'غير منفذة', 'المشاكل والشكاوى',
      'تأخر الطلب', 'عطل الشاشة',
    ]) {
      if (!text.includes(marker)) throw new Error(`PDF text extraction missed ${marker}`)
    }
    const salesAndAverage = ['إجمالي المبيعات', 'متوسط الفاتورة'].map((marker) => text.indexOf(marker))
    const laterSections = ['ملخص الهدر', 'ملخص التشيك ليست', 'المشاكل والشكاوى']
      .map((marker) => text.indexOf(marker))
    if (salesAndAverage.some((position) => position < 0 || position >= laterSections[0])
      || laterSections.some((position) => position < 0)
      || laterSections.some((position, index) => index > 0 && position <= laterSections[index - 1])) {
      throw new Error('PDF sections are not in the requested order')
    }
    if (text.includes('ملاحظة إضافية') || text.includes('حالة الفريق') || text.includes('تقييمات Google')) {
      throw new Error('PDF contains report fields that were not requested for this mail attachment')
    }
    if (text.includes('مراجعة إيجابية خارج النطاق')) {
      throw new Error('PDF includes a positive customer review outside the requested problems and complaints section')
    }
  } finally {
    await Deno.remove(file)
  }
})

Deno.test('real jsPDF remains valid when the optional logo asset is unavailable', async () => {
  const pdfBytes = await buildFixturePdf({ includeLogo: false })
  if (new TextDecoder().decode(pdfBytes.subarray(0, 5)) !== '%PDF-') {
    throw new Error('jsPDF failed to create a valid report without the optional logo asset')
  }
})

Deno.test('real jsPDF remains valid when an optional logo image is corrupt', async () => {
  const pdfBytes = await buildFixturePdf({
    includeLogo: false,
    logoDataUriOverride: 'data:image/png;base64,Zm9v',
  })
  if (new TextDecoder().decode(pdfBytes.subarray(0, 5)) !== '%PDF-') {
    throw new Error('jsPDF failed to create a valid report when the optional logo image is corrupt')
  }
})

Deno.test('the real PDF bytes are attached to the provider request without making an external email call', async () => {
  const pdfBytes = await buildFixturePdf()
  const reportId = reportFixture.id
  const payload = buildReportEmailPayload({
    from: 'ZAM Operations <operations@zam.sa>',
    report: reportFixture,
    branchName: 'زام الرئيسي',
    recipients: ['supervisor@example.test', 'operations@zam.sa'],
    html: '<p>Existing live report summary card</p>',
    pdfFilename: 'zam-shift-report-zam-main-2026-11-22.pdf',
    pdfBytes,
  })
  if (payload.html !== '<p>Existing live report summary card</p>') throw new Error('existing email summary HTML was not preserved')
  if (payload.attachments.length !== 1) throw new Error('expected one PDF email attachment')
  if (payload.bcc.length !== 1 || payload.bcc[0] !== 'supervisor@example.test') throw new Error('recipient routing changed unexpectedly')

  let ledgerState: 'empty' | 'sending' | 'unknown' | 'sent' | 'rejected' = 'empty'
  let storedHash = ''
  let activeHash = ''
  let providerAccepted = 0
  let providerRequests = 0
  const providerReceipts = new Map<string, { id: string }>()
  const seenKeys: string[] = []
  const seenPdfBytes: Uint8Array[] = []
  const claimSend = async () => {
    if (ledgerState === 'empty') {
      ledgerState = 'sending'
      storedHash = activeHash
      return { decision: 'send', idempotency_key: `zam-daily-report-copy:${reportId}` }
    }
    if (storedHash !== activeHash) return { decision: 'payload_changed', idempotency_key: `zam-daily-report-copy:${reportId}` }
    if (ledgerState === 'unknown') {
      ledgerState = 'sending'
      return { decision: 'send', idempotency_key: `zam-daily-report-copy:${reportId}` }
    }
    return { decision: ledgerState === 'sent' ? 'already_sent' : 'in_progress', idempotency_key: `zam-daily-report-copy:${reportId}` }
  }
  const finishSend = async ({ state }: { state: 'sent' | 'unknown' | 'rejected'; providerMessageId: string | null }) => {
    ledgerState = state
    if (state === 'sent') storedHash = activeHash
  }
  const fakeResend = async (url: string | URL | Request, options?: RequestInit) => {
    if (String(url) !== 'https://api.resend.com/emails') throw new Error('unexpected provider URL')
    const headers = options?.headers as Record<string, string>
    const key = headers['Idempotency-Key']
    seenKeys.push(key)
    providerRequests += 1
    const outgoing = JSON.parse(String(options?.body || '{}'))
    if (!Array.isArray(outgoing.attachments) || outgoing.attachments.length !== 1) throw new Error('provider payload omitted the attachment')
    const attachment = outgoing.attachments[0]
    if (attachment.filename !== 'zam-shift-report-zam-main-2026-11-22.pdf') throw new Error('provider payload used the wrong attachment filename')
    const attachedBytes = Uint8Array.from(atob(attachment.content), (character) => character.charCodeAt(0))
    if (new TextDecoder().decode(attachedBytes.subarray(0, 5)) !== '%PDF-') throw new Error('provider attachment is not a PDF')
    if (attachedBytes.length !== pdfBytes.length || attachedBytes.some((byte, index) => byte !== pdfBytes[index])) {
      throw new Error('provider attachment bytes differ from the generated PDF')
    }
    seenPdfBytes.push(attachedBytes)
    if (!providerReceipts.has(key)) {
      providerAccepted += 1
      providerReceipts.set(key, { id: 'mock-provider-receipt' })
      throw new TypeError('mock accepted request then dropped the response')
    }
    return new Response(JSON.stringify(providerReceipts.get(key)), { status: 200 })
  }
  const payloadHash = async (value: unknown) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  const sendOnce = async (currentPayload: ReturnType<typeof buildReportEmailPayload>, hash: string) => {
    activeHash = hash
    return sendReportEmailOnce({
      claimSend,
      finishSend,
      payload: currentPayload,
      sendEmail: ({ payload: outgoingPayload, idempotencyKey }: { payload: ReturnType<typeof buildReportEmailPayload>; idempotencyKey: string }) =>
        sendEmailWithResend({
          apiKey: 'mock-only-key',
          payload: outgoingPayload,
          idempotencyKey,
          fetcher: fakeResend,
        }),
    })
  }

  const firstHash = await payloadHash(payload)
  const firstAttempt = await sendOnce(payload, firstHash)
  if (firstAttempt.decision !== 'unknown' || providerAccepted !== 1) throw new Error('expected mock accepted send with lost response')
  const retryPayload = buildReportEmailPayload({
    from: 'ZAM Operations <operations@zam.sa>',
    report: reportFixture,
    branchName: 'زام الرئيسي',
    recipients: ['supervisor@example.test', 'operations@zam.sa'],
    html: '<p>Existing live report summary card</p>',
    pdfFilename: 'zam-shift-report-zam-main-2026-11-22.pdf',
    pdfBytes: await buildFixturePdf(),
  })
  const retryHash = await payloadHash(retryPayload)
  if (firstHash !== retryHash) throw new Error('rebuilding the same PDF attachment changed the email payload hash')
  const retry = await sendOnce(retryPayload, retryHash)
  if (retry.decision !== 'sent' || retry.providerMessageId !== 'mock-provider-receipt') throw new Error('mock retry did not reconcile the provider receipt')
  if (providerRequests !== 2 || providerAccepted !== 1 || seenPdfBytes.length !== 2) throw new Error('mock retry did not verify the PDF attachment twice')
  if (seenKeys.length !== 2 || seenKeys.some((key) => key !== `zam-daily-report-copy:${reportId}`)) throw new Error('retry used a different provider idempotency key')
  const duplicate = await sendOnce(retryPayload, retryHash)
  if (duplicate.decision !== 'already_sent' || providerRequests !== 2) throw new Error('confirmed retry must not call the provider again')
})
