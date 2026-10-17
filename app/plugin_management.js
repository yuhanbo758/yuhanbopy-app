const path = require('path');

function normalizePluginPreferences(value) {
    const result = Object.create(null);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    for (const [id, preference] of Object.entries(value)) {
        if (!preference || typeof preference !== 'object') continue;
        result[id] = { autoStart: preference.autoStart === true, hidden: preference.hidden === true };
    }
    return result;
}

function applyPluginPreferences(programs, softwareDir, preferences) {
    const normalized = normalizePluginPreferences(preferences);
    return programs.map((program) => {
        // 相对入口路径不会随安装目录移动而改变，也能区分同名程序。
        const id = path.relative(softwareDir, program.path).split(path.sep).join('/');
        const preference = normalized[id] || {};
        return { ...program, id, autoStart: preference.autoStart === true, hidden: preference.hidden === true };
    });
}

async function startConfiguredPlugins(programs, launch, { shouldStop = () => false, onError = () => {} } = {}) {
    const started = new Set();
    for (const program of programs) {
        if (shouldStop()) break;
        if (!program.autoStart || started.has(program.id)) continue;
        started.add(program.id);
        // 等待进程启动，不等待插件窗口关闭；单个启动失败不能阻断其他插件。
        try {
            await launch(program);
        } catch (error) {
            onError(program, error);
        }
    }
}

module.exports = { normalizePluginPreferences, applyPluginPreferences, startConfiguredPlugins };
