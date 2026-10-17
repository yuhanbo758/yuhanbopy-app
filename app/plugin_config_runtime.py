"""Python 插件统一用户配置读写接口。"""

import json
import os
import tempfile
import re
import subprocess
from pathlib import Path


CONFIG_FILE_ENV = "YUHANBOPY_PLUGIN_CONFIG_FILE"
CONFIG_DIR_ENV = "YUHANBOPY_PLUGIN_CONFIG_DIR"


def protect_config_directory(directory):
    root = Path(directory).resolve()
    root.mkdir(parents=True, exist_ok=True)
    try:
        result = subprocess.run(["git", "-C", str(root), "ls-files", "--", "."],
                                capture_output=True, text=True,
                                creationflags=0x08000000 if os.name == "nt" else 0)
        if result.returncode == 0 and result.stdout.strip():
            raise RuntimeError("用户配置目录包含 Git 已跟踪文件，请选择独立的私密目录")
    except FileNotFoundError:
        pass
    ignore = root / ".gitignore"
    previous = ignore.read_text(encoding="utf-8") if ignore.exists() else ""
    if not previous.rstrip().endswith("# Private plugin configuration\n*"):
        with ignore.open("a", encoding="utf-8", newline="\n") as stream:
            stream.write(("\n" if previous and not previous.endswith("\n") else "") +
                         "# Private plugin configuration\n*\n")
    return root


def initialize_config(plugin_directory, settings_path=None):
    """优先统一配置；脱离主程序且没有目录设置时使用插件旁配置。"""
    plugin = Path(plugin_directory).resolve()
    app_dir = None
    if plugin.parent.name == 'plugins':
        app_dir = plugin.parent.parent
    elif plugin.parent.name == 'software' and plugin.parent.parent.name == 'app':
        app_dir = plugin.parents[2]
    has_host = app_dir is not None and any((app_dir / relative).is_file() for relative in (
        'app/plugin_config_runtime.py', 'resources/app/plugin_config_runtime.py'))
    local_mode = False
    if os.environ.get(CONFIG_FILE_ENV, "").strip():
        config = Path(get_config_path())
        root = Path(get_config_directory())
        local_mode = not has_host and config.resolve() == plugin / 'config.json'
    else:
        appdata = os.environ.get("APPDATA") or str(Path.home() / ".config")
        settings_file = Path(settings_path) if settings_path else Path(appdata) / "yuhanbopy-app" / "settings.json"
        settings = json.loads(settings_file.read_text(encoding="utf-8-sig")) if settings_file.exists() else {}
        custom = str(settings.get("customPluginConfigDir", "") or '').strip()
        local_mode = not custom and not has_host
        root = Path(custom).resolve() if custom else (app_dir / 'plugin-configs' if has_host else plugin)
        plugin_id = re.sub(r"[^a-z0-9_-]+", "_", plugin.name.lower()).strip("_")
        plugin_id = plugin_id or plugin.name.encode("utf-8").hex()[:32]
        config = root / ('config.json' if local_mode else plugin_id + '.json')
    if not local_mode and (config.resolve().is_relative_to(plugin) or root.resolve().is_relative_to(plugin)):
        raise RuntimeError("用户配置必须保存在插件目录之外")
    if not local_mode and app_dir and any(root.resolve().is_relative_to(base) for base in (app_dir / 'app' / 'software', app_dir / 'plugins')):
        raise RuntimeError("用户配置目录不能放在插件程序目录中")
    if config.parent.resolve() != root.resolve():
        raise RuntimeError("插件配置文件必须位于插件用户配置目录")
    if local_mode:
        # 独立包只忽略真实配置及运行数据，不得忽略整个插件源码目录。
        try:
            tracked = subprocess.run(['git', '-C', str(plugin), 'ls-files', '--error-unmatch', '--', 'config.json'],
                                     capture_output=True, creationflags=0x08000000 if os.name == 'nt' else 0)
            if tracked.returncode == 0:
                raise RuntimeError('独立配置 config.json 已被 Git 跟踪，请先移出版本控制后再保存真实配置')
        except FileNotFoundError:
            pass
        ignore = plugin / '.gitignore'
        previous = ignore.read_text(encoding='utf-8') if ignore.exists() else ''
        rules = '/config.json\n/.config-*.tmp\n/sanrenjz-python-loc_cos_backup/\n/sanrenjz-backup/\n'
        if not previous.endswith(rules):
            with ignore.open('a', encoding='utf-8', newline='\n') as stream:
                stream.write(('\n' if previous and not previous.endswith('\n') else '') + rules)
    else:
        protect_config_directory(root)
    os.environ[CONFIG_FILE_ENV] = str(config.resolve())
    os.environ[CONFIG_DIR_ENV] = str(root.resolve())
    if not config.exists():
        # 仅首次从公开默认模板初始化，已有用户文件永不覆盖。
        metadata_file = plugin / 'settings.json'
        metadata = json.loads(metadata_file.read_text(encoding='utf-8-sig')) if metadata_file.exists() else {}
        template = (plugin / metadata.get('config_file', 'config.json')).resolve()
        if not template.is_relative_to(plugin) or template == plugin:
            raise RuntimeError('默认配置模板必须位于插件目录内')
        defaults = json.loads(template.read_text(encoding='utf-8-sig')) if template.is_file() else {}
        save_config(defaults)
    return str(config.resolve())


def get_config_path():
    config_path = os.environ.get(CONFIG_FILE_ENV, "").strip()
    if not config_path:
        raise RuntimeError("主程序未提供插件用户配置路径")
    return os.path.abspath(config_path)


def get_config_directory():
    configured = os.environ.get(CONFIG_DIR_ENV, "").strip()
    return os.path.abspath(configured or os.path.dirname(get_config_path()))


def load_config():
    with open(get_config_path(), "r", encoding="utf-8") as file:
        value = json.load(file)
    if not isinstance(value, dict):
        raise ValueError("插件配置根节点必须是 JSON 对象")
    return value


def save_config(config):
    if not isinstance(config, dict):
        raise TypeError("插件配置根节点必须是字典")
    config_path = get_config_path()
    config_dir = os.path.dirname(config_path)
    os.makedirs(config_dir, exist_ok=True)
    descriptor, temp_path = tempfile.mkstemp(prefix=".config-", suffix=".tmp", dir=config_dir)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as file:
            json.dump(config, file, ensure_ascii=False, indent=2)
            file.write("\n")
        os.replace(temp_path, config_path)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
