'use client';

import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { Company, InventoryCategory, InventoryItem, UserProfile } from '../lib/types';
import { cn, getErrorMessage, normalizeCategory } from '../lib/utils';

const ADMIN_EMAIL = 'sj_advisory@naver.com';
const CATEGORY_OPTIONS: InventoryCategory[] = ['원료', '분쇄품', '스크랩'];

type Props = {
  inventory: InventoryItem[];
  profiles: UserProfile[];
  companies: Company[];
  currentUserId: string | null;
  currentUserEmail: string | null;
  setCurrentUserName: (name: string) => void;
  onRefreshInventory: () => Promise<void>;
  onRefreshProfiles: () => Promise<void>;
  onCompanyAdded: () => Promise<void>;
};

export default function StockTab({
  inventory,
  profiles,
  companies,
  currentUserId,
  currentUserEmail,
  setCurrentUserName,
  onRefreshInventory,
  onRefreshProfiles,
  onCompanyAdded,
}: Props) {
  const [manageMode, setManageMode] = useState(false);
  const [stockSearch, setStockSearch] = useState('');
  const [stockCategory, setStockCategory] = useState('원료');
  const [stockViewMode, setStockViewMode] = useState<'all' | 'company'>('all');
  const [selectedCompanyFilter, setSelectedCompanyFilter] = useState<string | null>(null);
  const [errorText, setErrorText] = useState('');

  // 새 품목 추가
  const [newItemName, setNewItemName] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('kg');
  const [newItemStock, setNewItemStock] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<InventoryCategory>('원료');
  const [newItemCompanyId, setNewItemCompanyId] = useState<number | null>(null);
  const [newItemCompanyName, setNewItemCompanyName] = useState('');
  const [creatingItem, setCreatingItem] = useState(false);

  // 품목 수정
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingItemName, setEditingItemName] = useState('');
  const [editingItemStock, setEditingItemStock] = useState('');
  const [editingItemMemo, setEditingItemMemo] = useState('');
  const [editingItemCategory, setEditingItemCategory] = useState<InventoryCategory>('원료');
  const [editingItemCompanyId, setEditingItemCompanyId] = useState<number | null>(null);
  const [editingItemCompanyName, setEditingItemCompanyName] = useState('');

  // C안 거래처 등록 프롬프트
  const [pendingCompanyName, setPendingCompanyName] = useState<string | null>(null);
  const [addingCompany, setAddingCompany] = useState(false);

  // 직원 이름
  const [userNameDrafts, setUserNameDrafts] = useState<Record<string, string>>({});
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);

  const isAdmin = currentUserEmail === ADMIN_EMAIL;
  const stockTabs = ['원료', '분쇄품', '스크랩'];

  const sortedCompanies = useMemo(() => {
    return [...companies].sort((a, b) => {
      if (a.is_favorite && !b.is_favorite) return -1;
      if (!a.is_favorite && b.is_favorite) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [companies]);

  const filteredStock = useMemo(() => {
    return inventory.filter((item) => {
      const matchesSearch = stockSearch.trim() === '' || item.name.toLowerCase().includes(stockSearch.trim().toLowerCase());
      const itemCategory = normalizeCategory(item.category);
      const matchesCategory = itemCategory === stockCategory;
      const matchesCompany = stockViewMode === 'all' || !selectedCompanyFilter
        ? true
        : item.name.startsWith(selectedCompanyFilter + ' ');
      return matchesSearch && matchesCategory && matchesCompany;
    });
  }, [inventory, stockSearch, stockCategory, stockViewMode, selectedCompanyFilter]);

  // 품목명에서 거래처명/기본명 분리 (첫 단어 = 거래처, 나머지 = 품목명)
  function splitItemDisplay(name: string): { company: string; baseName: string } {
    const parts = name.split(' ');
    if (parts.length <= 1) return { company: '', baseName: name };
    return { company: parts[0], baseName: parts.slice(1).join(' ') };
  }

  // 거래처명 + 품목명 합치기
  function applyPrefix(company: string, baseName: string): string {
    const c = company.trim();
    const n = baseName.trim();
    if (!c) return n;
    if (n.startsWith(c + ' ')) return n;
    return `${c} ${n}`;
  }

  // 기존 품목명에서 거래처명 분리
  function parseItemName(name: string): { companyId: number | null; companyName: string; baseName: string } {
    for (const company of companies) {
      if (name.startsWith(company.name + ' ')) {
        return { companyId: company.id, companyName: company.name, baseName: name.slice(company.name.length + 1) };
      }
    }
    return { companyId: null, companyName: '', baseName: name };
  }

  // 이 거래처명이 목록에 없는 신규인지 확인
  function isNewCompanyName(name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;
    return !companies.some((c) => c.name === trimmed);
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

  async function handleCreateItem() {
    const baseName = newItemName.trim();
    const stock = newItemStock.trim() === '' ? 0 : Number(newItemStock);
    if (!baseName) { setErrorText('새 품목명을 입력해줘.'); return; }
    if (!newItemUnit.trim()) { setErrorText('단위를 입력해줘.'); return; }
    if (!Number.isFinite(stock) || stock < 0) { setErrorText('초기 재고는 0 이상 숫자로 입력해줘.'); return; }
    const finalName = applyPrefix(newItemCompanyName, baseName);
    try {
      setCreatingItem(true);
      setErrorText('');
      const { error } = await supabase.from('inventory_items').insert({
        name: finalName, category: newItemCategory, unit: newItemUnit.trim(), current_stock: stock,
      });
      if (error) throw error;
      const newCompany = newItemCompanyName.trim();
      setNewItemName(''); setNewItemUnit('kg'); setNewItemStock(''); setNewItemCategory('원료');
      setNewItemCompanyId(null); setNewItemCompanyName('');
      await onRefreshInventory();
      if (isNewCompanyName(newCompany)) {
        setPendingCompanyName(newCompany);
      }
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setCreatingItem(false);
    }
  }

  async function handleUpdateItem(itemId: number) {
    const baseName = editingItemName.trim();
    const stock = Number(editingItemStock);
    if (!baseName) { setErrorText('품목명을 입력해줘.'); return; }
    if (!Number.isFinite(stock) || stock < 0) { setErrorText('재고는 0 이상 숫자로 입력해줘.'); return; }
    const finalName = applyPrefix(editingItemCompanyName, baseName);
    try {
      setErrorText('');
      const { error } = await supabase.from('inventory_items').update({
        name: finalName, current_stock: stock, category: editingItemCategory, memo: editingItemMemo,
      }).eq('id', itemId);
      if (error) throw error;
      const newCompany = editingItemCompanyName.trim();
      setEditingItemId(null);
      await onRefreshInventory();
      if (isNewCompanyName(newCompany)) {
        setPendingCompanyName(newCompany);
      }
    } catch (error) {
      setErrorText(getErrorMessage(error));
    }
  }

  async function handleDeleteItem(itemId: number) {
    if (!window.confirm('이 품목과 관련된 모든 입출고 기록도 함께 삭제됩니다. 삭제할까요?')) return;
    try {
      setErrorText('');
      // 관련 입출고 로그 먼저 삭제 (외래키 오류 방지)
      const { error: logError } = await supabase.from('inventory_logs').delete().eq('item_id', itemId);
      if (logError) throw logError;
      const { error } = await supabase.from('inventory_items').delete().eq('id', itemId);
      if (error) throw error;
      await onRefreshInventory();
    } catch (error) {
      setErrorText(getErrorMessage(error));
    }
  }

  async function handleSaveProfileName(profileId: string) {
    const nextName = (userNameDrafts[profileId] || '').trim();
    if (!nextName) { setErrorText('직원 이름을 입력해줘.'); return; }
    try {
      setSavingProfileId(profileId);
      setErrorText('');
      const { error } = await supabase.from('profiles').update({ name: nextName }).eq('id', profileId);
      if (error) throw error;
      if (profileId === currentUserId) setCurrentUserName(nextName);
      await onRefreshProfiles();
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setSavingProfileId(null);
    }
  }

  async function handleClearMessages() {
    if (!window.confirm('채팅 기록을 모두 삭제할까요?')) return;
    try {
      setErrorText('');
      const { error } = await supabase.from('messages').delete().neq('id', 0);
      if (error) throw error;
    } catch (error) {
      setErrorText(getErrorMessage(error));
    }
  }

  // 거래처 선택 공통 UI 컴포넌트 (인라인)
  function CompanySelector({
    companyId,
    companyName,
    onSelectId,
    onChangeName,
  }: {
    companyId: number | null;
    companyName: string;
    onSelectId: (id: number | null, name: string) => void;
    onChangeName: (name: string) => void;
  }) {
    return (
      <div>
        <p className="mb-1 text-xs text-neutral-500">거래처 (선택)</p>
        {sortedCompanies.length > 0 && (
          <select
            value={companyId ?? ''}
            onChange={(e) => {
              if (e.target.value === '') {
                onSelectId(null, '');
              } else {
                const id = Number(e.target.value);
                const company = companies.find((c) => c.id === id);
                onSelectId(id, company?.name ?? '');
              }
            }}
            className="mb-2 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
          >
            <option value="">거래처 없음 / 직접 입력</option>
            {sortedCompanies.map((c) => (
              <option key={c.id} value={c.id}>{c.is_favorite ? '⭐ ' : ''}{c.name}</option>
            ))}
          </select>
        )}
        <input
          value={companyName}
          onChange={(e) => onChangeName(e.target.value)}
          placeholder="또는 거래처명 직접 입력"
          className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
        />
      </div>
    );
  }

  return (
    <div className="px-3 py-4">
      {errorText && (
        <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorText}</div>
      )}

      {/* C안 거래처 등록 모달 */}
      {pendingCompanyName && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setPendingCompanyName(null)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-10" onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-bold mb-1">거래처 등록</p>
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

      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => setManageMode(false)} className={cn('flex-1 rounded-2xl border px-3 py-3 text-sm font-medium', !manageMode ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-600')}>
          재고 보기
        </button>
        <button onClick={() => setManageMode(true)} className={cn('flex-1 rounded-2xl border px-3 py-3 text-sm font-medium', manageMode ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-600')}>
          관리
        </button>
      </div>

      {!manageMode && (
        <>
          <div className="mb-3 space-y-2">
            {/* 전체 / 거래처별 전환 */}
            <div className="flex gap-2">
              <button
                onClick={() => { setStockViewMode('all'); setSelectedCompanyFilter(null); }}
                className={cn('flex-1 rounded-2xl border py-2.5 text-sm font-medium', stockViewMode === 'all' ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-600')}
              >
                전체
              </button>
              <button
                onClick={() => setStockViewMode('company')}
                className={cn('flex-1 rounded-2xl border py-2.5 text-sm font-medium', stockViewMode === 'company' ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-600')}
              >
                거래처별
              </button>
            </div>

            {/* 거래처별: 거래처 선택 목록 */}
            {stockViewMode === 'company' && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                  onClick={() => setSelectedCompanyFilter(null)}
                  className={cn('whitespace-nowrap rounded-full border px-3 py-2 text-sm transition', selectedCompanyFilter === null ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-600')}
                >
                  전체
                </button>
                {sortedCompanies.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCompanyFilter(c.name)}
                    className={cn('whitespace-nowrap rounded-full border px-3 py-2 text-sm transition', selectedCompanyFilter === c.name ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-600')}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}

            {/* 카테고리 탭 */}
            <div className="flex gap-2 overflow-x-auto pb-1">
              {stockTabs.map((category) => (
                <button key={category} onClick={() => setStockCategory(category)} className={cn('whitespace-nowrap rounded-full border px-3 py-2 text-sm transition', stockCategory === category ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-600')}>
                  {category}
                </button>
              ))}
            </div>
            <input value={stockSearch} onChange={(e) => setStockSearch(e.target.value)} placeholder={`${stockCategory} 검색`} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400" />
          </div>

          <div className="space-y-3">
            {filteredStock.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-500">표시할 품목이 없어.</div>
            ) : (
              filteredStock.map((item) => {
                const { company, baseName } = splitItemDisplay(item.name);
                return (
                  <div key={item.id} className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        {company ? (
                          <>
                            <p className="text-xs text-neutral-400 font-medium">{company}</p>
                            <p className="truncate text-base font-semibold">{baseName}</p>
                          </>
                        ) : (
                          <p className="truncate text-base font-semibold">{item.name}</p>
                        )}
                        <p className="mt-1 text-xs text-neutral-500">{normalizeCategory(item.category)}</p>
                        {item.memo && <p className="mt-1 text-xs text-blue-500">{item.memo}</p>}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-lg font-bold tracking-tight">
                          {Number(item.current_stock).toLocaleString()}
                          <span className="ml-1 text-sm font-medium text-neutral-500">{item.unit}</span>
                        </p>
                        <p className="mt-1 text-[11px] text-neutral-400">현재 재고</p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {manageMode && (
        <div className="space-y-4">
          {isAdmin && (
            <div className="rounded-3xl border border-red-200 bg-red-50 p-4 shadow-sm">
              <p className="mb-3 text-sm font-semibold text-red-700">관리자 메뉴</p>
              <button onClick={() => void handleClearMessages()} className="w-full rounded-2xl bg-red-600 px-4 py-3 text-sm font-semibold text-white">
                채팅 기록 초기화
              </button>
            </div>
          )}

          <div className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="mb-3 text-sm font-semibold">직원 이름 관리</p>
            <div className="space-y-3">
              {profiles.length === 0 ? (
                <p className="text-sm text-neutral-500">직원 정보가 없어.</p>
              ) : (
                profiles.map((profile) => (
                  <div key={profile.id} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
                    <p className="truncate text-xs text-neutral-500">{profile.email || '이메일없음'}</p>
                    <div className="mt-2 flex gap-2">
                      <input
                        value={userNameDrafts[profile.id] ?? profile.name ?? ''}
                        onChange={(e) => setUserNameDrafts((prev) => ({ ...prev, [profile.id]: e.target.value }))}
                        placeholder="직원 이름"
                        className="flex-1 rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                      />
                      <button
                        onClick={() => void handleSaveProfileName(profile.id)}
                        disabled={savingProfileId === profile.id}
                        className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold text-neutral-700 disabled:opacity-50"
                      >
                        {savingProfileId === profile.id ? '저장중' : '저장'}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 새 품목 추가 */}
          <div className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="mb-3 text-sm font-semibold">새 품목 추가</p>
            <div className="space-y-2">
              <CompanySelector
                companyId={newItemCompanyId}
                companyName={newItemCompanyName}
                onSelectId={(id, name) => { setNewItemCompanyId(id); setNewItemCompanyName(name); }}
                onChangeName={(name) => { setNewItemCompanyName(name); setNewItemCompanyId(null); }}
              />
              <div>
                <p className="mb-1 text-xs text-neutral-500">
                  품목명{newItemCompanyName.trim() ? ` (저장 시 "${newItemCompanyName.trim()} " 자동 추가)` : ''}
                </p>
                <input
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder="품목명"
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input value={newItemUnit} onChange={(e) => setNewItemUnit(e.target.value)} placeholder="단위 (kg, bag 등)" className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400" />
                <input value={newItemStock} onChange={(e) => setNewItemStock(e.target.value)} placeholder="초기 재고" inputMode="decimal" className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORY_OPTIONS.map((category) => (
                  <button key={category} onClick={() => setNewItemCategory(category)} className={cn('rounded-2xl border px-3 py-3 text-sm font-medium', newItemCategory === category ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-neutral-50 text-neutral-700')}>
                    {category}
                  </button>
                ))}
              </div>
              {newItemCompanyName.trim() && newItemName.trim() && (
                <div className="rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  저장될 품목명: <b>{applyPrefix(newItemCompanyName, newItemName)}</b>
                </div>
              )}
              <button onClick={() => void handleCreateItem()} disabled={creatingItem} className="w-full rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
                {creatingItem ? '추가중' : '품목 추가'}
              </button>
            </div>
          </div>

          {/* 품목 목록 + 수정 */}
          <div className="space-y-3">
            {inventory.map((item) => (
              <div key={item.id} className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
                {editingItemId === item.id ? (
                  <div className="space-y-2">
                    <CompanySelector
                      companyId={editingItemCompanyId}
                      companyName={editingItemCompanyName}
                      onSelectId={(id, name) => { setEditingItemCompanyId(id); setEditingItemCompanyName(name); }}
                      onChangeName={(name) => { setEditingItemCompanyName(name); setEditingItemCompanyId(null); }}
                    />
                    <div>
                      <p className="mb-1 text-xs text-neutral-500">
                        품목명{editingItemCompanyName.trim() ? ` (거래처명 제외)` : ''}
                      </p>
                      <input
                        value={editingItemName}
                        onChange={(e) => setEditingItemName(e.target.value)}
                        placeholder="품목명"
                        className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
                      />
                    </div>
                    {editingItemCompanyName.trim() && editingItemName.trim() && (
                      <div className="rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                        저장될 품목명: <b>{applyPrefix(editingItemCompanyName, editingItemName)}</b>
                      </div>
                    )}
                    <input value={editingItemStock} onChange={(e) => setEditingItemStock(e.target.value)} placeholder="재고량" inputMode="decimal" className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400" />
                    <textarea value={editingItemMemo} onChange={(e) => setEditingItemMemo(e.target.value)} placeholder="메모 (선택)" className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400 resize-none" rows={2} />
                    <div className="grid grid-cols-3 gap-2">
                      {CATEGORY_OPTIONS.map((category) => (
                        <button key={category} onClick={() => setEditingItemCategory(category)} className={cn('rounded-2xl border px-3 py-3 text-sm font-medium', editingItemCategory === category ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-neutral-50 text-neutral-700')}>
                          {category}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => void handleUpdateItem(item.id)} className="rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white">저장</button>
                      <button onClick={() => setEditingItemId(null)} className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold text-neutral-700">취소</button>
                    </div>
                    <button onClick={() => void handleDeleteItem(item.id)} className="w-full rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">품목 삭제</button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-base font-semibold">{item.name}</p>
                      <p className="mt-1 text-xs text-neutral-500">현재: {Number(item.current_stock).toLocaleString()}{item.unit}</p>
                      <p className="mt-1 text-xs text-neutral-400">{normalizeCategory(item.category)}</p>
                    </div>
                    <button
                      onClick={() => {
                        const parsed = parseItemName(item.name);
                        setEditingItemId(item.id);
                        setEditingItemName(parsed.baseName);
                        setEditingItemCompanyId(parsed.companyId);
                        setEditingItemCompanyName(parsed.companyName);
                        setEditingItemStock(String(item.current_stock));
                        setEditingItemMemo(item.memo ?? '');
                        setEditingItemCategory((normalizeCategory(item.category) as InventoryCategory) || '원료');
                      }}
                      className="rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-semibold text-neutral-700"
                    >
                      수정
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
