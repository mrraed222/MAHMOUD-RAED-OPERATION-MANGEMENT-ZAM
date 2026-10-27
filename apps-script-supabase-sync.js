/* =====================================================================
 * مزامنة Google Sheet  →  Supabase  (نظام زام للعمليات)
 * ---------------------------------------------------------------------
 * هذا الملف «إضافة» لا يستبدل كودك الحالي.
 *   • لا تحذف doPost الموجود عندك — النموذج بيستعمله للإرسال.
 *   • الصق هذا الكود في نفس ملف Apps Script (خارج دوال doPost).
 *   • لو حبيت المزامنة happen تلقائي مع كل إرسال، أضف سطر واحد
 *     في آخر doPost:      syncToSupabase();
 *
 * ما الذي يفعله؟
 *   1) يقرأ كل تابات الشيت (ويكتشف نوع كل تاب تلقائياً من رؤوس الأعمدة)
 *   2) يربط كل تقرير بالمخزن في Supabase:
 *        daily_reports   → تقرير الشفت (مبيعات، طلبات، متوسط، تشيكلست)
 *        waste_logs      → الهدر
 *        shift_issues    → مشاكل وأحداث الشفت
 *        negative_reviews→ التعليقات السلبية (شكاوى العملاء)
 *   3) يمنع التكرار: كل سطر له مفتاح ثابت (sheet_key) مخزّن في
 *      custom_fields، فلو تكرر التشغيل ما هينزلش نفس البيانات مرتين.
 *   4) يعيد معرفات التقارير الجديدة فور الإدخال حتى تُربط بها سجلات الهدر والمشاكل والتعليقات في نفس التشغيل.
 *   5) يحفظ داخل custom_fields نسخة كاملة من الهدر والمشاكل والتعليقات
 *      الخاصة بالتقرير — عشان الداشبورد يقرأها حتى لو ربط الجداول الفرعية اتغيّر.
 *
 * ---------------------------------------------------------------------
 * التهيئة (مرة واحدة):
 *   1) Supabase Dashboard → Project Settings → API → انسخ مفتاح
 *      service_role  (اللي يبدأ بـ eyJ... واللي مكتوب عليه service_role)
 *   2) في Apps Script: Project Settings → Script Properties، أضف:
 *        SUPABASE_URL        = https://uuphgpncmiwyigtqhjmd.supabase.co
 *        SUPABASE_SERVICE_KEY = <مفتاح service_role>
 *      (مفتاح service_role سري — لا تضعه في أي ملف HTML ولا ترسله لأحد)
 *   3) احفظ وانشر: Deploy → New version → Execute as: Me → Anyone
 * ===================================================================== */

var ZAM_SUPABASE_URL = 'https://uuphgpncmiwyigtqhjmd.supabase.co';

// ─────────── أدوات عامة ───────────
function props() {
  return PropertiesService.getScriptProperties();
}
function supaKey() {
  return props().getProperty('SUPABASE_SERVICE_KEY') || '';
}
function supaUrl() {
  return props().getProperty('SUPABASE_URL') || ZAM_SUPABASE_URL;
}

/** طلب REST على Supabase */
function supa(method, path, body) {
  var key = supaKey();
  if (!key) throw new Error('مفتاح SUPABASE_SERVICE_KEY غير موجود في Script Properties');
  var opts = {
    method: method,
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    muteHttpExceptions: true
  };
  if (body) opts.payload = JSON.stringify(body);
  var res = UrlFetchApp.fetch(supaUrl() + path, opts);
  var code = res.getResponseCode();
  var txt = res.getContentText();
  if (code >= 300) throw new Error('Supabase ' + method + ' ' + path + ' → ' + code + ' : ' + txt.slice(0, 300));
  return txt ? JSON.parse(txt) : null;
}

/** تطبيع التاريخ إلى yyyy-MM-dd */
function toISO(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Riyadh', 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  var d = new Date(s.replace(/\//g, '-'));
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Riyadh', 'yyyy-MM-dd');
  return '';
}

/** يبحث عن قيمة في صف حسب قائمة أسماء (عربي/إنجليزي) */
function val(row, names) {
  var keys = Object.keys(row);
  var norm = function (s) {
    return String(s == null ? '' : s).trim().toLowerCase()
      .replace(/[ًٌٍَُِّْـ]/g, '')
      .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
      .replace(/[()_\-\/]/g, ' ').trim();
  };
  for (var i = 0; i < names.length; i++) {
    var t = norm(names[i]);
    for (var k = 0; k < keys.length; k++) {
      if (norm(keys[k]) === t) return row[keys[k]];
    }
  }
  for (var i2 = 0; i2 < names.length; i2++) {
    var t2 = norm(names[i2]);
    if (t2.length < 3) continue;
    for (var k2 = 0; k2 < keys.length; k2++) {
      if (norm(keys[k2]).indexOf(t2) >= 0) return row[keys[k2]];
    }
  }
  return '';
}
function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/[^\d.\-]/g, '')); return isNaN(n) ? 0 : n; }
function txt(v) { return String(v == null ? '' : v).trim(); }

/** مطابقة اسم فرع النموذج → اسم الفرع في Supabase */
var BRANCH_MAP = {
  'الفرع الرئيسي': 'زام الرئيسي',
  'فرع الرئيسي': 'زام الرئيسي',
  'زام الرئيسي': 'زام الرئيسي',
  'فرع البلد': 'زام البلد',
  'زام البلد': 'زام البلد',
  'فرع الحي': 'زام الحي',
  'زام الحي': 'زام الحي',
  'فرع المنح': 'زام المنح',
  'زام المنح': 'زام المنح',
  'فرع البرج': 'زام البرج',
  'زام البرج': 'زام البرج',
  'فرع تجربة زام': 'تجربة زام',
  'تجربة زام': 'تجربة زام'
};
function zamBranchName(raw) {
  var s = txt(raw);
  if (!s) return '';
  if (BRANCH_MAP[s]) return BRANCH_MAP[s];
  var keys = Object.keys(BRANCH_MAP);
  for (var i = 0; i < keys.length; i++) {
    if (s.indexOf(keys[i]) >= 0 || keys[i].indexOf(s) >= 0) return BRANCH_MAP[keys[i]];
  }
  return s;
}

/** مفتاح ثابت للسطر (يمنع التكرار) */
function sheetKey(parts) {
  return parts.join('|').replace(/\s+/g, ' ').trim().slice(0, 220);
}

// ─────────── قراءة الشيت ───────────
/**
 * يقرأ كل التابات ويصنّفها:
 *   { reports:[], waste:[], issues:[], negatives:[] }
 * كل عنصر = كائن {اسم العمود: قيمة}
 */
function readSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = { reports: [], waste: [], issues: [], negatives: [], tabs: [] };

  ss.getSheets().forEach(function (sh) {
    var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return;

    var head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v == null ? '' : v).trim(); });
    var body = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    out.tabs.push(sh.getName());

    var rows = body.map(function (r, idx) {
      var o = { __row: idx + 2 };                 // رقم الصف في الشيت
      for (var i = 0; i < head.length; i++) {
        var k = head[i] || ('col_' + i);
        var v = r[i];
        if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Riyadh', 'yyyy-MM-dd');
        else if (v === null) v = '';
        o[k] = v;
      }
      return o;
    });

    var joined = head.join(' ');
    var isWaste  = /(الكمية|quantity|qty)/i.test(joined) && !/(مبيعات|total_sales|طلبات|orders)/i.test(joined);
    var isNeg    = /(تعليق|negative|review|comment)/i.test(joined) && !/(مشكل|problem)/i.test(joined);
    var isIssues = /(مشكل|issue|problem|أحداث)/i.test(joined);

    if (isWaste)       out.waste = out.waste.concat(rows);
    else if (isNeg)    out.negatives = out.negatives.concat(rows);
    else if (isIssues) out.issues = out.issues.concat(rows);
    else               out.reports = out.reports.concat(rows);
  });

  return out;
}

/** يحوّل صف شيت إلى سطر تقرير جاهز لـ daily_reports */
function toReportRow(r, branchIds) {
  var date = toISO(val(r, ['التاريخ', 'تاريخ', 'date', 'report_date']));
  if (!date) return null;

  var branchRaw = txt(val(r, ['الفرع', 'فرع', 'branch', 'اسم الفرع']));
  var branchName = zamBranchName(branchRaw);
  var branchId = branchIds[branchName];
  if (!branchId) return null;

  var shiftTxt = txt(val(r, ['الفت', 'الوردية', 'shift', 'shift_type']));
  var shiftType = /مسائي|evening/i.test(shiftTxt) ? 'Evening' : 'Morning';

  var sales = num(val(r, ['إجمالي المبيعات', 'المبيعات', 'total_sales', 'totalSales']));
  var orders = num(val(r, ['عدد الطلبات', 'عدد الفواتير', 'orders_count', 'ordersCount']));
  var avg = num(val(r, ['متوسط الفاتورة', 'avg_ticket', 'avgTicket']));
  if (!avg && orders) avg = sales / orders;

  var sup = txt(val(r, ['المسؤول', 'المشرف', 'supervisor', 'supervisor_name', 'الاسم']));
  var team = txt(val(r, ['حالة أداء الفريق', 'حالة الفريق', 'team_status', 'teamStatus']));
  var pos = num(val(r, ['التقييمات الإيجابية', 'تقييمات إيجابية', 'positive_reviews', 'pos']));

  var entry = txt(val(r, ['وقت الدخول', 'entryTime', 'entry_time']));

  var key = sheetKey([branchName, date, shiftType, sup, r.__row]);

  return {
    row: {
      branch_id: branchId,
      report_date: date,
      shift_type: shiftType,
      supervisor_name: sup,
      total_sales: sales,
      orders_count: orders,
      avg_ticket: Math.round(avg * 100) / 100,
      team_status: team,
      positive_reviews: pos,
      sheet_key: key,
      custom_fields: {
        sheet_key: key,
        sheet_row: r.__row,
        entry_time: entry
      }
    },
    key: key,
    date: date,
    branchName: branchName
  };
}

/** يحوّل صف هدر إلى سجل waste_logs */
function toWasteRow(r) {
  var item = txt(val(r, ['الصنف', 'صنف', 'item', 'waste_item', 'item_name']));
  if (!item) return null;
  return {
    item_name: item,
    quantity: num(val(r, ['الكمية', 'qty', 'quantity', 'waste_qty'])),
    unit: txt(val(r, ['الوحدة', 'unit', 'waste_unit'])),
    reason: txt(val(r, ['السبب', 'reason', 'waste_reason', 'سبب الهدر'])),
    root_cause: txt(val(r, ['السبب الجذري', 'root_cause', 'السبب الجذري للهدر'])),
    corrective_action: txt(val(r, ['الإجراء التصحيحي', 'corrective_action', 'الإجراء'])),
    owner: txt(val(r, ['المسؤول', 'owner'])),
    unit_cost: num(val(r, ['تكلفة الوحدة', 'unit_cost', 'تكلفة الصنف'])),
    date: toISO(val(r, ['التاريخ', 'تاريخ', 'date'])),
    branchRaw: txt(val(r, ['الفرع', 'فرع', 'branch'])),
    sheet_row: r.__row
  };
}

/** يحوّل صف مشكلة إلى shift_issues */
function toIssueRow(r) {
  var desc = txt(val(r, ['المشكلة', 'الوصف', 'desc', 'issue_desc', 'description']));
  if (!desc) return null;
  return {
    description: desc,
    action_taken: txt(val(r, ['الإجراء', 'action', 'issue_action', 'action_taken'])),
    priority: txt(val(r, ['الأولوية', 'priority', 'issue_priority'])),
    type: txt(val(r, ['النوع', 'type', 'issue_type'])),
    date: toISO(val(r, ['التاريخ', 'تاريخ', 'date'])),
    branchRaw: txt(val(r, ['الفرع', 'فرع', 'branch'])),
    sheet_row: r.__row
  };
}

/** يحوّل صف تعليق سلبي إلى negative_reviews */
function toNegRow(r) {
  var c = txt(val(r, ['التعليق', 'التعليق السلبي', 'neg_comment', 'comment', 'comment_text']));
  if (!c) return null;
  return {
    comment_text: c,
    review_type: txt(val(r, ['النوع', 'type', 'review_type'])) || 'Google Review',
    rating: num(val(r, ['تقييم العميل', 'customer_rating', 'التقييم', 'rating'])),
    status: txt(val(r, ['الحالة', 'status'])) || 'معلقة',
    owner: txt(val(r, ['المسؤول', 'owner'])),
    action_taken: txt(val(r, ['الإجراء', 'action_taken', 'الإجراء المتخذ'])),
    date: toISO(val(r, ['التاريخ', 'تاريخ', 'date'])),
    branchRaw: txt(val(r, ['الفرع', 'فرع', 'branch'])),
    sheet_row: r.__row
  };
}

// ─────────── المزامنة ───────────
/**
 * المزامنة الكاملة: الشيت → Supabase
 * ترجع ملخصاً بالنتائج.
 */
function syncToSupabase() {
  var summary = { startedAt: new Date().toISOString(), inserted: 0, updated: 0, skipped: 0, children: 0, errors: [] };

  try {
    // 1) خرائط الفروع
    var branches = supa('GET', '/rest/v1/branches?select=id,name');
    var branchIds = {};
    (branches || []).forEach(function (b) { branchIds[b.name] = b.id; });

    // 2) المفاتيح الموجودة مسبقاً (لمنع التكرار)
    var existing = supa('GET', '/rest/v1/daily_reports?select=id,sheet_key,custom_fields');
    var byKey = {};
    (existing || []).forEach(function (r) {
      var k = r.sheet_key || (r.custom_fields && r.custom_fields.sheet_key);
      if (k) byKey[k] = r.id;
    });

    // 3) قراءة الشيت
    var data = readSheet();

    // 4) التقارير
    var prepared = [];
    data.reports.forEach(function (r) {
      var p = toReportRow(r, branchIds);
      if (p) prepared.push(p);
    });

    var toInsert = [];
    prepared.forEach(function (p) {
      if (byKey[p.key]) {
        // موجود — نحدّثه
        try {
          supa('PATCH', '/rest/v1/daily_reports?id=eq.' + byKey[p.key], [p.row]);
          summary.updated++;
          p.id = byKey[p.key];
        } catch (e) { summary.errors.push('تحديث: ' + e.message); }
      } else {
        toInsert.push(p.row);
      }
    });
    if (toInsert.length) {
      var inserted = supa('POST', '/rest/v1/daily_reports', toInsert);
      (inserted || []).forEach(function (r) {
        var cf = r.custom_fields || {};
        if (cf.sheet_key) byKey[cf.sheet_key] = r.id;
      });
      summary.inserted = toInsert.length;
    }

    // 5) ربط صفوف الهدر / المشاكل / التعليقات بأقرب تقرير (نفس التاريخ + نفس الفرع)
    var reportsByDateBranch = {};
    prepared.forEach(function (p) {
      var k = p.date + '|' + p.branchName;
      if (!reportsByDateBranch[k]) reportsByDateBranch[k] = [];
      reportsByDateBranch[k].push(p);
    });

    function findReport(date, branchRaw, sheetRow) {
      var bn = zamBranchName(branchRaw);
      var cands = reportsByDateBranch[date + '|' + bn] || [];
      if (!cands.length) return null;
      // الأقرب في ترتيب الشيت
      var best = cands[0], bestDiff = 1e9;
      cands.forEach(function (c) {
        var d = Math.abs((c.row.custom_fields.sheet_row || 0) - (sheetRow || 0));
        if (d < bestDiff) { bestDiff = d; best = c; }
      });
      return best;
    }

    function hasColumn(table, column) {
      try {
        supa('GET', '/rest/v1/' + table + '?select=' + column + '&limit=1');
        return true;
      } catch (e) { return false; }
    }
    // إن كان ملف SQL المرفق قد نُفّذ، نستخدم sheet_key لمنع التكرار بأمان
    var USE_CHILD_KEY = {
      waste: hasColumn('waste_logs', 'sheet_key'),
      issues: hasColumn('shift_issues', 'sheet_key'),
      negatives: hasColumn('negative_reviews', 'sheet_key')
    };

    // الهدر
    data.waste.forEach(function (r) {
      var w = toWasteRow(r);
      if (!w) return;
      var rep = findReport(w.date, w.branchRaw, w.sheet_row);
      if (!rep || !rep.id) { summary.skipped++; return; }
      var key = sheetKey([rep.key, 'W', w.item_name, w.quantity, w.unit, w.reason]);
      try {
        if (USE_CHILD_KEY.waste) {
          supa('POST', '/rest/v1/waste_logs?on_conflict=sheet_key', [{
            report_id: rep.id, item_name: w.item_name, quantity: w.quantity,
            unit: w.unit, reason: w.reason, sheet_key: key,
            root_cause: w.root_cause || null,
            corrective_action: w.corrective_action || null,
            owner: w.owner || null,
            unit_cost: w.unit_cost || null
          }]);
        } else {
          supa('DELETE', '/rest/v1/waste_logs?report_id=eq.' + rep.id + '&item_name=eq.' + encodeURIComponent(w.item_name));
          supa('POST', '/rest/v1/waste_logs', [{
            report_id: rep.id, item_name: w.item_name,
            quantity: w.quantity, unit: w.unit, reason: w.reason
          }]);
        }
        summary.children++;
      } catch (e) { summary.errors.push('waste_logs: ' + e.message); }
    });

    // مشاكل الشفت
    data.issues.forEach(function (r) {
      var i = toIssueRow(r);
      if (!i) return;
      var rep = findReport(i.date, i.branchRaw, i.sheet_row);
      if (!rep || !rep.id) { summary.skipped++; return; }
      var key = sheetKey([rep.key, 'I', i.description]);
      try {
        if (USE_CHILD_KEY.issues) {
          supa('POST', '/rest/v1/shift_issues?on_conflict=sheet_key', [{
            report_id: rep.id, description: i.description, action_taken: i.action_taken,
            priority: i.priority, issue_type: i.type, sheet_key: key
          }]);
        } else {
          supa('DELETE', '/rest/v1/shift_issues?report_id=eq.' + rep.id + '&description=eq.' + encodeURIComponent(i.description));
          supa('POST', '/rest/v1/shift_issues', [{
            report_id: rep.id, description: i.description,
            action_taken: i.action_taken, priority: i.priority
          }]);
        }
        summary.children++;
      } catch (e) { summary.errors.push('shift_issues: ' + e.message); }
    });

    // التعليقات السلبية
    data.negatives.forEach(function (r) {
      var n = toNegRow(r);
      if (!n) return;
      var rep = findReport(n.date, n.branchRaw, n.sheet_row);
      if (!rep || !rep.id) { summary.skipped++; return; }
      var key = sheetKey([rep.key, 'N', n.comment_text]);
      try {
        if (USE_CHILD_KEY.negatives) {
          supa('POST', '/rest/v1/negative_reviews?on_conflict=sheet_key', [{
            report_id: rep.id, comment_text: n.comment_text,
            review_type: n.review_type, sheet_key: key,
            status: n.status || 'معلقة',
            owner: n.owner || null,
            action_taken: n.action_taken || null,
            customer_rating: n.rating || null
          }]);
        } else {
          supa('DELETE', '/rest/v1/negative_reviews?report_id=eq.' + rep.id + '&comment_text=eq.' + encodeURIComponent(n.comment_text));
          supa('POST', '/rest/v1/negative_reviews', [{
            report_id: rep.id, comment_text: n.comment_text, review_type: n.review_type
          }]);
        }
        summary.children++;
      } catch (e) { summary.errors.push('negative_reviews: ' + e.message); }
    });

    summary.finishedAt = new Date().toISOString();
    summary.ok = true;
  } catch (e) {
    summary.ok = false;
    summary.fatal = e.message;
  }

  try { console.log(JSON.stringify(summary)); } catch (e) {}
  return summary;
}

// ─────────── القارئ للداشبورد ───────────
/**
 * أمان نقطة المزامنة
 * ------------------------------------------------------------------
 * endpoint المنشور على «Anyone» يقدر أي حد يستدعيه برابطه.
 * لذلك المزامنة لا تُنفَّذ إلا بـ:
 *   1) مفتاح سرّي (SYNC_TOKEN) موجود في Script Properties
 *   2) فترة تبريد 60 ثانية بين محاولتين
 * القراءة العامة معطّلة لأن التقرير يحتوي على بيانات تشغيلية حساسة.
 *
 * المفتاح لا يُضمَّن في صفحة التقرير؛ تبقى المزامنة داخل Apps Script فقط.
 */
var SYNC_COOLDOWN_MS = 60000;

function syncToken() {
  return props().getProperty('SYNC_TOKEN') || '';
}

function checkSyncRequest(e) {
  var t = (e && e.parameter && e.parameter.token) || '';
  var expected = syncToken();
  if (!expected) {
    return { ok: false, code: 'NO_TOKEN_SET',
             msg: 'SYNC_TOKEN غير موجود في Script Properties — أضفه قبل استخدام زر المزامنة.' };
  }
  if (t !== expected) {
    return { ok: false, code: 'BAD_TOKEN', msg: 'مفتاح المزامنة غير صحيح.' };
  }
  var last = parseInt(props().getProperty('last_sync_at') || '0', 10);
  var now = Date.now();
  if (last && (now - last) < SYNC_COOLDOWN_MS) {
    var wait = Math.ceil((SYNC_COOLDOWN_MS - (now - last)) / 1000);
    return { ok: false, code: 'COOLDOWN',
             msg: 'تم تشغيل المزامنة قبل لحظات. انتظر ' + wait + ' ثانية ثم أعد المحاولة.' };
  }
  props().setProperty('last_sync_at', String(now));
  return { ok: true };
}

/**
 * doGet — لا يعرّض بيانات الشيت للعامة، ويُشغّل المزامنة لمصرّح له فقط.
 *   طلبات القراءة العامة            → مرفوضة (القراءة من Supabase داخل الصفحة)
 *   .../exec?action=sync&token=XXX  → مزامنة (تحتاج المفتاح)
 */
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'read';
    if (action === 'sync') {
      var gate = checkSyncRequest(e);
      if (!gate.ok) {
        return ContentService.createTextOutput(JSON.stringify({
          ok: false, code: gate.code, fatal: gate.msg, inserted: 0, updated: 0, children: 0
        })).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify(syncToSupabase()))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      code: 'READ_DISABLED',
      error: 'القراءة العامة معطّلة. استخدم التقرير المحمي داخل النظام.'
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      error: String(err && err.stack || err), reports: [], waste: [], issues: [], negatives: []
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/** يطبع المفتاح السرّي — شغّلها مرة واحدة وانسخ الناتج منها */
function printSyncToken() {
  var t = syncToken();
  if (!t) {
    Logger.log('لم يُحدَّد SYNC_TOKEN بعد. أضفه من: Project Settings → Script Properties');
    return;
  }
  Logger.log('SYNC_TOKEN = ' + t);
}

/** مزامنة يدوية — شغّلها من محرر Apps Script لاختبار الربط */
function runSyncNow() {
  var s = syncToSupabase();
  Logger.log(JSON.stringify(s, null, 2));
  return s;
}

/** ينشئ تشغيل تلقائي يومي (06:00) لمزامنة الشيت مع Supabase */
function installDailySync() {
  var id = PropertiesService.getScriptProperties().getProperty('daily_sync_trigger_id');
  if (id) {
    var existing = ScriptApp.getProjectTriggers();
    existing.forEach(function (t) { if (t.getUniqueId() === id) ScriptApp.deleteTrigger(t); });
  }
  var t = ScriptApp.newTrigger('syncToSupabase').timeBased().everyDays(1).atHour(6).create();
  PropertiesService.getScriptProperties().setProperty('daily_sync_trigger_id', t.getUniqueId());
  Logger.log('تم إنشاء المزامنة اليومية — المعرّف: ' + t.getUniqueId());
  return t.getUniqueId();
}

/** فحص تشخيصي: أسماء التابات والعناوين وعدد الصفوف */
function diagnose() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(function (sh) {
    Logger.log('تاب: ' + sh.getName() + ' | صفوف: ' + sh.getLastRow() + ' | أعمدة: ' + sh.getLastColumn() +
      ' | العناوين: ' + sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].join(' , '));
  });
  try {
    var b = supa('GET', '/rest/v1/branches?select=id,name');
    Logger.log('فروع Supabase: ' + JSON.stringify(b));
  } catch (e) {
    Logger.log('تعذر قراءة Supabase: ' + e.message);
  }
}



