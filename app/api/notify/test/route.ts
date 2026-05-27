import { createClient } from '@supabase/supabase-js';

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // 1. chat_notifications 원본 조회
  const { data: notifs, error: notifErr } = await supabase
    .from('chat_notifications')
    .select('*')
    .eq('is_active', true);

  // 2. 조인 없이 메시지 따로 조회
  const messageContents: Record<number, string> = {};
  if (notifs && notifs.length > 0) {
    const ids = notifs.map((n: { chat_id: number }) => n.chat_id);
    const { data: msgs } = await supabase
      .from('messages')
      .select('id, content')
      .in('id', ids);
    (msgs ?? []).forEach((m: { id: number; content: string }) => {
      messageContents[m.id] = m.content;
    });
  }

  // 3. 텔레그램 환경변수 확인
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  return Response.json({
    env: {
      TELEGRAM_BOT_TOKEN: token ? '있음' : '없음',
      TELEGRAM_CHAT_ID: chatId ? '있음' : '없음',
    },
    notifError: notifErr?.message ?? null,
    notifCount: notifs?.length ?? 0,
    notifs: (notifs ?? []).map((n: Record<string, unknown>) => ({
      ...n,
      messageContent: messageContents[n.chat_id as number] ?? '(메시지 없음)',
    })),
    currentUTCHour: new Date().getUTCHours(),
  });
}
