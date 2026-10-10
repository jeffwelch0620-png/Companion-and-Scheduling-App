// Older queue entries stored only the error code. Their non-age review outcome was HTTP 409.
export const isSubmissionConflict=entry=>entry?.status==='needs_review'
 &&(entry.responseStatus===409||entry.error!=='queue_age_exceeded');
