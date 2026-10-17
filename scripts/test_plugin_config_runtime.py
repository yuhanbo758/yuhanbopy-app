import os
import sys
import tempfile
import json
import subprocess
import importlib.util
import shutil
from unittest.mock import patch
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, os.fspath(PROJECT_ROOT / "app"))

from plugin_config_runtime import get_config_directory, get_config_path, load_config, save_config, initialize_config


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
        root = Path(temp_dir)
        plugin = root / 'install' / 'app' / 'software' / 'sample_plugin'
        plugin.mkdir(parents=True)
        (plugin.parents[1] / 'plugin_config_runtime.py').write_text('# host marker', encoding='utf-8')
        template = plugin / 'config.json'
        template.write_text('{"token":""}', encoding='utf-8')
        appdata = root / 'appdata'
        settings = appdata / 'yuhanbopy-app' / 'settings.json'
        settings.parent.mkdir(parents=True)
        private = root / 'private'
        settings.write_text(json.dumps({'customPluginConfigDir': str(private)}), encoding='utf-8')
        with patch.dict(os.environ, {'APPDATA': str(appdata), 'PATH': os.environ.get('PATH', ''),
                                     'SYSTEMROOT': os.environ.get('SYSTEMROOT', '')}, clear=True):
            assert initialize_config(plugin) == str(private / 'sample_plugin.json')
            save_config({'token': 'fixture-only'})
            assert template.read_text(encoding='utf-8') == '{"token":""}'
            assert initialize_config(plugin) == str(private / 'sample_plugin.json')
            assert load_config() == {'token': 'fixture-only'}
            Path(get_config_path()).write_text('broken json', encoding='utf-8')
            try:
                load_config()
                raise AssertionError('损坏配置必须报错')
            except json.JSONDecodeError:
                pass
            assert Path(get_config_path()).read_text(encoding='utf-8') == 'broken json'
        with patch.dict(os.environ, {'APPDATA': str(root / 'empty-appdata'),
                                     'PATH': os.environ.get('PATH', ''), 'SYSTEMROOT': os.environ.get('SYSTEMROOT', '')}, clear=True):
            expected = root / 'install' / 'plugin-configs' / 'sample_plugin.json'
            assert initialize_config(plugin) == str(expected)
            # 加载备份插件真实 utils，但仅传入临时用户文件；不启动 GUI、定时或网络。
            spec = importlib.util.spec_from_file_location('backup_utils_test', PROJECT_ROOT / 'app/software/sanrenjz-python-loc_cos_backup/utils.py')
            if Path(spec.origin).exists():
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                module.save_config({'secret': 'fixture-only'})
                assert module.load_config() == {'secret': 'fixture-only'}
                assert Path(module.LOG_FILE).is_relative_to(expected.parent)
        repo = root / 'git-repo'
        repo.mkdir()
        subprocess.run(['git', 'init', str(repo)], check=True, capture_output=True)
        standalone = repo / 'standalone_backup'
        standalone.mkdir()
        shutil.copy2(PROJECT_ROOT / 'app/plugin_config_runtime.py', standalone)
        backup_utils = PROJECT_ROOT / 'app/software/sanrenjz-python-loc_cos_backup/utils.py'
        if backup_utils.exists():
            shutil.copy2(backup_utils, standalone)
            (standalone / 'config.json').write_text('{"initial":true}', encoding='utf-8')
            env = dict(os.environ)
            for key in ('YUHANBOPY_PLUGIN_CONFIG_FILE', 'YUHANBOPY_PLUGIN_CONFIG_DIR', 'PYTHONPATH'):
                env.pop(key, None)
            env['APPDATA'] = str(root / 'standalone-appdata')
            probe = (
                "from pathlib import Path; import utils; "
                "assert Path(utils.CONFIG_FILE) == Path.cwd() / 'config.json'; "
                "assert utils.load_config() == {'initial':True}; "
                "utils.save_config({'password':'test-only'}); "
                "assert utils.load_config() == {'password':'test-only'}; "
                "assert utils.initialize_config(Path.cwd()) == utils.CONFIG_FILE"
            )
            subprocess.run([sys.executable, '-c', probe], cwd=standalone, env=env, check=True, capture_output=True)
            subprocess.run(['git', '-C', str(repo), 'check-ignore', str(standalone / 'config.json')], check=True, capture_output=True)
            assert not subprocess.check_output(['git', '-C', str(repo), 'ls-files', '--', str(standalone / 'config.json')])
            # 即使主程序未运行，只要保存过自定义目录，独立包也优先读取该配置。
            saved_settings = Path(env['APPDATA']) / 'yuhanbopy-app/settings.json'
            saved_settings.parent.mkdir(parents=True)
            saved_settings.write_text(json.dumps({'customPluginConfigDir': str(root / 'configured-private')}), encoding='utf-8')
            before_local = (standalone / 'config.json').read_bytes()
            probe = (
                "from pathlib import Path; import utils; "
                "assert Path(utils.CONFIG_FILE).parent.name == 'configured-private'; "
                "utils.save_config({'source':'configured'}); "
                "assert utils.load_config() == {'source':'configured'}"
            )
            subprocess.run([sys.executable, '-c', probe], cwd=standalone, env=env, check=True, capture_output=True)
            assert (standalone / 'config.json').read_bytes() == before_local
        for name in ('plugin-configs', '自定义配置'):
            with patch.dict(os.environ, {'YUHANBOPY_PLUGIN_CONFIG_FILE': str(repo / name / 'sample_plugin.json'),
                                         'YUHANBOPY_PLUGIN_CONFIG_DIR': str(repo / name)}):
                initialize_config(plugin)
                subprocess.run(['git', '-C', str(repo), 'check-ignore', str(repo / name / 'sample_plugin.json')],
                               check=True, capture_output=True)
    print("plugin_config_runtime test passed")


if __name__ == "__main__":
    main()
