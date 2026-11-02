# Notice

pstack by Lauren Tan, MIT License (see `LICENSE`).

Source: https://github.com/cursor/plugins/tree/1b6d44ff26d4e242f4e8f68c391e6d2f7ca16def/pstack
Upstream version: 0.15.20

The files under `skills/` and `agents/` are copied unchanged from that commit. The plugin manifest,
`README.md`, `docs/`, `assets/` and `automations/` are not included.

OpenBot publishes that plugin at commit `1b6d44ff26d4e242f4e8f68c391e6d2f7ca16def` as the skill `pstack`, which installs
each folder of its `skills/` as the skill `pstack-<folder>`. The changes are: names of other pstack
skills in links, commands and mentions start with `pstack-`, `disable-model-invocation` is removed, the
`pstack in OpenBot` section is added to each `SKILL.md`, a skill that names a subagent gets `agents/`, links
to files outside the skills go to the upstream commit, and the index `SKILL.md` is added.
