const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

async function fileInfo(filePath) {
    const hash = crypto.createHash('sha512');
    await new Promise((resolve, reject) => {
        const input = fs.createReadStream(filePath);
        input.on('data', (chunk) => hash.update(chunk));
        input.on('end', resolve);
        input.on('error', reject);
    });
    return {
        name: path.basename(filePath),
        sha512: hash.digest('base64'),
        size: fs.statSync(filePath).size
    };
}

async function generateManifest(distPath, version) {
    const zipFiles = fs.readdirSync(distPath)
        .filter((name) => name.endsWith('.zip') && /-mac-(x64|arm64)\.zip$/.test(name))
        .sort((left, right) => left.includes('-x64.zip') ? -1 : right.includes('-x64.zip') ? 1 : left.localeCompare(right));

    const architectures = new Set(zipFiles.map((name) => name.includes('-arm64.zip') ? 'arm64' : 'x64'));
    if (architectures.size !== 2 || zipFiles.length !== 2) {
        throw new Error(`需要且只能有一个 x64 和一个 arm64 macOS ZIP，实际找到: ${zipFiles.join(', ') || '无'}`);
    }

    const files = await Promise.all(zipFiles.map((name) => fileInfo(path.join(distPath, name))));
    const primary = files.find((item) => item.name.includes('-x64.zip'));
    const lines = [
        `version: ${version}`,
        'files:',
        ...files.flatMap((item) => [
            `  - url: ${item.name}`,
            `    sha512: ${item.sha512}`,
            `    size: ${item.size}`
        ]),
        `path: ${primary.name}`,
        `sha512: ${primary.sha512}`,
        `releaseDate: '${new Date().toISOString()}'`,
        ''
    ];
    const outputPath = path.join(distPath, 'latest-mac.yml');
    fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
    return { outputPath, files };
}

if (require.main === module) {
    const distPath = path.resolve(process.argv[2] || 'dist');
    const version = process.argv[3] || require('../package.json').version;
    generateManifest(distPath, version)
        .then((result) => {
            process.stdout.write(`Generated ${result.outputPath} for ${result.files.map((item) => item.name).join(', ')}\n`);
        })
        .catch((error) => {
            console.error(error.message || error);
            process.exitCode = 1;
        });
}

module.exports = { generateManifest };
