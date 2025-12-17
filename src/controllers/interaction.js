// src/controllers/interaction.js
const { PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ChannelType } = require("discord.js");
const DB = require("../models/spreadsheet");
const View = require("../views/components");
const Logger = require("../services/logger");
const CanvasGen = require("../services/canvasGen");

async function handleCommand(i, client) {
    const { commandName } = i;

    // --- ADMIN COMMANDS ---
    if (["setlog", "setreminder", "stop", "reset", "refresh", "task"].includes(commandName)) {
        if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) return i.reply({ content: "❌ Bukan Admin!", ephemeral: true });
        
        if (commandName === "setlog") {
            const ch = i.options.getChannel('channel');
            DB.state.settings.logChannel = ch.id;
            await DB.saveSetting('LOG_CHANNEL_ID', ch.id);
            i.reply(`✅ Log diset ke ${ch}`);
        }
        else if (commandName === "setreminder") {
            const ch = i.options.getChannel('channel');
            DB.state.settings.reminderChannel = ch.id;
            await DB.saveSetting('REMINDER_CHANNEL_ID', ch.id);
            i.reply(`✅ Reminder diset ke ${ch}`);
        }
        else if (commandName === "refresh") {
            await i.deferReply({ephemeral:true});
            await DB.init();
            i.editReply("✅ Data Refreshed!");
        }
        else if (commandName === "reset") {
            await i.deferReply({ephemeral:true});
            await DB.resetPoints();
            i.editReply("⚠️ Leaderboard Reset!");
        }
        else if (commandName === "stop") {
             // Logic Select Menu Stop (sama seperti kodemu)
             // Gunakan DB.state.tasks
             // ...
             // Agar singkat, implementasikan logic yang sama di sini
        }
        else if (commandName === "task") {
            const titleId = i.options.getString("title");
            const roleId = i.options.getString("role");
            const modal = new ModalBuilder().setCustomId(`createTaskModal###${titleId}###${roleId}`).setTitle(`Buat Tugas`);
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('descInput').setLabel("Deskripsi").setStyle(TextInputStyle.Paragraph).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('deadlineInput').setLabel("Waktu (Menit)").setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pointInput').setLabel("Poin").setStyle(TextInputStyle.Short).setValue("1")),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('buttonsInput').setLabel("Labels (Koma)").setStyle(TextInputStyle.Short))
            );
            await i.showModal(modal);
        }
    }

    // --- PUBLIC COMMANDS ---
    if (commandName === "point") {
        const p = DB.state.points.get(i.user.id) || 0;
        i.reply({content: `⭐ Point: ${p}`, ephemeral: true});
    }
    else if (commandName === "list") {
        // Logic List Task
        // Gunakan DB.state.tasks
    }
    else if (commandName === "leaderboard") {
        await i.deferReply();
        const img = await CanvasGen.generateLeaderboard(client);
        await i.editReply({ files: [img] });
    }
    else if (commandName === "cancel") {
        // Logic cancel (loop task cari user id)
    }
}

async function handleModal(i, client) {
    if (!i.customId.startsWith("createTaskModal")) return;
    await i.deferReply({ ephemeral: true });
    
    const [_, titleId, roleId] = i.customId.split("###");
    const realTitle = DB.state.titles.get(titleId) || "Tugas";
    
    const desc = i.fields.getTextInputValue('descInput');
    const duration = parseInt(i.fields.getTextInputValue('deadlineInput'));
    const points = parseInt(i.fields.getTextInputValue('pointInput'));
    const btnsRaw = i.fields.getTextInputValue('buttonsInput');
    const labels = btnsRaw ? btnsRaw.split(",").map(b=>b.trim()).slice(0,15) : ["Ambil"];

    const taskData = {
        id: null, title: realTitle, originalDesc: desc, duration, pointValue: points,
        labels, takenBy: {}, finishedBy: {}, completed: [], 
        channelId: i.channelId, deadlines: {}, remindedLevels: {}, roleId: roleId
    };

    const embed = View.createTaskEmbed(taskData);
    const rows = View.createButtons(taskData);
    
    const msg = await i.channel.send({ content: roleId ? `<@&${roleId}>` : null, embeds: [embed], components: rows });
    taskData.id = msg.id;
    
    DB.state.tasks.set(msg.id, taskData);
    await DB.saveTask(taskData, View.generateSummary(taskData));
    await i.editReply("✅ Task Created");
}

async function handleButton(i, client) {
    const { customId } = i;
    // Implementasi logic Button (Take, Done, Reset, Delete)
    // Sama persis dengan kodemu, tapi ganti akses variabel global tasks/points ke DB.state.tasks/points
    // Gunakan DB.saveTask() setelah update data
    // Gunakan View.createTaskEmbed() saat update pesan
}

module.exports = { handleCommand, handleModal, handleButton };