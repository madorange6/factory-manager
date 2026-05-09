'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { CashFlow, Invoice, InvoiceItem, Payment } from '../lib/types';
import { cn, formatCurrency, getErrorMessage, todayString } from '../lib/utils';

type InvoiceWithDetails = Invoice & { items: InvoiceItem[]; payments: Payment[] };
type FactoryFilter = 'all' | '1공장' | '2공장';

type RawPaymentFromDB = {
  id: number;
  invoice_id: number;
  amount: number;
  date: string;
  memo: string | null;
  created_at: string;
  invoice: {
    company_name: string;
    direction: string;
    factory: string | null;
    items: { supply_amount: number; tax_amount: number }[];
    all_payments: { amount: number }[];
  } | null;
};

type PaymentWithInvoice = {
  id: number;
  invoice_id: number;
  amount: number;
  date: string;
  memo: string | null;
  invoiceCompanyName: string;
  invoiceDirection: 'receivable' | 'payable';
  invoiceFactory: string | null;
  invoiceTotal: number;
  invoiceCumPaid: number;
};

type InvoiceEditSheet = {
  open: boolean;
  invoice: InvoiceWithDetails | null;
  companyName: string;
  dueDate: string;
  factory: string;
  invoiceStatus: 'issued' | 'scheduled' | 'none';
  paymentDone: boolean;
  note: string;
  saving: boolean;
  error: string;
};

const EMPTY_INVOICE_EDIT: InvoiceEditSheet = {
  open: false, invoice: null, companyName: '', dueDate: '',
  factory: '', invoiceStatus: 'none', paymentDone: false,
  note: '', saving: false, error: '',
};

type CfModal = {
  open: boolean;
  editingId: number | null;
  date: string;
  amount: string;
  typeSign: 1 | -1;
  category: string;
  memo: string;
  isRecurring: boolean;
  recurringDay: string;
  status: 'planned' | 'done';
  saving: boolean;
  error: string;
};

const EMPTY_CF_MODAL: CfModal = {
  open: false, editingId: null, date: todayString(), amount: '',
  typeSign: 1, category: '', memo: '', isRecurring: false,
  recurringDay: '', status: 'planned', saving: false, error: '',
};

type RecurringAction = { type: 'edit' | 'delete'; cashFlow: CashFlow } | null;

type PartialPayForm = {
  invoiceId: number;
  amount: string;
  date: string;
  memo: string;
  saving: boolean;
  error: string;
};

function calcTotal(items: InvoiceItem[]) {
  return items.reduce((s, i) => s + Number(i.supply_amount) + Number(i.tax_amount), 0);
}
function calcPaid(payments: Payment[]) {
  return payments.reduce((s, p) => s + Number(p.amount), 0);
}

// 수금 먼저 → 지급, 각 그룹 내 가나다
function sortByDirThenName<T>(items: T[], getDir: (i: T) => string, getName: (i: T) => string): T[] {
  const rec = items.filter(i => getDir(i) === 'receivable').sort((a, b) => getName(a).localeCompare(getName(b), 'ko'));
  const pay = items.filter(i => getDir(i) === 'payable').sort((a, b) => getName(a).localeCompare(getName(b), 'ko'));
  return [...rec, ...pay];
}

export default function FinanceCalendarTab() {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [factoryFilter, setFactoryFilter] = useState<FactoryFilter>('all');

  const [invoices, setInvoices] = useState<InvoiceWithDetails[]>([]);
  const [cashFlows, setCashFlows] = useState<CashFlow[]>([]);
  const [monthPayments, setMonthPayments] = useState<PaymentWithInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');

  const [cfModal, setCfModal] = useState<CfModal>(EMPTY_CF_MODAL);
  const [recurringAction, setRecurringAction] = useState<RecurringAction>(null);
  const [editAllCf, setEditAllCf] = useState<CashFlow | null>(null);
  const [deletingCfId, setDeletingCfId] = useState<number | null>(null);

  const [invoiceEdit, setInvoiceEdit] = useState<InvoiceEditSheet>(EMPTY_INVOICE_EDIT);
  const lastTapRef = useRef<{ id: number; time: number } | null>(null);
  const lastPaymentTapRef = useRef<{ id: number; time: number } | null>(null);

  // 17차 신규 상태
  const [executedOpen, setExecutedOpen] = useState(false);
  const [plannedOpen, setPlannedOpen] = useState(false);
  const [partialPayForm, setPartialPayForm] = useState<PartialPayForm | null>(null);
  const [processingIds, setProcessingIds] = useState<Set<number>>(new Set());
  const [categories, setCategories] = useState<string[]>([]);
  const [categoryListOpen, setCategoryListOpen] = useState(false);
  const [addCategoryPrompt, setAddCategoryPrompt] = useState<string | null>(null);

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
      .from('cash_flows').select('*')
      .gte('date', from).lte('date', to)
      .order('date', { ascending: true });
    if (error) throw error;
    setCashFlows((data ?? []) as CashFlow[]);
  }, []);

  const fetchMonthPayments = useCallback(async (y: number, m: number) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const from = `${y}-${pad(m + 1)}-01`;
    const to = `${y}-${pad(m + 1)}-31`;
    const { data, error } = await supabase
      .from('payments')
      .select(`
        id, invoice_id, amount, date, memo, created_at,
        invoice:invoices(
          company_name, direction, factory,
          items:invoice_items(supply_amount, tax_amount),
          all_payments:payments(amount)
        )
      `)
      .gte('date', from).lte('date', to)
      .order('date', { ascending: true });
    if (error) throw error;

    const result: PaymentWithInvoice[] = ((data ?? []) as unknown as RawPaymentFromDB[]).map((p) => {
      const inv = p.invoice;
      const invTotal = inv ? (inv.items ?? []).reduce((s, i) => s + Number(i.supply_amount) + Number(i.tax_amount), 0) : 0;
      const invCumPaid = inv ? (inv.all_payments ?? []).reduce((s, ap) => s + Number(ap.amount), 0) : 0;
      return {
        id: p.id, invoice_id: p.invoice_id, amount: p.amount,
        date: p.date, memo: p.memo,
        invoiceCompanyName: inv?.company_name ?? '알 수 없음',
        invoiceDirection: (inv?.direction ?? 'receivable') as 'receivable' | 'payable',
        invoiceFactory: inv?.factory ?? null,
        invoiceTotal: invTotal, invoiceCumPaid: invCumPaid,
      };
    });
    setMonthPayments(result);
  }, []);

  async function fetchCategories() {
    const { data } = await supabase.from('cash_flow_categories').select('name').order('name');
    if (data) setCategories((data as { name: string }[]).map((d) => d.name));
  }

  async function ensureRecurringCashFlows(y: number, m: number) {
    const pad = (n: number) => String(n).padStart(2, '0');
    const { data: templates } = await supabase.from('cash_flows').select('*').eq('is_recurring', true);
    if (!templates || templates.length === 0) return;

    const from = `${y}-${pad(m + 1)}-01`;
    const to = `${y}-${pad(m + 1)}-31`;
    const { data: existing } = await supabase.from('cash_flows').select('recurring_day, date').gte('date', from).lte('date', to);

    const existingDays = new Set(
      (existing ?? []).filter((e) => e.recurring_day != null).map((e) => e.recurring_day as number)
    );

    for (const tmpl of templates as CashFlow[]) {
      if (!tmpl.recurring_day) continue;
      if (tmpl.date.startsWith(`${y}-${pad(m + 1)}`)) continue;
      if (existingDays.has(tmpl.recurring_day)) continue;

      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const day = Math.min(tmpl.recurring_day, daysInMonth);
      await supabase.from('cash_flows').insert({
        date: `${y}-${pad(m + 1)}-${pad(day)}`,
        amount: tmpl.amount, category: tmpl.category, memo: tmpl.memo,
        is_recurring: false, recurring_day: tmpl.recurring_day, status: 'planned',
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
          fetchMonthPayments(today.getFullYear(), today.getMonth()),
          fetchCategories(),
        ]);
      } catch (e) { setErrorText(getErrorMessage(e)); }
      finally { setLoading(false); }
    };
    void init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void fetchCashFlows(year, month).catch((e) => setErrorText(getErrorMessage(e)));
    void fetchMonthPayments(year, month).catch((e) => setErrorText(getErrorMessage(e)));
  }, [year, month, fetchCashFlows, fetchMonthPayments]);

  // 결제 후 invoices + monthPayments 갱신
  async function refreshAfterPayment() {
    await Promise.all([fetchInvoices(), fetchMonthPayments(year, month)]);
  }

  async function handleCheckCf(cf: CashFlow, checked: boolean) {
    if (!checked) {
      if (!window.confirm('예정으로 되돌릴까요?')) return;
    }
    const newStatus = checked ? 'done' : 'planned';
    const updates: Record<string, unknown> = { status: newStatus };
    if (checked) updates.date = todayString();
    const { error } = await supabase.from('cash_flows').update(updates).eq('id', cf.id);
    if (error) { setErrorText(getErrorMessage(error)); return; }
    await fetchCashFlows(year, month);
  }

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

  const filteredPayments = monthPayments.filter((p) =>
    factoryFilter === 'all' ? true : p.invoiceFactory === factoryFilter
  );
  const paymentDates = new Set<string>(filteredPayments.map((p) => p.date.slice(0, 10)));

  function toDateKey(day: number) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); } else setMonth((m) => m - 1);
    setSelectedDate(null);
  }
  function nextMonth() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); } else setMonth((m) => m + 1);
    setSelectedDate(null);
  }

  const selectedInvoices = selectedDate
    ? filteredInvoices.filter((inv) => inv.due_date?.slice(0, 10) === selectedDate)
    : [];
  const selectedCashFlows = selectedDate
    ? cashFlows.filter((cf) => cf.date.slice(0, 10) === selectedDate)
    : [];
  const selectedPayments = selectedDate
    ? filteredPayments.filter((p) => p.date.slice(0, 10) === selectedDate)
    : [];

  // 실행 토글 아이템
  const executedPayments = selectedPayments;
  const executedCfs = selectedCashFlows.filter(cf => cf.status === 'done');
  const hasExecuted = executedPayments.length > 0 || executedCfs.length > 0;

  // 예정 토글 아이템
  const plannedCfs = selectedCashFlows.filter(cf => cf.status !== 'done');
  const hasPlanned = selectedInvoices.length > 0 || plannedCfs.length > 0;

  // 실행 합계
  const executedReceivableSum = executedPayments.filter(p => p.invoiceDirection === 'receivable').reduce((s, p) => s + Number(p.amount), 0)
    + executedCfs.filter(cf => Number(cf.amount) >= 0).reduce((s, cf) => s + Number(cf.amount), 0);
  const executedPayableSum = executedPayments.filter(p => p.invoiceDirection === 'payable').reduce((s, p) => s + Number(p.amount), 0)
    + executedCfs.filter(cf => Number(cf.amount) < 0).reduce((s, cf) => s + Math.abs(Number(cf.amount)), 0);

  // 예정 합계 (미완납만)
  const plannedReceivableSum = selectedInvoices.filter(inv => inv.direction === 'receivable')
    .reduce((s, inv) => s + Math.max(0, calcTotal(inv.items) - calcPaid(inv.payments)), 0)
    + plannedCfs.filter(cf => Number(cf.amount) >= 0).reduce((s, cf) => s + Number(cf.amount), 0);
  const plannedPayableSum = selectedInvoices.filter(inv => inv.direction === 'payable')
    .reduce((s, inv) => s + Math.max(0, calcTotal(inv.items) - calcPaid(inv.payments)), 0)
    + plannedCfs.filter(cf => Number(cf.amount) < 0).reduce((s, cf) => s + Math.abs(Number(cf.amount)), 0);

  const cells: Array<number | null> = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);

  const MONTH_NAMES = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const DOW_LABELS = ['일','월','화','수','목','금','토'];

  // ── ★ CRUD ──
  function openAddCf(date?: string) {
    setCfModal({ ...EMPTY_CF_MODAL, open: true, date: date ?? selectedDate ?? todayString() });
  }
  function openEditCf(cf: CashFlow) {
    if (cf.is_recurring || cf.recurring_day != null) { setRecurringAction({ type: 'edit', cashFlow: cf }); return; }
    setCfModal({
      open: true, editingId: cf.id, date: cf.date,
      amount: String(Math.abs(cf.amount)), typeSign: cf.amount >= 0 ? 1 : -1,
      category: cf.category ?? '', memo: cf.memo ?? '',
      isRecurring: false, recurringDay: '',
      status: cf.status === 'done' ? 'done' : 'planned',
      saving: false, error: '',
    });
  }
  function openEditCfDirect(cf: CashFlow) {
    setCfModal({
      open: true, editingId: cf.id, date: cf.date,
      amount: String(Math.abs(cf.amount)), typeSign: cf.amount >= 0 ? 1 : -1,
      category: cf.category ?? '', memo: cf.memo ?? '',
      isRecurring: cf.is_recurring, recurringDay: cf.recurring_day ? String(cf.recurring_day) : '',
      status: cf.status === 'done' ? 'done' : 'planned',
      saving: false, error: '',
    });
  }

  async function handleSaveCf() {
    const amt = Number(cfModal.amount);
    if (!cfModal.amount || isNaN(amt) || amt <= 0) { setCfModal((p) => ({ ...p, error: '금액을 입력해줘.' })); return; }
    if (!cfModal.date) { setCfModal((p) => ({ ...p, error: '날짜를 입력해줘.' })); return; }
    if (cfModal.isRecurring && (!cfModal.recurringDay || isNaN(Number(cfModal.recurringDay)))) {
      setCfModal((p) => ({ ...p, error: '반복 날짜(1~31)를 입력해줘.' })); return;
    }
    try {
      setCfModal((p) => ({ ...p, saving: true, error: '' }));
      const payload = {
        date: cfModal.date, amount: cfModal.typeSign * amt,
        category: cfModal.category.trim() || null, memo: cfModal.memo.trim() || null,
        is_recurring: cfModal.isRecurring,
        recurring_day: cfModal.isRecurring ? Number(cfModal.recurringDay) : null,
        status: cfModal.status,
      };
      if (cfModal.editingId) {
        const { error } = await supabase.from('cash_flows').update(payload).eq('id', cfModal.editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('cash_flows').insert(payload);
        if (error) throw error;
      }
      if (editAllCf?.recurring_day) {
        await supabase.from('cash_flows').update({
          amount: cfModal.typeSign * amt,
          category: cfModal.category.trim() || null,
          memo: cfModal.memo.trim() || null,
        }).eq('is_recurring', true).eq('recurring_day', editAllCf.recurring_day);
      }
      setEditAllCf(null);
      await fetchCashFlows(year, month);
      const trimmedCat = cfModal.category.trim();
      if (trimmedCat && !categories.includes(trimmedCat)) {
        setCfModal((p) => ({ ...p, saving: false }));
        setAddCategoryPrompt(trimmedCat);
      } else {
        setCfModal(EMPTY_CF_MODAL);
      }
    } catch (e) { setCfModal((p) => ({ ...p, saving: false, error: getErrorMessage(e) })); }
  }

  async function handleDeleteCf(id: number) {
    const cf = cashFlows.find((c) => c.id === id);
    if (!cf) return;
    if (cf.is_recurring || cf.recurring_day != null) { setRecurringAction({ type: 'delete', cashFlow: cf }); return; }
    if (!window.confirm('이 ★ 항목을 삭제할까요?')) return;
    try {
      setDeletingCfId(id);
      const { error } = await supabase.from('cash_flows').delete().eq('id', id);
      if (error) throw error;
      await fetchCashFlows(year, month);
    } catch (e) { setErrorText(getErrorMessage(e)); }
    finally { setDeletingCfId(null); }
  }

  async function handleDeleteSingle(cf: CashFlow) {
    try {
      setDeletingCfId(cf.id);
      const { error } = await supabase.from('cash_flows').delete().eq('id', cf.id);
      if (error) throw error;
      setRecurringAction(null);
      await fetchCashFlows(year, month);
    } catch (e) { setErrorText(getErrorMessage(e)); }
    finally { setDeletingCfId(null); }
  }

  async function handleDisableRecurring(cf: CashFlow) {
    try {
      if (cf.recurring_day) {
        await supabase.from('cash_flows').update({ is_recurring: false }).eq('is_recurring', true).eq('recurring_day', cf.recurring_day);
      }
      if (cf.is_recurring) await supabase.from('cash_flows').delete().eq('id', cf.id);
      setRecurringAction(null);
      await fetchCashFlows(year, month);
    } catch (e) { setErrorText(getErrorMessage(e)); }
  }

  async function handleRevertPayment(paymentId: number) {
    try {
      const { error } = await supabase.from('payments').delete().eq('id', paymentId);
      if (error) throw error;
      await refreshAfterPayment();
    } catch (e) { setErrorText(getErrorMessage(e)); }
  }

  function handlePaymentNameTap(paymentId: number) {
    const now = Date.now();
    const last = lastPaymentTapRef.current;
    if (last && last.id === paymentId && now - last.time < 400) {
      lastPaymentTapRef.current = null;
      if (!window.confirm('예정으로 되돌릴까요?')) return;
      void handleRevertPayment(paymentId);
    } else {
      lastPaymentTapRef.current = { id: paymentId, time: now };
    }
  }

  // invoice 더블탭 수정
  function handleInvoiceTap(inv: InvoiceWithDetails) {
    const now = Date.now();
    const last = lastTapRef.current;
    if (last && last.id === inv.id && now - last.time < 400) {
      lastTapRef.current = null;
      openInvoiceEdit(inv);
    } else {
      lastTapRef.current = { id: inv.id, time: now };
    }
  }

  function openInvoiceEdit(inv: InvoiceWithDetails) {
    setInvoiceEdit({
      open: true, invoice: inv, companyName: inv.company_name,
      dueDate: inv.due_date ?? '', factory: inv.factory ?? '',
      invoiceStatus: inv.invoice_status ?? 'none', paymentDone: inv.payment_done,
      note: inv.note ?? '', saving: false, error: '',
    });
  }

  async function handleSaveInvoiceEdit() {
    if (!invoiceEdit.invoice) return;
    if (!invoiceEdit.companyName.trim()) { setInvoiceEdit((p) => ({ ...p, error: '거래처명을 입력해줘.' })); return; }
    try {
      setInvoiceEdit((p) => ({ ...p, saving: true, error: '' }));
      const { error } = await supabase.from('invoices').update({
        company_name: invoiceEdit.companyName.trim(),
        due_date: invoiceEdit.dueDate || null,
        factory: invoiceEdit.factory || null,
        invoice_status: invoiceEdit.invoiceStatus,
        payment_done: invoiceEdit.paymentDone,
        note: invoiceEdit.note.trim() || null,
      }).eq('id', invoiceEdit.invoice.id);
      if (error) throw error;
      setInvoiceEdit(EMPTY_INVOICE_EDIT);
      await fetchInvoices();
    } catch (e) { setInvoiceEdit((p) => ({ ...p, saving: false, error: getErrorMessage(e) })); }
  }

  // ── 결제 처리 (6-1 체크박스) ──
  async function handleCheckPayment(inv: InvoiceWithDetails, date: string) {
    const remaining = Math.max(0, calcTotal(inv.items) - calcPaid(inv.payments));
    if (remaining <= 0) return;
    setProcessingIds((prev) => new Set(prev).add(inv.id));
    try {
      const { error } = await supabase.from('payments').insert({
        invoice_id: inv.id, amount: remaining, date, memo: '전액 결제',
      });
      if (error) throw error;
      await refreshAfterPayment();
    } catch (e) { setErrorText(getErrorMessage(e)); }
    finally { setProcessingIds((prev) => { const s = new Set(prev); s.delete(inv.id); return s; }); }
  }

  async function handleUncheckPayment(inv: InvoiceWithDetails, date: string) {
    if (!window.confirm('이 날짜의 결제 내역을 삭제할까요?')) return;
    const payment = inv.payments
      .filter((p) => p.date?.slice(0, 10) === date)
      .sort((a, b) => b.id - a.id)[0];
    if (!payment) { setErrorText('해당 날짜의 결제 내역을 찾을 수 없어.'); return; }
    setProcessingIds((prev) => new Set(prev).add(inv.id));
    try {
      const { error } = await supabase.from('payments').delete().eq('id', payment.id);
      if (error) throw error;
      await refreshAfterPayment();
    } catch (e) { setErrorText(getErrorMessage(e)); }
    finally { setProcessingIds((prev) => { const s = new Set(prev); s.delete(inv.id); return s; }); }
  }

  // ── 결제 처리 (6-2 일부 결제) ──
  function openPartialPay(inv: InvoiceWithDetails) {
    setPartialPayForm({
      invoiceId: inv.id, amount: '', date: selectedDate ?? todayString(),
      memo: '', saving: false, error: '',
    });
  }

  async function handleSavePartialPay() {
    if (!partialPayForm) return;
    const amt = Number(partialPayForm.amount);
    if (!partialPayForm.amount || isNaN(amt) || amt <= 0) {
      setPartialPayForm((p) => p ? { ...p, error: '금액을 입력해줘.' } : null); return;
    }
    if (!partialPayForm.date) {
      setPartialPayForm((p) => p ? { ...p, error: '날짜를 입력해줘.' } : null); return;
    }
    setPartialPayForm((p) => p ? { ...p, saving: true, error: '' } : null);
    try {
      const { error } = await supabase.from('payments').insert({
        invoice_id: partialPayForm.invoiceId, amount: amt,
        date: partialPayForm.date, memo: partialPayForm.memo.trim() || null,
      });
      if (error) throw error;
      setPartialPayForm(null);
      await refreshAfterPayment();
    } catch (e) { setPartialPayForm((p) => p ? { ...p, saving: false, error: getErrorMessage(e) } : null); }
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
            const hasPayment = paymentDates.has(key);
            const isToday = key === todayKey;
            const isSelected = key === selectedDate;
            const dow = (startDow + day - 1) % 7;
            return (
              <button key={key} onClick={() => { setSelectedDate(isSelected ? null : key); setExecutedOpen(false); setPlannedOpen(false); }}
                className={cn('flex flex-col items-center justify-center rounded-2xl py-2 transition',
                  isSelected && 'bg-neutral-900',
                  !isSelected && isToday && 'border border-neutral-400',
                  !isSelected && !isToday && 'hover:bg-neutral-50',
                )}>
                <span className={cn('text-sm font-medium', isSelected ? 'text-white' : dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-neutral-800')}>
                  {day}
                </span>
                {(hasInvoice || hasPayment) && (
                  <div className="flex gap-0.5 mt-0.5">
                    {hasInvoice && <span className={cn('h-1.5 w-1.5 rounded-full', isSelected ? 'bg-white' : 'bg-blue-400')} />}
                    {hasPayment && <span className={cn('h-1.5 w-1.5 rounded-full', isSelected ? 'bg-white' : 'bg-green-500')} />}
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
          <span className="h-2 w-2 rounded-full bg-blue-400 inline-block" />예정
        </div>
        <div className="flex items-center gap-1 text-[11px] text-neutral-400">
          <span className="h-2 w-2 rounded-full bg-green-500 inline-block" />실행
        </div>
      </div>

      {/* 선택 날짜 내역 */}
      {selectedDate && (
        <div className="mt-4 space-y-3">
          {/* 헤더 */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-neutral-700">{selectedDate.replace(/-/g, '/')} 내역</p>
            <button onClick={() => openAddCf(selectedDate)}
              className="rounded-2xl border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700">
              + ★
            </button>
          </div>

          {/* ── 실행 토글 ── */}
          <div className="rounded-3xl border border-neutral-200 bg-white overflow-hidden shadow-sm">
            <button
              onClick={() => setExecutedOpen((o) => !o)}
              className="w-full flex items-center justify-between px-4 py-3">
              <span className="text-sm font-bold text-neutral-800">실행</span>
              <div className="flex items-center gap-3">
                {hasExecuted && (
                  <div className="flex gap-2 text-xs">
                    {executedReceivableSum > 0 && (
                      <span className="font-semibold text-emerald-600">+{formatCurrency(executedReceivableSum)}원</span>
                    )}
                    {executedPayableSum > 0 && (
                      <span className="font-semibold text-orange-600">-{formatCurrency(executedPayableSum)}원</span>
                    )}
                  </div>
                )}
                <span className="text-neutral-400 text-sm">{executedOpen ? '▲' : '▼'}</span>
              </div>
            </button>

            {executedOpen && (
              <div className="border-t border-neutral-100 px-4 pb-4 pt-3 space-y-3">
                {!hasExecuted ? (
                  <p className="text-sm text-neutral-400 text-center py-2">실행 내역 없음</p>
                ) : (
                  <>
                    {/* 실행 합계 행 */}
                    {(executedReceivableSum > 0 || executedPayableSum > 0) && (
                      <div className="flex gap-3 rounded-2xl bg-neutral-50 px-4 py-2 text-sm">
                        <span className="text-neutral-500">수금총액</span>
                        <span className="font-bold text-emerald-600 ml-auto">{formatCurrency(executedReceivableSum)}원</span>
                        <span className="text-neutral-300">|</span>
                        <span className="text-neutral-500">지급총액</span>
                        <span className="font-bold text-orange-600">{formatCurrency(executedPayableSum)}원</span>
                      </div>
                    )}

                    {/* payments 아이템 */}
                    <p className="text-[11px] text-neutral-400">거래처명 더블탭 → 예정으로 되돌리기</p>
                    {sortByDirThenName(
                      executedPayments,
                      (p) => p.invoiceDirection,
                      (p) => p.invoiceCompanyName,
                    ).map((p) => {
                      const balance = Math.max(0, p.invoiceTotal - p.invoiceCumPaid);
                      return (
                        <div key={`pay-${p.id}`} className="rounded-2xl border border-green-100 bg-green-50 p-3">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <p
                              className="font-bold text-sm truncate flex-1 cursor-pointer select-none"
                              onDoubleClick={() => { if (window.confirm('예정으로 되돌릴까요?')) void handleRevertPayment(p.id); }}
                              onTouchEnd={() => handlePaymentNameTap(p.id)}
                            >{p.invoiceCompanyName}</p>
                            <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold shrink-0', p.invoiceDirection === 'receivable' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>
                              {p.invoiceDirection === 'receivable' ? '수금' : '지급'}
                            </span>
                          </div>
                          <div className="space-y-0.5 text-xs text-neutral-600">
                            <div className="flex justify-between">
                              <span>이번 결제</span>
                              <span className="font-semibold text-green-700">{formatCurrency(Number(p.amount))}원</span>
                            </div>
                            {p.invoiceTotal > 0 && (
                              <>
                                <div className="flex justify-between">
                                  <span>누적 {p.invoiceDirection === 'receivable' ? '수령' : '지급'}</span>
                                  <span>{formatCurrency(p.invoiceCumPaid)}원</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className={balance > 0 ? 'text-orange-600' : 'text-emerald-600'}>잔액</span>
                                  <span className={cn('font-bold', balance > 0 ? 'text-orange-600' : 'text-emerald-600')}>
                                    {balance > 0 ? `${formatCurrency(balance)}원` : '완납'}
                                  </span>
                                </div>
                              </>
                            )}
                            {p.memo && <p className="text-green-700 mt-0.5">{p.memo}</p>}
                          </div>
                        </div>
                      );
                    })}

                    {/* ★ done 아이템 */}
                    {sortByDirThenName(
                      executedCfs,
                      (cf) => Number(cf.amount) >= 0 ? 'receivable' : 'payable',
                      (cf) => cf.category || cf.memo || '★',
                    ).map((cf) => {
                      const isIncome = Number(cf.amount) >= 0;
                      return (
                        <div key={`cf-${cf.id}`} className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <p className="font-bold text-sm truncate flex-1">{cf.category || cf.memo || '★'}</p>
                            <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold shrink-0', isIncome ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>
                              {isIncome ? '수금' : '지급'}
                            </span>
                          </div>
                          <div className="space-y-0.5 text-xs text-neutral-600">
                            <div className="flex justify-between">
                              <span>금액</span>
                              <span className={cn('font-semibold', isIncome ? 'text-emerald-700' : 'text-red-700')}>
                                {isIncome ? '+' : '-'}{formatCurrency(Math.abs(Number(cf.amount)))}원
                              </span>
                            </div>
                            {cf.memo && cf.category && <p className="text-emerald-700 mt-0.5">{cf.memo}</p>}
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <button
                              onClick={() => void handleCheckCf(cf, false)}
                              className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700"
                              title="예정으로 되돌리기"
                            >
                              <span className="w-4 h-4 rounded border-2 border-emerald-400 bg-emerald-400 flex items-center justify-center shrink-0">
                                <span className="text-white text-[10px] leading-none">✓</span>
                              </span>
                              예정으로
                            </button>
                            <div className="flex gap-2">
                              <button onClick={() => openEditCf(cf)}
                                className="rounded-xl border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700">수정</button>
                              <button onClick={() => void handleDeleteCf(cf.id)} disabled={deletingCfId === cf.id}
                                className="rounded-xl border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 disabled:opacity-50">
                                {deletingCfId === cf.id ? '삭제중' : '삭제'}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── 예정 토글 ── */}
          <div className="rounded-3xl border border-neutral-200 bg-white overflow-hidden shadow-sm">
            <button
              onClick={() => setPlannedOpen((o) => !o)}
              className="w-full flex items-center justify-between px-4 py-3">
              <span className="text-sm font-bold text-neutral-800">예정</span>
              <div className="flex items-center gap-3">
                {hasPlanned && (
                  <div className="flex gap-2 text-xs">
                    {plannedReceivableSum > 0 && (
                      <span className="font-semibold text-emerald-600">+{formatCurrency(plannedReceivableSum)}원</span>
                    )}
                    {plannedPayableSum > 0 && (
                      <span className="font-semibold text-orange-600">-{formatCurrency(plannedPayableSum)}원</span>
                    )}
                  </div>
                )}
                <span className="text-neutral-400 text-sm">{plannedOpen ? '▲' : '▼'}</span>
              </div>
            </button>

            {plannedOpen && (
              <div className="border-t border-neutral-100 px-4 pb-4 pt-3 space-y-3">
                {!hasPlanned ? (
                  <p className="text-sm text-neutral-400 text-center py-2">예정 내역 없음</p>
                ) : (
                  <>
                    {/* 예정 합계 행 */}
                    {(plannedReceivableSum > 0 || plannedPayableSum > 0) && (
                      <div className="flex gap-3 rounded-2xl bg-neutral-50 px-4 py-2 text-sm">
                        <span className="text-neutral-500">수금예정</span>
                        <span className="font-bold text-emerald-600 ml-auto">{formatCurrency(plannedReceivableSum)}원</span>
                        <span className="text-neutral-300">|</span>
                        <span className="text-neutral-500">지급예정</span>
                        <span className="font-bold text-orange-600">{formatCurrency(plannedPayableSum)}원</span>
                      </div>
                    )}

                    <p className="text-[11px] text-neutral-400">회사이름 더블탭 → 수정</p>

                    {/* invoice 아이템: 미완납(수금→지급 가나다) + 완납(맨 아래 연하게) */}
                    {(() => {
                      const withRemaining = selectedInvoices.map(inv => ({
                        inv, remaining: Math.max(0, calcTotal(inv.items) - calcPaid(inv.payments)),
                      }));
                      const incomplete = sortByDirThenName(
                        withRemaining.filter(x => x.remaining > 0),
                        (x) => x.inv.direction, (x) => x.inv.company_name,
                      );
                      const complete = sortByDirThenName(
                        withRemaining.filter(x => x.remaining === 0),
                        (x) => x.inv.direction, (x) => x.inv.company_name,
                      );
                      return [...incomplete, ...complete].map(({ inv, remaining }) => {
                        const total = calcTotal(inv.items);
                        const paid = calcPaid(inv.payments);
                        const isDone = remaining === 0;
                        const isProcessing = processingIds.has(inv.id);
                        const showPartialForm = partialPayForm?.invoiceId === inv.id;

                        return (
                          <div key={inv.id} className={cn('rounded-2xl border p-3', isDone ? 'border-neutral-100 bg-neutral-50 opacity-60' : 'border-blue-100 bg-blue-50')}>
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <p
                                className="font-bold text-sm truncate flex-1 cursor-pointer select-none"
                                onDoubleClick={() => openInvoiceEdit(inv)}
                                onTouchEnd={() => handleInvoiceTap(inv)}
                              >
                                {inv.company_name}
                              </p>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', inv.direction === 'receivable' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>
                                  {inv.direction === 'receivable' ? '수금' : '지급'}
                                </span>
                                {inv.factory && (
                                  <span className="rounded-full border border-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-500">{inv.factory}</span>
                                )}
                                {/* 6-1 완료 체크박스 */}
                                <button
                                  disabled={isProcessing}
                                  onClick={() => isDone
                                    ? void handleUncheckPayment(inv, selectedDate!)
                                    : void handleCheckPayment(inv, selectedDate!)}
                                  className={cn(
                                    'w-5 h-5 rounded border-2 flex items-center justify-center transition shrink-0',
                                    isDone ? 'border-emerald-500 bg-emerald-500' : 'border-neutral-300 bg-white',
                                    isProcessing && 'opacity-50',
                                  )}
                                >
                                  {isDone && <span className="text-white text-xs">✓</span>}
                                </button>
                              </div>
                            </div>

                            <div className="space-y-0.5 text-xs text-neutral-600 mb-2">
                              <div className="flex justify-between">
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

                            {/* 기존 결제 히스토리 (일부결제 폼 열릴 때) */}
                            {showPartialForm && inv.payments.length > 0 && (
                              <div className="mb-2 rounded-xl bg-white border border-blue-100 px-3 py-2 space-y-1">
                                <p className="text-[10px] text-neutral-400 font-semibold">결제 히스토리</p>
                                {inv.payments.map((p) => (
                                  <div key={p.id} className="flex justify-between text-xs text-neutral-600">
                                    <span>{p.date?.slice(0, 10)}</span>
                                    <span className="font-semibold">{formatCurrency(Number(p.amount))}원</span>
                                    {p.memo && <span className="text-neutral-400">{p.memo}</span>}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* 6-2 일부 결제 폼 */}
                            {showPartialForm ? (
                              <div className="space-y-2 rounded-xl bg-white border border-blue-200 p-3">
                                <p className="text-xs font-semibold text-blue-700">일부 결제</p>
                                <input
                                  type="number" inputMode="decimal" placeholder="금액"
                                  value={partialPayForm!.amount}
                                  onChange={(e) => setPartialPayForm(p => p ? { ...p, amount: e.target.value } : null)}
                                  className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
                                  autoFocus
                                />
                                <input
                                  type="date"
                                  value={partialPayForm!.date}
                                  onChange={(e) => setPartialPayForm(p => p ? { ...p, date: e.target.value } : null)}
                                  className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
                                />
                                <input
                                  placeholder="메모 (선택)"
                                  value={partialPayForm!.memo}
                                  onChange={(e) => setPartialPayForm(p => p ? { ...p, memo: e.target.value } : null)}
                                  className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none placeholder:text-neutral-400 focus:border-blue-400"
                                />
                                {partialPayForm!.error && (
                                  <p className="text-xs text-red-600">{partialPayForm!.error}</p>
                                )}
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => void handleSavePartialPay()}
                                    disabled={partialPayForm!.saving}
                                    className="flex-1 rounded-xl bg-neutral-900 py-2 text-xs font-semibold text-white disabled:opacity-50">
                                    {partialPayForm!.saving ? '저장중' : '저장'}
                                  </button>
                                  <button
                                    onClick={() => setPartialPayForm(null)}
                                    className="flex-1 rounded-xl border border-neutral-200 py-2 text-xs font-semibold text-neutral-600">
                                    취소
                                  </button>
                                </div>
                              </div>
                            ) : (
                              !isDone && (
                                <button
                                  onClick={() => openPartialPay(inv)}
                                  className="rounded-xl border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700">
                                  일부 결제
                                </button>
                              )
                            )}

                            <div className="mt-1 flex items-center gap-2 flex-wrap">
                              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium',
                                inv.invoice_status === 'issued' ? 'bg-emerald-50 text-emerald-700' :
                                inv.invoice_status === 'scheduled' ? 'bg-blue-50 text-blue-700' :
                                'bg-neutral-100 text-neutral-500'
                              )}>
                                {inv.invoice_status === 'issued' ? '계산서 발행' : inv.invoice_status === 'scheduled' ? '발행예정' : '미발행'}
                              </span>
                              {inv.note && <span className="text-[10px] text-blue-600">{inv.note}</span>}
                            </div>
                          </div>
                        );
                      });
                    })()}

                    {/* ★ planned 아이템 */}
                    {sortByDirThenName(
                      plannedCfs,
                      (cf) => Number(cf.amount) >= 0 ? 'receivable' : 'payable',
                      (cf) => cf.category || cf.memo || '★',
                    ).map((cf) => {
                      const isIncome = Number(cf.amount) >= 0;
                      const isRecurringRelated = cf.is_recurring || cf.recurring_day != null;
                      return (
                        <div key={`cf-${cf.id}`} className="rounded-2xl border border-blue-100 bg-blue-50 p-3">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <p className="font-bold text-sm truncate flex-1">{cf.category || cf.memo || '★'}</p>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {isRecurringRelated && (
                                <span className="rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700">반복</span>
                              )}
                              <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', isIncome ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>
                                {isIncome ? '수금' : '지급'}
                              </span>
                              <button
                                onClick={() => void handleCheckCf(cf, true)}
                                className="w-5 h-5 rounded border-2 border-blue-300 bg-white flex items-center justify-center shrink-0"
                                title="실행 완료로 표시"
                              />
                            </div>
                          </div>
                          <div className="space-y-0.5 text-xs text-neutral-600 mb-2">
                            <div className="flex justify-between">
                              <span>금액</span>
                              <span className={cn('font-semibold', isIncome ? 'text-emerald-700' : 'text-red-700')}>
                                {isIncome ? '+' : '-'}{formatCurrency(Math.abs(Number(cf.amount)))}원
                              </span>
                            </div>
                            {cf.memo && cf.category && <p className="text-blue-600">{cf.memo}</p>}
                          </div>
                          <div className="flex gap-2 justify-end">
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
                  </>
                )}
              </div>
            )}
          </div>

          {/* 내역 없을 때 */}
          {!hasExecuted && !hasPlanned && (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-4 py-6 text-center text-sm text-neutral-500">
              이 날 내역이 없어.
            </div>
          )}
        </div>
      )}

      {/* ── ★ 추가/수정 모달 ── */}
      {cfModal.open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setCfModal(EMPTY_CF_MODAL)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-10" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-base font-bold">{cfModal.editingId ? '★ 수정' : '★ 추가'}</p>
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
                <p className="mb-1 text-xs text-neutral-500">상태</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setCfModal((p) => ({ ...p, status: 'planned' }))}
                    className={cn('rounded-2xl border py-2.5 text-sm font-semibold', cfModal.status === 'planned' ? 'border-blue-500 bg-blue-500 text-white' : 'border-neutral-200 bg-white text-neutral-700')}>
                    예정
                  </button>
                  <button onClick={() => setCfModal((p) => ({ ...p, status: 'done' }))}
                    className={cn('rounded-2xl border py-2.5 text-sm font-semibold', cfModal.status === 'done' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-neutral-200 bg-white text-neutral-700')}>
                    완료
                  </button>
                </div>
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
                {categories.length > 0 && (
                  <div className="mt-1.5">
                    <button type="button" onClick={() => setCategoryListOpen((o) => !o)}
                      className="text-xs text-neutral-400">
                      {categoryListOpen ? '▲ 목록 접기' : '▼ 목록에서 선택'}
                    </button>
                    {categoryListOpen && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {[...categories].sort((a, b) => a.localeCompare(b, 'ko')).map((cat) => (
                          <button type="button" key={cat}
                            onClick={() => { setCfModal((p) => ({ ...p, category: cat })); setCategoryListOpen(false); }}
                            className={cn('rounded-full border px-3 py-1 text-xs', cfModal.category === cat ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-700')}>
                            {cat}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
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
                  className={cn('w-5 h-5 rounded border-2 shrink-0 flex items-center justify-center', cfModal.isRecurring ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300 bg-white')}>
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

      {/* ── 카테고리 목록 추가 확인 팝업 ── */}
      {addCategoryPrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="w-72 rounded-3xl bg-white p-6 shadow-xl">
            <p className="text-sm font-bold mb-2">카테고리 추가</p>
            <p className="text-sm text-neutral-600 mb-4">
              <span className="font-semibold">'{addCategoryPrompt}'</span>을(를) 목록에 추가할까요?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => { setAddCategoryPrompt(null); setCfModal(EMPTY_CF_MODAL); }}
                className="flex-1 rounded-2xl border border-neutral-200 py-2.5 text-sm text-neutral-700">
                이번만 사용
              </button>
              <button
                onClick={async () => {
                  await supabase.from('cash_flow_categories').insert({ name: addCategoryPrompt });
                  await fetchCategories();
                  setAddCategoryPrompt(null);
                  setCfModal(EMPTY_CF_MODAL);
                }}
                className="flex-1 rounded-2xl bg-neutral-900 py-2.5 text-sm font-semibold text-white">
                추가
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
                  <button onClick={() => void handleDeleteSingle(recurringAction.cashFlow)} disabled={deletingCfId !== null}
                    className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold text-neutral-700 disabled:opacity-50">
                    이번 건만 삭제
                  </button>
                  <button onClick={() => void handleDisableRecurring(recurringAction.cashFlow)}
                    className="w-full rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white">
                    반복 설정 해제
                  </button>
                  <button onClick={() => setRecurringAction(null)}
                    className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-500">취소</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-base font-bold mb-1">반복 항목 수정</p>
                <p className="text-sm text-neutral-600 mb-4">어떻게 수정할까요?</p>
                <div className="space-y-2">
                  <button onClick={() => { openEditCfDirect(recurringAction.cashFlow); setRecurringAction(null); }}
                    className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold text-neutral-700">
                    이번 건만 수정
                  </button>
                  <button onClick={() => { setEditAllCf(recurringAction.cashFlow); openEditCfDirect(recurringAction.cashFlow); setRecurringAction(null); }}
                    className="w-full rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white">
                    앞으로 모두 수정
                  </button>
                  <button onClick={() => setRecurringAction(null)}
                    className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-500">취소</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Invoice 수정 Bottom Sheet ── */}
      {invoiceEdit.open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setInvoiceEdit(EMPTY_INVOICE_EDIT)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-10" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-base font-bold">정산 수정</p>
              <button onClick={() => setInvoiceEdit(EMPTY_INVOICE_EDIT)} className="rounded-full border border-neutral-200 px-3 py-1 text-xs">닫기</button>
            </div>
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-xs text-neutral-500">거래처명 *</p>
                <input value={invoiceEdit.companyName}
                  onChange={(e) => setInvoiceEdit((p) => ({ ...p, companyName: e.target.value }))}
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400" />
              </div>
              <div>
                <p className="mb-1 text-xs text-neutral-500">결제 예정일</p>
                <input type="date" value={invoiceEdit.dueDate}
                  onChange={(e) => setInvoiceEdit((p) => ({ ...p, dueDate: e.target.value }))}
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400" />
              </div>
              <div>
                <p className="mb-1 text-xs text-neutral-500">공장</p>
                <div className="grid grid-cols-3 gap-2">
                  {(['', '1공장', '2공장'] as const).map((f) => (
                    <button key={f || 'none'} onClick={() => setInvoiceEdit((p) => ({ ...p, factory: f }))}
                      className={cn('rounded-2xl border py-2 text-sm font-semibold', invoiceEdit.factory === f ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-700')}>
                      {f || '없음'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs text-neutral-500">계산서 발행 여부</p>
                <div className="grid grid-cols-3 gap-2">
                  {([['issued', '발행'], ['scheduled', '예정'], ['none', '미발행']] as const).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setInvoiceEdit((p) => ({ ...p, invoiceStatus: val }))}
                      className={cn('rounded-2xl border py-2.5 text-sm font-semibold',
                        invoiceEdit.invoiceStatus === val
                          ? val === 'issued' ? 'border-emerald-600 bg-emerald-600 text-white'
                          : val === 'scheduled' ? 'border-blue-500 bg-blue-500 text-white'
                          : 'border-neutral-400 bg-neutral-400 text-white'
                          : 'border-neutral-200 bg-white text-neutral-700'
                      )}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-neutral-200 bg-white px-4 py-3">
                <span className="text-sm text-neutral-700">결제 완료</span>
                <button onClick={() => setInvoiceEdit((p) => ({ ...p, paymentDone: !p.paymentDone }))}
                  className={cn('w-12 h-6 rounded-full transition-colors relative', invoiceEdit.paymentDone ? 'bg-emerald-500' : 'bg-neutral-200')}>
                  <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', invoiceEdit.paymentDone ? 'translate-x-6' : 'translate-x-0.5')} />
                </button>
              </div>
              <div>
                <p className="mb-1 text-xs text-neutral-500">메모</p>
                <input placeholder="메모" value={invoiceEdit.note}
                  onChange={(e) => setInvoiceEdit((p) => ({ ...p, note: e.target.value }))}
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400" />
              </div>
              {invoiceEdit.error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{invoiceEdit.error}</div>
              )}
              <button onClick={() => void handleSaveInvoiceEdit()} disabled={invoiceEdit.saving}
                className="w-full rounded-2xl bg-neutral-900 px-4 py-4 text-sm font-semibold text-white disabled:opacity-50">
                {invoiceEdit.saving ? '저장중' : '수정 저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
