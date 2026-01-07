const Suwayomi = require('./suwayomi');
const DB = require('../models/spreadsheet');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Simpan waktu cek terakhir
let lastCheckTime = Date.now();

// Cache untuk menyimpan data Source (Nama & Logo)
let sourceCache = new Map();

async function startAutoUpdate(client) {
    console.log("⏰ [SYSTEM] Auto-Update Service: ON (Interval: 5 Menit)");

    // Update Cache Source dulu saat bot nyala
    await updateSourceCache();
    
    // Jalankan loop
    setInterval(() => {
        runCheck(client);
    }, 5 * 60 * 1000); 
}

// Fungsi bantu: Ambil daftar source biar tau Logo & Nama Extension
async function updateSourceCache() {
    try {
        const sources = await Suwayomi.getSources(); // Panggil fungsi REST API getSources yang sudah ada
        if (sources && Array.isArray(sources)) {
            sources.forEach(s => {
                // Simpan ID -> { name, icon }
                sourceCache.set(s.id, { 
                    name: s.name, 
                    iconUrl: s.iconUrl ? `${Suwayomi.baseUrl}${s.iconUrl}` : null 
                });
            });
            console.log(`🔌 [AUTO] Source Cache Updated: ${sourceCache.size} sources loaded.`);
        }
    } catch (e) {
        console.error("❌ Gagal update source cache:", e.message);
    }
}

async function runCheck(client) {
    try {
        // 1. CEK CHANNEL CONFIG
        const channelId = DB.state.settings['MANGA_CHANNEL_ID'];
        if (!channelId) return; 

        const channel = client.channels.cache.get(channelId);
        if (!channel) return console.log("⚠️ Channel Manga tidak ditemukan (Cek ID di Config).");

        // 2. UPDATE SOURCE CACHE (Sekali-kali biar update kalo ada ext baru)
        if (sourceCache.size === 0) await updateSourceCache();

        // 3. FORCE REFRESH LIBRARY
        await Suwayomi.forceRefreshLibrary();

        // 4. TUNGGU SERVER CRAWLING (60 Detik)
        console.log("⏳ [AUTO] Menunggu server crawling...");
        await new Promise(resolve => setTimeout(resolve, 60 * 1000));

        // 5. AMBIL DATA UPDATE
        const updates = await Suwayomi.getRecentUpdates();

        // 6. FILTER CHAPTER BARU
        const newChapters = updates.filter(ch => {
            // Konversi fetchedAt ke ms jika perlu
            let fetchTime = ch.fetchedAt;
            if (fetchTime < 10000000000) fetchTime *= 1000; 

            return fetchTime > lastCheckTime;
        });

        // Update penanda waktu
        lastCheckTime = Date.now();

        if (newChapters.length === 0) return;

        console.log(`🔥 [AUTO] ${newChapters.length} Chapter Baru ditemukan!`);

        // 7. KIRIM NOTIFIKASI
        // Reverse biar urut dari chapter lama -> baru
        const sortedChapters = newChapters.reverse();

        for (const ch of sortedChapters) {
            const manga = ch.manga;
            
            // Ambil Info Source (Logo & Nama) dari Cache
            const sourceInfo = sourceCache.get(manga.sourceId) || { name: "Unknown Source", iconUrl: null };
            
            // Fix URL Thumbnail Manga
            let mangaCover = manga.thumbnailUrl;
            if (mangaCover && mangaCover.startsWith('/')) mangaCover = `${Suwayomi.baseUrl}${mangaCover}`;

            // FORMAT EMBED SESUAI REQUEST
            const embed = new EmbedBuilder()
                .setColor(0x00AAFF) // Biru Langit
                .setTitle(`${manga.title} ${ch.name} Update`) // "Judul Chapter X Update"
                .setURL(ch.realUrl || null) // Klik judul langsung ke link
                .setDescription(`
**Link Chapter:**
[Klik Disini untuk Baca](${ch.realUrl || '#'})

**Source:**
${sourceInfo.name}
`)
                // Logo Extension jadi Thumbnail (Kecil di kanan atas)
                .setThumbnail(sourceInfo.iconUrl) 
                
                // Cover Manga jadi Gambar Utama (Besar di bawah) - Opsional, biar cakep
                .setImage(mangaCover)
                
                .setFooter({ text: `Auto Update • ${sourceInfo.name}`, iconURL: sourceInfo.iconUrl })
                .setTimestamp();

            // Tombol Shortcut (Opsional, kalau mau dihapus tinggal hapus components: [row])
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel("📖 Baca Sekarang")
                    .setStyle(ButtonStyle.Link) // Tipe Link button
                    .setURL(ch.realUrl || 'https://google.com') // Link ke chapter
            );

            await channel.send({ embeds: [embed], components: [row] });
            
            // Jeda 2 detik anti-spam
            await new Promise(r => setTimeout(r, 2000));
        }

    } catch (error) {
        console.error("❌ [AUTO UPDATE ERROR]", error.message);
    }
}

module.exports = { startAutoUpdate };