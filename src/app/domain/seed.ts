import type { InspectionPlan, QualificationVersion, TracePackage, Weld, Welder } from './types'

/** 今天：2026-10-03（与演示环境日期一致） */
export const NOW = '2026-10-03T09:00:00'
export const TODAY = '2026-10-03'

export const welders: Welder[] = [
  { id: 'H-01', name: '王凯', employeeNo: 'WG-10231' },
  { id: 'H-02', name: '刘强', employeeNo: 'WG-10877' },
  { id: 'H-03', name: '赵明', employeeNo: 'WG-11204' },
  { id: 'H-09', name: '孙鹏' }, // 现场临时焊工：只有姓名，无工号
]

export const seedVersions: QualificationVersion[] = [
  { id: 'Q-1', welderId: 'H-01', certNo: 'GX-2025-0001', standard: 'GB/T 9448', methods: ['*'], effectiveFrom: '2025-06-01', effectiveTo: '2027-06-30', source: 'pc', seq: 1, status: '生效' },
  { id: 'Q-2', welderId: 'H-02', certNo: 'GX-2025-0002', standard: 'GB/T 9448', methods: ['SAW'], effectiveFrom: '2025-03-01', effectiveTo: '2028-03-31', source: 'pc', seq: 2, status: '生效' },
  { id: 'Q-3', welderId: 'H-03', certNo: 'GX-2025-0003', standard: 'GB/T 9448', methods: ['FCAW', 'GMAW'], effectiveFrom: '2025-01-15', effectiveTo: '2027-01-31', source: 'pad', seq: 3, status: '生效' },
  // 孙鹏旧证 2026-10-01 到期（含当天），10-02 起失效；10-03 的计划即判定无有效证书
  { id: 'Q-4', welderId: 'H-09', certNo: 'GX-2024-0709', standard: 'GB/T 9448', methods: ['SMAW'], effectiveFrom: '2024-10-02', effectiveTo: '2026-10-01', source: 'pc', seq: 4, status: '生效' },
]

export const seedWelds: Weld[] = [
  { id: 'W-101', drawing: 'SG-04-钢柱', component: 'KZ-12 / 柱翼缘', joint: '全熔透坡口焊', method: 'GMAW', welderId: 'H-01', welderName: '王凯', inspectionRatio: 100, requiredRatio: 100, status: '合格', x: 18, y: 24, repairs: 0, defects: [] },
  { id: 'W-104', drawing: 'SG-07-屋面梁', component: 'GL-21 / 下翼缘', joint: '对接焊缝', method: 'SAW', welderId: 'H-02', welderName: '刘强', inspectionRatio: 100, requiredRatio: 100, status: '待复检', x: 48, y: 38, repairs: 2, defects: [{ id: 'D-31', position: 42, type: '夹渣', length: 12, level: 'Ⅱ级', method: 'UT', report: 'UT-2026-0918' }] },
  { id: 'W-107', drawing: 'SG-07-屋面梁', component: 'GL-21 / 腹板', joint: '角焊缝', method: 'FCAW', welderId: 'H-03', welderName: '赵明', inspectionRatio: 20, requiredRatio: 20, status: '返修中', x: 61, y: 42, repairs: 1, defects: [{ id: 'D-32', position: 68, type: '未熔合', length: 18, level: 'Ⅲ级', method: 'MT', report: 'MT-2026-0921' }] },
  { id: 'W-109', drawing: 'SG-12-平台梁', component: 'PL-08 / 节点板', joint: '角焊缝', method: 'SMAW', welderId: 'H-09', welderName: '孙鹏', inspectionRatio: 10, requiredRatio: 20, status: '待检测', x: 78, y: 60, repairs: 0, defects: [] },
  { id: 'W-112', drawing: 'SG-12-平台梁', component: 'PL-08 / 腹板', joint: '组合焊缝', method: 'GMAW', welderId: 'H-01', welderName: '王凯', inspectionRatio: 50, requiredRatio: 50, status: '已关闭', x: 36, y: 68, repairs: 0, defects: [] },
]

export const seedPlans: InspectionPlan[] = [
  {
    // 已完成：结论与依据快照永久保留，事后换证不影响
    id: 'IP-2026-0929-B', date: '2026-09-29', method: 'UT', weldIds: ['W-104'], inspector: '赵岚',
    state: '已完成', lifecycle: '有效', calculatedAt: '2026-09-29T16:40:00',
    basis: [
      { weldId: 'W-104', welderId: 'H-02', method: 'SAW', qualificationId: 'Q-2', certNo: 'GX-2025-0002', valid: true, reason: '依据 GX-2025-0002（2025-03-01 起生效）' },
    ],
    basisQualSeq: 4,
  },
  // 今日计划：孙鹏旧证 10-01 到期 → 按今天版本判定已失效待重排
  { id: 'IP-2026-1003-A', date: '2026-10-03', method: 'UT + MT', weldIds: ['W-109', 'W-101'], inspector: '陈锋', state: '执行中', lifecycle: '已失效待重排', calculatedAt: NOW, invalidReason: 'W-109: 2026-10-03 无覆盖 SMAW 的有效证书' },
  // 未来计划：换证成功后重算应自动恢复有效
  { id: 'IP-2026-1008-C', date: '2026-10-08', method: 'MT', weldIds: ['W-109'], inspector: '赵岚', state: '待执行', lifecycle: '已失效待重排', calculatedAt: NOW, invalidReason: 'W-109: 2026-10-08 无覆盖 SMAW 的有效证书' },
]

export const seedPackages: TracePackage[] = []
