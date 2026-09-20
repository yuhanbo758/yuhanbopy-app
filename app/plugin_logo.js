const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const GENERATED_META_FILE = '.yuhanbopy-logo.json';
const LOGO_GENERATOR_VERSION = 3;

function createCrcTable() {
    return Array.from({ length: 256 }, (_, index) => {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
        }
        return value >>> 0;
    });
}

const CRC_TABLE = createCrcTable();

function crc32(buffer) {
    let crc = 0xFFFFFFFF;
    for (const byte of buffer) {
        crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
    const typeBuffer = Buffer.from(type, 'ascii');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
    return Buffer.concat([length, typeBuffer, data, checksum]);
}

function hslToRgb(hue, saturation, lightness) {
    const c = (1 - Math.abs((2 * lightness) - 1)) * saturation;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = lightness - (c / 2);
    let rgb = [0, 0, 0];
    if (hue < 60) rgb = [c, x, 0];
    else if (hue < 120) rgb = [x, c, 0];
    else if (hue < 180) rgb = [0, c, x];
    else if (hue < 240) rgb = [0, x, c];
    else if (hue < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return rgb.map((value) => Math.round((value + m) * 255));
}

function calculatePluginFingerprint(folderPath, settings = {}, mainFilePath = '') {
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify({
        generatorVersion: LOGO_GENERATOR_VERSION,
        name: settings.name || path.basename(folderPath),
        description: settings.description || '',
        category: settings.category || '',
        mainFile: path.basename(mainFilePath || settings.main_file || '')
    }));
    if (mainFilePath && fs.existsSync(mainFilePath)) {
        hash.update(fs.readFileSync(mainFilePath));
    }
    return hash.digest('hex');
}

function classifyPluginSemantic(folderPath, settings = {}, mainFilePath = '') {
    const text = [
        path.basename(folderPath), settings.name, settings.description,
        settings.category, path.basename(mainFilePath || settings.main_file || '')
    ].filter(Boolean).join(' ').toLowerCase();

    // 先匹配更具体的业务含义，避免“下载器”等通用词覆盖主体对象。
    if (/(github|gitlab|gitee|仓库|repository|repo|代码库)/i.test(text)) return 'repository-download';
    if (/(腾讯云|对象存储|\bcos\b|\bcloud\b|云盘|云存储)/i.test(text) && /(下载|download|同步|sync)/i.test(text)) return 'cloud-download';
    if (/(终端|terminal|shell|命令行|console|powershell|cmd)/i.test(text)) return 'terminal';
    if (/(chatgpt|openai|人工智能|\bai\b|聊天|chat|助手|assistant|大模型|llm)/i.test(text)) return 'ai-chat';
    if (/(股票|证券|交易|量化|qmt|行情|stock|trade|order|选股)/i.test(text)) return 'trading';
    if (/(图表|报表|数据|chart|analytics|dashboard|统计)/i.test(text)) return 'chart-data';
    if (/(浏览器|网页|网站|web|http|api|网关|gateway|服务)/i.test(text)) return 'web-api';
    if (/(图片|图像|照片|视频|媒体|image|photo|video|media)/i.test(text)) return 'image-media';
    if (/(下载|download|文件|file|附件)/i.test(text)) return 'file-download';
    return 'tool';
}

function hashBuffer(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function generatePluginLogoPng(fingerprint, semanticType = 'tool', size = 128) {
    const digest = Buffer.from(fingerprint, 'hex');
    const pixels = Buffer.alloc(size * size * 4);
    const hue = ((digest[0] << 8) | digest[1]) % 360;
    const colorStart = hslToRgb(hue, 0.72, 0.48);
    const colorEnd = hslToRgb((hue + 42 + (digest[2] % 55)) % 360, 0.78, 0.34);
    const radius = Math.round(size * 0.19);

    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const nearestX = Math.max(radius, Math.min(size - radius - 1, x));
            const nearestY = Math.max(radius, Math.min(size - radius - 1, y));
            const outsideCorner = ((x - nearestX) ** 2) + ((y - nearestY) ** 2) > radius ** 2;
            const offset = ((y * size) + x) * 4;
            if (outsideCorner) {
                pixels[offset + 3] = 0;
                continue;
            }

            const ratio = (x + y) / (2 * Math.max(1, size - 1));
            for (let channel = 0; channel < 3; channel += 1) {
                pixels[offset + channel] = Math.round(colorStart[channel] * (1 - ratio) + colorEnd[channel] * ratio);
            }
            pixels[offset + 3] = 255;
        }
    }

    const scale = size / 128;
    const white = [255, 255, 255, 245];
    const detail = [...hslToRgb((hue + 200) % 360, 0.55, 0.18), 255];
    const accent = [...hslToRgb((hue + 48) % 360, 0.82, 0.62), 255];
    const setPixel = (x, y, color) => {
        const px = Math.round(x * scale);
        const py = Math.round(y * scale);
        if (px < 0 || py < 0 || px >= size || py >= size) return;
        const offset = ((py * size) + px) * 4;
        pixels[offset] = color[0]; pixels[offset + 1] = color[1];
        pixels[offset + 2] = color[2]; pixels[offset + 3] = color[3] ?? 255;
    };
    const fillRect = (x, y, width, height, color) => {
        for (let py = y; py < y + height; py += 1) for (let px = x; px < x + width; px += 1) setPixel(px, py, color);
    };
    const fillCircle = (cx, cy, radiusValue, color) => {
        for (let y = cy - radiusValue; y <= cy + radiusValue; y += 1) {
            for (let x = cx - radiusValue; x <= cx + radiusValue; x += 1) {
                if (((x - cx) ** 2) + ((y - cy) ** 2) <= radiusValue ** 2) setPixel(x, y, color);
            }
        }
    };
    const line = (x1, y1, x2, y2, width, color) => {
        const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
        for (let step = 0; step <= steps; step += 1) {
            const ratio = steps === 0 ? 0 : step / steps;
            fillCircle(x1 + ((x2 - x1) * ratio), y1 + ((y2 - y1) * ratio), width / 2, color);
        }
    };
    const polygon = (points, color) => {
        const minY = Math.floor(Math.min(...points.map((point) => point[1])));
        const maxY = Math.ceil(Math.max(...points.map((point) => point[1])));
        for (let y = minY; y <= maxY; y += 1) {
            const intersections = [];
            for (let index = 0; index < points.length; index += 1) {
                const current = points[index];
                const next = points[(index + 1) % points.length];
                if ((current[1] <= y && next[1] > y) || (next[1] <= y && current[1] > y)) {
                    intersections.push(current[0] + ((y - current[1]) * (next[0] - current[0])) / (next[1] - current[1]));
                }
            }
            intersections.sort((a, b) => a - b);
            for (let index = 0; index < intersections.length; index += 2) {
                for (let x = Math.ceil(intersections[index]); x <= Math.floor(intersections[index + 1]); x += 1) setPixel(x, y, color);
            }
        }
    };
    const roundedRect = (x, y, width, height, cornerRadius, color) => {
        fillRect(x + cornerRadius, y, width - (cornerRadius * 2), height, color);
        fillRect(x, y + cornerRadius, width, height - (cornerRadius * 2), color);
        fillCircle(x + cornerRadius, y + cornerRadius, cornerRadius, color);
        fillCircle(x + width - cornerRadius - 1, y + cornerRadius, cornerRadius, color);
        fillCircle(x + cornerRadius, y + height - cornerRadius - 1, cornerRadius, color);
        fillCircle(x + width - cornerRadius - 1, y + height - cornerRadius - 1, cornerRadius, color);
    };
    const downloadArrow = (cx, top, color) => {
        line(cx, top, cx, top + 28, 8, color);
        polygon([[cx - 15, top + 23], [cx + 15, top + 23], [cx, top + 40]], color);
        roundedRect(cx - 20, top + 44, 40, 7, 3, color);
    };

    if (semanticType === 'cloud-download') {
        fillCircle(46, 55, 18, white); fillCircle(66, 44, 24, white); fillCircle(88, 57, 18, white);
        roundedRect(29, 55, 77, 30, 10, white); downloadArrow(66, 54, detail);
    } else if (semanticType === 'file-download') {
        polygon([[35, 24], [76, 24], [96, 44], [96, 105], [35, 105]], white);
        polygon([[76, 24], [76, 45], [96, 45]], accent);
        downloadArrow(66, 48, detail);
    } else if (semanticType === 'repository-download') {
        polygon([[24, 37], [54, 37], [63, 47], [105, 47], [105, 99], [24, 99]], white);
        fillCircle(45, 65, 6, detail); fillCircle(45, 84, 6, detail); fillCircle(72, 75, 6, detail);
        line(45, 65, 45, 84, 5, detail); line(45, 75, 72, 75, 5, detail);
        fillCircle(91, 91, 24, accent); downloadArrow(91, 70, detail);
    } else if (semanticType === 'terminal') {
        roundedRect(20, 27, 88, 74, 9, white); fillRect(20, 40, 88, 61, detail);
        fillCircle(31, 34, 3, accent); fillCircle(41, 34, 3, accent); fillCircle(51, 34, 3, accent);
        line(39, 60, 52, 70, 6, white); line(52, 70, 39, 80, 6, white); line(62, 82, 84, 82, 6, accent);
    } else if (semanticType === 'ai-chat') {
        roundedRect(22, 27, 84, 66, 20, white); polygon([[48, 88], [40, 108], [65, 92]], white);
        fillCircle(47, 60, 6, detail); fillCircle(65, 60, 6, accent); fillCircle(83, 60, 6, detail);
    } else if (semanticType === 'trading') {
        line(28, 91, 47, 68, 8, white); line(47, 68, 64, 79, 8, white); line(64, 79, 94, 42, 8, white);
        polygon([[84, 39], [106, 30], [101, 54]], accent); fillRect(25, 98, 80, 7, white);
    } else if (semanticType === 'chart-data') {
        roundedRect(24, 24, 80, 81, 8, white); fillRect(37, 68, 12, 24, detail);
        fillRect(58, 51, 12, 41, accent); fillRect(79, 38, 12, 54, detail);
    } else if (semanticType === 'web-api') {
        roundedRect(19, 25, 90, 78, 10, white); fillRect(19, 40, 90, 63, detail);
        fillCircle(30, 33, 3, accent); fillCircle(40, 33, 3, accent);
        line(47, 62, 36, 73, 6, white); line(36, 73, 47, 84, 6, white);
        line(81, 62, 92, 73, 6, white); line(92, 73, 81, 84, 6, white);
        line(68, 57, 59, 89, 5, accent);
    } else if (semanticType === 'image-media') {
        roundedRect(22, 25, 84, 78, 9, white); fillCircle(81, 47, 9, accent);
        polygon([[29, 94], [51, 67], [65, 80], [78, 65], [100, 94]], detail);
    } else {
        fillCircle(64, 64, 34, white); fillCircle(64, 64, 18, detail);
        for (let angle = 0; angle < 360; angle += 45) {
            const radians = angle * Math.PI / 180;
            line(64 + Math.cos(radians) * 30, 64 + Math.sin(radians) * 30,
                64 + Math.cos(radians) * 43, 64 + Math.sin(radians) * 43, 10, white);
        }
        fillCircle(64, 64, 7, accent);
    }

    const raw = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y += 1) {
        const rowOffset = y * (size * 4 + 1);
        raw[rowOffset] = 0;
        pixels.copy(raw, rowOffset + 1, y * size * 4, (y + 1) * size * 4);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
        PNG_SIGNATURE,
        pngChunk('IHDR', header),
        pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        pngChunk('IEND', Buffer.alloc(0))
    ]);
}

function generateWindowsIco(png, size = 128) {
    // Windows Vista 及以上允许 ICO 容器直接内嵌 PNG；Tk/任务栏可据此加载真实 .ico。
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    const entry = Buffer.alloc(16);
    const detectedSize = png.length >= 24 && png.subarray(0, 8).equals(PNG_SIGNATURE)
        ? png.readUInt32BE(16)
        : size;
    entry[0] = detectedSize >= 256 ? 0 : detectedSize;
    entry[1] = detectedSize >= 256 ? 0 : detectedSize;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(header.length + entry.length, 12);
    return Buffer.concat([header, entry, png]);
}

function isInsideFolder(folderPath, candidatePath) {
    const relative = path.relative(folderPath, candidatePath);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function findManualLogo(folderPath, settings = {}) {
    const candidates = [];
    if (settings.logo) {
        const configured = path.resolve(folderPath, String(settings.logo));
        if (isInsideFolder(folderPath, configured)) candidates.push(configured);
    }
    for (const name of ['logo.png', 'icon.png', 'logo.ico', 'icon.ico']) {
        candidates.push(path.join(folderPath, name));
    }
    return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function ensurePluginLogo({ folderPath, settings = {}, mainFilePath = '', cacheDir = '', cacheOnly = false }) {
    const fingerprint = calculatePluginFingerprint(folderPath, settings, mainFilePath);
    const semanticType = classifyPluginSemantic(folderPath, settings, mainFilePath);
    const png = generatePluginLogoPng(fingerprint, semanticType);
    const ico = generateWindowsIco(png);
    if (cacheOnly) {
        if (!cacheDir) throw new Error('cacheOnly 模式必须提供 cacheDir');
        fs.mkdirSync(cacheDir, { recursive: true });
        const cachePath = path.join(cacheDir, `${fingerprint}.png`);
        const taskbarIconPath = path.join(cacheDir, `${fingerprint}.ico`);
        if (!fs.existsSync(cachePath)) fs.writeFileSync(cachePath, png);
        if (!fs.existsSync(taskbarIconPath)) fs.writeFileSync(taskbarIconPath, ico);
        return { logoPath: cachePath, taskbarIconPath, fingerprint, semanticType, generated: true, cached: true };
    }

    const existingLogo = findManualLogo(folderPath, settings);
    const generatedTaskbarIcon = path.join(folderPath, 'logo.ico');
    const metaPath = path.join(folderPath, GENERATED_META_FILE);
    let generatedMeta = null;
    try {
        if (fs.existsSync(metaPath)) generatedMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (_) {
        generatedMeta = null;
    }

    // 没有生成标记的现有图片视为用户设计，始终优先保留。
    if (existingLogo && !generatedMeta) {
        const manualIco = [path.join(folderPath, 'logo.ico'), path.join(folderPath, 'icon.ico')]
            .find((candidate) => fs.existsSync(candidate));
        if (manualIco || path.extname(existingLogo).toLowerCase() === '.ico') {
            return { logoPath: existingLogo, taskbarIconPath: manualIco || existingLogo, fingerprint, semanticType, generated: false };
        }
        if (!cacheDir) {
            // 用户自带 PNG 时保留原图，只补充 Windows 任务栏需要的 ICO，避免回退为 Python 默认图标。
            fs.writeFileSync(generatedTaskbarIcon, generateWindowsIco(fs.readFileSync(existingLogo)));
            return { logoPath: existingLogo, taskbarIconPath: generatedTaskbarIcon, fingerprint, semanticType, generated: false };
        }
        fs.mkdirSync(cacheDir, { recursive: true });
        const manualHash = hashBuffer(fs.readFileSync(existingLogo));
        const taskbarIconPath = path.join(cacheDir, `${manualHash}.ico`);
        if (!fs.existsSync(taskbarIconPath)) fs.writeFileSync(taskbarIconPath, generateWindowsIco(fs.readFileSync(existingLogo)));
        return { logoPath: existingLogo, taskbarIconPath, fingerprint, semanticType, generated: false };
    }
    if (existingLogo && generatedMeta?.logoSha256) {
        const currentLogoHash = hashBuffer(fs.readFileSync(existingLogo));
        if (currentLogoHash !== generatedMeta.logoSha256) {
            if (!cacheDir) {
                return {
                    logoPath: existingLogo,
                    taskbarIconPath: fs.existsSync(generatedTaskbarIcon) ? generatedTaskbarIcon : existingLogo,
                    fingerprint,
                    semanticType,
                    generated: false
                };
            }
            fs.mkdirSync(cacheDir, { recursive: true });
            const taskbarIconPath = path.join(cacheDir, `${currentLogoHash}.ico`);
            if (!fs.existsSync(taskbarIconPath)) fs.writeFileSync(taskbarIconPath, generateWindowsIco(fs.readFileSync(existingLogo)));
            return { logoPath: existingLogo, taskbarIconPath, fingerprint, semanticType, generated: false };
        }
    }
    if (existingLogo && generatedMeta?.fingerprint === fingerprint && generatedMeta?.logoSha256 && fs.existsSync(generatedTaskbarIcon)) {
        return { logoPath: existingLogo, taskbarIconPath: generatedTaskbarIcon, fingerprint, semanticType, generated: true };
    }

    const configuredName = String(settings.logo || '').toLowerCase().endsWith('.png')
        ? String(settings.logo)
        : 'logo.png';
    const configuredTarget = path.resolve(folderPath, configuredName);
    const targetPath = isInsideFolder(folderPath, configuredTarget)
        ? configuredTarget
        : path.join(folderPath, 'logo.png');

    try {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, png);
        fs.writeFileSync(generatedTaskbarIcon, ico);
        fs.writeFileSync(metaPath, JSON.stringify({
            fingerprint,
            semanticType,
            generatorVersion: LOGO_GENERATOR_VERSION,
            logoSha256: hashBuffer(png),
            taskbarIconSha256: hashBuffer(ico),
            generatedAt: new Date().toISOString()
        }, null, 2), 'utf8');
        return { logoPath: targetPath, taskbarIconPath: generatedTaskbarIcon, fingerprint, semanticType, generated: true };
    } catch (error) {
        if (!cacheDir) throw error;
        fs.mkdirSync(cacheDir, { recursive: true });
        const cachePath = path.join(cacheDir, `${fingerprint}.png`);
        const taskbarIconPath = path.join(cacheDir, `${fingerprint}.ico`);
        if (!fs.existsSync(cachePath)) fs.writeFileSync(cachePath, png);
        if (!fs.existsSync(taskbarIconPath)) fs.writeFileSync(taskbarIconPath, ico);
        return { logoPath: cachePath, taskbarIconPath, fingerprint, semanticType, generated: true, cached: true };
    }
}

function createPluginAppId(folderPath) {
    const stableName = path.basename(folderPath).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
    const suffix = stableName || crypto.createHash('sha256').update(path.basename(folderPath)).digest('hex').slice(0, 20);
    return `com.sanrenjz.yuhanbopy.plugin.${suffix}`.slice(0, 120);
}

module.exports = {
    calculatePluginFingerprint,
    classifyPluginSemantic,
    createPluginAppId,
    ensurePluginLogo,
    generatePluginLogoPng,
    generateWindowsIco
};
