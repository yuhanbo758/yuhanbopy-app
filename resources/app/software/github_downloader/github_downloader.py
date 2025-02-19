import os
import sys
import tkinter as tk
from tkinter import ttk, filedialog
from tkinter import messagebox
import threading
import urllib.request
import zipfile
import re

class GithubDownloader:
    def __init__(self, root):
        self.root = root
        self.root.title("GitHub仓库下载器")
        self.root.geometry("600x280")
        
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
        
        url_label = ttk.Label(url_frame, text="仓库地址:")
        url_label.pack(side=tk.LEFT, padx=(0, 10))
        
        self.url_entry = ttk.Entry(url_frame)
        self.url_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        
        # 创建保存路径选择框
        path_frame = ttk.Frame(self.main_frame)
        path_frame.pack(fill=tk.X, pady=(0, 15))
        
        path_label = ttk.Label(path_frame, text="保存位置:")
        path_label.pack(side=tk.LEFT, padx=(0, 10))
        
        self.path_entry = ttk.Entry(path_frame)
        self.path_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        self.path_entry.insert(0, self.software_dir)  # 使用动态获取的路径
        
        self.browse_btn = ttk.Button(
            path_frame,
            text="浏览",
            command=self.browse_directory,
            width=8
        )
        self.browse_btn.pack(side=tk.LEFT, padx=(10, 0))
        
        # 创建自动解压选项
        self.auto_extract = tk.BooleanVar(value=True)
        extract_check = ttk.Checkbutton(
            self.main_frame,
            text="下载后自动解压",
            variable=self.auto_extract
        )
        extract_check.pack(anchor=tk.W, pady=(0, 10))
        
        # 创建下载按钮
        self.download_btn = ttk.Button(
            self.main_frame,
            text="克隆仓库",
            command=self.start_download,
            width=15
        )
        self.download_btn.pack(pady=(0, 10))
        
        # 创建状态标签
        self.status_label = ttk.Label(
            self.main_frame, 
            text="请输入GitHub仓库地址",
            wraplength=560
        )
        self.status_label.pack(fill=tk.X, pady=(5, 10))
        
        # 创建进度条
        self.progress = ttk.Progressbar(
            self.main_frame,
            mode='determinate',
            length=560
        )
        self.progress.pack(fill=tk.X, pady=(5, 0))

    def center_window(self):
        """将窗口居中显示"""
        self.root.update_idletasks()
        width = 600
        height = 280
        x = (self.root.winfo_screenwidth() // 2) - (width // 2)
        y = (self.root.winfo_screenheight() // 2) - (height // 2)
        self.root.geometry(f"{width}x{height}+{x}+{y}")

    def browse_directory(self):
        """打开文件夹选择对话框"""
        directory = filedialog.askdirectory(
            initialdir=self.path_entry.get(),
            title="选择保存位置"
        )
        if directory:
            self.path_entry.delete(0, tk.END)
            self.path_entry.insert(0, directory)

    def update_progress(self, block_num, block_size, total_size):
        """更新下载进度"""
        if total_size > 0:
            percentage = (block_num * block_size / total_size) * 100
            self.progress['value'] = min(percentage, 100)
            self.root.update_idletasks()

    def parse_github_url(self, url):
        """解析GitHub URL，返回用户名和仓库名"""
        # 移除URL开头的@符号
        url = url.lstrip('@')
        
        # 移除末尾的.git（如果有）
        url = url.rstrip('.git')
        
        # 匹配GitHub URL模式
        pattern = r'https?://github\.com/([^/]+)/([^/]+)'
        match = re.match(pattern, url)
        
        if not match:
            raise ValueError("无效的GitHub仓库地址")
            
        return match.group(1), match.group(2)

    def download_file(self, url):
        try:
            # 解析GitHub URL
            username, repo = self.parse_github_url(url)
            
            # 构建下载URL（使用master分支的zip下载链接）
            download_url = f"https://github.com/{username}/{repo}/archive/refs/heads/main.zip"
            
            # 设置保存路径
            save_dir = self.path_entry.get().strip()
            if not save_dir:
                raise ValueError("请选择保存位置")
            
            zip_name = f"{repo}-main.zip"
            download_path = os.path.join(save_dir, zip_name)
            
            # 确保目录存在
            os.makedirs(os.path.dirname(download_path), exist_ok=True)
            
            # 更新状态
            self.status_label.config(text=f"正在下载: {username}/{repo}")
            self.progress['value'] = 0
            
            # 下载文件
            urllib.request.urlretrieve(
                download_url,
                download_path,
                self.update_progress
            )
            
            # 如果选择了自动解压
            if self.auto_extract.get():
                self.status_label.config(text="正在解压仓库...")
                with zipfile.ZipFile(download_path, 'r') as zip_ref:
                    zip_ref.extractall(save_dir)
                
                # 删除zip文件
                os.remove(download_path)
                self.status_label.config(text="仓库克隆完成！")
            else:
                self.status_label.config(text="下载完成！")
            
        except Exception as e:
            self.status_label.config(text=f"克隆失败: {str(e)}")
        finally:
            self.enable_controls()

    def disable_controls(self):
        """禁用控件"""
        self.download_btn.config(state='disabled')
        self.url_entry.config(state='disabled')
        self.path_entry.config(state='disabled')
        self.browse_btn.config(state='disabled')

    def enable_controls(self):
        """启用控件"""
        self.download_btn.config(state='normal')
        self.url_entry.config(state='normal')
        self.path_entry.config(state='normal')
        self.browse_btn.config(state='normal')

    def start_download(self):
        url = self.url_entry.get().strip()
        if not url:
            messagebox.showwarning("警告", "请输入GitHub仓库地址")
            return
        
        # 禁用所有控件
        self.disable_controls()
        
        # 启动下载线程
        thread = threading.Thread(target=self.download_file, args=(url,))
        thread.daemon = True
        thread.start()

    def get_software_dir(self):
        """获取软件目录路径"""
        try:
            # 获取当前脚本所在目录
            current_dir = os.path.dirname(os.path.abspath(__file__))
            
            # 如果是开发环境
            if os.path.basename(current_dir) == 'github_downloader':
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

def main():
    root = tk.Tk()
    app = GithubDownloader(root)
    root.mainloop()

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        messagebox.showerror("错误", f"程序出错: {str(e)}") 