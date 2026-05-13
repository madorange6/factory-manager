'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase/client';
import { Vehicle } from '../../lib/types';
import { getErrorMessage } from '../../lib/utils';

const ADMIN_EMAIL = 'sj_advisory@naver.com';

type Draft = {
  name: string;
  plate_number: string;
  inspection_date: string;
  recipient_phone: string;
  inspection_cycle: number;
};

const EMPTY_DRAFT: Draft = {
  name: '',
  plate_number: '',
  inspection_date: '',
  recipient_phone: '',
  inspection_cycle: 12,
};

function cn(...cls: Array<string | false | null | undefined>) {
  return cls.filter(Boolean).join(' ');
}

export default function VehiclesPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [draft, setDraft] = useState<Draft>({ ...EMPTY_DRAFT });
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>({ ...EMPTY_DRAFT });
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    void init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function init() {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) { router.replace('/login'); return; }
    const { data: profile } = await supabase.from('profiles').select('email').eq('id', data.user.id).maybeSingle();
    const email = (profile as { email: string } | null)?.email ?? data.user.email ?? '';
    if (email !== ADMIN_EMAIL) { router.replace('/'); return; }
    setChecking(false);
    await fetchVehicles();
  }

  async function fetchVehicles() {
    const { data, error } = await supabase.from('vehicles').select('*').order('name');
    if (error) { setErrorText(getErrorMessage(error)); return; }
    setVehicles((data ?? []) as Vehicle[]);
  }

  async function handleAdd() {
    if (!draft.name.trim() || !draft.plate_number.trim() || !draft.inspection_date || !draft.recipient_phone.trim()) {
      setErrorText('모든 항목을 입력해주세요.');
      return;
    }
    setSaving(true);
    setErrorText('');
    const { error } = await supabase.from('vehicles').insert({
      name: draft.name.trim(),
      plate_number: draft.plate_number.trim(),
      inspection_date: draft.inspection_date,
      recipient_phone: draft.recipient_phone.trim(),
      inspection_cycle: draft.inspection_cycle,
    });
    setSaving(false);
    if (error) { setErrorText(getErrorMessage(error)); return; }
    setDraft({ ...EMPTY_DRAFT });
    await fetchVehicles();
  }

  async function handleUpdate() {
    if (!editId) return;
    setSaving(true);
    setErrorText('');
    const { error } = await supabase.from('vehicles').update({
      name: editDraft.name.trim(),
      plate_number: editDraft.plate_number.trim(),
      inspection_date: editDraft.inspection_date,
      recipient_phone: editDraft.recipient_phone.trim(),
      inspection_cycle: editDraft.inspection_cycle,
      updated_at: new Date().toISOString(),
    }).eq('id', editId);
    setSaving(false);
    if (error) { setErrorText(getErrorMessage(error)); return; }
    setEditId(null);
    await fetchVehicles();
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`"${name}" 차량을 삭제할까요?`)) return;
    const { error } = await supabase.from('vehicles').delete().eq('id', id);
    if (error) { setErrorText(getErrorMessage(error)); return; }
    await fetchVehicles();
  }

  function daysUntil(dateStr: string): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr);
    target.setHours(0, 0, 0, 0);
    return Math.floor((target.getTime() - today.getTime()) / 86400000);
  }

  if (checking) return null;

  return (
    <main className="min-h-screen bg-neutral-100">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-neutral-50">
        <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+14px)] backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500">관리자 전용</p>
              <h1 className="text-lg font-bold">차량 검사일 관리</h1>
            </div>
            <button
              onClick={() => router.push('/')}
              className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700"
            >
              ← 돌아가기
            </button>
          </div>
        </header>

        <div className="flex flex-col gap-4 p-4 pb-10">
          {errorText && (
            <div className="flex items-center justify-between rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
              <span>{errorText}</span>
              <button onClick={() => setErrorText('')} className="ml-2 underline">닫기</button>
            </div>
          )}

          {/* 차량 목록 */}
          {vehicles.length > 0 && (
            <div className="flex flex-col gap-3">
              {vehicles.map((v) => {
                const days = daysUntil(v.inspection_date);
                const isOverdue = days < 0;
                const isSoon = days >= 0 && days <= 30;
                return editId === v.id ? (
                  <div key={v.id} className="rounded-3xl border border-blue-200 bg-white p-4 shadow-sm">
                    <p className="mb-3 text-sm font-semibold text-blue-700">차량 수정</p>
                    <div className="flex flex-col gap-2">
                      <input
                        value={editDraft.name}
                        onChange={(e) => setEditDraft((p) => ({ ...p, name: e.target.value }))}
                        placeholder="차량명"
                        className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm outline-none focus:border-neutral-400"
                      />
                      <input
                        value={editDraft.plate_number}
                        onChange={(e) => setEditDraft((p) => ({ ...p, plate_number: e.target.value }))}
                        placeholder="차량번호"
                        className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm outline-none focus:border-neutral-400"
                      />
                      <div>
                        <p className="mb-1 text-xs text-neutral-500">검사 만료일</p>
                        <input
                          type="date"
                          value={editDraft.inspection_date}
                          onChange={(e) => setEditDraft((p) => ({ ...p, inspection_date: e.target.value }))}
                          className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm outline-none focus:border-neutral-400"
                        />
                      </div>
                      <input
                        value={editDraft.recipient_phone}
                        onChange={(e) => setEditDraft((p) => ({ ...p, recipient_phone: e.target.value }))}
                        placeholder="담당자 번호 (010-XXXX-XXXX)"
                        className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm outline-none focus:border-neutral-400"
                      />
                      <div>
                        <p className="mb-1 text-xs text-neutral-500">검사 주기</p>
                        <div className="flex gap-2">
                          {[6, 12].map((cycle) => (
                            <button
                              key={cycle}
                              onClick={() => setEditDraft((p) => ({ ...p, inspection_cycle: cycle }))}
                              className={cn(
                                'flex-1 rounded-2xl border py-2.5 text-sm font-semibold',
                                editDraft.inspection_cycle === cycle
                                  ? 'border-neutral-900 bg-neutral-900 text-white'
                                  : 'border-neutral-200 bg-neutral-50 text-neutral-700',
                              )}
                            >
                              {cycle}개월
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => void handleUpdate()}
                          disabled={saving}
                          className="flex-1 rounded-2xl bg-blue-500 py-3 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {saving ? '저장중' : '저장'}
                        </button>
                        <button
                          onClick={() => setEditId(null)}
                          className="flex-1 rounded-2xl border border-neutral-200 bg-white py-3 text-sm font-semibold text-neutral-700"
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div key={v.id} className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-base font-bold">{v.name}</p>
                          <span className="text-xs text-neutral-400">{v.plate_number}</span>
                        </div>
                        <p className="mt-1 text-xs text-neutral-500">
                          검사 만료일: <span className={cn('font-semibold', isOverdue ? 'text-red-600' : isSoon ? 'text-orange-500' : 'text-neutral-700')}>{v.inspection_date}</span>
                          {!v.is_inspected && (
                            <span className={cn('ml-2', isOverdue ? 'text-red-500' : isSoon ? 'text-orange-400' : 'text-neutral-400')}>
                              {isOverdue ? `D+${Math.abs(days)}` : `D-${days}`}
                            </span>
                          )}
                        </p>
                        {v.is_inspected && (
                          <p className="mt-0.5 text-xs text-emerald-600 font-medium">✓ 검사 완료</p>
                        )}
                        <p className="mt-0.5 text-xs text-neutral-400">담당: {v.recipient_phone} / 주기: {v.inspection_cycle}개월</p>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          onClick={() => { setEditId(v.id); setEditDraft({ name: v.name, plate_number: v.plate_number, inspection_date: v.inspection_date, recipient_phone: v.recipient_phone, inspection_cycle: v.inspection_cycle }); }}
                          className="rounded-xl border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => void handleDelete(v.id, v.name)}
                          className="rounded-xl border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {vehicles.length === 0 && (
            <div className="rounded-3xl border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-400">
              등록된 차량이 없습니다.
            </div>
          )}

          {/* 차량 등록 폼 */}
          <div className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="mb-3 text-sm font-semibold">차량 등록</p>
            <div className="flex flex-col gap-2">
              <input
                value={draft.name}
                onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                placeholder="차량명 (예: 1톤 트럭)"
                className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm outline-none focus:border-neutral-400"
              />
              <input
                value={draft.plate_number}
                onChange={(e) => setDraft((p) => ({ ...p, plate_number: e.target.value }))}
                placeholder="차량번호"
                className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm outline-none focus:border-neutral-400"
              />
              <div>
                <p className="mb-1 text-xs text-neutral-500">검사 만료일</p>
                <input
                  type="date"
                  value={draft.inspection_date}
                  onChange={(e) => setDraft((p) => ({ ...p, inspection_date: e.target.value }))}
                  className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm outline-none focus:border-neutral-400"
                />
              </div>
              <input
                value={draft.recipient_phone}
                onChange={(e) => setDraft((p) => ({ ...p, recipient_phone: e.target.value }))}
                placeholder="담당자 번호 (010-XXXX-XXXX)"
                className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm outline-none focus:border-neutral-400"
              />
              <div>
                <p className="mb-1 text-xs text-neutral-500">검사 주기</p>
                <div className="flex gap-2">
                  {[6, 12].map((cycle) => (
                    <button
                      key={cycle}
                      onClick={() => setDraft((p) => ({ ...p, inspection_cycle: cycle }))}
                      className={cn(
                        'flex-1 rounded-2xl border py-2.5 text-sm font-semibold',
                        draft.inspection_cycle === cycle
                          ? 'border-neutral-900 bg-neutral-900 text-white'
                          : 'border-neutral-200 bg-neutral-50 text-neutral-700',
                      )}
                    >
                      {cycle}개월
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => void handleAdd()}
                disabled={saving}
                className="mt-1 w-full rounded-2xl bg-neutral-900 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? '등록중' : '차량 등록'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
