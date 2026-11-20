/**
 * ============================================================================
 * BAHAGIAN 1: MENU & FUNGSI GOOGLE SHEETS (PENGGUNAAN DALAMAN)
 * ============================================================================
 */
function onOpen() {
  ensureMemberLifecycleColumns_();
  var ui = SpreadsheetApp.getUi();
  
  var menuUjian = ui.createMenu('Hantar Emel Jemputan (Ujian)')
      .addItem('Ujian - Mesyuarat JAPSU', 'hantarUjianJAPSU')
      .addItem('Ujian - Mesyuarat JKPS', 'hantarUjianJKPS');
      
  ui.createMenu('Sistem Emel')
      .addSubMenu(menuUjian)
      .addSeparator() 
      .addItem('Hantar Emel Hebahan (Ahli JAPSU)', 'hantarEmelJAPSU')
      .addItem('Hantar Emel Hebahan (Ahli JKPS)', 'hantarEmelJKPS')
      .addToUi();
}

function initializeMemberLifecycleColumns() {
  ensureMemberLifecycleColumns_();
}

function ensureMemberLifecycleColumns_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  ['Ahli JKPS', 'Ahli JAPSU'].forEach(function(sheetName) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 8)).getValues()[0];
    ['Tarikh Lantikan', 'Tarikh Tamat', 'Status Keahlian'].forEach(function(header, index) {
      if (headers.indexOf(header) === -1) sheet.getRange(1, 6 + index).setValue(header);
    });
    sheet.getRange(1, 6, 1, 3).setFontWeight('bold');
  });
}

function hantarUjianJAPSU() {
  prosesPenghantaranEmel("Ujian", "Mesyuarat JAPSU", "pps_japsu@unisza.edu.my", "Sekretariat JAPSU");
}

function hantarUjianJKPS() {
  prosesPenghantaranEmel("Ujian", "Mesyuarat JKPS", "pps_jkps@unisza.edu.my", "Sekretariat JKPS");
}

function hantarEmelJAPSU() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert('Pengesahan Penghantaran', 'Adakah anda pasti untuk menghantar emel jemputan kepada semua Ahli JAPSU?', ui.ButtonSet.YES_NO);
  if (response == ui.Button.YES) {
    prosesPenghantaranEmel("Ahli JAPSU", "Mesyuarat JAPSU", "pps_japsu@unisza.edu.my", "Sekretariat JAPSU");
  }
}

function hantarEmelJKPS() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert('Pengesahan Penghantaran', 'Adakah anda pasti untuk menghantar emel jemputan kepada semua Ahli JKPS?', ui.ButtonSet.YES_NO);
  if (response == ui.Button.YES) {
    prosesPenghantaranEmel("Ahli JKPS", "Mesyuarat JKPS", "pps_jkps@unisza.edu.my", "Sekretariat JKPS");
  }
}

// Digunakan oleh portal UGS selepas pengguna mengesahkan penghantaran.
function sendInvitationFromPortal(committee, type) {
  if (['JKPS', 'JAPSU'].indexOf(committee) === -1) throw new Error('Jawatankuasa tidak sah.');
  if (['Ujian', 'Hebahan'].indexOf(type) === -1) throw new Error('Jenis penghantaran tidak sah.');
  const sourceSheet = type === 'Ujian' ? 'Ujian' : 'Ahli ' + committee;
  const meetingSheet = 'Mesyuarat ' + committee;
  const senderEmail = committee === 'JKPS' ? 'pps_jkps@unisza.edu.my' : 'pps_japsu@unisza.edu.my';
  const count = teraskanPenghantaranEmel(sourceSheet, meetingSheet, senderEmail, 'Sekretariat ' + committee);
  return { committee: committee, type: type, count: count };
}

// Wrapper untuk paparan mesej Alert di dalam Google Sheet
function prosesPenghantaranEmel(namaSheetSenarai, namaSheetMesyuarat, emelPengirim, namaPengirim) {
  try {
    const count = teraskanPenghantaranEmel(namaSheetSenarai, namaSheetMesyuarat, emelPengirim, namaPengirim);
    SpreadsheetApp.getUi().alert("Selesai! " + count + " emel telah berjaya dihantar untuk " + namaSheetMesyuarat + " melalui " + emelPengirim);
  } catch (error) {
    if(SpreadsheetApp.getUi) SpreadsheetApp.getUi().alert("Ralat: " + error.message);
  }
}

/**
 * ============================================================================
 * BAHAGIAN 2: FUNGSI TERAS PENGHANTARAN EMEL & HTML EMEL
 * ============================================================================
 */
function teraskanPenghantaranEmel(namaSheetSenarai, namaSheetMesyuarat, emelPengirim, namaPengirim) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  const sheetMesyuarat = ss.getSheetByName(namaSheetMesyuarat);
  if (!sheetMesyuarat) throw new Error("Sheet '" + namaSheetMesyuarat + "' tidak ditemui.");
  
  // Baca data mesyuarat mengikut format baris terkini
  const meetingData = {
    tajuk: sheetMesyuarat.getRange("B1").getValue(), 
    jenisPemakluman: sheetMesyuarat.getRange("B2").getValue(), // Baris 2: Biasa / Perubahan Maklumat
    bilangan: sheetMesyuarat.getRange("B3").getValue(), 
    tarikh: sheetMesyuarat.getRange("B4").getValue(), 
    masa: sheetMesyuarat.getRange("B5").getValue(), 
    tempat: sheetMesyuarat.getRange("B6").getValue(), 
    pautanMesyuarat: sheetMesyuarat.getRange("B7").getValue(), 
    pautanDokumen: sheetMesyuarat.getRange("B8").getValue()  
  };

  const sheetSenarai = ss.getSheetByName(namaSheetSenarai); 
  if (!sheetSenarai) throw new Error("Sheet '" + namaSheetSenarai + "' tidak ditemui.");
  
  const dataPenerima = sheetSenarai.getDataRange().getValues();
  let emelDihantar = 0;

  for (let i = 1; i < dataPenerima.length; i++) {
    const row = dataPenerima[i];
    const nama = row[1];
    const jawatan = row[2];
    const fakulti = row[3];
    const emel = row[4];
    const statusKeahlian = String(row[7] || 'Aktif').toLowerCase();

    if (emel && emel.toString().includes("@") && ['lepas', 'past', 'inactive'].indexOf(statusKeahlian) === -1) {
      
      // Semak Jenis Pemakluman untuk olah subjek emel
      let subject = "Jemputan " + meetingData.tajuk + " " + meetingData.bilangan;
      if (meetingData.jenisPemakluman === "Perubahan Maklumat") {
        subject = "Perubahan Maklumat: " + subject;
      }
      
      const htmlBody = binaHTMLEmel(nama, jawatan, fakulti, meetingData);
      
      const options = { htmlBody: htmlBody, name: namaPengirim };
      // Gmail rejects an unverified From address; use it only when it is an alias of the deploying account.
      if (GmailApp.getAliases().some(function(alias) { return alias.toLowerCase() === emelPengirim.toLowerCase(); })) {
        options.from = emelPengirim;
      }
      GmailApp.sendEmail(emel, subject, "Sila buka emel ini menggunakan aplikasi yang menyokong HTML.", options);
      
      emelDihantar++;
    }
  }
  
  return emelDihantar; // Pulangkan jumlah emel yang berjaya dihantar untuk log backend
}

function binaHTMLEmel(nama, jawatan, fakulti, meetingData) {
  const logoUrl = "https://lh3.googleusercontent.com/d/159AA9PJ34xa18Z0a2cl_eBWxIV8yqwDc";
  
  const calTajuk = encodeURIComponent(meetingData.tajuk + " " + meetingData.bilangan);
  const calTempat = encodeURIComponent(meetingData.tempat);
  const calLink = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${calTajuk}&location=${calTempat}&details=Sila%20rujuk%20emel%20jemputan%20untuk%20maklumat%20lanjut%20dan%20pautan%20berkaitan.`;
  
  // Banner amaran jika terdapat perubahan maklumat
  let bannerPerubahan = "";
  if (meetingData.jenisPemakluman === "Perubahan Maklumat") {
    bannerPerubahan = `<div style="background-color: #fef2f2; border: 1px solid #fca5a5; color: #ef4444; padding: 12px; border-radius: 8px; margin-bottom: 20px; font-weight: bold; text-align: center; font-size: 14px;">&#9888;&#65039; PERHATIAN: Terdapat perubahan maklumat bagi mesyuarat ini. Sila rujuk butiran terkini di bawah.</div>`;
  }
  
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <style>
      body {
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        background-color: #f4f4f4;
        margin: 0;
        padding: 20px;
      }
      .email-container {
        max-width: 650px;
        margin: 0 auto;
        background-color: #ffffff;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        overflow: hidden;
      }
      .header { padding: 20px 30px; background-color: #ffffff; }
      .header img { max-height: 60px; display: block; }
      .header-title { color: #1a5276; font-size: 17px; font-weight: bold; margin: 0; }
      .title-bar { background-color: #1a5276; color: #ffffff; padding: 15px 30px; font-size: 20px; font-weight: bold; }
      .content { padding: 30px; color: #333333; line-height: 1.6; font-size: 15px; }
      .details-table { width: 100%; border-collapse: collapse; margin: 20px 0; background-color: #f9f9f9; border-radius: 5px; }
      .details-table td { padding: 10px 15px; border-bottom: 1px solid #eeeeee; }
      .details-table td:first-child { font-weight: bold; width: 35%; color: #1a5276; }
      .button-container { text-align: center; margin: 30px 0 20px 0; }
      .btn { display: inline-block; padding: 12px 24px; margin: 5px; text-decoration: none; border-radius: 4px; font-weight: bold; color: #ffffff !important; }
      .btn-meet { background-color: #c0392b; }
      .btn-doc { background-color: #2980b9; }
      .btn-cal { background-color: #f39c12; font-size: 13px; padding: 8px 16px; }
      .footer { padding: 30px; color: #555555; font-size: 14px; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="email-container">
      <div class="header">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="1%" style="white-space: nowrap; padding-right: 15px;"><img src="${logoUrl}" alt="UniSZA Logo"></td>
            <td valign="middle"><div class="header-title">Pusat Pengajian Siswazah | UniSZA Graduate School</div></td>
          </tr>
        </table>
      </div>
      <div class="title-bar">Jemputan ${meetingData.tajuk}</div>
      <div class="content">
        ${bannerPerubahan}
        <p>YBhg. Prof./Datuk/Dato'/Dr./Tuan/Puan,</p>
        <p><strong>${nama}</strong><br>${jawatan}<br>${fakulti}</p>
        <p>Sukacita dimaklumkan bahawa <strong>${meetingData.tajuk} ${meetingData.bilangan}</strong> akan diadakan seperti ketetapan berikut:</p>
        <table class="details-table">
          <tr><td>&#128197; Tarikh</td><td>: ${meetingData.tarikh}</td></tr>
          <tr><td>&#9200; Masa</td><td>: ${meetingData.masa}</td></tr>
          <tr><td>&#128205; Tempat / Platform</td><td>: ${meetingData.tempat}</td></tr>
        </table>
        <div style="text-align: center; margin-bottom: 25px;"><a href="${calLink}" class="btn btn-cal" target="_blank">&#128197; Masukkan ke Google Calendar</a></div>
        <p>Sehubungan itu, YBhg. Prof./Datuk/Dato'/Dr./Tuan/Puan adalah dijemput hadir ke mesyuarat tersebut. Bersama-sama ini disertakan pautan ke mesyuarat dan dokumen berkaitan untuk rujukan pihak YBhg. Prof./Datuk/Dato'/Dr./Tuan/Puan sebelum mesyuarat bermula.</p>
        <div class="button-container">
          <a href="${meetingData.pautanMesyuarat}" class="btn btn-meet">&#127909; Sertai Mesyuarat</a>
          <a href="${meetingData.pautanDokumen}" class="btn btn-doc">&#128194; Dokumen Mesyuarat</a>
        </div>
        <p>Kerjasama dan perhatian daripada pihak YBhg. Prof./Datuk/Dato'/Dr./Tuan/Puan amatlah dihargai dan didahului dengan ucapan terima kasih.</p>
      </div>
      <div class="footer">
        Sekian,<br><br><strong>Urus Setia Mesyuarat</strong><br>Pusat Pengajian Siswazah<br>Universiti Sultan Zainal Abidin
      </div>
    </div>
  </body>
  </html>
  `;
  
  return html;
}

/**
 * ============================================================================
 * BAHAGIAN 3: WEB APP API (UNTUK GOOGLE SITES / FRONTEND HTML)
 * ============================================================================
 */

// Menarik (GET) semua rekod ahli dan butiran mesyuarat ke Frontend
function doGet(e) {
  if (e && e.parameter && e.parameter.view === 'app') {
    return HtmlService.createTemplateFromFile('Management')
      .evaluate()
      .setTitle('UGS Meeting Management')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  const getMembers = (sheetName) => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return [];
    const data = sheet.getDataRange().getValues();
    const members = [];
    // Mula dari i = 1 untuk elak tajuk (header)
    for (let i = 1; i < data.length; i++) {
      if (data[i][1] && data[i][1].toString().trim() !== "") { // Jika nama tidak kosong
        members.push({
          id: parseInt(data[i][0]) || i, // ID = Bil
          nama: data[i][1],
          jawatan: data[i][2],
          fakulti: data[i][3],
          emel: data[i][4],
          tarikhLantikan: data[i][5] || '',
          tarikhTamat: data[i][6] || '',
          statusKeahlian: data[i][7] || 'Aktif'
        });
      }
    }
    return members;
  };

  const getMeetingDetails = (sheetName) => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return null;
    return {
      tajuk: sheet.getRange("B1").getValue(),
      jenisPemakluman: sheet.getRange("B2").getValue(),
      bil: sheet.getRange("B3").getValue(),
      tarikh: sheet.getRange("B4").getValue(),
      masa: sheet.getRange("B5").getValue(),
      tempat: sheet.getRange("B6").getValue(),
      pautan: sheet.getRange("B7").getValue(),
      dokumen: sheet.getRange("B8").getValue()
    };
  };

  const response = {
    success: true,
    membersData: {
      'JAPSU': getMembers('Ahli JAPSU'),
      'JKPS': getMembers('Ahli JKPS')
    },
    meetingDetailsData: {
      'JAPSU': getMeetingDetails('Mesyuarat JAPSU'),
      'JKPS': getMeetingDetails('Mesyuarat JKPS')
    }
  };

  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}

// Mengemaskini (POST) data daripada Frontend
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === 'syncLiveAttendance') {
      return createJsonResponse({ success: true, result: handleLiveAttendancePost_(payload) });
    }

    // 1. KEMASKINI BUTIRAN MESYUARAT
    if (action === 'saveMeetingConfig') {
      const meeting = payload.meeting; // 'JAPSU' atau 'JKPS'
      const data = payload.data;
      const sheet = ss.getSheetByName('Mesyuarat ' + meeting);
      
      sheet.getRange("B2").setValue(data.jenisPemakluman);
      sheet.getRange("B3").setValue(data.bil);
      sheet.getRange("B4").setValue(data.tarikh);
      sheet.getRange("B5").setValue(data.masa);
      sheet.getRange("B6").setValue(data.tempat);
      sheet.getRange("B7").setValue(data.pautan);
      sheet.getRange("B8").setValue(data.dokumen);

      return createJsonResponse({ success: true, message: "Butiran berjaya disimpan." });
    }

    // 2. TAMBAH/KEMASKINI AHLI
    if (action === 'saveMember') {
      const tab = payload.tab; // 'JAPSU' atau 'JKPS'
      const member = payload.member;
      const sheetName = 'Ahli ' + tab;
      let sheet = ss.getSheetByName(sheetName);
      
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
        sheet.appendRow(["Bil", "Nama", "Jawatan", "Fakulti / Pusat / Institut", "Emel"]);
      }
      ensureMemberLifecycleColumns_();

      const data = sheet.getDataRange().getValues();
      let rowIndex = -1;

      // Cari jika id (Bil) wujud untuk kemaskini
      if (member.id) {
        for (let i = 1; i < data.length; i++) {
          if (data[i][0] == member.id) {
            rowIndex = i + 1; // +1 sebab array index mula dari 0, row mula dari 1
            break;
          }
        }
      }

      if (rowIndex !== -1) {
        // Kemaskini rekod sedia ada
        const existing = data[rowIndex - 1];
        sheet.getRange(rowIndex, 2, 1, 7).setValues([[member.nama, member.jawatan, member.fakulti, member.emel,
          member.tarikhLantikan || existing[5] || '', member.tarikhTamat || existing[6] || '', member.statusKeahlian || existing[7] || 'Aktif']]);
      } else {
        // Tambah rekod baharu
        const newId = data.length > 1 ? Math.max(...data.slice(1).map(r => parseInt(r[0]) || 0)) + 1 : 1;
        sheet.appendRow([newId, member.nama, member.jawatan, member.fakulti, member.emel, member.tarikhLantikan || '', member.tarikhTamat || '', member.statusKeahlian || 'Aktif']);
      }
      return createJsonResponse({ success: true });
    }

    // 3. BUANG AHLI
    if (action === 'deleteMember') {
      const tab = payload.tab;
      const id = payload.id;
      const sheet = ss.getSheetByName('Ahli ' + tab);
      if (!sheet) throw new Error("Sheet tidak ditemui");
      
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] == id) {
          sheet.deleteRow(i + 1);
          break;
        }
      }
      return createJsonResponse({ success: true });
    }

    // Arkib ahli supaya rekod pelantikan dan kehadiran sejarah tidak hilang.
    if (action === 'archiveMember') {
      const sheet = ss.getSheetByName('Ahli ' + payload.tab);
      if (!sheet) throw new Error("Sheet tidak ditemui");
      ensureMemberLifecycleColumns_();
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] == payload.id) {
          sheet.getRange(i + 1, 7).setValue(payload.tarikhTamat || new Date());
          sheet.getRange(i + 1, 8).setValue('Lepas');
          return createJsonResponse({ success: true });
        }
      }
      throw new Error("Ahli tidak ditemui");
    }

    // 3.5 KEMASKINI SUSUNAN (ORDER) AHLI
    if (action === 'updateOrder') {
      const tab = payload.tab; // 'JAPSU' atau 'JKPS'
      const orderedIds = payload.orderedIds; // Array ID contoh: [3, 1, 4, 2]
      const sheetName = 'Ahli ' + tab;
      const sheet = ss.getSheetByName(sheetName);

      if (!sheet) throw new Error("Sheet tidak ditemui");

      // Ambil semua data
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const rows = data.slice(1);

      // Susun semula baris mengikut orderedIds
      const newRows = [];
      for (let i = 0; i < orderedIds.length; i++) {
        const targetId = String(orderedIds[i]);
        
        // Cari baris asal yang sepadan dengan ID
        const row = rows.find(r => String(r[0]) === targetId);
        
        if (row) {
          // PENTING: Kita mesti 'clone' (salin) data tersebut supaya tidak merosakkan carian array asal
          const clonedRow = [...row]; 
          clonedRow[0] = i + 1; // Kemaskini terus nombor siri Bil.
          newRows.push(clonedRow);
        }
      }

      // Jika ada baris baru/lain yang terlepas pandang (safety net)
      const existingIds = orderedIds.map(String);
      const remainingRows = rows.filter(r => !existingIds.includes(String(r[0])));
      for(let i=0; i<remainingRows.length; i++){
         const clonedRow = [...remainingRows[i]];
         clonedRow[0] = newRows.length + 1;
         newRows.push(clonedRow);
      }

      // Padam data lama dan tulis semula susunan yang baru
      if (newRows.length > 0) {
        // Clear content sahaja, jangan delete row untuk kekalkan format/border
        sheet.getRange(2, 1, sheet.getLastRow() > 1 ? sheet.getLastRow() - 1 : 1, sheet.getLastColumn()).clearContent();
        sheet.getRange(2, 1, newRows.length, newRows[0].length).setValues(newRows);
      }

      return createJsonResponse({ success: true, message: "Susunan dikemaskini" });
    }

    // 4. HANTAR EMEL DARI FRONTEND
    if (action === 'sendEmail') {
      const meeting = payload.meeting; // 'JAPSU' atau 'JKPS'
      const type = payload.type; // 'Ujian' atau 'Hebahan'
      
      const sheetSenarai = type === 'Ujian' ? 'Ujian' : 'Ahli ' + meeting;
      const sheetMesyuarat = 'Mesyuarat ' + meeting;
      const emelPengirim = meeting === 'JKPS' ? 'pps_jkps@unisza.edu.my' : 'pps_japsu@unisza.edu.my';
      const namaPengirim = 'Sekretariat ' + meeting;

      const count = teraskanPenghantaranEmel(sheetSenarai, sheetMesyuarat, emelPengirim, namaPengirim);
      return createJsonResponse({ success: true, count: count });
    }

    return createJsonResponse({ success: false, error: 'Tindakan tidak sah.' });

  } catch (error) {
    return createJsonResponse({ success: false, error: error.toString() });
  }
}

// Helper untuk format pulangan JSON ke HTML Frontend
function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
