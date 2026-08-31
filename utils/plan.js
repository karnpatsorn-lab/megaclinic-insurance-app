// Level -> insurance plan mapping (from the broker's plan table):
//   Level 10-15  -> Plan 5
//   Level 5-9    -> Plan 4
//   Level 1-4    -> Plan 3
//   Maid/Driver  -> Plan 2 (regardless of level)
//   Relative     -> Plan 1 (handled separately in export.js)
//
// The source spreadsheet's own "plan" column is blank for a large share of
// records (mostly people never added to the ประกันกลุ่ม tracking sheet), so
// we derive it from level_label/position whenever it's missing.

function parseLevel(levelLabel) {
  if (!levelLabel) return null;
  const m = String(levelLabel).match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function isMaidOrDriver(position) {
  if (!position) return false;
  const p = position.toLowerCase();
  return p.includes('maid') || p.includes('driver');
}

function resolvePlan(emp) {
  if (emp.plan) return String(emp.plan);
  if (isMaidOrDriver(emp.position)) return '2';
  const level = emp.level || parseLevel(emp.level_label);
  if (level === null) return null;
  if (level >= 10) return '5';
  if (level >= 5) return '4';
  if (level >= 0) return '3'; // covers the documented 1-4 band plus an observed "Staff 0" grade
  return null;
}

module.exports = { resolvePlan, parseLevel, isMaidOrDriver };
