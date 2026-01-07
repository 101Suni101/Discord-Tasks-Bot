// src/index.js
const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, MessageFlags } = require("discord.js");
const CONFIG = require("../config/config");
const DB = require("./models/spreadsheet");
const Reminder = require("./services/reminder");
const InteractionCtrl = require("./controllers/interaction");
const Monitor = require("./services/monitor");
const AntiCrash = require("./services/antiCrash");
const Suwayomi = require("./services/suwayomi");
const AutoUpdate = require('./services/autoUpdate');
const RawWatcher = require("./services/rawWatcher");

// Inisialisasi Client Discord
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages]
});

const commands = [

    new SlashCommandBuilder()
        .setName('maintenance')
        .setDescription('⚙️ Mode Perbaikan (Admin Only)')
        .addStringOption(option =>
            option.setName('status')
                .setDescription('Hidupkan atau Matikan?')
                .setRequired(true)
                .addChoices(
                    { name: '🟢 ON (Kunci Bot & Save)', value: 'on' },
                    { name: '🔴 OFF (Buka Bot)', value: 'off' }
                )
        ),

    // 1. Command Admin: Buat Tugas
    new SlashCommandBuilder()
        .setName('task')
        .setDescription('Buat tugas baru (Admin)')
        .addStringOption(option =>
            option.setName('title').setDescription('Pilih Judul Tugas').setAutocomplete(true).setRequired(true))
        .addStringOption(option =>
            option.setName('role').setDescription('Pilih Role Target').setAutocomplete(true).setRequired(true))
        .addStringOption(option =>
            option.setName('tipe')
                .setDescription('Tipe urgensi tugas (Menentukan Bonus)')
                .setRequired(true)
                .addChoices(
                    { name: '🟢 Normal (Harga Sesuai Excel)', value: 'normal' },
                    { name: '🔴 SR/Balapan (+3 Poin)', value: 'fast' },
                )
        ),
    // 2. Command Admin: Konfigurasi
    new SlashCommandBuilder()
        .setName('config')
        .setDescription('Atur konfigurasi channel bot (Admin)')
        .addStringOption(option =>
            option.setName('tipe')
                .setDescription('Apa yang ingin diatur?')
                .setRequired(true)
                .addChoices(
                    { name: '📜 Channel Log Aktivitas', value: 'LOG_CHANNEL_ID' },
                    { name: '🚨 Channel Laporan (Report)', value: 'REPORT_CHANNEL_ID' },
                    { name: '⏰ Channel Reminder', value: 'REMINDER_CHANNEL_ID' },
                    { name: '🌐 Channel Monitor Web', value: 'MONITOR_CHANNEL_ID' },
                    { name: '✅ Channel Tugas Selesai', value: 'DONE_CHANNEL_ID' },
                    { name: 'Channel Admin (Quest QC)', value: 'ADMIN_CHANNEL_ID' },
                    { name: 'Channel Board (Quest Public)', value: 'QUEST_BOARD_ID' },
                    { name: 'Notif Raw', value: 'MANGA_CHANNEL_ID' }
                )
        )
        .addChannelOption(opt =>
            opt.setName('channel')
                .setDescription('Pilih channel tujuannya')
                .setRequired(true)
        ),

    // Command Quest
    new SlashCommandBuilder()
        .setName('quest')
        .setDescription('Buat Quest Berbayar (Jasa Editor/TL)')
        .addStringOption(option =>
            option.setName('role')
                .setDescription('Role Target')
                .setRequired(true)
                .addChoices(
                    { name: 'Editor', value: 'editor' },
                    { name: 'Translator', value: 'translator' }
                ))
        .addStringOption(option =>
            option.setName('origin')
                .setDescription('Asal Komik')
                .setRequired(true)
                .addChoices(
                    { name: 'Manhwa (Korea)', value: 'manhwa' },
                    { name: 'Manhua (China)', value: 'manhua' },
                    { name: 'Manga (Jepang)', value: 'manga' }
                )),

    // 3. Command Lapor (Wajib)
    new SlashCommandBuilder()
        .setName('lapor')
        .setDescription('📝 Menu pelaporan pekerjaan')
        // Opsi A: Lapor Lelang (Tugas Bot)
        .addSubcommand(sub =>
            sub.setName('lelang')
                .setDescription('✅ Lapor tugas LELANG yang kamu ambil dari bot')
                .addStringOption(opt => opt.setName('lelang').setDescription('Pilih tugas lelangnya').setAutocomplete(true).setRequired(true))
                .addStringOption(opt => opt.setName('optional').setDescription('Link/Deskripsi pekerjaan').setRequired(false))
                .addAttachmentOption(opt => opt.setName('file').setDescription('Kirimkan versi ZIP').setRequired(false))
        )
        // Opsi B: Lapor Tetap (Harian/Manual)
        .addSubcommand(sub =>
            sub.setName('tetap')
                .setDescription('📝 Lapor aktivitas TETAP / Harian (Non-Bot)')
                .addStringOption(opt => opt.setName('judul').setDescription('Judul aktivitas').setAutocomplete(true).setRequired(true))
                .addStringOption(opt => opt.setName('chapter').setDescription('Chapter yang dikerjakan').setRequired(true))
                .addAttachmentOption(opt => opt.setName('file').setDescription('Kirimkan versi ZIP').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('quest')
                .setDescription('Lapor pengerjaan Quest Berbayar')
                .addStringOption(o => o.setName('id_quest').setDescription('Masukkan ID Quest (Contoh: Q-12345)').setAutocomplete(true).setRequired(true))
                .addAttachmentOption(o => o.setName('file').setDescription('File hasil pengerjaan (ZIP/Image)').setRequired(false))
        ),

    // 4. COMMAND HELP
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('📖 Panduan lengkap penggunaan bot & daftar command'),

    // 5. Command Admin Lainnya
    new SlashCommandBuilder().setName('stop').setDescription('Hentikan tugas (Admin)').addSubcommand(sub => sub.setName('select').setDescription('Pilih satu tugas untuk distop (Dropdown)')).addSubcommand(sub => sub.setName('all').setDescription('⚠️ BAHAYA: Hentikan SEMUA tugas sekaligus!')),
    new SlashCommandBuilder().setName('reset').setDescription('Reset Leaderboard & Poin (Admin)'),
    new SlashCommandBuilder().setName('refresh').setDescription('Reload Data Excel (Admin)'),
    new SlashCommandBuilder().setName('save').setDescription('⚠️ Force Save & Download Backup Excel (Admin Only)'),

    // 6. Command Public (User)
    new SlashCommandBuilder().setName('stats').setDescription('Lihat kartu statistik karyawan').addUserOption(opt => opt.setName('user').setDescription('Lihat stats orang lain (Khusus Admin)')),
    new SlashCommandBuilder().setName('leaderboard').setDescription('Lihat papan peringkat Top 10'),
    new SlashCommandBuilder().setName('list').setDescription('Lihat daftar tugas yang sedang aktif'),
    new SlashCommandBuilder().setName('cancel').setDescription('Batalkan tugas yang sedang kamu kerjakan'),

    // 7. Fitur Cuti
    new SlashCommandBuilder().setName('active').setDescription('✋ Saya Kembali Aktif!'),
    new SlashCommandBuilder().setName('cuti').setDescription('🏖️ Saya Izin Cuti'),

    new SlashCommandBuilder().setName('manga_search').setDescription('🔍 Cari manga di Suwayomi')
        .addStringOption(o => o.setName('query').setDescription('Judul Manga').setRequired(true))
        .addStringOption(o => o.setName('source_id').setDescription('ID Source (Opsional)')),

    new SlashCommandBuilder().setName('manga_detail').setDescription('📚 Lihat detail manga')
        .addStringOption(o => o.setName('id').setDescription('ID Manga').setRequired(true)),

    new SlashCommandBuilder().setName('manga_dl').setDescription('⬇️ Download Chapter')
        .addStringOption(o => o.setName('manga_id').setDescription('ID Manga').setRequired(true))
        .addIntegerOption(o => o.setName('chapter_index').setDescription('Index Chapter').setRequired(true)),

    new SlashCommandBuilder().setName('manga_library').setDescription('📂 Lihat Library Manga'),
    new SlashCommandBuilder().setName('manga_sources').setDescription('🌐 Lihat Source Tersedia'),
    new SlashCommandBuilder()
        .setName('manga_add')
        .setDescription('Masukan manga ke Library (Gunakan ID dari hasil search)')
        .addStringOption(option =>
            option.setName('manga_id') // Ganti jadi manga_id
                .setDescription('ID Manga (Didapat dari /manga_search)')
                .setRequired(true)),

    // COMMAND BARU 2: CARI EXTENSION
    new SlashCommandBuilder()
        .setName('ext_search')
        .setDescription('Cari plugin extension baru di Repo')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Nama source (Contoh: Asura, Flame, Komikcast)')
                .setRequired(true)),

    // COMMAND BARU 3: INSTALL EXTENSION
    new SlashCommandBuilder()
        .setName('ext_install')
        .setDescription('Install extension (Ketik nama, bot akan cari)')
        .addStringOption(option =>
            option.setName('name') // Ubah jadi 'name' biar ramah user
                .setDescription('Ketik nama source (Contoh: Asura, Flame)')
                .setAutocomplete(true) // 🔥 FITUR AJAIB NYALA
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('assign')
        .setDescription('🛡️ [Admin] Paksa staff masuk ke slot tugas (Jalur Dalam)')
        .addStringOption(option =>
            option.setName('id_quest')
                .setDescription('Pilih Tugas (Ketik Judul...)')
                .setRequired(true)
                .setAutocomplete(true) 
        )
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Siapa yang mengerjakan?')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('waktu')
                .setDescription('Custom Deadline (Opsional). Contoh: 2h, 30m')
                .setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName('recovery')
        .setDescription('🚑 [Admin] Pulihkan tugas yang hilang/terhapus')
        .addStringOption(option =>
            option.setName('task_id')
                .setDescription('Pilih tugas yang mau dikembalikan')
                .setAutocomplete(true) 
                .setRequired(true)
        ),
]
    .map(command => command.toJSON());

client.once(Events.ClientReady, async () => {
    try {
        console.log(`🔥 Bot ${client.user.tag} Online!`);
        await DB.init();
        const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);
        console.log('🚧 Mendaftarkan command ke Discord...');
        await rest.put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID), { body: commands });
        console.log('✅ Command berhasil didaftarkan!');

        Reminder.start(client);
        Monitor.start(client);
        AntiCrash(client);
        AutoUpdate.startAutoUpdate(client);
        RawWatcher.start(client);
    } catch (e) {
        console.error("❌ Error saat booting:", e);
    }
});

client.on(Events.InteractionCreate, async i => {
    try {
        if (i.isChatInputCommand()) await InteractionCtrl.handleCommand(i, client);

        else if (i.isAutocomplete()) {
            await InteractionCtrl.handleAutocomplete(i, client);
        }
        else if (i.isModalSubmit()) await InteractionCtrl.handleModal(i, client);
        else if (i.isButton()) await InteractionCtrl.handleButton(i, client);
        else if (i.isStringSelectMenu()) await InteractionCtrl.handleSelectMenu(i, client);
    } catch (e) {
        console.error("⚠️ Interaction Error (Handled):", e.message);
        if (i.isAutocomplete()) return;
        if (i.replied || i.deferred) return;
        try { await i.reply({ content: "❌ Terjadi kesalahan internal pada bot.", flags: MessageFlags.Ephemeral }); } catch (finalErr) { }
    }
});

client.login(CONFIG.TOKEN);