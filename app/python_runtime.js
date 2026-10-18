const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function createEmbeddedRuntime(paths) {
    return {
        mode: 'embedded',
        executable: paths.executable,
        rootPath: paths.rootPath,
        scriptsPath: paths.scriptsPath,
        libPath: paths.libPath,
        sitePackagesPath: paths.sitePackagesPath,
        dllsPath: paths.dllsPath,
        tclPath: paths.tclPath,
        tclLibraryPath: paths.tclLibraryPath || '',
        tkLibraryPath: paths.tkLibraryPath || '',
        platform: paths.platform || process.platform,
        requiredPaths: paths.requiredPaths || []
    };
}

function firstDirectory(candidates) {
    return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

function createBundledRuntime(appRoot, { platform = process.platform, arch = process.arch } = {}) {
    if (arch !== 'x64') {
        throw new Error(`当前安装包不支持 ${platform}/${arch} Python 运行时`);
    }

    if (platform === 'win32') {
        const rootPath = path.join(appRoot, 'python', 'python-3.12.8-embed-amd64');
        const libPath = path.join(rootPath, 'Lib');
        const scriptsPath = path.join(rootPath, 'Scripts');
        const dllsPath = path.join(rootPath, 'DLLs');
        const tclPath = path.join(rootPath, 'tcl');
        return createEmbeddedRuntime({
            executable: path.join(rootPath, 'python.exe'), rootPath, scriptsPath, libPath,
            sitePackagesPath: path.join(libPath, 'site-packages'), dllsPath, tclPath,
            tclLibraryPath: path.join(tclPath, 'tcl8.6'), tkLibraryPath: path.join(tclPath, 'tk8.6'),
            platform, requiredPaths: [libPath, scriptsPath, dllsPath]
        });
    }

    const platformName = platform === 'darwin' ? 'macos' : platform;
    if (!['macos', 'linux'].includes(platformName)) {
        throw new Error(`当前安装包不支持 ${platform}/${arch} Python 运行时`);
    }
    const rootPath = path.join(appRoot, 'python', `python-3.12.8-${platformName}-x64`);
    const scriptsPath = path.join(rootPath, 'bin');
    const libPath = path.join(rootPath, 'lib', 'python3.12');
    return createEmbeddedRuntime({
        executable: path.join(scriptsPath, 'python3'), rootPath, scriptsPath, libPath,
        sitePackagesPath: path.join(libPath, 'site-packages'), dllsPath: '', tclPath: '', platform,
        tclLibraryPath: firstDirectory([
            path.join(rootPath, 'lib', 'tcl8.6'),
            path.join(rootPath, 'share', 'tcltk', 'tcl8.6')
        ]),
        tkLibraryPath: firstDirectory([
            path.join(rootPath, 'lib', 'tk8.6'),
            path.join(rootPath, 'share', 'tcltk', 'tk8.6')
        ]),
        requiredPaths: [libPath, scriptsPath]
    });
}

function createCustomRuntime(executable, info = {}) {
    const normalizedExecutable = String(executable || '').trim();
    const resolvedExecutable = normalizedExecutable ? path.resolve(normalizedExecutable) : '';
    return {
        mode: 'custom',
        executable: resolvedExecutable,
        rootPath: info.prefix || (resolvedExecutable ? path.dirname(resolvedExecutable) : ''),
        version: info.version || '',
        prefix: info.prefix || ''
    };
}

function createPythonProcessEnv(runtime, { baseEnv = process.env, appPath = '', pathDelimiter = path.delimiter } = {}) {
    const env = { ...baseEnv, PYTHONIOENCODING: 'utf-8' };

    if (runtime.mode === 'embedded') {
        env.PATH = [runtime.rootPath, runtime.dllsPath, runtime.scriptsPath, baseEnv.PATH]
            .filter(Boolean)
            .join(pathDelimiter);
        env.PYTHONPATH = [runtime.libPath, runtime.sitePackagesPath, appPath]
            .filter(Boolean)
            .join(pathDelimiter);
        env.PYTHONHOME = runtime.rootPath;
        delete env.TCL_LIBRARY;
        delete env.TK_LIBRARY;
        if (runtime.tclLibraryPath) env.TCL_LIBRARY = runtime.tclLibraryPath;
        if (runtime.tkLibraryPath) env.TK_LIBRARY = runtime.tkLibraryPath;
        return env;
    }

    // 自定义解释器必须使用自己的标准库与 site-packages，不能继承内置 Python 的路径。
    delete env.PYTHONHOME;
    delete env.TCL_LIBRARY;
    delete env.TK_LIBRARY;
    const customRoot = runtime.prefix || runtime.rootPath;
    env.PATH = [
        path.dirname(runtime.executable),
        customRoot,
        customRoot && path.join(customRoot, 'Scripts'),
        customRoot && path.join(customRoot, 'Library', 'bin'),
        customRoot && path.join(customRoot, 'DLLs'),
        baseEnv.PATH
    ].filter(Boolean).join(pathDelimiter);
    env.PYTHONPATH = [appPath, baseEnv.PYTHONPATH].filter(Boolean).join(pathDelimiter);
    return env;
}

function inspectPythonRuntime(runtime, { env, timeoutMs = 10000 } = {}) {
    const inspectCode = [
        'import json, sys',
        'print(json.dumps({',
        '    "executable": sys.executable,',
        '    "version": sys.version.split()[0],',
        '    "prefix": sys.prefix,',
        '    "major": sys.version_info[0]',
        '}))'
    ].join('\n');

    return new Promise((resolve, reject) => {
        const child = spawn(runtime.executable, ['-c', inspectCode], {
            windowsHide: true,
            env: env || process.env
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill();
            reject(new Error('Python 环境检测超时'));
        }, timeoutMs);

        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });
        child.on('error', (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(new Error(`无法启动 Python：${error.message}`));
        });
        child.on('close', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (code !== 0) {
                reject(new Error(`Python 环境检测失败：${stderr.trim() || `退出码 ${code}`}`));
                return;
            }

            try {
                const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
                const info = JSON.parse(line || '');
                if (info.major !== 3) {
                    throw new Error(`仅支持 Python 3，当前版本为 ${info.version || '未知'}`);
                }
                resolve(info);
            } catch (error) {
                reject(new Error(`无法识别 Python 环境：${error.message}`));
            }
        });
    });
}

module.exports = {
    createBundledRuntime,
    createCustomRuntime,
    createEmbeddedRuntime,
    createPythonProcessEnv,
    inspectPythonRuntime
};
