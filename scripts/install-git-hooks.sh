#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf 'Skipping Git hook installation because this directory is not a Git worktree.\n'
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel)"
git_common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
cd "$repo_root"
hooks_path="$git_common_dir/codex-hooks/git-hooks"
mkdir -p "$hooks_path"
for hook_name in pre-commit pre-push; do
  cp "scripts/git-hooks/$hook_name" "$hooks_path/$hook_name"
  chmod 755 "$hooks_path/$hook_name"
done
git config core.hooksPath "$hooks_path"
printf 'Configured Git hooks path: %s\n' "$hooks_path"
