const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function createPluginAppId(folderPath) {
    const stableName = path.basename(folderPath).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
    const suffix = stableName || crypto.createHash('sha256').update(path.basename(folderPath)).digest('hex').slice(0, 20);
    return `com.sanrenjz.yuhanbopy.plugin.${suffix}`.slice(0, 120);
}

function existingFile(filePath) {
    if (!filePath) return '';
    try {
        return fs.statSync(filePath).isFile() ? filePath : '';
    } catch (_) {
        return '';
    }
}

function resolvePluginVisual({ folderPath, settings = {}, defaultLogoPath = '', defaultIconPath = '' }) {
    const candidates = [];
    if (settings.logo) {
        const candidate = path.resolve(folderPath, String(settings.logo));
        const relative = path.relative(folderPath, candidate);
        if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
            candidates.push(candidate);
        }
    }
    candidates.push(...['logo.png', 'icon.png', 'logo.ico', 'icon.ico'].map((name) => path.join(folderPath, name)));
    const iconCandidates = [path.join(folderPath, 'logo.ico'), path.join(folderPath, 'icon.ico')];
    if (candidates[0] && path.extname(candidates[0]).toLowerCase() === '.ico') iconCandidates.unshift(candidates[0]);
    // 主程序只解析现有资源；不生成图片、转换 ICO、计算入口源码指纹或写入插件目录。
    return {
        logoPath: candidates.find(existingFile) || existingFile(defaultLogoPath) || existingFile(defaultIconPath),
        taskbarIconPath: iconCandidates.find(existingFile) || existingFile(defaultIconPath),
        visualDependencies: [...new Set([...candidates, ...iconCandidates, defaultLogoPath, defaultIconPath].filter(Boolean))]
    };
}

module.exports = { createPluginAppId, resolvePluginVisual };
