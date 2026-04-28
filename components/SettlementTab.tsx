'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { Company, Invoice, InvoiceItem } from '../lib/types';
import { cn, formatCurrency, getErrorMessage, todayString } from '../lib/utils';

type Props = {
  companies: Company[];
};

type InvoiceWithItems = Invoice & { items: InvoiceItem[] };

type InvoiceItemDraft = {
  item_name: string;
  quantity: string;
  unit_price: string;
  supply_amount: string;
  tax_amount: string;
};

const EMPTY_ITEM_DRAFT: InvoiceItemDraft = {
  item_name: '',
  quantity: '',
  unit_price: '',
  supply_amount: '',
  tax_amount: '',
};

type Filter = 'all' | 'pending' | 'done';
type DirectionFilter = 'all' | 'receivable' | 'payable';

export default function SettlementTab({ companies }: Props) {
  const [invoices, setInvoices] = useState<InvoiceWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');

  const [filter, setFilter] = useState<Filter>('all');
  const [dirFilter, setDirFilter] = useState<DirectionFilter>('all');
  const [companyFilter, setCompanyFilter] = useState<string>('all');

  const [showForm, setShowForm] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState<number | null>(null);

  // 폼 상태
  const [formDate, setFormDate] = useState(todayString());
  const [formCompanyId, setFormCompanyId] = useState<number | null>(null);
  const [formCompanyName, setFormCompanyName] = useState('');
  const [formDirection, setFormDirection] = useState<'receivable' | 'payable'>('receivable');
  const [formNote, setFormNote] = useState('');
  const [formInvoiceIssued, setFormInvoiceIssued] = useState(false);
  const [formItems, setFormItems] = useState<InvoiceItemDraft[]>([{ ...EMPTY_ITEM_DRAFT }]);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => { void fetchInvoices(); }, []);

  async function fetchInvoices() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('invoices')
        .select('*, items:invoice_items(*)')
        .order('date', { ascending: false });
      if (error) throw error;
      setInvoices((data ?? []) as InvoiceWithItems[]);
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  function calcItemTotals(items: InvoiceItem[]) {
    const supply = items.reduce((s, i) => s + Number(i.supply_amount), 0);
    const tax = items.reduce((s, i) => s + Number(i.tax_amount), 0);
    return { supply, tax, total: supply + tax };
  }

  function calcDraftTotals(items: InvoiceItemDraft[]) {
    const supply = items.reduce((s, i) => s + (Number(i.supply_amount) || 0), 0);
    const tax = items.reduce((s, i) => s + (Number(i.tax_amount) || 0), 0);
    return { supply, tax, total: supply + tax };
  }

  // 요약 카드: payment_done=false 인 건들
  const totalReceivable = invoices
    .filter((inv) => !inv.payment_done && inv.direction === 'receivable')
    .reduce((s, inv) => s + calcItemTotals(inv.items).total, 0);
  const totalPayable = invoices
    .filter((inv) => !inv.payment_done && inv.direction === 'payable')
    .reduce((s, inv) => s + calcItemTotals(inv.items).total, 0);

  // 필터링
  const filtered = invoices.filter((inv) => {
    if (filter === 'pending' && inv.payment_done) return false;
    if (filter === 'done' && !inv.payment_done) return false;
    if (dirFilter !== 'all' && inv.direction !== dirFilter) return false;
    if (companyFilter !== 'all' && inv.company_name !== companyFilter) return false;
    return true;
  }).sort((a, b) => {
    // 미처리 먼저, 날짜 내림차순
    if (!a.payment_done && b.payment_done) return -1;
    if (a.payment_done && !b.payment_done) return 1;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  function updateDraftItem(index: number, field: keyof InvoiceItemDraft, value: string) {
    setFormItems((prev) => {
      const next = [...prev];
      const item = { ...next[index], [field]: value };

      // 수량 or 단가 변경 시 자동 계산
      if (field === 'quantity' || field === 'unit_price') {
        const qty = Number(field === 'quantity' ? value : item.quantity);
        const price = Number(field === 'unit_price' ? value : item.unit_price);
        if (!isNaN(qty) && !isNaN(price)) {
          const supply = qty * price;
          item.supply_amount = String(supply);
          item.tax_amount = String(Math.round(supply * 0.1));
        }
      }
      // 공급가액 변경 시 세액 자동 계산
      if (field === 'supply_amount') {
        const supply = Number(value);
        if (!isNaN(supply)) item.tax_amount = String(Math.round(supply * 0.1));
      }

      next[index] = item;
      return next;
    });
  }

  function openNewForm() {
    setEditingInvoiceId(null);
    setFormDate(todayString());
    setFormCompanyId(null);
    setFormCompanyName('');
    setFormDirection('receivable');
    setFormNote('');
    setFormInvoiceIssued(false);
    setFormItems([{ ...EMPTY_ITEM_DRAFT }]);
    setShowForm(true);
  }

  function openEditForm(inv: InvoiceWithItems) {
    setEditingInvoiceId(inv.id);
    setFormDate(inv.date);
    setFormCompanyId(inv.company_id ?? null);
    setFormCompanyName(inv.company_name);
    setFormDirection(inv.direction);
    setFormNote(inv.note ?? '');
    setFormInvoiceIssued(inv.invoice_issued);
    setFormItems(inv.items.map((item) => ({
      item_name: item.item_name ?? '',
      quantity: String(item.quantity),
      unit_price: String(item.unit_price),
      supply_amount: String(item.supply_amount),
      tax_amount: String(item.tax_amount),
    })));
    setShowForm(true);
  }

  async function handleSave() {
    const companyName = formCompanyName.trim();
    if (!companyName) { setErrorText('거래처명을 입력해줘.'); return; }
    if (formItems.length === 0) { setErrorText('품목 라인을 1개 이상 추가해줘.'); return; }

    try {
      setSaving(true);
      setErrorText('');

      if (editingInvoiceId) {
        // 수정
        const { error: invError } = await supabase.from('invoices').update({
          company_id: formCompanyId,
          company_name: companyName,
          direction: formDirection,
          date: formDate,
          invoice_issued: formInvoiceIssued,
          note: formNote.trim() || null,
        }).eq('id', editingInvoiceId);
        if (invError) throw invError;

        // 기존 items 삭제 후 재삽입
        const { error: delError } = await supabase.from('invoice_items').delete().eq('invoice_id', editingInvoiceId);
        if (delError) throw delError;

        const itemRows = formItems.map((item) => ({
          invoice_id: editingInvoiceId,
          item_name: item.item_name.trim() || null,
          quantity: Number(item.quantity) || 0,
          unit_price: Number(item.unit_price) || 0,
          supply_amount: Number(item.supply_amount) || 0,
          tax_amount: Number(item.tax_amount) || 0,
        }));
        const { error: itemError } = await supabase.from('invoice_items').insert(itemRows);
        if (itemError) throw itemError;
      } else {
        // 신규
        const { data: invData, error: invError } = await supabase.from('invoices').insert({
          company_id: formCompanyId,
          company_name: companyName,
          direction: formDirection,
          date: formDate,
          invoice_issued: formInvoiceIssued,
          payment_done: false,
          note: formNote.trim() || null,
        }).select('id').single();
        if (invError) throw invError;

        const newId = (invData as { id: number }).id;
        const itemRows = formItems.map((item) => ({
          invoice_id: newId,
          item_name: item.item_name.trim() || null,
          quantity: Number(item.quantity) || 0,
          unit_price: Number(item.unit_price) || 0,
          supply_amount: Number(item.supply_amount) || 0,
          tax_amount: Number(item.tax_amount) || 0,
        }));
        const { error: itemError } = await supabase.from('invoice_items').insert(itemRows);
        if (itemError) throw itemError;
      }

      setShowForm(false);
      setEditingInvoiceId(null);
      await fetchInvoices();
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function toggleInvoiceField(inv: InvoiceWithItems, field: 'invoice_issued' | 'payment_done') {
    try {
      const { error } = await supabase.from('invoices').update({ [field]: !inv[field] }).eq('id', inv.id);
      if (error) throw error;
      setInvoices((prev) => prev.map((i) => i.id === inv.id ? { ...i, [field]: !inv[field] } : i));
    } catch (error) {
      setErrorText(getErrorMessage(error));
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm('이 정산 건을 삭제할까요?')) return;
    try {
      setDeletingId(id);
      setErrorText('');
      const { error } = await supabase.from('invoices').delete().eq('id', id);
      if (error) throw error;
      await fetchInvoices();
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setDeletingId(null);
    }
  }

  const uniqueCompanyNames = Array.from(new Set(invoices.map((i) => i.company_name))).sort();

  if (showForm) {
    const draftTotals = calcDraftTotals(formItems);
    return (
      <div className="px-3 py-4">
        {errorText && (
          <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorText}</div>
        )}

        <div className="mb-3 flex items-center gap-2">
          <button onClick={() => { setShowForm(false); setEditingInvoiceId(null); }} className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700">
            ← 취소
          </button>
          <p className="text-base font-bold">{editingInvoiceId ? '정산 수정' : '새 정산 추가'}</p>
        </div>

        <div className="space-y-3">
          {/* 헤더 정보 */}
          <div className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm space-y-3">
            <div>
              <p className="mb-1 text-xs text-neutral-500">날짜</p>
              <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400" />
            </div>

            <div>
              <p className="mb-1 text-xs text-neutral-500">거래처</p>
              <select
                value={formCompanyId ?? ''}
                onChange={(e) => {
                  if (e.target.value === '') { setFormCompanyId(null); }
                  else {
                    const id = Number(e.target.value);
                    const company = companies.find((c) => c.id === id);
                    setFormCompanyId(id);
                    if (company) setFormCompanyName(company.name);
                  }
                }}
                className="mb-2 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
              >
                <option value="">직접 입력</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input
                value={formCompanyName}
                onChange={(e) => { setFormCompanyName(e.target.value); setFormCompanyId(null); }}
                placeholder="거래처명 직접 입력"
                className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
              />
            </div>

            <div>
              <p className="mb-1 text-xs text-neutral-500">구분</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setFormDirection('receivable')} className={cn('rounded-2xl border py-3 text-sm font-semibold', formDirection === 'receivable' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-neutral-200 bg-white text-neutral-700')}>
                  받을 돈
                </button>
                <button onClick={() => setFormDirection('payable')} className={cn('rounded-2xl border py-3 text-sm font-semibold', formDirection === 'payable' ? 'border-red-500 bg-red-500 text-white' : 'border-neutral-200 bg-white text-neutral-700')}>
                  줄 돈
                </button>
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs text-neutral-500">메모 (선택)</p>
              <input value={formNote} onChange={(e) => setFormNote(e.target.value)} placeholder="메모" className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400" />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={formInvoiceIssued} onChange={(e) => setFormInvoiceIssued(e.target.checked)} className="h-4 w-4 rounded" />
              <span className="text-sm text-neutral-700">계산서 발행 완료</span>
            </label>
          </div>

          {/* 품목 라인 */}
          <div className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="mb-3 text-sm font-semibold">품목 라인</p>
            <div className="space-y-4">
              {formItems.map((item, index) => (
                <div key={index} className="rounded-2xl border border-neutral-100 bg-neutral-50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-neutral-500">품목 {index + 1}</p>
                    {formItems.length > 1 && (
                      <button onClick={() => setFormItems((prev) => prev.filter((_, i) => i !== index))} className="text-red-500 text-xs font-semibold">✕ 삭제</button>
                    )}
                  </div>
                  <input value={item.item_name} onChange={(e) => updateDraftItem(index, 'item_name', e.target.value)} placeholder="품목명 (선택)" className="w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400" />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="mb-1 text-[11px] text-neutral-400">수량</p>
                      <input value={item.quantity} onChange={(e) => updateDraftItem(index, 'quantity', e.target.value)} inputMode="decimal" placeholder="0" className="w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400" />
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] text-neutral-400">단가</p>
                      <input value={item.unit_price} onChange={(e) => updateDraftItem(index, 'unit_price', e.target.value)} inputMode="decimal" placeholder="0" className="w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400" />
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] text-neutral-400">공급가액</p>
                      <input value={item.supply_amount} onChange={(e) => updateDraftItem(index, 'supply_amount', e.target.value)} inputMode="decimal" placeholder="0" className="w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400" />
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] text-neutral-400">세액</p>
                      <input value={item.tax_amount} onChange={(e) => updateDraftItem(index, 'tax_amount', e.target.value)} inputMode="decimal" placeholder="0" className="w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setFormItems((prev) => [...prev, { ...EMPTY_ITEM_DRAFT }])} className="mt-3 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
              + 품목 추가
            </button>
          </div>

          {/* 합계 미리보기 */}
          <div className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="mb-2 text-sm font-semibold">합계 미리보기</p>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between text-neutral-600">
                <span>공급가액 합계</span>
                <span>{formatCurrency(draftTotals.supply)}원</span>
              </div>
              <div className="flex justify-between text-neutral-600">
                <span>세액 합계</span>
                <span>{formatCurrency(draftTotals.tax)}원</span>
              </div>
              <div className="flex justify-between font-bold text-neutral-900 pt-1 border-t border-neutral-100">
                <span>총합계</span>
                <span>{formatCurrency(draftTotals.total)}원</span>
              </div>
            </div>
          </div>

          <button onClick={() => void handleSave()} disabled={saving} className="w-full rounded-2xl bg-neutral-900 px-4 py-4 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? '저장중' : editingInvoiceId ? '수정 저장' : '정산 추가'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-4">
      {errorText && (
        <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorText}</div>
      )}

      {/* 요약 카드 */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs font-semibold text-emerald-700 mb-1">받을 돈</p>
          <p className="text-lg font-bold text-emerald-800">{formatCurrency(totalReceivable)}원</p>
          <p className="text-[11px] text-emerald-600 mt-0.5">미수금</p>
        </div>
        <div className="rounded-3xl border border-red-200 bg-red-50 p-4">
          <p className="text-xs font-semibold text-red-700 mb-1">줄 돈</p>
          <p className="text-lg font-bold text-red-800">{formatCurrency(totalPayable)}원</p>
          <p className="text-[11px] text-red-600 mt-0.5">미지급</p>
        </div>
      </div>

      {/* 필터 */}
      <div className="mb-3 space-y-2">
        <div className="flex gap-2">
          {(['all', 'pending', 'done'] as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cn('flex-1 rounded-2xl border py-2 text-sm font-medium', filter === f ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-600')}>
              {f === 'all' ? '전체' : f === 'pending' ? '미처리' : '완료'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {(['all', 'receivable', 'payable'] as DirectionFilter[]).map((f) => (
            <button key={f} onClick={() => setDirFilter(f)} className={cn('flex-1 rounded-2xl border py-2 text-sm font-medium', dirFilter === f ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-600')}>
              {f === 'all' ? '전체' : f === 'receivable' ? '받을돈' : '줄돈'}
            </button>
          ))}
        </div>
        <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400">
          <option value="all">전체 거래처</option>
          {uniqueCompanyNames.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>

      <button onClick={openNewForm} className="mb-4 w-full rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white">
        + 새 정산 추가
      </button>

      {loading ? (
        <div className="py-8 text-center text-sm text-neutral-500">불러오는 중…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-500">표시할 정산 건이 없어.</div>
      ) : (
        <div className="space-y-4">
          {filtered.map((inv) => {
            const totals = calcItemTotals(inv.items);
            return (
              <div key={inv.id} className={cn('rounded-3xl border bg-white p-4 shadow-sm', inv.payment_done ? 'border-neutral-100 opacity-60' : 'border-neutral-200')}>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <p className="text-base font-bold">{inv.company_name}</p>
                    <p className="text-xs text-neutral-500 mt-0.5">{inv.date}</p>
                    {inv.note && <p className="text-xs text-blue-600 mt-0.5">{inv.note}</p>}
                  </div>
                  <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold', inv.direction === 'receivable' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
                    {inv.direction === 'receivable' ? '받을돈' : '줄돈'}
                  </span>
                </div>

                {/* 품목 테이블 */}
                {inv.items.length > 0 && (
                  <div className="mb-3 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-neutral-400">
                          <th className="text-left py-1 pr-2 font-medium">품목</th>
                          <th className="text-right py-1 px-2 font-medium">수량</th>
                          <th className="text-right py-1 px-2 font-medium">단가</th>
                          <th className="text-right py-1 px-2 font-medium">공급가</th>
                          <th className="text-right py-1 pl-2 font-medium">세액</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inv.items.map((item) => (
                          <tr key={item.id} className="border-t border-neutral-100">
                            <td className="py-1.5 pr-2 text-neutral-700">{item.item_name || '-'}</td>
                            <td className="py-1.5 px-2 text-right text-neutral-700">{Number(item.quantity).toLocaleString()}</td>
                            <td className="py-1.5 px-2 text-right text-neutral-700">{formatCurrency(item.unit_price)}</td>
                            <td className="py-1.5 px-2 text-right text-neutral-700">{formatCurrency(item.supply_amount)}</td>
                            <td className="py-1.5 pl-2 text-right text-neutral-700">{formatCurrency(item.tax_amount)}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-neutral-200 font-semibold">
                          <td colSpan={3} className="py-1.5 pr-2 text-neutral-500">합계</td>
                          <td className="py-1.5 px-2 text-right">{formatCurrency(totals.supply)}</td>
                          <td className="py-1.5 pl-2 text-right">{formatCurrency(totals.tax)}</td>
                        </tr>
                      </tbody>
                    </table>
                    <div className="mt-2 text-right">
                      <span className="text-sm font-bold">총합계: {formatCurrency(totals.total)}원</span>
                    </div>
                  </div>
                )}

                {/* 토글 */}
                <div className="flex gap-3 mb-3">
                  <button
                    onClick={() => void toggleInvoiceField(inv, 'invoice_issued')}
                    className={cn('flex-1 rounded-2xl border py-2 text-xs font-semibold transition', inv.invoice_issued ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-600')}
                  >
                    계산서 {inv.invoice_issued ? '✅ 발행' : '❌ 미발행'}
                  </button>
                  <button
                    onClick={() => void toggleInvoiceField(inv, 'payment_done')}
                    className={cn('flex-1 rounded-2xl border py-2 text-xs font-semibold transition', inv.payment_done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-neutral-200 bg-white text-neutral-600')}
                  >
                    {inv.direction === 'receivable' ? '입금' : '지급'} {inv.payment_done ? '✅ 완료' : '❌ 미완료'}
                  </button>
                </div>

                {/* 수정/삭제 */}
                <div className="flex gap-2">
                  <button onClick={() => openEditForm(inv)} className="flex-1 rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-semibold text-neutral-700">
                    수정
                  </button>
                  <button onClick={() => void handleDelete(inv.id)} disabled={deletingId === inv.id} className="flex-1 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50">
                    {deletingId === inv.id ? '삭제중' : '삭제'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
