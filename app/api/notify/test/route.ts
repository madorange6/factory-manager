export async function GET() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return Response.json({
      error: '환경변수 없음',
      TELEGRAM_BOT_TOKEN: token ? '있음' : '없음',
      TELEGRAM_CHAT_ID: chatId ? '있음' : '없음',
    });
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: '꼼꼼이 디버그 테스트', parse_mode: 'HTML' }),
  });

  const body = await res.json();
  return Response.json({ status: res.status, telegram: body });
}
