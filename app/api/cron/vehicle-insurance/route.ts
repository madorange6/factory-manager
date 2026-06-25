import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendTelegramMessage } from '@/lib/telegram';

function dateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function sendSms(to: string, text: string) {
  const apiKey = process.env.SOLAPI_API_KEY!;
  const apiSecret = process.env.SOLAPI_API_SECRET!;
  const sender = process.env.SOLAPI_SENDER!;

  const date = new Date().toISOString();
  const salt = Math.random().toString(36).slice(2);
  const signature = await makeSignature(apiSecret, date, salt);

  const res = await fetch('https://api.solapi.com/messages/v4/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
    },
    body: JSON.stringify({
      message: { to, from: sender, text },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SOLAPI error: ${body}`);
  }

  await sendTelegramMessage(`📱 <b>[SMS 발송]</b>\n수신: ${to}\n\n${text}`);
}

async function makeSignature(secret: string, date: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const data = encoder.encode(date + salt);
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function GET() {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { data: vehicles, error } = await supabaseAdmin.from('vehicles').select('*');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // KST = UTC+9. 0h UTC = 9am KST, 6h UTC = 3pm KST
    const utcHour = new Date().getUTCHours();
    const isMorning = utcHour === 0;
    const isAfternoon = utcHour === 6;

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const todayStr = dateStr(today);
    const d7Str = dateStr(addDays(today, 7));

    const results: string[] = [];

    for (const v of vehicles ?? []) {
      const insuranceDate = v.insurance_date as string | null;
      const phone = v.insurance_recipient_phone as string | null;
      const name = v.name as string;
      const plate = v.plate_number as string;
      const isInsured = v.is_insured as boolean;

      if (!insuranceDate || !phone) continue;

      if (isMorning) {
        // D-7 경고
        if (insuranceDate === d7Str) {
          const msg = `[차량보험 D-7]\n${name}(${plate}) 보험 만료일이 7일 남았습니다.\n만료일: ${insuranceDate}`;
          await sendSms(phone, msg);
          results.push(`D-7 SMS → ${phone}`);
        }

        // 당일 오전 (미가입만)
        if (insuranceDate === todayStr && !isInsured) {
          const msg = `[차량보험 당일 안내]\n${name}(${plate}) 오늘 보험 만료일입니다.\n갱신/가입 후 완료 처리를 해주세요.\n만료일: ${insuranceDate}`;
          await sendSms(phone, msg);
          results.push(`D-day 오전 SMS → ${phone}`);
        }
      }

      if (isAfternoon) {
        // 당일 오후 긴급 (미가입만)
        if (insuranceDate === todayStr && !isInsured) {
          const msg = `[차량보험 긴급]\n${name}(${plate}) 보험이 아직 미가입 상태입니다.\n즉시 가입해주세요!\n만료일: ${insuranceDate}`;
          await sendSms(phone, msg);
          results.push(`D-day 오후 긴급 SMS → ${phone}`);
        }
      }
    }

    return NextResponse.json({ ok: true, sent: results, run: isMorning ? 'morning' : isAfternoon ? 'afternoon' : 'other' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
