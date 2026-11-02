# Third-party notices

Preset content shipped with the marketplace catalog. Each source keeps its license file beside the
copied material.

## Z.ai zcode built-in plugins

- Source: https://github.com/… (local clone at `D:\AI\bot\refs\zcode`, Apache-2.0) — the
  `superpowers`, `documents`, `pdf`, `spreadsheets`, `presentations`, `skill-creator` and
  `visualize` catalog plugins package those plugins' `skills/` folders (renamed to the pack
  convention), without their plugin runtime code or CDN branding. Keep the Apache-2.0 license
  notices of the copied skills when redistributing.

## Anthropic skills (anthropics/skills)

- Source: https://github.com/anthropics/skills — the `anthropic-web`, `anthropic-mcp-builder`,
  `anthropic-creative`, `anthropic-comms` and `anthropic-claude-api` catalog plugins package the
  repository's Apache-2.0 "example skills" (renamed to the pack convention). The document skills
  (`docx`, `pdf`, `pptx`, `xlsx`) are source-available, not open source, and are deliberately NOT
  redistributed. Per the repository README: "Many skills in this repo are open source (Apache 2.0)."

## Model Context Protocol reference servers

- Source: https://github.com/modelcontextprotocol/servers (MIT) — the `mcp-everything`,
  `mcp-memory` and `mcp-sequential-thinking` catalog apps wrap the official reference servers,
  which the app installs and runs locally through `npx`.

## uiverse-io/galaxy (inspiration)

- Source: https://github.com/uiverse-io/galaxy — MIT. The marketplace skeleton shimmer adapts the
  technique of the `loaders/vk-uiux_neat-goat-26.html` element by vk-uiux (via Uiverse.io).

## PSTACK

- Source: `marketplace/production-catalog/bundles/pstack/` (in-repo), redistributed as the `pstack`
  catalog plugin with child skills renamed `pstack-<name>`.
- License: see `marketplace/production-catalog/licenses/`.

## ego-browser (managed skill, not a catalog plugin)

- Source: https://github.com/CitroLabs/ego-lite (`skills/ego-browser`), MIT.
- © 2026 CitroLabs. Already integrated as a managed skill in `resources/managed-skills/`; the
  marketplace lists it only as installed-by-default content.

## Provider logos from Magpie / LobeHub Icons

The SVG provider logos in `packages/ui/src/assets/provider-icons/` are copied from Magpie's
`internal/gui/assets/icons/`. Magpie identifies LobeHub Icons as their source in `docs/reference.md`.
Both projects use the MIT license; copies are beside the assets (`LICENSE.magpie`,
`LICENSE.lobe-icons`). Provider names and marks identify their respective services.
Upstream: https://github.com/lobehub/lobe-icons

## Subscription plugin directory and logos

The offline provider-plugin directory in `packages/contracts/src/subscription-catalog.ts` is
adapted from the MIT-licensed Magpie community registry. It contains provider identities and
descriptions only; installed versions, sign-in methods, models and account usage are read from
the installed plugins. Non-provider middleware, agent, tool and page plugins are excluded.
Source: https://github.com/magpie-community/plugins/blob/main/registry.json

The bundled subscription marks in `packages/ui/src/assets/subscription-icons/` are copied from
Magpie's `internal/gui/assets/icons/`, with MIT notices in `LICENSE.magpie` and
`LICENSE.lobe-icons`. The registry's notice is retained as `LICENSE.magpie-community` in the
same folder. Vendor names and marks identify the corresponding services. Downloaded plugins
retain their own package licenses and are not relicensed by Dengerbot.
