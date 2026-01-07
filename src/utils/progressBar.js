// src/utils/progressBar.js

function createProgressBar(current, total, size = 10) {
    const percentage = Math.min(Math.max(current / total, 0), 1); // Pastikan 0-1
    const progress = Math.round(size * percentage);
    const empty = size - progress;
    
    const filledChar = "█";
    const emptyChar = "░";
    
    const bar = filledChar.repeat(progress) + emptyChar.repeat(empty);
    const percentText = Math.round(percentage * 100);
    
    return `[${bar}] ${percentText}%`;
}

module.exports = { createProgressBar };