
const fs = require('fs');
const path = require('path');

const sourceDir = __dirname;
const destDir = path.join(__dirname, 'www');

if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir);
}

const filesToCopy = fs.readdirSync(sourceDir).filter(file => {
    // Exclude node_modules, android, and other non-web files
    return !['node_modules', 'android', 'package.json', 'package-lock.json', 'capacitor.config.json', 'www', 'patch_frontend.py', 'build.js'].includes(file) && !file.startsWith('.');
});

function copyRecursiveSync(src, dest) {
    const stats = fs.statSync(src);
    if (stats.isDirectory()) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest);
        }
        fs.readdirSync(src).forEach(childItemName => {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

filesToCopy.forEach(file => {
    copyRecursiveSync(path.join(sourceDir, file), path.join(destDir, file));
});

console.log('Build complete: Files copied to www');
