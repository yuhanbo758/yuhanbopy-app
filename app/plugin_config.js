const fs = require('fs');
const path = require('path');

function ensureDir(targetPath) {
    fs.mkdirSync(targetPath, { recursive: true });
    return targetPath;
}

function safePluginId(folderPath) {
    const normalized = path.basename(folderPath).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    return normalized || Buffer.from(path.basename(folderPath), 'utf8').toString('hex').slice(0, 32);
}

function isInsideFolder(folderPath, candidatePath) {
    const relative = path.relative(folderPath, candidatePath);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function getPluginConfigRoot(appSettings = {}, installedAppPath = process.cwd()) {
    const customPath = String(appSettings.customPluginConfigDir || '').trim();
    return path.resolve(customPath || path.join(installedAppPath, 'plugin-configs'));
}

function getDefaultConfigPath(folderPath, settings = {}) {
    const configuredName = String(settings.config_file || '').trim();
    if (!configuredName) return '';
    const candidate = path.resolve(folderPath, configuredName);
    if (!isInsideFolder(folderPath, candidate) || path.extname(candidate).toLowerCase() !== '.json') {
        throw new Error(`插件默认配置必须是插件目录内的 JSON 文件：${configuredName}`);
    }
    return fs.existsSync(candidate) ? candidate : '';
}

function preparePluginConfig({ folderPath, settings = {}, configRoot }) {
    const rootPath = ensureDir(path.resolve(configRoot));
    const pluginId = safePluginId(folderPath);
    const configPath = path.join(rootPath, `${pluginId}.json`);
    const defaultConfigPath = getDefaultConfigPath(folderPath, settings);

    if (!fs.existsSync(configPath)) {
        if (defaultConfigPath) {
            const parsed = JSON.parse(fs.readFileSync(defaultConfigPath, 'utf8'));
            fs.writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
        } else {
            fs.writeFileSync(configPath, '{}\n', 'utf8');
        }
    }

    return { pluginId, configRoot: rootPath, configPath, defaultConfigPath };
}

function copyMissingPluginConfigs(sourceRoot, targetRoot) {
    const sourcePath = path.resolve(sourceRoot);
    const targetPath = ensureDir(path.resolve(targetRoot));
    if (sourcePath === targetPath || !fs.existsSync(sourcePath)) return [];

    const copied = [];
    for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') continue;
        const targetFile = path.join(targetPath, entry.name);
        if (fs.existsSync(targetFile)) continue;
        fs.copyFileSync(path.join(sourcePath, entry.name), targetFile, fs.constants.COPYFILE_EXCL);
        copied.push(entry.name);
    }
    return copied;
}

function savePluginConfigDirectory({ settingsPath, appSettings = {}, installedAppPath, customPluginConfigDir }) {
    const previousConfigRoot = getPluginConfigRoot(appSettings, installedAppPath);
    const nextSettings = {
        ...appSettings,
        customPluginConfigDir: String(customPluginConfigDir || '').trim()
    };
    const nextConfigRoot = getPluginConfigRoot(nextSettings, installedAppPath);

    copyMissingPluginConfigs(previousConfigRoot, nextConfigRoot);
    ensureDir(path.dirname(settingsPath));
    fs.writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2), 'utf8');
    return { settings: nextSettings, directory: nextConfigRoot };
}

module.exports = {
    copyMissingPluginConfigs,
    getPluginConfigRoot,
    preparePluginConfig,
    savePluginConfigDirectory,
    safePluginId
};
