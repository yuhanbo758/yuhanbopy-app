"""Python 插件统一用户配置读写接口。"""

import json
import os
import tempfile


CONFIG_FILE_ENV = "YUHANBOPY_PLUGIN_CONFIG_FILE"
CONFIG_DIR_ENV = "YUHANBOPY_PLUGIN_CONFIG_DIR"


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
