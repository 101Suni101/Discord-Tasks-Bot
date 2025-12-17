const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require("discord.js");
const DB = require("../models/spreadsheet");
const View = require("../views/components");
const Logger = require("./logger");

async function checkReminders(client) {
    const now = Date.now();
    const thresholds = [5, 10, 15];
    const { tasks, settings } = DB.state;

    for (const [taskId, task] of tasks) {
        for (const [idx, userId] of Object.entries(task.takenBy)) {
            const deadline = task.deadlines[idx];
            if (!deadline) continue;
            
            const diff = deadline - now;
            const minLeft = Math.floor(diff / 60000);
            if (!task.remindedLevels[idx]) task.remindedLevels[idx] = [];

            // 1. Reminder Logic
            if (minLeft > 0) {
                for (const t of thresholds) {
                    if (minLeft <= t && !task.remindedLevels[idx].includes(t)) {
                        if (settings.reminderChannel) {
                            const ch = client.channels.cache.get(settings.reminderChannel);
                            if (ch) ch.send(`⚠️ **REMINDER: ${t} Menit Lagi!**\nTarget: <@${userId}>\nBagian: **${task.labels[idx]}**\n[➡️ Ke Tugas](https://discord.com/channels/${process.env.GUILD_ID}/${task.channelId}/${task.id})`).catch(()=>{});
                        }
                        task.remindedLevels[idx].push(t);
                        await DB.saveTask(task, View.generateSummary(task));
                        break;
                    }
                }
            } 
            // 2. Overdue Logic
            else if (minLeft < 0 && !task.remindedLevels[idx].includes("OVERDUE")) {
                const resetBtn = new ButtonBuilder().setCustomId(`reset_${taskId}_${idx}`).setLabel(`📢 Reset Slot: ${task.labels[idx]}`).setStyle(ButtonStyle.Danger);
                Logger.log(client, "🚨 DEADLINE TERLEWAT", `**Tugas:** ${task.title}\n**User:** <@${userId}>\nKlik tombol di bawah untuk menendang user.`, "Red", [new ActionRowBuilder().addComponents(resetBtn)]);
                
                task.remindedLevels[idx].push("OVERDUE");
                await DB.saveTask(task, View.generateSummary(task));
            }
        }
    }
}

module.exports = { start: (client) => setInterval(() => checkReminders(client), 60000) };