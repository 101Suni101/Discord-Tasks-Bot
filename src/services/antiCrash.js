// src/services/antiCrash.js
const Logger = require("../utils/logs");

module.exports = (client) => {
    // 1. Menangkap Error pada Promise (Misal: Database timeout, Error API Discord)
    process.on('unhandledRejection', async (reason, promise) => {
        console.error("⚠️ [Anti-Crash] Unhandled Rejection:", reason);
        
        // Kirim Laporan ke Channel Log
        await Logger.sendLog(
            client, 
            "⚠️ ERROR: Unhandled Rejection", 
            `**Alasan:** \`\`\`${reason}\`\`\`\nBot **TIDAK** mati. Data aman.`, 
            "Red"
        );
    });

    // 2. Menangkap Error pada Kodingan (Misal: typo variable, null pointer)
    process.on('uncaughtException', async (err, origin) => {
        console.error("🔥 [Anti-Crash] Uncaught Exception:", err);

        // Kirim Laporan ke Channel Log
        await Logger.sendLog(
            client, 
            "🔥 ERROR: Uncaught Exception", 
            `**Error:** \`\`\`${err.message}\`\`\`\n**Origin:** ${origin}\nBot **TIDAK** mati. Data aman.`, 
            "Red"
        );
    });
    
    // 3. Menangkap Error Spesifik Discord (Biasanya koneksi)
    process.on('uncaughtExceptionMonitor', (err, origin) => {
        console.log("🛡️ [Anti-Crash] Blocking crash...");
    });
};