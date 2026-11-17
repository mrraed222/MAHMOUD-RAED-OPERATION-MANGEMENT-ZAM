(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZamWeeklyMetrics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeShift(value) {
    var s = String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!s || /^(all|both|كل|كلاهما|الكل)$/.test(s)) return 'All';
    if (/evening|night|مسائ|ليل/.test(s)) return 'Evening';
    if (/morning|صباح/.test(s)) return 'Morning';
    return s;
  }

  function dateParts(date) {
    var parts = String(date == null ? '' : date).slice(0, 10).split('-').map(Number);
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
    var d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (isNaN(d.getTime()) || d.getUTCFullYear() !== parts[0] || d.getUTCMonth() !== parts[1] - 1 || d.getUTCDate() !== parts[2]) return null;
    return d;
  }

  function dateStringInZone(value, timeZone) {
    var raw = String(value == null ? '' : value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return dateParts(raw) ? raw : '';
    var date = new Date(raw);
    if (isNaN(date.getTime())) return '';
    try {
      var parts = new Intl.DateTimeFormat('en', {
        timeZone: timeZone || 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(date);
      var values = {};
      parts.forEach(function (part) { values[part.type] = part.value; });
      var result = values.year + '-' + values.month + '-' + values.day;
      return dateParts(result) ? result : '';
    } catch (_) { return ''; }
  }

  function expectedSessions(range, branches, options) {
    options = options || {};
    var from = dateStringInZone(range && range.from, 'Asia/Riyadh');
    var requestedTo = dateStringInZone(range && range.to, 'Asia/Riyadh');
    var today = dateStringInZone(options.today, 'Asia/Riyadh');
    if (!from || !requestedTo || !today) return { sessions: [], unknownBranches: [], from: from, to: '', today: today };
    var to = requestedTo < today ? requestedTo : today;
    if (from > to) return { sessions: [], unknownBranches: [], from: from, to: to, today: today };

    var shiftFilter = normalizeShift(options.shiftFilter || 'All');
    var shifts = shiftFilter === 'All' ? ['Morning', 'Evening'] :
      (shiftFilter === 'Morning' || shiftFilter === 'Evening' ? [shiftFilter] : []);
    var sessions = [], unknownBranches = [], seenBranches = Object.create(null);
    (branches || []).forEach(function (branch) {
      if (!branch) return;
      var id = branch.id != null ? branch.id : branch.branch;
      if (!id || seenBranches[String(id)]) return;
      seenBranches[String(id)] = true;
      if (options.branchFilter && String(id) !== String(options.branchFilter)) return;
      var created = dateStringInZone(branch.createdDate || branch.created_at || branch.createdAt, 'Asia/Riyadh');
      if (!created) { unknownBranches.push(String(id)); return; }
      var start = created > from ? created : from;
      if (start > to) return;
      var d = dateParts(start), end = dateParts(to);
      while (d && end && d <= end) {
        var date = d.toISOString().slice(0, 10);
        shifts.forEach(function (shift) { sessions.push({ date: date, branch: id, shift: shift }); });
        d.setUTCDate(d.getUTCDate() + 1);
      }
    });
    return { sessions: sessions, unknownBranches: unknownBranches, from: from, to: to, today: today };
  }

  function isTaskScheduled(task, date) {
    if (!task || task.is_active === false || task.active === false) return false;
    var d = dateParts(date);
    if (!d) return false;
    var frequency = String(task.frequency || 'daily').toLowerCase();
    if (frequency === 'weekly') {
      var days = Array.isArray(task.days_of_week) ? task.days_of_week : [];
      return days.length
        ? days.some(function (day) { return Number(day) === d.getUTCDay(); })
        : Number(task.day_of_week) === d.getUTCDay();
    }
    if (frequency === 'monthly') {
      var lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      return d.getUTCDate() === Math.min(Number(task.day_of_month), lastDay);
    }
    return true;
  }

  function isCompletedStatus(status) {
    return ['completed', 'done', 'مكتمل', 'منجز'].indexOf(String(status == null ? '' : status).trim().toLowerCase()) >= 0;
  }

  function isFlaggedStatus(status) {
    return /flagged|معلّم|مرفوض|مخالفة/i.test(String(status == null ? '' : status));
  }

  function logShiftForOccurrence(log, template) {
    if (log && log.shift_type) {
      var explicit = normalizeShift(log.shift_type);
      return explicit === 'Morning' || explicit === 'Evening' ? explicit : '';
    }
    var assigned = normalizeShift(template && template.shift_type);
    // السجل التاريخي بلا وردية لا يُنسب إلى مهمّة Both في كلا الوردتين.
    return assigned === 'Morning' || assigned === 'Evening' ? assigned : '';
  }

  function occurrenceKey(templateId, date, branchId, shift) {
    return [templateId, String(date).slice(0, 10), branchId, shift].join('|');
  }

  function calculateCompliance(templates, sessions, logs, options) {
    options = options || {};
    var branchFilter = options.branchFilter || null;
    var shiftFilter = normalizeShift(options.shiftFilter || 'All');
    var allowedBranches = options.branches ? options.branches.slice() : null;
    var allowedBranchSet = allowedBranches ? new Set(allowedBranches.map(String)) : null;
    var byId = Object.create(null), statsById = Object.create(null);
    var expected = Object.create(null), statusByKey = Object.create(null);
    var hourlyById = Object.create(null), sessionKeys = Object.create(null);

    (templates || []).forEach(function (t, index) {
      if (!t || t.is_active === false || t.active === false) return;
      var id = String(t.id != null ? t.id : 'template-' + index);
      var taskShift = normalizeShift(t.shift_type);
      if (branchFilter && t.branch_id && String(t.branch_id) !== String(branchFilter)) return;
      if (allowedBranchSet && t.branch_id && !allowedBranchSet.has(String(t.branch_id))) return;
      if (shiftFilter !== 'All' && taskShift !== 'All' && taskShift !== shiftFilter) return;
      if (String(t.frequency || 'daily').toLowerCase() === 'hourly') {
        hourlyById[id] = t;
        return;
      }
      byId[id] = t;
      statsById[id] = {
        id: id,
        title: t.task_title || t.name || 'مهمة بدون اسم',
        category: t.category || '—',
        frequency: String(t.frequency || 'daily').toLowerCase(),
        total: 0,
        done: 0,
        flagged: 0,
        pending: 0
      };
    });

    var hourlySessions = Object.create(null), hourlyTemplateSessions = 0, hourlyApplicableTemplates = Object.create(null);
    (sessions || []).forEach(function (session) {
      if (!session || !session.date || !session.branch) return;
      var date = String(session.date).slice(0, 10), branch = session.branch;
      if (!dateParts(date)) return;
      var shift = normalizeShift(session.shift || session.shiftType);
      if (shift !== 'Morning' && shift !== 'Evening') return;
      if (branchFilter && String(branch) !== String(branchFilter)) return;
      if (allowedBranchSet && !allowedBranchSet.has(String(branch))) return;
      if (shiftFilter !== 'All' && shift !== shiftFilter) return;
      var sessionKey = [date, branch, shift].join('|');
      if (sessionKeys[sessionKey]) return;
      sessionKeys[sessionKey] = true;

      Object.keys(statsById).forEach(function (id) {
        var task = byId[id];
        var taskShift = normalizeShift(task.shift_type);
        if (task.branch_id && String(task.branch_id) !== String(branch)) return;
        if (taskShift !== 'All' && taskShift !== shift) return;
        if (!isTaskScheduled(task, date)) return;
        var key = occurrenceKey(id, date, branch, shift);
        expected[key] = { id: id, date: date, branch: branch, shift: shift };
        statsById[id].total++;
      });

      var matchedHourly = false;
      Object.keys(hourlyById).forEach(function (id) {
        var task = hourlyById[id];
        var taskShift = normalizeShift(task.shift_type);
        if (task.branch_id && String(task.branch_id) !== String(branch)) return;
        if (taskShift !== 'All' && taskShift !== shift) return;
        if (!isTaskScheduled(task, date)) return;
        matchedHourly = true;
        hourlyApplicableTemplates[id] = true;
        hourlyTemplateSessions++;
      });
      if (matchedHourly) hourlySessions[sessionKey] = true;
    });

    (logs || []).forEach(function (log) {
      if (!log) return;
      var id = String(log.template_id == null ? '' : log.template_id);
      var task = byId[id];
      if (!task) return;
      var date = String(log.execution_date || '').slice(0, 10), branch = log.branch_id;
      var shift = logShiftForOccurrence(log, task);
      if (!dateParts(date) || !branch || !shift) return;
      if (branchFilter && String(branch) !== String(branchFilter)) return;
      if (allowedBranchSet && !allowedBranchSet.has(String(branch))) return;
      if (shiftFilter !== 'All' && shift !== shiftFilter) return;
      if (task.branch_id && String(task.branch_id) !== String(branch)) return;
      if (!isTaskScheduled(task, date)) return;
      var key = occurrenceKey(id, date, branch, shift);
      if (!expected[key]) return;
      var bucket = isCompletedStatus(log.status) ? 'done' : (isFlaggedStatus(log.status) ? 'flagged' : 'pending');
      var previous = statusByKey[key];
      if (previous === 'done') return;
      if (bucket === 'done' || !previous || (bucket === 'flagged' && previous !== 'done')) statusByKey[key] = bucket;
    });

    Object.keys(statusByKey).forEach(function (key) {
      var occurrence = expected[key];
      if (!occurrence) return;
      if (statusByKey[key] === 'done') statsById[occurrence.id].done++;
      else if (statusByKey[key] === 'flagged') statsById[occurrence.id].flagged++;
    });

    var stats = Object.keys(statsById).map(function (id) {
      var item = statsById[id];
      item.pending = Math.max(0, item.total - item.done);
      return item;
    }).filter(function (item) { return item.total > 0; });

    var unknownBranchIds = Array.from(new Set((options.unknownBranchIds || []).map(String)));
    var unknownCouldAffect = unknownBranchIds.some(function (branchId) {
      return Object.keys(byId).concat(Object.keys(hourlyById)).some(function (id) {
        var task = byId[id] || hourlyById[id];
        return !task.branch_id || String(task.branch_id) === branchId;
      });
    });
    var hourlyTemplateCount = Object.keys(hourlyApplicableTemplates).length;
    var reasons = [];
    if (hourlyTemplateSessions) reasons.push('hourly_occurrences_unavailable');
    if (unknownCouldAffect) reasons.push('branch_creation_date_missing');
    var totalExpected = stats.reduce(function (sum, item) { return sum + item.total; }, 0);
    var totalDone = stats.reduce(function (sum, item) { return sum + item.done; }, 0);
    var complete = reasons.length === 0;
    return {
      stats: stats,
      hourlyExcluded: hourlyTemplateCount,
      hourlyTemplateCount: hourlyTemplateCount,
      hourlyAffectedSessions: Object.keys(hourlySessions).length,
      hourlyTemplateSessions: hourlyTemplateSessions,
      unknownBranchCount: unknownCouldAffect ? unknownBranchIds.length : 0,
      unknownBranchIds: unknownBranchIds,
      coverageIncomplete: !complete,
      complete: complete,
      reasons: reasons,
      nonHourlyExpected: totalExpected,
      nonHourlyDone: totalDone,
      nonHourlyPending: Math.max(0, totalExpected - totalDone),
      nonHourlyPct: totalExpected ? Math.min(100, Math.round(totalDone / totalExpected * 100)) : null,
      pct: complete && totalExpected ? Math.min(100, Math.round(totalDone / totalExpected * 100)) : null
    };
  }

  function topIncomplete(stats, limit) {
    var max = Math.max(0, Math.min(5, Number(limit) || 5));
    return (stats || []).filter(function (item) { return Number(item.pending) > 0; })
      .slice().sort(function (a, b) {
        return Number(b.pending) - Number(a.pending) || String(a.title || '').localeCompare(String(b.title || ''), 'ar');
      }).slice(0, max);
  }

  function hourlyOccurrenceCompleted(task, logs, occurrence) {
    occurrence = occurrence || {};
    if (!task || String(task.frequency || '').toLowerCase() !== 'hourly') return false;
    return (logs || []).some(function (log) {
      return log && String(log.template_id) === String(task.id) && log.branch_id === occurrence.branchId &&
        String(log.execution_date || '').slice(0, 10) === String(occurrence.date || '').slice(0, 10) &&
        Number(log.occurrence_hour) === Number(occurrence.hour) &&
        normalizeShift(log.shift_type) === normalizeShift(occurrence.shift) &&
        isCompletedStatus(log.status);
    });
  }

  return {
    normalizeShift: normalizeShift,
    dateStringInZone: dateStringInZone,
    expectedSessions: expectedSessions,
    isTaskScheduled: isTaskScheduled,
    isCompletedStatus: isCompletedStatus,
    isFlaggedStatus: isFlaggedStatus,
    logShiftForOccurrence: logShiftForOccurrence,
    calculateCompliance: calculateCompliance,
    topIncomplete: topIncomplete,
    hourlyOccurrenceCompleted: hourlyOccurrenceCompleted
  };
});
