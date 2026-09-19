const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initializeSoftwareStore } = require('../app/software_store');

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

    console.log('software_store test passed');
} finally {
    fs.rmSync(testRoot, { recursive: true, force: true });
}
