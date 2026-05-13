'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { Company, CompanyMemo, DeliveryNoteTemplate, InventoryItem, Invoice, InvoiceItem, Payment } from '../lib/types';
import { cn, formatCurrency, getErrorMessage, todayString } from '../lib/utils';

async function getXLSX() { return import('xlsx'); }

type Props = {
  companies: Company[];
  inventory: InventoryItem[];
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
type InvoiceStatusFilter = 'all' | 'issued' | 'scheduled' | 'none';

type UnitPriceModalItem = {
  itemId: number;
  itemName: string;
  unitPriceId: string | null;
  unitPrice: string;
  memo: string;
};

type UnitPriceModal = {
  open: boolean;
  companyId: number | null;
  companyName: string;
  loading: boolean;
  saving: boolean;
  error: string;
  items: UnitPriceModalItem[];
  companyMemos: CompanyMemo[];
  newMemoContent: string;
  editingMemoId: string | null;
  editingMemoContent: string;
  newItemName: string;
  newItemPrice: string;
  addingItem: boolean;
  editingItemId: number | null;
  editingItemName: string;
};

const EMPTY_UNIT_PRICE_MODAL: UnitPriceModal = {
  open: false, companyId: null, companyName: '',
  loading: false, saving: false, error: '', items: [],
  companyMemos: [], newMemoContent: '',
  editingMemoId: null, editingMemoContent: '',
  newItemName: '', newItemPrice: '', addingItem: false,
  editingItemId: null, editingItemName: '',
};

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

type DnModal = {
  open: boolean;
  companyId: number | null;
  companyName: string;
  factory: string;
  template: DeliveryNoteTemplate | null;
  loading: boolean;
  generating: boolean;
  error: string;
  month: string;
  showConfig: boolean;
  cfgFile: File | null;
  cfgDataStart: number;
  cfgColDate: number;
  cfgColItem: string;
  cfgColQty: number;
  cfgColPrice: number;
  cfgColAmount: number;
  cfgColNote: string;
  cfgMonthRow: number;
  cfgMonthCol: number;
  cfgCatPC: string;
  cfgCatPP: string;
  cfgCatABS: string;
  cfgCatAF: string;
};

const curMonthStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const EMPTY_DN_MODAL: DnModal = {
  open: false, companyId: null, companyName: '', factory: '',
  template: null, loading: false, generating: false, error: '', month: curMonthStr(),
  showConfig: false, cfgFile: null,
  cfgDataStart: 9, cfgColDate: 0, cfgColItem: '1', cfgColQty: 3,
  cfgColPrice: 5, cfgColAmount: 7, cfgColNote: '9',
  cfgMonthRow: 6, cfgMonthCol: 1,
  cfgCatPC: '', cfgCatPP: '', cfgCatABS: '', cfgCatAF: '',
};

export default function SettlementTab({ companies, inventory, onCompanyAdded }: Props) {
  const [invoices, setInvoices] = useState<InvoiceWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<InvoiceStatusFilter>('all');
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
  const [formInvoiceStatus, setFormInvoiceStatus] = useState<'issued' | 'scheduled' | 'none'>('none');
  const [formItems, setFormItems] = useState<InvoiceItemDraft[]>([{ ...EMPTY_ITEM_DRAFT }]);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [paymentModal, setPaymentModal] = useState<PaymentModal>(EMPTY_PAYMENT_MODAL);

  const [pendingCompanyName, setPendingCompanyName] = useState<string | null>(null);
  const [addingCompany, setAddingCompany] = useState(false);
  const [expandedDoneIds, setExpandedDoneIds] = useState<Set<number>>(new Set());
  const [unitPriceModal, setUnitPriceModal] = useState<UnitPriceModal>(EMPTY_UNIT_PRICE_MODAL);
  const lastStarTapRef = useRef<{ name: string; time: number } | null>(null);
  const [showMonthlyOnly, setShowMonthlyOnly] = useState(false);
  const [dnModal, setDnModal] = useState<DnModal>({ ...EMPTY_DN_MODAL });

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
    if (summaryFactoryFilter !== 'all' && inv.factory !== summaryFactoryFilter) return false;
    if (invoiceStatusFilter !== 'all' && inv.invoice_status !== invoiceStatusFilter) return false;
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
  const monthlyCompanyIds = new Set(companies.filter((c) => c.is_monthly_settlement).map((c) => c.id));
  const sortedGroupKeys = Array.from(groupMap.keys())
    .filter((name) => {
      if (!showMonthlyOnly) return true;
      const inv = groupMap.get(name)?.[0];
      return inv?.company_id != null && monthlyCompanyIds.has(inv.company_id);
    })
    .sort((a, b) => a.localeCompare(b, 'ko'));

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
    setFormInvoiceStatus('none');
    setFormItems([{ ...EMPTY_ITEM_DRAFT }]);
    setShowForm(true);
  }

  function openNewFormForCompany(name: string, id: number | null) {
    setEditingInvoiceId(null);
    setFormDate(todayString());
    setFormDueDate('');
    setFormCompanyId(id);
    setFormCompanyName(name);
    setFormDirection('receivable');
    setFormNote('');
    setFormFactory(null);
    setFormInvoiceStatus('none');
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
    setFormInvoiceStatus(inv.invoice_status ?? 'none');
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
        invoice_status: formInvoiceStatus,
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
      const nextDone = !inv.payment_done;
      const { error } = await supabase.from('invoices').update({ payment_done: nextDone }).eq('id', inv.id);
      if (error) throw error;
      if (nextDone) {
        const remaining = Math.max(0, calcItemTotals(inv.items).total - calcPaid(inv.payments));
        if (remaining > 0) {
          await supabase.from('payments').insert({
            invoice_id: inv.id, amount: remaining, date: todayString(), memo: '완료 처리',
          });
        }
        await fetchInvoices();
      } else {
        setInvoices((prev) => prev.map((i) => i.id === inv.id ? { ...i, payment_done: false } : i));
      }
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

  async function setInvoiceStatus(inv: InvoiceWithItems, status: 'issued' | 'scheduled' | 'none') {
    try {
      const { error } = await supabase.from('invoices').update({ invoice_status: status }).eq('id', inv.id);
      if (error) throw error;
      setInvoices((prev) => prev.map((i) => i.id === inv.id ? { ...i, invoice_status: status } : i));
    } catch (error) {
      setErrorText(getErrorMessage(error));
    }
  }

  function handleStarTap(companyName: string, companyId: number | null) {
    const now = Date.now();
    const last = lastStarTapRef.current;
    if (last && last.name === companyName && now - last.time < 400) {
      lastStarTapRef.current = null;
      const resolvedId = companyId ?? companies.find((c) => c.name === companyName)?.id ?? null;
      void openUnitPriceModal(companyName, resolvedId);
    } else {
      lastStarTapRef.current = { name: companyName, time: now };
    }
  }

  async function toggleMonthlySettlement(companyId: number | null, companyName: string, current: boolean) {
    if (!companyId) return;
    await supabase.from('companies').update({ is_monthly_settlement: !current }).eq('id', companyId);
    await onCompanyAdded();
  }

  async function openDeliveryNoteModal(companyName: string, companyId: number | null, factory: string) {
    setDnModal({ ...EMPTY_DN_MODAL, open: true, companyId, companyName, factory, loading: true });
    if (!companyId) { setDnModal((p) => ({ ...p, loading: false, showConfig: true })); return; }
    const { data } = await supabase.from('delivery_note_templates')
      .select('*').eq('company_id', companyId).eq('factory', factory).maybeSingle();
    const tpl = data as DeliveryNoteTemplate | null;
    if (tpl) {
      setDnModal((p) => ({
        ...p, loading: false, template: tpl,
        cfgDataStart: tpl.data_start_row, cfgColDate: tpl.col_date,
        cfgColItem: tpl.col_item != null ? String(tpl.col_item) : '',
        cfgColQty: tpl.col_qty, cfgColPrice: tpl.col_price, cfgColAmount: tpl.col_amount,
        cfgColNote: tpl.col_note != null ? String(tpl.col_note) : '',
        cfgMonthRow: tpl.month_cell_row, cfgMonthCol: tpl.month_cell_col,
        cfgCatPC: tpl.category_cols?.PC ? String(tpl.category_cols.PC.col) : '',
        cfgCatPP: tpl.category_cols?.PP ? String(tpl.category_cols.PP.col) : '',
        cfgCatABS: tpl.category_cols?.ABS ? String(tpl.category_cols.ABS.col) : '',
        cfgCatAF: tpl.category_cols?.AF ? String(tpl.category_cols.AF.col) : '',
      }));
    } else {
      setDnModal((p) => ({ ...p, loading: false, showConfig: true }));
    }
  }

  async function saveDnTemplate() {
    const { companyId, factory, cfgFile, cfgDataStart, cfgColDate, cfgColItem, cfgColQty,
      cfgColPrice, cfgColAmount, cfgColNote, cfgMonthRow, cfgMonthCol,
      cfgCatPC, cfgCatPP, cfgCatABS, cfgCatAF, template } = dnModal;
    if (!companyId) return;

    let templateXlsx = template?.template_xlsx ?? '';
    if (cfgFile) {
      const buf = await cfgFile.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      bytes.forEach((b) => { bin += String.fromCharCode(b); });
      templateXlsx = btoa(bin);
    }
    if (!templateXlsx) { setDnModal((p) => ({ ...p, error: '양식 파일을 먼저 업로드해주세요.' })); return; }

    const categoryColsObj: Record<string, { col: number; prefix: string }> = {};
    if (cfgCatPC) categoryColsObj.PC = { col: parseInt(cfgCatPC), prefix: 'PC' };
    if (cfgCatPP) categoryColsObj.PP = { col: parseInt(cfgCatPP), prefix: 'PP' };
    if (cfgCatABS) categoryColsObj.ABS = { col: parseInt(cfgCatABS), prefix: 'ABS' };
    if (cfgCatAF) categoryColsObj.AF = { col: parseInt(cfgCatAF), prefix: 'AF' };

    const payload = {
      company_id: companyId, factory,
      template_xlsx: templateXlsx,
      data_start_row: cfgDataStart,
      col_date: cfgColDate,
      col_item: cfgColItem.trim() !== '' ? parseInt(cfgColItem) : null,
      col_qty: cfgColQty, col_price: cfgColPrice, col_amount: cfgColAmount,
      col_note: cfgColNote.trim() !== '' ? parseInt(cfgColNote) : null,
      month_cell_row: cfgMonthRow, month_cell_col: cfgMonthCol,
      category_cols: categoryColsObj,
    };

    if (template) {
      await supabase.from('delivery_note_templates').update(payload).eq('id', template.id);
    } else {
      await supabase.from('delivery_note_templates').insert(payload);
    }

    const { data } = await supabase.from('delivery_note_templates')
      .select('*').eq('company_id', companyId).eq('factory', factory).maybeSingle();
    setDnModal((p) => ({ ...p, template: data as DeliveryNoteTemplate, showConfig: false }));
  }

  async function generateDeliveryNote() {
    const { companyId, companyName, factory, template, month } = dnModal;
    if (!template) return;
    setDnModal((p) => ({ ...p, generating: true, error: '' }));

    try {
      const [year, mon] = month.split('-').map(Number);
      const lastDay = new Date(year, mon, 0).getDate();
      const dateFrom = `${month}-01`;
      const dateTo = `${month}-${String(lastDay).padStart(2, '0')}`;

      const logsQuery = supabase.from('inventory_logs')
        .select('date, kg_weight, qty, item_id')
        .eq('action', 'out')
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date', { ascending: true });

      if (companyId) {
        logsQuery.or(`company_id.eq.${companyId},company_name.eq.${companyName}`);
      } else {
        logsQuery.eq('company_name', companyName);
      }

      const { data: logs } = await logsQuery;
      if (!logs || logs.length === 0) {
        setDnModal((p) => ({ ...p, generating: false, error: '해당 월 출고 내역이 없습니다.' }));
        return;
      }

      const itemIds = [...new Set((logs as { item_id: number | null }[]).map((l) => l.item_id).filter(Boolean))] as number[];
      const priceMap = new Map<number, number>();
      const itemNameMap = new Map<number, string>();

      if (itemIds.length > 0) {
        const [{ data: priceData }, { data: itemData }] = await Promise.all([
          supabase.from('unit_prices').select('inventory_item_id, unit_price').in('inventory_item_id', itemIds),
          supabase.from('inventory_items').select('id, name').in('id', itemIds),
        ]);
        (priceData ?? []).forEach((p: { inventory_item_id: number; unit_price: number }) =>
          priceMap.set(p.inventory_item_id, p.unit_price));
        (itemData ?? []).forEach((i: { id: number; name: string }) =>
          itemNameMap.set(i.id, i.name));
      }

      const XLSX = await getXLSX();
      const wb = XLSX.read(template.template_xlsx, { type: 'base64' });
      const ws = wb.Sheets[wb.SheetNames[0]];

      // 월 셀 업데이트
      const monthSerial = Math.round((new Date(year, mon - 1, 1).getTime() / 86400000) + 25569);
      const monthAddr = XLSX.utils.encode_cell({ r: template.month_cell_row, c: template.month_cell_col });
      if (ws[monthAddr]) ws[monthAddr].v = monthSerial;

      // 기존 데이터 행 삭제
      const ref = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
      for (let r = template.data_start_row; r <= ref.e.r; r++) {
        for (let c = ref.s.c; c <= ref.e.c; c++) {
          delete ws[XLSX.utils.encode_cell({ r, c })];
        }
      }

      // 새 데이터 행 작성
      (logs as { date: string; kg_weight: number | null; qty: number; item_id: number | null }[]).forEach((log, idx) => {
        const r = template.data_start_row + idx;
        const itemName = log.item_id ? (itemNameMap.get(log.item_id) ?? '') : '';
        const kgQty = log.kg_weight ?? log.qty ?? 0;
        const unitPrice = log.item_id ? (priceMap.get(log.item_id) ?? 0) : 0;
        const amount = kgQty * unitPrice;

        const setCell = (c: number, v: string | number, t?: string) => {
          ws[XLSX.utils.encode_cell({ r, c })] = { v, t: t ?? (typeof v === 'number' ? 'n' : 's') };
        };

        const dateSerial = Math.round((new Date(log.date).getTime() / 86400000) + 25569);
        setCell(template.col_date, dateSerial, 'n');
        if (template.col_item != null) setCell(template.col_item, itemName);
        setCell(template.col_qty, kgQty, 'n');
        if (unitPrice > 0) setCell(template.col_price, unitPrice, 'n');
        if (amount > 0) setCell(template.col_amount, amount, 'n');

        // 카테고리 컬럼
        Object.entries(template.category_cols ?? {}).forEach(([, cfg]) => {
          if (itemName.startsWith(cfg.prefix)) setCell(cfg.col, kgQty, 'n');
        });
      });

      // ref 범위 업데이트
      ref.e.r = Math.max(ref.e.r, template.data_start_row + logs.length - 1);
      ws['!ref'] = XLSX.utils.encode_range(ref);

      XLSX.writeFile(wb, `납품내역서_${companyName}_${month}.xlsx`);
      setDnModal((p) => ({ ...p, generating: false }));
    } catch (e) {
      setDnModal((p) => ({ ...p, generating: false, error: getErrorMessage(e) }));
    }
  }

  async function openUnitPriceModal(companyName: string, companyId: number | null) {
    setUnitPriceModal({ ...EMPTY_UNIT_PRICE_MODAL, open: true, companyId, companyName, loading: true });
    try {
      // companyId가 없으면 DB에서 직접 조회
      let resolvedCompanyId = companyId;
      if (!resolvedCompanyId) {
        const { data: compRow } = await supabase.from('companies').select('id').eq('name', companyName).maybeSingle();
        if (compRow) {
          resolvedCompanyId = (compRow as { id: number }).id;
          setUnitPriceModal((p) => ({ ...p, companyId: resolvedCompanyId }));
        }
      }
      let logRows: { item_id: number }[];
      if (resolvedCompanyId) {
        const [{ data: d1 }, { data: d2 }] = await Promise.all([
          supabase.from('inventory_logs').select('item_id').not('item_id', 'is', null).eq('company_id', resolvedCompanyId),
          supabase.from('inventory_logs').select('item_id').not('item_id', 'is', null).is('company_id', null).eq('company_name', companyName),
        ]);
        logRows = [...(d1 ?? []), ...(d2 ?? [])] as { item_id: number }[];
      } else {
        const { data } = await supabase.from('inventory_logs').select('item_id').not('item_id', 'is', null).eq('company_name', companyName);
        logRows = (data ?? []) as { item_id: number }[];
      }
      const itemIds = [...new Set(logRows.map((l) => l.item_id).filter(Boolean))];

      const [itemData, priceData, memoData] = await Promise.all([
        itemIds.length > 0
          ? supabase.from('inventory_items').select('id, name').in('id', itemIds).order('name').then((r) => r.data)
          : Promise.resolve([]),
        itemIds.length > 0
          ? supabase.from('unit_prices').select('*').in('inventory_item_id', itemIds).then((r) => r.data)
          : Promise.resolve([]),
        resolvedCompanyId
          ? supabase.from('company_memos').select('*').eq('company_id', resolvedCompanyId).order('created_at', { ascending: false }).then((r) => r.data)
          : Promise.resolve([]),
      ]);

      const priceMap = new Map((priceData ?? []).map((p: { inventory_item_id: number; id: string; unit_price: number; memo: string | null }) => [p.inventory_item_id, p]));
      const items: UnitPriceModalItem[] = (itemData ?? []).map((item: { id: number; name: string }) => {
        const existing = priceMap.get(item.id);
        return {
          itemId: item.id,
          itemName: item.name,
          unitPriceId: existing?.id ?? null,
          unitPrice: existing ? String(existing.unit_price) : '',
          memo: existing?.memo ?? '',
        };
      });
      setUnitPriceModal((p) => ({ ...p, loading: false, items, companyMemos: (memoData ?? []) as CompanyMemo[] }));
    } catch (e) {
      setUnitPriceModal((p) => ({ ...p, loading: false, error: getErrorMessage(e) }));
    }
  }

  async function handleSaveUnitPrices() {
    const toSave = unitPriceModal.items.filter((item) => item.unitPrice.trim() !== '');
    if (toSave.length === 0) { setUnitPriceModal(EMPTY_UNIT_PRICE_MODAL); return; }
    try {
      setUnitPriceModal((p) => ({ ...p, saving: true, error: '' }));
      for (const item of toSave) {
        const { error } = await supabase.from('unit_prices').upsert({
          inventory_item_id: item.itemId,
          unit_price: Number(item.unitPrice),
          memo: item.memo.trim() || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'inventory_item_id' });
        if (error) throw error;
      }
      setUnitPriceModal(EMPTY_UNIT_PRICE_MODAL);
    } catch (e) {
      setUnitPriceModal((p) => ({ ...p, saving: false, error: getErrorMessage(e) }));
    }
  }

  async function handleAddMemo() {
    const content = unitPriceModal.newMemoContent.trim();
    if (!content || !unitPriceModal.companyId) return;
    const { data, error } = await supabase.from('company_memos')
      .insert({ company_id: unitPriceModal.companyId, content })
      .select('*').single();
    if (error) { setUnitPriceModal((p) => ({ ...p, error: getErrorMessage(error) })); return; }
    setUnitPriceModal((p) => ({ ...p, newMemoContent: '', companyMemos: [data as CompanyMemo, ...p.companyMemos] }));
  }

  async function handleSaveMemo(id: string) {
    const content = unitPriceModal.editingMemoContent.trim();
    if (!content) return;
    const { error } = await supabase.from('company_memos').update({ content, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { setUnitPriceModal((p) => ({ ...p, error: getErrorMessage(error) })); return; }
    setUnitPriceModal((p) => ({
      ...p, editingMemoId: null, editingMemoContent: '',
      companyMemos: p.companyMemos.map((m) => m.id === id ? { ...m, content } : m),
    }));
  }

  async function handleDeleteMemo(id: string) {
    if (!window.confirm('메모를 삭제할까요?')) return;
    const { error } = await supabase.from('company_memos').delete().eq('id', id);
    if (error) { setUnitPriceModal((p) => ({ ...p, error: getErrorMessage(error) })); return; }
    setUnitPriceModal((p) => ({ ...p, companyMemos: p.companyMemos.filter((m) => m.id !== id) }));
  }

  async function handleAddNewItem() {
    const name = unitPriceModal.newItemName.trim();
    if (!name) return;
    setUnitPriceModal((p) => ({ ...p, addingItem: true, error: '' }));
    try {
      const { data: itemData, error: itemErr } = await supabase
        .from('inventory_items').insert({ name, category: '분쇄품', unit: 'bag', current_stock: 0 })
        .select('id, name').single();
      if (itemErr) throw itemErr;
      const newItem = itemData as { id: number; name: string };
      setUnitPriceModal((p) => ({
        ...p, addingItem: false, newItemName: '', newItemPrice: '',
        items: [...p.items, { itemId: newItem.id, itemName: newItem.name, unitPriceId: null, unitPrice: p.newItemPrice, memo: '' }],
      }));
    } catch (e) {
      setUnitPriceModal((p) => ({ ...p, addingItem: false, error: getErrorMessage(e) }));
    }
  }

  async function handleRenameItem(itemId: number, newName: string) {
    if (!newName.trim()) return;
    const { error } = await supabase.from('inventory_items').update({ name: newName.trim() }).eq('id', itemId);
    if (error) { setUnitPriceModal((p) => ({ ...p, error: getErrorMessage(error) })); return; }
    setUnitPriceModal((p) => ({
      ...p,
      editingItemId: null,
      editingItemName: '',
      items: p.items.map((item) => item.itemId === itemId ? { ...item, itemName: newName.trim() } : item),
    }));
  }

  async function handleDeleteItem(itemId: number, itemName: string) {
    if (!window.confirm(`'${itemName}' 품목을 삭제할까요?\n연관 단가도 함께 삭제됩니다.`)) return;
    await supabase.from('unit_prices').delete().eq('inventory_item_id', itemId);
    const { error } = await supabase.from('inventory_items').delete().eq('id', itemId);
    if (error) { setUnitPriceModal((p) => ({ ...p, error: getErrorMessage(error) })); return; }
    setUnitPriceModal((p) => ({ ...p, items: p.items.filter((item) => item.itemId !== itemId) }));
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
              <div className="grid grid-cols-3 gap-2">
                {([['issued', '발행'], ['scheduled', '예정'], ['none', '미발행']] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setFormInvoiceStatus(val)}
                    className={cn('rounded-2xl border py-2.5 text-sm font-semibold',
                      formInvoiceStatus === val
                        ? val === 'issued' ? 'border-emerald-600 bg-emerald-600 text-white'
                        : val === 'scheduled' ? 'border-blue-500 bg-blue-500 text-white'
                        : 'border-neutral-400 bg-neutral-400 text-white'
                        : 'border-neutral-200 bg-white text-neutral-700'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
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
      <div className="mb-2 space-y-2">
        <div className="flex gap-2">
          {(['all', 'pending', 'done'] as StatusFilter[]).map((f) => (
            <button key={f} onClick={() => setStatusFilter(f)} className={cn('flex-1 rounded-2xl border py-2 text-sm font-medium', statusFilter === f ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-600')}>
              {f === 'all' ? '전체' : f === 'pending' ? '미처리' : '완료'}
            </button>
          ))}
        </div>

        {/* 계산서 필터 [전체][발행][예정][미발행] */}
        <div className="flex gap-1.5">
        {([['all', '전체'], ['issued', '발행'], ['scheduled', '예정'], ['none', '미발행']] as [InvoiceStatusFilter, string][]).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setInvoiceStatusFilter(val)}
            className={cn('flex-1 rounded-2xl border py-1.5 text-xs font-medium',
              invoiceStatusFilter === val
                ? val === 'issued' ? 'border-emerald-600 bg-emerald-600 text-white'
                : val === 'scheduled' ? 'border-blue-500 bg-blue-500 text-white'
                : val === 'none' ? 'border-neutral-500 bg-neutral-500 text-white'
                : 'border-neutral-900 bg-neutral-900 text-white'
                : 'border-neutral-200 bg-white text-neutral-600'
            )}
          >
            {label}
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

      <div className="mb-3 flex gap-2">
        <button
          onClick={() => setShowMonthlyOnly((v) => !v)}
          className={cn('flex-1 rounded-2xl border py-2 text-xs font-semibold',
            showMonthlyOnly ? 'border-violet-600 bg-violet-600 text-white' : 'border-neutral-200 bg-white text-neutral-600')}
        >
          월말정산만
        </button>
        <button onClick={openNewForm} className="flex-[3] rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white">
          + 새 정산 추가
        </button>
      </div>

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
            const hasPending = pendingCount > 0;
            // 상태 표시 색상: receivable=초록, payable=주황, 둘 다=금액 큰 쪽
            const pendingReceivableAmt = pendingInvoices
              .filter((inv) => inv.direction === 'receivable')
              .reduce((s, inv) => s + Math.max(0, calcItemTotals(inv.items).total - calcPaid(inv.payments)), 0);
            const pendingPayableAmt = pendingInvoices
              .filter((inv) => inv.direction === 'payable')
              .reduce((s, inv) => s + Math.max(0, calcItemTotals(inv.items).total - calcPaid(inv.payments)), 0);
            const pendingAmount = pendingReceivableAmt - pendingPayableAmt;
            const indicatorColor = (pendingReceivableAmt > 0 && pendingPayableAmt > 0)
              ? (pendingReceivableAmt >= pendingPayableAmt ? 'bg-emerald-500' : 'bg-orange-500')
              : pendingReceivableAmt > 0 ? 'bg-emerald-500'
              : pendingPayableAmt > 0 ? 'bg-orange-500'
              : 'bg-neutral-300';

            // 상태 인디케이터 SVG
            const hasBoth = pendingReceivableAmt > 0 && pendingPayableAmt > 0;
            const StatusDot = () => {
              if (!hasPending) return <span className="w-3.5 h-3.5 rounded-full border-2 border-neutral-300 bg-white shrink-0 inline-block" />;
              if (hasBoth) return (
                <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
                  <path d="M7,0 A7,7 0 0,0 7,14 Z" fill="#f97316" />
                  <path d="M7,0 A7,7 0 0,1 7,14 Z" fill="#10b981" />
                </svg>
              );
              return <span className={cn('w-3.5 h-3.5 rounded-full shrink-0 inline-block', indicatorColor)} />;
            };

            return (
              <div key={companyName} className="rounded-3xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center px-4 py-4 gap-2">
                  <button
                    onClick={() => toggleGroup(companyName)}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left"
                  >
                    <StatusDot />
                    <p className="font-semibold truncate">{companyName}</p>
                    {pendingCount > 0 && (
                      <span className="text-xs text-neutral-400 shrink-0">{pendingCount}건</span>
                    )}
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    {pendingCount > 0 && (
                      <span className="text-sm font-bold text-neutral-700">{formatCurrency(pendingAmount)}원</span>
                    )}
                    {(() => {
                      const co = companies.find((c) => c.id === groupInvoices[0]?.company_id);
                      const isMonthly = co?.is_monthly_settlement ?? false;
                      const coId = groupInvoices[0]?.company_id ?? null;
                      const coFactory = groupInvoices[0]?.factory ?? '';
                      return (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); void toggleMonthlySettlement(coId, companyName, isMonthly); }}
                            title={isMonthly ? '월말정산 해제' : '월말정산 설정'}
                            className={cn('rounded-full border w-6 h-6 flex items-center justify-center text-[10px] font-bold',
                              isMonthly ? 'border-violet-400 bg-violet-100 text-violet-700' : 'border-neutral-200 bg-white text-neutral-400')}
                          >月</button>
                          {isMonthly && (
                            <button
                              onClick={(e) => { e.stopPropagation(); void openDeliveryNoteModal(companyName, coId, coFactory); }}
                              className="rounded-full border border-violet-300 bg-violet-50 px-2 h-6 flex items-center justify-center text-[10px] font-semibold text-violet-700 hover:bg-violet-100"
                            >납품내역서</button>
                          )}
                        </>
                      );
                    })()}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleStarTap(companyName, groupInvoices[0]?.company_id ?? null); }}
                      className="rounded-full border border-amber-200 bg-amber-50 w-6 h-6 flex items-center justify-center text-amber-500 text-xs font-bold hover:bg-amber-100"
                    >★</button>
                    <button
                      onClick={(e) => { e.stopPropagation(); openNewFormForCompany(companyName, groupInvoices[0]?.company_id ?? null); }}
                      className="rounded-full border border-neutral-300 bg-neutral-50 w-6 h-6 flex items-center justify-center text-neutral-500 text-sm font-bold hover:bg-neutral-100"
                    >+</button>
                    <button onClick={() => toggleGroup(companyName)} className="text-neutral-400 text-sm">
                      {isExpanded ? '▲' : '▼'}
                    </button>
                  </div>
                </div>

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
                                  {invDateStr}{lastPaymentDate ? ` / ${lastPaymentDate}` : ''} | {inv.direction === 'payable' ? '-' : ''}{formatCurrency(doneTotal)}원
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
                                총합계: {inv.direction === 'payable' ? '-' : ''}{formatCurrency(totals.total)}원
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

                          {/* 계산서 발행 여부 (3단계) */}
                          <div className="mb-2 grid grid-cols-3 gap-1">
                            {([['issued', '발행'], ['scheduled', '예정'], ['none', '미발행']] as const).map(([val, label]) => (
                              <button
                                key={val}
                                onClick={() => void setInvoiceStatus(inv, val)}
                                className={cn('rounded-xl border py-1.5 text-xs font-semibold transition',
                                  inv.invoice_status === val
                                    ? val === 'issued' ? 'border-emerald-600 bg-emerald-600 text-white'
                                    : val === 'scheduled' ? 'border-blue-500 bg-blue-500 text-white'
                                    : 'border-neutral-400 bg-neutral-400 text-white'
                                    : 'border-neutral-200 bg-white text-neutral-600'
                                )}
                              >
                                {label}
                              </button>
                            ))}
                          </div>

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

      {/* 단가 기록 모달 */}
      {unitPriceModal.open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setUnitPriceModal(EMPTY_UNIT_PRICE_MODAL)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-10 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-base font-bold">{unitPriceModal.companyName} 단가</p>
              <button onClick={() => setUnitPriceModal(EMPTY_UNIT_PRICE_MODAL)} className="rounded-full border border-neutral-200 px-3 py-1 text-xs">닫기</button>
            </div>
            {unitPriceModal.loading ? (
              <p className="py-6 text-center text-sm text-neutral-500">불러오는 중…</p>
            ) : (
              <div className="space-y-4">
                {/* 거래처 메모 섹션 */}
                {unitPriceModal.companyId && (
                  <div>
                    <p className="mb-2 text-xs font-semibold text-neutral-500">거래처 메모</p>
                    <div className="space-y-2">
                      {unitPriceModal.companyMemos.map((memo) => (
                        <div key={memo.id} className="rounded-2xl border border-neutral-100 bg-neutral-50 p-3">
                          {unitPriceModal.editingMemoId === memo.id ? (
                            <div className="flex gap-2">
                              <input
                                value={unitPriceModal.editingMemoContent}
                                onChange={(e) => setUnitPriceModal((p) => ({ ...p, editingMemoContent: e.target.value }))}
                                className="flex-1 rounded-xl border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
                                autoFocus
                              />
                              <button onClick={() => void handleSaveMemo(memo.id)} className="rounded-xl bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white">저장</button>
                              <button onClick={() => setUnitPriceModal((p) => ({ ...p, editingMemoId: null }))} className="rounded-xl border border-neutral-200 px-3 py-1.5 text-xs text-neutral-500">취소</button>
                            </div>
                          ) : (
                            <div className="flex items-start justify-between gap-2">
                              <p className="flex-1 text-sm text-neutral-700">{memo.content}</p>
                              <div className="flex gap-1 shrink-0">
                                <button onClick={() => setUnitPriceModal((p) => ({ ...p, editingMemoId: memo.id, editingMemoContent: memo.content }))} className="text-xs text-neutral-400 underline">수정</button>
                                <button onClick={() => void handleDeleteMemo(memo.id)} className="text-xs text-red-400 underline">삭제</button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <input
                          value={unitPriceModal.newMemoContent}
                          onChange={(e) => setUnitPriceModal((p) => ({ ...p, newMemoContent: e.target.value }))}
                          placeholder="새 메모 입력"
                          className="flex-1 rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                          onKeyDown={(e) => { if (e.key === 'Enter') void handleAddMemo(); }}
                        />
                        <button onClick={() => void handleAddMemo()} className="rounded-2xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white">추가</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 단가 목록 */}
                {unitPriceModal.items.length === 0 && !unitPriceModal.companyId ? (
                  <p className="py-4 text-center text-sm text-neutral-500">등록된 거래 품목이 없어.</p>
                ) : unitPriceModal.items.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold text-neutral-500">단가</p>
                    <div className="space-y-3">
                      {unitPriceModal.items.map((item, idx) => (
                        <div key={item.itemId} className="rounded-2xl border border-neutral-200 p-3">
                          {unitPriceModal.editingItemId === item.itemId ? (
                            <div className="flex gap-2 mb-2">
                              <input
                                value={unitPriceModal.editingItemName}
                                onChange={(e) => setUnitPriceModal((p) => ({ ...p, editingItemName: e.target.value }))}
                                className="flex-1 rounded-xl border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
                                autoFocus
                                onKeyDown={(e) => { if (e.key === 'Enter') void handleRenameItem(item.itemId, unitPriceModal.editingItemName); }}
                              />
                              <button onClick={() => void handleRenameItem(item.itemId, unitPriceModal.editingItemName)} className="rounded-xl bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white">저장</button>
                              <button onClick={() => setUnitPriceModal((p) => ({ ...p, editingItemId: null }))} className="rounded-xl border border-neutral-200 px-2 py-1.5 text-xs text-neutral-500">취소</button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-sm font-semibold">{item.itemName}</p>
                              <div className="flex gap-1">
                                <button
                                  onClick={() => setUnitPriceModal((p) => ({ ...p, editingItemId: item.itemId, editingItemName: item.itemName }))}
                                  className="rounded-lg border border-neutral-200 px-2 py-0.5 text-xs text-neutral-600"
                                >수정</button>
                                <button
                                  onClick={() => void handleDeleteItem(item.itemId, item.itemName)}
                                  className="rounded-lg border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-600"
                                >삭제</button>
                              </div>
                            </div>
                          )}
                          <div className="flex gap-2">
                            <input
                              type="number" inputMode="decimal" placeholder="단가"
                              value={item.unitPrice}
                              onChange={(e) => setUnitPriceModal((p) => {
                                const items = [...p.items];
                                items[idx] = { ...items[idx], unitPrice: e.target.value };
                                return { ...p, items };
                              })}
                              className="flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
                            />
                            <input
                              placeholder="메모"
                              value={item.memo}
                              onChange={(e) => setUnitPriceModal((p) => {
                                const items = [...p.items];
                                items[idx] = { ...items[idx], memo: e.target.value };
                                return { ...p, items };
                              })}
                              className="flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* + 품목 추가 */}
                <div className="rounded-2xl border border-dashed border-neutral-300 p-3">
                  <p className="mb-2 text-xs font-semibold text-neutral-500">+ 품목 추가</p>
                  <div className="flex gap-2">
                    <input
                      placeholder="품목명"
                      value={unitPriceModal.newItemName}
                      onChange={(e) => setUnitPriceModal((p) => ({ ...p, newItemName: e.target.value }))}
                      className="flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                    />
                    <input
                      type="number" inputMode="decimal" placeholder="단가"
                      value={unitPriceModal.newItemPrice}
                      onChange={(e) => setUnitPriceModal((p) => ({ ...p, newItemPrice: e.target.value }))}
                      className="w-24 rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
                    />
                    <button
                      onClick={() => void handleAddNewItem()}
                      disabled={unitPriceModal.addingItem || !unitPriceModal.newItemName.trim()}
                      className="rounded-xl bg-neutral-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {unitPriceModal.addingItem ? '추가중' : '추가'}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {unitPriceModal.error && (
              <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{unitPriceModal.error}</div>
            )}
            {!unitPriceModal.loading && unitPriceModal.items.length > 0 && (
              <button
                onClick={() => void handleSaveUnitPrices()}
                disabled={unitPriceModal.saving}
                className="mt-4 w-full rounded-2xl bg-neutral-900 px-4 py-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {unitPriceModal.saving ? '저장중' : '저장'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 납품내역서 모달 */}
      {dnModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold">{dnModal.companyName} 납품내역서</h3>
              <button onClick={() => setDnModal({ ...EMPTY_DN_MODAL })} className="text-neutral-400 text-lg">✕</button>
            </div>

            {dnModal.error && (
              <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{dnModal.error}</div>
            )}

            {dnModal.loading ? (
              <p className="py-4 text-center text-sm text-neutral-500">불러오는 중…</p>
            ) : (
              <>
                {/* 템플릿 있을 때: 월 선택 + 생성 버튼 */}
                {dnModal.template && !dnModal.showConfig && (
                  <div className="flex flex-col gap-3">
                    <div>
                      <p className="mb-1 text-xs font-semibold text-neutral-500">대상 월</p>
                      <input
                        type="month"
                        value={dnModal.month}
                        onChange={(e) => setDnModal((p) => ({ ...p, month: e.target.value }))}
                        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <button
                      onClick={() => void generateDeliveryNote()}
                      disabled={dnModal.generating}
                      className="w-full rounded-xl bg-violet-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {dnModal.generating ? '생성 중…' : '납품내역서 생성 및 다운로드'}
                    </button>
                    <button
                      onClick={() => setDnModal((p) => ({ ...p, showConfig: true }))}
                      className="w-full rounded-xl border border-neutral-200 py-2 text-xs text-neutral-500"
                    >
                      양식/컬럼 설정 변경
                    </button>
                  </div>
                )}

                {/* 설정 폼 */}
                {(!dnModal.template || dnModal.showConfig) && (
                  <div className="flex flex-col gap-2 text-xs">
                    <p className="font-semibold text-neutral-600">
                      {dnModal.template ? '양식/컬럼 설정 변경' : '양식 등록 (최초 1회)'}
                    </p>

                    <div>
                      <p className="mb-1 text-neutral-500">엑셀 양식 파일 (.xlsx)</p>
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={(e) => setDnModal((p) => ({ ...p, cfgFile: e.target.files?.[0] ?? null }))}
                        className="w-full rounded border border-neutral-300 px-2 py-1.5"
                      />
                      {dnModal.template && !dnModal.cfgFile && (
                        <p className="mt-1 text-neutral-400">파일 없이 저장하면 기존 양식 유지</p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {([
                        ['데이터 시작 행 (0부터)', 'cfgDataStart', 'number'],
                        ['날짜 컬럼', 'cfgColDate', 'number'],
                        ['품목명 컬럼 (없으면 빈칸)', 'cfgColItem', 'text'],
                        ['수량 컬럼', 'cfgColQty', 'number'],
                        ['단가 컬럼', 'cfgColPrice', 'number'],
                        ['금액 컬럼', 'cfgColAmount', 'number'],
                        ['비고 컬럼 (없으면 빈칸)', 'cfgColNote', 'text'],
                        ['월 셀 행', 'cfgMonthRow', 'number'],
                        ['월 셀 컬럼', 'cfgMonthCol', 'number'],
                      ] as [string, keyof DnModal, string][]).map(([label, key, type]) => (
                        <div key={key}>
                          <p className="mb-0.5 text-neutral-500">{label}</p>
                          <input
                            type={type}
                            value={String(dnModal[key] ?? '')}
                            onChange={(e) => setDnModal((p) => ({ ...p, [key]: type === 'number' ? Number(e.target.value) : e.target.value }))}
                            className="w-full rounded border border-neutral-300 px-2 py-1"
                          />
                        </div>
                      ))}
                    </div>

                    <p className="mt-1 font-semibold text-neutral-600">카테고리 분류 컬럼 (선택)</p>
                    <p className="text-neutral-400">품목명 앞글자가 일치하면 해당 컬럼에 수량 기입</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(['PC', 'PP', 'ABS', 'AF'] as const).map((cat) => {
                        const key = `cfgCat${cat}` as keyof DnModal;
                        return (
                          <div key={cat}>
                            <p className="mb-0.5 text-neutral-500">{cat} 컬럼</p>
                            <input
                              type="text"
                              placeholder="없으면 빈칸"
                              value={String(dnModal[key] ?? '')}
                              onChange={(e) => setDnModal((p) => ({ ...p, [key]: e.target.value }))}
                              className="w-full rounded border border-neutral-300 px-2 py-1"
                            />
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => void saveDnTemplate()}
                        className="flex-1 rounded-xl bg-violet-600 py-2.5 font-semibold text-white"
                      >
                        저장
                      </button>
                      {dnModal.template && (
                        <button
                          onClick={() => setDnModal((p) => ({ ...p, showConfig: false }))}
                          className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-neutral-600"
                        >
                          취소
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
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
