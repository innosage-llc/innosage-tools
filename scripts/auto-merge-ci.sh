#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
./scripts/run-local-ci.sh "$@"
pr_number="$(gh pr view --json number -q .number 2>/dev/null || true)"
if [[ -z "$pr_number" ]]; then pr_number="$(gh pr list --state open --search "$(git rev-parse HEAD)" --json number -q '.[0].number')"; fi
pr_state="$(gh pr view "$pr_number" --json state -q .state)"
[[ "$pr_state" == "OPEN" ]] || { printf 'PR #%s is %s; nothing to merge.\n' "$pr_number" "$pr_state"; exit 0; }
gh pr merge "$pr_number" --squash --delete-branch
