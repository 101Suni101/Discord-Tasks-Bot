// src/models/spreadsheet.js
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const axios = require('axios');
const CONFIG = require('../../config/config');
const Backup = require('../../src/utils/backupHandler');

// --- SETUP AUTHENTICATION ---
const serviceAccountAuth = new JWT({
    email: CONFIG.GOOGLE_EMAIL,
    key: CONFIG.GOOGLE_KEY,
    scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.readonly'
    ],
});

const doc = new GoogleSpreadsheet(CONFIG.SPREADSHEET_ID, serviceAccountAuth);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// --- STATE MEMORY ---
const state = {
    tasks: new Map(),
    userStats: new Map(),
    monitors: [],
    settings: {},
    titles: [],
    questPrices: [],
    activeQuests: new Map(), // Cukup satu aja
    tempQuestCache: new Map(),
    roles: [],
    dirtyTaskIds: new Set(),
    dirtyUserIds: new Set(),
    dirtyQuestIds: new Set(),
    isSaving: false,
    isMaintenance: false
};
async function loadQuestPrices() {
    const sheet = doc.sheetsByTitle['HargaQuest'];
    if (!sheet) { console.log("⚠️ Sheet 'HargaQuest' tidak ditemukan."); return; }

    // Load seluruh baris
    const rows = await sheet.getRows();

    let lastRole = ""; // Variabel ingatan untuk merge cell

    state.questPrices = rows.map(row => {
        // Ambil nilai mentah dari kolom Role
        let currentRole = row.get('Role');

        // LOGIKA FILL DOWN:
        // Jika kolom Role ada isinya, simpan ke ingatan (lastRole).
        // Jika kosong (karena merge cell), pakai ingatan terakhir.
        if (currentRole && currentRole.trim() !== "") {
            lastRole = currentRole.trim().toLowerCase();
        }

        // Ambil data lainnya
        return {
            role: lastRole, // Pakai lastRole, bukan currentRole yang mungkin kosong
            type: row.get('Type') ? row.get('Type').toLowerCase().trim() : "unknown",
            price: parseInt(row.get('Price') || "0"),
            fee: parseInt(row.get('Fee') || "0")
        };
    }).filter(item => item.type !== "unknown"); // Buang baris kosong jika ada

    console.log(`💰 Quest Prices loaded: ${state.questPrices.length} items`);
}

async function loadActiveQuests() {
    const sheet = doc.sheetsByTitle['LogQuest'];
    if (!sheet) return;
    const rows = await sheet.getRows();

    rows.forEach((row) => {
        const status = row.get('Status');
        if (status !== 'DONE' && status !== 'CANCEL') {
            const qId = row.get('ID');
            const workerDataRaw = row.get('WorkerID'); // Isinya string aneh tadi

            const newQuest = {
                rowParams: row, // Simpan referensi baris biar bisa diedit nanti
                id: qId,
                creatorId: row.get('CreatorID'),
                title: row.get('Title'),
                slots: new Map(),
                chaptersRaw: [],
                deadline: "TBA" // Nanti ketimpa kalau ada update
            };

            // PARSING DATA SLOT DARI STRING EXCEL
            // Format: "1:UserID(STATUS) | 2:UserID(STATUS)"
            if (workerDataRaw && workerDataRaw !== '-' && workerDataRaw !== 'MULTIPLE') {
                const parts = workerDataRaw.split('|');
                parts.forEach(p => {
                    // Regex untuk ambil data: "1:12345(TAKEN)"
                    const match = p.match(/(\w+):(\d+)\((\w+)\)/);
                    if (match) {
                        const [_, ch, wId, stat] = match;
                        newQuest.slots.set(ch, { workerId: wId, status: stat });
                    }
                });
            }

            state.activeQuests.set(qId, newQuest);
        }
    });
    console.log(`📂 Active Quests loaded: ${state.activeQuests.size}`);
}

async function saveQuestSlots(questId) {
    const quest = state.activeQuests.get(questId);
    if (!quest) return;

    // 1. Convert Map Slot jadi String Rapi
    // Hasil: "1:998877(TAKEN) | 2:554433(DONE)"
    let slotStringParts = [];
    quest.slots.forEach((data, ch) => {
        if (data.workerId) {
            slotStringParts.push(`${ch}:${data.workerId}(${data.status})`);
        }
    });

    const finalString = slotStringParts.length > 0 ? slotStringParts.join(' | ') : 'MULTIPLE';

    if (quest.rowParams) {
        quest.rowParams.set('WorkerID', finalString);
        state.dirtyQuestIds.add(questId); // <--- Masukkan ke antrian
    }
    Backup.save(state);
}
// ... (parseChapterString & export lainnya) ...

module.exports = {
    // ... export lama ...
    saveQuestSlots, // <--- JANGAN LUPA DIEXPORT
    parseChapterString
};

function parseChapterString(input) {
    const result = [];
    if (!input) return result;
    const parts = input.split(',');

    parts.forEach(part => {
        const range = part.trim().split('-');
        if (range.length === 2) {
            const start = parseInt(range[0]);
            const end = parseInt(range[1]);
            if (!isNaN(start) && !isNaN(end)) {
                for (let i = start; i <= end; i++) result.push(i.toString());
            }
        } else {
            if (part.trim() !== "") result.push(part.trim());
        }
    });
    return result;
}

// [BARU] Fungsi Tambah Quest Baru ke Excel
async function addQuestLog(data) {
    const sheet = doc.sheetsByTitle['LogQuest'];
    if (!sheet) return;

    const newRow = await sheet.addRow({
        'ID': data.id,
        'Date': new Date().toLocaleDateString('id-ID'),
        'CreatorID': data.creatorId,
        'WorkerID': '-',
        'Title': data.title,
        'Total': data.totalCost,
        'Status': 'OPEN'
    }, { raw: true });

    // Simpan ke memory
    const memoryData = {
        rowParams: newRow,
        ...data,
        workerId: '-'
    };

    // [FIX] Pastikan slots tidak hilang/undefined saat disimpan ke RAM
    if (!memoryData.slots) memoryData.slots = new Map();

    state.activeQuests.set(data.id, memoryData);
}

// [BARU] Update Status Quest (Ambil, Selesai)
async function updateQuestStatus(questId, status, workerId = null) {
    const quest = state.activeQuests.get(questId);
    if (!quest) return;

    quest.status = status;
    quest.rowParams.set('Status', status);

    if (workerId) {
        quest.workerId = workerId;
        quest.rowParams.set('WorkerID', workerId);
    }

    state.dirtyQuestIds.add(questId);

    // Jika DONE, hapus dari memory aktif biar hemat RAM
    if (status === 'DONE') {
        state.activeQuests.delete(questId);
    }
}

// --- FUNGSI INIT (VERSI PERBAIKAN) ---
async function init() {
    try {
        console.log("🔄 Menghubungkan ke Google Sheets...");
        await doc.loadInfo();
        await loadQuestPrices();
        await loadActiveQuests();
        console.log(`✅ Terhubung: ${doc.title}`);


        state.dirtyTaskIds.clear();
        state.dirtyUserIds.clear();
        state.isSaving = false;

        // 1. Load Settings
        const sheetSettings = doc.sheetsByTitle['Settings'];
        if (sheetSettings) {
            const rowsSettings = await doc.sheetsByTitle['Settings'].getRows();
            rowsSettings.forEach(row => state.settings[row.get('Key')] = row.get('Value'));
        }
        // 2. Load User Stats (FIXED: Handling Nilai Kosong/NaN)
        const sheetPoints = doc.sheetsByTitle['Points'];
        if (!sheetPoints) await createSheet('Points', ['UserID', 'Username', 'Point', 'TotalTasks', 'LastActive', 'ImmunityUntil', 'OnLeave']);
        else await sheetPoints.loadHeaderRow();

        const rowsPoints = await sheetPoints.getRows();
        state.userStats.clear();
        rowsPoints.forEach(row => {
            const rawPoint = row.get('Point');
            const rawTasks = row.get('TotalTasks');

            state.userStats.set(row.get('UserID'), {
                username: row.get('Username') || '',
                point: rawPoint ? parseInt(rawPoint) : 0,         // Default 0
                totalTasks: rawTasks ? parseInt(rawTasks) : 0,    // Default 0
                lastActive: row.get('LastActive') ? parseInt(row.get('LastActive')) : 0,
                immunityUntil: row.get('ImmunityUntil') ? parseInt(row.get('ImmunityUntil')) : 0,
                onLeave: row.get('OnLeave') === 'TRUE'
            });
        });

        // 3. Load Tasks
        const sheetTasks = doc.sheetsByTitle['Tasks'];
        if (!sheetTasks) await createSheet('Tasks', ['TaskID', 'Title', 'Description', 'Deadline', 'Points', 'Buttons', 'Ringkasan', 'Data']);
        const rowsTasks = await sheetTasks.getRows();
        state.tasks.clear();
        rowsTasks.forEach(row => {
            try {
                const rawData = row.get('Data');
                if (rawData) state.tasks.set(JSON.parse(rawData).id, JSON.parse(rawData));
                const isDone = t.completed && t.labels && t.completed.length >= t.labels.length;
                        const isStopped = row.get('Status') && row.get('Status').includes('STOP');

                        if (!isDone && !isStopped) {
                            state.tasks.set(t.id, t); 
                        } else {
                        }
                    } catch (e) { }
        });

        // 4. Load Master Data
        let sheetJudul = doc.sheetsByTitle['Judul'];
        state.titles = [];

        if (!sheetJudul) {
            console.log("⚠️ Sheet 'Judul' tidak ditemukan, membuat baru...");
            // Kita buat header baru dengan 2 kolom poin
            await createSheet('Judul', ['ID', 'Nama', 'ETL', 'KTL', 'CTL', 'JTL', 'Editor', 'Tujuan-TS']);
        } else {
            await sheetJudul.loadHeaderRow();
            const rowsJudul = await sheetJudul.getRows();

            rowsJudul.forEach((row, index) => {
                const id = row.get('ID');
                const val = row.get('Nama');

                // Ambil 2 jenis poin. Jika kosong, default ke 1.
                const pTE = parseInt(row.get('ETL') || row.get('ETL') || "1");
                const pTK = parseInt(row.get('KTL') || row.get('KTL') || "1");
                const pTC = parseInt(row.get('CTL') || row.get('CTL') || "1");
                const pTJ = parseInt(row.get('JTL') || row.get('JTL') || "1");
                const pE = parseInt(row.get('Editor') || row.get('Editor') || "1");

                if (val) {
                    state.titles.push({
                        id: id || `AUTO-${index}`,
                        name: val.toString().trim(),
                        translatore: isNaN(pTE) ? 1 : pTE, // Harga Role Translator Eng
                        translatork: isNaN(pTK) ? 1 : pTK, // Harga Role Translator Kor
                        translatorc: isNaN(pTC) ? 1 : pTC, // Harga Role Translator CN
                        translatorj: isNaN(pTJ) ? 1 : pTJ, // Harga Role Translator JP
                        editor: isNaN(pE) ? 1 : pE,  // Harga Role Editor
                        tujuanTS: row.get('Tujuan-TS') ? row.get('Tujuan-TS').trim() : null
                    });
                }
            });
            console.log(`📊 Loaded ${state.titles.length} Titles (Dual Pricing).`);
        }
        const sheetRole = doc.sheetsByTitle['Role'];
        state.roles = [];
        if (sheetRole) {
            const rowsRole = await sheetRole.getRows();
            rowsRole.forEach(row => {
                const namaRole = row.get('Nama Role');
                const rawId = row.get('id role');
                if (namaRole && rawId) state.roles.push({ name: namaRole, id: rawId.replace(/[<@&>]/g, '') });
            });
        }

        // 5. LOAD DAFTAR MONITOR WEB
        const sheetMonitor = doc.sheetsByTitle['Monitor'];
        state.monitors = [];
        if (!sheetMonitor) {
            await createSheet('Monitor', ['Nama Website', 'URL']);
        } else {
            const rowsMonitor = await sheetMonitor.getRows();
            rowsMonitor.forEach(row => {
                const name = row.get('Nama Website');
                const url = row.get('URL');
                if (name && url) {
                    state.monitors.push({
                        name,
                        url,
                        lastStatus: 'UNKNOWN'
                    });
                }
            });
            console.log(`🌐 Memantau ${state.monitors.length} Website.`);
        }
        console.log("📂 Mengecek data cadangan lokal (Blackbox)...");
        const localData = Backup.load();

        if (localData) {

            if (localData.userStats) state.userStats = localData.userStats;
            if (localData.activeQuests) state.activeQuests = localData.activeQuests;

            if (localData.tasks) {
                localData.tasks.forEach((t, tid) => {
                    const isDone = t.completed && t.labels && t.completed.length >= t.labels.length;
                    if (!isDone) {
                        state.tasks.set(tid, t);
                    }
                });
            }

            console.log(`✅ **RESTORE SUKSES!** Menggunakan data lokal (${new Date(localData.timestamp).toLocaleTimeString()}).`);
            console.log(`📊 Stats: ${state.tasks.size} Tasks, ${state.userStats.size} Users dipulihkan.`);

            state.dirtyTaskIds = new Set(state.tasks.keys());
            state.dirtyUserIds = new Set(state.userStats.keys());
        } else {
            console.log("⚠️ Tidak ada data cadangan lokal, menggunakan murni data Excel.");
        }
        
        if (!global.autoSaveInterval) startAutoSave();
        console.log(`✅ Database Siap!`);
    } catch (e) {
        console.error("❌ Gagal Init Database:", e);
    }
}

function startAutoSave() {
    if (global.autoSaveInterval) clearInterval(global.autoSaveInterval);
    console.log("🚌 Batching System: ON (Update tiap 30 detik)");
    global.autoSaveInterval = setInterval(async () => { await saveAllToGoogle(); }, 30000);

    const saveAndExit = async () => {
        console.log("\n🛑 Bot dimatikan! Menyimpan data terakhir...");
        await saveAllToGoogle();
        process.exit(0);
    };
    if (process.listenerCount('SIGINT') === 0) {
        process.on('SIGINT', saveAndExit);
        process.on('SIGTERM', saveAndExit);
    }
}
async function getRecoverableTasks() {
    const sheet = doc.sheetsByTitle['Tasks'];
    if (!sheet) return [];
    
    const rows = await sheet.getRows();
    const results = [];
    
    // Cari tugas di Excel yang TIDAK ada di Memori Bot
    rows.forEach(row => {
        try {
            const rawData = row.get('Data');
            if (rawData) {
                const t = JSON.parse(rawData);
                
                // Jika task ini TIDAK ADA di RAM (state.tasks), berarti dia "Hilang"
                if (!state.tasks.has(t.id)) {
                    // Cek statusnya
                    const status = row.get('Status') || "UNKNOWN";
                    const isDone = t.completed.length >= t.labels.length;
                    
                    // Kita cuma mau recover yang BELUM SELESAI
                    // atau yang tidak sengaja ke-STOP
                    if (!isDone) {
                        results.push({
                            id: t.id,
                            title: t.title,
                            status: status,
                            labels: t.labels,
                            completed: t.completed,
                            rowNumber: row.rowNumber // Simpan nomor baris buat akses cepat
                        });
                    }
                }
            }
        } catch (e) {}
    });
    
    return results;
}

async function saveAllToGoogle(force = false) {
    // Cek apakah ada data kotor di Task, User, ATAU Quest
    if (state.isSaving && !force) return;
    if (!force && state.dirtyTaskIds.size === 0 && state.dirtyUserIds.size === 0 && state.dirtyQuestIds.size === 0) return;

    state.isSaving = true;
    try {
        console.log("📤 [AUTO-SAVE] Memulai sinkronisasi ke Google Sheets...");

        // ============================
        // A. SAVE TASKS
        // ============================
        if (state.dirtyTaskIds.size > 0) {
            const sheet = doc.sheetsByTitle['Tasks'];
            const rows = await sheet.getRows();
            const newRows = [];
            
            // Loop Manual (Jangan Promise.all untuk .save())
            for (const taskId of state.dirtyTaskIds) {
                const taskData = state.tasks.get(taskId);
                
                // Jika task dihapus dari memory
                if (!taskData) {
                    const rowToDelete = rows.find(r => r.get('TaskID') === taskId);
                    if (rowToDelete) await rowToDelete.delete();
                    continue;
                }

                const rowData = {
                    TaskID: taskData.id,
                    Title: taskData.title,
                    Description: taskData.originalDesc,
                    Deadline: taskData.duration,
                    Points: taskData.pointValue,
                    Buttons: taskData.labels.join(', '),
                    Ringkasan: `${taskData.title} | ${taskData.labels.length} Slot`,
                    Data: JSON.stringify(taskData)
                };

                const existingRow = rows.find(r => r.get('TaskID') === taskId);
                
                if (existingRow) { 
                    existingRow.assign(rowData); 
                    // SAVE SEQUENTIAL + RAW
                    await existingRow.save({ valueInputOption: 'RAW' });
                } else { 
                    newRows.push(rowData); 
                }
            }

            // Add rows bisa sekaligus (batch)
            if (newRows.length > 0) {
                await sheet.addRows(newRows, { raw: true });
                await sleep(1500);
            }
            state.dirtyTaskIds.clear();
        }

        // ============================
        // B. SAVE POINTS
        // ============================
        if (state.dirtyUserIds.size > 0) {
            const sheet = doc.sheetsByTitle['Points'];
            const rows = await sheet.getRows();
            const newRows = [];
            
            for (const userId of state.dirtyUserIds) {
                const stats = state.userStats.get(userId);
                if (!stats) continue;

                const rowData = {
                    UserID: userId,
                    Username: stats.username || '',
                    Point: stats.point,
                    TotalTasks: stats.totalTasks,
                    LastActive: stats.lastActive,
                    ImmunityUntil: stats.immunityUntil,
                    OnLeave: stats.onLeave ? 'TRUE' : 'FALSE'
                };

                const existingRow = rows.find(r => r.get('UserID') === userId);
                if (existingRow) { 
                    existingRow.assign(rowData); 
                    await existingRow.save({ valueInputOption: 'RAW' });
                } else { 
                    newRows.push(rowData); 
                }
            }

            if (newRows.length > 0) {
                await sheet.addRows(newRows, { raw: true });
                await sleep(1500);
            }
            state.dirtyUserIds.clear();
        }

        // ============================
        // C. SAVE QUESTS (BARU!)
        // ============================
        if (state.dirtyQuestIds.size > 0) {
            
            for (const qId of state.dirtyQuestIds) {
                const quest = state.activeQuests.get(qId);
                
                if (!quest) continue; 

                if (quest.rowParams) {
                    await quest.rowParams.save({ valueInputOption: 'RAW' });
                    await sleep(1500);
                }
            }
            state.dirtyQuestIds.clear();
        }

        console.log("✅ [AUTO-SAVE] Sinkronisasi Selesai.");
    } catch (e) {
        // Kalau kena limit 429, kita paksa pause lamaan dikit
        if (e.message.includes('429')) {
            console.error("⚠️ Masih kena limit, bot istirahat 10 detik...");
            await sleep(10000);
        } else {
            console.error("❌ Save Error:", e.message);
        }
    } finally {
        state.isSaving = false;
    }
}


async function getExcelFileBuffer() {
    try {
        console.log("📦 Mengambil file backup dari Google Drive...");
        const token = (await serviceAccountAuth.getAccessToken()).token;
        const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/export?format=xlsx`;
        const response = await axios.get(url, { headers: { Authorization: `Bearer ${token}` }, responseType: 'arraybuffer' });
        return Buffer.from(response.data);
    } catch (e) {
        console.error("Gagal download excel:", e);
        throw new Error("Gagal mengambil file dari Google.");
    }
}

async function createSheet(title, headerValues) { await doc.addSheet({ title, headerValues }); }
async function saveTask(taskData, summaryStr) { state.tasks.set(taskData.id, taskData); state.dirtyTaskIds.add(taskData.id); Backup.save(state); }
async function saveSetting(key, value) { state.settings[key] = value; const sheet = doc.sheetsByTitle['Settings']; const rows = await sheet.getRows(); const row = rows.find(r => r.get('Key') === key); if (row) { row.assign({ Value: value }); await row.save(); } else { await sheet.addRow({ Key: key, Value: value }); } }

async function addPoint(userId, amount, username = '') {
    let stats = state.userStats.get(userId) || { point: 0, totalTasks: 0, lastActive: Date.now(), immunityUntil: 0, onLeave: false };
    if (username) stats.username = username;
    stats.point += amount;
    stats.totalTasks += 1;
    stats.lastActive = Date.now();
    state.userStats.set(userId, stats);
    state.dirtyUserIds.add(userId);
    Backup.save(state);
}

async function updateActivity(userId, username = '') {
    let stats = state.userStats.get(userId) || { point: 0, totalTasks: 0, lastActive: Date.now(), immunityUntil: 0, onLeave: false };
    if (username) stats.username = username;
    stats.lastActive = Date.now();
    state.userStats.set(userId, stats);
    state.dirtyUserIds.add(userId);
}


async function updateUserStatus(userId, updates) { let stats = state.userStats.get(userId) || { point: 0, totalTasks: 0, lastActive: Date.now(), immunityUntil: 0, onLeave: false }; stats = { ...stats, ...updates }; state.userStats.set(userId, stats); state.dirtyUserIds.add(userId); Backup.save(state); }
async function resetPoints() {
    const sheet = doc.sheetsByTitle['Points'];
    if (!sheet) throw new Error("Sheet 'Points' tidak ditemukan.");

    // 1. Ambil semua baris data user yang ada
    const rows = await sheet.getRows();

    console.log(`⏳ Sedang mereset poin untuk ${rows.length} staff...`);

    // 2. Loop satu per satu baris
    for (const row of rows) {
        // Ubah nilainya jadi 0 di Excel
        row.set('Point', '0');
        row.set('Total Task', '0');

        // Simpan perubahan per baris
        await row.save();
    }

    // 3. Reset Memori Bot (RAM)
    // Ini wajib biar bot langsung sadar kalau poinnya 0 tanpa perlu restart
    state.userStats.forEach((stats, userId) => {
        stats.point = 0;
        stats.totalTasks = 0;
        // Kita simpan balik ke map
        state.userStats.set(userId, stats);
    });

    console.log("✅ Sukses Reset Poin & Total Task (User tetap aman).");
}
async function clearAllTasks() { state.tasks.clear(); state.dirtyTaskIds.clear(); const sheet = doc.sheetsByTitle['Tasks']; if (sheet) await sheet.clearRows(); }
async function forceStopAllTasks() {
    Backup.save(state);
    if (state.tasks.size === 0) return 0;

    // Ganti 'this.doc' jadi 'doc'
    const sheet = doc.sheetsByTitle['Tasks'];
    if (!sheet) throw new Error("Sheet 'Tasks' tidak ditemukan.");

    const rows = await sheet.getRows();
    let count = 0;

    for (const row of rows) {
        const taskId = row.get('ID');

        // Ganti 'this.state.tasks' jadi 'state.tasks'
        if (state.tasks.has(taskId)) {
            // UPDATE STATUS
            if (row.get('Status')) row.set('Status', '⛔ FORCE STOPPED');

            const oldTitle = row.get('Judul') || row.get('Nama') || row.get('Title');
            if (oldTitle && !oldTitle.includes('[STOP]')) {
                row.set('Title', `[⛔ STOP] ${oldTitle}`);
            }

            await row.save();
            count++;
        }
    }

    // Ganti 'this.state' jadi 'state'
    state.tasks.clear();
    state.dirtyTaskIds.clear();

    console.log(`💀 Force Stopped ${count} tasks.`);
    return count;
}

async function executeRecovery(taskId) {
    const sheet = doc.sheetsByTitle['Tasks'];
    const rows = await sheet.getRows();
    
    // Cari baris berdasarkan ID
    const targetRow = rows.find(r => r.get('TaskID') === taskId);
    
    if (!targetRow) return null; // Gak ketemu di Excel
    
    try {
        const rawData = targetRow.get('Data');
        const task = JSON.parse(rawData);
        
        // 1. Bersihkan tanda [⛔ STOP] dari judul (kalau ada)
        task.title = task.title.replace('[⛔ STOP] ', '').trim();
        targetRow.set('Title', task.title);
        targetRow.set('Status', 'ACTIVE'); // Reset status Excel
        
        // 2. Masukkan kembali ke RAM
        state.tasks.set(task.id, task);
        state.dirtyTaskIds.add(task.id); // Tandai biar kesave ulang nanti
        
        // 3. Simpan perubahan baris Excel (Hapus label STOP)
        await targetRow.save();
        
        return task;
    } catch (e) {
        console.error("Recovery Fail:", e);
        return null;
    }
}
async function refreshLite() {
    console.log("🔄  Memulai Refresh Judul...");

    // 1. Sync Info Dokumen
    await doc.loadInfo();

    // 2. REFRESH JUDUL (Titles)
    const sheetJudul = doc.sheetsByTitle['Judul'];
    if (sheetJudul) {
        state.titles = []; // Kosongkan data lama
        const rowsJudul = await sheetJudul.getRows();

        rowsJudul.forEach((row, index) => {
            const id = row.get('ID');
            const val = row.get('Nama');

            // Ambil harga (Sama persis kayak logika Init)
            const pTE = parseInt(row.get('ETL') || "1");
            const pTK = parseInt(row.get('KTL') || "1");
            const pTC = parseInt(row.get('CTL') || "1");
            const pTJ = parseInt(row.get('JTL') || "1");
            const pE = parseInt(row.get('Editor') || "1");

            if (val) {
                state.titles.push({
                    id: id || `AUTO-${index}`,
                    name: val.toString().trim(),
                    translatore: isNaN(pTE) ? 1 : pTE,
                    translatork: isNaN(pTK) ? 1 : pTK,
                    translatorc: isNaN(pTC) ? 1 : pTC,
                    translatorj: isNaN(pTJ) ? 1 : pTJ,
                    editor: isNaN(pE) ? 1 : pE,
                    tujuanTS: row.get('Tujuan-TS') ? row.get('Tujuan-TS').trim() : null
                });
            }
        });
        console.log(`📊 [LITE] Judul Diupdate: ${state.titles.length} Data.`);
    }

    console.log("✅ [LITE] Refresh Selesai.");
    return { titles: state.titles.length };
}

// --- PENTING: EXPORTS JANGAN SAMPAI HILANG ---
module.exports = {
    state, init,
    saveAllToGoogle, getExcelFileBuffer, forceStopAllTasks, refreshLite, getRecoverableTasks,
    executeRecovery, saveTask, saveSetting, addPoint, updateActivity, updateUserStatus, resetPoints, clearAllTasks, loadQuestPrices,
    addQuestLog, updateQuestStatus, parseChapterString, saveQuestSlots
};