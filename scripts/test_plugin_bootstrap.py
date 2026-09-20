import ctypes
import os
import subprocess
import sys
import tempfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
BOOTSTRAP = PROJECT_ROOT / "app" / "plugin_bootstrap.py"
TEST_LOGO = PROJECT_ROOT / "app" / "software" / "terminal" / "logo.png"
TEST_ICON = PROJECT_ROOT / "app" / "software" / "terminal" / "logo.ico"
EXPECTED_APP_ID = "com.sanrenjz.yuhanbopy.plugin.bootstrap.test"


def main():
    with tempfile.TemporaryDirectory(prefix="yuhanbopy-bootstrap-test-") as temp_dir:
        probe = Path(temp_dir) / "probe.py"
        probe.write_text(
            "import os\n"
            "import sys\n"
            "import ctypes\n"
            "import tkinter as tk\n"
            "assert tk.Tk.__init__.__name__ == 'patched_init'\n"
            "root = tk.Tk()\n"
            "root.withdraw()\n"
            "assert hasattr(root, '_yuhanbopy_plugin_logo')\n"
            "assert hasattr(root, '_yuhanbopy_plugin_icon')\n"
            "assert os.environ['YUHANBOPY_PLUGIN_CONFIG_FILE'].endswith('terminal.json')\n"
            "root.update_idletasks()\n"
            "if sys.platform == 'win32':\n"
            "    child_hwnd = root.winfo_id()\n"
            "    frame_hwnd = ctypes.windll.user32.GetParent(child_hwnd) or child_hwnd\n"
            "    icon_handle = ctypes.windll.user32.SendMessageW(frame_hwnd, 0x007F, 1, 0)\n"
            "    if not icon_handle:\n"
            "        icon_handle = ctypes.windll.user32.GetClassLongPtrW(frame_hwnd, -14)\n"
            "    assert icon_handle, 'Windows 窗口没有加载大图标句柄'\n"
            "root.destroy()\n"
            "if sys.platform == 'win32':\n"
            "    import ctypes\n"
            "    app_id = ctypes.c_wchar_p()\n"
            "    result = ctypes.windll.shell32.GetCurrentProcessExplicitAppUserModelID(ctypes.byref(app_id))\n"
            "    assert result == 0\n"
            f"    assert app_id.value == {EXPECTED_APP_ID!r}\n"
            "print('plugin_bootstrap probe passed')\n",
            encoding="utf-8",
        )
        result = subprocess.run(
            [
                sys.executable,
                os.fspath(BOOTSTRAP),
                "--script",
                os.fspath(probe),
                "--logo",
                os.fspath(TEST_LOGO),
                "--icon",
                os.fspath(TEST_ICON),
                "--config",
                os.fspath(Path(temp_dir) / "terminal.json"),
                "--config-dir",
                os.fspath(Path(temp_dir)),
                "--app-id",
                EXPECTED_APP_ID,
            ],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        if result.returncode != 0:
            raise AssertionError(f"bootstrap probe failed:\nstdout={result.stdout}\nstderr={result.stderr}")
        assert "plugin_bootstrap probe passed" in result.stdout
    print("plugin_bootstrap test passed")


if __name__ == "__main__":
    main()
