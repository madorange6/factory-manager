'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { TodoMatrixItem, TodoMatrixSubtask } from '../../lib/types';

type Props = {
  item: TodoMatrixItem;
  onClose: () => void;
  onSave: () => Promise<void>;
};

export default function MatrixItemPopup({ item, onClose, onSave }: Props) {
  const [title, setTitle] = useState(item.title);
  const [minutes, setMinutes] = useState(item.estimated_minutes != null ? String(item.estimated_minutes) : '');
  const [memo, setMemo] = useState(item.memo ?? '');
  const [quadrant, setQuadrant] = useState(item.quadrant);
  const [subtasks, setSubtasks] = useState<TodoMatrixSubtask[]>([]);
  const [newSubtask, setNewSubtask] = useState('');
  const [postponeEnabled, setPostponeEnabled] = useState(false);
  const [postponeDate, setPostponeDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchSubtasks = useCallback(async () => {
    const { data } = await supabase
      .from('todo_matrix_subtasks')
      .select('*')
      .eq('matrix_item_id', item.id)
      .order('created_at');
    setSubtasks((data ?? []) as TodoMatrixSubtask[]);
  }, [item.id]);

  useEffect(() => { void fetchSubtasks(); }, [fetchSubtasks]);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      if (postponeEnabled && postponeDate) {
        // 새 날짜에 복사본 생성 (밀림 from 표시)
        await supabase.from('todo_matrix_items').insert({
          date: postponeDate,
          quadrant,
          title: title.trim(),
          estimated_minutes: minutes ? Number(minutes) : null,
          memo: memo.trim() || null,
          is_completed: false,
          is_postponed: true,
          postponed_from_date: item.date,
        });
        // 원본에 밀림 to 표시 (원래 날짜에 흔적 남김)
        await supabase.from('todo_matrix_items').update({
          title: title.trim(),
          estimated_minutes: minutes ? Number(minutes) : null,
          memo: memo.trim() || null,
          quadrant,
          is_postponed: true,
          postponed_to_date: postponeDate,
        }).eq('id', item.id);
      } else {
        await supabase.from('todo_matrix_items').update({
          title: title.trim(),
          estimated_minutes: minutes ? Number(minutes) : null,
          memo: memo.trim() || null,
          quadrant,
        }).eq('id', item.id);
      }
      await onSave();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm('삭제할까요?')) return;
    setDeleting(true);
    try {
      await supabase.from('todo_matrix_items').delete().eq('id', item.id);
      await onSave();
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  async function addSubtask() {
    if (!newSubtask.trim()) return;
    await supabase.from('todo_matrix_subtasks').insert({
      matrix_item_id: item.id,
      title: newSubtask.trim(),
    });
    setNewSubtask('');
    await fetchSubtasks();
  }

  async function toggleSubtask(id: number, current: boolean) {
    await supabase.from('todo_matrix_subtasks').update({ is_completed: !current }).eq('id', id);
    await fetchSubtasks();
  }

  async function deleteSubtask(id: number) {
    await supabase.from('todo_matrix_subtasks').delete().eq('id', id);
    await fetchSubtasks();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-10 overflow-y-auto"
        style={{ maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-base font-bold">할일 상세</p>
          <div className="flex gap-2">
            <button
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="rounded-full border border-red-200 px-3 py-1 text-xs text-red-500 disabled:opacity-40"
            >
              {deleting ? '삭제중' : '삭제'}
            </button>
            <button onClick={onClose} className="rounded-full border border-neutral-200 px-3 py-1 text-xs">닫기</button>
          </div>
        </div>

        <div className="space-y-4">
          {/* 사분면 */}
          <div>
            <p className="mb-1 text-xs text-neutral-500">매트릭스</p>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                { key: 'urgent_important', label: '🔴 긴급+중요' },
                { key: 'urgent_not_important', label: '🟠 긴급+비중요' },
                { key: 'not_urgent_important', label: '🔵 비긴급+중요' },
                { key: 'not_urgent_not_important', label: '⚫ 비긴급+비중요' },
              ] as const).map((q) => (
                <button
                  key={q.key}
                  onClick={() => setQuadrant(q.key)}
                  className={`rounded-xl border px-3 py-2 text-xs font-medium text-left transition ${
                    quadrant === q.key
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : 'border-neutral-200 bg-neutral-50 text-neutral-600'
                  }`}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          {/* 제목 */}
          <div>
            <p className="mb-1 text-xs text-neutral-500">제목</p>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm outline-none focus:border-neutral-400"
            />
          </div>

          {/* 예상 소요시간 */}
          <div>
            <p className="mb-1 text-xs text-neutral-500">예상 소요시간 (분)</p>
            <input
              type="number"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder="예: 30"
              className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm outline-none focus:border-neutral-400"
            />
          </div>

          {/* 메모 */}
          <div>
            <p className="mb-1 text-xs text-neutral-500">메모</p>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={2}
              placeholder="메모 (선택)"
              className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm outline-none focus:border-neutral-400 resize-none"
            />
          </div>

          {/* 하위 할일 */}
          <div>
            <p className="mb-2 text-xs text-neutral-500">하위 할일</p>
            <div className="space-y-1.5 mb-2">
              {subtasks.map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={t.is_completed}
                    onChange={() => void toggleSubtask(t.id, t.is_completed)}
                    className="h-4 w-4 shrink-0 cursor-pointer"
                  />
                  <p className={`flex-1 text-sm ${t.is_completed ? 'line-through text-neutral-400' : 'text-neutral-800'}`}>
                    {t.title}
                  </p>
                  <button
                    onClick={() => void deleteSubtask(t.id)}
                    className="text-xs text-neutral-300 hover:text-red-400"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                placeholder="하위 할일 추가"
                onKeyDown={(e) => { if (e.key === 'Enter') void addSubtask(); }}
                className="flex-1 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm outline-none focus:border-neutral-400"
              />
              <button
                onClick={() => void addSubtask()}
                disabled={!newSubtask.trim()}
                className="rounded-xl bg-neutral-900 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                추가
              </button>
            </div>
          </div>

          {/* 미루기 */}
          <div className="rounded-2xl border border-orange-200 bg-orange-50 p-3.5">
            <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={postponeEnabled}
                onChange={(e) => setPostponeEnabled(e.target.checked)}
                className="h-4 w-4"
              />
              미루기
            </label>
            {postponeEnabled && (
              <div className="mt-3">
                <p className="mb-1 text-xs text-neutral-500">언제로 미룰까요?</p>
                <input
                  type="date"
                  value={postponeDate}
                  min={item.date}
                  onChange={(e) => setPostponeDate(e.target.value)}
                  className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-neutral-400"
                />
                {postponeDate && (
                  <p className="mt-1.5 text-xs text-orange-600">
                    원래 날짜({item.date})에 흔적이 남고, {postponeDate}에 새로 생성돼.
                  </p>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => void handleSave()}
            disabled={saving || !title.trim() || (postponeEnabled && !postponeDate)}
            className="w-full rounded-2xl bg-neutral-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {saving ? '저장중' : postponeEnabled && postponeDate ? '저장 + 미루기' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
