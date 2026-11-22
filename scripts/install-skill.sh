#!/usr/bin/env bash
# scripts/install-skill.sh — 幂等安装 how2build3d skill 到本机 skill 库。
#
# 用法：
#   bash scripts/install-skill.sh --check     # 只校验，不写入（CI/门禁用）
#   bash scripts/install-skill.sh            # 安装（幂等）
#   bash scripts/install-skill.sh --uninstall
#
# 安装策略（双模式 + 可判定状态）：
#   - magpie 库目标（$LIBRARY）：受管**实体拷贝**——rsync 仓库到实体目录（排除 .git/.spec/.zcode/
#     build/evidence/node_modules/sources/skill 与安装元数据）。原因：magpie 只服务实体目录，
#     且其 sync 会清理托管目录里的外来链接；拷贝带 .how2build3d-managed 标记，
#     仓库仍是唯一真源，更新 = 重跑本脚本。
#   - $DSH 目标：符号链接（live，随仓库即时更新）。
#   - --check 判定：受管拷贝缺失 / .how2build3d-version 版本或内容 hash 不一致 /
#     .distill/creation 载荷漂移 / 符号链接缺失或指错 → exit 1 并打印三条恢复路径；
#     magpie library.json 缺失或未登记只告警，不判红（magpie 注册由 magpie 管理）。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SOURCE="$REPO_ROOT"
NAME="how2build3d"
LIBRARY="${HOW2BUILD3D_SKILL_LIBRARY:-$HOME/.config/magpie/library/skills}"
DSH="${HOW2BUILD3D_DSH_SKILLS:-$HOME/.dsh/skills}"
MARKER=".how2build3d-managed"
VERSION_FILE=".how2build3d-version"
EXCLUDED_NAMES=(.git .spec .zcode .maintainer '.env*' .DS_Store build evidence node_modules sources skill "$MARKER" "$VERSION_FILE")
RSYNC_EXCLUDES=()
FIND_EXCLUDES=()
for pattern in "${EXCLUDED_NAMES[@]}"; do
  RSYNC_EXCLUDES+=("--exclude=$pattern")
  FIND_EXCLUDES+=(-name "$pattern" -prune -o)
done

mode="install"
[ "$#" -le 1 ] || { echo "expected at most one mode" >&2; exit 2; }
for arg in "$@"; do
  case "$arg" in
    --check) mode="check" ;;
    --uninstall) mode="uninstall" ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# 三条恢复路径（A3：library.json 缺失/未登记只告警）
# 三条恢复路径始终打到 stdout：--check 的输出既是状态报告，也是恢复手册。
recovery_hint() {
  echo "recovery: 1) bash scripts/install-skill.sh"
  echo "recovery: 2) magpie library sync"
  echo "recovery: 3) Library 页面重新登记 $NAME"
}

fail=0
[ -f "$SOURCE/SKILL.md" ] || { echo "missing $SOURCE/SKILL.md" >&2; fail=1; }
[ -f "$SOURCE/references/00-workflow.md" ] || { echo "missing references/00-workflow.md" >&2; fail=1; }
[ -f "$SOURCE/snippets/sky.glsl.mjs" ] || { echo "missing snippets/sky.glsl.mjs" >&2; fail=1; }
if [ "$fail" -ne 0 ]; then exit 1; fi

# 内容 hash：源与安装副本用同一排除清单（排除安装元数据，避免自指漂移）。
content_hash() {
  local base="$1"
  ( cd "$base" && find . "${FIND_EXCLUDES[@]}" -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $1}' )
}

skill_version() {
  sed -n 's/^version:[[:space:]]*//p' "$SOURCE/SKILL.md" | head -1
}

copy_managed() {
  local dest="$1"
  # 拷贝模式：若目标恰好是指向本仓库的旧符号链接，先摘除（rsync 会跟随符号链接写入仓库）。
  if [ -L "$dest" ]; then unlink "$dest"; fi
  mkdir -p "$dest"
  rsync -ac --delete "${RSYNC_EXCLUDES[@]}" "$SOURCE/" "$dest/"
  touch "$dest/$MARKER"
  local version hash
  version="$(skill_version)"
  hash="$(content_hash "$dest")"
  printf 'version=%s\nhash=%s\n' "$version" "$hash" > "$dest/$VERSION_FILE"
}

if [ "$mode" = "check" ]; then
  echo "check: source ok ($SOURCE/SKILL.md)"
  # magpie 注册状态只告警（A3 pick a）
  if [ ! -f "$LIBRARY/library.json" ] || ! grep -q "$NAME" "$LIBRARY/library.json" 2>/dev/null; then
    echo "check: WARNING magpie library.json missing or $NAME not registered" >&2
    recovery_hint
  fi
  dest="$LIBRARY/$NAME"
  if [ -L "$dest" ] || [ ! -d "$dest" ] || [ ! -f "$dest/$MARKER" ] || [ -L "$dest/$MARKER" ] || [ ! -f "$dest/SKILL.md" ]; then
    if [ -L "$dest" ]; then
      echo "check: library target is a legacy symlink → $(readlink "$dest")（重跑 install 升级为受管拷贝）" >&2
    else
      echo "check: library copy missing ($dest)" >&2
    fi
    recovery_hint
    exit 1
  fi
  version="$(skill_version)"
  expected_hash="$(content_hash "$dest")"
  if [ -z "$version" ] || [ ! -f "$dest/$VERSION_FILE" ] || [ -L "$dest/$VERSION_FILE" ] ||
     ! grep -qxF "version=$version" "$dest/$VERSION_FILE" ||
     ! grep -qxF "hash=$expected_hash" "$dest/$VERSION_FILE"; then
    echo "check: version/content hash mismatch ($dest/$VERSION_FILE)" >&2
    recovery_hint
    exit 1
  fi
  # .distill/creation 载荷：必须存在且与源逐文件 hash 一致（F2 pick a）
  if [ ! -f "$dest/.distill/creation/00-index.md" ]; then
    echo "check: .distill/creation payload missing" >&2
    recovery_hint
    exit 1
  fi
  drift="$(rsync -rclpni --delete "${RSYNC_EXCLUDES[@]}" "$SOURCE/" "$dest/")"
  if [ -n "$drift" ]; then
    echo "check: installed payload differs from source: $drift" >&2
    recovery_hint
    exit 1
  fi
  if [ -e "$dest/sources" ] || [ -e "$dest/skill" ]; then
    echo "check: excluded sources/skill present in managed copy" >&2
    recovery_hint
    exit 1
  fi
  echo "check: library copy ok ($dest)"
  if [ -L "$DSH/$NAME" ] && [ "$DSH/$NAME" -ef "$SOURCE" ]; then
    echo "check: dsh symlink ok ($DSH/$NAME -> $SOURCE)"
  else
    echo "check: dsh symlink missing or wrong ($DSH/$NAME)" >&2
    recovery_hint
    exit 1
  fi
  echo "check: $NAME installed OK (version $version)"
  recovery_hint
  exit 0
fi

if [ "$mode" = "uninstall" ]; then
  if [ ! -L "$LIBRARY/$NAME" ] && [ -d "$LIBRARY/$NAME" ] && [ -f "$LIBRARY/$NAME/$MARKER" ] && [ ! -L "$LIBRARY/$NAME/$MARKER" ] && [ ! "$LIBRARY/$NAME" -ef "$SOURCE" ]; then
    rm -rf "$LIBRARY/$NAME"; echo "removed managed copy $LIBRARY/$NAME"
  elif [ -L "$LIBRARY/$NAME" ] && [ "$LIBRARY/$NAME" -ef "$SOURCE" ]; then
    rm -f "$LIBRARY/$NAME"; echo "removed symlink $LIBRARY/$NAME"
  else
    echo "skip (not ours): $LIBRARY/$NAME"
  fi
  if [ -L "$DSH/$NAME" ] && [ "$DSH/$NAME" -ef "$SOURCE" ]; then unlink "$DSH/$NAME"; echo "removed $DSH/$NAME"; else echo "skip (not ours): $DSH/$NAME"; fi
  exit 0
fi

mkdir -p "$LIBRARY" "$DSH"
LIBRARY="$(cd "$LIBRARY" && pwd -P)"
DSH="$(cd "$DSH" && pwd -P)"
dest="$LIBRARY/$NAME"
for target in "$dest" "$DSH/$NAME"; do
  case "$target/" in "$SOURCE/"*) echo "target inside source: $target" >&2; exit 1;; esac
  case "$SOURCE/" in "$target/"*) echo "source inside target: $target" >&2; exit 1;; esac
done
case "$DSH/$NAME/" in "$dest/"*) echo "overlapping skill targets" >&2; exit 1;; esac
case "$dest/" in "$DSH/$NAME/"*) echo "overlapping skill targets" >&2; exit 1;; esac
if [ -L "$dest" ]; then
  [ "$dest" -ef "$SOURCE" ] || { echo "refusing foreign symlink: $dest" >&2; exit 1; }
elif [ -e "$dest" ]; then
  [ -d "$dest" ] && [ -f "$dest/$MARKER" ] && [ ! -L "$dest/$MARKER" ] && [ ! -L "$dest/$VERSION_FILE" ] || { echo "refusing unmanaged target: $dest" >&2; exit 1; }
fi
if [ -e "$DSH/$NAME" ] || [ -L "$DSH/$NAME" ]; then
  [ -L "$DSH/$NAME" ] && [ "$DSH/$NAME" -ef "$SOURCE" ] || { echo "refusing foreign target: $DSH/$NAME" >&2; exit 1; }
fi
copy_managed "$dest"
echo "library copy installed: $LIBRARY/$NAME"

[ -L "$DSH/$NAME" ] || ln -s "$SOURCE" "$DSH/$NAME"
echo "dsh symlink installed: $DSH/$NAME"
echo "installed: $NAME"
