// src/controllers/interaction.js
const {
    PermissionFlagsBits,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    AttachmentBuilder
} = require("discord.js");
const DB = require("../models/spreadsheet");
const View = require("../views/components");
const CanvasGen = require("../services/canvasGen");
const Logger = require("../utils/logs");
const { createProgressBar } = require("../utils/progressBar");
const Suwayomi = require("../services/suwayomi");
const parseDurationLib = require('parse-duration');
const parse = parseDurationLib.default || parseDurationLib;
const { parseChapterString } = require("../models/spreadsheet");
const taskCreationCache = new Map();

// --- KONFIGURASI ROLE ---
const ROLE_WARNING = "1418608292443459724";
const ROLE_ACTIVE = "1228143820458426368";
const ROLE_ETL = "1407582349331533915";
const ROLE_KTL = "1407609381964480543";
const ROLE_CTL = "1407609488374239302";
const ROLE_JTL = "1455035711345528948";
const ROLE_EDITOR = "1407582653800120362";
const TL_ROLES = [
    "1407582349331533915", // ETL
    "1407609381964480543", // KTL
    "1407609488374239302", // CTL
    "1455035711345528948"  // JTL
];
const ROLE_VIP_NO_FILE = "1407581479625556052";

async function handleCommand(i, client) {
    const { commandName, user, member, channelId } = i;
    const RESTRICTED_CHANNELS = {
        'lapor': '1455768783892385853',  // Khusus Lapor
        'cuti': '1406115267641348126',   // Khusus Absen/Cuti
        'active': '1406115267641348126'  // Khusus Absen/Cuti
    };

    if (RESTRICTED_CHANNELS[commandName]) {
        // Jika channel saat ini BUKAN channel yang seharusnya
        if (channelId !== RESTRICTED_CHANNELS[commandName]) {
            return i.reply({
                content: `🚫 **Salah Channel!**\nCommand \`/${commandName}\` hanya boleh digunakan di channel <#${RESTRICTED_CHANNELS[commandName]}>.`,
                flags: MessageFlags.Ephemeral // Pesan rahasia (cuma user yg liat)
            });
        }
    }

    else if (commandName === 'maintenance') {
        // 1. Cek Admin
        if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return i.reply({ content: "❌ Khusus Admin!", flags: MessageFlags.Ephemeral });
        }

        const status = i.options.getString('status');

        if (status === 'on') {
            try {

                // Aktifkan Saklar
                DB.state.isMaintenance = true;

                // Force Save Data (Penting!)
                await DB.saveAllToGoogle(true);

                await i.editReply(`🔐 **MAINTENANCE MODE: ON**\n\n✅ Semua interaksi tombol dimatikan.\n✅ Data berhasil diamankan ke Google Sheets.\n\n🛑 **AMAN UNTUK RESTART SEKARANG.**`);

                // (Opsional) Ubah status bot jadi DND
                if (client.user) client.user.setPresence({ status: 'dnd', activities: [{ name: 'Maintenance Mode 🚧' }] });

            } catch (error) {
                console.error("Maintenance Error:", error);
                // Kalau save gagal, bot TETAP harus lapor, jangan diam saja.
                await i.editReply(`⚠️ **Maintenance ON, tapi SAVE GAGAL!**\n\nError: \`${error.message}\`\nBot sudah dalam mode maintenance, tapi data mungkin belum tersimpan sempurna di Excel.`);
            }
        }else {
                // Matikan Saklar
                DB.state.isMaintenance = false;

                await i.reply(`🔓 **MAINTENANCE MODE: OFF**\nSistem kembali normal.`);

                // (Opsional) Kembalikan status bot
                if (client.user) client.user.setPresence({ status: 'online', activities: [] });
            }
        }

        // COMMAND LAPOR
        if (commandName === 'lapor') {
            await i.deferReply({ flags: MessageFlags.Ephemeral });

            const subcommand = i.options.getSubcommand();
            const bukti = i.options.getString('chapter') || i.options.getString('bukti') || "-";
            const lampiran = i.options.getAttachment('file') || i.options.getAttachment('lampiran');
            const isVip = member.roles.cache.has(ROLE_VIP_NO_FILE);
            const hasFile = !!lampiran;

            // Validasi File
            if (!hasFile && !isVip) {
                return i.editReply("❌ **File Wajib Diupload!**\nKamu wajib melampirkan file (ZIP).\n*(Kecuali Role TL)*");
            }

            // --- FUNGSI HELPER: CREATE STYLISH EMBED ---
            const createStylishEmbed = (title, type, taskName, point, user, desc, isSpecial) => {
                const embed = new EmbedBuilder()
                    .setColor(isSpecial ? 0x9B59B6 : (type === 'Lelang' ? 0xFFA500 : 0x00AE86)) // Ungu (VIP), Orange (Lelang), Hijau (Tetap)   
                    .setAuthor({ name: "SOULSCANS REPORT SYSTEM", iconURL: client.user.displayAvatarURL() })
                    .setTitle(title)
                    .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 128 })) // Foto User di pojok kanan
                    .setDescription(null)
                    .addFields(
                        { name: "👤 **Staff Pelapor**", value: `<@${user.id}>`, inline: true },
                        { name: "🏷️ **Jenis Tugas**", value: `\`${type}\``, inline: true },
                        { name: "💎 **Potensi Poin**", value: `**+${point}** Poin`, inline: true },

                        { name: "📚 **Judul Garapan**", value: `**${taskName} Chapter ${(desc || "-").substring(0, 100)}${(desc || "").length > 100 ? '...' : ''}**`, inline: false },

                        { name: "📅 **Waktu Lapor**", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                    )
                    .setFooter({ text: `User ID: ${user.id} • Soulscans Bot`, iconURL: user.displayAvatarURL() });

                return embed;
            };

            // --- SUBCOMMAND: LELANG ---
            if (subcommand === 'lelang') {
                const taskValue = i.options.getString('lelang');
                const [taskId, idx] = taskValue.split('###');
                const task = DB.state.tasks.get(taskId);

                if (!task) return i.editReply("❌ Tugas tidak ditemukan.");
                if (!task.takenBy || task.takenBy[idx] !== user.id) return i.editReply("❌ Bukan slot kamu.");
                if (task.pendingReview && task.pendingReview[idx]) return i.editReply("⏳ Sedang direview.");

                // [LOGIKA BARU] SENTRALISASI KE CHANNEL REPORT
                const reportChannelId = DB.state.settings['REPORT_CHANNEL_ID'] || DB.state.settings['LOG_CHANNEL_ID'];
                if (!reportChannelId) return i.editReply("❌ Channel Report belum disetting.");

                const titleData = DB.state.titles.find(t => t.name.toLowerCase() === task.title.toLowerCase());

                const isEditor = member.roles.cache.has(ROLE_EDITOR);
                let isRouting = false;

                // Logika Routing
                if (isEditor && hasFile && titleData && titleData.tujuanTS) {
                    isRouting = true;
                }

                const channel = client.channels.cache.get(reportChannelId);
                if (!channel) return i.editReply(`❌ Gagal lapor. Channel Admin (Report) tidak ditemukan.`);

                task.pendingReview = task.pendingReview || {};
                if (!task.pendingReview) task.pendingReview = {};
                task.pendingReview[idx] = true;
                await DB.saveTask(task, View.generateSummary(task));
                // GENERATE STYLISH EMBED
                const embedTitle = isRouting ? "✨ QC EDITOR (Menunggu Forward)" : "📩 LAPORAN TUGAS LELANG";
                const realChapter = task.labels[idx];
                const reportEmbed = createStylishEmbed(embedTitle, "Lelang", task.title, task.pointValue, user, realChapter, isRouting);

                if (hasFile) {
                    reportEmbed.addFields({ name: "📂 File", value: `[👉 ${lampiran.name}](${lampiran.url})`, inline: false });
                    if (lampiran.contentType?.startsWith('image/')) reportEmbed.setImage(lampiran.url);
                }

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`acc_sys_${taskId}_${idx}_${user.id}`).setLabel("✅ ACC & Forward").setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`rej_sys_${taskId}_${idx}_${user.id}`).setLabel("❌ Revisi").setStyle(ButtonStyle.Danger)
                );

                await channel.send({ content: "🔔 **Review Required! <@&1228143820445847611>**", embeds: [reportEmbed], components: [row] });
                await i.editReply(`✅ **Laporan Terkirim ke Admin!**\nMohon tunggu verifikasi sebelum file diteruskan ke TS.`);
            }

            // --- SUBCOMMAND: TETAP ---
            else if (subcommand === 'tetap') {
                const judulTetap = i.options.getString('judul');
                let displayTitle = judulTetap;
                let defaultPoint = 0;

                const reportChannelId = DB.state.settings['REPORT_CHANNEL_ID'] || DB.state.settings['LOG_CHANNEL_ID'];
                if (!reportChannelId) return i.editReply("❌ Channel Report belum disetting.");

                const titleData = judulTetap ? DB.state.titles.find(t => t.name.toLowerCase() === judulTetap.toLowerCase()) : null;
                let isRouting = false;
                let destTS = '0'; // Default 0 kalau gak ada tujuan

                if (titleData) {
                    displayTitle = titleData.name;
                    if (member.roles.cache.has(ROLE_EDITOR) && hasFile) {
                        defaultPoint = titleData.editor;
                        if (titleData.tujuanTS) {
                            destTS = titleData.tujuanTS;
                            isRouting = true;
                        }
                    } else {
                        // --- [LOGIKA BARU: SMART ROLE DETECTION] ---
                        // Kita kumpulkan semua kemungkinan harga berdasarkan Role user
                        let potentialPoints = [];

                        // 1. Kumpulkan semua kemungkinan harga dari role yang dia punya
                        if (member.roles.cache.has(ROLE_ETL)) potentialPoints.push(titleData.translatore || 0);
                        if (member.roles.cache.has(ROLE_KTL)) potentialPoints.push(titleData.translatork || 0);
                        if (member.roles.cache.has(ROLE_CTL)) potentialPoints.push(titleData.translatorc || 0);
                        if (member.roles.cache.has(ROLE_JTL)) potentialPoints.push(titleData.translatorj || 0);

                        // 2. Cari angka paling besar di antara role yang dia punya
                        if (potentialPoints.length > 0) {
                            defaultPoint = Math.max(...potentialPoints);
                        } else {
                            defaultPoint = titleData.translatore || 1;
                        }
                    }
                }
                const channel = client.channels.cache.get(reportChannelId);

                if (!channel) return i.editReply(`❌ **Error Config:** Channel Report (ID: ${reportChannelId}) tidak ditemukan atau bot tidak punya akses.`);

                const embedTitle = isRouting ? "✨ QC EDITOR (Menunggu Forward)" : "📩 LAPORAN TUGAS TETAP";
                const cleanChapter = bukti.replace(/^(chapter|ch|chap|c)\.?\s*/i, "");
                const reportEmbed = createStylishEmbed(embedTitle, "Tetap", displayTitle, defaultPoint || 0, user, bukti, isRouting);

                if (hasFile) {
                    reportEmbed.addFields({ name: "📂 File", value: `[👉 ${lampiran.name}](${lampiran.url})`, inline: false });
                    if (lampiran.contentType?.startsWith('image/')) reportEmbed.setImage(lampiran.url);
                }
                // [PENTING] Kita selipkan ID Channel Tujuan ke dalam ID Tombol (biar nanti Modal tau mau forward kemana)
                // Format Baru: acc_man_USERID_POINT_DESTTS
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`acc_man_${user.id}_${defaultPoint}_${destTS}`).setLabel(`✅ ACC (Poin: ${defaultPoint})`).setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`reject_report_${user.id}`).setLabel("❌ Tolak").setStyle(ButtonStyle.Danger)
                );

                await channel.send({ content: "🔔 **Review Required! <@&1228143820445847611>**", embeds: [reportEmbed], components: [row] });
                await i.editReply(`✅ **Laporan Terkirim ke Admin!**`);
            }
            else if (subcommand === 'quest') {

                const rawInput = i.options.getString('id_quest');
                const lampiranQuest = i.options.getAttachment('file');

                // 1. Validasi Input Autocomplete
                if (!rawInput || !rawInput.includes('###')) {
                    return i.editReply("❌ **Data Tidak Valid!**\nMohon pilih Quest dari daftar **Autocomplete** yang muncul saat mengetik ID.\nJangan copy-paste ID manual sembarangan.");
                }

                const [questId, chapter] = rawInput.split('###');

                // 2. Validasi File
                if (!lampiranQuest) return i.editReply("❌ **Wajib Upload File!**\nLampirkan hasil pengerjaan (Rar/Zip).");

                // 3. Cek Data di Database
                const questData = DB.state.activeQuests.get(questId);
                if (!questData) return i.editReply("❌ **Quest Tidak Ditemukan!**\nMungkin quest sudah selesai atau dibatalkan admin.");

                // 4. Cek Slot Chapter
                // (Self-healing: kalau slots undefined, anggap kosong)
                const slots = questData.slots || new Map();
                const slotData = slots.get(chapter);

                if (!slotData) return i.editReply(`❌ Data chapter **${chapter}** tidak valid.`);
                if (slotData.workerId !== user.id) return i.editReply(`❌ Kamu tidak mengambil slot **Chapter ${chapter}** di quest ini.`);
                if (slotData.status === 'DONE') return i.editReply("❌ Chapter ini sudah selesai (Approved).");
                if (slotData.status === 'PENDING_QC') return i.editReply("⏳ **Laporan Sedang Diproses!**\nKamu sudah mengirim laporan untuk chapter ini. Tunggu Admin selesai mengecek (QC) sebelum melapor lagi.");
                // 5. Kirim ke Channel Admin
                const adminChId = DB.state.settings['REPORT_CHANNEL_ID'];
                if (!adminChId) return i.editReply("❌ **Admin Channel Error:** Belum disetting di `/config`.");

                const adminCh = client.channels.cache.get(adminChId);
                if (!adminCh) return i.editReply("❌ Bot tidak bisa mengakses Channel Admin.");

                // Buat Embed Laporan
                const qcEmbed = new EmbedBuilder()
                    .setTitle(`📦 QC CHECK: ${questData.title.substring(0, 50)}`)
                    .setColor(0xFFFF00) // Kuning
                    .setDescription(`**Worker:** <@${user.id}>\n**Quest ID:** \`${questId}\`\n**Chapter:** \`${chapter}\``)
                    .addFields(
                        { name: "📂 File Hasil", value: `[👉 Klik untuk Download](${lampiranQuest.url})` },
                        { name: "Time", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                    )
                    .setFooter({ text: "Admin: Cek file, lalu Approve jika sesuai." });

                // Jika lampiran gambar, tampilkan preview
                if (lampiranQuest.contentType && lampiranQuest.contentType.startsWith('image/')) {
                    qcEmbed.setImage(lampiranQuest.url);
                }

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`btn_q_approve_ch###${questId}###${chapter}`).setLabel("✅ Approve & Send").setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`btn_q_reject_ch###${questId}###${chapter}`).setLabel("❌ Revisi").setStyle(ButtonStyle.Danger)
                );

                await adminCh.send({ content: `🔔 **Laporan Quest Masuk!** <@&${DB.state.settings['ADMIN_ROLE_ID'] || ""}>`, embeds: [qcEmbed], components: [row] });

                // Update Status Lokal jadi PENDING
                slotData.status = 'PENDING_QC';
                // (Opsional: Simpan status pending ke Excel jika mau, tapi di Memory sudah cukup)

                await i.editReply(`✅ **Laporan Chapter ${chapter} Terkirim!**\nSilakan tunggu QC dari Admin.`);
            }

        }


        // ==========================================
        // 2. COMMAND Quest 
        // ==========================================
        else if (commandName === 'quest') {
            // Input Options dari User
            const roleTarget = i.options.getString('role');
            const originType = i.options.getString('origin');

            // Tampilkan Modal untuk detail
            const modal = new ModalBuilder()
                .setCustomId(`modalQuestCreate###${roleTarget}###${originType}`)
                .setTitle("Buat Quest Berbayar");

            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q_title').setLabel("Judul Quest").setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q_desc').setLabel("Deskripsi & Link Raw").setStyle(TextInputStyle.Paragraph).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q_chapters').setLabel("List Chapter (Contoh: 1, 2, 3)").setStyle(TextInputStyle.Short).setPlaceholder("Pisahkan dengan koma").setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q_bonus').setLabel("Bonus Tambahan (Opsional)").setStyle(TextInputStyle.Short).setPlaceholder("Contoh: 5000 (Isi angka saja)").setRequired(false))
            );

            await i.showModal(modal);
        }

        // ==========================================
        // 2. COMMAND HELP (UPDATED: FLAGS)
        // ==========================================
        else if (commandName === 'help') {
            const isAdmin = i.member.permissions.has(PermissionFlagsBits.Administrator);
            const helpEmbed = new EmbedBuilder()
                .setColor(isAdmin ? 0xFFD700 : 0x00AE86)
                .setThumbnail(client.user.displayAvatarURL())
                .setTitle(isAdmin ? "🛡️ PANDUAN ADMIN & STAFF" : "📘 PANDUAN STAFF")
                .setTimestamp();

            const workflowText =
                "1️⃣ **Ambil Tugas** → Klik tombol biru di papan tugas (Lelang).\n" +
                "2️⃣ **Kerjakan** → Selesaikan sesuai instruksi.\n" +
                "3️⃣ **Lapor** → Gunakan `/lapor` (Pilih Lelang/Tetap).\n" +
                "4️⃣ **Review** → Tunggu Admin ACC laporanmu.\n" +
                "5️⃣ **Cuti** → Ketik `/cuti` di channel jika ingin libur.";

            helpEmbed.addFields({ name: "🔄 Alur Kerja", value: workflowText });

            let commandList = "**📌 Command Staff:**\n`/lapor` : Lapor tugas.\n`/cancel` : Batal tugas.\n`/cuti` : Izin cuti.\n`/active` : Kembali kerja.\n`/stats` : Cek poin.\n";
            if (isAdmin) {
                commandList += "\n**🛡️ Command Admin:**\n`/task` : Buat tugas.\n`/stop` : Hapus tugas.\n`/list` : Daftar tugas lelang yang masih aktif.\n`/config` : Setup channel.\n`/leaderboard` : Top 10.\n /save` : Force save & export.\n `/reset` : Reset poin.\n`/refresh` : Reload DB.";
            }
            helpEmbed.setDescription(commandList);
            await i.reply({ embeds: [helpEmbed], flags: MessageFlags.Ephemeral });
        }

        else if (commandName === 'active') {
            await i.deferReply({ flags: MessageFlags.Ephemeral });

            // 1. Ambil data statistik user dari database
            const stats = DB.state.userStats.get(user.id);

            if (!stats || !stats.onLeave) {
                return i.editReply("🚫 **Akses Ditolak!**\nKamu terdeteksi **SUDAH AKTIF**.\n\nCommand `/active` hanya digunakan untuk kembali bekerja setelah mengambil **Cuti**.");
            }
            await DB.updateUserStatus(user.id, { immunityUntil: Date.now() + 86400000, onLeave: false, username: user.username });

            let roleInfo = "";
            try {
                // Tambah Role Active
                if (!member.roles.cache.has(ROLE_ACTIVE)) await member.roles.add(ROLE_ACTIVE);
                // Cabut Role Warning (jika ada)
                if (member.roles.cache.has(ROLE_WARNING)) await member.roles.remove(ROLE_WARNING);
            } catch (e) {
                roleInfo = "\n*(Ada kendala update role Discord, tapi status database sudah Aktif)*";
            }

            await Logger.sendLog(client, "🟢 Staff Kembali Aktif", `User: <@${user.id}>\nStatus: **ACTIVE** (Cuti Dicabut)`, "Green");

            await i.editReply(`✅ **Selamat Datang Kembali!**\nStatus Cuti berhasil dicabut. Selamat bekerja!${roleInfo}`);
        }

        else if (commandName === 'cuti') {
            const modal = new ModalBuilder()
                .setCustomId('modalCuti')
                .setTitle("Formulir Izin Cuti");

            const reasonInput = new TextInputBuilder()
                .setCustomId('reason')
                .setLabel("Alasan Cuti")
                .setStyle(TextInputStyle.Paragraph) // Kotak teks besar
                .setPlaceholder("Contoh: Sakit / Ujian / Urusan Keluarga / Healing")
                .setRequired(true); // Wajib diisi

            const row = new ActionRowBuilder().addComponents(reasonInput);
            modal.addComponents(row);

            await i.showModal(modal);

            let releasedTasks = [];
            for (const [taskId, task] of DB.state.tasks) {
                const slotEntry = Object.entries(task.takenBy).find(([idx, userId]) => userId === user.id);
                if (slotEntry) {
                    const [idxStr, _] = slotEntry;
                    delete task.takenBy[idxStr]; delete task.deadlines[idxStr]; delete task.remindedLevels[idxStr];
                    if (task.pendingReview) delete task.pendingReview[idxStr];
                    await DB.saveTask(task, View.generateSummary(task));
                    try { const msg = await client.channels.cache.get(task.channelId).messages.fetch(taskId); if (msg) await msg.edit({ embeds: [View.createTaskEmbed(task)], components: View.createButtons(task) }); } catch (e) { }
                    if (TL_ROLES.includes(task.roleId)) {
                        const finishedChapter = task.labels[idx];
                        await checkAndUnfreezeEditor(client, task.title, finishedChapter, i.channel);
                    }

                    await i.message.edit({ content: `✅ **DISETUJUI**`, embeds: [new EmbedBuilder(i.message.embeds[0].data).setColor(0x00FF00).setFooter({ text: `Total: ${totalPoin} (Base: ${task.pointValue} + Bonus: ${bonus})` })], components: [] });
                    releasedTasks.push(task.title);
                }
            }
            await DB.updateUserStatus(user.id, { onLeave: true, immunityUntil: 0, username: user.username });
            try { if (member.roles.cache.has(ROLE_ACTIVE)) await member.roles.remove(ROLE_ACTIVE); if (!member.roles.cache.has(ROLE_WARNING)) await member.roles.add(ROLE_WARNING); } catch (e) { }
            await Logger.sendLog(client, "🏖️ Staff Cuti", `User: <@${user.id}>\nReleased: ${releasedTasks.join(', ')}`, "Orange");
            await i.editReply(`✅ **Izin Cuti Diterima.**\nReleased: ${releasedTasks.length} tugas.`);
        }

        else if (commandName === 'config') {
            if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) return i.reply({ content: "❌ Khusus Admin!", flags: MessageFlags.Ephemeral });
            const settingKey = i.options.getString('tipe'); const targetChannel = i.options.getChannel('channel');
            await DB.saveSetting(settingKey, targetChannel.id);
            await i.reply(`✅ Pengaturan **${settingKey}** berhasil diubah ke channel ${targetChannel}`);
        }

        else if (commandName === 'refresh') {
            // Cek Admin
            if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) return i.reply({ content: "❌ Khusus Admin!", flags: MessageFlags.Ephemeral });

            await i.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                // PANGGIL FUNGSI LITE (Ringan)
                const result = await DB.refreshLite();

                // Respon Cepat
                await i.editReply(`✅ **REFRESH BERHASIL!** (Mode Ringan)\n\n📊 **Judul:** ${result.titles} Data dimuat ulang.\n💎 **Poin:** Data user diperbarui dari Excel.\n\n*(Task & Settings tidak diutak-atik agar bot tetap stabil)*.`);

            } catch (err) {
                console.error(err);
                await i.editReply(`❌ Gagal Refresh: ${err.message}`);
            }
        }
        else if (commandName === 'save') {
            if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) return i.reply({ content: "❌ Khusus Admin!", flags: MessageFlags.Ephemeral });
            await i.deferReply({ flags: MessageFlags.Ephemeral }); await DB.saveAllToGoogle(true);
            const fileBuffer = await DB.getExcelFileBuffer(); const { AttachmentBuilder } = require('discord.js');
            const file = new AttachmentBuilder(fileBuffer, { name: `Backup.xlsx` }); await i.editReply({ content: "✅ **Saved!**", files: [file] });
        }

        else if (commandName === 'task') {
            if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) return i.reply({ content: "❌ Khusus Admin!", flags: MessageFlags.Ephemeral });

            const rawTitle = i.options.getString('title');
            const titleInput = rawTitle ? rawTitle.trim() : "Judul Manual";
            const roleId = i.options.getString('role');
            const tipeTugas = i.options.getString('tipe'); // 'normal', 'fast'

            // --- KONFIGURASI HARGA ---
            // Cari data judul di memory
            const titleData = DB.state.titles.find(t => t.name.toLowerCase() === titleInput.toLowerCase());

            let finalPoint = 0;

            if (titleData) {
                // 1. Tentukan Base Poin berdasarkan Role
                if (roleId === ROLE_ETL) {
                    finalPoint = titleData.translatore; // Pakai poin Translator Eng
                } else if (roleId === ROLE_KTL) {
                    finalPoint = titleData.translatork; // Pakai poin Translator Kor
                } else if (roleId === ROLE_CTL) {
                    finalPoint = titleData.translatorc; // Pakai poin TSranslator CN
                } else if (roleId === ROLE_JTL) {
                    finalPoint = titleData.translatorj; // Pakai poin Translator JP
                } else {
                    finalPoint = titleData.editor; // Pakai poin Editor
                }

                // 2. Tambah Bonus berdasarkan Tipe
                if (tipeTugas === 'fast') finalPoint += 3;       // Bonus Cepat/Balapan
            } else {
                finalPoint = 1; // Default jika judul manual
            }

            // 1. Generate ID Unik (Pakai ID interaksi aja biar unik)
            const cacheId = i.id;

            // 2. Simpan Judul Panjang & Role ke Memory Bot
            taskCreationCache.set(cacheId, {
                title: titleInput,
                roleId: roleId
            });

            // 3. Buat Modal dengan ID Pendek
            // Format: modalTask###CACHE_ID
            const modal = new ModalBuilder()
                .setCustomId(`modalTask###${cacheId}`)
                .setTitle("Detail Tugas");

            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel("Deskripsi").setStyle(TextInputStyle.Paragraph).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('time').setLabel("Waktu (7d 4h 4m 2s)").setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('point').setLabel("Poin Reward").setStyle(TextInputStyle.Short).setValue(finalPoint.toString())),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('buttons').setLabel("List Tombol").setStyle(TextInputStyle.Short).setRequired(false))
            );

            await i.showModal(modal);
        }

        else if (commandName === 'stop') {
            if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) return i.reply({ content: "❌ Khusus Admin!", flags: MessageFlags.Ephemeral });
            const subcommand = i.options.getSubcommand();
            if (subcommand === 'select') {
                await i.deferReply({ flags: MessageFlags.Ephemeral });
                if (DB.state.tasks.size === 0) return i.editReply({ content: "📂 Tidak ada tugas aktif." });
                const menu = new StringSelectMenuBuilder().setCustomId('menu_stop').setPlaceholder('Pilih tugas untuk dihapus...');
                let count = 0; DB.state.tasks.forEach((task, id) => { if (task.completed.length < task.labels.length && count < 25) { menu.addOptions(new StringSelectMenuOptionBuilder().setLabel(task.title.substring(0, 50)).setDescription(`ID: ${id.slice(-4)}`).setValue(id).setEmoji("🗑️")); count++; } });
                if (count === 0) return i.editReply({ content: "✅ Semua tugas sudah selesai." });
                await i.editReply({ content: "⚠️ **Pilih tugas yang ingin dihapus:**", components: [new ActionRowBuilder().addComponents(menu)] });
            } else if (subcommand === 'all') {
                await i.deferReply({ flags: MessageFlags.Ephemeral });

                // 1. CEK DATA
                if (DB.state.tasks.size === 0) {
                    return i.editReply("📂 Tidak ada tugas yang sedang aktif.");
                }

                try {
                    let deletedCount = 0;

                    // 2. HAPUS PESAN DISCORD (Looping Manual)
                    // Kita copy dulu keys-nya biar aman saat looping
                    const taskIds = Array.from(DB.state.tasks.keys());

                    for (const taskId of taskIds) {
                        const task = DB.state.tasks.get(taskId);
                        if (task && task.channelId) {
                            try {
                                // Coba ambil channel & pesan lalu hapus
                                const ch = client.channels.cache.get(task.channelId);
                                if (ch) {
                                    const msg = await ch.messages.fetch(taskId).catch(() => null);
                                    if (msg) await msg.delete();
                                }
                            } catch (err) {
                                console.log(`Gagal hapus pesan ${taskId}: ${err.message}`);
                            }
                        }
                    }

                    // 3. UPDATE EXCEL (SOFT DELETE)
                    // Panggil fungsi baru yang kita buat di spreadsheet.js
                    const excelCount = await DB.forceStopAllTasks();

                    // 4. LOG & LAPORAN
                    await Logger.sendLog(client, "⛔ FORCE STOP ALL", `Admin <@${user.id}> menghentikan paksa **${excelCount} tugas**.\n- Pesan Discord dihapus.\n- Excel ditandai [STOP].`, "Red");

                    await i.editReply(`✅ **BERHASIL DIHENTIKAN!**\n\n🗑️ **Discord:** Pesan tugas telah dihapus.\n📝 **Excel:** ${excelCount} data ditandai sebagai \`[⛔ STOP]\`.\n(Data tidak hilang, hanya statusnya dibatalkan).`);

                } catch (err) {
                    console.error(err);
                    await i.editReply(`❌ Terjadi error saat proses stop: ${err.message}`);
                }
            }
        }
        else if (commandName === 'assign') {
            // 1. Cek Admin
            if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return i.reply({ content: "❌ Khusus Admin!", flags: MessageFlags.Ephemeral });
            }

            const rawInput = i.options.getString('id_quest'); // Pakai autocomplete yang sama
            const targetUser = i.options.getUser('user');
            const customDuration = i.options.getString('waktu'); // Opsional (misal: 2h)

            // 2. Validasi Input
            if (!rawInput || !rawInput.includes('###')) {
                return i.reply({ content: "❌ **Tugas Tidak Valid!**\nPilih tugas dari daftar Autocomplete (ketik judul/ID).", flags: MessageFlags.Ephemeral });
            }

            const [taskId, idx] = rawInput.split('###');
            const task = DB.state.tasks.get(taskId);

            if (!task) return i.reply({ content: "❌ Data tugas tidak ditemukan.", flags: MessageFlags.Ephemeral });

            // 3. Cek Slot
            if (task.completed.includes(idx)) {
                return i.reply({ content: "❌ Slot ini sudah SELESAI (Done). Tidak bisa di-assign ulang.", flags: MessageFlags.Ephemeral });
            }

            // 4. Hitung Deadline
            // Kalau admin kasih waktu khusus, pakai itu. Kalau tidak, pakai durasi default tugas.
            let deadlineTimestamp = 0;
            if (customDuration) {
                const parsedTime = parse(customDuration);
                if (parsedTime) deadlineTimestamp = Date.now() + parsedTime;
                else deadlineTimestamp = Date.now() + task.duration;
            } else {
                deadlineTimestamp = Date.now() + task.duration;
            }

            // 5. UPDATE DATA (FORCE ASSIGN)
            task.takenBy[idx] = targetUser.id;     // Masukkan ID User
            task.deadlines[idx] = deadlineTimestamp; // Set Deadline (Timer Jalan)

            // Hapus status pending/beku jika ada (biar langsung aktif)
            if (task.pendingReview) delete task.pendingReview[idx];
            // Jika sebelumnya beku (0), sekarang dipaksa jalan
            if (task.deadlines[idx] === 0) task.deadlines[idx] = deadlineTimestamp;

            // 6. Simpan & Update Visual Tombol
            await DB.saveTask(task, View.generateSummary(task));

            try {
                const msg = await client.channels.cache.get(task.channelId).messages.fetch(taskId);
                await msg.edit({
                    embeds: [View.createTaskEmbed(task)],
                    components: View.createButtons(task) // Tombol otomatis jadi Merah/Taken
                });
            } catch (e) {
                console.log("Gagal update visual pesan:", e.message);
            }

            // 7. Notifikasi
            await i.reply(`✅ **Berhasil Assign!**\nUser: <@${targetUser.id}>\nTugas: **${task.title}** (Chapter ${task.labels[idx]})\n\nSekarang dia bisa pakai \`/lapor\`.`);

            // DM User biar tau dia dapet tugas kaget
            sendNotification(client, targetUser.id, `🚨 **TUGAS MANUAL DARI ADMIN!**\nAdmin telah memasukkanmu ke tugas:\n**${task.title}** - Chapter ${task.labels[idx]}\n\nSilakan kerjakan dan lapor seperti biasa.`);
        }
        else if (commandName === 'stats') {
            const targetUser = i.options.getUser('user') || user;
            const stats = DB.state.userStats.get(targetUser.id) || { point: 0, totalTasks: 0, lastActive: 0, onLeave: false };
            //CARI TUGAS AKTIF (BARU)
            let activeTasksList = [];
            DB.state.tasks.forEach((task) => {
                // Cek setiap slot di tugas ini
                Object.entries(task.takenBy).forEach(([idx, userId]) => {
                    // Jika user ini yang ambil
                    if (userId === targetUser.id) {
                        // Cek status apakah "Pending Review" atau "Sedang Dikerjakan"
                        const isPending = task.pendingReview && task.pendingReview[idx];
                        const statusIcon = isPending ? "⏳" : "🔨";

                        // Format: "🔨 Judul (Tombol)"
                        activeTasksList.push(`${statusIcon} **${task.title}** \n└ \`[${task.labels[idx]}]\``);
                    }
                });
            });
            const activeTasksDisplay = activeTasksList.length > 0
                ? activeTasksList.join("\n\n")
                : "*Tidak ada tugas yang sedang dikerjakan.*";

            // Hitung Ranking Global
            const allStats = [...DB.state.userStats.entries()].sort((a, b) => b[1].point - a[1].point);
            const rank = allStats.findIndex(x => x[0] === targetUser.id) + 1;
            const totalStaff = allStats.length;

            // Hitung Level (Misal: 1 Level = 100 Poin)
            const LEVEL_CAP = 100;
            const level = Math.floor(stats.point / LEVEL_CAP) + 1;
            const currentXP = stats.point % LEVEL_CAP;
            const progressBar = createProgressBar(currentXP, LEVEL_CAP, 10); // Panjang bar 10 balok

            // Tentukan Status & Warna
            let statusText = "🟢 **Aktif**";
            let color = 0x00AE86; // Hijau Tosca

            if (stats.onLeave) {
                statusText = "🏖️ **Sedang Cuti**";
                color = 0xFFA500; // Oranye
            } else {
                // Cek Warning (Tidak aktif > 5 hari)
                const daysInactive = Math.floor((Date.now() - stats.lastActive) / (1000 * 60 * 60 * 24));
                if (daysInactive >= 5) {
                    statusText = "⚠️ **Warning (Jarang Aktif)**";
                    color = 0xFF0000; // Merah
                }
            }

            // 4. Susun Embed "Mewah"
            const embed = new EmbedBuilder()
                .setAuthor({ name: `Kartu Staff Soulscans: ${targetUser.username}`, iconURL: targetUser.displayAvatarURL() })
                .setTitle(statusText)
                .setColor(color)
                .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
                .addFields(
                    { name: "🏆 Peringkat", value: `#${rank} / ${totalStaff} Staff`, inline: true },
                    { name: "💼 Total Garapan", value: `${stats.totalTasks} Selesai`, inline: true },
                    { name: "\u200b", value: "\u200b", inline: true }, // Spacer kosong biar rapi 2 kolom

                    { name: `📈 Level ${level}`, value: `${progressBar} \`(${currentXP}/${LEVEL_CAP} Poin)\``, inline: false },

                    { name: "🔥 Sedang Dikerjakan", value: activeTasksDisplay, inline: false },
                    { name: "⭐ Total Poin", value: `**${stats.point.toLocaleString()}** Poin Akumulasi`, inline: true },
                    { name: "🕒 Terakhir Aktif", value: stats.lastActive ? `<t:${Math.floor(stats.lastActive / 1000)}:R>` : "Belum ada data", inline: true }
                )
                .setFooter({ text: "Terus tingkatkan kinerjamu!", iconURL: client.user.displayAvatarURL() })
                .setTimestamp();

            await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        else if (commandName === 'leaderboard') {
            if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) return i.reply({ content: "❌ Khusus Admin.", flags: MessageFlags.Ephemeral });
            await i.deferReply();
            try { const img = await CanvasGen.generateLeaderboard(client); await i.editReply({ content: "🏆 **LEADERBOARD**", files: [img] }); } catch (e) { await i.editReply("❌ Gagal generate gambar."); }
        }

        else if (commandName === 'list') {
            let text = "**📋 Daftar Tugas Aktif:**\n"; let count = 0;
            DB.state.tasks.forEach((t, id) => { if (t.completed.length < t.labels.length) { const sisaSlot = t.labels.length - t.completed.length; text += `- **${t.title}** (Sisa: ${sisaSlot} Slot)\n`; count++; } });
            if (count === 0) text = "✅ **Tidak ada tugas aktif.**";
            await i.reply({ content: text.substring(0, 2000), flags: MessageFlags.Ephemeral });
        }

        else if (commandName === 'cancel') {
            await i.deferReply({ flags: MessageFlags.Ephemeral }); const myTasks = []; DB.state.tasks.forEach((task, id) => { Object.entries(task.takenBy).forEach(([idx, userId]) => { if (userId === user.id) myTasks.push({ id, idx, title: task.title, label: task.labels[idx] }); }); });
            if (myTasks.length === 0) return i.editReply({ content: "🚫 Kamu tidak punya tugas aktif." });
            const menu = new StringSelectMenuBuilder().setCustomId('menu_cancel').setPlaceholder('Batalkan...');
            myTasks.forEach(t => menu.addOptions(new StringSelectMenuOptionBuilder().setLabel(`${t.label} - ${t.title}`).setValue(`${t.id}_${t.idx}`).setEmoji("↩️")));
            await i.editReply({ content: "⚠️ Batalkan:", components: [new ActionRowBuilder().addComponents(menu)] });
        }

        else if (commandName === 'reset') { await i.deferReply({ ephemeral: true }); await DB.resetPoints(); await i.editReply("⚠️ Reset Done"); }

        else if (commandName === 'manga_library') {
            await i.deferReply();

            const LIMIT = 10;
            const OFFSET = 0;

            // Ambil 10 Manga Pertama
            const data = await Suwayomi.getLibraryMangas(LIMIT, OFFSET);

            if (!data || !data.nodes || data.nodes.length === 0) {
                return i.editReply("📂 Library masih kosong. Tambahkan manga dulu pakai `/manga_search`.");
            }

            // Buat Tampilan List
            const embed = createLibraryListEmbed(data.nodes, OFFSET, data.totalCount, i.user);
            const row = createListButtons(OFFSET, LIMIT, data.totalCount);

            await i.editReply({ embeds: [embed], components: [row] });
        }

        try {
            // 🔥 BARIS PERBAIKAN: Definisikan variabel biar gak error
            const interaction = i;
            const options = i.options;

            // ====================================================
            // 🛠️ COMMAND: MANGA SEARCH (Cari Manga)
            // ====================================================
            if (commandName === 'manga_search') {
                await interaction.deferReply();
                const query = options.getString('query');
                const sourceId = options.getString('source_id');

                // Cari Manga
                const results = await Suwayomi.search(query, sourceId);

                if (!results || results.length === 0) {
                    return interaction.editReply("❌ Manga tidak ditemukan.");
                }

                // Ambil Top 10 Hasil
                const topResults = results.slice(0, 10);

                // 1. Buat Embed Tampilan
                const embed = new EmbedBuilder()
                    .setColor(0x0099ff)
                    .setTitle(`🔍 Hasil: "${query}"`)
                    .setDescription("Pilih manga di bawah ini untuk **Ditambahkan ke Library** atau **Lihat Detail**.")
                    .setFooter({ text: "Klik menu di bawah 👇" });

                // 2. Buat Dropdown Menu (Select Menu)
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('menu_search_result')
                    .setPlaceholder('Pilih Manga untuk di-Add / Cek...');

                topResults.forEach(m => {
                    // Label: Judul (Maks 100 char)
                    const label = m.title.substring(0, 100);

                    // Value: ID###SOURCE_ID (Kita simpan ID dan Source di value biar gampang)
                    // Kalau sudah di library, sourceId mungkin null, jadi kita handle aman
                    const sId = sourceId || "LIBRARY";
                    const value = `${m.id}###${sId}`;

                    // Description: Status Library
                    const desc = m.inLibrary ? "✅ Sudah di Library" : "☁️ Belum di-Add (Klik buat Add)";

                    selectMenu.addOptions(
                        new StringSelectMenuOptionBuilder()
                            .setLabel(label)
                            .setDescription(desc)
                            .setValue(value)
                            .setEmoji(m.inLibrary ? "📚" : "➕")
                    );
                });

                const row = new ActionRowBuilder().addComponents(selectMenu);

                await interaction.editReply({ embeds: [embed], components: [row] });
            }

            // ====================================================
            // ➕ COMMAND: MANGA ADD (Tambah ke Library)
            // ====================================================
            else if (commandName === 'manga_add') {
                await interaction.deferReply();
                const mangaId = options.getString('manga_id');

                try {
                    // Panggil fungsi Add Manga (GraphQL)
                    // Fungsi ini pintar, kalau sudah ada dia return data library-nya
                    const result = await Suwayomi.addManga(mangaId);

                    if (result && result.inLibrary) {
                        const embed = new EmbedBuilder()
                            .setColor(0x00FF00)
                            .setTitle("✅ Manga Aktif di Library!")
                            .setThumbnail(result.thumbnailUrl) // Kalau ada thumbnail
                            .setDescription(`**Judul:** ${result.title}\n**ID Library:** \`${result.id}\`\n\nSekarang kamu bisa:\n1. \`/manga_chapters id:${result.id}\`\n2. \`/manga_download id:${result.id} ...\``);

                        await i.editReply({ embeds: [embed] });
                    } else {
                        await i.editReply("❌ Gagal menambahkan manga. Coba lagi.");
                    }
                } catch (err) {
                    await i.editReply(`❌ Error: ${err.message}`);
                }
            }

            // ====================================================
            // 🧩 COMMAND: EXTENSION SEARCH (Cari Plugin)
            // ====================================================
            else if (commandName === 'ext_search') {
                await interaction.deferReply();
                const query = options.getString('query');

                const results = await Suwayomi.searchExtension(query);

                if (results.length === 0) {
                    return interaction.editReply("❌ Extension tidak ditemukan di Repo.");
                }

                const listText = results.map(ext => {
                    const status = ext.isInstalled ? "✅ Terinstall" : "⬇️ Belum Install";
                    return `**${ext.name}** (${status})\n📦 Pkg: \`${ext.pkgName}\``;
                }).join('\n\n');

                const embed = new EmbedBuilder()
                    .setColor(0xFFA500) // Orange
                    .setTitle(`🧩 Pencarian Extension: "${query}"`)
                    .setDescription(listText)
                    .setFooter({ text: "Gunakan /ext_install [pkg_name] untuk menginstall" });

                await interaction.editReply({ embeds: [embed] });
            }

            // ====================================================
            // 📥 COMMAND: EXTENSION INSTALL (Install Plugin)
            // ====================================================
            else if (commandName === 'ext_install') {
                await interaction.deferReply();

                const pkgName = options.getString('name');

                // ⚠️ VALIDASI PENTING:
                // Nama paket asli pasti ada titiknya (contoh: tachiyomi.en.asurascans)
                // Kalau user cuma ketik "Asura", berarti dia lupa klik menu autocomplete.
                if (!pkgName.includes('.')) {
                    return interaction.editReply(`❌ **Input Tidak Valid!**\nKamu mengetik: \`${pkgName}\`\n\n⚠️ **Caranya:** Ketik nama, lalu **KLIK** pilihan yang muncul di daftar menu (yang ada tulisan kecil *tachiyomi...*). Jangan cuma tekan Enter.`);
                }

                await interaction.editReply(`⏳ Sedang menginstall paket: \`${pkgName}\`...`);

                const success = await Suwayomi.installExtension(pkgName);

                if (success) {
                    await interaction.editReply(`✅ **Berhasil Install!**\nPaket \`${pkgName}\` sudah masuk sistem.\nSilakan cek \`/manga_sources\` untuk melihat ID-nya.`);
                } else {
                    await interaction.editReply(`❌ **Gagal Install.**\nCek terminal bot (PM2 logs) untuk melihat alasan penolakan dari server.`);
                }

            }

            // ====================================================
            // 📜 COMMAND: SOURCES LIST (Lihat Source Aktif)
            // ====================================================
            else if (commandName === 'manga_sources') {
                await interaction.deferReply();
                const sources = await Suwayomi.getSources();

                if (sources.length === 0) {
                    return interaction.editReply("Tidak ada source yang aktif.");
                }

                const list = sources.map(s => `• **${s.name}** (ID: \`${s.id}\`)`).join('\n');

                const embed = new EmbedBuilder()
                    .setTitle('Daftar Source Manga')
                    .setDescription(list)
                    .setColor(0x00AE86);

                await interaction.editReply({ embeds: [embed] });
            }

            // ====================================================
            // 📚 COMMAND: CHAPTERS (Lihat Chapter)
            // ====================================================
            else if (commandName === 'manga_chapters') {
                await interaction.deferReply();
                const mangaId = options.getString('id');
                const chapters = await Suwayomi.getChapters(mangaId);

                if (chapters.length === 0) return interaction.editReply('❌ Tidak ada chapter ditemukan (Mungkin perlu refresh di server).');

                // Ambil 10 chapter terbaru saja
                const latestChapters = chapters.slice(0, 10);

                const list = latestChapters.map((ch, index) =>
                    `**${ch.name}** (Index: ${ch.index})\nScanlator: ${ch.scanlator || '-'}`
                ).join('\n\n');

                const embed = new EmbedBuilder()
                    .setTitle(`Chapter List: (ID: ${mangaId})`)
                    .setDescription(list)
                    .setFooter({ text: "Gunakan /manga_download [id] [chapter_index]" });

                await interaction.editReply({ embeds: [embed] });
            }

            else if (commandName === 'recovery') {
                // 1. Cek Admin
                if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return i.reply({ content: "❌ Khusus Admin!", flags: MessageFlags.Ephemeral });
                }

                await i.deferReply({ flags: MessageFlags.Ephemeral });

                const taskId = i.options.getString('task_id');

                // 2. Jalankan Recovery di Database
                const recoveredTask = await DB.executeRecovery(taskId);

                if (!recoveredTask) {
                    return i.editReply("❌ **Gagal Recovery.**\nTugas tidak ditemukan di Excel atau data korup.");
                }

                // 3. Kirim Ulang Pesan ke Discord (Resend)
                try {
                    const channel = client.channels.cache.get(recoveredTask.channelId);
                    if (!channel) return i.editReply(`❌ Data pulih, tapi channel tujuan (ID: ${recoveredTask.channelId}) sudah dihapus.`);

                    try {
                        const oldMsg = await channel.messages.fetch(taskId).catch(() => null);
                        if (oldMsg) await oldMsg.delete();
                    } catch (e) { }

                    const embed = View.createTaskEmbed(recoveredTask);
                    const buttons = View.createButtons(recoveredTask);
                    const mention = recoveredTask.roleId ? `<@&${recoveredTask.roleId}>` : "";
                    const newMsg = await channel.send({ content: `${mention} **(RECOVERED)**`, embeds: [embed], components: buttons });

                    DB.state.tasks.delete(taskId);
                    DB.state.dirtyTaskIds.delete(taskId);

                    const oldId = recoveredTask.id;
                    recoveredTask.id = newMsg.id;

                    DB.state.tasks.set(recoveredTask.id, recoveredTask);
                    DB.state.dirtyTaskIds.add(recoveredTask.id);
                    await DB.saveTask(recoveredTask, View.generateSummary(recoveredTask));

                    await i.editReply(`✅ **Recovery Sukses!**\nTugas **"${recoveredTask.title}"** telah dimunculkan kembali.\n🆔 ID Baru: \`${newMsg.id}\``);

                } catch (err) {
                    console.error(err);
                    await i.editReply(`❌ Error saat mengirim pesan baru: ${err.message}`);
                }
            }



        } catch (error) {
            console.error('⚠️ Interaction Error (Handled):', error.message);
            // Pastikan interaction belum dibalas sebelum mengirim pesan error
            if (i && !i.replied && !i.deferred) {
                await i.reply({ content: 'Terjadi kesalahan pada bot.', ephemeral: true });
            } else if (i) {
                await i.editReply({ content: 'Terjadi kesalahan saat memproses data.' });
            }
        }
    };


    async function handleButton(i, client) {

        if (DB.state.isMaintenance) {
            return i.reply({
                content: "⚠️ **SEDANG MAINTENANCE**\nBot sedang dalam mode perbaikan/backup data. Mohon tunggu admin menyelesaikan proses ini.",
                flags: MessageFlags.Ephemeral
            });
        }

        const { customId, user, message, member } = i;
        const isAdmin = member ? member.permissions.has(PermissionFlagsBits.Administrator) : false;

        if (customId.startsWith('btn_q_verify')) {
            const tempId = customId.split('###')[1];

            // Cek Cache dulu
            if (!DB.state.tempQuestCache.has(tempId)) {
                return i.reply({ content: "❌ Data sesi habis. Silakan buat ulang.", flags: MessageFlags.Ephemeral });
            }

            // Tampilkan Modal untuk detail pembayaran
            const modal = new ModalBuilder()
                .setCustomId(`modalPayConfirm###${tempId}`)
                .setTitle("Konfirmasi Pembayaran");

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('pay_method')
                        .setLabel("Transfer Lewat Apa? & Ke Mana?")
                        .setPlaceholder("Contoh: Dana / Gopay / Qris")
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('pay_sender')
                        .setLabel("Atas Nama Siapa?")
                        .setPlaceholder("Nama pemilik rekening/akun pengirim")
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                )
            );

            await i.showModal(modal);
        }

        if (customId.startsWith('btn_q_cancel')) {
            const tempId = customId.split('###')[1];

            if (DB.state.tempQuestCache.has(tempId)) {
                DB.state.tempQuestCache.delete(tempId);
            }

            try {
                await i.message.delete();
            } catch (e) {
                await i.deferUpdate();
            }
            return;
        }



        if (customId.startsWith('btn_q_setup')) {
            const tempId = customId.split('###')[1];

            const modal = new ModalBuilder()
                .setCustomId(`modalAdminSetup###${tempId}`)
                .setTitle("Setup Quest (Admin)");

            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('deadline').setLabel("Deadline (Wajib Diisi)").setStyle(TextInputStyle.Short).setPlaceholder("Contoh: 24 Jam / 3 Hari").setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('note').setLabel("Catatan Admin (Opsional)").setStyle(TextInputStyle.Short).setRequired(false))
            );

            await i.showModal(modal);
        }

        // 3. WORKER AMBIL QUEST
        if (customId.startsWith('btn_q_take')) {
            await handleTakeSlot(i, customId.split('###')[1], customId.split('###')[2]);
        }

        if (customId.startsWith('btn_q_reject_init')) {
            // JANGAN deferReply/deferUpdate DISINI, karena showModal harus jadi respon pertama!

            const tempId = customId.split('###')[1];

            const modal = new ModalBuilder()
                .setCustomId(`modalRejectInit###${tempId}`)
                .setTitle("Tolak Verifikasi Quest");

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('reason')
                        .setLabel("Alasan Penolakan")
                        .setPlaceholder("Contoh: Dana belum masuk / Bukti palsu / Nominal kurang")
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                )
            );

            await i.showModal(modal);
        }
        // 4. ADMIN APPROVE HASIL -> AUTO DM CREATOR
        if (customId.startsWith('btn_q_approve_ch')) {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const [_, qId, ch] = customId.split('###');
            const quest = DB.state.activeQuests.get(qId);

            if (!quest) return i.editReply("❌ Quest data error.");
            const slot = quest.slots.get(ch);

            // Update Slot jadi DONE
            slot.status = 'DONE';
            await DB.saveQuestSlots(qId);

            // Ambil File URL dari Embed
            const fileUrl = i.message.embeds[0].fields[0].value.match(/\((.*?)\)/)[1];

            // DM Creator
            try {
                const creator = await client.users.fetch(quest.creatorId);
                await creator.send(`📦 **Chapter Selesai!**\nQuest: ${quest.title}\nChapter: ${ch}\nWorker: <@${slot.workerId}>\n\n📥 **File:** ${fileUrl}`);
            } catch (e) { }

            await i.message.edit({ content: `✅ **Chapter ${ch} APPROVED & SENT.**`, components: [] });
            await i.editReply("✅ Sukses.");

            // Cek jika semua selesai (Opsional: Update Excel Global jadi DONE)
        }

        if (customId.startsWith('acc_sys_')) {
            if (!isAdmin) return i.reply({ content: "❌ Khusus Admin", flags: MessageFlags.Ephemeral });
            const parts = customId.split('_');
            const modal = new ModalBuilder().setCustomId(`modalAccSys###${parts[2]}###${parts[3]}###${parts[4]}`).setTitle("ACC Tugas & Bonus");
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bonus').setLabel("Poin Tambahan").setStyle(TextInputStyle.Short).setValue("0").setRequired(true)));
            return i.showModal(modal);
        }
        if (customId.startsWith('rej_sys_')) {
            if (!isAdmin) return i.reply({ content: "❌ Khusus Admin", flags: MessageFlags.Ephemeral });
            const parts = customId.split('_');
            const modal = new ModalBuilder().setCustomId(`modalRejSys###${parts[2]}###${parts[3]}###${parts[4]}`).setTitle("Tolak / Revisi Tugas");
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel("Alasan").setStyle(TextInputStyle.Paragraph).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('time').setLabel("Menit Revisi (0 = Kick)").setStyle(TextInputStyle.Short).setValue("0").setRequired(true)));
            return i.showModal(modal);
        }
        if (customId.startsWith('acc_man_')) {
            if (!isAdmin) return i.reply({ content: "❌ Khusus Admin", flags: MessageFlags.Ephemeral });

            const parts = customId.split('_');
            const userId = parts[2];
            const point = parts[3];
            const destTS = parts[4] || '0'; // Ambil ID tujuan (atau 0)

            const modal = new ModalBuilder()
                .setCustomId(`modalACC###${userId}###${destTS}`) // Simpan DestTS di sini
                .setTitle("ACC Laporan Tetap");

            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('amount').setLabel("Total Poin").setStyle(TextInputStyle.Short).setValue(point || "0")
            ));
            return i.showModal(modal);
        }
        if (customId.startsWith('reject_report_')) {
            if (!isAdmin) return i.reply({ content: "❌ Khusus Admin", flags: MessageFlags.Ephemeral });
            const modal = new ModalBuilder().setCustomId(`modalRejectManual###${customId.split('_')[2]}`).setTitle("Tolak Laporan Manual");
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel("Alasan").setStyle(TextInputStyle.Paragraph).setRequired(true)));
            return i.showModal(modal);
        }

        if (customId.startsWith('cancel_self_')) {
            await i.deferReply({ flags: MessageFlags.Ephemeral }); const [_, __, idx] = customId.split('_'); const task = DB.state.tasks.get(message.id);
            if (!task || task.takenBy[idx] !== user.id) return i.editReply("❌ Error");
            delete task.takenBy[idx]; delete task.deadlines[idx]; delete task.remindedLevels[idx]; if (task.pendingReview) delete task.pendingReview[idx];
            await DB.saveTask(task, View.generateSummary(task)); await message.edit({ embeds: [View.createTaskEmbed(task)], components: View.createButtons(task) });
            await i.editReply("✅ Batal");
        }
        if (customId.startsWith('take_')) {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const [_, idx] = customId.split('_');
            const task = DB.state.tasks.get(message.id);

            if (!task) return i.editReply("❌ Tugas hilang.");
            if (task.takenBy[idx]) return i.editReply("❌ Sudah diambil.");

            // --- [VALIDASI SMART MULTITASKING] ---
            const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
            if (!isAdmin) {
                if (task.roleId && task.roleId !== 'null') {
                    if (!member.roles.cache.has(task.roleId)) {
                        return i.editReply(`🚫 **Akses Ditolak!**\nTugas ini khusus untuk role <@&${task.roleId}>.`);
                    }
                }

                let totalTasks = 0;
                let hasActiveTask = false;
                let activeTaskTitle = "";

                for (const [tId, tData] of DB.state.tasks) {
                    const userSlotIdx = Object.keys(tData.takenBy).find(key => tData.takenBy[key] === user.id);
                    if (userSlotIdx) {
                        totalTasks++;

                        // Cek Status: Apakah Pending Review ATAU Beku (Deadline 0)?
                        const isPending = tData.pendingReview && tData.pendingReview[userSlotIdx];
                        const isFrozen = tData.deadlines && tData.deadlines[userSlotIdx] === 0;

                        // Kalau TIDAK Pending DAN TIDAK Beku, berarti sedang kerja aktif -> Block
                        if (!isPending && !isFrozen) {
                            hasActiveTask = true;
                            activeTaskTitle = tData.title;
                        }
                    }
                }

                // Hard Limit 3 Slot (Gabungan Aktif + Beku)
                if (totalTasks >= 3) return i.editReply(`❌ **Kuota Penuh (3/3)!**\nKamu memegang 3 slot (termasuk yang booking/pending). Lepas satu dulu.`);

                // Block hanya jika punya tugas AKTIF yang sedang berjalan argonyo
                if (hasActiveTask) return i.editReply(`❌ **Fokus Woi!**\nKamu sedang mengerjakan: **${activeTaskTitle}**.\n\nSelesaikan itu dulu, atau tunggu sampai tugas booking-mu cair.`);
            }
            // -------------------------------------

            // --- [LOGIKA BOOKING / CEK TETANGGA] ---
            let isFrozen = false;
            let freezeReason = "";

            console.log(`\n🕵️ --- MULAI CEK BOOKING ---`);
            console.log(`> User: ${user.username}`);
            console.log(`> Judul Tugas Ini: "${task.title}"`);
            console.log(`> Role ID Tugas Ini: "${task.roleId}"`);
            console.log(`> Target ROLE_EDITOR di Kodingan: "${ROLE_EDITOR}"`);

            // 1. Cek Apakah Tugas Ini Milik Editor?
            if (task.roleId === ROLE_EDITOR) {
                console.log(`> ✅ Role COCOK. Mencari pasangan TL...`);

                const currentChapter = task.labels[idx];
                const cleanTitle = task.title.trim().toLowerCase();
                let tlFound = false;
                let tlDone = false;

                // Loop semua tugas untuk cari TL
                for (const [otherId, otherTask] of DB.state.tasks) {
                    // Skip diri sendiri
                    if (otherId === task.id) continue;

                    console.log(`  🔎 Cek ID: ${otherId.slice(-4)} | Judul: "${otherTask.title}" | Role: ${otherTask.roleId}`);

                    // Cek Judul
                    if (otherTask.title.trim().toLowerCase() !== cleanTitle) {
                        console.log(`     ❌ Judul Beda.`);
                        continue;
                    }

                    // Cek Role TL
                    // Pastikan array TL_ROLES sudah didefinisikan di atas file!
                    if (!TL_ROLES.includes(otherTask.roleId)) {
                        console.log(`     ❌ Bukan Role TL (List TL: ${JSON.stringify(TL_ROLES)})`);
                        continue;
                    }

                    // Cek Chapter
                    const tlIdx = otherTask.labels.findIndex(l => l === currentChapter);
                    if (tlIdx === -1) {
                        console.log(`     ❌ Chapter ${currentChapter} gak ada di tugas TL ini.`);
                        continue;
                    }

                    console.log(`     ✅ KETEMU PASANGAN TL!`);
                    tlFound = true;

                    // Cek Apakah Selesai?
                    if (otherTask.finishedBy[tlIdx]) {
                        console.log(`     ⚠️ Tapi statusnya SUDAH SELESAI (Done).`);
                        tlDone = true;
                    } else {
                        console.log(`     ❄️ Statusnya BELUM SELESAI. (Harusnya BEKU)`);
                    }
                    break;
                }

                if (tlFound && !tlDone) {
                    isFrozen = true;
                    freezeReason = "Menunggu Translator.";
                    console.log(`> ❄️ KEPUTUSAN AKHIR: BEKU.`);
                } else {
                    console.log(`> 🔥 KEPUTUSAN AKHIR: GAS (TL tidak ketemu / sudah selesai).`);
                }

            } else {
                console.log(`> ⏭️ SKIPPED. Role ID tugas ini BEDA dengan ROLE_EDITOR.`);
                console.log(`> Tips: Cek apakah ID Role di file interaction.js baris atas sudah benar?`);
            }
            console.log(`------------------------------\n`);
            // ---------------------------------------

            task.takenBy[idx] = user.id;

            if (isFrozen) {
                task.deadlines[idx] = 0;
                await i.editReply(`❄️ **Slot Diamankan!**\nStatus: **Tunggu TL Selesai**\n(Timer PAUSED. Kamu boleh ambil tugas lain).`);
            } else {
                task.deadlines[idx] = Date.now() + task.duration;
                await i.editReply(`✅ **Berhasil Diambil!**\nSelamat bekerja.`);
            }

            await DB.saveTask(task, View.generateSummary(task));
            await message.edit({ embeds: [View.createTaskEmbed(task)], components: View.createButtons(task) });
        }

        if (customId.startsWith('delete_')) { if (!isAdmin) return; const taskId = customId.split('_')[1]; DB.state.dirtyTaskIds.add(taskId); DB.state.tasks.delete(taskId); try { await message.delete(); } catch (e) { } }
        if (customId.startsWith('reset_')) {
            if (!isAdmin) return;
            const [_, taskId, idx] = customId.split('_');
            const task = DB.state.tasks.get(taskId);
            if (task) {
                delete task.takenBy[idx]; delete task.deadlines[idx]; delete task.remindedLevels[idx];
                if (task.pendingReview) delete task.pendingReview[idx];
                await DB.saveTask(task, View.generateSummary(task));
                try {
                    const msg = await client.channels.cache.get(task.channelId).messages.fetch(taskId);
                    await msg.edit({ embeds: [View.createTaskEmbed(task)], components: View.createButtons(task) });
                } catch (e) { }
            }
            await i.reply({ content: "Reset", flags: MessageFlags.Ephemeral }); // [FIX] Gunakan Flags
        }
        if (customId.startsWith('lib_nav_')) {
            await i.deferUpdate();

            // Format ID: lib_nav_ACTION_CURRENTOFFSET
            const [_, __, action, offsetStr] = customId.split('_');
            let currentOffset = parseInt(offsetStr);
            const LIMIT = 10;

            // Hitung Offset Baru
            let newOffset = currentOffset;
            if (action === 'next') newOffset += LIMIT;
            else if (action === 'prev') newOffset -= LIMIT;

            // Validasi biar gak minus
            if (newOffset < 0) newOffset = 0;

            // Ambil Data Baru
            const data = await Suwayomi.getLibraryMangas(LIMIT, newOffset);

            if (!data || !data.nodes) {
                return i.followUp({ content: "❌ Gagal memuat data.", flags: MessageFlags.Ephemeral });
            }

            // Update Pesan
            const embed = createLibraryListEmbed(data.nodes, newOffset, data.totalCount, i.user);
            const row = createListButtons(newOffset, LIMIT, data.totalCount);

            await i.editReply({ embeds: [embed], components: [row] });
        }
        if (customId === 'menu_stop') { await i.update({ content: "Deleted", components: [] }); }
        if (customId === 'menu_cancel') { await i.update({ content: "Canceled", components: [] }); }
        if (!i.replied && !i.deferred) await i.deferUpdate();
    }

    async function handleModal(i, client) {
        if (DB.state.isMaintenance) {
            return i.reply({
                content: "⚠️ **SEDANG MAINTENANCE**\nBot sedang dalam mode perbaikan/backup data. Mohon tunggu admin menyelesaikan proses ini.",
                flags: MessageFlags.Ephemeral
            });
        }
        if (i.customId.startsWith('modalAccSys')) {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const [_, taskId, idx, targetUserId] = i.customId.split('###');
            const bonus = parseInt(i.fields.getTextInputValue('bonus') || "0");
            const task = DB.state.tasks.get(taskId);

            if (!task) return i.editReply("❌ Data tugas hilang.");

            const totalPoin = task.pointValue + (isNaN(bonus) ? 0 : bonus);
            let targetName = "Unknown";
            try { const u = await client.users.fetch(targetUserId); targetName = u.username; } catch (e) { }

            await DB.addPoint(targetUserId, totalPoin, targetName);
            task.completed.push(idx); task.finishedBy[idx] = targetUserId;
            delete task.takenBy[idx]; delete task.deadlines[idx]; delete task.remindedLevels[idx];
            if (task.pendingReview) delete task.pendingReview[idx];

            await DB.saveTask(task, View.generateSummary(task));
            try { const msg = await client.channels.cache.get(task.channelId).messages.fetch(taskId); await msg.edit({ embeds: [View.createTaskEmbed(task)], components: View.createButtons(task) }); } catch (e) { }
            if (TL_ROLES.includes(task.roleId)) {
                const finishedChapter = task.labels[idx];
                // Kita panggil fungsi helper di bawah nanti
                await checkAndUnfreezeEditor(client, task.title, finishedChapter, i.channel);
            }
            await i.message.edit({ content: `✅ **DISETUJUI**`, embeds: [new EmbedBuilder(i.message.embeds[0].data).setColor(0x00FF00).setFooter({ text: `Total: ${totalPoin} (Base: ${task.pointValue} + Bonus: ${bonus})` })], components: [] });
            sendNotification(client, targetUserId, `✅ **Tugas Diterima!**\nJudul: ${task.title}\nPoin: ${totalPoin} (Bonus: ${bonus})`, i.channel);
            await checkAndMigrateTask(client, task);
            await i.editReply(`✅ Sukses.`);
            try {
                // 1. Cek Apakah Judul ini punya Tujuan TS?
                const titleData = DB.state.titles.find(t => t.name.toLowerCase() === task.title.toLowerCase());

                if (titleData && titleData.tujuanTS) {
                    const reportMsg = i.message;
                    let fileName = null;
                    let extension = ".zip";

                    // 2. Ambil Link File dari Embed Laporan Admin
                    if (reportMsg.embeds.length > 0) {
                        const embed = reportMsg.embeds[0];
                        if (embed.image) fileUrl = embed.image.url;
                        else if (embed.fields) {
                            // Prioritas 2: Link di dalam text field
                            const fileField = embed.fields.find(f => f.name.includes("File") || f.name.includes("Lampiran"));
                            if (fileField) {
                                const match = fileField.value.match(/\((https?:\/\/[^)]+)\)/);
                                if (match) fileUrl = match[1];
                                const extMatch = fileUrl.match(/(\.[a-zA-Z0-9]+)(?:\?|$)/);
                                if (extMatch) extension = extMatch[1];
                            }
                        }
                    }

                    if (fileUrl) {
                        const tsChannel = client.channels.cache.get(titleData.tujuanTS);
                        if (tsChannel) {
                            try {
                                const cleanTitle = task.title.replace(/[\\/:*?"<>|]/g, "");
                                const newFileName = `${cleanTitle} - Ch ${task.labels[idx]}${extension}`;
                                const attachment = new AttachmentBuilder(fileUrl, { name: newFileName });
                                // 3. Buat Embed Format Baru
                                const forwardEmbed = new EmbedBuilder()
                                    .setColor(0x0099FF) // Biru
                                    .setTitle(`Chapter ${task.labels[idx]} | ${task.title}`) // Format: Chapter X | Judul
                                    .setURL(fileUrl)
                                    .setDescription(`**Editor:** <@${targetUserId}>`) // Cuma nampilin Editor
                                    .setFooter({ text: "Soulscans" })
                                    .setTimestamp();

                                // Kalau linknya gambar, tampilkan previewnya
                                if (fileUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) forwardEmbed.setImage(`attachment://${newFileName}`);

                                // 4. Buat Tombol Download Terpisah (Cadangan)
                                const rowDownload = new ActionRowBuilder().addComponents(
                                    new ButtonBuilder()
                                        .setLabel("📥 Download File")
                                        .setStyle(ButtonStyle.Link)
                                        .setURL(fileUrl)
                                );

                                // 5. Kirim ke Channel TS
                                await tsChannel.send({
                                    content: `🔔 **Siap Diupload! <@&1407583057799680101>**`,
                                    embeds: [forwardEmbed],
                                    components: [rowDownload],
                                    files: [attachment]
                                });

                                await i.editReply(`✅ Poin diberikan & **File diteruskan ke Channel TS**.`);
                                return; // Stop di sini biar gak lanjut editReply default
                            } catch (uploadErr) {
                                console.error("Gagal Re-upload:", uploadErr);
                                await i.followUp({ content: `⚠️ Gagal re-upload file ke TS (Mungkin file terlalu besar/link mati). Admin harap forward manual.`, flags: MessageFlags.Ephemeral });
                            }
                        }
                    }
                }
            } catch (fwErr) {
                console.error("Gagal forward file:", fwErr);
            }

            await i.editReply(`✅ Sukses.`);
        }

        else if (i.customId.startsWith('modalRejSys')) {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const [_, taskId, idx, targetUserId] = i.customId.split('###');
            const reason = i.fields.getTextInputValue('reason');
            const timeAdd = parseInt(i.fields.getTextInputValue('time') || "0");
            const task = DB.state.tasks.get(taskId);

            if (!task) return i.editReply("❌ Data tugas hilang.");
            if (task.pendingReview) delete task.pendingReview[idx];

            let notifMsg = "";
            const chapterNum = task.labels[idx];
            if (timeAdd <= 0) {
                delete task.takenBy[idx]; delete task.deadlines[idx]; delete task.remindedLevels[idx];
                notifMsg = `❌ **Laporan Ditolak & Dilelang Ulang**\n\n**Tugas:** ${task.title}\n**Alasan:** ${reason}`;
                await i.message.edit({ content: "❌ **DITOLAK (LELANG ULANG)**", embeds: [new EmbedBuilder(i.message.embeds[0].data).setColor(0xFF0000).addFields({ name: "Alasan", value: reason })], components: [] });
            } else {
                task.deadlines[idx] = Date.now() + (timeAdd * 60000);
                notifMsg = `⚠️ **Laporan Ditolak (Revisi ${timeAdd} Menit)**\n\n**Tugas:** ${task.title}\n**Chapter:** ${chapterNum}\n**Alasan:** ${reason}`;

                await i.message.edit({ content: `⚠️ **REVISI (${timeAdd}m)**`, embeds: [new EmbedBuilder(i.message.embeds[0].data).setColor(0xFF0000).addFields({ name: "Alasan", value: reason })], components: [] });
            }

            await DB.saveTask(task, View.generateSummary(task));
            try { const msg = await client.channels.cache.get(task.channelId).messages.fetch(taskId); await msg.edit({ embeds: [View.createTaskEmbed(task)], components: View.createButtons(task) }); } catch (e) { }
            sendNotification(client, targetUserId, notifMsg, i.channel);
            await i.editReply("✅ Penolakan diproses.");
        }

        else if (i.customId.startsWith('modalACC')) {
            await i.deferReply({ flags: MessageFlags.Ephemeral });

            // Parse ID: modalACC###userId###destTS
            const parts = i.customId.split('###');
            const targetUserId = parts[1];
            const destTS = parts[2]; // ID Channel Tujuan (bisa 'undefined' atau '0' kalau dari kode lama)

            const amount = parseInt(i.fields.getTextInputValue('amount') || "0");

            if (amount > 0) {
                // ... (Kode addPoint & notifikasi user TETAP SAMA) ...
                let targetName = "Unknown";
                try { const u = await client.users.fetch(targetUserId); targetName = u.username; } catch (e) { }
                await DB.addPoint(targetUserId, amount, targetName);
                // ... (Logika autoClosedTask tetap sama) ...

                await i.message.edit({ content: `✅ **Laporan Manual Disetujui.** (+${amount} Poin)`, components: [] });
                sendNotification(client, targetUserId, `✅ **Laporan Manual Diterima!**\n\n**Poin:** +${amount}`, i.channel);

                // --- [LOGIKA BARU: AUTO FORWARD MANUAL] ---
                if (destTS && destTS !== '0' && destTS !== 'undefined') {
                    try {
                        const tsChannel = client.channels.cache.get(destTS);
                        if (tsChannel) {
                            const reportMsg = i.message;
                            let fileUrl = null;
                            let extension = ".zip";

                            // 1. Ambil File URL
                            if (reportMsg.embeds.length > 0) {
                                const embed = reportMsg.embeds[0];
                                if (embed.image) fileUrl = embed.image.url;
                                else if (embed.fields) {
                                    const fileField = embed.fields.find(f => f.name.includes("File") || f.name.includes("Lampiran"));
                                    if (fileField) {
                                        const match = fileField.value.match(/\((https?:\/\/[^)]+)\)/);
                                        if (match) fileUrl = match[1];
                                        const extMatch = fileUrl.match(/(\.[a-zA-Z0-9]+)(?:\?|$)/);
                                        if (extMatch) extension = extMatch[1];
                                    }
                                }
                            }

                            // 2. Ambil Judul Garapan dari Embed Laporan (Format: "Judul Chapter X")
                            let displayTitle = "Manual Report";
                            if (reportMsg.embeds[0] && reportMsg.embeds[0].fields) {
                                const titleField = reportMsg.embeds[0].fields.find(f => f.name.includes("Judul") || f.name.includes("Garapan"));
                                if (titleField) {
                                    displayTitle = titleField.value.replace(/\*\*/g, '').trim();
                                }
                            }

                            if (fileUrl) {
                                // 3. Buat Embed
                                const cleanName = displayTitle.replace(/[\\/:*?"<>|]/g, "");
                                const newFileName = `${cleanName}${extension}`;
                                const attachment = new AttachmentBuilder(fileUrl, { name: newFileName });;
                                const forwardEmbed = new EmbedBuilder()
                                    .setColor(0x0099FF)
                                    .setTitle(displayTitle)
                                    .setURL(fileUrl)
                                    .setDescription(`**Editor:** <@${targetUserId}>`)
                                    .setFooter({ text: "Soulscans" })
                                    .setTimestamp();

                                if (fileUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) forwardEmbed.setImage(`attachment://${newFileName}`);

                                // 4. Buat Tombol Download
                                const rowDownload = new ActionRowBuilder().addComponents(
                                    new ButtonBuilder()
                                        .setLabel("📥 Download File")
                                        .setStyle(ButtonStyle.Link)
                                        .setURL(fileUrl)
                                );

                                await tsChannel.send({
                                    content: `🔔 **Siap Diupload!<@&1407583057799680101>**`,
                                    embeds: [forwardEmbed],
                                    components: [rowDownload],
                                    files: [attachment]
                                });

                                await i.editReply(`✅ Poin diberikan & **File diteruskan ke Channel TS**.`);
                                return;
                            }
                        }
                    } catch (e) {
                        console.log("Gagal forward tetap:", e);
                        await i.followUp({
                            content: "⚠️ Gagal re-upload file ke TS.", flags: MessageFlags.Ephemeral
                        });
                    }
                }

                await i.editReply(`✅ Poin diberikan.`);
            } else {
                await i.editReply("❌ Poin harus lebih dari 0.");
            }
        }

        else if (i.customId.startsWith('modalPayConfirm')) {
            const user = i.user;
            const tempId = i.customId.split('###')[1];
            const payMethod = i.fields.getTextInputValue('pay_method');
            const paySender = i.fields.getTextInputValue('pay_sender');

            try {
                // 1. Defer Reply (WAJIB PERTAMA biar gak "Something went wrong")
                await i.deferReply();

                // 2. Cek apakah data quest masih ada di memori?
                const questData = DB.state.tempQuestCache.get(tempId);
                if (!questData) {
                    return i.editReply("❌ **Sesi Habis.**\nData hilang karena bot restart. Silakan ulangi klik tombol 'Saya Sudah Transfer'.");
                }

                // 3. Minta User Upload Gambar
                await i.editReply({
                    content: `✅ Info dicatat: **${payMethod} (a.n ${paySender})**\n\n📸 **KIRIM FOTO BUKTI TRANSFER SEKARANG!**\n*(Bot menunggu 3 menit...)*`,
                    components: []
                });

                // 4. Tunggu Upload Gambar (Timeout 5 Menit)
                const filter = (m) => m.author.id === i.user.id && m.attachments.size > 0;
                const collected = await i.channel.awaitMessages({ filter, max: 1, time: 180000, errors: ['time'] });

                // 5. Ambil URL Gambar
                const imageMsg = collected.first();
                const imageUrl = imageMsg.attachments.first().url;

                // 6. Siapkan Channel Admin
                const adminChId = DB.state.settings['ADMIN_CHANNEL_ID'];
                const adminCh = client.channels.cache.get(adminChId);

                if (!adminCh) throw new Error("Channel Admin belum disetting di /config.");

                const verifyEmbed = new EmbedBuilder()
                    .setTitle("💸 VERIFIKASI PEMBAYARAN QUEST")
                    .setColor(0xFFA500) // Orange (Warna Peringatan/Action)
                    .setThumbnail(user.displayAvatarURL({ dynamic: true })) // Foto Profil Creator
                    .setDescription(`**<@${questData.creatorId}>** mengklaim sudah transfer.\nMohon Admin cek mutasi rekening sebelum menekan tombol **Setup**.\n\u200b`)
                    .addFields(
                        // BAGIAN 1: KEUANGAN (Paling Penting buat Admin)
                        { name: "💰 TOTAL DITRANSFER", value: `\`Rp ${questData.totalCost.toLocaleString()}\``, inline: true },
                        { name: "💳 Metode", value: payMethod, inline: true },
                        { name: "📊 Rincian", value: `Base: Rp ${(questData.totalCost - questData.fee - (questData.bonus || 0)).toLocaleString()}\nFee: Rp ${questData.fee}\nBonus: Rp ${(questData.bonus || 0).toLocaleString()}`, inline: false },
                        { name: "\u200b", value: "\u200b", inline: true }, // Spacer kosong biar rapi

                        // BAGIAN 2: DETAIL QUEST
                        { name: "📂 Judul Quest", value: `**${questData.title}**`, inline: true },
                        { name: "🏷️ Tipe & Role", value: `${questData.type.toUpperCase()} - ${questData.role.toUpperCase()}`, inline: true },
                        { name: "📚 Muatan", value: `Chapter: **${questData.rawChapters}**\nTotal: **${questData.chapterList.length} Chapter**`, inline: true },

                        // BAGIAN 3: KONTEKS
                        { name: "📝 Deskripsi / Note / Link Raw", value: questData.desc.length > 1000 ? questData.desc.substring(0, 900) + "..." : questData.desc }
                    )
                    .setImage(imageUrl)
                    .setFooter({ text: `Quest ID: ${tempId} • Menunggu Verifikasi`, iconURL: client.user.displayAvatarURL() })
                    .setTimestamp();

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`btn_q_setup###${tempId}`).setLabel("⚙️ Setup & Approve").setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`btn_q_reject_init###${tempId}`).setLabel("❌ Tolak").setStyle(ButtonStyle.Danger)
                );

                // Kirim ke Admin
                await adminCh.send({ content: `🔔 **Cek AKUNMU Ewallet mu HEI BAGINDA** <@&524926755853565952>`, embeds: [verifyEmbed], components: [row] });

                // 8. Beritahu User Sukses
                await i.followUp(`✅ **Bukti Diterima!**\nFoto berhasil dikirim ke Admin. Mohon tunggu verifikasi.`);

            } catch (error) {
                // Handle Error (Timeout atau Error Coding)
                if (error.message === 'time' || (error instanceof Map && error.size === 0)) {
                    await i.editReply("❌ **Waktu Habis!** Kamu terlalu lama tidak mengirim bukti gambar.\nSilakan ulangi prosesnya.");
                } else {
                    console.error("ERROR MODAL:", error);
                    if (i.deferred || i.replied) await i.editReply(`⚠️ **System Error:** ${error.message}`);
                    else await i.reply({ content: `⚠️ **System Error:** ${error.message}`, flags: MessageFlags.Ephemeral });
                }
            }
        }

        else if (i.customId.startsWith('modalRejectInit')) {
            await i.deferUpdate(); // Kita update pesan adminnya

            const tempId = i.customId.split('###')[1];
            const reason = i.fields.getTextInputValue('reason');
            const questData = DB.state.tempQuestCache.get(tempId);

            // 1. Ambil Pesan Asli (Embed Verifikasi)
            const oldEmbed = i.message.embeds[0];

            // 2. Update Embed Jadi MERAH (DITOLAK)
            const rejectedEmbed = new EmbedBuilder(oldEmbed.data)
                .setTitle("❌ VERIFIKASI DITOLAK")
                .setColor(0xFF0000) // Merah
                .addFields({ name: "⚠️ Alasan Penolakan", value: reason });

            await i.editReply({ components: [], embeds: [rejectedEmbed] });

            // 3. DM CREATOR (Pemberitahuan & Instruksi Refund)
            if (questData) {
                try {
                    const creator = await client.users.fetch(questData.creatorId);

                    const dmEmbed = new EmbedBuilder()
                        .setTitle("❌ Permintaan Quest Ditolak")
                        .setColor(0xFF0000)
                        .setDescription(`Halo, permintaan quest **${questData.title}** kamu ditolak oleh Admin.`)
                        .addFields(
                            { name: "⚠️ Alasan", value: reason },
                            { name: "💸 Masalah Dana?", value: "Jika kamu merasa **SUDAH TRANSFER** namun ditolak (uang terlanjur dikirim), mohon segera **DM Admin** atau reply pesan ini dengan bukti transfer valid untuk proses **Pengembalian Dana (Refund)**." }
                        )
                        .setFooter({ text: "Soulscans Bot System" });

                    await creator.send({ embeds: [dmEmbed] });
                } catch (e) {
                    console.log("Gagal DM User (Ditolak):", e.message);
                    // Jika DM tertutup, Admin tau dari log error (opsional: bisa kirim notif ke channel admin juga)
                }

                // Hapus dari cache memory
                DB.state.tempQuestCache.delete(tempId);
            }
        }

        else if (i.customId.startsWith('modalRejectManual')) {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const targetUserId = i.customId.split('###')[1];
            const reason = i.fields.getTextInputValue('reason');
            await i.message.edit({ content: `❌ **Laporan Manual Ditolak.**`, embeds: [new EmbedBuilder(i.message.embeds[0].data).setColor(0xFF0000).addFields({ name: "Alasan Penolakan", value: reason })], components: [] });
            sendNotification(client, targetUserId, `❌ **Laporan Manual Ditolak**\n\n**Alasan:** ${reason}`, i.channel);
            await i.editReply("✅ Laporan ditolak.");
        }

        else if (i.customId.startsWith('modalTask')) {
            await i.deferReply({ flags: MessageFlags.Ephemeral });

            // [FIX] Ambil Data dari Cache Memory
            const [_, cacheId] = i.customId.split('###');
            const cachedData = taskCreationCache.get(cacheId);

            // Validasi: Kalau bot habis restart saat admin ngetik, data hilang
            if (!cachedData) {
                return i.editReply("? **Sesi Habis / Bot Restart.**\nData tugas hilang dari memori sementara. Silakan ulangi command `/task`.");
            }

            const { title, roleId } = cachedData; // Ambil Judul & Role yang disimpan tadi

            // Hapus dari cache biar hemat memori
            taskCreationCache.delete(cacheId);

            const desc = i.fields.getTextInputValue('desc');
            const timeInput = i.fields.getTextInputValue('time');
            const durationMs = parse(timeInput);
            if (!durationMs || durationMs <= 0) {
                return i.editReply("❌ **Format Waktu Salah!**\nLibrary gagal membaca waktumu.\nGunakan format standar: `1d` (hari), `2h` (jam), `30m` (menit).\nContoh: `1d 2h 30m`");
            }

            const point = parseInt(i.fields.getTextInputValue('point') || "1");

            const rawBtn = i.fields.getTextInputValue('buttons');
            let labels = [];

            if (rawBtn) {
                const rawLabels = rawBtn.split(',').map(s => s.trim()).filter(s => s);
                const isAllNumbers = rawLabels.every(lbl => /^[0-9]+$/.test(lbl));
                if (!isAllNumbers) return i.editReply("❌ **Format Salah!**\nKolom 'List Tombol' hanya boleh berisi **ANGKA** yang dipisah koma.\nContoh: `1, 2, 5, 10`");
                labels = rawLabels;
            } else {
                labels = ["1"];
            }

            const taskData = { title: title || "Tugas Baru", originalDesc: desc, duration: durationMs, originalDuration: timeInput, pointValue: point, labels: labels, roleId: roleId === 'null' ? null : roleId, takenBy: {}, finishedBy: {}, completed: [], deadlines: {}, remindedLevels: {}, channelId: i.channelId };
            const embed = View.createTaskEmbed(taskData); const buttons = View.createButtons(taskData);
            const msg = await i.channel.send({ content: roleId && roleId !== 'null' ? `<@&${roleId}>` : "", embeds: [embed], components: buttons });
            taskData.id = msg.id; await DB.saveTask(taskData, View.generateSummary(taskData));
            await Logger.sendLog(client, "📝 Tugas Baru", `Judul: ${title}`, "Blue"); await i.editReply("✅ Tugas Dibuat!");

        }
        else if (i.customId.startsWith('modalQuestCreate')) {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const [_, roleTarget, originType] = i.customId.split('###');

            const title = i.fields.getTextInputValue('q_title');
            const desc = i.fields.getTextInputValue('q_desc');
            const rawChapters = i.fields.getTextInputValue('q_chapters');
            // [BARU] Ambil Bonus
            const rawBonus = i.fields.getTextInputValue('q_bonus');
            const bonus = rawBonus && /^\d+$/.test(rawBonus) ? parseInt(rawBonus) : 0; // Validasi angka

            // 1. Parse Chapter
            let chapterList = [];
            if (DB.parseChapterString) {
                chapterList = DB.parseChapterString(rawChapters);
            } else {
                // Fallback manual parsing
                const parts = rawChapters.split(',');
                parts.forEach(p => {
                    const r = p.trim().split('-');
                    if (r.length === 2) { for (let x = parseInt(r[0]); x <= parseInt(r[1]); x++) chapterList.push(x.toString()); }
                    else if (p.trim()) chapterList.push(p.trim());
                });
            }

            const totalChapters = chapterList.length;
            if (totalChapters === 0) return i.editReply("❌ Format chapter salah.");

            // 2. Cari Harga Base
            const priceData = DB.state.questPrices.find(p => p.role === roleTarget && p.type === originType);
            if (!priceData) return i.editReply(`❌ Harga kombinasi **${roleTarget}-${originType}** belum disetting.`);

            // 3. Kalkulasi Total (INCLUDE BONUS)
            const basePriceTotal = totalChapters * priceData.price;
            const totalCost = basePriceTotal + priceData.fee + bonus;

            const tempId = `Q-${Date.now().toString().slice(-5)}`;

            // 4. Simpan ke Cache (Simpan data bonus juga)
            if (!DB.state.tempQuestCache) DB.state.tempQuestCache = new Map();
            DB.state.tempQuestCache.set(tempId, {
                id: tempId, creatorId: i.user.id, role: roleTarget, type: originType,
                title, desc, rawChapters, chapterList,
                pricePerCh: priceData.price, fee: priceData.fee,
                bonus: bonus, // Simpan bonus terpisah
                totalCost: totalCost
            });

            // 5. Buat Invoice Embed (Tampilkan Rincian Bonus)
            const invoiceEmbed = new EmbedBuilder()
                .setTitle("🧾 INVOICE QUEST")
                .setColor(0x0099FF)
                .setDescription(`Halo **${i.user.username}**,\nMohon transfer sesuai nominal di bawah ini:`)
                .addFields(
                    { name: "📦 Paket", value: `${roleTarget.toUpperCase()} - ${originType.toUpperCase()}`, inline: true },
                    { name: "📚 Muatan", value: `${totalChapters} Chapter`, inline: true },
                    { name: "💵 Subtotal", value: `Rp ${basePriceTotal.toLocaleString()}`, inline: true },

                    // Tampilkan Field Bonus Jika Ada
                    ...(bonus > 0 ? [{ name: "🔥 Bonus User", value: `**Rp ${bonus.toLocaleString()}**`, inline: true }] : []),

                    { name: "🛡️ Fee Admin", value: `Rp ${priceData.fee.toLocaleString()}`, inline: true },
                    { name: "💰 TOTAL TRANSFER", value: `**Rp ${totalCost.toLocaleString()}**`, inline: false },
                    { name: "Dana/Gopay", value: `**082120785343 A/N Dini**`, inline: false }
                )
                .setFooter({ text: "Klik tombol di bawah JIKA SUDAH transfer." });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`btn_q_verify###${tempId}`).setLabel("✅ Saya Sudah Transfer").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`btn_q_cancel###${tempId}`).setLabel("❌ Batal").setStyle(ButtonStyle.Secondary)
            );

            // Kirim DM
            try {
                await i.user.send({ content: "Permintaan Quest baru diterima!", embeds: [invoiceEmbed], components: [row] });
                await i.editReply("✅ **Invoice Berhasil Dibuat!**\nCek DM kamu untuk rincian tagihan & pembayaran.");
            } catch (error) {
                await i.editReply("❌ **Gagal Mengirim DM!** Buka privasi DM kamu.");
            }
        }
        else if (i.customId.startsWith('modalAdminSetup')) {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const tempId = i.customId.split('###')[1];
            const questData = DB.state.tempQuestCache.get(tempId);

            if (!questData) return i.editReply("❌ Data expired.");

            const deadlineInput = i.fields.getTextInputValue('deadline');
            const adminNote = i.fields.getTextInputValue('note');

            // Update Data
            questData.deadline = deadlineInput;
            questData.adminNote = adminNote;

            const boardChId = DB.state.settings['QUEST_BOARD_ID'];
            const boardCh = client.channels.cache.get(boardChId);
            if (!boardCh) return i.editReply("❌ Channel Board belum disetting.");

            // --- [LOGIKA SMART TAG] ---
            const ROLE_IDS = {
                editor: "1407582653800120362", // ID Role Editor
                etl: "1455040182192701614"     // ID Role Translator Inggris (Default)
            };

            let tagRole = "";

            // 1. Cek Apakah Editor?
            if (questData.role === 'editor') {
                tagRole = ROLE_IDS.editor;
            }
            // 2. Cek Apakah Translator? (Sesuaikan dengan Origin)
            else if (questData.role === 'translator') {
                tagRole = ROLE_IDS.etl;
            }

            // --- [GENERATE EMBED] ---
            const hasBonus = questData.bonus && questData.bonus > 0;
            const rewardText = hasBonus ? "🔥 **Bonus Menanti**" : "Tambahan Duit";
            const publicEmbed = new EmbedBuilder()
                .setTitle(`🛡️ QUEST: ${questData.role.toUpperCase()}`)
                .setDescription(`**${questData.title}**\n\n📝 **Deskripsi:**\n${questData.desc}\n\n⚠️ **Note Admin:** ${adminNote || "-"}`)
                .addFields(
                    { name: "🧩 Tipe", value: questData.type.toUpperCase(), inline: true },
                    { name: "⏰ Deadline", value: `**${deadlineInput}**`, inline: true },
                    { name: "💰 Reward", value: rewardText, inline: true },
                    { name: "📚 Chapters", value: questData.rawChapters, inline: true }
                )
                .setColor(hasBonus ? 0xFF4500 : 0x00FF00)
                .setFooter({ text: `Quest ID: ${questData.id} • Creator: Dicari` });

            // Generate Components (Button/Menu)
            const components = [];
            if (questData.chapterList.length <= 5) {
                const btnRow = new ActionRowBuilder();
                questData.chapterList.forEach(ch => {
                    btnRow.addComponents(new ButtonBuilder().setCustomId(`btn_q_take_ch###${questData.id}###${ch}`).setLabel(`Ambil Ch ${ch}`).setStyle(ButtonStyle.Primary));
                });
                components.push(btnRow);
            } else {
                const menu = new StringSelectMenuBuilder().setCustomId(`menu_q_take_ch###${questData.id}`).setPlaceholder("Pilih Chapter yang mau diambil...");
                questData.chapterList.slice(0, 25).forEach(ch => menu.addOptions({ label: `Chapter ${ch}`, value: ch, emoji: "📜" }));
                components.push(new ActionRowBuilder().addComponents(menu));
            }

            // --- [KIRIM PESAN DENGAN TAG SPESIFIK] ---
            const msg = await boardCh.send({
                content: `<@&${tagRole}> **Quest Baru Tersedia!**`, // <--- Ini otomatis ngetag role yang sesuai
                embeds: [publicEmbed],
                components: components
            });

            // Simpan ke Memory & Excel
            const newQuest = {
                id: questData.id, creatorId: questData.creatorId, title: questData.title,
                slots: new Map(), deadline: deadlineInput, pricePerCh: questData.pricePerCh, totalCost: questData.totalCost, bonus: questData.bonus || 0,
                boardMsgId: msg.id, channelId: boardChId
            };
            questData.chapterList.forEach(ch => newQuest.slots.set(ch, { workerId: null, status: 'OPEN' }));
            DB.state.activeQuests.set(newQuest.id, newQuest);
            await DB.addQuestLog(newQuest);

            // Notif Creator
            try {
                const creator = await client.users.fetch(questData.creatorId);
                await creator.send(`✅ **Quest Approved!**\nAdmin telah memposting quest **${questData.title}**.\n📅 Deadline: ${deadlineInput}`);
            } catch (e) { }

            await i.editReply("✅ **Quest Diposting dengan Tag Role Spesifik!**");
        }
        else if (i.customId === 'modalCuti') {
            await i.deferReply();

            const reason = i.fields.getTextInputValue('reason');
            const user = i.user;
            const member = i.member;

            // 1. PROSES LEPAS TUGAS (Logika Lama)
            let releasedTasks = [];
            for (const [taskId, task] of DB.state.tasks) {
                const slotEntry = Object.entries(task.takenBy).find(([idx, userId]) => userId === user.id);
                if (slotEntry) {
                    const [idxStr, _] = slotEntry;
                    delete task.takenBy[idxStr];
                    delete task.deadlines[idxStr];
                    delete task.remindedLevels[idxStr];
                    if (task.pendingReview) delete task.pendingReview[idxStr];

                    await DB.saveTask(task, View.generateSummary(task));
                    try {
                        const msg = await client.channels.cache.get(task.channelId).messages.fetch(taskId);
                        if (msg) await msg.edit({ embeds: [View.createTaskEmbed(task)], components: View.createButtons(task) });
                    } catch (e) { }

                    releasedTasks.push(task.title);
                }
            }

            // 2. UPDATE DATABASE & ROLE
            await DB.updateUserStatus(user.id, { onLeave: true, immunityUntil: 0, username: user.username });
            try {
                if (member.roles.cache.has(ROLE_ACTIVE)) await member.roles.remove(ROLE_ACTIVE);
                if (!member.roles.cache.has(ROLE_WARNING)) await member.roles.add(ROLE_WARNING);
            } catch (e) { }

            // 3. KIRIM LOG KE ADMIN (Pakai Alasan)
            await Logger.sendLog(client, "🏖️ Staff Cuti", `User: <@${user.id}>\n**Alasan:** ${reason}\nReleased: ${releasedTasks.join(', ') || "-"}`, "Orange");

            // 4. BUAT EMBED HASIL (Sesuai Request)
            const cutiEmbed = new EmbedBuilder()
                .setTitle("✅ Izin Cuti Diterima")
                .setColor(0xFFA500) // Orange Cuti
                .setThumbnail(user.displayAvatarURL())
                .setDescription(`Status kamu sekarang: **CUTI / NON-AKTIF**.\nGunakan command \`/active\` jika sudah siap bekerja kembali.`)
                .addFields(
                    { name: "👤 Nama Staff", value: `<@${user.id}>`, inline: true },
                    { name: "📝 Alasan", value: reason, inline: false }
                )
                .setFooter({ text: "Soulscans HR System", iconURL: client.user.displayAvatarURL() })
                .setTimestamp();

            // Kalau ada tugas yang dilepas otomatis, tampilkan listnya
            if (releasedTasks.length > 0) {
                cutiEmbed.addFields({ name: "🗑️ Tugas Dilepas Otomatis", value: releasedTasks.map(t => `• ${t}`).join("\n"), inline: false });
            }

            await i.editReply({ embeds: [cutiEmbed] });
        }
    }
    async function handleTakeSlot(i, questId, chapter) {
        try {
            await i.deferReply({ flags: MessageFlags.Ephemeral });

            // 1. Cek Data Quest
            const quest = DB.state.activeQuests.get(questId);
            if (!quest) return i.editReply("❌ **Error:** Quest ini sudah tidak aktif/dihapus.");

            // 2. Self-Healing Slot
            if (!quest.slots) quest.slots = new Map();
            let slot = quest.slots.get(chapter);
            if (!slot) {
                slot = { workerId: null, status: 'OPEN' };
                quest.slots.set(chapter, slot);
            }

            // 3. Validasi Slot
            if (slot.workerId) return i.editReply("❌ **Telat!** Slot ini sudah diambil orang lain.");

            // 4. Validasi User (Cek Quest Lain)
            for (const [otherQId, otherQData] of DB.state.activeQuests) {
                if (otherQId !== questId && otherQData.slots) {
                    for (const [_, otherSlot] of otherQData.slots) {
                        if (otherSlot && otherSlot.workerId === i.user.id && otherSlot.status !== 'DONE') {
                            return i.editReply(`🚫 **Ditolak:** Selesaikan dulu quest **${otherQData.title}** sebelum ambil yang baru.`);
                        }
                    }
                }
            }

            // 5. UPDATE DATA (RAM & EXCEL)
            slot.workerId = i.user.id;
            slot.status = 'TAKEN';

            try { await DB.saveQuestSlots(questId); }
            catch (e) { console.error("Gagal save excel:", e); }

            // ============================================================
            // 6. [BARU] UPDATE TAMPILAN TOMBOL DI DISCORD (VISUAL)
            // ============================================================
            try {
                const boardCh = i.client.channels.cache.get(quest.channelId);
                if (boardCh) {
                    const msg = await boardCh.messages.fetch(quest.boardMsgId).catch(() => null);

                    if (msg) {
                        // Ambil komponen lama
                        const oldRows = msg.components;
                        const newRows = [];

                        // Loop setiap baris tombol (ActionRow)
                        for (const row of oldRows) {
                            const newRow = new ActionRowBuilder();

                            // Loop setiap tombol di baris itu
                            for (const component of row.components) {
                                const btn = ButtonBuilder.from(component); // Clone tombol lama

                                // Cek apakah ini tombol yang baru saja diklik?
                                // ID Tombol format: btn_q_take_ch###ID_QUEST###CHAPTER
                                const targetId = `btn_q_take_ch###${questId}###${chapter}`;

                                if (btn.data.custom_id === targetId) {
                                    // Ubah jadi MERAH (Secondary/Danger) & DISABLED
                                    btn.setStyle(ButtonStyle.Secondary); // Jadi abu-abu
                                    btn.setDisabled(true); // Gak bisa diklik lagi
                                    btn.setLabel(`Ch ${chapter} (Taken)`);
                                }

                                newRow.addComponents(btn);
                            }
                            newRows.push(newRow);
                        }

                        // Update Pesan Asli
                        await msg.edit({ components: newRows });
                    }
                }
            } catch (visualError) {
                console.error("Gagal update tombol visual:", visualError);
                // Tidak perlu return error ke user, karena data sudah tersimpan
            }

            // 7. Feedback Sukses
            await i.editReply(`✅ **Berhasil Ambil Chapter ${chapter}!**\nTombol di papan quest sudah diupdate.`);

        } catch (error) {
            console.error("CRASH handleTakeSlot:", error);
            await i.editReply(`⚠️ **Error:** ${error.message}`);
        }
    }
    async function handleSelectMenu(i, client) {
        if (DB.state.isMaintenance) {
            return i.reply({
                content: "⚠️ **SEDANG MAINTENANCE**\nBot sedang dalam mode perbaikan/backup data. Mohon tunggu admin menyelesaikan proses ini.",
                flags: MessageFlags.Ephemeral
            });
        }
        try {
            // ====================================================
            // A. MENU SEARCH SUWAYOMI (ADD MANGA)
            // ====================================================
            if (i.customId === 'menu_search_result') {
                // Defer agar tidak timeout
                await i.deferReply({ flags: MessageFlags.Ephemeral });

                // Value dropdown: "ID_MANGA###SOURCE_ID"
                const [mangaId, sourceMode] = i.values[0].split('###');
                console.log(`📥 [MENU] User memilih Manga ID: ${mangaId}`);

                // Panggil fungsi Add Manga
                const result = await Suwayomi.addManga(mangaId);

                if (result) {
                    const embed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle("✅ Berhasil Ditambahkan!")
                        .setThumbnail(result.thumbnailUrl || null)
                        .setDescription(`📖 **Judul:** ${result.title}\n🆔 **ID Library:** \`${result.id}\`\n\nSekarang bisa dibaca/didownload.`);

                    // Tombol Shortcut
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setLabel("Lihat Chapter").setStyle(ButtonStyle.Primary).setCustomId(`manga_chapters_btn_${result.id}`)
                    );

                    // Note: Jika belum ada logic 'manga_chapters_btn', hapus components: [row] agar tidak error
                    await i.editReply({ embeds: [embed] });

                    try {
                        const notifChannelId = DB.state.settings['MANGA_CHANNEL_ID'];

                        if (notifChannelId) {
                            const notifChannel = client.channels.cache.get(notifChannelId);

                            if (notifChannel) {
                                // Rapikan Data (Handling kalau datanya null)
                                const genres = result.genre ? result.genre.join(', ') : "-";
                                const authors = result.author || result.artist || "-";
                                const status = result.status || "UNKNOWN";
                                const totalCh = result.chapters?.totalCount || 0;
                                const sourceName = result.source?.displayName || result.sourceId || "Unknown Source";

                                // Potong Deskripsi kalau kepanjangan (Discord max 1024 chars per field)
                                let desc = result.description || "Tidak ada sinopsis.";
                                if (desc.length > 800) desc = desc.substring(0, 797) + "...";

                                // Embed Publik (INFO LENGKAP)
                                const publicEmbed = new EmbedBuilder()
                                    .setColor(0x9B59B6) // Ungu Elegan
                                    .setTitle("📚 MANGA BARU DITAMBAHKAN")
                                    .setDescription(`### [${result.title}](${result.realUrl || '#'})`) // Judul jadi Link
                                    .setThumbnail(result.thumbnailUrl || null)
                                    .addFields(
                                        { name: "📝 Sinopsis", value: desc, inline: false },
                                        { name: "👤 Author", value: authors, inline: true },
                                        { name: "📊 Status", value: status, inline: true },
                                        { name: "📑 Total Chapter", value: `${totalCh} Ch`, inline: true },
                                        { name: "🎭 Genre", value: genres, inline: false },
                                        { name: "🌍 Source", value: sourceName, inline: false }
                                    )
                                    .setFooter({ text: `Added by ${i.user.username} • ID: ${result.id}`, iconURL: i.user.displayAvatarURL() })
                                    .setTimestamp();

                                // Kirim TANPA TOMBOL (Sesuai request)
                                await notifChannel.send({ embeds: [publicEmbed], components: [] });

                                console.log(`✅ Notif Lengkap dikirim ke channel ${notifChannel.name}`);
                            }
                        }
                    } catch (notifErr) {
                        console.error("❌ Gagal kirim notif:", notifErr);
                    }

                } else {
                    await i.editReply("❌ Gagal menambahkan ke Library. Cek terminal bot untuk detail error.");
                }
            }
            if (i.customId === 'menu_stop') {
                const taskId = i.values[0]; const task = DB.state.tasks.get(taskId);
                if (task) { DB.state.dirtyTaskIds.add(taskId); DB.state.tasks.delete(taskId); try { const msg = await client.channels.cache.get(task.channelId).messages.fetch(taskId); await msg.delete(); } catch (e) { } await Logger.sendLog(client, "⛔ Stop Tugas", `Judul: **${task.title}**`, "Red"); await i.update({ content: `✅ Dihapus.`, components: [] }); }
            } else if (i.customId === 'menu_cancel') {
                const [taskId, idx] = i.values[0].split('_'); const task = DB.state.tasks.get(taskId);
                if (task) { delete task.takenBy[idx]; delete task.deadlines[idx]; delete task.remindedLevels[idx]; if (task.pendingReview) delete task.pendingReview[idx]; await DB.saveTask(task, View.generateSummary(task)); try { const msg = await client.channels.cache.get(task.channelId).messages.fetch(taskId); await msg.edit({ embeds: [View.createTaskEmbed(task)], components: View.createButtons(task) }); } catch (e) { } await Logger.sendLog(client, "↩️ Cancel", `User: <@${i.user.id}>`, "Orange"); } await i.update({ content: "✅ Cancelled.", components: [] });
            }
            if (i.customId.startsWith('menu_q_take_ch')) {
                const qId = i.customId.split('###')[1];
                const ch = i.values[0];
                await handleTakeSlot(i, qId, ch);
            }

        } catch (error) {
            console.error("⚠️ Menu Error:", error);
            if (!i.replied && !i.deferred) {
                await i.reply({ content: `❌ Error Sistem: ${error.message}`, flags: MessageFlags.Ephemeral });
            } else {
                await i.editReply({ content: `❌ Terjadi kesalahan: ${error.message}` });
            }
        }
    }


    // [BARU] FUNGSI AUTOCOMPLETE - FIXED NAMES
    async function handleAutocomplete(i, client) {
        if (DB.state.isMaintenance) {
            return i.respond({
                content: "⚠️ **SEDANG MAINTENANCE**\nBot sedang dalam mode perbaikan/backup data. Mohon tunggu admin menyelesaikan proses ini.",
                flags: MessageFlags.Ephemeral
            });
        }
        const focused = i.options.getFocused(true);

        if (focused.name === 'task_id') {
            // Ambil daftar tugas dari Excel yang HILANG dari RAM
            const lostTasks = await DB.getRecoverableTasks();
            const input = focused.value.toLowerCase();

            const filtered = lostTasks.filter(t => t.title.toLowerCase().includes(input));

            // Format Tampilan: "Judul [Status]"
            const choices = filtered.slice(0, 25).map(t => ({
                name: `🚑 ${t.title.substring(0, 50)} [${t.status}]`,
                value: t.id
            }));

            try { await i.respond(choices); } catch (err) { }
        }

        // 1. AUTOCOMPLETE: LELANG (Perbaiki nama: 'lelang')
        if (focused.name === 'lelang') {
            const myTasks = [];
            DB.state.tasks.forEach((task, id) => {
                Object.entries(task.takenBy).forEach(([idx, userId]) => {
                    if (userId === i.user.id) {
                        myTasks.push({ name: `${task.title} (${task.labels[idx]})`.substring(0, 100), value: `${id}###${idx}` });
                    }
                });
            });
            try { await i.respond(myTasks); } catch (err) { }
        }

        // 2. AUTOCOMPLETE: JUDUL
        else if (focused.name === 'title' || focused.name === 'judul') {
            const input = focused.value.toLowerCase();
            const filtered = DB.state.titles.filter(t => t.name.toLowerCase().includes(input));
            const choices = filtered.slice(0, 25).map(t => ({ name: `${t.name} (ID: ${t.id})`, value: t.name.substring(0, 100) }));
            try { await i.respond(choices); } catch (err) { }
        }

        // 3. AUTOCOMPLETE: ROLE
        else if (focused.name === 'role') {
            const input = focused.value.toLowerCase();
            const choices = DB.state.roles.filter(r => r.name.toLowerCase().includes(input)).slice(0, 25).map(r => ({ name: r.name, value: r.id }));
            try { await i.respond(choices); } catch (err) { }
        }

        // 4. [UPDATE] AUTOCOMPLETE: ID QUEST (FORMAT BARU)
        const choices = [];
        const input = focused.value.toLowerCase();

        // MODE A: JIKA SEDANG PAKAI COMMAND /ASSIGN (Cari Tugas Lelang Biasa)
        if (i.commandName === 'assign') {
            DB.state.tasks.forEach((task, taskId) => {
                // Filter Judul sesuai ketikan
                if (task.title.toLowerCase().includes(input)) {
                    // Loop semua chapter di tugas ini
                    task.labels.forEach((label, idx) => {
                        const idxStr = idx.toString();

                        // Cek apakah slot ini SUDAH SELESAI? (Skip kalau sudah done)
                        // Kita pakai String() untuk aman karena completed isinya string
                        const isDone = task.completed.some(c => c.toString() === idxStr);

                        if (!isDone) {
                            const worker = task.takenBy[idxStr];
                            const status = worker ? `👤 Taken` : "🟢 OPEN";

                            // Format: "Judul (Ch X) - Status"
                            // Potong judul biar gak kepanjangan
                            const shortTitle = task.title.length > 40 ? task.title.substring(0, 37) + "..." : task.title;

                            choices.push({
                                name: `${shortTitle} | Ch ${label} [${status}]`,
                                value: `${taskId}###${idxStr}` // Format Value: ID_TUGAS###INDEX
                            });
                        }
                    });
                }
            });
        }

        // MODE B: DEFAULT / LAPOR QUEST (Cari Quest Berbayar)
        else {
            const userId = i.user.id;
            if (DB.state.activeQuests) {
                DB.state.activeQuests.forEach((quest) => {
                    if (quest.slots) {
                        quest.slots.forEach((slotData, chNum) => {
                            // Filter: Hanya tampilkan slot milik User yg request & belum selesai
                            if (slotData && slotData.workerId === userId && slotData.status !== 'DONE') {
                                const shortTitle = quest.title.length > 30 ? quest.title.substring(0, 30) + "..." : quest.title;
                                choices.push({
                                    name: `📝 Ch ${chNum} | ${shortTitle} (ID: ${quest.id})`,
                                    value: `${quest.id}###${chNum}`
                                });
                            }
                        });
                    }
                });
            }
        }

        // Return maksimal 25 pilihan (Limit Discord)
        try { await i.respond(choices.slice(0, 25)); } catch (err) { }
    }

    async function sendNotification(client, userId, text, channel) {
        try { const u = await client.users.fetch(userId); await u.send(text); return true; } catch (e) { if (channel) await channel.send({ content: `<@${userId}> 🔒 **DM Kamu Tertutup!**\n${text}` }).catch(() => { }); return false; }
    }

    async function checkAndMigrateTask(client, task) {
        const uniqueCompleted = new Set(task.completed);

        if (uniqueCompleted.size >= task.labels.length) {
            const doneChannelId = DB.state.settings['DONE_CHANNEL_ID'];
            if (!doneChannelId) return;

            const doneChannel = client.channels.cache.get(doneChannelId);
            if (doneChannel) {
                const doneEmbed = View.createTaskEmbed(task);
                doneEmbed.setColor(0x808080);
                doneEmbed.setTitle(`[SELESAI] ${task.title}`);
                doneEmbed.setFooter({ text: `Task ID: ${task.id} | Selesai pada: ${new Date().toLocaleTimeString('id-ID')}` });

                const newMsg = await doneChannel.send({ embeds: [doneEmbed], components: [] });

                try {
                    const oldMsg = await client.channels.cache.get(task.channelId).messages.fetch(task.id);
                    if (oldMsg) await oldMsg.delete();
                } catch (e) { }

                const oldId = task.id;
                DB.state.dirtyTaskIds.add(oldId);
                DB.state.tasks.delete(oldId);

                task.id = newMsg.id;
                task.channelId = doneChannelId;

                task.completed = [...uniqueCompleted];

                DB.state.tasks.set(task.id, task);
                DB.state.dirtyTaskIds.add(task.id);
                console.log(`📦 Tugas ${task.title} dipindahkan ke Arsip.`);
            }
        }
    }

    async function checkAndUnfreezeEditor(client, tlTitle, tlChapter, sourceChannel) {
        try {
            const cleanTitle = tlTitle.trim().toLowerCase();
            // ID ROLE EDITOR (Pastikan sama dengan konstanta di atas)
            const EDITOR_ROLE_ID = "1407582653800120362";

            for (const [taskId, task] of DB.state.tasks) {
                // Cari Tugas Editor yang judulnya sama
                if (task.roleId !== EDITOR_ROLE_ID) continue;
                if (task.title.trim().toLowerCase() !== cleanTitle) continue;

                // Cari Chapter yang sama
                const idx = task.labels.findIndex(l => l === tlChapter);
                if (idx === -1) continue;

                // Cek Status: HARUS 'TAKEN' dan 'DEADLINE === 0' (Beku)
                if (task.takenBy[idx] && task.deadlines[idx] === 0) {

                    const editorId = task.takenBy[idx];

                    // 1. Nyalakan Timer (Start Sekarang)
                    task.deadlines[idx] = Date.now() + task.duration;

                    // 2. Simpan & Update Visual
                    await DB.saveTask(task, View.generateSummary(task));
                    try {
                        const msg = await client.channels.cache.get(task.channelId).messages.fetch(taskId);
                        await msg.edit({ embeds: [View.createTaskEmbed(task)], components: View.createButtons(task) });
                    } catch (e) { }

                    // 3. Notifikasi Editor
                    const notifText = `🔔 **TL sudah Ready!**\nTranslator untuk **${task.title} - Ch ${tlChapter}** sudah selesai.\n\n🔥 **Timer kamu BERJALAN mulai sekarang!**\nSilakan download TL & kerjakan.`;
                    await sendNotification(client, editorId, notifText, sourceChannel);
                    console.log(`❄️➡️🔥 Unfreezing Editor ${editorId} for ${task.title} Ch ${tlChapter}`);
                }
            }
        } catch (err) {
            console.error("❌ Error Unfreeze:", err);
        }
    }

    function createLibraryListEmbed(mangas, offset, total, user) {
        // Susun List Teks
        // Format: "1. Judul Manga (Source)"
        const listText = mangas.map((m, idx) => {
            const num = offset + idx + 1;
            const sourceName = m.source?.displayName || "Unknown Source";
            const titleLink = m.realUrl ? `[${m.title}](${m.realUrl})` : m.title; // Judul jadi Link kalau ada URL

            // Tampilan Baris: 
            // 1. Judul Manga
            //    └ 🌍 Source: Asura Scans
            return `**${num}. ${titleLink}**\n   └ 🌍 ${sourceName}`;
        }).join('\n\n'); // Kasih jarak antar item biar rapi

        return new EmbedBuilder()
            .setColor(0x00AAFF)
            .setTitle(`📚 LIBRARY SOULSCANS (${total} Judul)`)
            .setDescription(listText || "Data kosong.")
            .setFooter({ text: `Menampilkan ${offset + 1}-${Math.min(offset + mangas.length, total)} dari ${total}`, iconURL: user.displayAvatarURL() })
            .setTimestamp();
    }

    function createListButtons(offset, limit, total) {
        const row = new ActionRowBuilder();

        // Tombol PREV
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`lib_nav_prev_${offset}`)
                .setLabel('⬅️ Prev 10')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(offset === 0)
        );

        // Tombol Indikator Halaman
        const currentPage = Math.floor(offset / limit) + 1;
        const totalPage = Math.ceil(total / limit);

        row.addComponents(
            new ButtonBuilder()
                .setCustomId('lib_nav_info')
                .setLabel(`Halaman ${currentPage} / ${totalPage}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );

        // Tombol NEXT
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`lib_nav_next_${offset}`)
                .setLabel('Next 10 ➡️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(offset + limit >= total)
        );

        return row;
    }

    module.exports = { handleCommand, handleModal, handleButton, handleSelectMenu, handleAutocomplete };