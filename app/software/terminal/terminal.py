import codecs
import ctypes
import locale
import os
import queue
import re
import subprocess
import sys
import tempfile
import threading
import time
import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext, ttk


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
APP_ID = "com.sanrenjz.yuhanbopy.plugin.terminal"


def python_console():
    executable = sys.executable
    if os.path.basename(executable).lower() == "pythonw.exe":
        candidate = os.path.join(os.path.dirname(executable), "python.exe")
        if os.path.isfile(candidate):
            executable = candidate
    return executable


def prepare_command(command):
    # 只替换独立 pip 调用的解释器，保留用户参数，不擅自升级、卸载或指定安装位置。
    match = re.match(r"^(?:pip3?|python3?\s+-m\s+pip)(?=\s|$)", command, re.I)
    if match:
        return subprocess.list2cmdline([python_console()]) + " -m pip" + command[match.end():]
    return command


def resolve_directory(command, current):
    match = re.fullmatch(r"(?:cd|chdir)\s+(?:/d\s+)?(.+)", command, re.I)
    if not match or any(char in command for char in "\n\r&|<>"):
        return None
    target = match.group(1).strip()
    if len(target) >= 2 and target[0] == target[-1] == '"':
        target = target[1:-1]
    target = os.path.expanduser(os.path.expandvars(target))
    target = os.path.abspath(os.path.join(current, target))
    if not os.path.isdir(target):
        raise ValueError("目录不存在或不可访问：" + target)
    return target


class CommandRunner:
    """后台任务只发队列事件，Tk 控件始终由主线程更新。"""

    def __init__(self):
        self.events = queue.Queue(maxsize=256)
        self.lock = threading.Lock()
        self.process = None
        self.thread = None
        self.cancelled = threading.Event()

    @property
    def running(self):
        return self.thread is not None and self.thread.is_alive()

    def start(self, command, cwd, encoding):
        if self.running:
            return False
        self.cancelled.clear()
        self.thread = threading.Thread(target=self._run, args=(command, cwd, encoding), daemon=True)
        self.thread.start()
        return True

    def _read(self, stream, tag, encoding):
        decoder = codecs.getincrementaldecoder(encoding)(errors="replace")
        try:
            # 两路管道并行按块读取，避免等待换行或另一条空管道造成死锁。
            while True:
                data = os.read(stream.fileno(), 4096)
                if not data:
                    break
                self.events.put((tag, decoder.decode(data)))
            tail = decoder.decode(b"", final=True)
            if tail:
                self.events.put((tag, tail))
        except (OSError, ValueError) as error:
            self.events.put(("error", f"\n读取输出失败：{error}\n"))
        finally:
            stream.close()

    def _run(self, command, cwd, encoding):
        started = time.monotonic()
        code = None
        command_directory = None
        try:
            environment = os.environ.copy()
            environment["PYTHONIOENCODING"] = encoding
            environment["PYTHONUNBUFFERED"] = "1"
            options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {"start_new_session": True}
            if os.name == "nt":
                # CMD 代码页与所选解码一致；旧式程序可在界面切换到系统编码。
                page = {"utf-8": 65001, "gbk": 936}.get(codecs.lookup(encoding).name)
                if page is None and encoding.lower().startswith("cp") and encoding[2:].isdigit():
                    page = int(encoding[2:])
                prefix = "@echo off\r\n" + (f"chcp {page} >nul\r\n" if page else "")
                # CMD /c 直接传多行文本会吞掉后续行；临时批处理同时保留引号、管道和多行语义。
                temporary_root = os.path.join(tempfile.gettempdir(), "yuhanbopy-temp")
                os.makedirs(temporary_root, exist_ok=True)
                command_directory = tempfile.TemporaryDirectory(prefix="terminal-", dir=temporary_root)
                script = os.path.join(command_directory.name, "command.cmd")
                with open(script, "w", encoding=encoding, newline="") as output:
                    output.write(prefix + command.replace("\r\n", "\n").replace("\n", "\r\n") + "\r\n")
                shell = os.environ.get("COMSPEC", "cmd.exe")
                args = f'"{shell}" /d /s /c ""{script}""'
            else:
                args = ["/bin/sh", "-c", command]
            with self.lock:
                if self.cancelled.is_set():
                    return
                self.process = subprocess.Popen(
                    args, cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, **options
                )
                process = self.process
            readers = [threading.Thread(target=self._read, args=(stream, tag, encoding), daemon=True)
                       for stream, tag in ((process.stdout, "normal"), (process.stderr, "error"))]
            for reader in readers:
                reader.start()
            code = process.wait()
            for reader in readers:
                reader.join()
        except Exception as error:
            self.events.put(("error", f"\n执行失败：{error}\n"))
        finally:
            if command_directory is not None:
                try:
                    command_directory.cleanup()
                except OSError as error:
                    self.events.put(("error", f"\n临时命令文件清理失败：{error}\n"))
            with self.lock:
                self.process = None
            self.events.put(("done", (code, time.monotonic() - started, self.cancelled.is_set())))

    def stop(self):
        self.cancelled.set()
        threading.Thread(target=self._terminate, daemon=True).start()

    def _terminate(self):
        with self.lock:
            process = self.process
            if process is None:
                return
            try:
                if os.name == "nt":
                    result = subprocess.run(
                        ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                        creationflags=subprocess.CREATE_NO_WINDOW, timeout=10,
                    )
                    if result.returncode and process.poll() is None:
                        raise OSError("无法终止命令进程，请重试")
                else:
                    import signal
                    os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            except (OSError, subprocess.TimeoutExpired) as error:
                self.events.put(("stop_error", f"\n停止失败：{error}\n"))


class TerminalGUI:
    def __init__(self, root):
        self.root = root
        root.title("终端模拟器 · 三人聚智")
        root.geometry("1040x720")
        root.minsize(760, 520)
        root.configure(background="#f0f3f8")
        self.runner = CommandRunner()
        self.cwd = os.path.expanduser("~")
        self.history = []
        self.history_index = 0
        self.draft = ""
        self.busy = False
        self.closing = False
        self.encoding_var = tk.StringVar(value="UTF-8")
        self.directory_var = tk.StringVar(value=self.cwd)
        self.status_var = tk.StringVar(value="就绪")
        self.follow_var = tk.BooleanVar(value=True)
        self._build_ui()
        self._append("终端已就绪\n", "accent")
        self._append("Ctrl+Enter 执行  ·  Alt+↑ / Alt+↓ 历史命令  ·  Ctrl+L 清屏\n"
                     "Windows 使用 CMD 语法；支持多行批处理，不支持交互式输入。\n\n", "muted")
        root.protocol("WM_DELETE_WINDOW", self.close)
        root.bind("<Control-l>", self.clear_screen)
        self.input_text.bind("<Control-Return>", self.execute_command)
        self.input_text.bind("<Control-a>", self.select_all)
        self.input_text.bind("<Alt-Up>", lambda event: self.recall(-1))
        self.input_text.bind("<Alt-Down>", lambda event: self.recall(1))
        self.input_text.focus_set()
        self.poll_id = root.after(50, self.process_output)

    def _build_ui(self):
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure("TFrame", background="#f0f3f8")
        style.configure("TLabel", background="#f0f3f8", foreground="#344054", font=("Microsoft YaHei UI", 10))
        style.configure("Title.TLabel", font=("Microsoft YaHei UI", 20, "bold"), foreground="#101828")
        style.configure("TButton", padding=(12, 7), font=("Microsoft YaHei UI", 10))
        style.configure("Accent.TButton", foreground="white", background="#1890ff")
        style.map("Accent.TButton", background=[("disabled", "#98a2b3"), ("active", "#096dd9")])
        main = ttk.Frame(self.root, padding=20)
        main.pack(fill=tk.BOTH, expand=True)
        header = ttk.Frame(main)
        header.pack(fill=tk.X, pady=(0, 14))
        ttk.Label(header, text="终端模拟器", style="Title.TLabel").pack(side=tk.LEFT)
        ttk.Label(header, text="SYSTEM TERMINAL", foreground="#667085").pack(side=tk.LEFT, padx=14, pady=(8, 0))
        ttk.Button(header, text="导出日志", command=self.export_output).pack(side=tk.RIGHT)
        ttk.Button(header, text="清屏", command=self.clear_screen).pack(side=tk.RIGHT, padx=8)
        directory = ttk.Frame(main)
        directory.pack(fill=tk.X, pady=(0, 12))
        ttk.Label(directory, text="工作目录").pack(side=tk.LEFT, padx=(0, 10))
        self.directory_entry = ttk.Entry(directory, textvariable=self.directory_var)
        self.directory_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        self.directory_entry.bind("<Return>", self.change_directory)
        self.directory_button = ttk.Button(directory, text="切换", command=self.change_directory)
        self.directory_button.pack(side=tk.LEFT, padx=8)
        self.browse_button = ttk.Button(directory, text="浏览…", command=self.browse_directory)
        self.browse_button.pack(side=tk.LEFT)
        output_panel = ttk.Frame(main)
        output_panel.pack(fill=tk.BOTH, expand=True)
        self.output_text = scrolledtext.ScrolledText(
            output_panel, wrap=tk.NONE, background="#101828", foreground="#e4e7ec",
            insertbackground="white", selectbackground="#24578a", relief=tk.FLAT,
            padx=14, pady=14, font=("Consolas", 11), state=tk.DISABLED, height=20,
        )
        self.output_text.pack(fill=tk.BOTH, expand=True)
        horizontal = ttk.Scrollbar(output_panel, orient=tk.HORIZONTAL, command=self.output_text.xview)
        horizontal.pack(fill=tk.X)
        self.output_text.configure(xscrollcommand=horizontal.set)
        for tag, color in (("normal", "#e4e7ec"), ("error", "#ff9393"), ("accent", "#69c0ff"), ("muted", "#98a2b3")):
            self.output_text.tag_configure(tag, foreground=color)
        options = ttk.Frame(main)
        options.pack(fill=tk.X, pady=(12, 6))
        ttk.Label(options, text="命令输入", font=("Microsoft YaHei UI", 10, "bold")).pack(side=tk.LEFT)
        ttk.Label(options, text="Ctrl+Enter 执行", foreground="#667085").pack(side=tk.LEFT, padx=12)
        self.encoding_box = ttk.Combobox(options, textvariable=self.encoding_var, values=("UTF-8", "系统默认", "GBK"), width=10, state="readonly")
        self.encoding_box.pack(side=tk.RIGHT)
        ttk.Label(options, text="输出编码").pack(side=tk.RIGHT, padx=8)
        ttk.Checkbutton(options, text="自动滚动", variable=self.follow_var).pack(side=tk.RIGHT, padx=12)
        entry = ttk.Frame(main)
        entry.pack(fill=tk.X)
        self.input_text = scrolledtext.ScrolledText(entry, height=4, wrap=tk.WORD, undo=True,
                                                   font=("Consolas", 11), relief=tk.FLAT, padx=10, pady=8)
        self.input_text.pack(side=tk.LEFT, fill=tk.X, expand=True)
        actions = ttk.Frame(entry)
        actions.pack(side=tk.RIGHT, fill=tk.Y, padx=(12, 0))
        self.run_button = ttk.Button(actions, text="执行命令", style="Accent.TButton", command=self.execute_command)
        self.run_button.pack(fill=tk.X)
        self.stop_button = ttk.Button(actions, text="停止", state=tk.DISABLED, command=self.stop_command)
        self.stop_button.pack(fill=tk.X, pady=(6, 0))
        footer = ttk.Frame(main)
        footer.pack(fill=tk.X, pady=(12, 0))
        ttk.Label(footer, textvariable=self.status_var, foreground="#096dd9").pack(side=tk.LEFT)
        ttk.Label(footer, text="历史仅保留在本次窗口内 · 输出有容量上限", foreground="#667085").pack(side=tk.RIGHT)

    def _append(self, text, tag="normal"):
        self.output_text.configure(state=tk.NORMAL)
        self.output_text.insert(tk.END, text.replace("\r\n", "\n").replace("\r", "\n"), tag)
        lines = int(self.output_text.index("end-1c").split(".")[0])
        if lines > 12000:
            self.output_text.delete("1.0", f"{lines - 12000 + 1}.0")
        # 行数与字符数双重限制，处理没有换行的长输出。
        count = self.output_text.count("1.0", "end-1c", "chars")[0]
        if count > 1000000:
            self.output_text.delete("1.0", f"1.0+{count - 1000000}c")
        self.output_text.configure(state=tk.DISABLED)
        if self.follow_var.get():
            self.output_text.see(tk.END)

    def _set_busy(self, busy):
        self.busy = busy
        self.run_button.configure(state=tk.DISABLED if busy else tk.NORMAL)
        self.stop_button.configure(state=tk.NORMAL if busy else tk.DISABLED)
        for widget in (self.directory_entry, self.directory_button, self.browse_button):
            widget.configure(state=tk.DISABLED if busy else tk.NORMAL)
        self.encoding_box.configure(state=tk.DISABLED if busy else "readonly")

    def select_all(self, event=None):
        self.input_text.tag_add(tk.SEL, "1.0", "end-1c")
        return "break"

    def clear_screen(self, event=None):
        self.output_text.configure(state=tk.NORMAL)
        self.output_text.delete("1.0", tk.END)
        self.output_text.configure(state=tk.DISABLED)
        return "break"

    def change_directory(self, event=None):
        if not self.busy:
            target = os.path.expanduser(os.path.expandvars(self.directory_var.get().strip().strip('"')))
            target = os.path.abspath(os.path.join(self.cwd, target))
            if os.path.isdir(target):
                self.cwd = target
                self.status_var.set("已切换工作目录")
            else:
                self._append("目录不存在或不可访问：" + target + "\n", "error")
            self.directory_var.set(self.cwd)
        return "break"

    def browse_directory(self):
        path = filedialog.askdirectory(parent=self.root, initialdir=self.cwd, title="选择工作目录")
        if path:
            self.directory_var.set(path)
            self.change_directory()

    def recall(self, step):
        if not self.history:
            return "break"
        if self.history_index == len(self.history):
            self.draft = self.input_text.get("1.0", "end-1c")
        self.history_index = max(0, min(len(self.history), self.history_index + step))
        self.input_text.delete("1.0", tk.END)
        self.input_text.insert("1.0", self.history[self.history_index] if self.history_index < len(self.history) else self.draft)
        return "break"

    def execute_command(self, event=None):
        if self.busy or self.closing:
            return "break"
        command = self.input_text.get("1.0", "end-1c").strip()
        if not command:
            return "break"
        if command.lower() in ("exit", "quit"):
            self.close()
            return "break"
        if not self.history or self.history[-1] != command:
            self.history.append(command)
            self.history = self.history[-100:]
        self.history_index = len(self.history)
        self.draft = ""
        self.input_text.delete("1.0", tk.END)
        if command.lower() in ("clear", "cls"):
            return self.clear_screen()
        self._append(f"\n{self.cwd}> {command}\n", "accent")
        try:
            directory = resolve_directory(command, self.cwd)
            if directory:
                self.cwd = directory
                self.directory_var.set(directory)
                self.status_var.set("已切换工作目录")
                return "break"
        except ValueError as error:
            self._append(str(error) + "\n", "error")
            return "break"
        encoding = {"UTF-8": "utf-8", "GBK": "gbk", "系统默认": locale.getpreferredencoding(False)}[self.encoding_var.get()]
        self._set_busy(True)
        self.status_var.set("正在执行…")
        if not self.runner.start(prepare_command(command), self.cwd, encoding):
            self._set_busy(False)
            self.status_var.set("上一条命令仍在收尾，请稍后重试")
        return "break"

    def stop_command(self):
        if self.busy:
            self.status_var.set("正在停止…")
            self.runner.stop()

    def process_output(self):
        # 每次只处理有限事件，将控制权及时还给 Tk，避免高频输出冻结界面。
        for _ in range(64):
            try:
                tag, payload = self.runner.events.get_nowait()
            except queue.Empty:
                break
            if tag == "done":
                code, elapsed, stopped = payload
                text = "已停止" if stopped else ("执行成功" if code == 0 else "执行失败")
                self.status_var.set(f"{text} · 返回码 {code} · {elapsed:.2f} 秒")
                self._append(f"\n[{self.status_var.get()}]\n", "muted" if stopped or code == 0 else "error")
                self._set_busy(False)
            elif tag == "stop_error":
                self.closing = False
                self.status_var.set("停止失败，可重试或等待命令结束")
                self._append(payload, "error")
            else:
                self._append(payload, tag)
        if self.closing and not self.busy and not self.runner.running:
            self.root.destroy()
            return
        self.poll_id = self.root.after(50, self.process_output)

    def export_output(self):
        path = filedialog.asksaveasfilename(parent=self.root, title="导出当前输出", defaultextension=".txt",
                                          filetypes=[("文本日志", "*.txt"), ("所有文件", "*.*")])
        if path:
            try:
                with open(path, "w", encoding="utf-8") as output:
                    output.write(self.output_text.get("1.0", "end-1c"))
                self.status_var.set("日志已导出")
            except OSError as error:
                messagebox.showerror("导出失败", str(error), parent=self.root)

    def close(self):
        if self.closing:
            return
        if self.busy:
            if not messagebox.askokcancel("关闭终端", "命令仍在执行，停止该命令及其子进程并关闭窗口？", parent=self.root):
                return
            self.closing = True
            self.stop_command()
        else:
            self.root.after_cancel(self.poll_id)
            self.root.destroy()


def main():
    if sys.platform == "win32":
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
    root = tk.Tk()
    for filename in ("logo.png", "logo.ico"):
        try:
            if filename.endswith(".png"):
                root._terminal_logo = tk.PhotoImage(file=os.path.join(BASE_DIR, filename))
                root.iconphoto(True, root._terminal_logo)
            else:
                root.iconbitmap(default=os.path.join(BASE_DIR, filename))
                root.iconbitmap(os.path.join(BASE_DIR, filename))
        except tk.TclError:
            pass
    TerminalGUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
