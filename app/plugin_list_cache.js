const fs = require('fs');
const path = require('path');

function fileSignature(filePath) {
    try {
        const stats = fs.statSync(filePath);
        return `${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}:${stats.ino}`;
    } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return 'missing';
        throw error;
    }
}

function createPluginListCache() {
    const entries = new Map();
    const signature = (files) => files.map(fileSignature).join('|');
    return {
        get(itemPath, context, build) {
            const previous = entries.get(itemPath);
            if (previous && previous.context === context && previous.signature === signature(previous.files)) {
                return previous.programs;
            }
            const programs = build();
            // 目录本身监测新增/删除；已知资源单独监测内容变化，不遍历插件数据目录。
            const files = new Set([itemPath]);
            if (fs.statSync(itemPath).isDirectory()) {
                for (const name of ['settings.json', 'logo.png', 'logo.ico', 'icon.png', 'icon.ico']) {
                    files.add(path.join(itemPath, name));
                }
            }
            for (const program of programs) {
                for (const file of program.visualDependencies || []) files.add(file);
                for (const key of ['path', 'detailFilePath', 'requirementsPath', 'logoPath', 'taskbarIconPath']) {
                    if (program[key]) files.add(program[key]);
                }
            }
            const watched = [...files];
            // 图标生成可能新增文件，因此应在生成完成后记录签名。
            entries.set(itemPath, { context, programs, files: watched, signature: signature(watched) });
            return programs;
        },
        prune(activePaths) {
            const active = new Set(activePaths);
            for (const key of entries.keys()) if (!active.has(key)) entries.delete(key);
        }
    };
}

module.exports = { createPluginListCache };
