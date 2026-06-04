'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { TodoSchedule } from '../../lib/types';
import { cn } from '../../lib/utils';

const COLORS = ['yellow', 'green', 'blue', 'pink'] as const;

const COLOR_LABELS: Record<string, string> = {
  yellow: '노랑', green: '초록', blue: '파랑', pink: '핑크',
};
const COLOR_BG: Record<string, string> = {
  yellow: 'bg-yellow-300', green: 'bg-green-300', blue: 'bg-blue-300', pink: 'bg-pink-300',
};

type Props = {
  schedule: TodoSchedule | null;
  onSave: () => Promise<void>;
  onClose: () => void;
};

type TaskDraft = { id: string; title: string; is_completed: boolean };

export default function ScheduleModal({ schedule, onSave, onClose }: Props) {
  const [title, setTitle] = useState(schedule?.title ?? '');
  const [startDate, setStartDate] = useState(schedule?.start_date ?? '');
  const [endDate, setEndDate] = useState(schedule?.end_date ?? '');
  const [color, setColor] = useState<typeof COLORS[number]>(schedule?.color ?? 'yellow');
  const [tasks, setTasks] = useState<TaskDraft[]>(
    schedule?.todo_schedule_tasks?.map((t) => ({ id: String(t.id), title: t.title, is_completed: t.is_completed })) ?? []
  );
  const [saving, setSaving] = useState(false);
  const loadedIdsRef = useRef<number[]>(
    schedule?.todo_schedule_tasks?.map((t) => t.id) ?? []
  );

  useEffect(() => {
    if (!schedule) return;
    void supabase
      .from('todo_schedule_tasks')
      .select('id, title, is_completed')
      .eq('schedule_id', schedule.id)
      .order('created_at')
      .then(({ data }) => {
        if (data) {
          setTasks(data.map((t: { id: number; title: string; is_completed: boolean }) => ({ id: String(t.id), title: t.title, is_completed: t.is_completed })));
          loadedIdsRef.current = data.map((t: { id: number }) => t.id);
        }
      });
  }, [schedule?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function addTask() {
    setTasks((p) => [...p, { id: `new-${Date.now()}`, title: '', is_completed: false }]);
  }

  async function toggleTask(id: string, current: boolean) {
    setTasks((p) => p.map((t) => t.id === id ? { ...t, is_completed: !current } : t));
    if (!id.startsWith('new-')) {
      const numId = Number(id);
      await supabase.from('todo_schedule_tasks').update({ is_completed: !current }).eq('id', numId);
      await supabase.from('todo_matrix_items').update({ is_completed: !current }).eq('schedule_task_id', numId);
    }
  }

  function updateTask(id: string, val: string) {
    setTasks((p) => p.map((t) => t.id === id ? { ...t, title: val } : t));
  }

  function removeTask(id: string) {
    setTasks((p) => p.filter((t) => t.id !== id));
  }

  async function handleSave() {
    if (!title.trim() || !startDate || !endDate) return;
    setSaving(true);
    try {
      let scheduleId: number | undefined;

      if (schedule) {
        await supabase.from('todo_schedules').update({
          title: title.trim(), start_date: startDate, end_date: endDate, color,
        }).eq('id', schedule.id);
        scheduleId = schedule.id;

        // 기존 task 중 UI에서 제거된 것만 DELETE (ID 보존)
        const currentIds = tasks.filter((t) => !t.id.startsWith('new-')).map((t) => Number(t.id));
        const removedIds = loadedIdsRef.current.filter((id) => !currentIds.includes(id));
        for (const id of removedIds) {
          await supabase.from('todo_schedule_tasks').delete().eq('id', id);
        }

        // 기존 task 제목만 UPDATE (is_completed·ID 유지)
        for (const t of tasks.filter((t) => !t.id.startsWith('new-') && t.title.trim())) {
          await supabase.from('todo_schedule_tasks').update({ title: t.title.trim() }).eq('id', Number(t.id));
        }
      } else {
        const { data } = await supabase.from('todo_schedules').insert({
          title: title.trim(), start_date: startDate, end_date: endDate, color,
        }).select('id').single();
        scheduleId = (data as { id: number } | null)?.id;
      }

      // 새로 추가된 task INSERT
      if (scheduleId) {
        const newTasks = tasks.filter((t) => t.id.startsWith('new-') && t.title.trim());
        if (newTasks.length > 0) {
          await supabase.from('todo_schedule_tasks').insert(
            newTasks.map((t) => ({ schedule_id: scheduleId!, title: t.title.trim(), is_completed: t.is_completed }))
          );
        }
      }

      await onSave();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-10 overflow-y-auto"
        style={{ maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-base font-bold">{schedule ? '스케줄 수정' : '기간 스케줄 추가'}</p>
          <button onClick={onClose} className="rounded-full border border-neutral-200 px-3 py-1 text-xs">닫기</button>
        </div>

        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs text-neutral-500">제목 *</p>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="스케줄 제목"
              className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm outline-none focus:border-neutral-400"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="mb-1 text-xs text-neutral-500">시작일 *</p>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm outline-none focus:border-neutral-400"
              />
            </div>
            <div>
              <p className="mb-1 text-xs text-neutral-500">종료일 *</p>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm outline-none focus:border-neutral-400"
              />
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs text-neutral-500">색상 *</p>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    'flex-1 rounded-2xl py-2 text-xs font-semibold border-2',
                    color === c ? 'border-neutral-900' : 'border-transparent',
                    COLOR_BG[c],
                  )}
                >
                  {COLOR_LABELS[c]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs text-neutral-500">세부 할일</p>
              <button onClick={addTask} className="text-xs text-neutral-600 underline">+ 추가</button>
            </div>
            {tasks.map((t) => (
              <div key={t.id} className="flex items-center gap-2 mb-1.5">
                <input
                  type="checkbox"
                  checked={t.is_completed}
                  onChange={() => void toggleTask(t.id, t.is_completed)}
                  className="h-4 w-4 shrink-0 cursor-pointer"
                />
                <input
                  value={t.title}
                  onChange={(e) => updateTask(t.id, e.target.value)}
                  placeholder="할일 내용"
                  className={`flex-1 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-neutral-400 ${t.is_completed ? 'line-through text-neutral-400' : ''}`}
                />
                <button
                  onClick={() => removeTask(t.id)}
                  className="rounded-xl border border-neutral-200 px-2.5 py-2 text-neutral-400 hover:text-red-500"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={() => void handleSave()}
            disabled={saving || !title.trim() || !startDate || !endDate}
            className="w-full rounded-2xl bg-neutral-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {saving ? '저장중' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
