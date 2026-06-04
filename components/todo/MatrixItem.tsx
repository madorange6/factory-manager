'use client';

import { useRef } from 'react';
import { supabase } from '../../lib/supabase/client';
import { TodoMatrixItem } from '../../lib/types';

type Props = {
  item: TodoMatrixItem;
  scheduleTitle?: string;
  onToggleComplete: () => Promise<void>;
  onDelete: () => Promise<void>;
  onOpenPopup: (item: TodoMatrixItem) => void;
};

export default function MatrixItem({ item, scheduleTitle, onToggleComplete, onDelete, onOpenPopup }: Props) {
  const lastTapRef = useRef(0);

  async function toggle() {
    await supabase.from('todo_matrix_items').update({ is_completed: !item.is_completed }).eq('id', item.id);
    if (item.schedule_task_id != null) {
      await supabase.from('todo_schedule_tasks').update({ is_completed: !item.is_completed }).eq('id', item.schedule_task_id);
    }
    await onToggleComplete();
  }

  async function handleDelete() {
    if (!window.confirm('삭제할까요?')) return;
    await supabase.from('todo_matrix_items').delete().eq('id', item.id);
    if (item.schedule_task_id != null) {
      if (window.confirm('연결된 스케줄 세부할일도 삭제할까요?')) {
        await supabase.from('todo_schedule_tasks').delete().eq('id', item.schedule_task_id);
      }
    }
    await onDelete();
  }

  function handleTap() {
    const now = Date.now();
    if (now - lastTapRef.current < 350) {
      onOpenPopup(item);
    }
    lastTapRef.current = now;
  }

  // 원본: 미뤄진 곳으로 밀린 흔적
  const isPostponedAway = item.is_postponed && item.postponed_to_date != null;
  // 새 항목: 어디선가 밀려온 것
  const isPostponedFrom = item.is_postponed && item.postponed_from_date != null;

  function formatDate(d: string) {
    const [, m, day] = d.split('-');
    return `${Number(m)}/${Number(day)}`;
  }

  return (
    <div
      className={`rounded-xl border px-2 py-1.5 cursor-pointer select-none ${
        isPostponedAway
          ? 'bg-neutral-100 border-neutral-200'
          : 'bg-white/80 border-neutral-100 active:bg-neutral-50'
      }`}
      onClick={handleTap}
      onDoubleClick={() => onOpenPopup(item)}
    >
      <div className="flex items-start gap-1.5">
        <input
          type="checkbox"
          checked={item.is_completed}
          onChange={(e) => { e.stopPropagation(); void toggle(); }}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer"
        />
        <div className="flex-1 min-w-0">
          <p className={`text-[13px] leading-tight break-words ${
            item.is_completed || isPostponedAway
              ? 'line-through text-neutral-400'
              : 'text-neutral-800'
          }`}>
            {item.title}
          </p>
          {item.estimated_minutes != null && (
            <p className="text-[11px] text-neutral-400 mt-0.5">{item.estimated_minutes}분</p>
          )}
          {item.memo && !isPostponedAway && (
            <p className="text-[11px] text-neutral-400 mt-0.5">{item.memo}</p>
          )}
          {scheduleTitle && (
            <p className="text-[11px] text-blue-400 mt-0.5">📋 {scheduleTitle}</p>
          )}
          {isPostponedAway && (
            <p className="text-[11px] text-orange-500 mt-0.5 font-medium">
              → {formatDate(item.postponed_to_date!)}로 밀림
            </p>
          )}
          {isPostponedFrom && (
            <p className="text-[11px] text-orange-500 mt-0.5 font-medium">
              ↩️ 밀림 · 원래 {formatDate(item.postponed_from_date!)}
            </p>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); void handleDelete(); }}
          className="shrink-0 text-[13px] text-neutral-300 hover:text-red-400 leading-none"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
