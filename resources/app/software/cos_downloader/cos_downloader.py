# -*- coding: utf-8 -*-
import os
import sys
import tkinter as tk
from tkinter import ttk
from tkinter import messagebox
import threading
import urllib.request
import zipfile

class CosDownloader:
    def __init__(self, root):
        self.root = root
        self.root.title("腾讯云对象存储下载器")
        self.root.geometry("500x200")
        
        # 获取软件目录路径
        self.software_dir = self.get_software_dir()
        
        # 窗口居中
        self.center_window()
        
        # 创建主框架
        self.main_frame = ttk.Frame(root)
        self.main_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=20)
        
        # 创建URL输入框
        url_frame = ttk.Frame(self.main_frame)
        url_frame.pack(fill=tk.X, pady=(0, 15))
        
        url_label = ttk.Label(url_frame, text="下载地址:", font=("微软雅黑", 12))
        url_label.pack(side=tk.LEFT, padx=(0, 10))
        
        self.url_entry = ttk.Entry(url_frame, font=("微软雅黑", 11))
        self.url_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        
        # 创建下载按钮
        self.download_btn = ttk.Button(
            url_frame, 
            text="下载",
            command=self.start_download,
            width=10
        )
        self.download_btn.pack(side=tk.LEFT, padx=(10, 0))
        
        # 创建状态标签
        self.status_label = ttk.Label(
            self.main_frame, 
            text="请输入腾讯云对象存储文件地址",
            wraplength=460,
            font=("微软雅黑", 11)
        )
        self.status_label.pack(fill=tk.X, pady=(5, 10))
        
        # 创建进度条
        self.progress = ttk.Progressbar(
            self.main_frame,
            mode='determinate',
            length=460
        )
        self.progress.pack(fill=tk.X, pady=(5, 0))

    def get_software_dir(self):
        """获取软件目录路径"""
        try:
            # 获取当前脚本所在目录
            current_dir = os.path.dirname(os.path.abspath(__file__))
            
            # 如果是开发环境
            if os.path.basename(current_dir) == 'cos_downloader':
                # 返回上级目录
                return os.path.dirname(current_dir)
            
            # 如果是打包环境，尝试不同的路径
            possible_paths = [
                # 相对于当前目录
                os.path.join(current_dir, '..', 'software'),
                # 相对于resources目录
                os.path.join(current_dir, '..', '..', 'app', 'software'),
                # 相对于应用程序根目录
                os.path.join(current_dir, 'app', 'software'),
            ]
            
            # 尝试每个可能的路径
            for path in possible_paths:
                abs_path = os.path.abspath(path)
                if os.path.exists(abs_path) and os.path.isdir(abs_path):
                    return abs_path
            
            # 如果都不存在，创建一个新目录
            default_path = os.path.join(current_dir, 'software')
            os.makedirs(default_path, exist_ok=True)
            return default_path
            
        except Exception as e:
            print(f"获取软件目录失败: {e}")
            # 如果出错，使用当前目录
            return os.path.dirname(os.path.abspath(__file__))

    def center_window(self):
        """将窗口居中显示"""
        self.root.update_idletasks()
        width = 500
        height = 200
        x = (self.root.winfo_screenwidth() // 2) - (width // 2)
        y = (self.root.winfo_screenheight() // 2) - (height // 2)
        self.root.geometry(f"{width}x{height}+{x}+{y}")

    def update_progress(self, block_num, block_size, total_size):
        """更新下载进度"""
        if total_size > 0:
            percentage = (block_num * block_size / total_size) * 100
            self.progress['value'] = min(percentage, 100)
            self.root.update_idletasks()

    def decode_filename(self, filename):
        """尝试解码文件名中的URL编码"""
        try:
            from urllib.parse import unquote
            return unquote(filename)
        except:
            return filename

    def download_file(self, url):
        try:
            # 从URL中提取文件名并解码
            file_name = self.decode_filename(url.split('/')[-1])
            if not file_name:
                raise ValueError("无法从URL中获取文件名")
            
            # 设置下载路径
            download_path = os.path.join(self.software_dir, file_name)
            
            # 确保目录存在
            os.makedirs(os.path.dirname(download_path), exist_ok=True)
            
            # 更新状态
            self.status_label.config(text=f"正在下载: {file_name}")
            self.progress['value'] = 0
            
            # 下载文件
            urllib.request.urlretrieve(
                url, 
                download_path,
                self.update_progress
            )
            
            # 如果是zip文件，自动解压
            if file_name.lower().endswith('.zip'):
                self.status_label.config(text="正在解压文件...")
                with zipfile.ZipFile(download_path, 'r') as zip_ref:
                    zip_ref.extractall(
                        self.software_dir,
                        # 修复zip文件中的中文编码
                        pwd=None if not any(name.encode('cp437').decode('gbk', 'ignore').encode('gbk') != name.encode('cp437') for name in zip_ref.namelist()) else None
                    )
                self.status_label.config(text="文件解压完成！")
            else:
                self.status_label.config(text="下载完成！")
            
        except Exception as e:
            self.status_label.config(text=f"下载失败: {str(e)}")
        finally:
            self.download_btn.config(state='normal')
            self.url_entry.config(state='normal')

    def start_download(self):
        url = self.url_entry.get().strip()
        if not url:
            messagebox.showwarning("警告", "请输入下载地址")
            return
        
        # 禁用输入和按钮
        self.download_btn.config(state='disabled')
        self.url_entry.config(state='disabled')
        
        # 启动下载线程
        thread = threading.Thread(target=self.download_file, args=(url,))
        thread.daemon = True
        thread.start()

def main():
    root = tk.Tk()
    app = CosDownloader(root)
    root.mainloop()

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        messagebox.showerror("错误", f"程序出错: {str(e)}") 