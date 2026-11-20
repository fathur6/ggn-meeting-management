const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {randomUUID} = require('node:crypto');
const {test} = require('node:test');

const directory = path.join(__dirname, '..', 'gas');
const source = ['Code.js', 'QuorumService.gs', 'PortalService.gs', 'MeetingAccess.gs', 'CirculationService.gs']
  .map(file => fs.readFileSync(path.join(directory, file), 'utf8')).join('\n');
const rosterHeaders = ['Bil', 'Nama', 'Jawatan', 'Fakulti / Pusat / Institut', 'Emel', 'Tarikh Lantikan', 'Tarikh Tamat', 'Status Keahlian'];
const admin = 'admin@unisza.edu.my';
const japsuMember = 'japsu@unisza.edu.my';
const alternate = 'ganti@unisza.edu.my';
const otherFaculty = 'sains@unisza.edu.my';
const jkpsMember = 'jkps@unisza.edu.my';
const faculty = 'Fakulti A';
const secondFaculty = 'Fakulti Sains';
const pdf = 'https://drive.google.com/file/d/sample-test-drive-id/view?usp=sharing';
const paperId = '069bdae4-38dc-4a2a-80c0-8ab392802e64';

function formatDate(date, zone, pattern) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return pattern.replaceAll('yyyy', parts.year).replaceAll('MM', parts.month).replaceAll('dd', parts.day)
    .replaceAll('HH', parts.hour).replaceAll('mm', parts.minute).replaceAll('ss', parts.second).replaceAll("'", '');
}

function testEnvironment() {
  const data = {
    'Ahli PPS': [rosterHeaders.slice(0, 5), [1, 'Admin PPS', 'Pegawai', 'Pusat Pengajian Siswazah', admin]],
    'Ahli JAPSU': [rosterHeaders,
      [1, 'Wakil A', 'Dekan', faculty, japsuMember, '', '', ''],
      [2, 'Wakil Ganti', 'Timbalan', faculty, alternate, '', '', 'Aktif'],
      [3, 'Wakil Sains', 'Dekan', secondFaculty, otherFaculty, '', '', 'Aktif'],
      [4, 'Bekas Wakil', 'Dekan', faculty, 'past@unisza.edu.my', '', '', 'Lepas'],
    ],
    'Ahli JKPS': [rosterHeaders, [1, 'Wakil JKPS', 'Timbalan', faculty, jkpsMember, '', '', 'Aktif']],
  };
  const state = {user: admin, bookAccess: 'PRIVATE', pdfAccess: 'PRIVATE', pdfMime: 'application/pdf', mail: [], failMail: false};
  let locked = false;
  const save = value => typeof value === 'string' && value.startsWith("'") ? value.slice(1) : value;

  function sheet(name) {
    const rows = data[name];
    return {
      appendRow(values) { rows.push(values.map(save)); return this; },
      getLastRow() { return rows.length; },
      getDataRange() { return {getValues: () => rows.map(row => row.slice())}; },
      setFrozenRows() {},
      getRange(row, col, count, width) {
        return {
          getValues() {
            return rows.slice(row - 1, row - 1 + count).map(cells => cells.slice(col - 1, col - 1 + width));
          },
          setFontWeight() { return this; },
          setBackground() { return this; },
          setFontColor() { return this; },
          setNumberFormat() { return this; },
          setValues(values) {
            assert.equal(locked, true);
            for (const [index, cells] of values.entries()) {
              rows[row + index - 1] = cells.map(save);
              for (const value of cells) if (typeof value === 'string') assert.doesNotMatch(value, /^\s*=/);
            }
          },
          setValue(value) { assert.equal(locked, true); rows[row - 1][col - 1] = value; },
        };
      },
    };
  }

  const book = {
    getSheetByName: name => data[name] ? sheet(name) : null,
    getSpreadsheetTimeZone: () => 'Asia/Kuala_Lumpur',
    insertSheet(name) { data[name] = []; return sheet(name); },
  };
  const driveFile = id => ({
    getSharingAccess: () => id === 'sample-test-drive-id' ? state.pdfAccess : state.bookAccess,
    getMimeType: () => state.pdfMime,
  });
  const environment = {
    Date, console,
    Session: {getActiveUser: () => ({getEmail: () => state.user})},
    Utilities: {formatDate, getUuid: randomUUID},
    SpreadsheetApp: {openById: () => book, flush: () => {}},
    ScriptApp: {getService: () => ({getUrl: () => 'https://example.invalid/exec'})},
    LockService: {getScriptLock: () => ({
      tryLock() { assert.equal(locked, false); locked = true; return true; },
      releaseLock() { assert.equal(locked, true); locked = false; },
    })},
    DriveApp: {Access: {PRIVATE: 'PRIVATE'}, getFileById: driveFile, getFileByIdAndResourceKey: driveFile},
    GmailApp: {sendEmail(...mail) {
      assert.equal(data['Pengesahan Edaran'].at(-1).includes('SEDANG'), true);
      if (state.failMail) throw new Error('Email quota exceeded');
      state.mail.push(mail);
    }},
    HtmlService: {
      createTemplateFromFile(file) {
        return {
          evaluate() {
            return {file, paperId: this.paperId, committee: this.committee, message: this.message, signInUrl: this.signInUrl,
              setTitle() { return this; }, addMetaTag() { return this; }};
          },
        };
      },
    },
    ContentService: {MimeType: {JSON: 'json'}, createTextOutput(value) {
      return {setMimeType: () => JSON.parse(value)};
    }},
  };

  vm.createContext(environment);
  vm.runInContext(source, environment);
  const methods = environment;
  const draft = (changes = {}) => methods.saveCirculationDraft({
    id: paperId, committee: 'JAPSU', title: 'Kertas contoh', reference: 'JAPSU Edaran Bil. 2',
    context: 'Perkara mesyuarat', summary: 'Butiran A\nButiran B', pdf, deadline: '2098-12-13T17:00', revision: 0,
    candidates: [{email: japsuMember, unit: faculty}, {email: alternate, unit: faculty},
      {email: otherFaculty, unit: secondFaculty}],
    ...changes,
  });
  const publish = () => methods.changeCirculationStatus(paperId, 1, 'Terbit');
  const vote = (changes = {}) => methods.submitCirculationVote({
    paperId, requestId: randomUUID(), unit: faculty, name: 'Nama Wakil', email: state.user,
    vote: 'SOKONG', receipt: false, ...changes,
  });
  return {methods, state, data, draft, publish, vote};
}

test('the portal, existing management RPCs and legacy API require Ahli PPS', () => {
  const {methods, state} = testEnvironment();
  const navigation = {parameter: {view: 'app'}};
  assert.equal(methods.doGet(navigation).file, 'Management');
  state.user = japsuMember;
  assert.equal(methods.doGet(navigation).file, 'AccessDenied');
  assert.equal(methods.doGet({}).success, false);
  const write = {postData: {contents: JSON.stringify({action: 'saveMeetingConfig', meeting: 'JAPSU', data: {}})}};
  assert.equal(methods.doPost(write).success, false);
  for (const method of ['getPortalMembers', 'getPortalMeeting', 'getDashboardData', 'getManagementOverview',
    'getLiveTrackingDashboard', 'sendInvitationFromPortal', 'getCirculationAdmin', 'getCirculationCandidates']) {
    assert.throws(() => methods[method]('JAPSU'), /Urus Setia PPS/, method);
  }
  state.user = '';
  assert.match(methods.doGet(navigation).message, /Log masuk/);
});

test('Google sign-in returns to the requested portal page or ballot', () => {
  const {methods, state, draft, publish} = testEnvironment();
  draft();
  publish();
  const voting = {view: 'edaran', id: paperId, next: 'https://elsewhere.invalid/'};
  for (const user of ['', 'personal@gmail.com', jkpsMember]) {
    state.user = user;
    for (const [parameter, expected] of [[{view: 'app'}, 'view=app'], [voting, 'view=edaran&id=' + paperId]]) {
      const page = methods.doGet({parameter});
      assert.equal(page.file, 'AccessDenied');
      const signIn = new URL(page.signInUrl);
      assert.equal(signIn.origin + signIn.pathname, 'https://accounts.google.com/AccountChooser');
      assert.equal(signIn.searchParams.get('continue'), 'https://example.invalid/exec?' + expected);
    }
  }
  state.user = '';
  const invalid = methods.doGet({parameter: {...voting, id: 'https://elsewhere.invalid/'}});
  assert.match(invalid.message, /tidak sah/);
  assert.equal(invalid.signInUrl, '');
  state.user = japsuMember;
  assert.equal(methods.doGet({parameter: voting}).file, 'Circulation');
  state.bookAccess = 'ANYONE_WITH_LINK';
  assert.equal(methods.doGet({parameter: voting}).signInUrl, '');
});

test('a reviewer-readable PDF supports publication and voting while the workbook stays restricted', () => {
  const {methods, state, data, draft, publish, vote} = testEnvironment();
  state.bookAccess = 'ANYONE_WITH_LINK';
  assert.throws(draft, /Google Sheet rasmi/);
  assert.equal(data['Pengesahan Edaran'], undefined);
  state.bookAccess = 'PRIVATE';
  assert.throws(() => draft({pdf: 'https://example.invalid/paper.pdf'}), /Google Drive/);
  assert.throws(() => draft({deadline: '2098-02-30T10:00'}), /tarikh dan masa/);
  draft();
  state.pdfAccess = 'ANYONE_WITH_LINK';
  state.pdfMime = 'text/plain';
  assert.throws(publish, /merujuk fail PDF/);
  state.pdfMime = 'application/pdf';
  assert.equal(publish().status, 'Dibuka');
  state.user = japsuMember;
  assert.match(methods.getCirculationPage(paperId).current.pdfUrl, /sample-test-drive-id\/view$/);
  assert.equal(vote().receipt, 'TIADA');
});

test('drafts and other committees are hidden, and published details are frozen', () => {
  const {methods, state, draft, publish} = testEnvironment();
  const saved = draft();
  assert.match(saved.link, new RegExp('view=edaran&id=' + paperId));
  assert.throws(draft, /Rekod telah berubah/);
  state.user = japsuMember;
  assert.equal(methods.doGet({parameter: {view: 'edaran', id: paperId}}).file, 'AccessDenied');
  state.user = admin;
  publish();
  assert.throws(() => draft({revision: 2}), /dimuktamadkan/);
  state.user = jkpsMember;
  assert.throws(() => methods.getCirculationPage(paperId), /dikhaskan/);
  state.user = japsuMember;
  const page = methods.doGet({parameter: {view: 'edaran', id: paperId}});
  assert.equal(page.file, 'Circulation');
  assert.equal(page.committee, 'JAPSU');
  const {current} = methods.getCirculationPage(paperId);
  assert.equal(current.summary.total, 2);
  assert.equal(current.options[0].name, faculty);
  assert.equal(JSON.stringify(current).includes(alternate), false);
});

test('one vote per unit, mandatory objection reason, receipt and duplicate retry', () => {
  const {methods, state, data, draft, publish, vote} = testEnvironment();
  draft();
  publish();
  state.user = japsuMember;
  assert.throws(() => vote({unit: secondFaculty}), /tiada mandat/);
  assert.throws(() => vote({email: alternate}), /tidak sepadan/);
  assert.throws(() => vote({vote: 'BANTAH'}), /Sebab bantahan/);
  const submission = {vote: 'BANTAH', reason: '=teks semakan', receipt: true, requestId: randomUUID()};
  const cast = vote(submission);
  assert.equal(cast.receipt, 'DIHANTAR');
  assert.equal(state.mail[0][0], japsuMember);
  assert.equal(vote(submission).id, cast.id);
  assert.equal(state.mail.length, 1);
  state.user = alternate;
  assert.throws(vote, /telah direkodkan/);
  state.user = otherFaculty;
  state.failMail = true;
  assert.equal(vote({unit: secondFaculty, receipt: true}).receipt, 'GAGAL');
  assert.equal(data['Pengesahan Edaran'].length, 4);
  const {current} = methods.getCirculationPage(paperId);
  assert.equal(current.summary.oppose, 1);
  assert.equal(current.summary.support, 1);
  assert.equal(JSON.stringify(current).includes('teks semakan'), false);
});

test('revocation, deadline and closing stop new votes', () => {
  const {methods, data, state, draft, publish, vote} = testEnvironment();
  draft();
  publish();
  state.user = japsuMember;
  data['Ahli JAPSU'][1][7] = 'Lepas';
  assert.throws(vote, /tiada mandat/);
  data['Ahli JAPSU'][1][7] = 'Aktif';
  data['Pengesahan Edaran'][1][8] = new Date('2020-01-01T00:00:00Z');
  assert.throws(vote, /ditutup/);
  state.user = admin;
  assert.equal(methods.changeCirculationStatus(paperId, 2, 'Tutup').status, 'Ditutup');
  state.user = japsuMember;
  assert.equal(methods.getCirculationPage(paperId).current.isOpen, false);
});
