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

function testAnalyticsUsesPaginatedSalesReadAndOperationalFiltering() {
    const api = fs.readFileSync(path.join(__dirname, '..', 'assets', 'supabase-config.js'), 'utf8');
    const page = fs.readFileSync(path.join(__dirname, '..', 'analytics', 'index.html'), 'utf8');
    const start = api.indexOf('async getAnalyticsReports(');
    const end = api.indexOf('\n    async getReportFields', start);
    assert.ok(start >= 0 && end > start, 'analytics report API must exist');
    assert.match(api.slice(start, end), /return readAllRows\(/, 'the report query must paginate beyond Supabase default row limits');
    assert.match(page, /ZamAPI\.getAnalyticsReports\(/);
    assert.match(page, /ZamBranchLifecycle\.isOperational\(branch, recordDate\)/, 'planned branches must stay out of sales, waste, issues, and task counts');
    assert.match(page, /ZamAnalyticsCore\.summarizeSales/);
    assert.match(page, /ZamAnalyticsCore\.summarizeIssues/);
}

testSalesSummaryUsesWeightedAverageAndBranchGroups();
testSalesSummaryHandlesMissingOrInvalidValues();
testIssueSummaryGroupsTypePriorityAndBranch();
testAnalyticsUsesPaginatedSalesReadAndOperationalFiltering();
console.log('analytics-core tests: all checks passed');
