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
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  function scrollToBottom() {
    setTimeout(() => { chatBottomRef.current?.scrollIntoView({ behavior: 'auto' }); }, 80);
  }

  useEffect(() => { scrollToBottom(); }, [messages.length]);

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
      content,
      message_type: messageType,
      user_id: currentUserId,
      user_email: currentUserEmail,
      user_name: currentUserName,
    });
    if (error) throw error;
  }

  async function saveUserMessage(content: string, type: MessageRow['message_type'] = 'chat') {
    const temp = createTempMessage(content, type);
    setMessages((prev) => [...prev, temp]);
    setTimeout(scrollToBottom, 10);
    try {
      await insertMessage(content, type);
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
    try {
      setSending(true);
      setErrorText('');
      await saveUserMessage(trimmed, 'chat');
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

  return (
    <div className="flex flex-col h-full">
      {errorText && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{errorText}</div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-4 pb-[180px]">
        <div className="mb-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3">
          <p className="text-sm font-semibold">빠른 사용법</p>
          <p className="mt-1 text-xs leading-5 text-neutral-500">⚡ 버튼 또는 / 입력으로 빠른입력 열기</p>
        </div>

        <div className="space-y-3">
          {messages.map((message) => {
            const isUser = message.message_type === 'chat' || message.message_type === 'command';
            const isCommand = message.message_type === 'command';
            return (
              <div key={message.id} className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
                <div className="max-w-[84%]">
                  <div className={cn(
                    'rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm',
                    isUser && !isCommand && 'rounded-br-md bg-neutral-900 text-white',
                    isCommand && 'rounded-br-md border border-blue-200 bg-blue-50 text-blue-900',
                    !isUser && 'rounded-bl-md border border-neutral-200 bg-white text-neutral-800',
                  )}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className={cn('text-[11px] font-semibold uppercase tracking-wide', !isUser ? 'text-neutral-400' : isCommand ? 'text-blue-500' : 'text-neutral-300')}>
                        {!isUser ? 'system' : isCommand ? 'command' : 'chat'}
                      </p>
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
              value={input}
              onChange={(e) => { const v = e.target.value; setInput(v); if (v.trim() === '/') { setInput(''); onOpenQuickPanel(); } }}
              placeholder="메시지 입력 또는 ⚡로 빠른입력"
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
    </div>
  );
}
