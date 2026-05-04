import os
import sys
import subprocess
import platform
import tkinter as tk
from tkinter import ttk, scrolledtext
from tkinter import messagebox
import threading
import queue
import locale

class TerminalGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("终端模拟器")
        self.root.geometry("800x600")
        
        # 获取系统默认编码
        self.system_encoding = locale.getpreferredencoding()
        
        # 设置主题色
        style = ttk.Style()
        style.configure("Custom.TFrame", background="#f0f0f0")
        
        # 创建主框架
        self.main_frame = ttk.Frame(root, style="Custom.TFrame")
        self.main_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        
        # 创建输出文本区域
        self.output_text = scrolledtext.ScrolledText(
            self.main_frame,
            wrap=tk.WORD,
            background="#ffffff",
            foreground="#1e1e1e",
            font=("Consolas", 10),
            height=20  # 调整输出区域的高度
        )
        self.output_text.pack(fill=tk.BOTH, expand=True, pady=(0, 10))
        
        # 配置错误文本标签
        self.output_text.tag_configure("error", foreground="#ff4d4f")
        
        # 创建输入区域的容器
        input_container = ttk.Frame(self.main_frame)
        input_container.pack(fill=tk.BOTH, expand=False)
        
        # 显示当前目录
        self.dir_label = ttk.Label(input_container, text=os.getcwd())
        self.dir_label.pack(fill=tk.X, pady=(0, 5))
        
        # 创建输入框和按钮的容器
        input_frame = ttk.Frame(input_container)
        input_frame.pack(fill=tk.BOTH, expand=True)
        
        # 创建多行文本输入框
        self.input_text = scrolledtext.ScrolledText(
            input_frame,
            wrap=tk.WORD,
            background="white",  # 改为白色背景
            foreground="black",  # 改为黑色文字
            font=("Consolas", 10),
            height=3,  # 设置为3行
            undo=True  # 启用撤销功能
        )
        self.input_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        # 创建按钮容器
        button_frame = ttk.Frame(input_frame)
        button_frame.pack(side=tk.RIGHT, padx=(5, 0), fill=tk.Y)
        
        # 创建执行按钮
        self.run_button = ttk.Button(
            button_frame, 
            text="执行\n(Ctrl+Enter)", 
            command=self.execute_command,
            width=15
        )
        self.run_button.pack(fill=tk.BOTH, expand=True)
        
        # 绑定快捷键
        self.input_text.bind("<Control-Return>", lambda e: self.execute_command())
        self.input_text.bind("<Control-Key-a>", lambda e: self.select_all())
        self.input_text.bind("<Control-Key-l>", lambda e: self.clear_screen())
        
        # 输出队列
        self.output_queue = queue.Queue()
        
        # 显示欢迎信息
        self.show_welcome_message()
        
        # 启动输出处理线程
        self.process_output()
        
        # 设置焦点到输入框
        self.input_text.focus_set()

    def select_all(self, event=None):
        """选择所有文本"""
        self.input_text.tag_add(tk.SEL, "1.0", tk.END)
        self.input_text.mark_set(tk.INSERT, "1.0")
        self.input_text.see(tk.INSERT)
        return 'break'

    def show_welcome_message(self):
        # 配置普通文本标签
        self.output_text.tag_configure("normal", font=("Consolas", 10))
        
        welcome_msg = """欢迎使用终端模拟器！

可用命令：
- 输入任何系统命令来执行
- exit 或 quit：退出程序
- clear：清除屏幕
- cd 目录路径：切换工作目录

快捷键：
- Ctrl+Enter：执行命令
- Ctrl+A：全选文本
- Ctrl+L：清除屏幕

特别说明：
- pip 命令将优先使用官方源，如果失败会自动切换到国内镜像
- 支持所有系统命令和中文输出
- 支持多行命令输入

""" + "-" * 50 + "\n"
        
        # 使用normal标签插入文本
        self.output_text.insert(tk.END, welcome_msg, "normal")
        self.output_text.see(tk.END)

    def clear_screen(self):
        self.output_text.delete(1.0, tk.END)

    def update_dir_label(self):
        self.dir_label.config(text=os.getcwd())

    def process_output(self):
        try:
            while True:
                try:
                    msg, is_error = self.output_queue.get_nowait()
                    if is_error:
                        self.output_text.insert(tk.END, msg + "\n", "error")
                    else:
                        self.output_text.insert(tk.END, msg + "\n")
                    self.output_text.see(tk.END)
                    self.output_queue.task_done()
                except queue.Empty:
                    break
        finally:
            self.root.after(100, self.process_output)

    def run_command(self, command):
        try:
            # 特殊处理pip命令
            is_pip_command = command.startswith(('pip ', 'pip3 ', 'python -m pip ', 'python3 -m pip '))
            if is_pip_command:
                command = self.modify_pip_command(command)

            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                shell=True,
                encoding=self.system_encoding,
                errors='replace'
            )
            
            def read_output():
                try:
                    while True:
                        output = process.stdout.readline()
                        error = process.stderr.readline()
                        
                        if output == '' and error == '' and process.poll() is not None:
                            break
                        
                        # 对于pip命令，过滤不必要的输出
                        if is_pip_command:
                            if error and not any(skip_msg in error.lower() for skip_msg in [
                                'requirement already satisfied',
                                'already up to date',
                                'collecting',
                                'downloading',
                                'installing collected packages',
                                'successfully installed'
                            ]):
                                self.output_queue.put((error.strip(), True))
                            if output:
                                self.output_queue.put((output.strip(), False))
                        else:
                            if output:
                                self.output_queue.put((output.strip(), False))
                            if error:
                                self.output_queue.put((error.strip(), True))
                    
                    return_code = process.poll()
                    if return_code != 0 and not is_pip_command:
                        self.output_queue.put((f"\n命令执行失败，返回码: {return_code}", True))
                except Exception as e:
                    self.output_queue.put((f"读取输出时出错: {str(e)}", True))
            
            thread = threading.Thread(target=read_output)
            thread.daemon = True
            thread.start()
            
        except Exception as e:
            self.output_queue.put((f"执行命令时出错: {str(e)}", True))

    def modify_pip_command(self, command):
        """修改pip命令，添加必要的参数"""
        pip_sources = [
            'https://pypi.org/simple/',  # 官方源
            'https://pypi.tuna.tsinghua.edu.cn/simple/',  # 清华源
            'https://mirrors.aliyun.com/pypi/simple/',  # 阿里源
        ]
        
        # 获取python.exe所在目录
        python_dir = os.path.dirname(sys.executable)
        site_packages = os.path.join(python_dir, "Lib", "site-packages")
        
        # 如果site-packages目录不存在，创建它
        if not os.path.exists(site_packages):
            os.makedirs(site_packages)
        
        # 修改命令以使用完整路径
        if command.startswith('pip '):
            command = f'"{sys.executable}" -m pip {command[4:]}'
        elif command.startswith('pip3 '):
            command = f'"{sys.executable}" -m pip {command[5:]}'
        
        # 根据不同的pip命令添加不同的参数
        if ' install ' in command:
            # 安装命令的特殊参数
            extra_args = [
                '--no-warn-conflicts',
                '--disable-pip-version-check',
                '--upgrade',  # 添加升级参数
                f'--target={site_packages}',  # 指定安装目录
                '--progress-bar', 'on',  # 显示进度条
                '--index-url', pip_sources[0],
                '--extra-index-url', pip_sources[1],
                '--extra-index-url', pip_sources[2],
                '--trusted-host', 'pypi.org',
                '--trusted-host', 'pypi.tuna.tsinghua.edu.cn',
                '--trusted-host', 'mirrors.aliyun.com'
            ]
            parts = command.split(' install ', 1)
            return f"{parts[0]} install {' '.join(extra_args)} {parts[1]}"
        elif ' uninstall ' in command:
            # 卸载命令的特殊参数
            extra_args = ['--yes']  # 自动确认卸载
            parts = command.split(' uninstall ', 1)
            return f"{parts[0]} uninstall {' '.join(extra_args)} {parts[1]}"
        
        return command

    def execute_command(self):
        command = self.input_text.get("1.0", tk.END).strip()
        if not command:
            return
            
        # 清空输入框
        self.input_text.delete("1.0", tk.END)
        
        self.output_text.insert(tk.END, f"{os.getcwd()}> {command}\n")
        
        if command.lower() in ['exit', 'quit']:
            if messagebox.askokcancel("确认", "确定要退出程序吗？"):
                self.root.quit()
            return
            
        if command.lower() == 'clear':
            self.clear_screen()
            return
            
        if command.lower().startswith('cd '):
            try:
                new_dir = command[3:].strip()
                new_dir = os.path.expanduser(os.path.expandvars(new_dir))
                os.chdir(new_dir)
                self.update_dir_label()
            except Exception as e:
                self.output_queue.put((f"切换目录失败: {str(e)}", True))
            return
        
        self.run_command(command)

def main():
    root = tk.Tk()
    app = TerminalGUI(root)
    root.mainloop()

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        messagebox.showerror("错误", f"程序出错: {str(e)}") 