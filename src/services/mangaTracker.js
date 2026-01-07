// src/services/mangaTracker.js
const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const DB = require('../models/spreadsheet');

const SUWAYOMI_GRAPHQL = 'http://soulscans_suwayomi:4567/api/graphql';

// Cek tiap 5 menit
const CHECK_INTERVAL = 5 * 60 * 1000; 

// Force update library tiap 60 menit
const FORCE_UPDATE_INTERVAL = 60 * 60 * 1000; 

let lastCheckTime = Date.now();
let lastForceUpdateTime = 0;

async function start(client) {
    console.log("📚 Manga Tracker (V5: Final Fix) Siap!");

    setInterval(async () => {
        try {
            const now = Date.now();

            // 1. FORCE UPDATE LIBRARY
            if (now - lastForceUpdateTime > FORCE_UPDATE_INTERVAL) {
                console.log("🔨 Memaksa Suwayomi update library...");
                try {
                    // Pakai updateLibrary sesuai mutation list kamu
                    await axios.post(SUWAYOMI_GRAPHQL, { query: `mutation { updateLibrary }` });
                    lastForceUpdateTime = now;
                    console.log("✅ Perintah update terkirim!");
                } catch (e) {
                    console.log("⚠️ Gagal paksa update (Mungkin lagi jalan).");
                }
            }

            // 2. CEK UPDATE
            const updateChannelId = DB.state.settings ? DB.state.settings['MANGA_CHANNEL_ID'] : null;
            if (!updateChannelId) return;

            const channel = client.channels.cache.get(updateChannelId);
            if (!channel) return;

            // --- QUERY FINAL (Sesuai Screenshot Kamu) ---
            const queryLibrary = {
                query: `
                query {
                    mangas {
                        nodes { 
                            id
                            title
                            thumbnailUrl
                            inLibrary
                            # Field yang benar adalah chapterNumber, bukan index
                            latestUploadedChapter {
                                name
                                chapterNumber
                                uploadDate
                                url
                            }
                        }
                    }
                }`
            };

            const response = await axios.post(SUWAYOMI_GRAPHQL, queryLibrary);
            
            // Masuk ke: mangas -> nodes
            const allManga = response.data?.data?.mangas?.nodes || [];
            // console.log(`🔍 Tracker Check: Memantau ${allManga.length} judul di Library.`); 
            const newUpdates = [];

            for (const manga of allManga) {
                // Filter: Hanya yang di Library & Punya Chapter Terbaru
                if (!manga.inLibrary || !manga.latestUploadedChapter) continue;

                const latest = manga.latestUploadedChapter;

                // Logika Waktu: Bandingkan uploadDate dengan waktu terakhir cek
                if (latest.uploadDate > lastCheckTime) {
                    newUpdates.push({
                        manga: manga,
                        chapter: latest
                    });
                }
            }

            // Jika ada chapter baru
            if (newUpdates.length > 0) {
                console.log(`📚 Ditemukan ${newUpdates.length} chapter baru!`);
                lastCheckTime = Date.now();

                // Posting dari yang terlama ke terbaru
                for (const update of newUpdates.reverse()) {
                    await sendUpdateEmbed(channel, update.manga, update.chapter);
                }
            }

        } catch (err) {
            if (err.code !== 'ECONNREFUSED') console.error("⚠️ Tracker Error:", err.message);
        }
    }, CHECK_INTERVAL);
}

async function sendUpdateEmbed(channel, manga, chapter) {
    try {
        // [FIX] Gunakan Thumbnail asli dari Manga, fallback ke icon jika null
        // Note: Jika Suwayomi pakai localhost, gambar mungkin tidak muncul di Discord (kecuali public URL)
        const thumbUrl = manga.thumbnailUrl || `https://upload.wikimedia.org/wikipedia/commons/7/7a/Manga_icon.png`;

        const embed = new EmbedBuilder()
            .setTitle(`🆕 UPDATE: ${manga.title}`)
            .setDescription(`**${chapter.name}** rilis!`)
            .setColor(0x00FF00)
            .setThumbnail(thumbUrl)
            .addFields(
                // Ganti index dengan chapterNumber
                { name: 'Chapter', value: `${chapter.chapterNumber}`, inline: true },
                { name: 'Waktu', value: `<t:${Math.floor(chapter.uploadDate / 1000)}:R>`, inline: true }
            )
            .setFooter({ text: 'Soulscans Auto-Notifier' });

        await channel.send({ embeds: [embed] });
    } catch (e) {
        console.error("Gagal kirim embed:", e.message);
    }
}

module.exports = { start };