const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const packageLockPath = path.join(rootDir, 'package-lock.json');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function bumpPatch(version) {
    const parts = String(version || '1.0.0').trim().split('.').map((segment) => Number.parseInt(segment, 10) || 0);
    while (parts.length < 3) {
        parts.push(0);
    }
    parts[2] += 1;
    return parts.slice(0, 3).join('.');
}

const packageJson = readJson(packageJsonPath);
const nextVersion = process.argv[2] || bumpPatch(packageJson.version);

packageJson.version = nextVersion;
writeJson(packageJsonPath, packageJson);

if (fs.existsSync(packageLockPath)) {
    const packageLock = readJson(packageLockPath);
    packageLock.version = nextVersion;
    if (packageLock.packages && packageLock.packages['']) {
        packageLock.packages[''].version = nextVersion;
    }
    writeJson(packageLockPath, packageLock);
}

process.stdout.write(`${nextVersion}\n`);
