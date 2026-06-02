'use client';

import { TodoMatrixItem, TodoSchedule } from '../../lib/types';
import { cn } from '../../lib/utils';

type Props = {
  year: number;
  month: number;
  schedules: TodoSchedule[];
  matrixItems: Pick<TodoMatrixItem, 'id' | 'date' | 'quadrant' | 'is_completed'>[];
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
};

const MONTH_NAMES = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
const DOW_LABELS = ['일','월','화','수','목','금','토'];

const SCHEDULE_COLORS: Record<string, string> = {
  yellow: 'rgba(253, 224, 71, 0.55)',
  green:  'rgba(134, 239, 172, 0.55)',
  blue:   'rgba(147, 197, 253, 0.55)',
  pink:   'rgba(249, 168, 212, 0.55)',
};

const QUADRANT_COLORS: Record<string, string> = {
  urgent_important:         '#ef4444',
  urgent_not_important:     '#f97316',
  not_urgent_important:     '#3b82f6',
  not_urgent_not_important: '#6b7280',
};

export default function TodoCalendar({
  year, month, schedules, matrixItems,
  selectedDate, onSelectDate, onPrevMonth, onNextMonth,
}: Props) {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const cells: Array<number | null> = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);

  function toDateKey(day: number) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Matrix dots per date: quadrant → Set
  const matrixDotMap = new Map<string, Set<string>>();
  for (const item of matrixItems) {
    const key = item.date.slice(0, 10);
    if (!matrixDotMap.has(key)) matrixDotMap.set(key, new Set());
    matrixDotMap.get(key)!.add(item.quadrant);
  }

  return (
    <div>
      {/* Month navigation */}
      <div className="mb-4 flex items-center justify-between">
        <button onClick={onPrevMonth} className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700">
          ← 이전
        </button>
        <p className="text-base font-bold">{year}년 {MONTH_NAMES[month]}</p>
        <button onClick={onNextMonth} className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700">
          다음 →
        </button>
      </div>

      {/* Calendar grid */}
      <div className="rounded-3xl border border-neutral-200 bg-white p-3 shadow-sm">
        {/* DOW headers */}
        <div className="grid grid-cols-7 mb-2">
          {DOW_LABELS.map((d, i) => (
            <p key={d} className={cn('text-center text-xs font-semibold py-1', i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-neutral-500')}>
              {d}
            </p>
          ))}
        </div>

        {/* Date cells */}
        <div className="grid grid-cols-7 gap-y-1">
          {cells.map((day, idx) => {
            if (day === null) return <div key={`empty-${idx}`} />;

            const key = toDateKey(day);
            const isToday = key === todayKey;
            const isSelected = key === selectedDate;
            const dow = (startDow + day - 1) % 7;

            // Schedules overlapping this date (max 3 displayed + overflow count)
            const allCellSchedules = schedules.filter((s) => s.start_date <= key && s.end_date >= key);
            const cellSchedules = allCellSchedules.slice(0, 3);
            const overflowCount = allCellSchedules.length - 3;

            const quadrants = matrixDotMap.get(key);

            return (
              <button
                key={key}
                onClick={() => onSelectDate(isSelected ? null : key)}
                className={cn(
                  'relative flex flex-col items-center rounded-2xl pt-2 pb-1.5 transition',
                  isSelected && 'bg-neutral-900',
                  !isSelected && isToday && 'border border-neutral-400',
                  !isSelected && !isToday && 'hover:bg-neutral-50',
                )}
              >
                {/* Date number */}
                <span className={cn(
                  'relative z-10 text-sm font-medium leading-none',
                  isSelected ? 'text-white' : dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-neutral-800',
                )}>
                  {day}
                </span>

                {/* Matrix dots */}
                <div className="relative z-10 flex gap-0.5 mt-0.5 min-h-[6px]">
                  {quadrants && Array.from(quadrants).map((q) => (
                    <span
                      key={q}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: isSelected ? 'white' : QUADRANT_COLORS[q] }}
                    />
                  ))}
                </div>

                {/* Highlighter schedule bars */}
                {!isSelected && cellSchedules.length > 0 && (
                  <div className="w-full flex flex-col gap-px mt-1">
                    {cellSchedules.map((s) => {
                      const isStart = key === s.start_date;
                      const isEnd = key === s.end_date;
                      const isSingle = isStart && isEnd;
                      return (
                        <div
                          key={s.id}
                          style={{
                            height: '3px',
                            marginLeft: isSingle ? '15%' : isStart ? '50%' : '0',
                            marginRight: isSingle ? '15%' : isEnd ? '50%' : '0',
                            backgroundColor: SCHEDULE_COLORS[s.color] ?? SCHEDULE_COLORS.yellow,
                            borderRadius: isSingle
                              ? '9999px'
                              : isStart
                              ? '9999px 0 0 9999px'
                              : isEnd
                              ? '0 9999px 9999px 0'
                              : '0',
                          }}
                        />
                      );
                    })}
                    {overflowCount > 0 && (
                      <p className="text-center text-[7px] text-neutral-400 leading-none mt-px">+{overflowCount}</p>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
