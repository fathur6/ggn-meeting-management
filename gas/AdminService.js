/**
 * Portal administrators.
 *
 * The administration roster is the `Ahli PPS` tab of the official workbook: the
 * same tab that already decides who may open the management pages. This file only
 * adds the `Jawatan` role codes (TDA_PPS, PPA, PJK) so the portal can name each
 * administrator and let the TDA PPS appoint the others.
 *
 * Only the TDA PPS may add, edit or withdraw an administrator. Everyone else who
 * can open the portal sees the roster read-only.
 */

const PORTAL_ADMIN_TAB = 'Ahli PPS';
const PORTAL_ADMIN_ROLES = ['TDA_PPS', 'PPA', 'PJK'];
const PORTAL_ADMIN_UNIT = 'PPS';

function getPortalAccess() {
  const {book, email} = requireMeetingAdmin_();
  const rows = portalAdminRows_(book);
  const mine = rows.find(row => row.email === email) || null;
  const tda = isMeetingTdaPps_(email);
  return {
    email: email,
    name: mine ? mine.name : '',
    role: tda ? 'TDA_PPS' : (mine && mine.role ? mine.role : ''),
    roleLabel: tda ? 'TDA PPS' : (mine && mine.roleLabel ? mine.roleLabel : 'PPS'),
    canDeletePapers: tda,
    canManageAdmins: tda,
  };
}

function getPortalAdmins() {
  const {book} = requireMeetingAdmin_();
  return portalAdminPayload_(book);
}

function savePortalAdmin(member) {
  const {book} = requireMeetingTdaPps_();
  const input = member || {};
  const name = portalAdminText_(input.name, 160, 'Nama');
  const email = meetingEmail_(input.email);
  if (!MEETING_DOMAIN.test(email)) throw new Error('E-mel mesti berakhir dengan @unisza.edu.my.');
  // '__keep' leaves an existing free-text Jawatan (for example "Dekan") untouched
  // instead of forcing the whole roster into role codes in one edit.
  const requested = String(input.role || '').trim();
  const keepRole = requested === '__keep';
  const role = requested.toUpperCase();
  if (!keepRole && !PORTAL_ADMIN_ROLES.includes(role)) throw new Error('Peranan pentadbir tidak sah.');
  const unit = String(input.unit || '').trim() ? portalAdminText_(input.unit, 160, 'Fakulti / unit') : PORTAL_ADMIN_UNIT;
  const appointment = portalAdminIsoDate_(input.appointment) || portalAdminToday_();

  const sheet = portalAdminSheet_(book);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(value => String(value).trim());
  const columns = new Map(headers.map((value, index) => [value, index]));
  ['Nama', 'Emel', 'Jawatan', 'Fakulti / Pusat / Institut'].forEach(header => {
    if (!columns.has(header)) throw new Error('Lajur "' + header + '" tiada dalam tab ' + PORTAL_ADMIN_TAB + '.');
  });

  // Match on id (Bil) first, then on the email so a previously withdrawn
  // administrator is reactivated instead of duplicated.
  const id = String(input.id || '').trim();
  const idAt = columns.get('Bil');
  let index = id && idAt !== undefined ? data.slice(1).findIndex(row => String(row[idAt]) === id) : -1;
  if (index < 0) index = data.slice(1).findIndex(row => meetingEmail_(row[columns.get('Emel')]) === email);

  const existingRole = index >= 0 ? String(data[index + 1][columns.get('Jawatan')] || '').trim() : '';
  if (keepRole && !existingRole) throw new Error('Pilih peranan pentadbir.');
  // An allowlisted TDA PPS keeps the matching label even if another role was
  // picked, so the roster never disagrees with the account's real rights.
  const label = keepRole ? existingRole : (isMeetingTdaPps_(email) ? 'TDA_PPS' : role);

  if (index >= 0) {
    const row = index + 2;
    const existing = data[index + 1];
    const keep = header => {
      const at = columns.get(header);
      return at === undefined ? '' : existing[at];
    };
    const archived = isPastMember_(keep('Status Keahlian'));
    const values = new Map();
    values.set('Nama', name);
    values.set('Emel', email);
    values.set('Jawatan', label);
    values.set('Fakulti / Pusat / Institut', unit);
    values.set('Tarikh Lantikan', keep('Tarikh Lantikan') || appointment);
    // Editing a withdrawn row restores it; an active appointment keeps any
    // planned end date instead of losing it.
    values.set('Tarikh Tamat', archived ? '' : keep('Tarikh Tamat'));
    values.set('Status Keahlian', 'Aktif');
    values.forEach((value, header) => {
      const at = columns.get(header);
      if (at !== undefined) sheet.getRange(row, at + 1).setValue(value);
    });
  } else {
    const record = new Array(headers.length).fill('');
    const put = (header, value) => {
      const at = columns.get(header);
      if (at !== undefined) record[at] = value;
    };
    put('Bil', idAt !== undefined ? Math.max(0, ...data.slice(1).map(row => Number(row[idAt]) || 0)) + 1 : data.length);
    put('Nama', name);
    put('Emel', email);
    put('Jawatan', label);
    put('Fakulti / Pusat / Institut', unit);
    put('Tarikh Lantikan', appointment);
    put('Tarikh Tamat', '');
    put('Status Keahlian', 'Aktif');
    sheet.appendRow(record);
  }
  SpreadsheetApp.flush();
  return portalAdminPayload_(book);
}

/**
 * Withdraws access by archiving the roster row (`Status Keahlian` = Lepas) so the
 * appointment record survives. The row can be restored from the same form.
 */
function removePortalAdmin(id) {
  const {book, email: actor} = requireMeetingTdaPps_();
  const sheet = portalAdminSheet_(book);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(value => String(value).trim());
  const columns = new Map(headers.map((value, index) => [value, index]));
  const idAt = columns.get('Bil');
  ['Emel', 'Tarikh Tamat', 'Status Keahlian'].forEach(header => {
    if (!columns.has(header)) throw new Error('Lajur "' + header + '" tiada dalam tab ' + PORTAL_ADMIN_TAB + '.');
  });
  const index = data.slice(1).findIndex((row, offset) =>
    String((idAt !== undefined ? row[idAt] : '') || offset + 2).trim() === String(id));
  if (index < 0) throw new Error('Rekod pentadbir tidak ditemui.');
  const target = meetingEmail_(data[index + 1][columns.get('Emel')]);
  if (target && target === actor) throw new Error('Anda tidak boleh menarik akses pentadbir anda sendiri.');
  if (isMeetingTdaPps_(target)) throw new Error('Akaun TDA PPS tidak boleh dibuang melalui portal.');

  sheet.getRange(index + 2, columns.get('Tarikh Tamat') + 1).setValue(new Date());
  sheet.getRange(index + 2, columns.get('Status Keahlian') + 1).setValue('Lepas');
  SpreadsheetApp.flush();
  return portalAdminPayload_(book);
}

function portalAdminPayload_(book) {
  const rows = portalAdminRows_(book);
  return {
    roles: PORTAL_ADMIN_ROLES,
    active: rows.filter(row => !isPastMember_(row.status)),
    past: rows.filter(row => isPastMember_(row.status)),
  };
}

function portalAdminRows_(book) {
  const sheet = book.getSheetByName(PORTAL_ADMIN_TAB);
  if (!sheet) throw new Error('Tab ' + PORTAL_ADMIN_TAB + ' tidak ditemui dalam Google Sheet rasmi.');
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const columns = new Map(headers.map((value, index) => [String(value).trim(), index]));
  if (!columns.has('Emel')) throw new Error('Lajur "Emel" tiada dalam tab ' + PORTAL_ADMIN_TAB + '.');
  return rows.flatMap((row, index) => {
    const cell = header => (columns.has(header) ? row[columns.get(header)] : '');
    const email = meetingEmail_(cell('Emel'));
    if (!email) return [];
    const position = String(cell('Jawatan') || '').trim();
    return [{
      id: String(cell('Bil') || '').trim() || String(index + 2),
      name: String(cell('Nama') || '').trim(),
      email: email,
      role: portalAdminRole_(position),
      roleLabel: position || 'Belum ditetapkan',
      unit: String(cell('Fakulti / Pusat / Institut') || '').replace(/\s+/g, ' ').trim() || PORTAL_ADMIN_UNIT,
      appointment: portalAdminIsoDate_(cell('Tarikh Lantikan')),
      end: portalAdminIsoDate_(cell('Tarikh Tamat')),
      status: String(cell('Status Keahlian') || 'Aktif').trim() || 'Aktif',
    }];
  });
}

function portalAdminRole_(value) {
  const key = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return PORTAL_ADMIN_ROLES.includes(key) ? key : '';
}

function portalAdminSheet_(book) {
  const sheet = book.getSheetByName(PORTAL_ADMIN_TAB);
  if (!sheet) throw new Error('Tab ' + PORTAL_ADMIN_TAB + ' tidak ditemui dalam Google Sheet rasmi.');
  // The PPS roster may predate the membership lifecycle columns. Add any missing
  // header in the same slot 6-8 convention used by Ahli JKPS and Ahli JAPSU, or in
  // the next free column when that slot is taken by something else.
  const width = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, width).getValues()[0].map(value => String(value).trim());
  ['Tarikh Lantikan', 'Tarikh Tamat', 'Status Keahlian'].forEach(header => {
    if (headers.includes(header)) return;
    let column = 6;
    while (column <= headers.length && headers[column - 1]) column++;
    sheet.getRange(1, column).setValue(header).setFontWeight('bold');
    headers[column - 1] = header;
  });
  return sheet;
}

function portalAdminText_(value, limit, field) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error(field + ' diperlukan.');
  if (text.length > limit) throw new Error(field + ' melebihi ' + limit + ' aksara.');
  return text;
}

function portalAdminIsoDate_(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return Utilities.formatDate(value, MEETING_ZONE, 'yyyy-MM-dd');
  }
  const day = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
}

function portalAdminToday_() {
  return Utilities.formatDate(new Date(), MEETING_ZONE, 'yyyy-MM-dd');
}
