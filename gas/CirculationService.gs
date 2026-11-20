const CIRCULATION_TAB = 'Pengesahan Edaran';
const CIRCULATION_COLUMNS = {
  kind: 'Jenis Rekod', id: 'ID Edaran', committee: 'Jawatankuasa', reference: 'Rujukan Edaran',
  title: 'Tajuk Kertas', context: 'Maklumat Jawatankuasa', summary: 'Perkara untuk Pertimbangan',
  pdf: 'Pautan PDF', deadline: 'Tutup Undian (MYT)', status: 'Status Edaran',
  delegates: 'Unit dan Wakil (JSON)', revision: 'Versi Rekod',
  createdAt: 'Masa Direkod', createdBy: 'Direkod Oleh / Emel Wakil',
  updatedAt: 'Masa Dikemas Kini', updatedBy: 'Dikemas Kini Oleh',
  unit: 'Unit Mengundi', name: 'Nama Wakil', decision: 'Undi', reason: 'Sebab Bantahan',
  receipt: 'Status Emel', request: 'ID Permintaan', voteId: 'Rujukan Undi',
};

function getCirculationAdmin() {
  const {book} = requireMeetingAdmin_();
  const entries = circulationRecords_(book);
  return {
    papers: entries.filter(row => row.kind === 'KERTAS').reverse().map(paper => ({
      ...adminPaper_(paper),
      tally: circulationTally_(paper, entries).summary,
    })),
  };
}

function getCirculationCandidates(committee) {
  const {book} = requireMeetingAdmin_();
  return circulationRoster_(book, committee)
    .filter(member => isCirculationUnit_(member.unit))
    .map(({name, role, unit, email}) => ({name, role, unit, email}))
    .sort((a, b) => a.unit.localeCompare(b.unit) || a.name.localeCompare(b.name));
}

function saveCirculationDraft(form) {
  const {book, email} = requireMeetingAdmin_();
  const id = circulationId_(form?.id);
  const committee = circulationCommittee_(form?.committee);
  const title = circulationText_(form.title, 300, 'Tajuk kertas', true);
  const reference = circulationText_(form.reference, 160, 'Rujukan edaran');
  const context = circulationText_(form.context, 2000, 'Maklumat jawatankuasa');
  const summary = circulationText_(form.summary, 8000, 'Perkara untuk pertimbangan');
  const pdf = form.pdf ? circulationPdf_(form.pdf).view : '';
  const deadline = form.deadline ? circulationDeadline_(form.deadline) : '';
  const roster = circulationRoster_(book, committee);
  const delegates = circulationDelegates_(roster, form.candidates);

  return circulationLocked_(() => {
    const table = circulationSheet_(book, true);
    const current = circulationRecords_(book).find(row => row.kind === 'KERTAS' && row.id === id);
    circulationRevision_(current, form.revision);
    if (current && current.status !== 'Draf') throw new Error('Kandungan edaran diterbitkan telah dimuktamadkan.');

    const now = new Date();
    const paper = {
      kind: 'KERTAS', id, committee, title, reference, context, summary, pdf, deadline, status: 'Draf',
      delegates: JSON.stringify(delegates), revision: Number(form.revision) + 1,
      createdAt: current?.createdAt || now, createdBy: current?.createdBy || email, updatedAt: now, updatedBy: email,
    };
    writeCirculationRecord_(table, current?._row || table.getLastRow() + 1, paper);
    return adminPaper_(paper);
  });
}

function changeCirculationStatus(id, revision, action) {
  const {book, email} = requireMeetingAdmin_();
  id = circulationId_(id);
  return circulationLocked_(() => {
    const records = circulationRecords_(book);
    const paper = findCirculationPaper_(records, id);
    circulationRevision_(paper, revision);

    if (action === 'Terbit' && paper.status === 'Draf') {
      if (!paper.reference || !paper.summary || !paper.pdf || !(paper.deadline instanceof Date)
          || paper.deadline.getTime() <= Date.now()) {
        throw new Error('Lengkapkan rujukan, perkara untuk pertimbangan, PDF dan tarikh tutup akan datang.');
      }
      const delegates = readCirculationDelegates_(paper);
      const roster = circulationRoster_(book, paper.committee);
      if (!delegates.length || delegates.some(unit => unit.emails.some(email => !hasCirculationSeat_(roster, unit.key, email)))) {
        throw new Error('Pilih sekurang-kurangnya satu unit dan pastikan semua wakil masih tersenarai sebagai ahli aktif.');
      }
      verifyCirculationPdf_(paper.pdf);
      paper.status = 'Dibuka';
    } else if (action === 'Tutup' && paper.status === 'Dibuka') {
      paper.status = 'Ditutup';
    } else {
      throw new Error('Perubahan status ini tidak tersedia.');
    }

    paper.revision = Number(paper.revision) + 1;
    paper.updatedAt = new Date();
    paper.updatedBy = email;
    writeCirculationRecord_(circulationSheet_(book), paper._row, paper);
    return adminPaper_(paper);
  });
}

function renderCirculationPage_(id) {
  try {
    const access = circulationAccess_(id);
    const template = HtmlService.createTemplateFromFile('Circulation');
    template.paperId = access.paper.id;
    template.committee = access.paper.committee;
    return template.evaluate().setTitle(access.paper.committee + ' | Pengesahan Edaran')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (error) {
    return renderRestrictedMeetingPage_(error.message);
  }
}

function getCirculationPage(id) {
  const {paper, records, roster, email} = circulationAccess_(id);
  const pdf = paper.pdf && paper.status !== 'Draf' ? verifyCirculationPdf_(paper.pdf) : null;
  const tally = circulationTally_(paper, records);
  const options = tally.unitStates.filter(unit => unit.emails.includes(email)
    && hasCirculationSeat_(roster, unit.key, email));
  return {
    viewer: {email, name: roster.find(member => member.email === email)?.name || ''},
    current: {
      id: paper.id, committee: paper.committee, title: paper.title, reference: paper.reference,
      context: paper.context, points: String(paper.summary).split('\n').map(line => line.trim()).filter(Boolean),
      isOpen: circulationIsOpen_(paper), label: circulationStatus_(paper),
      deadline: paper.deadline instanceof Date ? Utilities.formatDate(paper.deadline, MEETING_ZONE, 'dd/MM/yyyy · HH:mm') + ' MYT' : '',
      pdfUrl: pdf?.view || '', previewUrl: pdf?.preview || '',
      summary: tally.summary, unitStates: tally.unitStates.map(safeCirculationUnit_),
      options: options.map(safeCirculationUnit_),
    },
  };
}

function submitCirculationVote(form) {
  const email = signedInMeetingEmail_();
  const book = meetingWorkbook_();
  const id = circulationId_(form?.paperId);
  const request = circulationId_(form?.requestId);
  const key = circulationUnitKey_(form?.unit);
  const decision = form?.vote;
  const name = circulationText_(form?.name, 160, 'Nama penuh', true);
  if (meetingEmail_(form.email) !== email) throw new Error('Akaun UniSZA dalam borang tidak sepadan dengan sesi.');
  if (!['SOKONG', 'BANTAH'].includes(decision)) throw new Error('Pilih Sokong atau Bantah.');
  const reason = decision === 'BANTAH' ? circulationText_(form.reason, 2000, 'Sebab bantahan', true) : '';

  return circulationLocked_(() => {
    const records = circulationRecords_(book);
    const paper = findCirculationPaper_(records, id);
    const roster = circulationRoster_(book, paper.committee);
    const unit = readCirculationDelegates_(paper).find(unit => unit.key === key);
    if (!unit?.emails.includes(email) || !hasCirculationSeat_(roster, key, email)) {
      throw new Error('Akaun ini tiada mandat mengundi bagi unit yang dipilih.');
    }

    const previous = records.find(row => row.kind === 'UNDI' && row.id === id && circulationUnitKey_(row.unit) === key);
    if (previous) {
      if (previous.request === request && previous.createdBy === email && previous.decision === decision) {
        return {id: previous.voteId, receipt: previous.receipt};
      }
      throw new Error('Undian bagi unit ini telah direkodkan.');
    }
    if (!circulationIsOpen_(paper)) throw new Error('Undian bagi kertas ini telah ditutup atau masih dalam penyediaan.');
    verifyCirculationPdf_(paper.pdf);

    const sheet = circulationSheet_(book);
    const next = sheet.getLastRow() + 1;
    const ballot = {
      kind: 'UNDI', id, committee: paper.committee, reference: paper.reference,
      unit: unit.name, name, decision, reason, createdAt: new Date(), createdBy: email,
      receipt: form.receipt === true ? 'SEDANG' : 'TIADA', request, voteId: 'EDR-' + Utilities.getUuid().toUpperCase(),
    };
    writeCirculationRecord_(sheet, next, ballot);
    if (ballot.receipt === 'SEDANG') {
      try {
        GmailApp.sendEmail(email, 'Akuan undian | ' + paper.reference.replace(/[\r\n]+/g, ' '), [
          'Maklum balas undian anda telah direkodkan.',
          'Jawatankuasa: ' + paper.committee,
          'Kertas: ' + paper.title,
          'Unit: ' + unit.name,
          'Wakil: ' + name,
          'Undi: ' + decision,
          ...(reason ? ['Sebab bantahan: ' + reason] : []),
          'Masa Malaysia: ' + Utilities.formatDate(ballot.createdAt, MEETING_ZONE, 'dd/MM/yyyy HH:mm:ss'),
          'Rujukan undi: ' + ballot.voteId,
        ].join('\n'), {name: 'Urus Setia ' + paper.committee});
        ballot.receipt = 'DIHANTAR';
      } catch (error) {
        ballot.receipt = 'GAGAL';
      }
      const col = Object.keys(CIRCULATION_COLUMNS).indexOf('receipt') + 1;
      sheet.getRange(next, col).setValue(ballot.receipt);
      SpreadsheetApp.flush();
    }
    return {id: ballot.voteId, receipt: ballot.receipt};
  });
}

function circulationAccess_(id) {
  const email = signedInMeetingEmail_();
  const book = meetingWorkbook_();
  const records = circulationRecords_(book);
  const paper = findCirculationPaper_(records, circulationId_(id));
  const roster = circulationRoster_(book, paper.committee);
  const member = roster.some(member => member.email === email);
  if ((!member || paper.status === 'Draf') && !meetingAdmin_(book, email)) {
    throw new Error('Edaran ini dikhaskan untuk ahli aktif ' + paper.committee + '. Semak akaun UniSZA yang sedang digunakan.');
  }
  return {paper, records, roster, email};
}

function circulationCommittee_(committee) {
  if (!['JKPS', 'JAPSU'].includes(committee)) throw new Error('Pilih jawatankuasa JKPS atau JAPSU.');
  return committee;
}

function circulationRoster_(book, committee) {
  return meetingRoster_(book, 'Ahli ' + circulationCommittee_(committee));
}

function isCirculationUnit_(unit) {
  return /^(fakulti|institut)\s/i.test(unit);
}

function circulationUnitKey_(unit) {
  return String(unit || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function hasCirculationSeat_(roster, key, email) {
  return roster.some(member => member.email === email && circulationUnitKey_(member.unit) === key);
}

function circulationDelegates_(roster, candidates) {
  if (!Array.isArray(candidates) || candidates.length > 160) throw new Error('Senarai wakil tidak sah.');
  const units = new Map();
  for (const candidate of candidates) {
    const email = meetingEmail_(candidate?.email);
    const key = circulationUnitKey_(candidate?.unit);
    const member = roster.find(member => member.email === email && isCirculationUnit_(member.unit)
      && circulationUnitKey_(member.unit) === key);
    if (!member) throw new Error('Wakil tidak lagi sepadan dengan daftar aktif. Muat semula senarai wakil.');
    if (!units.has(key)) units.set(key, {key, name: member.unit, emails: []});
    const emails = units.get(key).emails;
    if (!emails.includes(email)) emails.push(email);
  }
  return [...units.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function readCirculationDelegates_(paper) {
  return JSON.parse(paper.delegates || '[]');
}

function circulationTally_(paper, records) {
  const decisions = new Map(records.filter(row => row.kind === 'UNDI' && row.id === paper.id)
    .map(row => [circulationUnitKey_(row.unit), row.decision]));
  const unitStates = readCirculationDelegates_(paper)
    .map(unit => ({...unit, vote: decisions.get(unit.key) || ''}));
  const support = unitStates.filter(unit => unit.vote === 'SOKONG').length;
  const oppose = unitStates.filter(unit => unit.vote === 'BANTAH').length;
  return {unitStates, summary: {support, oppose, waiting: unitStates.length - support - oppose, total: unitStates.length}};
}

function safeCirculationUnit_({key, name, vote}) {
  return {key, name, vote};
}

function circulationIsOpen_(paper) {
  return paper.status === 'Dibuka' && paper.deadline instanceof Date && paper.deadline.getTime() > Date.now();
}

function circulationStatus_(paper) {
  if (paper.status === 'Draf') return 'Dalam penyediaan';
  return circulationIsOpen_(paper) ? 'Undian dibuka' : 'Undian ditutup';
}

function circulationId_(id) {
  const value = String(id || '').toLowerCase();
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)) throw new Error('Pautan atau nombor edaran tidak sah.');
  return value;
}

function circulationText_(value, limit, field, required = false) {
  const text = String(value || '').trim();
  if ((required && !text) || text.length > limit || /\u0000/.test(text)) {
    throw new Error(field + ' diperlukan atau melebihi ' + limit + ' aksara.');
  }
  return text;
}

function circulationDeadline_(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) throw new Error('Masukkan tarikh dan masa tutup yang sah.');
  const date = new Date(text + ':00+08:00');
  if (!Number.isFinite(date.getTime()) || Utilities.formatDate(date, MEETING_ZONE, "yyyy-MM-dd'T'HH:mm") !== text) {
    throw new Error('Masukkan tarikh dan masa tutup yang sah.');
  }
  return date;
}

function circulationPdf_(value) {
  const link = String(value || '').trim();
  const match = link.match(/^https:\/\/drive\.google\.com\/file\/d\/([a-z0-9_-]{15,})(?:\/(?:view|preview|edit))?\/?(?:\?.*)?$/i)
    || link.match(/^https:\/\/drive\.google\.com\/(?:open|uc)\?id=([a-z0-9_-]{15,})(?:&.*)?$/i);
  if (!match) throw new Error('Gunakan pautan fail PDF daripada Google Drive.');
  const resourceKey = link.match(/[?&]resourcekey=([a-z0-9_-]+)(?:&|$)/i)?.[1] || '';
  const root = 'https://drive.google.com/file/d/' + match[1];
  const suffix = resourceKey ? '?resourcekey=' + resourceKey : '';
  return {id: match[1], resourceKey, view: root + '/view' + suffix, preview: root + '/preview' + suffix};
}

function verifyCirculationPdf_(value) {
  const pdf = circulationPdf_(value);
  const file = privateMeetingFile_(pdf.id, 'Tetapkan akses umum PDF kepada Restricted dan kongsi dengan ahli jawatankuasa yang berkenaan.', pdf.resourceKey);
  if (file.getMimeType() !== 'application/pdf') throw new Error('Pautan ini mesti merujuk fail PDF.');
  return pdf;
}

function adminPaper_(paper) {
  return {
    id: paper.id, committee: paper.committee, reference: paper.reference, title: paper.title,
    context: paper.context, summary: paper.summary, pdf: paper.pdf,
    deadline: paper.deadline instanceof Date ? Utilities.formatDate(paper.deadline, MEETING_ZONE, "yyyy-MM-dd'T'HH:mm") : '',
    status: paper.status, statusLabel: circulationStatus_(paper), revision: Number(paper.revision),
    candidates: readCirculationDelegates_(paper).flatMap(unit => unit.emails.map(email => ({unit: unit.name, email}))),
    link: circulationLink_(paper.id),
  };
}

function circulationLink_(id) {
  const url = ScriptApp.getService().getUrl();
  return url ? url + '?view=edaran&id=' + encodeURIComponent(id) : '';
}

function findCirculationPaper_(entries, id) {
  const paper = entries.find(row => row.kind === 'KERTAS' && row.id === id);
  if (!paper) throw new Error('Rekod kertas edaran tidak ditemui.');
  return paper;
}

function circulationRevision_(paper, revision) {
  if (!Number.isInteger(revision) || revision !== Number(paper?.revision || 0)) {
    throw new Error('Rekod telah berubah. Muat semula senarai edaran dan cuba lagi.');
  }
}

function circulationSheet_(book, create = false) {
  let sheet = book.getSheetByName(CIRCULATION_TAB);
  const headers = Object.values(CIRCULATION_COLUMNS);
  if (!sheet && create) sheet = book.insertSheet(CIRCULATION_TAB);
  if (!sheet) return null;
  if (!sheet.getLastRow() && create) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#104534').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.getRange('I2:I').setNumberFormat('dd/mm/yyyy hh:mm');
    sheet.getRange('M2:M').setNumberFormat('dd/mm/yyyy hh:mm:ss');
    sheet.getRange('O2:O').setNumberFormat('dd/mm/yyyy hh:mm:ss');
  }
  if (!sheet.getLastRow()) return null;
  const stored = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (headers.some((value, index) => stored[index] !== value)) throw new Error('Struktur tab Pengesahan Edaran tidak sepadan.');
  return sheet;
}

function circulationRecords_(book) {
  const sheet = circulationSheet_(book);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const keys = Object.keys(CIRCULATION_COLUMNS);
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, keys.length).getValues().flatMap((cells, index) =>
    cells[0] ? [{...Object.fromEntries(keys.map((key, i) => [key, cells[i]])), _row: index + 2}] : []);
}

function writeCirculationRecord_(sheet, row, record) {
  const values = Object.keys(CIRCULATION_COLUMNS).map(key => {
    const value = record[key] ?? '';
    return typeof value === 'string' && /^\s*[=+\-@]/.test(value) ? "'" + value : value;
  });
  sheet.getRange(row, 1, 1, values.length).setValues([values]);
  SpreadsheetApp.flush();
}

function circulationLocked_(action) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(12000)) throw new Error('Sistem sedang sibuk. Cuba sebentar lagi.');
  try {
    return action();
  } finally {
    lock.releaseLock();
  }
}
