---
name: pstack-principle-laziness-protocol
description: "Apply when refactoring, evaluating diff size, or tempted to add abstractions, layers, or signal threading. Bias toward deletion and the smallest change that solves the problem."
---

# Laziness Protocol

- **Consolidate decisions.** Do not repeat the same choice in several places. Put it behind one source of truth and pass the result as a simple flag.
- **Minimize the diff.** Make the smallest change that solves the problem. Fewer lines beat "elegant" boilerplate.

## pstack in OpenBot

- This skill is part of pstack. OpenBot installs each pstack skill as its own skill: the skill `<name>` is `pstack-<name>`. A principle `<name>` is `pstack-principle-<name>`. Call a skill with `$pstack-<name>`.
- The license and notice are in `../pstack/LICENSE` and `../pstack/NOTICE.md`.
