---
name: pstack-principle-guard-the-context-window
description: "Apply when context is filling up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents; keep summaries in the main thread, not raw payloads."
---

# Guard the Context Window

**Why:** Context overflow degrades reasoning quality, creates compression artifacts, and halts progress.

**Pattern:**
- **Size phases and cap scope.** Limit files per phase, set turn budgets, account for mechanism costs.

## pstack in OpenBot

- This skill is part of pstack. OpenBot installs each pstack skill as its own skill: the skill `<name>` is `pstack-<name>`. A principle `<name>` is `pstack-principle-<name>`. Call a skill with `$pstack-<name>`.
- The license and notice are in `../pstack/LICENSE` and `../pstack/NOTICE.md`.
