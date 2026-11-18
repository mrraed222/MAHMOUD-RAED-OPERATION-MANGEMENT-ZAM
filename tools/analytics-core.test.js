const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const analytics = require('../assets/analytics-core.js');

function testSalesSummaryUsesWeightedAverageAndBranchGroups() {
    const summary = analytics.summarizeSales([
        { branch_id: 'a', branches: { name: 'زام الرئيسي' }, total_sales: '100', orders_count: '2', avg_ticket: 999 },
        { branch_id: 'a', branches: { name: 'زام الرئيسي' }, total_sales: 60, orders_count: 3 },
        { branch_id: 'b', branches: { name: 'زام البلد' }, total_sales: '40', orders_count: 0 },
    ]);

    assert.equal(summary.reportCount, 3);
    assert.equal(summary.totalSales, 200);
    assert.equal(summary.orderCount, 5);
    assert.equal(summary.weightedAverageTicket, 40, 'weighted average must use total sales / total orders, not the average of report averages');
    assert.deepEqual(summary.byBranch.map(branch => [branch.id, branch.reportCount, branch.totalSales, branch.orderCount, branch.weightedAverageTicket]), [
        ['a', 2, 160, 5, 32],
        ['b', 1, 40, 0, 0],
    ]);
}

function testSalesSummaryHandlesMissingOrInvalidValues() {
    assert.deepEqual(analytics.summarizeSales([]), {
        reportCount: 0, totalSales: 0, orderCount: 0, weightedAverageTicket: 0, byBranch: []
    });
    const summary = analytics.summarizeSales([{ total_sales: 'bad', orders_count: null }]);
    assert.equal(summary.totalSales, 0);
    assert.equal(summary.orderCount, 0);
    assert.equal(summary.weightedAverageTicket, 0);
}

function testIssueSummaryGroupsTypePriorityAndBranch() {
    const summary = analytics.summarizeIssues([
        { issue_type: 'تقنية', priority: 'عاجل', daily_reports: { branch_id: 'a', branches: { name: 'زام الرئيسي' } } },
        { issue_type: 'تقنية', priority: 'عادي', daily_reports: { branch_id: 'b', branches: { name: 'زام البلد' } } },
        { issue_type: 'موظف', priority: 'عالية', daily_reports: { branch_id: 'a', branches: { name: 'زام الرئيسي' } } },
        { priority: '', branch_id: 'c' },
    ]);

    assert.equal(summary.total, 4);
    assert.equal(summary.affectedBranches, 3);
    assert.equal(summary.highPriorityCount, 2);
    assert.deepEqual(summary.topType, { label: 'تقنية', count: 2 });
    assert.deepEqual(new Set(summary.byType.map(row => row.label)), new Set(['تقنية', 'غير مصنف', 'موظف']));
    assert.ok(summary.byPriority.some(row => row.label === 'غير محددة'));
}

function testTechnicalIssuesMergeWithShiftIssuesUsingRiyadhDates() {
    const technicalIssues = [
        { id: 'tech-1', branch_id: 'a', title: 'ارتفاع حرارة ثلاجة 1', description: '9 درجات', source: 'fridge', priority: 'high', status: 'resolved', created_at: '2026-11-15T21:48:35.912Z', branches: { name: 'زام الرئيسي' }, fridges: { name: 'ثلاجة 1 باب تبريد' } },
        { id: 'tech-2', branch_id: 'a', title: 'ارتفاع حرارة ثلاجة 2', description: '10 درجات', source: 'fridge', priority: 'high', status: 'resolved', created_at: '2026-11-15T14:10:28.255Z', branches: { name: 'زام الرئيسي' } },
        { id: 'tech-3', branch_id: 'a', title: 'ارتفاع حرارة ثلاجة 3', description: '10 درجات', source: 'fridge', priority: 'high', status: 'resolved', created_at: '2026-11-15T11:36:49.398Z', branches: { name: 'زام الرئيسي' } },
    ];
    const combined = analytics.combineIssueSources([
        { issue_type: 'تقنية', priority: 'عادي', daily_reports: { branch_id: 'b', branches: { name: 'زام البلد' } } },
    ], technicalIssues);
    const fridgeIssue = combined.find(issue => issue.analytics_source === 'technical_issues');
    const summary = analytics.summarizeIssues(combined);

    assert.equal(combined.length, 4, 'shift issues and technical issues must both be retained');
    assert.equal(fridgeIssue.daily_reports.report_date, '2026-11-16', 'UTC timestamps near midnight must use the Riyadh date');
    assert.equal(fridgeIssue.daily_reports.shift_type, 'غير مرتبط بشفت');
    assert.equal(fridgeIssue.issue_type, 'عطل فني - ثلاجة');
    assert.equal(fridgeIssue.priority, 'عالية');
    assert.equal(fridgeIssue.action_taken, 'تم الحل');
    assert.equal(fridgeIssue.daily_reports.branches.name, 'زام الرئيسي');
    assert.equal(summary.total, 4);
    assert.equal(summary.highPriorityCount, 3);
    assert.deepEqual(summary.byType.find(row => row.label === 'عطل فني - ثلاجة'), { label: 'عطل فني - ثلاجة', count: 3 });
}

function testAnalyticsUsesPaginatedSalesReadAndOperationalFiltering() {
    const api = fs.readFileSync(path.join(__dirname, '..', 'assets', 'supabase-config.js'), 'utf8');
    const page = fs.readFileSync(path.join(__dirname, '..', 'analytics', 'index.html'), 'utf8');
    const start = api.indexOf('async getAnalyticsReports(');
    const end = api.indexOf('\n    async getReportFields', start);
    assert.ok(start >= 0 && end > start, 'analytics report API must exist');
    assert.match(api.slice(start, end), /return readAllRows\(/, 'the report query must paginate beyond Supabase default row limits');
    const technicalStart = api.indexOf('async getAnalyticsTechnicalIssues(');
    const technicalEnd = api.indexOf('\n    // ============================================\n    // إحصائيات سريعة', technicalStart);
    assert.ok(technicalStart >= 0 && technicalEnd > technicalStart, 'technical issue analytics API must exist');
    const technicalApi = api.slice(technicalStart, technicalEnd);
    assert.match(technicalApi, /from\('technical_issues'\)/, 'analytics must read technical issues from their own source table');
    assert.match(technicalApi, /return readAllRows\(/, 'technical issues must use paginated reads');
    assert.match(technicalApi, /gte\('created_at'/);
    assert.match(technicalApi, /lt\('created_at'/, 'the end date must be exclusive to include the full Riyadh calendar day');
    assert.match(page, /ZamAPI\.getAnalyticsReports\(/);
    assert.match(page, /ZamAPI\.getAnalyticsTechnicalIssues\(/);
    assert.match(page, /ZamAnalyticsCore\.combineIssueSources\(/);
    assert.match(page, /ZamBranchLifecycle\.isOperational\(branch, recordDate\)/, 'planned branches must stay out of sales, waste, issues, and task counts');
    assert.match(page, /ZamAnalyticsCore\.summarizeSales/);
    assert.match(page, /ZamAnalyticsCore\.summarizeIssues/);
}

testSalesSummaryUsesWeightedAverageAndBranchGroups();
testSalesSummaryHandlesMissingOrInvalidValues();
testIssueSummaryGroupsTypePriorityAndBranch();
testTechnicalIssuesMergeWithShiftIssuesUsingRiyadhDates();
testAnalyticsUsesPaginatedSalesReadAndOperationalFiltering();
console.log('analytics-core tests: all checks passed');
