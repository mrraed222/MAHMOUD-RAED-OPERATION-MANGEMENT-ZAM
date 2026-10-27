/* =====================================================================
 * weekly-report-core.js  —  v3
 * محرك «التقرير التشغيلي الأسبوعي» — نظام زام للعمليات
 * ---------------------------------------------------------------------
 * v3 التغييرات:
 *   • الفروع تُقرأ ديناميكياً من جدول branches (لا قائمة ثابتة)
 *   • نسبة الالتزام تُحسب من checklist_templates + checklist_logs
 *     (المهام المنفذة ÷ المستحقة) حسب القوائم المسندة وتكرارها الفعلي
 *   • الحقول اليدوية (السبب/الإجراء/المسؤول/الموعد) تُحفظ في Supabase
 *     عبر weekly_report_notes، مع localStorage كاحتياطي offline
 *   • محور 6 (خطة الأسبوع) يُقرأ/يُحفظ من weekly_plans عبر RPC
 *   • محور 2 يعرض الزيارات الإشرافية (supervisory_visits)
 *   • محور 5 يعرض الحضور والغياب (attendance_records)
 *   • محور 3 يعرض حالة الشكوى (معلقة/معالجة/مغلقة)
 *   • محور 4 يعرض السبب الجذري والإجراء التصحيحي وتكلفة الوحدة
 * ===================================================================== */
(function (global) {
  'use strict';

  /* ══════════ ثوابت العرض ══════════ */

  /* قائمة احتياطية — تُستخدم فقط لو تعذّر قراءة جدول branches */
  var FALLBACK_BRANCHES = [
    { id: null, name: 'الفرع الرئيسي', short: 'الرئيسي' },
    { id: null, name: 'فرع البلد',     short: 'البلد' },
    { id: null, name: 'فرع الحي',      short: 'الحي' },
    { id: null, name: 'فرع المنح',     short: 'المنح' },
    { id: null, name: 'فرع البرج',     short: 'البرج' },
    { id: null, name: 'تجربة زام',     short: 'تجربة' }
  ];

  /* أسماء الفروع كما في نموذج تسجيل الشفت → المقابل في نظام زام */
  var ALIAS = {
    'الفرع الرئيسي': 'زام الرئيسي', 'فرع الرئيسي': 'زام الرئيسي', 'زام الرئيسي': 'زام الرئيسي',
    'فرع البلد': 'زام البلد', 'زام البلد': 'زام البلد',
    'فرع الحي': 'زام الحي', 'زام الحي': 'زام الحي',
    'فرع المنح': 'زام المنح', 'زام المنح': 'زام المنح',
    'فرع البرج': 'زام البرج', 'زام البرج': 'زام البرج',
    'فرع تجربة زام': 'تجربة زام', 'تجربة زام': 'تجربة زام'
  };

  var COLORS = { primary: '#33210d', brown: '#4b3621', outline: '#80756c', track: '#e4e2e1',
                 good: '#00450e', bad: '#ba1a1a', accent: '#725a42', light: '#bd9f83' };

  /* ══════════ أدوات ══════════ */
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var nf = function (n) { return Number(n || 0).toLocaleString('en-US'); };
  var nf1 = function (n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var nf2 = function (n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); };
  var pctTxt = function (n) { return (n > 0 ? '+' : '') + Number(n || 0).toFixed(1) + '%'; };
  var dstr = function (d) { return d.toISOString().slice(0, 10); };
  var parseD = function (s) { var p = String(s).split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); };
  var dlabel = function (s) { var d = parseD(s); return d.getUTCDate() + '/' + (d.getUTCMonth() + 1); };
  var AR_DAY = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var dayName = function (s) { return AR_DAY[parseD(s).getUTCDay()]; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var num = function (v) { var n = parseFloat(String(v == null ? '' : v).replace(/[^\d.\-]/g, '')); return isNaN(n) ? 0 : n; };
  var norm = function (s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' '); };
  function dlt(cur, prev) { return prev ? ((cur - prev) / prev) * 100 : (cur ? 100 : 0); }

  /* ══════════ حالة عامة ══════════ */
  /* المصدر الوحيد: Supabase عبر جلسة المستخدم المصادَق.
     لا يوجد endpoint قراءة عام ولا مسار احتياطي من Google Sheet. */
  var CFG = { client: null, user: null };
  var SRC = {
    label: 'غير محدد', kind: 'none', note: '',
    branches: [], reports: [], waste: [], issues: [], negs: [],
    visits: [], attendance: [], plans: [], notes: [], snapshots: [],
    templates: [], logs: []
  };
  var BRANCHES = [];             /* [{id,name,short}] — ديناميكي */
  var BR_NAME_TO_ID = {};        /* اسم الفرع → id */
  var state = { range: 'week', from: null, to: null, branches: new Set(), shift: 'all', tab: 1, drill: null };
  var EDIT_KEY = 'zam-weekly-edits-v3';
  var NOTES_KEY = 'zam-weekly-notes-v3';

  /* ══════════ مطابقة الفروع ══════════ */
  function buildBranchMaps() {
    BR_NAME_TO_ID = {};
    BRANCHES.forEach(function (b) {
      BR_NAME_TO_ID[norm(b.name)] = b.id;
      BR_NAME_TO_ID[norm(b.short)] = b.id;
    });
    Object.keys(ALIAS).forEach(function (k) {
      var target = ALIAS[k];
      for (var i = 0; i < BRANCHES.length; i++) {
        if (norm(BRANCHES[i].name) === norm(target)) { BR_NAME_TO_ID[norm(k)] = BRANCHES[i].id; break; }
      }
    });
  }
  /** يحوّل أي اسم فرع (من الشيت أو من الداتابيز) إلى id */
  function branchKey(raw) {
    raw = norm(raw);
    if (!raw) return '';
    if (BR_NAME_TO_ID[raw]) return BR_NAME_TO_ID[raw];
    var alias = ALIAS[raw];
    if (alias && BR_NAME_TO_ID[norm(alias)]) return BR_NAME_TO_ID[norm(alias)];
    var hit = Object.keys(BR_NAME_TO_ID).filter(function (k) { return raw.indexOf(k) >= 0 || k.indexOf(raw) >= 0; })[0];
    if (hit) return BR_NAME_TO_ID[hit];
    var aHit = Object.keys(ALIAS).filter(function (k) { return raw.indexOf(k) >= 0 || k.indexOf(raw) >= 0; })[0];
    if (aHit) {
      var t = ALIAS[aHit];
      var tHit = Object.keys(BR_NAME_TO_ID).filter(function (k) { return norm(k) === norm(t); })[0];
      if (tHit) return BR_NAME_TO_ID[tHit];
    }
    return raw; /* لم يُعرف — نستخدم الاسم كـ id مؤقت */
  }
  function branchName(id) {
    var b = BRANCHES.filter(function (x) { return x.id === id; })[0];
    return b ? b.name : (id || '—');
  }
  function branchShort(id) {
    var b = BRANCHES.filter(function (x) { return x.id === id; })[0];
    return b ? (b.short || b.name) : (id || '—');
  }

  /* ══════════ مصادر البيانات ══════════ */
  /** قراءة كاملة من Supabase */
  function loadFromClient() {
    if (!CFG.client || typeof CFG.client.from !== 'function') return Promise.resolve(null);
    var c = CFG.client;
    function q(table, sel, order) {
      var b = c.from(table).select(sel);
      if (order) b = b.order(order);
      return b.limit(5000).then(function (r) { return r.data || []; })
        .catch(function () { return []; });
    }
    return Promise.all([
      q('branches', 'id,name'),
      q('daily_reports', 'id,branch_id,report_date,shift_type,supervisor_name,total_sales,orders_count,avg_ticket,team_status,positive_reviews,custom_fields,sheet_key', 'report_date'),
      q('waste_logs', 'id,report_id,item_name,quantity,unit,reason,root_cause,corrective_action,owner,unit_cost'),
      q('shift_issues', 'id,report_id,description,action_taken,priority,issue_type'),
      q('negative_reviews', 'id,report_id,comment_text,review_type,status,owner,action_taken,customer_rating,closed_at'),
      q('supervisory_visits', '*'),
      q('attendance_records', '*'),
      q('weekly_plans', '*'),
      q('weekly_report_notes', '*'),
      q('weekly_reports', '*'),
      q('checklist_templates', '*'),
      q('checklist_logs', '*')
    ]).then(function (res) {
      var branches = res[0], reports = res[1], waste = res[2], issues = res[3], negs = res[4],
          visits = res[5], attendance = res[6], plans = res[7], notes = res[8],
          snapshots = res[9], templates = res[10], logs = res[11];

      // إن وُجدت فروع على الأقل نُبقي المصدر (حتى لو كانت جداول التقارير فارغة)
      // حتى لا نخسر الفروع الديناميكية؛ وإن فشل الاتصال تماماً نرجع null
      // كي تتولّى خطة GAS ثم CSV.
      var hasAny = reports.length || waste.length || issues.length || negs.length ||
        visits.length || attendance.length || plans.length || notes.length ||
        templates.length || logs.length;
      if (!hasAny && !branches.length) return null;

      /* الفروع ديناميكياً */
      BRANCHES = branches.map(function (b) {
        return { id: b.id, name: b.name, short: b.name.replace(/^فرع\s*/, '').replace(/^زام\s*/, '') };
      });
      if (!BRANCHES.length) BRANCHES = FALLBACK_BRANCHES;
      buildBranchMaps();
      state.branches = new Set(BRANCHES.map(function (b) { return b.id; }));

      var repById = {};
      reports.forEach(function (r) { repById[r.id] = r; });
      function repInfo(child) {
        var rep = repById[child.report_id];
        return rep ? { date: String(rep.report_date || '').slice(0, 10), branch: rep.branch_id,
          shiftType: /evening/i.test(rep.shift_type || '') ? 'Evening' : (rep.shift_type || 'Morning') } : { date: '', branch: '', shiftType: 'غير محدد' };
      }

      var R = reports.map(function (r) {
        return { date: String(r.report_date || '').slice(0, 10), branch: r.branch_id,
          branchName: branchName(r.branch_id), shift: r.shift_type || 'Morning',
          shiftType: /evening/i.test(r.shift_type || '') ? 'Evening' : 'Morning',
          supervisor: r.supervisor_name || '', sales: num(r.total_sales), orders: num(r.orders_count),
          avg: num(r.avg_ticket) || (r.orders_count ? num(r.total_sales) / num(r.orders_count) : 0),
          team: r.team_status || '', pos: num(r.positive_reviews) };
      }).filter(function (x) { return x.date; });

      var W = waste.map(function (w) { var i = repInfo(w); return {
        date: i.date, branch: i.branch, shiftType: i.shiftType, item: w.item_name || '', qty: num(w.quantity),
        unit: w.unit || '', reason: w.reason || '', rootCause: w.root_cause || '',
        action: w.corrective_action || '', owner: w.owner || '', unitCost: num(w.unit_cost) }; })
        .filter(function (x) { return x.date; });

      var I = issues.map(function (x) { var i = repInfo(x); return {
        date: i.date, branch: i.branch, type: x.issue_type || '', desc: x.description || '',
        priority: x.priority || '', action: x.action_taken || '' }; }).filter(function (x) { return x.date; });

      var N = negs.map(function (x) { var i = repInfo(x); return {
        date: i.date, branch: i.branch, text: x.comment_text || '', status: x.status || 'معلقة',
        owner: x.owner || '', action: x.action_taken || '', rating: num(x.customer_rating) }; })
        .filter(function (x) { return x.text; });

      SRC = {
        label: 'مباشر من Supabase (نظام زام)', kind: 'live',
        note: 'قراءة مباشرة من قاعدة بيانات نظام زام',
        branches: BRANCHES, reports: R, waste: W, issues: I, negs: N,
        visits: visits.map(function (v) { return {
          date: String(v.visit_date || '').slice(0, 10), branch: v.branch_id,
          visitor: v.visitor_name || '', score: num(v.score),
          total: num(v.checklist_total), done: num(v.checklist_done),
          observation: v.observation || '', action: v.corrective_action || '',
          owner: v.owner || '', due: v.due_date || '', status: v.status || 'مفتوحة' }; })
          .filter(function (v) { return v.date; }),
        attendance: attendance.map(function (a) { return {
          date: String(a.work_date || '').slice(0, 10), branch: a.branch_id,
          employee: a.employee_name || '', shiftType: a.shift_type || 'Morning',
          status: a.status || 'حاضر', notes: a.notes || '' }; }).filter(function (a) { return a.date; }),
        plans: plans.map(function (p) { return {
          weekStart: p.week_start || '', rowNo: num(p.row_no) || 1, objective: p.objective || '',
          scope: p.scope || '', kpi: p.kpi || '', owner: p.owner || '', due: p.due_date || '',
          status: p.status || 'مخطط', needsApproval: !!p.needs_approval,
          approvedBy: p.approved_by || '', notes: p.notes || '' }; }),
        notes: notes.map(function (n) { return { reportKey: n.report_key, noteKey: n.note_key, body: n.body || '' }; }),
        snapshots: snapshots.map(normSnapshot).filter(function (s) { return s.start; }),
        templates: templates, logs: logs
      };
      applyNotes();
      return SRC;
    }).catch(function () { return null; });
  }

  function loadData() {
    /* المصدر الوحيد: Supabase عبر جلسة المستخدم.
       لا يوجد مسار قراءة عام ولا قراءة CSV من Google Sheet. */
    return loadFromClient().then(function (r) {
      if (r) return SRC;
      SRC = { label: 'تعذّر تحميل البيانات', kind: 'none',
        note: 'تأكد من تسجيل الدخول ومن صلاحيات القراءة في Supabase.',
        branches: BRANCHES, reports: [], waste: [], issues: [], negs: [],
        visits: [], attendance: [], plans: [], notes: [], snapshots: [],
        templates: [], logs: [] };
      return SRC;
    });
  }

  /* ══════════ الفلاتر ══════════ */
  function weekRange(off) {
    var now = new Date();
    var today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    var dow = today.getUTCDay();
    var sat = new Date(today); sat.setUTCDate(today.getUTCDate() - ((dow + 1) % 7));
    var fri = new Date(sat); fri.setUTCDate(sat.getUTCDate() + 6);
    if (off) { sat.setUTCDate(sat.getUTCDate() + 7 * off); fri.setUTCDate(fri.getUTCDate() + 7 * off); }
    return { from: dstr(sat), to: dstr(fri) };
  }
  function resolveRange() {
    if (state.range === 'custom' && state.from && state.to) return { from: state.from, to: state.to };
    if (state.range === 'prev') return weekRange(-1);
    if (state.range === 'd7') { var t = new Date(), f = new Date(); t.setUTCDate(t.getUTCDate() + 1); f.setUTCDate(f.getUTCDate() - 6); return { from: dstr(f), to: dstr(t) }; }
    if (state.range === 'd30') { var t2 = new Date(), f2 = new Date(); t2.setUTCDate(t2.getUTCDate() + 1); f2.setUTCDate(f2.getUTCDate() - 29); return { from: dstr(f2), to: dstr(t2) }; }
    return weekRange(0);
  }
  function prevRange(cur) {
    var f = parseD(cur.from), t = parseD(cur.to);
    var days = Math.round((t - f) / 86400000) + 1;
    var pf = new Date(f), pt = new Date(t);
    pf.setUTCDate(pf.getUTCDate() - days); pt.setUTCDate(pt.getUTCDate() - days);
    return { from: dstr(pf), to: dstr(pt) };
  }
  function inRange(d, r) { if (!d) return false; d = String(d).slice(0, 10); return d >= r.from && d <= r.to; }
  function dayList(r) {
    var out = [], d = parseD(r.from), end = parseD(r.to);
    while (d <= end) { out.push(dstr(d)); d.setUTCDate(d.getUTCDate() + 1); }
    return out;
  }
  function reportKey(r) { return r.from; }   /* مفتاح الأسبوع = تاريخ البداية */

  function filterRows(rows, r, useBranch, useShift) {
    return (rows || []).filter(function (x) {
      if (!inRange(x.date, r)) return false;
      if (useBranch && x.branch && !state.branches.has(x.branch)) return false;
      if (useShift && state.shift !== 'all' && x.shiftType !== state.shift) return false;
      return true;
    });
  }
  function agg(reports, r) {
    var rows = filterRows(reports, r, true, true);
    var sales = 0, orders = 0, pos = 0;
    var team = {}, shiftsSeen = {};
    rows.forEach(function (x) {
      sales += x.sales; orders += x.orders; pos += x.pos;
      if (x.team) team[x.team] = (team[x.team] || 0) + 1;
      shiftsSeen[x.date + '|' + x.branch + '|' + x.shiftType] = 1;
    });
    return { rows: rows, sales: sales, orders: orders, avg: orders ? sales / orders : 0, pos: pos,
             team: team, count: rows.length, shiftCount: Object.keys(shiftsSeen).length };
  }
  function byBranch(reports, r) {
    return BRANCHES.map(function (b) {
      var rows = filterRows(reports, r, true, true).filter(function (x) { return x.branch === b.id; });
      var sales = 0, orders = 0;
      rows.forEach(function (x) { sales += x.sales; orders += x.orders; });
      return { id: b.id, name: b.name, short: b.short, sales: sales, orders: orders,
               avg: orders ? sales / orders : 0, shifts: rows.length };
    });
  }

  /* ══════════ الالتزام بالتشيكلست — القوالب المسندة فقط ══════════ */
  function dayOfWeek(date) { return parseD(date).getUTCDay(); }
  function templateDue(t, date, branch, shift) {
    if (t.is_active === false || t.active === false) return false;
    if (t.branch_id && t.branch_id !== branch) return false;
    if (t.shift_type && String(t.shift_type).toLowerCase() !== String(shift).toLowerCase()) return false;
    var f = String(t.frequency || 'daily').toLowerCase();
    if (f === 'weekly' && t.day_of_week != null && Number(t.day_of_week) !== dayOfWeek(date)) return false;
    if (f === 'monthly' && t.day_of_month != null && Number(t.day_of_month) !== parseD(date).getUTCDate()) return false;
    return true;
  }
  function workedSessions(r, branchFilter) {
    var out = {};
    filterRows(SRC.reports, r, true, true).forEach(function (x) {
      if (branchFilter && x.branch !== branchFilter) return;
      out[x.date + '|' + x.branch + '|' + x.shiftType] = { date: x.date, branch: x.branch, shift: x.shiftType };
    });
    return out;
  }
  function compliance(r, branchFilter) {
    var templates = SRC.templates || [], logs = SRC.logs || [], sessions = workedSessions(r, branchFilter);
    if (!templates.length || !Object.keys(sessions).length) return null;
    var stats = complianceByTemplate(r, branchFilter), expected = 0, done = 0, flagged = 0;
    stats.forEach(function (s) { expected += s.total; done += s.done; flagged += s.flagged; });
    if (!expected) return null;
    return { expected: expected, done: done, flagged: flagged,
             pct: Math.min(100, Math.round(done / expected * 100)) };
  }
  /** تفصيل الالتزام لكل قالب مسند، حتى لو لم يُسجّل له تنفيذ */
  function complianceByTemplate(r, branchFilter) {
    var templates = SRC.templates || [], logs = SRC.logs || [], sessions = workedSessions(r, branchFilter);
    if (!templates.length || !Object.keys(sessions).length) return [];
    var stats = {}, sessionKeys = Object.keys(sessions);
    templates.forEach(function (t) {
      stats[t.id] = { title: t.task_title || t.name || 'مهمة بدون اسم', category: t.category || '—', total: 0, done: 0, flagged: 0 };
      sessionKeys.forEach(function (k) {
        var s = sessions[k]; if (templateDue(t, s.date, s.branch, s.shift)) stats[t.id].total++;
      });
    });
    var seen = {};
    logs.forEach(function (l) {
      var date = String(l.execution_date || '').slice(0, 10), t = templates.filter(function (x) { return x.id === l.template_id; })[0];
      if (!t || !inRange(date, r) || (branchFilter && l.branch_id !== branchFilter)) return;
      var session = sessionKeys.filter(function (k) { var s = sessions[k]; return s.date === date && s.branch === l.branch_id && templateDue(t, s.date, s.branch, s.shift); })[0];
      if (!session) return;
      var key = l.template_id + '|' + date + '|' + l.branch_id;
      if (seen[key]) return;
      seen[key] = true;
      if (String(l.status || '').toLowerCase() === 'flagged') stats[t.id].flagged++;
      else stats[t.id].done++;
    });
    return Object.keys(stats).map(function (k) { return stats[k]; }).filter(function (s) { return s.total > 0; });
  }

  /* ══════════ النسخ المحفوظة للتقرير (weekly_reports) ══════════
     جدول weekly_reports اتأنشئ في Supabase، فأعمدته تختلف بحسب الـ migration.
     لذلك بنقرأ الأعمدة المرشّحة من الصف نفسه، وبنحفظ بأعمدة مرشّحة مع
     تدرّج تلقائي: لو عمود غير موجود بنحذفه ونعيد المحاولة. */
  var SNAP_COL = {
    start:    ['period_start', 'week_start', 'start_date', 'from_date', 'period_from'],
    end:      ['period_end', 'week_end', 'end_date', 'to_date', 'period_to'],
    status:   ['status', 'report_status'],
    createdBy:['created_by', 'author', 'owner', 'prepared_by', 'created_by_name'],
    approvedBy:['approved_by', 'reviewed_by'],
    snapshot: ['snapshot', 'snapshot_data', 'data', 'metrics', 'payload'],
    notes:    ['notes', 'notes_json', 'comments'],
    createdAt:['created_at']
  };
  function firstCol(row, names) {
    for (var i = 0; i < names.length; i++) if (row && row[names[i]] != null) return names[i];
    return null;
  }
  function normSnapshot(row) {
    var sc = firstCol(row, SNAP_COL.snapshot);
    var body = sc ? row[sc] : null;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
    return {
      id: row.id || null,
      start: row[firstCol(row, SNAP_COL.start) || ''] || '',
      end: row[firstCol(row, SNAP_COL.end) || ''] || '',
      status: row[firstCol(row, SNAP_COL.status) || ''] || 'محفوظة',
      createdBy: row[firstCol(row, SNAP_COL.createdBy) || ''] || '',
      approvedBy: row[firstCol(row, SNAP_COL.approvedBy) || ''] || '',
      createdAt: row[firstCol(row, SNAP_COL.createdAt) || ''] || '',
      body: body || null
    };
  }
  /** إدراج متدرّج: يحذف أي عمود غير موجود في الجدول ويعيد المحاولة */
  function insertAdaptive(table, payload, tries) {
    tries = tries == null ? 8 : tries;
    return CFG.client.from(table).insert(payload).then(function (res) {
      if (!res.error) return { ok: true };
      var msg = res.error.message || '';
      var m = /column "?([A-Za-z0-9_]+)"? does not exist/i.exec(msg);
      if (m && tries > 0 && payload[m[1]] !== undefined) {
        delete payload[m[1]];
        return insertAdaptive(table, payload, tries - 1);
      }
      return { ok: false, error: msg || 'خطأ غير معروف' };
    }).catch(function (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    });
  }
  /** يحفظSnapshot للأرقام والتعليقات كما هي لحظة الحفظ */
  function saveSnapshot() {
    var btn = document.getElementById('saveSnapshotBtn');
    if (!CFG.client || typeof CFG.client.from !== 'function') {
      notify('لا يوجد عميل Supabase — تعذّر حفظ النسخة.', 'error'); return;
    }
    var r = resolveRange();
    var cur = agg(SRC.reports, r), prv = agg(SRC.reports, prevRange(r));
    var comp = compliance(r);
    var wasteRows = filterRows(SRC.waste, r, true, false);
    var wasteByUnit = {};
    wasteRows.forEach(function (w) {
      var u = w.unit || 'غير محدد';
      wasteByUnit[u] = (wasteByUnit[u] || 0) + (w.qty || 0);
    });
    var snapshot = {
      period: { from: r.from, to: r.to },
      kpis: {
        sales: cur.sales, orders: cur.orders,
        avgTicket: cur.orders ? cur.sales / cur.orders : 0,
        prevSales: prv.sales, prevOrders: prv.orders,
        prevAvgTicket: prv.orders ? prv.sales / prv.orders : 0,
        compliance: comp ? comp.pct : null,
        complianceExpected: comp ? comp.expected : null,
        complianceDone: comp ? comp.done : null,
        complaints: filterRows(SRC.negs, r, true, false).length,
        wasteRecords: wasteRows.length,
        wasteByUnit: wasteByUnit
      },
      branches: byBranch(SRC.reports, r).map(function (b) {
        return { id: b.id, name: b.name, sales: b.sales, orders: b.orders, avg: b.avg, shifts: b.shifts };
      }),
      checklist: complianceByTemplate(r).map(function (s) {
        return { title: s.title, category: s.category, total: s.total, done: s.done, flagged: s.flagged };
      }),
      notes: SRC.noteMap || {},
      plans: (SRC.plans || []).filter(function (p) { return p.weekStart === r.from; })
    };
    var payload = {
      period_start: r.from,
      period_end: r.to,
      week_start: r.from,
      status: 'مسودة',
      snapshot: snapshot,
      notes: snapshot.notes
    };
    var uid = CFG.user && (CFG.user.id || CFG.user.user_id);
    if (uid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(uid))) {
      payload.created_by = uid;
    }
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="material-symbols-outlined text-sm">save</span> جارٍ الحفظ…'; }
    insertAdaptive('weekly_reports', payload).then(function (res) {
      if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined text-sm">save</span> حفظ نسخة التقرير'; }
      if (!res.ok) {
        notify('تعذّر حفظ النسخة: ' + res.error, 'error'); return;
      }
      notify('تم حفظ نسخة التقرير (نسخة تاريخية) في جدول weekly_reports.', 'ok');
      return boot();
    });
  }
  /** يعرض النسخ المحفوظة */
  function renderSnapshots() {
    var el = document.getElementById('snapshotsList');
    if (!el) return;
    var list = (SRC.snapshots || []).slice().sort(function (a, b) {
      return String(b.start).localeCompare(String(a.start));
    });
    if (!list.length) {
      el.innerHTML = '<p class="text-body-sm text-on-surface-variant">لا توجد نسخ محفوظة بعد — اضغط «حفظ نسخة التقرير» لحفظ أرقام وتعليقات الفترة الحالية.</p>';
      return;
    }
    el.innerHTML = '<div class="overflow-x-auto"><table class="w-full text-body-sm">' +
      '<thead><tr class="bg-surface-container text-on-surface-variant">' +
      '<th class="text-right px-md py-sm font-label-bold">الفترة</th>' +
      '<th class="text-right px-md py-sm font-label-bold">الحالة</th>' +
      '<th class="text-right px-md py-sm font-label-bold">المبيعات</th>' +
      '<th class="text-right px-md py-sm font-label-bold">متوسط الفاتورة</th>' +
      '<th class="text-right px-md py-sm font-label-bold">الالتزام</th>' +
      '<th class="text-right px-md py-sm font-label-bold">سُجّل في</th></tr></thead><tbody>' +
      list.map(function (s) {
        var k = (s.body && s.body.kpis) || {};
        var per = s.start && s.end ? (s.start + ' → ' + s.end) : (s.start || '—');
        return '<tr class="border-b border-outline-variant">' +
          '<td class="px-md py-sm font-semibold">' + esc(per) + '</td>' +
          '<td class="px-md py-sm">' + esc(s.status) + '</td>' +
          '<td class="px-md py-sm">' + (k.sales != null ? nf(k.sales) : '—') + '</td>' +
          '<td class="px-md py-sm">' + (k.avgTicket != null ? nf1(k.avgTicket) : '—') + '</td>' +
          '<td class="px-md py-sm">' + (k.compliance != null ? k.compliance + '%' : '—') + '</td>' +
          '<td class="px-md py-sm text-on-surface-variant">' + esc(String(s.createdAt || '').slice(0, 10)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ══════════ الملاحظات (Supabase + localStorage) ══════════ */
  function localNotes() {
    try { return JSON.parse(localStorage.getItem(NOTES_KEY) || '{}'); } catch (e) { return {}; }
  }
  function applyNotes() {
    var rk = reportKey(resolveRange());
    var merged = localNotes();
    (SRC.notes || []).forEach(function (n) {
      if (n.reportKey === rk && n.body) merged[n.noteKey] = n.body;
    });
    SRC.noteMap = merged;
  }
  function saveNote(noteKey, body) {
    var rk = reportKey(resolveRange());
    if (!SRC.noteMap) SRC.noteMap = {};
    SRC.noteMap[noteKey] = body;
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(SRC.noteMap)); } catch (e) {}
    /* حفظ في Supabase عبر RPC */
    if (CFG.client && typeof CFG.client.rpc === 'function') {
      return CFG.client.rpc('save_weekly_note', {
        p_report_key: rk, p_note_key: noteKey, p_body: body,
        p_updated_by: (CFG.user && (CFG.user.full_name || CFG.user.email)) || null
      }).then(function () { return true; })
        .catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  /* ══════════ الرسوم ══════════ */
  function svgEl(w, h, inner) {
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h +
      '" preserveAspectRatio="xMidYMid meet" style="overflow:visible">' + inner + '</svg>';
  }
  function lineChart(el, days, cur, prev) {
    var W = 760, H = 250, PL = 56, PR = 14, PT = 16, PB = 34;
    var max = 1;
    cur.forEach(function (d) { max = Math.max(max, d.v); });
    prev.forEach(function (d) { max = Math.max(max, d.v || 0); });
    var x = function (i) { return PL + (days.length < 2 ? 0 : (i * (W - PL - PR) / (days.length - 1))); };
    var y = function (v) { return PT + (H - PT - PB) * (1 - (v / (max || 1))); };
    var g = '', i;
    for (i = 0; i <= 4; i++) {
      var yy = PT + (H - PT - PB) * i / 4;
      g += '<line x1="' + PL + '" y1="' + yy + '" x2="' + (W - PR) + '" y2="' + yy + '" stroke="' + COLORS.track + '" stroke-width="1"/>';
      g += '<text x="' + (W - PR + 4) + '" y="' + (yy + 4) + '" font-size="10" fill="' + COLORS.outline + '">' + Math.round(max - max * i / 4) + '</text>';
    }
    var pts = cur.map(function (d, ix) { return x(ix) + ',' + y(d.v); }).join(' ');
    g += '<polygon points="' + PL + ',' + (H - PB) + ' ' + pts + ' ' + x(days.length - 1) + ',' + (H - PB) + '" fill="' + COLORS.primary + '" opacity="0.07"/>';
    g += '<polyline points="' + pts + '" fill="none" stroke="' + COLORS.primary + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
    var ppts = prev.map(function (d, ix) { return d.v == null ? null : x(ix) + ',' + y(d.v); }).filter(Boolean);
    if (ppts.length > 1) g += '<polyline points="' + ppts.join(' ') + '" fill="none" stroke="' + COLORS.outline + '" stroke-width="1.8" stroke-dasharray="5 4"/>';
    var step = days.length > 14 ? Math.ceil(days.length / 10) : 1;
    cur.forEach(function (d, ix) {
      g += '<circle cx="' + x(ix) + '" cy="' + y(d.v) + '" r="3.5" fill="' + COLORS.primary + '"/>';
      if (days.length <= 14 || ix % step === 0) {
        g += '<text x="' + x(ix) + '" y="' + (y(d.v) - 10) + '" font-size="10" font-weight="700" fill="' + COLORS.primary + '" text-anchor="middle">' + nf(Math.round(d.v)) + '</text>';
        g += '<text x="' + x(ix) + '" y="' + (H - PB + 16) + '" font-size="10" fill="' + COLORS.outline + '" text-anchor="middle">' + dayName(d.d) + '</text>';
        g += '<text x="' + x(ix) + '" y="' + (H - PB + 28) + '" font-size="9" fill="' + COLORS.outline + '" text-anchor="middle">' + dlabel(d.d) + '</text>';
      }
    });
    el.innerHTML = svgEl(W, H, g);
  }
  function barCompare(el, items, onClick) {
    var W = 760, rowH = 38, H = Math.max(80, items.length * rowH + 16);
    var max = 1;
    items.forEach(function (i) { max = Math.max(max, i.v, i.p || 0); });
    var labelW = 170, valW = 95, trackX = labelW + 8, trackW = W - labelW - valW - 16;
    var g = '';
    items.forEach(function (it, i) {
      var y = i * rowH + 10;
      var wv = (it.v / max) * trackW, wp = ((it.p || 0) / max) * trackW;
      g += '<text x="' + W + '" y="' + (y + 16) + '" font-size="12" font-weight="600" fill="#1b1c1c" text-anchor="end">' + esc(it.label) + '</text>';
      g += '<rect x="' + trackX + '" y="' + (y + 2) + '" width="' + trackW + '" height="22" rx="4" fill="' + COLORS.track + '"/>';
      if (it.p) g += '<rect x="' + trackX + '" y="' + (y + 2) + '" width="' + wp + '" height="22" rx="4" fill="' + COLORS.outline + '" opacity="0.35"/>';
      g += '<rect x="' + trackX + '" y="' + (y + 2) + '" width="' + wv + '" height="22" rx="4" fill="' + COLORS.primary + '" class="barhit" data-b="' + esc(it.key || '') + '" style="cursor:pointer"/>';
      var dv = it.p ? pctTxt(dlt(it.v, it.p)) : '';
      var col = it.p ? (it.v >= it.p ? COLORS.good : COLORS.bad) : COLORS.outline;
      g += '<text x="' + (trackX - 6) + '" y="' + (y + 18) + '" font-size="11" font-weight="700" fill="' + col + '" text-anchor="end">' + nf(Math.round(it.v)) + ' ' + dv + '</text>';
    });
    el.innerHTML = svgEl(W, H, g);
    $$('.barhit', el).forEach(function (r) {
      r.addEventListener('click', function () {
        var k = r.getAttribute('data-b');
        if (k && onClick) onClick(k);
      });
    });
  }
  function donut(el, items) {
    var total = items.reduce(function (a, i) { return a + i.v; }, 0);
    if (!total) { el.innerHTML = '<div class="text-body-sm text-on-surface-variant text-center py-lg">لا توجد بيانات هدر في هذه الفترة</div>'; return; }
    var W = 300, cx = W / 2, cy = 78, R = 72, r = 45;
    var palette = ['#4b3621', '#725a42', '#bd9f83', '#8a7a63', '#a89478', '#5e604d', '#33210d'];
    var ang = -Math.PI / 2, g = '';
    items.forEach(function (it, i) {
      var sweep = (it.v / total) * Math.PI * 2;
      var x1 = cx + R * Math.cos(ang), y1 = cy + R * Math.sin(ang);
      var x2 = cx + R * Math.cos(ang + sweep), y2 = cy + R * Math.sin(ang + sweep);
      var x3 = cx + r * Math.cos(ang + sweep), y3 = cy + r * Math.sin(ang + sweep);
      var x4 = cx + r * Math.cos(ang), y4 = cy + r * Math.sin(ang);
      var large = sweep > Math.PI ? 1 : 0;
      g += '<path d="M' + x1 + ',' + y1 + ' A' + R + ',' + R + ' 0 ' + large + ' 1 ' + x2 + ',' + y2 +
           ' L' + x3 + ',' + y3 + ' A' + r + ',' + r + ' 0 ' + large + ' 0 ' + x4 + ',' + y4 + ' Z" fill="' + palette[i % palette.length] + '"/>';
      ang += sweep;
    });
    g += '<text x="' + cx + '" y="' + (cy - 2) + '" font-size="21" font-weight="800" fill="' + COLORS.primary + '" text-anchor="middle">' + nf(total) + '</text>';
    g += '<text x="' + cx + '" y="' + (cy + 15) + '" font-size="10" fill="' + COLORS.outline + '" text-anchor="middle">إجمالي الهدر</text>';
    var cols = 2, legend = [];
    items.slice(0, 6).forEach(function (it, i) {
      var col = palette[i % palette.length];
      var x = 12 + (i % cols) * 148, y = 162 + Math.floor(i / cols) * 22;
      legend.push('<rect x="' + x + '" y="' + (y - 9) + '" width="10" height="10" rx="2" fill="' + col + '"/>' +
        '<text x="' + (x + 15) + '" y="' + y + '" font-size="10" fill="#4e453d">' + esc(String(it.label).slice(0, 15)) + ' (' + nf(it.v) + ')</text>');
    });
    el.innerHTML = svgEl(W, 162 + Math.ceil(Math.min(items.length, 6) / cols) * 22 + 10, g + legend.join(''));
  }
  /** أشرطة عامة (تُستخدم للتشيكلست الديناميكي) */
  function bars(el, items) {
    var W = 760, rowH = 30, H = Math.max(60, items.length * rowH + 16), g = '';
    items.forEach(function (it, i) {
      var y = i * rowH + 6;
      var p = it.total ? Math.min(100, it.done / it.total * 100) : 0;
      var col = p >= 90 ? COLORS.good : p >= 70 ? COLORS.accent : COLORS.bad;
      g += '<text x="' + W + '" y="' + (y + 14) + '" font-size="11" fill="#1b1c1c" text-anchor="end">' + esc(String(it.label).slice(0, 52)) + '</text>';
      g += '<rect x="220" y="' + (y + 2) + '" width="' + (W - 340) + '" height="16" rx="4" fill="' + COLORS.track + '"/>';
      g += '<rect x="220" y="' + (y + 2) + '" width="' + ((W - 340) * p / 100) + '" height="16" rx="4" fill="' + col + '"/>';
      g += '<text x="210" y="' + (y + 14) + '" font-size="11" font-weight="700" fill="' + col + '" text-anchor="end">' + p.toFixed(0) + '%</text>';
      g += '<text x="' + (W - 110) + '" y="' + (y + 14) + '" font-size="10" fill="' + COLORS.outline + '">' + it.done + '/' + it.total + '</text>';
    });
    el.innerHTML = svgEl(W, H, g);
  }

  /* ══════════ العرض ══════════ */
  function deltaChip(d, goodDir, prevZero) {
    var up = d >= 0;
    var good = goodDir === 'up' ? up : !up;
    var cls = good ? 'text-tertiary-container bg-tertiary-container/15' : 'text-error bg-error-container/40';
    var txt = prevZero ? 'جديد' : pctTxt(d);
    var ic = prevZero ? 'fiber_new' : (up ? 'north_east' : 'south_east');
    return '<span class="inline-flex items-center gap-xs font-bold text-body-sm ' + cls + ' px-xs py-0.5 rounded-full">' +
      '<span class="material-symbols-outlined text-[14px]">' + ic + '</span>' + txt + '</span>';
  }
  function renderSlicers() {
    var ranges = [['week', 'هذا الأسبوع'], ['prev', 'الأسبوع الماضي'], ['d7', 'آخر 7 أيام'], ['d30', 'آخر 30 يوم'], ['custom', 'مخصص']];
    var rc = $('#rangeChips');
    if (rc) {
      rc.innerHTML = ranges.map(function (x) {
        return '<button class="slicer px-sm py-xs rounded-full border border-outline-variant text-body-sm ' +
          (state.range === x[0] ? 'on' : '') + '" data-range="' + x[0] + '">' + x[1] + '</button>';
      }).join('');
      $$('.slicer[data-range]', rc).forEach(function (b) {
        b.addEventListener('click', function () { state.range = b.getAttribute('data-range'); applyNotes(); renderAll(); });
      });
    }
    var bc = $('#branchChips');
    if (bc) {
      bc.innerHTML = BRANCHES.map(function (b) {
        return '<button class="slicer px-sm py-xs rounded-full border border-outline-variant text-body-sm ' +
          (state.branches.has(b.id) ? 'on' : '') + '" data-b="' + esc(b.id) + '">' + esc(b.short || b.name) + '</button>';
      }).join('');
      $$('.slicer[data-b]', bc).forEach(function (b) {
        b.addEventListener('click', function () {
          var k = b.getAttribute('data-b');
          if (state.branches.has(k)) state.branches.delete(k); else state.branches.add(k);
          if (!state.branches.size) state.branches.add(k);
          renderAll();
        });
      });
      var ab = $('#allBranches');
      if (ab) ab.addEventListener('click', function () {
        state.branches = new Set(BRANCHES.map(function (b) { return b.id; })); renderAll();
      });
    }
    var sc = $('#shiftChips');
    if (sc) {
      sc.innerHTML = [['all', 'كل الشفتات'], ['Morning', 'صباحي'], ['Evening', 'مسائي']].map(function (x) {
        return '<button class="slicer px-sm py-xs rounded-full border border-outline-variant text-body-sm ' +
          (state.shift === x[0] ? 'on' : '') + '" data-shift="' + x[0] + '">' + x[1] + '</button>';
      }).join('');
      $$('.slicer[data-shift]', sc).forEach(function (b) {
        b.addEventListener('click', function () { state.shift = b.getAttribute('data-shift'); renderAll(); });
      });
    }
    var r = resolveRange();
    var df = $('#dFrom'), dt = $('#dTo');
    if (df) df.value = r.from;
    if (dt) dt.value = r.to;
  }

  function renderKpis() {
    var r = resolveRange(), p = prevRange(r);
    var cur = agg(SRC.reports, r), prv = agg(SRC.reports, p);
    var curW = filterRows(SRC.waste, r, true, false);
    var prvW = filterRows(SRC.waste, p, true, false);
    var negsCur = filterRows(SRC.negs, r, true, false);
    var comp = compliance(r), compPrev = compliance(p);
    var att = filterRows(SRC.attendance, r, true, false);
    var visits = filterRows(SRC.visits, r, true, false);

    var cards = [
      { l: 'إجمالي المبيعات', i: 'payments', v: nf(cur.sales) + ' ر.س', p: nf(prv.sales) + ' ر.س', d: dlt(cur.sales, prv.sales), g: 'up', z: !prv.sales },
      { l: 'عدد الفواتير', i: 'receipt_long', v: nf(cur.orders), p: nf(prv.orders), d: dlt(cur.orders, prv.orders), g: 'up', z: !prv.orders },
      { l: 'متوسط الفاتورة', i: 'calculate', v: nf1(cur.avg) + ' ر.س', p: nf1(prv.avg) + ' ر.س', d: dlt(cur.avg, prv.avg), g: 'up', z: !prv.avg },
      { l: 'نسبة الالتزام بالتشيكلست', i: 'fact_check',
        v: comp ? comp.pct + '%' : '—', p: compPrev ? compPrev.pct + '%' : '—',
        d: comp && compPrev ? dlt(comp.pct, compPrev.pct) : null, g: 'up', z: false },
      { l: 'عدد الشكاوى', i: 'sentiment_dissatisfied', v: String(negsCur.length), p: '—', d: null, g: 'down', z: false },
      { l: 'سجلات الهدر', i: 'delete_sweep', v: curW.length + ' سجل', p: prvW.length + ' سجل', d: dlt(curW.length, prvW.length), g: 'down', z: !prvW.length },
      { l: 'الزيارات الإشرافية', i: 'travel_explore', v: String(visits.length), p: '—', d: null, g: 'up', z: false },
      { l: 'سجلات الحضور', i: 'how_to_reg', v: String(att.length), p: '—', d: null, g: 'up', z: false }
    ];
    var el = $('#kpis');
    if (!el) return;
    el.innerHTML = cards.map(function (c) {
      return '<div class="card p-md"><div class="flex items-center gap-xs text-body-sm text-on-surface-variant">' +
        '<span class="material-symbols-outlined text-[18px]">' + c.i + '</span>' + c.l + '</div>' +
        '<div class="font-display-lg text-primary mt-xs leading-none">' + c.v + '</div>' +
        '<div class="flex items-center justify-between mt-sm"><span class="text-body-sm text-on-surface-variant">السابق: ' + c.p + '</span>' +
        (c.d == null ? '' : deltaChip(c.d, c.g, c.z)) + '</div></div>';
    }).join('');
  }

  function renderCharts() {
    var r = resolveRange(), p = prevRange(r), days = dayList(r);
    var cur = days.map(function (d) {
      var rows = SRC.reports.filter(function (x) { return x.date === d && state.branches.has(x.branch) && (state.shift === 'all' || x.shiftType === state.shift); });
      return { d: d, v: rows.reduce(function (a, x) { return a + x.sales; }, 0) };
    });
    var prev = days.map(function (d) {
      var dp = dstr(new Date(parseD(d).getTime() - 7 * 86400000));
      var rows = SRC.reports.filter(function (x) { return x.date === dp && state.branches.has(x.branch) && (state.shift === 'all' || x.shiftType === state.shift); });
      return { d: dp, v: rows.reduce(function (a, x) { return a + x.sales; }, 0) };
    });
    if ($('#chartTrend')) lineChart($('#chartTrend'), cur.map(function (c) { return c.d; }), cur, prev);

    var wrows = filterRows(SRC.waste, r, true, false);
    /* الدائري يحسب عدد السجلات لكل سبب (بدون خلط وحدات القياس) —
       الكميات لكل وحدة تظهر مفصولة في محور 4. */
    var byReason = {};
    wrows.forEach(function (x) { var k = x.reason || 'غير محدد'; byReason[k] = (byReason[k] || 0) + 1; });
    if ($('#chartWaste')) donut($('#chartWaste'), Object.keys(byReason).map(function (k) {
      return { label: k, v: byReason[k] };
    }).sort(function (a, b) { return b.v - a.v; }));

    var bb = byBranch(SRC.reports, r), pb = byBranch(SRC.reports, p);
    var pmap = {}; pb.forEach(function (x) { pmap[x.id] = x.sales; });
    if ($('#chartBranch')) barCompare($('#chartBranch'), bb.map(function (b) {
      return { label: b.name, v: b.sales, p: pmap[b.id] || 0, key: b.id };
    }), function (k) { state.drill = k; state.tab = 1; renderTabs(); renderPanes();
      var pn = $('#panes'); if (pn) global.scrollTo({ top: pn.offsetTop - 80, behavior: 'smooth' }); });

    var tpl = complianceByTemplate(r);
    if ($('#chartChecks')) {
      bars($('#chartChecks'), tpl.map(function (t) {
        return { label: t.title, done: t.done, total: t.total };
      }));
    }
  }

  /* ══════════ التبويبات ══════════ */
  var TAB_NAMES = ['1. أداء الفروع والمبيعات', '2. الرقابة التشغيلية', '3. شكاوى العملاء',
                   '4. الهدر والمخزون', '5. الموظفون والمعدات', '6. خطة الأسبوع القادم'];

  function renderTabs() {
    var t = $('#tabs');
    if (!t) return;
    t.innerHTML = TAB_NAMES.map(function (n, i) {
      return '<button class="tabbtn px-md py-xs rounded-full border border-outline-variant text-body-sm ' +
        (state.tab === i + 1 ? 'on' : '') + '" data-tab="' + (i + 1) + '">' + n + '</button>';
    }).join('');
    $$('.tabbtn', t).forEach(function (b) {
      b.addEventListener('click', function () { state.tab = +b.getAttribute('data-tab'); renderTabs(); renderPanes(); });
    });
  }

  /* ───────── محور 1 ───────── */
  function pane1() {
    var r = resolveRange(), p = prevRange(r);
    var cur = byBranch(SRC.reports, r), prv = byBranch(SRC.reports, p);
    var pmap = {}; prv.forEach(function (x) { pmap[x.id] = x; });
    var totals = { sales: 0, orders: 0, psales: 0, porders: 0 };
    cur.forEach(function (b) { totals.sales += b.sales; totals.orders += b.orders; });
    prv.forEach(function (b) { totals.psales += b.sales; totals.porders += b.orders; });
    var best = cur.slice().sort(function (a, b) { return b.sales - a.sales; })[0];
    var worst = cur.filter(function (b) { return b.shifts > 0; }).sort(function (a, b) { return a.sales - b.sales; })[0];
    var drill = state.drill ? cur.filter(function (b) { return b.id === state.drill; })[0] : null;

    var rows = cur.map(function (b) {
      var pb = pmap[b.id] || { sales: 0, orders: 0, avg: 0 };
      return '<tr class="border-b border-outline-variant ' + (state.drill === b.id ? 'bg-secondary-container' : '') + '">' +
        '<td class="px-md py-sm font-semibold">' + esc(b.name) + '</td>' +
        '<td class="px-md py-sm">' + nf(b.orders) + '</td>' +
        '<td class="px-md py-sm">' + (b.orders ? deltaChip(dlt(b.orders, pb.orders), 'up') : '<span class="text-on-surface-variant">—</span>') + '</td>' +
        '<td class="px-md py-sm">' + nf(b.sales) + '</td>' +
        '<td class="px-md py-sm">' + (pb.sales ? deltaChip(dlt(b.sales, pb.sales), 'up') : '<span class="text-on-surface-variant">—</span>') + '</td>' +
        '<td class="px-md py-sm">' + nf1(b.avg) + '</td>' +
        '<td class="px-md py-sm">' + (pb.avg ? deltaChip(dlt(b.avg, pb.avg), 'up') : '<span class="text-on-surface-variant">—</span>') + '</td>' +
        '<td class="px-md py-sm text-on-surface-variant">' + b.shifts + ' شفت</td></tr>';
    }).join('');

    var detail = '';
    if (drill) {
      var lines = SRC.reports.filter(function (x) { return inRange(x.date, r) && x.branch === drill.id; })
        .map(function (x) { return x.date + ' — ' + (x.shiftType === 'Morning' ? 'صباحي' : 'مسائي') + ' — ' + nf(x.orders) + ' فاتورة — ' + nf(x.sales) + ' ر.س — ' + esc(x.supervisor); }).join('<br>');
      detail = '<div class="bg-surface-container rounded-lg p-md"><div class="font-label-bold text-on-surface-variant">تفصيل الفرع — ' + esc(drill.name) + '</div>' +
        '<div class="text-body-sm mt-1">' + (lines || 'لا توجد صفوف') + '</div></div>';
    }

    return '<div class="card overflow-hidden fadein"><div class="bg-primary text-on-primary px-md py-sm font-title-md">1. أداء الفروع والمبيعات</div>' +
      '<div class="p-md space-y-md"><div class="overflow-x-auto"><table class="w-full text-body-sm">' +
      '<thead><tr class="bg-surface-container text-on-surface-variant">' +
      '<th class="text-right px-md py-sm font-label-bold">الفرع</th><th class="text-right px-md py-sm font-label-bold">عدد الفواتير</th>' +
      '<th class="text-right px-md py-sm font-label-bold">المقارنة</th><th class="text-right px-md py-sm font-label-bold">المبيعات ر.س</th>' +
      '<th class="text-right px-md py-sm font-label-bold">المقارنة</th><th class="text-right px-md py-sm font-label-bold">متوسط الفاتورة</th>' +
      '<th class="text-right px-md py-sm font-label-bold">المقارنة</th><th class="text-right px-md py-sm font-label-bold">عدد الشفتات</th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="8" class="px-md py-lg text-center text-on-surface-variant">لا توجد بيانات</td></tr>') + '</tbody>' +
      '<tfoot class="bg-surface-container font-bold"><tr><td class="px-md py-sm">الإجمالي</td>' +
      '<td class="px-md py-sm">' + nf(totals.orders) + '</td><td class="px-md py-sm">' + deltaChip(dlt(totals.orders, totals.porders), 'up') + '</td>' +
      '<td class="px-md py-sm">' + nf(totals.sales) + '</td><td class="px-md py-sm">' + deltaChip(dlt(totals.sales, totals.psales), 'up') + '</td>' +
      '<td class="px-md py-sm">' + nf1(totals.orders ? totals.sales / totals.orders : 0) + '</td><td class="px-md py-sm">—</td>' +
      '<td class="px-md py-sm"></td></tr></tfoot></table></div>' +
      '<div class="grid md:grid-cols-2 gap-md">' +
      '<div class="border-2 border-tertiary-container rounded-lg p-md bg-tertiary-container/5"><div class="font-title-md text-tertiary-container flex items-center gap-xs"><span class="material-symbols-outlined">trending_up</span> أفضل فرع أداءً</div>' +
      '<div class="font-title-md text-primary mt-xs">' + (best ? esc(best.name) : '—') + '</div>' +
      '<div class="mt-sm"><label class="font-label-bold text-on-surface-variant">سبب التميز</label><div class="text-body-sm mt-1" data-edit="bestReason">' +
      (best ? 'إجمالي مبيعات ' + nf(best.sales) + ' ر.س على ' + nf(best.orders) + ' فاتورة، بمتوسط ' + nf1(best.avg) + ' ر.س — أعلى نسبة بين الفروع في الفترة.' : 'لا توجد بيانات كافية.') +
      '</div></div></div>' +
      '<div class="border-2 border-error-container rounded-lg p-md bg-error-container/20"><div class="font-title-md text-error flex items-center gap-xs"><span class="material-symbols-outlined">trending_down</span> أقل فرع أداءً + خطة التحسين</div>' +
      '<div class="font-title-md text-primary mt-xs">' + (worst ? esc(worst.name) : '—') + '</div>' +
      '<div class="mt-sm"><label class="font-label-bold text-on-surface-variant">سبب القصور</label><div class="text-body-sm mt-1" data-edit="worstReason">' +
      (worst ? 'مبيعات ' + nf(worst.sales) + ' ر.س على ' + nf(worst.orders) + ' فاتورة (' + worst.shifts + ' شفت مسجلة فقط) — راجع تغطية الورديات أولاً قبل الحكم على الأداء.' : 'لا توجد بيانات كافية.') +
      '</div></div><div class="grid grid-cols-3 gap-sm mt-sm">' +
      '<div><label class="font-label-bold text-on-surface-variant">الإجراء التصحيحي</label><div class="text-body-sm mt-1" data-edit="worstAction">—</div></div>' +
      '<div><label class="font-label-bold text-on-surface-variant">المسؤول</label><div class="text-body-sm mt-1" data-edit="worstOwner">—</div></div>' +
      '<div><label class="font-label-bold text-on-surface-variant">الموعد</label><div class="text-body-sm mt-1" data-edit="worstDue">—</div></div>' +
      '</div></div></div>' + detail + '</div></div>';
  }

  /* ───────── محور 2 ───────── */
  function pane2() {
    var r = resolveRange();
    var cur = agg(SRC.reports, r);
    var issues = filterRows(SRC.issues, r, true, false);
    var visits = filterRows(SRC.visits, r, true, false);
    var comp = compliance(r);
    var tpl = complianceByTemplate(r);

    var teamEntries = {};
    cur.rows.forEach(function (x) { if (x.team) teamEntries[x.team] = (teamEntries[x.team] || 0) + 1; });
    var teamRows = Object.keys(teamEntries).map(function (k) {
      var v = teamEntries[k];
      return '<tr class="border-b border-outline-variant"><td class="px-md py-sm font-semibold">' + esc(k) + '</td>' +
        '<td class="px-md py-sm">' + v + '</td><td class="px-md py-sm">' + (v / (cur.rows.length || 1) * 100).toFixed(0) + '%</td></tr>';
    }).join('');

    var visitRows = visits.map(function (v) {
      return '<tr class="border-b border-outline-variant"><td class="px-md py-sm">' + esc(v.date) + '</td>' +
        '<td class="px-md py-sm">' + esc(branchName(v.branch)) + '</td>' +
        '<td class="px-md py-sm">' + esc(v.visitor || '—') + '</td>' +
        '<td class="px-md py-sm font-bold">' + (v.score ? v.score + '%' : '—') + '</td>' +
        '<td class="px-md py-sm text-on-surface-variant">' + esc(v.observation || '—') + '</td>' +
        '<td class="px-md py-sm">' + esc(v.action || '—') + '</td>' +
        '<td class="px-md py-sm">' + esc(v.owner || '—') + '</td>' +
        '<td class="px-md py-sm">' + esc(v.due || '—') + '</td>' +
        '<td class="px-md py-sm">' + esc(v.status) + '</td></tr>';
    }).join('');

    var issueRows = issues.slice(0, 25).map(function (i) {
      return '<tr class="border-b border-outline-variant"><td class="px-md py-sm">' + esc(i.date) + '</td>' +
        '<td class="px-md py-sm">' + esc(branchName(i.branch)) + '</td>' +
        '<td class="px-md py-sm">' + esc(i.type || '—') + '</td>' +
        '<td class="px-md py-sm text-on-surface-variant">' + esc(i.desc) + '</td>' +
        '<td class="px-md py-sm">' + esc(i.priority || '—') + '</td>' +
        '<td class="px-md py-sm">' + esc(i.action || '—') + '</td>' +
        '<td class="px-md py-sm" data-edit="issueOwner">—</td><td class="px-md py-sm" data-edit="issueDue">—</td></tr>';
    }).join('');

    return '<div class="card overflow-hidden fadein"><div class="bg-primary text-on-primary px-md py-sm font-title-md">2. الرقابة التشغيلية</div>' +
      '<div class="p-md space-y-md"><div class="grid md:grid-cols-4 gap-md">' +
      '<div class="bg-surface-container rounded-lg p-md"><div class="text-body-sm text-on-surface-variant">عدد الزيارات الإشرافية</div><div class="font-display-lg text-primary mt-xs">' + visits.length + '</div></div>' +
      '<div class="bg-surface-container rounded-lg p-md"><div class="text-body-sm text-on-surface-variant">الشفتات المفحوصة</div><div class="font-display-lg text-primary mt-xs">' + cur.count + '</div></div>' +
      '<div class="bg-surface-container rounded-lg p-md"><div class="text-body-sm text-on-surface-variant">نسبة الالتزام (مستحقة ÷ منفذة)</div><div class="font-display-lg text-primary mt-xs">' +
      (comp ? comp.pct + '%' : '—') + (comp ? '<div class="text-body-sm text-on-surface-variant">' + comp.done + '/' + comp.expected + ' مهمة</div>' : '') + '</div></div>' +
      '<div class="bg-error-container/30 rounded-lg p-md"><div class="text-body-sm text-on-error-container">مهام مُعلّمة (Flagged)</div><div class="font-display-lg text-error mt-xs">' + (comp ? comp.flagged : 0) + '</div></div>' +
      '</div>' +
      '<div><div class="font-title-md text-primary mb-xs">نسبة الالتزام لكل مهمة من قوالب التشيك ليست</div><div id="paneChecks"></div>' +
      (tpl.length ? '' : '<p class="text-body-sm text-on-surface-variant mt-xs">لا توجد قوالب مهام مسندة أو سجلات تنفيذ في هذه الفترة.</p>') + '</div>' +
      '<div><div class="font-title-md text-primary mb-xs">نتائج الزيارات الإشرافية</div><div class="overflow-x-auto"><table class="w-full text-body-sm">' +
      '<thead><tr class="bg-surface-container text-on-surface-variant"><th class="text-right px-md py-sm font-label-bold">التاريخ</th>' +
      '<th class="text-right px-md py-sm font-label-bold">الفرع</th><th class="text-right px-md py-sm font-label-bold">المشرف</th>' +
      '<th class="text-right px-md py-sm font-label-bold">التقييم</th><th class="text-right px-md py-sm font-label-bold">الملاحظة</th>' +
      '<th class="text-right px-md py-sm font-label-bold">الإجراء التصحيحي</th><th class="text-right px-md py-sm font-label-bold">المسؤول</th>' +
      '<th class="text-right px-md py-sm font-label-bold">الموعد</th><th class="text-right px-md py-sm font-label-bold">الحالة</th></tr></thead><tbody>' +
      (visitRows || '<tr><td colspan="9" class="px-md py-lg text-center text-on-surface-variant">لا توجد زيارات مسجلة — تُسجَّل في جدول supervisory_visits</td></tr>') +
      '</tbody></table></div></div>' +
      '<div><div class="font-title-md text-primary mb-xs">أبرز الملاحظات والمخالفات التشغيلية</div><div class="overflow-x-auto"><table class="w-full text-body-sm">' +
      '<thead><tr class="bg-surface-container text-on-surface-variant"><th class="text-right px-md py-sm font-label-bold">التاريخ</th>' +
      '<th class="text-right px-md py-sm font-label-bold">الفرع</th><th class="text-right px-md py-sm font-label-bold">النوع</th>' +
      '<th class="text-right px-md py-sm font-label-bold">الوصف</th><th class="text-right px-md py-sm font-label-bold">الأولوية</th>' +
      '<th class="text-right px-md py-sm font-label-bold">الإجراء المتخذ</th><th class="text-right px-md py-sm font-label-bold">المسؤول</th>' +
      '<th class="text-right px-md py-sm font-label-bold">الموعد</th></tr></thead><tbody>' +
      (issueRows || '<tr><td colspan="8" class="px-md py-lg text-center text-on-surface-variant">لا توجد ملاحظات مسجلة في هذه الفترة</td></tr>') +
      '</tbody></table></div></div>' +
      '<div><div class="font-title-md text-primary mb-xs">تقييم حالة أداء الفريق</div><table class="w-full text-body-sm">' +
      '<thead><tr class="bg-surface-container text-on-surface-variant"><th class="text-right px-md py-sm font-label-bold">التقييم</th>' +
      '<th class="text-right px-md py-sm font-label-bold">عدد الشفتات</th><th class="text-right px-md py-sm font-label-bold">النسبة</th></tr></thead>' +
      '<tbody>' + (teamRows || '<tr><td colspan="3" class="px-md py-lg text-center text-on-surface-variant">لا توجد بيانات</td></tr>') + '</tbody></table></div>' +
      '</div></div>';
  }

  /* ───────── محور 3 ───────── */
  function pane3() {
    var r = resolveRange();
    var negs = filterRows(SRC.negs, r, true, false);
    var posTotal = filterRows(SRC.reports, r, true, true).reduce(function (a, x) { return a + x.pos; }, 0);
    var closed = negs.filter(function (n) { return /مغلقة|معالجة|تم/.test(n.status); }).length;
    var pending = negs.length - closed;

    var rows = BRANCHES.map(function (b) {
      var mine = negs.filter(function (x) { return x.branch === b.id; });
      var cl = mine.filter(function (n) { return /مغلقة|معالجة|تم/.test(n.status); }).length;
      return '<tr class="border-b border-outline-variant"><td class="px-md py-sm font-semibold">' + esc(b.name) + '</td>' +
        '<td class="px-md py-sm">' + mine.length + '</td>' +
        '<td class="px-md py-sm text-tertiary-container font-bold">' + cl + '</td>' +
        '<td class="px-md py-sm text-error font-bold">' + (mine.length - cl) + '</td>' +
        '<td class="px-md py-sm">' + posTotal + '</td>' +
        '<td class="px-md py-sm text-on-surface-variant">' + esc(mine.slice(0, 2).map(function (x) { return x.text; }).join(' | ') || '—') + '</td>' +
        '<td class="px-md py-sm" data-edit="complAction-' + b.id + '">—</td></tr>';
    }).join('');

    return '<div class="card overflow-hidden fadein"><div class="bg-primary text-on-primary px-md py-sm font-title-md">3. شكاوى العملاء</div>' +
      '<div class="p-md space-y-md"><div class="grid md:grid-cols-4 gap-md">' +
      '<div class="bg-surface-container rounded-lg p-md"><div class="text-body-sm text-on-surface-variant">عدد الشكاوى</div><div class="font-display-lg text-primary mt-xs">' + negs.length + '</div></div>' +
      '<div class="bg-tertiary-container/15 rounded-lg p-md"><div class="text-body-sm text-tertiary-container">تمت معالجتها</div><div class="font-display-lg text-tertiary-container mt-xs">' + closed + '</div></div>' +
      '<div class="bg-error-container/40 rounded-lg p-md"><div class="text-body-sm text-on-error-container">معلقة</div><div class="font-display-lg text-error mt-xs">' + pending + '</div></div>' +
      '<div class="bg-surface-container rounded-lg p-md"><div class="text-body-sm text-on-surface-variant">تقييمات إيجابية (جوجل)</div><div class="font-display-lg text-primary mt-xs">' + posTotal + '</div></div>' +
      '</div><div class="overflow-x-auto"><table class="w-full text-body-sm">' +
      '<thead><tr class="bg-surface-container text-on-surface-variant"><th class="text-right px-md py-sm font-label-bold">الفرع</th>' +
      '<th class="text-right px-md py-sm font-label-bold">عدد الشكاوى</th><th class="text-right px-md py-sm font-label-bold">تمت معالجتها</th>' +
      '<th class="text-right px-md py-sm font-label-bold">معلقة</th><th class="text-right px-md py-sm font-label-bold">تقييمات إيجابية</th>' +
      '<th class="text-right px-md py-sm font-label-bold">أبرز التعليقات</th><th class="text-right px-md py-sm font-label-bold">إجراء تحسين التجربة</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="bg-surface-container rounded-lg p-md"><label class="font-label-bold text-on-surface-variant">إجراءات تحسين تجربة العملاء المتخذة</label>' +
      '<div class="text-body-sm mt-1" data-edit="cxAction">—</div></div></div></div>';
  }

  /* ───────── محور 4 ───────── */
  function pane4() {
    var r = resolveRange();
    var w = filterRows(SRC.waste, r, true, false);
    /* تجميع منفصل حسب وحدة القياس: لا نخلط جراماً بلتر أو قطعة.
       المفتاح = (الاسم + الوحدة) والقيمة = الكمية. */
    var byItem = {}, byReason = {}, byRoot = {}, itemUnit = {}, reasonUnit = {}, rootUnit = {};
    var cost = 0, hasCost = false;
    w.forEach(function (x) {
      var u = x.unit || 'غير محدد';
      var k = x.item || 'غير محدد';
      var ik = k + '|' + u;
      byItem[ik] = (byItem[ik] || 0) + (x.qty || 0); itemUnit[ik] = u;
      var rk = x.reason || 'غير محدد';
      var rku = rk + '|' + u;
      byReason[rku] = (byReason[rku] || 0) + (x.qty || 0); reasonUnit[rku] = u;
      if (x.rootCause) {
        var rck = x.rootCause + '|' + u;
        byRoot[rck] = (byRoot[rck] || 0) + (x.qty || 0); rootUnit[rck] = u;
      }
      if (x.unitCost) { hasCost = true; cost += (x.qty || 0) * x.unitCost; }
    });
    /* ترتيب البنود داخل كل وحدة على حدة */
    var itemsByUnit = {};
    Object.keys(byItem).forEach(function (k) {
      var u = itemUnit[k];
      (itemsByUnit[u] = itemsByUnit[u] || []).push([k.split('|')[0], byItem[k], u]);
    });
    Object.keys(itemsByUnit).forEach(function (u) {
      itemsByUnit[u].sort(function (a, b) { return b[1] - a[1]; });
      itemsByUnit[u] = itemsByUnit[u].slice(0, 12);
    });
    var topItems = [];
    Object.keys(itemsByUnit).forEach(function (u) {
      itemsByUnit[u].forEach(function (row) { topItems.push(row); });
    });
    var barsHtml = Object.keys(itemsByUnit).map(function (u) {
      var maxV = Math.max.apply(null, [1].concat(itemsByUnit[u].map(function (x) { return x[1]; })));
      return '<div class="mb-sm"><div class="font-label-bold text-on-surface-variant mb-xs">وحدة القياس: ' + esc(u) + '</div>' +
        itemsByUnit[u].map(function (x) {
          return '<div class="mb-xs"><div class="flex justify-between text-body-sm"><span>' + esc(x[0]) + '</span><span class="font-bold">' + nf(x[1]) + ' ' + esc(x[2]) + '</span></div>' +
            '<div class="h-2 bg-surface-container-high rounded-full overflow-hidden"><div class="h-full bg-primary" style="width:' + (x[1] / maxV * 100) + '%"></div></div></div>';
        }).join('') + '</div>';
    }).join('');
    var topItem = topItems.length ? topItems.slice().sort(function (a, b) { return b[1] - a[1]; })[0] : null;

    // ترتيب مستقل داخل كل فرع AND كل وحدة قياس؛ لا تتم مقارنة الجرام باللتر أو القطعة.
    var shiftUnits = {};
    w.forEach(function (x) {
      var branch = x.branch || 'غير محدد', shift = x.shiftType || 'غير محدد', unit = x.unit || 'غير محدد';
      var key = branch + '|' + shift + '|' + unit;
      if (!shiftUnits[key]) shiftUnits[key] = { branch: branch, shift: shift, unit: unit, qty: 0, records: 0, items: {} };
      shiftUnits[key].qty += x.qty || 0;
      shiftUnits[key].records++;
      shiftUnits[key].items[x.item || 'غير محدد'] = (shiftUnits[key].items[x.item || 'غير محدد'] || 0) + (x.qty || 0);
    });
    /* topShiftsByBranch[branch][unit] = أعلى 3 شفتات داخل those الوحدة */
    var topShiftsByBranch = {};
    Object.keys(shiftUnits).forEach(function (key) {
      var s = shiftUnits[key];
      var byUnit = topShiftsByBranch[s.branch] || (topShiftsByBranch[s.branch] = {});
      (byUnit[s.unit] = byUnit[s.unit] || []).push(s);
    });
    Object.keys(topShiftsByBranch).forEach(function (branch) {
      var byUnit = topShiftsByBranch[branch];
      Object.keys(byUnit).forEach(function (unit) {
        byUnit[unit].sort(function (a, b) { return b.qty - a.qty; });
        byUnit[unit] = byUnit[unit].slice(0, 3);   /* أعلى 3 شفتات لكل فرع/وحدة */
      });
    });
    var shiftWasteHtml = BRANCHES.map(function (b) {
      var byUnit = topShiftsByBranch[b.id] || {};
      var units = Object.keys(byUnit);
      return '<div class="bg-surface-container rounded-lg p-md"><div class="font-title-md text-primary mb-sm">' + esc(b.name) + '</div>' +
        (units.length ? units.map(function (u) {
          return '<div class="mb-sm"><div class="font-label-bold text-on-surface-variant mb-xs">وحدة القياس: ' + esc(u) + '</div>' +
            byUnit[u].map(function (s) {
              var top = Object.keys(s.items).sort(function (a, z) { return s.items[z] - s.items[a]; })[0];
              return '<div class="border-b border-outline-variant py-sm last:border-0"><div class="flex justify-between gap-2 text-body-sm"><span class="font-semibold">' + esc(s.shift) + '</span><span class="font-bold">' + nf(s.qty) + ' ' + esc(s.unit) + '</span></div><div class="text-body-sm text-on-surface-variant">' + s.records + ' سجل · الأكثر: ' + esc(top || '—') + '</div></div>';
            }).join('') + '</div>';
        }).join('') : '<div class="text-body-sm text-on-surface-variant">لا توجد بيانات شفت لهذا الفرع</div>') + '</div>';
    }).join('');

    var rows = w.slice(0, 60).map(function (x) {
      return '<tr class="border-b border-outline-variant"><td class="px-md py-sm">' + esc(x.date) + '</td>' +
        '<td class="px-md py-sm">' + esc(branchName(x.branch)) + '</td>' +
        '<td class="px-md py-sm font-semibold">' + esc(x.item) + '</td>' +
        '<td class="px-md py-sm">' + nf(x.qty) + ' ' + esc(x.unit) + '</td>' +
        '<td class="px-md py-sm text-on-surface-variant">' + esc(x.reason) + '</td>' +
        '<td class="px-md py-sm text-on-surface-variant">' + esc(x.rootCause || '—') + '</td>' +
        '<td class="px-md py-sm">' + esc(x.action || '—') + '</td>' +
        '<td class="px-md py-sm">' + (x.unitCost ? nf2(x.qty * x.unitCost) + ' ر.س' : '—') + '</td></tr>';
    }).join('');

    return '<div class="card overflow-hidden fadein"><div class="bg-primary text-on-primary px-md py-sm font-title-md">4. الهدر والمخزون</div>' +
      '<div class="p-md space-y-md"><div class="grid md:grid-cols-4 gap-md">' +
      '<div class="bg-surface-container rounded-lg p-md"><div class="text-body-sm text-on-surface-variant">سجلات الهدر في الفترة</div><div class="font-display-lg text-primary mt-xs">' + w.length + '</div></div>' +
      '<div class="bg-surface-container rounded-lg p-md"><div class="text-body-sm text-on-surface-variant">أصناف متأثرة</div><div class="font-display-lg text-primary mt-xs">' + (function () {
        var s = {}; w.forEach(function (x) { s[x.item || 'غير محدد'] = 1; }); return Object.keys(s).length;
      })() + '</div></div>' +
      '<div class="bg-surface-container rounded-lg p-md"><div class="text-body-sm text-on-surface-variant">قيمة الهدر (بالريال)</div><div class="font-display-lg text-primary mt-xs">' +
      (hasCost ? nf2(cost) + ' ر.س' : 'تحتاج تكلفة الوحدة') + '</div></div>' +
      '<div class="bg-surface-container rounded-lg p-md"><div class="text-body-sm text-on-surface-variant">أعلى صنف</div><div class="font-body-lg font-bold text-primary mt-xs">' + (topItem ? esc(topItem[0]) + ' (' + esc(topItem[2]) + ')' : '—') + '</div></div>' +
      '</div><div class="grid md:grid-cols-3 gap-md">' +
      '<div class="bg-surface-container rounded-lg p-md"><div class="font-title-md text-primary mb-sm">أعلى الأصناف هدراً</div>' + (barsHtml || '<div class="text-body-sm text-on-surface-variant">لا توجد بيانات</div>') + '</div>' +
      '<div class="bg-surface-container rounded-lg p-md"><div class="font-title-md text-primary mb-sm">توزيع الأسباب</div>' +
      (Object.keys(byReason).sort(function (a, b) { return byReason[b] - byReason[a]; }).map(function (k) {
        return '<div class="flex justify-between text-body-sm py-xs border-b border-outline-variant"><span>' + esc(k.split('|')[0]) + '</span><span class="font-bold">' + nf(byReason[k]) + ' ' + esc(reasonUnit[k]) + '</span></div>';
      }).join('') || '<div class="text-body-sm text-on-surface-variant">لا توجد بيانات</div>') + '</div>' +
      '<div class="bg-surface-container rounded-lg p-md"><div class="font-title-md text-primary mb-sm">الأسباب الجذرية</div>' +
      (Object.keys(byRoot).sort(function (a, b) { return byRoot[b] - byRoot[a]; }).map(function (k) {
        return '<div class="flex justify-between text-body-sm py-xs border-b border-outline-variant"><span>' + esc(k.split('|')[0]) + '</span><span class="font-bold">' + nf(byRoot[k]) + ' ' + esc(rootUnit[k]) + '</span></div>';
      }).join('') || '<div class="text-body-sm text-on-surface-variant">لم تُسجَّل أسباب جذرية بعد (root_cause)</div>') + '</div>' +
      '</div><div><div class="font-title-md text-primary mb-sm">أعلى 3 شفتات هدراً داخل كل فرع</div><p class="text-body-sm text-on-surface-variant mb-sm">الترتيب منفصل حسب وحدة القياس (جرام/لتر/قطعة) — لا تتم مقارنة الجرام باللتر أو القطعة.</p><div class="grid md:grid-cols-2 xl:grid-cols-3 gap-md">' + shiftWasteHtml + '</div></div>' +
      '<div class="border-2 border-error-container rounded-lg p-md bg-error-container/20"><label class="font-label-bold text-on-error-container">أثر نفاد المنتجات على التشغيل</label>' +
      '<div class="text-body-sm mt-1" data-edit="stockImpact">—</div></div>' +
      '<div class="overflow-x-auto"><table class="w-full text-body-sm">' +
      '<thead><tr class="bg-surface-container text-on-surface-variant"><th class="text-right px-md py-sm font-label-bold">التاريخ</th>' +
      '<th class="text-right px-md py-sm font-label-bold">الفرع</th><th class="text-right px-md py-sm font-label-bold">الصنف</th>' +
      '<th class="text-right px-md py-sm font-label-bold">الكمية</th><th class="text-right px-md py-sm font-label-bold">السبب</th>' +
      '<th class="text-right px-md py-sm font-label-bold">السبب الجذري</th><th class="text-right px-md py-sm font-label-bold">الإجراء التصحيحي</th>' +
      '<th class="text-right px-md py-sm font-label-bold">قيمة الهدر</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="8" class="px-md py-lg text-center text-on-surface-variant">لا توجد سجلات هدر في هذه الفترة</td></tr>') +
      '</tbody></table></div></div></div>';
  }

  /* ───────── محور 5 ───────── */
  function pane5() {
    var r = resolveRange();
    var rows = filterRows(SRC.reports, r, true, true);
    var issues = filterRows(SRC.issues, r, true, false);
    var att = filterRows(SRC.attendance, r, true, false);
    var equip = issues.filter(function (i) { return /عطل|معدات|ماكينة|جهاز|تكييف|ثلاجة|grinder|espresso/i.test((i.type || '') + (i.desc || '')); });
    var staff = issues.filter(function (i) { return /موظف|غياب|نقص|تغطية|دوام|استقالة/i.test((i.type || '') + (i.desc || '')); });

    var attByBranch = {};
    att.forEach(function (a) {
      var b = attByBranch[a.branch] || (attByBranch[a.branch] = { present: 0, absent: 0, late: 0, other: 0 });
      if (a.status === 'حاضر') b.present++;
      else if (a.status === 'غائب') b.absent++;
      else if (a.status === 'متأخر') b.late++;
      else b.other++;
    });
    var attRows = BRANCHES.map(function (b) {
      var a = attByBranch[b.id] || { present: 0, absent: 0, late: 0, other: 0 };
      var tot = a.present + a.absent + a.late + a.other;
      var rate = tot ? Math.round(a.present / tot * 100) : null;
      return '<tr class="border-b border-outline-variant"><td class="px-md py-sm font-semibold">' + esc(b.name) + '</td>' +
        '<td class="px-md py-sm">' + (rate == null ? '—' : rate + '%') + '</td>' +
        '<td class="px-md py-sm">' + a.present + '</td>' +
        '<td class="px-md py-sm text-error font-bold">' + (a.absent || '—') + '</td>' +
        '<td class="px-md py-sm text-on-surface-variant">' + (a.late || '—') + '</td></tr>';
    }).join('');

    var teamRows = BRANCHES.map(function (b) {
      var rs = rows.filter(function (x) { return x.branch === b.id; });
      var ts = {};
      rs.forEach(function (x) { if (x.team) ts[x.team] = (ts[x.team] || 0) + 1; });
      var bad = ts['🔴 سيء'] || 0;
      function mine(arr) {
        var m = arr.filter(function (i) { return i.branch === b.id; });
        return m.length ? esc(m[0].desc) : '—';
      }
      return '<tr class="border-b border-outline-variant"><td class="px-md py-sm font-semibold">' + esc(b.name) + '</td>' +
        '<td class="px-md py-sm">' + rs.length + ' شفت</td>' +
        '<td class="px-md py-sm">' + (Object.keys(ts).map(function (k) { return esc(k) + ': ' + ts[k]; }).join(' · ') || '—') + '</td>' +
        '<td class="px-md py-sm ' + (bad ? 'text-error font-bold' : '') + '">' + (bad || '—') + '</td>' +
        '<td class="px-md py-sm">' + mine(equip) + '</td>' +
        '<td class="px-md py-sm">' + mine(staff) + '</td>' +
        '<td class="px-md py-sm" data-edit="need-' + b.id + '">—</td></tr>';
    }).join('');

    return '<div class="card overflow-hidden fadein"><div class="bg-primary text-on-primary px-md py-sm font-title-md">5. الموظفون والمعدات</div>' +
      '<div class="p-md space-y-md"><div class="grid md:grid-cols-4 gap-md">' +
      '<div class="bg-surface-container rounded-lg p-md"><div class="text-body-sm text-on-surface-variant">إجمالي الشفتات</div><div class="font-display-lg text-primary mt-xs">' + rows.length + '</div></div>' +
      '<div class="bg-surface-container rounded-lg p-md"><div class="text-body-sm text-on-surface-variant">مشاكل مرتبطة بالمعدات</div><div class="font-display-lg text-primary mt-xs">' + equip.length + '</div></div>' +
      '<div class="bg-surface-container rounded-lg p-md"><div class="text-body-sm text-on-surface-variant">مشاكل مرتبطة بالكادر</div><div class="font-display-lg text-primary mt-xs">' + staff.length + '</div></div>' +
      '<div class="bg-secondary-container rounded-lg p-md"><div class="text-body-sm text-on-secondary-container">سجلات الحضور</div><div class="font-display-lg text-primary mt-xs">' + att.length + '</div></div>' +
      '</div>' +
      '<div><div class="font-title-md text-primary mb-xs">الحضور والغياب</div>' +
      (att.length ? '<div class="overflow-x-auto"><table class="w-full text-body-sm">' +
        '<thead><tr class="bg-surface-container text-on-surface-variant"><th class="text-right px-md py-sm font-label-bold">الفرع</th>' +
        '<th class="text-right px-md py-sm font-label-bold">نسبة الحضور</th><th class="text-right px-md py-sm font-label-bold">حاضر</th>' +
        '<th class="text-right px-md py-sm font-label-bold">غائب</th><th class="text-right px-md py-sm font-label-bold">متأخر</th></tr></thead>' +
        '<tbody>' + attRows + '</tbody></table></div>'
        : '<p class="text-body-sm text-on-surface-variant">لا توجد سجلات حضور — تُسجَّل في جدول attendance_records (شُغّل SQL v2 أولاً).</p>') +
      '</div>' +
      '<div class="overflow-x-auto"><table class="w-full text-body-sm">' +
      '<thead><tr class="bg-surface-container text-on-surface-variant"><th class="text-right px-md py-sm font-label-bold">الفرع</th>' +
      '<th class="text-right px-md py-sm font-label-bold">تغطية الشفتات</th><th class="text-right px-md py-sm font-label-bold">تقييم أداء الفريق</th>' +
      '<th class="text-right px-md py-sm font-label-bold">تقييمات سلبية</th><th class="text-right px-md py-sm font-label-bold">أبرز عطل</th>' +
      '<th class="text-right px-md py-sm font-label-bold">أبرز نقص كوادر</th><th class="text-right px-md py-sm font-label-bold">الاحتياج الذي يتطلب تدخل الإدارة</th></tr></thead>' +
      '<tbody>' + teamRows + '</tbody></table></div>' +
      '<div class="bg-surface-container rounded-lg p-md"><label class="font-label-bold text-on-surface-variant">تنسيق مع قسم التدريب</label>' +
      '<div class="text-body-sm mt-1" data-edit="training">—</div></div></div></div>';
  }

  /* ───────── محور 6 ───────── */
  function pane6() {
    var r = resolveRange();
    var weekStart = r.from;
    var existing = (SRC.plans || []).filter(function (p) { return p.weekStart === weekStart; });
    var byRow = {};
    existing.forEach(function (p) { byRow[p.rowNo] = p; });
    var maxRow = Math.max(7, existing.length);

    var rows = '';
    for (var i = 1; i <= maxRow; i++) {
      var p = byRow[i] || {};
      rows += '<tr class="border-b border-outline-variant" data-plan-row="' + i + '">' +
        '<td class="px-md py-sm text-on-surface-variant">' + i + '</td>' +
        '<td class="px-md py-sm"><span data-plan="objective" contenteditable="true">' + esc(p.objective || '') + '</span></td>' +
        '<td class="px-md py-sm"><span data-plan="scope" contenteditable="true">' + esc(p.scope || '') + '</span></td>' +
        '<td class="px-md py-sm"><span data-plan="kpi" contenteditable="true">' + esc(p.kpi || '') + '</span></td>' +
        '<td class="px-md py-sm"><span data-plan="owner" contenteditable="true">' + esc(p.owner || '') + '</span></td>' +
        '<td class="px-md py-sm"><span data-plan="due" contenteditable="true">' + esc(p.due || '') + '</span></td>' +
        '<td class="px-md py-sm"><span data-plan="approve" contenteditable="true">' + esc(p.needsApproval ? 'يحتاج اعتماد' : '') + '</span></td>' +
        '<td class="px-md py-sm"><button class="plan-save px-sm py-xs rounded-full border border-outline-variant text-body-sm hover:bg-surface-container">حفظ</button></td></tr>';
    }

    return '<div class="card overflow-hidden fadein"><div class="bg-primary text-on-primary px-md py-sm font-title-md">6. خطة العمل للأسبوع القادم</div>' +
      '<div class="p-md space-y-md">' +
      '<p class="text-body-sm text-on-surface-variant">تُحفظ البنود في جدول <b>weekly_plans</b> — بياناتها تظهر لكل من يفتح التقرير، ولا تُحفظ في المتصفح فقط.</p>' +
      '<div class="overflow-x-auto"><table class="w-full text-body-sm">' +
      '<thead><tr class="bg-surface-container text-on-surface-variant"><th class="text-right px-md py-sm font-label-bold">م</th>' +
      '<th class="text-right px-md py-sm font-label-bold">الهدف التشغيلي المستهدف</th><th class="text-right px-md py-sm font-label-bold">الفرع / النطاق</th>' +
      '<th class="text-right px-md py-sm font-label-bold">مؤشر القياس</th><th class="text-right px-md py-sm font-label-bold">المسؤول عن التنفيذ</th>' +
      '<th class="text-right px-md py-sm font-label-bold">الموعد المتوقع</th><th class="text-right px-md py-sm font-label-bold">يحتاج اعتماد؟</th>' +
      '<th class="text-right px-md py-sm font-label-bold">إجراء</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="bg-surface-container rounded-lg p-md"><label class="font-label-bold text-on-surface-variant">أبرز التحديات المستمرة التي تتطلب تدخل الإدارة</label>' +
      '<div class="text-body-sm mt-1" data-edit="challenges">—</div></div></div></div>';
  }

  var PANES = { 1: pane1, 2: pane2, 3: pane3, 4: pane4, 5: pane5, 6: pane6 };

  function renderPanes() {
    var el = $('#panes');
    if (!el) return;
    el.innerHTML = PANES[state.tab]();
    if (state.tab === 2) {
      var tpl = complianceByTemplate(resolveRange());
      var cur = agg(SRC.reports, resolveRange());
      bars($('#paneChecks'), tpl.map(function (t) {
        return { label: t.title, done: t.done, total: t.total };
      }));
    }
    restoreEdits();
    bindPlanSaves();
  }

  /* ══════════ الحقول القابلة للتحرير + الملاحظات ══════════ */
  function saveEdits() {
    try {
      var o = {};
      $$('[data-edit]').forEach(function (el) { o[el.getAttribute('data-edit')] = el.innerHTML; });
      localStorage.setItem(EDIT_KEY, JSON.stringify(o));
    } catch (e) {}
  }
  function restoreEdits() {
    var o = {};
    try { o = JSON.parse(localStorage.getItem(EDIT_KEY) || '{}'); } catch (e) {}
    $$('[data-edit]').forEach(function (el) {
      var k = el.getAttribute('data-edit');
      var v = (SRC.noteMap && SRC.noteMap[k]) || o[k];
      if (v != null && v !== '' && v !== '—') el.innerHTML = v;
    });
  }
  function bindEdits() {
    document.addEventListener('input', function (e) {
      var el = e.target;
      if (el.closest && el.closest('[data-edit]')) {
        var k = el.getAttribute('data-edit');
        if (!SRC.noteMap) SRC.noteMap = {};
        SRC.noteMap[k] = el.innerHTML;
        saveEdits();
        try { localStorage.setItem(NOTES_KEY, JSON.stringify(SRC.noteMap)); } catch (err) {}
        clearTimeout(bindEdits._t);
        bindEdits._t = setTimeout(function () { saveNote(k, el.innerHTML); }, 1200);
      }
    });
  }
  function bindPlanSaves() {
    $$('.plan-save').forEach(function (b) {
      b.addEventListener('click', function () {
        var tr = b.closest('tr'), rowNo = +tr.getAttribute('data-plan-row');
        function get(name) { var el = tr.querySelector('[data-plan="' + name + '"]'); return el ? el.innerHTML.trim() : ''; }
        var needs = /اعتماد|نعم/i.test(get('approve'));
        if (!CFG.client || typeof CFG.client.rpc !== 'function') {
          notify('الحفظ في القاعدة غير متاح في هذه النسخة.', 'error'); return;
        }
        b.disabled = true;
        CFG.client.rpc('save_weekly_plan', {
          p_week_start: resolveRange().from, p_row_no: rowNo,
          p_objective: get('objective'), p_scope: get('scope'), p_kpi: get('kpi'),
          p_owner: get('owner'), p_due_date: get('due') || null,
          p_needs_approval: needs, p_notes: null,
          p_updated_by: (CFG.user && (CFG.user.full_name || CFG.user.email)) || null
        }).then(function () { notify('تم حفظ بند الخطة في قاعدة البيانات.', 'ok'); return boot(); })
          .catch(function (e) { notify('تعذّر الحفظ: ' + (e && e.message ? e.message : e), 'error'); })
          .then(function () { b.disabled = false; });
      });
    });
  }

  /* ══════════ العرض العام ══════════ */
  function renderAll() {
    renderSlicers();
    var r = resolveRange(), p = prevRange(r);
    var lbl = $('#rangeLabel');
    if (lbl) lbl.textContent = 'من ' + r.from + ' إلى ' + r.to + '  ·  المقارنة: ' + p.from + ' — ' + p.to;
    renderKpis();
    renderCharts();
    renderPanes();
    renderSnapshots();
    var hasSource = SRC.reports.length || SRC.waste.length || SRC.issues.length || SRC.negs.length ||
                    SRC.visits.length || SRC.attendance.length || SRC.plans.length;
    var inPeriod = SRC.reports.some(function (x) { return inRange(x.date, r); }) ||
                   SRC.waste.some(function (x) { return inRange(x.date, r); }) ||
                   SRC.issues.some(function (x) { return inRange(x.date, r); }) ||
                   SRC.negs.some(function (x) { return inRange(x.date, r); }) ||
                   SRC.visits.some(function (x) { return inRange(x.date, r); });
    var es = $('#emptyState');
    if (es) {
      es.classList.toggle('hidden', !!(hasSource && inPeriod));
      if (hasSource && !inPeriod) {
        var em = $('#emptyMsg');
        if (em) em.textContent = 'المصدر متصل، لكن لا توجد سجلات داخل الفترة المختارة. جرّب «آخر 30 يوم» أو حدّد تاريخاً يدوياً.';
      } else if (!hasSource && $('#emptyMsg')) {
        $('#emptyMsg').textContent = SRC.note || 'شغّل المزامنة أولاً — البيانات غير موجودة في القاعدة بعد.';
      }
    }
    if (!hasSource) {
      var k = $('#kpis');
      if (k) k.innerHTML = '<div class="card p-md col-span-full text-body-sm text-on-surface-variant">لا توجد بيانات بعد — شغّل runSyncNow من Google Apps Script أو استورد السجلات إلى Supabase، ثم اضغط «تحديث».</div>';
      ['chartTrend', 'chartWaste', 'chartBranch', 'chartChecks'].forEach(function (id) {
        var e = document.getElementById(id); if (e) e.innerHTML = '';
      });
    }
  }

  function setSourceChip() {
    var chip = $('#srcChip'), lbl = $('#srcLabel');
    if (!chip || !lbl) return;
    var color = SRC.kind === 'live' ? 'text-tertiary-container' : SRC.kind === 'cache' ? 'text-on-surface-variant' : 'text-error';
    chip.className = 'flex items-center gap-xs bg-surface-container-low px-md py-xs rounded-full border border-outline-variant text-body-sm ' + color;
    lbl.textContent = SRC.label;
    var total = SRC.reports.length + SRC.waste.length + SRC.issues.length + SRC.negs.length + SRC.visits.length;
    chip.title = SRC.label + ' — ' + (SRC.note || '') + ' — إجمالي السجلات: ' + total;
  }

  /* ══════════ الواجهة العامة ══════════ */
  function init(opts) {
    opts = opts || {};
    CFG.client = opts.client || (global.zamClient || null);
    CFG.user = opts.user || null;
    if (!BRANCHES.length) { BRANCHES = FALLBACK_BRANCHES; buildBranchMaps(); state.branches = new Set(BRANCHES.map(function (b) { return b.id; })); }

    bindEdits();

    var df = document.getElementById('dFrom'), dt = document.getElementById('dTo');
    if (df) df.addEventListener('change', function (e) { state.from = e.target.value; state.range = 'custom'; applyNotes(); renderAll(); });
    if (dt) dt.addEventListener('change', function (e) { state.to = e.target.value; state.range = 'custom'; applyNotes(); renderAll(); });

    var rb = document.getElementById('reloadBtn');
    if (rb) rb.addEventListener('click', function () { boot(); });
    var pb = document.getElementById('printBtn');
    if (pb) pb.addEventListener('click', function () { global.print(); });
    var ssb = document.getElementById('saveSnapshotBtn');
    if (ssb) ssb.addEventListener('click', saveSnapshot);

    renderTabs();
    boot();
  }

  function notify(msg, kind) {
    var box = document.getElementById('toast');
    if (!box) { console.log(msg); return; }
    var cls = kind === 'error' ? 'bg-error-container text-on-error-container' : 'bg-tertiary-container text-on-tertiary';
    box.className = 'fixed bottom-md left-md z-50 px-md py-sm rounded-lg text-body-sm font-semibold shadow-lg ' + cls;
    box.textContent = msg;
    box.style.display = 'block';
    clearTimeout(notify._t);
    notify._t = setTimeout(function () { box.style.display = 'none'; }, 6000);
  }

  function boot() {
    var lbl = document.getElementById('srcLabel');
    if (lbl) lbl.textContent = 'جارٍ التحميل…';
    return loadData().then(function () {
      setSourceChip();
      var r = resolveRange();
      var anyHit = SRC.reports.some(function (x) { return inRange(x.date, r); }) ||
                   SRC.waste.some(function (x) { return inRange(x.date, r); });
      if (!anyHit) {
        var all = SRC.reports.map(function (x) { return x.date; })
          .concat(SRC.waste.map(function (x) { return x.date; }))
          .concat(SRC.issues.map(function (x) { return x.date; }))
          .concat(SRC.negs.map(function (x) { return x.date; }))
          .concat(SRC.visits.map(function (x) { return x.date; }))
          .filter(Boolean).sort();
        if (all.length) {
          var last = all[all.length - 1];
          var f = new Date(parseD(last)); f.setUTCDate(f.getUTCDate() - 29);
          state.range = 'custom'; state.from = dstr(f); state.to = last;
        }
      }
      applyNotes();
      renderAll();
      return SRC;
    });
  }

  global.ZamWeeklyReport = {
    init: init, boot: boot, render: renderAll, notify: notify,
    getSource: function () { return SRC; },
    setBranches: function (arr) { state.branches = new Set(arr); renderAll(); }
  };

})(window);


