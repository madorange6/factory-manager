'use client';

import { TodoSchedule } from '../../lib/types';
import { cn } from '../../lib/utils';

const COLOR_BG: Record<string, string> = {
  yellow: 'bg-yellow-300',
  green:  'bg-green-300',
  blue:   'bg-blue-300',
  pink:   'bg-pink-300',
};

type Props = {
  schedules: TodoSchedule[];
  onEdit: (s: TodoSchedule) => void;
  onDelete: (s: TodoSchedule) => void;
};

export default function ScheduleList({ schedules, onEdit, onDelete }: Props) {
  if (schedules.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-neutral-500">기간 스케줄</p>
      {schedules.map((s) => (
        <div key={s.id} className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-3 py-2.5 shadow-sm">
          <div className={cn('h-3 w-3 rounded-full shrink-0', COLOR_BG[s.color])} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{s.title}</p>
            <p className="text-xs text-neutral-400">{s.start_date} ~ {s.end_date}</p>
            {(s.todo_schedule_tasks?.length ?? 0) > 0 && (
              <p className="text-xs text-neutral-400">{s.todo_schedule_tasks!.length}개 할일</p>
            )}
          </div>
          <div className="flex gap-1 shrink-0">
            <button
              onClick={() => onEdit(s)}
              className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
            >
              수정
            </button>
            <button
              onClick={() => onDelete(s)}
              className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50"
            >
              삭제
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
