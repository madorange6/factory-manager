import { NextResponse } from 'next/server';
import { sendTelegramMessage } from '@/lib/telegram';

type SolapiWebhookPayload = {
  messageId?: string;
  groupId?: string;
  to?: string;
  from?: string;
  type?: string;
  statusCode?: string;
  statusMessage?: string;
  networkName?: string;
  text?: string;
};

export async function POST(request: Request) {
  let payload: SolapiWebhookPayload;
  try {
    payload = await request.json() as SolapiWebhookPayload;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const to = payload.to ?? '알 수 없음';
  const from = payload.from ?? '알 수 없음';
  const status = payload.statusCode ?? '?';
  const statusMsg = payload.statusMessage ?? '?';
  const type = payload.type ?? 'SMS';
  const network = payload.networkName ? ` (${payload.networkName})` : '';
  const isSuccess = status === '2000';

  const icon = isSuccess ? '📱' : '⚠️';
  const label = isSuccess ? '발송 완료' : '발송 실패';

  await sendTelegramMessage(
    `${icon} <b>[SOLAPI ${label}]</b>\n발신: ${from}\n수신: ${to}${network}\n유형: ${type}\n상태: ${statusMsg}(${status})`
  );

  return NextResponse.json({ ok: true });
}
