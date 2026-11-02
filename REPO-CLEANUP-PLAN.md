# Dengerbot v0.0.01Preview - GitHub 仓库终极清理计划

## 目标
创建纯净的首次发布版本：GitHub 只保留**可构建的源码**，移除所有开发痕迹、文档、临时文件。

---

## ⚠️ 重要警告

**此操作是破坏性的！** 执行后将：
1. **丢失所有 Git 历史**（commits, branches, PRs 关联信息）
2. 现有 issues 可能失效
3. fork 开发者需要重新 fork

**请务必备份当前工作区后再执行！**

```bash
# 第一步：完整备份（必须！）
tar -czf dengerbot-backup-v$(date +%Y%m%d).tar.gz D:/AI/bot/TeCat/dengerbot/
```

---

## 一、版本调整

### 1.1 package.json 更新
```json
{
  "version": "0.0.01Preview"
}
```

### 1.2 README.md 相关引用
检查并更新版本号引用处

---

## 二、Git 历史重建方案（推荐：方案 A）

### 方案 A：新仓库 + 当前 clean state ✅ **推荐**

**优点：**
- 安全可控
- 历史清晰
- 易于回退

**步骤：**

```bash
cd D:/AI/bot/TeCat/dengerbot

# 1. 备份
cp -r . ..\dengerbot-backup-pre-clean/

# 2. 删除不需要的文件（暂不 git rm，先手动处理）
rm -rf CHANGELOG.md
rm -f _cdp.mjs _cdp2.mjs _css-clean.py _css-clean2.py start-tecat.cmd
# plans/changelog.d/.local-work 保持现状（git rm --cached 会处理）

# 3. 重置 Git
git reset --hard HEAD
git clean -fdx

# 4. 创建新的初始 commit
git init
git add \
  README.md \
  AGENTS.md \
  LICENSE \
  NOTICE \
  THIRD_PARTY_NOTICES.md \
  CLA.md \
  CONTRIBUTING.md \
  CODE_OF_CONDUCT.md \
  SECURITY.md \
  PRIVACY.md \
  electron-builder.yml \
  package.json \
  bun.lock \
  tsconfig*.json \
  vitest.config.ts \
  scripts/*.ts \
  scripts/**/*.ts \
  src/**/* \
  packages/**/* \
  resources/**/* \
  build/**/* \
  .githooks/* \
  .github/**/* \
  tools/**/* \
  remote/**/*

git commit -m "Initial release v0.0.01Preview

Core source code and build configuration only.
All development records, docs, and test fixtures removed for clean release."

git branch -M main

# 5. 推送（替换远程仓库）
git remote set-url origin https://github.com/zuoyou12/Dengerbot.git
git push -u --force origin main
```

---

## 三、文件筛选清单

### ✅ 保留文件（进入新仓库）

| 类别 | 内容 |
|------|------|
| **文档** | README.md, AGENTS.md, LICENSE, NOTICE, THIRD_PARTY_NOTICES.md, CLA.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, PRIVACY.md |
| **配置** | package.json, bun.lock, electron-builder.yml, tsconfig*.json, vitest.config.ts, biome.json, knip.config.ts |
| **源码** | src/**/* (backend, main, preload, renderer), packages/**/* (contracts, ui, brand, i18n, logging) |
| **脚本** | scripts/*.ts (build/install/package/release), scripts/**/*.ts (helper utilities) |
| **资源** | resources/**/* (icons, plugins, catalog), build/**/* (electron builder configs) |
| **CI** | .github/**/* (workflows, templates, reviews), .githooks/* |
| **工具** | tools/**/* (biome, ui-foundation, vitest) |
| **其他** | remote/**/* (Signal server), CHANGELOG.d/README.md (格式说明) |

### ❌ 删除文件（不进入新仓库）

| 类别 | 内容 |
|------|------|
| **变更记录** | CHANGELOG.md, changelog.d/*.md |
| **开发计划** | plans/*.md |
| **任务清单** | TASKS.md |
| **临时脚本** | _cdp.mjs, _cdp2.mjs, _css-clean.py, _css-clean2.py, start-tecat.cmd, start-dengerbot.cmd |
| **本地数据** | .local-work/, .openbot-build/, .openbot/, dev-launch.log |
| **测试代码** | *.test.ts, *.dom.test.ts, */fixtures/ (保留测试逻辑但在 CI 运行，不上传) |
| **生成交付** | apps/mobile/src/features/marketplace/model/plugin-catalog.generated.ts |
| **架构文档** | docs/architecture/*.md (除 STRUCTURE.md 外)，docs/TROUBLESHOOTING.md |

---

## 四、验证清单

执行前逐项确认：

- [ ] package.json version = "0.0.01Preview"
- [ ] README.md 包含最新构建命令
- [ ] AGENTS.md 保留（作为唯一开发指导）
- [ ] LICENSE/NOTICE 存在（许可证合规）
- [ ] electron-builder.yml 配置正确
- [ ] packages/*/package.json 依赖完整
- [ ] scripts/中有必要的构建脚本
- [ ] tests/目录被明确排除（或彻底删除）
- [ ] No .test.ts files in source tree

---

## 五、推送后检查

```bash
# 1. 确认远程仓库文件数
git ls-files | wc -l  # 预期：< 1000 (原为 4431)

# 2. 检查关键文件
git ls-files | grep -E '(src/|packages/|README|LICENSE|AGENTS)' | head -20

# 3. 确认无敏感文件
git ls-files | grep -E '(plans|changelog\.d|TASKS|\._cdp|\.local-work)' && echo "ERROR: sensitive files found!"

# 4. 尝试干净安装
cd /tmp
git clone https://github.com/zuoyou12/Dengerbot.git dengerbot-clean-test
cd dengerbot-clean-test
bun install
bun run typecheck:node  # 应通过
```

---

## 六、风险评估与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 误删必要文件 | 低 | 高 | 预先列出清单；备份充分 |
| 构建失败 | 中 | 高 | 提前在隔离环境测试 `bun install && bun run build` |
| Git 历史丢失 | 确定 | 中 | 告知团队；fork 开发者需重新 fork |
| Issue/PR 断裂 | 确定 | 低 | 迁移到新版本号对应分支 |
| 许可证问题 | 低 | 高 | 确保 LICENSE/NOTICE 完整保留 |

---

## 七、执行时间表建议

1. **Day 1**: 备份 + 方案评审 + 团队通知
2. **Day 2**: 在隔离 VM 执行并验证
3. **Day 3**: 正式执行推送 + 更新 Release 页面
4. **Day 4**: 监控反馈 + 修复遗漏问题

---

## 八、决策点

### 用户需在以下选项中做选择：

**选项 A（推荐）**：按本计划执行，完全清空 Git 历史，创建全新的初始 commit

**选项 B**：保留部分历史记录（如最近 3 个月），使用 `git filter-repo --since="3 months ago"`

**选项 C**：不修改 Git 历史，仅添加 `.gitignore` 拒绝提交新增的开发文件，让现有 tracked 文件逐步过期

---

## 九、下一步行动

1. ✅ 备份当前工作区到 `..\dengerbot-backup-pre-clean/`
2. ✅ 审阅本计划的"文件筛选清单"，确认无误
3. ✅ 选择 A/B/C 方案
4. ⏸️ **等待用户确认后再执行任何 git 命令**
5. ⏸️ 执行确认后，立即推送并创建首个 Release v0.0.01Preview

---

*计划生成时间：2026-11-02*
*版本目标：v0.0.01Preview*
