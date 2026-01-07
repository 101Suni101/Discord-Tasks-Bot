// src/services/canvasGen.js
const { Worker } = require('worker_threads');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');
const DB = require('../models/spreadsheet');

function generateLeaderboard(client) {
    return new Promise((resolve, reject) => {
        // 1. SIAPKAN BAHAN
        const sorted = [...DB.state.userStats.entries()]
            .sort((a, b) => b[1].point - a[1].point)
            .slice(0, 10);

        const fetchPromises = sorted.map(async ([userId, stats], index) => {
            let user = client.users.cache.get(userId);
            if (!user) {
                try { user = await client.users.fetch(userId); } catch {}
            }
            return {
                index: index,
                username: user ? user.username : "Unknown",
                avatarURL: user ? user.displayAvatarURL({ extension: 'png', size: 128 }) : null,
                points: stats.point
            };
        });

        Promise.all(fetchPromises).then((cleanData) => {
            // 2. LEMPAR KE DAPUR (WORKER THREAD)
            // Kita pakai require.resolve agar path-nya 100% akurat menurut Node.js
            let workerPath;
            try {
                workerPath = require.resolve('./worker.js');
            } catch (e) {
                return reject(new Error("File worker.js tidak ditemukan di src/services/"));
            }

            const worker = new Worker(workerPath, {
                workerData: cleanData
            });

            worker.on('message', (buffer) => {
                const attachment = new AttachmentBuilder(Buffer.from(buffer), { name: 'leaderboard.png' });
                resolve(attachment); 
            });

            // Tangkap error biar bot tidak mati
            worker.on('error', (err) => {
                console.error("⚠️ Worker Error (Cek Library Canvas):", err.message);
                reject(new Error("Gagal memproses gambar."));
            });

            worker.on('exit', (code) => {
                if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
            });
        });
    });
}

module.exports = { generateLeaderboard };