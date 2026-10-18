const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    createBundledRuntime,
    createCustomRuntime,
    createPythonProcessEnv,
    inspectPythonRuntime
} = require('../app/python_runtime');
const { generateManifest } = require('./generate_macos_update_manifest');

async function main() {
    const projectRoot = path.resolve(__dirname, '..');
    const embedded = createBundledRuntime(projectRoot, { platform: 'win32', arch: 'x64' });
    const rootPath = embedded.rootPath;
    const embeddedEnv = createPythonProcessEnv(embedded, {
        baseEnv: { PATH: 'system-path', PYTHONPATH: 'system-python-path' },
        appPath: 'app-path',
        pathDelimiter: ';'
    });
    assert.strictEqual(embeddedEnv.PYTHONHOME, rootPath);
    assert(embeddedEnv.PYTHONPATH.includes(path.join(rootPath, 'Lib', 'site-packages')));

    for (const [platform, directory, arch] of [
        ['darwin', 'macos', 'x64'],
        ['darwin', 'macos', 'arm64'],
        ['linux', 'linux', 'x64']
    ]) {
        const runtime = createBundledRuntime(projectRoot, { platform, arch });
        assert.strictEqual(runtime.executable, path.join(projectRoot, 'python', `python-3.12.8-${directory}-${arch}`, 'bin', 'python3'));
        assert(!runtime.executable.endsWith('.exe'), `${platform} 不能使用 Windows 解释器`);
        const env = createPythonProcessEnv(runtime, {
            baseEnv: { PATH: 'system-path', TCL_LIBRARY: 'host-tcl', TK_LIBRARY: 'host-tk' },
            appPath: 'app-path', pathDelimiter: ':'
        });
        assert.strictEqual(env.PYTHONHOME, runtime.rootPath);
        assert(env.PATH.includes(`${runtime.rootPath}:${runtime.scriptsPath}`));
        assert.strictEqual(env.TCL_LIBRARY, undefined, '不存在随包 Tcl 路径时不能继承构建机路径');
        assert.strictEqual(env.TK_LIBRARY, undefined, '不存在随包 Tk 路径时不能继承构建机路径');
    }
    assert.throws(() => createBundledRuntime(projectRoot, { platform: 'linux', arch: 'arm64' }), /不支持/);
    assert.throws(() => createBundledRuntime(projectRoot, { platform: 'win32', arch: 'arm64' }), /不支持/);

    const workflow = fs.readFileSync(path.join(projectRoot, '.github', 'workflows', 'release.yml'), 'utf8');
    assert(workflow.includes('bash scripts/prepare_portable_python.sh macos "${{ matrix.arch }}"'));
    assert(workflow.includes('bash scripts/prepare_portable_python.sh linux x64'));
    assert(workflow.includes('runner: macos-15-intel'), 'x64 macOS 资产必须在 Intel runner 构建');
    assert(workflow.includes('runner: macos-15'), 'arm64 macOS 资产必须在 Apple Silicon runner 构建');
    assert(workflow.includes('node scripts/generate_macos_update_manifest.js dist'));
    const runtimeScript = fs.readFileSync(path.join(projectRoot, 'scripts', 'prepare_portable_python.sh'), 'utf8');
    assert(runtimeScript.includes('aarch64-apple-darwin'));
    assert(runtimeScript.includes('python-${version}-${platform}-${architecture}'));
    assert(runtimeScript.includes('Runtime architecture mismatch'));
    const mainSource = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
    assert(!mainSource.includes("python-3.12.8-embed-amd64"), '主进程不能硬编码 Windows runtime 路径');
    assert(mainSource.includes("process.platform === 'win32'"), '自定义解释器选择器必须按平台过滤');
    const indexSource = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
    assert(indexSource.includes('macOS/Linux 通常为 python3'));

    const manifestRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yuhanbopy-mac-manifest-'));
    try {
        fs.writeFileSync(path.join(manifestRoot, 'yuhanbopy-app-9.9.9-mac-x64.zip'), 'x64');
        fs.writeFileSync(path.join(manifestRoot, 'yuhanbopy-app-9.9.9-mac-arm64.zip'), 'arm64');
        const manifest = await generateManifest(manifestRoot, '9.9.9');
        const manifestSource = fs.readFileSync(manifest.outputPath, 'utf8');
        assert(manifestSource.includes('version: 9.9.9'));
        assert(manifestSource.includes('yuhanbopy-app-9.9.9-mac-x64.zip'));
        assert(manifestSource.includes('yuhanbopy-app-9.9.9-mac-arm64.zip'));
        assert.strictEqual(manifest.files.length, 2);
    } finally {
        fs.rmSync(manifestRoot, { recursive: true, force: true });
    }

    const custom = createCustomRuntime('D:\\Python311\\python.exe');
    const customEnv = createPythonProcessEnv(custom, {
        baseEnv: {
            PATH: 'system-path',
            PYTHONPATH: 'user-python-path',
            PYTHONHOME: 'embedded-home',
            TCL_LIBRARY: 'embedded-tcl',
            TK_LIBRARY: 'embedded-tk'
        },
        appPath: 'app-path',
        pathDelimiter: ';'
    });
    assert.strictEqual(customEnv.PYTHONHOME, undefined);
    assert.strictEqual(customEnv.TCL_LIBRARY, undefined);
    assert.strictEqual(customEnv.TK_LIBRARY, undefined);
    assert(customEnv.PYTHONPATH.includes('user-python-path'));
    assert(!customEnv.PYTHONPATH.includes('site-packages'));
    assert(customEnv.PATH.includes('D:\\Python311\\Scripts'));

    const info = await inspectPythonRuntime(embedded, { env: embeddedEnv });
    assert.strictEqual(info.major, 3);
    assert(info.version);
    const selectedRuntime = createCustomRuntime(embedded.executable);
    const selectedInfo = await inspectPythonRuntime(selectedRuntime, {
        env: createPythonProcessEnv(selectedRuntime, {
            baseEnv: process.env,
            appPath: path.resolve(__dirname, '..', 'app')
        })
    });
    assert.strictEqual(selectedInfo.major, 3);
    console.log(`python_runtime test passed (${info.version})`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
