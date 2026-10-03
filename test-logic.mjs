import '@angular/compiler'
import { weldReducer, initialState } from './.tmp-test/store/weld.reducer.js'
import * as A from './.tmp-test/store/weld.actions.js'

const welds = [
  { id:'W-101', welder:'王凯', method:'GMAW', status:'合格', defects:[] },
  { id:'W-104', welder:'刘强', method:'SAW', status:'待复检', defects:[] },
  { id:'W-107', welder:'赵明', method:'FCAW', status:'返修中', defects:[] },
  { id:'W-109', welder:'孙鹏', method:'SMAW', status:'待检测', defects:[] },
  { id:'W-112', welder:'王凯', method:'GMAW', status:'已关闭', defects:[] },
]
const qualifications = [
  { id:'Q-1', welder:'王凯', certNo:'GB/T 9448', method:'GMAW', grade:'x', validFrom:'2026-06-01', validTo:'2027-06-30', version:1, status:'现行' },
  { id:'Q-2', welder:'刘强', certNo:'GB/T 9448', method:'SAW', grade:'x', validFrom:'2026-03-01', validTo:'2028-03-31', version:1, status:'现行' },
  { id:'Q-3', welder:'赵明', certNo:'GB/T 9448', method:'FCAW', grade:'x', validFrom:'2026-01-01', validTo:'2027-01-31', version:1, status:'现行' },
  { id:'Q-4', welder:'孙鹏', certNo:'GB/T 9448', method:'SMAW', grade:'x', validFrom:'2025-10-01', validTo:'2026-10-01', version:1, status:'现行' },
]
const plans = [
  { id:'IP-2026-0930-A', date:'2026-09-30', method:'UT + MT', weldIds:['W-109','W-101'], inspector:'陈锋', state:'待执行' },
  { id:'IP-2026-0929-B', date:'2026-09-29', method:'UT', weldIds:['W-104'], inspector:'赵岚', state:'执行中' },
  { id:'IP-2026-1005-D', date:'2026-10-05', method:'UT', weldIds:['W-109','W-104'], inspector:'陈锋', state:'待执行' },
  { id:'IP-2026-0925-C', date:'2026-09-25', method:'MT', weldIds:['W-112'], inspector:'赵岚', state:'已完成', completedAt:'2026-09-25 17:20',
    basis:[{ weldId:'W-112', welder:'王凯', certId:'Q-1', certNo:'GB/T 9448', validFrom:'2026-06-01', validTo:'2027-06-30' }] },
]

let pass = 0, fail = 0
function check(name, cond) { if (cond) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name) } }
const plan = (s, id) => s.plans.find((p) => p.id === id)
const certsOf = (s, w) => s.qualifications.filter((q) => q.welder === w)

let s = weldReducer(initialState, A.loadWeldsSuccess({ welds, plans, qualifications }))

// 1. 计划当天只看当天有效证书：10-05 计划中孙鹏证书 10-01 到期 → W-109 失效
check('加载后 10-05 计划标记失效', plan(s,'IP-2026-1005-D').invalid === true)
check('10-05 计划暂停 W-109', plan(s,'IP-2026-1005-D').invalidWeldIds.some((w) => w.weldId === 'W-109'))
check('10-05 计划中刘强仍有效（SAW 至 2028）', !plan(s,'IP-2026-1005-D').invalidWeldIds.some((w) => w.weldId === 'W-104'))
// 2. 09-30 计划：孙鹏证书 10-01 到期，09-30 当天仍有效 → 不失效
check('09-30 计划当天证书有效，不失效', plan(s,'IP-2026-0930-A').invalid !== true)
// 3. 已完成计划不被重算，依据保留
check('已完成计划保留原依据', plan(s,'IP-2026-0925-C').basis.length === 1 && plan(s,'IP-2026-0925-C').state === '已完成')
check('加载重算生成审计事件', s.audit.some((e) => e.action === '计划失效重算'))

// 4. 孙鹏换证（录入端 A 先到，baseVersion=1）
s = weldReducer(s, A.submitQualification({ welder:'孙鹏', certNo:'GB/T 9448', method:'SMAW', grade:'角焊缝 · 立焊', validFrom:'2026-10-02', validTo:'2027-10-01', baseVersion:1, terminal:'录入端-A' }))
const sun = certsOf(s,'孙鹏')
check('换证后孙鹏 v2 现行', sun.find((q) => q.version === 2)?.status === '现行')
check('旧版 v1 置为已失效', sun.find((q) => q.version === 1)?.status === '已失效')
check('换证后 10-05 计划重算恢复', plan(s,'IP-2026-1005-D').invalid === false)
check('恢复后无暂停焊缝', plan(s,'IP-2026-1005-D').invalidWeldIds.length === 0)

// 5. 录入端 B 基于旧版本 v1 同时提交 → 留冲突
s = weldReducer(s, A.submitQualification({ welder:'孙鹏', certNo:'GB/T 9448（补录）', method:'SMAW', grade:'x', validFrom:'2026-10-02', validTo:'2027-10-01', baseVersion:1, terminal:'录入端-B' }))
check('后到内容进入冲突队列', s.conflicts.length === 1)
check('冲突状态待裁决', s.conflicts[0].status === '待裁决' && s.conflicts[0].winnerVersion === 2)
check('冲突未覆盖现行 v2', certsOf(s,'孙鹏').find((q) => q.status === '现行').version === 2)

// 6. 驳回冲突
s = weldReducer(s, A.resolveConflict({ id: s.conflicts[0].id, decision:'驳回' }))
check('驳回后冲突标记已驳回', s.conflicts[0].status === '已驳回')
check('驳回不产生新版本', certsOf(s,'孙鹏').length === 2)

// 7. 再来一个先到提交（baseVersion=2）→ 生效 v3
s = weldReducer(s, A.submitQualification({ welder:'孙鹏', certNo:'GB/T 9448（增项）', method:'SMAW', grade:'x', validFrom:'2026-10-02', validTo:'2028-06-30', baseVersion:2, terminal:'录入端-A' }))
check('新提交生效为 v3', certsOf(s,'孙鹏').find((q) => q.status === '现行')?.version === 3)

// 8. 完成 09-30 计划 → 冻结依据
s = weldReducer(s, A.completePlan({ id:'IP-2026-0930-A' }))
const done = plan(s,'IP-2026-0930-A')
check('计划完成', done.state === '已完成' && !!done.completedAt)
check('完成时冻结 2 条焊缝依据', done.basis.length === 2)
check('依据含证书编号与有效期', done.basis.every((b) => b.certNo && b.validTo))

// 9. 王凯换证 → 已完成计划依据不被改写
const basisBefore = JSON.stringify(done.basis)
s = weldReducer(s, A.submitQualification({ welder:'王凯', certNo:'GB/T 9448（新）', method:'GMAW', grade:'x', validFrom:'2026-10-04', validTo:'2029-10-03', baseVersion:1, terminal:'录入端-A' }))
check('王凯换证生效', certsOf(s,'王凯').find((q) => q.status === '现行')?.version === 2)
check('已完成计划依据保持不变', JSON.stringify(plan(s,'IP-2026-0930-A').basis) === basisBefore)
check('已完成计划不被重算标记', plan(s,'IP-2026-0930-A').invalid === false)

// 10. 追溯包：导出 → 幂等
s = weldReducer(s, A.exportPackage({}))
check('首次导出 1 个包', s.packages.length === 1 && s.packages[0].status === '已生成')
const pkgNo = s.packages[0].packageNo
const count1 = s.packages[0].recordCount
s = weldReducer(s, A.exportPackage({}))
check('重复导出不新增记录', s.packages.length === 1)
check('重复导出记录数不变', s.packages[0].recordCount === count1)

// 11. 失败 → 按包号恢复
s = weldReducer(s, A.exportPackage({ packageNo:'ZP-TEST-0001', simulateFailure:true }))
check('失败包状态', s.packages.find((p) => p.packageNo === 'ZP-TEST-0001')?.status === '失败')
s = weldReducer(s, A.recoverPackage({ packageNo:'ZP-TEST-0001' }))
const recovered = s.packages.find((p) => p.packageNo === 'ZP-TEST-0001')
check('按包号恢复成功', recovered.status === '已恢复' && recovered.attempts === 2)
check('恢复后记录数可复算', recovered.recordCount > 0 && !!recovered.snapshotHash)
s = weldReducer(s, A.recoverPackage({ packageNo:'ZP-TEST-0001' }))
check('重复恢复不新增记录', s.packages.filter((p) => p.packageNo === 'ZP-TEST-0001').length === 1)
check('总包数仍为 2', s.packages.length === 2)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
