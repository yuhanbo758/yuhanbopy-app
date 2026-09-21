const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    copyMissingPluginConfigs,
    getPluginConfigRoot,
    preparePluginConfig,
    savePluginConfigDirectory
} = require('../app/plugin_config');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yuhanbopy-plugin-config-test-'));
try {
    const installDir = path.join(testRoot, 'install');
    const pluginDir = path.join(installDir, 'plugins', 'sample_plugin');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'config.json'), JSON.stringify({ endpoint: 'https://example.com', token: '' }), 'utf8');

    const defaultRoot = getPluginConfigRoot({}, installDir);
    assert.strictEqual(defaultRoot, path.join(installDir, 'plugin-configs'));
    const first = preparePluginConfig({
        folderPath: pluginDir,
        settings: { config_file: 'config.json' },
        configRoot: defaultRoot
    });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(first.configPath, 'utf8')), {
        endpoint: 'https://example.com', token: ''
    });

    fs.writeFileSync(first.configPath, JSON.stringify({ endpoint: 'custom', token: 'private' }), 'utf8');
    fs.writeFileSync(path.join(pluginDir, 'config.json'), JSON.stringify({ endpoint: 'updated-default', token: '' }), 'utf8');
    preparePluginConfig({ folderPath: pluginDir, settings: { config_file: 'config.json' }, configRoot: defaultRoot });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(first.configPath, 'utf8')), {
        endpoint: 'custom', token: 'private'
    }, '再次加载必须保留用户配置');

    const customRoot = path.join(testRoot, 'custom-configs');
    assert.deepStrictEqual(copyMissingPluginConfigs(defaultRoot, customRoot), ['sample_plugin.json']);
    assert.strictEqual(fs.existsSync(path.join(customRoot, 'sample_plugin.json')), true);
    assert.deepStrictEqual(copyMissingPluginConfigs(defaultRoot, customRoot), [], '不能覆盖新目录中的同名用户配置');

    const settingsPath = path.join(testRoot, 'user-data', 'settings.json');
    const persisted = savePluginConfigDirectory({
        settingsPath,
        appSettings: { pythonMode: 'embedded', customPluginConfigDir: '' },
        installedAppPath: installDir,
        customPluginConfigDir: customRoot
    });
    const reloadedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.strictEqual(reloadedSettings.customPluginConfigDir, customRoot);
    assert.strictEqual(getPluginConfigRoot(reloadedSettings, installDir), customRoot, '重启读取后必须继续使用自定义目录');
    assert.strictEqual(persisted.directory, customRoot);
    assert.strictEqual(reloadedSettings.pythonMode, 'embedded', '独立保存目录时必须保留其他设置');

    const existingConfigPath = path.join(customRoot, 'sample_plugin.json');
    fs.writeFileSync(existingConfigPath, JSON.stringify({ endpoint: 'kept', token: 'private' }), 'utf8');
    savePluginConfigDirectory({
        settingsPath,
        appSettings: reloadedSettings,
        installedAppPath: installDir,
        customPluginConfigDir: customRoot
    });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(existingConfigPath, 'utf8')), {
        endpoint: 'kept', token: 'private'
    }, '再次保存目录不能覆盖已有用户配置');

    const reset = savePluginConfigDirectory({
        settingsPath,
        appSettings: reloadedSettings,
        installedAppPath: installDir,
        customPluginConfigDir: ''
    });
    const resetSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.strictEqual(resetSettings.customPluginConfigDir, '');
    assert.strictEqual(reset.directory, defaultRoot, '恢复默认后必须重新使用安装目录旁的 plugin-configs');
    console.log('plugin_config test passed');
} finally {
    fs.rmSync(testRoot, { recursive: true, force: true });
}
