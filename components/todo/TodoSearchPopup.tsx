'use client';

import { useRef, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { TodoMatrixItem } from '../../lib/types';
import MatrixItemPopup from './MatrixItemPopup';

const QUADRANT_EMOJI: Record<string, string> = {
  urgent_important: '🔴',
  urgent_not_important: '🟠',
  not_urgent_important: '🔵',
  not_urgent_not_important: '⚫',
};

type Props = {
  onClose: () => void;
};

export default function TodoSearchPopup({ onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TodoMatrixItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [popupItem, setPopupItem] = useState<TodoMatrixItem | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(() => { void search(value.trim()); }, 300);
  }

  async function search(q: string) {
    setLoading(true);
    const { data } = await supabase
      .from('todo_matrix_items')
      .select('*')
      .or(`title.ilike.%${q}%,memo.ilike.%${q}%`)
      .order('date', { ascending: false })
      .limit(50);
    setResults((data ?? []) as TodoMatrixItem[]);
    setLoading(false);
  }

  function formatDate(d: string) {
    const [y, m, day] = d.split('-');
    return `${y}. ${Number(m)}. ${Number(day)}`;
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50" onClick={onClose}>
        <div
          className="w-full max-w-md rounded-t-3xl bg-white pb-10 flex flex-col"
          style={{ maxHeight: '90vh' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 shrink-0">
            <p className="text-base font-bold">🔍 할일 검색</p>
            <button onClick={onClose} className="rounded-full border border-neutral-200 px-3 py-1 text-xs">닫기</button>
          </div>

          <div className="px-4 py-3 border-b border-neutral-100 shrink-0">
            <input
              autoFocus
              value={query}
              onChange={(e) => handleChange(e.target.value)}
              placeholder="제목 또는 메모 검색..."
              className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm outline-none focus:border-neutral-400"
            />
          </div>

          <div className="overflow-y-auto flex-1">
            {loading && (
              <p className="px-5 py-6 text-sm text-neutral-400 text-center">검색 중...</p>
            )}
            {!loading && query.trim() && results.length === 0 && (
              <p className="px-5 py-6 text-sm text-neutral-400 text-center">결과 없음</p>
            )}
            {!loading && !query.trim() && (
              <p className="px-5 py-6 text-sm text-neutral-400 text-center">제목이나 메모에 입력한 내용으로 검색</p>
            )}
            <div className="divide-y divide-neutral-100">
              {results.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setPopupItem(item)}
                  className="w-full px-5 py-3.5 text-left hover:bg-neutral-50 active:bg-neutral-100"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-base shrink-0 mt-0.5">{QUADRANT_EMOJI[item.quadrant]}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium leading-snug ${
                        item.is_completed || item.postponed_to_date
                          ? 'line-through text-neutral-400'
                          : 'text-neutral-800'
                      }`}>
                        {item.title}
                      </p>
                      {item.memo && (
                        <p className="mt-0.5 text-xs text-neutral-400 line-clamp-2">{item.memo}</p>
                      )}
                      <p className="mt-1 text-xs text-neutral-300">{formatDate(item.date)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {popupItem && (
        <MatrixItemPopup
          item={popupItem}
          onClose={() => setPopupItem(null)}
          onSave={async () => { if (query.trim()) await search(query.trim()); }}
        />
      )}
    </>
  );
}
