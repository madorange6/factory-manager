'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { Company, InventoryItem, MessageRow } from '../lib/types';
import { cn, formatChatDateTime, formatCurrency, getErrorMessage } from '../lib/utils';

const ADMIN_EMAIL = 'sj_advisory@naver.com';

type SearchState = {
  open: boolean;
  query: string;
  resultIndices: number[];
  currentIdx: number;
};

type DollarTrigger = {
  step: 'company' | 'prices';
  search: string;
  selectedCompanyId: number | null;
  selectedCompanyName: string;
  priceItems: Array<{ itemId: number; itemName: string; unitPrice: number | null }>;
  loadingPrices: boolean;
} | null;

type Props = {
  messages: MessageRow[];
  setMessages: React.Dispatch<React.SetStateAction<MessageRow[]>>;
  currentUserId: string | null;
  currentUserEmail: string | null;
  currentUserName: string | null;
  onOpenQuickPanel: () => void;
  companies: Company[];
  inventory: InventoryItem[];
};

type ContextMenu = { message: MessageRow } | null;

// 메시지 트리 구성: root → replies 순서로 평탄화
function organizeMessages(messages: MessageRow[]): MessageRow[] {
  const roots = messages.filter((m) => !m.parent_id);
  const replyMap = new Map<number, MessageRow[]>();
  messages.forEach((m) => {
    if (m.parent_id) {
      const existing = replyMap.get(m.parent_id) ?? [];
      replyMap.set(m.parent_id, [...existing, m]);
    }
  });
  const result: MessageRow[] = [];
  roots.forEach((root) => {
    result.push(root);
    const replies = (replyMap.get(root.id) ?? []).sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    );
    result.push(...replies);
  });
  return result;
}

export default function ChatTab({
  messages,
  setMessages,
  currentUserId,
  currentUserEmail,
  currentUserName,
  onOpenQuickPanel,
  companies,
}: Props) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const [dollarTrigger, setDollarTrigger] = useState<DollarTrigger>(null);
  const [search, setSearch] = useState<SearchState>({ open: false, query: '', resultIndices: [], currentIdx: 0 });
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messageRefs = useRef<(HTMLDivElement | null)[]>([]);

  function scrollToBottom() {
    setTimeout(() => { chatBottomRef.current?.scrollIntoView({ behavior: 'auto' }); }, 80);
  }

  useEffect(() => { scrollToBottom(); }, [messages.length]);

  function createTempMessage(content: string, messageType: MessageRow['message_type'], parentId?: number | null): MessageRow {
    return {
      id: -Date.now() - Math.floor(Math.random() * 1000),
      content,
      message_type: messageType,
      created_at: new Date().toISOString(),
      user_id: currentUserId,
      user_email: currentUserEmail,
      user_name: currentUserName,
      is_important: false,
      parent_id: parentId ?? null,
    };
  }

  async function insertMessage(content: string, messageType: MessageRow['message_type'], parentId?: number | null) {
    const { error } = await supabase.from('messages').insert({
      content,
      message_type: messageType,
      source: 'user',
      user_id: currentUserId,
      user_email: currentUserEmail,
      user_name: currentUserName,
      parent_id: parentId ?? null,
    });
    if (error) throw error;
  }

  async function saveUserMessage(content: string, type: MessageRow['message_type'] = 'chat', parentId?: number | null) {
    const temp = createTempMessage(content, type, parentId);
    setMessages((prev) => [...prev, temp]);
    setTimeout(scrollToBottom, 10);
    try {
      await insertMessage(content, type, parentId);
    } catch (error) {
      setMessages((prev) => prev.filter((m) => m.id !== temp.id));
      throw error;
    }
  }

  async function handleImageUpload(file: File) {
    if (!currentUserId) return;
    try {
      setSending(true);
      const ext = file.name.split('.').pop();
      const fileName = `${currentUserId}_${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('chat-images').upload(fileName, file);
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('chat-images').getPublicUrl(fileName);
      await saveUserMessage(data.publicUrl, 'chat');
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setSending(false);
    }
  }

  async function handleSend(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    if (trimmed === '/') { setInput(''); onOpenQuickPanel(); return; }
    setInput('');
    const parentId = replyTo?.id ?? null;
    setReplyTo(null);
    try {
      setSending(true);
      setErrorText('');
      await saveUserMessage(trimmed, 'chat', parentId);
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setSending(false);
    }
  }

  async function handleClearMessages() {
    if (!window.confirm('채팅 기록을 모두 삭제할까요?')) return;
    try {
      const { error } = await supabase.from('messages').delete().neq('id', 0);
      if (error) throw error;
      setMessages([]);
    } catch (error) {
      setErrorText(getErrorMessage(error));
    }
  }

  function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function highlightText(text: string, query: string): React.ReactNode {
    if (!query.trim()) return text;
    const parts = text.split(new RegExp(`(${escapeRegex(query)})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase()
        ? <mark key={i} className="rounded bg-yellow-200 text-neutral-900">{part}</mark>
        : part
    );
  }

  function handleSearchChange(q: string) {
    const indices: number[] = [];
    organized.forEach((msg, idx) => {
      if (q.trim() && msg.content.toLowerCase().includes(q.toLowerCase())) indices.push(idx);
    });
    setSearch({ open: true, query: q, resultIndices: indices, currentIdx: 0 });
    if (indices.length > 0) {
      setTimeout(() => messageRefs.current[indices[0]]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
  }

  function navigateSearch(dir: 1 | -1) {
    setSearch((prev) => {
      if (prev.resultIndices.length === 0) return prev;
      const next = (prev.currentIdx + dir + prev.resultIndices.length) % prev.resultIndices.length;
      setTimeout(() => messageRefs.current[prev.resultIndices[next]]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      return { ...prev, currentIdx: next };
    });
  }

  function closeSearch() {
    setSearch({ open: false, query: '', resultIndices: [], currentIdx: 0 });
  }

  async function openDollarCompany(companyId: number | null, companyName: string) {
    setDollarTrigger({ step: 'prices', search: '', selectedCompanyId: companyId, selectedCompanyName: companyName, priceItems: [], loadingPrices: true });
    try {
      // unit_prices 전체 로드
      const { data: allPrices } = await supabase.from('unit_prices').select('inventory_item_id, unit_price');
      const priceMap = new Map((allPrices ?? []).map((p: { inventory_item_id: number; unit_price: number }) => [p.inventory_item_id, p.unit_price]));

      // 거래처 연관 품목 (inventory_logs 기반)
      let query = supabase.from('inventory_logs').select('item_id').not('item_id', 'is', null);
      if (companyId) query = query.eq('company_id', companyId);
      else query = query.eq('company_name', companyName);
      const { data: logData } = await query;
      let itemIds = [...new Set((logData ?? []).map((l: { item_id: number }) => l.item_id).filter(Boolean))];

      // inventory_logs에 없으면 unit_prices 등록된 품목 전체로 fallback
      if (itemIds.length === 0) itemIds = [...priceMap.keys()];

      if (itemIds.length === 0) {
        setDollarTrigger((p) => p ? { ...p, loadingPrices: false, priceItems: [] } : null);
        return;
      }

      const { data: itemData } = await supabase.from('inventory_items').select('id, name').in('id', itemIds).order('name');
      const priceItems = (itemData ?? []).map((item: { id: number; name: string }) => ({
        itemId: item.id,
        itemName: item.name,
        unitPrice: priceMap.has(item.id) ? priceMap.get(item.id)! : null,
      }));
      setDollarTrigger((p) => p ? { ...p, loadingPrices: false, priceItems } : null);
    } catch {
      setDollarTrigger((p) => p ? { ...p, loadingPrices: false } : null);
    }
  }

  function selectPriceItem(companyName: string, itemName: string, unitPrice: number | null) {
    const text = unitPrice != null
      ? `${companyName} ${itemName} 단가: ${formatCurrency(unitPrice)}원`
      : `${companyName} ${itemName} 단가: 미등록`;
    setInput((prev) => prev + text);
    setDollarTrigger(null);
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  // 항목 5: 중요 표시 토글
  async function handleToggleImportant(message: MessageRow) {
    const newVal = !message.is_important;
    const { error } = await supabase.from('messages').update({ is_important: newVal }).eq('id', message.id);
    if (!error) {
      setMessages((prev) => prev.map((m) => m.id === message.id ? { ...m, is_important: newVal } : m));
    }
    setContextMenu(null);
  }

  // 항목 5: 메시지 삭제
  async function handleDeleteMessage(message: MessageRow) {
    if (!window.confirm('이 메시지를 삭제할까요?')) return;
    const { error } = await supabase.from('messages').delete().eq('id', message.id);
    if (!error) {
      setMessages((prev) => prev.filter((m) => m.id !== message.id));
    }
    setContextMenu(null);
  }

  // 항목 5: 댓글 달기 선택
  function handleStartReply(message: MessageRow) {
    setReplyTo(message);
    setContextMenu(null);
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  // 항목 5: 길게 누르기 시작
  function startLongPress(message: MessageRow) {
    longPressTimer.current = setTimeout(() => {
      setContextMenu({ message });
    }, 500);
  }

  function cancelLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  const organized = organizeMessages(messages);

  return (
    <div className="flex flex-col h-full">
      {errorText && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{errorText}</div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-4 pb-[180px]">

        <div className="mb-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3">
          <p className="text-sm font-semibold">빠른 사용법</p>
          <p className="mt-1 text-xs leading-5 text-neutral-500">⚡ 버튼 또는 / 입력으로 빠른입력 열기</p>
          <p className="mt-0.5 text-xs leading-5 text-neutral-500">$ 입력 → 거래처 단가 조회</p>
          <p className="mt-0.5 text-xs leading-5 text-neutral-400">메시지 길게 누르기 → 중요 표시 / 댓글</p>
        </div>

        <div className="space-y-3">
          {organized.map((message, msgIdx) => {
            const isReply = !!message.parent_id;
            const isUser = message.message_type === 'chat' || message.message_type === 'command';
            const isCommand = message.message_type === 'command';
            const isSystemSource = message.source === 'system';
            const isQuickInput = message.source === 'quick_input';
            const isImportant = !!message.is_important;

            const isSearchHit = search.open && search.query.trim() && search.resultIndices[search.currentIdx] === msgIdx;
            return (
              <div
                key={message.id}
                ref={(el) => { messageRefs.current[msgIdx] = el; }}
                className={cn('flex', isUser ? 'justify-end' : 'justify-start', isReply && 'pl-6', isSearchHit && 'ring-2 ring-yellow-400 rounded-2xl')}
                onMouseDown={() => startLongPress(message)}
                onMouseUp={cancelLongPress}
                onMouseLeave={cancelLongPress}
                onTouchStart={() => startLongPress(message)}
                onTouchEnd={cancelLongPress}
                onTouchMove={cancelLongPress}
                onContextMenu={(e) => { e.preventDefault(); setContextMenu({ message }); }}
              >
                <div className="max-w-[84%]">
                  {isReply && (
                    <p className={cn('mb-0.5 text-[10px] px-1', isUser ? 'text-right text-neutral-400' : 'text-neutral-400')}>↩ 댓글</p>
                  )}
                  <div className={cn(
                    'rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm select-none',
                    isUser && !isCommand && !isSystemSource && !isQuickInput && 'rounded-br-md bg-neutral-900 text-white',
                    isUser && !isCommand && isSystemSource && 'rounded-br-md border border-teal-200 bg-teal-50 text-teal-900',
                    isUser && !isCommand && isQuickInput && 'rounded-br-md border border-neutral-300 bg-neutral-100 text-neutral-700',
                    isCommand && 'rounded-br-md border border-blue-200 bg-blue-50 text-blue-900',
                    !isUser && 'rounded-bl-md border border-neutral-200 bg-white text-neutral-800',
                    isImportant && isUser && 'ring-2 ring-yellow-400',
                    isImportant && !isUser && 'ring-2 ring-yellow-400',
                  )}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <p className={cn('text-[11px] font-semibold uppercase tracking-wide', !isUser ? 'text-neutral-400' : isCommand ? 'text-blue-500' : 'text-neutral-300')}>
                          {!isUser ? 'system' : isCommand ? 'command' : 'chat'}
                        </p>
                        {isImportant && <span className="text-sm leading-none">⭐</span>}
                      </div>
                      {(message.user_name || message.user_email) && (
                        <p className={cn('truncate text-[11px]', isUser ? 'text-neutral-300' : 'text-neutral-500')}>
                          {message.user_name || message.user_email}
                        </p>
                      )}
                    </div>
                    {message.content.startsWith('https://') && message.content.includes('chat-images') ? (
                      <img src={message.content} alt="uploaded" className="max-w-full rounded-xl" />
                    ) : (
                      <p className="break-words whitespace-pre-wrap">{search.open && search.query.trim() ? highlightText(message.content, search.query) : message.content}</p>
                    )}
                  </div>
                  <p className={cn('mt-1 px-1 text-[11px] text-neutral-400', isUser ? 'text-right' : 'text-left')}>
                    {formatChatDateTime(message.created_at)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
        <div ref={chatBottomRef} />
      </div>

      <div className="fixed bottom-[72px] left-1/2 z-20 w-full max-w-md -translate-x-1/2 bg-gradient-to-t from-neutral-50 via-neutral-50 to-transparent px-3 pb-3 pt-4">
        {/* 검색바 */}
        {search.open && (
          <div className="mb-2 flex items-center gap-2 rounded-2xl border border-neutral-200 bg-white px-3 py-2 shadow-sm">
            <input
              autoFocus
              value={search.query}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="메시지 검색"
              className="flex-1 rounded-xl border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
            />
            {search.query.trim() && (
              <span className="shrink-0 text-xs text-neutral-500">
                {search.resultIndices.length > 0 ? `${search.currentIdx + 1}/${search.resultIndices.length}` : '없음'}
              </span>
            )}
            <button onClick={() => navigateSearch(-1)} className="shrink-0 rounded-lg border border-neutral-200 px-2 py-1 text-xs text-neutral-600">↑</button>
            <button onClick={() => navigateSearch(1)} className="shrink-0 rounded-lg border border-neutral-200 px-2 py-1 text-xs text-neutral-600">↓</button>
            <button onClick={closeSearch} className="shrink-0 text-sm font-bold text-neutral-400">✕</button>
          </div>
        )}
        <div className="mb-2 flex justify-end">
          <button
            onClick={() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white shadow-sm text-neutral-600"
            aria-label="최신 메시지로 이동"
          >
            ↓
          </button>
        </div>

        {/* 항목 5: 댓글 대상 표시 */}
        {replyTo && (
          <div className="mb-2 flex items-center justify-between rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2">
            <p className="text-xs text-blue-700 truncate flex-1">
              ↩ <span className="font-semibold">{replyTo.user_name || replyTo.user_email || 'system'}</span>에 댓글: {replyTo.content.slice(0, 30)}{replyTo.content.length > 30 ? '…' : ''}
            </p>
            <button onClick={() => setReplyTo(null)} className="ml-2 text-blue-500 text-sm font-bold shrink-0">✕</button>
          </div>
        )}

        <div className="rounded-3xl border border-neutral-200 bg-white p-2 shadow-lg">
          <div className="flex items-end gap-2">
            <button
              onClick={() => setSearch((p) => p.open ? { open: false, query: '', resultIndices: [], currentIdx: 0 } : { ...p, open: true })}
              type="button"
              className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border text-lg', search.open ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-neutral-50')}
              aria-label="검색"
            >
              🔍
            </button>
            <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-2xl border border-neutral-200 bg-neutral-50 text-lg">
              <span>📷</span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImageUpload(f); e.target.value = ''; }} />
            </label>
            <button onClick={onOpenQuickPanel} type="button" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-neutral-200 bg-neutral-50 text-lg" aria-label="빠른입력 열기">
              ⚡
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                const v = e.target.value; setInput(v);
                if (v.trim() === '/') { setInput(''); onOpenQuickPanel(); return; }
                if (v.trim() === '$') { setInput(''); setDollarTrigger({ step: 'company', search: '', selectedCompanyId: null, selectedCompanyName: '', priceItems: [], loadingPrices: false }); }
              }}
              placeholder={replyTo ? '댓글 입력…' : '메시지 입력'}
              rows={1}
              className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border-0 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-neutral-400"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
            />
            <button onClick={() => void handleSend()} disabled={sending} className="rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
              {sending ? '처리중' : '전송'}
            </button>
          </div>
        </div>
      </div>

      {/* $ 단가 조회 Bottom Sheet */}
      {dollarTrigger && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setDollarTrigger(null)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-10 max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {dollarTrigger.step === 'company' ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-base font-bold">$ 단가 조회 — 거래처 선택</p>
                  <button onClick={() => setDollarTrigger(null)} className="rounded-full border border-neutral-200 px-3 py-1 text-xs">닫기</button>
                </div>
                <input
                  autoFocus
                  placeholder="거래처 검색"
                  value={dollarTrigger.search}
                  onChange={(e) => setDollarTrigger((p) => p ? { ...p, search: e.target.value } : null)}
                  className="mb-3 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                />
                <div className="space-y-1">
                  {companies
                    .filter((c) => !dollarTrigger.search.trim() || c.name.includes(dollarTrigger.search.trim()))
                    .map((c) => (
                      <button
                        key={c.id}
                        onClick={() => void openDollarCompany(c.id, c.name)}
                        className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-left text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                      >
                        {c.name}
                      </button>
                    ))
                  }
                </div>
              </>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <button onClick={() => setDollarTrigger((p) => p ? { ...p, step: 'company', priceItems: [] } : null)} className="text-sm text-neutral-500">← 뒤로</button>
                  <p className="text-base font-bold">{dollarTrigger.selectedCompanyName}</p>
                  <button onClick={() => setDollarTrigger(null)} className="rounded-full border border-neutral-200 px-3 py-1 text-xs">닫기</button>
                </div>
                {dollarTrigger.loadingPrices ? (
                  <p className="py-6 text-center text-sm text-neutral-500">불러오는 중…</p>
                ) : dollarTrigger.priceItems.length === 0 ? (
                  <p className="py-6 text-center text-sm text-neutral-500">등록된 거래 품목이 없어.</p>
                ) : (
                  <div className="space-y-1">
                    {dollarTrigger.priceItems.map((item) => (
                      <button
                        key={item.itemId}
                        onClick={() => selectPriceItem(dollarTrigger.selectedCompanyName, item.itemName, item.unitPrice)}
                        className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-left hover:bg-neutral-50"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-neutral-800">{item.itemName}</span>
                          <span className={cn('text-sm font-semibold', item.unitPrice != null ? 'text-neutral-900' : 'text-neutral-400')}>
                            {item.unitPrice != null ? `${formatCurrency(item.unitPrice)}원` : '미등록'}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* 항목 5: 컨텍스트 메뉴 Bottom Sheet */}
      {contextMenu && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setContextMenu(null)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-10" onClick={(e) => e.stopPropagation()}>
            <p className="mb-1 text-xs text-neutral-400 truncate">
              {contextMenu.message.content.slice(0, 50)}{contextMenu.message.content.length > 50 ? '…' : ''}
            </p>
            <div className="mt-3 space-y-2">
              <button
                onClick={() => void handleToggleImportant(contextMenu.message)}
                className="w-full rounded-2xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm font-semibold text-yellow-800">
                {contextMenu.message.is_important ? '⭐ 중요 해제' : '⭐ 중요 표시'}
              </button>
              {/* 댓글 달기 — 루트 메시지에만 표시 */}
              {!contextMenu.message.parent_id && (
                <button
                  onClick={() => handleStartReply(contextMenu.message)}
                  className="w-full rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
                  ↩ 댓글 달기
                </button>
              )}
              <button
                onClick={() => void handleDeleteMessage(contextMenu.message)}
                className="w-full rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
                삭제
              </button>
              <button
                onClick={() => setContextMenu(null)}
                className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-500">
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
