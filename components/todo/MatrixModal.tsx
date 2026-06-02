'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { TodoMatrixItem, TodoSchedule } from '../../lib/types';
import MatrixQuadrant from './MatrixQuadrant';
import MatrixItemPopup from './MatrixItemPopup';

type Quadrant = 'urgent_important' | 'urgent_not_important' | 'not_urgent_important' | 'not_urgent_not_important';

const QUADRANTS: { key: Quadrant; label: string; sub: string; colorClass: string; emoji: string }[] = [
  { key: 'urgent_important', label: '🔴 긴급 + 중요', sub: 'Do First', colorClass: 'border-red-200 bg-red-50', emoji: '🔴' },
  { key: 'urgent_not_important', label: '🟠 긴급 + 비중요', sub: 'Delegate', colorClass: 'border-orange-200 bg-orange-50', emoji: '🟠' },
  { key: 'not_urgent_important', label: '🔵 비긴급 + 중요', sub: 'Schedule', colorClass: 'border-blue-200 bg-blue-50', emoji: '🔵' },
  { key: 'not_urgent_not_important', label: '⚫ 비긴급 + 비중요', sub: 'Eliminate', colorClass: 'border-neutral-200 bg-neutral-50', emoji: '⚫' },
];

type Props = {
  date: string;
  schedules: TodoSchedule[];
  onClose: () => void;
  onMatrixChange?: () => void;
};

export default function MatrixModal({ date, schedules, onClose, onMatrixChange }: Props) {
  const [items, setItems] = useState<TodoMatrixItem[]>([]);
  const [stagedTitles, setStagedTitles] = useState<string[]>([]);
  const [stagingInput, setStagingInput] = useState('');
  const [assigning, setAssigning] = useState<number | null>(null);
  const [popupItem, setPopupItem] = useState<TodoMatrixItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchItems = useCallback(async () => {
    const { data } = await supabase
      .from('todo_matrix_items')
      .select('*')
      .eq('date', date)
      .order('created_at');
    setItems((data ?? []) as TodoMatrixItem[]);
    onMatrixChange?.();
  }, [date, onMatrixChange]);

  useEffect(() => { void fetchItems(); }, [fetchItems]);

  const dateSchedules = schedules.filter((s) => s.start_date <= date && s.end_date >= date);

  function addToStaging() {
    const t = stagingInput.trim();
    if (!t) return;
    setStagedTitles((prev) => [...prev, t]);
    setStagingInput('');
    inputRef.current?.focus();
  }

  async function assignToQuadrant(idx: number, quadrant: Quadrant) {
    setAssigning(idx);
    await supabase.from('todo_matrix_items').insert({
      date,
      quadrant,
      title: stagedTitles[idx],
      is_completed: false,
    });
    setStagedTitles((prev) => prev.filter((_, i) => i !== idx));
    setAssigning(null);
    await fetchItems();
  }

  function removeStaged(idx: number) {
    setStagedTitles((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
        <div
          className="w-full max-w-md rounded-t-3xl bg-white pb-10 flex flex-col"
          style={{ maxHeight: '90vh' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 shrink-0">
            <p className="text-base font-bold">{date.replace(/-/g, '/')}</p>
            <button onClick={onClose} className="rounded-full border border-neutral-200 px-3 py-1 text-xs">닫기</button>
          </div>

          {/* 스테이징 영역 */}
          <div className="px-3 pt-3 pb-2 border-b border-neutral-100 shrink-0">
            <div className="flex gap-2 mb-2">
              <input
                ref={inputRef}
                value={stagingInput}
                onChange={(e) => setStagingInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addToStaging(); }}
                placeholder="할일 목록에 추가..."
                className="flex-1 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-neutral-400"
              />
              <button
                onClick={addToStaging}
                disabled={!stagingInput.trim()}
                className="rounded-xl bg-neutral-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                추가
              </button>
            </div>
            {stagedTitles.length > 0 && (
              <div className="space-y-1.5">
                {stagedTitles.map((title, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-2.5 py-1.5">
                    <p className="flex-1 text-sm text-neutral-800 truncate">{title}</p>
                    <div className="flex gap-1 shrink-0">
                      {QUADRANTS.map((q) => (
                        <button
                          key={q.key}
                          onClick={() => void assignToQuadrant(idx, q.key)}
                          disabled={assigning === idx}
                          className="text-base leading-none disabled:opacity-50"
                          title={q.label}
                        >
                          {q.emoji}
                        </button>
                      ))}
                      <button
                        onClick={() => removeStaged(idx)}
                        className="ml-1 text-xs text-neutral-300 hover:text-red-400 leading-none"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 p-3 overflow-y-auto flex-1">
            {QUADRANTS.map((q) => (
              <MatrixQuadrant
                key={q.key}
                date={date}
                quadrant={q.key}
                label={q.label}
                sub={q.sub}
                colorClass={q.colorClass}
                items={items.filter((i) => i.quadrant === q.key)}
                dateSchedules={dateSchedules}
                onItemsChange={fetchItems}
                onOpenPopup={setPopupItem}
              />
            ))}
          </div>
        </div>
      </div>

      {popupItem && (
        <MatrixItemPopup
          item={popupItem}
          onClose={() => setPopupItem(null)}
          onSave={fetchItems}
        />
      )}
    </>
  );
}
