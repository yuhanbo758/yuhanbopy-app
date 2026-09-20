import os
import sys
import tempfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, os.fspath(PROJECT_ROOT / "app"))

from plugin_config_runtime import get_config_directory, get_config_path, load_config, save_config


def main():
    with tempfile.TemporaryDirectory(prefix="yuhanbopy-config-runtime-test-") as temp_dir:
        config_path = Path(temp_dir) / "sample_plugin.json"
        config_path.write_text('{"value": "default"}\n', encoding="utf-8")
        os.environ["YUHANBOPY_PLUGIN_CONFIG_FILE"] = os.fspath(config_path)
        os.environ["YUHANBOPY_PLUGIN_CONFIG_DIR"] = temp_dir
        assert get_config_path() == os.fspath(config_path)
        assert get_config_directory() == temp_dir
        assert load_config() == {"value": "default"}
        save_config({"value": "user", "secret": "kept-outside-plugin"})
        assert load_config() == {"value": "user", "secret": "kept-outside-plugin"}
        assert not list(Path(temp_dir).glob(".config-*.tmp"))
    print("plugin_config_runtime test passed")


if __name__ == "__main__":
    main()
