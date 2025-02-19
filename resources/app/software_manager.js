const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const os = require('os');

class SoftwareManager {
    constructor(mainWindow) {
        this.pythonPath = path.join(__dirname, '..', 'python', 'python-3.12.8-embed-amd64', 'python.exe');
        this.softwareDir = path.join(__dirname, 'software');
        this.processes = new Map();
        this.tempBaseDir = path.join(os.tmpdir(), 'yuhanbolh');
        this.mainWindow = mainWindow;

        // 启动时清理遗留的临时目录
        this.cleanupTempDir();

        // 注册进程退出时的清理
        process.on('exit', () => {
            this.cleanupTempDir();
        });

        // 注册意外退出的清理
        process.on('SIGINT', () => {
            this.cleanupTempDir();
            process.exit();
        });
        process.on('SIGTERM', () => {
            this.cleanupTempDir();
            process.exit();
        });
    }

    // 发送输出到主窗口
    sendOutput(output) {
        if (this.mainWindow) {
            this.mainWindow.webContents.send('terminal-output', output);
        }
    }

    // 发送错误到主窗口
    sendError(error) {
        if (this.mainWindow) {
            this.mainWindow.webContents.send('terminal-error', error);
        }
    }

    // 清空输出
    clearOutput() {
        if (this.mainWindow) {
            this.mainWindow.webContents.send('terminal-clear');
        }
    }

    cleanupTempDir() {
        try {
            if (fs.existsSync(this.tempBaseDir)) {
                fs.rmSync(this.tempBaseDir, { recursive: true, force: true });
                console.log('清理临时目录完成');
            }
        } catch (err) {
            console.error('清理临时目录失败:', err);
        }
    }

    decryptCode(encryptedData) {
        try {
            // 从加密数据中提取IV和加密内容
            const iv = encryptedData.slice(0, 16);  // 前16字节是IV
            const encryptedContent = encryptedData.slice(16);  // 跳过IV
            
            // 使用固定密钥
            const key = Buffer.from('12345678901234567890123456789012');

            // 创建解密器
            const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
            decipher.setAutoPadding(true);
            
            // 解密
            let decrypted = decipher.update(encryptedContent);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            
            // 转换为字符串并清理
            let content = decrypted.toString('utf8').trim();
            
            // 确保只有一个编码声明
            content = content.replace(/# -\*- coding:.*?-\*-\n/g, '');
            content = '# -*- coding: utf-8 -*-\n' + content;
            
            return content;
        } catch (error) {
            console.error('解密失败:', error);
            throw error;
        }
    }
    
    async runSoftware(softwareCode) {
        try {
            const encFilePath = path.join(this.softwareDir, softwareCode, `${softwareCode}.enc`);
            const softwareWorkDir = path.join(this.softwareDir, softwareCode);  // 软件工作目录，用于存储用户数据
            console.log('运行加密软件:', encFilePath);
            
            if (!fs.existsSync(encFilePath)) {
                throw new Error(`软件文件不存在: ${encFilePath}`);
            }

            // 确保软件工作目录存在
            if (!fs.existsSync(softwareWorkDir)) {
                fs.mkdirSync(softwareWorkDir, { recursive: true });
            }

            // 使用类的tempBaseDir存放临时文件
            if (!fs.existsSync(this.tempBaseDir)) {
                fs.mkdirSync(this.tempBaseDir);
            }
            const tempDir = path.join(this.tempBaseDir, `${softwareCode}_${Date.now()}`);
            
            // 显示终端窗口
            this.clearOutput();

            // 读取加密文件
            const encryptedData = fs.readFileSync(encFilePath);
            
            // 检查是否是ZIP文件
            const isZip = encryptedData.slice(0, 4).toString('hex') === '504b0304';
            
            let mainFile = null;

            if (isZip) {
                // 如果是ZIP文件，解压到临时目录
                console.log('处理ZIP文件...');
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }
                fs.mkdirSync(tempDir, { recursive: true });

                const zip = new AdmZip(encryptedData);
                
                // 解压文件时，将数据文件复制到软件工作目录
                zip.getEntries().forEach((entry) => {
                    const entryName = entry.entryName.toLowerCase();
                    // 如果是数据文件（如.json, .txt等），且在软件工作目录中不存在，则复制到软件工作目录
                    if ((entryName.endsWith('.json') || 
                         entryName.endsWith('.txt') || 
                         entryName.endsWith('.csv') || 
                         entryName.endsWith('.db')) && 
                        !fs.existsSync(path.join(softwareWorkDir, entry.entryName))) {
                        zip.extractEntryTo(entry, softwareWorkDir, false, true);
                    }
                });

                // 解压所有文件到临时目录（用于运行）
                zip.extractAllTo(tempDir, true);

                // 按优先级查找主文件
                mainFile = path.join(tempDir, '__main__.py');
                if (!fs.existsSync(mainFile)) {
                    mainFile = path.join(tempDir, `${softwareCode}.py`);
                    if (!fs.existsSync(mainFile)) {
                        const pyFiles = fs.readdirSync(tempDir)
                            .filter(file => file.toLowerCase().endsWith('.py'))
                            .sort();
                        
                        if (pyFiles.length > 0) {
                            mainFile = path.join(tempDir, pyFiles[0]);
                            console.log('使用第一个Python文件作为主程序:', pyFiles[0]);
                        } else {
                            throw new Error('找不到任何Python文件');
                        }
                    } else {
                        console.log('使用同名文件作为主程序:', path.basename(mainFile));
                    }
                } else {
                    console.log('使用__main__.py作为主程序');
                }
            } else {
                // 如果是加密文件，解密并创建临时文件
                console.log('处理加密文件...');
                const pythonCode = this.decryptCode(encryptedData);
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }
                mainFile = path.join(tempDir, '_temp.py');
                fs.writeFileSync(mainFile, pythonCode);
            }
            
            return new Promise((resolve, reject) => {
                // 运行Python程序
                console.log('启动Python进程:', this.pythonPath);
                console.log('运行主文件:', mainFile);
                const pythonProcess = spawn(this.pythonPath, [mainFile], {
                    cwd: softwareWorkDir,  // 使用软件工作目录作为工作目录
                    env: {
                        ...process.env,
                        PYTHONIOENCODING: 'utf-8',
                        PYTHONUNBUFFERED: '1',
                        PYTHONPATH: `${tempDir}${path.delimiter}${softwareWorkDir}`  // 同时添加临时目录和工作目录到Python路径
                    }
                });

                // 处理标准输出
                pythonProcess.stdout.on('data', (data) => {
                    const output = data.toString('utf8');
                    console.log('收到程序输出:', output);
                    this.sendOutput(output);
                });

                // 处理错误输出
                pythonProcess.stderr.on('data', (data) => {
                    const error = data.toString('utf8');
                    console.error('程序错误:', error);
                    this.sendError(error);
                });

                // 进程结束时
                pythonProcess.on('close', (code) => {
                    console.log(`Python进程退出，退出码: ${code}`);
                    
                    // 清理临时文件和目录
                    try {
                        if (tempDir && fs.existsSync(tempDir)) {
                            fs.rmSync(tempDir, { recursive: true, force: true });
                        } else if (mainFile && fs.existsSync(mainFile)) {
                            fs.unlinkSync(mainFile);
                        }
                    } catch (err) {
                        console.error('清理临时文件失败:', err);
                    }
                    
                    if (code === 0) {
                        this.sendOutput(`\n程序执行完成，退出码: ${code}`);
                        resolve();
                    } else {
                        const errorMessage = `程序异常退出，退出码: ${code}`;
                        this.sendError(errorMessage);
                        reject(new Error(errorMessage));
                    }
                });

                // 进程错误处理
                pythonProcess.on('error', (error) => {
                    const errorMessage = `启动程序失败: ${error.message}`;
                    console.error(errorMessage);
                    this.sendError(errorMessage);
                    
                    // 清理临时文件和目录
                    try {
                        if (tempDir && fs.existsSync(tempDir)) {
                            fs.rmSync(tempDir, { recursive: true, force: true });
                        } else if (mainFile && fs.existsSync(mainFile)) {
                            fs.unlinkSync(mainFile);
                        }
                    } catch (err) {
                        console.error('清理临时文件失败:', err);
                    }
                    
                    reject(new Error(errorMessage));
                });

                // 存储进程引用
                this.processes.set(softwareCode, pythonProcess);
            });
        } catch (error) {
            console.error(`运行软件失败:`, error);
            this.sendError(`运行软件失败: ${error.message}`);
            throw error;
        }
    }

    stopSoftware(softwareCode) {
        const pythonProcess = this.processes.get(softwareCode);
        if (pythonProcess) {
            pythonProcess.kill();
            this.processes.delete(softwareCode);
            console.log(`[${softwareCode}] 已停止运行`);
            this.sendOutput(`\n程序已停止运行`);
        }
    }

    stopAllSoftware() {
        for (const [code, pythonProcess] of this.processes) {
            pythonProcess.kill();
            console.log(`[${code}] 已停止运行`);
        }
        this.processes.clear();
        this.sendOutput(`\n所有程序已停止运行`);
    }
}

module.exports = SoftwareManager; 