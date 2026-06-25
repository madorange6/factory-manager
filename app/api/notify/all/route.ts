import { createClient } from '@supabase/supabase-js';
import { sendTelegramMessage } from '@/lib/telegram';
import { sendSms } from '@/lib/solapi';

type NotifRow = {
  chat_id: number;
  target_date: string | null;
  alert_days: number[] | null;
  repeat_time: string;
  repeat_type: string | null;
  repeat_day_of_week: number | null;
  repeat_day_of_month: number | null;
};

type NotifySetting = {
  key: string;
  is_enabled: boolean;
  notify_hour_kst: number;
};

function maskPhone(phone: string): string {
  return phone.replace(/(\d{3})-?(\d{4})-?(\d{4})/, '$1-****-$3');
}

function addDaysToDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchMessageContents(supabase: any, ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from('messages').select('id, content').in('id', ids);
  return new Map((data ?? []).map((m: { id: number; content: string }) => [m.id, m.content]));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret') ?? request.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // test_date: 날짜 오버라이드 (?test_date=2026-06-25)
  // test_mode: true이면 실제 발송 없이 콘솔 로그만 출력
  const testDateParam = searchParams.get('test_date');
  const testMode = searchParams.get('test_mode') === 'true';

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const now = new Date();
  // KST 기준 오늘 날짜 (UTC+9)
  const today = testDateParam ?? new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
  const currentHour = now.getUTCHours();

  async function notify(msg: string) {
    if (testMode) { console.log('[TEST TELEGRAM]', msg); return; }
    await sendTelegramMessage(msg);
  }
  async function notifySms(to: string, text: string) {
    if (testMode) { console.log('[TEST SMS]', to, text); return; }
    await sendSms(to, text);
  }

  const { data: settingsData } = await supabase.from('notify_settings').select('key, is_enabled, notify_hour_kst');
  const settingsMap = new Map((settingsData ?? [] as NotifySetting[]).map((s: NotifySetting) => [s.key, s]));

  function shouldRun(key: string): boolean {
    const s = settingsMap.get(key);
    if (!s || !s.is_enabled) return false;
    if (testMode) return true;
    return ((s.notify_hour_kst - 9 + 24) % 24) === currentHour;
  }

  // ── 오전 세금·대출 알림 ────────────────────────────────
  if (shouldRun('morning_finance')) {
    const morningMessages: string[] = [];

    const { data: taxPayments } = await supabase
      .from('tax_payments')
      .select('amount, tax_schedule:tax_schedules(tax_name)')
      .eq('payment_date', today)
      .eq('is_paid', false);

    if (taxPayments && taxPayments.length > 0) {
      morningMessages.push('<b>💸 오늘 납부 예정 세금</b>');
      (taxPayments as unknown as { amount: number; tax_schedule: { tax_name: string } | null }[]).forEach((p) => {
        morningMessages.push(`• ${p.tax_schedule?.tax_name ?? '(미상)'} — ${Number(p.amount).toLocaleString()}원`);
      });
    }

    const { data: loanSchedules } = await supabase
      .from('loan_schedules')
      .select('total_payment, loan:loans(loan_name)')
      .eq('payment_date', today)
      .eq('is_paid', false);

    if (loanSchedules && loanSchedules.length > 0) {
      morningMessages.push('');
      morningMessages.push('<b>🏦 오늘 납입 예정 대출</b>');
      (loanSchedules as unknown as { total_payment: number; loan: { loan_name: string } | null }[]).forEach((s) => {
        morningMessages.push(`• ${s.loan?.loan_name ?? '(미상)'} — ${Number(s.total_payment).toLocaleString()}원`);
      });
    }

    if (morningMessages.length > 0) {
      await notify('📢 <b>[오전 알림]</b> 오늘 납부 일정입니다\n\n' + morningMessages.join('\n'));
    }

    // 보험 만기 알림 — insurances 테이블
    // 차량보험: D-7, 당일 / 화재보험: D-30, D-7, 당일
    for (const days of [30, 7, 0]) {
      const dateStr = addDaysToDate(today, days);

      const { data: insurances } = await supabase
        .from('insurances')
        .select('insurance_name, insurance_type, insurance_company, expiry_date, notify_sms, notify_telegram, recipient_phone')
        .eq('expiry_date', dateStr);

      for (const ins of (insurances ?? []) as unknown as { insurance_name: string; insurance_type: string; insurance_company: string | null; expiry_date: string; notify_sms: boolean; notify_telegram: boolean; recipient_phone: string | null }[]) {
        if (ins.insurance_type === '차량' && days === 30) continue;

        const companyText = ins.insurance_company ? `\n보험사: ${ins.insurance_company}` : '';
        const msg = days === 0
          ? `🛡️ <b>[보험 만기 알림]</b>\n\n${ins.insurance_name}${companyText}\n오늘이 보험 만기일입니다.`
          : `🛡️ <b>[보험 만기 알림]</b>\n\n${ins.insurance_name}${companyText}\n만기일: ${ins.expiry_date}\n${days}일 후 만료 예정입니다.`;

        if (ins.notify_telegram) {
          await notify(msg);
        }
        if (ins.notify_sms && ins.recipient_phone) {
          const plainMsg = msg.replace(/<[^>]+>/g, '');
          await notifySms(ins.recipient_phone, plainMsg);
        }
      }
    }

  }

  // ── 차량검사 텔레그램 알림 (morning_finance 독립 실행) ────
  {
    const morningHour = (() => {
      const s = settingsMap.get('morning_finance') as NotifySetting | undefined;
      return s ? ((s.notify_hour_kst - 9 + 24) % 24) : 0;
    })();

    if (testMode || currentHour === morningHour) {
      const { data: telegramVehicles } = await supabase
        .from('vehicles')
        .select('name, plate_number, inspection_date, telegram_notify_days')
        .eq('telegram_notify', true);

      for (const v of (telegramVehicles ?? []) as unknown as { name: string; plate_number: string; inspection_date: string; telegram_notify_days: number }[]) {
        const notifyDays = v.telegram_notify_days ?? 7;
        const notifyDateStr = addDaysToDate(today, notifyDays);

        if (v.inspection_date === notifyDateStr) {
          await notify(
            `🚗 <b>[차량검사 알림]</b>\n\n${v.name} (${v.plate_number})\n검사 만료일: ${v.inspection_date}\n${notifyDays}일 후 만료 예정입니다.`
          );
        } else if (v.inspection_date === today) {
          await notify(
            `🚗 <b>[차량검사 알림]</b>\n\n${v.name} (${v.plate_number})\n오늘이 검사 만료일입니다.`
          );
        }
      }
    }
  }

  // ── 차량검사 SMS 알림 ─────────────────────────────────
  {
    const morningHour = (() => {
      const s = settingsMap.get('morning_finance') as NotifySetting | undefined;
      return s ? ((s.notify_hour_kst - 9 + 24) % 24) : 0;
    })();

    {
      const d30Str = addDaysToDate(today, 30);
      const d15AgoStr = addDaysToDate(today, -15);

      const { data: smsVehicles } = await supabase
        .from('vehicles')
        .select('name, plate_number, inspection_date, recipient_phone, is_inspected, sms_notify_hour_kst');

      for (const v of (smsVehicles ?? []) as unknown as { name: string; plate_number: string; inspection_date: string; recipient_phone: string; is_inspected: boolean; sms_notify_hour_kst: number | null }[]) {
        if (!v.recipient_phone) continue;

        // 차량별 시간 설정이 있으면 그 시간, 없으면 morning_finance 시간
        const vehicleUtcHour = v.sms_notify_hour_kst != null ? ((v.sms_notify_hour_kst - 9 + 24) % 24) : morningHour;
        if (!testMode && currentHour !== vehicleUtcHour) continue;

        let label: string | null = null;
        let msg: string | null = null;

        if (v.inspection_date === d30Str) {
          label = 'D-30';
          msg = `[차량검사 D-30]\n${v.name}(${v.plate_number}) 정기검사일이 30일 남았습니다.\n검사일: ${v.inspection_date}`;
        } else if (v.inspection_date === today && !v.is_inspected) {
          label = 'D-day';
          msg = `[차량검사 당일]\n${v.name}(${v.plate_number}) 오늘 정기검사일입니다.\n검사일: ${v.inspection_date}`;
        } else if (v.inspection_date === d15AgoStr && !v.is_inspected) {
          label = 'D+15';
          msg = `[차량검사 미완료 경고]\n${v.name}(${v.plate_number}) 정기검사일이 15일 지났습니다.\n검사를 완료해주세요.`;
        }

        if (!label || !msg) continue;

        try {
          await notifySms(v.recipient_phone, msg);
          await notify(
            `✅ <b>[차량검사 SMS 발송 완료]</b>\n차량: ${v.name} (${v.plate_number})\n수신: ${maskPhone(v.recipient_phone)}\n검사만료일: ${v.inspection_date}\n발송 시점: ${label}`
          );
        } catch (err) {
          await notify(
            `❌ <b>[차량검사 SMS 발송 실패]</b>\n차량: ${v.name} (${v.plate_number})\n검사만료일: ${v.inspection_date}\n오류: ${String(err)}`
          );
        }
      }
    }
  }

  // ── 오후 미납 재알림 ──────────────────────────────────
  if (shouldRun('evening_finance')) {
    const eveningMessages: string[] = [];

    const { data: taxPayments } = await supabase
      .from('tax_payments')
      .select('amount, tax_schedule:tax_schedules(tax_name)')
      .eq('payment_date', today)
      .eq('is_paid', false);

    if (taxPayments && taxPayments.length > 0) {
      eveningMessages.push('<b>💸 미납 세금</b>');
      (taxPayments as unknown as { amount: number; tax_schedule: { tax_name: string } | null }[]).forEach((p) => {
        eveningMessages.push(`• ${p.tax_schedule?.tax_name ?? '(미상)'} — ${Number(p.amount).toLocaleString()}원`);
      });
    }

    const { data: loanSchedules } = await supabase
      .from('loan_schedules')
      .select('total_payment, loan:loans(loan_name)')
      .eq('payment_date', today)
      .eq('is_paid', false);

    if (loanSchedules && loanSchedules.length > 0) {
      eveningMessages.push('');
      eveningMessages.push('<b>🏦 미납 대출</b>');
      (loanSchedules as unknown as { total_payment: number; loan: { loan_name: string } | null }[]).forEach((s) => {
        eveningMessages.push(`• ${s.loan?.loan_name ?? '(미상)'} — ${Number(s.total_payment).toLocaleString()}원`);
      });
    }

    if (eveningMessages.length > 0) {
      await notify('⚠️ <b>[미납 재알림]</b> 아직 미체크 항목이 있습니다\n\n' + eveningMessages.join('\n'));
    }
  }

  // ── 긴급 할일 미완료 알림 ─────────────────────────────
  if (shouldRun('urgent_todo')) {
    const { data: urgentItems } = await supabase
      .from('todo_matrix_items')
      .select('title, quadrant')
      .eq('date', today)
      .in('quadrant', ['urgent_important', 'urgent_not_important'])
      .eq('is_completed', false)
      .is('postponed_to_date', null)
      .order('quadrant');

    if (urgentItems && urgentItems.length > 0) {
      const lines = (urgentItems as { title: string; quadrant: string }[]).map((it) => {
        const prefix = it.quadrant === 'urgent_important' ? '🔴' : '🟠';
        return `${prefix} ${it.title}`;
      });
      await notify(`⏰ <b>[할일 체크]</b> 미완료 긴급 항목\n\n${lines.join('\n')}`);
    }
  }

  // ── 할일 개별 알림 ────────────────────────────────────
  {
    const { data: itemNotifs } = await supabase
      .from('todo_matrix_items')
      .select('title, quadrant, notify_hour_kst')
      .eq('date', today)
      .eq('notify_enabled', true)
      .eq('is_completed', false)
      .is('postponed_to_date', null);

    for (const it of (itemNotifs ?? []) as { title: string; quadrant: string; notify_hour_kst: number }[]) {
      if (it.notify_hour_kst == null) continue;
      const utcHour = ((it.notify_hour_kst - 9 + 24) % 24);
      if (!testMode && utcHour !== currentHour) continue;
      const prefix = it.quadrant === 'urgent_important' ? '🔴'
        : it.quadrant === 'urgent_not_important' ? '🟠'
        : it.quadrant === 'not_urgent_important' ? '🔵' : '⚫';
      await notify(`🔔 <b>[할일 알림]</b>\n\n${prefix} ${it.title}`);
    }
  }

  // ── 채팅 D-day 알림 ───────────────────────────────────
  const { data: ddayRaw } = await supabase
    .from('chat_notifications')
    .select('chat_id, target_date, alert_days, repeat_time')
    .eq('notification_type', 'dday')
    .eq('is_active', true);

  const ddayAlerts = (ddayRaw ?? []) as NotifRow[];
  const ddayMsgMap = await fetchMessageContents(supabase, ddayAlerts.map((a) => a.chat_id));

  for (const alert of ddayAlerts) {
    const alertHourKST = parseInt(alert.repeat_time?.substring(0, 2) ?? '9');
    const utcAlertHour = (alertHourKST - 9 + 24) % 24;
    if (!testMode && utcAlertHour !== currentHour) continue;

    if (!alert.target_date || !alert.alert_days) continue;
    const target = new Date(alert.target_date);
    const diffDays = Math.round((target.getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24));
    if (alert.alert_days.includes(diffDays)) {
      const label = diffDays === 0 ? '오늘' : `D-${diffDays}`;
      await notify(
        `🔔 <b>[채팅 알림] ${label}</b>\n\n${ddayMsgMap.get(alert.chat_id) ?? '내용 없음'}\n\n기준일: ${alert.target_date}`
      );
    }
  }

  // ── 채팅 반복 알림 ────────────────────────────────────
  const { data: repeatRaw } = await supabase
    .from('chat_notifications')
    .select('chat_id, repeat_type, repeat_time, repeat_day_of_week, repeat_day_of_month')
    .eq('notification_type', 'repeat')
    .eq('is_active', true);

  const repeatAlerts = (repeatRaw ?? []) as NotifRow[];
  const repeatMsgMap = await fetchMessageContents(supabase, repeatAlerts.map((a) => a.chat_id));

  const todayDate = new Date(today + 'T00:00:00Z');
  const dayOfWeek = todayDate.getUTCDay();
  const dayOfMonth = todayDate.getUTCDate();

  for (const alert of repeatAlerts) {
    const alertHourKST = parseInt(alert.repeat_time?.substring(0, 2) ?? '9');
    const utcAlertHour = (alertHourKST - 9 + 24) % 24;
    if (!testMode && utcAlertHour !== currentHour) continue;

    let shouldSend = false;
    if (alert.repeat_type === 'daily') {
      shouldSend = true;
    } else if (alert.repeat_type === 'weekly') {
      shouldSend = alert.repeat_day_of_week === dayOfWeek;
    } else if (alert.repeat_type === 'monthly') {
      shouldSend = alert.repeat_day_of_month === dayOfMonth;
    }

    if (shouldSend) {
      await notify(`🔔 <b>[반복 알림]</b>\n\n${repeatMsgMap.get(alert.chat_id) ?? '내용 없음'}`);
    }
  }

  return Response.json({ ok: true, testMode, today });
}
