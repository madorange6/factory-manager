'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { CashFlow, Invoice, InvoiceItem, Payment } from '../lib/types';
import { cn, formatCurrency, getErrorMessage, todayString } from '../lib/utils';

type InvoiceWithDetails = Invoice & { items: InvoiceItem[]; payments: Payment[] };
type FactoryFilter = 'all' | '1공장' | '2공장';
type InvoiceTypeFilter = 'all' | 'receivable' | 'payable';

type CfModal = {
  open: boolean;
  editingId: number | null;
  date: string;
  amount: string;       // 양수 입력, typeSign으로 부호 결정
  typeSign: 1 | -1;     // 1=수입, -1=지출
  category: string;
  memo: string;
  isRecurring: boolean;
  recurringDay: string;
  saving: boolean;
  error: string;
};

const EMPTY_CF_MODAL: CfModal = {
  open: false,
  editingId: null,
  date: todayString(),
  amount: '',
  typeSign: 1,
  category: '',
  memo: '',
  isRecurring: false,
  recurringDay: '',
  saving: false,
  error: '',
};

// 반복 항목 수정/삭제 시 선택 모달
type RecurringAction = { type: 'edit' | 'delete'; cashFlow: CashFlow } | null;

function calcTotal(items: InvoiceItem[]) {
  return items.reduce((s, i) => s + Number(i.supply_amount) + Number(i.tax_amount), 0);
}
function calcPaid(payments: Payment[]) {
  return payments.reduce((s, p) => s + Number(p.amount), 0);
}

export default function FinanceCalendarTab() {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [factoryFilter, setFactoryFilter] = useState<FactoryFilter>('all');
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceTypeFilter>('all');

  const [invoices, setInvoices] = useState<InvoiceWithDetails[]>([]);
  const [cashFlows, setCashFlows] = useState<CashFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');

  const [cfModal, setCfModal] = useState<CfModal>(EMPTY_CF_MODAL);
  const [recurringAction, setRecurringAction] = useState<RecurringAction>(null);
  const [editAllCf, setEditAllCf] = useState<CashFlow | null>(null); // "앞으로 모두 수정" 대상
  const [deletingCfId, setDeletingCfId] = useState<number | null>(null);

  // ── 패치 ──
  async function fetchInvoices() {
    const { data, error } = await supabase
      .from('invoices')
      .select('*, items:invoice_items(*), payments:payments(*)')
      .not('due_date', 'is', null)
      .order('due_date', { ascending: true });
    if (error) throw error;
    setInvoices((data ?? []) as InvoiceWithDetails[]);
  }

  const fetchCashFlows = useCallback(async (y: number, m: number) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const from = `${y}-${pad(m + 1)}-01`;
    const to = `${y}-${pad(m + 1)}-31`;
    const { data, error } = await supabase
      .from('cash_flows')
      .select('*')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true });
    if (error) throw error;
    setCashFlows((data ?? []) as CashFlow[]);
  }, []);

  // 반복 항목 자동생성 (마운트 시 이번 달만)
  async function ensureRecurringCashFlows(y: number, m: number) {
    const pad = (n: number) => String(n).padStart(2, '0');
    const { data: templates } = await supabase
      .from('cash_flows')
      .select('*')
      .eq('is_recurring', true);
    if (!templates || templates.length === 0) return;

    const from = `${y}-${pad(m + 1)}-01`;
    const to = `${y}-${pad(m + 1)}-31`;
    const { data: existing } = await supabase
      .from('cash_flows')
      .select('recurring_day, date')
      .gte('date', from)
      .lte('date', to);

    const existingDays = new Set(
      (existing ?? [])
        .filter((e) => e.recurring_day != null)
        .map((e) => e.recurring_day as number)
    );

    for (const tmpl of templates as CashFlow[]) {
      if (!tmpl.recurring_day) continue;
      // 템플릿 자체가 이번 달이면 스킵
      if (tmpl.date.startsWith(`${y}-${pad(m + 1)}`)) continue;
      if (existingDays.has(tmpl.recurring_day)) continue;

      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const day = Math.min(tmpl.recurring_day, daysInMonth);
      const dateStr = `${y}-${pad(m + 1)}-${pad(day)}`;
      await supabase.from('cash_flows').insert({
        date: dateStr,
        amount: tmpl.amount,
        category: tmpl.category,
        memo: tmpl.memo,
        is_recurring: false,
        recurring_day: tmpl.recurring_day,
      });
    }
  }

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);
        await Promise.all([
          fetchInvoices(),
          fetchCashFlows(today.getFullYear(), today.getMonth()),
          ensureRecurringCashFlows(today.getFullYear(), today.getMonth()),
        ]);
      } catch (e) {
        setErrorText(getErrorMessage(e));
      } finally {
        setLoading(false);
      }
    };
    void init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 월 이동 시 cash_flows 재패치
  useEffect(() => {
    void fetchCashFlows(year, month).catch((e) => setErrorText(getErrorMessage(e)));
  }, [year, month, fetchCashFlows]);

  // ── 달력 계산 ──
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const filteredInvoices = invoices.filter((inv) =>
    factoryFilter === 'all' ? true : inv.factory === factoryFilter
  );

  const invoiceDates = new Set<string>();
  filteredInvoices.forEach((inv) => {
    if (!inv.due_date) return;
    const key = inv.due_date.slice(0, 10);
    const [y, m] = key.split('-').map(Number);
    if (y === year && m === month + 1) invoiceDates.add(key);
  });

  const cashFlowDates = new Set<string>(cashFlows.map((cf) => cf.date.slice(0, 10)));

  function toDateKey(day: number) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
    setSelectedDate(null);
  }
  function nextMonth() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
    setSelectedDate(null);
  }

  const selectedInvoices = selectedDate
    ? filteredInvoices.filter((inv) => inv.due_date?.slice(0, 10) === selectedDate)
    : [];
  const selectedCashFlows = selectedDate
    ? cashFlows.filter((cf) => cf.date.slice(0, 10) === selectedDate)
    : [];

  const cells: Array<number | null> = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);

  const MONTH_NAMES = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const DOW_LABELS = ['일','월','화','수','목','금','토'];

  // ── cash_flows CRUD ──
  function openAddCf(date?: string) {
    setCfModal({ ...EMPTY_CF_MODAL, open: true, date: date ?? selectedDate ?? todayString() });
  }
  function openEditCf(cf: CashFlow) {
    const isRecurringRelated = cf.is_recurring || (cf.recurring_day != null);
    if (isRecurringRelated) {
      setRecurringAction({ type: 'edit', cashFlow: cf });
      return;
    }
    setCfModal({
      open: true,
      editingId: cf.id,
      date: cf.date,
      amount: String(Math.abs(cf.amount)),
      typeSign: cf.amount >= 0 ? 1 : -1,
      category: cf.category ?? '',
      memo: cf.memo ?? '',
      isRecurring: false,
      recurringDay: '',
      saving: false,
      error: '',
    });
  }
  function openEditCfDirect(cf: CashFlow) {
    setCfModal({
      open: true,
      editingId: cf.id,
      date: cf.date,
      amount: String(Math.abs(cf.amount)),
      typeSign: cf.amount >= 0 ? 1 : -1,
      category: cf.category ?? '',
      memo: cf.memo ?? '',
      isRecurring: cf.is_recurring,
      recurringDay: cf.recurring_day ? String(cf.recurring_day) : '',
      saving: false,
      error: '',
    });
  }

  async function handleSaveCf() {
    const amt = Number(cfModal.amount);
    if (!cfModal.amount || isNaN(amt) || amt <= 0) {
      setCfModal((p) => ({ ...p, error: '금액을 입력해줘.' })); return;
    }
    if (!cfModal.date) {
      setCfModal((p) => ({ ...p, error: '날짜를 입력해줘.' })); return;
    }
    if (cfModal.isRecurring && (!cfModal.recurringDay || isNaN(Number(cfModal.recurringDay)))) {
      setCfModal((p) => ({ ...p, error: '반복 날짜(1~31)를 입력해줘.' })); return;
    }

    try {
      setCfModal((p) => ({ ...p, saving: true, error: '' }));
      const payload = {
        date: cfModal.date,
        amount: cfModal.typeSign * amt,
        category: cfModal.category.trim() || null,
        memo: cfModal.memo.trim() || null,
        is_recurring: cfModal.isRecurring,
        recurring_day: cfModal.isRecurring ? Number(cfModal.recurringDay) : null,
      };
      if (cfModal.editingId) {
        const { error } = await supabase.from('cash_flows').update(payload).eq('id', cfModal.editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('cash_flows').insert(payload);
        if (error) throw error;
      }
      // "앞으로 모두 수정" — 템플릿도 업데이트
      if (editAllCf?.recurring_day) {
        await supabase.from('cash_flows').update({
          amount: cfModal.typeSign * amt,
          category: cfModal.category.trim() || null,
          memo: cfModal.memo.trim() || null,
        }).eq('is_recurring', true).eq('recurring_day', editAllCf.recurring_day);
      }
      setEditAllCf(null);
      setCfModal(EMPTY_CF_MODAL);
      await fetchCashFlows(year, month);
    } catch (e) {
      setCfModal((p) => ({ ...p, saving: false, error: getErrorMessage(e) }));
    }
  }

  async function handleDeleteCf(id: number) {
    const cf = cashFlows.find((c) => c.id === id);
    if (!cf) return;
    if (cf.is_recurring || cf.recurring_day != null) {
      setRecurringAction({ type: 'delete', cashFlow: cf });
      return;
    }
    if (!window.confirm('이 현금흐름 항목을 삭제할까요?')) return;
    try {
      setDeletingCfId(id);
      const { error } = await supabase.from('cash_flows').delete().eq('id', id);
      if (error) throw error;
      await fetchCashFlows(year, month);
    } catch (e) {
      setErrorText(getErrorMessage(e));
    } finally {
      setDeletingCfId(null);
    }
  }

  async function handleDeleteSingle(cf: CashFlow) {
    try {
      setDeletingCfId(cf.id);
      const { error } = await supabase.from('cash_flows').delete().eq('id', cf.id);
      if (error) throw error;
      setRecurringAction(null);
      await fetchCashFlows(year, month);
    } catch (e) {
      setErrorText(getErrorMessage(e));
    } finally {
      setDeletingCfId(null);
    }
  }

  async function handleDisableRecurring(cf: CashFlow) {
    try {
      if (cf.recurring_day) {
        await supabase.from('cash_flows').update({ is_recurring: false }).eq('is_recurring', true).eq('recurring_day', cf.recurring_day);
      }
      if (cf.is_recurring) {
        await supabase.from('cash_flows').delete().eq('id', cf.id);
      }
      setRecurringAction(null);
      await fetchCashFlows(year, month);
    } catch (e) {
      setErrorText(getErrorMessage(e));
    }
  }

  // ── 합계 계산 ──
  function calcDateNetTotal(invs: InvoiceWithDetails[], cfs: CashFlow[]) {
    const invNet = invs.reduce((s, inv) => {
      const rem = Math.max(0, calcTotal(inv.items) - calcPaid(inv.payments));
      return s + (inv.direction === 'receivable' ? rem : -rem);
    }, 0);
    const cfNet = cfs.reduce((s, cf) => s + Number(cf.amount), 0);
    return invNet + cfNet;
  }

  if (loading) return <div className="px-4 py-10 text-center text-sm text-neutral-500">불러오는 중…</div>;

  return (
    <div className="px-3 py-4">
      {errorText && (
        <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorText}</div>
      )}

      {/* 공장 필터 */}
      <div className="mb-3 flex gap-2">
        {([['all', '전체'], ['1공장', '1공장'], ['2공장', '2공장']] as [FactoryFilter, string][]).map(([val, label]) => (
          <button key={val} onClick={() => setFactoryFilter(val)}
            className={cn('flex-1 rounded-2xl border py-2 text-sm font-medium', factoryFilter === val ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-600')}>
            {label}
          </button>
        ))}
      </div>

      {/* 월 네비게이션 */}
      <div className="mb-4 flex items-center justify-between">
        <button onClick={prevMonth} className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700">← 이전</button>
        <p className="text-base font-bold">{year}년 {MONTH_NAMES[month]}</p>
        <button onClick={nextMonth} className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700">다음 →</button>
      </div>

      {/* 달력 */}
      <div className="rounded-3xl border border-neutral-200 bg-white p-3 shadow-sm">
        <div className="grid grid-cols-7 mb-2">
          {DOW_LABELS.map((d, i) => (
            <p key={d} className={cn('text-center text-xs font-semibold py-1', i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-neutral-500')}>{d}</p>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {cells.map((day, idx) => {
            if (day === null) return <div key={`empty-${idx}`} />;
            const key = toDateKey(day);
            const hasInvoice = invoiceDates.has(key);
            const hasCf = cashFlowDates.has(key);
            const isToday = key === todayKey;
            const isSelected = key === selectedDate;
            const dow = (startDow + day - 1) % 7;
            return (
              <button key={key} onClick={() => setSelectedDate(isSelected ? null : key)}
                className={cn('flex flex-col items-center justify-center rounded-2xl py-2 transition',
                  isSelected && 'bg-neutral-900',
                  !isSelected && isToday && 'border border-neutral-400',
                  !isSelected && !isToday && 'hover:bg-neutral-50',
                )}>
                <span className={cn('text-sm font-medium', isSelected ? 'text-white' : dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-neutral-800')}>
                  {day}
                </span>
                {(hasInvoice || hasCf) && (
                  <div className="flex gap-0.5 mt-0.5">
                    {hasInvoice && <span className={cn('h-1.5 w-1.5 rounded-full', isSelected ? 'bg-white' : 'bg-blue-400')} />}
                    {hasCf && <span className={cn('h-1.5 w-1.5 rounded-full', isSelected ? 'bg-white' : 'bg-teal-400')} />}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 점 범례 */}
      <div className="mt-2 flex gap-3 justify-end px-1">
        <div className="flex items-center gap-1 text-[11px] text-neutral-400">
          <span className="h-2 w-2 rounded-full bg-blue-400 inline-block" />정산
        </div>
        <div className="flex items-center gap-1 text-[11px] text-neutral-400">
          <span className="h-2 w-2 rounded-full bg-teal-400 inline-block" />현금흐름
        </div>
      </div>

      {/* 선택 날짜 내역 */}
      {selectedDate && (
        <div className="mt-4 space-y-4">
          {/* 헤더 */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-neutral-700">{selectedDate.replace(/-/g, '/')} 내역</p>
            <button onClick={() => openAddCf(selectedDate)}
              className="rounded-2xl border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700">
              + 현금흐름
            </button>
          </div>

          {/* ── 정산 내역 ── */}
          {selectedInvoices.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-neutral-500 uppercase tracking-wide">정산</p>

              {/* [전체][미수금][미지급] 탭 */}
              {(() => {
                const receivableSum = selectedInvoices.filter((inv) => inv.direction === 'receivable')
                  .reduce((s, inv) => s + Math.max(0, calcTotal(inv.items) - calcPaid(inv.payments)), 0);
                const payableSum = selectedInvoices.filter((inv) => inv.direction === 'payable')
                  .reduce((s, inv) => s + Math.max(0, calcTotal(inv.items) - calcPaid(inv.payments)), 0);
                const netSum = receivableSum - payableSum;
                const displayLabel = invoiceFilter === 'receivable' ? '미수금 합계' : invoiceFilter === 'payable' ? '미지급 합계' : '합계';
                const displayValue = invoiceFilter === 'receivable'
                  ? `${formatCurrency(receivableSum)}원`
                  : invoiceFilter === 'payable'
                  ? `-${formatCurrency(payableSum)}원`
                  : `${netSum < 0 ? '-' : ''}${formatCurrency(Math.abs(netSum))}원`;
                const displayColor = (invoiceFilter === 'payable' || netSum < 0) ? 'text-orange-600' : 'text-neutral-800';
                const displayInvoices = selectedInvoices.filter((inv) =>
                  invoiceFilter === 'all' ? true : inv.direction === invoiceFilter
                );
                return (
                  <>
                    <div className="mb-2 flex gap-2">
                      {([['all', '전체'], ['receivable', '미수금'], ['payable', '미지급']] as [InvoiceTypeFilter, string][]).map(([val, label]) => (
                        <button key={val} onClick={() => setInvoiceFilter(val)}
                          className={cn('flex-1 rounded-2xl border py-1.5 text-xs font-semibold', invoiceFilter === val ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-600')}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="mb-2 rounded-2xl border border-neutral-100 bg-neutral-50 px-4 py-2 text-sm">
                      <span className="text-neutral-500">{displayLabel}: </span>
                      <span className={cn('font-bold', displayColor)}>{displayValue}</span>
                    </div>
                    <div className="space-y-3">
                      {displayInvoices.length === 0 ? (
                        <p className="text-sm text-neutral-400 text-center py-2">해당 항목 없음</p>
                      ) : displayInvoices.map((inv) => {
                        const total = calcTotal(inv.items);
                        const paid = calcPaid(inv.payments);
                        const remaining = Math.max(0, total - paid);
                        return (
                          <div key={inv.id} className={cn('rounded-3xl border bg-white p-4 shadow-sm', inv.payment_done ? 'border-neutral-100 opacity-60' : 'border-neutral-200')}>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <p className="text-base font-bold truncate flex-1">{inv.company_name}</p>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', inv.direction === 'receivable' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
                                  {inv.direction === 'receivable' ? '매출' : '매입'}
                                </span>
                                {inv.factory && (
                                  <span className="rounded-full border border-neutral-200 px-2 py-0.5 text-xs text-neutral-500">{inv.factory}</span>
                                )}
                              </div>
                            </div>
                            <div className="space-y-1 text-sm">
                              <div className="flex justify-between text-neutral-600">
                                <span>전체 금액</span>
                                <span className="font-semibold">{inv.direction === 'payable' ? '-' : ''}{formatCurrency(total)}원</span>
                              </div>
                              <div className="flex justify-between">
                                <span className={remaining > 0 ? 'text-orange-600' : 'text-emerald-600'}>
                                  {inv.direction === 'receivable' ? '미수금' : '미지급금'}
                                </span>
                                <span className={cn('font-bold', remaining > 0 ? 'text-orange-600' : 'text-emerald-600')}>
                                  {remaining > 0 ? `${inv.direction === 'payable' ? '-' : ''}${formatCurrency(remaining)}원` : '완납'}
                                </span>
                              </div>
                            </div>
                            <div className="mt-2 flex items-center gap-2 flex-wrap">
                              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', inv.invoice_issued ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-500')}>
                                {inv.invoice_issued ? '계산서 발행' : '미발행'}
                              </span>
                              {inv.note && <span className="text-xs text-blue-600">{inv.note}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* ── 현금흐름 내역 ── */}
          {selectedCashFlows.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-neutral-500 uppercase tracking-wide">현금흐름</p>
              <div className="space-y-2">
                {selectedCashFlows.map((cf) => {
                  const isIncome = Number(cf.amount) >= 0;
                  const isRecurringRelated = cf.is_recurring || (cf.recurring_day != null);
                  return (
                    <div key={cf.id} className="rounded-3xl border border-blue-100 bg-blue-50 p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            {cf.category && (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">{cf.category}</span>
                            )}
                            {isRecurringRelated && (
                              <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700">반복</span>
                            )}
                          </div>
                          {cf.memo && <p className="text-xs text-blue-600 truncate">{cf.memo}</p>}
                        </div>
                        <p className={cn('text-base font-bold shrink-0', isIncome ? 'text-blue-500' : 'text-blue-700')}>
                          {isIncome ? '+' : ''}{formatCurrency(Number(cf.amount))}원
                        </p>
                      </div>
                      <div className="mt-2 flex gap-2 justify-end">
                        <button onClick={() => openEditCf(cf)}
                          className="rounded-xl border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700">수정</button>
                        <button onClick={() => void handleDeleteCf(cf.id)} disabled={deletingCfId === cf.id}
                          className="rounded-xl border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 disabled:opacity-50">
                          {deletingCfId === cf.id ? '삭제중' : '삭제'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── 날짜 없을 때 ── */}
          {selectedInvoices.length === 0 && selectedCashFlows.length === 0 && (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-4 py-6 text-center text-sm text-neutral-500">
              이 날 내역이 없어.
            </div>
          )}

          {/* ── 순합계 ── */}
          {(selectedInvoices.length > 0 || selectedCashFlows.length > 0) && (
            <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3">
              <div className="flex justify-between items-center text-sm">
                <span className="font-semibold text-neutral-700">순합계</span>
                <span className={cn('font-bold text-base', calcDateNetTotal(selectedInvoices, selectedCashFlows) < 0 ? 'text-orange-600' : 'text-emerald-600')}>
                  {(() => {
                    const net = calcDateNetTotal(selectedInvoices, selectedCashFlows);
                    return `${net < 0 ? '-' : '+'}${formatCurrency(Math.abs(net))}원`;
                  })()}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 현금흐름 추가/수정 모달 ── */}
      {cfModal.open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setCfModal(EMPTY_CF_MODAL)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-10" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-base font-bold">{cfModal.editingId ? '현금흐름 수정' : '현금흐름 추가'}</p>
              <button onClick={() => setCfModal(EMPTY_CF_MODAL)} className="rounded-full border border-neutral-200 px-3 py-1 text-xs">닫기</button>
            </div>
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-xs text-neutral-500">날짜</p>
                <input type="date" value={cfModal.date}
                  onChange={(e) => setCfModal((p) => ({ ...p, date: e.target.value }))}
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400" />
              </div>
              <div>
                <p className="mb-1 text-xs text-neutral-500">구분</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setCfModal((p) => ({ ...p, typeSign: 1 }))}
                    className={cn('rounded-2xl border py-2.5 text-sm font-semibold', cfModal.typeSign === 1 ? 'border-blue-500 bg-blue-500 text-white' : 'border-neutral-200 bg-white text-neutral-700')}>
                    + 수입
                  </button>
                  <button onClick={() => setCfModal((p) => ({ ...p, typeSign: -1 }))}
                    className={cn('rounded-2xl border py-2.5 text-sm font-semibold', cfModal.typeSign === -1 ? 'border-blue-700 bg-blue-700 text-white' : 'border-neutral-200 bg-white text-neutral-700')}>
                    - 지출
                  </button>
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs text-neutral-500">금액 *</p>
                <input type="number" inputMode="decimal" placeholder="금액 입력" value={cfModal.amount}
                  onChange={(e) => setCfModal((p) => ({ ...p, amount: e.target.value }))}
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400" autoFocus />
              </div>
              <div>
                <p className="mb-1 text-xs text-neutral-500">카테고리 (선택)</p>
                <input placeholder="이자, 재비용, 기타수입 등" value={cfModal.category}
                  onChange={(e) => setCfModal((p) => ({ ...p, category: e.target.value }))}
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400" />
              </div>
              <div>
                <p className="mb-1 text-xs text-neutral-500">메모 (선택)</p>
                <input placeholder="메모" value={cfModal.memo}
                  onChange={(e) => setCfModal((p) => ({ ...p, memo: e.target.value }))}
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400" />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCfModal((p) => ({ ...p, isRecurring: !p.isRecurring }))}
                  className={cn('w-5 h-5 rounded border-2 shrink-0 flex items-center justify-center', cfModal.isRecurring ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300 bg-white')}
                >
                  {cfModal.isRecurring && <span className="text-white text-xs">✓</span>}
                </button>
                <span className="text-sm text-neutral-700">매월 반복</span>
              </div>
              {cfModal.isRecurring && (
                <div>
                  <p className="mb-1 text-xs text-neutral-500">반복 날짜 (매월 몇 일)</p>
                  <input type="number" inputMode="numeric" placeholder="예: 25" min={1} max={31} value={cfModal.recurringDay}
                    onChange={(e) => setCfModal((p) => ({ ...p, recurringDay: e.target.value }))}
                    className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400" />
                </div>
              )}
              {cfModal.error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{cfModal.error}</div>
              )}
              <button onClick={() => void handleSaveCf()} disabled={cfModal.saving}
                className="w-full rounded-2xl bg-neutral-900 px-4 py-4 text-sm font-semibold text-white disabled:opacity-50">
                {cfModal.saving ? '저장중' : cfModal.editingId ? '수정 저장' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 반복 항목 액션 선택 모달 ── */}
      {recurringAction && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setRecurringAction(null)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-10" onClick={(e) => e.stopPropagation()}>
            {recurringAction.type === 'delete' ? (
              <>
                <p className="text-base font-bold mb-1">반복 항목 삭제</p>
                <p className="text-sm text-neutral-600 mb-4">어떻게 삭제할까요?</p>
                <div className="space-y-2">
                  <button
                    onClick={() => void handleDeleteSingle(recurringAction.cashFlow)}
                    disabled={deletingCfId !== null}
                    className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold text-neutral-700 disabled:opacity-50">
                    이번 건만 삭제
                  </button>
                  <button
                    onClick={() => void handleDisableRecurring(recurringAction.cashFlow)}
                    className="w-full rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white">
                    반복 설정 해제
                  </button>
                  <button onClick={() => setRecurringAction(null)}
                    className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-500">
                    취소
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-base font-bold mb-1">반복 항목 수정</p>
                <p className="text-sm text-neutral-600 mb-4">어떻게 수정할까요?</p>
                <div className="space-y-2">
                  <button
                    onClick={() => { openEditCfDirect(recurringAction.cashFlow); setRecurringAction(null); }}
                    className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold text-neutral-700">
                    이번 건만 수정
                  </button>
                  <button
                    onClick={() => { setEditAllCf(recurringAction.cashFlow); openEditCfDirect(recurringAction.cashFlow); setRecurringAction(null); }}
                    className="w-full rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white">
                    앞으로 모두 수정
                  </button>
                  <button onClick={() => setRecurringAction(null)}
                    className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-500">
                    취소
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
