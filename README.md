# 钢结构焊缝台账、无损检测和返修闭环平台

源提示词编号：13。覆盖构件与图纸焊缝台账、二维定位、焊工资质和检测比例预警、批量检测计划、缺陷记录、返修/复检状态、Apollo GraphQL 数据层、版本快照、签字锁定和完整追溯。

## 技术栈

Angular、PrimeNG、NgRx、Angular Router、RxJS、Apollo Angular、GraphQL、TypeScript。

## 运行

```bash
npm install
npm run dev
```

开发地址：http://localhost:62056

```bash
npm run build
```

## 焊工资质版本化（资质生效台）

`src/app/domain/` 为不依赖框架的纯领域层（`qualification.engine.ts`）+ Angular signal 状态封装（`qualification.store.ts`）：

- **按作业日生效的资格版本**：证书是带 `effectiveFrom/effectiveTo` 与方法覆盖的版本链；检测计划在作业日只取当天有效版本（到期日当天仍有效，次日失效）。
- **更新即时冲销**：换证（携带被替换旧证 id，旧证置废）后所有未完成计划立即重算，无有效证书者转「已失效待重排」并附原因；**已完成计划冻结完成时的依据快照**（证书号 + 资质链序号上界），永不变更。
- **双端并发裁决**：以服务端单调序号裁决，先到版本生效、旧证置废；后到内容以「冲突搁置」原文留存，不触发重算，可人工采纳/驳回留痕；完全相同内容重复提交幂等。
- **追溯包**：按业务范围生成幂等键，重复导出命中同一包、记录不多；导出失败可按包号恢复，恢复只追加流水、记录数与既定范围一致。

入口页面：「资质生效台」（路由 `/qualification`）。领域规则自测：

```bash
npm run selftest
```
