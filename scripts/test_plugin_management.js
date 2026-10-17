const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const os = require('os');
const { applyPluginPreferences, normalizePluginPreferences, startConfiguredPlugins } = require('../app/plugin_management');

async function main() {
    const root = path.resolve('fixture-plugins');
    const programs = [
        { name: '同名插件', path: path.join(root, 'alpha', 'main.py') },
        { name: '同名插件', path: path.join(root, 'beta', 'main.py') },
        { name: '新增插件', path: path.join(root, 'new.py') }
    ];
    const defaults = applyPluginPreferences(programs, root, undefined);
    assert(defaults.every((program) => !program.hidden && !program.autoStart));
    const preferences = JSON.parse(JSON.stringify({
        'alpha/main.py': { autoStart: true, hidden: true },
        'beta/main.py': { autoStart: true },
        'removed/main.py': { hidden: true }
    }));
    const managed = applyPluginPreferences(programs, root, preferences);
    assert.strictEqual(managed.filter((program) => !program.hidden).length, 2);
    assert.strictEqual(managed[0].autoStart, true, '隐藏和自动启动独立');
    assert.strictEqual(normalizePluginPreferences({ bad: { autoStart: 'true', hidden: 1 } }).bad.hidden, false);
    const starts = [];
    const errors = [];
    await startConfiguredPlugins([...managed, managed[0]], async (program) => {
        starts.push(program.id);
        if (program.id === 'alpha/main.py') throw new Error('模拟启动失败');
    }, { onError: (program) => errors.push(program.id) });
    assert.deepStrictEqual(starts, ['alpha/main.py', 'beta/main.py']);
    assert.deepStrictEqual(errors, ['alpha/main.py']);
    await startConfiguredPlugins(managed, () => { throw new Error('退出时不应启动'); }, { shouldStop: () => true });

    // 使用真实启动函数和模拟子进程，确认启动完成不等待窗口退出，且旧手动运行语义保留。
    const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const functionText = source.slice(source.indexOf('async function runPythonScript('), source.indexOf("\nipcMain.handle('show-log-window'"));
    const children = [];
    const context = {
        path, fs: { existsSync: () => false }, console,
        isQuitting: false,
        logWindow: { isDestroyed: () => false, webContents: { send() {} } },
        activePythonRuntime: {}, pluginBootstrapPath: 'not-present',
        getPluginConfigForScript: () => ({ configPath: 'fixture.json', configRoot: 'fixture' }),
        getPythonLauncher: () => 'fake-python', getPythonProcessEnv: () => ({}), createPluginAppId: () => 'fixture',
        registerRunningProcess() {}, unregisterRunningProcess() {}, cleanupTempFile() {},
        spawn() {
            const child = new EventEmitter();
            child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = children.length + 1;
            children.push(child);
            setImmediate(() => child.emit('spawn'));
            return child;
        }
    };
    vm.createContext(context);
    vm.runInContext(functionText, context);
    const started = await Promise.race([
        context.runPythonScript('fixture.py', null, '', '', '', { waitForExit: false }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('自动启动错误地等待插件退出')), 1000))
    ]);
    assert.strictEqual(started.success, true);
    let finished = false;
    const manual = context.runPythonScript('fixture.py', null).then(() => { finished = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(finished, false);
    children[1].emit('close', 0);
    await manual;
    children[0].emit('close', 0);
    context.isQuitting = true;
    await assert.rejects(() => context.runPythonScript('fixture.py', null), /正在退出/);
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'yuhanbopy-management-settings-'));
    try {
        const settingsFile = path.join(temporary, 'settings.json');
        fs.writeFileSync(settingsFile, JSON.stringify({ customPluginConfigDir: 'kept-directory', existingSetting: 'kept' }));
        const persistence = {
            fs, path, settingsPath: settingsFile, installedAppPath: temporary,
            normalizePluginPreferences,
            loadSettings: () => JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
            getPluginConfigRoot: () => temporary,
            activateConfiguredPython: async () => {}, copyMissingPluginConfigs() {},
            ensureDir: (directory) => fs.mkdirSync(directory, { recursive: true }),
            app: { setLoginItemSettings() {} }, process: { execPath: 'fixture-electron' }
        };
        vm.createContext(persistence);
        vm.runInContext(source.slice(source.indexOf('async function saveSettings('), source.indexOf('\nfunction compareVersions(')), persistence);
        await persistence.saveSettings({ pluginPreferences: preferences });
        const reloaded = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        assert.strictEqual(reloaded.customPluginConfigDir, 'kept-directory');
        assert.strictEqual(reloaded.existingSetting, 'kept');
        assert.strictEqual(reloaded.pluginPreferences['alpha/main.py'].autoStart, true);
        assert.strictEqual(reloaded.pluginPreferences['alpha/main.py'].hidden, true);
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
    console.log('plugin_management tests passed (defaults, persistence, hidden startup, failure isolation, process lifecycle)');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
