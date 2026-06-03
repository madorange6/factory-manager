'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase/client';
import { TodoMatrixItem, TodoSchedule } from '../../lib/types';
import TodoCalendar from '../../components/todo/TodoCalendar';
import MatrixModal from '../../components/todo/MatrixModal';
import ScheduleModal from '../../components/todo/ScheduleModal';
import ScheduleList from '../../components/todo/ScheduleList';
import NotifySettingsPopup from '../../components/todo/NotifySettingsPopup';

const ADMIN_EMAIL = 'sj_advisory@naver.com';

export default function TodoPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [schedules, setSchedules] = useState<TodoSchedule[]>([]);
  const [matrixItems, setMatrixItems] = useState<Pick<TodoMatrixItem, 'id' | 'date' | 'quadrant' | 'is_completed'>[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [editSchedule, setEditSchedule] = useState<TodoSchedule | null>(null);
  const [showNotifySettings, setShowNotifySettings] = useState(false);

  useEffect(() => { void init(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) { router.replace('/login'); return; }
    const { data: profile } = await supabase.from('profiles').select('email').eq('id', data.user.id).maybeSingle();
    const email = (profile as { email: string } | null)?.email ?? data.user.email ?? '';
    if (email !== ADMIN_EMAIL) { router.replace('/'); return; }
    setChecking(false);
    await fetchAll(today.getFullYear(), today.getMonth());
  }

  const fetchAll = useCallback(async (y: number, m: number) => {
    const monthStart = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m + 1, 0).getDate();
    const monthEnd = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const [{ data: sch }, { data: mat }] = await Promise.all([
      supabase
        .from('todo_schedules')
        .select('*, todo_schedule_tasks(*)')
        .lte('start_date', monthEnd)
        .gte('end_date', monthStart)
        .order('start_date'),
      supabase
        .from('todo_matrix_items')
        .select('id, date, quadrant, is_completed')
        .gte('date', monthStart)
        .lte('date', monthEnd),
    ]);
    setSchedules((sch ?? []) as TodoSchedule[]);
    setMatrixItems((mat ?? []) as Pick<TodoMatrixItem, 'id' | 'date' | 'quadrant' | 'is_completed'>[]);
  }, []);

  function prevMonth() {
    const newMonth = month === 0 ? 11 : month - 1;
    const newYear = month === 0 ? year - 1 : year;
    setYear(newYear);
    setMonth(newMonth);
    setSelectedDate(null);
    void fetchAll(newYear, newMonth);
  }

  function nextMonth() {
    const newMonth = month === 11 ? 0 : month + 1;
    const newYear = month === 11 ? year + 1 : year;
    setYear(newYear);
    setMonth(newMonth);
    setSelectedDate(null);
    void fetchAll(newYear, newMonth);
  }

  async function handleDeleteSchedule(s: TodoSchedule) {
    if (!window.confirm(`"${s.title}" 스케줄을 삭제할까요?`)) return;
    await supabase.from('todo_schedules').delete().eq('id', s.id);
    await fetchAll(year, month);
  }

  if (checking) return null;

  return (
    <main className="min-h-screen bg-neutral-100">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-neutral-50">
        <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+14px)] backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-neutral-500">관리자 전용</p>
              <h1 className="text-lg font-bold">할일</h1>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setEditSchedule(null); setShowScheduleModal(true); }}
                className="rounded-2xl bg-neutral-900 px-3 py-2 text-xs font-semibold text-white"
              >
                + 기간 스케줄
              </button>
              <button
                onClick={() => setShowNotifySettings(true)}
                className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-base leading-none"
              >
                🔔
              </button>
              <button
                onClick={() => router.push('/')}
                className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700"
              >
                ← 돌아가기
              </button>
            </div>
          </div>
        </header>

        <div className="flex flex-col gap-4 p-4 pb-10">
          <TodoCalendar
            year={year}
            month={month}
            schedules={schedules}
            matrixItems={matrixItems}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onPrevMonth={prevMonth}
            onNextMonth={nextMonth}
          />

          <ScheduleList
            schedules={schedules}
            onEdit={(s) => { setEditSchedule(s); setShowScheduleModal(true); }}
            onDelete={(s) => void handleDeleteSchedule(s)}
          />
        </div>

        {selectedDate && (
          <MatrixModal
            date={selectedDate}
            schedules={schedules}
            onClose={() => setSelectedDate(null)}
            onMatrixChange={() => void fetchAll(year, month)}
          />
        )}

        {showScheduleModal && (
          <ScheduleModal
            schedule={editSchedule}
            onSave={() => fetchAll(year, month)}
            onClose={() => { setShowScheduleModal(false); setEditSchedule(null); }}
          />
        )}

        {showNotifySettings && (
          <NotifySettingsPopup onClose={() => setShowNotifySettings(false)} />
        )}
      </div>
    </main>
  );
}
