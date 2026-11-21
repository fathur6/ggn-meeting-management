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
  const candidates = circulationRoster_(book, committee).filter(member => isCirculationUnit_(member.unit));
  const unique = new Map(candidates.map(member => [circulationUnitKey_(member.unit) + '|' + member.email, member]));
  return [...unique.values()].sort((a, b) => a.unit.localeCompare(b.unit) || a.name.localeCompare(b.name));
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

function deleteCirculationDraft(id, revision) {
  const {book} = requireMeetingAdmin_();
  id = circulationId_(id);
  return circulationLocked_(() => {
    const table = circulationSheet_(book, true);
    const records = circulationRecords_(book);
    const paper = findCirculationPaper_(records, id);
    circulationRevision_(paper, revision);
    if (paper.status !== 'Draf') throw new Error('Hanya kertas edaran yang belum diterbitkan boleh dibuang.');

    // Remove any stray vote rows first, then the paper itself. Re-read the
    // records afterwards because deleting a row shifts every row below it.
    records.filter(row => row.kind === 'UNDI' && row.id === id)
      .sort((a, b) => b._row - a._row)
      .forEach(row => table.deleteRow(row._row));
    const current = findCirculationPaper_(circulationRecords_(book), id);
    table.deleteRow(current._row);
    SpreadsheetApp.flush();
    return {deleted: true, id};
  });
}

function exportCirculationVotesPdf(id) {
  const {book, email} = requireMeetingAdmin_();
  id = circulationId_(id);
  const records = circulationRecords_(book);
  const paper = findCirculationPaper_(records, id);
  const tally = circulationTally_(paper, records);
  const votes = records.filter(row => row.kind === 'UNDI' && row.id === id);
  const roster = circulationRoster_(book, paper.committee);
  const html = circulationVotesReportHtml_({paper, tally, votes, roster, generatedBy: email});
  const pdf = Utilities.newBlob(html, MimeType.HTML, 'laporan.html').getAs(MimeType.PDF);
  return {
    name: circulationReportName_(paper),
    mimeType: 'application/pdf',
    base64: Utilities.base64Encode(pdf.getBytes()),
  };
}

function circulationVotesReportHtml_({paper, tally, votes, roster, generatedBy}) {
  const esc = circulationEscape_;
  const line = value => esc(value).replace(/\n/g, '<br>');
  const memberName = email => roster.find(member => member.email === email)?.name || email;
  const rows = tally.unitStates.map(unit => {
    const vote = votes.find(row => circulationUnitKey_(row.unit) === unit.key);
    const representatives = unit.emails.map(memberName).join(', ');
    const decision = vote ? (vote.decision === 'SOKONG' ? 'Menyokong' : vote.decision === 'BANTAH' ? 'Membantah' : String(vote.decision || '')) : 'Belum mengundi';
    return '<tr>'
      + '<td>' + esc(unit.name) + '</td>'
      + '<td>' + esc(representatives) + '</td>'
      + '<td class="tag">' + esc(decision) + '</td>'
      + '<td>' + (vote && vote.reason ? line(vote.reason) : '-') + '</td>'
      + '<td>' + (vote ? circulationFormatDate_(vote.createdAt) : '-') + '</td>'
      + '<td>' + (vote ? esc(vote.name || '') + (vote.createdBy ? '<br><span class="muted">' + esc(vote.createdBy) + '</span>' : '') : '-') + '</td>'
      + '</tr>';
  }).join('');

  return '<!doctype html><html><head><meta charset="utf-8"><style>'
    + '@page{size:A4 landscape;margin:12mm}'
    + 'body{font-family:Arial,Helvetica,sans-serif;color:#1d2b24;font-size:10px;line-height:1.4}'
    + '.header{background:#104534;color:#fff;padding:16px 20px}'
    + '.header h1{margin:0;font-size:20px;letter-spacing:.2px}'
    + '.header p{margin:5px 0 0;font-size:11px}'
    + '.meta{width:100%;border-collapse:collapse;margin:12px 0}'
    + '.meta td{padding:3px 6px;vertical-align:top}'
    + '.meta .label{color:#5d6f64;width:115px}'
    + 'h2{font-size:13px;margin:15px 0 6px;color:#104534}'
    + '.summary{width:100%;border-collapse:collapse;margin:6px 0 10px}'
    + '.summary td{border:1px solid #cfdad3;padding:8px;text-align:center;width:25%}'
    + '.summary strong{display:block;font-size:18px}'
    + 'table.votes{width:100%;border-collapse:collapse}'
    + 'table.votes th{background:#e8f1eb;color:#104534;text-align:left;padding:6px;border:1px solid #cfdad3;font-size:9px}'
    + 'table.votes td{border:1px solid #dbe5de;padding:6px;vertical-align:top;font-size:9px}'
    + '.tag{font-weight:bold}.muted{color:#6b7d72;font-size:8px}'
    + '.footer{margin-top:18px;font-size:9px;color:#5d6f64;border-top:1px solid #cfdad3;padding-top:8px}'
    + '.sign{margin-top:26px;width:45%}.sign div{border-top:1px solid #1d2b24;margin-top:32px;padding-top:4px}'
    + '</style></head><body>'
    + '<div class="header"><h1>Pengesahan Secara Edaran</h1><p>' + esc(paper.committee) + ' &middot; Bukti Maklum Balas Undian</p></div>'
    + '<table class="meta">'
    + '<tr><td class="label">Rujukan</td><td><strong>' + esc(paper.reference || '-') + '</strong></td><td class="label">Tarikh jana</td><td>' + circulationFormatDate_(new Date()) + ' MYT</td></tr>'
    + '<tr><td class="label">Tajuk kertas</td><td colspan="3">' + esc(paper.title || '-') + '</td></tr>'
    + '<tr><td class="label">Status</td><td>' + esc(circulationStatus_(paper)) + '</td><td class="label">Tarikh tutup</td><td>' + (paper.deadline instanceof Date ? circulationFormatDate_(paper.deadline) : '-') + ' MYT</td></tr>'
    + '<tr><td class="label">Maklumat jawatankuasa</td><td colspan="3">' + line(paper.context || '-') + '</td></tr>'
    + '<tr><td class="label">Perkara untuk pertimbangan</td><td colspan="3">' + line(paper.summary || '-') + '</td></tr>'
    + '</table>'
    + '<h2>Ringkasan undian</h2>'
    + '<table class="summary"><tr>'
    + '<td><strong>' + tally.summary.total + '</strong>Unit edaran</td>'
    + '<td><strong>' + tally.summary.support + '</strong>Menyokong</td>'
    + '<td><strong>' + tally.summary.oppose + '</strong>Membantah</td>'
    + '<td><strong>' + tally.summary.waiting + '</strong>Belum mengundi</td>'
    + '</tr></table>'
    + '<h2>Maklum balas mengikut unit</h2>'
    + '<table class="votes"><thead><tr><th>Unit</th><th>Wakil</th><th>Undi</th><th>Sebab bantahan</th><th>Masa direkod</th><th>Direkod oleh</th></tr></thead><tbody>'
    + (rows || '<tr><td colspan="6">Tiada unit edaran direkodkan.</td></tr>')
    + '</tbody></table>'
    + '<div class="footer">Dokumen ini dijana secara automatik daripada sistem UGS Meeting Management pada ' + circulationFormatDate_(new Date()) + ' MYT oleh ' + esc(generatedBy) + '. Rekod undian hendaklah disimpan sebagai bukti rasmi jawatankuasa.</div>'
    + '<div class="sign"><div>Tandatangan Urus Setia</div></div>'
    + '</body></html>';
}

function circulationReportName_(paper) {
  const label = paper.reference || paper.title || 'Edaran';
  const stamp = Utilities.formatDate(new Date(), MEETING_ZONE, 'yyyy-MM-dd HHmmss');
  return (paper.committee + ' - ' + label + ' - Bukti Undian - ' + stamp)
    .replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 180) + '.pdf';
}

function circulationFormatDate_(value) {
  if (!(value instanceof Date) || isNaN(value.getTime())) return '-';
  return Utilities.formatDate(value, MEETING_ZONE, 'dd/MM/yyyy HH:mm');
}

function circulationEscape_(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function renderCirculationPage_(id) {
  let paperId;
  try {
    paperId = circulationId_(id);
    const access = circulationAccess_(paperId);
    const template = HtmlService.createTemplateFromFile('Circulation');
    template.paperId = access.paper.id;
    template.committee = access.paper.committee;
    return template.evaluate().setTitle(access.paper.committee + ' | Pengesahan Edaran')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (error) {
    return renderRestrictedMeetingPage_(error, paperId ? 'view=edaran&id=' + encodeURIComponent(paperId) : '');
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
    throw new MeetingAccountError_('Edaran ini dikhaskan untuk ahli aktif ' + paper.committee + '. Semak akaun UniSZA yang sedang digunakan.');
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

// Faculties and institutes vote by default. Selected centres may also hold one
// seat when the committee explicitly includes them in a circulation paper.
const CIRCULATION_EXTRA_UNITS = [
  'pusat kecemerlangan dan inovasi akademik (comae-i)',
  'pusat pemindahan ilmu dan pendidikan berterusan',
];

function isCirculationUnit_(unit) {
  const key = circulationUnitKey_(unit);
  return /^(fakulti|institut)\s/i.test(unit) || CIRCULATION_EXTRA_UNITS.includes(key);
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
  const file = pdf.resourceKey ? DriveApp.getFileByIdAndResourceKey(pdf.id, pdf.resourceKey) : DriveApp.getFileById(pdf.id);
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
