// نسخة بدون أي استيراد خارجي (تعمل حتى لو خدمة تجميع الوحدات متعطلة)
// كل الاستعلامات عبر REST مباشرة بمفتاح service_role

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

// ============ وصول قاعدة البيانات عبر REST ============
const SB_URL = Deno.env.get('SUPABASE_URL') || ''
const SR_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

function sbHeaders(prefer?: string): Record<string, string> {
  const h: Record<string, string> = {
    apikey: SR_KEY,
    Authorization: `Bearer ${SR_KEY}`,
    'Content-Type': 'application/json',
  }
  if (prefer) h['Prefer'] = prefer
  return h
}

async function sbGet(table: string): Promise<any[]> {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?select=*&limit=10000`, { headers: sbHeaders() })
  if (!res.ok) { console.error(`sbGet ${table} failed:`, res.status, await res.text()); return [] }
  return await res.json()
}

async function sbGetFiltered(table: string, filter: string): Promise<any[]> {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?select=*&${filter}&limit=10000`, { headers: sbHeaders() })
  if (!res.ok) { console.error(`sbGet ${table} failed:`, res.status, await res.text()); return [] }
  return await res.json()
}

async function sbPatch(table: string, filter: string, body: any) {
  await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, { method: 'PATCH', headers: sbHeaders('return=minimal'), body: JSON.stringify(body) })
}

async function sbInsert(table: string, body: any, mergeDuplicates = false) {
  const prefer = mergeDuplicates ? 'return=minimal,resolution=merge-duplicates' : 'return=minimal'
  await fetch(`${SB_URL}/rest/v1/${table}`, { method: 'POST', headers: sbHeaders(prefer), body: JSON.stringify(body) })
}

// ============ قوالب الإيميل (هوية زام) ============
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

// الإرسال عبر Resend من دومين زام + تسجيل كل محاولة في email_logs
async function sendEmail(resendKey: string, to: string[], subject: string, html: string) {
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
    await sbInsert('email_logs', {
      recipient_email: recipients,
      subject,
      status: ok ? 'Sent' : 'Failed',
      error_message: errorMsg,
    })
  } catch (e) {
    console.error('Resend error:', e)
    await sbInsert('email_logs', {
      recipient_email: recipients,
      subject,
      status: 'Failed',
      error_message: String(e),
    })
  }
}

Deno.serve(async () => {
  try {
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const now = riyadhNow()
    const today = now.toISOString().split('T')[0]

    if (!resendKey || !SB_URL || !SR_KEY) {
      return new Response(JSON.stringify({ ok: true, ran: 0, hasKey: !!resendKey }), { headers: { 'Content-Type': 'application/json' } })
    }

    const [schedules, allProfiles, taskCategoryRows, allTemplates] = await Promise.all([
      sbGetFiltered('automation_schedules', 'is_active=eq.true'),
      sbGetFiltered('profiles', 'status=eq.active'),
      sbGet('employee_task_categories'),
      sbGet('checklist_templates'),
    ])
    if (!schedules.length) {
      return new Response(JSON.stringify({ ok: true, ran: 0 }), { headers: { 'Content-Type': 'application/json' } })
    }

    const staffProfiles = allProfiles.filter((p: any) => p.email)
    const ownerAdminEmails = staffProfiles.filter((r: any) => r.role === 'Owner' || r.role === 'Admin').map((r: any) => r.email)

    const categoriesByProfile: Record<string, string[]> = {}
    for (const row of taskCategoryRows) {
      categoriesByProfile[row.profile_id] = categoriesByProfile[row.profile_id] || []
      categoriesByProfile[row.profile_id].push(row.category)
    }

    function resolveRecipients(sch: any) {
      if (sch.recipient_emails && sch.recipient_emails.length) return [...new Set(sch.recipient_emails)]
      let list = [...ownerAdminEmails]
      if (sch.branch_id) {
        const branchExtra = staffProfiles.filter((r: any) => r.branch_id === sch.branch_id && r.receives_branch_reports).map((r: any) => r.email)
        list = [...new Set([...list, ...branchExtra])]
      }
      return list
    }

    const ROLE_CATEGORY: Record<string, string> = { Barista: 'البار', Waiter: 'الصالة', Kitchen: 'المطبخ' }
    function employeeCategories(emp: any): string[] {
      if (categoriesByProfile[emp.id]?.length) return categoriesByProfile[emp.id]
      return ROLE_CATEGORY[emp.role] ? [ROLE_CATEGORY[emp.role]] : []
    }
    function taskFitsEmployee(t: any, emp: any): boolean {
      if (!employeeCategories(emp).includes(t.category)) return false
      if (t.branch_id && t.branch_id !== emp.branch_id) return false
      if (emp.shift_type && emp.shift_type !== 'Both' && t.shift_type !== emp.shift_type) return false
      return true
    }
    function fmtTime(t: any): string {
      return t ? ` (⏰ ${String(t).slice(0, 5)})` : ''
    }
    function isDueToday(t: any): boolean {
      const freq = t.frequency || 'daily'
      if (freq === 'daily') return true
      if (freq === 'weekly') return t.day_of_week === now.getDay()
      if (freq === 'monthly') {
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
        return now.getDate() === Math.min(t.day_of_month, lastDay)
      }
      return true
    }

    const logsToday = await sbGetFiltered('checklist_logs', `execution_date=eq.${today}`)

    let ranCount = 0

    // ============ تذكير لحظي عند وقت المهمة (target_time) ============
    {
      const dueTemplates = allTemplates.filter((t: any) => t.target_time && timeMatches(t.target_time, now) && isDueToday(t))
      if (dueTemplates.length) {
        const alreadySent = await sbGetFiltered('task_reminder_logs', `log_date=eq.${today}`)
        const sentIds = new Set(alreadySent.map((r: any) => r.template_id))
        const donePairs = new Set(logsToday.map((l: any) => `${l.executed_by}|${l.template_id}`))
        const staff = staffProfiles.filter((p: any) => ['Barista', 'Waiter', 'Kitchen'].includes(p.role))

        for (const t of dueTemplates) {
          if (sentIds.has(t.id)) continue
          const targets = staff.filter((emp: any) => taskFitsEmployee(t, emp) && !donePairs.has(`${emp.id}|${t.id}`))
          if (targets.length) {
            const body = `<p>وصل وقت تنفيذ المهمة التالية:</p>` +
              `<p style="font-size:16px;font-weight:700;color:#33210d;">${t.task_title} ⏰ ${String(t.target_time).slice(0, 5)}</p>` +
              (t.instructions ? `<p style="color:#4e453d;">${t.instructions}</p>` : '')
            await sendEmail(resendKey, targets.map((e: any) => e.email), `⏰ حان وقت مهمة: ${t.task_title}`, emailShell('تذكير بوقت المهمة', body, '#ba1a1a'))
          }
          await sbInsert('task_reminder_logs', { template_id: t.id, log_date: today }, true)
        }
      }
    }

    const branches = await sbGet('branches')
    const reportsToday = await sbGetFiltered('daily_reports', `report_date=eq.${today}`)

    for (const sch of schedules) {
      if (sch.last_run_date === today) continue
      if (!timeMatches(sch.send_time, now)) continue

      // ============ ملخص تشيك ليست بالفئات ============
      if (sch.report_type === 'checklist_summary') {
        const scopeBranches = sch.branch_id ? branches.filter((b: any) => b.id === sch.branch_id) : branches
        let body = sectionTitle(`ملخص تنفيذ التشيك ليست - ${today}`)
        for (const b of scopeBranches) {
          const branchTemplates = allTemplates.filter((t: any) => (!t.branch_id || t.branch_id === b.id) && isDueToday(t))
          const byCategory: Record<string, { done: number; total: number }> = {}
          branchTemplates.forEach((t: any) => { byCategory[t.category] = byCategory[t.category] || { done: 0, total: 0 }; byCategory[t.category].total++ })
          const doneIds = new Set(logsToday.filter((l: any) => l.branch_id === b.id).map((l: any) => l.template_id))
          branchTemplates.forEach((t: any) => { if (doneIds.has(t.id)) byCategory[t.category].done++ })
          body += `<div style="margin-bottom:16px;"><div style="font-weight:700;color:#33210d;margin-bottom:6px;">${b.name}</div>`
          body += listBlock(Object.entries(byCategory).map(([cat, v]: any) => `${cat}: <b>${v.done}</b> من ${v.total}`))
          body += '</div>'
        }
        await sendEmail(resendKey, resolveRecipients(sch), `ملخص تشيك ليست - ${today}`, emailShell('ملخص قوائم التحقق اليومية', body))
      }

      // ============ ملخص أداء التقارير ============
      if (sch.report_type === 'manager_reports_summary') {
        const scopeReports = sch.branch_id ? reportsToday.filter((r: any) => r.branch_id === sch.branch_id) : reportsToday
        const totalSales = scopeReports.reduce((s: number, r: any) => s + (Number(r.total_sales) || 0), 0)
        const reportIds = scopeReports.map((r: any) => r.id)
        const waste = reportIds.length ? await sbGetFiltered('waste_logs', `report_id=in.(${reportIds.join(',')})`) : []
        const issues = reportIds.length ? await sbGetFiltered('shift_issues', `report_id=in.(${reportIds.join(',')})`) : []
        let body = sectionTitle(`ملخص أداء الفروع - ${today}`)
        body += `<div style="text-align:center;">${statPill('تقارير مستلمة', scopeReports.length)}${statPill('إجمالي المبيعات', totalSales.toLocaleString() + ' ر.س', '#56b958')}${statPill('سجلات هدر', waste.length, '#ba1a1a')}${statPill('مشاكل شفت', issues.length, '#ba1a1a')}</div>`
        body += sectionTitle('تفاصيل الفروع')
        body += listBlock(scopeReports.map((r: any) => `${branches.find((b: any) => b.id === r.branch_id)?.name || ''}: ${r.total_sales} ر.س (${r.orders_count} طلب) - ${r.team_status || ''}`))
        await sendEmail(resendKey, resolveRecipients(sch), `ملخص أداء الفروع - ${today}`, emailShell('ملخص أداء التقارير', body, '#4b3621'))
      }

      // ============ تنبيه تأخر تسليم التقارير ============
      if (sch.report_type === 'missed_report_alert') {
        const scopeBranches = sch.branch_id ? branches.filter((b: any) => b.id === sch.branch_id) : branches
        const reportedBranchIds = new Set(reportsToday.map((r: any) => r.branch_id))
        const missing = scopeBranches.filter((b: any) => !reportedBranchIds.has(b.id))
        if (missing.length) {
          const body = sectionTitle('⚠️ فروع لم ترسل تقريرها اليوم') + listBlock(missing.map((b: any) => b.name))
          await sendEmail(resendKey, resolveRecipients(sch), `⚠️ فروع لم ترسل تقريرها - ${today}`, emailShell('تنبيه تأخر التقارير', body, '#ba1a1a'))
        }
      }

      // ============ تذكير الموظف بمهامه غير المنفذة (موجّه: فرعه + فئاته + وردية الموظف) ============
      if (sch.report_type === 'employee_task_reminder') {
        let staff = staffProfiles.filter((p: any) => ['Barista', 'Waiter', 'Kitchen'].includes(p.role))
        if (sch.branch_id) staff = staff.filter((p: any) => p.branch_id === sch.branch_id)
        if (sch.shift_type) staff = staff.filter((p: any) => p.shift_type === 'Both' || p.shift_type === sch.shift_type)

        for (const emp of staff) {
          const doneIds = new Set(logsToday.filter((l: any) => l.executed_by === emp.id).map((l: any) => l.template_id))
          const pending = allTemplates.filter((t: any) => taskFitsEmployee(t, emp) && isDueToday(t) && !doneIds.has(t.id))
          if (!pending.length) continue

          const shiftLabel = emp.shift_type === 'Both' ? 'الصباحية والمسائية' : (emp.shift_type === 'Morning' ? 'الصباحية' : 'المسائية')
          const body = `<p>مرحباً <b>${emp.full_name}</b>، عندك ${pending.length} مهمة لسه مانفّذتهاش النهاردة (وردية ${shiftLabel}):</p>` +
            listBlock(pending.map((t: any) => `${t.task_title}${fmtTime(t.target_time)}`))
          await sendEmail(resendKey, [emp.email], `⏰ تذكير: مهام لم تُنفَّذ بعد`, emailShell('تذكير بتنفيذ التشيك ليست', body, '#ba1a1a'))
        }
      }

      // ============ تذكير المشرف بمهامه وتقريره ============
      if (sch.report_type === 'supervisor_task_reminder') {
        let supervisors = staffProfiles.filter((p: any) => p.role === 'Supervisor')
        if (sch.branch_id) supervisors = supervisors.filter((p: any) => p.branch_id === sch.branch_id)
        if (sch.shift_type) supervisors = supervisors.filter((p: any) => p.shift_type === 'Both' || p.shift_type === sch.shift_type)

        const reportedBranches = new Set(reportsToday.map((r: any) => `${r.branch_id}|${r.shift_type}`))
        for (const sup of supervisors) {
          const branchTemplates = allTemplates.filter((t: any) => (!t.branch_id || t.branch_id === sup.branch_id) && isDueToday(t))
          const doneIds = new Set(logsToday.filter((l: any) => l.branch_id === sup.branch_id).map((l: any) => l.template_id))
          const pending = branchTemplates.filter((t: any) => !doneIds.has(t.id))
          const myShift = sup.shift_type === 'Both' ? null : sup.shift_type
          const reportSubmitted = myShift
            ? reportedBranches.has(`${sup.branch_id}|${myShift}`)
            : [...reportedBranches].some((k: any) => k.startsWith(`${sup.branch_id}|`))
          if (!pending.length && reportSubmitted) continue

          let body = `<p>مرحباً <b>${sup.full_name}</b>،</p>`
          if (pending.length) { body += sectionTitle(`${pending.length} مهمة لسه معلّقة في فرعك`); body += listBlock(pending.map((t: any) => `${t.task_title}${fmtTime(t.target_time)}`)) }
          if (!reportSubmitted) body += `<p style="color:#ba1a1a;font-weight:700;margin-top:12px;">⚠️ لسه ماأرسلتش تقرير الشفت النهاردة.</p>`
          await sendEmail(resendKey, [sup.email], `⏰ تذكير مهام وتقرير الشفت`, emailShell('تذكير المشرف', body, '#ba1a1a'))
        }
      }

      await sbPatch('automation_schedules', `id=eq.${sch.id}`, { last_run_date: today })
      ranCount++
    }

    return new Response(JSON.stringify({ ok: true, ran: ranCount }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
