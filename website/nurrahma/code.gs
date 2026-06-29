const SPREADSHEET_ID = '1w1DcF8qu_CozEJ5GzL88HNhWv3AxWSLnMm2KO3V5838';
const FOLDER_ID      = '10j8P6hWY3RZRKyKLqEm01Gestq6FN8EL';
const SHEET_DOKUMEN  = 'dokumen';
const SHEET_TRX      = 'transaksi';
const SHEET_TRX_DET  = 'transaksi_detail';
const SHEET_ABSENSI  = 'absensi';

// ── HASH SHA-256 ──────────────────────────────────────────────────────────────
// [1.1] Fungsi hash password menggunakan SHA-256 via GAS Utilities
function hashPassword(plaintext) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    plaintext,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

// ── MIGRASI PASSWORD LAMA ─────────────────────────────────────────────────────
// [1.5] Jalankan sekali manual dari editor GAS untuk hash semua password plaintext
// yang sudah ada di sheet users. Cirinya: password yang belum di-hash pendek
// (bukan 64 karakter hex). Setelah dijalankan, kolom password berisi hash SHA-256.
function migrasiPasswordLama() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('users');
  if (!sheet) { Logger.log('Sheet "users" tidak ditemukan'); return; }

  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const passCol = headers.indexOf('password');
  if (passCol < 0) { Logger.log('Kolom "password" tidak ditemukan'); return; }

  let count = 0;
  for (let i = 1; i < data.length; i++) {
    const pass = String(data[i][passCol] || '');
    // Hash SHA-256 selalu 64 karakter hex — kalau bukan, berarti masih plaintext
    if (pass.length !== 64 || !/^[0-9a-f]+$/.test(pass)) {
      const hashed = hashPassword(pass);
      sheet.getRange(i + 1, passCol + 1).setValue(hashed);
      count++;
      Logger.log(`Row ${i + 1}: password dimigrasi`);
    }
  }
  Logger.log(`Migrasi selesai. ${count} password di-hash.`);
}

function hitungStatus(dp, pelunasan, jumlah){
  dp        = Number(dp)        || 0;
  pelunasan = Number(pelunasan) || 0;
  jumlah    = Number(jumlah)    || 0;
  const totalBayar = dp + pelunasan;
  if(dp === 0 && pelunasan === 0) return null;
  if(totalBayar === jumlah)       return 'Lunas';
  if(totalBayar < jumlah)         return 'Diproses';
  return 'Pending';
}

// Cari baris terakhir yang benar-benar berisi data
function getLastDataRow(sheet) {
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i].some(cell => cell !== '' && cell !== null && cell !== 0 && cell !== '0')) {
      return i + 1;
    }
  }
  return 1;
}

// Generate ID transaksi berikutnya
function generateTrxId(sheet) {
  const data = sheet.getDataRange().getValues();
  let maxNum = 0;
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][0] || '');
    if (id.startsWith('TRX-')) {
      const num = parseInt(id.replace('TRX-', '')) || 0;
      if (num > maxNum) maxNum = num;
    }
  }
  return 'TRX-' + String(maxNum + 1).padStart(3, '0');
}

function doPost(e) {
  try {
    const params = e.parameter;
    const action = params.action || 'uploadDok';
    if (action === 'login')             return handleLogin(params);          // [1.3]
    if (action === 'getUsers')          return handleGetUsers(params);       // [1.4]
    if (action === 'gantiPassword')     return handleGantiPassword(params);  // [1.8]
    if (action === 'resetPassword')     return handleResetPassword(params);  // [1.9]
    if (action === 'editUser')          return handleEditUser(params);       // [1.10]
    if (action === 'tambahTrx')         return tambahTrx(params);
    if (action === 'updateStatusTrx')   return updateStatusTrx(params);
    if (action === 'logAkses')          return simpanLogAkses(params);
    if (action === 'clearLog')          return clearLogAkses(params);
    if (action === 'absensi')           return handleAbsensi(params);
    if (action === 'updateAbsensiAdmin')return updateAbsensiAdmin(params);
    if (action === 'uploadAbsensiFoto') return uploadAbsensiFoto(params);
    if (action === 'registrasi')        return handleRegistrasi(params);
    if (action === 'istirahat_mulai')   return handleIstirahatMulai(params);   // [2.5]
    if (action === 'istirahat_selesai') return handleIstirahatSelesai(params); // [2.6]
    if (action === 'getShift')          return handleGetShift(params);       // [3.3]
    if (action === 'getJadwal')         return handleGetJadwal(params);      // [3.4]
    if (action === 'setJadwal')         return handleSetJadwal(params);      // [3.5]
    if (action === 'kelolaShift')       return handleKelolaShift(params);    // [3.6]
    return uploadDokumen(params);
  } catch(err) {
    return jsonResponse({ success: false, message: 'doPost error: ' + err.toString() });
  }
}

// ── LOGIN VIA SERVER ──────────────────────────────────────────────────────────
// [1.3] Endpoint login: terima username + password plaintext, hash di server,
// cocokkan dengan hash di sheet, balas sukses/gagal + data user (TANPA password)
function handleLogin(params) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('users');
    if (!sheet) return jsonResponse({ success: false, message: 'Sheet "users" tidak ditemukan' });

    const username = (params.username || '').trim().toLowerCase();
    const password = (params.password || '').trim();

    if (!username || !password)
      return jsonResponse({ success: false, message: 'Username dan password wajib diisi' });

    const inputHash = hashPassword(password);

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const userCol = headers.indexOf('username');
    const passCol = headers.indexOf('password');
    // [FIX] support kolom 'name' (alias 'nama') di sheet users
    const namaCol = headers.indexOf('nama') >= 0 ? headers.indexOf('nama') : headers.indexOf('name');
    const roleCol = headers.indexOf('role');
    const statCol = headers.indexOf('status');

    if (userCol < 0 || passCol < 0)
      return jsonResponse({ success: false, message: 'Kolom username/password tidak ditemukan' });

    for (let i = 1; i < data.length; i++) {
      const rowUser = String(data[i][userCol] || '').trim().toLowerCase();
      if (rowUser !== username) continue;

      const storedPass = String(data[i][passCol] || '');
      if (storedPass !== inputHash)
        return jsonResponse({ success: false, message: 'Password salah' });

      const status = String(data[i][statCol] || 'Aktif');
      if (status.toLowerCase() === 'nonaktif')
        return jsonResponse({ success: false, message: 'Akun Anda dinonaktifkan. Hubungi admin.' });

      return jsonResponse({
        success:  true,
        message:  'Login berhasil',
        user: {
          username: data[i][userCol],
          nama:     namaCol >= 0 ? String(data[i][namaCol] || '') : '',
          role:     roleCol >= 0 ? String(data[i][roleCol] || 'karyawan').toLowerCase() : 'karyawan',
          status:   status
        }
      });
    }

    return jsonResponse({ success: false, message: 'Username tidak ditemukan' });

  } catch(err) {
    return jsonResponse({ success: false, message: 'handleLogin error: ' + err.toString() });
  }
}

// ── GET USERS (tanpa password) ────────────────────────────────────────────────
// [1.4] Endpoint: balas daftar user (username, nama, role, status) — TANPA password
// Bisa dipanggil GET atau POST dengan action=getUsers
function handleGetUsers(params) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('users');
    if (!sheet) return jsonResponse({ success: false, message: 'Sheet "users" tidak ditemukan' });

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const userCol = headers.indexOf('username');
    // [FIX] support kolom 'name' (alias 'nama') di sheet users
    const namaCol = headers.indexOf('nama') >= 0 ? headers.indexOf('nama') : headers.indexOf('name');
    const roleCol = headers.indexOf('role');
    const statCol = headers.indexOf('status');

    const users = [];
    for (let i = 1; i < data.length; i++) {
      const username = String(data[i][userCol] || '').trim();
      if (!username) continue;
      users.push({
        username: username,
        nama:     namaCol >= 0 ? String(data[i][namaCol] || '') : '',
        role:     roleCol >= 0 ? String(data[i][roleCol] || 'karyawan').toLowerCase() : 'karyawan',
        status:   statCol >= 0 ? String(data[i][statCol] || 'Aktif') : 'Aktif'
      });
    }

    return jsonResponse({ success: true, users: users });

  } catch(err) {
    return jsonResponse({ success: false, message: 'handleGetUsers error: ' + err.toString() });
  }
}

// ── GANTI PASSWORD (karyawan sendiri) ────────────────────────────────────────
// [1.8] Verifikasi password lama, simpan hash password baru
function handleGantiPassword(params) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('users');
    if (!sheet) return jsonResponse({ success: false, message: 'Sheet "users" tidak ditemukan' });

    const username    = (params.username    || '').trim().toLowerCase();
    const passLama    = (params.passLama    || '').trim();
    const passBaru    = (params.passBaru    || '').trim();

    if (!username || !passLama || !passBaru)
      return jsonResponse({ success: false, message: 'Data tidak lengkap' });
    if (passBaru.length < 6)
      return jsonResponse({ success: false, message: 'Password baru minimal 6 karakter' });

    const hashLama = hashPassword(passLama);
    const hashBaru = hashPassword(passBaru);

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const userCol = headers.indexOf('username');
    const passCol = headers.indexOf('password');

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][userCol] || '').trim().toLowerCase() !== username) continue;
      if (String(data[i][passCol] || '') !== hashLama)
        return jsonResponse({ success: false, message: 'Password lama tidak cocok' });
      sheet.getRange(i + 1, passCol + 1).setValue(hashBaru);
      return jsonResponse({ success: true, message: 'Password berhasil diubah' });
    }

    return jsonResponse({ success: false, message: 'User tidak ditemukan' });

  } catch(err) {
    return jsonResponse({ success: false, message: 'handleGantiPassword error: ' + err.toString() });
  }
}

// ── RESET PASSWORD (admin/owner) ──────────────────────────────────────────────
// [1.9] Reset password karyawan lain tanpa perlu tahu password lama
function handleResetPassword(params) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('users');
    if (!sheet) return jsonResponse({ success: false, message: 'Sheet "users" tidak ditemukan' });

    const requesterRole = (params.requesterRole || '').toLowerCase();
    if (requesterRole !== 'admin' && requesterRole !== 'owner')
      return jsonResponse({ success: false, message: 'Akses ditolak: hanya admin/owner' });

    const targetUsername = (params.targetUsername || '').trim().toLowerCase();
    const passBaru       = (params.passBaru       || '').trim();

    if (!targetUsername || !passBaru)
      return jsonResponse({ success: false, message: 'Data tidak lengkap' });
    if (passBaru.length < 6)
      return jsonResponse({ success: false, message: 'Password baru minimal 6 karakter' });

    const hashBaru = hashPassword(passBaru);

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const userCol = headers.indexOf('username');
    const passCol = headers.indexOf('password');

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][userCol] || '').trim().toLowerCase() !== targetUsername) continue;
      sheet.getRange(i + 1, passCol + 1).setValue(hashBaru);
      return jsonResponse({ success: true, message: 'Password berhasil direset' });
    }

    return jsonResponse({ success: false, message: 'User tidak ditemukan' });

  } catch(err) {
    return jsonResponse({ success: false, message: 'handleResetPassword error: ' + err.toString() });
  }
}

// ── EDIT USER (admin/owner) ───────────────────────────────────────────────────
// [1.10] Edit data karyawan: username, nama, role, status (password opsional)
function handleEditUser(params) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('users');
    if (!sheet) return jsonResponse({ success: false, message: 'Sheet "users" tidak ditemukan' });

    const requesterRole = (params.requesterRole || '').toLowerCase();
    if (requesterRole !== 'admin' && requesterRole !== 'owner')
      return jsonResponse({ success: false, message: 'Akses ditolak: hanya admin/owner' });

    // targetUsername: username yang SEDANG DIEDIT (sebelum diubah)
    const targetUsername = (params.targetUsername || '').trim().toLowerCase();
    if (!targetUsername)
      return jsonResponse({ success: false, message: 'targetUsername wajib diisi' });

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const userCol = headers.indexOf('username');
    // [FIX] support kolom 'name' (alias 'nama') di sheet users
    const namaCol = headers.indexOf('nama') >= 0 ? headers.indexOf('nama') : headers.indexOf('name');
    const roleCol = headers.indexOf('role');
    const statCol = headers.indexOf('status');
    const passCol = headers.indexOf('password');

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][userCol] || '').trim().toLowerCase() !== targetUsername) continue;

      if (params.username !== undefined && userCol >= 0)
        sheet.getRange(i + 1, userCol + 1).setValue((params.username || '').trim().toLowerCase());
      if (params.nama !== undefined && namaCol >= 0)
        sheet.getRange(i + 1, namaCol + 1).setValue((params.nama || '').trim());
      if (params.role !== undefined && roleCol >= 0)
        sheet.getRange(i + 1, roleCol + 1).setValue((params.role || 'karyawan').trim().toLowerCase());
      if (params.status !== undefined && statCol >= 0)
        sheet.getRange(i + 1, statCol + 1).setValue((params.status || 'Aktif').trim());

      // Reset password hanya kalau field passBaru diisi
      if (params.passBaru && params.passBaru.trim().length >= 6 && passCol >= 0) {
        sheet.getRange(i + 1, passCol + 1).setValue(hashPassword(params.passBaru.trim()));
      }

      return jsonResponse({ success: true, message: 'Data karyawan berhasil diperbarui' });
    }

    return jsonResponse({ success: false, message: 'User tidak ditemukan' });

  } catch(err) {
    return jsonResponse({ success: false, message: 'handleEditUser error: ' + err.toString() });
  }
}

// ── REGISTRASI ────────────────────────────────────────────────────────────────
// [1.2] Hash password sebelum disimpan ke sheet users
function handleRegistrasi(params) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('users');
    if (!sheet) return jsonResponse({ success: false, message: 'Sheet "users" tidak ditemukan' });

    const username = (params.username || '').trim().toLowerCase();
    const nama     = (params.nama     || '').trim();
    const password = (params.password || '').trim();
    const role     = (params.role     || 'karyawan').trim();
    const status   = (params.status   || 'Aktif').trim();

    if (!username || !password || !nama)
      return jsonResponse({ success: false, message: 'Data tidak lengkap' });

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const userCol = headers.indexOf('username');
    if (userCol < 0) return jsonResponse({ success: false, message: 'Kolom "username" tidak ditemukan di sheet users' });

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][userCol] || '').toLowerCase() === username) {
        return jsonResponse({ success: false, message: 'Username sudah digunakan' });
      }
    }

    // [1.2] Hash password sebelum simpan
    const hashedPassword = hashPassword(password);

    const newRow = headers.map(h => {
      if (h === 'username') return username;
      if (h === 'nama' || h === 'name') return nama;  // [FIX] support kolom name
      if (h === 'password') return hashedPassword;
      if (h === 'role')     return role;
      if (h === 'status')   return status;
      return '';
    });

    const lastRow = getLastDataRow(sheet);
    sheet.getRange(lastRow + 1, 1, 1, newRow.length).setValues([newRow]);

    return jsonResponse({ success: true, message: 'Registrasi berhasil' });

  } catch(err) {
    return jsonResponse({ success: false, message: 'handleRegistrasi error: ' + err.toString() });
  }
}

// ── TAMBAH TRANSAKSI ──────────────────────────────────────────────────────────
function tambahTrx(params) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const shTrx = ss.getSheetByName(SHEET_TRX);
    const shDet = ss.getSheetByName(SHEET_TRX_DET);

    const trxId    = generateTrxId(shTrx);
    const lastTrx  = getLastDataRow(shTrx);
    const lastDet  = getLastDataRow(shDet);

    const mitraId   = params.mitraId   || '';
    const mitra     = params.mitra     || '';
    const tipe      = params.tipe      || '';
    const tanggal   = params.tanggal   || '';
    const deskripsi = params.deskripsi || '';
    const jumlah    = Number(params.jumlah)    || 0;
    const dp        = Number(params.dp)        || 0;
    const pelunasan = Number(params.pelunasan) || 0;
    const status    = hitungStatus(dp, pelunasan, jumlah) || params.status || 'Lunas';

    let detailRaw = params.detail || '[]';
    try { detailRaw = decodeURIComponent(detailRaw); } catch(e) {}
    const detailArr = JSON.parse(detailRaw);

    shTrx.getRange(lastTrx + 1, 1, 1, 10).setValues([[
      trxId, mitraId, mitra, tipe, tanggal, deskripsi, dp, pelunasan, jumlah, status
    ]]);

    let detRow = lastDet + 1;
    detailArr.forEach(d => {
      shDet.getRange(detRow, 1, 1, 9).setValues([[
        trxId,
        d.detail    || '',
        d.subdetail || '',
        Number(d.qty)      || 0,
        d.satuan    || '',
        Number(d.harga)    || 0,
        Number(d.subtotal) || 0,
        Number(d.ongkos)   || 0,
        d.supir     || ''
      ]]);
      detRow++;
    });

    return jsonResponse({ success: true, message: 'Transaksi berhasil disimpan', trxId });

  } catch(err) {
    return jsonResponse({ success: false, message: 'tambahTrx error: ' + err.toString() });
  }
}

function updateStatusTrx(params) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_TRX);
    const data  = sheet.getDataRange().getValues();
    const headers = data[0];

    const trxId     = params.trxId  || '';
    const dp        = Number(params.dp)        || 0;
    const pelunasan = Number(params.pelunasan) || 0;
    const jumlah    = Number(params.jumlah)    || 0;
    const status    = hitungStatus(dp, pelunasan, jumlah) || 'Pending';

    const idCol        = headers.indexOf('id');
    const statusCol    = headers.indexOf('status');
    const dpCol        = headers.indexOf('dp');
    const pelunasanCol = headers.indexOf('pelunasan');

    if(idCol < 0 || statusCol < 0)
      return jsonResponse({ success: false, message: 'Kolom tidak ditemukan' });

    for(let i = 1; i < data.length; i++){
      if(String(data[i][idCol]).trim() === trxId){
        if(dpCol >= 0)        sheet.getRange(i+1, dpCol+1).setValue(dp);
        if(pelunasanCol >= 0) sheet.getRange(i+1, pelunasanCol+1).setValue(pelunasan);
        sheet.getRange(i+1, statusCol+1).setValue(status);
        return jsonResponse({ success: true, message: 'Berhasil diupdate', status });
      }
    }
    return jsonResponse({ success: false, message: 'Transaksi tidak ditemukan' });

  } catch(err) {
    return jsonResponse({ success: false, message: 'updateStatusTrx error: ' + err.toString() });
  }
}

// ── UPLOAD DOKUMEN ────────────────────────────────────────────────────────────
function uploadDokumen(params) {
  try {
    const fileData    = params.fileData    || '';
    const fileName    = params.fileName    || 'dokumen_' + Date.now();
    const mitraId     = params.mitraId     || '';
    const mitraNama   = params.mitraNama   || '';
    const jenis       = params.jenis       || 'Lainnya';
    const docNamaBaru = params.docNamaBaru || '';
    const keterangan  = params.keterangan  || '';
    const docNama     = params.docNama     || '';
    const oldFileId   = params.oldFileId   || '';
    const mimeType    = params.mimeType    || 'application/octet-stream';
    const docTanggal  = params.docTanggal  || '';

    if (!fileData) return jsonResponse({ success: false, message: 'File tidak ditemukan' });

    const decoded = Utilities.base64Decode(fileData);
    const blob    = Utilities.newBlob(decoded, mimeType, fileName);
    const folder  = DriveApp.getFolderById(FOLDER_ID);
    const file    = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const fileUrl = 'https://drive.google.com/file/d/' + file.getId() + '/view';

    const ss      = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet   = ss.getSheetByName(SHEET_DOKUMEN);

    const tanggal = docTanggal
      ? docTanggal.slice(0, 10)
      : Utilities.formatDate(new Date(), 'Asia/Makassar', 'yyyy-MM-dd');

    if (docNama) {
      const data    = sheet.getDataRange().getValues();
      const headers = data[0];
      const namaCol = headers.indexOf('nama');
      const urlCol  = headers.indexOf('url');
      let updated   = false;
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][namaCol]).trim() === String(docNama).trim()) {
          sheet.getRange(i + 1, urlCol + 1).setValue(fileUrl);
          updated = true;
          break;
        }
      }
      if (oldFileId) {
        try { DriveApp.getFileById(oldFileId).setTrashed(true); } catch(e) {}
      }
      if (!updated) return jsonResponse({ success: false, message: 'Dokumen "' + docNama + '" tidak ditemukan' });
      return jsonResponse({ success: true, message: 'File berhasil diganti', fileUrl });

    } else {
      const lastRow = getLastDataRow(sheet);
      const docId   = 'DOC' + String(lastRow).padStart(4, '0');
      sheet.getRange(lastRow + 1, 1, 1, 9).setValues([[
        docId, mitraId, mitraNama, docNamaBaru, jenis, tanggal, keterangan, 'Aktif', fileUrl
      ]]);
      return jsonResponse({ success: true, message: 'Dokumen berhasil diupload', docId, fileUrl });
    }

  } catch(err) {
    return jsonResponse({ success: false, message: 'uploadDokumen error: ' + err.toString() });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── LOG AKSES ─────────────────────────────────────────────────────────────────
function simpanLogAkses(params) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Log Akses');
    if (!sheet) return jsonResponse({ success: false, message: 'Sheet "Log Akses" tidak ditemukan' });
    sheet.appendRow([
      params.waktu   || '',
      params.username|| '',
      params.nama    || '',
      params.role    || '',
      params.tipe    || '',
      params.halaman || '',
      params.ip      || '',
      params.kota    || '',
      params.negara  || '',
      params.browser || '',
      params.device  || ''
    ]);
    return jsonResponse({ success: true });
  } catch(err) {
    return jsonResponse({ success: false, message: 'logAkses error: ' + err.toString() });
  }
}

// ── BERSIHKAN LOG AKSES ───────────────────────────────────────────────────────
function clearLogAkses(params) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Log Akses');
    if (!sheet) return jsonResponse({ success: false, message: 'Sheet "Log Akses" tidak ditemukan' });
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
    }
    return jsonResponse({ success: true, message: 'Log akses berhasil dibersihkan' });
  } catch(err) {
    return jsonResponse({ success: false, message: 'clearLogAkses error: ' + err.toString() });
  }
}

function doGet(e) {
  try {
    const params = e.parameter;
    const action = params.action || '';
    if (action === 'getUsers')  return handleGetUsers(params);   // [1.4] juga bisa via GET
    if (action === 'getShift')  return handleGetShift(params);   // [3.3] juga bisa via GET
    if (action === 'getJadwal') return handleGetJadwal(params);  // [3.4] juga bisa via GET
    return jsonResponse({ success: true, message: 'API aktif ✅' });
  } catch(err) {
    return jsonResponse({ success: false, message: 'doGet error: ' + err.toString() });
  }
}



// ── ABSENSI ───────────────────────────────────────────────────────────────────

function generateAbsensiId(sheet) {
  const data = sheet.getDataRange().getValues();
  let max = 0;
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][0] || '');
    if (id.startsWith('ABS-')) {
      const n = parseInt(id.replace('ABS-', '')) || 0;
      if (n > max) max = n;
    }
  }
  return 'ABS-' + String(max + 1).padStart(4, '0');
}

// ── HELPER JAM & DURASI ───────────────────────────────────────────────────────
function toHHMM(val) {
  if (!val) return '';
  if (val instanceof Date) {
    const h = String(val.getHours()).padStart(2, '0');
    const m = String(val.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  const m = String(val).match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2,'0')}:${m[2]}` : '';
}

function hitungDurasi(jamMasukRaw, jamKeluarRaw) {
  const jamMasuk  = toHHMM(jamMasukRaw);
  const jamKeluar = toHHMM(jamKeluarRaw);
  if (!jamMasuk || !jamKeluar) return '';
  try {
    const [hM, mM] = jamMasuk.split(':').map(Number);
    const [hK, mK] = jamKeluar.split(':').map(Number);
    const totalMenit = (hK * 60 + mK) - (hM * 60 + mM);
    if (totalMenit < 0) return '';
    const jam = Math.floor(totalMenit / 60);
    const mnt = totalMenit % 60;
    return `${jam}j ${mnt}m`;
  } catch (e) { return ''; }
}

function setTextCell(sheet, row, col, value) {
  const cell = sheet.getRange(row, col);
  cell.setNumberFormat('@');
  cell.setValue(value);
}

function findCol(headers, aliases) {
  for (let i = 0; i < aliases.length; i++) {
    const idx = headers.indexOf(aliases[i]);
    if (idx >= 0) return idx;
  }
  return -1;
}

function ensureAbsensiColumns(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  // [2.4] Tambah kolom istirahat_log (JSON sesi istirahat) + kolom shift
  const required = ['gps_keluar', 'gps_link_keluar', 'shift_id', 'istirahat_log'];
  required.forEach(name => {
    if (headers.indexOf(name) < 0) {
      const newColIdx = headers.length + 1;
      sheet.getRange(1, newColIdx).setValue(name);
      headers.push(name);
    }
  });
  return headers;
}

function handleAbsensi(params) {
  try {
    const ss      = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet   = ss.getSheetByName(SHEET_ABSENSI)
                 || ss.insertSheet(SHEET_ABSENSI);

    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, 14).setValues([[
        'id','username','tanggal','status',
        'jam_masuk','jam_keluar','durasi',
        'gps_masuk','gps_link_masuk','gps_keluar','gps_link_keluar',
        'foto_masuk','foto_keluar','keterangan'
      ]]);
    }

    ensureAbsensiColumns(sheet);

    const username   = (params.username   || '').trim().toLowerCase();
    const tanggal    = params.tanggal    || '';
    const tipe       = params.tipe       || '';
    const jam        = params.jam        || '';
    const status     = params.status     || 'Hadir';
    const gps        = params.gps        || '';
    const gpsLink    = params.gpsLink    || '';
    const foto       = params.foto       || '';
    const keterangan = params.keterangan || '';
    const shiftId    = params.shiftId    || ''; // [3.7] shift yang dipakai saat check-in

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol   = headers.indexOf('id');
    const usrCol  = headers.indexOf('username');
    const tglCol  = headers.indexOf('tanggal');
    const jmCol   = headers.indexOf('jam_masuk');
    const jkCol   = headers.indexOf('jam_keluar');
    const durCol  = headers.indexOf('durasi');
    const fmCol   = headers.indexOf('foto_masuk');
    const fkCol   = headers.indexOf('foto_keluar');
    const stCol   = headers.indexOf('status');
    const ketCol  = headers.indexOf('keterangan');
    const gpsMasukCol     = findCol(headers, ['gps_masuk', 'gps']);
    const gpsLinkMasukCol = findCol(headers, ['gps_link_masuk', 'gps_link']);
    const gpsKeluarCol     = findCol(headers, ['gps_keluar']);
    const gpsLinkKeluarCol = findCol(headers, ['gps_link_keluar']);
    const shiftIdCol       = findCol(headers, ['shift_id']); // [3.7]
    const istirahatLogCol  = findCol(headers, ['istirahat_log']); // [2.4]

    function sameDate(cellVal) {
      if (!cellVal) return false;
      let str;
      if (cellVal instanceof Date) {
        const y = cellVal.getFullYear();
        const m = String(cellVal.getMonth()+1).padStart(2,'0');
        const d = String(cellVal.getDate()).padStart(2,'0');
        str = `${y}-${m}-${d}`;
      } else {
        str = String(cellVal).slice(0, 10);
      }
      return str === tanggal;
    }
    function sameUser(cellVal) {
      return String(cellVal || '').trim().toLowerCase() === username;
    }

    if (tipe === 'lapor') {
      for (let i = 1; i < data.length; i++) {
        if (sameUser(data[i][usrCol]) && sameDate(data[i][tglCol])) {
          sheet.getRange(i+1, stCol+1).setValue(status);
          if (keterangan && ketCol >= 0) sheet.getRange(i+1, ketCol+1).setValue(keterangan);
          if (foto && fmCol >= 0) sheet.getRange(i+1, fmCol+1).setValue(foto);
          return jsonResponse({ success: true, message: 'Status diperbarui' });
        }
      }
      const newId   = generateAbsensiId(sheet);
      const lastRow = getLastDataRow(sheet);
      const newRow  = new Array(headers.length).fill('');
      newRow[idCol]  = newId;
      newRow[usrCol] = username;
      newRow[tglCol] = tanggal;
      newRow[stCol]  = status;
      if (gpsMasukCol >= 0)     newRow[gpsMasukCol]     = gps;
      if (gpsLinkMasukCol >= 0) newRow[gpsLinkMasukCol] = gpsLink;
      if (fmCol >= 0)  newRow[fmCol]  = foto;
      if (ketCol >= 0) newRow[ketCol] = keterangan;
      sheet.getRange(lastRow+1, 1, 1, headers.length).setValues([newRow]);
      return jsonResponse({ success: true, message: 'Laporan disimpan', id: newId });
    }

    if (tipe === 'checkin') {
      for (let i = 1; i < data.length; i++) {
        if (sameUser(data[i][usrCol]) && sameDate(data[i][tglCol]) && data[i][jmCol]) {
          return jsonResponse({ success: false, message: 'Sudah check-in hari ini' });
        }
      }
      const newId   = generateAbsensiId(sheet);
      const lastRow = getLastDataRow(sheet);
      const newRow  = new Array(headers.length).fill('');
      newRow[idCol]  = newId;
      newRow[usrCol] = username;
      newRow[tglCol] = tanggal;
      newRow[stCol]  = 'Hadir';
      if (gpsMasukCol >= 0)     newRow[gpsMasukCol]     = gps;
      if (gpsLinkMasukCol >= 0) newRow[gpsLinkMasukCol] = gpsLink;
      if (fmCol >= 0)  newRow[fmCol]  = foto;
      if (ketCol >= 0) newRow[ketCol] = keterangan;
      if (shiftIdCol >= 0) newRow[shiftIdCol] = shiftId; // [3.7]
      if (istirahatLogCol >= 0) newRow[istirahatLogCol] = '[]'; // [2.4] inisialisasi log istirahat kosong
      sheet.getRange(lastRow+1, 1, 1, headers.length).setValues([newRow]);
      setTextCell(sheet, lastRow+1, jmCol+1, jam);
      return jsonResponse({ success: true, message: 'Check In berhasil', id: newId });
    }

    if (tipe === 'checkout') {
      for (let i = 1; i < data.length; i++) {
        if (sameUser(data[i][usrCol]) && sameDate(data[i][tglCol]) && data[i][jmCol]) {
          // [2.7] Auto-tutup sesi istirahat yang masih terbuka
          if (istirahatLogCol >= 0) {
            let logArr = [];
            try { logArr = JSON.parse(String(data[i][istirahatLogCol] || '[]')); } catch(e) { logArr = []; }
            let changed = false;
            logArr = logArr.map(sesi => {
              if (sesi.mulai && !sesi.selesai) {
                changed = true;
                // Auto-tutup dengan 1j 1m = 61 menit
                const [hh, mm] = sesi.mulai.split(':').map(Number);
                const selesaiMenit = (hh * 60 + mm + 61) % (24 * 60);
                const sh = String(Math.floor(selesaiMenit / 60)).padStart(2, '0');
                const sm = String(selesaiMenit % 60).padStart(2, '0');
                return { ...sesi, selesai: `${sh}:${sm}`, durasi_menit: 61, auto: true };
              }
              return sesi;
            });
            if (changed) {
              sheet.getRange(i + 1, istirahatLogCol + 1).setValue(JSON.stringify(logArr));
            }
          }
          const dur = hitungDurasi(data[i][jmCol], jam);
          setTextCell(sheet, i+1, jkCol+1, jam);
          sheet.getRange(i+1, durCol+1).setValue(dur);
          if (foto && fkCol >= 0) sheet.getRange(i+1, fkCol+1).setValue(foto);
          if (gpsKeluarCol >= 0)     sheet.getRange(i+1, gpsKeluarCol+1).setValue(gps);
          if (gpsLinkKeluarCol >= 0) sheet.getRange(i+1, gpsLinkKeluarCol+1).setValue(gpsLink);
          return jsonResponse({ success: true, message: 'Check Out berhasil', durasi: dur });
        }
      }
      return jsonResponse({ success: false, message: 'Check In tidak ditemukan' });
    }

    return jsonResponse({ success: false, message: 'Tipe tidak dikenal' });

  } catch (err) {
    return jsonResponse({ success: false, message: 'handleAbsensi error: ' + err.toString() });
  }
}

// ── EDIT ABSENSI OLEH ADMIN/OWNER ─────────────────────────────────────────────
function updateAbsensiAdmin(params) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_ABSENSI);
    if (!sheet) return jsonResponse({ success: false, message: 'Sheet "absensi" tidak ditemukan' });

    ensureAbsensiColumns(sheet);

    const id = (params.id || '').trim();
    if (!id) return jsonResponse({ success: false, message: 'ID absensi tidak ditemukan' });

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol   = headers.indexOf('id');
    const stCol   = headers.indexOf('status');
    const jmCol   = headers.indexOf('jam_masuk');
    const jkCol   = headers.indexOf('jam_keluar');
    const durCol  = headers.indexOf('durasi');
    const ketCol  = headers.indexOf('keterangan');

    if (idCol < 0) return jsonResponse({ success: false, message: 'Kolom "id" tidak ditemukan' });

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]).trim() === id) {
        const row = i + 1;

        const status     = params.status     !== undefined ? params.status     : data[i][stCol];
        const jamMasuk    = params.jamMasuk   !== undefined ? params.jamMasuk   : toHHMM(data[i][jmCol]);
        const jamKeluar   = params.jamKeluar  !== undefined ? params.jamKeluar  : toHHMM(data[i][jkCol]);
        const keterangan  = params.keterangan !== undefined ? params.keterangan : data[i][ketCol];

        if (stCol >= 0)  sheet.getRange(row, stCol+1).setValue(status);
        if (jmCol >= 0)  setTextCell(sheet, row, jmCol+1, jamMasuk);
        if (jkCol >= 0)  setTextCell(sheet, row, jkCol+1, jamKeluar);
        if (ketCol >= 0) sheet.getRange(row, ketCol+1).setValue(keterangan);

        const durasi = hitungDurasi(jamMasuk, jamKeluar);
        if (durCol >= 0) sheet.getRange(row, durCol+1).setValue(durasi);

        return jsonResponse({ success: true, message: 'Data absensi diperbarui', durasi });
      }
    }
    return jsonResponse({ success: false, message: 'Data absensi tidak ditemukan' });

  } catch (err) {
    return jsonResponse({ success: false, message: 'updateAbsensiAdmin error: ' + err.toString() });
  }
}

function uploadAbsensiFoto(params) {
  try {
    const fileData = params.fileData || '';
    const fileName = params.fileName || 'foto_' + Date.now();
    const mimeType = params.mimeType || 'image/jpeg';
    const username = params.username || '';

    if (!fileData) return jsonResponse({ success: false, message: 'File kosong' });

    const decoded = Utilities.base64Decode(fileData);
    const blob    = Utilities.newBlob(decoded, mimeType, fileName);
    const root    = DriveApp.getFolderById(FOLDER_ID);

    function getOrCreateFolder(parent, name) {
      const iter = parent.getFoldersByName(name);
      return iter.hasNext() ? iter.next() : parent.createFolder(name);
    }
    const dokFolder  = getOrCreateFolder(root, 'dokumen');
    const absFolder  = getOrCreateFolder(dokFolder, 'absensi');
    const userFolder = getOrCreateFolder(absFolder, username);

    const file = userFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const fileUrl = 'https://drive.google.com/file/d/' + file.getId() + '/view';

    return jsonResponse({ success: true, fileUrl });

  } catch (err) {
    return jsonResponse({ success: false, message: 'uploadAbsensiFoto error: ' + err.toString() });
  }
}

// ── ISTIRAHAT (Bagian 2) ─────────────────────────────────────────────────────

// Helper: ambil row absensi hari ini untuk username+tanggal
function getAbsensiRow(sheet, username, tanggal) {
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const usrCol  = headers.indexOf('username');
  const tglCol  = headers.indexOf('tanggal');
  const jmCol   = headers.indexOf('jam_masuk');

  function sameDate(cellVal) {
    if (!cellVal) return false;
    let str;
    if (cellVal instanceof Date) {
      const y = cellVal.getFullYear();
      const m = String(cellVal.getMonth()+1).padStart(2,'0');
      const d = String(cellVal.getDate()).padStart(2,'0');
      str = `${y}-${m}-${d}`;
    } else {
      str = String(cellVal).slice(0, 10);
    }
    return str === tanggal;
  }

  for (let i = 1; i < data.length; i++) {
    const rowUser = String(data[i][usrCol] || '').trim().toLowerCase();
    if (rowUser === username && sameDate(data[i][tglCol]) && data[i][jmCol]) {
      return { rowIndex: i + 1, rowData: data[i], headers };
    }
  }
  return null;
}

// [2.5] Mulai sesi istirahat
function handleIstirahatMulai(params) {
  try {
    const ss       = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet    = ss.getSheetByName(SHEET_ABSENSI);
    if (!sheet) return jsonResponse({ success: false, message: 'Sheet absensi tidak ditemukan' });

    ensureAbsensiColumns(sheet);

    const username = (params.username || '').trim().toLowerCase();
    const tanggal  = (params.tanggal  || '').trim();
    const jam      = (params.jam      || '').trim(); // format HH:MM dari client

    if (!username || !tanggal || !jam)
      return jsonResponse({ success: false, message: 'username, tanggal, dan jam wajib diisi' });

    const found = getAbsensiRow(sheet, username, tanggal);
    if (!found) return jsonResponse({ success: false, message: 'Belum check-in hari ini' });

    const { rowIndex, rowData, headers } = found;
    const istirahatLogCol = headers.indexOf('istirahat_log');
    const jkCol           = headers.indexOf('jam_keluar');

    if (jkCol >= 0 && rowData[jkCol]) {
      return jsonResponse({ success: false, message: 'Sudah check-out, tidak bisa mulai istirahat' });
    }

    let logArr = [];
    if (istirahatLogCol >= 0) {
      try { logArr = JSON.parse(String(rowData[istirahatLogCol] || '[]')); } catch(e) { logArr = []; }
    }

    // Cek apakah ada sesi yang masih terbuka
    const sesiTerbuka = logArr.find(s => s.mulai && !s.selesai);
    if (sesiTerbuka) {
      return jsonResponse({ success: false, message: 'Ada sesi istirahat yang masih berjalan' });
    }

    logArr.push({ mulai: jam, selesai: null, durasi_menit: null, auto: false });
    if (istirahatLogCol >= 0) {
      sheet.getRange(rowIndex, istirahatLogCol + 1).setValue(JSON.stringify(logArr));
    }

    return jsonResponse({
      success: true,
      message: 'Istirahat dimulai',
      jam_mulai: jam,
      total_sesi: logArr.length
    });

  } catch(err) {
    return jsonResponse({ success: false, message: 'handleIstirahatMulai error: ' + err.toString() });
  }
}

// [2.6] Selesai sesi istirahat
function handleIstirahatSelesai(params) {
  try {
    const ss       = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet    = ss.getSheetByName(SHEET_ABSENSI);
    if (!sheet) return jsonResponse({ success: false, message: 'Sheet absensi tidak ditemukan' });

    ensureAbsensiColumns(sheet);

    const username = (params.username || '').trim().toLowerCase();
    const tanggal  = (params.tanggal  || '').trim();
    const jam      = (params.jam      || '').trim(); // HH:MM dari client

    if (!username || !tanggal || !jam)
      return jsonResponse({ success: false, message: 'username, tanggal, dan jam wajib diisi' });

    const found = getAbsensiRow(sheet, username, tanggal);
    if (!found) return jsonResponse({ success: false, message: 'Belum check-in hari ini' });

    const { rowIndex, rowData, headers } = found;
    const istirahatLogCol = headers.indexOf('istirahat_log');

    let logArr = [];
    if (istirahatLogCol >= 0) {
      try { logArr = JSON.parse(String(rowData[istirahatLogCol] || '[]')); } catch(e) { logArr = []; }
    }

    const idxTerbuka = logArr.findIndex(s => s.mulai && !s.selesai);
    if (idxTerbuka < 0) {
      return jsonResponse({ success: false, message: 'Tidak ada sesi istirahat yang sedang berjalan' });
    }

    const sesi = logArr[idxTerbuka];
    const [hM, mM] = sesi.mulai.split(':').map(Number);
    const [hS, mS] = jam.split(':').map(Number);
    const durasiMenit = Math.max(0, (hS * 60 + mS) - (hM * 60 + mM));

    logArr[idxTerbuka] = { ...sesi, selesai: jam, durasi_menit: durasiMenit, auto: false };

    if (istirahatLogCol >= 0) {
      sheet.getRange(rowIndex, istirahatLogCol + 1).setValue(JSON.stringify(logArr));
    }

    const totalMenit = logArr.filter(s => s.selesai).reduce((sum, s) => sum + (s.durasi_menit || 0), 0);
    const totalJam   = Math.floor(totalMenit / 60);
    const totalSisaMenit = totalMenit % 60;

    return jsonResponse({
      success: true,
      message: 'Istirahat selesai',
      durasi_sesi_menit: durasiMenit,
      total_istirahat: `${totalJam}j ${totalSisaMenit}m`,
      total_sesi: logArr.length,
      ada_auto: logArr.some(s => s.auto)
    });

  } catch(err) {
    return jsonResponse({ success: false, message: 'handleIstirahatSelesai error: ' + err.toString() });
  }
}

// ── SISTEM SHIFT (Bagian 3) ───────────────────────────────────────────────────

const SHEET_SHIFT  = 'shift';
const SHEET_JADWAL = 'jadwal_shift';

// [3.1] Buat sheet "shift" dengan header + 3 baris preset.
// Dijalankan MANUAL SEKALI dari editor Google Apps Script (bukan dari web).
// Aman dipanggil ulang: kalau sheet sudah ada & sudah berisi data, tidak menimpa apapun.
function setupShift() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_SHIFT);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SHIFT);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 7).setValues([[
      'id', 'nama', 'jam_masuk', 'jam_keluar', 'durasi_kerja', 'toleransi_telat', 'aktif'
    ]]);
    sheet.getRange(2, 1, 3, 7).setValues([
      ['SHF-001', 'Pagi',  '08:00', '16:00', 8, 15, true],
      ['SHF-002', 'Siang', '14:00', '22:00', 8, 15, true],
      ['SHF-003', 'Malam', '22:00', '06:00', 8, 15, true]
    ]);
    // Kolom jam disimpan sebagai teks agar tidak diubah jadi format Date oleh Sheets
    sheet.getRange(2, 3, 3, 2).setNumberFormat('@');
    Logger.log('Sheet "shift" dibuat dengan 3 preset (Pagi, Siang, Malam).');
  } else {
    Logger.log('Sheet "shift" sudah ada & sudah berisi data — tidak ada perubahan.');
  }
}

// [3.2] Buat sheet "jadwal_shift" dengan header, otomatis dipanggil saat pertama dipakai.
function ensureJadwalSheet() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_JADWAL);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_JADWAL);
    sheet.getRange(1, 1, 1, 4).setValues([[
      'tanggal', 'username', 'shift_id', 'ditetapkan_oleh'
    ]]);
  }
  return sheet;
}

// Helper: ambil semua baris shift sebagai array of object, beserta info kolom.
function readShiftSheet(sheet) {
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol   = headers.indexOf('id');
  const namaCol = headers.indexOf('nama');
  const jmCol   = headers.indexOf('jam_masuk');
  const jkCol   = headers.indexOf('jam_keluar');
  const durCol  = headers.indexOf('durasi_kerja');
  const tolCol  = headers.indexOf('toleransi_telat');
  const aktCol  = headers.indexOf('aktif');
  return { data, headers, idCol, namaCol, jmCol, jkCol, durCol, tolCol, aktCol };
}

function shiftRowToObj(row, cols) {
  return {
    id:              String(row[cols.idCol] || ''),
    nama:            String(row[cols.namaCol] || ''),
    jam_masuk:       toHHMM(row[cols.jmCol]) || String(row[cols.jmCol] || ''),
    jam_keluar:      toHHMM(row[cols.jkCol]) || String(row[cols.jkCol] || ''),
    durasi_kerja:    Number(row[cols.durCol]) || 0,
    toleransi_telat: Number(row[cols.tolCol]) || 0,
    aktif:           row[cols.aktCol] === true || String(row[cols.aktCol]).toUpperCase() === 'TRUE'
  };
}

// Generate id shift baru, format SHF-XXX
function generateShiftId(sheet) {
  const data = sheet.getDataRange().getValues();
  let maxNum = 0;
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][0] || '');
    if (id.startsWith('SHF-')) {
      const num = parseInt(id.replace('SHF-', '')) || 0;
      if (num > maxNum) maxNum = num;
    }
  }
  return 'SHF-' + String(maxNum + 1).padStart(3, '0');
}

// [3.3] Endpoint: balas semua shift AKTIF sebagai JSON. Bisa GET atau POST.
function handleGetShift(params) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_SHIFT);
    if (!sheet) return jsonResponse({ success: true, shifts: [] });

    const cols = readShiftSheet(sheet);
    if (cols.idCol < 0) return jsonResponse({ success: true, shifts: [] });

    // semua=1 → balas semua termasuk nonaktif (dipakai halaman Kelola Shift)
    const includeAll = String(params.semua || '') === '1';

    const shifts = [];
    for (let i = 1; i < cols.data.length; i++) {
      const row = cols.data[i];
      if (!row[cols.idCol]) continue;
      const obj = shiftRowToObj(row, cols);
      if (includeAll || obj.aktif) shifts.push(obj);
    }

    return jsonResponse({ success: true, shifts: shifts });

  } catch(err) {
    return jsonResponse({ success: false, message: 'handleGetShift error: ' + err.toString() });
  }
}

// [3.4] Endpoint: balas jadwal shift untuk username+tanggal tertentu.
// Balas { success:true, jadwal:null } kalau tidak ada jadwal untuk kombinasi itu.
function handleGetJadwal(params) {
  try {
    const username = (params.username || '').trim().toLowerCase();
    const tanggal  = (params.tanggal  || '').trim();

    if (!username || !tanggal)
      return jsonResponse({ success: false, message: 'username dan tanggal wajib diisi' });

    const sheet   = ensureJadwalSheet();
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const tglCol  = headers.indexOf('tanggal');
    const usrCol  = headers.indexOf('username');
    const shfCol  = headers.indexOf('shift_id');
    const olehCol = headers.indexOf('ditetapkan_oleh');

    function rowTanggal(val) {
      if (val instanceof Date) {
        const y = val.getFullYear();
        const m = String(val.getMonth()+1).padStart(2,'0');
        const d = String(val.getDate()).padStart(2,'0');
        return `${y}-${m}-${d}`;
      }
      return String(val || '').slice(0, 10);
    }

    for (let i = 1; i < data.length; i++) {
      const rowUser = String(data[i][usrCol] || '').trim().toLowerCase();
      if (rowUser !== username) continue;
      if (rowTanggal(data[i][tglCol]) !== tanggal) continue;

      return jsonResponse({
        success: true,
        jadwal: {
          tanggal:         tanggal,
          username:        username,
          shift_id:        String(data[i][shfCol] || ''),
          ditetapkan_oleh: String(data[i][olehCol] || '')
        }
      });
    }

    return jsonResponse({ success: true, jadwal: null });

  } catch(err) {
    return jsonResponse({ success: false, message: 'handleGetJadwal error: ' + err.toString() });
  }
}

// [3.5] Endpoint: admin/owner assign shift ke karyawan untuk tanggal tertentu (upsert).
// Mendukung bulk assign: params.usernames boleh berisi banyak username dipisah koma,
// untuk kebutuhan "assign semua karyawan shift X untuk besok" dari Frontend.
function handleSetJadwal(params) {
  try {
    const requesterRole = (params.requesterRole || '').toLowerCase();
    if (requesterRole !== 'admin' && requesterRole !== 'owner')
      return jsonResponse({ success: false, message: 'Akses ditolak: hanya admin/owner' });

    const tanggal       = (params.tanggal       || '').trim();
    const shiftId       = (params.shiftId       || '').trim();
    const ditetapkanOleh= (params.requesterUsername || params.ditetapkanOleh || '').trim().toLowerCase();

    // usernames: boleh satu (params.username) atau banyak dipisah koma (params.usernames)
    let usernameList = [];
    if (params.usernames) {
      usernameList = String(params.usernames).split(',').map(u => u.trim().toLowerCase()).filter(Boolean);
    } else if (params.username) {
      usernameList = [String(params.username).trim().toLowerCase()];
    }

    if (!tanggal || !shiftId || usernameList.length === 0)
      return jsonResponse({ success: false, message: 'tanggal, shiftId, dan username(s) wajib diisi' });

    const sheet   = ensureJadwalSheet();
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const tglCol  = headers.indexOf('tanggal');
    const usrCol  = headers.indexOf('username');
    const shfCol  = headers.indexOf('shift_id');
    const olehCol = headers.indexOf('ditetapkan_oleh');

    function rowTanggal(val) {
      if (val instanceof Date) {
        const y = val.getFullYear();
        const m = String(val.getMonth()+1).padStart(2,'0');
        const d = String(val.getDate()).padStart(2,'0');
        return `${y}-${m}-${d}`;
      }
      return String(val || '').slice(0, 10);
    }

    let updatedCount = 0;
    let insertedCount = 0;

    usernameList.forEach(username => {
      let found = false;
      // re-baca data terbaru tiap iterasi tidak perlu karena baris baru ditambah di akhir
      // dan kita scan dari data yang sudah diambil di atas + baris yang baru ditambah.
      for (let i = 1; i < data.length; i++) {
        const rowUser = String(data[i][usrCol] || '').trim().toLowerCase();
        if (rowUser === username && rowTanggal(data[i][tglCol]) === tanggal) {
          const row = i + 1;
          sheet.getRange(row, shfCol + 1).setValue(shiftId);
          sheet.getRange(row, olehCol + 1).setValue(ditetapkanOleh);
          updatedCount++;
          found = true;
          break;
        }
      }
      if (!found) {
        const lastRow = sheet.getLastRow();
        const newRow  = new Array(headers.length).fill('');
        newRow[tglCol]  = tanggal;
        newRow[usrCol]  = username;
        newRow[shfCol]  = shiftId;
        newRow[olehCol] = ditetapkanOleh;
        sheet.getRange(lastRow + 1, 1, 1, headers.length).setValues([newRow]);
        setTextCell(sheet, lastRow + 1, tglCol + 1, tanggal);
        // Catat juga di array `data` lokal supaya username yang sama tidak dobel-insert
        // dalam satu pemanggilan bulk (meski berbeda baris fisik karena sudah ditambah).
        data.push(newRow);
        insertedCount++;
      }
    });

    return jsonResponse({
      success: true,
      message: 'Jadwal berhasil disimpan',
      updated: updatedCount,
      inserted: insertedCount
    });

  } catch(err) {
    return jsonResponse({ success: false, message: 'handleSetJadwal error: ' + err.toString() });
  }
}

// [3.6] Endpoint: admin/owner tambah/edit/nonaktifkan shift master.
// params.mode: 'tambah' | 'edit' | 'nonaktifkan' | 'aktifkan'
function handleKelolaShift(params) {
  try {
    const requesterRole = (params.requesterRole || '').toLowerCase();
    if (requesterRole !== 'admin' && requesterRole !== 'owner')
      return jsonResponse({ success: false, message: 'Akses ditolak: hanya admin/owner' });

    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_SHIFT);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_SHIFT);
      sheet.getRange(1, 1, 1, 7).setValues([[
        'id', 'nama', 'jam_masuk', 'jam_keluar', 'durasi_kerja', 'toleransi_telat', 'aktif'
      ]]);
    }

    const mode = (params.mode || 'tambah').toLowerCase();

    if (mode === 'tambah') {
      const nama            = (params.nama            || '').trim();
      const jamMasuk         = (params.jamMasuk        || '').trim();
      const jamKeluar        = (params.jamKeluar       || '').trim();
      const durasiKerja      = Number(params.durasiKerja)      || 8;
      const toleransiTelat   = Number(params.toleransiTelat)   || 15;

      if (!nama || !jamMasuk || !jamKeluar)
        return jsonResponse({ success: false, message: 'nama, jamMasuk, dan jamKeluar wajib diisi' });

      const newId   = generateShiftId(sheet);
      const lastRow = getLastDataRow(sheet);
      sheet.getRange(lastRow + 1, 1, 1, 7).setValues([[
        newId, nama, jamMasuk, jamKeluar, durasiKerja, toleransiTelat, true
      ]]);
      sheet.getRange(lastRow + 1, 3, 1, 2).setNumberFormat('@');

      return jsonResponse({ success: true, message: 'Shift berhasil ditambahkan', id: newId });
    }

    // Mode edit/nonaktifkan/aktifkan semuanya butuh targetId
    const targetId = (params.targetId || params.id || '').trim();
    if (!targetId) return jsonResponse({ success: false, message: 'targetId wajib diisi' });

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol   = headers.indexOf('id');
    const namaCol = headers.indexOf('nama');
    const jmCol   = headers.indexOf('jam_masuk');
    const jkCol   = headers.indexOf('jam_keluar');
    const durCol  = headers.indexOf('durasi_kerja');
    const tolCol  = headers.indexOf('toleransi_telat');
    const aktCol  = headers.indexOf('aktif');

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]).trim() !== targetId) continue;
      const row = i + 1;

      if (mode === 'edit') {
        if (params.nama !== undefined)          sheet.getRange(row, namaCol + 1).setValue((params.nama || '').trim());
        if (params.jamMasuk !== undefined)       setTextCell(sheet, row, jmCol + 1, (params.jamMasuk || '').trim());
        if (params.jamKeluar !== undefined)      setTextCell(sheet, row, jkCol + 1, (params.jamKeluar || '').trim());
        if (params.durasiKerja !== undefined)    sheet.getRange(row, durCol + 1).setValue(Number(params.durasiKerja) || 0);
        if (params.toleransiTelat !== undefined) sheet.getRange(row, tolCol + 1).setValue(Number(params.toleransiTelat) || 0);
        return jsonResponse({ success: true, message: 'Shift berhasil diperbarui' });
      }

      if (mode === 'nonaktifkan') {
        sheet.getRange(row, aktCol + 1).setValue(false);
        return jsonResponse({ success: true, message: 'Shift dinonaktifkan' });
      }

      if (mode === 'aktifkan') {
        sheet.getRange(row, aktCol + 1).setValue(true);
        return jsonResponse({ success: true, message: 'Shift diaktifkan' });
      }

      return jsonResponse({ success: false, message: 'Mode tidak dikenal: ' + mode });
    }

    return jsonResponse({ success: false, message: 'Shift tidak ditemukan' });

  } catch(err) {
    return jsonResponse({ success: false, message: 'handleKelolaShift error: ' + err.toString() });
  }
}