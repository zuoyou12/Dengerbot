---
name: pstack-principle-outcome-oriented-execution
description: "Apply during planned rewrites and migrations with explicit phase boundaries. Converge on the target architecture; don't preserve smooth intermediate states with throwaway compatibility code."
---

# Outcome-Oriented Execution

Optimize for the intended, verifiable end state rather than preserving smooth intermediate states.

**Why:** Keeping every intermediate step fully stable often creates temporary compatibility code that becomes long-lived debt. Converge on the target architecture and prove correctness at explicit verification boundaries.

**Core rule:**
- Prioritize end-state integrity over transitional stability
- Intermediate breakage is acceptable when it is planned, scoped, and reversible

**Guardrails:**
- Use this for planned rewrites and migrations with explicit phase boundaries
- Declare where temporary breakage is acceptable
- Keep high-signal checks for actively touched areas while migrating
- Require full static and runtime verification at plan completion

## pstack in OpenBot

- This skill is part of pstack. OpenBot installs each pstack skill as its own skill: the skill `<name>` is `pstack-<name>`. A principle `<name>` is `pstack-principle-<name>`. Call a skill with `$pstack-<name>`.
- The license and notice are in `../pstack/LICENSE` and `../pstack/NOTICE.md`.
