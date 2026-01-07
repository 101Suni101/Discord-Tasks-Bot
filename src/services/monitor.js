// src/services/monitor.js
const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const DB = require('../models/spreadsheet');

const CHECK_INTERVAL = 60000 * 5; // Cek tiap 5 menit

// 🔥 DAFTAR ERROR DATABASE & KRITIS
const FATAL_ERRORS = [
    'error establishing a database connection',
    'sqlstate[',
    'access denied for user',
    'critical error on this website',
    '502 bad gateway',
    '504 gateway time-out',
    'service unavailable',
    'internal server error'
];

// 🔥 HEADER PALSU (Bypass Cloudflare Ringan)
const FAKE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Cache-Control': 'no-cache',
    'Upgrade-Insecure-Requests': '1'
};

async function start(client) {
    console.log("📡 Sistem Monitoring Web Aktif (Smart Error Detection)...");

    setInterval(async () => {
        const monitors = DB.state.monitors;
        if (monitors.length === 0) return;

        const channelId = DB.state.settings['MONITOR_CHANNEL_ID'] 
                       || DB.state.settings['REPORT_CHANNEL_ID'] 
                       || DB.state.settings['LOG_CHANNEL_ID'];
        
        if (!channelId) return;
        const channel = client.channels.cache.get(channelId);
        if (!channel) return;

        console.log(`🔎 Mengecek ${monitors.length} website...`);

        for (const site of monitors) {
            try {
                const res = await axios.get(site.url, { 
                    timeout: 20000, 
                    headers: FAKE_HEADERS,
                    validateStatus: () => true 
                });
                
                // Cek Cloudflare Challenge
                const pageContent = typeof res.data === 'string' ? res.data.toLowerCase() : "";
                if (pageContent.includes('cloudflare') && (pageContent.includes('challenge') || pageContent.includes('verify'))) {
                    console.log(`⚠️ ${site.name} terkena Cloudflare. Skip.`);
                    continue; 
                }

                let isDown = false;
                let currentDetail = ""; // Pesan error saat ini

                // 1. Cek Status Code
                if (res.status >= 400) {
                    isDown = true;
                    currentDetail = `Status Code: ${res.status} ${res.statusText}`;
                } 
                // 2. Cek Isi Layar (Database Error)
                else {
                    const foundError = FATAL_ERRORS.find(keyword => pageContent.includes(keyword));
                    if (foundError) {
                        isDown = true;
                        currentDetail = `Error di Layar: "${foundError}"`;
                    } else {
                        currentDetail = "OK";
                    }
                }

                // --- LOGIKA PELAPORAN PINTAR ---
                
                if (!isDown) {
                    // KASUS: WEB HIDUP
                    if (site.lastStatus !== 'ONLINE') {
                        if (site.lastStatus !== 'UNKNOWN') { 
                            await sendAlert(channel, site, true, "Web Normal Kembali");
                        }
                        site.lastStatus = 'ONLINE';
                        site.lastDetail = "OK";
                    }
                } else {
                    // KASUS: WEB MATI / ERROR
                    // Kita lapor jika:
                    // 1. Status berubah dari ONLINE ke OFFLINE
                    // 2. ATAU Status tetap OFFLINE, tapi Pesan Errornya berubah (Misal: 403 -> 500)
                    
                    if (site.lastStatus !== 'OFFLINE' || site.lastDetail !== currentDetail) {
                        
                        // Tambahkan info "UPDATE STATUS" biar admin tau ini error baru
                        const titlePrefix = site.lastStatus === 'OFFLINE' ? "🔄 UPDATE ERROR" : "🔴 Website DOWN";
                        
                        await sendAlert(channel, site, false, currentDetail, titlePrefix);
                        
                        site.lastStatus = 'OFFLINE';
                        site.lastDetail = currentDetail; // Simpan error terbaru ke memori
                    }
                }

            } catch (error) {
                // Error Koneksi (Timeout/DNS)
                const errorMsg = error.code ? `Koneksi Gagal: ${error.code}` : error.message;

                if (site.lastStatus !== 'OFFLINE' || site.lastDetail !== errorMsg) {
                    const titlePrefix = site.lastStatus === 'OFFLINE' ? "🔄 UPDATE ERROR" : "🔴 Website DOWN";
                    
                    await sendAlert(channel, site, false, errorMsg, titlePrefix);
                    
                    site.lastStatus = 'OFFLINE';
                    site.lastDetail = errorMsg;
                }
            }
        }
    }, CHECK_INTERVAL);
}

async function sendAlert(channel, site, isOnline, detail, customTitle) {
    // Tentukan Judul Default
    let title = isOnline ? "🟢 Website PULIH" : "🔴 Website DOWN / ERROR";
    if (customTitle) title = customTitle; // Pakai judul custom jika ada (misal: UPDATE ERROR)

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(`**Nama:** ${site.name}\n**URL:** ${site.url}\n**Diagnosa Bot:** \`${detail}\``)
        .setColor(isOnline ? 0x00FF00 : (customTitle?.includes('UPDATE') ? 0xFFA500 : 0xFF0000)) // Oranye kalau update, Merah kalau baru down
        .setTimestamp();

    // Mention hanya kalau baru down (biar update error gak terlalu spam mention)
    const content = (isOnline || customTitle?.includes('UPDATE')) ? "" : "⚠️ **Perhatian! Ada masalah di website!**"; 
    
    await channel.send({ content, embeds: [embed] }).catch(() => {});
}

module.exports = { start };