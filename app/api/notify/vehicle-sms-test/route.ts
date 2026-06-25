import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendSms } from '@/lib/solapi';
import { sendTelegramMessage } from '@/lib/telegram';

const ADMIN_EMAIL = 'sj_advisory@naver.com';

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabaseUser = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabaseUser.from('profiles').select('email').eq('id', user.id).maybeSingle();
  const email = (profile as { email: string } | null)?.email ?? user.email ?? '';
  if (email !== ADMIN_EMAIL) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { vehicle_id } = await request.json() as { vehicle_id: string };

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: vehicle, error } = await supabaseAdmin.from('vehicles').select('*').eq('id', vehicle_id).single();
  if (error || !vehicle) return NextResponse.json({ error: '차량 없음' }, { status: 404 });
  if (!vehicle.recipient_phone) return NextResponse.json({ error: '수신번호 없음' }, { status: 400 });

  const msg = `[차량검사 테스트]\n${vehicle.name}(${vehicle.plate_number})\n검사 만료일: ${vehicle.inspection_date}`;
  await sendSms(vehicle.recipient_phone as string, msg);
  await sendTelegramMessage(`📨 <b>[차량검사 테스트 발송]</b>\n차량: ${vehicle.name} (${vehicle.plate_number})\n검사만료일: ${vehicle.inspection_date}`);

  return NextResponse.json({ ok: true });
}
