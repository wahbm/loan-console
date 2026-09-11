import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ComponentType, LoanCase, LoanCaseInput, LoanComponent, PrepaymentInput, RepaymentMethod } from "@loan-console/shared";
import { ApiRequestError, api, download } from "./api.js";

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());

function money(value: string | number): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(Number(value));
}

function percent(value: string): string {
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function rateFromPercent(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "0";
  const negative = trimmed.startsWith("-");
  const clean = negative ? trimmed.slice(1) : trimmed;
  const [whole = "0", fraction = ""] = clean.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  const decimalPlaces = fraction.length + 2;
  const padded = digits.padStart(decimalPlaces + 1, "0");
  const splitAt = padded.length - decimalPlaces;
  const result = `${padded.slice(0, splitAt) || "0"}.${padded.slice(splitAt)}`;
  return `${negative ? "-" : ""}${result}`;
}

function componentLabel(type: ComponentType): string {
  return type === "commercial" ? "商业贷款" : "公积金贷款";
}

function repaymentLabel(method: RepaymentMethod): string {
  return method === "equal_payment" ? "等额本息" : "等额本金";
}

function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "操作失败";
  return <div className="alert alert-error">{message}</div>;
}

function MetricCard({ label, value, hint, tone = "default" }: { label: string; value: string; hint?: string; tone?: "default" | "accent" | "warm" }) {
  return <div className={`metric-card ${tone}`}><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div>;
}

function App() {
  return <Routes><Route path="/login" element={<LoginPage />} /><Route element={<RequireAuth />}><Route element={<Layout />}><Route index element={<DashboardPage />} /><Route path="loans" element={<LoansPage />} /><Route path="loans/new" element={<LoanFormPage />} /><Route path="loans/:id" element={<LoanDetailPage />} /><Route path="settings" element={<SettingsPage />} /></Route></Route><Route path="*" element={<Navigate to="/" replace />} /></Routes>;
}

function RequireAuth() {
  const location = useLocation();
  const query = useQuery({ queryKey: ["me"], queryFn: api.me });
  if (query.isLoading) return <div className="center-screen"><div className="loading-ring" /></div>;
  if (query.error) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

function Layout() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const logout = useMutation({ mutationFn: api.logout, onSuccess: () => { client.clear(); navigate("/login"); } });
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">LC</div><div><strong>Loan Console</strong><span>贷款分析台</span></div></div>
      <nav className="nav-list">
        <NavLink to="/" end className={({ isActive }) => isActive ? "nav-item active" : "nav-item"}><span>⌂</span>总览</NavLink>
        <NavLink to="/loans" className={({ isActive }) => isActive ? "nav-item active" : "nav-item"}><span>▣</span>贷款台账</NavLink>
        <NavLink to="/settings" className={({ isActive }) => isActive ? "nav-item active" : "nav-item"}><span>⚙</span>备份与设置</NavLink>
      </nav>
      <div className="sidebar-note"><span className="status-dot" />计划模型运行中<small>基于合同条件估算</small></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><span className="eyebrow">PERSONAL FINANCE / V1</span><h1>贷款分析后台</h1></div><div className="topbar-actions"><span className="date-pill">{today}</span><button className="icon-button" title="退出登录" onClick={() => logout.mutate()} disabled={logout.isPending}>↪</button></div></header>
      <div className="page-content"><Outlet /></div>
    </main>
  </div>;
}

function LoginPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({ mutationFn: () => api.login({ username, password }), onSuccess: (data) => { client.setQueryData(["me"], data); navigate("/"); } });
  return <div className="login-screen"><div className="login-panel"><div className="brand login-brand"><div className="brand-mark">LC</div><div><strong>Loan Console</strong><span>贷款分析台</span></div></div><div className="login-copy"><span className="eyebrow">PRIVATE FINANCE CONSOLE</span><h1>把每一笔利息<br /><em>算清楚。</em></h1><p>按月度计划、利率历史和提前还款场景，建立一份可解释的个人贷款账本。</p></div><form className="login-form" onSubmit={(event) => { event.preventDefault(); login.mutate(); }}><label>管理员账号<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label><label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label><ErrorBanner error={login.error} /><button className="primary-button wide" disabled={login.isPending}>{login.isPending ? "登录中…" : "进入贷款分析台"}</button></form><small className="login-footnote">所有结果均为计划模型估算，不代表银行真实账单。</small></div><div className="login-art"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-line line-one" /><div className="art-line line-two" /><div className="art-number">01<span>/</span>24</div><div className="art-caption">principle · clarity · control</div></div></div>;
}

function DashboardPage() {
  const query = useQuery({ queryKey: ["dashboard", today], queryFn: () => api.dashboard(today) });
  if (query.isLoading) return <PageLoading />;
  if (query.error) return <ErrorBanner error={query.error} />;
  const data = query.data!;
  const chartData = [{ name: "商业贷款", value: Number(data.byComponentType.commercial) }, { name: "公积金贷款", value: Number(data.byComponentType.provident_fund) }];
  return <div className="page-stack"><div className="page-intro"><div><span className="eyebrow">OVERVIEW / {data.asOf}</span><h2>今天的负债全景</h2><p>以计划模型为基准，快速掌握本金、月供和未来利息。</p></div><Link className="primary-button" to="/loans/new">＋ 录入贷款</Link></div><div className="metrics-grid"><MetricCard label="计划剩余本金" value={money(data.totals.remainingPrincipal)} tone="accent" hint="截至今日计划余额" /><MetricCard label="下期计划还款" value={money(data.totals.nextPayment)} hint={data.totals.nextPaymentDate ? `还款日 ${data.totals.nextPaymentDate}` : "暂无计划"} /><MetricCard label="已到期计划利息" value={money(data.totals.paidInterest)} tone="warm" hint="按计划估算" /><MetricCard label="计划剩余利息" value={money(data.totals.remainingInterest)} hint={`预计 ${data.totals.remainingPeriods} 期`} /></div><div className="dashboard-grid"><section className="panel chart-panel"><div className="panel-heading"><div><span className="eyebrow">BALANCE MIX</span><h3>余额构成</h3></div><span className="panel-note">按贷款分项</span></div><div className="chart-wrap"><ResponsiveContainer width="100%" height={250}><PieChart><Pie data={chartData} dataKey="value" nameKey="name" innerRadius={72} outerRadius={100} paddingAngle={4}>{chartData.map((entry, index) => <Cell key={entry.name} fill={index === 0 ? "#8ee3b2" : "#8a9cff"} />)}</Pie><Tooltip formatter={(value: number) => money(value)} /><text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" className="donut-total">{money(data.totals.remainingPrincipal)}</text><text x="50%" y="60%" textAnchor="middle" dominantBaseline="middle" className="donut-label">计划余额</text></PieChart></ResponsiveContainer><div className="legend-list">{chartData.map((item, index) => <div className="legend-row" key={item.name}><span className={`legend-dot dot-${index}`} /><span>{item.name}</span><strong>{money(item.value)}</strong></div>)}</div></div></section><section className="panel trend-panel"><div className="panel-heading"><div><span className="eyebrow">LOAN BOOK</span><h3>贷款台账</h3></div><Link to="/loans" className="text-link">查看全部 →</Link></div>{data.loans.length === 0 ? <EmptyState title="还没有贷款记录" description="先录入第一笔贷款，建立你的还款计划。" action={<Link className="secondary-button" to="/loans/new">开始录入</Link>} /> : <div className="loan-mini-list">{data.loans.slice(0, 5).map((loan) => <Link to={`/loans/${loan.id}`} className="loan-mini-row" key={loan.id}><div className="loan-avatar">{loan.name.slice(0, 1)}</div><div className="loan-mini-main"><strong>{loan.name}</strong><span>{loan.nextPaymentDate ? `下期 ${loan.nextPaymentDate}` : "已结清"}</span></div><div className="loan-mini-value"><strong>{money(loan.remainingPrincipal)}</strong><span>剩余本金</span></div><span className="row-arrow">→</span></Link>)}</div>}</section></div><div className="notice-strip"><span className="notice-icon">i</span><div><strong>这是计划模型，不是银行流水</strong><p>系统默认所有已到期还款均已按计划偿还；如需记录实际还款，请在后续版本接入流水。</p></div></div></div>;
}

function LoansPage() {
  const query = useQuery({ queryKey: ["loans"], queryFn: api.listLoans });
  if (query.isLoading) return <PageLoading />;
  if (query.error) return <ErrorBanner error={query.error} />;
  const loans = query.data ?? [];
  return <div className="page-stack"><div className="page-intro"><div><span className="eyebrow">LOAN BOOK</span><h2>贷款台账</h2><p>每笔贷款组合及其商贷、公积金分项都在这里。</p></div><Link className="primary-button" to="/loans/new">＋ 录入贷款</Link></div>{loans.length === 0 ? <div className="panel"><EmptyState title="还没有贷款" description="录入商贷、公积金或混合贷款，系统会自动生成还款计划。" action={<Link className="primary-button" to="/loans/new">录入第一笔贷款</Link>} /></div> : <div className="loan-grid">{loans.map((loan) => <LoanCard loan={loan} key={loan.id} />)}</div>}</div>;
}

function LoanCard({ loan }: { loan: LoanCase }) {
  const schedule = useQuery({ queryKey: ["schedule", loan.id, today], queryFn: () => api.schedule(loan.id, today) });
  const metrics = schedule.data?.schedule.metrics;
  return <Link to={`/loans/${loan.id}`} className="loan-card"><div className="loan-card-top"><div className="loan-avatar large">{loan.name.slice(0, 1)}</div><div><h3>{loan.name}</h3><span>{loan.components.length === 2 ? "混合贷款" : componentLabel(loan.components[0]?.componentType ?? "commercial")}</span></div><span className="row-arrow">→</span></div><div className="loan-card-number">{metrics ? money(metrics.remainingPrincipal) : "加载中…"}<small>计划剩余本金</small></div><div className="loan-card-bottom"><span>{loan.components.map((component) => <i key={component.id} className={`tag ${component.componentType}`}>{componentLabel(component.componentType)}</i>)}</span><span>{metrics?.nextPaymentDate ? `下期 ${metrics.nextPaymentDate}` : ""}</span></div></Link>;
}

type DraftComponent = { componentType: ComponentType; principal: string; disbursementDate: string; firstPaymentDate: string; termMonths: string; repaymentMethod: RepaymentMethod; initialRate: string };

const defaultComponent = (type: ComponentType): DraftComponent => ({ componentType: type, principal: "", disbursementDate: today, firstPaymentDate: today, termMonths: "360", repaymentMethod: "equal_payment", initialRate: "3.25" });

function LoanFormPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [components, setComponents] = useState<DraftComponent[]>([defaultComponent("commercial")]);
  const [error, setError] = useState<unknown>(null);
  const create = useMutation({ mutationFn: (input: LoanCaseInput) => api.createLoan(input), onSuccess: (loan) => { client.invalidateQueries({ queryKey: ["loans"] }); client.invalidateQueries({ queryKey: ["dashboard"] }); navigate(`/loans/${loan.id}`); }, onError: setError });
  const updateComponent = (index: number, patch: Partial<DraftComponent>) => setComponents((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const submit = (event: React.FormEvent) => { event.preventDefault(); setError(null); if (!name.trim()) { setError(new Error("请填写贷款名称")); return; } if (components.some((component) => !component.principal || Number(component.principal) <= 0)) { setError(new Error("请填写有效的贷款本金")); return; } create.mutate({ name: name.trim(), notes, components: components.map((component) => ({ componentType: component.componentType, principal: component.principal, disbursementDate: component.disbursementDate, firstPaymentDate: component.firstPaymentDate, termMonths: Number(component.termMonths), repaymentMethod: component.repaymentMethod, initialRate: rateFromPercent(component.initialRate) })) }); };
  return <div className="page-stack narrow-page"><div className="page-intro"><div><Link className="back-link" to="/loans">← 返回贷款台账</Link><span className="eyebrow">NEW LOAN CASE</span><h2>录入一笔贷款</h2><p>先记录合同条件，之后再用利率历史和提前还款模拟补充变化。</p></div></div><form className="form-stack" onSubmit={submit}><section className="panel form-panel"><div className="panel-heading"><div><span className="eyebrow">01 / CASE</span><h3>贷款组合</h3></div><span className="step-badge">基础信息</span></div><div className="form-grid"><label>贷款名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：滨江公寓按揭" /></label><label>备注<span className="input-hint">可选</span><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="例如：2026 年购房" /></label></div></section>{components.map((component, index) => <section className="panel form-panel" key={component.componentType}><div className="panel-heading"><div><span className="eyebrow">0{index + 2} / COMPONENT</span><h3>{componentLabel(component.componentType)}</h3></div>{components.length > 1 && <button type="button" className="ghost-button danger-text" onClick={() => setComponents((items) => items.filter((_, itemIndex) => itemIndex !== index))}>移除</button>}</div><div className="form-grid three"><label>贷款本金（元）<input inputMode="decimal" value={component.principal} onChange={(event) => updateComponent(index, { principal: event.target.value })} placeholder="1000000.00" /></label><label>还款方式<select value={component.repaymentMethod} onChange={(event) => updateComponent(index, { repaymentMethod: event.target.value as RepaymentMethod })}><option value="equal_payment">等额本息</option><option value="equal_principal">等额本金</option></select></label><label>年利率（%）<input inputMode="decimal" value={component.initialRate} onChange={(event) => updateComponent(index, { initialRate: event.target.value })} placeholder="3.25" /></label><label>放款日期<input type="date" value={component.disbursementDate} onChange={(event) => updateComponent(index, { disbursementDate: event.target.value })} /></label><label>首期还款日<input type="date" value={component.firstPaymentDate} onChange={(event) => updateComponent(index, { firstPaymentDate: event.target.value })} /></label><label>期限（月）<input inputMode="numeric" value={component.termMonths} onChange={(event) => updateComponent(index, { termMonths: event.target.value })} /></label></div><div className="form-footnote">利率会以 {rateFromPercent(component.initialRate)} 的小数率保存；后续可在贷款详情中追加生效日期。</div></section>)}{components.length < 2 && <button type="button" className="add-component" onClick={() => setComponents((items) => [...items, defaultComponent("provident_fund")])}>＋ 添加公积金分项，建立混合贷款</button>}<ErrorBanner error={error} /><div className="form-actions"><Link className="secondary-button" to="/loans">取消</Link><button className="primary-button" disabled={create.isPending}>{create.isPending ? "保存中…" : "保存并生成计划"}</button></div></form></div>;
}

function LoanDetailPage() {
  const { id = "" } = useParams();
  const client = useQueryClient();
  const [asOf, setAsOf] = useState(today);
  const loanQuery = useQuery({ queryKey: ["loan", id], queryFn: () => api.getLoan(id) });
  const scheduleQuery = useQuery({ queryKey: ["schedule", id, asOf], queryFn: () => api.schedule(id, asOf), enabled: Boolean(id) });
  const [activeComponent, setActiveComponent] = useState<string | null>(null);
  const deleteLoan = useMutation({ mutationFn: () => api.deleteLoan(id), onSuccess: () => { client.invalidateQueries({ queryKey: ["loans"] }); client.invalidateQueries({ queryKey: ["dashboard"] }); window.location.href = "/loans"; } });
  if (loanQuery.isLoading || scheduleQuery.isLoading) return <PageLoading />;
  if (loanQuery.error || scheduleQuery.error) return <ErrorBanner error={loanQuery.error ?? scheduleQuery.error} />;
  const loan = loanQuery.data!;
  const schedule = scheduleQuery.data!;
  const selected = activeComponent ?? loan.components[0]?.id ?? "";
  return <div className="page-stack"><div className="page-intro detail-intro"><div><Link className="back-link" to="/loans">← 返回贷款台账</Link><span className="eyebrow">LOAN CASE / {loan.components.length === 2 ? "MIXED" : "SINGLE"}</span><h2>{loan.name}</h2><p>{loan.notes || "基于合同条件生成的确定性计划模型"}</p></div><div className="detail-actions"><label className="date-control">计算截至<input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></label><button className="ghost-button danger-text" onClick={() => { if (window.confirm("确定删除这笔贷款及其方案吗？")) deleteLoan.mutate(); }}>删除贷款</button></div></div><div className="metrics-grid"><MetricCard label="计划剩余本金" value={money(schedule.schedule.metrics.remainingPrincipal)} tone="accent" /><MetricCard label="下期计划还款" value={money(schedule.schedule.metrics.nextPayment)} hint={schedule.schedule.metrics.nextPaymentDate ?? "已结清"} /><MetricCard label="已到期计划利息" value={money(schedule.schedule.metrics.paidInterest)} tone="warm" /><MetricCard label="计划剩余利息" value={money(schedule.schedule.metrics.remainingInterest)} hint={`预计 ${schedule.schedule.metrics.remainingPeriods} 期`} /></div><div className="detail-layout"><div className="main-column"><section className="panel"><div className="panel-heading"><div><span className="eyebrow">REPAYMENT PLAN</span><h3>还款计划</h3></div><span className="panel-note">{schedule.schedule.metrics.payoffDate ? `预计结清 ${schedule.schedule.metrics.payoffDate}` : "暂无计划"}</span></div><div className="component-tabs">{loan.components.map((component) => <button className={selected === component.id ? "component-tab active" : "component-tab"} key={component.id} onClick={() => setActiveComponent(component.id)}>{componentLabel(component.componentType)}<small>{percent(component.ratePeriods.at(-1)?.annualRate ?? "0")}</small></button>)}</div><ScheduleTable rows={schedule.componentRows[selected] ?? []} /></section><PrepaymentPanel loan={loan} asOf={asOf} /></div><aside className="side-column"><RateHistoryPanel loan={loan} onChanged={() => { client.invalidateQueries({ queryKey: ["loan", id] }); client.invalidateQueries({ queryKey: ["schedule", id] }); }} /><div className="panel small-panel"><div className="panel-heading"><div><span className="eyebrow">MODEL NOTE</span><h3>口径说明</h3></div></div><p className="muted-copy">已到期计划利息默认视为已支付。系统不记录银行流水，不计算日息、罚息或提前还款违约金。</p></div></aside></div></div>;
}

function ScheduleTable({ rows }: { rows: Array<{ period: number; paymentDate: string; openingPrincipal: string; payment: string; principal: string; interest: string; annualRate: string; endingPrincipal: string }> }) {
  if (rows.length === 0) return <EmptyState title="暂无还款计划" description="请先完善贷款分项参数。" />;
  return <div className="table-scroll"><table><thead><tr><th>期次</th><th>还款日</th><th>月供</th><th>本金</th><th>利息</th><th>剩余本金</th><th>年利率</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.paymentDate}-${row.period}`}><td className="muted-cell">{String(row.period).padStart(2, "0")}</td><td>{row.paymentDate}</td><td className="number-cell">{money(row.payment)}</td><td className="number-cell">{money(row.principal)}</td><td className="number-cell interest-cell">{money(row.interest)}</td><td className="number-cell">{money(row.endingPrincipal)}</td><td>{percent(row.annualRate)}</td></tr>)}</tbody></table></div>;
}

function RateHistoryPanel({ loan, onChanged }: { loan: LoanCase; onChanged: () => void }) {
  const [componentId, setComponentId] = useState(loan.components[0]?.id ?? "");
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [annualRate, setAnnualRate] = useState("");
  const mutation = useMutation({ mutationFn: () => api.addRate(loan.id, componentId, { effectiveDate, annualRate: rateFromPercent(annualRate) }), onSuccess: () => { setAnnualRate(""); onChanged(); } });
  const component = loan.components.find((item) => item.id === componentId) ?? loan.components[0];
  return <section className="panel"><div className="panel-heading"><div><span className="eyebrow">RATE HISTORY</span><h3>利率历史</h3></div></div><select className="full-input" value={componentId} onChange={(event) => setComponentId(event.target.value)}>{loan.components.map((item) => <option value={item.id} key={item.id}>{componentLabel(item.componentType)}</option>)}</select><div className="rate-list">{component?.ratePeriods.map((period) => <div className="rate-row" key={period.id}><span>{period.effectiveDate}</span><strong>{percent(period.annualRate)}</strong>{period.effectiveDate <= today && <i>历史</i>}</div>)}</div><div className="inline-form"><input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /><input placeholder="新利率 %" inputMode="decimal" value={annualRate} onChange={(event) => setAnnualRate(event.target.value)} /><button className="secondary-button" disabled={!annualRate || mutation.isPending} onClick={() => mutation.mutate()}>添加</button></div><ErrorBanner error={mutation.error} /></section>;
}

function PrepaymentPanel({ loan, asOf }: { loan: LoanCase; asOf: string }) {
  const [date, setDate] = useState(asOf);
  const [strategy, setStrategy] = useState<PrepaymentInput["strategy"]>("reduce_term");
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(loan.components.map((component) => [component.id, ""])));
  const [saved, setSaved] = useState(false);
  const input = useMemo<PrepaymentInput>(() => ({ date, strategy, components: loan.components.map((component) => ({ componentId: component.id, amount: amounts[component.id] || "0" })) }), [amounts, date, loan.components, strategy]);
  const preview = useMutation({ mutationFn: () => api.prepaymentPreview(loan.id, input, asOf), onSuccess: () => setSaved(false) });
  const save = useMutation({ mutationFn: () => api.saveScenario(loan.id, input, asOf), onSuccess: () => setSaved(true) });
  return <section className="panel prepayment-panel"><div className="panel-heading"><div><span className="eyebrow">WHAT IF / PREPAYMENT</span><h3>提前还款模拟</h3></div><span className="step-badge">不修改原贷款</span></div><div className="prepayment-form"><label>提前还款日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>方案<select value={strategy} onChange={(event) => setStrategy(event.target.value as PrepaymentInput["strategy"])}><option value="reduce_term">保持月供，缩短期限</option><option value="reduce_payment">保持期限，降低月供</option></select></label>{loan.components.map((component) => <label key={component.id}>{componentLabel(component.componentType)}提前还款<input placeholder="0.00" inputMode="decimal" value={amounts[component.id] ?? ""} onChange={(event) => setAmounts((current) => ({ ...current, [component.id]: event.target.value }))} /></label>)}<button className="primary-button" onClick={() => preview.mutate()} disabled={preview.isPending}>{preview.isPending ? "计算中…" : "查看前后变化"}</button></div><ErrorBanner error={preview.error ?? save.error} />{preview.data && <div className="comparison"><ComparisonMetric label="计划剩余利息" before={money(preview.data.before.metrics.remainingInterest)} after={money(preview.data.after.metrics.remainingInterest)} saving={`节省 ${money(preview.data.savedInterest)}`} /><ComparisonMetric label="剩余期数" before={`${preview.data.before.metrics.remainingPeriods} 期`} after={`${preview.data.after.metrics.remainingPeriods} 期`} saving={preview.data.savedPeriods > 0 ? `缩短 ${preview.data.savedPeriods} 期` : "期限不变"} /><ComparisonMetric label="下期计划还款" before={money(preview.data.before.metrics.nextPayment)} after={money(preview.data.after.metrics.nextPayment)} saving={preview.data.firstPaymentReduction !== "0.00" ? `减少 ${money(preview.data.firstPaymentReduction)}` : "月供不变"} /><div className="comparison-actions"><button className="secondary-button" onClick={() => save.mutate()} disabled={save.isPending || saved}>{saved ? "方案已保存" : "保存这次方案"}</button><span>计算版本 {"1"}</span></div></div>}</section>;
}

function ComparisonMetric({ label, before, after, saving }: { label: string; before: string; after: string; saving: string }) {
  return <div className="comparison-row"><span>{label}</span><div><small>原计划</small><strong>{before}</strong></div><div className="comparison-arrow">→</div><div className="after-value"><small>提前还款后</small><strong>{after}</strong></div><em>{saving}</em></div>;
}

function SettingsPage() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<unknown>(null);
  const importBackup = async (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; try { setError(null); const backup = JSON.parse(await file.text()); const preview = await api.backupPreview(backup); if (!window.confirm(`即将恢复 ${preview.counts.loans} 笔贷款、${preview.counts.components} 个分项，当前业务数据将被替换。继续吗？`)) return; await api.backupCommit(preview.previewId); setMessage("备份恢复成功"); } catch (caught) { setError(caught); } finally { event.target.value = ""; } };
  return <div className="page-stack narrow-page"><div className="page-intro"><div><span className="eyebrow">SETTINGS / BACKUP</span><h2>备份与设置</h2><p>业务数据可导出为 JSON，便于迁移和恢复。</p></div></div><section className="panel settings-panel"><div className="settings-icon">↗</div><div><h3>导出业务备份</h3><p>仅包含贷款、利率和已保存方案，不包含管理员账号或登录会话。</p></div><button className="secondary-button" onClick={() => download("/export/backup.json", "loan-console-backup.json")}>下载 JSON</button></section><section className="panel settings-panel"><div className="settings-icon">↙</div><div><h3>恢复业务备份</h3><p>恢复会替换当前业务数据，系统会先校验格式并要求确认。</p></div><label className="secondary-button file-button">选择 JSON<input type="file" accept="application/json,.json" onChange={importBackup} /></label></section><section className="panel settings-panel"><div className="settings-icon">▤</div><div><h3>导出汇总 CSV</h3><p>适合在 Excel 或表格工具中进一步分析。</p></div><button className="secondary-button" onClick={() => download(`/export/summary.csv?asOf=${today}`, "loan-summary.csv")}>下载 CSV</button></section>{message && <div className="alert alert-success">{message}</div>}<ErrorBanner error={error} /></div>;
}

function PageLoading() { return <div className="center-content"><div className="loading-ring" /><span>正在生成计划…</span></div>; }
function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) { return <div className="empty-state"><div className="empty-icon">∅</div><h3>{title}</h3><p>{description}</p>{action}</div>; }

export default App;
