'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { TaxPayment, TaxSchedule, TaxType } from '../lib/types';
import { cn, formatCurrency, getErrorMessage, todayString } from '../lib/utils';

type TaxScheduleWithPayments = TaxSchedule & { payments: TaxPayment[] };

type InstallmentRow = { payment_date: string; amount: string; is_extended: boolean; memo: string };

type TaxForm = {
  open: boolean;
  tax_name: string;
  due_date: string;
  total_amount: string;
  memo: string;
  is_installment: boolean;
  installment_count: string;
  installments: InstallmentRow[];
  saving: boolean;
  error: string;
};

const EMPTY_FORM: TaxForm = {
  open: false,
  tax_name: '', due_date: '', total_amount: '', memo: '',
  is_installment: false, installment_count: '2',
  installments: [],
  saving: false, error: '',
};

type Props = { onDataChange?: () => void };

export default function TaxSection({ onDataChange }: Props) {
  const [schedules, setSchedules] = useState<TaxScheduleWithPayments[]>([]);
  const [taxTypes, setTaxTypes] = useState<TaxType[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<TaxForm>(EMPTY_FORM);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [savingPaidId, setSavingPaidId] = useState<number | null>(null);
  const [saveTypeModal, setSaveTypeModal] = useState<string | null>(null); // pending new tax name to save

  useEffect(() => { void fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      const [{ data: schData }, { data: typeData }] = await Promise.all([
        supabase.from('tax_schedules').select('*, payments:tax_payments(*)').order('due_date', { ascending: false }),
        supabase.from('tax_types').select('*').order('name'),
      ]);
      setSchedules(((schData ?? []) as TaxScheduleWithPayments[]).map((s) => ({
        ...s,
        payments: [...(s.payments ?? [])].sort((a, b) => a.seq - b.seq),
      })));
      setTaxTypes((typeData ?? []) as TaxType[]);
    } finally {
      setLoading(false);
    }
  }

  function openAddForm() {
    setForm({ ...EMPTY_FORM, open: true, due_date: todayString() });
  }

  function updateInstallmentRows(count: number, existingRows: InstallmentRow[]): InstallmentRow[] {
    const rows: InstallmentRow[] = [];
    for (let i = 0; i < count; i++) {
      rows.push(existingRows[i] ?? { payment_date: '', amount: '', is_extended: false, memo: '' });
    }
    return rows;
  }

  function handleInstallmentToggle(checked: boolean) {
    const count = Number(form.installment_count) || 2;
    setForm((p) => ({
      ...p,
      is_installment: checked,
      installments: checked ? updateInstallmentRows(count, p.installments) : [],
    }));
  }

  function handleInstallmentCountChange(val: string) {
    const count = Math.max(2, Number(val) || 2);
    setForm((p) => ({
      ...p,
      installment_count: String(count),
      installments: updateInstallmentRows(count, p.installments),
    }));
  }

  async function handleSave() {
    const { tax_name, due_date, total_amount, is_installment, installments } = form;
    if (!tax_name.trim()) { setForm((p) => ({ ...p, error: '세금명을 입력해줘.' })); return; }
    if (!due_date) { setForm((p) => ({ ...p, error: '납부 기한을 입력해줘.' })); return; }
    if (!total_amount || isNaN(Number(total_amount)) || Number(total_amount) <= 0) {
      setForm((p) => ({ ...p, error: '고지 금액을 입력해줘.' })); return;
    }
    if (is_installment) {
      for (const row of installments) {
        if (!row.payment_date || !row.amount || isNaN(Number(row.amount))) {
          setForm((p) => ({ ...p, error: '각 회차의 납부일과 금액을 모두 입력해줘.' })); return;
        }
      }
    }

    // 새 세금명이면 저장 여부 물어보기
    const isNewType = !taxTypes.find((t) => t.name === tax_name.trim());
    if (isNewType) {
      setSaveTypeModal(tax_name.trim());
      return;
    }
    await doSave(false);
  }

  async function doSave(saveType: boolean) {
    const { tax_name, due_date, total_amount, memo, is_installment, installments } = form;
    setForm((p) => ({ ...p, saving: true, error: '' }));
    setSaveTypeModal(null);
    try {
      if (saveType) {
        await supabase.from('tax_types').insert({ name: tax_name.trim() });
      }
      const typeRow = taxTypes.find((t) => t.name === tax_name.trim());
      const { data: schData, error: schErr } = await supabase.from('tax_schedules').insert({
        tax_type_id: typeRow?.id ?? null,
        tax_name: tax_name.trim(),
        due_date,
        total_amount: Number(total_amount),
        memo: memo.trim() || null,
      }).select('id').single();
      if (schErr) throw schErr;

      const scheduleId = (schData as { id: number }).id;

      if (is_installment) {
        const rows = installments.map((row, i) => ({
          tax_schedule_id: scheduleId,
          seq: i + 1,
          payment_date: row.payment_date,
          amount: Number(row.amount),
          is_paid: false,
          is_extended: row.is_extended,
          memo: row.memo.trim() || null,
        }));
        const { error: pmtErr } = await supabase.from('tax_payments').insert(rows);
        if (pmtErr) throw pmtErr;
      } else {
        const { error: pmtErr } = await supabase.from('tax_payments').insert({
          tax_schedule_id: scheduleId,
          seq: 1,
          payment_date: due_date,
          amount: Number(total_amount),
          is_paid: false,
          is_extended: false,
          memo: memo.trim() || null,
        });
        if (pmtErr) throw pmtErr;
      }

      setForm(EMPTY_FORM);
      await fetchAll();
      onDataChange?.();
    } catch (e) {
      setForm((p) => ({ ...p, saving: false, error: getErrorMessage(e) }));
    }
  }

  async function handleTogglePaid(payment: TaxPayment) {
    setSavingPaidId(payment.id);
    const newVal = !payment.is_paid;
    await supabase.from('tax_payments').update({
      is_paid: newVal,
      paid_at: newVal ? new Date().toISOString() : null,
    }).eq('id', payment.id);
    setSavingPaidId(null);
    await fetchAll();
    onDataChange?.();
  }

  async function handleDeleteSchedule(id: number) {
    if (!window.confirm('이 세금 일정을 삭제할까요? (관련 납부 내역 모두 삭제)')) return;
    await supabase.from('tax_schedules').delete().eq('id', id);
    await fetchAll();
    onDataChange?.();
  }

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-neutral-800">💸 세금 관리</h2>
        <button
          onClick={openAddForm}
          className="rounded-2xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700"
        >+ 세금 추가</button>
      </div>

      {loading ? (
        <p className="text-xs text-neutral-400 py-4 text-center">불러오는 중…</p>
      ) : schedules.length === 0 ? (
        <p className="text-xs text-neutral-400 py-4 text-center">등록된 세금 일정이 없어.</p>
      ) : (
        <div className="space-y-3">
          {schedules.map((sch) => {
            const allPaid = sch.payments.length > 0 && sch.payments.every((p) => p.is_paid);
            const isExpanded = expandedIds.has(sch.id);
            return (
              <div key={sch.id} className={cn('rounded-2xl border bg-white', allPaid ? 'border-neutral-100 opacity-60' : 'border-red-100')}>
                <div className="flex items-center justify-between gap-2 px-4 py-3">
                  <button className="flex-1 text-left min-w-0" onClick={() => toggleExpand(sch.id)}>
                    <div className="flex items-center gap-2">
                      <span className={cn('text-sm font-semibold', allPaid ? 'text-neutral-400 line-through' : 'text-neutral-800')}>{sch.tax_name}</span>
                      {allPaid && <span className="text-xs text-emerald-600 font-medium">완납</span>}
                    </div>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      기한 {sch.due_date.replace(/-/g, '.')} · {formatCurrency(sch.total_amount)}원
                    </p>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-neutral-400 text-sm">{isExpanded ? '▲' : '▼'}</span>
                    <button
                      onClick={() => void handleDeleteSchedule(sch.id)}
                      className="text-xs text-neutral-300 hover:text-red-500"
                    >✕</button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-neutral-100 px-4 pb-3 pt-2 space-y-2">
                    {sch.memo && <p className="text-xs text-blue-600">{sch.memo}</p>}
                    {sch.payments.map((pmt) => (
                      <div key={pmt.id} className="flex items-center justify-between gap-2 rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-neutral-600">
                            {sch.payments.length > 1 && <span className="font-semibold mr-1">{pmt.seq}회차</span>}
                            {pmt.payment_date.replace(/-/g, '.')} · {formatCurrency(pmt.amount)}원
                            {pmt.is_extended && <span className="ml-1 text-orange-500">연장</span>}
                          </p>
                          {pmt.memo && <p className="text-[11px] text-neutral-400">{pmt.memo}</p>}
                          {pmt.is_paid && pmt.paid_at && (
                            <p className="text-[11px] text-emerald-600">납부 {pmt.paid_at.slice(0, 10).replace(/-/g, '.')}</p>
                          )}
                        </div>
                        <button
                          onClick={() => void handleTogglePaid(pmt)}
                          disabled={savingPaidId === pmt.id}
                          className={cn(
                            'shrink-0 rounded-xl border px-3 py-1.5 text-xs font-semibold disabled:opacity-50',
                            pmt.is_paid
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                              : 'border-neutral-200 bg-white text-neutral-600',
                          )}
                        >
                          {pmt.is_paid ? '✅ 납부' : '미납'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 세금 추가 모달 */}
      {form.open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setForm(EMPTY_FORM)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-10 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-base font-bold">세금 일정 추가</p>
              <button onClick={() => setForm(EMPTY_FORM)} className="text-neutral-400 text-lg">✕</button>
            </div>

            <div className="space-y-3">
              {/* 세금명 */}
              <div>
                <p className="mb-1 text-xs text-neutral-500">세금명</p>
                <input
                  list="tax-type-list"
                  value={form.tax_name}
                  onChange={(e) => setForm((p) => ({ ...p, tax_name: e.target.value }))}
                  placeholder="세금명 입력 또는 선택"
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
                />
                <datalist id="tax-type-list">
                  {taxTypes.map((t) => <option key={t.id} value={t.name} />)}
                </datalist>
              </div>

              {/* 납부 기한 */}
              <div>
                <p className="mb-1 text-xs text-neutral-500">납부 기한</p>
                <input
                  type="date"
                  value={form.due_date}
                  onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))}
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
                />
              </div>

              {/* 고지 금액 */}
              <div>
                <p className="mb-1 text-xs text-neutral-500">고지 금액</p>
                <input
                  type="number"
                  value={form.total_amount}
                  onChange={(e) => setForm((p) => ({ ...p, total_amount: e.target.value }))}
                  placeholder="0"
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
                />
              </div>

              {/* 분할납부 */}
              <div className="flex items-center justify-between rounded-2xl border border-neutral-200 bg-white px-4 py-3">
                <span className="text-sm text-neutral-700">분할납부</span>
                <button
                  onClick={() => handleInstallmentToggle(!form.is_installment)}
                  className={cn('w-12 h-6 rounded-full transition-colors relative', form.is_installment ? 'bg-red-500' : 'bg-neutral-200')}
                >
                  <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', form.is_installment ? 'translate-x-6' : 'translate-x-0.5')} />
                </button>
              </div>

              {form.is_installment && (
                <>
                  <div>
                    <p className="mb-1 text-xs text-neutral-500">회차 수</p>
                    <input
                      type="number"
                      min="2"
                      value={form.installment_count}
                      onChange={(e) => handleInstallmentCountChange(e.target.value)}
                      className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
                    />
                  </div>
                  {form.installments.map((row, i) => (
                    <div key={i} className="rounded-2xl border border-neutral-100 bg-neutral-50 p-3 space-y-2">
                      <p className="text-xs font-semibold text-neutral-600">{i + 1}회차</p>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="date"
                          value={row.payment_date}
                          onChange={(e) => setForm((p) => {
                            const rows = [...p.installments];
                            rows[i] = { ...rows[i], payment_date: e.target.value };
                            return { ...p, installments: rows };
                          })}
                          className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs outline-none"
                        />
                        <input
                          type="number"
                          placeholder="금액"
                          value={row.amount}
                          onChange={(e) => setForm((p) => {
                            const rows = [...p.installments];
                            rows[i] = { ...rows[i], amount: e.target.value };
                            return { ...p, installments: rows };
                          })}
                          className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-xs text-neutral-600">
                          <input
                            type="checkbox"
                            checked={row.is_extended}
                            onChange={(e) => setForm((p) => {
                              const rows = [...p.installments];
                              rows[i] = { ...rows[i], is_extended: e.target.checked };
                              return { ...p, installments: rows };
                            })}
                            className="accent-orange-500"
                          />
                          기일연장
                        </label>
                        <input
                          placeholder="메모"
                          value={row.memo}
                          onChange={(e) => setForm((p) => {
                            const rows = [...p.installments];
                            rows[i] = { ...rows[i], memo: e.target.value };
                            return { ...p, installments: rows };
                          })}
                          className="flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-xs outline-none"
                        />
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* 메모 */}
              <div>
                <p className="mb-1 text-xs text-neutral-500">메모</p>
                <input
                  value={form.memo}
                  onChange={(e) => setForm((p) => ({ ...p, memo: e.target.value }))}
                  placeholder="메모 (선택)"
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
                />
              </div>

              {form.error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{form.error}</div>
              )}

              <button
                onClick={() => void handleSave()}
                disabled={form.saving}
                className="w-full rounded-2xl bg-neutral-900 px-4 py-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {form.saving ? '저장중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 새 세금명 저장 여부 모달 */}
      {saveTypeModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-xl">
            <p className="text-sm font-bold mb-2">세금명 저장</p>
            <p className="text-sm text-neutral-600 mb-4">
              <b>{saveTypeModal}</b>을(를) 세금 목록에 저장할까요?
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => void doSave(true)}
                className="rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white"
              >저장</button>
              <button
                onClick={() => void doSave(false)}
                className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-700"
              >이번만 사용</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
