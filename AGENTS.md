# AGENTS.md - Operational Rules for Agents

## 🛡️ Mandatory Git Best Practices
These rules are non-negotiable and enforced by Husky hooks.

1. **Every commit must be tracked by an individual PR.**
2. **NEVER git push to remote 'main' directly.** (Note: This repo currently uses `master` as its primary branch).
3. **NEVER git commit on local primary branch directly.**
4. **Master Sync Rule**: Always pull the latest primary branch before starting a new feature branch.
5. **Optimistic 10-Minute Merge**: Once a PR is created and CI is green, agents MUST wait at least 10 minutes for human intervention before merging.

## 🤖 Autonomous Operations Script
Agents SHOULD use automation scripts to manage the development lifecycle.

## The Non-Negotiable "Gate"
Every task MUST pass the Gate before it is considered complete. No exceptions.
The Gate command for this repository is:
`npm run lint` followed by `npm run build`

## Atomic Agentic Committing
- One logical change per commit.
- Agents should commit early and often once the Gate passes.
- Use descriptive commit messages following Conventional Commits.

## Closing the Loop
1. **Identify**: Read the task/issue.
2. **Execute**: Modify the code.
3. **Verify (The Gate)**: Run the Gate. If it fails, fix and repeat until it passes.
4. **Wait**: Observe the 10-minute optimistic window.
5. **Merge**: Execute squash-merge.

## Workspace Structure
- `memory/`: Daily logs (`YYYY-MM-DD.md`).
- `MEMORY.md`: Long-term curated memory.
- `ACTIVE_TASKS.md`: Orchestration of current work.
- `docs/postmortem/`: Incident reports and learnings.
