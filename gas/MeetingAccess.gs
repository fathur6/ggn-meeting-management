const MEETING_DOMAIN = /@unisza\.edu\.my$/;
const MEETING_ZONE = 'Asia/Kuala_Lumpur';

function meetingEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function signedInMeetingEmail_() {
  const email = meetingEmail_(Session.getActiveUser().getEmail());
  if (!MEETING_DOMAIN.test(email)) {
    throw new Error('Log masuk dengan akaun Google UniSZA. Jika membuka pautan melalui WhatsApp, cuba gunakan pelayar biasa.');
  }
  return email;
}

function privateMeetingFile_(id, message, resourceKey) {
  const file = resourceKey ? DriveApp.getFileByIdAndResourceKey(id, resourceKey) : DriveApp.getFileById(id);
  if (file.getSharingAccess() !== DriveApp.Access.PRIVATE) throw new Error(message);
  return file;
}

function meetingWorkbook_() {
  // This workbook supplies authorization as well as records. Anyone with write
  // access to it is in a position to alter the rosters.
  privateMeetingFile_(CONFIG.spreadsheetId, 'Tetapkan akses umum Google Sheet rasmi kepada Restricted sebelum menggunakan portal.');
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
  const today = Utilities.formatDate(new Date(), MEETING_ZONE, 'yyyy-MM-dd');
  return rows.flatMap(row => {
    const cell = header => row[columns.get(header)];
    const name = String(cell('Nama') || '').trim();
    const email = meetingEmail_(cell('Emel'));
    const unit = String(cell('Fakulti / Pusat / Institut') || '').replace(/\s+/g, ' ').trim();
    const role = String(cell('Jawatan') || '').trim();
    const status = String(cell('Status Keahlian') || '').trim().toLowerCase();
    const started = membershipDate_(cell('Tarikh Lantikan'), book.getSpreadsheetTimeZone());
    const ended = membershipDate_(cell('Tarikh Tamat'), book.getSpreadsheetTimeZone());
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
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
}

function meetingAdmin_(book, email) {
  return meetingRoster_(book, 'Ahli PPS').some(member => member.email === email);
}

function requireMeetingAdmin_() {
  const email = signedInMeetingEmail_();
  const book = meetingWorkbook_();
  if (!meetingAdmin_(book, email)) throw new Error('Halaman pengurusan dikhaskan untuk Urus Setia PPS.');
  return {book, email};
}
