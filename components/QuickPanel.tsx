'use client';

import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { Company, InventoryCategory, InventoryItem, InOutItem, MessageRow, QuickPanelState } from '../lib/types';
import { cn, getErrorMessage, normalizeCategory, todayString } from '../lib/utils';

type Props = {
  quickPanel: QuickPanelState;
  setQuickPanel: React.Dispatch<React.SetStateAction<QuickPanelState>>;
  inventory: InventoryItem[];
  companies: Company[];
  currentUserId: string | null;
  currentUserEmail: string | null;
  currentUserName: string | null;
  onClose: () => void;
  onDone: () => Promise<void>;
  onCompanyAdded: () => Promise<void>;
  setMessages: React.Dispatch<React.SetStateAction<MessageRow[]>>;
};

const CATEGORY_OPTIONS: InventoryCategory[] = ['원료', '분쇄품', '스크랩'];

export const EMPTY_INOUT_ITEM: InOutItem = { itemId: null, itemName: '', bagQty: '', kgQty: '', itemCategory: null };

export const EMPTY_PANEL: QuickPanelState = {
  isOpen: false,
  date: todayString(),
  productionEndDate: todayString(),
  companyId: null,
  companyName: '',
  action: null,
  category: null,
  memo: '',
  inoutItems: [{ ...EMPTY_INOUT_ITEM }],
  productionType: null,
  sources: [{ itemId: null, customName: '', bagQty: '' }],
  targetItemId: null,
  targetItemName: '',
  targetBagQty: '',
  targetKgQty: '',
};

export default function QuickPanel({
  quickPanel,
  setQuickPanel,
  inventory,
  companies,
  currentUserId,
  currentUserEmail,
  currentUserName,
  onClose,
  onDone,
  onCompanyAdded,
  setMessages,
}: Props) {
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  // 거래처 등록 확인 프롬프트
  const [pendingCompanyName, setPendingCompanyName] = useState<string | null>(null);
  const [addingCompany, setAddingCompany] = useState(false);

  const sortedCompanies = useMemo(() => {
    return [...companies].sort((a, b) => {
      if (a.is_favorite && !b.is_favorite) return -1;
      if (!a.is_favorite && b.is_favorite) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [companies]);

  function setField<K extends keyof QuickPanelState>(key: K, value: QuickPanelState[K]) {
    setQuickPanel((prev) => ({ ...prev, [key]: value }));
    setError('');
  }

  // 버그 수정: 원료생산 소스 = 분쇄품 + 원료
  const productionSourceItems = useMemo(() => {
    if (quickPanel.productionType === '원료생산') {
      return inventory.filter((item) =>
        normalizeCategory(item.category) === '분쇄품' ||
        normalizeCategory(item.category) === '원료'
      );
    }
    if (quickPanel.productionType === '분쇄품생산') {
      return inventory.filter((item) => normalizeCategory(item.category) === '스크랩');
    }
    return [];
  }, [quickPanel.productionType, inventory]);

  const productionTargetItems = useMemo(() => {
    if (quickPanel.productionType === '원료생산') return inventory.filter((item) => normalizeCategory(item.category) === '원료');
    if (quickPanel.productionType === '분쇄품생산') return inventory.filter((item) => normalizeCategory(item.category) === '분쇄품');
    return [];
  }, [quickPanel.productionType, inventory]);

  // 거래처명 prefix로 품목 필터링 (item 4)
  const categoryItems = useMemo(() => {
    if (!quickPanel.category) return [];
    const byCategory = inventory.filter((item) => normalizeCategory(item.category) === quickPanel.category);
    const prefix = quickPanel.companyName.trim();
    if (prefix) {
      const filtered = byCategory.filter((item) => item.name.startsWith(prefix + ' '));
      return filtered.length > 0 ? filtered : byCategory;
    }
    return byCategory;
  }, [quickPanel.category, quickPanel.companyName, inventory]);

  const existingProductionTargetItem = useMemo(() => {
    const raw = quickPanel.targetItemName.trim();
    if (!raw || !quickPanel.productionType) return null;
    const company = quickPanel.companyName.trim();
    // 거래처 선택 시 prefix 적용 후 매칭
    const typed = (company && !raw.startsWith(company + ' ')) ? `${company} ${raw}` : raw;
    const targetCategory = quickPanel.productionType === '원료생산' ? '원료' : '분쇄품';
    return inventory.find((item) => item.name.trim().toLowerCase() === typed.toLowerCase() && normalizeCategory(item.category) === targetCategory) ?? null;
  }, [inventory, quickPanel.targetItemName, quickPanel.productionType, quickPanel.companyName]);

  // 거래처 선택 시 생산 결과 품목도 필터링
  const filteredProductionTargetItems = useMemo(() => {
    const prefix = quickPanel.companyName.trim();
    if (!prefix) return productionTargetItems;
    const filtered = productionTargetItems.filter((item) => item.name.startsWith(prefix + ' '));
    return filtered.length > 0 ? filtered : productionTargetItems;
  }, [productionTargetItems, quickPanel.companyName]);

  const willCreateProductionTargetItem = useMemo(() => {
    if (quickPanel.action !== '생산') return false;
    if (!quickPanel.productionType || !quickPanel.targetItemName.trim()) return false;
    if (quickPanel.targetItemId) return false;
    return !existingProductionTargetItem;
  }, [quickPanel, existingProductionTargetItem]);

  function createTempMessage(content: string, messageType: MessageRow['message_type']): MessageRow {
    const source: MessageRow['source'] = messageType === 'chat' ? 'quick_input' : 'system';
    return {
      id: -Date.now() - Math.floor(Math.random() * 1000),
      content,
      message_type: messageType,
      created_at: new Date().toISOString(),
      user_id: currentUserId,
      user_email: currentUserEmail,
      user_name: currentUserName,
      source,
    };
  }

  async function insertMessage(content: string, messageType: MessageRow['message_type']) {
    const source: MessageRow['source'] = messageType === 'chat' ? 'quick_input' : 'system';
    const { error } = await supabase.from('messages').insert({
      content, message_type: messageType, source,
      user_id: currentUserId, user_email: currentUserEmail, user_name: currentUserName,
    });
    if (error) throw error;
  }

  async function saveMsg(content: string, type: MessageRow['message_type'] = 'chat') {
    const temp = createTempMessage(content, type);
    setMessages((prev) => [...prev, temp]);
    try { await insertMessage(content, type); }
    catch (e) { setMessages((prev) => prev.filter((m) => m.id !== temp.id)); throw e; }
  }

  async function insertLog(itemId: number, action: 'in' | 'out', qty: number, note: string | null = null, logDate?: string, bagCount?: number | null, kgWeight?: number | null) {
    const { error } = await supabase.from('inventory_logs').insert({
      item_id: itemId,
      action,
      qty,
      note,
      date: logDate ?? quickPanel.date,
      user_id: currentUserId,
      user_email: currentUserEmail,
      user_name: currentUserName,
      company_id: quickPanel.companyId || null,
      company_name: quickPanel.companyName.trim() || null,
      ...(bagCount != null && { bag_count: bagCount }),
      ...(kgWeight != null && { kg_weight: kgWeight }),
    });
    if (error) throw error;
  }

  async function updateStock(itemId: number, newStock: number) {
    const { error } = await supabase.from('inventory_items').update({ current_stock: newStock }).eq('id', itemId);
    if (error) throw error;
  }

  async function createItem(name: string, category: InventoryCategory, unit: string, initialStock: number): Promise<InventoryItem> {
    const { data, error } = await supabase.from('inventory_items')
      .insert({ name, category, unit, current_stock: initialStock })
      .select('id, name, current_stock, unit, category')
      .single();
    if (error) throw error;
    return data as InventoryItem;
  }

  function getMatchedItem(itemName: string, category?: InventoryCategory | null): InventoryItem | null {
    const normalized = itemName.trim().toLowerCase();
    return inventory.find((item) => {
      const nameMatch = item.name.trim().toLowerCase() === normalized;
      const categoryMatch = category ? normalizeCategory(item.category) === category : true;
      return nameMatch && categoryMatch;
    }) ?? null;
  }

  // 거래처명 자동 prefix 적용 (item 4)
  function applyCompanyPrefix(rawName: string): string {
    const company = quickPanel.companyName.trim();
    if (!company) return rawName;
    if (rawName.startsWith(company + ' ')) return rawName;
    return `${company} ${rawName}`;
  }

  function updateInoutItem(index: number, field: keyof InOutItem, value: string | number | null) {
    setQuickPanel((prev) => {
      const next = [...prev.inoutItems];
      next[index] = { ...next[index], [field]: value };
      return { ...prev, inoutItems: next };
    });
    setError('');
  }

  async function handleAddCompany(name: string) {
    try {
      setAddingCompany(true);
      const { error } = await supabase.from('companies').insert({ name, is_favorite: false });
      if (error) throw error;
      await onCompanyAdded();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setAddingCompany(false);
      setPendingCompanyName(null);
      onClose();
      await onDone();
    }
  }

  async function handleSkipCompanyAdd() {
    setPendingCompanyName(null);
    onClose();
    await onDone();
  }

  async function execute() {
    const action = quickPanel.action;
    if (!action) { setError('작업을 먼저 선택해줘.'); return; }

    // 거래처명 필수 (생산 제외)
    if (action !== '생산' && !quickPanel.companyName.trim()) {
      setError('거래처명을 입력해줘.');
      return;
    }

    const userMemo = quickPanel.memo.trim();
    const isNewCompany = !quickPanel.companyId && quickPanel.companyName.trim() !== '';

    // ── 생산 ──
    if (action === '생산') {
      const productionType = quickPanel.productionType;
      if (!productionType) { setError('생산 종류를 먼저 선택해줘.'); return; }

      const validSources = quickPanel.sources.filter(
        (src) => (src.itemId !== null || (src.customName ?? '').trim() !== '') && (src.bagQty ?? '').trim() !== ''
      );

      for (const src of validSources) {
        if (src.itemId === null) continue;
        const srcItem = inventory.find((item) => item.id === src.itemId);
        if (!srcItem) continue;
        const qty = Number(src.bagQty);
        if (Number(srcItem.current_stock) < qty) {
          setError(`${srcItem.name} 재고 부족 (현재 ${srcItem.current_stock}${srcItem.unit})`);
          return;
        }
      }

      const targetCategory: InventoryCategory = productionType === '원료생산' ? '원료' : '분쇄품';
      let targetItem = inventory.find((item) => item.id === quickPanel.targetItemId) ?? existingProductionTargetItem ?? null;
      // 거래처 선택 시 결과 품목명에 prefix 적용
      const typedTargetName = applyCompanyPrefix(quickPanel.targetItemName.trim());

      if (!targetItem && !typedTargetName) { setError('결과 품목을 선택하거나 새로 입력해줘.'); return; }
      if (!targetItem && typedTargetName) {
        targetItem = await createItem(typedTargetName, targetCategory, productionType === '원료생산' ? 'kg' : 'bag', 0);
      }
      if (!targetItem) { setError('결과 품목을 확인해줘.'); return; }

      const sourceNames = validSources.map((src) => {
        const srcItem = src.itemId ? inventory.find((item) => item.id === src.itemId) : null;
        return `${srcItem?.name || src.customName} ${src.bagQty}bag`;
      }).join(', ');

      const dateNote = quickPanel.productionEndDate && quickPanel.productionEndDate !== quickPanel.date
        ? `기간: ${quickPanel.date} ~ ${quickPanel.productionEndDate}`
        : `날짜: ${quickPanel.date}`;
      const memoNote = userMemo ? ` / 메모: ${userMemo}` : '';

      if (productionType === '원료생산') {
        const targetKgQty = Number(quickPanel.targetKgQty);
        if (!Number.isFinite(targetKgQty) || targetKgQty <= 0) { setError('생산된 원료 kg를 입력해줘.'); return; }
        await saveMsg(`생산 원료생산 사용:${sourceNames || '없음'} 결과:${targetItem.name} ${targetKgQty}kg`, 'chat');
        for (const src of validSources) {
          if (src.itemId === null) continue;
          const srcItem = inventory.find((item) => item.id === src.itemId)!;
          await updateStock(srcItem.id, Number(srcItem.current_stock) - Number(src.bagQty));
          await insertLog(srcItem.id, 'out', Number(src.bagQty), `production_use:원료생산:${targetItem.name} / ${dateNote}${memoNote}`, quickPanel.productionEndDate);
        }
        await updateStock(targetItem.id, Number(targetItem.current_stock ?? 0) + targetKgQty);
        await insertLog(targetItem.id, 'in', targetKgQty, `production_result:원료생산:${sourceNames || '없음'} / ${dateNote}${memoNote}`, quickPanel.productionEndDate);
        await saveMsg(`${sourceNames || '사용품목 없음'}, ${targetItem.name} ${targetKgQty}kg 생산 완료.`, 'system');
        if (isNewCompany) {
          setPendingCompanyName(quickPanel.companyName.trim());
          await onDone();
        } else {
          onClose();
          await onDone();
        }
        return;
      }

      if (productionType === '분쇄품생산') {
        const targetBagQty = Number(quickPanel.targetBagQty);
        if (!Number.isFinite(targetBagQty) || targetBagQty <= 0) { setError('생산된 분쇄품 bag 수를 입력해줘.'); return; }
        await saveMsg(`생산 분쇄품생산 사용:${sourceNames || '없음'} 결과:${targetItem.name} ${targetBagQty}bag`, 'chat');
        for (const src of validSources) {
          if (src.itemId === null) continue;
          const srcItem = inventory.find((item) => item.id === src.itemId)!;
          await updateStock(srcItem.id, Number(srcItem.current_stock) - Number(src.bagQty));
          await insertLog(srcItem.id, 'out', Number(src.bagQty), `production_use:분쇄품생산:${targetItem.name} / ${dateNote}${memoNote}`, quickPanel.productionEndDate);
        }
        await updateStock(targetItem.id, Number(targetItem.current_stock ?? 0) + targetBagQty);
        await insertLog(targetItem.id, 'in', targetBagQty, `production_result:분쇄품생산:${sourceNames || '없음'} / ${dateNote}${memoNote}`, quickPanel.productionEndDate);
        await saveMsg(`${sourceNames || '사용품목 없음'}, ${targetItem.name} ${targetBagQty}bag 생산 완료.`, 'system');
        if (isNewCompany) {
          setPendingCompanyName(quickPanel.companyName.trim());
          await onDone();
        } else {
          onClose();
          await onDone();
        }
        return;
      }
    }

    // ── 재고 ──
    if (action === '재고') {
      const firstItem = quickPanel.inoutItems[0];
      const found = (firstItem?.itemId ? inventory.find((i) => i.id === firstItem.itemId) : null)
        || getMatchedItem(firstItem?.itemName ?? '', null);
      if (!found) { setError('재고 확인할 품목을 입력하거나 선택해줘.'); return; }
      await saveMsg(`재고 ${found.name}`, 'chat');
      await saveMsg(`${found.name} 현재 재고는 ${found.current_stock}${found.unit} 이야.`, 'system');
      onClose();
      return;
    }

    // ── 입고 / 출고 (다중 품목) ──
    if (action === '입고' || action === '출고') {
      if (!quickPanel.category) { setError('형태를 먼저 선택해줘.'); return; }

      const validItems = quickPanel.inoutItems.filter((item) => {
        const hasItem = item.itemId !== null || item.itemName.trim() !== '';
        const effectiveCat = item.itemCategory ?? quickPanel.category;
        const hasQty = effectiveCat === '원료'
          ? item.kgQty.trim() !== ''
          : (item.bagQty.trim() !== '' || item.kgQty.trim() !== '');
        return hasItem && hasQty;
      });

      if (validItems.length === 0) { setError('품목과 수량을 입력해줘.'); return; }

      const results: string[] = [];

      for (const inoutItem of validItems) {
        const effectiveCat = inoutItem.itemCategory ?? quickPanel.category;
        const rawName = inoutItem.itemName.trim();
        // 거래처명 자동 prefix 적용
        const typedName = rawName ? applyCompanyPrefix(rawName) : '';
        let found = (inoutItem.itemId ? inventory.find((i) => i.id === inoutItem.itemId) : null)
          || (typedName ? getMatchedItem(typedName, effectiveCat) : null);

        if (effectiveCat === '원료') {
          const kg = Number(inoutItem.kgQty);
          if (!Number.isFinite(kg) || kg <= 0) continue;
          if (!found) {
            if (action === '출고') { setError(`'${typedName}' 없는 품목은 출고할 수 없어.`); return; }
            found = await createItem(typedName, '원료', 'kg', 0);
          }
          const currentStock = Number(found.current_stock ?? 0);
          if (action === '출고' && currentStock < kg) {
            setError(`${found.name} 재고 부족 (현재 ${currentStock}${found.unit})`);
            return;
          }
          const newStock = action === '입고' ? currentStock + kg : currentStock - kg;
          await updateStock(found.id, newStock);
          await insertLog(found.id, action === '입고' ? 'in' : 'out', kg, userMemo || null);
          results.push(`${found.name} ${kg}kg`);
        } else {
          const bagQty = Number(inoutItem.bagQty);
          const kgQty = inoutItem.kgQty.trim() === '' ? null : Number(inoutItem.kgQty);
          const hasBag = Number.isFinite(bagQty) && bagQty > 0;
          const hasKg = kgQty !== null && Number.isFinite(kgQty) && kgQty > 0;
          if (!hasBag && !hasKg) continue;
          if (!found) {
            if (action === '출고') { setError(`'${typedName}' 없는 품목은 출고할 수 없어.`); return; }
            found = await createItem(typedName, effectiveCat!, 'bag', 0);
          }
          const currentStock = Number(found.current_stock ?? 0);
          const changeQty = hasBag ? bagQty : kgQty!;
          if (action === '출고' && currentStock < changeQty) {
            setError(`${found.name} 재고 부족 (현재 ${currentStock}${found.unit})`);
            return;
          }
          const newStock = action === '입고' ? currentStock + changeQty : currentStock - changeQty;
          await updateStock(found.id, newStock);
          await insertLog(found.id, action === '입고' ? 'in' : 'out', changeQty, userMemo || null, undefined,
            hasBag ? bagQty : null,
            hasKg ? kgQty : null);
          const qtyParts: string[] = [];
          if (hasBag) qtyParts.push(`${bagQty}bag`);
          if (hasKg) qtyParts.push(`${kgQty}kg`);
          results.push(`${found.name} ${qtyParts.join(' / ')}`);
        }
      }

      if (results.length === 0) { setError('처리된 품목이 없어. 수량을 확인해줘.'); return; }

      const summary = results.join(', ');
      await saveMsg(`${action} ${quickPanel.category} ${summary}`, 'chat');
      await saveMsg(`${summary} ${action} 완료.`, 'system');

      // 새 거래처 등록 프롬프트
      if (isNewCompany) {
        setPendingCompanyName(quickPanel.companyName.trim());
        await onDone();
      } else {
        onClose();
        await onDone();
      }
    }
  }

  async function handleExecute() {
    if (sending) return;
    try {
      setSending(true);
      setError('');
      await execute();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSending(false);
    }
  }

  const summary = useMemo(() => {
    const parts: string[] = [];
    if (quickPanel.companyName.trim()) parts.push(quickPanel.companyName.trim());
    if (quickPanel.action) parts.push(quickPanel.action);
    if (quickPanel.action === '생산') {
      if (quickPanel.productionType) parts.push(quickPanel.productionType);
    } else if (quickPanel.category) {
      parts.push(quickPanel.category);
      quickPanel.inoutItems.forEach((item) => {
        const effectiveCat = item.itemCategory ?? quickPanel.category;
        const name = item.itemId ? (inventory.find((i) => i.id === item.itemId)?.name || item.itemName) : item.itemName;
        if (name) {
          let qty = '';
          if (effectiveCat === '원료') {
            qty = item.kgQty ? `${item.kgQty}kg` : '';
          } else {
            const qtyParts: string[] = [];
            if (Number(item.bagQty) > 0) qtyParts.push(`${item.bagQty}bag`);
            if (Number(item.kgQty) > 0) qtyParts.push(`${item.kgQty}kg`);
            qty = qtyParts.join('/');
          }
          if (qty) parts.push(`${name} ${qty}`);
        }
      });
    }
    return parts.join(' / ');
  }, [quickPanel, inventory]);

  // ── 거래처 등록 확인 프롬프트 ──
  if (pendingCompanyName) {
    return (
      <div className="mb-2 rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold mb-1">거래처 등록</p>
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
            onClick={() => void handleSkipCompanyAdd()}
            className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-700"
          >
            이번만 사용
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2 rounded-3xl border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold text-neutral-500">빠른 입력</p>
        <button onClick={onClose} className="rounded-full border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600">닫기</button>
      </div>

      <div className="space-y-3">
        {/* 1. 날짜 */}
        <div>
          <p className="mb-1 text-xs text-neutral-500">날짜</p>
          <input
            type="date"
            value={quickPanel.date}
            onChange={(e) => setField('date', e.target.value)}
            className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
          />
        </div>

        {/* 2. 거래처 */}
        <div>
          <p className="mb-1 text-xs text-neutral-500">
            거래처{quickPanel.action && quickPanel.action !== '생산' ? ' *' : ' (선택)'}
          </p>
          {sortedCompanies.length > 0 && (
            <select
              value={quickPanel.companyId ?? ''}
              onChange={(e) => {
                if (e.target.value === '') {
                  setQuickPanel((prev) => ({ ...prev, companyId: null, companyName: '' }));
                } else {
                  const id = Number(e.target.value);
                  const company = companies.find((c) => c.id === id);
                  setQuickPanel((prev) => ({ ...prev, companyId: id, companyName: company?.name ?? '' }));
                }
                setError('');
              }}
              className="mb-2 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
            >
              <option value="">직접 입력</option>
              {sortedCompanies.map((c) => (
                <option key={c.id} value={c.id}>{c.is_favorite ? '⭐ ' : ''}{c.name}</option>
              ))}
            </select>
          )}
          <input
            value={quickPanel.companyName}
            onChange={(e) => {
              setQuickPanel((prev) => ({ ...prev, companyName: e.target.value, companyId: null }));
              setError('');
            }}
            placeholder="거래처명 직접 입력"
            className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
          />
        </div>

        {/* 3. 작업 선택 */}
        <div>
          <p className="mb-1 text-xs text-neutral-500">작업</p>
          <div className="grid grid-cols-4 gap-2">
            {(['재고', '입고', '출고', '생산'] as const).map((action) => (
              <button
                key={action}
                onClick={() => {
                  setQuickPanel((prev) => ({
                    ...prev,
                    action,
                    category: null,
                    memo: '',
                    inoutItems: [{ ...EMPTY_INOUT_ITEM }],
                    productionType: null,
                    sources: [{ itemId: null, customName: '', bagQty: '' }],
                    targetItemId: null,
                    targetItemName: '',
                    targetBagQty: '',
                    targetKgQty: '',
                  }));
                  setError('');
                }}
                className={cn('rounded-2xl border px-2 py-3 text-xs font-medium', quickPanel.action === action ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-neutral-50 text-neutral-700')}
              >
                {action}
              </button>
            ))}
          </div>
        </div>

        {/* ── 생산 ── */}
        {quickPanel.action === '생산' && (
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs text-neutral-500">종료일 (단일이면 시작일과 동일)</p>
              <input
                type="date"
                value={quickPanel.productionEndDate}
                min={quickPanel.date}
                onChange={(e) => setField('productionEndDate', e.target.value)}
                className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
              />
            </div>
            <div>
              <p className="mb-1 text-xs text-neutral-500">생산 종류</p>
              <div className="grid grid-cols-2 gap-2">
                {(['원료생산', '분쇄품생산'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => {
                      setQuickPanel((prev) => ({
                        ...prev,
                        productionType: type,
                        sources: [{ itemId: null, customName: '', bagQty: '' }],
                        targetItemId: null,
                        targetItemName: '',
                        targetBagQty: '',
                        targetKgQty: '',
                      }));
                      setError('');
                    }}
                    className={cn('rounded-2xl border px-3 py-3 text-sm font-medium', quickPanel.productionType === type ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-neutral-50 text-neutral-700')}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {quickPanel.productionType && (
              <>
                <div>
                  <p className="mb-1 text-xs text-neutral-500">
                    사용 품목 {quickPanel.productionType === '원료생산' ? '(분쇄품 + 원료)' : '(스크랩)'}
                  </p>
                  {quickPanel.sources.map((src, index) => (
                    <div key={index} className="mb-2 space-y-1">
                      <div className="flex gap-2">
                        <select
                          value={src.itemId ?? ''}
                          onChange={(e) => {
                            const newSources = [...quickPanel.sources];
                            newSources[index] = { ...newSources[index], itemId: e.target.value ? Number(e.target.value) : null, customName: '' };
                            setQuickPanel((prev) => ({ ...prev, sources: newSources }));
                          }}
                          className="flex-1 rounded-2xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none focus:border-neutral-400"
                        >
                          <option value="">재고 품목 선택</option>
                          {productionSourceItems.map((item) => (
                            <option key={item.id} value={item.id}>{item.name}</option>
                          ))}
                        </select>
                        <input
                          value={src.bagQty}
                          onChange={(e) => {
                            const newSources = [...quickPanel.sources];
                            newSources[index] = { ...newSources[index], bagQty: e.target.value };
                            setQuickPanel((prev) => ({ ...prev, sources: newSources }));
                            setError('');
                          }}
                          placeholder="bag"
                          inputMode="numeric"
                          className="w-20 rounded-2xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none focus:border-neutral-400"
                        />
                        {quickPanel.sources.length > 1 && (
                          <button
                            onClick={() => setQuickPanel((prev) => ({ ...prev, sources: prev.sources.filter((_, i) => i !== index) }))}
                            className="rounded-2xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-600"
                          >✕</button>
                        )}
                      </div>
                      {!src.itemId && (
                        <input
                          value={src.customName ?? ''}
                          onChange={(e) => {
                            const newSources = [...quickPanel.sources];
                            newSources[index] = { ...newSources[index], customName: e.target.value };
                            setQuickPanel((prev) => ({ ...prev, sources: newSources }));
                          }}
                          placeholder="또는 직접 입력 (재고 미반영)"
                          className="w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400 placeholder:text-neutral-400"
                        />
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => setQuickPanel((prev) => ({ ...prev, sources: [...prev.sources, { itemId: null, customName: '', bagQty: '' }] }))}
                    className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600"
                  >
                    + 품목 추가
                  </button>
                </div>

                <div>
                  <p className="mb-1 text-xs text-neutral-500">결과 품목 {quickPanel.productionType === '원료생산' ? '(원료)' : '(분쇄품)'}</p>
                  <select
                    value={quickPanel.targetItemId ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') {
                        setQuickPanel((prev) => ({ ...prev, targetItemId: null, targetItemName: '' }));
                      } else {
                        const id = Number(val);
                        const item = filteredProductionTargetItems.find((i) => i.id === id);
                        setQuickPanel((prev) => ({ ...prev, targetItemId: id, targetItemName: item?.name ?? '' }));
                      }
                    }}
                    className="mb-2 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
                  >
                    <option value="">목록에서 선택</option>
                    {filteredProductionTargetItems.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                  <input
                    value={quickPanel.targetItemName}
                    onChange={(e) => setQuickPanel((prev) => ({ ...prev, targetItemName: e.target.value, targetItemId: null }))}
                    placeholder="또는 직접 입력 (새 품목으로 추가)"
                    className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                  />
                  {willCreateProductionTargetItem && (
                    <div className="mt-2 rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                      새 품목으로 추가돼. (<b>{quickPanel.productionType === '원료생산' ? '원료' : '분쇄품'}</b>)
                    </div>
                  )}
                </div>

                {quickPanel.productionType === '원료생산' && (
                  <div>
                    <p className="mb-1 text-xs text-neutral-500">생산량 kg</p>
                    <input value={quickPanel.targetKgQty} onChange={(e) => { setQuickPanel((prev) => ({ ...prev, targetKgQty: e.target.value })); setError(''); }} placeholder="생산된 원료 kg" inputMode="decimal" className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400" />
                  </div>
                )}
                {quickPanel.productionType === '분쇄품생산' && (
                  <div>
                    <p className="mb-1 text-xs text-neutral-500">생산량 bag</p>
                    <input value={quickPanel.targetBagQty} onChange={(e) => { setQuickPanel((prev) => ({ ...prev, targetBagQty: e.target.value })); setError(''); }} placeholder="생산된 분쇄품 bag" inputMode="numeric" className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400" />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── 재고 ── */}
        {quickPanel.action === '재고' && (
          <div>
            <p className="mb-1 text-xs text-neutral-500">품목</p>
            <select
              value={quickPanel.inoutItems[0]?.itemId ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                setQuickPanel((prev) => {
                  const next = [...prev.inoutItems];
                  if (val === '') {
                    next[0] = { ...next[0], itemId: null, itemName: '' };
                  } else {
                    const id = Number(val);
                    const item = inventory.find((i) => i.id === id);
                    next[0] = { ...next[0], itemId: id, itemName: item?.name ?? '' };
                  }
                  return { ...prev, inoutItems: next };
                });
                setError('');
              }}
              className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
            >
              <option value="">품목 선택</option>
              {inventory.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({Number(item.current_stock).toLocaleString()}{item.unit})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* ── 입고 / 출고 (다중 품목) ── */}
        {(quickPanel.action === '입고' || quickPanel.action === '출고') && (
          <>
            <div>
              <p className="mb-1 text-xs text-neutral-500">형태</p>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORY_OPTIONS.map((category) => (
                  <button
                    key={category}
                    onClick={() => {
                      setQuickPanel((prev) => ({ ...prev, category, inoutItems: [{ ...EMPTY_INOUT_ITEM }] }));
                      setError('');
                    }}
                    className={cn('rounded-2xl border px-3 py-3 text-sm font-medium', quickPanel.category === category ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-neutral-50 text-neutral-700')}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>

            {quickPanel.category && (
              <div>
                <p className="mb-2 text-xs text-neutral-500">
                  품목 목록
                  {quickPanel.companyName.trim() && <span className="ml-1 text-blue-500">({quickPanel.companyName.trim()} 품목 우선)</span>}
                </p>
                {quickPanel.inoutItems.map((inoutItem, index) => {
                  const itemEffectiveCat = inoutItem.itemCategory ?? quickPanel.category;
                  const byCategory = itemEffectiveCat ? inventory.filter((item) => normalizeCategory(item.category) === itemEffectiveCat) : [];
                  const prefix = quickPanel.companyName.trim();
                  const itemOptions = prefix
                    ? (byCategory.filter((i) => i.name.startsWith(prefix + ' ')).length > 0
                      ? byCategory.filter((i) => i.name.startsWith(prefix + ' '))
                      : byCategory)
                    : byCategory;
                  return (
                    <div key={index} className="mb-3 rounded-2xl border border-neutral-100 bg-neutral-50 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-neutral-500">품목 {index + 1}</p>
                        {quickPanel.inoutItems.length > 1 && (
                          <button onClick={() => setQuickPanel((prev) => ({ ...prev, inoutItems: prev.inoutItems.filter((_, i) => i !== index) }))} className="text-red-500 text-xs font-semibold">✕ 삭제</button>
                        )}
                      </div>
                      {/* 품목별 유형 선택 */}
                      <div className="flex gap-1">
                        {CATEGORY_OPTIONS.map((cat) => (
                          <button
                            key={cat}
                            onClick={() => {
                              setQuickPanel((prev) => {
                                const next = [...prev.inoutItems];
                                next[index] = { ...EMPTY_INOUT_ITEM, itemCategory: cat };
                                return { ...prev, inoutItems: next };
                              });
                              setError('');
                            }}
                            className={cn(
                              'flex-1 rounded-xl border px-1 py-1 text-[11px] font-medium',
                              itemEffectiveCat === cat
                                ? 'border-neutral-900 bg-neutral-900 text-white'
                                : 'border-neutral-200 bg-white text-neutral-600'
                            )}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                      <select
                        value={inoutItem.itemId ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setQuickPanel((prev) => {
                            const next = [...prev.inoutItems];
                            if (val === '') {
                              next[index] = { ...next[index], itemId: null, itemName: '' };
                            } else {
                              const id = Number(val);
                              const item = itemOptions.find((i) => i.id === id);
                              next[index] = { ...next[index], itemId: id, itemName: item?.name ?? '' };
                            }
                            return { ...prev, inoutItems: next };
                          });
                          setError('');
                        }}
                        className="w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400"
                      >
                        <option value="">품목 선택</option>
                        {itemOptions.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} ({Number(item.current_stock).toLocaleString()}{item.unit})
                          </option>
                        ))}
                      </select>
                      <input
                        value={inoutItem.itemName}
                        onChange={(e) => { updateInoutItem(index, 'itemName', e.target.value); updateInoutItem(index, 'itemId', null); }}
                        placeholder={quickPanel.companyName.trim() ? `품목명 입력 (저장 시 "${quickPanel.companyName.trim()} " 자동 추가)` : '또는 품목명 직접 입력'}
                        className="w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                      />
                      {itemEffectiveCat === '원료' ? (
                        <div>
                          <p className="mb-1 text-[11px] text-neutral-400">kg</p>
                          <input value={inoutItem.kgQty} onChange={(e) => updateInoutItem(index, 'kgQty', e.target.value)} placeholder="kg 수량" inputMode="decimal" className="w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400" />
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="mb-1 text-[11px] text-neutral-400">bag</p>
                            <input value={inoutItem.bagQty} onChange={(e) => updateInoutItem(index, 'bagQty', e.target.value)} placeholder="bag 수" inputMode="numeric" className="w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400" />
                          </div>
                          <div>
                            <p className="mb-1 text-[11px] text-neutral-400">kg (선택)</p>
                            <input value={inoutItem.kgQty} onChange={(e) => updateInoutItem(index, 'kgQty', e.target.value)} placeholder="없으면 비워둬" inputMode="decimal" className="w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <button
                  onClick={() => setQuickPanel((prev) => ({ ...prev, inoutItems: [...prev.inoutItems, { ...EMPTY_INOUT_ITEM }] }))}
                  className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600"
                >
                  + 품목 추가
                </button>
              </div>
            )}
          </>
        )}

        {/* 메모 (입고/출고/생산) */}
        {quickPanel.action && quickPanel.action !== '재고' && (
          <div>
            <p className="mb-1 text-xs text-neutral-500">메모 (선택)</p>
            <input
              value={quickPanel.memo}
              onChange={(e) => setField('memo', e.target.value)}
              placeholder="메모 입력"
              className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
            />
          </div>
        )}

        {/* 선택값 요약 */}
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
          {summary ? `선택값: ${summary}` : '아직 선택된 값이 없어.'}
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button onClick={onClose} className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-700">취소</button>
          <button onClick={() => void handleExecute()} disabled={sending} className="rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
            {sending ? '처리중' : '실행'}
          </button>
        </div>
      </div>

    </div>
  );
}
