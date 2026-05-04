const fs = require('fs');
const path = require('path');
const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule.default || pngToIcoModule;

async function main() {
    const rootDir = path.resolve(__dirname, '..');
    const buildDir = path.join(rootDir, 'build');
    const pngPath = path.join(buildDir, 'logo.png');
    const icoPath = path.join(buildDir, 'icon.ico');

    if (!fs.existsSync(pngPath)) {
        throw new Error(`未找到 PNG 图标文件: ${pngPath}`);
    }

    const buffer = await pngToIco(pngPath);
    fs.writeFileSync(icoPath, buffer);
    process.stdout.write(`Prepared icon: ${icoPath}\n`);
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
