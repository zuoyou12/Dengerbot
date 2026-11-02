# Dengerbot

[![License](https://img.shields.io/badge/license-PolyForm_Noncommercial_1.0.0-blue.svg)](LICENSE)

Dengerbot is a local-first desktop workspace for persistent AI teammates. It supports Claude Code and deepseek-ai/dsh (DeepSeek Harness), plus custom API endpoints with model discovery. It gives every agent its own workspace and conversation, local queues, file transfers, and an embedded browser.

> [!WARNING]
> Dengerbot is in preview. Agents run with `danger-full-access` and `approvalPolicy: never`. They can read and modify files, run commands, use the network, and control the embedded browser without per-action confirmations after the explicit first-launch consent. Run only agents and tasks you trust, keep backups, and review [Security](#security) before use.

## What works

- Prompt-driven agent creation and editing on desktop, with editable instructions and section review before saving.
- Persistent agents backed by independent Claude and DeepSeek sessions with local workspaces.
- Custom OpenAI-compatible API endpoints with model discovery. This personal build offers DeepSeek; local model scanning is removed.
- Per-agent context monitoring with automatic compaction before long threads exhaust the model window.
- FIFO message queues with pause, resume, cancellation, and crash-safe persistence.
- Optional Computer Use through the `cua-driver` binary.
- Local data storage and privacy-safe diagnostics exports from the settings menu.

Dengerbot is local-first, not offline-only. Claude connects to Anthropic, deepseek-ai/dsh runs locally, visited pages use the network, and installed plugins may connect to their own services.

## Install

Download and run from the [GitHub Releases](https://github.com/zuoyou12/Dengerbot/releases).

## License

PolyForm Noncommercial 1.0.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
