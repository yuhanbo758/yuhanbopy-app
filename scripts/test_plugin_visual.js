const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolvePluginVisual, createPluginAppId } = require('../app/plugin_visual');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yuhanbopy-visual-readonly-'));
try {
    const folderPath = path.join(root, 'plugin');
    fs.mkdirSync(folderPath);
    const defaultLogoPath = path.join(root, 'default.png');
    const defaultIconPath = path.join(root, 'default.ico');
    fs.writeFileSync(defaultLogoPath, 'default-logo');
    fs.writeFileSync(defaultIconPath, 'default-icon');
    const options = { folderPath, defaultLogoPath, defaultIconPath };
    const missing = resolvePluginVisual(options);
    assert.strictEqual(missing.logoPath, defaultLogoPath);
    assert.strictEqual(missing.taskbarIconPath, defaultIconPath);
    assert.deepStrictEqual(fs.readdirSync(folderPath), [], '缺图时不得生成任何图标或元数据文件');
    const png = path.join(folderPath, 'logo.png');
    fs.writeFileSync(png, 'plugin-logo');
    const pngOnly = resolvePluginVisual(options);
    assert.strictEqual(pngOnly.logoPath, png);
    assert.strictEqual(pngOnly.taskbarIconPath, defaultIconPath, '缺少插件 ICO 时使用默认图标，不能自动转换');
    assert.strictEqual(fs.existsSync(path.join(folderPath, 'logo.ico')), false);
    const custom = path.join(folderPath, 'custom.ico');
    fs.writeFileSync(custom, 'custom-icon');
    const supplied = resolvePluginVisual({ ...options, settings: { logo: 'custom.ico' } });
    assert.strictEqual(supplied.logoPath, custom);
    assert.strictEqual(supplied.taskbarIconPath, custom);
    const external = resolvePluginVisual({ ...options, settings: { logo: '../default.png' } });
    assert.strictEqual(external.logoPath, png, '元数据不能引用插件目录外资源');
    fs.unlinkSync(png);
    fs.renameSync(custom, path.join(folderPath, 'logo.ico'));
    const icoOnly = resolvePluginVisual(options);
    assert.strictEqual(icoOnly.logoPath, path.join(folderPath, 'logo.ico'));
    assert.strictEqual(icoOnly.taskbarIconPath, icoOnly.logoPath);
    assert.strictEqual(createPluginAppId(folderPath), 'com.sanrenjz.yuhanbopy.plugin.plugin');
    const before = fs.readdirSync(folderPath).map((name) => [name, fs.readFileSync(path.join(folderPath, name), 'hex')]);
    resolvePluginVisual(options);
    assert.deepStrictEqual(fs.readdirSync(folderPath).map((name) => [name, fs.readFileSync(path.join(folderPath, name), 'hex')]), before);
    const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert(!main.includes('ensurePluginLogo') && !main.includes("'plugin_logo.js'"), '主程序不能引用制作阶段的图标生成器');
    console.log('plugin_visual tests passed (supplied icons, defaults, PNG-only, ICO-only, read-only runtime)');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
