// src/views/components.js
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

function createTaskEmbed(task) {
    const embed = new EmbedBuilder()
        .setTitle(task.title)
        .setDescription(task.originalDesc)
        .setColor(0x00AE86)
        .addFields(
            { name: '💰 Poin', value: `${task.pointValue}`, inline: true },
            { name: '⏳ Durasi', value: task.originalDuration || `${task.duration} Menit`, inline: true },
        )
        .setFooter({ text: `Task ID: ${task.id}` });

    let statusText = "";
    let isOverdue = false;

    task.labels.forEach((label, idx) => {
        const userId = task.takenBy[idx];
        const doneUser = task.finishedBy[idx];
        const deadline = task.deadlines ? task.deadlines[idx] : null;

        // 1. Jika Selesai
        if (doneUser) {
            statusText += `✅ **${label}**: Selesai oleh <@${doneUser}>\n`;
        }
        // 2. Jika Sedang Diambil
        else if (userId) {
            // --- [UPDATE: STATUS VISUAL] ---
            if (deadline === 0) {
                statusText += `❄️ **${label}**: <@${userId}> **(Menunggu TL)**\n`;
            }
            // B. Data Error / Korup (Safety Check)
            else if (!deadline || isNaN(deadline)) {
                statusText += `⚠️ **${label}**: <@${userId}> (Error Waktu)\n`;
            }
            // C. Tampilan NORMAL (Timer Jalan)
            else {
                const now = Date.now();
                const timestamp = Math.floor(deadline / 1000);
                
                if (Date.now() > deadline) {
                    // Jika waktu sekarang sudah lewat deadline
                    statusText += `🔴 **${label}**: <@${userId}> **OVERDUE** (<t:${timestamp}:R>)\n`;
                    isOverdue = true;
                } else {
                    // Jika masih ada waktu (Countdown otomatis)
                    statusText += `⏳ **${label}**: <@${userId}> (<t:${timestamp}:R>)\n`;
                }
            }
        } else {
            statusText += `⬜ **${label}**: Kosong\n`;
        }
    });

        if (statusText) embed.addFields({ name: "📋 Status Slot", value: statusText });
        if (isOverdue) embed.setColor(0xFF0000);

        return embed;
    }

function createButtons(task) {
            const rows = [];
            let currentRow = new ActionRowBuilder();

            task.labels.forEach((label, idx) => {
                const isTaken = !!task.takenBy[idx];
                const isDone = !!task.finishedBy[idx];

                let btn;

                // A. JIKA SUDAH SELESAI (Hijau Mati)
                if (isDone) {
                    btn = new ButtonBuilder()
                        .setCustomId(`done_view_${idx}`) // Dummy ID
                        .setLabel(`✅ Selesai`)
                        .setStyle(ButtonStyle.Success)
                        .setDisabled(true);
                }
                // B. JIKA SEDANG DIAMBIL (Merah - Batalkan) [UPDATE BARU]
                else if (isTaken) {
                    btn = new ButtonBuilder()
                        .setCustomId(`cancel_self_${idx}`) // Tombol Batal Mandiri
                        .setLabel(`❌ Batalkan`)
                        .setStyle(ButtonStyle.Danger); // Merah biar user sadar
                }
                // C. JIKA KOSONG (Biru - Ambil)
                else {
                    btn = new ButtonBuilder()
                        .setCustomId(`take_${idx}`)
                        .setLabel(`${label}`)
                        .setStyle(ButtonStyle.Primary);
                }

                currentRow.addComponents(btn);
                if (currentRow.components.length >= 5) {
                    rows.push(currentRow);
                    currentRow = new ActionRowBuilder();
                }
            });

            if (currentRow.components.length > 0) rows.push(currentRow);

            // Tombol Admin (Delete)
            const adminRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`delete_${task.id}`).setLabel("🗑️ Hapus Task").setStyle(ButtonStyle.Secondary)
            );
            rows.push(adminRow);

            return rows;
        }

function generateSummary(task) {
            return `${task.title} | ${task.labels.length} Slot | Poin: ${task.pointValue}`;
        }

module.exports = { createTaskEmbed, createButtons, generateSummary };