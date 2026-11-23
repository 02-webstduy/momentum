# AGENTS.md — 仓库协作规则

本文件只约束本仓库的提交与文档工作流；产品与架构规则见工作区级 AGENTS.md。

## 提交规范（每次修改必做）

1. 完成一批修改后立即提交：按改动主题拆分 commit，中文、简洁、一句话能懂，前缀用 feat / fix / chore / docs。
2. 每个 commit 只含相关文件；`node_modules`、`dist` 等由 `.gitignore` 排除，不入库。
3. 提交后立即推送到 origin main，保证 GitHub 与本地一致。
4. 涉及框架或信息流变化的批次，在 `docs/` 输出改动说明文档（聚焦架构与信息流动，不贴大段代码）。
