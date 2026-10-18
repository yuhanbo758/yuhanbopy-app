const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function protectConfigDirectory(directory) {
    const root = ensureDir(path.resolve(directory));
    const tracked = spawnSync('git', ['-C', root, 'ls-files', '--', '.'], { encoding: 'utf8', windowsHide: true });
    if (tracked.status === 0 && tracked.stdout.trim()) {
        throw new Error('插件用户配置目录包含已被 Git 跟踪的文件，请选择独立的私密目录');
    }
    const ignorePath = path.join(root, '.gitignore');
    const previous = fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, 'utf8') : '';
    if (!previous.trimEnd().endsWith('# Private plugin configuration\n*')) {
        fs.appendFileSync(ignorePath, `${previous && !previous.endsWith('\n') ? '\n' : ''}# Private plugin configuration\n*\n`, 'utf8');
    }
    return root;
}

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
    const root = path.resolve(customPath || path.join(installedAppPath, 'plugin-configs'));
    for (const plugins of [path.join(installedAppPath, 'app', 'software'), path.join(installedAppPath, 'plugins')]) {
        if (root === plugins || isInsideFolder(plugins, root)) {
            throw new Error('插件用户配置目录不能放在插件程序目录中');
        }
    }
    return root;
}

function getDefaultConfigPath(folderPath, settings = {}) {
    const configuredName = String(settings.config_file || 'config.json').trim();
    const candidate = path.resolve(folderPath, configuredName);
    if (!isInsideFolder(folderPath, candidate) || path.extname(candidate).toLowerCase() !== '.json') {
        throw new Error(`插件默认配置必须是插件目录内的 JSON 文件：${configuredName}`);
    }
    return fs.existsSync(candidate) ? candidate : '';
}

function preparePluginConfig({ folderPath, settings = {}, configRoot, initialize = true }) {
    // 列表查询只计算路径；Git 保护检查仅在实际初始化/读写流程执行。
    const rootPath = initialize ? protectConfigDirectory(configRoot) : path.resolve(configRoot);
    const pluginId = safePluginId(folderPath);
    const configPath = path.join(rootPath, `${pluginId}.json`);
    const defaultConfigPath = getDefaultConfigPath(folderPath, settings);

    if (initialize && !fs.existsSync(configPath)) {
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
    const targetPath = protectConfigDirectory(targetRoot);
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
    protectConfigDirectory,
    copyMissingPluginConfigs,
    getPluginConfigRoot,
    preparePluginConfig,
    savePluginConfigDirectory,
    safePluginId
};
