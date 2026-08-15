# Golden Record vs Fixture Comparison

## 目标

确认 3 个现有 Fixture 与本地 Golden Record 语义是否一致，仅保留证据级别的断言，避免把 sandbox fixture 当成实时 ERPNext 记录。

## 样本定义

- Golden Record：`JOB-GOLDEN-001`（本地 `public.job.jobId = FOS-P11C0B-001`）
- Fixture A：`normalLinked`（ERP Work Order + 显式确认 lineage + Carbon Job）
- Fixture B：`partialCompletion`（planned 10 / execution 4 / operation complete 4）
- Fixture C：`quantityRegression`（aggregate 1 / operation 1 / job 0）

## 对照表

| 对比项 | A `normalLinked` | B `partialCompletion` | C `quantityRegression` | Golden Record `JOB-GOLDEN-001` |
|---|---|---|---|---|
| 真实系统关联链 | 仅用于语义合约，非真实运行态 | 不适用（合成示例） | 不适用（合成示例） | **本地仅碳端，有效但未与 ERPNext 闭环** |
| 计划与执行 | 明确分层，确认后可 merge | 仅语义示例 | 仅语义示例 | 计划=1、执行来源=job 与 productionQuantity=1 |
| 关键回归 `1/1/0` | 不构成回归场景 | 不构成回归场景 | 专门覆盖：`1/1/0` | 覆盖：aggregate=1、operation=1、job=0 |
| 结论 | **A 的闭环结论不能替代现实观测** | **B 的数值结构与现实不一致** | C 的语义与现实的 `1/1/0` 一致 | C 语义在现实中被复核，但仍缺 ERP/碳端显式外键 |
| 可用性（P2） | 可用于合约行为测试 | 可用于测试行为边界 | 可用于回归保护 | 可用于“真实执行样本”验证，但不用于跨系统身份确认 |

## 结论

真实 Golden Record 与 `quantityRegression` 一致，但不应把它升级为
`ERP Work Order ↔ Carbon Job` 的可靠联合身份。跨系统绑定仍需额外确认证据。
