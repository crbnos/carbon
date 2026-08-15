# Golden Record Quantity Decision

## 结论

`completedQuantity` 当前 **不应** 定义为 `job.quantityComplete`。

本地样本存在 `1:1:0` 形态，且没有来自 ERPNext 的 produced_qty/确认状态，
所以将 `completedQuantity = job.quantityComplete` 会错误地将订单标记为“已完成 0%/0/100%”或混淆执行层级，违背
`operation / job / aggregate` 的不同语义。

## 已有约束与实测

1. 聚合层面
   - 订单层 aggregate：`job.quantity = 1`
   - 操作层完成：`jobOperation.quantityComplete = 1`（已完成一条操作）
   - 订单层 job 完成量：`job.quantityComplete = 0`
   - 直接将 job 完成量映射为 canonical completedQuantity 会违反语义分层。

2. 数据质量与权威
   - ERPNext 与该订单的 produced_qty 在本地未观测；
   - Carbon MES 侧仅保证原始字段，不具备跨系统权威裁决能力；
   - 因此 canonical 已完成量仍处于 `REQUIRES_DOMAIN_CONFIRMATION`。

3. 回归覆盖（与映射 MVP）
   - 已有 `C` 夹具（`Aggregate=1, Operation=1, Job=0`）与测试保持一致：不推导 canonical 百分比；
   - 现有 `prod-order-mapping` 测试包含 1/1/0 场景，验证不会直接用 `job.quantityComplete` 作为完成率。

## 建议定义（当前阶段）

| 项目 | 建议 |
|---|---|
| Canonical `completedQuantity` | `UNDEFINED`（当前阶段） |
| Canonical `progressPercent` | `UNDEFINED`（当前阶段） |
| 可展示值 | 保留 `source.label` 的 `job.quantityComplete=0`、`operationCompletedQuantity=1`、`productionQuantity=1` |
| Domain owner 下一步决策问题 | `completedQuantity` 的权限来源是 ERPNext 计划层（`produced_qty`）还是 MES 层聚合（`jobOperation.quantityComplete`）的哪一个？ |

## Domain Owner 明确问题（待确认）

请确认后续 `completedQuantity` 的权威规则：
- 采用 ERPNext `produced_qty`（若能稳定采集）；
- 采用 Carbon MES 的 operation 级聚合；
- 采用按单位与业务阶段分层的双值策略（`operationCompleted` 与 `jobQuantityComplete` 并列显示），并在 UI 强制保留来源标签。
