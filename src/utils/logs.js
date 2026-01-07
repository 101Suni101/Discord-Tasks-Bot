// src/utils/logs.js
const { EmbedBuilder } = require("discord.js");
const DB = require("../models/spreadsheet");

const COLORS = { "Red": 0xFF0000, "Green": 0x00FF00, "Blue": 0x0099FF, "Yellow": 0xFFD700, "Orange": 0xFFA500, "White": 0xFFFFFF };

async function sendLog(client, title, description, colorName = "Blue") {
    try {
        const logChannelId = DB.state.settings['LOG_CHANNEL_ID'];
        if (!logChannelId) return;
        const channel = client.channels.cache.get(logChannelId);
        if (!channel) return;
        const hexColor = COLORS[colorName] || COLORS["Blue"];
        const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(hexColor).setTimestamp();
        await channel.send({ embeds: [embed] });
    } catch (e) { console.error(`⚠️ Gagal kirim log: ${e.message}`); }
}
module.exports = { sendLog };