require('dotenv').config();

module.exports = {
    TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID,
    SPREADSHEET_ID: process.env.SPREADSHEET_ID,
    GOOGLE_EMAIL: process.env.GOOGLE_CLIENT_EMAIL,
    GOOGLE_KEY: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    DEBUG: true
};