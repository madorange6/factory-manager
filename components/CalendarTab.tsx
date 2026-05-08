'use client';

import { useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { Company, InventoryItem, InventoryLogRow } from '../lib/types';
import { cn, formatDateTime, getErrorMessage, todayString } from '../lib/utils';

type Props = {
  logs: InventoryLogRow[];
  inventory: InventoryItem[];
  companies: Company[];
  onRefreshLogs: () => Promise<void>;
  onRefreshInventory: () => Promise<void>;
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

type EditLogModal = {
  open: boolean;
  log: InventoryLogRow | null;
  date: string;
  companyId: number | null;
  companyName: string;
  itemId: number | null;
  qty: string;
  note: string;
  saving: boolean;
  error: string;
};

const EMPTY_EDIT_MODAL: EditLogModal = {
  open: false,
  log: null,
  date: todayString(),
  companyId: null,
  companyName: '',
  itemId: null,
  qty: '',
  note: '',
  saving: false,
  error: '',
};

// 생산 로그 여부 판단
function isProductionLog(log: InventoryLogRow): boolean {
  if (!log.note) return false;
  return log.note.includes('production_result:') || log.note.includes('production_use:');
}

// 로그의 날짜 키 반환 (date 우선, 없으면 created_at)
function logDateKey(log: InventoryLogRow): string {
  if (log.date) return log.date.slice(0, 10);
  const d = new Date(log.created_at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CalendarTab({ logs, inventory, companies, onRefreshLogs, onRefreshInventory }: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [modal, setModal] = useState<SettlementModal>(EMPTY_MODAL);
  const [editModal, setEditModal] = useState<EditLogModal>(EMPTY_EDIT_MODAL);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // 메모 인라인 편집
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState('');
  const [savingNoteId, setSavingNoteId] = useState<number | null>(null);

  const inventoryMap = new Map(inventory.map((item) => [item.id, item]));

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  // 이 달에 입출고가 있는 날짜 Set (log.date 우선)
  const activeDates = new Set<string>();
  logs.forEach((log) => {
    const key = logDateKey(log);
    const [y, m] = key.split('-').map(Number);
    if (y === year && m === month + 1) {
      activeDates.add(key);
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

  // 선택 날짜 필터 (log.date 우선)
  const selectedLogs = selectedDate
    ? logs
        .filter((log) => logDateKey(log) === selectedDate)
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
          invoice_status: 'none',
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

  // 메모 저장
  async function handleNoteSave(logId: number) {
    setSavingNoteId(logId);
    try {
      const { error } = await supabase
        .from('inventory_logs')
        .update({ note: editingNoteValue || null })
        .eq('id', logId);
      if (error) throw error;
      const log = logs.find((l) => l.id === logId);
      if (log) log.note = editingNoteValue || null;
      setEditingNoteId(null);
    } catch (error) {
      alert(getErrorMessage(error));
    } finally {
      setSavingNoteId(null);
    }
  }

  // 수정 모달 열기
  function openEditModal(log: InventoryLogRow) {
    setEditModal({
      open: true,
      log,
      date: log.date ?? logDateKey(log),
      companyId: log.company_id ?? null,
      companyName: log.company_name ?? '',
      itemId: log.item_id,
      qty: String(log.qty),
      note: log.note ?? '',
      saving: false,
      error: '',
    });
  }

  // 수정 저장
  async function handleEditSave() {
    if (!editModal.log) return;
    const newQty = Number(editModal.qty);
    if (!Number.isFinite(newQty) || newQty <= 0) {
      setEditModal((prev) => ({ ...prev, error: '수량을 올바르게 입력해줘.' }));
      return;
    }
    if (!editModal.itemId) {
      setEditModal((prev) => ({ ...prev, error: '품목을 선택해줘.' }));
      return;
    }

    const log = editModal.log;
    const oldQty = Number(log.qty);
    const oldItemId = log.item_id;
    const newItemId = editModal.itemId;
    const action = log.action;

    try {
      setEditModal((prev) => ({ ...prev, saving: true, error: '' }));

      // 재고 재계산
      if (oldItemId === newItemId) {
        // 같은 품목: 수량 차이만 반영
        const item = inventoryMap.get(oldItemId);
        if (item) {
          const netDelta = action === 'in' ? (newQty - oldQty) : (oldQty - newQty);
          const newStock = Number(item.current_stock) + netDelta;
          const { error: stockErr } = await supabase.from('inventory_items').update({ current_stock: newStock }).eq('id', oldItemId);
          if (stockErr) throw stockErr;
        }
      } else {
        // 다른 품목: 기존 품목 복구 + 새 품목 적용
        const oldItem = inventoryMap.get(oldItemId);
        const newItem = inventoryMap.get(newItemId);
        if (oldItem) {
          const revertedStock = Number(oldItem.current_stock) + (action === 'in' ? -oldQty : oldQty);
          const { error: e1 } = await supabase.from('inventory_items').update({ current_stock: revertedStock }).eq('id', oldItemId);
          if (e1) throw e1;
        }
        if (newItem) {
          const appliedStock = Number(newItem.current_stock) + (action === 'in' ? newQty : -newQty);
          const { error: e2 } = await supabase.from('inventory_items').update({ current_stock: appliedStock }).eq('id', newItemId);
          if (e2) throw e2;
        }
      }

      // 로그 업데이트
      const companyId = editModal.companyId
        ?? companies.find((c) => c.name === editModal.companyName.trim())?.id
        ?? null;
      const { error: logErr } = await supabase.from('inventory_logs').update({
        date: editModal.date || null,
        company_id: companyId,
        company_name: editModal.companyName.trim() || null,
        item_id: newItemId,
        qty: newQty,
        note: editModal.note.trim() || null,
      }).eq('id', log.id);
      if (logErr) throw logErr;

      setEditModal(EMPTY_EDIT_MODAL);
      await onRefreshLogs();
      await onRefreshInventory();
    } catch (error) {
      setEditModal((prev) => ({ ...prev, saving: false, error: getErrorMessage(error) }));
    }
  }

  // 삭제
  async function handleDeleteLog(log: InventoryLogRow) {
    if (!window.confirm('이 입출고 내역을 삭제할까요? 재고도 자동으로 복구돼.')) return;
    try {
      setDeletingId(log.id);
      // 재고 복구
      const item = inventoryMap.get(log.item_id);
      if (item) {
        const restoredStock = Number(item.current_stock) + (log.action === 'in' ? -Number(log.qty) : Number(log.qty));
        const { error: stockErr } = await supabase.from('inventory_items').update({ current_stock: restoredStock }).eq('id', log.item_id);
        if (stockErr) throw stockErr;
      }
      // 로그 삭제
      const { error } = await supabase.from('inventory_logs').delete().eq('id', log.id);
      if (error) throw error;

      await onRefreshLogs();
      await onRefreshInventory();
    } catch (error) {
      alert(getErrorMessage(error));
    } finally {
      setDeletingId(null);
    }
  }

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
                const isProd = isProductionLog(log);
                const isIn = log.action === 'in';
                const item = inventoryMap.get(log.item_id);
                const qty = Number(log.qty);
                const unit = item?.unit ?? '';
                const isEditingNote = editingNoteId === log.id;

                return (
                  <div key={log.id} className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
                    {/* 상단: 회사명 + 배지 + 정산/수정/삭제 버튼 */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-base font-bold truncate flex-1">
                        {log.company_name || '거래처 없음'}
                      </p>
                      <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                        {isProd ? (
                          <span className="rounded-full px-2.5 py-1 text-xs font-semibold bg-orange-50 text-orange-600">
                            생산
                          </span>
                        ) : (
                          <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', isIn ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600')}>
                            {isIn ? '입고' : '출고'}
                          </span>
                        )}
                        {!isProd && (
                          <button
                            onClick={() => openSettlementModal(log)}
                            className="rounded-full border border-neutral-300 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                          >
                            정산
                          </button>
                        )}
                        <button
                          onClick={() => openEditModal(log)}
                          className="rounded-full border border-neutral-300 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => void handleDeleteLog(log)}
                          disabled={deletingId === log.id}
                          className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50"
                        >
                          {deletingId === log.id ? '삭제중' : '삭제'}
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

                    {/* 메모 인라인 편집 */}
                    {isEditingNote ? (
                      <div className="mt-2 flex gap-1.5">
                        <input
                          type="text"
                          value={editingNoteValue}
                          onChange={(e) => setEditingNoteValue(e.target.value)}
                          placeholder="메모 입력"
                          className="flex-1 rounded-xl border border-neutral-300 px-3 py-1.5 text-xs outline-none focus:border-neutral-500"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleNoteSave(log.id);
                            if (e.key === 'Escape') setEditingNoteId(null);
                          }}
                        />
                        <button
                          onClick={() => void handleNoteSave(log.id)}
                          disabled={savingNoteId === log.id}
                          className="rounded-xl bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {savingNoteId === log.id ? '저장중' : '저장'}
                        </button>
                        <button
                          onClick={() => setEditingNoteId(null)}
                          className="rounded-xl border border-neutral-200 px-2.5 py-1 text-xs text-neutral-500"
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        {log.note ? (
                          <p className="flex-1 text-xs text-blue-600">{log.note}</p>
                        ) : (
                          <p className="flex-1 text-xs text-neutral-300">메모 없음</p>
                        )}
                        <button
                          onClick={() => {
                            setEditingNoteId(log.id);
                            setEditingNoteValue(log.note ?? '');
                          }}
                          className="shrink-0 text-xs text-neutral-400 underline underline-offset-2 hover:text-neutral-600"
                        >
                          수정
                        </button>
                      </div>
                    )}
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

      {/* 수정 모달 */}
      {editModal.open && editModal.log && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setEditModal(EMPTY_EDIT_MODAL)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-10 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-base font-bold">입출고 수정</p>
              <button onClick={() => setEditModal(EMPTY_EDIT_MODAL)} className="rounded-full border border-neutral-200 px-3 py-1 text-xs">닫기</button>
            </div>

            <div className="space-y-3">
              <div>
                <p className="mb-1 text-xs text-neutral-500">날짜</p>
                <input
                  type="date"
                  value={editModal.date}
                  onChange={(e) => setEditModal((prev) => ({ ...prev, date: e.target.value }))}
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
                />
              </div>

              <div>
                <p className="mb-1 text-xs text-neutral-500">거래처</p>
                <select
                  value={editModal.companyId ?? ''}
                  onChange={(e) => {
                    if (e.target.value === '') {
                      setEditModal((prev) => ({ ...prev, companyId: null, companyName: '' }));
                    } else {
                      const id = Number(e.target.value);
                      const company = companies.find((c) => c.id === id);
                      setEditModal((prev) => ({ ...prev, companyId: id, companyName: company?.name ?? '' }));
                    }
                  }}
                  className="mb-2 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
                >
                  <option value="">직접 입력</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input
                  value={editModal.companyName}
                  onChange={(e) => setEditModal((prev) => ({ ...prev, companyName: e.target.value, companyId: null }))}
                  placeholder="거래처명 직접 입력"
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                />
              </div>

              <div>
                <p className="mb-1 text-xs text-neutral-500">품목</p>
                <select
                  value={editModal.itemId ?? ''}
                  onChange={(e) => setEditModal((prev) => ({ ...prev, itemId: e.target.value ? Number(e.target.value) : null }))}
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
                >
                  <option value="">품목 선택</option>
                  {inventory.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <p className="mb-1 text-xs text-neutral-500">수량</p>
                <input
                  type="number"
                  value={editModal.qty}
                  onChange={(e) => setEditModal((prev) => ({ ...prev, qty: e.target.value }))}
                  placeholder="수량"
                  inputMode="decimal"
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
                />
              </div>

              <div>
                <p className="mb-1 text-xs text-neutral-500">메모</p>
                <input
                  type="text"
                  value={editModal.note}
                  onChange={(e) => setEditModal((prev) => ({ ...prev, note: e.target.value }))}
                  placeholder="메모 (선택)"
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                />
              </div>

              {editModal.error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{editModal.error}</div>
              )}

              <button
                onClick={() => void handleEditSave()}
                disabled={editModal.saving}
                className="w-full rounded-2xl bg-neutral-900 px-4 py-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {editModal.saving ? '저장중' : '수정 저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
