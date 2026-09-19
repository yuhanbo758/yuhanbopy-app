const assert = require('assert');
const path = require('path');
const {
    createCustomRuntime,
    createEmbeddedRuntime,
    createPythonProcessEnv,
    inspectPythonRuntime
} = require('../app/python_runtime');

async function main() {
    const rootPath = path.resolve(__dirname, '..', 'python', 'python-3.12.8-embed-amd64');
    const embedded = createEmbeddedRuntime({
        executable: path.join(rootPath, 'python.exe'),
        rootPath,
        scriptsPath: path.join(rootPath, 'Scripts'),
        libPath: path.join(rootPath, 'Lib'),
        sitePackagesPath: path.join(rootPath, 'Lib', 'site-packages'),
        dllsPath: path.join(rootPath, 'DLLs'),
        tclPath: path.join(rootPath, 'tcl')
    });
    const embeddedEnv = createPythonProcessEnv(embedded, {
        baseEnv: { PATH: 'system-path', PYTHONPATH: 'system-python-path' },
        appPath: 'app-path',
        pathDelimiter: ';'
    });
    assert.strictEqual(embeddedEnv.PYTHONHOME, rootPath);
    assert(embeddedEnv.PYTHONPATH.includes(path.join(rootPath, 'Lib', 'site-packages')));

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
