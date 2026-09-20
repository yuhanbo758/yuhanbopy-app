const fs = require('fs');
const path = require('path');
const { ensurePluginLogo } = require('../app/plugin_logo');

const projectRoot = path.resolve(__dirname, '..');
const softwareRoot = path.join(projectRoot, 'app', 'software');
const requestedNames = process.argv.slice(2);
const pluginDirs = requestedNames.length > 0
    ? requestedNames.map((name) => path.resolve(softwareRoot, name))
    : fs.readdirSync(softwareRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => path.join(softwareRoot, entry.name));

for (const folderPath of pluginDirs) {
    const settingsPath = path.join(folderPath, 'settings.json');
    if (!fs.existsSync(settingsPath)) continue;
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const mainFilePath = path.join(folderPath, settings.main_file || '');
    if (!fs.existsSync(mainFilePath)) {
        throw new Error(`插件入口不存在：${mainFilePath}`);
    }
    settings.logo = settings.logo || 'logo.png';
    const result = ensurePluginLogo({ folderPath, settings, mainFilePath });
    fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    console.log(`${path.basename(folderPath)} -> ${result.logoPath}`);
}
