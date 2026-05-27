'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { Loan, LoanSchedule } from '../lib/types';
import { cn, formatCurrency, getErrorMessage, todayString } from '../lib/utils';

type LoanWithSchedules = Loan & { schedules: LoanSchedule[] };

type LoanForm = {
  open: boolean;
  loan_name: string;
  bank_name: string;
  principal: string;
  interest_rate: string;
  start_date: string;
  end_date: string;
  grace_period_months: string;
  memo: string;
  saving: boolean;
  error: string;
};

const EMPTY_LOAN_FORM: LoanForm = {
  open: false,
  loan_name: '', bank_name: '', principal: '', interest_rate: '',
  start_date: '', end_date: '', grace_period_months: '0',
  memo: '', saving: false, error: '',
};

type ScheduleRow = {
  seq: string;
  payment_date: string;
  principal: string;
  interest: string;
  total_payment: string;
  remaining_principal: string;
  is_grace_period: boolean;
  memo: string;
};

const EMPTY_SCHEDULE_ROW = (): ScheduleRow => ({
  seq: '', payment_date: '', principal: '0', interest: '0',
  total_payment: '0', remaining_principal: '0',
  is_grace_period: false, memo: '',
});

type ScheduleEditState = {
  loanId: number;
  rows: ScheduleRow[];
  saving: boolean;
  error: string;
};

type Props = { onDataChange?: () => void };

export default function LoanSection({ onDataChange }: Props) {
  const [loans, setLoans] = useState<LoanWithSchedules[]>([]);
  const [loading, setLoading] = useState(true);
  const [loanForm, setLoanForm] = useState<LoanForm>(EMPTY_LOAN_FORM);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [scheduleEdit, setScheduleEdit] = useState<ScheduleEditState | null>(null);
  const [savingPaidId, setSavingPaidId] = useState<number | null>(null);

  useEffect(() => { void fetchLoans(); }, []);

  async function fetchLoans() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('loans')
        .select('*, schedules:loan_schedules(*)')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      setLoans(((data ?? []) as LoanWithSchedules[]).map((l) => ({
        ...l,
        schedules: [...(l.schedules ?? [])].sort((a, b) => a.seq - b.seq),
      })));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveLoan() {
    const { loan_name, principal, interest_rate, start_date, end_date, grace_period_months, bank_name, memo } = loanForm;
    if (!loan_name.trim()) { setLoanForm((p) => ({ ...p, error: '대출명을 입력해줘.' })); return; }
    if (!principal || isNaN(Number(principal)) || Number(principal) <= 0) {
      setLoanForm((p) => ({ ...p, error: '원금을 입력해줘.' })); return;
    }
    setLoanForm((p) => ({ ...p, saving: true, error: '' }));
    try {
      const { data, error } = await supabase.from('loans').insert({
        loan_name: loan_name.trim(),
        bank_name: bank_name.trim() || null,
        principal: Number(principal),
        interest_rate: interest_rate ? Number(interest_rate) : null,
        start_date: start_date || null,
        end_date: end_date || null,
        grace_period_months: Number(grace_period_months) || 0,
        memo: memo.trim() || null,
        is_active: true,
      }).select('id').single();
      if (error) throw error;
      const newId = (data as { id: number }).id;
      setLoanForm(EMPTY_LOAN_FORM);
      await fetchLoans();
      setExpandedIds((prev) => new Set([...prev, newId]));
      setScheduleEdit({ loanId: newId, rows: [EMPTY_SCHEDULE_ROW()], saving: false, error: '' });
    } catch (e) {
      setLoanForm((p) => ({ ...p, saving: false, error: getErrorMessage(e) }));
    }
  }

  async function handleDeleteLoan(id: number) {
    if (!window.confirm('이 대출을 삭제할까요? (상환 스케줄 모두 삭제)')) return;
    await supabase.from('loans').delete().eq('id', id);
    await fetchLoans();
    onDataChange?.();
  }

  function openScheduleEdit(loan: LoanWithSchedules) {
    const rows: ScheduleRow[] = loan.schedules.length > 0
      ? loan.schedules.map((s) => ({
          seq: String(s.seq),
          payment_date: s.payment_date,
          principal: String(s.principal),
          interest: String(s.interest),
          total_payment: String(s.total_payment),
          remaining_principal: String(s.remaining_principal),
          is_grace_period: s.is_grace_period,
          memo: s.memo ?? '',
        }))
      : [EMPTY_SCHEDULE_ROW()];
    setScheduleEdit({ loanId: loan.id, rows, saving: false, error: '' });
  }

  async function handleSaveSchedule() {
    if (!scheduleEdit) return;
    for (const row of scheduleEdit.rows) {
      if (!row.payment_date || !row.seq) {
        setScheduleEdit((p) => p ? { ...p, error: '회차와 납입일을 모두 입력해줘.' } : null); return;
      }
    }
    setScheduleEdit((p) => p ? { ...p, saving: true, error: '' } : null);
    try {
      await supabase.from('loan_schedules').delete().eq('loan_id', scheduleEdit.loanId);
      const rows = scheduleEdit.rows.map((r) => ({
        loan_id: scheduleEdit.loanId,
        seq: Number(r.seq),
        payment_date: r.payment_date,
        principal: Number(r.principal) || 0,
        interest: Number(r.interest) || 0,
        total_payment: Number(r.total_payment) || 0,
        remaining_principal: Number(r.remaining_principal) || 0,
        is_grace_period: r.is_grace_period,
        memo: r.memo.trim() || null,
        is_paid: false,
      }));
      const { error } = await supabase.from('loan_schedules').insert(rows);
      if (error) throw error;
      setScheduleEdit(null);
      await fetchLoans();
      onDataChange?.();
    } catch (e) {
      setScheduleEdit((p) => p ? { ...p, saving: false, error: getErrorMessage(e) } : null);
    }
  }

  async function handleXlsxUpload(file: File, loanId: number) {
    try {
      const { default: XLSX } = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheetName = wb.SheetNames.find((n) => n === '상환스케줄') ?? wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

      // Skip header description row (2nd row has Korean descriptions)
      const dataRows = raw.filter((r) => {
        const seq = r['seq'] ?? r['회차'];
        return !isNaN(Number(seq)) && Number(seq) > 0;
      });

      const rows: ScheduleRow[] = dataRows.map((r) => ({
        seq: String(r['seq'] ?? r['회차'] ?? ''),
        payment_date: String(r['payment_date'] ?? r['납입일'] ?? ''),
        principal: String(r['principal'] ?? r['원금'] ?? '0'),
        interest: String(r['interest'] ?? r['이자'] ?? '0'),
        total_payment: String(r['total_payment'] ?? r['납입금액'] ?? '0'),
        remaining_principal: String(r['remaining_principal'] ?? r['잔여원금'] ?? '0'),
        is_grace_period: String(r['is_grace_period'] ?? '').toUpperCase() === 'TRUE',
        memo: String(r['memo'] ?? r['비고'] ?? ''),
      }));

      if (rows.length === 0) { alert('스케줄 데이터를 찾을 수 없어. 양식을 확인해줘.'); return; }
      setScheduleEdit({ loanId, rows, saving: false, error: '' });
    } catch (e) {
      alert(getErrorMessage(e));
    }
  }

  async function handleTogglePaid(schedule: LoanSchedule) {
    setSavingPaidId(schedule.id);
    const newVal = !schedule.is_paid;
    await supabase.from('loan_schedules').update({
      is_paid: newVal,
      paid_at: newVal ? new Date().toISOString() : null,
    }).eq('id', schedule.id);
    setSavingPaidId(null);
    await fetchLoans();
    onDataChange?.();
  }

  function getRemainingPrincipal(loan: LoanWithSchedules): number | null {
    const unpaid = loan.schedules.filter((s) => !s.is_paid);
    if (unpaid.length === 0) return 0;
    return unpaid[0].remaining_principal;
  }

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="mt-6 mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-neutral-800">🏦 대출 관리</h2>
        <button
          onClick={() => setLoanForm({ ...EMPTY_LOAN_FORM, open: true, start_date: todayString() })}
          className="rounded-2xl border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700"
        >+ 대출 추가</button>
      </div>

      {loading ? (
        <p className="text-xs text-neutral-400 py-4 text-center">불러오는 중…</p>
      ) : loans.length === 0 ? (
        <p className="text-xs text-neutral-400 py-4 text-center">등록된 대출이 없어.</p>
      ) : (
        <div className="space-y-3">
          {loans.map((loan) => {
            const remaining = getRemainingPrincipal(loan);
            const allPaid = loan.schedules.length > 0 && loan.schedules.every((s) => s.is_paid);
            const isExpanded = expandedIds.has(loan.id);
            const nextUnpaid = loan.schedules.find((s) => !s.is_paid);
            return (
              <div key={loan.id} className={cn('rounded-2xl border bg-white', allPaid ? 'border-neutral-100 opacity-60' : 'border-purple-100')}>
                <div className="flex items-center justify-between gap-2 px-4 py-3">
                  <button className="flex-1 text-left min-w-0" onClick={() => toggleExpand(loan.id)}>
                    <div className="flex items-center gap-2">
                      <span className={cn('text-sm font-semibold', allPaid ? 'text-neutral-400 line-through' : 'text-neutral-800')}>{loan.loan_name}</span>
                      {loan.bank_name && <span className="text-xs text-neutral-400">{loan.bank_name}</span>}
                      {allPaid && <span className="text-xs text-emerald-600 font-medium">완납</span>}
                    </div>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      {remaining != null && remaining > 0 && `잔여원금 ${formatCurrency(remaining)}원`}
                      {nextUnpaid && ` · 다음납입 ${nextUnpaid.payment_date.replace(/-/g, '.')}`}
                    </p>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openScheduleEdit(loan)}
                      className="rounded-xl border border-purple-200 bg-purple-50 px-2 py-1 text-xs font-semibold text-purple-700"
                    >스케줄</button>
                    <span className="text-neutral-400 text-sm">{isExpanded ? '▲' : '▼'}</span>
                    <button onClick={() => void handleDeleteLoan(loan.id)} className="text-xs text-neutral-300 hover:text-red-500">✕</button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-neutral-100 pb-3 pt-2">
                    {loan.memo && <p className="text-xs text-blue-600 px-4 mb-2">{loan.memo}</p>}
                    {loan.schedules.length === 0 ? (
                      <p className="text-xs text-neutral-400 text-center py-2">상환 스케줄 없음. 스케줄 버튼으로 입력해줘.</p>
                    ) : (
                      <div className="overflow-x-auto px-2">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-neutral-400 border-b border-neutral-100">
                              <th className="py-1 px-2 text-center font-medium">회차</th>
                              <th className="py-1 px-1 text-center font-medium">납입일</th>
                              <th className="py-1 px-1 text-right font-medium">납입금</th>
                              <th className="py-1 px-1 text-right font-medium">잔여원금</th>
                              <th className="py-1 px-1 text-center font-medium">납부</th>
                            </tr>
                          </thead>
                          <tbody>
                            {loan.schedules.map((s) => (
                              <tr key={s.id} className={cn('border-t border-neutral-50', s.is_paid && 'opacity-50')}>
                                <td className="py-1.5 px-2 text-center text-neutral-600">
                                  {s.seq}
                                  {s.is_grace_period && <span className="ml-1 text-neutral-400">(거)</span>}
                                </td>
                                <td className="py-1.5 px-1 text-center text-neutral-600">{s.payment_date.replace(/-/g, '.')}</td>
                                <td className="py-1.5 px-1 text-right text-neutral-700">{formatCurrency(s.total_payment)}</td>
                                <td className="py-1.5 px-1 text-right text-neutral-500">{formatCurrency(s.remaining_principal)}</td>
                                <td className="py-1.5 px-1 text-center">
                                  <button
                                    onClick={() => void handleTogglePaid(s)}
                                    disabled={savingPaidId === s.id}
                                    className={cn(
                                      'rounded-lg border px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50',
                                      s.is_paid ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-neutral-200 bg-white text-neutral-600',
                                    )}
                                  >{s.is_paid ? '✅' : '미납'}</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 대출 추가 모달 */}
      {loanForm.open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setLoanForm(EMPTY_LOAN_FORM)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-10 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-base font-bold">대출 추가</p>
              <button onClick={() => setLoanForm(EMPTY_LOAN_FORM)} className="text-neutral-400 text-lg">✕</button>
            </div>
            <div className="space-y-3">
              {[
                { label: '대출명', key: 'loan_name', placeholder: '예: 국민은행_운전자금', type: 'text' },
                { label: '은행명', key: 'bank_name', placeholder: '예: 국민은행', type: 'text' },
                { label: '원금', key: 'principal', placeholder: '0', type: 'number' },
                { label: '금리 (%)', key: 'interest_rate', placeholder: '예: 4.5', type: 'number' },
                { label: '거치기간 (개월)', key: 'grace_period_months', placeholder: '0', type: 'number' },
                { label: '시작일', key: 'start_date', placeholder: '', type: 'date' },
                { label: '종료일', key: 'end_date', placeholder: '', type: 'date' },
              ].map(({ label, key, placeholder, type }) => (
                <div key={key}>
                  <p className="mb-1 text-xs text-neutral-500">{label}</p>
                  <input
                    type={type}
                    placeholder={placeholder}
                    value={loanForm[key as keyof LoanForm] as string}
                    onChange={(e) => setLoanForm((p) => ({ ...p, [key]: e.target.value }))}
                    className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
                  />
                </div>
              ))}
              <div>
                <p className="mb-1 text-xs text-neutral-500">메모</p>
                <input
                  value={loanForm.memo}
                  onChange={(e) => setLoanForm((p) => ({ ...p, memo: e.target.value }))}
                  placeholder="메모 (선택)"
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
                />
              </div>
              {loanForm.error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loanForm.error}</div>
              )}
              <button
                onClick={() => void handleSaveLoan()}
                disabled={loanForm.saving}
                className="w-full rounded-2xl bg-neutral-900 px-4 py-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {loanForm.saving ? '저장중…' : '저장 후 스케줄 입력'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 스케줄 편집 모달 */}
      {scheduleEdit && (() => {
        const loan = loans.find((l) => l.id === scheduleEdit.loanId);
        return (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setScheduleEdit(null)}>
            <div className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-10 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-base font-bold">{loan?.loan_name} 상환 스케줄</p>
                <button onClick={() => setScheduleEdit(null)} className="text-neutral-400 text-lg">✕</button>
              </div>

              {/* 엑셀 업로드 */}
              <label className="mb-4 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-purple-300 bg-purple-50 px-4 py-3 text-xs font-semibold text-purple-700 cursor-pointer">
                📥 엑셀 업로드 (.xlsx)
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleXlsxUpload(f, scheduleEdit.loanId);
                    e.target.value = '';
                  }}
                />
              </label>

              {/* 수동 입력 테이블 */}
              <div className="space-y-2 mb-3">
                {scheduleEdit.rows.map((row, i) => (
                  <div key={i} className="rounded-2xl border border-neutral-100 bg-neutral-50 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-neutral-600">{i + 1}행</span>
                      <button
                        onClick={() => setScheduleEdit((p) => p ? { ...p, rows: p.rows.filter((_, j) => j !== i) } : null)}
                        className="text-xs text-neutral-300 hover:text-red-500"
                      >✕</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: '회차', field: 'seq', type: 'number' },
                        { label: '납입일', field: 'payment_date', type: 'date' },
                        { label: '원금', field: 'principal', type: 'number' },
                        { label: '이자', field: 'interest', type: 'number' },
                        { label: '납입금액', field: 'total_payment', type: 'number' },
                        { label: '잔여원금', field: 'remaining_principal', type: 'number' },
                      ].map(({ label, field, type }) => (
                        <div key={field}>
                          <p className="text-[10px] text-neutral-400 mb-0.5">{label}</p>
                          <input
                            type={type}
                            value={row[field as keyof ScheduleRow] as string}
                            onChange={(e) => setScheduleEdit((p) => {
                              if (!p) return null;
                              const rows = [...p.rows];
                              rows[i] = { ...rows[i], [field]: e.target.value };
                              return { ...p, rows };
                            })}
                            className="w-full rounded-xl border border-neutral-200 bg-white px-2 py-1.5 text-xs outline-none"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-neutral-600">
                        <input
                          type="checkbox"
                          checked={row.is_grace_period}
                          onChange={(e) => setScheduleEdit((p) => {
                            if (!p) return null;
                            const rows = [...p.rows];
                            rows[i] = { ...rows[i], is_grace_period: e.target.checked };
                            return { ...p, rows };
                          })}
                          className="accent-purple-500"
                        />
                        거치기간
                      </label>
                      <input
                        placeholder="메모"
                        value={row.memo}
                        onChange={(e) => setScheduleEdit((p) => {
                          if (!p) return null;
                          const rows = [...p.rows];
                          rows[i] = { ...rows[i], memo: e.target.value };
                          return { ...p, rows };
                        })}
                        className="flex-1 rounded-xl border border-neutral-200 bg-white px-2 py-1.5 text-xs outline-none"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setScheduleEdit((p) => p ? { ...p, rows: [...p.rows, EMPTY_SCHEDULE_ROW()] } : null)}
                className="mb-3 w-full rounded-2xl border border-neutral-200 bg-white py-2.5 text-xs font-semibold text-neutral-600"
              >+ 행 추가</button>

              {scheduleEdit.error && (
                <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{scheduleEdit.error}</div>
              )}

              <button
                onClick={() => void handleSaveSchedule()}
                disabled={scheduleEdit.saving}
                className="w-full rounded-2xl bg-neutral-900 px-4 py-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {scheduleEdit.saving ? '저장중…' : '스케줄 저장'}
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
