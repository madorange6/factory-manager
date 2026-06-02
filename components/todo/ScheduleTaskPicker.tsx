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
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm mt-1.5 p-2.5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold text-neutral-600">기간 스케줄에서 가져오기</p>
        <button onClick={onClose} className="text-[10px] text-neutral-400 underline">닫기</button>
      </div>
      {dateSchedules.map((s) => (
        <div key={s.id} className="mb-2">
          <p className="text-[10px] font-medium text-neutral-500 mb-1">{s.title}</p>
          {(s.todo_schedule_tasks ?? []).length === 0 && (
            <p className="text-[10px] text-neutral-300 ml-1">세부 할일 없음</p>
          )}
          {(s.todo_schedule_tasks ?? []).map((t) => (
            <button
              key={t.id}
              onClick={() => void handlePick(t.id, s.id, t.title)}
              className="w-full text-left rounded-lg bg-neutral-50 px-2 py-1 text-[10px] text-neutral-700 hover:bg-neutral-100 mb-0.5 block"
            >
              + {t.title}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
