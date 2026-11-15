import { createClient } from 'jsr:@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c] || c))
const clean = (value: unknown, max = 500) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max)
const managementRoles = ['Owner', 'Admin', 'Manager', 'Quality', 'Quality Manager']

async function loadArabicFont(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Font download failed: ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

function wrap(text: string, max = 78) {
  const words = clean(text, 1200).split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if ((line + ' ' + word).trim().length > max && line) { lines.push(line); line = word } else line = (line + ' ' + word).trim()
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['—']
}

async function buildPdf(visit: any, results: any[], actions: any[], evidence: any[]) {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  let regular: any
  let bold: any
  try {
    const [regularBytes, boldBytes] = await Promise.all([
      loadArabicFont('https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSansArabic/NotoSansArabic-Regular.ttf'),
      loadArabicFont('https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSansArabic/NotoSansArabic-Bold.ttf'),
    ])
    regular = await doc.embedFont(regularBytes, { subset: true })
    bold = await doc.embedFont(boldBytes, { subset: true })
  } catch (error) {
    console.error('Arabic font unavailable, using Helvetica fallback', error)
    regular = await doc.embedFont(StandardFonts.Helvetica)
    bold = await doc.embedFont(StandardFonts.HelveticaBold)
  }
  const primary = rgb(0x33 / 255, 0x21 / 255, 0x0d / 255)
  const muted = rgb(0.35, 0.32, 0.30)
  let page = doc.addPage([595, 842])
  let y = 790
  const ensure = (height = 24) => { if (y < 56 + height) { page = doc.addPage([595, 842]); y = 790 } }
  const text = (value: unknown, size = 10, isBold = false, color = rgb(0.1, 0.1, 0.1)) => {
    for (const line of wrap(String(value ?? '—'))) { ensure(size + 12); page.drawText(line, { x: 45, y, size, font: isBold ? bold : regular, color }); y -= size + 7 }
  }
  const heading = (value: string) => { ensure(32); page.drawRectangle({ x: 35, y: y - 5, width: 525, height: 25, color: primary }); page.drawText(value, { x: 48, y: y + 2, size: 12, font: bold, color: rgb(1, 1, 1) }); y -= 35 }

  text('تقرير زيارة فرع — Operations Expert', 19, true, primary)
  text(`الفرع: ${visit.branches?.name || 'غير محدد'} | التاريخ: ${visit.visit_date} | الشفت: ${visit.shift_type === 'Morning' ? 'صباحي' : 'مسائي'}`, 10, false, muted)
  text(`منفّذ الزيارة: ${visit.visitor_name || '—'} | الحالة: ${visit.status || '—'} | التوقيع: ${visit.signed_at ? 'معتمدة إلكترونياً' : 'غير معتمدة'}`, 10, false, muted)
  y -= 8
  heading('النتيجة العامة')
  text(`الدرجة: ${visit.score_total ?? '—'} من ${visit.score_possible ?? '—'} | النسبة: ${visit.score_percentage == null ? '—' : `${Number(visit.score_percentage).toFixed(0)}%`}`, 13, true, primary)
  if (visit.observation) text(`ملاحظات عامة: ${visit.observation}`, 10)
  y -= 8
  heading('بنود التقييم ودرجاتها')
  let currentCategory = ''
  for (const result of results) {
    const category = result.visit_checklist_templates?.category || 'عام'
    if (category !== currentCategory) { currentCategory = category; text(category, 11, true, primary) }
    const score = result.score == null ? 'لا ينطبق' : `${result.score}/10`
    text(`${result.visit_checklist_templates?.title || 'بند'} — ${score}${result.is_violation ? ' — مخالفة' : ''}`, 10, true)
    if (Array.isArray(result.subchecks)) for (const check of result.subchecks) text(`• ${check.title || check.code} — ${check.score}/10`, 9, false, muted)
    if (result.note) text(`ملاحظة: ${result.note}`, 9, false, muted)
  }
  if (actions.length) {
    y -= 8; heading('الإجراءات والمخالفات')
    for (const action of actions) text(`${action.item_type || 'تكليف'} | ${action.title} | الأولوية: ${action.priority || '—'} | المسؤول: ${action.assigned_role || '—'} | الموعد: ${action.due_date || '—'} | الحالة: ${action.status || '—'}${action.description ? ` | ${action.description}` : ''}`, 9)
  }
  if (evidence.length) {
    y -= 8; heading('مرفقات المخالفات')
    for (const item of evidence) {
      const fileName = clean(item.file_name || 'مرفق', 120)
      if (item.loadError) { text(`${fileName} — ${item.loadError}`, 9, false, muted); continue }
      const mime = String(item.mime_type || '').toLowerCase()
      const isPng = mime.includes('png') || /\.png$/i.test(fileName)
      const isJpeg = mime.includes('jpeg') || mime.includes('jpg') || /\.(jpe?g)$/i.test(fileName)
      if (!isPng && !isJpeg) { text(`${fileName} — نوع الصورة غير مدعوم داخل PDF`, 9, false, muted); continue }
      try {
        const image = isPng ? await doc.embedPng(item.bytes) : await doc.embedJpg(item.bytes)
        const scale = Math.min(500 / image.width, 590 / image.height, 1)
        const width = image.width * scale
        const height = image.height * scale
        if (y - height - 28 < 56) { page = doc.addPage([595, 842]); y = 790 }
        text(fileName, 9, true, muted)
        page.drawImage(image, { x: 45, y: y - height, width, height })
        y -= height + 18
      } catch (error) {
        console.error('Visit evidence could not be embedded', fileName, error)
        text(`${fileName} — تعذر تضمين الصورة في PDF`, 9, false, muted)
      }
    }
  }
  y -= 10
  text(`حالة الاعتماد: ${visit.signed_at ? 'معتمدة إلكترونياً' : 'غير معتمدة'} | وقت الاعتماد: ${visit.signed_at ? new Date(visit.signed_at).toLocaleString('ar-SA') : '—'}`, 9, false, muted)
  text(`تم إنشاء التقرير: ${new Date().toLocaleString('ar-SA')}`, 8, false, muted)
  text('اعتماد إلكتروني — محمود شريف — إدارة التشغيل', 11, true, primary)
  return await doc.save()
}

function base64(bytes: Uint8Array) { let binary = ''; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length))); return btoa(binary) }
function emailHtml(visit: any, recipients: string[], actions: any[]) { return `<div dir="rtl" style="font-family:Tahoma,Arial;background:#f7f3ef;padding:24px"><div style="max-width:620px;margin:auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #e5d9cf"><h2 style="color:#33210d">تقرير زيارة فرع</h2><p>تم إنشاء تقرير زيارة <b>${esc(visit.branches?.name)}</b> بتاريخ <b>${esc(visit.visit_date)}</b>.</p><p>الدرجة: <b>${visit.score_percentage == null ? '—' : Number(visit.score_percentage).toFixed(0) + '%'}</b></p><p>عدد الإجراءات والمخالفات: <b>${actions.length}</b></p><p style="color:#71655c;font-size:12px">المستلمون: ${recipients.map(esc).join('، ')}</p></div></div>` }

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
    const body = await req.json()
    visitId = clean(body.visit_id, 80)
    if (!visitId) return json({ error: 'visit_id مطلوب' }, 400)
    const sendEmail = body.send_email === true
    const modes = Array.isArray(body.recipient_modes) ? body.recipient_modes.filter((x: any) => ['management','shift_supervisor','self'].includes(x)) : []
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
    const pdfBytes = await buildPdf(visit, results || [], actions || [], evidence)
    const safeBranch = String(visit.branch_id || 'branch').replace(/[^A-Za-z0-9_-]/g, '') || 'branch'
    const path = `${visitId}/visit-${safeBranch}-${visit.visit_date}.pdf`
    const upload = await supabaseAdmin.storage.from('visit-reports').upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true })
    if (upload.error) throw upload.error
    await supabaseAdmin.from('supervisory_visits').update({ pdf_storage_path: path }).eq('id', visitId)
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
      await supabaseAdmin.from('visit_email_logs').insert({ visit_id: visitId, sent_by: actorId, recipients: [], cc_recipients: [], attachment_path: path, status: 'failed', error_message: 'لم يتم العثور على بريد للمستلمين المحددين' })
      return json({ error: 'لم يتم العثور على بريد للمستلمين المحددين', pdf_path: path, signed_url: signed.data.signedUrl }, 422)
    }
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const from = Deno.env.get('RESEND_FROM') || 'Operations Expert <onboarding@resend.dev>'
    if (!resendKey) throw new Error('RESEND_API_KEY غير مضبوط في أسرار Edge Function')
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: recipients, subject: `تقرير زيارة ${visit.branches?.name || ''} - ${visit.visit_date}`, html: emailHtml(visit, recipients, actions || []), attachments: [{ filename: `visit-${safeBranch}-${visit.visit_date}.pdf`, content: base64(pdfBytes) }] }) })
    const responseText = await response.text()
    if (!response.ok) throw new Error(`Resend ${response.status}: ${responseText.slice(0, 300)}`)
    await supabaseAdmin.from('visit_email_logs').insert({ visit_id: visitId, sent_by: actorId, recipients, cc_recipients: [], attachment_path: path, status: 'sent', sent_at: new Date().toISOString() })
    return json({ ok: true, pdf_path: path, signed_url: signed.data.signedUrl, recipients })
  } catch (error) {
    console.error(error)
    if (supabaseAdmin && visitId) await supabaseAdmin.from('visit_email_logs').insert({ visit_id: visitId, sent_by: actorId, recipients: [], cc_recipients: [], status: 'failed', error_message: String(error).slice(0, 1000) })
    return json({ error: 'تعذر إنشاء أو إرسال التقرير', detail: String(error).slice(0, 300) }, 500)
  }
})
