const { EmbedBuilder } = require("discord.js");
const DB = require("../models/spreadsheet");

async function log(client, title, desc, color = "Blue", components = []) {
    const channelId = DB.state.settings.logChannel;
    if (!channelId) return;
    try {
        const ch = client.channels.cache.get(channelId);
        if (ch) await ch.send({ 
            embeds: [new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color).setTimestamp()],
            components 
        });
    } catch (e) { console.error("Log Error:", e); }
}
module.exports = { log };