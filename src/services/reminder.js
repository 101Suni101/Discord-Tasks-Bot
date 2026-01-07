// src/services/reminder.js
const { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const DB = require("../models/spreadsheet");
const View = require("../views/components"); 

// KONFIGURASI ROLE (Harus sama dengan interaction.js)
const ROLE_WARNING = "1418608292443459724"; 
const ROLE_PUNISH = "1407583290939936838";  
const ROLE_ACTIVE = "1228143820458426368";  

async function start(client) {
    console.log("⏰ Sistem Reminder & Inactivity Watchdog Aktif");
    
    // INTERVAL CHECK (1 MENIT)
    setInterval(async () => {
        const now = Date.now();
        const guildId = process.env.GUILD_ID;
        const guild = client.guilds.cache.get(guildId);

        // --- A. CEK TUGAS DEADLINE ---
        const thresholds = [5, 10, 15]; 
        for (const [taskId, task] of DB.state.tasks) {
            for (const [idxStr, userId] of Object.entries(task.takenBy || {})) {
                
                // [BARU] LOGIKA FREEZE: Jika status Pending Review, JANGAN TAGIH/HUKUM
                // User sudah lapor, bola ada di tangan Admin.
                if (task.pendingReview && task.pendingReview[idxStr]) {
                    continue; // Skip slot ini, lanjut ke yang lain
                }

                const userDeadline = task.deadlines ? task.deadlines[idxStr] : null;
                if (!userDeadline) continue;
                
                const timeDiff = userDeadline - now;
                const minutesLeft = Math.floor(timeDiff / 60000);
                
                if (!task.remindedLevels) task.remindedLevels = {};
                if (!task.remindedLevels[idxStr]) task.remindedLevels[idxStr] = [];

                if (minutesLeft < 0 && !task.remindedLevels[idxStr].includes("OVERDUE")) {
                    const reportChId = DB.state.settings['REPORT_CHANNEL_ID'] || DB.state.settings['LOG_CHANNEL_ID'];
                    if (reportChId) {
                        const channel = client.channels.cache.get(reportChId);
                        if (channel) {
                            const alertEmbed = new EmbedBuilder().setTitle("🚨 OVERDUE").setColor(0xFF0000).setDescription(`User <@${userId}> terlambat mengerjakan **${task.title}**.`);
                            const resetBtn = new ButtonBuilder().setCustomId(`reset_${taskId}_${idxStr}`).setLabel(`📢 Reset Slot`).setStyle(ButtonStyle.Danger);
                            await channel.send({ content: "<@&1228143820445847611>", embeds: [alertEmbed], components: [new ActionRowBuilder().addComponents(resetBtn)] }).catch(()=>{});
                        }
                    }
                    task.remindedLevels[idxStr].push("OVERDUE");
                    try { const mainMsg = await client.channels.cache.get(task.channelId).messages.fetch(taskId); await mainMsg.edit({ embeds: [View.createTaskEmbed(task)], components: View.createButtons(task) }); } catch(e) {}
                    await DB.saveTask(task, View.generateSummary(task));
                }
                else if (minutesLeft > 0) {
                    for (const t of thresholds) {
                        if (minutesLeft <= t && !task.remindedLevels[idxStr].includes(t)) {
                            const remChannelId = DB.state.settings['REMINDER_CHANNEL_ID'];
                            if (remChannelId) {
                                const remChannel = client.channels.cache.get(remChannelId);
                                if (remChannel) await remChannel.send(`⚠️ **${t} Menit Lagi!** <@${userId}> selesaikan: ${task.title}`).catch(()=>{});
                            }
                            thresholds.forEach(th => { if (th >= t && !task.remindedLevels[idxStr].includes(th)) task.remindedLevels[idxStr].push(th); });
                            await DB.saveTask(task, View.generateSummary(task)); break; 
                        }
                    }
                }
            }
        }

        // --- B. CEK INACTIVITY USER (WATCHDOG) ---
        if (guild) {
            for (const [userId, stats] of DB.state.userStats) {
                if (stats.immunityUntil && now < stats.immunityUntil) continue;

                let member;
                try { member = await guild.members.fetch(userId); } catch (e) { continue; } 
                if (!member) continue;

                if (member.permissions.has(PermissionFlagsBits.Administrator)) continue;

                if (stats.onLeave) {
                    if (!member.roles.cache.has(ROLE_WARNING)) await member.roles.add(ROLE_WARNING).catch(()=>{});
                    if (member.roles.cache.has(ROLE_ACTIVE)) await member.roles.remove(ROLE_ACTIVE).catch(()=>{});
                    continue; 
                }

                const lastActive = stats.lastActive || 0;
                const daysInactive = Math.floor((now - lastActive) / (1000 * 60 * 60 * 24));

                // > 10 Hari
                if (daysInactive >= 10) {
                    if (member.roles.cache.has(ROLE_WARNING)) await member.roles.remove(ROLE_WARNING).catch(()=>{});
                    if (!member.roles.cache.has(ROLE_PUNISH)) await member.roles.add(ROLE_PUNISH).catch(()=>{});
                    if (member.roles.cache.has(ROLE_ACTIVE)) await member.roles.remove(ROLE_ACTIVE).catch(()=>{});
                }
                // > 5 Hari
                else if (daysInactive >= 5) {
                    if (!member.roles.cache.has(ROLE_WARNING) && !member.roles.cache.has(ROLE_PUNISH)) await member.roles.add(ROLE_WARNING).catch(()=>{});
                    if (member.roles.cache.has(ROLE_ACTIVE)) await member.roles.remove(ROLE_ACTIVE).catch(()=>{});
                }
            }
        }

    }, 60000); 
}

module.exports = { start };