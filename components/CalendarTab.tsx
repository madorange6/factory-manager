'use client';

import { useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { Company, InventoryItem, InventoryLogRow } from '../lib/types';
import { cn, formatDateTime, getErrorMessage } from '../lib/utils';

type Props = {
  logs: InventoryLogRow[];
  inventory: InventoryItem[];
  companies: Company[];
};

type SettlementModal = {
  open: boolean;
  log: InventoryLogRow | null;
  itemName: string;
  unitPrice: string;
  saving: boolean;
  error: string;
};

const EMPTY_MODAL: SettlementModal = {
  open: false,
  log: null,
  itemName: '',
  unitPrice: '',
  saving: false,
  error: '',
};

export default function CalendarTab({ logs, inventory, companies }: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [modal, setModal] = useState<SettlementModal>(EMPTY_MODAL);

  const inventoryMap = new Map(inventory.map((item) => [item.id, item]));

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  // 이 달에 입출고가 있는 날짜 Set
  const activeDates = new Set<string>();
  logs.forEach((log) => {
    const d = new Date(log.created_at);
    if (d.getFullYear() === year && d.getMonth() === month) {
      activeDates.add(`${year}-${String(month + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
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

  const selectedLogs = selectedDate
    ? logs
        .filter((log) => {
          const d = new Date(log.created_at);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          return key === selectedDate;
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    : [];

  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const cells: Array<number | null> = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);

  const MONTH_NAMES = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
  const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

  // 정산 모달 열기
  function openSettlementModal(log: InventoryLogRow) {
    const item = inventoryMap.get(log.item_id);
    setModal({
      open: true,
      log,
      itemName: item?.name ?? '',
      unitPrice: '',
      saving: false,
      error: '',
    });
  }

  // 정산 저장
  async function handleSettlementSave() {
    if (!modal.log) return;
    const unitPrice = Number(modal.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      setModal((prev) => ({ ...prev, error: '단가를 입력해줘.' }));
      return;
    }
    const log = modal.log;
    const qty = Number(log.qty);
    const supplyAmount = qty * unitPrice;
    const taxAmount = Math.round(supplyAmount * 0.1);
    // 입고 → 매입(payable), 출고 → 매출(receivable)
    const direction = log.action === 'in' ? 'payable' : 'receivable';
    const companyName = log.company_name || '';
    const companyId = companies.find((c) => c.name === companyName)?.id ?? null;
    const logDate = log.date || new Date(log.created_at).toISOString().slice(0, 10);

    try {
      setModal((prev) => ({ ...prev, saving: true, error: '' }));
      const { data: invData, error: invError } = await supabase
        .from('invoices')
        .insert({
          company_id: companyId,
          company_name: companyName,
          direction,
          date: logDate,
          invoice_issued: false,
          payment_done: false,
          note: `입출고 로그 #${log.id}에서 생성`,
        })
        .select('id')
        .single();
      if (invError) throw invError;

      const newId = (invData as { id: number }).id;
      const { error: itemError } = await supabase.from('invoice_items').insert({
        invoice_id: newId,
        item_name: modal.itemName || null,
        quantity: qty,
        unit_price: unitPrice,
        supply_amount: supplyAmount,
        tax_amount: taxAmount,
      });
      if (itemError) throw itemError;

      setModal(EMPTY_MODAL);
      alert('정산이 저장됐어.');
    } catch (error) {
      setModal((prev) => ({ ...prev, saving: false, error: getErrorMessage(error) }));
    }
  }

  // 정산 모달 미리보기 계산
  const modalQty = modal.log ? Number(modal.log.qty) : 0;
  const modalUnitPrice = Number(modal.unitPrice) || 0;
  const modalSupply = modalQty * modalUnitPrice;
  const modalTax = Math.round(modalSupply * 0.1);
  const modalTotal = modalSupply + modalTax;

  return (
    <div className="px-3 py-4">
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
            const hasLogs = activeDates.has(key);
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
                {hasLogs && (
                  <span className={cn('mt-0.5 h-1.5 w-1.5 rounded-full', isSelected ? 'bg-white' : 'bg-emerald-500')} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 선택한 날짜 내역 */}
      {selectedDate && (
        <div className="mt-4">
          <p className="mb-3 text-sm font-semibold text-neutral-700">
            {selectedDate.replace(/-/g, '/')} 입출고 내역
          </p>

          {selectedLogs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-4 py-6 text-center text-sm text-neutral-500">
              이 날 입출고 내역이 없어.
            </div>
          ) : (
            <div className="space-y-3">
              {selectedLogs.map((log) => {
                const isIn = log.action === 'in';
                const item = inventoryMap.get(log.item_id);
                const qty = Number(log.qty);
                const unit = item?.unit ?? '';
                return (
                  <div key={log.id} className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
                    {/* 상단: 회사명 + 배지 + 정산버튼 */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-base font-bold truncate flex-1">
                        {log.company_name || '거래처 없음'}
                      </p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', isIn ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600')}>
                          {isIn ? '입고' : '출고'}
                        </span>
                        <button
                          onClick={() => openSettlementModal(log)}
                          className="rounded-full border border-neutral-300 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                        >
                          정산
                        </button>
                      </div>
                    </div>

                    {/* 하단: 품목명 + 수량 */}
                    <p className="text-sm text-neutral-700">
                      {item?.name ?? `품목#${log.item_id}`}
                      <span className="ml-2 font-semibold">{qty.toLocaleString()}{unit}</span>
                    </p>

                    {/* 부가 정보 */}
                    <p className="mt-1 text-xs text-neutral-400">{formatDateTime(log.created_at)}</p>
                    {(log.user_name || log.user_email) && (
                      <p className="mt-0.5 text-xs text-neutral-400">작성: {log.user_name || log.user_email}</p>
                    )}
                    {log.note && <p className="mt-0.5 text-xs text-blue-600">{log.note}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 정산 모달 */}
      {modal.open && modal.log && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setModal(EMPTY_MODAL)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-10" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-base font-bold">정산 입력</p>
              <button onClick={() => setModal(EMPTY_MODAL)} className="rounded-full border border-neutral-200 px-3 py-1 text-xs">닫기</button>
            </div>

            <div className="space-y-3">
              {/* 자동 채워진 정보 */}
              <div className="rounded-2xl border border-neutral-100 bg-neutral-50 px-4 py-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-neutral-500">거래처</span>
                  <span className="font-medium">{modal.log.company_name || '없음'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">날짜</span>
                  <span className="font-medium">{(modal.log.date || new Date(modal.log.created_at).toISOString().slice(0, 10))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">구분</span>
                  <span className={cn('font-semibold', modal.log.action === 'in' ? 'text-red-600' : 'text-emerald-600')}>
                    {modal.log.action === 'in' ? '매입 (입고)' : '매출 (출고)'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">품목</span>
                  <span className="font-medium">{modal.itemName || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">수량</span>
                  <span className="font-medium">{Number(modal.log.qty).toLocaleString()}{inventoryMap.get(modal.log.item_id)?.unit ?? ''}</span>
                </div>
              </div>

              {/* 단가 입력 */}
              <div>
                <p className="mb-1 text-xs text-neutral-500">단가 *</p>
                <input
                  type="number"
                  value={modal.unitPrice}
                  onChange={(e) => setModal((prev) => ({ ...prev, unitPrice: e.target.value }))}
                  placeholder="단가 입력"
                  inputMode="decimal"
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
                  autoFocus
                />
              </div>

              {/* 합계 미리보기 */}
              {modalUnitPrice > 0 && (
                <div className="rounded-2xl border border-neutral-100 bg-neutral-50 px-4 py-3 space-y-1 text-sm">
                  <div className="flex justify-between text-neutral-600">
                    <span>공급가액</span>
                    <span>{modalSupply.toLocaleString()}원</span>
                  </div>
                  <div className="flex justify-between text-neutral-600">
                    <span>세액 (10%)</span>
                    <span>{modalTax.toLocaleString()}원</span>
                  </div>
                  <div className="flex justify-between font-bold text-neutral-900 pt-1 border-t border-neutral-200">
                    <span>총합계</span>
                    <span>{modalTotal.toLocaleString()}원</span>
                  </div>
                </div>
              )}

              {modal.error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{modal.error}</div>
              )}

              <button
                onClick={() => void handleSettlementSave()}
                disabled={modal.saving}
                className="w-full rounded-2xl bg-neutral-900 px-4 py-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {modal.saving ? '저장중' : '정산 저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
