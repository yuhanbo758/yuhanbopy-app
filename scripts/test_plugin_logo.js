const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    calculatePluginFingerprint,
    classifyPluginSemantic,
    createPluginAppId,
    ensurePluginLogo,
    generatePluginLogoPng,
    generateWindowsIco
} = require('../app/plugin_logo');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yuhanbopy-logo-test-'));
try {
    const folderPath = path.join(testRoot, 'sample_plugin');
    fs.mkdirSync(folderPath);
    const mainFilePath = path.join(folderPath, 'sample_plugin.py');
    fs.writeFileSync(mainFilePath, 'print("v1")\n', 'utf8');
    const settings = { name: '示例插件', category: '测试工具', main_file: 'sample_plugin.py', logo: 'logo.png' };
    const firstFingerprint = calculatePluginFingerprint(folderPath, settings, mainFilePath);
    const png = generatePluginLogoPng(firstFingerprint, 'tool');
    assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    const ico = generateWindowsIco(png);
    assert.strictEqual(ico.readUInt16LE(2), 1, '必须生成 Windows ICO 容器');
    assert.strictEqual(classifyPluginSemantic('cos_downloader', {
        name: '腾讯云对象存储下载器', category: '下载工具'
    }), 'cloud-download');
    assert.strictEqual(classifyPluginSemantic('file_downloader', {
        name: '文件下载器', category: '下载工具'
    }), 'file-download');
    assert.strictEqual(classifyPluginSemantic('github_downloader', {
        name: 'GitHub 仓库下载器', category: '下载工具'
    }), 'repository-download');
    assert.strictEqual(classifyPluginSemantic('terminal', {
        name: '终端模拟器', category: '系统工具'
    }), 'terminal');
    assert(!generatePluginLogoPng(firstFingerprint, 'terminal').equals(
        generatePluginLogoPng(firstFingerprint, 'file-download')
    ), '不同功能模板必须生成不同 Logo');

    const first = ensurePluginLogo({ folderPath, settings, mainFilePath });
    assert(fs.existsSync(first.logoPath));
    assert(fs.existsSync(first.taskbarIconPath));
    const firstBytes = fs.readFileSync(first.logoPath);
    const repeated = ensurePluginLogo({ folderPath, settings, mainFilePath });
    assert(firstBytes.equals(fs.readFileSync(repeated.logoPath)), '相同代码必须生成稳定 Logo');

    fs.writeFileSync(mainFilePath, 'print("v2")\n', 'utf8');
    const changed = ensurePluginLogo({ folderPath, settings, mainFilePath });
    assert(!firstBytes.equals(fs.readFileSync(changed.logoPath)), '代码变化后自动 Logo 应同步变化');
    assert.strictEqual(createPluginAppId(folderPath), 'com.sanrenjz.yuhanbopy.plugin.sample.plugin');

    fs.writeFileSync(changed.logoPath, Buffer.from('author-designed-logo'));
    fs.writeFileSync(mainFilePath, 'print("v3")\n', 'utf8');
    ensurePluginLogo({ folderPath, settings, mainFilePath });
    assert.strictEqual(fs.readFileSync(changed.logoPath, 'utf8'), 'author-designed-logo', '作者替换的 Logo 不能被覆盖');

    const manualFolder = path.join(testRoot, 'manual_plugin');
    fs.mkdirSync(manualFolder);
    const manualLogo = path.join(manualFolder, 'logo.png');
    fs.writeFileSync(manualLogo, Buffer.from('manual-logo'));
    const manual = ensurePluginLogo({ folderPath: manualFolder, settings: {}, mainFilePath: '' });
    assert.strictEqual(fs.readFileSync(manual.logoPath, 'utf8'), 'manual-logo', '手工 Logo 不能被覆盖');
    assert.strictEqual(path.extname(manual.taskbarIconPath), '.ico', '手工 PNG 必须补充 Windows 任务栏 ICO');
    assert(fs.existsSync(manual.taskbarIconPath), '手工 PNG 对应的 ICO 必须写入插件目录');
    console.log('plugin_logo test passed');
} finally {
    fs.rmSync(testRoot, { recursive: true, force: true });
}
