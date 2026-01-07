// src/utils/backupHandler.js
const fs = require('fs');
const path = require('path');

// Pastikan folder 'data' ada. Kalau tidak, buat baru.
const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const BACKUP_FILE = path.join(DATA_DIR, 'blackbox.json');

// Helper: Convert Map ke Array (supaya bisa di-JSON-kan)
function mapToObj(map) {
    return JSON.stringify(Array.from(map.entries()));
}

// Helper: Convert Array balik ke Map
function objToMap(jsonStr) {
    return new Map(JSON.parse(jsonStr));
}

module.exports = {
    // 1. Simpan Data RAM ke File (Instant)
    save: (state) => {
        try {
            const backupData = {
                timestamp: Date.now(),
                tasks: mapToObj(state.tasks),
                userStats: mapToObj(state.userStats),
                activeQuests: mapToObj(state.activeQuests || new Map()) // Backup Quest juga
            };

            // Tulis ke file secara Synchronous (Block) biar aman 100% sebelum crash
            fs.writeFileSync(BACKUP_FILE, JSON.stringify(backupData, null, 2));
        } catch (err) {
            console.error("⚠️ Gagal menulis Blackbox:", err.message);
        }
    },

    // 2. Load Data File ke RAM (Saat Booting)
    load: () => {
        try {
            if (!fs.existsSync(BACKUP_FILE)) return null;

            const rawData = fs.readFileSync(BACKUP_FILE, 'utf-8');
            const data = JSON.parse(rawData);

            return {
                timestamp: data.timestamp,
                tasks: objToMap(data.tasks),
                userStats: objToMap(data.userStats),
                activeQuests: data.activeQuests ? objToMap(data.activeQuests) : new Map()
            };
        } catch (err) {
            console.error("⚠️ Gagal load Blackbox (File Corrupt/Baru):", err.message);
            return null;
        }
    }
};