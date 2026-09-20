import argparse
import ctypes
import os
import runpy
import sys


def configure_windows_identity(app_id):
    if sys.platform != "win32" or not app_id:
        return
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(app_id)
    except Exception:
        pass


def install_tkinter_icon(logo_path, icon_path):
    if not any(path and os.path.isfile(path) for path in (logo_path, icon_path)):
        return
    try:
        import tkinter as tk
    except Exception:
        return

    original_init = tk.Tk.__init__

    def patched_init(window, *args, **kwargs):
        original_init(window, *args, **kwargs)
        # PNG 负责窗口图像，ICO 同时设置默认类图标和当前窗口图标；两者缺一时
        # Windows 任务栏可能继续显示 python.exe 的通用图标。
        try:
            if logo_path and os.path.isfile(logo_path) and not logo_path.lower().endswith(".ico"):
                image = tk.PhotoImage(file=logo_path)
                window.iconphoto(True, image)
                window._yuhanbopy_plugin_logo = image
        except Exception:
            pass
        if icon_path and os.path.isfile(icon_path):
            try:
                window.iconbitmap(default=icon_path)
                window.iconbitmap(icon_path)
                window._yuhanbopy_plugin_icon = icon_path
            except Exception:
                pass

    tk.Tk.__init__ = patched_init


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--script", required=True)
    parser.add_argument("--logo", default="")
    parser.add_argument("--icon", default="")
    parser.add_argument("--app-id", default="")
    parser.add_argument("--config", default="")
    parser.add_argument("--config-dir", default="")
    options, plugin_args = parser.parse_known_args()

    configure_windows_identity(options.app_id)
    if options.config:
        os.environ["YUHANBOPY_PLUGIN_CONFIG_FILE"] = os.path.abspath(options.config)
    if options.config_dir:
        os.environ["YUHANBOPY_PLUGIN_CONFIG_DIR"] = os.path.abspath(options.config_dir)
    install_tkinter_icon(options.logo, options.icon)
    sys.argv = [options.script, *plugin_args]
    runpy.run_path(options.script, run_name="__main__")


if __name__ == "__main__":
    main()
