"""终端回归验证：只在临时目录执行本地、无副作用的命令。"""
import importlib.util
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import time
import tkinter as tk
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "app/software/terminal/terminal.py"
spec = importlib.util.spec_from_file_location("terminal_plugin", SOURCE)
terminal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(terminal)


def python_command(source):
    return subprocess.list2cmdline([sys.executable, "-u", "-c", source])


def collect(runner, timeout=12):
    events = []
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            event = runner.events.get(timeout=0.1)
        except queue.Empty:
            continue
        events.append(event)
        if event[0] == "done":
            runner.thread.join(2)
            return events
    runner.stop()
    raise AssertionError("命令未在限制时间内结束")


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="terminal-test-")
        self.addCleanup(self.directory.cleanup)
        self.runner = terminal.CommandRunner()

    def run_command(self, command, encoding="utf-8"):
        self.assertTrue(self.runner.start(command, self.directory.name, encoding))
        return collect(self.runner)

    def test_streams_and_nonzero_exit(self):
        events = self.run_command(python_command(
            "import sys; print('中文输出'); sys.stderr.write('E'*180000); sys.exit(7)"))
        self.assertIn("中文输出", "".join(value for tag, value in events if tag == "normal"))
        self.assertEqual(sum(value.count("E") for tag, value in events if tag == "error"), 180000)
        self.assertEqual(events[-1][1][0], 7)

    def test_live_output_without_newline_and_stop(self):
        self.runner.start(python_command(
            "import sys,time; sys.stdout.write('READY'); sys.stdout.flush(); time.sleep(30)"),
            self.directory.name, "utf-8")
        try:
            tag, value = self.runner.events.get(timeout=5)
            self.assertEqual((tag, value), ("normal", "READY"))
            self.assertFalse(self.runner.start("echo duplicate", self.directory.name, "utf-8"))
        finally:
            self.runner.stop()
        events = collect(self.runner)
        self.assertTrue(events[-1][1][2])

    def test_multiline_and_pipe(self):
        events = self.run_command("echo first\necho second")
        output = "".join(value for tag, value in events if tag == "normal")
        self.assertIn("first", output)
        self.assertIn("second", output)
        events = self.run_command('echo pipe-ok | findstr pipe-ok' if os.name == "nt" else 'echo pipe-ok | cat')
        self.assertIn("pipe-ok", "".join(value for tag, value in events if tag == "normal"))

    def test_cwd_with_unicode_and_spaces(self):
        path = Path(self.directory.name) / "中文 空格"
        path.mkdir()
        self.assertEqual(terminal.resolve_directory('cd /d "中文 空格"', self.directory.name), str(path))
        self.assertIsNone(terminal.resolve_directory('cd .. & echo next', str(path)))
        with self.assertRaises(ValueError):
            terminal.resolve_directory("cd missing", str(path))
        self.runner.start(python_command("import os; print(os.getcwd())"), str(path), "utf-8")
        self.assertIn(str(path), "".join(value for tag, value in collect(self.runner) if tag == "normal"))

    def test_gbk(self):
        events = self.run_command(python_command("print('中文输出')"), "gbk")
        self.assertIn("中文输出", "".join(value for tag, value in events if tag == "normal"))

    def test_pip_parameters_preserved(self):
        for prefix in ("pip", "pip3", "python -m pip", "python3 -m pip"):
            command = terminal.prepare_command(prefix + ' install "some package" -i https://example.invalid/simple')
            self.assertTrue(command.endswith(' -m pip install "some package" -i https://example.invalid/simple'))
            self.assertNotIn("--upgrade", command)
            self.assertNotIn("--target", command)
        self.assertNotIn("--yes", terminal.prepare_command("pip uninstall example"))
        self.assertEqual(terminal.prepare_command("pipx --version"), "pipx --version")
        events = self.run_command(terminal.prepare_command("pip --version"))
        self.assertEqual(events[-1][1][0], 0)

    def test_stop_before_spawn(self):
        with self.runner.lock:
            self.runner.start("echo unused", self.directory.name, "utf-8")
            self.runner.stop()
        self.assertTrue(collect(self.runner)[-1][1][2])

    @unittest.skipUnless(os.name == "nt", "Windows 进程树验证")
    def test_stop_child_process(self):
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        source = "import subprocess,sys,time; p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); print(p.pid,flush=True); time.sleep(30)"
        self.runner.start(python_command(source), self.directory.name, "utf-8")
        handle = None
        try:
            tag, value = self.runner.events.get(timeout=5)
            self.assertEqual(tag, "normal")
            handle = kernel.OpenProcess(0x00100000, False, int(value.strip()))
            self.assertTrue(handle)
        finally:
            self.runner.stop()
        collect(self.runner)
        try:
            self.assertEqual(kernel.WaitForSingleObject(handle, 3000), 0)
        finally:
            if handle:
                kernel.CloseHandle(handle)

    @unittest.skipUnless(os.name == "nt", "Windows VBS 启动验证")
    def test_vbs_launch_in_isolated_directory(self):
        root = Path(self.directory.name)
        plugin = root / "app/software/terminal"
        plugin.mkdir(parents=True)
        marker = root / "started.txt"
        (plugin / "terminal.py").write_text(
            "from pathlib import Path\nPath(" + repr(str(marker)) + ").write_text('ok')\n", encoding="utf-8")
        (plugin / "config.json").write_text("{}", encoding="utf-8")
        source = (SOURCE.parent / "VBS运行.vbs").read_text(encoding="utf-16")
        source = source.replace('pythonExe = "pythonw"', 'pythonExe = "' + sys.executable + '"')
        source = source.replace('objShell.Run command, 0, False', 'objShell.Run command, 0, True')
        launcher = plugin / "VBS运行.vbs"
        launcher.write_text(source, encoding="utf-16")
        result = subprocess.run(["cscript.exe", "//Nologo", str(launcher)], capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(marker.read_text(), "ok")
        self.assertEqual((root / "plugin-configs/terminal.json").read_text(), "{}")


class GuiTests(unittest.TestCase):
    def setUp(self):
        self.root = tk.Tk()
        self.root.withdraw()
        self.gui = terminal.TerminalGUI(self.root)

    def tearDown(self):
        self.gui.close()

    def test_output_history_and_command(self):
        self.gui.clear_screen()
        self.gui._append("x" * 1000200)
        self.assertEqual(self.gui.output_text.count("1.0", "end-1c", "chars")[0], 1000000)
        self.gui.clear_screen()
        self.gui.input_text.insert("1.0", "echo gui-ok")
        self.gui.execute_command()
        self.assertTrue(self.gui.busy)
        self.assertTrue(self.gui.run_button.instate(["disabled"]))
        deadline = time.monotonic() + 10
        while self.gui.busy and time.monotonic() < deadline:
            self.root.update()
            time.sleep(0.02)
        self.assertFalse(self.gui.busy)
        self.assertIn("gui-ok", self.gui.output_text.get("1.0", "end-1c"))
        self.assertIn("执行成功", self.gui.status_var.get())
        self.gui.input_text.insert("1.0", "draft")
        self.gui.recall(-1)
        self.assertEqual(self.gui.input_text.get("1.0", "end-1c"), "echo gui-ok")
        self.gui.recall(1)
        self.assertEqual(self.gui.input_text.get("1.0", "end-1c"), "draft")


if __name__ == "__main__":
    unittest.main(verbosity=2)
