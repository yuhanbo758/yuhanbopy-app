const fs = require('fs');
const path = require('path');

function copyMissingEntries(sourceDir, targetDir) {
    if (!sourceDir || !fs.existsSync(sourceDir)) {
        return { copied: [], skipped: [] };
    }

    fs.mkdirSync(targetDir, { recursive: true });
    const result = { copied: [], skipped: [] };

    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        // 下载缓存等隐藏目录不属于插件，不能随升级迁移。
        if (entry.name.startsWith('.')) {
            continue;
        }

        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);
        if (fs.existsSync(targetPath)) {
            result.skipped.push(entry.name);
            continue;
        }

        fs.cpSync(sourcePath, targetPath, {
            recursive: entry.isDirectory(),
            force: false,
            errorOnExist: true
        });
        result.copied.push(entry.name);
    }

    return result;
}

function initializeSoftwareStore({ bundledDir, persistentDir, migrationDirs = [] }) {
    fs.mkdirSync(persistentDir, { recursive: true });
    const migrated = [];

    for (const migrationDir of migrationDirs) {
        if (!migrationDir || !fs.existsSync(migrationDir)) {
            continue;
        }

        const result = copyMissingEntries(migrationDir, persistentDir);
        migrated.push(...result.copied);
        // 只有完整复制成功后才删除临时备份；异常时保留备份供下次重试。
        fs.rmSync(migrationDir, { recursive: true, force: true });
    }

    const seeded = copyMissingEntries(bundledDir, persistentDir);
    return {
        persistentDir,
        migrated,
        added: seeded.copied,
        preserved: seeded.skipped
    };
}

function importLocalSoftware(sourcePath, softwareDir, runningScriptPaths = [], configRoot = '') {
    const source = fs.realpathSync(sourcePath);
    const store = fs.realpathSync(softwareDir);
    const name = path.basename(path.resolve(sourcePath));
    const target = path.join(store, name);
    const stats = fs.statSync(source);
    if (name.startsWith('.') || (!stats.isDirectory() && (!stats.isFile() || path.extname(name).toLowerCase() !== '.py'))) {
        throw new Error('请选择 Python 文件或插件文件夹');
    }

    // 直接选择已安装插件时无需复制，避免把源目录当作旧版本移走。
    if (fs.existsSync(target) && fs.realpathSync(target) === source) {
        return { name, path: target, action: 'unchanged' };
    }
    const contains = (parent, child) => {
        const relative = path.relative(parent, child);
        return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
    };
    if (contains(source, target) || contains(target, source)) {
        throw new Error('导入源和目标目录不能互相包含');
    }
    if (configRoot && (contains(target, path.resolve(configRoot)) || contains(path.resolve(configRoot), target))) {
        throw new Error('插件目录与用户配置目录不能互相包含，请先迁移用户配置目录');
    }
    if (runningScriptPaths.some((scriptPath) => contains(target, path.resolve(scriptPath)))) {
        throw new Error(`插件 ${name} 正在运行，请关闭后再替换`);
    }

    const replaced = fs.existsSync(target);
    const workspace = fs.mkdtempSync(path.join(store, '.local-import-'));
    const staged = path.join(workspace, 'new');
    const backup = path.join(workspace, 'old');
    try {
        // 完整准备新版本后才切换目录，确保旧文件被移除且复制失败不损坏旧插件。
        fs.cpSync(source, staged, { recursive: stats.isDirectory(), force: false, errorOnExist: true });
        // 更新程序不能改变配置内容；兼容旧插件旁路配置及新版本配置文件改名。
        if (replaced && stats.isDirectory()) {
            const settingsFile = path.join(target, 'settings.json');
            const metadata = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {};
            if (configRoot) {
                // 迁移只针对尚不存在的用户文件，且必须取自旧插件，不能使用新包的空模板。
                const { preparePluginConfig } = require('./plugin_config');
                preparePluginConfig({ folderPath: target, settings: metadata, configRoot });
            }
            const incomingSettingsFile = path.join(staged, 'settings.json');
            const incomingMetadata = fs.existsSync(incomingSettingsFile) ? JSON.parse(fs.readFileSync(incomingSettingsFile, 'utf8')) : {};
            const oldName = metadata.config_file || 'config.json';
            const nextName = incomingMetadata.config_file || 'config.json';
            const preserve = (fromName, toName) => {
                const oldConfig = path.resolve(target, fromName);
                const newConfig = path.resolve(staged, toName);
                if (oldConfig === target || newConfig === staged || !contains(target, oldConfig) || !contains(staged, newConfig)) {
                    throw new Error('配置文件路径必须位于插件目录内');
                }
                if (fs.existsSync(oldConfig)) {
                    fs.mkdirSync(path.dirname(newConfig), { recursive: true });
                    fs.copyFileSync(oldConfig, newConfig);
                }
            };
            preserve('config.json', 'config.json');
            // 旧插件可能未声明 config_file，仍使用 sync_config.json 等文件；替换不得丢弃。
            const preserveLegacyConfigs = (directory, relative = '') => {
                for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                    const name = path.join(relative, entry.name);
                    if (entry.isDirectory() && !entry.name.startsWith('.') && !['node_modules', '__pycache__'].includes(entry.name)) {
                        preserveLegacyConfigs(path.join(directory, entry.name), name);
                    } else if (entry.isFile() && /(?:^|[_.-])config(?:[_.-]|$)/i.test(entry.name) && /\.json$/i.test(entry.name)) {
                        preserve(name, name);
                    }
                }
            };
            preserveLegacyConfigs(target);
            preserve(oldName, oldName);
            if (nextName !== oldName) {
                // 新入口可能使用新路径；沿用原始内容，不能让包内空模板遮蔽旧配置。
                preserve(oldName, nextName);
            }
        }
        if (replaced) fs.renameSync(target, backup);
        try {
            fs.renameSync(staged, target);
        } catch (error) {
            if (replaced) {
                try {
                    fs.renameSync(backup, target);
                } catch (restoreError) {
                    throw new Error(`替换失败：${error.message}；恢复失败：${restoreError.message}。旧插件保留在 ${backup}`);
                }
            }
            throw error;
        }
    } catch (error) {
        // 恢复失败时保留备份，不能在清理临时文件时删除唯一的旧版本。
        if (!fs.existsSync(backup)) fs.rmSync(workspace, { recursive: true, force: true });
        throw error;
    }
    try {
        fs.rmSync(workspace, { recursive: true, force: true });
    } catch (error) {
        console.warn('插件已导入，临时备份清理失败:', workspace, error.message);
    }
    return { name, path: target, action: replaced ? 'replaced' : 'added' };
}

module.exports = {
    importLocalSoftware,
    copyMissingEntries,
    initializeSoftwareStore
};
