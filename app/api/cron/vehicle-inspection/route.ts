import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

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
    const { data: vehicles, error } = await supabaseAdmin.from('vehicles').select('*');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayStr = dateStr(today);
    const d30Str = dateStr(addDays(today, 30));
    const d15AgoStr = dateStr(addDays(today, -15));

    const results: string[] = [];

    for (const v of vehicles ?? []) {
      const inspectionDate = v.inspection_date as string;
      const phone = v.recipient_phone as string;
      const name = v.name as string;
      const plate = v.plate_number as string;
      const isInspected = v.is_inspected as boolean;

      // D-30
      if (inspectionDate === d30Str) {
        const msg = `[차량검사 D-30]\n${name}(${plate}) 정기검사일이 30일 남았습니다.\n검사일: ${inspectionDate}`;
        await sendSms(phone, msg);
        results.push(`D-30 SMS → ${phone}`);
      }

      // D-day
      if (inspectionDate === todayStr) {
        const msg = `[차량검사 당일]\n${name}(${plate}) 오늘 정기검사일입니다.\n검사일: ${inspectionDate}`;
        await sendSms(phone, msg);
        results.push(`D-day SMS → ${phone}`);
      }

      // D+15 (미완료만)
      if (inspectionDate === d15AgoStr && !isInspected) {
        const msg = `[차량검사 미완료 경고]\n${name}(${plate}) 정기검사일이 15일 지났습니다.\n검사를 완료해주세요.`;
        await sendSms(phone, msg);
        results.push(`D+15 SMS → ${phone}`);
      }
    }

    return NextResponse.json({ ok: true, sent: results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
