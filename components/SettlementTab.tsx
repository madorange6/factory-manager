'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { Company, Invoice, InvoiceItem, Payment } from '../lib/types';
import { cn, formatCurrency, getErrorMessage, todayString } from '../lib/utils';

type Props = {
  companies: Company[];
  onCompanyAdded: () => Promise<void>;
};

type InvoiceWithItems = Invoice & { items: InvoiceItem[]; payments: Payment[] };

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

type StatusFilter = 'all' | 'pending' | 'done';
type FactoryFilter = 'all' | '1공장' | '2공장';
type DirectionFilter = 'all' | 'receivable' | 'payable';

type PaymentModal = {
  open: boolean;
  invoiceId: number | null;
  editingPaymentId: number | null; // null = 새 추가, number = 수정
  date: string;
  amount: string;
  memo: string;
  saving: boolean;
  error: string;
};

const EMPTY_PAYMENT_MODAL: PaymentModal = {
  open: false,
  invoiceId: null,
  editingPaymentId: null,
  date: todayString(),
  amount: '',
  memo: '',
  saving: false,
  error: '',
};

export default function SettlementTab({ companies, onCompanyAdded }: Props) {
  const [invoices, setInvoices] = useState<InvoiceWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  const [summaryFactoryFilter, setSummaryFactoryFilter] = useState<FactoryFilter>('all');
  const [companySearch, setCompanySearch] = useState('');

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const [showForm, setShowForm] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState<number | null>(null);

  const [formDate, setFormDate] = useState(todayString());
  const [formDueDate, setFormDueDate] = useState('');
  const [formCompanyId, setFormCompanyId] = useState<number | null>(null);
  const [formCompanyName, setFormCompanyName] = useState('');
  const [formDirection, setFormDirection] = useState<'receivable' | 'payable'>('receivable');
  const [formNote, setFormNote] = useState('');
  const [formFactory, setFormFactory] = useState<string | null>(null);
  const [formInvoiceIssued, setFormInvoiceIssued] = useState(false);
  const [formItems, setFormItems] = useState<InvoiceItemDraft[]>([{ ...EMPTY_ITEM_DRAFT }]);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [paymentModal, setPaymentModal] = useState<PaymentModal>(EMPTY_PAYMENT_MODAL);

  const [pendingCompanyName, setPendingCompanyName] = useState<string | null>(null);
  const [addingCompany, setAddingCompany] = useState(false);
  const [expandedDoneIds, setExpandedDoneIds] = useState<Set<number>>(new Set());

  useEffect(() => { void fetchInvoices(); }, []);

  async function fetchInvoices() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('invoices')
        .select('*, items:invoice_items(*), payments:payments(*)')
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

  function calcPaid(payments: Payment[]) {
    return payments.reduce((s, p) => s + Number(p.amount), 0);
  }

  function calcDraftTotals(items: InvoiceItemDraft[]) {
    const supply = items.reduce((s, i) => s + (Number(i.supply_amount) || 0), 0);
    const tax = items.reduce((s, i) => s + (Number(i.tax_amount) || 0), 0);
    return { supply, tax, total: supply + tax };
  }

  // 요약 카드: 미수금/미지급금 = (total - paidSum) for unpaid invoices
  function getUnpaidRemaining(direction: 'receivable' | 'payable') {
    return invoices
      .filter((inv) => {
        if (inv.payment_done) return false;
        if (inv.direction !== direction) return false;
        if (directionFilter !== 'all' && inv.direction !== directionFilter) return false;
        if (summaryFactoryFilter !== 'all' && inv.factory !== summaryFactoryFilter) return false;
        return true;
      })
      .reduce((s, inv) => {
        const total = calcItemTotals(inv.items).total;
        const paid = calcPaid(inv.payments);
        return s + Math.max(0, total - paid);
      }, 0);
  }

  const totalReceivable = getUnpaidRemaining('receivable');
  const totalPayable = getUnpaidRemaining('payable');

  // 필터링 + 그룹핑
  const filteredInvoices = invoices.filter((inv) => {
    if (statusFilter === 'pending' && inv.payment_done) return false;
    if (statusFilter === 'done' && !inv.payment_done) return false;
    if (directionFilter !== 'all' && inv.direction !== directionFilter) return false;
    if (companySearch.trim() && !inv.company_name.includes(companySearch.trim())) return false;
    return true;
  });

  const groupMap = new Map<string, InvoiceWithItems[]>();
  for (const inv of filteredInvoices) {
    if (!groupMap.has(inv.company_name)) groupMap.set(inv.company_name, []);
    groupMap.get(inv.company_name)!.push(inv);
  }
  for (const [, invs] of groupMap) {
    invs.sort((a, b) => {
      if (a.payment_done && !b.payment_done) return 1;
      if (!a.payment_done && b.payment_done) return -1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
  }
  const sortedGroupKeys = Array.from(groupMap.keys()).sort((a, b) => a.localeCompare(b, 'ko'));

  function toggleGroup(name: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function updateDraftItem(index: number, field: keyof InvoiceItemDraft, value: string) {
    setFormItems((prev) => {
      const next = [...prev];
      const item = { ...next[index], [field]: value };
      if (field === 'quantity' || field === 'unit_price') {
        const qty = Number(field === 'quantity' ? value : item.quantity);
        const price = Number(field === 'unit_price' ? value : item.unit_price);
        if (!isNaN(qty) && !isNaN(price)) {
          const supply = qty * price;
          item.supply_amount = String(supply);
          item.tax_amount = String(Math.round(supply * 0.1));
        }
      }
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
    setFormDueDate('');
    setFormCompanyId(null);
    setFormCompanyName('');
    setFormDirection('receivable');
    setFormNote('');
    setFormFactory(null);
    setFormInvoiceIssued(false);
    setFormItems([{ ...EMPTY_ITEM_DRAFT }]);
    setShowForm(true);
  }

  function openEditForm(inv: InvoiceWithItems) {
    setEditingInvoiceId(inv.id);
    setFormDate(inv.date);
    setFormDueDate(inv.due_date ?? '');
    setFormCompanyId(inv.company_id ?? null);
    setFormCompanyName(inv.company_name);
    setFormDirection(inv.direction);
    setFormNote(inv.note ?? '');
    setFormFactory(inv.factory ?? null);
    setFormInvoiceIssued(inv.invoice_issued ?? false);
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
      const invoicePayload = {
        company_id: formCompanyId,
        company_name: companyName,
        direction: formDirection,
        date: formDate,
        due_date: formDueDate.trim() || null,
        invoice_issued: formInvoiceIssued,
        factory: formFactory,
        note: formNote.trim() || null,
      };

      if (editingInvoiceId) {
        const { error: invError } = await supabase.from('invoices').update(invoicePayload).eq('id', editingInvoiceId);
        if (invError) throw invError;
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
        const { data: invData, error: invError } = await supabase
          .from('invoices')
          .insert({ ...invoicePayload, payment_done: false })
          .select('id')
          .single();
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
      // C안: 새 거래처면 목록 추가 제안
      const isNewCompany = !formCompanyId && !companies.find((c) => c.name.toLowerCase() === companyName.toLowerCase());
      if (isNewCompany) setPendingCompanyName(companyName);
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function togglePaymentDone(inv: InvoiceWithItems) {
    try {
      const { error } = await supabase.from('invoices').update({ payment_done: !inv.payment_done }).eq('id', inv.id);
      if (error) throw error;
      setInvoices((prev) => prev.map((i) => i.id === inv.id ? { ...i, payment_done: !inv.payment_done } : i));
    } catch (error) {
      setErrorText(getErrorMessage(error));
    }
  }

  async function setFactory(inv: InvoiceWithItems, factory: string | null) {
    try {
      const { error } = await supabase.from('invoices').update({ factory }).eq('id', inv.id);
      if (error) throw error;
      setInvoices((prev) => prev.map((i) => i.id === inv.id ? { ...i, factory } : i));
    } catch (error) {
      setErrorText(getErrorMessage(error));
    }
  }

  async function toggleInvoiceIssued(inv: InvoiceWithItems) {
    try {
      const { error } = await supabase.from('invoices').update({ invoice_issued: !inv.invoice_issued }).eq('id', inv.id);
      if (error) throw error;
      setInvoices((prev) => prev.map((i) => i.id === inv.id ? { ...i, invoice_issued: !inv.invoice_issued } : i));
    } catch (error) {
      setErrorText(getErrorMessage(error));
    }
  }

  async function setDueDate(inv: InvoiceWithItems, due_date: string | null) {
    try {
      const { error } = await supabase.from('invoices').update({ due_date }).eq('id', inv.id);
      if (error) throw error;
      setInvoices((prev) => prev.map((i) => i.id === inv.id ? { ...i, due_date } : i));
    } catch (error) {
      setErrorText(getErrorMessage(error));
    }
  }

  async function handleAddCompany(name: string) {
    try {
      setAddingCompany(true);
      const { error } = await supabase.from('companies').insert({ name, is_favorite: false });
      if (error) throw error;
      await onCompanyAdded();
    } catch (e) {
      setErrorText(getErrorMessage(e));
    } finally {
      setAddingCompany(false);
      setPendingCompanyName(null);
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

  // 입금내역 추가 / 수정
  async function handleSavePayment() {
    if (!paymentModal.invoiceId) return;
    const amount = Number(paymentModal.amount);
    if (!amount || amount <= 0) {
      setPaymentModal((prev) => ({ ...prev, error: '금액을 입력해줘.' }));
      return;
    }
    if (!paymentModal.date) {
      setPaymentModal((prev) => ({ ...prev, error: '날짜를 입력해줘.' }));
      return;
    }

    try {
      setPaymentModal((prev) => ({ ...prev, saving: true, error: '' }));

      if (paymentModal.editingPaymentId !== null) {
        // 수정
        const { error: payError } = await supabase.from('payments').update({
          amount,
          date: paymentModal.date,
          memo: paymentModal.memo.trim() || null,
        }).eq('id', paymentModal.editingPaymentId);
        if (payError) throw payError;
      } else {
        // 신규 추가
        const { error: payError } = await supabase.from('payments').insert({
          invoice_id: paymentModal.invoiceId,
          amount,
          date: paymentModal.date,
          memo: paymentModal.memo.trim() || null,
        });
        if (payError) throw payError;
      }

      // payment_done 자동 체크 (최신 데이터로 재계산)
      const inv = invoices.find((i) => i.id === paymentModal.invoiceId);
      if (inv) {
        const total = calcItemTotals(inv.items).total;
        // 기존 합산에서 수정 전 금액을 빼고 새 금액을 더해 계산
        const oldPaid = paymentModal.editingPaymentId !== null
          ? calcPaid(inv.payments.filter((p) => p.id !== paymentModal.editingPaymentId))
          : calcPaid(inv.payments);
        const newPaid = oldPaid + amount;
        if (newPaid >= total && !inv.payment_done) {
          await supabase.from('invoices').update({ payment_done: true }).eq('id', inv.id);
        } else if (newPaid < total && inv.payment_done) {
          await supabase.from('invoices').update({ payment_done: false }).eq('id', inv.id);
        }
      }

      setPaymentModal(EMPTY_PAYMENT_MODAL);
      await fetchInvoices();
    } catch (error) {
      setPaymentModal((prev) => ({ ...prev, saving: false, error: getErrorMessage(error) }));
    }
  }

  // 입금내역 삭제
  async function handleDeletePayment(paymentId: number, invoiceId: number) {
    if (!window.confirm('이 입금내역을 삭제할까요?')) return;
    try {
      const { error } = await supabase.from('payments').delete().eq('id', paymentId);
      if (error) throw error;

      // payment_done 자동 재계산
      const inv = invoices.find((i) => i.id === invoiceId);
      if (inv && inv.payment_done) {
        const total = calcItemTotals(inv.items).total;
        const newPaid = calcPaid(inv.payments.filter((p) => p.id !== paymentId));
        if (newPaid < total) {
          await supabase.from('invoices').update({ payment_done: false }).eq('id', inv.id);
        }
      }

      await fetchInvoices();
    } catch (error) {
      setErrorText(getErrorMessage(error));
    }
  }

  // ── 폼 화면 ──
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
              <input value={formCompanyName} onChange={(e) => { setFormCompanyName(e.target.value); setFormCompanyId(null); }} placeholder="거래처명 직접 입력" className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400" />
            </div>
            <div>
              <p className="mb-1 text-xs text-neutral-500">구분</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setFormDirection('receivable')} className={cn('rounded-2xl border py-3 text-sm font-semibold', formDirection === 'receivable' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-neutral-200 bg-white text-neutral-700')}>
                  매출 (받을돈)
                </button>
                <button onClick={() => setFormDirection('payable')} className={cn('rounded-2xl border py-3 text-sm font-semibold', formDirection === 'payable' ? 'border-red-500 bg-red-500 text-white' : 'border-neutral-200 bg-white text-neutral-700')}>
                  매입 (줄돈)
                </button>
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs text-neutral-500">결제 예정일 (선택)</p>
              <input type="date" value={formDueDate} onChange={(e) => setFormDueDate(e.target.value)} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400" />
            </div>
            <div>
              <p className="mb-1 text-xs text-neutral-500">계산서 발행 여부</p>
              <button
                onClick={() => setFormInvoiceIssued((prev) => !prev)}
                className={cn('w-full rounded-2xl border py-3 text-sm font-semibold', formInvoiceIssued ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-neutral-200 bg-white text-neutral-700')}
              >
                {formInvoiceIssued ? '✅ 발행됨' : '❌ 미발행'}
              </button>
            </div>
            <div>
              <p className="mb-1 text-xs text-neutral-500">공장</p>
              <div className="grid grid-cols-3 gap-2">
                {([null, '1공장', '2공장'] as const).map((val) => (
                  <button
                    key={val ?? 'none'}
                    onClick={() => setFormFactory(val)}
                    className={cn('rounded-2xl border py-2.5 text-sm font-medium', formFactory === val ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-700')}
                  >
                    {val === null ? '없음' : val}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs text-neutral-500">메모 (선택)</p>
              <input value={formNote} onChange={(e) => setFormNote(e.target.value)} placeholder="메모" className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400" />
            </div>
          </div>

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

          <div className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="mb-2 text-sm font-semibold">합계 미리보기</p>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between text-neutral-600"><span>공급가액 합계</span><span>{formatCurrency(draftTotals.supply)}원</span></div>
              <div className="flex justify-between text-neutral-600"><span>세액 합계</span><span>{formatCurrency(draftTotals.tax)}원</span></div>
              <div className="flex justify-between font-bold text-neutral-900 pt-1 border-t border-neutral-100"><span>총합계</span><span>{formatCurrency(draftTotals.total)}원</span></div>
            </div>
          </div>

          <button onClick={() => void handleSave()} disabled={saving} className="w-full rounded-2xl bg-neutral-900 px-4 py-4 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? '저장중' : editingInvoiceId ? '수정 저장' : '정산 추가'}
          </button>
        </div>
      </div>
    );
  }

  // ── 목록 화면 ──
  return (
    <div className="px-3 py-4">
      {errorText && (
        <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorText}</div>
      )}

      {/* 요약 카드 + 공장 필터 */}
      <div className="mb-3">
        <div className="mb-2 flex gap-2">
          {(['all', '1공장', '2공장'] as FactoryFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setSummaryFactoryFilter(f)}
              className={cn('flex-1 rounded-2xl border py-2 text-xs font-semibold', summaryFactoryFilter === f ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-600')}
            >
              {f === 'all' ? '전체' : f}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs font-semibold text-emerald-700 mb-1">매출 미수금</p>
            <p className="text-lg font-bold text-emerald-800">{formatCurrency(totalReceivable)}원</p>
          </div>
          <div className="rounded-3xl border border-red-200 bg-red-50 p-4">
            <p className="text-xs font-semibold text-red-700 mb-1">매입 미지급</p>
            <p className="text-lg font-bold text-red-800">{formatCurrency(totalPayable)}원</p>
          </div>
        </div>
      </div>

      {/* 방향 필터 [전체][매출][매입] */}
      <div className="mb-2 flex gap-2">
        {([['all', '전체'], ['receivable', '매출'], ['payable', '매입']] as [DirectionFilter, string][]).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setDirectionFilter(val)}
            className={cn('flex-1 rounded-2xl border py-2 text-sm font-medium', directionFilter === val ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-600')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 상태 필터 + 거래처 검색 */}
      <div className="mb-3 space-y-2">
        <div className="flex gap-2">
          {(['all', 'pending', 'done'] as StatusFilter[]).map((f) => (
            <button key={f} onClick={() => setStatusFilter(f)} className={cn('flex-1 rounded-2xl border py-2 text-sm font-medium', statusFilter === f ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-600')}>
              {f === 'all' ? '전체' : f === 'pending' ? '미처리' : '완료'}
            </button>
          ))}
        </div>
        <input
          value={companySearch}
          onChange={(e) => setCompanySearch(e.target.value)}
          placeholder="거래처 검색"
          className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
        />
      </div>

      <button onClick={openNewForm} className="mb-4 w-full rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white">
        + 새 정산 추가
      </button>

      {loading ? (
        <div className="py-8 text-center text-sm text-neutral-500">불러오는 중…</div>
      ) : sortedGroupKeys.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-500">표시할 정산 건이 없어.</div>
      ) : (
        <div className="space-y-3">
          {sortedGroupKeys.map((companyName) => {
            const groupInvoices = groupMap.get(companyName)!;
            const isExpanded = expandedGroups.has(companyName);
            const pendingInvoices = groupInvoices.filter((inv) => !inv.payment_done);
            const pendingCount = pendingInvoices.length;
            const pendingAmount = pendingInvoices.reduce((s, inv) => {
              const total = calcItemTotals(inv.items).total;
              const paid = calcPaid(inv.payments);
              return s + Math.max(0, total - paid);
            }, 0);
            const hasPending = pendingCount > 0;

            return (
              <div key={companyName} className="rounded-3xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
                <button
                  onClick={() => toggleGroup(companyName)}
                  className="w-full flex items-center justify-between px-4 py-4 text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {hasPending && <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0" />}
                    <p className="font-semibold truncate">{companyName}</p>
                    {pendingCount > 0 && (
                      <span className="text-xs text-neutral-400 shrink-0">{pendingCount}건 · {formatCurrency(pendingAmount)}원</span>
                    )}
                  </div>
                  <span className="text-neutral-400 text-sm shrink-0">{isExpanded ? '▲' : '▼'}</span>
                </button>

                {isExpanded && (
                  <div className="border-t border-neutral-100 px-3 pb-3 space-y-3 pt-3">
                    {groupInvoices.map((inv) => {
                      const totals = calcItemTotals(inv.items);
                      const paid = calcPaid(inv.payments);
                      const remaining = Math.max(0, totals.total - paid);
                      const sortedPayments = [...inv.payments].sort((a, b) => a.date.localeCompare(b.date));

                      // 완료 항목: 접힌/펼친 토글
                      if (inv.payment_done) {
                        const isDoneExpanded = expandedDoneIds.has(inv.id);
                        const lastPaymentDate = inv.payments.length > 0
                          ? [...inv.payments].sort((a, b) => b.date.localeCompare(a.date))[0].date.replace(/-/g, '.')
                          : null;
                        const invDateStr = inv.date.replace(/-/g, '.');
                        const doneTotal = calcItemTotals(inv.items).total;
                        return (
                          <div key={inv.id} className="rounded-2xl border border-neutral-100 bg-neutral-50 opacity-70">
                            {/* 접힌 헤더 */}
                            <div className="flex items-center justify-between gap-2 px-3 py-2">
                              <button
                                className="flex items-center gap-2 min-w-0 flex-1 text-left"
                                onClick={() => setExpandedDoneIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(inv.id)) next.delete(inv.id);
                                  else next.add(inv.id);
                                  return next;
                                })}
                              >
                                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', inv.direction === 'receivable' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
                                  {inv.direction === 'receivable' ? '매출' : '매입'}
                                </span>
                                <span className="text-xs text-neutral-500 truncate">
                                  {invDateStr}{lastPaymentDate ? ` / ${lastPaymentDate}` : ''} | {formatCurrency(doneTotal)}원
                                </span>
                                <span className="text-neutral-400 text-xs shrink-0">{isDoneExpanded ? '▲' : '▼'}</span>
                              </button>
                              <button
                                onClick={() => void togglePaymentDone(inv)}
                                className="shrink-0 rounded-xl border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600"
                              >
                                완료취소
                              </button>
                            </div>
                            {/* 펼쳐진 상세 */}
                            {isDoneExpanded && (
                              <div className="border-t border-neutral-200 px-3 pb-3 pt-2 space-y-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className="text-xs text-neutral-500">{inv.date}{inv.due_date ? ` → 결제예정 ${inv.due_date}` : ''}</p>
                                    {inv.note && <p className="text-xs text-blue-600">{inv.note}</p>}
                                  </div>
                                </div>
                                {inv.items.length > 0 && (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="text-neutral-400">
                                          <th className="text-left py-1 pr-2 font-medium">품목</th>
                                          <th className="text-right py-1 px-1 font-medium">수량</th>
                                          <th className="text-right py-1 px-1 font-medium">단가</th>
                                          <th className="text-right py-1 px-1 font-medium">공급가</th>
                                          <th className="text-right py-1 pl-1 font-medium">세액</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {inv.items.map((item) => (
                                          <tr key={item.id} className="border-t border-neutral-100">
                                            <td className="py-1 pr-2 text-neutral-700">{item.item_name || '-'}</td>
                                            <td className="py-1 px-1 text-right text-neutral-700">{Number(item.quantity).toLocaleString()}</td>
                                            <td className="py-1 px-1 text-right text-neutral-700">{formatCurrency(item.unit_price)}</td>
                                            <td className="py-1 px-1 text-right text-neutral-700">{formatCurrency(item.supply_amount)}</td>
                                            <td className="py-1 pl-1 text-right text-neutral-700">{formatCurrency(item.tax_amount)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                    <div className="mt-1 text-right text-xs font-bold">총합계: {formatCurrency(doneTotal)}원</div>
                                  </div>
                                )}
                                <div className="flex gap-2">
                                  <button onClick={() => openEditForm(inv)} className="flex-1 rounded-xl border border-neutral-200 bg-white px-2 py-1.5 text-xs font-semibold text-neutral-700">수정</button>
                                  <button onClick={() => void handleDelete(inv.id)} disabled={deletingId === inv.id} className="flex-1 rounded-xl border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50">
                                    {deletingId === inv.id ? '삭제중' : '삭제'}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      }

                      return (
                        <div key={inv.id} className="rounded-2xl border border-neutral-200 p-3">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div>
                              <p className="text-xs text-neutral-500">{inv.date}{inv.due_date ? ` → 결제예정 ${inv.due_date}` : ''}</p>
                              {inv.note && <p className="text-xs text-blue-600">{inv.note}</p>}
                            </div>
                            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', inv.direction === 'receivable' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
                              {inv.direction === 'receivable' ? '매출' : '매입'}
                            </span>
                          </div>

                          {/* 품목 */}
                          {inv.items.length > 0 && (
                            <div className="mb-2 overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-neutral-400">
                                    <th className="text-left py-1 pr-2 font-medium">품목</th>
                                    <th className="text-right py-1 px-1 font-medium">수량</th>
                                    <th className="text-right py-1 px-1 font-medium">단가</th>
                                    <th className="text-right py-1 px-1 font-medium">공급가</th>
                                    <th className="text-right py-1 pl-1 font-medium">세액</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {inv.items.map((item) => (
                                    <tr key={item.id} className="border-t border-neutral-100">
                                      <td className="py-1 pr-2 text-neutral-700">{item.item_name || '-'}</td>
                                      <td className="py-1 px-1 text-right text-neutral-700">{Number(item.quantity).toLocaleString()}</td>
                                      <td className="py-1 px-1 text-right text-neutral-700">{formatCurrency(item.unit_price)}</td>
                                      <td className="py-1 px-1 text-right text-neutral-700">{formatCurrency(item.supply_amount)}</td>
                                      <td className="py-1 pl-1 text-right text-neutral-700">{formatCurrency(item.tax_amount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <div className="mt-1 text-right text-xs font-bold">
                                총합계: {formatCurrency(totals.total)}원
                              </div>
                            </div>
                          )}

                          {/* 입금/지급 내역 */}
                          {sortedPayments.length > 0 && (
                            <div className="mb-2 rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2 space-y-1">
                              <p className="text-[11px] font-semibold text-neutral-500 mb-1">
                                {inv.direction === 'receivable' ? '입금 내역' : '지급 내역'}
                              </p>
                              {sortedPayments.map((p) => (
                                <div key={p.id} className="flex items-center justify-between gap-1 text-xs">
                                  <span className="flex-1 text-neutral-500 min-w-0 truncate">
                                    {p.date}{p.memo ? ` · ${p.memo}` : ''}
                                  </span>
                                  <span className="font-semibold text-neutral-700 shrink-0">{formatCurrency(p.amount)}원</span>
                                  <button
                                    onClick={() => setPaymentModal({
                                      open: true,
                                      invoiceId: inv.id,
                                      editingPaymentId: p.id,
                                      date: p.date,
                                      amount: String(p.amount),
                                      memo: p.memo ?? '',
                                      saving: false,
                                      error: '',
                                    })}
                                    className="shrink-0 rounded-lg border border-neutral-200 bg-white px-1.5 py-0.5 text-[10px] text-neutral-600 hover:bg-neutral-100"
                                  >
                                    수정
                                  </button>
                                  <button
                                    onClick={() => void handleDeletePayment(p.id, inv.id)}
                                    className="shrink-0 rounded-lg border border-red-100 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-100"
                                  >
                                    삭제
                                  </button>
                                </div>
                              ))}
                              <div className="flex justify-between text-xs font-bold pt-1 border-t border-neutral-200">
                                <span className={remaining > 0 ? 'text-orange-600' : 'text-emerald-600'}>
                                  {remaining > 0 ? '잔액' : '완납'}
                                </span>
                                <span className={remaining > 0 ? 'text-orange-600' : 'text-emerald-600'}>
                                  {remaining > 0 ? `${formatCurrency(remaining)}원` : '완료'}
                                </span>
                              </div>
                            </div>
                          )}

                          {/* + 입금내역 추가 버튼 */}
                          <button
                            onClick={() => setPaymentModal({ open: true, invoiceId: inv.id, editingPaymentId: null, date: todayString(), amount: '', memo: '', saving: false, error: '' })}
                            className="mb-2 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-100"
                          >
                            + {inv.direction === 'receivable' ? '입금내역' : '지급내역'} 추가
                          </button>

                          {/* 결제 예정일 */}
                          <div className="mb-2 flex items-center gap-2">
                            <p className="text-xs text-neutral-400 shrink-0">결제예정일</p>
                            <input
                              type="date"
                              value={inv.due_date ?? ''}
                              onChange={(e) => void setDueDate(inv, e.target.value || null)}
                              className="flex-1 rounded-xl border border-neutral-200 bg-white px-2 py-1 text-xs outline-none focus:border-neutral-400"
                            />
                          </div>

                          {/* 계산서 발행 여부 (독립 체크박스) */}
                          <button
                            onClick={() => void toggleInvoiceIssued(inv)}
                            className={cn('w-full mb-2 rounded-xl border py-1.5 text-xs font-semibold transition', inv.invoice_issued ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-neutral-200 bg-white text-neutral-600')}
                          >
                            계산서 {inv.invoice_issued ? '✅ 발행됨' : '❌ 미발행'}
                          </button>

                          {/* 공장 선택 (독립) */}
                          <div className="mb-2 grid grid-cols-3 gap-1">
                            {([null, '1공장', '2공장'] as const).map((val) => (
                              <button
                                key={val ?? 'none'}
                                onClick={() => void setFactory(inv, val)}
                                className={cn('rounded-xl border py-1.5 text-xs font-medium', (inv.factory ?? null) === val ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-neutral-50 text-neutral-600')}
                              >
                                {val === null ? '없음' : val}
                              </button>
                            ))}
                          </div>

                          {/* 입금/지급 완료 */}
                          <button
                            onClick={() => void togglePaymentDone(inv)}
                            className={cn('w-full mb-2 rounded-xl border py-2 text-xs font-semibold transition', inv.payment_done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-neutral-200 bg-white text-neutral-600')}
                          >
                            {inv.direction === 'receivable' ? '입금' : '지급'} {inv.payment_done ? '✅ 완료' : '❌ 미완료'}
                          </button>

                          {/* 수정/삭제 */}
                          <div className="flex gap-2">
                            <button onClick={() => openEditForm(inv)} className="flex-1 rounded-xl border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs font-semibold text-neutral-700">수정</button>
                            <button onClick={() => void handleDelete(inv.id)} disabled={deletingId === inv.id} className="flex-1 rounded-xl border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50">
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
          })}
        </div>
      )}

      {/* 입금내역 추가/수정 모달 */}
      {paymentModal.open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setPaymentModal(EMPTY_PAYMENT_MODAL)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-10" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-base font-bold">{paymentModal.editingPaymentId !== null ? '입금/지급 수정' : '입금/지급 내역 추가'}</p>
              <button onClick={() => setPaymentModal(EMPTY_PAYMENT_MODAL)} className="rounded-full border border-neutral-200 px-3 py-1 text-xs">닫기</button>
            </div>
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-xs text-neutral-500">날짜</p>
                <input
                  type="date"
                  value={paymentModal.date}
                  onChange={(e) => setPaymentModal((prev) => ({ ...prev, date: e.target.value }))}
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
                />
              </div>
              <div>
                <p className="mb-1 text-xs text-neutral-500">금액 *</p>
                <input
                  type="number"
                  value={paymentModal.amount}
                  onChange={(e) => setPaymentModal((prev) => ({ ...prev, amount: e.target.value }))}
                  placeholder="금액 입력"
                  inputMode="decimal"
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
                  autoFocus
                />
              </div>
              <div>
                <p className="mb-1 text-xs text-neutral-500">메모 (선택)</p>
                <input
                  type="text"
                  value={paymentModal.memo}
                  onChange={(e) => setPaymentModal((prev) => ({ ...prev, memo: e.target.value }))}
                  placeholder="메모"
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
                />
              </div>
              {paymentModal.error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{paymentModal.error}</div>
              )}
              <button
                onClick={() => void handleSavePayment()}
                disabled={paymentModal.saving}
                className="w-full rounded-2xl bg-neutral-900 px-4 py-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {paymentModal.saving ? '저장중' : paymentModal.editingPaymentId !== null ? '수정 저장' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* C안: 거래처 목록 추가 제안 모달 */}
      {pendingCompanyName && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-10">
            <p className="text-base font-bold mb-2">거래처 등록</p>
            <p className="text-sm text-neutral-600 mb-4">
              <b>{pendingCompanyName}</b>을(를) 거래처 목록에 추가할까요?
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => void handleAddCompany(pendingCompanyName)}
                disabled={addingCompany}
                className="rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {addingCompany ? '추가중' : '추가'}
              </button>
              <button
                onClick={() => setPendingCompanyName(null)}
                className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-700"
              >
                이번만 사용
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
