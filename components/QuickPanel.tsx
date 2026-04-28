'use client';

import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { Company, InventoryCategory, InventoryItem, InventoryLogRow, MessageRow, QuickPanelState } from '../lib/types';
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
  setMessages: React.Dispatch<React.SetStateAction<MessageRow[]>>;
};

const CATEGORY_OPTIONS: InventoryCategory[] = ['원료', '분쇄품', '스크랩'];

export const EMPTY_PANEL: QuickPanelState = {
  isOpen: false,
  date: todayString(),
  companyId: null,
  companyName: '',
  action: null,
  category: null,
  itemName: '',
  selectedItemId: null,
  bagQty: '',
  kgQty: '',
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
  setMessages,
}: Props) {
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [itemModalOpen, setItemModalOpen] = useState(false);

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

  const quickPanelItems = useMemo(() => {
    if (!quickPanel.action) return [];
    if (quickPanel.action === '재고') return inventory;
    if ((quickPanel.action === '입고' || quickPanel.action === '출고') && quickPanel.category) {
      return inventory.filter((item) => normalizeCategory(item.category) === quickPanel.category);
    }
    return [];
  }, [quickPanel.action, quickPanel.category, inventory]);

  const willCreateNewItem = useMemo(() => {
    if (!(quickPanel.action === '입고' || quickPanel.action === '출고')) return false;
    if (!quickPanel.category || !quickPanel.itemName.trim()) return false;
    if (quickPanel.selectedItemId) return false;
    const typed = quickPanel.itemName.trim().toLowerCase();
    return !inventory.find((item) => {
      const nameMatch = item.name.trim().toLowerCase() === typed;
      const categoryMatch = normalizeCategory(item.category) === quickPanel.category;
      return nameMatch && categoryMatch;
    });
  }, [quickPanel, inventory]);

  const existingProductionTargetItem = useMemo(() => {
    const typed = quickPanel.targetItemName.trim().toLowerCase();
    if (!typed || !quickPanel.productionType) return null;
    const targetCategory = quickPanel.productionType === '원료생산' ? '원료' : '분쇄품';
    return inventory.find((item) => item.name.trim().toLowerCase() === typed && normalizeCategory(item.category) === targetCategory) ?? null;
  }, [inventory, quickPanel.targetItemName, quickPanel.productionType]);

  const willCreateProductionTargetItem = useMemo(() => {
    if (quickPanel.action !== '생산') return false;
    if (!quickPanel.productionType || !quickPanel.targetItemName.trim()) return false;
    if (quickPanel.targetItemId) return false;
    return !existingProductionTargetItem;
  }, [quickPanel, existingProductionTargetItem]);

  function createTempMessage(content: string, messageType: MessageRow['message_type']): MessageRow {
    return {
      id: -Date.now() - Math.floor(Math.random() * 1000),
      content,
      message_type: messageType,
      created_at: new Date().toISOString(),
      user_id: currentUserId,
      user_email: currentUserEmail,
      user_name: currentUserName,
    };
  }

  async function insertMessage(content: string, messageType: MessageRow['message_type']) {
    const { error } = await supabase.from('messages').insert({
      content, message_type: messageType,
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

  async function insertLog(itemId: number, action: 'in' | 'out', qty: number, note: string | null = null) {
    const { error } = await supabase.from('inventory_logs').insert({
      item_id: itemId, action, qty, note,
      user_id: currentUserId, user_email: currentUserEmail, user_name: currentUserName,
      company_id: quickPanel.companyId || null,
      company_name: quickPanel.companyName.trim() || null,
    });
    if (error) throw error;
  }

  async function updateStock(itemId: number, newStock: number) {
    const { error } = await supabase.from('inventory_items').update({ current_stock: newStock }).eq('id', itemId);
    if (error) throw error;
  }

  async function createItem(name: string, category: InventoryCategory, unit: string, initialStock: number): Promise<InventoryItem> {
    const { data, error } = await supabase.from('inventory_items').insert({ name, category, unit, current_stock: initialStock }).select('id, name, current_stock, unit, category').single();
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

  async function execute() {
    const action = quickPanel.action;
    if (!action) { setError('작업을 먼저 선택해줘.'); return; }

    // 생산
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
      const typedTargetName = quickPanel.targetItemName.trim();

      if (!targetItem && !typedTargetName) { setError('결과 품목을 선택하거나 새로 입력해줘.'); return; }
      if (!targetItem && typedTargetName) {
        targetItem = await createItem(typedTargetName, targetCategory, productionType === '원료생산' ? 'kg' : 'bag', 0);
      }
      if (!targetItem) { setError('결과 품목을 확인해줘.'); return; }

      const sourceNames = validSources.map((src) => {
        const srcItem = src.itemId ? inventory.find((item) => item.id === src.itemId) : null;
        return `${srcItem?.name || src.customName} ${src.bagQty}bag`;
      }).join(', ');

      if (productionType === '원료생산') {
        const targetKgQty = Number(quickPanel.targetKgQty);
        if (!Number.isFinite(targetKgQty) || targetKgQty <= 0) { setError('생산된 원료 kg를 입력해줘.'); return; }
        await saveMsg(`생산 원료생산 사용:${sourceNames || '없음'} 결과:${targetItem.name} ${targetKgQty}kg`, 'chat');
        for (const src of validSources) {
          if (src.itemId === null) continue;
          const srcItem = inventory.find((item) => item.id === src.itemId)!;
          await updateStock(srcItem.id, Number(srcItem.current_stock) - Number(src.bagQty));
          await insertLog(srcItem.id, 'out', Number(src.bagQty), `production_use:원료생산:${targetItem.name}`);
        }
        await updateStock(targetItem.id, Number(targetItem.current_stock ?? 0) + targetKgQty);
        await insertLog(targetItem.id, 'in', targetKgQty, `production_result:원료생산:${sourceNames || '없음'}`);
        await saveMsg(`${sourceNames || '사용품목 없음'}, ${targetItem.name} ${targetKgQty}kg 생산 완료.`, 'system');
        onClose();
        await onDone();
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
          await insertLog(srcItem.id, 'out', Number(src.bagQty), `production_use:분쇄품생산:${targetItem.name}`);
        }
        await updateStock(targetItem.id, Number(targetItem.current_stock ?? 0) + targetBagQty);
        await insertLog(targetItem.id, 'in', targetBagQty, `production_result:분쇄품생산:${sourceNames || '없음'}`);
        await saveMsg(`${sourceNames || '사용품목 없음'}, ${targetItem.name} ${targetBagQty}bag 생산 완료.`, 'system');
        onClose();
        await onDone();
        return;
      }
    }

    // 재고 확인
    if (action === '재고') {
      const found = inventory.find((i) => i.id === quickPanel.selectedItemId) || getMatchedItem(quickPanel.itemName.trim(), null);
      if (!found) { setError('재고 확인할 품목을 입력하거나 선택해줘.'); return; }
      await saveMsg(`재고 ${found.name}`, 'chat');
      await saveMsg(`${found.name} 현재 재고는 ${found.current_stock}${found.unit} 이야.`, 'system');
      onClose();
      return;
    }

    // 입고 / 출고
    if (action === '입고' || action === '출고') {
      if (!quickPanel.category) { setError('형태를 먼저 선택해줘.'); return; }
      const typedName = quickPanel.itemName.trim();
      let found = inventory.find((i) => i.id === quickPanel.selectedItemId) || getMatchedItem(typedName, quickPanel.category);
      if (!typedName && !found) { setError('품목을 입력하거나 선택해줘.'); return; }

      if (quickPanel.category === '원료') {
        const kg = Number(quickPanel.kgQty);
        if (!Number.isFinite(kg) || kg <= 0) { setError('원료는 kg 수량을 입력해줘.'); return; }
        if (!found) {
          if (action === '출고') { setError('없는 품목은 출고할 수 없어.'); return; }
          found = await createItem(typedName, '원료', 'kg', 0);
        }
        const currentStock = Number(found.current_stock ?? 0);
        if (action === '출고' && currentStock < kg) { setError(`${found.name} 재고 부족 (현재 ${currentStock}${found.unit})`); return; }
        const newStock = action === '입고' ? currentStock + kg : currentStock - kg;
        await saveMsg(`${action} ${quickPanel.category} ${found.name} ${kg}kg`, 'chat');
        await updateStock(found.id, newStock);
        await insertLog(found.id, action === '입고' ? 'in' : 'out', kg);
        await saveMsg(willCreateNewItem ? `${found.name} 새 품목 추가 후 ${kg}kg ${action} 완료.` : `${found.name} ${kg}kg ${action} 완료.`, 'system');
        onClose();
        await onDone();
        return;
      }

      const bagQty = Number(quickPanel.bagQty);
      const kgQty = quickPanel.kgQty.trim() === '' ? null : Number(quickPanel.kgQty);
      if (!Number.isFinite(bagQty) || bagQty <= 0) { setError('분쇄품/스크랩은 bag 수를 입력해줘.'); return; }
      if (kgQty !== null && (!Number.isFinite(kgQty) || kgQty < 0)) { setError('kg는 비워두거나 숫자로 입력해줘.'); return; }
      if (!found) {
        if (action === '출고') { setError('없는 품목은 출고할 수 없어.'); return; }
        found = await createItem(typedName, quickPanel.category, 'bag', 0);
      }
      const currentStock = Number(found.current_stock ?? 0);
      if (action === '출고' && currentStock < bagQty) { setError(`${found.name} 재고 부족 (현재 ${currentStock}${found.unit})`); return; }
      const newStock = action === '입고' ? currentStock + bagQty : currentStock - bagQty;
      const kgText = kgQty !== null && kgQty > 0 ? ` / ${kgQty}kg` : '';
      await saveMsg(`${action} ${quickPanel.category} ${found.name} ${bagQty}bag${kgText}`, 'chat');
      await updateStock(found.id, newStock);
      await insertLog(found.id, action === '입고' ? 'in' : 'out', bagQty);
      await saveMsg(willCreateNewItem ? `${found.name} 새 품목 추가 후 ${bagQty}bag${kgText} ${action} 완료.` : `${found.name} ${bagQty}bag${kgText} ${action} 완료.`, 'system');
      onClose();
      await onDone();
    }
  }

  async function handleExecute() {
    if (sending) return;
    try {
      setSending(true);
      setError('');
      await execute();
    } catch (e) {
      const msg = getErrorMessage(e);
      setError(msg);
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
    } else {
      if (quickPanel.category) parts.push(quickPanel.category);
      if (quickPanel.itemName.trim()) parts.push(quickPanel.itemName.trim());
      if (quickPanel.bagQty.trim()) parts.push(`${quickPanel.bagQty.trim()}bag`);
      if (quickPanel.kgQty.trim()) parts.push(`${quickPanel.kgQty.trim()}kg`);
    }
    return parts.join(' / ');
  }, [quickPanel]);

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

        {/* 2. 회사 선택 */}
        <div>
          <p className="mb-1 text-xs text-neutral-500">거래처 (선택)</p>
          {sortedCompanies.length > 0 && (
            <select
              value={quickPanel.companyId ?? ''}
              onChange={(e) => {
                if (e.target.value === '') {
                  setField('companyId', null);
                } else {
                  const id = Number(e.target.value);
                  const company = companies.find((c) => c.id === id);
                  setQuickPanel((prev) => ({ ...prev, companyId: id, companyName: company?.name ?? '' }));
                  setError('');
                }
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
            onChange={(e) => setQuickPanel((prev) => ({ ...prev, companyName: e.target.value, companyId: null }))}
            placeholder="거래처명 직접 입력 (없으면 비워도 됨)"
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
                    itemName: '',
                    selectedItemId: null,
                    bagQty: '',
                    kgQty: '',
                    productionType: null,
                    sources: [{ itemId: null, customName: '', bagQty: '' }],
                    targetItemId: null,
                    targetItemName: '',
                    targetBagQty: '',
                    targetKgQty: '',
                  }));
                  setError('');
                  setItemModalOpen(false);
                }}
                className={cn('rounded-2xl border px-2 py-3 text-xs font-medium', quickPanel.action === action ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-neutral-50 text-neutral-700')}
              >
                {action}
              </button>
            ))}
          </div>
        </div>

        {/* 생산 */}
        {quickPanel.action === '생산' && (
          <div className="space-y-3">
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
                          >
                            ✕
                          </button>
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
                  <input
                    value={quickPanel.targetItemName}
                    onChange={(e) => setQuickPanel((prev) => ({ ...prev, targetItemName: e.target.value, targetItemId: null }))}
                    placeholder="결과 품목 직접 입력 가능"
                    className="mb-2 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                  />
                  <div className="flex flex-wrap gap-2">
                    {productionTargetItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setQuickPanel((prev) => ({ ...prev, targetItemId: item.id, targetItemName: item.name }))}
                        className={cn('rounded-full border px-3 py-2 text-sm', quickPanel.targetItemId === item.id ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-neutral-50 text-neutral-700')}
                      >
                        {item.name}
                      </button>
                    ))}
                  </div>
                  {willCreateProductionTargetItem && (
                    <div className="mt-2 rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                      새 품목으로 추가돼. (<b>{quickPanel.productionType === '원료생산' ? '원료' : '분쇄품'}</b>)
                    </div>
                  )}
                </div>

                {quickPanel.productionType === '원료생산' && (
                  <div>
                    <p className="mb-1 text-xs text-neutral-500">생산량 kg</p>
                    <input
                      value={quickPanel.targetKgQty}
                      onChange={(e) => { setQuickPanel((prev) => ({ ...prev, targetKgQty: e.target.value })); setError(''); }}
                      placeholder="생산된 원료 kg"
                      inputMode="decimal"
                      className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                    />
                  </div>
                )}
                {quickPanel.productionType === '분쇄품생산' && (
                  <div>
                    <p className="mb-1 text-xs text-neutral-500">생산량 bag</p>
                    <input
                      value={quickPanel.targetBagQty}
                      onChange={(e) => { setQuickPanel((prev) => ({ ...prev, targetBagQty: e.target.value })); setError(''); }}
                      placeholder="생산된 분쇄품 bag"
                      inputMode="numeric"
                      className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* 입고/출고 폼 */}
        {(quickPanel.action === '입고' || quickPanel.action === '출고') && (
          <>
            <div>
              <p className="mb-1 text-xs text-neutral-500">형태</p>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORY_OPTIONS.map((category) => (
                  <button
                    key={category}
                    onClick={() => setQuickPanel((prev) => ({ ...prev, category, itemName: '', selectedItemId: null, bagQty: '', kgQty: '' }))}
                    className={cn('rounded-2xl border px-3 py-3 text-sm font-medium', quickPanel.category === category ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-neutral-50 text-neutral-700')}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>

            {quickPanel.category && (
              <div>
                <p className="mb-1 text-xs text-neutral-500">품목</p>
                <input
                  value={quickPanel.itemName}
                  onChange={(e) => { setQuickPanel((prev) => ({ ...prev, itemName: e.target.value, selectedItemId: null })); setError(''); }}
                  placeholder="품목명 입력"
                  className="mb-2 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                />
                {quickPanelItems.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => setItemModalOpen((prev) => !prev)}
                      className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-left text-sm text-neutral-700"
                    >
                      {quickPanel.selectedItemId ? quickPanelItems.find((i) => i.id === quickPanel.selectedItemId)?.name : '품목 선택'}
                      <span className="float-right">{itemModalOpen ? '▲' : '▼'}</span>
                    </button>
                  </div>
                )}
                {willCreateNewItem && (
                  <div className="mt-2 rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    새 품목으로 추가돼. (<b>{quickPanel.category}</b>)
                  </div>
                )}
              </div>
            )}

            {quickPanel.category === '원료' && (
              <div>
                <p className="mb-1 text-xs text-neutral-500">kg</p>
                <input
                  value={quickPanel.kgQty}
                  onChange={(e) => { setQuickPanel((prev) => ({ ...prev, kgQty: e.target.value })); setError(''); }}
                  placeholder="kg 수량"
                  inputMode="decimal"
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                />
              </div>
            )}
            {quickPanel.category && quickPanel.category !== '원료' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="mb-1 text-xs text-neutral-500">bag</p>
                  <input
                    value={quickPanel.bagQty}
                    onChange={(e) => { setQuickPanel((prev) => ({ ...prev, bagQty: e.target.value })); setError(''); }}
                    placeholder="bag 수"
                    inputMode="numeric"
                    className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs text-neutral-500">kg (선택)</p>
                  <input
                    value={quickPanel.kgQty}
                    onChange={(e) => { setQuickPanel((prev) => ({ ...prev, kgQty: e.target.value })); setError(''); }}
                    placeholder="없으면 비워둬"
                    inputMode="decimal"
                    className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                  />
                </div>
              </div>
            )}
          </>
        )}

        {/* 재고 */}
        {quickPanel.action === '재고' && (
          <div>
            <p className="mb-1 text-xs text-neutral-500">품목</p>
            <input
              value={quickPanel.itemName}
              onChange={(e) => { setQuickPanel((prev) => ({ ...prev, itemName: e.target.value, selectedItemId: null })); setError(''); }}
              placeholder="품목명 입력"
              className="mb-2 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
            />
            <div className="flex flex-wrap gap-2">
              {inventory.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setQuickPanel((prev) => ({ ...prev, selectedItemId: item.id, itemName: item.name }))}
                  className={cn('rounded-full border px-3 py-2 text-sm', quickPanel.selectedItemId === item.id ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-neutral-50 text-neutral-700')}
                >
                  {item.name}
                </button>
              ))}
            </div>
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

      {/* 품목 선택 모달 */}
      {itemModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setItemModalOpen(false)}>
          <div className="w-full max-w-md rounded-3xl bg-white p-4 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">품목 선택</p>
              <button onClick={() => setItemModalOpen(false)} className="rounded-full border border-neutral-200 px-3 py-1 text-xs">닫기</button>
            </div>
            <div className="max-h-80 overflow-y-auto space-y-2">
              {quickPanelItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => { setQuickPanel((prev) => ({ ...prev, selectedItemId: item.id, itemName: item.name })); setItemModalOpen(false); setError(''); }}
                  className={cn('w-full rounded-2xl border px-4 py-3 text-left text-sm font-medium', quickPanel.selectedItemId === item.id ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-neutral-50 text-neutral-700')}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
