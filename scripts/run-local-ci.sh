#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
command -v gh >/dev/null 2>&1 || fail "GitHub CLI (gh) is required."
gh auth status >/dev/null 2>&1 || fail "Authenticate GitHub CLI with: gh auth login"

resolve_pr() {
  PR_NUMBER="$(gh pr view --json number -q .number 2>/dev/null || true)"
  if [[ -z "$PR_NUMBER" ]]; then
    head_sha="$(git rev-parse HEAD)"
    PR_NUMBER="$(gh pr list --state open --search "$head_sha" --json number -q '.[0].number' 2>/dev/null || true)"
  fi
  [[ -n "$PR_NUMBER" ]] || fail "No open pull request found for this checkout."
  PR_URL="$(gh pr view "$PR_NUMBER" --json url -q .url)"
  PR_STATE="$(gh pr view "$PR_NUMBER" --json state -q .state)"
  REMOTE_BRANCH="$(gh pr view "$PR_NUMBER" --json headRefName -q .headRefName)"
  BASE_BRANCH="$(gh pr view "$PR_NUMBER" --json baseRefName -q .baseRefName)"
}

resolve_pr
[[ "$PR_STATE" == "OPEN" ]] || { printf 'PR #%s is %s; nothing to validate.\n' "$PR_NUMBER" "$PR_STATE"; exit 0; }
current_branch="$(git branch --show-current)"
[[ "$current_branch" != "$BASE_BRANCH" ]] || fail "Run this gate from a PR branch, not $BASE_BRANCH."
[[ -z "$(git status --porcelain)" ]] || fail "Commit or stash local changes before running the gate."
git fetch origin "$REMOTE_BRANCH" "$BASE_BRANCH" >/dev/null
[[ "$(git rev-parse HEAD)" == "$(git rev-parse "origin/$REMOTE_BRANCH")" ]] || fail "Local HEAD is not synchronized with origin/$REMOTE_BRANCH."
if ! git merge-base --is-ancestor "origin/$BASE_BRANCH" HEAD; then
  git merge "origin/$BASE_BRANCH" --no-edit || { git merge --abort 2>/dev/null || true; fail "Resolve base-branch conflicts manually."; }
  git push origin "HEAD:$REMOTE_BRANCH"
fi

printf '\n==> Install locked dependencies\n'
if [[ ! -x node_modules/.bin/oxlint ]]; then
  npm ci
fi
printf '\n==> InnoSage Tools authoritative gate\n'
bash scripts/gatekeeper.sh
gh pr comment "$PR_NUMBER" --body "### ✅ Local CI passed\n\nCommit: \`$(git rev-parse --short HEAD)\`\n\n_Run via \`./scripts/run-local-ci.sh\`._" >/dev/null || true
printf '\nLocal CI passed for PR #%s: %s\n' "$PR_NUMBER" "$PR_URL"
