const fs = require('fs');
const path = require('path');

function loadFiles(dirName) {
    const files = [];
    const items = fs.readdirSync(dirName, { withFileTypes: true });

    for (const item of items) {
        if (item.isDirectory()) {
            files.push(...loadFiles(path.join(dirName, item.name)));
        } else if (item.name.endsWith('.js')) {
            files.push(path.join(dirName, item.name));
        }
    }
    return files;
}

module.exports = { loadFiles };