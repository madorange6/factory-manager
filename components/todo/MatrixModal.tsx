'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { TodoMatrixItem, TodoSchedule } from '../../lib/types';
import MatrixQuadrant from './MatrixQuadrant';

type Quadrant = 'urgent_important' | 'urgent_not_important' | 'not_urgent_important' | 'not_urgent_not_important';

const QUADRANTS: { key: Quadrant; label: string; sub: string; colorClass: string }[] = [
  { key: 'urgent_important', label: '🔴 긴급 + 중요', sub: 'Do First', colorClass: 'border-red-200 bg-red-50' },
  { key: 'urgent_not_important', label: '🟠 긴급 + 비중요', sub: 'Delegate', colorClass: 'border-orange-200 bg-orange-50' },
  { key: 'not_urgent_important', label: '🔵 비긴급 + 중요', sub: 'Schedule', colorClass: 'border-blue-200 bg-blue-50' },
  { key: 'not_urgent_not_important', label: '⚫ 비긴급 + 비중요', sub: 'Eliminate', colorClass: 'border-neutral-200 bg-neutral-50' },
];

type Props = {
  date: string;
  schedules: TodoSchedule[];
  onClose: () => void;
  onMatrixChange?: () => void;
};

export default function MatrixModal({ date, schedules, onClose, onMatrixChange }: Props) {
  const [items, setItems] = useState<TodoMatrixItem[]>([]);

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

  return (
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
            />
          ))}
        </div>
      </div>
    </div>
  );
}
