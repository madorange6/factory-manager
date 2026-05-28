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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchMessageContents(supabase: any, ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from('messages').select('id, content').in('id', ids);
  return new Map((data ?? []).map((m: { id: number; content: string }) => [m.id, m.content]));
}

export async function GET(request: Request) {
  const secret = request.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const currentHour = now.getUTCHours();

  // ── 오전 9시 알림 (UTC 0시 = KST 9시) ───────────────
  if (currentHour === 0) {
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
      await sendTelegramMessage('📢 <b>[오전 알림]</b> 오늘 납부 일정입니다\n\n' + morningMessages.join('\n'));
    }

    // 보험 만기 알림 — insurances 테이블
    // 차량보험: D-7, 당일 / 화재보험: D-30, D-7, 당일
    for (const days of [30, 7, 0]) {
      const targetDate = new Date(now);
      targetDate.setDate(now.getDate() + days);
      const dateStr = targetDate.toISOString().split('T')[0];

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
          await sendTelegramMessage(msg);
        }
        if (ins.notify_sms && ins.recipient_phone) {
          const plainMsg = msg.replace(/<[^>]+>/g, '');
          await sendSms(ins.recipient_phone, plainMsg);
        }
      }
    }

    // 차량검사 텔레그램 알림
    const { data: telegramVehicles } = await supabase
      .from('vehicles')
      .select('name, plate_number, inspection_date, telegram_notify_days')
      .eq('telegram_notify', true);

    for (const v of (telegramVehicles ?? []) as unknown as { name: string; plate_number: string; inspection_date: string; telegram_notify_days: number }[]) {
      const notifyDays = v.telegram_notify_days ?? 7;
      const notifyDate = new Date(now);
      notifyDate.setDate(now.getDate() + notifyDays);
      const notifyDateStr = notifyDate.toISOString().split('T')[0];

      if (v.inspection_date === notifyDateStr) {
        await sendTelegramMessage(
          `🚗 <b>[차량검사 알림]</b>\n\n${v.name} (${v.plate_number})\n검사 만료일: ${v.inspection_date}\n${notifyDays}일 후 만료 예정입니다.`
        );
      } else if (v.inspection_date === today) {
        await sendTelegramMessage(
          `🚗 <b>[차량검사 알림]</b>\n\n${v.name} (${v.plate_number})\n오늘이 검사 만료일입니다.`
        );
      }
    }
  }

  // ── 오후 9시 재알림 (UTC 12시 = KST 21시) ───────────
  if (currentHour === 12) {
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
      await sendTelegramMessage('⚠️ <b>[미납 재알림]</b> 아직 미체크 항목이 있습니다\n\n' + eveningMessages.join('\n'));
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
    if (utcAlertHour !== currentHour) continue;

    if (!alert.target_date || !alert.alert_days) continue;
    const target = new Date(alert.target_date);
    const diffDays = Math.round((target.getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24));
    if (alert.alert_days.includes(diffDays)) {
      const label = diffDays === 0 ? '오늘' : `D-${diffDays}`;
      await sendTelegramMessage(
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

  const todayDate = new Date(today);
  const dayOfWeek = todayDate.getDay();
  const dayOfMonth = todayDate.getDate();

  for (const alert of repeatAlerts) {
    const alertHourKST = parseInt(alert.repeat_time?.substring(0, 2) ?? '9');
    const utcAlertHour = (alertHourKST - 9 + 24) % 24;
    if (utcAlertHour !== currentHour) continue;

    let shouldSend = false;
    if (alert.repeat_type === 'daily') {
      shouldSend = true;
    } else if (alert.repeat_type === 'weekly') {
      shouldSend = alert.repeat_day_of_week === dayOfWeek;
    } else if (alert.repeat_type === 'monthly') {
      shouldSend = alert.repeat_day_of_month === dayOfMonth;
    }

    if (shouldSend) {
      await sendTelegramMessage(`🔔 <b>[반복 알림]</b>\n\n${repeatMsgMap.get(alert.chat_id) ?? '내용 없음'}`);
    }
  }

  return Response.json({ ok: true });
}
