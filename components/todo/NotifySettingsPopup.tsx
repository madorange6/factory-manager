'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase/client';

type NotifySetting = {
  key: string;
  label: string;
  is_enabled: boolean;
  notify_hour_kst: number;
};

type Props = {
  onClose: () => void;
};

function formatHour(h: number) {
  if (h === 0) return '오전 12시';
  if (h < 12) return `오전 ${h}시`;
  if (h === 12) return '오후 12시';
  return `오후 ${h - 12}시`;
}

export default function NotifySettingsPopup({ onClose }: Props) {
  const [settings, setSettings] = useState<NotifySetting[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { void fetchSettings(); }, []);

  async function fetchSettings() {
    const { data } = await supabase.from('notify_settings').select('*').order('key');
    setSettings((data ?? []) as NotifySetting[]);
  }

  function update(key: string, field: 'is_enabled' | 'notify_hour_kst', value: boolean | number) {
    setSettings((prev) => prev.map((s) => s.key === key ? { ...s, [field]: value } : s));
  }

  async function handleSave() {
    setSaving(true);
    try {
      for (const s of settings) {
        await supabase.from('notify_settings').update({
          is_enabled: s.is_enabled,
          notify_hour_kst: s.notify_hour_kst,
          updated_at: new Date().toISOString(),
        }).eq('key', s.key);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-base font-bold">🔔 알림 설정</p>
          <button onClick={onClose} className="rounded-full border border-neutral-200 px-3 py-1 text-xs">닫기</button>
        </div>

        <div className="space-y-3 mb-5">
          {settings.map((s) => (
            <div key={s.key} className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-neutral-800">{s.label}</p>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={s.is_enabled}
                    onChange={(e) => update(s.key, 'is_enabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-neutral-300 rounded-full peer peer-checked:bg-neutral-900 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                </label>
              </div>
              {s.is_enabled && (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-neutral-500">알림 시간</p>
                  <select
                    value={s.notify_hour_kst}
                    onChange={(e) => update(s.key, 'notify_hour_kst', Number(e.target.value))}
                    className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs outline-none"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{formatHour(i)}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={() => void handleSave()}
          disabled={saving || settings.length === 0}
          className="w-full rounded-2xl bg-neutral-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          {saving ? '저장중' : '저장'}
        </button>
      </div>
    </div>
  );
}
