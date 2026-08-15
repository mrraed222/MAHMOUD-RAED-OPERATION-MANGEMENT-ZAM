import { createClient } from 'jsr:@supabase/supabase-js@2'

function riyadhNow() {
  const now = new Date()
  const utc = now.getTime() + now.getTimezoneOffset() * 60000
  return new Date(utc + 3 * 3600000)
}

function timeMatches(sendTime: string, current: Date) {
  const [h, m] = sendTime.split(':').map(Number)
  const curH = current.getHours()
  const curM = current.getMinutes()
  const diff = Math.abs((curH * 60 + curM) - (h * 60 + m))
  return diff <= 7
}

// قالب الإيميل الاحترافي الموحد (هوية زام)
function emailShell(titleAr: string, bodyHtml: string, accentColor = '#33210d') {
  return `
  <div dir="rtl" style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;background:#f6f3f2;padding:32px 16px;">
    <table role="presentation" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4e2e1;box-shadow:0 2px 8px rgba(75,54,33,0.08);width:100%;">
      <tr><td style="background:${accentColor};padding:28px 32px;text-align:center;">
        <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">☕ ZAM Operations</div>
        <div style="color:#e1c1a4;font-size:13px;margin-top:4px;">${titleAr}</div>
      </td></tr>
      <tr><td style="padding:32px;color:#1b1c1c;font-size:14px;line-height:1.8;">${bodyHtml}</td></tr>
      <tr><td style="background:#f6f3f2;padding:16px 32px;text-align:center;font-size:11px;color:#80756c;border-top:1px solid #e4e2e1;">
        رسالة تلقائية من نظام زام لإدارة العمليات &mdash; لا ترد على هذا البريد
      </td></tr>
    </table>
  </div>`
}

function statPill(label: string, value: string | number, color = '#33210d') {
  return `<div style="display:inline-block;background:#f0eded;border-radius:10px;padding:12px 18px;margin:4px;text-align:center;min-width:110px;">
    <div style="font-size:20px;font-weight:700;color:${color};">${value}</div>
    <div style="font-size:11px;color:#4e453d;margin-top:2px;">${label}</div>
  </div>`
}

function sectionTitle(text: string) {
  return `<div style="font-size:15px;font-weight:700;color:#33210d;margin:20px 0 10px;border-bottom:2px solid #e1c1a4;padding-bottom:6px;">${text}</div>`
}

function listBlock(items: string[]) {
  if (!items.length) return '<div style="color:#80756c;font-size:13px;">لا يوجد</div>'
  return `<ul style="margin:0;padding-right:20px;color:#1b1c1c;">${items.map(i => `<li style="margin-bottom:6px;">${i}</li>`).join('')}</ul>`
}

// ⬇️ التعديل 1: الإرسال من دومين زام المعتمد + تسجيل كل محاولة (نجاح أو فشل) في email_logs
async function sendEmail(supabase: any, resendKey: string, to: string[], subject: string, html: string) {
  if (!to.length) return
  const from = Deno.env.get('RESEND_FROM') || 'ZAM Operations <operations@zam.sa>'
  const recipients = to.join(',')
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
    })
    const ok = res.ok
    let errorMsg: string | null = null
    if (!ok) {
      errorMsg = `Resend ${res.status}: ${await res.text()}`
      console.error('Resend error:', errorMsg)
    }
    await supabase.from('email_logs').insert({
      recipient_email: recipients,
      subject,
      status: ok ? 'Sent' : 'Failed',
      error_message: errorMsg,
    })
  } catch (e) {
    console.error('Resend error:', e)
    await supabase.from('email_logs').insert({
      recipient_email: recipients,
      subject,
      status: 'Failed',
      error_message: String(e),
    })
  }
}

Deno.serve(async (req: Request) => {
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const now = riyadhNow()
    const today = now.toISOString().split('T')[0]
    const currentShift = now.getHours() < 16 ? 'Morning' : 'Evening'

    const { data: schedules } = await supabase.from('automation_schedules').select('*, branches(name)').eq('is_active', true)
    if (!schedules || !schedules.length || !resendKey) {
      return new Response(JSON.stringify({ ok: true, ran: 0, hasKey: !!resendKey }), { headers: { 'Content-Type': 'application/json' } })
    }

    const { data: allProfiles } = await supabase.from('profiles').select('id, full_name, email, role, branch_id, receives_branch_reports').eq('status', 'active').not('email', 'is', null)
    const ownerAdminEmails = (allProfiles || []).filter((r: any) => r.role === 'Owner' || r.role === 'Admin').map((r: any) => r.email)

    // ⬇️ التعديل 2: فئات المهام الحقيقية لكل موظف من جدول employee_task_categories (تدعم تعدد الفئات)
    const { data: taskCategoryRows } = await supabase.from('employee_task_categories').select('profile_id, category')
    const categoriesByProfile: Record<string, string[]> = {}
    for (const row of taskCategoryRows || []) {
      categoriesByProfile[row.profile_id] = categoriesByProfile[row.profile_id] || []
      categoriesByProfile[row.profile_id].push(row.category)
    }

    function resolveRecipients(sch: any) {
      if (sch.recipient_emails && sch.recipient_emails.length) return [...new Set(sch.recipient_emails)]
      let list = [...ownerAdminEmails]
      if (sch.branch_id) {
        const branchExtra = (allProfiles || []).filter((r: any) => r.branch_id === sch.branch_id && r.receives_branch_reports).map((r: any) => r.email)
        list = [...new Set([...list, ...branchExtra])]
      }
      return list
    }

    let ranCount = 0

    for (const sch of schedules) {
      if (sch.last_run_date === today) continue
      if (!timeMatches(sch.send_time, now)) continue
      if (sch.shift_type && sch.shift_type !== 'Both' && sch.shift_type !== currentShift) continue

      // ============ ملخص تشيك ليست بالفئات ============
      if (sch.report_type === 'checklist_summary') {
        let branchQuery = supabase.from('branches').select('*')
        if (sch.branch_id) branchQuery = branchQuery.eq('id', sch.branch_id)
        const { data: branches } = await branchQuery
        const { data: templates } = await supabase.from('checklist_templates').select('*')
        const { data: logs } = await supabase.from('checklist_logs').select('branch_id, template_id').eq('execution_date', today)

        let body = sectionTitle(`ملخص تنفيذ التشيك ليست - ${today}`)
        for (const b of branches || []) {
          const branchTemplates = (templates || []).filter((t: any) => !t.branch_id || t.branch_id === b.id)
          const byCategory: Record<string, { done: number; total: number }> = {}
          branchTemplates.forEach((t: any) => { byCategory[t.category] = byCategory[t.category] || { done: 0, total: 0 }; byCategory[t.category].total++ })
          const doneIds = new Set((logs || []).filter((l: any) => l.branch_id === b.id).map((l: any) => l.template_id))
          branchTemplates.forEach((t: any) => { if (doneIds.has(t.id)) byCategory[t.category].done++ })

          body += `<div style="margin-bottom:16px;"><div style="font-weight:700;color:#33210d;margin-bottom:6px;">${b.name}</div>`
          body += listBlock(Object.entries(byCategory).map(([cat, v]: any) => `${cat}: <b>${v.done}</b> من ${v.total}`))
          body += '</div>'
        }
        await sendEmail(supabase, resendKey, resolveRecipients(sch), `ملخص تشيك ليست - ${today}`, emailShell('ملخص قوائم التحقق اليومية', body))
      }

      // ============ ملخص أداء التقارير ============
      if (sch.report_type === 'manager_reports_summary') {
        let reportsQuery = supabase.from('daily_reports').select('*, branches(name)').eq('report_date', today)
        if (sch.branch_id) reportsQuery = reportsQuery.eq('branch_id', sch.branch_id)
        const { data: reports } = await reportsQuery
        const totalSales = (reports || []).reduce((s: number, r: any) => s + (Number(r.total_sales) || 0), 0)
        const reportIds = (reports || []).map((r: any) => r.id)
        const { data: waste } = reportIds.length ? await supabase.from('waste_logs').select('id').in('report_id', reportIds) : { data: [] }
        const { data: issues } = reportIds.length ? await supabase.from('shift_issues').select('id').in('report_id', reportIds) : { data: [] }

        let body = sectionTitle(`ملخص أداء الفروع - ${today}`)
        body += `<div style="text-align:center;">${statPill('تقارير مستلمة', (reports || []).length)}${statPill('إجمالي المبيعات', totalSales.toLocaleString() + ' ر.س', '#56b958')}${statPill('سجلات هدر', (waste || []).length, '#ba1a1a')}${statPill('مشاكل شفت', (issues || []).length, '#ba1a1a')}</div>`
        body += sectionTitle('تفاصيل الفروع')
        body += listBlock((reports || []).map((r: any) => `${r.branches?.name || ''}: ${r.total_sales} ر.س (${r.orders_count} طلب) - ${r.team_status || ''}`))
        await sendEmail(supabase, resendKey, resolveRecipients(sch), `ملخص أداء الفروع - ${today}`, emailShell('ملخص أداء التقارير', body, '#4b3621'))
      }

      // ============ تنبيه تأخر تسليم التقارير ============
      if (sch.report_type === 'missed_report_alert') {
        let branchQuery = supabase.from('branches').select('*')
        if (sch.branch_id) branchQuery = branchQuery.eq('id', sch.branch_id)
        const { data: branches } = await branchQuery
        const { data: reports } = await supabase.from('daily_reports').select('branch_id').eq('report_date', today)
        const reportedBranchIds = new Set((reports || []).map((r: any) => r.branch_id))
        const missing = (branches || []).filter((b: any) => !reportedBranchIds.has(b.id))
        if (missing.length) {
          const body = sectionTitle('⚠️ فروع لم ترسل تقريرها اليوم') + listBlock(missing.map((b: any) => b.name))
          await sendEmail(supabase, resendKey, resolveRecipients(sch), `⚠️ فروع لم ترسل تقريرها - ${today}`, emailShell('تنبيه تأخر التقارير', body, '#ba1a1a'))
        }
      }

      // ============ تذكير الموظف بمهامه غير المنفذة ============
      if (sch.report_type === 'employee_task_reminder') {
        const ROLE_CATEGORY: Record<string, string> = { Barista: 'البار', Waiter: 'الصالة', Kitchen: 'المطبخ' }
        const staffQuery = sch.branch_id
          ? (allProfiles || []).filter((p: any) => p.branch_id === sch.branch_id)
          : (allProfiles || [])
        const staff = staffQuery.filter((p: any) => ['Barista', 'Waiter', 'Kitchen'].includes(p.role))

        const { data: templates } = await supabase.from('checklist_templates').select('*').eq('shift_type', currentShift)
        const { data: logs } = await supabase.from('checklist_logs').select('branch_id, template_id, executed_by').eq('execution_date', today)

        for (const emp of staff) {
          // ⬇️ التعديل 2 (تكملة): فئات الموظف من الجدول الجديد، ولو فاضي نرجع لفئة دوره الأساسية
          const empCategories = categoriesByProfile[emp.id]?.length
            ? categoriesByProfile[emp.id]
            : (ROLE_CATEGORY[emp.role] ? [ROLE_CATEGORY[emp.role]] : [])
          if (!empCategories.length) continue

          const empTemplates = (templates || []).filter((t: any) =>
            empCategories.includes(t.category) && (!t.branch_id || t.branch_id === emp.branch_id))
          const doneIds = new Set((logs || []).filter((l: any) => l.branch_id === emp.branch_id).map((l: any) => l.template_id))
          const pending = empTemplates.filter((t: any) => !doneIds.has(t.id))
          if (!pending.length) continue

          const body = `<p>مرحباً <b>${emp.full_name}</b>، عندك ${pending.length} مهمة لسه مانفّذتهاش النهاردة:</p>` + listBlock(pending.map((t: any) => t.task_title))
          await sendEmail(supabase, resendKey, [emp.email], `⏰ تذكير: مهام لم تُنفَّذ بعد`, emailShell('تذكير بتنفيذ التشيك ليست', body, '#ba1a1a'))
        }
      }

      // ============ تذكير المشرف بمهامه وتقريره ============
      if (sch.report_type === 'supervisor_task_reminder') {
        const supervisors = (sch.branch_id
          ? (allProfiles || []).filter((p: any) => p.branch_id === sch.branch_id)
          : (allProfiles || [])
        ).filter((p: any) => p.role === 'Supervisor')

        const { data: templates } = await supabase.from('checklist_templates').select('*').eq('shift_type', currentShift)
        const { data: logs } = await supabase.from('checklist_logs').select('branch_id, template_id').eq('execution_date', today)
        const { data: reports } = await supabase.from('daily_reports').select('branch_id').eq('report_date', today).eq('shift_type', currentShift)
        const reportedBranches = new Set((reports || []).map((r: any) => r.branch_id))

        for (const sup of supervisors) {
          const branchTemplates = (templates || []).filter((t: any) => !t.branch_id || t.branch_id === sup.branch_id)
          const doneIds = new Set((logs || []).filter((l: any) => l.branch_id === sup.branch_id).map((l: any) => l.template_id))
          const pending = branchTemplates.filter((t: any) => !doneIds.has(t.id))
          const reportSubmitted = reportedBranches.has(sup.branch_id)

          if (!pending.length && reportSubmitted) continue

          let body = `<p>مرحباً <b>${sup.full_name}</b>، بالنسبة للشفت ${currentShift === 'Morning' ? 'الصباحي' : 'المسائي'} النهاردة:</p>`
          if (pending.length) { body += sectionTitle(`${pending.length} مهمة لسه معلّقة في فرعك`); body += listBlock(pending.map((t: any) => t.task_title)) }
          if (!reportSubmitted) body += `<p style="color:#ba1a1a;font-weight:700;margin-top:12px;">⚠️ لسه ماأرسلتش تقرير الشفت النهاردة.</p>`
          await sendEmail(supabase, resendKey, [sup.email], `⏰ تذكير مهام وتقرير الشفت`, emailShell('تذكير المشرف', body, '#ba1a1a'))
        }
      }

      await supabase.from('automation_schedules').update({ last_run_date: today }).eq('id', sch.id)
      ranCount++
    }

    return new Response(JSON.stringify({ ok: true, ran: ranCount }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
