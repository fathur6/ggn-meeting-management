const MEETING_DOMAIN = /^[^\s@]+@unisza\.edu\.my$/;
const MEETING_ZONE = 'Asia/Kuala_Lumpur';

class MeetingAccountError_ extends Error {}
class MeetingDriveAuthorizationError_ extends Error {}

function meetingEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function signedInMeetingEmail_() {
  const email = meetingEmail_(Session.getActiveUser().getEmail());
  if (!MEETING_DOMAIN.test(email)) {
    throw new MeetingAccountError_('Log masuk dengan akaun Google UniSZA untuk meneruskan.');
  }
  return email;
}

// Run from the Apps Script editor using the deployment owner's account.
function checkMeetingDriveAccess() {
  const active = meetingEmail_(Session.getActiveUser().getEmail());
  const effective = meetingEmail_(Session.getEffectiveUser().getEmail());
  if (!active || active !== effective) throw new Error('Jalankan semakan ini menggunakan akaun pemilik deployment portal.');
  meetingWorkbook_();
  console.log('Akses Google Drive dan Google Sheet rasmi disahkan.');
}

function meetingWorkbook_() {
  // This workbook supplies authorization as well as records. Anyone with write
  // access to it is in a position to alter the rosters.
  let sharingAccess;
  try {
    sharingAccess = DriveApp.getFileById(CONFIG.spreadsheetId).getSharingAccess();
  } catch (error) {
    if (/https:\/\/www\.googleapis\.com\/auth\/drive(?:\.readonly)?\b/.test(error.message)) {
      throw new MeetingDriveAuthorizationError_('Kebenaran Google Drive belum diberikan kepada portal. Hubungi Urus Setia PPS.');
    }
    throw error;
  }
  if (sharingAccess !== DriveApp.Access.PRIVATE) {
    throw new Error('Tetapkan akses umum Google Sheet rasmi kepada Restricted sebelum menggunakan portal.');
  }
  return SpreadsheetApp.openById(CONFIG.spreadsheetId);
}

function meetingRoster_(book, tab) {
  const sheet = book.getSheetByName(tab);
  if (!sheet) throw new Error('Daftar rasmi jawatankuasa tidak ditemui.');
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const columns = new Map(headers.map((value, index) => [String(value).trim(), index]));
  if (!['Nama', 'Emel', 'Fakulti / Pusat / Institut'].every(header => columns.has(header))) {
    throw new Error('Lajur daftar rasmi tidak lengkap.');
  }
  const zone = book.getSpreadsheetTimeZone();
  const today = Utilities.formatDate(new Date(), MEETING_ZONE, 'yyyy-MM-dd');
  return rows.flatMap(row => {
    const cell = header => row[columns.get(header)];
    const name = String(cell('Nama') || '').trim();
    const email = meetingEmail_(cell('Emel'));
    const unit = String(cell('Fakulti / Pusat / Institut') || '').replace(/\s+/g, ' ').trim();
    const role = String(cell('Jawatan') || '').trim();
    const status = String(cell('Status Keahlian') || '').trim().toLowerCase();
    const started = membershipDate_(cell('Tarikh Lantikan'), zone);
    const ended = membershipDate_(cell('Tarikh Tamat'), zone);
    const active = ['', 'aktif', 'active'].includes(status)
      && (!cell('Tarikh Lantikan') || Boolean(started && started <= today))
      && (!cell('Tarikh Tamat') || Boolean(ended && ended >= today));
    return name && MEETING_DOMAIN.test(email) && active ? [{name, email, unit, role}] : [];
  });
}

function membershipDate_(value, zone) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return Utilities.formatDate(value, zone, 'yyyy-MM-dd');
  }
  // Non-date cells written by the management form contain ISO dates.
  const day = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const date = new Date(day + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : '';
}

function meetingAdmin_(book, email) {
  return meetingRoster_(book, 'Ahli PPS').some(member => member.email === email);
}

// Reserved actions (deleting a circulation paper, appointing portal
// administrators) belong to the TDA PPS alone. Keep the list in one place so the
// front end and the server read the same source of truth; the server check is the
// one that matters.
const MEETING_TDA_PPS_EMAILS = ['fathurrahman@unisza.edu.my'];

function isMeetingTdaPps_(email) {
  const target = meetingEmail_(email);
  return Boolean(target) && MEETING_TDA_PPS_EMAILS.includes(target);
}

function requireMeetingTdaPps_() {
  const access = requireMeetingAdmin_();
  if (!isMeetingTdaPps_(access.email)) {
    throw new MeetingAccountError_('Tindakan ini dikhaskan untuk TDA PPS.');
  }
  return access;
}

function requireMeetingAdmin_() {
  const email = signedInMeetingEmail_();
  const book = meetingWorkbook_();
  if (!meetingAdmin_(book, email)) throw new MeetingAccountError_('Halaman pengurusan dikhaskan untuk Urus Setia PPS.');
  return {book, email};
}
