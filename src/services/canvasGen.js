const Canvas = require('canvas');
const { AttachmentBuilder } = require('discord.js');
const DB = require('../models/spreadsheet');

async function generateLeaderboard(client) {
    const canvas = Canvas.createCanvas(700, 800);
    const ctx = canvas.getContext('2d');
    
    // Background
    try {
        const bg = await Canvas.loadImage('./leaderboard.jpg'); // Pastikan file ada di root/docker
        ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
    } catch { ctx.fillStyle = '#23272A'; ctx.fillRect(0, 0, canvas.width, canvas.height); }

    // ... (Salin logika Canvas drawing kamu yang panjang di sini) ...
    // Ganti akses `points` dengan `DB.state.points`

    // Contoh simplifikasi bagian loop data:
    const sorted = [...DB.state.points.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    
    // Render Loop (Sama seperti kodemu)
    // ...

    return new AttachmentBuilder(canvas.toBuffer(), { name: 'leaderboard.png' });
}

module.exports = { generateLeaderboard };