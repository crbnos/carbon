# Golden Record Lineage Validation

## 结论

当前样本的跨系统 lineage 为 `UNLINKED`（不成链）。

- Carbon MES 侧存在一条可验证的生产记录（`JOB-GOLDEN-001`）；
- ERPNext 侧未在本地运行态观测到对应 `Work Order`；
- 本地 Carbon Job 记录 `customFields: {}`、`notes: {}`，`public.job` 也无可用于 ERPNext 关联的确定性外键；
- 因而不能构建“本地可验证”的 `WO -> Job` 映射链路。

## 可追溯证据

1. 本地服务拓扑
   - 运行容器包含 `inbucket`、`kong`、`gotrue`、`redis`、`postgres`、`inngest` 等；
   - 未发现 ERPNext/Frappe 容器或服务。
2. 本地数据库可读证据
   - `public.job` 样本：`customFields` 与 `notes` 均为 `{}`；
   - `public.job` 表未提供 `external* / erp* / workOrder*` 约束型字段；
   - 可观测 jobOperation 及 productionQuantity/productionEvent 仅证明 Carbon 侧执行证据。
3. 规则/映射层检索（只读）
   - 未检出运行时中的 ERPNext connector/同步入口在当前工作树与数据库里有可直接执行证据；
   - 现有 P2 文档已明确：MVP `production-order-mapping.ts` 提供的是“显式 lineage 才合并、否则分离展示”的语义，并未证明真实运行态跨系统抓取链路。

## 机器可读身份结论

- ERP 机器身份：`WO-GOLDEN-001`（本地未观测，无法提供可靠链路）
- MES 机器身份：`JOB-GOLDEN-001`
- `sourceId` 级别 cross-system 关联：`NO_RELIABLE_MAPPING`

## 风险与影响

只把 Carbon 样本作为 Golden Record，会导致：
- 真实业务合并/追踪链无法闭环；
- `Factory OS` 不应展示“ERP↔MES 已闭环”的统一生产订单状态；
- 所有跨系统 UI/决策展示必须保留来源标签与不确定性。
