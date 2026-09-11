import type {
  AuthResponse,
  DashboardSummary,
  LoanCase,
  LoanCaseInput,
  PrepaymentInput,
  PrepaymentResponse,
  RatePeriod,
  ScheduleResponse
} from "@loan-console/shared";

export class ApiRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...options
  });
  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = data?.error;
    throw new ApiRequestError(response.status, error?.code ?? "REQUEST_FAILED", error?.message ?? "请求失败");
  }
  return data as T;
}

export const api = {
  me: () => request<AuthResponse>("/auth/me"),
  login: (input: { username: string; password: string }) => request<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify(input) }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  listLoans: async () => (await request<{ loans: LoanCase[] }>("/loans")).loans,
  getLoan: async (id: string) => (await request<{ loan: LoanCase }>(`/loans/${id}`)).loan,
  createLoan: async (input: LoanCaseInput) => (await request<{ loan: LoanCase }>("/loans", { method: "POST", body: JSON.stringify(input) })).loan,
  updateLoan: async (id: string, input: { name?: string; notes?: string }) => (await request<{ loan: LoanCase }>(`/loans/${id}`, { method: "PATCH", body: JSON.stringify(input) })).loan,
  deleteLoan: (id: string) => request<void>(`/loans/${id}`, { method: "DELETE" }),
  schedule: (id: string, asOf: string) => request<ScheduleResponse>(`/loans/${id}/schedule?asOf=${encodeURIComponent(asOf)}`),
  addRate: async (loanId: string, componentId: string, input: { effectiveDate: string; annualRate: string }) => (await request<{ ratePeriod: RatePeriod }>(`/loans/${loanId}/components/${componentId}/rate-periods`, { method: "POST", body: JSON.stringify(input) })).ratePeriod,
  prepaymentPreview: (id: string, input: PrepaymentInput, asOf: string) => request<PrepaymentResponse>(`/loans/${id}/prepayment-preview?asOf=${encodeURIComponent(asOf)}`, { method: "POST", body: JSON.stringify(input) }),
  saveScenario: async (id: string, input: PrepaymentInput, asOf: string) => (await request<{ scenario: unknown }>(`/loans/${id}/prepayment-scenarios?asOf=${encodeURIComponent(asOf)}`, { method: "POST", body: JSON.stringify(input) })).scenario,
  dashboard: (asOf: string) => request<DashboardSummary>(`/dashboard/summary?asOf=${encodeURIComponent(asOf)}`),
  backupPreview: (backup: unknown) => request<{ previewId: string; counts: Record<string, number> }>("/import/backup/preview", { method: "POST", body: JSON.stringify(backup) }),
  backupCommit: (previewId: string) => request<{ ok: true }>("/import/backup/commit", { method: "POST", body: JSON.stringify({ previewId }) })
};

export async function download(path: string, filename: string): Promise<void> {
  const response = await fetch(`${apiBase}${path}`, { credentials: "include" });
  if (!response.ok) throw new Error("下载失败");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
