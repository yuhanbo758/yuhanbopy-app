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

module.exports = {
    copyMissingEntries,
    initializeSoftwareStore
};
