const fs = require('fs');
const path = require('path');

console.log("=========================================");
console.log("🕵️  DETEKTIF FILE SEDANG BEKERJA");
console.log("=========================================");

const filesToCheck = [
    'src/index.js',
    'src/services/monitor.js', // Target Utama
    'src/services/worker.js',
    'src/models/spreadsheet.js'
];

filesToCheck.forEach(filePath => {
    const fullPath = path.join(__dirname, filePath);
    if (fs.existsSync(fullPath)) {
        console.log(`✅ ADA: ${filePath}`);
    } else {
        console.log(`❌ HILANG: ${filePath}`);
        console.log(`   (Bot mencari di: ${fullPath})`);
    }
});

console.log("=========================================");