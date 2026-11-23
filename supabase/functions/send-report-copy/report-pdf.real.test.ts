import { jsPDF } from 'npm:jspdf@4.2.1'
import { buildDailyReportPdf } from './report-pdf.mjs'
import { sendEmailWithResend } from './email-provider.mjs'
import { sendReportEmailOnce } from './email-send-once.mjs'

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)))
  }
  return btoa(binary)
}

Deno.test('real jsPDF preserves Arabic/English report details and long text', async () => {
  const fontBytes = await Deno.readFile(new URL('./assets/ZamArabicSans-Regular.ttf', import.meta.url))
  const pdfBytes = await buildDailyReportPdf({
    jsPDF,
    fontBase64: base64(fontBytes),
    report: {
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
    },
    branchName: 'زام الرئيسي',
    waste: [],
    issues: [{
      issue_type: 'متابعة',
      description: `${'تفاصيل عربية ومختلطة English '.repeat(470)}END_OF_LONG_VISIT_NOTE`,
      priority: 'عالية',
      action_taken: 'Follow-up confirmed',
      created_at: '23:45',
    }],
    reviews: [],
    technicalIssues: [],
  })
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
    if (pageCount < 2) throw new Error(`expected a multi-page PDF, got ${pageCount} page(s)`)

    const extracted = await new Deno.Command('pdftotext', { args: [file, '-'], stdout: 'piped', stderr: 'piped' }).output()
    if (extracted.code !== 0) throw new Error(new TextDecoder().decode(extracted.stderr))
    const text = new TextDecoder().decode(extracted.stdout)
    const normalizedText = text.normalize('NFKC')
    for (const marker of ['محمود شريف', 'زام الرئيسي', 'App A', 'END_OF_LONG_VISIT_NOTE', 'Follow-up confirmed']) {
      if (!normalizedText.includes(marker)) throw new Error(`PDF text extraction missed ${marker}`)
    }
  } finally {
    await Deno.remove(file)
  }
})

Deno.test('real PDF retry after accepted-but-lost response keeps payload hash and provider key stable', async () => {
  const fontBytes = await Deno.readFile(new URL('./assets/ZamArabicSans-Regular.ttf', import.meta.url))
  const reportId = '30000000-0000-4000-8000-000000000001'
  const report = {
    id: reportId,
    branch_id: '10000000-0000-4000-8000-000000000001',
    submitted_by: '20000000-0000-4000-8000-000000000001',
    report_date: '2026-11-22',
    entry_time: '23:30',
    created_at: '2026-11-22T20:30:00.000Z',
    supervisor_name: 'محمود شريف',
    shift_type: 'Evening',
    total_sales: 1275.5,
    orders_count: 19,
    avg_ticket: 67.13,
    team_status: 'مكتمل',
    positive_reviews: 4,
    custom_fields: {},
    branches: { name: 'زام الرئيسي' },
  }
  const buildRealPdf = () => buildDailyReportPdf({
    jsPDF,
    fontBase64: base64(fontBytes),
    report,
    branchName: 'زام الرئيسي',
    waste: [],
    issues: [],
    reviews: [],
    technicalIssues: [],
  })
  const firstPdf = await buildRealPdf()
  const retryPdf = await buildRealPdf()
  const pdfAsBase64 = (bytes: Uint8Array) => base64(bytes)
  const makePayload = (pdf: Uint8Array) => ({
    from: 'ZAM Operations <operations@zam.sa>',
    to: ['supervisor@example.test'],
    subject: 'تقرير الوردية اليومية - زام الرئيسي - 2026-11-22',
    html: '<p>اختبار محلي فقط</p>',
    attachments: [{ filename: 'zam-shift-report-test-2026-11-22.pdf', content: pdfAsBase64(pdf) }],
  })
  const firstPayload = makePayload(firstPdf)
  const retryPayload = makePayload(retryPdf)
  const payloadHash = async (payload: unknown) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)))
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  }
  const firstHash = await payloadHash(firstPayload)
  const retryHash = await payloadHash(retryPayload)
  if (firstHash !== retryHash) throw new Error('rebuilding the same real PDF changed the email payload hash')

  const stableKey = `zam-daily-report-copy:${reportId}`
  let ledgerState: 'empty' | 'sending' | 'unknown' | 'sent' | 'rejected' = 'empty'
  let storedHash = ''
  let activeHash = ''
  let providerAccepted = 0
  let providerRequests = 0
  const providerReceipts = new Map<string, { id: string }>()
  const seenKeys: string[] = []
  const claimSend = async () => {
    if (ledgerState === 'empty') {
      ledgerState = 'sending'
      storedHash = activeHash
      return { decision: 'send', idempotency_key: stableKey }
    }
    if (storedHash !== activeHash) return { decision: 'payload_changed', idempotency_key: stableKey }
    if (ledgerState === 'unknown') {
      ledgerState = 'sending'
      return { decision: 'send', idempotency_key: stableKey }
    }
    return { decision: ledgerState === 'sent' ? 'already_sent' : 'in_progress', idempotency_key: stableKey }
  }
  const finishSend = async ({ state, providerMessageId }: { state: 'sent' | 'unknown' | 'rejected'; providerMessageId: string | null }) => {
    ledgerState = state
    if (state === 'sent') storedHash = activeHash
    void providerMessageId
  }
  const fakeResend = async (url: string | URL | Request, options?: RequestInit) => {
    if (String(url) !== 'https://api.resend.com/emails') throw new Error('unexpected provider URL')
    const headers = options?.headers as Record<string, string>
    const key = headers['Idempotency-Key']
    seenKeys.push(key)
    providerRequests += 1
    if (!providerReceipts.has(key)) {
      providerAccepted += 1
      providerReceipts.set(key, { id: 'resend-existing-receipt' })
      throw new TypeError('connection closed after provider acceptance')
    }
    return new Response(JSON.stringify(providerReceipts.get(key)), { status: 200 })
  }
  const sendOnce = async (payload: ReturnType<typeof makePayload>, hash: string) => {
    activeHash = hash
    return sendReportEmailOnce({
      claimSend,
      finishSend,
      payload,
      sendEmail: ({ payload: outgoingPayload, idempotencyKey }: { payload: ReturnType<typeof makePayload>; idempotencyKey: string }) => sendEmailWithResend({
        apiKey: 'mock-only-key',
        payload: outgoingPayload,
        idempotencyKey,
        fetcher: fakeResend,
      }),
    })
  }

  const firstAttempt = await sendOnce(firstPayload, firstHash)
  if (firstAttempt.decision !== 'unknown' || providerAccepted !== 1) throw new Error('expected accepted send with lost response')
  const retry = await sendOnce(retryPayload, retryHash)
  if (retry.decision !== 'sent' || retry.providerMessageId !== 'resend-existing-receipt') throw new Error('retry did not reconcile the provider receipt')
  if (providerRequests !== 2 || providerAccepted !== 1) throw new Error('retry must use one provider idempotency key without duplicate acceptance')
  if (seenKeys.length !== 2 || seenKeys.some(key => key !== stableKey)) throw new Error('retry used a different provider idempotency key')
  const duplicate = await sendOnce(retryPayload, retryHash)
  if (duplicate.decision !== 'already_sent' || providerRequests !== 2) throw new Error('confirmed retry must not call the provider again')
})
