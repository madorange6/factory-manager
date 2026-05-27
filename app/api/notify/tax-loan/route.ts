import { createClient } from '@supabase/supabase-js';
import { sendTelegramMessage } from '@/lib/telegram';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type'); // 'morning' | 'evening'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const today = new Date().toISOString().split('T')[0];
  const messages: string[] = [];

  const { data: taxPayments } = await supabase
    .from('tax_payments')
    .select('amount, tax_schedule:tax_schedules(tax_name)')
    .eq('payment_date', today)
    .eq('is_paid', false);

  if (taxPayments && taxPayments.length > 0) {
    messages.push('<b>💸 오늘 납부 예정 세금</b>');
    (taxPayments as unknown as { amount: number; tax_schedule: { tax_name: string } | null }[]).forEach((p) => {
      messages.push(`• ${p.tax_schedule?.tax_name ?? '(미상)'} — ${Number(p.amount).toLocaleString()}원`);
    });
  }

  const { data: loanSchedules } = await supabase
    .from('loan_schedules')
    .select('total_payment, loan:loans(loan_name)')
    .eq('payment_date', today)
    .eq('is_paid', false);

  if (loanSchedules && loanSchedules.length > 0) {
    messages.push('');
    messages.push('<b>🏦 오늘 납입 예정 대출</b>');
    (loanSchedules as unknown as { total_payment: number; loan: { loan_name: string } | null }[]).forEach((s) => {
      messages.push(`• ${s.loan?.loan_name ?? '(미상)'} — ${Number(s.total_payment).toLocaleString()}원`);
    });
  }

  if (messages.length === 0) return Response.json({ sent: false });

  const prefix = type === 'morning'
    ? '📢 <b>[오전 알림]</b> 오늘 납부 일정입니다\n\n'
    : '⚠️ <b>[미납 재알림]</b> 아직 미체크 항목이 있습니다\n\n';

  await sendTelegramMessage(prefix + messages.join('\n'));
  return Response.json({ sent: true });
}
