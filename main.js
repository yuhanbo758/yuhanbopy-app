const { app, BrowserWindow, ipcMain, dialog, shell, session, safeStorage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');

let autoUpdater = null;
try {
    autoUpdater = require('electron-updater').autoUpdater;
} catch (error) {
    console.warn('自动更新模块不可用:', error.message || error);
}

const remoteMain = require('@electron/remote/main');
remoteMain.initialize();

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
}

const SHOP_BASE_URL = 'https://shop.sanrenjz.com';
const SHOP_STORE_URL = `${SHOP_BASE_URL}/python`;
const SHOP_MEMBER_CENTER_URL = `${SHOP_BASE_URL}/member-center`;
const SHOP_HOSTNAME = new URL(SHOP_BASE_URL).hostname;
const DOWNLOAD_HOSTNAME = 'xz.sanrenjz.com';
const UPDATE_GENERIC_URL = 'https://xz.sanrenjz.com/Download/yuhanbopy-app/';
const GITHUB_OWNER = 'yuhanbo758';
const GITHUB_REPO = 'yuhanbopy-app';
const BUILTIN_BROWSER_PARTITION = 'persist:yuhanbopy-app-shop';
const ACCOUNT_TOKEN_FILE = 'account-token.bin';
const SETTINGS_FILE = 'settings.json';

const appRoot = app.isPackaged ? process.resourcesPath : __dirname;
const buildRoot = path.join(appRoot, 'build');
const pythonRootPath = path.join(appRoot, 'python', 'python-3.12.8-embed-amd64');
const pythonPath = path.join(pythonRootPath, 'python.exe');
const pythonScriptsPath = path.join(pythonRootPath, 'Scripts');
const pythonLibPath = path.join(pythonRootPath, 'Lib');
const pythonSitePackagesPath = path.join(pythonLibPath, 'site-packages');
const pythonTclPath = path.join(pythonRootPath, 'tcl');
const pythonDLLsPath = path.join(pythonRootPath, 'DLLs');
const embeddedAppPath = path.join(appRoot, 'app');
const settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);

const defaultSettings = {
    autoStart: false,
    autoCheckUpdates: true
};

let mainWindow = null;
let logWindow = null;
let shopWindow = null;
let isQuitting = false;
let cachedAccount = null;
let lastUpdateSource = 'github';
let lastCheckedUpdateInfo = null;
let updateAvailable = false;
let builtinSessionEventsBound = false;
let suppressUpdaterErrors = false;

const runningProcesses = new Map();

process.env.PATH = [pythonRootPath, pythonDLLsPath, pythonScriptsPath, process.env.PATH]
    .filter(Boolean)
    .join(';');

process.env.PYTHONPATH = [pythonLibPath, pythonSitePackagesPath, embeddedAppPath]
    .filter(Boolean)
    .join(';');

process.env.TCL_LIBRARY = path.join(pythonTclPath, 'tcl8.6');
process.env.TK_LIBRARY = path.join(pythonTclPath, 'tk8.6');
process.env.PYTHONHOME = pythonRootPath;

function configureLoggingAndCache() {
    try {
        app.commandLine.appendSwitch('disable-logging');
        app.commandLine.appendSwitch('lang', 'en-US');
        process.env.ELECTRON_ENABLE_LOGGING = '0';
        const cachePath = path.join(app.getPath('userData'), 'Cache');
        fs.mkdirSync(cachePath, { recursive: true });
        app.setPath('cache', cachePath);
    } catch (error) {
        console.warn('配置缓存目录失败:', error.message || error);
    }
}

configureLoggingAndCache();

function ensureDir(targetPath) {
    fs.mkdirSync(targetPath, { recursive: true });
    return targetPath;
}

function ensurePathExists(targetPath) {
    if (!fs.existsSync(targetPath)) {
        console.warn(`路径不存在: ${targetPath}`);
        return false;
    }
    return true;
}

function getIconPath() {
    const candidates = [
        path.join(buildRoot, 'icon.ico'),
        path.join(buildRoot, 'logo.ico'),
        path.join(buildRoot, 'logo.png')
    ];
    return candidates.find((candidate) => fs.existsSync(candidate));
}

function getSoftwareDir() {
    return ensureDir(path.join(appRoot, 'app', 'software'));
}

function getBuiltinSession() {
    return session.fromPartition(BUILTIN_BROWSER_PARTITION);
}

function tokenPath() {
    return path.join(app.getPath('userData'), ACCOUNT_TOKEN_FILE);
}

function sanitizeFileName(fileName) {
    return String(fileName || 'download')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, ' ')
        .trim() || 'download';
}

function uniquePath(filePath) {
    if (!fs.existsSync(filePath)) {
        return filePath;
    }

    const parsed = path.parse(filePath);
    let counter = 1;
    while (true) {
        const candidate = path.join(parsed.dir, `${parsed.name}_${counter}${parsed.ext}`);
        if (!fs.existsSync(candidate)) {
            return candidate;
        }
        counter += 1;
    }
}

function removePath(targetPath) {
    try {
        fs.rmSync(targetPath, { recursive: true, force: true });
    } catch (error) {
        console.warn('删除路径失败:', targetPath, error.message || error);
    }
}

function copyDirectoryContents(sourceDir, targetDir) {
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
}

function isShopDomain(hostname) {
    const normalized = String(hostname || '').replace(/^\./, '').toLowerCase();
    return normalized === SHOP_HOSTNAME || normalized.endsWith(`.${SHOP_HOSTNAME}`);
}

function isShopUrl(rawUrl) {
    try {
        return isShopDomain(new URL(rawUrl).hostname);
    } catch (_) {
        return false;
    }
}

function isPluginDownloadUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        const extension = path.extname(parsed.pathname || '').toLowerCase();
        return (isShopDomain(parsed.hostname) || parsed.hostname.toLowerCase() === DOWNLOAD_HOSTNAME) && extension === '.zip';
    } catch (_) {
        return false;
    }
}

function toSerializable(value) {
    if (value == null) {
        return value;
    }

    try {
        return JSON.parse(JSON.stringify(value));
    } catch (_) {
        if (value instanceof Error) {
            return { message: value.message || String(value), stack: value.stack || '' };
        }
        return { message: String(value) };
    }
}

function sendRendererEvent(channel, payload = {}) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, toSerializable(payload));
    }
}

function sendUpdateEvent(type, payload = {}) {
    sendRendererEvent('update:status', { type, source: lastUpdateSource, ...payload });
}

function saveAccountToken(token) {
    const file = tokenPath();
    ensureDir(path.dirname(file));
    const content = String(token || '').trim();
    if (!content) {
        removePath(file);
        return;
    }

    const data = safeStorage && safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(content)
        : Buffer.from(content, 'utf8');
    fs.writeFileSync(file, data);
}

function readAccountToken() {
    const file = tokenPath();
    if (!fs.existsSync(file)) {
        return '';
    }

    const data = fs.readFileSync(file);
    try {
        if (safeStorage && safeStorage.isEncryptionAvailable()) {
            return safeStorage.decryptString(data);
        }
    } catch (_) {
        return data.toString('utf8');
    }

    return data.toString('utf8');
}

function clearAccountToken() {
    removePath(tokenPath());
}

function loadSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            return { ...defaultSettings, ...JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
        }
    } catch (error) {
        console.error('读取设置失败:', error);
    }
    return { ...defaultSettings };
}

function saveSettings(settings) {
    const nextSettings = { ...loadSettings(), ...settings };
    ensureDir(path.dirname(settingsPath));
    fs.writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2), 'utf8');
    app.setLoginItemSettings({ openAtLogin: Boolean(nextSettings.autoStart), path: process.execPath });
    return nextSettings;
}

function compareVersions(left, right) {
    const normalize = (value) => String(value || '')
        .trim()
        .replace(/^v/i, '')
        .split('-')[0]
        .split('.')
        .map((segment) => Number.parseInt(segment, 10) || 0);

    const a = normalize(left);
    const b = normalize(right);
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
        const diff = (a[index] || 0) - (b[index] || 0);
        if (diff !== 0) {
            return diff > 0 ? 1 : -1;
        }
    }
    return 0;
}

function configureAutoUpdater(source, token = '') {
    if (!autoUpdater) {
        return;
    }

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.requestHeaders = source === 'object-storage' && token
        ? { Authorization: `Bearer ${token}` }
        : {};
    lastUpdateSource = source;

    if (source === 'object-storage') {
        autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_GENERIC_URL });
        return;
    }

    autoUpdater.setFeedURL({ provider: 'github', owner: GITHUB_OWNER, repo: GITHUB_REPO });
}

function canCheckForUpdates() {
    return Boolean(autoUpdater) && app.isPackaged;
}

async function tryCheckForUpdates(source, token = '', quiet = false) {
    if (!autoUpdater) {
        throw new Error('自动更新模块不可用，请确认 electron-updater 已安装');
    }

    configureAutoUpdater(source, token);
    suppressUpdaterErrors = quiet;
    try {
        const result = await autoUpdater.checkForUpdates();
        const updateInfo = toSerializable(result?.updateInfo || null);
        const available = compareVersions(updateInfo?.version, app.getVersion()) > 0;
        lastCheckedUpdateInfo = updateInfo;
        updateAvailable = available;
        return {
            success: true,
            source: lastUpdateSource,
            available,
            updateInfo
        };
    } finally {
        suppressUpdaterErrors = false;
    }
}

async function shopRequest(apiPath, options = {}) {
    const fetchImpl = global.fetch;
    if (typeof fetchImpl !== 'function') {
        throw new Error('当前 Electron 运行时不支持 fetch');
    }

    const headers = {
        Accept: 'application/json, text/plain, */*',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
    };

    const token = String(options.token || '').trim();
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetchImpl(`${SHOP_BASE_URL}${apiPath}`, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
    });

    const text = await response.text();
    let payload = {};
    try {
        payload = text ? JSON.parse(text) : {};
    } catch (_) {
        payload = { raw: text };
    }

    if (!response.ok) {
        throw new Error(payload?.message || payload?.error || payload?.detail || `请求失败: ${response.status}`);
    }

    return payload;
}

async function shopSessionRequest(apiPath, options = {}) {
    const token = String(options.token || readAccountToken() || '').trim();
    if (!token) {
        throw new Error('未登录');
    }

    const builtinSession = getBuiltinSession();
    if (typeof builtinSession.fetch !== 'function') {
        return shopRequest(apiPath, { ...options, token });
    }

    const response = await builtinSession.fetch(`${SHOP_BASE_URL}${apiPath}`, {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json, text/plain, */*',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            Authorization: `Bearer ${token}`,
            ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        credentials: 'include'
    });

    const text = await response.text();
    let payload = {};
    try {
        payload = text ? JSON.parse(text) : {};
    } catch (_) {
        payload = { raw: text };
    }

    if (!response.ok) {
        throw new Error(payload?.message || payload?.error || payload?.detail || `请求失败: ${response.status}`);
    }

    return payload;
}

function isPythonMember(accessPayload) {
    const payload = accessPayload?.data || accessPayload || {};
    if (payload.canDownloadUpdates === true) {
        return true;
    }
    if (payload.entitlements?.canDownloadUpdates === true) {
        return true;
    }

    const memberships = payload.entitlements?.activeMemberships || payload.activeMemberships || [];
    return memberships.some((item) => {
        const key = item?.planKey || item?.typeCategory || item?.category || item;
        return key === 'python' || key === 'all';
    });
}

async function loadAccountSnapshotFromSession() {
    try {
        const token = readAccountToken();
        if (!token) {
            return { authenticated: false, canDownloadUpdates: false, user: null };
        }

        const [me, access] = await Promise.all([
            shopSessionRequest('/api/users/electron/me?typeCategory=python', { token }),
            shopSessionRequest('/api/users/electron/access?typeCategory=python', { token })
        ]);

        return {
            authenticated: true,
            user: toSerializable(me?.user || me?.data?.user || me?.data || me),
            canDownloadUpdates: isPythonMember(access)
        };
    } catch (error) {
        return { authenticated: false, canDownloadUpdates: false, user: null, error: error.message || String(error) };
    }
}

async function fetchPythonAccess() {
    const sessionAccess = await loadAccountSnapshotFromSession();
    if (sessionAccess.authenticated) {
        return {
            authenticated: true,
            canDownloadUpdates: Boolean(sessionAccess.canDownloadUpdates),
            user: sessionAccess.user || null
        };
    }

    const token = readAccountToken();
    if (!token) {
        return { authenticated: false, canDownloadUpdates: false, user: null };
    }

    try {
        const [me, access] = await Promise.all([
            shopRequest('/api/users/electron/me?typeCategory=python', { token }),
            shopRequest('/api/users/electron/access?typeCategory=python', { token })
        ]);

        return {
            authenticated: true,
            canDownloadUpdates: isPythonMember(access),
            user: toSerializable(me?.user || me?.data?.user || me?.data || me)
        };
    } catch (error) {
        return { authenticated: false, canDownloadUpdates: false, user: null, error: error.message || String(error) };
    }
}

async function loadAccountSnapshot() {
    const snapshot = await fetchPythonAccess();
    cachedAccount = snapshot;
    return snapshot;
}

async function readTokenFromWebContents(webContents) {
    if (!webContents || webContents.isDestroyed()) {
        return '';
    }

    try {
        if (!isShopUrl(webContents.getURL())) {
            return '';
        }

        const token = await webContents.executeJavaScript(`(() => {
            try {
                return String(window.localStorage.getItem('token') || '');
            } catch (_) {
                return '';
            }
        })()`, true);
        return String(token || '').trim();
    } catch (_) {
        return '';
    }
}

async function syncAccountFromWebContents(webContents) {
    const token = await readTokenFromWebContents(webContents);
    if (token) {
        saveAccountToken(token);
    } else if (isShopUrl(webContents?.getURL?.())) {
        clearAccountToken();
    }

    cachedAccount = await loadAccountSnapshot();
    sendRendererEvent('account:changed', cachedAccount || { authenticated: false, canDownloadUpdates: false, user: null });
    return cachedAccount;
}

async function clearShopSession() {
    const builtinSession = getBuiltinSession();
    try {
        await builtinSession.clearStorageData({ storages: ['cookies', 'localstorage'] });
    } catch (_) {
        // Ignore cleanup errors.
    }

    try {
        const cookies = await builtinSession.cookies.get({});
        for (const cookie of cookies) {
            const hostname = String(cookie.domain || '').replace(/^\./, '');
            const protocol = cookie.secure ? 'https://' : 'http://';
            const cookieUrl = `${protocol}${hostname}${cookie.path || '/'}`;
            await builtinSession.cookies.remove(cookieUrl, cookie.name);
        }
    } catch (_) {
        // Ignore cleanup errors.
    }
}

async function checkForAppUpdates() {
    if (!autoUpdater) {
        throw new Error('自动更新模块不可用，请确认 electron-updater 已安装');
    }

    if (!app.isPackaged) {
        updateAvailable = false;
        lastCheckedUpdateInfo = null;
        lastUpdateSource = 'github';
        const message = '当前为开发环境，已跳过自动更新检查，请在打包版本中验证更新。';
        sendUpdateEvent('not-available', { message });
        return {
            success: true,
            skipped: true,
            source: lastUpdateSource,
            available: false,
            updateInfo: null,
            message
        };
    }

    sendUpdateEvent('checking');

    const token = readAccountToken();
    const access = await fetchPythonAccess();
    const shouldTryObjectStorage = access.authenticated && access.canDownloadUpdates;
    let objectStorageError = null;

    if (shouldTryObjectStorage) {
        try {
            const objectResult = await tryCheckForUpdates('object-storage', token, true);
            if (objectResult.available) {
                return {
                    ...objectResult,
                    canDownloadUpdates: true,
                    fallbackReason: null
                };
            }
        } catch (error) {
            objectStorageError = error;
        }
    }

    const githubResult = await tryCheckForUpdates('github', '', false);
    return {
        ...githubResult,
        canDownloadUpdates: Boolean(access.canDownloadUpdates),
        fallbackReason: objectStorageError ? objectStorageError.message || String(objectStorageError) : null
    };
}

function bindAutoUpdaterEvents() {
    if (!autoUpdater || bindAutoUpdaterEvents.bound) {
        return;
    }

    bindAutoUpdaterEvents.bound = true;
    autoUpdater.on('checking-for-update', () => sendUpdateEvent('checking'));
    autoUpdater.on('update-available', (info) => {
        updateAvailable = true;
        sendUpdateEvent('available', { info: toSerializable(info) });
    });
    autoUpdater.on('update-not-available', (info) => {
        updateAvailable = false;
        sendUpdateEvent('not-available', { info: toSerializable(info) });
    });
    autoUpdater.on('download-progress', (progress) => sendUpdateEvent('download-progress', { progress: toSerializable(progress) }));
    autoUpdater.on('update-downloaded', (info) => sendUpdateEvent('downloaded', { info: toSerializable(info) }));
    autoUpdater.on('error', (error) => {
        if (!suppressUpdaterErrors) {
            sendUpdateEvent('error', { message: error.message || String(error) });
        }
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1080,
        height: 780,
        minWidth: 980,
        minHeight: 680,
        title: '三人聚智-Python程序管理工具',
        icon: getIconPath(),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    });

    remoteMain.enable(mainWindow.webContents);
    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    Menu.setApplicationMenu(null);

    mainWindow.on('close', async (event) => {
        if (!isQuitting) {
            event.preventDefault();
            isQuitting = true;
            await cleanupRunningProcesses();
            if (shopWindow && !shopWindow.isDestroyed()) {
                shopWindow.destroy();
            }
            if (logWindow && !logWindow.isDestroyed()) {
                logWindow.destroy();
            }
            setImmediate(() => app.quit());
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function createLogWindow() {
    logWindow = new BrowserWindow({
        width: 900,
        height: 520,
        minWidth: 760,
        minHeight: 420,
        title: '运行日志',
        parent: mainWindow || undefined,
        show: false,
        icon: getIconPath(),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    logWindow.loadFile(path.join(__dirname, 'log.html'));
    logWindow.on('closed', () => {
        logWindow = null;
    });
}

function showLogWindow() {
    if (!logWindow || logWindow.isDestroyed()) {
        createLogWindow();
    }

    logWindow.show();
    logWindow.focus();
}

function findSoftwareRoots(rootDir) {
    const matches = [];
    const queue = [rootDir];

    while (queue.length > 0) {
        const current = queue.shift();
        if (!current || !fs.existsSync(current)) {
            continue;
        }

        const settingsJsonPath = path.join(current, 'settings.json');
        if (fs.existsSync(settingsJsonPath)) {
            matches.push(current);
            continue;
        }

        const entries = fs.readdirSync(current, { withFileTypes: true });
        const hasProgramFiles = entries.some((entry) => entry.isFile() && (entry.name.endsWith('.py') || entry.name.endsWith('.enc')));
        if (hasProgramFiles) {
            matches.push(current);
            continue;
        }

        for (const entry of entries) {
            if (entry.isDirectory() && entry.name !== '__MACOSX' && entry.name !== '.git') {
                queue.push(path.join(current, entry.name));
            }
        }
    }

    return matches;
}

function getDetailFile(folderPath) {
    const candidates = ['README.md', 'FEATURES.md', '安装说明.md', '使用说明.md', '说明.md', '需求.md'];
    for (const candidate of candidates) {
        const filePath = path.join(folderPath, candidate);
        if (fs.existsSync(filePath)) {
            return filePath;
        }
    }
    return null;
}

function extractArchive(archivePath, destinationDir) {
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(destinationDir, true);
}

async function installDownloadedSoftware(downloadPath) {
    const softwareDir = getSoftwareDir();
    const extractDir = uniquePath(path.join(os.tmpdir(), `${path.parse(downloadPath).name}-unzipped`));

    try {
        ensureDir(extractDir);
        extractArchive(downloadPath, extractDir);
        const roots = findSoftwareRoots(extractDir);
        if (roots.length === 0) {
            throw new Error('下载内容中未找到可识别的插件目录');
        }

        const installed = [];
        for (const root of roots) {
            const folderName = sanitizeFileName(path.basename(root));
            const targetDir = path.join(softwareDir, folderName);
            removePath(targetDir);
            copyDirectoryContents(root, targetDir);
            installed.push({ name: folderName, path: targetDir });
        }

        return installed;
    } finally {
        removePath(extractDir);
        removePath(downloadPath);
    }
}

function bindBuiltinSessionEvents() {
    if (builtinSessionEventsBound) {
        return;
    }

    builtinSessionEventsBound = true;
    const builtinSession = getBuiltinSession();
    builtinSession.on('will-download', (event, item, webContents) => {
        const sourceUrl = item.getURL() || webContents?.getURL?.() || '';
        const fileName = sanitizeFileName(item.getFilename());
        if (!isPluginDownloadUrl(sourceUrl) && path.extname(fileName).toLowerCase() !== '.zip') {
            return;
        }

        const saveDir = ensureDir(path.join(getSoftwareDir(), '.downloads'));
        const savePath = uniquePath(path.join(saveDir, fileName));
        item.setSavePath(savePath);
        sendRendererEvent('plugins:download', { type: 'started', fileName: path.basename(savePath) });

        item.on('done', async (_event, state) => {
            if (state !== 'completed') {
                sendRendererEvent('plugins:download', {
                    type: 'error',
                    fileName: path.basename(savePath),
                    message: `下载未完成：${state}`
                });
                removePath(savePath);
                return;
            }

            try {
                const installed = await installDownloadedSoftware(savePath);
                sendRendererEvent('plugins:download', { type: 'completed', fileName: path.basename(savePath), installed });
                sendRendererEvent('plugins:changed', { installed });
            } catch (error) {
                sendRendererEvent('plugins:download', {
                    type: 'error',
                    fileName: path.basename(savePath),
                    message: error.message || String(error)
                });
            }
        });
    });
}

function openBuiltinBrowserWindow(url) {
    bindBuiltinSessionEvents();

    if (shopWindow && !shopWindow.isDestroyed()) {
        shopWindow.loadURL(url);
        shopWindow.show();
        shopWindow.focus();
        return shopWindow;
    }

    shopWindow = new BrowserWindow({
        width: 1180,
        height: 820,
        minWidth: 800,
        minHeight: 560,
        title: '程序小店',
        icon: getIconPath(),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            session: getBuiltinSession()
        }
    });

    const syncAccountState = () => {
        syncAccountFromWebContents(shopWindow.webContents).catch(() => {});
    };

    shopWindow.webContents.on('did-finish-load', syncAccountState);
    shopWindow.webContents.on('did-navigate', syncAccountState);
    shopWindow.webContents.on('did-navigate-in-page', syncAccountState);
    shopWindow.webContents.on('will-navigate', (event, targetUrl) => {
        if (isPluginDownloadUrl(targetUrl)) {
            event.preventDefault();
            shopWindow.webContents.downloadURL(targetUrl);
        }
    });
    shopWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
        if (isPluginDownloadUrl(targetUrl)) {
            shopWindow.webContents.downloadURL(targetUrl);
            return { action: 'deny' };
        }

        openBuiltinBrowserWindow(targetUrl);
        return { action: 'deny' };
    });
    shopWindow.webContents.on('page-title-updated', (_event, title) => {
        shopWindow.setTitle(title || '程序小店');
    });

    shopWindow.on('closed', () => {
        shopWindow = null;
    });

    shopWindow.loadURL(url);
    return shopWindow;
}

async function checkPythonEnv() {
    console.log('检查 Python 环境...');

    if (!ensurePathExists(pythonPath)) {
        throw new Error(`Python 解释器未找到: ${pythonPath}`);
    }

    const criticalPaths = [pythonLibPath, pythonScriptsPath, pythonDLLsPath];
    for (const criticalPath of criticalPaths) {
        ensurePathExists(criticalPath);
    }
}

async function checkPackageInstalled(packageName) {
    return new Promise((resolve) => {
        const checker = spawn(pythonPath, ['-c', `import ${packageName.replace(/-/g, '_')}`], {
            windowsHide: true,
            env: {
                ...process.env,
                PYTHONPATH: pythonLibPath,
                PYTHONIOENCODING: 'utf-8'
            }
        });

        checker.on('close', (code) => resolve(code === 0));
        checker.on('error', () => resolve(false));
    });
}

async function checkAllRequirements(requirementsPath) {
    try {
        const packages = fs.readFileSync(requirementsPath, 'utf8')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#'))
            .map((line) => line.split(/[><=~]/)[0].trim());

        const checks = await Promise.all(packages.map(async (pkg) => ({
            package: pkg,
            installed: await checkPackageInstalled(pkg)
        })));

        return checks.every((entry) => entry.installed);
    } catch (error) {
        console.error('检查依赖失败:', error);
        return false;
    }
}

async function installRequirements(requirementsPath) {
    const allInstalled = await checkAllRequirements(requirementsPath);
    if (allInstalled) {
        return;
    }

    return new Promise((resolve, reject) => {
        if (logWindow && !logWindow.isDestroyed()) {
            logWindow.webContents.send('log-output', '正在安装缺失的依赖...');
        }

        const pip = spawn(pythonPath, [
            '-m', 'pip', 'install',
            '--index-url', 'https://pypi.org/simple/',
            '--extra-index-url', 'https://pypi.tuna.tsinghua.edu.cn/simple/',
            '--extra-index-url', 'https://mirrors.aliyun.com/pypi/simple/',
            '-r', requirementsPath,
            '--trusted-host', 'pypi.org',
            '--trusted-host', 'pypi.tuna.tsinghua.edu.cn',
            '--trusted-host', 'mirrors.aliyun.com'
        ], {
            windowsHide: true,
            env: {
                ...process.env,
                PYTHONPATH: pythonLibPath,
                PYTHONIOENCODING: 'utf-8'
            }
        });

        pip.stdout.on('data', (data) => {
            if (logWindow && !logWindow.isDestroyed()) {
                logWindow.webContents.send('log-output', `[pip] ${data.toString()}`);
            }
        });

        pip.stderr.on('data', (data) => {
            if (logWindow && !logWindow.isDestroyed()) {
                logWindow.webContents.send('log-error', `[pip] ${data.toString()}`);
            }
        });

        pip.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`依赖安装失败，退出码: ${code}`));
        });
        pip.on('error', (error) => reject(error));
    });
}

function registerRunningProcess(childProcess, record) {
    runningProcesses.set(childProcess.pid, { childProcess, ...record });
}

function unregisterRunningProcess(pid) {
    runningProcesses.delete(pid);
}

function cleanupTempFile(filePath) {
    if (!filePath) {
        return;
    }

    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (error) {
        console.warn('删除临时文件失败:', filePath, error.message || error);
    }
}

function killProcessTree(pid) {
    return new Promise((resolve) => {
        if (!pid) {
            resolve();
            return;
        }

        if (process.platform === 'win32') {
            const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
            killer.on('close', () => resolve());
            killer.on('error', () => resolve());
            return;
        }

        try {
            process.kill(-pid, 'SIGTERM');
        } catch (_) {
            try {
                process.kill(pid, 'SIGTERM');
            } catch (_) {
                // Ignore.
            }
        }
        resolve();
    });
}

async function cleanupRunningProcesses() {
    const tasks = [];
    for (const [pid, record] of runningProcesses.entries()) {
        cleanupTempFile(record.tempFilePath);
        tasks.push(killProcessTree(pid));
    }
    runningProcesses.clear();
    await Promise.all(tasks);
}

function getProgramInfo(folderPath) {
    const settingsJsonPath = path.join(folderPath, 'settings.json');
    const detailFilePath = getDetailFile(folderPath);

    if (fs.existsSync(settingsJsonPath)) {
        try {
            const settings = JSON.parse(fs.readFileSync(settingsJsonPath, 'utf8'));
            const mainFilePath = path.join(folderPath, settings.main_file);
            const requirementsPath = path.join(folderPath, 'requirements.txt');
            if (fs.existsSync(mainFilePath)) {
                return [{
                    name: settings.name || path.basename(folderPath),
                    description: settings.description || '双击运行此程序',
                    path: mainFilePath,
                    folderPath,
                    detailFilePath,
                    detailFileName: detailFilePath ? path.basename(detailFilePath) : '',
                    version: settings.version || '',
                    author: settings.author || '',
                    category: settings.category || '',
                    requirementsPath: fs.existsSync(requirementsPath) ? requirementsPath : null
                }];
            }
        } catch (error) {
            console.error(`读取 settings.json 失败 ${folderPath}:`, error);
        }
    }

    const requirementsPath = path.join(folderPath, 'requirements.txt');
    return fs.readdirSync(folderPath)
        .filter((file) => file.endsWith('.py') || file.endsWith('.enc'))
        .map((file) => {
            const isEncrypted = file.endsWith('.enc');
            return {
                name: path.basename(file, isEncrypted ? '.enc' : '.py'),
                description: isEncrypted ? '加密程序，双击运行' : '双击运行此程序',
                path: path.join(folderPath, file),
                folderPath,
                detailFilePath,
                detailFileName: detailFilePath ? path.basename(detailFilePath) : '',
                version: '',
                author: '',
                category: '',
                requirementsPath: fs.existsSync(requirementsPath) ? requirementsPath : null
            };
        });
}

async function getSoftwareList() {
    const softwareDir = getSoftwareDir();
    const items = fs.readdirSync(softwareDir, { withFileTypes: true });
    let programs = [];

    for (const item of items) {
        if (item.name.startsWith('.')) {
            continue;
        }

        const itemPath = path.join(softwareDir, item.name);
        if (item.isDirectory()) {
            programs = programs.concat(getProgramInfo(itemPath));
        } else if (item.isFile() && (item.name.endsWith('.py') || item.name.endsWith('.enc'))) {
            const isEncrypted = item.name.endsWith('.enc');
            programs.push({
                name: path.basename(item.name, isEncrypted ? '.enc' : '.py'),
                description: isEncrypted ? '加密程序，双击运行' : '双击运行此程序',
                path: itemPath,
                folderPath: softwareDir,
                detailFilePath: null,
                detailFileName: '',
                version: '',
                author: '',
                category: '',
                requirementsPath: null
            });
        }
    }

    return programs.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

async function getSoftwareDetails(folderPath) {
    if (!folderPath || !fs.existsSync(folderPath)) {
        throw new Error('未找到插件目录');
    }

    const settingsJsonPath = path.join(folderPath, 'settings.json');
    let settings = {};
    if (fs.existsSync(settingsJsonPath)) {
        settings = JSON.parse(fs.readFileSync(settingsJsonPath, 'utf8'));
    }

    const detailFilePath = getDetailFile(folderPath);
    return {
        name: settings.name || path.basename(folderPath),
        description: settings.description || '暂无简介',
        version: settings.version || '',
        author: settings.author || '',
        category: settings.category || '',
        detailFileName: detailFilePath ? path.basename(detailFilePath) : '',
        markdown: detailFilePath ? fs.readFileSync(detailFilePath, 'utf8') : '',
        folderPath
    };
}

async function runPythonScript(scriptPath, requirementsPath) {
    if (!logWindow || logWindow.isDestroyed()) {
        createLogWindow();
    }

    if (requirementsPath) {
        await installRequirements(requirementsPath);
    }

    const isEncrypted = scriptPath.endsWith('.enc');
    let finalScriptPath = scriptPath;
    let tempFilePath = null;

    if (isEncrypted) {
        const encryptedData = fs.readFileSync(scriptPath);
        const iv = encryptedData.slice(0, 16);
        const encryptedContent = encryptedData.slice(16);
        const key = Buffer.from(process.env.YUHANBOPY_ENC_KEY || '12345678901234567890123456789012');
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        decipher.setAutoPadding(true);
        let decrypted = decipher.update(encryptedContent);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        const tempDir = ensureDir(path.join(os.tmpdir(), 'yuhanbopy-temp'));
        tempFilePath = path.join(tempDir, `${crypto.randomBytes(12).toString('hex')}_${path.basename(scriptPath, '.enc')}.py`);
        fs.writeFileSync(tempFilePath, decrypted, 'utf8');
        finalScriptPath = tempFilePath;
    }

    return new Promise((resolve, reject) => {
        const childProcess = spawn(pythonPath, [finalScriptPath], {
            windowsHide: false,
            env: {
                ...process.env,
                PYTHONIOENCODING: 'utf-8'
            }
        });

        registerRunningProcess(childProcess, {
            scriptPath,
            finalScriptPath,
            tempFilePath
        });

        childProcess.stdout.on('data', (data) => {
            if (logWindow && !logWindow.isDestroyed()) {
                logWindow.webContents.send('log-output', data.toString());
            }
        });

        childProcess.stderr.on('data', (data) => {
            if (logWindow && !logWindow.isDestroyed()) {
                logWindow.webContents.send('log-error', data.toString());
            }
        });

        childProcess.on('close', (code) => {
            unregisterRunningProcess(childProcess.pid);
            cleanupTempFile(tempFilePath);
            if (code === 0) {
                resolve({ success: true });
                return;
            }
            reject(new Error(`Python script exited with code ${code}`));
        });

        childProcess.on('error', (error) => {
            unregisterRunningProcess(childProcess.pid);
            cleanupTempFile(tempFilePath);
            reject(new Error(`Failed to start Python process: ${error.message}`));
        });
    });
}

ipcMain.handle('show-log-window', () => {
    showLogWindow();
    return { success: true };
});

ipcMain.handle('get-software-list', async () => getSoftwareList());
ipcMain.handle('get-software-details', async (_event, folderPath) => getSoftwareDetails(folderPath));
ipcMain.handle('run-python-script', async (_event, scriptPath, requirementsPath) => runPythonScript(scriptPath, requirementsPath));
ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (_event, settings) => saveSettings(settings));
ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('get-software-directory', () => getSoftwareDir());

ipcMain.handle('open-software-directory', async () => {
    const softwareDir = getSoftwareDir();
    const error = await shell.openPath(softwareDir);
    if (error) {
        throw new Error(error);
    }
    return { success: true, path: softwareDir };
});

ipcMain.handle('account:login', async () => {
    openBuiltinBrowserWindow(SHOP_MEMBER_CENTER_URL);
    return { success: true, url: SHOP_MEMBER_CENTER_URL };
});

ipcMain.handle('account:logout', async () => {
    await clearShopSession();
    clearAccountToken();
    cachedAccount = { authenticated: false, canDownloadUpdates: false, user: null };
    sendRendererEvent('account:changed', cachedAccount);
    return cachedAccount;
});

ipcMain.handle('account:me', async () => loadAccountSnapshot());
ipcMain.handle('account:access', async () => fetchPythonAccess());
ipcMain.handle('shop:open-store', async () => {
    openBuiltinBrowserWindow(SHOP_STORE_URL);
    return { success: true, url: SHOP_STORE_URL };
});
ipcMain.handle('shop:open-member-center', async () => {
    openBuiltinBrowserWindow(SHOP_MEMBER_CENTER_URL);
    return { success: true, url: SHOP_MEMBER_CENTER_URL };
});

ipcMain.handle('update:check', async () => checkForAppUpdates());
ipcMain.handle('update:download', async () => {
    if (!autoUpdater) {
        throw new Error('自动更新模块不可用');
    }
    if (!app.isPackaged) {
        throw new Error('开发环境不支持下载自动更新，请在打包版本中测试');
    }
    if (!updateAvailable && compareVersions(lastCheckedUpdateInfo?.version, app.getVersion()) <= 0) {
        throw new Error('当前没有可下载的新版本，请先检查更新');
    }
    await autoUpdater.downloadUpdate();
    return { success: true, source: lastUpdateSource };
});
ipcMain.handle('update:install', async () => {
    if (!autoUpdater) {
        throw new Error('自动更新模块不可用');
    }
    if (!app.isPackaged) {
        throw new Error('开发环境不支持安装自动更新，请在打包版本中测试');
    }
    autoUpdater.quitAndInstall(false, true);
    return { success: true };
});

ipcMain.handle('show-message-box', async (_event, options) => dialog.showMessageBox(mainWindow || undefined, options));
ipcMain.handle('show-open-dialog', async (_event, options) => dialog.showOpenDialog(mainWindow || undefined, options));

app.on('second-instance', () => {
    if (!mainWindow) {
        createWindow();
        return;
    }

    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
});

app.on('before-quit', async () => {
    isQuitting = true;
    try {
        if (shopWindow && !shopWindow.isDestroyed()) {
            shopWindow.destroy();
        }
        if (logWindow && !logWindow.isDestroyed()) {
            logWindow.destroy();
        }
    } catch (_) {
        // Ignore window cleanup errors.
    }
    await cleanupRunningProcesses();
});

app.whenReady().then(async () => {
    try {
        bindAutoUpdaterEvents();
        await checkPythonEnv();
        createWindow();
        cachedAccount = await loadAccountSnapshot();

        const settings = loadSettings();
        app.setLoginItemSettings({ openAtLogin: Boolean(settings.autoStart), path: process.execPath });
        if (settings.autoCheckUpdates && canCheckForUpdates()) {
            setTimeout(() => {
                checkForAppUpdates().catch(() => {});
            }, 2000);
        }
    } catch (error) {
        console.error('应用初始化失败:', error);
        dialog.showErrorBox('启动失败', `应用启动失败：\n${error.message}\n\n请检查 Python 环境是否正确安装。`);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (!mainWindow) {
        createWindow();
    }
});
