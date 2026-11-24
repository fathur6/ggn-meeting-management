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
  const {book, email} = requireMeetingAdmin_();
  const entries = circulationRecords_(book);
  return {
    // Only the TDA PPS sees the delete control; the server re-checks on delete.
    canDelete: isMeetingTdaPps_(email),
    papers: entries.filter(row => row.kind === 'KERTAS').reverse().map(paper => ({
      ...adminPaper_(paper),
      tally: circulationTally_(paper, entries, circulationRoster_(book, paper.committee)).summary,
    })),
  };
}

function getCirculationCandidates(committee) {
  const {book} = requireMeetingAdmin_();
  const canonical = circulationCanonicalUnits_(book, committee);
  const candidates = circulationRoster_(book, committee)
    .filter(member => isCirculationUnit_(member.unit))
    // Use the paper committee's spelling so members of the same unit from two
    // rosters land in one group.
    .map(member => ({...member, unit: circulationCanonicalUnit_(canonical, member.unit)}));
  const unique = new Map(candidates.map(member => [circulationUnitKey_(member.unit) + '|' + member.email, member]));
  return [...unique.values()].sort((a, b) => a.unit.localeCompare(b.unit) || a.name.localeCompare(b.name));
}

function circulationCanonicalUnits_(book, committee) {
  const canonical = new Map();
  meetingRoster_(book, 'Ahli ' + circulationCommittee_(committee)).forEach(member => {
    const name = String(member.unit || '').replace(/\s+/g, ' ').trim();
    const alias = circulationUnitAlias_(name);
    if (alias && !canonical.has(alias)) canonical.set(alias, name);
  });
  return canonical;
}

function circulationCanonicalUnit_(canonical, unit) {
  const name = String(unit || '').replace(/\s+/g, ' ').trim();
  const exact = canonical.get(circulationUnitAlias_(name));
  if (exact) return exact;
  for (const [alias, stored] of canonical) {
    if (circulationUnitsMatch_(alias, name)) return stored;
  }
  return name;
}

/**
 * One unit casts one vote, but several representatives may hold the seat and any of
 * them may cast it. This payload powers the "Wakil dan undian" panel: who holds the
 * seat, what the unit decided, and which representatives may still be changed.
 */
function getCirculationVotes(id) {
  const {book, email} = requireMeetingAdmin_();
  id = circulationId_(id);
  const records = circulationRecords_(book);
  const paper = findCirculationPaper_(records, id);
  return circulationVotesPayload_(book, paper, records, email);
}

function circulationVotesPayload_(book, paper, records, actor) {
  const roster = circulationRoster_(book, paper.committee).filter(member => isCirculationUnit_(member.unit));

  const tally = circulationTally_(paper, records, roster);
  const states = new Map(tally.unitStates.map(unit => [unit.key, unit]));
  const isOpen = paper.status === 'Dibuka';
  const tda = isMeetingTdaPps_(actor);

  const units = readCirculationDelegates_(paper).map(unit => {
    const state = states.get(unit.key) || {};
    // The vote that decided the unit: the Dean's when they voted, otherwise the
    // representative's.
    const deciding = records.filter(row => row.kind === 'UNDI' && row.id === paper.id
      && circulationUnitKey_(row.unit) === unit.key
      && (!state.decidedBy || meetingEmail_(row.createdBy) === state.decidedBy)).pop() || null;
    const candidates = roster.filter(member => circulationUnitsMatch_(member.unit, unit.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(member => ({
        email: member.email, name: member.name, role: member.role,
        selected: unit.emails.includes(member.email),
        // The representative who recorded the vote must stay seated.
        voter: Boolean(deciding) && meetingEmail_(deciding.createdBy) === meetingEmail_(member.email),
        dean: isCirculationDeanRole_(member.role),
      }));
    return {
      key: unit.key,
      name: unit.name,
      emails: unit.emails,
      candidates,
      vote: state.vote || '',
      byDean: Boolean(state.byDean),
      superseded: state.superseded || null,
      reason: deciding ? deciding.reason : '',
      votedBy: deciding ? meetingEmail_(deciding.createdBy) : '',
      votedAt: circulationStamp_(deciding && deciding.createdAt),
      changedBy: deciding ? deciding.updatedBy : '',
      changedAt: circulationStamp_(deciding && deciding.updatedAt),
    };
  });

  return {
    paper: {
      id: paper.id, title: paper.title, reference: paper.reference, committee: paper.committee,
      status: paper.status, statusLabel: circulationStatus_(paper),
      revision: Number(paper.revision), isOpen,
    },
    summary: tally.summary,
    units,
    // Only a PPS super administrator may change representatives on an open paper;
    // adding one to a unit that already voted is allowed, dropping the voter is not.
    canEditDelegates: isMeetingSuperAdmin_(actor) && isOpen,
    canOverride: tda && isOpen,
  };
}

function circulationStamp_(value) {
  return value instanceof Date && Number.isFinite(value.getTime())
    ? Utilities.formatDate(value, MEETING_ZONE, 'dd/MM/yyyy HH:mm')
    : '';
}

/**
 * The TDA PPS may correct a faculty's recorded vote while the poll is open, for
 * example when the representative's decision contradicts the faculty. The previous
 * decision is kept in the audit log.
 */
function overrideCirculationVote(id, unitKey, decision, reason) {
  const {book, email} = requireMeetingTdaPps_();
  id = circulationId_(id);
  const vote = String(decision || '').trim().toUpperCase();
  if (!['SOKONG', 'BANTAH'].includes(vote)) throw new Error('Pilih Sokong atau Bantah.');
  const note = circulationText_(reason, 2000, 'Sebab perubahan', true);
  const key = circulationUnitKey_(unitKey);

  return circulationLocked_(() => {
    const table = circulationSheet_(book, true);
    const records = circulationRecords_(book);
    const paper = findCirculationPaper_(records, id);
    if (paper.status !== 'Dibuka') throw new Error('Keputusan hanya boleh diubah semasa undian dibuka.');
    const unit = readCirculationDelegates_(paper).find(entry => entry.key === key);
    if (!unit) throw new Error('Unit edaran tidak ditemui.');
    const current = records.find(row => row.kind === 'UNDI' && row.id === id && circulationUnitKey_(row.unit) === key);
    if (!current) throw new Error('Unit ini belum mengundi.');
    if (current.decision === vote) throw new Error('Keputusan ' + unit.name + ' sudah ' + vote + '.');

    writeCirculationRecord_(table, current._row, {
      ...current, decision: vote, reason: note, updatedAt: new Date(), updatedBy: email,
    });
    circulationLog_(book, {
      id, committee: paper.committee, reference: paper.reference, unit: unit.name,
      action: 'Ubah keputusan', before: current.decision, after: vote, reason: note, by: email,
    });
    return circulationVotesPayload_(book, findCirculationPaper_(circulationRecords_(book), id), circulationRecords_(book), email);
  });
}

/**
 * Adds or removes representatives while the poll is open, as long as that unit has
 * not voted yet: the seat is decided, not the people holding it.
 */
function saveCirculationDelegates(id, revision, candidates) {
  const {book, email} = requireMeetingSuperAdmin_();
  id = circulationId_(id);
  return circulationLocked_(() => {
    const table = circulationSheet_(book, true);
    const records = circulationRecords_(book);
    const paper = findCirculationPaper_(records, id);
    circulationRevision_(paper, revision);
    if (paper.status !== 'Dibuka') throw new Error('Wakil boleh diubah semasa undian dibuka. Draf disunting melalui borang kertas.');
    const roster = circulationRoster_(book, paper.committee);
    const delegates = circulationDelegates_(roster, candidates, readCirculationDelegates_(paper));
    const voted = new Map(records
      .filter(row => row.kind === 'UNDI' && row.id === id)
      .map(row => [circulationUnitKey_(row.unit), row]));
    const before = new Map(readCirculationDelegates_(paper).map(unit => [unit.key, unit]));

    // A super administrator may add a representative to a unit that has already
    // voted, but the representative who recorded that vote must stay seated.
    voted.forEach((row, key) => {
      const kept = before.get(key);
      if (!kept) return;
      const next = delegates.find(unit => unit.key === key);
      const voter = meetingEmail_(row.createdBy);
      if (!next || !next.emails.includes(voter)) {
        throw new Error('Wakil yang telah mengundi bagi ' + kept.name + ' mesti kekal dalam senarai.');
      }
    });

    const updated = {
      ...paper, delegates: JSON.stringify(delegates),
      revision: Number(paper.revision) + 1, updatedAt: new Date(), updatedBy: email,
    };
    writeCirculationRecord_(table, paper._row, updated);
    circulationLog_(book, {
      id, committee: paper.committee, reference: paper.reference, unit: '(semua unit)',
      action: 'Ubah wakil', before: circulationDelegateSummary_(before), after: circulationDelegateSummary_(delegates),
      reason: '', by: email,
    });
    return adminPaper_(updated);
  });
}

function circulationDelegateSummary_(units) {
  const list = units instanceof Map ? [...units.values()] : units;
  return list.map(unit => unit.name + ': ' + unit.emails.join(', ')).join(' | ').slice(0, 900);
}

/**
 * Vote changes are official-record edits, so they are appended to a small log tab
 * instead of silently replacing the representative's row.
 */
const CIRCULATION_LOG_TAB = 'Log Pengesahan Edaran';
const CIRCULATION_LOG_HEADERS = ['Masa', 'ID Edaran', 'Jawatankuasa', 'Rujukan', 'Unit', 'Tindakan', 'Sebelum', 'Selepas', 'Sebab', 'Oleh'];

function circulationLog_(book, entry) {
  let sheet = book.getSheetByName(CIRCULATION_LOG_TAB);
  if (!sheet) {
    sheet = book.insertSheet(CIRCULATION_LOG_TAB);
    sheet.appendRow(CIRCULATION_LOG_HEADERS);
    sheet.getRange(1, 1, 1, CIRCULATION_LOG_HEADERS.length).setFontWeight('bold').setBackground('#104534').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([
    new Date(), entry.id, entry.committee, entry.reference, entry.unit,
    entry.action, entry.before || '', entry.after || '', entry.reason || '', entry.by,
  ]);
  SpreadsheetApp.flush();
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

  return circulationLocked_(() => {
    const table = circulationSheet_(book, true);
    const current = circulationRecords_(book).find(row => row.kind === 'KERTAS' && row.id === id);
    circulationRevision_(current, form.revision);
    if (current && current.status !== 'Draf') throw new Error('Kandungan edaran diterbitkan telah dimuktamadkan.');
    // Existing units keep their stored name and key while the draft is edited.
    const delegates = circulationDelegates_(roster, form.candidates, current ? readCirculationDelegates_(current) : []);

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
        throw new Error('Lengkapkan rujukan, perkara untuk pertimbangan, pautan dokumen dan tarikh tutup akan datang.');
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

/**
 * Removes a circulation paper of any status, including a published paper with
 * recorded votes. Reserved for the TDA PPS: the button is hidden from everyone
 * else and the check below rejects the call regardless of the interface.
 * The PDF in Drive is not touched; only the portal records are removed.
 */
function deleteCirculationPaper(id, revision) {
  const {book, email} = requireMeetingTdaPps_();
  id = circulationId_(id);
  return circulationLocked_(() => {
    const table = circulationSheet_(book, true);
    const records = circulationRecords_(book);
    const paper = findCirculationPaper_(records, id);
    circulationRevision_(paper, revision);

    const votes = records.filter(row => row.kind === 'UNDI' && row.id === id);
    votes.sort((a, b) => b._row - a._row).forEach(row => table.deleteRow(row._row));
    const current = findCirculationPaper_(circulationRecords_(book), id);
    table.deleteRow(current._row);
    SpreadsheetApp.flush();
    console.log('Kertas edaran %s (%s) dipadam oleh %s; %s rekod undi dibuang.', id, paper.status, email, votes.length);
    return {deleted: true, id, status: paper.status, votesRemoved: votes.length};
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
    const vote = votes.find(row => circulationUnitKey_(row.unit) === unit.key
      && (!unit.decidedBy || String(row.createdBy || '').toLowerCase() === unit.decidedBy));
    const representatives = unit.emails.map(memberName).join(', ');
    const decision = unit.vote
      ? (unit.vote === 'SOKONG' ? 'Menyokong' : unit.vote === 'BANTAH' ? 'Membantah' : String(unit.vote))
      : 'Belum mengundi';
    const deanTag = unit.byDean ? ' <span class="muted">(Dekan)</span>' : '';
    const superseded = unit.superseded
      ? '<br><span class="muted">Undian wakil ' + esc(unit.superseded.email) + ': '
        + esc(unit.superseded.decision === 'SOKONG' ? 'Menyokong' : unit.superseded.decision === 'BANTAH' ? 'Membantah' : unit.superseded.decision)
        + ' — diketepikan</span>'
      : '';
    return '<tr>'
      + '<td>' + esc(unit.name) + '</td>'
      + '<td>' + esc(representatives) + '</td>'
      + '<td class="tag">' + esc(decision) + deanTag + '</td>'
      + '<td>' + (vote && vote.reason ? line(vote.reason) : '-') + superseded + '</td>'
      + '<td>' + (vote ? circulationFormatDate_(vote.createdAt) : '-') + '</td>'
      + '<td>' + (vote ? esc(vote.name || '') + (vote.createdBy ? '<br><span class="muted">' + esc(vote.createdBy) + '</span>' : '') : '-')
        + (vote && vote.updatedBy && vote.updatedBy !== vote.createdBy
          ? '<br><span class="muted">Diubah oleh ' + esc(vote.updatedBy) + (vote.updatedAt instanceof Date ? ' · ' + circulationFormatDate_(vote.updatedAt) : '') + '</span>'
          : '')
        + '</td>'
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
    + '<table class="votes"><thead><tr><th>Unit</th><th>Wakil</th><th>Undi</th><th>Sebab/ulasan bantahan atau cadangan pindaan</th><th>Masa direkod</th><th>Direkod oleh</th></tr></thead><tbody>'
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
  const tally = circulationTally_(paper, records, roster);
  // A representative may vote while nobody has; a Dean may still vote after a
  // representative because their decision outranks it.
  const options = tally.unitStates
    .filter(unit => unit.emails.includes(email) && hasCirculationSeat_(roster, unit.key, email))
    .filter(unit => !unit.vote || (!unit.byDean && circulationIsDean_(roster, unit.key, email)))
    .map(unit => ({
      key: unit.key,
      name: unit.name,
      vote: unit.vote,
      dean: circulationIsDean_(roster, unit.key, email),
      overrides: unit.vote ? 'Undian wakil telah direkodkan; keputusan Dekan akan mengatasi.' : '',
    }));
  return {
    viewer: {email, name: roster.find(member => member.email === email)?.name || ''},
    current: {
      id: paper.id, committee: paper.committee, title: paper.title, reference: paper.reference,
      context: paper.context, points: String(paper.summary).split('\n').map(line => line.trim()).filter(Boolean),
      isOpen: circulationIsOpen_(paper), label: circulationStatus_(paper),
      deadline: paper.deadline instanceof Date ? Utilities.formatDate(paper.deadline, MEETING_ZONE, 'dd/MM/yyyy · HH:mm') + ' MYT' : '',
      pdfUrl: pdf?.view || '', previewUrl: pdf?.preview || '', pdfKind: pdf?.kind || '',
      summary: tally.summary, unitStates: tally.unitStates.map(safeCirculationUnit_),
      options,
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
  const reason = decision === 'BANTAH'
    ? circulationText_(form.reason, 2000, 'Sebab/ulasan bantahan', true)
    : circulationText_(form.reason, 2000, 'Cadangan pindaan');

  return circulationLocked_(() => {
    const records = circulationRecords_(book);
    const paper = findCirculationPaper_(records, id);
    const roster = circulationRoster_(book, paper.committee);
    const unit = readCirculationDelegates_(paper).find(unit => unit.key === key);
    if (!unit?.emails.includes(email) || !hasCirculationSeat_(roster, key, email)) {
      throw new Error('Akaun ini tiada mandat mengundi bagi unit yang dipilih.');
    }

    const previous = records.filter(row => row.kind === 'UNDI' && row.id === id && circulationUnitKey_(row.unit) === key);
    const retry = previous.find(row => row.request === request && row.createdBy === email && row.decision === decision);
    if (retry) return {id: retry.voteId, receipt: retry.receipt};
    if (!circulationIsOpen_(paper)) throw new Error('Undian bagi kertas ini telah ditutup atau masih dalam penyediaan.');

    const actingDean = circulationIsDean_(roster, key, email);
    const deanVote = previous.find(row => circulationIsDean_(roster, key, meetingEmail_(row.createdBy)));
    if (deanVote) {
      throw new Error(actingDean
        ? 'Undian Dekan bagi unit ini telah direkodkan.'
        : 'Keputusan Dekan telah direkodkan untuk unit ini.');
    }
    // Representatives share one vote per unit; a later Dean vote is the exception
    // because the Dean's decision outranks theirs.
    if (!actingDean && previous.length) throw new Error('Undian bagi unit ini telah direkodkan.');

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
          ...(reason ? [(decision === 'BANTAH' ? 'Sebab/ulasan bantahan: ' : 'Cadangan pindaan: ') + reason] : []),
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
  // Viewing stays with the paper's own committee; a delegate from another roster
  // (Ahli JKPS) may open the paper once they are seated on it. Candidates come from
  // the union roster so a JKPS member can be seated.
  const committeeMember = meetingRoster_(book, 'Ahli ' + paper.committee).some(member => member.email === email);
  const seated = readCirculationDelegates_(paper).some(unit => unit.emails.includes(email));
  if ((!committeeMember && !seated) || paper.status === 'Draf') {
    if (!meetingAdmin_(book, email)) {
      throw new MeetingAccountError_('Edaran ini dikhaskan untuk ahli aktif ' + paper.committee + '. Semak akaun UniSZA yang sedang digunakan.');
    }
  }
  return {paper, records, roster, email};
}

function circulationCommittee_(committee) {
  if (!['JKPS', 'JAPSU'].includes(committee)) throw new Error('Pilih jawatankuasa JKPS atau JAPSU.');
  return committee;
}

/**
 * Voting candidates come from the paper's own committee roster plus the JKPS
 * roster in the same workbook, so a faculty can be represented by its JKPS
 * member (deputy dean, coordinator) as well as its own committee delegate.
 * The committee roster wins when the same person appears in both.
 */
function circulationRoster_(book, committee) {
  const primary = meetingRoster_(book, 'Ahli ' + circulationCommittee_(committee));
  if (String(committee).toUpperCase() === 'JKPS') return primary;
  let secondary = [];
  try {
    secondary = meetingRoster_(book, 'Ahli JKPS');
  } catch (_) {
    // A workbook without the JKPS tab keeps working with its committee roster.
    return primary;
  }
  const seen = new Set(primary.map(member => member.email));
  return primary.concat(secondary.filter(member => !seen.has(member.email)));
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

// Stored key for a unit. Votes and delegate rows are keyed by it, so it must stay
// stable for existing papers.
function circulationUnitKey_(unit) {
  return String(unit || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Matching alias: the two rosters spell the same unit differently ("&" vs "dan",
// "Rekabentuk" vs "Reka Bentuk", punctuation). Used only to compare roster rows
// with a unit, never stored.
function circulationUnitAlias_(unit) {
  return String(unit || '')
    .replace(/&/g, ' dan ')
    .replace(/\brekabentuk\b/gi, ' reka bentuk ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Same unit across two rosters: identical after normalisation, or one keystroke
// apart ("Melayu Islan" vs "Melayu Islam"). Short names must match exactly so
// unrelated units never merge.
function circulationUnitsMatch_(left, right) {
  const a = circulationUnitAlias_(left);
  const b = circulationUnitAlias_(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.length >= 12 && b.length >= 12 && circulationEditDistance_(a, b) <= 1;
}

function circulationEditDistance_(a, b) {
  let previous = Array.from({length: b.length + 1}, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

function hasCirculationSeat_(roster, key, email) {
  return roster.some(member => member.email === email && circulationUnitsMatch_(member.unit, key));
}

function circulationDelegates_(roster, candidates, existing) {
  if (!Array.isArray(candidates) || candidates.length > 160) throw new Error('Senarai wakil tidak sah.');
  const units = new Map();
  // Units already on the paper keep their stored name and key, so a member whose
  // roster spells the unit differently is folded into the same unit.
  const stored = existing || [];
  for (const candidate of candidates) {
    const email = meetingEmail_(candidate?.email);
    const member = roster.find(entry => entry.email === email && isCirculationUnit_(entry.unit)
      && circulationUnitsMatch_(entry.unit, candidate?.unit));
    if (!member) throw new Error('Wakil tidak lagi sepadan dengan daftar aktif. Muat semula senarai wakil.');
    const kept = stored.find(unit => circulationUnitsMatch_(unit.name, candidate?.unit));
    const name = kept ? kept.name : String(candidate?.unit || member.unit).replace(/\s+/g, ' ').trim();
    const key = kept ? kept.key : circulationUnitKey_(name);
    if (!units.has(key)) units.set(key, {key, name, emails: []});
    const emails = units.get(key).emails;
    if (!emails.includes(email)) emails.push(email);
  }
  return [...units.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function readCirculationDelegates_(paper) {
  return JSON.parse(paper.delegates || '[]');
}

function circulationTally_(paper, records, roster) {
  const votes = records.filter(row => row.kind === 'UNDI' && row.id === paper.id);
  const unitStates = readCirculationDelegates_(paper).map(unit => {
    const unitVotes = votes.filter(row => circulationUnitKey_(row.unit) === unit.key);
    const deanEmail = circulationDeanEmail_(roster || [], unit.key);
    const isDeanVote = row => Boolean(deanEmail) && meetingEmail_(row.createdBy) === deanEmail;
    const deanVote = lastCirculationVote_(unitVotes.filter(isDeanVote));
    const repVote = lastCirculationVote_(unitVotes.filter(row => !isDeanVote(row)));
    // The Dean outranks the representatives: when the Dean votes, that decision is
    // the unit's decision even if a representative voted earlier or later.
    const deciding = deanVote || repVote;
    return {
      ...unit,
      vote: deciding ? deciding.decision : '',
      decidedBy: deciding ? meetingEmail_(deciding.createdBy) : '',
      byDean: Boolean(deanVote),
      // The representative vote the Dean overruled, kept for the evidence trail.
      superseded: deanVote && repVote
        ? {decision: repVote.decision, email: meetingEmail_(repVote.createdBy), name: repVote.name, reason: repVote.reason}
        : null,
    };
  });
  const support = unitStates.filter(unit => unit.vote === 'SOKONG').length;
  const oppose = unitStates.filter(unit => unit.vote === 'BANTAH').length;
  return {unitStates, summary: {support, oppose, waiting: unitStates.length - support - oppose, total: unitStates.length}};
}

function lastCirculationVote_(votes) {
  return votes.length ? votes.reduce((latest, vote) => (Number(vote._row) || 0) >= (Number(latest._row) || 0) ? vote : latest) : null;
}

// "Dekan" decides the faculty vote; "Timbalan Dekan" is an ordinary representative.
function isCirculationDeanRole_(role) {
  const text = String(role || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return /^dekan\b/.test(text) && !/^timbalan/.test(text);
}

function circulationDeanEmail_(roster, key) {
  const dean = roster.find(member => circulationUnitsMatch_(member.unit, key) && isCirculationDeanRole_(member.role));
  return dean ? meetingEmail_(dean.email) : '';
}

function circulationIsDean_(roster, key, email) {
  const target = meetingEmail_(email);
  return Boolean(target) && circulationDeanEmail_(roster, key) === target;
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

/**
 * A circulation paper may point at either a Google Drive PDF or a Microsoft 365
 * document (OneDrive / SharePoint). A Word document is opened in the browser so
 * members can review it and add comments or suggested changes in Word Online;
 * Drive keeps the embedded preview that the portal already renders.
 */
const CIRCULATION_DOC_HOSTS = ['sharepoint.com', '1drv.ms', 'onedrive.live.com', 'onedrive.com'];

function circulationPdf_(value) {
  const link = String(value || '').trim();
  const match = link.match(/^https:\/\/drive\.google\.com\/file\/d\/([a-z0-9_-]{15,})(?:\/(?:view|preview|edit))?\/?(?:\?.*)?$/i)
    || link.match(/^https:\/\/drive\.google\.com\/(?:open|uc)\?id=([a-z0-9_-]{15,})(?:&.*)?$/i);
  if (match) {
    const resourceKey = link.match(/[?&]resourcekey=([a-z0-9_-]+)(?:&|$)/i)?.[1] || '';
    const root = 'https://drive.google.com/file/d/' + match[1];
    const suffix = resourceKey ? '?resourcekey=' + resourceKey : '';
    return {kind: 'drive', id: match[1], resourceKey, view: root + '/view' + suffix, preview: root + '/preview' + suffix};
  }
  const onedrive = circulationOneDrivePdf_(link);
  if (onedrive) return {kind: 'onedrive', id: '', resourceKey: '', view: onedrive, preview: ''};
  throw new Error('Gunakan pautan Google Drive (PDF) atau pautan OneDrive/SharePoint (Word).');
}

// Only Microsoft 365 hosts are accepted, so a paper can never point voters at an
// unrelated site. The share link is stored exactly as supplied: the tenant sets
// the sharing scope, and stripping query parameters can invalidate it.
// Parsed with a regex because the Apps Script runtime has no WHATWG URL object.
function circulationOneDrivePdf_(link) {
  const match = link.match(/^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(?:[/?#]|$)/i);
  if (!match) return '';
  const host = match[1].toLowerCase();
  return CIRCULATION_DOC_HOSTS.some(domain => host === domain || host.endsWith('.' + domain)) ? link : '';
}

function verifyCirculationPdf_(value) {
  const pdf = circulationPdf_(value);
  // OneDrive sharing lives outside Google Drive, so only the link shape can be
  // checked here; members open the document with their UniSZA Microsoft 365 account.
  if (pdf.kind === 'onedrive') return pdf;
  const file = pdf.resourceKey ? DriveApp.getFileByIdAndResourceKey(pdf.id, pdf.resourceKey) : DriveApp.getFileById(pdf.id);
  if (file.getMimeType() !== 'application/pdf') throw new Error('Pautan Google Drive ini mesti merujuk fail PDF.');
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

/**
 * One-off spelling repair. The rosters and the circulation records drifted apart
 * ("Rekabentuk", "Pengurusan dan Perniagaan", "& " vs "dan", "Melayu Islan", a
 * shouted centre name). Renames every unit in the roster tabs and in
 * Pengesahan Edaran (paper delegates and each UNDI row), so votes keep matching
 * their unit after the rename.
 *
 * Run from the portal with an empty call for a report, then with `true` to apply.
 */
const CIRCULATION_UNIT_CORRECTIONS = [
  [/^fakulti rekabentuk inovatif dan teknologi$/i, 'Fakulti Reka Bentuk Inovatif dan Teknologi'],
  [/^fakulti pengurusan dan perniagaan$/i, 'Fakulti Perniagaan dan Pengurusan'],
  [/^institut penyelidikan produk\s*(?:&|dan)\s*ketamadunan melayu islan$/i, 'Institut Penyelidikan Produk dan Ketamadunan Melayu Islam'],
  [/^institut penyelidikan produk\s*(?:&|dan)\s*ketamadunan melayu islam$/i, 'Institut Penyelidikan Produk dan Ketamadunan Melayu Islam'],
  [/^pusat pemindahan ilmu dan pendidikan berterusan$/i, 'Pusat Pemindahan Ilmu dan Pendidikan Berterusan'],
];

function correctedCirculationUnit_(name) {
  const text = String(name || '').replace(/\s+/g, ' ').trim();
  for (const [pattern, fixed] of CIRCULATION_UNIT_CORRECTIONS) {
    if (pattern.test(text)) return fixed;
  }
  return text;
}

function repairCirculationUnitSpellings(apply) {
  const {book, email} = requireMeetingSuperAdmin_();
  const dryRun = apply !== true;
  return circulationLocked_(() => {
    const changes = [];

    // 1) roster tabs
    ['Ahli JKPS', 'Ahli JAPSU'].forEach(tab => {
      const sheet = book.getSheetByName(tab);
      if (!sheet) return;
      const values = sheet.getDataRange().getValues();
      const header = values[0] || [];
      const column = header.indexOf('Fakulti / Pusat / Institut');
      if (column < 0) return;
      values.slice(1).forEach((row, index) => {
        const current = String(row[column] || '');
        const fixed = correctedCirculationUnit_(current);
        if (!current || fixed === current.trim()) return;
        changes.push({where: tab, row: index + 2, from: current, to: fixed});
        if (!dryRun) sheet.getRange(index + 2, column + 1).setValue(fixed);
      });
    });

    // 2) circulation records
    const table = circulationSheet_(book);
    if (table) {
      circulationRecords_(book).forEach(record => {
        if (record.kind === 'KERTAS') {
          const units = readCirculationDelegates_(record);
          let touched = false;
          const fixed = units.map(unit => {
            const name = correctedCirculationUnit_(unit.name);
            if (name === unit.name) return unit;
            touched = true;
            changes.push({where: 'Pengesahan Edaran', row: record._row, from: unit.name, to: name, field: 'delegates'});
            return {...unit, name, key: circulationUnitKey_(name)};
          });
          if (touched && !dryRun) {
            const current = findCirculationPaper_(circulationRecords_(book), record.id);
            writeCirculationRecord_(table, current._row, {...current, delegates: JSON.stringify(fixed), updatedAt: new Date(), updatedBy: email});
          }
          return;
        }
        if (record.kind === 'UNDI') {
          const name = correctedCirculationUnit_(record.unit);
          if (name === record.unit) return;
          changes.push({where: 'Pengesahan Edaran', row: record._row, from: record.unit, to: name, field: 'undi'});
          if (!dryRun) writeCirculationRecord_(table, record._row, {...record, unit: name});
        }
      });
    }

    if (!dryRun) SpreadsheetApp.flush();
    console.log('repairCirculationUnitSpellings: %s change(s)%s', changes.length, dryRun ? ' (dry run)' : ' applied');
    return {applied: !dryRun, changes, count: changes.length};
  });
}
