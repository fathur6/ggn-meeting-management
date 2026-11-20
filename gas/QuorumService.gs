const CONFIG = {
  spreadsheetId: '1FPSij01iB7r40S-FDfX0haAPr_VZt8apHHUbxM3SBok',
  rosterSheet: 'Ahli JKPS',
  sheets: {
    meetings: 'JKPS Live Meetings',
    attendance: 'JKPS Live Attendance',
    representatives: 'JKPS Representation Rules',
    memberships: 'JKPS Membership History',
    calls: 'JKPS Meeting Calls'
  },
  liveSyncTokenProperty: 'JKPS_LIVE_SYNC_TOKEN'
};

// Called by the existing API's doPost action `syncLiveAttendance`.
function resolveLiveSyncToken_() {
  return PropertiesService.getScriptProperties().getProperty(CONFIG.liveSyncTokenProperty);
}

function handleLiveAttendancePost_(payload) {
  const token = resolveLiveSyncToken_();
  if (!token || payload.token !== token) throw new Error('Invalid live-sync token.');
  meetingWorkbook_();
  return committeeForTracking_(payload.trackingId) === 'JAPSU' ? ingestJapsuLiveAttendance_(payload) : ingestLiveAttendance_(payload);
}

function getLiveTrackingDashboard(committee, meetingId) {
  requireMeetingAdmin_();
  return getLiveTrackingDashboard_(committee, meetingId);
}

function getLiveTrackingDashboard_(committee, meetingId) {
  if (committee !== 'JAPSU') return enrichTrackingRows_(getDashboardData_(meetingId), 'JKPS');
  const ss = getSpreadsheet_();
  ensureSheet_(ss, 'JAPSU Live Meetings', ['Meeting ID', 'Title', 'Meeting Date', 'Created At', 'Eligible Members', 'Quorum Required']);
  ensureSheet_(ss, 'JAPSU Live Attendance', ['Meeting ID', 'Source Name', 'Source Faculty', 'Check-in Time', 'Match Type', 'Roster Name', 'Roster Email', 'Match Status', 'Synced At']);
  const meetings = readObjects_(ss, 'JAPSU Live Meetings');
  const meeting = meetings.filter(function(row) { return row['Meeting ID'] === meetingId; })[0] || meetings[0] || null;
  const rows = meeting ? readObjects_(ss, 'JAPSU Live Attendance').filter(function(row) { return row['Meeting ID'] === meeting['Meeting ID']; }) : [];
  const counted = {};
  rows.filter(function(row) { return row['Match Status'] === 'Counted'; }).forEach(function(row) { counted[row['Roster Email']] = true; });
  const roster = committeeRoster_(ss, 'Ahli JAPSU');
  const totalMembers = Number(meeting && meeting['Eligible Members']) || roster.length;
  const quorumRequired = Number(meeting && meeting['Quorum Required']) || Math.ceil((2 * totalMembers) / 3);
  return enrichTrackingRows_({ meetings: meetings, selectedMeeting: meeting, attendees: rows, totalMembers: totalMembers, presentCount: Object.keys(counted).length, quorumRequired: quorumRequired, hasQuorum: Object.keys(counted).length >= quorumRequired }, 'JAPSU');
}

function ingestJapsuLiveAttendance_(payload) {
  const ss = getSpreadsheet_();
  ensureSheet_(ss, 'JAPSU Live Meetings', ['Meeting ID', 'Title', 'Meeting Date', 'Created At', 'Eligible Members', 'Quorum Required']);
  ensureSheet_(ss, 'JAPSU Live Attendance', ['Meeting ID', 'Source Name', 'Source Faculty', 'Check-in Time', 'Match Type', 'Roster Name', 'Roster Email', 'Match Status', 'Synced At']);
  const roster = committeeRoster_(ss, 'Ahli JAPSU');
  const title = String(payload.meetingTitle || '').trim();
  let meeting = readObjects_(ss, 'JAPSU Live Meetings').filter(function(row) { return row.Title === title; })[0];
  if (!meeting) {
    const id = Utilities.getUuid(); const date = extractDate_(title) || new Date(); const quorum = Math.ceil((2 * roster.length) / 3);
    ss.getSheetByName('JAPSU Live Meetings').appendRow([id, title, date, new Date(), roster.length, quorum]);
    meeting = { 'Meeting ID': id, Title: title, 'Meeting Date': formatDate_(date), 'Eligible Members': String(roster.length), 'Quorum Required': String(quorum) };
  }
  const rows = (payload.attendees || []).map(function(attendee) {
    const member = roster.filter(function(item) { return normalize_(item.name) === normalize_(attendee.name); })[0];
    return [meeting['Meeting ID'], attendee.name || '', attendee.faculty || '', attendee.checkInTime || '', member ? 'Member name' : 'Unmatched', member ? member.name : '', member ? member.email : '', member ? 'Counted' : 'Review required', new Date()];
  });
  replaceMeetingAttendance_(ss.getSheetByName('JAPSU Live Attendance'), meeting['Meeting ID'], rows);
  return getLiveTrackingDashboard_('JAPSU', meeting['Meeting ID']);
}

function committeeForTracking_(trackingId) {
  const id = String(trackingId || '').trim();
  if (!id) return 'JKPS';
  ensurePortalSheet_(PORTAL.trackingSheet, ['Committee', 'Tracking ID', 'Report URL', 'Updated At']);
  const rows = readObjects_(getSpreadsheet_(), PORTAL.trackingSheet);
  return (rows.filter(function(row) { return row['Tracking ID'] === id; })[0] || {}).Committee || 'JKPS';
}

function committeeRoster_(ss, sheetName) {
  return readObjects_(ss, sheetName).filter(function(row) { return row.Nama && row.Emel && !['lepas', 'past', 'inactive'].includes(String(row['Status Keahlian'] || 'Aktif').toLowerCase()); }).map(function(row) {
    return { name: row.Nama, email: row.Emel.toLowerCase(), faculty: row['Fakulti / Pusat / Institut'] || '', position: row.Jawatan || '' };
  });
}

function enrichTrackingRows_(data, committee) {
  const lookup = {};
  committeeRoster_(getSpreadsheet_(), committee === 'JAPSU' ? 'Ahli JAPSU' : 'Ahli JKPS').forEach(function(member) { lookup[member.email] = member; });
  data.attendees = data.attendees.map(function(row) { row.Position = (lookup[row['Roster Email']] || {}).position || ''; return row; });
  return data;
}

function initializeApp() {
  requireMeetingAdmin_();
  const ss = getSpreadsheet_();
  ensureSheet_(ss, CONFIG.sheets.meetings, ['Meeting ID', 'Title', 'Meeting Date', 'Created At', 'Created By', 'Eligible Members', 'Quorum Required']);
  ensureSheet_(ss, CONFIG.sheets.attendance, ['Meeting ID', 'Source Name', 'Source Faculty', 'Check-in Time', 'Match Type', 'Roster Name', 'Roster Email', 'Match Status', 'Synced At']);
  ensureSheet_(ss, CONFIG.sheets.representatives, ['eMeeting Faculty', 'Representing Member Email', 'Active']);
  ensureSheet_(ss, CONFIG.sheets.memberships, ['Member Email', 'Member Name', 'Membership Start', 'Membership End', 'Active']);
  ensureSheet_(ss, CONFIG.sheets.calls, ['Meeting ID', 'Member Email', 'Called On', 'Status']);
  return getDashboardData_();
}

function getDashboardData(meetingId) {
  requireMeetingAdmin_();
  return getDashboardData_(meetingId);
}

function getDashboardData_(meetingId) {
  const ss = getSpreadsheet_();
  const roster = readRoster_(ss);
  const meetings = readObjects_(ss, CONFIG.sheets.meetings).sort(function(a, b) {
    return new Date(b['Meeting Date']) - new Date(a['Meeting Date']);
  });
  const meeting = meetings.filter(function(row) { return row['Meeting ID'] === meetingId; })[0] || meetings[0] || null;
  const rows = meeting ? readObjects_(ss, CONFIG.sheets.attendance).filter(function(row) {
    return row['Meeting ID'] === meeting['Meeting ID'];
  }) : [];
  const counted = {};
  rows.filter(function(row) { return row['Match Status'] === 'Counted'; }).forEach(function(row) {
    counted[row['Roster Email']] = true;
  });
  const presentCount = Object.keys(counted).length;
  // A meeting uses its opening roster snapshot so later membership changes do not rewrite history.
  const totalMembers = Number(meeting && meeting['Eligible Members']) || roster.length;
  const quorumRequired = Number(meeting && meeting['Quorum Required']) || Math.ceil((2 * totalMembers) / 3);
  const unmatched = rows.filter(function(row) { return row['Match Status'] !== 'Counted'; });

  return {
    meetings: meetings,
    selectedMeeting: meeting,
    totalMembers: totalMembers,
    presentCount: presentCount,
    quorumRequired: quorumRequired,
    hasQuorum: presentCount >= quorumRequired,
    lastSyncedAt: rows.length ? rows[0]['Synced At'] : '',
    attendees: rows,
    unmatched: unmatched
  };
}

function createMeeting(data) {
  requireMeetingAdmin_();
  if (!data || !String(data.title || '').trim() || !data.meetingDate) {
    throw new Error('A meeting title and date are required.');
  }
  const meeting = createMeetingRecord_(getSpreadsheet_(), String(data.title).trim(), new Date(data.meetingDate + 'T00:00:00'), Session.getActiveUser().getEmail());
  return getDashboardData_(meeting['Meeting ID']);
}

function setLiveSyncToken(token) {
  requireMeetingAdmin_();
  if (!token || String(token).length < 24) throw new Error('Use a random token of at least 24 characters.');
  PropertiesService.getScriptProperties().setProperty(CONFIG.liveSyncTokenProperty, String(token));
}

function ingestLiveAttendance_(payload) {
  if (!Array.isArray(payload.attendees)) throw new Error('The attendance payload is invalid.');
  const ss = getSpreadsheet_();
  const meeting = resolveMeeting_(ss, payload);
  const roster = readRoster_(ss);
  const representativeRules = representativeRules_(ss, roster);
  const syncedAt = new Date();
  const rows = payload.attendees.map(function(attendee) {
    const match = matchAttendee_(attendee, roster, representativeRules);
    return [
      meeting['Meeting ID'], attendee.name || '', attendee.faculty || '', attendee.checkInTime || '',
      match.type, match.member ? match.member.name : '', match.member ? match.member.email : '', match.status, syncedAt
    ];
  });
  replaceMeetingAttendance_(ss.getSheetByName(CONFIG.sheets.attendance), meeting['Meeting ID'], rows);
  return getDashboardData_(meeting['Meeting ID']);
}

function resolveMeeting_(ss, payload) {
  const meetings = readObjects_(ss, CONFIG.sheets.meetings);
  const title = String(payload.meetingTitle || '').trim();
  const existing = meetings.filter(function(row) { return row.Title === title; })[0];
  if (existing) return existing;
  if (!title) throw new Error('The source report did not contain a meeting title.');
  return createMeetingRecord_(ss, title, extractDate_(title) || new Date(), 'eMeeting live sync');
}

function createMeetingRecord_(ss, title, date, createdBy) {
  const roster = readRoster_(ss);
  const meetingId = Utilities.getUuid();
  const quorumRequired = Math.ceil((2 * roster.length) / 3);
  ss.getSheetByName(CONFIG.sheets.meetings).appendRow([meetingId, title, date, new Date(), createdBy, roster.length, quorumRequired]);
  if (roster.length) {
    ss.getSheetByName(CONFIG.sheets.calls).getRange(ss.getSheetByName(CONFIG.sheets.calls).getLastRow() + 1, 1, roster.length, 4)
      .setValues(roster.map(function(member) { return [meetingId, member.email, new Date(), 'Called']; }));
  }
  return { 'Meeting ID': meetingId, Title: title, 'Meeting Date': formatDate_(date), 'Eligible Members': String(roster.length), 'Quorum Required': String(quorumRequired) };
}

function seedCurrentMemberships(startDate) {
  requireMeetingAdmin_();
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(CONFIG.sheets.memberships);
  const existingEmails = readObjects_(ss, CONFIG.sheets.memberships).map(function(row) { return row['Member Email'].toLowerCase(); });
  const newMembers = readRoster_(ss).filter(function(member) { return existingEmails.indexOf(member.email) === -1; });
  if (newMembers.length) sheet.getRange(sheet.getLastRow() + 1, 1, newMembers.length, 5).setValues(newMembers.map(function(member) {
    const effectiveDate = member.appointmentDate || startDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(effectiveDate || ''))) throw new Error('Set Tarikh Lantikan for every member, or provide a YYYY-MM-DD fallback date.');
    return [member.email, member.name, effectiveDate, member.endDate || '', 'Yes'];
  }));
  return newMembers.length;
}

function getAnnualAttendanceReport(year) {
  requireMeetingAdmin_();
  const reportYear = Number(year);
  if (!/^\d{4}$/.test(String(reportYear))) throw new Error('Choose a valid four-digit year.');
  const ss = getSpreadsheet_();
  const meetings = readObjects_(ss, CONFIG.sheets.meetings).filter(function(meeting) { return meeting['Meeting Date'].slice(0, 4) === String(reportYear); });
  const calls = readObjects_(ss, CONFIG.sheets.calls);
  const attendance = readObjects_(ss, CONFIG.sheets.attendance).filter(function(row) { return row['Match Status'] === 'Counted'; });
  const histories = readObjects_(ss, CONFIG.sheets.memberships).filter(function(row) { return row.Active !== 'No' && row.Active !== 'FALSE'; });
  const roster = readRoster_(ss);
  const people = {};
  histories.forEach(function(row) {
    const email = row['Member Email'].toLowerCase();
    if (!people[email]) people[email] = { email: email, name: row['Member Name'], histories: [] };
    people[email].histories.push(row);
  });
  roster.forEach(function(member) { if (!people[member.email]) people[member.email] = { email: member.email, name: member.name, histories: [] }; });
  const rows = Object.keys(people).map(function(email) {
    const person = people[email];
    let calledMeetings = 0;
    let attended = 0;
    meetings.forEach(function(meeting) {
      const called = calls.some(function(call) { return call['Meeting ID'] === meeting['Meeting ID'] && call['Member Email'].toLowerCase() === email && call.Status === 'Called'; });
      if (called && isMembershipActive_(person.histories, meeting['Meeting Date'])) {
        calledMeetings++;
        if (attendance.some(function(record) { return record['Meeting ID'] === meeting['Meeting ID'] && record['Roster Email'].toLowerCase() === email; })) attended++;
      }
    });
    return { name: person.name, email: email, calledMeetings: calledMeetings, attended: attended, rate: calledMeetings ? Math.round((attended / calledMeetings) * 100) : null };
  }).filter(function(row) { return row.calledMeetings || row.attended; }).sort(function(a, b) { return a.name.localeCompare(b.name); });
  return { year: reportYear, meetings: meetings.length, rows: rows };
}

function getManagementOverview() {
  requireMeetingAdmin_();
  const ss = getSpreadsheet_();
  const getCount = function(sheetName) {
    return readObjects_(ss, sheetName).filter(function(row) {
      return row.Nama && row.Emel && !['lepas', 'past', 'inactive'].includes(String(row['Status Keahlian'] || 'Aktif').toLowerCase());
    }).length;
  };
  return {
    jkpsMembers: getCount(CONFIG.rosterSheet),
    japsuMembers: getCount('Ahli JAPSU'),
    jkpsMeeting: readMeetingConfig_('Mesyuarat JKPS'),
    japsuMeeting: readMeetingConfig_('Mesyuarat JAPSU')
  };
}

function getCommitteeMembers(committee) {
  requireMeetingAdmin_();
  const sheetName = committee === 'JAPSU' ? 'Ahli JAPSU' : CONFIG.rosterSheet;
  return readObjects_(getSpreadsheet_(), sheetName).filter(function(row) { return row.Nama && row.Emel; }).map(function(row) {
    return { name: row.Nama, position: row.Jawatan, faculty: row['Fakulti / Pusat / Institut'], email: row.Emel, appointmentDate: row['Tarikh Lantikan'] || '', endDate: row['Tarikh Tamat'] || '', status: row['Status Keahlian'] || 'Aktif' };
  });
}

function readMeetingConfig_(sheetName) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) return null;
  return { title: sheet.getRange('B1').getDisplayValue(), number: sheet.getRange('B3').getDisplayValue(), date: sheet.getRange('B4').getDisplayValue() };
}

function isMembershipActive_(histories, meetingDate) {
  return histories.some(function(history) {
    return history['Membership Start'] && history['Membership Start'].slice(0, 10) <= meetingDate.slice(0, 10) && (!history['Membership End'] || history['Membership End'].slice(0, 10) >= meetingDate.slice(0, 10));
  });
}

function readRoster_(ss) {
  return readObjects_(ss, CONFIG.rosterSheet).filter(function(row) {
    return row.Nama && row.Emel && !['lepas', 'past', 'inactive'].includes(String(row['Status Keahlian'] || 'Aktif').toLowerCase());
  }).map(function(row) {
    return { name: row.Nama, email: row.Emel.toLowerCase(), faculty: row['Fakulti / Pusat / Institut'] || '', position: row.Jawatan || '', appointmentDate: row['Tarikh Lantikan'] || '', endDate: row['Tarikh Tamat'] || '' };
  });
}

function representativeRules_(ss, roster) {
  return readObjects_(ss, CONFIG.sheets.representatives).filter(function(row) {
    return row.Active !== 'No' && row.Active !== 'FALSE' && row['eMeeting Faculty'] && row['Representing Member Email'];
  }).reduce(function(rules, row) {
    const member = roster.filter(function(item) { return item.email === row['Representing Member Email'].toLowerCase(); })[0];
    if (member) rules[normalize_(row['eMeeting Faculty'])] = member;
    return rules;
  }, {});
}

function matchAttendee_(attendee, roster, representativeRules) {
  const direct = roster.filter(function(member) { return normalize_(member.name) === normalize_(attendee.name); })[0];
  if (direct) return { type: 'Member name', member: direct, status: 'Counted' };
  const representative = representativeRules[normalize_(attendee.faculty)];
  if (representative) return { type: 'Faculty representative', member: representative, status: 'Counted' };
  return { type: 'Unmatched', member: null, status: 'Review required' };
}

function replaceMeetingAttendance_(sheet, meetingId, newRows) {
  const existing = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues() : [];
  const retained = existing.filter(function(row) { return row[0] !== meetingId; });
  sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), 9).clearContent();
  const allRows = retained.concat(newRows);
  if (allRows.length) sheet.getRange(2, 1, allRows.length, 9).setValues(allRows);
}

function getSpreadsheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  ensureMemberLifecycleColumns_();
  ensureSheet_(ss, CONFIG.sheets.meetings, ['Meeting ID', 'Title', 'Meeting Date', 'Created At', 'Created By', 'Eligible Members', 'Quorum Required']);
  ensureSheet_(ss, CONFIG.sheets.attendance, ['Meeting ID', 'Source Name', 'Source Faculty', 'Check-in Time', 'Match Type', 'Roster Name', 'Roster Email', 'Match Status', 'Synced At']);
  ensureSheet_(ss, CONFIG.sheets.representatives, ['eMeeting Faculty', 'Representing Member Email', 'Active']);
  ensureSheet_(ss, CONFIG.sheets.memberships, ['Member Email', 'Member Name', 'Membership Start', 'Membership End', 'Active']);
  ensureSheet_(ss, CONFIG.sheets.calls, ['Meeting ID', 'Member Email', 'Called On', 'Status']);
  return ss;
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#0f3d2e').setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  return sheet;
}

function readObjects_(ss, sheetName) {
  const values = ss.getSheetByName(sheetName).getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values.shift();
  return values.filter(function(row) { return row.some(String); }).map(function(row) {
    return headers.reduce(function(object, header, index) {
      object[header] = row[index] instanceof Date ? formatTimestamp_(row[index]) : String(row[index]);
      return object;
    }, {});
  });
}

function normalize_(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/prof\.?\s*madya|prof\.?|dr\.?|ts\.?|ir\.?|puan|encik/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function extractDate_(title) {
  const match = String(title).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : null;
}

function formatDate_(date) {
  return Utilities.formatDate(new Date(date), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function formatTimestamp_(date) {
  return Utilities.formatDate(new Date(date), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}
