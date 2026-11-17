(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ZamAnalyticsCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function number(value) {
        const parsed = typeof value === 'number' ? value : Number(String(value == null ? '' : value).replace(/,/g, '').trim());
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function relationName(relation) {
        const item = Array.isArray(relation) ? relation[0] : relation;
        return item && item.name ? String(item.name) : 'غير محدد';
    }

    function summarizeSales(reports) {
        const rows = Array.isArray(reports) ? reports : [];
        const branches = new Map();
        let totalSales = 0;
        let orderCount = 0;

        rows.forEach(report => {
            const sales = number(report && report.total_sales);
            const orders = number(report && report.orders_count);
            totalSales += sales;
            orderCount += orders;

            const name = relationName(report && report.branches);
            const id = report && report.branch_id != null ? String(report.branch_id) : name;
            if (!branches.has(id)) branches.set(id, { id, name, reportCount: 0, totalSales: 0, orderCount: 0 });
            const branch = branches.get(id);
            branch.reportCount += 1;
            branch.totalSales += sales;
            branch.orderCount += orders;
        });

        const byBranch = Array.from(branches.values()).map(branch => ({
            ...branch,
            weightedAverageTicket: branch.orderCount ? branch.totalSales / branch.orderCount : 0
        })).sort((a, b) => b.totalSales - a.totalSales || a.name.localeCompare(b.name, 'ar'));

        return {
            reportCount: rows.length,
            totalSales,
            orderCount,
            weightedAverageTicket: orderCount ? totalSales / orderCount : 0,
            byBranch
        };
    }

    function summarizeIssues(issues) {
        const rows = Array.isArray(issues) ? issues : [];
        const types = new Map();
        const priorities = new Map();
        const branches = new Set();
        let highPriorityCount = 0;

        rows.forEach(issue => {
            const type = String(issue && (issue.issue_type || issue.type) || '').trim() || 'غير مصنف';
            const priority = String(issue && issue.priority || '').trim() || 'غير محددة';
            types.set(type, (types.get(type) || 0) + 1);
            priorities.set(priority, (priorities.get(priority) || 0) + 1);

            const report = issue && issue.daily_reports;
            const branchId = report && report.branch_id != null ? report.branch_id : issue && issue.branch_id;
            const reportBranchName = relationName(report && report.branches);
            const branchName = reportBranchName !== 'غير محدد' ? reportBranchName : relationName(issue && issue.branches);
            if (branchId != null) branches.add(String(branchId));
            else if (branchName !== 'غير محدد') branches.add(branchName);

            if (/^(عالية|عالي|عاجل|high|critical|urgent)$/i.test(priority)) highPriorityCount += 1;
        });

        const rank = map => Array.from(map.entries())
            .map(([label, count]) => ({ label, count }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ar'));
        const byType = rank(types);
        const byPriority = rank(priorities);

        return {
            total: rows.length,
            affectedBranches: branches.size,
            highPriorityCount,
            topType: byType[0] || null,
            byType,
            byPriority
        };
    }

    return Object.freeze({ summarizeSales, summarizeIssues });
});
