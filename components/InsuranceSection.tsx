'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { Insurance, Vehicle } from '../lib/types';
import { cn } from '../lib/utils';

type InsuranceWithVehicle = Insurance & { vehicle: Pick<Vehicle, 'id' | 'name' | 'plate_number'> | null };

type InsuranceForm = {
  insurance_type: '차량' | '화재';
  vehicle_id: string;
  insurance_name: string;
  insurance_company: string;
  expiry_date: string;
  premium: string;
  recipient_phone: string;
  notify_sms: boolean;
  notify_telegram: boolean;
  memo: string;
};

const EMPTY_FORM: InsuranceForm = {
  insurance_type: '차량',
  vehicle_id: '',
  insurance_name: '',
  insurance_company: '',
  expiry_date: '',
  premium: '',
  recipient_phone: '',
  notify_sms: false,
  notify_telegram: false,
  memo: '',
};

function getDaysDiff(expiry: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiry + 'T00:00:00');
  return Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function ExpiryBadge({ expiry }: { expiry: string }) {
  const diff = getDaysDiff(expiry);
  if (diff < 0) return <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-semibold text-neutral-500">만기</span>;
  if (diff === 0) return <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-semibold text-white">당일</span>;
  if (diff <= 30) return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">D-{diff}</span>;
  if (diff <= 60) return <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-semibold text-yellow-700">D-{diff}</span>;
  return null;
}

export default function InsuranceSection() {
  const [insurances, setInsurances] = useState<InsuranceWithVehicle[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<InsuranceForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [renewId, setRenewId] = useState<number | null>(null);
  const [renewDate, setRenewDate] = useState('');

  const fetchData = useCallback(async () => {
    const [{ data: ins }, { data: veh }] = await Promise.all([
      supabase
        .from('insurances')
        .select('*, vehicle:vehicles(id, name, plate_number)')
        .order('expiry_date', { ascending: true }),
      supabase.from('vehicles').select('id, name, plate_number').order('name'),
    ]);
    setInsurances((ins ?? []) as InsuranceWithVehicle[]);
    setVehicles((veh ?? []) as Vehicle[]);
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  async function handleSave() {
    if (!form.insurance_name || !form.expiry_date) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('insurances').insert({
        insurance_type: form.insurance_type,
        vehicle_id: form.insurance_type === '차량' && form.vehicle_id ? form.vehicle_id : null,
        insurance_name: form.insurance_name.trim(),
        insurance_company: form.insurance_company.trim() || null,
        expiry_date: form.expiry_date,
        premium: form.premium ? Number(form.premium) : null,
        recipient_phone: form.recipient_phone.trim() || null,
        notify_sms: form.notify_sms,
        notify_telegram: form.notify_telegram,
        memo: form.memo.trim() || null,
      });
      if (error) throw error;
      setForm(EMPTY_FORM);
      setShowForm(false);
      await fetchData();
    } finally {
      setSaving(false);
    }
  }

  async function handleRenew(id: number) {
    if (!renewDate) return;
    const { error } = await supabase.from('insurances').update({ expiry_date: renewDate, updated_at: new Date().toISOString() }).eq('id', id);
    if (!error) {
      setRenewId(null);
      setRenewDate('');
      await fetchData();
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm('이 보험을 삭제할까요?')) return;
    await supabase.from('insurances').delete().eq('id', id);
    await fetchData();
  }

  return (
    <div className="mt-6 border-t border-neutral-200 pt-6">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-base font-bold">🛡️ 보험 관리</p>
        <button
          onClick={() => { setShowForm((p) => !p); setForm(EMPTY_FORM); }}
          className="rounded-xl bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white"
        >
          {showForm ? '닫기' : '+ 등록'}
        </button>
      </div>

      {showForm && (
        <div className="mb-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 space-y-3">
          <div>
            <p className="mb-1 text-xs text-neutral-500">보험 타입 *</p>
            <div className="flex gap-2">
              {(['차량', '화재'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setForm((p) => ({ ...p, insurance_type: t, vehicle_id: '' }))}
                  className={cn(
                    'flex-1 rounded-xl border py-2 text-sm font-semibold',
                    form.insurance_type === t
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : 'border-neutral-200 bg-white text-neutral-700',
                  )}
                >
                  {t}보험
                </button>
              ))}
            </div>
          </div>
          {form.insurance_type === '차량' && (
            <div>
              <p className="mb-1 text-xs text-neutral-500">연결 차량</p>
              <select
                value={form.vehicle_id}
                onChange={(e) => setForm((p) => ({ ...p, vehicle_id: e.target.value }))}
                className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400"
              >
                <option value="">선택 안함</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.name} ({v.plate_number})</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <p className="mb-1 text-xs text-neutral-500">보험명 *</p>
            <input
              value={form.insurance_name}
              onChange={(e) => setForm((p) => ({ ...p, insurance_name: e.target.value }))}
              placeholder="예: 1공장 화재보험"
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </div>
          <div>
            <p className="mb-1 text-xs text-neutral-500">보험사</p>
            <input
              value={form.insurance_company}
              onChange={(e) => setForm((p) => ({ ...p, insurance_company: e.target.value }))}
              placeholder="예: 삼성화재"
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </div>
          <div>
            <p className="mb-1 text-xs text-neutral-500">만기일 *</p>
            <input
              type="date"
              value={form.expiry_date}
              onChange={(e) => setForm((p) => ({ ...p, expiry_date: e.target.value }))}
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </div>
          <div>
            <p className="mb-1 text-xs text-neutral-500">보험료</p>
            <input
              type="number"
              value={form.premium}
              onChange={(e) => setForm((p) => ({ ...p, premium: e.target.value }))}
              placeholder="원"
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </div>
          <div>
            <p className="mb-1 text-xs text-neutral-500">알림 방법</p>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.notify_sms}
                  onChange={(e) => setForm((p) => ({ ...p, notify_sms: e.target.checked }))}
                  className="rounded"
                />
                솔라피 (문자)
              </label>
              {form.notify_sms && (
                <input
                  value={form.recipient_phone}
                  onChange={(e) => setForm((p) => ({ ...p, recipient_phone: e.target.value }))}
                  placeholder="수신 번호 (010-XXXX-XXXX)"
                  className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400"
                />
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.notify_telegram}
                  onChange={(e) => setForm((p) => ({ ...p, notify_telegram: e.target.checked }))}
                  className="rounded"
                />
                꼼꼼이 (텔레그램)
              </label>
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs text-neutral-500">메모</p>
            <input
              value={form.memo}
              onChange={(e) => setForm((p) => ({ ...p, memo: e.target.value }))}
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </div>
          <button
            onClick={() => void handleSave()}
            disabled={saving || !form.insurance_name || !form.expiry_date}
            className="w-full rounded-xl bg-neutral-900 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {saving ? '저장중' : '저장'}
          </button>
        </div>
      )}

      {insurances.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-4 py-6 text-center text-sm text-neutral-500">
          등록된 보험이 없어.
        </div>
      ) : (
        <div className="space-y-2">
          {insurances.map((ins) => {
            const diff = getDaysDiff(ins.expiry_date);
            const isUrgent = diff <= 30;
            const isWarn = diff > 30 && diff <= 60;
            return (
              <div
                key={ins.id}
                className={cn(
                  'rounded-2xl border px-4 py-3',
                  isUrgent ? 'border-red-200 bg-red-50' : isWarn ? 'border-yellow-200 bg-yellow-50' : 'border-neutral-200 bg-white',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                        ins.insurance_type === '차량' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700',
                      )}>
                        {ins.insurance_type}
                      </span>
                      <p className={cn('text-sm font-semibold', isUrgent ? 'text-red-800' : isWarn ? 'text-yellow-800' : 'text-neutral-800')}>
                        {ins.insurance_name}
                      </p>
                      <ExpiryBadge expiry={ins.expiry_date} />
                    </div>
                    {ins.vehicle && (
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {ins.vehicle.name} ({ins.vehicle.plate_number})
                        {ins.insurance_company ? ` · ${ins.insurance_company}` : ''}
                      </p>
                    )}
                    {!ins.vehicle && ins.insurance_company && (
                      <p className="mt-0.5 text-xs text-neutral-500">{ins.insurance_company}</p>
                    )}
                    <p className="mt-0.5 text-xs text-neutral-500">
                      만기일: {ins.expiry_date}
                      {ins.premium ? ` · ${Number(ins.premium).toLocaleString()}원` : ''}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      {ins.notify_sms && <span className="text-[10px] text-neutral-400">📱 문자</span>}
                      {ins.notify_telegram && <span className="text-[10px] text-neutral-400">💬 꼼꼼이</span>}
                    </div>
                    {ins.memo && <p className="mt-0.5 text-xs text-neutral-400">{ins.memo}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      onClick={() => { setRenewId(ins.id); setRenewDate(''); }}
                      className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
                    >
                      갱신
                    </button>
                    <button
                      onClick={() => void handleDelete(ins.id)}
                      className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-400 hover:bg-neutral-50"
                    >
                      삭제
                    </button>
                  </div>
                </div>

                {renewId === ins.id && (
                  <div className="mt-2 flex items-center gap-2 border-t border-neutral-200 pt-2">
                    <input
                      type="date"
                      value={renewDate}
                      onChange={(e) => setRenewDate(e.target.value)}
                      className="flex-1 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs outline-none"
                    />
                    <button
                      onClick={() => void handleRenew(ins.id)}
                      disabled={!renewDate}
                      className="rounded-lg bg-neutral-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      확인
                    </button>
                    <button
                      onClick={() => setRenewId(null)}
                      className="rounded-lg border border-neutral-200 px-2 py-1 text-xs text-neutral-500"
                    >
                      취소
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
