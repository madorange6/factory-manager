'use client';

import { useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { Company, InventoryItem, InventoryLogRow } from '../lib/types';
import { cn, formatDateTime, getErrorMessage } from '../lib/utils';

const ADMIN_EMAIL = 'sj_advisory@naver.com';

type Props = {
  companies: Company[];
  setCompanies: React.Dispatch<React.SetStateAction<Company[]>>;
  logs: InventoryLogRow[];
  inventory: InventoryItem[];
  currentUserEmail: string | null;
  onRefreshLogs: () => Promise<void>;
  onRefreshCompanies: () => Promise<void>;
};

type View = 'list' | 'detail' | 'manage';

export default function InOutTab({
  companies,
  setCompanies,
  logs,
  inventory,
  currentUserEmail,
  onRefreshLogs,
  onRefreshCompanies,
}: Props) {
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [view, setView] = useState<View>('list');
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [deletingLogId, setDeletingLogId] = useState<number | null>(null);
  const [errorText, setErrorText] = useState('');

  // 회사 관리 상태
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyMemo, setNewCompanyMemo] = useState('');
  const [editingCompanyId, setEditingCompanyId] = useState<number | null>(null);
  const [editingCompanyName, setEditingCompanyName] = useState('');
  const [editingCompanyMemo, setEditingCompanyMemo] = useState('');
  const [savingCompany, setSavingCompany] = useState(false);
  const [deletingCompanyId, setDeletingCompanyId] = useState<number | null>(null);

  const isAdmin = currentUserEmail === ADMIN_EMAIL;

  const inventoryMap = new Map(inventory.map((item) => [item.id, item]));

  const sortedCompanies = [...companies].sort((a, b) => {
    if (a.is_favorite && !b.is_favorite) return -1;
    if (!a.is_favorite && b.is_favorite) return 1;
    return a.name.localeCompare(b.name);
  });

  function getLastLogDate(companyId: number): string | null {
    const companyLogs = logs
      .filter((l) => l.company_id === companyId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (companyLogs.length === 0) return null;
    const d = new Date(companyLogs[0].created_at);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  async function toggleFavorite(company: Company) {
    try {
      const { error } = await supabase
        .from('companies')
        .update({ is_favorite: !company.is_favorite })
        .eq('id', company.id);
      if (error) throw error;
      setCompanies((prev) =>
        prev.map((c) => c.id === company.id ? { ...c, is_favorite: !c.is_favorite } : c)
      );
    } catch (error) {
      setErrorText(getErrorMessage(error));
    }
  }

  const companyLogs = selectedCompany
    ? logs
        .filter((l) => {
          const matchCompany = l.company_id === selectedCompany.id || l.company_name === selectedCompany.name;
          const matchDirection = direction === 'in' ? l.action === 'in' : l.action === 'out';
          return matchCompany && matchDirection;
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    : [];

  async function handleDeleteLog(log: InventoryLogRow) {
    const item = inventory.find((x) => x.id === log.item_id);
    if (!item) { setErrorText('재고 품목을 찾지 못했어.'); return; }
    const currentStock = Number(item.current_stock ?? 0);
    let restoredStock = currentStock;
    if (log.action === 'in') {
      restoredStock = currentStock - Number(log.qty);
      if (restoredStock < 0) { setErrorText('이 로그를 삭제하면 재고가 음수가 돼서 삭제할 수 없어.'); return; }
    } else {
      restoredStock = currentStock + Number(log.qty);
    }
    try {
      setDeletingLogId(log.id);
      setErrorText('');
      const { error: stockError } = await supabase
        .from('inventory_items')
        .update({ current_stock: restoredStock })
        .eq('id', item.id);
      if (stockError) throw stockError;
      const { error } = await supabase.from('inventory_logs').delete().eq('id', log.id);
      if (error) throw error;
      await onRefreshLogs();
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setDeletingLogId(null);
    }
  }

  async function handleAddCompany() {
    const name = newCompanyName.trim();
    if (!name) { setErrorText('회사명을 입력해줘.'); return; }
    try {
      setSavingCompany(true);
      setErrorText('');
      const { error } = await supabase.from('companies').insert({ name, memo: newCompanyMemo.trim() || null });
      if (error) throw error;
      setNewCompanyName('');
      setNewCompanyMemo('');
      await onRefreshCompanies();
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setSavingCompany(false);
    }
  }

  async function handleUpdateCompany(id: number) {
    const name = editingCompanyName.trim();
    if (!name) { setErrorText('회사명을 입력해줘.'); return; }
    try {
      setSavingCompany(true);
      setErrorText('');
      const { error } = await supabase
        .from('companies')
        .update({ name, memo: editingCompanyMemo.trim() || null })
        .eq('id', id);
      if (error) throw error;
      setEditingCompanyId(null);
      await onRefreshCompanies();
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setSavingCompany(false);
    }
  }

  async function handleDeleteCompany(id: number) {
    if (!window.confirm('이 거래처를 삭제할까요?')) return;
    try {
      setDeletingCompanyId(id);
      setErrorText('');
      const { error } = await supabase.from('companies').delete().eq('id', id);
      if (error) throw error;
      await onRefreshCompanies();
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setDeletingCompanyId(null);
    }
  }

  return (
    <div className="px-3 py-4">
      {errorText && (
        <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorText}</div>
      )}

      {/* 상단 스위치 + 관리 버튼 */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex flex-1 rounded-2xl border border-neutral-200 bg-white overflow-hidden">
          <button
            onClick={() => setDirection('in')}
            className={cn('flex-1 py-3 text-sm font-semibold transition', direction === 'in' ? 'bg-emerald-600 text-white' : 'text-neutral-600')}
          >
            입고
          </button>
          <button
            onClick={() => setDirection('out')}
            className={cn('flex-1 py-3 text-sm font-semibold transition', direction === 'out' ? 'bg-red-500 text-white' : 'text-neutral-600')}
          >
            출고
          </button>
        </div>
        <button
          onClick={() => setView(view === 'manage' ? 'list' : 'manage')}
          className={cn('rounded-2xl border px-3 py-3 text-sm font-semibold', view === 'manage' ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-700')}
        >
          관리
        </button>
      </div>

      {/* 회사 목록 */}
      {view === 'list' && !selectedCompany && (
        <div className="space-y-3">
          {sortedCompanies.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-500">
              등록된 거래처가 없어. 관리 버튼으로 추가해줘.
            </div>
          ) : (
            sortedCompanies.map((company) => {
              const lastDate = getLastLogDate(company.id);
              return (
                <div
                  key={company.id}
                  className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => void toggleFavorite(company)}
                      className="text-xl shrink-0"
                      aria-label="즐겨찾기 토글"
                    >
                      {company.is_favorite ? '⭐' : '☆'}
                    </button>
                    <button
                      className="flex-1 text-left min-w-0"
                      onClick={() => { setSelectedCompany(company); setView('detail'); }}
                    >
                      <p className="text-base font-semibold truncate">{company.name}</p>
                      {company.memo && <p className="text-xs text-blue-500 truncate mt-0.5">{company.memo}</p>}
                      {lastDate && <p className="text-xs text-neutral-400 mt-0.5">최근: {lastDate}</p>}
                    </button>
                    <span className="text-neutral-300 text-lg shrink-0">›</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 회사별 내역 */}
      {view === 'detail' && selectedCompany && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <button
              onClick={() => { setSelectedCompany(null); setView('list'); }}
              className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700"
            >
              ← 뒤로
            </button>
            <p className="text-base font-bold truncate flex-1">{selectedCompany.name}</p>
          </div>

          <div className="space-y-3">
            {companyLogs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-500">
                {direction === 'in' ? '입고' : '출고'} 내역이 없어.
              </div>
            ) : (
              companyLogs.map((log) => {
                const isIn = log.action === 'in';
                const item = inventoryMap.get(log.item_id);
                return (
                  <div key={log.id} className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-semibold">{item?.name ?? `품목#${log.item_id}`}</p>
                        <p className="mt-1 text-xs text-neutral-500">{formatDateTime(log.created_at)}</p>
                        {(log.user_name || log.user_email) && (
                          <p className="mt-1 truncate text-xs text-neutral-500">작성: {log.user_name || log.user_email}</p>
                        )}
                        {log.note && <p className="mt-1 text-xs text-blue-600">{log.note}</p>}
                      </div>
                      <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold shrink-0', isIn ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600')}>
                        {isIn ? '입고' : '출고'}
                      </span>
                    </div>
                    <div className="mt-3">
                      <p className="text-xs text-neutral-400">수량</p>
                      <p className="mt-1 text-2xl font-bold tracking-tight">
                        {Number(log.qty).toLocaleString()}
                        <span className="ml-1 text-base font-medium text-neutral-500">{item?.unit ?? ''}</span>
                      </p>
                    </div>
                    <button
                      onClick={() => void handleDeleteLog(log)}
                      disabled={deletingLogId === log.id}
                      className="mt-3 w-full rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 disabled:opacity-50"
                    >
                      {deletingLogId === log.id ? '삭제중' : '로그 삭제 + 재고복구'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 거래처 관리 */}
      {view === 'manage' && (
        <div className="space-y-4">
          {/* 추가 폼 */}
          <div className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="mb-3 text-sm font-semibold">거래처 추가</p>
            <div className="space-y-2">
              <input
                value={newCompanyName}
                onChange={(e) => setNewCompanyName(e.target.value)}
                placeholder="회사명"
                className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
              />
              <input
                value={newCompanyMemo}
                onChange={(e) => setNewCompanyMemo(e.target.value)}
                placeholder="메모 (선택)"
                className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
              />
              <button
                onClick={() => void handleAddCompany()}
                disabled={savingCompany}
                className="w-full rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {savingCompany ? '추가중' : '거래처 추가'}
              </button>
            </div>
          </div>

          {/* 목록 */}
          <div className="space-y-3">
            {companies.map((company) => (
              <div key={company.id} className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
                {editingCompanyId === company.id ? (
                  <div className="space-y-2">
                    <input
                      value={editingCompanyName}
                      onChange={(e) => setEditingCompanyName(e.target.value)}
                      className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
                    />
                    <input
                      value={editingCompanyMemo}
                      onChange={(e) => setEditingCompanyMemo(e.target.value)}
                      placeholder="메모 (선택)"
                      className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-400"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => void handleUpdateCompany(company.id)}
                        disabled={savingCompany}
                        className="rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        저장
                      </button>
                      <button
                        onClick={() => setEditingCompanyId(null)}
                        className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold text-neutral-700"
                      >
                        취소
                      </button>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => void handleDeleteCompany(company.id)}
                        disabled={deletingCompanyId === company.id}
                        className="w-full rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 disabled:opacity-50"
                      >
                        {deletingCompanyId === company.id ? '삭제중' : '거래처 삭제'}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{company.is_favorite ? '⭐' : '☆'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{company.name}</p>
                      {company.memo && <p className="text-xs text-neutral-400 truncate">{company.memo}</p>}
                    </div>
                    <button
                      onClick={() => {
                        setEditingCompanyId(company.id);
                        setEditingCompanyName(company.name);
                        setEditingCompanyMemo(company.memo ?? '');
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
