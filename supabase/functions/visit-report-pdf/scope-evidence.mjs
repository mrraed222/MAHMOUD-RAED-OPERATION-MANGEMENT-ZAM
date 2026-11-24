export function visitEvidenceBucketFor(item) {
  return item?.action_item_id ? 'visit-action-evidence' : 'task-evidence';
}

export function scopeVisitPdfRows({ actions = [], evidenceRows = [], fullReportVisible = false }) {
  const scopedActions = Array.isArray(actions) ? actions : [];
  if (fullReportVisible) {
    return { actions: scopedActions, evidenceRows: Array.isArray(evidenceRows) ? evidenceRows : [] };
  }

  const allowedActionIds = new Set(
    scopedActions.map(action => action?.id).filter(value => value != null).map(String),
  );
  const scopedEvidenceRows = (Array.isArray(evidenceRows) ? evidenceRows : []).filter(row =>
    row?.action_item_id != null && allowedActionIds.has(String(row.action_item_id)),
  );

  return { actions: scopedActions, evidenceRows: scopedEvidenceRows };
}
