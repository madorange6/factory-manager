import { sendTelegramMessage } from '@/lib/telegram';

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

export async function sendSms(to: string, text: string) {
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
    body: JSON.stringify({ message: { to, from: sender, text } }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SOLAPI error: ${body}`);
  }

  await sendTelegramMessage(`📱 <b>[SMS 발송]</b>\n수신: ${to}\n\n${text}`);
}
