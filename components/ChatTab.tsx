'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { MessageRow } from '../lib/types';
import { cn, formatChatDateTime, getErrorMessage } from '../lib/utils';

const ADMIN_EMAIL = 'sj_advisory@naver.com';

type Props = {
  messages: MessageRow[];
  setMessages: React.Dispatch<React.SetStateAction<MessageRow[]>>;
  currentUserId: string | null;
  currentUserEmail: string | null;
  currentUserName: string | null;
  onOpenQuickPanel: () => void;
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
}: Props) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

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
          <p className="mt-0.5 text-xs leading-5 text-neutral-400">메시지 길게 누르기 → 중요 표시 / 댓글</p>
        </div>

        <div className="space-y-3">
          {organized.map((message) => {
            const isReply = !!message.parent_id;
            const isUser = message.message_type === 'chat' || message.message_type === 'command';
            const isCommand = message.message_type === 'command';
            const isImportant = !!message.is_important;

            return (
              <div
                key={message.id}
                className={cn('flex', isUser ? 'justify-end' : 'justify-start', isReply && 'pl-6')}
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
                    isUser && !isCommand && 'rounded-br-md bg-neutral-900 text-white',
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
                      <p className="break-words whitespace-pre-wrap">{message.content}</p>
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
        {currentUserEmail === ADMIN_EMAIL && (
          <div className="mb-2 flex justify-end">
            <button onClick={() => void handleClearMessages()} className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
              채팅 초기화
            </button>
          </div>
        )}

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
              onChange={(e) => { const v = e.target.value; setInput(v); if (v.trim() === '/') { setInput(''); onOpenQuickPanel(); } }}
              placeholder={replyTo ? '댓글 입력…' : '메시지 입력 또는 ⚡로 빠른입력'}
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
