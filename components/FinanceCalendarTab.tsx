'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { Invoice, InvoiceItem, Payment } from '../lib/types';
import { cn, formatCurrency, getErrorMessage } from '../lib/utils';

type InvoiceWithDetails = Invoice & { items: InvoiceItem[]; payments: Payment[] };
type FactoryFilter = 'all' | '1공장' | '2공장';

function calcTotal(items: InvoiceItem[]) {
  return items.reduce((s, i) => s + Number(i.supply_amount) + Number(i.tax_amount), 0);
}

function calcPaid(payments: Payment[]) {
  return payments.reduce((s, p) => s + Number(p.amount), 0);
}

export default function FinanceCalendarTab() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [factoryFilter, setFactoryFilter] = useState<FactoryFilter>('all');

  const [invoices, setInvoices] = useState<InvoiceWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');

  useEffect(() => { void fetchInvoices(); }, []);

  async function fetchInvoices() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('invoices')
        .select('*, items:invoice_items(*), payments:payments(*)')
        .not('due_date', 'is', null)
        .order('due_date', { ascending: true });
      if (error) throw error;
      setInvoices((data ?? []) as InvoiceWithDetails[]);
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  // 팩토리 필터 적용
  const filteredInvoices = invoices.filter((inv) => {
    if (factoryFilter === 'all') return true;
    return inv.factory === factoryFilter;
  });

  // 이 달에 due_date가 있는 날짜 Set
  const activeDates = new Set<string>();
  filteredInvoices.forEach((inv) => {
    if (!inv.due_date) return;
    const key = inv.due_date.slice(0, 10);
    const [y, m] = key.split('-').map(Number);
    if (y === year && m === month + 1) activeDates.add(key);
  });

  function toDateKey(day: number) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setSelectedDate(null);
  }

  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setSelectedDate(null);
  }

  const selectedInvoices = selectedDate
    ? filteredInvoices.filter((inv) => inv.due_date?.slice(0, 10) === selectedDate)
    : [];

  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const cells: Array<number | null> = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);

  const MONTH_NAMES = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
  const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

  if (loading) return <div className="px-4 py-10 text-center text-sm text-neutral-500">불러오는 중…</div>;

  return (
    <div className="px-3 py-4">
      {errorText && (
        <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorText}</div>
      )}

      {/* 공장 필터 */}
      <div className="mb-3 flex gap-2">
        {([['all', '전체'], ['1공장', '1공장'], ['2공장', '2공장']] as [FactoryFilter, string][]).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setFactoryFilter(val)}
            className={cn('flex-1 rounded-2xl border py-2 text-sm font-medium', factoryFilter === val ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-600')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 월 네비게이션 */}
      <div className="mb-4 flex items-center justify-between">
        <button onClick={prevMonth} className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700">
          ← 이전
        </button>
        <p className="text-base font-bold">{year}년 {MONTH_NAMES[month]}</p>
        <button onClick={nextMonth} className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700">
          다음 →
        </button>
      </div>

      {/* 달력 */}
      <div className="rounded-3xl border border-neutral-200 bg-white p-3 shadow-sm">
        <div className="grid grid-cols-7 mb-2">
          {DOW_LABELS.map((d, i) => (
            <p key={d} className={cn('text-center text-xs font-semibold py-1', i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-neutral-500')}>
              {d}
            </p>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {cells.map((day, idx) => {
            if (day === null) return <div key={`empty-${idx}`} />;
            const key = toDateKey(day);
            const hasItems = activeDates.has(key);
            const isToday = key === todayKey;
            const isSelected = key === selectedDate;
            const dow = (startDow + day - 1) % 7;
            return (
              <button
                key={key}
                onClick={() => setSelectedDate(isSelected ? null : key)}
                className={cn(
                  'flex flex-col items-center justify-center rounded-2xl py-2 transition',
                  isSelected && 'bg-neutral-900',
                  !isSelected && isToday && 'border border-neutral-400',
                  !isSelected && !isToday && 'hover:bg-neutral-50',
                )}
              >
                <span className={cn('text-sm font-medium', isSelected ? 'text-white' : dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-neutral-800')}>
                  {day}
                </span>
                {hasItems && (
                  <span className={cn('mt-0.5 h-1.5 w-1.5 rounded-full', isSelected ? 'bg-white' : 'bg-blue-400')} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 선택한 날짜 결제 예정 내역 */}
      {selectedDate && (
        <div className="mt-4">
          <p className="mb-3 text-sm font-semibold text-neutral-700">
            {selectedDate.replace(/-/g, '/')} 결제 예정 내역
          </p>

          {selectedInvoices.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-4 py-6 text-center text-sm text-neutral-500">
              이 날 결제 예정 내역이 없어.
            </div>
          ) : (
            <div className="space-y-3">
              {selectedInvoices.map((inv) => {
                const total = calcTotal(inv.items);
                const paid = calcPaid(inv.payments);
                const remaining = Math.max(0, total - paid);
                return (
                  <div key={inv.id} className={cn('rounded-3xl border bg-white p-4 shadow-sm', inv.payment_done ? 'border-neutral-100 opacity-60' : 'border-neutral-200')}>
                    {/* 상단: 거래처명 + 매출/매입 배지 */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-base font-bold truncate flex-1">{inv.company_name}</p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', inv.direction === 'receivable' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
                          {inv.direction === 'receivable' ? '매출' : '매입'}
                        </span>
                        {inv.factory && (
                          <span className="rounded-full border border-neutral-200 px-2 py-0.5 text-xs text-neutral-500">
                            {inv.factory}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 금액 */}
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between text-neutral-600">
                        <span>전체 금액</span>
                        <span className="font-semibold">{formatCurrency(total)}원</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={remaining > 0 ? 'text-orange-600' : 'text-emerald-600'}>
                          {inv.direction === 'receivable' ? '미수금' : '미지급금'}
                        </span>
                        <span className={cn('font-bold', remaining > 0 ? 'text-orange-600' : 'text-emerald-600')}>
                          {remaining > 0 ? `${formatCurrency(remaining)}원` : '완납'}
                        </span>
                      </div>
                    </div>

                    {/* 계산서 발행 여부 + 메모 */}
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
          )}
        </div>
      )}
    </div>
  );
}
