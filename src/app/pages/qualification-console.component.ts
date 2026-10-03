import { Component, computed, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ButtonModule } from 'primeng/button'
import { SelectModule } from 'primeng/select'
import { CardModule } from 'primeng/card'
import { QualificationStore, type QualificationFormInput } from '../domain/qualification.store'
import type { InspectionPlan, QualificationVersion } from '../domain/types'

type Severity = 'success' | 'info' | 'warn' | 'danger' | 'secondary'

/**
 * 焊工资质版本化 / 检测计划按作业日生效 演示台
 * 规则落点：
 *  A 计划当天只看当天有效证书（台账、计划依据均按作业日实时取版本）
 *  B 资质更新 → 未完成计划立即失效并重算；已完成计划保留固化依据
 *  C 双端并发换证：先到生效置废旧证，后到原文留冲突，人工可裁决
 *  D 追溯包：失败按包号恢复；同范围重复导出幂等，不多记录
 */
@Component({
  selector: 'app-qualification-console',
  standalone: true,
  imports: [CommonModule, FormsModule, TableModule, TagModule, ButtonModule, SelectModule, CardModule],
  template: `
  <main class="page">
    <div class="page-head">
      <div>
        <p class="eyebrow">QUALIFICATION AS OF WORKDAY</p>
        <h1>焊工资质版本与检测计划生效台</h1>
        <p>证书按作业日成版本链；计划执行日只认当天有效版本，换证即时冲销未完成计划，已完成结论冻结原依据。</p>
      </div>
      <div class="day-box">
        <label>系统作业日</label>
        <input type="date" [ngModel]="store.workday()" (ngModelChange)="store.workday.set($event)" />
      </div>
    </div>

    <!-- A. 焊缝台账：按作业日实时判定资质 -->
    <section class="card">
      <div class="section-head">
        <h2 class="panel-title">① 焊缝台账 · 当天资质视图</h2>
        <span class="hint">现场临时焊工（无工号）同样按姓名挂接证书版本链</span>
      </div>
      <p-table [value]="store.weldRows()" [paginator]="false">
        <ng-template #header>
          <tr><th>焊缝</th><th>构件</th><th>方法</th><th>焊工</th><th>作业日有效证书</th><th>状态</th></tr>
        </ng-template>
        <ng-template #body let-row>
          <tr>
            <td><b>{{row.weld.id}}</b></td>
            <td>{{row.weld.component}}<small class="block muted">{{row.weld.drawing}}</small></td>
            <td>{{row.weld.method}}</td>
            <td>{{row.welder?.name}}<small class="block muted">{{row.welder?.employeeNo || '临时焊工 · 仅姓名'}}</small></td>
            <td>
              <ng-container *ngIf="row.qualification; else none">
                <b>{{row.qualification.certNo}}</b>
                <small class="block muted">{{row.qualification.standard}} · {{row.qualification.methods.join('/')}} · {{row.qualification.effectiveFrom}} ~ {{row.qualification.effectiveTo ?? '长期'}}</small>
                <small class="block warn" *ngIf="row.expiringSoon">30 天内到期</small>
              </ng-container>
              <ng-template #none><span class="danger">无覆盖 {{row.weld.method}} 的有效证书</span></ng-template>
            </td>
            <td><p-tag [value]="row.valid ? '当天有效' : '当天无效'" [severity]="row.valid ? 'success' : 'danger'" /></td>
          </tr>
        </ng-template>
      </p-table>
    </section>

    <div class="grid-2 mt-4">
      <!-- C. 证书录入：两端并发 -->
      <section class="card">
        <div class="section-head"><h2 class="panel-title">② 证书录入端（换证 / 补录）</h2><span class="hint">两端同时提交时，服务端序号小者先到</span></div>
        <div class="form">
          <label>焊工</label>
          <p-select [options]="welderOptions" optionLabel="label" optionValue="id" [(ngModel)]="form.welderId" (ngModelChange)="onWelderChange($event)" />
          <label>证书编号</label><input class="ctl" [(ngModel)]="form.certNo" placeholder="如 GX-2026-1002" />
          <label>标准</label><input class="ctl" [(ngModel)]="form.standard" />
          <label>方法覆盖（逗号分隔，* 为全部）</label><input class="ctl" [(ngModel)]="methodsText" (ngModelChange)="methodsText = $event" />
          <div class="form-row">
            <div><label>生效日（含）</label><input class="ctl" type="date" [(ngModel)]="form.effectiveFrom" /></div>
            <div><label>到期日（含，空=长期）</label><input class="ctl" type="date" [(ngModel)]="form.effectiveTo" /></div>
          </div>
          <label>换证对象（留空 = 补录/新增）</label>
          <p-select [options]="replaceOptions()" optionLabel="label" optionValue="id" [showClear]="true" [(ngModel)]="form.replacesQualificationId" placeholder="选择被替换的旧证书" />
          <div class="submit-row">
            <p-button label="PC 端提交" icon="pi pi-desktop" (onClick)="submit('pc')" />
            <p-button label="平板端提交" icon="pi pi-tablet" severity="help" (onClick)="submit('pad')" />
          </div>
          <p class="muted small">演示并发：先点一端再点另一端（内容可改成不同证书号）；后到内容自动进冲突区。</p>
        </div>
        <div *ngIf="lastOutcome()" class="outcome" [class.ok]="outcomeOk()" [class.bad]="!outcomeOk()">
          {{ outcomeText() }}
        </div>
      </section>

      <!-- 证书版本链 -->
      <section class="card">
        <div class="section-head"><h2 class="panel-title">③ 资质版本链</h2><span class="hint">冲突/作废版本保留留痕</span></div>
        <p-table [value]="store.versions()" [paginator]="false" [rows]="10" [tableStyle]="{ 'font-size': '13px' }">
          <ng-template #header><tr><th>序号</th><th>焊工</th><th>证书</th><th>生效区间</th><th>方法</th><th>端</th><th>状态</th></tr></ng-template>
          <ng-template #body let-q>
            <tr [class.dim]="q.status!=='生效'">
              <td>{{q.seq}}</td>
              <td>{{welderName(q.welderId)}}</td>
              <td>{{q.certNo}}<small class="block muted">{{q.standard}}</small></td>
              <td class="nowrap">{{q.effectiveFrom}}<br />~ {{q.effectiveTo ?? '长期'}}</td>
              <td>{{q.methods.join('/')}}</td>
              <td>{{q.source}}</td>
              <td><p-tag [value]="q.status" [severity]="versionSeverity(q.status)" /></td>
            </tr>
          </ng-template>
        </p-table>
      </section>
    </div>

    <!-- B. 检测计划：失效重算 + 已完成冻结 -->
    <section class="card mt-4">
      <div class="section-head">
        <h2 class="panel-title">④ 检测计划 · 按作业日的资格版本执行</h2>
        <div>
          <p-button label="全部重算" icon="pi pi-refresh" size="small" severity="secondary" (onClick)="store.recompute()" />
        </div>
      </div>
      <p-table [value]="store.plans()" [paginator]="false">
        <ng-template #header>
          <tr><th>计划</th><th>作业日</th><th>方法 / 检测人</th><th>焊缝资格依据</th><th>执行状态</th><th>生命周期</th><th>操作</th></tr>
        </ng-template>
        <ng-template #body let-plan>
          <tr>
            <td><b>{{plan.id}}</b></td>
            <td class="nowrap">{{plan.date}}</td>
            <td>{{plan.method}}<small class="block muted">{{plan.inspector}}</small></td>
            <td>
              <div class="basis" *ngFor="let b of store.planBasis(plan)">
                <p-tag [value]="b.valid ? '有效' : '无效'" [severity]="b.valid ? 'success' : 'danger'" />
                <span><b>{{b.weldId}}</b> · {{welderName(b.welderId)}} ·
                  <ng-container *ngIf="b.certNo; else noCert">{{b.certNo}}</ng-container>
                  <ng-template #noCert><span class="danger">{{b.reason}}</span></ng-template>
                </span>
                <i class="pi pi-lock" *ngIf="plan.state==='已完成'" title="已完成：依据快照冻结"></i>
              </div>
              <small class="block muted" *ngIf="plan.state==='已完成'">
                完成时冻结于资质链序号 {{plan.basisQualSeq}}，后续换证不改变结论
              </small>
              <small class="block danger" *ngIf="plan.invalidReason">{{plan.invalidReason}}</small>
            </td>
            <td><p-tag [value]="plan.state" [severity]="plan.state==='已完成'?'success':plan.state==='执行中'?'info':'warn'" /></td>
            <td><p-tag [value]="plan.lifecycle" [severity]="plan.lifecycle==='有效'?'success':'danger'" /></td>
            <td>
              <p-button label="执行完成" size="small" [disabled]="plan.state==='已完成' || plan.lifecycle==='已失效待重排'"
                (onClick)="store.completePlan(plan.id)" />
              <p-button label="重算" size="small" severity="secondary" text [disabled]="plan.state==='已完成'"
                (onClick)="store.recompute(plan.id)" />
            </td>
          </tr>
        </ng-template>
      </p-table>
      <p class="muted small mt-2">已完成计划的「执行完成」按钮永久禁用，依据快照（证书号 + 资质链序号）不可变。</p>
    </section>

    <div class="grid-2 mt-4">
      <!-- 冲突区 -->
      <section class="card">
        <div class="section-head"><h2 class="panel-title">⑤ 并发冲突留存区</h2>
          <p-tag [value]="pendingConflicts() + ' 条待裁决'" [severity]="pendingConflicts() ? 'danger' : 'secondary'" /></div>
        <p class="muted small" *ngIf="!store.conflicts().length">暂无冲突。</p>
        <div class="conflict" *ngFor="let c of store.conflicts()">
          <div class="conflict-head">
            <b>{{c.id}} · {{welderName(c.welderId)}}</b>
            <p-tag [value]="c.status" [severity]="c.status==='待裁决'?'danger':c.status==='采纳'?'success':'secondary'" />
          </div>
          <p class="small">后到内容（{{c.incoming.source}} 端，序号 {{c.incoming.seq}}）：
            <b>{{c.incoming.certNo}}</b> · {{c.incoming.standard}} · {{c.incoming.methods.join('/')}} · {{c.incoming.effectiveFrom}} ~ {{c.incoming.effectiveTo ?? '长期'}}</p>
          <p class="small muted">{{c.reason}}</p>
          <p class="small muted" *ngIf="c.resolvedAt">裁决人 {{c.resolvedBy}} · {{c.resolvedAt}}</p>
          <div class="conflict-actions" *ngIf="c.status==='待裁决'">
            <p-button label="采纳后到内容" size="small" (onClick)="store.resolveConflict(c.id,'采纳')" />
            <p-button label="驳回" size="small" severity="secondary" (onClick)="store.resolveConflict(c.id,'驳回')" />
          </div>
        </div>
      </section>

      <!-- D. 追溯包 -->
      <section class="card">
        <div class="section-head"><h2 class="panel-title">⑥ 质量追溯包（幂等导出 / 按包号恢复）</h2></div>
        <div class="trace-actions">
          <p-button label="导出已完成计划追溯包" icon="pi pi-file-export" size="small" (onClick)="exportPkg(false)" />
          <p-button label="模拟导出失败" icon="pi pi-times-circle" size="small" severity="danger" (onClick)="exportPkg(true)" />
        </div>
        <div class="pkg" *ngFor="let p of store.packages()">
          <div class="conflict-head">
            <b>{{p.id}}</b>
            <p-tag [value]="p.status" [severity]="p.status==='导出失败'?'danger':p.status==='已恢复'?'warn':'success'" />
          </div>
          <p class="small muted">范围 {{p.planIds.join(', ')}} · {{p.recordCount}} 条记录 · 指纹 {{p.fingerprint}}</p>
          <div class="attempt" *ngFor="let a of p.attempts"><i class="pi" [class.pi-check-circle]="a.result!=='失败'" [class.pi-exclamation-triangle]="a.result==='失败'"></i> {{a.at}} · {{a.result}} · {{a.detail}}</div>
          <div class="conflict-actions" *ngIf="p.status==='导出失败'">
            <p-button label="按包号恢复" size="small" (onClick)="restore(p.id)" />
          </div>
        </div>
        <p class="muted small">同一范围反复点导出只命中同一个包（按范围幂等键），不会多出记录；失败包按包号恢复后记录数与既定范围一致。</p>
      </section>
    </div>

    <!-- 事件流水 -->
    <section class="card mt-4">
      <div class="section-head"><h2 class="panel-title">⑦ 资质变更与计划失效事件链</h2></div>
      <p class="muted small" *ngIf="!store.events().length">换证被接受后，此处记录：哪本旧证置废、哪些未完成计划被即时冲销。</p>
      <div class="event" *ngFor="let e of store.events()">
        <i class="pi pi-bolt"></i>
        <div>
          <b>{{e.at}}</b> · {{e.source}} 端序号 {{e.seq}} · {{welderName(e.welderId)}} 证书 <b>{{e.certNo}}</b> 生效
          <span *ngIf="e.supersededQualificationId">，旧证 {{e.supersededQualificationId}} 置废</span>
          <div class="small danger" *ngIf="e.invalidatedPlanIds.length">即时失效待重排：{{e.invalidatedPlanIds.join(', ')}}</div>
          <div class="small muted" *ngIf="!e.invalidatedPlanIds.length">本次无新增失效计划（已完成计划不受影响）</div>
        </div>
      </div>
    </section>
  </main>
  `,
  styles: [`
    .day-box{background:#f8fafc;border:1px solid #e1e7ef;border-radius:8px;padding:10px 14px}
    .day-box label{display:block;font-size:12px;color:#64748b;margin-bottom:4px}
    .day-box input{padding:7px;border:1px solid #cbd5e1;border-radius:6px}
    .section-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap}
    .hint{font-size:12px;color:#94a3b8}
    .block{display:block}.muted{color:#7a8798}.small{font-size:13px}.mt-2{margin-top:8px}.mt-4{margin-top:16px}
    .danger{color:#dc2626}.warn{color:#d97706}.nowrap{white-space:nowrap}.dim{opacity:.55}
    .form{display:grid;gap:8px}.form label{font-size:13px;color:#475569}.ctl{padding:9px;border:1px solid #cbd5e1;border-radius:6px;width:100%}
    .form-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .submit-row{display:flex;gap:10px;margin-top:6px}
    .outcome{margin-top:12px;padding:10px 12px;border-radius:7px;font-size:13px;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c}
    .outcome.ok{background:#f0fdf4;border-color:#bbf7d0;color:#15803d}
    .basis{display:flex;align-items:center;gap:8px;padding:2px 0;font-size:13px}.basis .pi-lock{color:#94a3b8;font-size:12px}
    .conflict,.pkg,.event{border:1px solid #e1e7ef;border-radius:8px;padding:11px 13px;margin-bottom:10px;background:#fff}
    .conflict-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
    .conflict-actions{display:flex;gap:8px;margin-top:8px}
    .trace-actions{display:flex;gap:8px;margin-bottom:12px}
    .attempt{font-size:12px;color:#64748b;padding:2px 0}
    .attempt .pi-check-circle{color:#16a34a}.attempt .pi-exclamation-triangle{color:#dc2626}
    .event{display:flex;gap:10px;align-items:flex-start}.event>.pi-bolt{color:#2563eb;margin-top:3px}
    @media(max-width:760px){.form-row{grid-template-columns:1fr}}
  `],
})
export class QualificationConsoleComponent {
  readonly store = inject(QualificationStore)

  welderOptions = this.store.weldersList().map((w) => ({ id: w.id, label: `${w.name}${w.employeeNo ? `（${w.employeeNo}）` : '（临时 · 仅姓名）'}` }))

  form: QualificationFormInput = {
    welderId: 'H-09',
    certNo: 'GX-2026-1002',
    standard: 'GB/T 9448',
    methods: ['SMAW'],
    effectiveFrom: '2026-10-02',
    effectiveTo: '2028-10-01',
    source: 'pc',
    replacesQualificationId: 'Q-4',
  }
  methodsText = 'SMAW'
  lastOutcome = signal<{ kind: string; text: string } | null>(null)

  readonly outcomeText = computed(() => this.lastOutcome()?.text ?? '')
  readonly outcomeOk = computed(() => {
    const k = this.lastOutcome()?.kind
    return k === 'accepted' || k === 'duplicate'
  })

  readonly pendingConflicts = computed(() => this.store.conflicts().filter((c) => c.status === '待裁决').length)

  replaceOptions = computed(() =>
    this.store
      .versions()
      .filter((q) => q.welderId === this.form.welderId && q.status === '生效')
      .map((q) => ({ id: q.id, label: `${q.certNo}（${q.effectiveFrom} ~ ${q.effectiveTo ?? '长期'}）` })),
  )

  onWelderChange(id: string) {
    this.form.replacesQualificationId = this.replaceOptions()[0]?.id
  }

  submit(source: 'pc' | 'pad') {
    this.form.source = source
    this.form.methods = this.methodsText.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    const outcome = this.store.submitCertificate(this.form)
    const text =
      outcome.kind === 'accepted' ? `✓ 先到版本 ${outcome.versionId} 已生效；未完成计划已即时重算。`
      : outcome.kind === 'duplicate' ? `＝ 内容与 ${outcome.versionId} 完全相同，幂等命中，不生成新版本。`
      : outcome.kind === 'conflict' ? `✗ 后到内容未生效，已留冲突 ${outcome.conflictId}；先到版本 ${outcome.winnerId} 保持有效。`
      : `✗ 提交被拒，内容留存于 ${outcome.conflictId} 等待人工处理。`
    this.lastOutcome.set({ kind: outcome.kind, text })
  }

  welderName(id: string): string {
    return this.store.weldersList().find((w) => w.id === id)?.name ?? id
  }

  versionSeverity(status: QualificationVersion['status']): Severity {
    return status === '生效' ? 'success' : status === '作废' ? 'secondary' : 'danger'
  }

  exportPkg(fail: boolean) {
    const planIds = this.store.plans().filter((p: InspectionPlan) => p.state === '已完成').map((p) => p.id)
    if (!planIds.length) return
    const { pkg, reused } = this.store.exportPackage(planIds, fail)
    this.lastOutcome.set({
      kind: reused ? 'duplicate' : fail ? 'conflict' : 'accepted',
      text: reused
        ? `＝ 相同范围重复导出，命中既有包 ${pkg.id}，记录数仍为 ${pkg.recordCount}。`
        : fail
          ? `✗ 包 ${pkg.id} 导出失败，可按包号恢复。`
          : `✓ 包 ${pkg.id} 已导出，${pkg.recordCount} 条记录。`,
    })
  }

  restore(id: string) {
    const pkg = this.store.restorePackage(id)
    if (pkg) this.lastOutcome.set({ kind: 'accepted', text: `✓ 已按包号 ${id} 恢复，记录数 ${pkg.recordCount}（不多不少）。` })
  }
}
