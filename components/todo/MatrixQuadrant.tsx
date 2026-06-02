'use client';

import { useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { TodoMatrixItem, TodoSchedule } from '../../lib/types';
import MatrixItem from './MatrixItem';
import ScheduleTaskPicker from './ScheduleTaskPicker';

type Quadrant = 'urgent_important' | 'urgent_not_important' | 'not_urgent_important' | 'not_urgent_not_important';

type Props = {
  date: string;
  quadrant: Quadrant;
  label: string;
  sub: string;
  colorClass: string;
  items: TodoMatrixItem[];
  dateSchedules: TodoSchedule[];
  onItemsChange: () => Promise<void>;
};

type AddForm = { title: string; minutes: string; memo: string };

export default function MatrixQuadrant({ date, quadrant, label, sub, colorClass, items, dateSchedules, onItemsChange }: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<AddForm>({ title: '', minutes: '', memo: '' });
  const [saving, setSaving] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const taskScheduleMap = new Map<number, string>();
  for (const s of dateSchedules) {
    for (const t of s.todo_schedule_tasks ?? []) {
      taskScheduleMap.set(t.id, s.title);
    }
  }

  async function handleAdd() {
    if (!form.title.trim()) return;
    setSaving(true);
    await supabase.from('todo_matrix_items').insert({
      date,
      quadrant,
      title: form.title.trim(),
      estimated_minutes: form.minutes ? Number(form.minutes) : null,
      memo: form.memo.trim() || null,
      is_completed: false,
    });
    setSaving(false);
    setForm({ title: '', minutes: '', memo: '' });
    setFormOpen(false);
    await onItemsChange();
  }

  return (
    <div className={`rounded-2xl border ${colorClass} p-2.5 flex flex-col gap-1.5 min-h-[130px]`}>
      <div className="mb-0.5">
        <p className="text-[10px] font-bold leading-tight">{label}</p>
        <p className="text-[9px] text-neutral-500">{sub}</p>
      </div>

      {items.map((item) => (
        <MatrixItem
          key={item.id}
          item={item}
          scheduleTitle={item.schedule_task_id != null ? taskScheduleMap.get(item.schedule_task_id) : undefined}
          onToggleComplete={onItemsChange}
          onDelete={onItemsChange}
        />
      ))}

      {formOpen ? (
        <div className="flex flex-col gap-1 mt-1">
          <input
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            placeholder="할일 내용"
            autoFocus
            className="w-full rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[11px] outline-none focus:border-neutral-400"
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(); }}
          />
          <input
            type="number"
            value={form.minutes}
            onChange={(e) => setForm((p) => ({ ...p, minutes: e.target.value }))}
            placeholder="예상 분 (선택)"
            className="w-full rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[11px] outline-none focus:border-neutral-400"
          />
          <div className="flex gap-1">
            <button
              onClick={() => void handleAdd()}
              disabled={saving || !form.title.trim()}
              className="flex-1 rounded-lg bg-neutral-900 py-1 text-[10px] font-semibold text-white disabled:opacity-40"
            >
              {saving ? '...' : '추가'}
            </button>
            <button
              onClick={() => { setFormOpen(false); setForm({ title: '', minutes: '', memo: '' }); }}
              className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[10px] text-neutral-500"
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-1 mt-auto pt-1">
          <button
            onClick={() => setFormOpen(true)}
            className="flex-1 rounded-lg border border-neutral-200 bg-white/80 py-1 text-[10px] font-medium text-neutral-600 hover:bg-white"
          >
            + 추가
          </button>
          {dateSchedules.length > 0 && (
            <button
              onClick={() => setShowPicker((p) => !p)}
              className="rounded-lg border border-neutral-200 bg-white/80 px-1.5 py-1 text-[10px] font-medium text-neutral-600 hover:bg-white"
              title="기간 스케줄에서 가져오기"
            >
              📋
            </button>
          )}
        </div>
      )}

      {showPicker && (
        <ScheduleTaskPicker
          date={date}
          quadrant={quadrant}
          dateSchedules={dateSchedules}
          onPick={async () => {
            setShowPicker(false);
            await onItemsChange();
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
