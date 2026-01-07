// src/services/worker.js
const { parentPort, workerData } = require('worker_threads');

// --- GUNAKAN LIBRARY BARU (@napi-rs/canvas) ---
let createCanvas, loadImage;
try {
    const canvasLib = require('@napi-rs/canvas');
    createCanvas = canvasLib.createCanvas;
    loadImage = canvasLib.loadImage;
} catch (e) {
    // Tangkap error jika library belum terinstall
    console.error("\n========================================");
    console.error("❌ ERROR LIBRARY CANVAS");
    console.error("Pastikan kamu sudah install: npm install @napi-rs/canvas");
    console.error("========================================\n");
    process.exit(1);
}

// Proses Worker (Dapur)
async function draw() {
    const width = 700;
    const height = 800;
    
    // Syntax @napi-rs/canvas sedikit beda (langsung panggil fungsi, bukan dari class Canvas)
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 1. Background
    try {
        const bg = await loadImage('./leaderboard.jpg');
        ctx.drawImage(bg, 0, 0, width, height);
    } catch (e) {
        ctx.fillStyle = '#23272A';
        ctx.fillRect(0, 0, width, height);
    }

    // 2. Header
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 40px Arial'; // Ganti 'Sans' jadi 'Arial' (lebih aman di napi-rs)
    ctx.textAlign = 'center';
    ctx.fillText('🏆 LEADERBOARD 🏆', width / 2, 60);

    // 3. Render Data User
    let y = 120;
    const dataUsers = workerData || [];

    for (const u of dataUsers) {
        // Kotak Dasar
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(50, y, 600, 60);

        // Nomor Urut
        ctx.fillStyle = '#FFD700';
        ctx.font = 'bold 30px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(`#${u.index + 1}`, 70, y + 42);

        // Avatar
        if (u.avatarURL) {
            try {
                const avatar = await loadImage(u.avatarURL);
                ctx.save();
                ctx.beginPath();
                ctx.arc(160, y + 30, 25, 0, Math.PI * 2, true);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(avatar, 135, y + 5, 50, 50);
                ctx.restore();
            } catch (e) {}
        } else {
            ctx.fillStyle = '#555';
            ctx.beginPath();
            ctx.arc(160, y + 30, 25, 0, Math.PI * 2);
            ctx.fill();
        }

        // Username
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 24px Arial';
        ctx.fillText((u.username || "Unknown").slice(0, 15), 200, y + 40);

        // Points
        ctx.fillStyle = '#00FF00';
        ctx.textAlign = 'right';
        ctx.fillText(`${u.points || 0} Pts`, 630, y + 40);

        y += 70;
    }

    // Kirim gambar buffer balik
    // @napi-rs/canvas outputnya langsung buffer png secara default di toBuffer
    const buffer = await canvas.encode('png'); 
    if (parentPort) parentPort.postMessage(buffer);
}

draw();