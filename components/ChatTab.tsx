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
type Thread = { root: MessageRow; replies: MessageRow[] };

type NotifModal = {
  open: boolean;
  messageId: number | null;
  tab: 'dday' | 'repeat';
  targetDate: string;
  alertDays: number[];
  repeatType: 'daily' | 'weekly' | 'monthly';
  repeatTime: string;
  repeatDayOfWeek: number;
  repeatDayOfMonth: number;
  saving: boolean;
  existingId: number | null;
};

const EMPTY_NOTIF: NotifModal = {
  open: false,
  messageId: null,
  tab: 'dday',
  targetDate: '',
  alertDays: [7, 1, 0],
  repeatType: 'daily',
  repeatTime: '09',
  repeatDayOfWeek: 1,
  repeatDayOfMonth: 1,
  saving: false,
  existingId: null,
};

function buildThreads(messages: MessageRow[]): Thread[] {
  const replyMap = new Map<number, MessageRow[]>();
  messages.forEach((m) => {
    if (m.parent_id != null) {
      const arr = replyMap.get(m.parent_id) ?? [];
      replyMap.set(m.parent_id, [...arr, m]);
    }
  });
  return messages
    .filter((m) => m.parent_id == null)
    .map((root) => ({
      root,
      replies: (replyMap.get(root.id) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    }));
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
  const [showImportantOnly, setShowImportantOnly] = useState(false);
  const [notifModal, setNotifModal] = useState<NotifModal>(EMPTY_NOTIF);
  const [notifMessageIds, setNotifMessageIds] = useState<Set<number>>(new Set());
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messageRefs = useRef<(HTMLDivElement | null)[]>([]);

  function scrollToBottom() {
    setTimeout(() => { chatBottomRef.current?.scrollIntoView({ behavior: 'auto' }); }, 80);
  }

  useEffect(() => { scrollToBottom(); }, [messages.length]);

  useEffect(() => {
    supabase.from('chat_notifications').select('chat_id').eq('is_active', true).then(({ data }) => {
      if (data) setNotifMessageIds(new Set(data.map((r: { chat_id: number }) => r.chat_id)));
    });
  }, []);

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

  async function insertMessage(content: string, messageType: MessageRow['message_type'], parentId?: number | null): Promise<MessageRow> {
    const { data, error } = await supabase.from('messages').insert({
      content,
      message_type: messageType,
      source: 'user',
      user_id: currentUserId,
      user_email: currentUserEmail,
      user_name: currentUserName,
      parent_id: parentId ?? null,
    }).select('id, content, message_type, source, created_at, user_id, user_email, user_name, is_important, parent_id').single();
    if (error) throw error;
    return data as MessageRow;
  }

  async function saveUserMessage(content: string, type: MessageRow['message_type'] = 'chat', parentId?: number | null) {
    const temp = createTempMessage(content, type, parentId);
    setMessages((prev) => [...prev, temp]);
    setTimeout(scrollToBottom, 10);
    try {
      const real = await insertMessage(content, type, parentId);
      setMessages((prev) => prev.map((m) => m.id === temp.id ? real : m));
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
    if (!window.confirm('채팅 기록을 모두 삭제할까요?\n(중요 표시 메시지는 삭제되지 않습니다)')) return;
    try {
      const { error } = await supabase.from('messages').delete().neq('id', 0).eq('is_important', false);
      if (error) throw error;
      setMessages((prev) => prev.filter((m) => !!m.is_important));
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

  const threads = buildThreads(messages);
  const displayedThreads = showImportantOnly
    ? threads.filter((t) => !!t.root.is_important || t.replies.some((r) => !!r.is_important))
    : threads;

  function handleSearchChange(q: string) {
    const indices: number[] = [];
    displayedThreads.forEach((thread, idx) => {
      const texts = [thread.root, ...thread.replies].map((m) => m.content.toLowerCase());
      if (q.trim() && texts.some((t) => t.includes(q.toLowerCase()))) indices.push(idx);
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
      let priceQuery = supabase.from('unit_prices').select('inventory_item_id, unit_price');
      if (companyId) priceQuery = priceQuery.eq('company_id', companyId);
      const { data: allPrices } = await priceQuery;
      const priceMap = new Map((allPrices ?? []).map((p: { inventory_item_id: number; unit_price: number }) => [p.inventory_item_id, p.unit_price]));

      let query = supabase.from('inventory_logs').select('item_id').not('item_id', 'is', null);
      if (companyId) query = query.eq('company_id', companyId);
      else query = query.eq('company_name', companyName);
      const { data: logData } = await query;
      let itemIds = [...new Set((logData ?? []).map((l: { item_id: number }) => l.item_id).filter(Boolean))];

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

  async function handleToggleImportant(message: MessageRow) {
    const newVal = !message.is_important;
    const { error } = await supabase.from('messages').update({ is_important: newVal }).eq('id', message.id);
    if (!error) {
      setMessages((prev) => prev.map((m) => m.id === message.id ? { ...m, is_important: newVal } : m));
    }
    setContextMenu(null);
  }

  async function handleDeleteMessage(message: MessageRow) {
    if (message.is_important) {
      alert('중요 표시된 메시지는 삭제할 수 없어.\n중요 해제 후 삭제해줘.');
      return;
    }
    if (!window.confirm('이 메시지를 삭제할까요?')) return;
    const { error } = await supabase.from('messages').delete().eq('id', message.id);
    if (!error) {
      setMessages((prev) => prev.filter((m) => m.id !== message.id && m.parent_id !== message.id));
    }
    setContextMenu(null);
  }

  function handleStartReply(message: MessageRow) {
    setReplyTo(message);
    setContextMenu(null);
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  async function handleOpenNotif(message: MessageRow) {
    setContextMenu(null);
    const { data } = await supabase
      .from('chat_notifications')
      .select('*')
      .eq('chat_id', message.id)
      .eq('is_active', true)
      .maybeSingle();
    if (data) {
      setNotifModal({
        open: true,
        messageId: message.id,
        tab: data.notification_type as 'dday' | 'repeat',
        targetDate: data.target_date ?? '',
        alertDays: data.alert_days ?? [7, 1, 0],
        repeatType: (data.repeat_type as 'daily' | 'weekly' | 'monthly') ?? 'daily',
        repeatTime: data.repeat_time?.substring(0, 2) ?? '09',
        repeatDayOfWeek: data.repeat_day_of_week ?? 1,
        repeatDayOfMonth: data.repeat_day_of_month ?? 1,
        saving: false,
        existingId: data.id,
      });
    } else {
      setNotifModal({ ...EMPTY_NOTIF, open: true, messageId: message.id });
    }
  }

  async function handleSaveNotif() {
    if (!notifModal.messageId) return;
    setNotifModal((p) => ({ ...p, saving: true }));
    try {
      if (notifModal.existingId) {
        await supabase.from('chat_notifications').update({ is_active: false }).eq('id', notifModal.existingId);
      }
      const payload = notifModal.tab === 'dday'
        ? {
            chat_id: notifModal.messageId,
            notification_type: 'dday' as const,
            target_date: notifModal.targetDate,
            alert_days: notifModal.alertDays,
            repeat_time: notifModal.repeatTime + ':00:00',
          }
        : {
            chat_id: notifModal.messageId,
            notification_type: 'repeat' as const,
            repeat_type: notifModal.repeatType,
            repeat_time: notifModal.repeatTime + ':00:00',
            repeat_day_of_week: notifModal.repeatType === 'weekly' ? notifModal.repeatDayOfWeek : null,
            repeat_day_of_month: notifModal.repeatType === 'monthly' ? notifModal.repeatDayOfMonth : null,
          };
      await supabase.from('chat_notifications').insert(payload);
      setNotifMessageIds((prev) => new Set([...prev, notifModal.messageId!]));
      setNotifModal(EMPTY_NOTIF);
    } catch {
      setNotifModal((p) => ({ ...p, saving: false }));
    }
  }

  async function handleDisableNotif() {
    if (!notifModal.existingId) return;
    await supabase.from('chat_notifications').update({ is_active: false }).eq('id', notifModal.existingId);
    setNotifMessageIds((prev) => { const s = new Set(prev); s.delete(notifModal.messageId!); return s; });
    setNotifModal(EMPTY_NOTIF);
  }

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
          {displayedThreads.map((thread, threadIdx) => {
            const { root, replies } = thread;
            const isUser = root.message_type === 'chat' || root.message_type === 'command';
            const isCommand = root.message_type === 'command';
            const isSystemSource = root.source === 'system';
            const isQuickInput = root.source === 'quick_input';
            const isImportant = !!root.is_important;
            const isSearchHit = search.open && search.query.trim() && search.resultIndices[search.currentIdx] === threadIdx;

            return (
              <div
                key={root.id}
                ref={(el) => { messageRefs.current[threadIdx] = el; }}
                className={cn('flex', isUser ? 'justify-end' : 'justify-start', isSearchHit && 'ring-2 ring-yellow-400 rounded-2xl')}
              >
                <div className="max-w-[84%]">
                  <div
                    className={cn(
                      'rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm select-none',
                      isUser && !isCommand && !isSystemSource && !isQuickInput && 'rounded-br-md bg-neutral-900 text-white',
                      isUser && !isCommand && isSystemSource && 'rounded-br-md border border-teal-200 bg-teal-50 text-teal-900',
                      isUser && !isCommand && isQuickInput && 'rounded-br-md border border-neutral-300 bg-neutral-100 text-neutral-700',
                      isCommand && 'rounded-br-md border border-blue-200 bg-blue-50 text-blue-900',
                      !isUser && 'rounded-bl-md border border-neutral-200 bg-white text-neutral-800',
                      isImportant && 'ring-2 ring-yellow-400',
                    )}
                    onMouseDown={() => startLongPress(root)}
                    onMouseUp={cancelLongPress}
                    onMouseLeave={cancelLongPress}
                    onTouchStart={() => startLongPress(root)}
                    onTouchEnd={cancelLongPress}
                    onTouchMove={cancelLongPress}
                    onContextMenu={(e) => { e.preventDefault(); setContextMenu({ message: root }); }}
                  >
                    {/* 헤더 */}
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <p className={cn('text-[11px] font-semibold uppercase tracking-wide', !isUser ? 'text-neutral-400' : isCommand ? 'text-blue-500' : 'text-neutral-300')}>
                          {!isUser ? 'system' : isCommand ? 'command' : 'chat'}
                        </p>
                        {isImportant && <span className="text-sm leading-none">⭐</span>}
                        {notifMessageIds.has(root.id) && <span className="text-sm leading-none">🔔</span>}
                      </div>
                      {(root.user_name || root.user_email) && (
                        <p className={cn('truncate text-[11px]', isUser ? 'text-neutral-300' : 'text-neutral-500')}>
                          {root.user_name || root.user_email}
                        </p>
                      )}
                    </div>

                    {/* 원글 내용 */}
                    {root.content.startsWith('https://') && root.content.includes('chat-images') ? (
                      <img src={root.content} alt="uploaded" className="max-w-full rounded-xl" />
                    ) : (
                      <p className="break-words whitespace-pre-wrap">
                        {search.open && search.query.trim() ? highlightText(root.content, search.query) : root.content}
                      </p>
                    )}

                    {/* 댓글 */}
                    {replies.length > 0 && (
                      <div className={cn('mt-2 space-y-2 border-t pt-2', isUser && !isQuickInput ? 'border-white/20' : 'border-neutral-100')}>
                        {replies.map((reply) => (
                          <div
                            key={reply.id}
                            className={cn('select-none', !!reply.is_important && 'ring-1 ring-yellow-400 rounded-xl px-1 py-0.5')}
                            onMouseDown={(e) => { e.stopPropagation(); startLongPress(reply); }}
                            onMouseUp={cancelLongPress}
                            onMouseLeave={cancelLongPress}
                            onTouchStart={(e) => { e.stopPropagation(); startLongPress(reply); }}
                            onTouchEnd={cancelLongPress}
                            onTouchMove={cancelLongPress}
                            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ message: reply }); }}
                          >
                            <p className={cn('text-[10px] mb-0.5 font-medium', isUser ? 'text-neutral-400' : 'text-neutral-400')}>
                              ↩ {reply.user_name || reply.user_email || ''}
                              {!!reply.is_important && ' ⭐'}
                            </p>
                            <p className={cn('break-words whitespace-pre-wrap text-sm', isUser && !isQuickInput ? 'text-neutral-100' : 'text-neutral-700')}>
                              {search.open && search.query.trim() ? highlightText(reply.content, search.query) : reply.content}
                            </p>
                            <p className={cn('mt-0.5 text-[10px]', isUser ? 'text-neutral-500' : 'text-neutral-400')}>
                              {formatChatDateTime(reply.created_at)}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <p className={cn('mt-1 px-1 text-[11px] text-neutral-400', isUser ? 'text-right' : 'text-left')}>
                    {formatChatDateTime(root.created_at)}
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

        {replyTo && (
          <div className="mb-2 flex items-center justify-between rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2">
            <p className="text-xs text-blue-700 truncate flex-1">
              ↩ <span className="font-semibold">{replyTo.user_name || replyTo.user_email || 'system'}</span>에 댓글: {replyTo.content.slice(0, 30)}{replyTo.content.length > 30 ? '…' : ''}
            </p>
            <button onClick={() => setReplyTo(null)} className="ml-2 text-blue-500 text-sm font-bold shrink-0">✕</button>
          </div>
        )}

        <div className="rounded-3xl border border-neutral-200 bg-white p-2 shadow-lg">
          <div className="flex items-end gap-1.5">
            <button
              onClick={() => setSearch((p) => p.open ? { open: false, query: '', resultIndices: [], currentIdx: 0 } : { ...p, open: true })}
              type="button"
              className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border text-base', search.open ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-neutral-50')}
              aria-label="검색"
            >
              🔍
            </button>
            <label className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-2xl border border-neutral-200 bg-neutral-50 text-base">
              <span>📷</span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImageUpload(f); e.target.value = ''; }} />
            </label>
            <button onClick={onOpenQuickPanel} type="button" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-neutral-200 bg-neutral-50 text-base" aria-label="빠른입력 열기">
              ⚡
            </button>
            <button
              onClick={() => { setShowImportantOnly((p) => !p); setSearch({ open: false, query: '', resultIndices: [], currentIdx: 0 }); }}
              type="button"
              className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border text-base', showImportantOnly ? 'border-yellow-400 bg-yellow-50 text-yellow-500' : 'border-neutral-200 bg-neutral-50 text-neutral-400')}
              aria-label="중요 모아보기"
            >
              ★
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
            <button onClick={() => void handleSend()} disabled={sending} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-neutral-900 text-xs font-semibold text-white disabled:opacity-50">
              {sending ? '…' : '전송'}
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

      {/* 컨텍스트 메뉴 */}
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
              {!contextMenu.message.parent_id && (
                <button
                  onClick={() => handleStartReply(contextMenu.message)}
                  className="w-full rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
                  ↩ 댓글 달기
                </button>
              )}
              {!contextMenu.message.parent_id && (
                <button
                  onClick={() => void handleOpenNotif(contextMenu.message)}
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold text-neutral-700">
                  🔔 알림 설정
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
      {/* 알림 설정 모달 */}
      {notifModal.open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setNotifModal(EMPTY_NOTIF)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-10 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-base font-bold">🔔 알림 설정</p>
              <button onClick={() => setNotifModal(EMPTY_NOTIF)} className="rounded-full border border-neutral-200 px-3 py-1 text-xs">닫기</button>
            </div>

            {/* 탭 */}
            <div className="mb-4 flex gap-2">
              {(['dday', 'repeat'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setNotifModal((p) => ({ ...p, tab: t }))}
                  className={cn(
                    'flex-1 rounded-xl py-2 text-sm font-semibold',
                    notifModal.tab === t ? 'bg-neutral-900 text-white' : 'border border-neutral-200 text-neutral-500'
                  )}
                >
                  {t === 'dday' ? 'D-day 알림' : '반복 알림'}
                </button>
              ))}
            </div>

            {notifModal.tab === 'dday' ? (
              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-xs text-neutral-500">기준 날짜</p>
                  <input
                    type="date"
                    value={notifModal.targetDate}
                    onChange={(e) => setNotifModal((p) => ({ ...p, targetDate: e.target.value }))}
                    className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
                  />
                </div>
                <div>
                  <p className="mb-2 text-xs text-neutral-500">알림 시점 (복수 선택)</p>
                  <div className="flex gap-2 flex-wrap">
                    {[7, 3, 1, 0].map((d) => (
                      <label key={d} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={notifModal.alertDays.includes(d)}
                          onChange={(e) => setNotifModal((p) => ({
                            ...p,
                            alertDays: e.target.checked
                              ? [...p.alertDays, d]
                              : p.alertDays.filter((x) => x !== d),
                          }))}
                          className="rounded"
                        />
                        <span className="text-sm">{d === 0 ? '당일' : `D-${d}`}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs text-neutral-500">알림 시간 (KST)</p>
                  <select
                    value={notifModal.repeatTime}
                    onChange={(e) => setNotifModal((p) => ({ ...p, repeatTime: e.target.value }))}
                    className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={String(h).padStart(2, '0')}>{String(h).padStart(2, '0')}시</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="mb-2 text-xs text-neutral-500">반복 주기</p>
                  <div className="space-y-1.5">
                    {(['daily', 'weekly', 'monthly'] as const).map((type) => (
                      <label key={type} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          checked={notifModal.repeatType === type}
                          onChange={() => setNotifModal((p) => ({ ...p, repeatType: type }))}
                        />
                        <span className="text-sm">
                          {type === 'daily' ? '매일' : type === 'weekly' ? '매주' : '매월'}
                        </span>
                        {type === 'weekly' && notifModal.repeatType === 'weekly' && (
                          <div className="flex gap-1 ml-1">
                            {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
                              <button
                                key={i}
                                onClick={() => setNotifModal((p) => ({ ...p, repeatDayOfWeek: i }))}
                                className={cn('w-7 h-7 rounded-full text-xs font-semibold', notifModal.repeatDayOfWeek === i ? 'bg-neutral-900 text-white' : 'border border-neutral-200 text-neutral-600')}
                              >
                                {d}
                              </button>
                            ))}
                          </div>
                        )}
                        {type === 'monthly' && notifModal.repeatType === 'monthly' && (
                          <input
                            type="number"
                            min={1}
                            max={31}
                            value={notifModal.repeatDayOfMonth}
                            onChange={(e) => setNotifModal((p) => ({ ...p, repeatDayOfMonth: Number(e.target.value) }))}
                            className="ml-1 w-16 rounded-lg border border-neutral-200 px-2 py-1 text-sm outline-none"
                          />
                        )}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs text-neutral-500">알림 시간 (KST)</p>
                  <select
                    value={notifModal.repeatTime}
                    onChange={(e) => setNotifModal((p) => ({ ...p, repeatTime: e.target.value }))}
                    className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={String(h).padStart(2, '0')}>{String(h).padStart(2, '0')}시</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="mt-4 space-y-2">
              <button
                onClick={() => void handleSaveNotif()}
                disabled={notifModal.saving}
                className="w-full rounded-2xl bg-neutral-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
              >
                {notifModal.saving ? '저장중' : '저장'}
              </button>
              {notifModal.existingId && (
                <button
                  onClick={() => void handleDisableNotif()}
                  className="w-full rounded-2xl border border-neutral-200 py-3 text-sm font-medium text-neutral-500"
                >
                  알림 끄기
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
