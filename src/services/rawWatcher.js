const Suwayomi = require('./suwayomi');
const DB = require('../models/spreadsheet');
const { EmbedBuilder } = require('discord.js');

let isRunning = false;
let lastCheckTime = Date.now(); // Titik waktu mulai cek

async function start(client) {
    console.log("👀 [RAW WATCHER] Service Started (Interval: 5 Menit)...");
    
    // 🔥 UPDATE: Loop setiap 5 Menit (300.000 ms)
    setInterval(async () => {
        await checkUpdates(client);
    }, 300000); 

    // Cek pertama kali saat bot nyala (tunggu 10 detik biar DB ready)
    setTimeout(() => { checkUpdates(client); }, 10000);
}

async function checkUpdates(client) {
    if (isRunning) return; // Jangan tumpuk proses
    isRunning = true;

    try {
        // Ambil ID dari Excel (sesuai gambar yang kamu kirim)
        const channelId = DB.state.settings['MANGA_CHANNEL_ID']; 
        
        if (!channelId) {
            console.log("⚠️ [RAW WATCHER] Channel Notif belum disetting (/config MANGA_CHANNEL_ID)");
            isRunning = false;
            return;
        }

        const channel = client.channels.cache.get(channelId);
        if (!channel) {
            console.log(`⚠️ [RAW WATCHER] Channel ID ${channelId} tidak ditemukan di Discord.`);
            isRunning = false;
            return;
        }

        console.log("🔄 [RAW WATCHER] Memicu Refresh Library...");
        
        // 1. SURUH SERVER CRAWLING (Refresh)
        await Suwayomi.forceRefreshLibrary();

        // 2. TUNGGU SEBENTAR (Beri waktu server download data baru)
        // Kita tunggu 20 detik biar server nafas dulu
        await new Promise(resolve => setTimeout(resolve, 20000));

        // 3. AMBIL LIST CHAPTER UPDATE
        const updates = await Suwayomi.getRecentUpdates();
        
        if (updates.length === 0) {
            console.log("✅ [RAW WATCHER] Tidak ada update baru.");
            isRunning = false;
            return;
        }

        // 4. FILTER: HANYA YANG BARU
        // Bandingkan 'fetchedAt' dengan waktu cek terakhir kita
        const newChapters = updates.filter(ch => {
            const fetchTime = new Date(ch.fetchedAt * 1000).getTime(); 
            return fetchTime > lastCheckTime;
        });

        if (newChapters.length > 0) {
            console.log(`🔥 [RAW WATCHER] Ditemukan ${newChapters.length} Chapter Baru!`);
            
            // Update waktu cek terakhir ke SEKARANG
            lastCheckTime = Date.now();

            // 5. KIRIM NOTIFIKASI KE DISCORD
            // Kelompokkan per Manga biar gak spam chat
            const groupedUpdates = {};

            newChapters.forEach(ch => {
                const title = ch.manga?.title || "Unknown Manga";
                if (!groupedUpdates[title]) groupedUpdates[title] = [];
                groupedUpdates[title].push(ch);
            });

            // Kirim Embed per Judul
            for (const [mangaTitle, chapters] of Object.entries(groupedUpdates)) {
                const mangaInfo = chapters[0].manga;
                const thumb = mangaInfo.thumbnailUrl;
                const mangaId = mangaInfo.id;
                const sourceName = mangaInfo.source?.displayName || 'Unknown Source';

                // Sortir chapter dari kecil ke besar
                chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

                const chList = chapters.map(c => {
                    return `• **${c.name}**\n   └ 🔗 [Baca / Download](${c.realUrl || '#'})`;
                }).join('\n');

                const embed = new EmbedBuilder()
                    .setColor(0xFF4500) // Merah Orange
                    .setTitle(`🚨 RAW UPDATE: ${mangaTitle}`)
                    .setThumbnail(thumb)
                    .setDescription(chList)
                    .addFields({ name: "🌍 Source", value: sourceName, inline: true })
                    .setFooter({ text: `ID: ${mangaId} • Auto Watcher` })
                    .setTimestamp();

                await channel.send({ embeds: [embed] });
            }
        } else {
            console.log("💤 [RAW WATCHER] Belum ada yang baru sejak cek terakhir.");
        }

    } catch (e) {
        console.error("❌ [RAW WATCHER ERROR]", e);
    } finally {
        isRunning = false;
    }
}

module.exports = { start };