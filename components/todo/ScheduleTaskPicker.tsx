'use client';

import { supabase } from '../../lib/supabase/client';
import { TodoSchedule } from '../../lib/types';

type Quadrant = 'urgent_important' | 'urgent_not_important' | 'not_urgent_important' | 'not_urgent_not_important';

type Props = {
  date: string;
  quadrant: Quadrant;
  dateSchedules: TodoSchedule[];
  onPick: () => Promise<void>;
  onClose: () => void;
};

export default function ScheduleTaskPicker({ date, quadrant, dateSchedules, onPick, onClose }: Props) {
  async function handlePick(taskId: number, scheduleId: number, taskTitle: string) {
    void scheduleId;
    await supabase.from('todo_matrix_items').insert({
      date,
      quadrant,
      title: taskTitle,
      is_completed: false,
      schedule_task_id: taskId,
    });
    await onPick();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl bg-white pb-10 flex flex-col"
        style={{ maxHeight: '70vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 shrink-0">
          <p className="text-sm font-bold">기간 스케줄에서 가져오기</p>
          <button onClick={onClose} className="rounded-full border border-neutral-200 px-3 py-1 text-xs">닫기</button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {dateSchedules.map((s) => (
            <div key={s.id}>
              <p className="text-xs font-semibold text-neutral-500 mb-1.5">{s.title}</p>
              {(s.todo_schedule_tasks ?? []).length === 0 && (
                <p className="text-xs text-neutral-300 ml-1">세부 할일 없음</p>
              )}
              {(s.todo_schedule_tasks ?? []).map((t) => (
                <button
                  key={t.id}
                  onClick={() => void handlePick(t.id, s.id, t.title)}
                  className="w-full text-left rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-700 hover:bg-neutral-100 mb-1 block"
                >
                  + {t.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
