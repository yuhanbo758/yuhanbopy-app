const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PNG } = require('pngjs');
const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule.default || pngToIcoModule;

function resizeNearestNeighbor(sourcePng, targetSize) {
    const targetPng = new PNG({ width: targetSize, height: targetSize });

    for (let y = 0; y < targetSize; y += 1) {
        const sourceY = Math.min(sourcePng.height - 1, Math.floor((y * sourcePng.height) / targetSize));
        for (let x = 0; x < targetSize; x += 1) {
            const sourceX = Math.min(sourcePng.width - 1, Math.floor((x * sourcePng.width) / targetSize));
            const sourceIndex = (sourceY * sourcePng.width + sourceX) << 2;
            const targetIndex = (y * targetSize + x) << 2;
            sourcePng.data.copy(targetPng.data, targetIndex, sourceIndex, sourceIndex + 4);
        }
    }

    return PNG.sync.write(targetPng);
}

function prepareMacIcns(iconPngPath, icnsPath, buildDir) {
    if (process.platform !== 'darwin') {
        return;
    }

    const iconsetPath = path.join(buildDir, 'icon.iconset');
    fs.rmSync(iconsetPath, { recursive: true, force: true });
    fs.mkdirSync(iconsetPath, { recursive: true });

    const sizes = [16, 32, 64, 128, 256, 512, 1024];
    for (const size of sizes) {
        const targetName = size === 1024 ? 'icon_512x512@2x.png' : `icon_${size}x${size}.png`;
        execFileSync('sips', ['-z', String(size), String(size), iconPngPath, '--out', path.join(iconsetPath, targetName)], { stdio: 'ignore' });
    }

    execFileSync('iconutil', ['-c', 'icns', iconsetPath, '-o', icnsPath], { stdio: 'ignore' });
    fs.rmSync(iconsetPath, { recursive: true, force: true });
}

async function main() {
    const rootDir = path.resolve(__dirname, '..');
    const buildDir = path.join(rootDir, 'build');
    const pngPath = path.join(buildDir, 'logo.png');
    const iconPngPath = path.join(buildDir, 'icon.png');
    const icoPath = path.join(buildDir, 'icon.ico');
    const icnsPath = path.join(buildDir, 'icon.icns');

    if (!fs.existsSync(pngPath)) {
        throw new Error(`未找到 PNG 图标文件: ${pngPath}`);
    }

    const sourcePng = PNG.sync.read(fs.readFileSync(pngPath));
    fs.writeFileSync(iconPngPath, resizeNearestNeighbor(sourcePng, 1024));

    const buffer = await pngToIco(iconPngPath);
    fs.writeFileSync(icoPath, buffer);
    prepareMacIcns(iconPngPath, icnsPath, buildDir);
    process.stdout.write(`Prepared icon: ${icoPath}\n`);
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
