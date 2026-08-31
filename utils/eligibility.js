// Business rules from Mega Clinic's HR policy:
//  - After 4 months of tenure, an employee becomes eligible for group insurance
//    (HR must notify the insurer to enroll them).
//  - After 6 months of tenure, an employee may add exactly 1 relative to the
//    policy (HR must notify the insurer once the relative's info is on file).
//  - When an employee resigns, HR must notify the insurer to remove them
//    (and their relative, if any) from the policy.

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function toISODate(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const MS = 24 * 60 * 60 * 1000;
  return Math.round((new Date(b) - new Date(a)) / MS);
}

// Returns a status object describing where an employee sits relative to the
// two milestones, for a given "as of" date (defaults to today).
function computeEligibility(emp, asOf = new Date()) {
  const startDate = emp.start_date ? new Date(emp.start_date) : null;
  const resignEff = emp.resign_eff ? new Date(emp.resign_eff) : null;
  // status is the authoritative field (verified 1:1 consistent with status_resign
  // across the full dataset). A stray resign_eff value on an otherwise-active
  // record does happen in the source data (e.g. a cancelled resignation) and
  // should not by itself mark someone as resigned.
  const isResigned = emp.status === 'OFF';

  const eligible4mDate = startDate ? addMonths(startDate, 4) : null;
  const eligible6mDate = startDate ? addMonths(startDate, 6) : null;

  const reached4m = eligible4mDate ? asOf >= eligible4mDate : false;
  const reached6m = eligible6mDate ? asOf >= eligible6mDate : false;

  return {
    empId: emp.emp_id,
    isResigned,
    startDate: toISODate(startDate),
    resignEff: toISODate(resignEff),
    eligible4mDate: toISODate(eligible4mDate),
    eligible6mDate: toISODate(eligible6mDate),
    reached4m,
    reached6m,
    needsEnrollNotice: !isResigned && reached4m && !emp.notify_in,
    needsExitNotice: isResigned && !emp.notify_out,
    canAddRelative: !isResigned && reached6m,
    daysUntil4m: eligible4mDate ? daysBetween(asOf, eligible4mDate) : null,
    daysUntil6m: eligible6mDate ? daysBetween(asOf, eligible6mDate) : null,
  };
}

module.exports = { computeEligibility, addMonths, toISODate, daysBetween };
