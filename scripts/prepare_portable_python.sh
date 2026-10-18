#!/usr/bin/env bash
set -euo pipefail

platform="${1:-}"
version="3.12.8"
release_tag="20241206"

case "$platform" in
  macos)
    target_triple="x86_64-apple-darwin"
    expected_sha256="3ba35c706577d755e8e52a4c161a042464577c0e695e2a605362fa469e26de10"
    ;;
  linux)
    target_triple="x86_64-unknown-linux-gnu"
    expected_sha256="b9d6ee5ddac1198e72d53112698773fc8bb597de095592eb849ca794306699ba"
    ;;
  *)
    echo "Usage: $0 <macos|linux>" >&2
    exit 2
    ;;
esac

project_root="$(cd "$(dirname "$0")/.." && pwd)"
target_root="$project_root/python/python-${version}-${platform}-x64"
archive_name="cpython-${version}+${release_tag}-${target_triple}-install_only.tar.gz"
download_url="https://github.com/astral-sh/python-build-standalone/releases/download/${release_tag}/${archive_name}"
temp_root="$(mktemp -d)"
trap 'rm -rf "$temp_root"' EXIT
archive_path="$temp_root/$archive_name"

echo "[prepare-portable-python] Downloading $download_url"
curl --fail --location --retry 3 --output "$archive_path" "$download_url"
if command -v sha256sum >/dev/null 2>&1; then
  actual_sha256="$(sha256sum "$archive_path" | awk '{print $1}')"
else
  actual_sha256="$(shasum -a 256 "$archive_path" | awk '{print $1}')"
fi
if [[ "$actual_sha256" != "$expected_sha256" ]]; then
  echo "SHA-256 mismatch: expected $expected_sha256, got $actual_sha256" >&2
  exit 1
fi

# 下载和校验成功后才替换运行时；只保留当前平台，防止把其他平台解释器带入安装包。
rm -rf \
  "$project_root/python/python-${version}-embed-amd64" \
  "$project_root/python/python-${version}-macos-x64" \
  "$project_root/python/python-${version}-linux-x64"
mkdir -p "$target_root"
tar -xzf "$archive_path" -C "$target_root" --strip-components=1
python_executable="$target_root/bin/python3"
test -x "$python_executable"

"$python_executable" -m ensurepip --upgrade
"$python_executable" -m pip install --upgrade pip
if [[ -f "$project_root/python/requirements.txt" ]]; then
  "$python_executable" -m pip install -r "$project_root/python/requirements.txt"
fi

# Tcl() 不需要图形显示，但能验证 tkinter 及随包 Tcl 资源可在移动后的目录中加载。
PYTHONHOME="$target_root" "$python_executable" - <<'PY'
import json
import pathlib
import sys
import tkinter

print(json.dumps({
    "executable": sys.executable,
    "prefix": sys.prefix,
    "version": sys.version.split()[0],
    "tcl": tkinter.Tcl().eval("info patchlevel"),
}))
assert pathlib.Path(sys.executable).is_file()
assert sys.version_info[:3] == (3, 12, 8)
PY

echo "[prepare-portable-python] Runtime ready at $target_root"
