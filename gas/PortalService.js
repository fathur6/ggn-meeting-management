const PORTAL = { trackingSheet: 'UGS Attendance Tracking' };

function getPortalMeeting(committee) {
  requireMeetingAdmin_();
  const sheet = portalMeetingSheet_(committee);
  return {
    committee: committee,
    title: sheet.getRange('B1').getDisplayValue(),
    number: sheet.getRange('B3').getDisplayValue(),
    date: sheet.getRange('B4').getDisplayValue(),
    time: sheet.getRange('B5').getDisplayValue(),
    location: sheet.getRange('B6').getDisplayValue(),
    link: sheet.getRange('B7').getDisplayValue(),
    documents: sheet.getRange('B8').getDisplayValue()
  };
}

function savePortalMeeting(committee, data) {
  requireMeetingAdmin_();
  const sheet = portalMeetingSheet_(committee);
  sheet.getRange('B3:B8').setValues([[data.number || ''], [data.date || ''], [data.time || ''], [data.location || ''], [data.link || ''], [data.documents || '']]);
  return getPortalMeeting(committee);
}

function getPortalMembers(committee) {
  requireMeetingAdmin_();
  const sheetName = committee === 'JAPSU' ? 'Ahli JAPSU' : 'Ahli JKPS';
  const rows = readObjects_(getSpreadsheet_(), sheetName).filter(function(row) { return row.Nama && row.Emel; }).map(function(row) {
    return { id: row.Bil, name: row.Nama, position: row.Jawatan, faculty: row['Fakulti / Pusat / Institut'], email: row.Emel, appointment: portalIsoDate_(row['Tarikh Lantikan']), end: portalIsoDate_(row['Tarikh Tamat']), status: row['Status Keahlian'] || 'Aktif' };
  });
  return { active: rows.filter(function(row) { return !isPastMember_(row.status); }), past: rows.filter(function(row) { return isPastMember_(row.status); }) };
}

function savePortalMember(committee, member) {
  requireMeetingAdmin_();
  const sheet = getSpreadsheet_().getSheetByName(committee === 'JAPSU' ? 'Ahli JAPSU' : 'Ahli JKPS');
  const data = sheet.getDataRange().getValues();
  const rowIndex = data.slice(1).findIndex(function(row) { return String(row[0]) === String(member.id); });
  const existing = rowIndex >= 0 ? data[rowIndex + 1] : null;
  // A blank date from the form means "leave it as it was". Dates the form cannot
  // display used to be submitted blank and quietly wiped the appointment history.
  const held = function(index) { return existing && existing[index] ? existing[index] : ''; };
  const appointment = member.appointment ? portalIsoDate_(member.appointment) : held(5);
  const end = member.end ? portalIsoDate_(member.end) : held(6);
  const values = [member.name, member.position, member.faculty, member.email, appointment, end, member.status || 'Aktif'];
  if (rowIndex >= 0) sheet.getRange(rowIndex + 2, 2, 1, 7).setValues([values]);
  else sheet.appendRow([nextMemberId_(data), values[0], values[1], values[2], values[3], values[4], values[5], values[6]]);
  return getPortalMembers(committee);
}

// The sheet may hold a real date, an ISO string or dd/MM/yyyy text; the date input
// needs yyyy-MM-dd. readObjects_ already turns Date cells into "yyyy-MM-dd HH:mm:ss".
function portalIsoDate_(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return Utilities.formatDate(value, MEETING_ZONE, 'yyyy-MM-dd');
  }
  const text = String(value || '').trim();
  if (!text) return '';
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]|$)/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  const dmy = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (dmy) return dmy[3] + '-' + String(dmy[2]).padStart(2, '0') + '-' + String(dmy[1]).padStart(2, '0');
  return '';
}

function archivePortalMember(committee, id) {
  requireMeetingAdmin_();
  const sheet = getSpreadsheet_().getSheetByName(committee === 'JAPSU' ? 'Ahli JAPSU' : 'Ahli JKPS');
  const rows = sheet.getDataRange().getValues();
  const index = rows.slice(1).findIndex(function(row) { return String(row[0]) === String(id); });
  if (index < 0) throw new Error('Member not found.');
  sheet.getRange(index + 2, 7, 1, 2).setValues([[new Date(), 'Lepas']]);
  return getPortalMembers(committee);
}

function saveAttendanceTracking(committee, trackingId) {
  requireMeetingAdmin_();
  const id = String(trackingId || '').trim();
  if (!/^[a-zA-Z0-9]{5}$/.test(id)) throw new Error('Enter the final five-character eMeeting tracking ID.');
  const sheet = ensurePortalSheet_(PORTAL.trackingSheet, ['Committee', 'Tracking ID', 'Report URL', 'Updated At']);
  const rows = sheet.getDataRange().getValues();
  const index = rows.slice(1).findIndex(function(row) { return row[0] === committee; });
  const values = [committee, id, 'https://portal.unisza.edu.my/sistem/modules.php?name=emeeting&file=report2&thekey=' + id, new Date()];
  if (index >= 0) sheet.getRange(index + 2, 1, 1, 4).setValues([values]); else sheet.appendRow(values);
  return getAttendanceTracking(committee);
}

function getAttendanceTracking(committee) {
  requireMeetingAdmin_();
  const sheet = ensurePortalSheet_(PORTAL.trackingSheet, ['Committee', 'Tracking ID', 'Report URL', 'Updated At']);
  const row = readObjects_(getSpreadsheet_(), PORTAL.trackingSheet).filter(function(item) { return item.Committee === committee; })[0];
  return row ? { trackingId: row['Tracking ID'], url: row['Report URL'] } : { trackingId: '', url: '' };
}

function portalMeetingSheet_(committee) {
  if (['JKPS', 'JAPSU'].indexOf(committee) < 0) throw new Error('Invalid committee.');
  return getSpreadsheet_().getSheetByName('Mesyuarat ' + committee);
}

function ensurePortalSheet_(name, headers) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) { sheet = ss.insertSheet(name); sheet.appendRow(headers); }
  return sheet;
}

function isPastMember_(status) { return ['lepas', 'past', 'inactive'].indexOf(String(status || '').toLowerCase()) >= 0; }
function nextMemberId_(data) { return Math.max.apply(null, data.slice(1).map(function(row) { return Number(row[0]) || 0; }).concat([0])) + 1; }
