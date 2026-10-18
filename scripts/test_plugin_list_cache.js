const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createPluginListCache } = require('../app/plugin_list_cache');

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yuhanbopy-list-cache-'));
    try {
        const plugin = path.join(root, 'sample');
        fs.mkdirSync(path.join(plugin, 'assets'), { recursive: true });
        const script = path.join(plugin, 'main.py');
        const settings = path.join(plugin, 'settings.json');
        const logo = path.join(plugin, 'assets', 'custom.png');
        const laterLogo = path.join(plugin, 'assets', 'later.png');
        fs.writeFileSync(script, 'version1');
        fs.writeFileSync(settings, '{"name":"original"}');
        fs.writeFileSync(logo, 'manual-logo');
        let builds = 0;
        const build = () => {
            builds++;
            return [{ path: script, logoPath: logo, visualDependencies: [laterLogo], name: JSON.parse(fs.readFileSync(settings)).name,
                version: fs.readFileSync(script, 'utf8') }];
        };
        const cache = createPluginListCache();
        assert.strictEqual(cache.get(plugin, 'config-root', build)[0].name, 'original');
        cache.get(plugin, 'config-root', build);
        assert.strictEqual(builds, 1, '无变化刷新不应读取并重建插件信息');
        fs.writeFileSync(script, 'version2');
        fs.utimesSync(script, 1, Date.now() / 1000 + 1);
        assert.strictEqual(cache.get(plugin, 'config-root', build)[0].version, 'version2');
        fs.writeFileSync(settings, '{"name":"updated"}');
        assert.strictEqual(cache.get(plugin, 'config-root', build)[0].name, 'updated');
        const beforeLogo = builds;
        fs.writeFileSync(logo, 'replaced-manual-logo');
        cache.get(plugin, 'config-root', build);
        assert.strictEqual(builds, beforeLogo + 1, '嵌套手工图片变化也应使缓存失效');
        const beforeAdd = builds;
        fs.writeFileSync(path.join(plugin, 'README.md'), 'new documentation');
        fs.utimesSync(plugin, 1, Date.now() / 1000 + 2);
        cache.get(plugin, 'config-root', build);
        assert.strictEqual(builds, beforeAdd + 1, '新增资源需要重新探测');
        cache.get(plugin, 'new-config-root', build);
        assert.strictEqual(builds, beforeAdd + 2, '更换配置目录不得返回旧路径');
        cache.prune([]);
        cache.get(plugin, 'new-config-root', build);
        assert.strictEqual(builds, beforeAdd + 3, '移除插件应释放旧缓存');
        fs.unlinkSync(logo);
        cache.get(plugin, 'new-config-root', build);
        assert.strictEqual(builds, beforeAdd + 4, '资源删除应使缓存失效');
        fs.writeFileSync(laterLogo, 'newly-supplied-logo');
        cache.get(plugin, 'new-config-root', build);
        assert.strictEqual(builds, beforeAdd + 5, '原先缺少的嵌套图标补齐后不能继续使用默认图标缓存');

        const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
        const start = html.indexOf('let programsLoadPromise =');
        const end = html.indexOf('\n        function openModal', start);
        let renders = 0;
        let requests = 0;
        let data = [{ name: 'original' }];
        const context = { state: { programs: [] },
            applySearch: () => renders++, showNotification: () => assert.fail('列表加载不应失败'),
            ipcRenderer: { invoke: async () => { requests++; return data; } } };
        vm.createContext(context);
        vm.runInContext(html.slice(start, end), context);
        await context.loadPrograms();
        await context.loadPrograms();
        assert.strictEqual(renders, 1, '无变化的周期刷新不应重建卡片');
        data = [{ name: 'changed' }];
        await context.loadPrograms();
        assert.strictEqual(renders, 2, '变化后必须立即更新列表');
        const beforeConcurrent = requests;
        await Promise.all(Array.from({ length: 6 }, () => context.loadPrograms()));
        assert.strictEqual(requests - beforeConcurrent, 2, '并发刷新应合并为当前请求和一次补查');
        assert.strictEqual(renders, 2);
        console.log('plugin_list_cache tests passed (resource invalidation, removed plugins, configuration directory, rendering, concurrent refresh)');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
