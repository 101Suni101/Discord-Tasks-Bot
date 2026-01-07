require('dotenv').config();

// Logic untuk mengubah Base64 kembali menjadi teks kunci asli
let finalKey;
if (process.env.GOOGLE_BASE64_KEY) {
    // Cara Baru (Anti Error)
    finalKey = Buffer.from(process.env.GOOGLE_BASE64_KEY, 'base64').toString('utf-8');
} else {
    // Cara Lama (Backup)
    finalKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
}

module.exports = {
    TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID,
    SPREADSHEET_ID: process.env.SPREADSHEET_ID,
    GOOGLE_EMAIL: process.env.GOOGLE_CLIENT_EMAIL,
    
    // Gunakan kunci yang sudah diproses di atas
    GOOGLE_KEY: finalKey,
    
    SUWAYOMI_URL: process.env.SUWAYOMI_URL,

    DEBUG: true
};