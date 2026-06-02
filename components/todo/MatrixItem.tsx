'use client';

import { supabase } from '../../lib/supabase/client';
import { TodoMatrixItem } from '../../lib/types';

type Props = {
  item: TodoMatrixItem;
  scheduleTitle?: string;
  onToggleComplete: () => Promise<void>;
  onDelete: () => Promise<void>;
};

export default function MatrixItem({ item, scheduleTitle, onToggleComplete, onDelete }: Props) {
  async function toggle() {
    await supabase.from('todo_matrix_items').update({ is_completed: !item.is_completed }).eq('id', item.id);
    await onToggleComplete();
  }

  async function handleDelete() {
    if (!window.confirm('삭제할까요?')) return;
    await supabase.from('todo_matrix_items').delete().eq('id', item.id);
    await onDelete();
  }

  return (
    <div className="rounded-xl bg-white/80 border border-neutral-100 px-2 py-1.5">
      <div className="flex items-start gap-1.5">
        <input
          type="checkbox"
          checked={item.is_completed}
          onChange={() => void toggle()}
          className="mt-0.5 h-3 w-3 shrink-0 cursor-pointer"
        />
        <div className="flex-1 min-w-0">
          <p className={`text-[11px] leading-tight break-words ${item.is_completed ? 'line-through text-neutral-400' : 'text-neutral-800'}`}>
            {item.title}
          </p>
          {item.estimated_minutes != null && (
            <p className="text-[9px] text-neutral-400 mt-0.5">{item.estimated_minutes}분</p>
          )}
          {item.memo && (
            <p className="text-[9px] text-neutral-400 mt-0.5">{item.memo}</p>
          )}
          {scheduleTitle && (
            <p className="text-[9px] text-blue-400 mt-0.5">📋 {scheduleTitle}</p>
          )}
        </div>
        <button
          onClick={() => void handleDelete()}
          className="shrink-0 text-[11px] text-neutral-300 hover:text-red-400 leading-none"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
