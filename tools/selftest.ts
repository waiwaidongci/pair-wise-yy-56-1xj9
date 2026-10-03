/**
 * 领域引擎自测：node 直接运行（commonjs 编译后）。
 * 覆盖：按作业日取证书、资质更新即时失效重算、已完成结论保留、
 * 双端并发先到生效/后到留冲突、重复内容幂等、追溯包失败按包号恢复、重复导出不增记录。
 */
import {
  completePlan,
  evaluateBasis,
  exportTracePackage,
  qualificationOn,
  recalculatePlan,
  restoreTracePackage,
  submitQualification,
} from '../src/app/domain/qualification.engine'
import { seedPlans, seedVersions, seedWelds } from '../src/app/domain/seed'
import type { InspectionPlan, QualificationVersion } from '../src/app/domain/types'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name} ${detail}`)
  }
}
function eq<T>(name: string, actual: T, expected: T) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

const now = '2026-10-03T09:00:00'
let versions: QualificationVersion[] = [...seedVersions]
let plans: InspectionPlan[] = seedPlans.map((p) => ({ ...p }))

console.log('1) 计划当天只看当天有效的证书')
check('10-01（到期日当天）旧证仍有效', qualificationOn(versions, 'H-09', 'SMAW', '2026-10-01')?.id === 'Q-4')
check('10-02 旧证已失效', qualificationOn(versions, 'H-09', 'SMAW', '2026-10-02') === null)
check('10-03（作业日）无有效证书', qualificationOn(versions, 'H-09', 'SMAW', '2026-10-03') === null)
check('方法不覆盖也判定无效', qualificationOn(versions, 'H-03', 'SMAW', '2026-10-03') === null)
check('方法通配符 * 覆盖全部', qualificationOn(versions, 'H-01', 'SMAW', '2026-10-03')?.id === 'Q-1')
const basis1003 = evaluateBasis(seedWelds, versions, ['W-109', 'W-101'], '2026-10-03')
eq('W-109 依据无效 / W-101 依据有效', basis1003.map((b) => b.valid), [false, true])

console.log('2) 资质一更新，未完成计划立即失效并重算')
// 孙鹏换新证，10-02 起生效（替换 10-01 到期的旧证 Q-4）
const r1 = submitQualification(
  { versions, conflicts: [], plans, welds: seedWelds },
  { welderId: 'H-09', certNo: 'GX-2026-1002', standard: 'GB/T 9448', methods: ['SMAW'], effectiveFrom: '2026-10-02', effectiveTo: '2028-10-01', source: 'pc', seq: 5, replacesQualificationId: 'Q-4' },
  now,
)
eq('先到版本被接受', r1.outcome, { kind: 'accepted', versionId: 'Q-5' })
check('旧证 Q-4 被置废', r1.versions.find((q) => q.id === 'Q-4')?.status === '作废')
check('换证事件记录被替换旧证', r1.events[0].supersededQualificationId === 'Q-4')
versions = r1.versions
plans = r1.plans
const p1003 = plans.find((p) => p.id === 'IP-2026-1003-A')!
const p1008 = plans.find((p) => p.id === 'IP-2026-1008-C')!
check('今日未完成计划重算后恢复有效', p1003.lifecycle === '有效' && p1003.invalidReason === undefined)
check('未来未完成计划一并重算恢复', p1008.lifecycle === '有效')
eq('事件记录被影响计划', r1.events[0].invalidatedPlanIds, [])

console.log('3) 换新证前的反向场景：旧证有效时的计划在证书注销后立即失效')
// 构造一个未完成计划在证书有效期内，再提交一本不覆盖该方法的版本不影响；
// 直接验证 recalculatePlan：删除/置废后计划转失效
const versionsWithoutOld = versions.filter((q) => q.id !== 'Q-4' && q.id !== 'Q-5')
const freshPlan: InspectionPlan = { id: 'IP-X', date: '2026-10-10', method: 'SMAW', weldIds: ['W-109'], inspector: '陈锋', state: '待执行', lifecycle: '有效', calculatedAt: now }
const recalced = recalculatePlan(freshPlan, seedWelds, versionsWithoutOld, now)
check('无有效证书 → 已失效待重排并带原因', recalced.lifecycle === '已失效待重排' && !!recalced.invalidReason?.includes('W-109'))

console.log('4) 已完成结论保留原依据')
// 用 09-29 当天资质完成计划
let planB = seedPlans.find((p) => p.id === 'IP-2026-0929-B')!
const basisSnapshot = JSON.stringify(planB.basis)
const seqSnapshot = planB.basisQualSeq
// 之后刘强资质再更新（替换 Q-2）
const r2 = submitQualification(
  { versions, conflicts: [], plans: plans.map((p) => (p.id === planB.id ? planB : p)), welds: seedWelds },
  { welderId: 'H-02', certNo: 'GX-2026-1003', standard: 'GB/T 9448', methods: ['SAW', 'GMAW'], effectiveFrom: '2026-10-03', effectiveTo: '2029-10-02', source: 'pc', seq: 6, replacesQualificationId: 'Q-2' },
  now,
)
planB = r2.plans.find((p) => p.id === 'IP-2026-0929-B')!
check('已完成计划状态不动', planB.state === '已完成')
eq('已完成依据快照不变', planB.basis, JSON.parse(basisSnapshot))
eq('依据资质链序号上界不变', planB.basisQualSeq, seqSnapshot)
check('完成动作固化当天依据（模拟 09-29 完成）', completePlan({ ...freshPlan, id: 'IP-Y', date: '2026-09-29', weldIds: ['W-104'] }, seedWelds, seedVersions, now).basis?.[0].qualificationId === 'Q-2')
// completePlan 幂等
const completed = completePlan(planB, seedWelds, versions, now)
check('重复完成不覆盖原依据', completed === planB || completed.basisQualSeq === seqSnapshot)

console.log('5) 两个录入端同时提交同一焊工新证书：先到生效，后到留冲突')
// 王凯换证：PC 端与 PAD 端同时提交（都声明替换旧证 Q-1），内容不同
const base = { versions: r2.versions, conflicts: r2.conflicts, plans: r2.plans, welds: seedWelds }
const pcFirst = submitQualification(
  base,
  { welderId: 'H-01', certNo: 'GX-2026-0901-PC', standard: 'GB/T 9448', methods: ['GMAW'], effectiveFrom: '2026-09-01', effectiveTo: '2028-08-31', source: 'pc', seq: 7, replacesQualificationId: 'Q-1' },
  now,
)
eq('PC 端先到 → 生效并置废旧证', pcFirst.outcome, { kind: 'accepted', versionId: 'Q-7' })
check('旧证 Q-1 已被先到者置废', pcFirst.versions.find((q) => q.id === 'Q-1')?.status === '作废')
const padSecond = submitQualification(
  { versions: pcFirst.versions, conflicts: pcFirst.conflicts, plans: pcFirst.plans, welds: seedWelds },
  { welderId: 'H-01', certNo: 'GX-2026-0901-PAD', standard: 'EN ISO 9606', methods: ['SMAW'], effectiveFrom: '2026-09-10', effectiveTo: '2028-09-09', source: 'pad', seq: 8, replacesQualificationId: 'Q-1' },
  now,
)
check('PAD 端后到（旧证已被换）→ 冲突', padSecond.outcome.kind === 'conflict')
check('冲突记录指向先到新版本 Q-7', padSecond.outcome.kind === 'conflict' && padSecond.outcome.winnerId === 'Q-7')
check('后到版本以搁置状态留存原文', padSecond.versions.find((q) => q.seq === 8)?.status === '冲突搁置')
check('后到证书 certNo 原文保留', padSecond.conflicts[0].incoming.certNo === 'GX-2026-0901-PAD')
check('冲突内容不影响有效链：当天仍取先到版本', qualificationOn(padSecond.versions, 'H-01', 'GMAW', '2026-10-03')?.certNo === 'GX-2026-0901-PC')
const plansBeforeLoser = JSON.stringify(pcFirst.plans)
eq('后到搁置不触发计划重算', padSecond.plans, JSON.parse(plansBeforeLoser))

console.log('6) 完全相同内容重复提交幂等（任一端重发）')
const dup = submitQualification(
  { versions: padSecond.versions, conflicts: padSecond.conflicts, plans: padSecond.plans, welds: seedWelds },
  { welderId: 'H-01', certNo: 'GX-2026-0901-PC', standard: 'GB/T 9448', methods: ['GMAW'], effectiveFrom: '2026-09-01', effectiveTo: '2028-08-31', source: 'pad', seq: 9, replacesQualificationId: 'Q-1' },
  now,
)
eq('重复内容命中已存在版本', dup.outcome, { kind: 'duplicate', versionId: 'Q-7' })
eq('不新增版本', dup.versions.length, padSecond.versions.length)

console.log('6b) 补录方法不相交的证书可与现有版本共存（非冲突）')
const addMethod = submitQualification(
  { versions: padSecond.versions, conflicts: padSecond.conflicts, plans: padSecond.plans, welds: seedWelds },
  { welderId: 'H-03', certNo: 'GX-2026-1001-SMAW', standard: 'GB/T 9448', methods: ['SMAW'], effectiveFrom: '2026-10-01', effectiveTo: '2028-09-30', source: 'pc', seq: 10 },
  now,
)
eq('方法覆盖不相交 → 直接生效', addMethod.outcome, { kind: 'accepted', versionId: 'Q-10' })
check('FCAW 旧证保留、SMAW 新证可查', qualificationOn(addMethod.versions, 'H-03', 'FCAW', '2026-10-03')?.id === 'Q-3' && qualificationOn(addMethod.versions, 'H-03', 'SMAW', '2026-10-03')?.id === 'Q-10')

console.log('7) 追溯包失败后按包号恢复')
let pkgs = exportTracePackage([], { idempotencyKey: 'trace:IP-2026-0929-B', planIds: ['IP-2026-0929-B'], createdBy: '质量负责人' }, now, true)
check('首次导出标记失败', pkgs.pkg.status === '导出失败')
const failedId = pkgs.pkg.id
// 失败后用户用同一范围重试 → 命中同一包号，不会生成第二个失败包
const retry = exportTracePackage(pkgs.packages, { idempotencyKey: 'trace:IP-2026-0929-B', planIds: ['IP-2026-0929-B'], createdBy: '质量负责人' }, now)
check('同范围重试复用同一包（幂等）', retry.reused && retry.pkg.id === failedId)
const restored = restoreTracePackage(retry.packages, failedId, now)
check('按包号恢复成功', restored.pkg?.status === '已恢复')
eq('恢复后记录数与既定范围一致', restored.pkg?.recordCount, 1)
check('恢复流水追加且原失败流水保留', restored.pkg!.attempts.length === 2 && restored.pkg!.attempts[0].result === '失败')
// 对已恢复包再次恢复/导出不得多出记录
const restoreAgain = restoreTracePackage(restored.packages, failedId, now)
eq('重复恢复不新增流水', restoreAgain.pkg?.attempts.length, 2)

console.log('8) 重复导出不能多出记录')
let exportState = exportTracePackage([], { idempotencyKey: 'trace:A,B', planIds: ['P1', 'P2'], createdBy: '质量负责人' }, now)
eq('首次导出 2 条记录', exportState.pkg.recordCount, 2)
exportState = exportTracePackage(exportState.packages, { idempotencyKey: 'trace:A,B', planIds: ['P1', 'P2'], createdBy: '质量负责人' }, now)
check('第二次导出命中原包', exportState.reused)
exportState = exportTracePackage(exportState.packages, { idempotencyKey: 'trace:A,B', planIds: ['P1', 'P2'], createdBy: '质量负责人' }, now)
eq('导出三次仍只有 1 个包、2 条记录', [exportState.packages.length, exportState.pkg.recordCount], [1, 2])
// 不同范围是不同包
exportState = exportTracePackage(exportState.packages, { idempotencyKey: 'trace:A', planIds: ['P1'], createdBy: '质量负责人' }, now)
eq('不同范围生成独立包', exportState.packages.length, 2)

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
