'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { Vehicle, VehicleInsurance } from '../lib/types';
import { cn } from '../lib/utils';

type InsuranceWithVehicle = VehicleInsurance & { vehicle: Vehicle | null };

type InsuranceForm = {
  vehicle_id: string;
  insurance_name: string;
  insurance_company: string;
  expiry_date: string;
  premium: string;
  memo: string;
};

const EMPTY_FORM: InsuranceForm = {
  vehicle_id: '',
  insurance_name: '',
  insurance_company: '',
  expiry_date: '',
  premium: '',
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
  if (diff <= 7) return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">D-{diff}</span>;
  if (diff <= 30) return <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-semibold text-yellow-700">D-{diff}</span>;
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
        .from('vehicle_insurances')
        .select('*, vehicle:vehicles(*)')
        .eq('is_active', true)
        .order('expiry_date', { ascending: true }),
      supabase.from('vehicles').select('*').order('name'),
    ]);
    setInsurances((ins ?? []) as InsuranceWithVehicle[]);
    setVehicles((veh ?? []) as Vehicle[]);
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  async function handleSave() {
    if (!form.vehicle_id || !form.insurance_name || !form.expiry_date) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('vehicle_insurances').insert({
        vehicle_id: form.vehicle_id,
        insurance_name: form.insurance_name.trim(),
        insurance_company: form.insurance_company.trim() || null,
        expiry_date: form.expiry_date,
        premium: form.premium ? Number(form.premium) : null,
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
    const { error } = await supabase.from('vehicle_insurances').update({ expiry_date: renewDate }).eq('id', id);
    if (!error) {
      setRenewId(null);
      setRenewDate('');
      await fetchData();
    }
  }

  async function handleDeactivate(id: number) {
    if (!window.confirm('이 보험을 비활성화할까요?')) return;
    await supabase.from('vehicle_insurances').update({ is_active: false }).eq('id', id);
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
            <p className="mb-1 text-xs text-neutral-500">차량 *</p>
            <select
              value={form.vehicle_id}
              onChange={(e) => setForm((p) => ({ ...p, vehicle_id: e.target.value }))}
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400"
            >
              <option value="">선택</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.name} ({v.plate_number})</option>
              ))}
            </select>
          </div>
          <div>
            <p className="mb-1 text-xs text-neutral-500">보험명 *</p>
            <input
              value={form.insurance_name}
              onChange={(e) => setForm((p) => ({ ...p, insurance_name: e.target.value }))}
              placeholder="예: 자동차 종합보험"
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
            <p className="mb-1 text-xs text-neutral-500">메모</p>
            <input
              value={form.memo}
              onChange={(e) => setForm((p) => ({ ...p, memo: e.target.value }))}
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </div>
          <button
            onClick={() => void handleSave()}
            disabled={saving || !form.vehicle_id || !form.insurance_name || !form.expiry_date}
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
            const isUrgent = diff <= 7;
            return (
              <div
                key={ins.id}
                className={cn(
                  'rounded-2xl border px-4 py-3',
                  isUrgent ? 'border-red-200 bg-red-50' : diff <= 30 ? 'border-yellow-200 bg-yellow-50' : 'border-neutral-200 bg-white',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className={cn('text-sm font-semibold', isUrgent ? 'text-red-800' : diff <= 30 ? 'text-yellow-800' : 'text-neutral-800')}>
                        {ins.insurance_name}
                      </p>
                      <ExpiryBadge expiry={ins.expiry_date} />
                    </div>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {ins.vehicle?.name ?? '(차량 없음'} {ins.vehicle?.plate_number ? `(${ins.vehicle.plate_number})` : ''}
                      {ins.insurance_company ? ` · ${ins.insurance_company}` : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      만기일: {ins.expiry_date}
                      {ins.premium ? ` · ${Number(ins.premium).toLocaleString()}원` : ''}
                    </p>
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
                      onClick={() => void handleDeactivate(ins.id)}
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
