# Git & worktrees (strict)

- Commit **only** when the user asks. Never amend, force-push, or skip hooks unless explicitly requested.
- Never update `git config`. Never use interactive git (`-i`).
- Do not commit `.env`, credentials, or service-role keys.
- **Worktrees:** default to the main repo checkout (`swamp/`). Do not create Claude worktrees under `.claude/worktrees/` unless the user asks for isolation.
- If a worktree is created: finish the work, ensure commits are on a branch pushed to `origin` (or discarded intentionally), then remove the worktree directory and prune git worktree metadata.
- Orphan worktrees with broken `gitdir:` paths (moved repos) must be deleted, not “fixed in place.”
- Keep `.claude/settings.local.json` and machine-local allowlists out of shared docs; they are local-only.
