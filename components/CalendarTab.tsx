'use client';

import { useState } from 'react';
import { InventoryItem, InventoryLogRow } from '../lib/types';
import { cn, formatDateTime } from '../lib/utils';

type Props = {
  logs: InventoryLogRow[];
  inventory: InventoryItem[];
};

export default function CalendarTab({ logs, inventory }: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const inventoryMap = new Map(inventory.map((item) => [item.id, item]));

  // 해당 월의 날짜 계산
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay(); // 0=일
  const daysInMonth = lastDay.getDate();

  // 이 달에 입출고가 있는 날짜 Set (YYYY-MM-DD)
  const activeDates = new Set<string>();
  logs.forEach((log) => {
    const d = new Date(log.created_at);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      activeDates.add(key);
    }
  });

  function toDateKey(day: number) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setSelectedDate(null);
  }

  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setSelectedDate(null);
  }

  const selectedLogs = selectedDate
    ? logs
        .filter((log) => {
          const d = new Date(log.created_at);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          return key === selectedDate;
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    : [];

  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // 달력 셀 배열 생성 (앞에 빈 칸 포함)
  const cells: Array<number | null> = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);

  const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
  const MONTH_NAMES = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

  return (
    <div className="px-3 py-4">
      {/* 월 네비게이션 */}
      <div className="mb-4 flex items-center justify-between">
        <button onClick={prevMonth} className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700">
          ← 이전
        </button>
        <p className="text-base font-bold">{year}년 {MONTH_NAMES[month]}</p>
        <button onClick={nextMonth} className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700">
          다음 →
        </button>
      </div>

      {/* 달력 */}
      <div className="rounded-3xl border border-neutral-200 bg-white p-3 shadow-sm">
        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 mb-2">
          {DOW_LABELS.map((d, i) => (
            <p key={d} className={cn('text-center text-xs font-semibold py-1', i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-neutral-500')}>
              {d}
            </p>
          ))}
        </div>

        {/* 날짜 셀 */}
        <div className="grid grid-cols-7 gap-y-1">
          {cells.map((day, idx) => {
            if (day === null) return <div key={`empty-${idx}`} />;
            const key = toDateKey(day);
            const hasLogs = activeDates.has(key);
            const isToday = key === todayKey;
            const isSelected = key === selectedDate;
            const dow = (startDow + day - 1) % 7;

            return (
              <button
                key={key}
                onClick={() => setSelectedDate(isSelected ? null : key)}
                className={cn(
                  'flex flex-col items-center justify-center rounded-2xl py-2 transition',
                  isSelected && 'bg-neutral-900',
                  !isSelected && isToday && 'border border-neutral-400',
                  !isSelected && !isToday && 'hover:bg-neutral-50',
                )}
              >
                <span className={cn(
                  'text-sm font-medium',
                  isSelected ? 'text-white' : dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-neutral-800',
                )}>
                  {day}
                </span>
                {hasLogs && (
                  <span className={cn('mt-0.5 h-1.5 w-1.5 rounded-full', isSelected ? 'bg-white' : 'bg-emerald-500')} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 선택한 날짜 내역 */}
      {selectedDate && (
        <div className="mt-4">
          <p className="mb-3 text-sm font-semibold text-neutral-700">
            {selectedDate.replace(/-/g, '/')} 입출고 내역
          </p>

          {selectedLogs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-4 py-6 text-center text-sm text-neutral-500">
              이 날 입출고 내역이 없어.
            </div>
          ) : (
            <div className="space-y-3">
              {selectedLogs.map((log) => {
                const isIn = log.action === 'in';
                const item = inventoryMap.get(log.item_id);
                return (
                  <div key={log.id} className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-semibold">{item?.name ?? `품목#${log.item_id}`}</p>
                        {log.company_name && (
                          <p className="mt-1 text-xs font-medium text-neutral-600">{log.company_name}</p>
                        )}
                        <p className="mt-1 text-xs text-neutral-500">{formatDateTime(log.created_at)}</p>
                        {(log.user_name || log.user_email) && (
                          <p className="mt-1 truncate text-xs text-neutral-400">작성: {log.user_name || log.user_email}</p>
                        )}
                        {log.note && <p className="mt-1 text-xs text-blue-600">{log.note}</p>}
                      </div>
                      <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold shrink-0', isIn ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600')}>
                        {isIn ? '입고' : '출고'}
                      </span>
                    </div>
                    <div className="mt-3">
                      <p className="text-2xl font-bold tracking-tight">
                        {Number(log.qty).toLocaleString()}
                        <span className="ml-1 text-base font-medium text-neutral-500">{item?.unit ?? ''}</span>
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
