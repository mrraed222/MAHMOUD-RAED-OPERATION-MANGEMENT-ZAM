import { createClient } from 'jsr:@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c] || c))
const clean = (value: unknown, max = 500) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max)
const managementRoles = ['Owner', 'Admin', 'Manager', 'Quality', 'Quality Manager']

class RequestBodyError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

async function readJsonBody(req: Request, maxBytes: number) {
  const declaredLength = Number(req.headers.get('Content-Length') || 0)
  if (declaredLength > maxBytes) throw new RequestBodyError('حجم الطلب أكبر من الحد المسموح', 413)
  if (!req.body) throw new RequestBodyError('جسم الطلب غير صالح', 400)
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new RequestBodyError('حجم الطلب أكبر من الحد المسموح', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid body')
    return body as Record<string, unknown>
  } catch {
    throw new RequestBodyError('بيانات الطلب غير صالحة', 400)
  }
}

function decodeRenderedPages(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new RequestBodyError('صفحات تقرير PDF غير صالحة', 400)
  }
  let totalEncoded = 0
  const pages: Uint8Array[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(item)) {
      throw new RequestBodyError('صيغة صورة PDF غير صالحة', 400)
    }
    totalEncoded += item.length
    if (totalEncoded > 8 * 1024 * 1024) throw new RequestBodyError('حجم صور تقرير PDF أكبر من الحد المسموح', 413)
    let bytes: Uint8Array
    try {
      const binary = atob(item)
      bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    } catch {
      throw new RequestBodyError('تعذر قراءة صفحات تقرير PDF', 400)
    }
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw new RequestBodyError('صفحات التقرير يجب أن تكون صور JPEG صالحة', 400)
    }
    pages.push(bytes)
  }
  return pages
}

async function buildPdf(renderedPages: Uint8Array[], evidence: any[]) {
  const doc = await PDFDocument.create()
  for (const bytes of renderedPages) {
    const image = await doc.embedJpg(bytes)
    const page = doc.addPage([595, 842])
    page.drawImage(image, { x: 0, y: 0, width: 595, height: 842 })
  }
  const labelFont = await doc.embedFont(StandardFonts.HelveticaBold)
  let attachmentNumber = 0
  for (const item of evidence) {
    const fileName = clean(item.file_name || 'attachment', 120)
    if (item.loadError) continue
    const mime = String(item.mime_type || '').toLowerCase()
    const isPng = mime.includes('png') || /\.png$/i.test(fileName)
    const isJpeg = mime.includes('jpeg') || mime.includes('jpg') || /\.(jpe?g)$/i.test(fileName)
    if (!isPng && !isJpeg) continue
    try {
      const image = isPng ? await doc.embedPng(item.bytes) : await doc.embedJpg(item.bytes)
      const page = doc.addPage([595, 842])
      const scale = Math.min(525 / image.width, 735 / image.height, 1)
      const width = image.width * scale
      const height = image.height * scale
      page.drawText(`Attachment ${++attachmentNumber}`, { x: 45, y: 805, size: 10, font: labelFont, color: rgb(0.35, 0.32, 0.30) })
      page.drawImage(image, { x: (595 - width) / 2, y: 45 + (735 - height) / 2, width, height })
    } catch (error) {
      console.error('Visit evidence could not be embedded', fileName, error)
    }
  }
  return await doc.save()
}

function base64(bytes: Uint8Array) { let binary = ''; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length))); return btoa(binary) }
function emailHtml(visit: any, recipients: string[], actions: any[]) {
  const quality = esc(visit.quality_status || 'غير محددة')
  const overrideAt = visit.quality_override_at ? new Date(visit.quality_override_at).toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' }) : '—'
  const override = visit.quality_override
    ? `<p style="color:#8d332c">رسوب استثنائي موثق: <b>${esc(visit.quality_override_reason || '—')}</b> · ${esc(overrideAt)}</p>`
    : ''
  return `<div dir="rtl" style="font-family:Tahoma,Arial;background:#f7f3ef;padding:24px"><div style="max-width:620px;margin:auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #e5d9cf"><h2 style="color:#33210d">تقرير زيارة فرع</h2><p>تم إنشاء تقرير زيارة <b>${esc(visit.branches?.name)}</b> بتاريخ <b>${esc(visit.visit_date)}</b>.</p><p>الدرجة: <b>${visit.score_percentage == null ? '—' : Number(visit.score_percentage).toFixed(0) + '%'}</b></p><p>حالة الجودة: <b>${quality}</b></p>${override}<p>عدد الإجراءات والمخالفات: <b>${actions.length}</b></p><p>للتواصل: <a href="mailto:operation@zam.sa">operation@zam.sa</a></p><p style="color:#71655c;font-size:12px">المستلمون: ${recipients.map(esc).join('، ')}</p></div></div>`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  let supabaseAdmin: any
  let visitId = ''
  let actorId: string | null = null
  try {
    const auth = req.headers.get('Authorization') || ''
    if (!auth.startsWith('Bearer ')) return json({ error: 'تسجيل الدخول مطلوب' }, 401)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || '', { global: { headers: { Authorization: auth } } })
    const { data: authData, error: authError } = await userClient.auth.getUser()
    if (authError || !authData.user) return json({ error: 'جلسة المستخدم غير صالحة' }, 401)
    actorId = authData.user.id
    supabaseAdmin = createClient(supabaseUrl, serviceKey)
    const { data: actor } = await supabaseAdmin.from('profiles').select('id,full_name,email,role,branch_id,shift_type,status').eq('id', actorId).maybeSingle()
    if (!actor || actor.status !== 'active') return json({ error: 'الحساب غير نشط' }, 403)
    const { data: canManageVisits, error: permissionError } = await userClient.rpc('can_manage_branch_visits')
    if (permissionError) throw permissionError
    const body = await readJsonBody(req, 12 * 1024 * 1024)
    visitId = clean(body.visit_id, 80)
    if (!visitId) return json({ error: 'visit_id مطلوب' }, 400)
    const sendEmail = body.send_email === true
    const modes = Array.isArray(body.recipient_modes) ? body.recipient_modes.filter((x: any) => ['management','shift_supervisor','self'].includes(x)) : []
    const renderedPages = decodeRenderedPages(body.rendered_pages)
    const { data: visit, error: visitError } = await supabaseAdmin.from('supervisory_visits').select('*,branches(name)').eq('id', visitId).maybeSingle()
    if (visitError) throw visitError
    if (!visit) return json({ error: 'الزيارة غير موجودة' }, 404)
    const { data: canAccessVisit, error: accessError } = await userClient.rpc('can_access_branch_visit', { p_visit_id: visitId })
    if (accessError) throw accessError
    if (!canAccessVisit) return json({ error: 'لا يوجد لديك تكليف أو صلاحية لعرض هذا التقرير' }, 403)
    if (sendEmail && !canManageVisits) return json({ error: 'إرسال تقارير الزيارة بالبريد يتطلب صلاحية إدارة زيارات الفروع' }, 403)
    const { data: results, error: resultsError } = await supabaseAdmin.from('supervisory_visit_results').select('id,score,result,note,is_violation,subchecks,visit_checklist_templates(category,title,sort_order)').eq('visit_id', visitId).order('sort_order', { referencedTable: 'visit_checklist_templates', ascending: true })
    if (resultsError) throw resultsError
    const { data: actions, error: actionsError } = await supabaseAdmin.from('visit_action_items').select('id,title,description,item_type,priority,assigned_role,due_date,status,assigned_to,branch_id,shift_type').eq('visit_id', visitId).order('created_at')
    if (actionsError) throw actionsError
    const { data: canReviewActionProof, error: reviewPermissionError } = await userClient.rpc('can_review_branch_visit_actions')
    if (reviewPermissionError) throw reviewPermissionError
    const actionIdsVisibleToActor = new Set((actions || []).filter((action: any) => action.assigned_to === actorId || (
      action.assigned_to == null
      && actor.role === 'Supervisor'
      && ['مشرف الشفت', 'Supervisor', 'Shift Supervisor'].includes(action.assigned_role)
      && action.branch_id === actor.branch_id
      && (action.shift_type == null || actor.shift_type === 'Both' || action.shift_type === actor.shift_type)
    )).map((action: any) => action.id))
    const { data: evidenceRows, error: evidenceError } = await supabaseAdmin.from('visit_evidence')
      .select('id,result_id,action_item_id,file_path,file_name,mime_type').eq('visit_id', visitId).order('created_at')
    if (evidenceError) throw evidenceError
    const evidence = []
    for (const item of evidenceRows || []) {
      if (item.action_item_id && !canReviewActionProof && !actionIdsVisibleToActor.has(item.action_item_id)) continue
      const mime = String(item.mime_type || '').toLowerCase()
      const name = String(item.file_name || '')
      const supported = mime.includes('png') || mime.includes('jpeg') || mime.includes('jpg') || /\.(png|jpe?g)$/i.test(name)
      if (!supported) { evidence.push({ ...item, loadError: 'نوع الصورة غير مدعوم داخل PDF' }); continue }
      const evidenceBucket = item.action_item_id ? 'visit-action-evidence' : 'task-evidence'
      const { data: file, error: fileError } = await supabaseAdmin.storage.from(evidenceBucket).download(item.file_path)
      if (fileError || !file) { evidence.push({ ...item, loadError: 'تعذر تحميل المرفق من التخزين' }); continue }
      evidence.push({ ...item, bytes: new Uint8Array(await file.arrayBuffer()) })
    }
    const pdfBytes = await buildPdf(renderedPages, evidence)
    const safeBranch = String(visit.branch_id || 'branch').replace(/[^A-Za-z0-9_-]/g, '') || 'branch'
    const path = `${visitId}/visit-${safeBranch}-${visit.visit_date}.pdf`
    const upload = await supabaseAdmin.storage.from('visit-reports').upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true })
    if (upload.error) throw upload.error
    await supabaseAdmin.from('supervisory_visits').update({ pdf_storage_path: path }).eq('id', visitId)
    const attachmentPath = path
    const signed = await supabaseAdmin.storage.from('visit-reports').createSignedUrl(path, 3600)
    if (signed.error) throw signed.error
    if (!sendEmail) return json({ ok: true, pdf_path: path, signed_url: signed.data.signedUrl, recipients: [] })

    const emails = new Set<string>()
    if (modes.includes('management')) {
      const { data } = await supabaseAdmin.from('profiles').select('email').in('role', managementRoles).eq('status', 'active').not('email', 'is', null)
      for (const row of data || []) if (row.email) emails.add(row.email.trim().toLowerCase())
    }
    if (modes.includes('shift_supervisor')) {
      const { data } = await supabaseAdmin.from('profiles').select('email').eq('role', 'Supervisor').eq('branch_id', visit.branch_id).eq('shift_type', visit.shift_type).eq('status', 'active').not('email', 'is', null)
      for (const row of data || []) if (row.email) emails.add(row.email.trim().toLowerCase())
    }
    if (modes.includes('self') && actor.email) emails.add(actor.email.trim().toLowerCase())
    const recipients = [...emails].filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)).slice(0, 20)
    if (!recipients.length) {
      await supabaseAdmin.from('visit_email_logs').insert({ visit_id: visitId, sent_by: actorId, recipients: [], cc_recipients: [], attachment_path: attachmentPath, status: 'failed', error_message: 'لم يتم العثور على بريد للمستلمين المحددين' })
      return json({ error: 'لم يتم العثور على بريد للمستلمين المحددين', pdf_path: path, signed_url: signed.data.signedUrl }, 422)
    }
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const from = Deno.env.get('RESEND_FROM') || 'Operations Expert <onboarding@resend.dev>'
    if (!resendKey) throw new Error('RESEND_API_KEY غير مضبوط في أسرار Edge Function')
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: recipients, subject: `تقرير زيارة ${visit.branches?.name || ''} - ${visit.visit_date}`, html: emailHtml(visit, recipients, actions || []), attachments: [{ filename: `visit-${safeBranch}-${visit.visit_date}.pdf`, content: base64(pdfBytes) }] }) })
    const responseText = await response.text()
    if (!response.ok) throw new Error(`Resend ${response.status}: ${responseText.slice(0, 300)}`)
    await supabaseAdmin.from('visit_email_logs').insert({ visit_id: visitId, sent_by: actorId, recipients, cc_recipients: [], attachment_path: attachmentPath, status: 'sent', sent_at: new Date().toISOString() })
    return json({ ok: true, pdf_path: path, signed_url: signed.data.signedUrl, recipients })
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message }, error.status)
    console.error(error)
    if (supabaseAdmin && visitId) await supabaseAdmin.from('visit_email_logs').insert({ visit_id: visitId, sent_by: actorId, recipients: [], cc_recipients: [], status: 'failed', error_message: String(error).slice(0, 1000) })
    return json({ error: 'تعذر إنشاء أو إرسال التقرير', detail: String(error).slice(0, 300) }, 500)
  }
})
