const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initializeSoftwareStore, importLocalSoftware } = require('../app/software_store');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yuhanbopy-plugin-store-test-'));

function writePlugin(baseDir, name, content) {
    const pluginDir = path.join(baseDir, name);
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'value.txt'), content, 'utf8');
}

try {
    const bundledDir = path.join(testRoot, 'bundled');
    const migrationDir = path.join(testRoot, 'migration');
    const persistentDir = path.join(testRoot, 'persistent');

    writePlugin(bundledDir, 'same-plugin', 'remote-version');
    writePlugin(bundledDir, 'remote-only-plugin', 'new-plugin');
    writePlugin(migrationDir, 'same-plugin', 'local-version');
    writePlugin(migrationDir, 'local-only-plugin', 'custom-plugin');
    writePlugin(migrationDir, '.downloads', 'download-cache');

    const result = initializeSoftwareStore({
        bundledDir,
        persistentDir,
        migrationDirs: [migrationDir]
    });

    assert.strictEqual(
        fs.readFileSync(path.join(persistentDir, 'same-plugin', 'value.txt'), 'utf8'),
        'local-version',
        '同名插件必须保留本地版本'
    );
    assert.strictEqual(
        fs.readFileSync(path.join(persistentDir, 'local-only-plugin', 'value.txt'), 'utf8'),
        'custom-plugin',
        '本地独有插件必须完成迁移'
    );
    assert.strictEqual(
        fs.readFileSync(path.join(persistentDir, 'remote-only-plugin', 'value.txt'), 'utf8'),
        'new-plugin',
        '远端新增插件必须补充到本地'
    );
    assert.strictEqual(fs.existsSync(path.join(persistentDir, '.downloads')), false, '不能迁移下载缓存');
    assert.strictEqual(fs.existsSync(migrationDir), false, '成功迁移后应清理临时备份');
    assert.deepStrictEqual(result.migrated.sort(), ['local-only-plugin', 'same-plugin']);
    assert.deepStrictEqual(result.added, ['remote-only-plugin']);
    assert.deepStrictEqual(result.preserved, ['same-plugin']);

    const localDir = path.join(testRoot, 'local');
    const sourceDir = path.join(localDir, 'same-plugin');
    writePlugin(localDir, 'same-plugin', 'import-v1');
    fs.writeFileSync(path.join(sourceDir, 'obsolete.py'), 'old', 'utf8');
    assert.strictEqual(importLocalSoftware(sourceDir, persistentDir).action, 'replaced');
    fs.unlinkSync(path.join(sourceDir, 'obsolete.py'));
    fs.writeFileSync(path.join(sourceDir, 'value.txt'), 'import-v2', 'utf8');
    const userConfig = path.join(testRoot, 'plugin-configs', 'same-plugin.json');
    fs.mkdirSync(path.dirname(userConfig));
    fs.writeFileSync(userConfig, '{"user":"preserved"}', 'utf8');
    fs.writeFileSync(path.join(persistentDir, 'same-plugin', 'config.json'), '{"default":"old"}', 'utf8');
    fs.writeFileSync(path.join(sourceDir, 'config.json'), '{"default":"new"}', 'utf8');
    assert.strictEqual(importLocalSoftware(sourceDir, persistentDir, [], path.dirname(userConfig)).action, 'replaced');
    const targetDir = path.join(persistentDir, 'same-plugin');
    assert.strictEqual(fs.readFileSync(path.join(targetDir, 'value.txt'), 'utf8'), 'import-v2');
    assert.strictEqual(fs.existsSync(path.join(targetDir, 'obsolete.py')), false, '替换须清除旧版遗留文件');
    assert.strictEqual(fs.existsSync(path.join(persistentDir, 'same-plugin_1')), false, '不得生成副本目录');
    assert.strictEqual(fs.readFileSync(userConfig, 'utf8'), '{"user":"preserved"}');
    assert.strictEqual(fs.readFileSync(path.join(targetDir, 'config.json'), 'utf8'), '{"default":"old"}', '替换程序不得覆盖原配置模板');
    const { preparePluginConfig } = require('../app/plugin_config');
    const existingUserBytes = fs.readFileSync(userConfig);
    fs.writeFileSync(path.join(sourceDir, 'settings.json'), JSON.stringify({ config_file: 'defaults/new-config.json', version: '2' }));
    fs.mkdirSync(path.join(sourceDir, 'defaults'));
    fs.writeFileSync(path.join(sourceDir, 'defaults/new-config.json'), '{}');
    importLocalSoftware(sourceDir, persistentDir, [], path.dirname(userConfig));
    const incomingSettings = JSON.parse(fs.readFileSync(path.join(targetDir, 'settings.json'), 'utf8'));
    assert.strictEqual(incomingSettings.version, '2', '程序元数据应更新');
    assert.strictEqual(fs.readFileSync(path.join(targetDir, incomingSettings.config_file), 'utf8'), '{"default":"old"}', '配置改名后也必须沿用旧内容');
    const loadedConfig = preparePluginConfig({ folderPath: targetDir, settings: incomingSettings, configRoot: path.dirname(userConfig) });
    assert.strictEqual(loadedConfig.configPath, userConfig);
    assert.deepStrictEqual(fs.readFileSync(loadedConfig.configPath), existingUserBytes, '重载并扫描后用户配置必须逐字节不变');
    const legacyRoot = path.join(testRoot, 'legacy-user-configs');
    fs.writeFileSync(path.join(targetDir, 'sync_config.json'), '{"paths":{"txt":"user.txt"}}');
    fs.writeFileSync(path.join(sourceDir, 'sync_config.json'), '{}');
    importLocalSoftware(sourceDir, persistentDir, [], legacyRoot);
    assert.strictEqual(fs.readFileSync(path.join(targetDir, 'sync_config.json'), 'utf8'), '{"paths":{"txt":"user.txt"}}', '未声明的旧版 sync_config.json 也不能覆盖');
    assert.strictEqual(fs.readFileSync(path.join(legacyRoot, 'same-plugin.json'), 'utf8'), '{\n  "default": "old"\n}\n', '用户目录首次初始化必须读取旧插件配置，不得用新包空模板');
    assert.throws(() => importLocalSoftware(sourceDir, persistentDir, [], path.join(targetDir, 'private')), /用户配置目录/);
    assert.strictEqual(importLocalSoftware(targetDir, persistentDir).action, 'unchanged');
    assert.throws(() => importLocalSoftware(sourceDir, persistentDir, [path.join(targetDir, 'main.py')]), /正在运行/);
    assert.throws(() => importLocalSoftware(persistentDir, persistentDir), /互相包含/);
    const nestedSource = path.join(targetDir, 'same-plugin');
    fs.mkdirSync(nestedSource);
    assert.throws(() => importLocalSoftware(nestedSource, persistentDir), /互相包含/);

    const script = path.join(localDir, '测试.py');
    fs.writeFileSync(script, 'v1', 'utf8');
    assert.strictEqual(importLocalSoftware(script, persistentDir).action, 'added');
    fs.writeFileSync(script, 'v2', 'utf8');
    assert.strictEqual(importLocalSoftware(script, persistentDir).action, 'replaced');
    assert.strictEqual(fs.readFileSync(path.join(persistentDir, '测试.py'), 'utf8'), 'v2');
    assert.strictEqual(fs.existsSync(path.join(persistentDir, '测试_1.py')), false);

    // 模拟复制和切换失败，验证旧插件及临时目录清理，而非只验证成功路径。
    const originalCopy = fs.cpSync;
    try {
        fs.cpSync = () => { throw new Error('模拟复制失败'); };
        assert.throws(() => importLocalSoftware(sourceDir, persistentDir), /模拟复制失败/);
    } finally {
        fs.cpSync = originalCopy;
    }
    const originalRename = fs.renameSync;
    try {
        fs.renameSync = (from, to) => {
            if (path.basename(from) === 'new') throw new Error('模拟切换失败');
            return originalRename(from, to);
        };
        assert.throws(() => importLocalSoftware(sourceDir, persistentDir), /模拟切换失败/);
    } finally {
        fs.renameSync = originalRename;
    }
    assert.strictEqual(fs.readFileSync(path.join(targetDir, 'value.txt'), 'utf8'), 'import-v2', '失败后须保留旧插件');
    assert.strictEqual(fs.readdirSync(persistentDir).some((name) => name.startsWith('.local-import-')), false);

    console.log('software_store tests passed (startup preservation, local replacement, rollback)');
} finally {
    fs.rmSync(testRoot, { recursive: true, force: true });
}
