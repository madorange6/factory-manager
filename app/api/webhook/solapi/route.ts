import { NextResponse } from 'next/server';
import { sendTelegramMessage } from '@/lib/telegram';

type SolapiMessage = {
  messageId?: string;
  groupId?: string;
  to?: string;
  from?: string;
  type?: string;
  statusCode?: string;
  statusMessage?: string;
  networkName?: string;
  networkCode?: string;
  text?: string;
};

export async function POST(request: Request) {
  let payload: SolapiMessage | SolapiMessage[];
  try {
    payload = await request.json() as SolapiMessage | SolapiMessage[];
  } catch {
    return NextResponse.json({ ok: true });
  }

  const messages = Array.isArray(payload) ? payload : [payload];

  for (const msg of messages) {
    const to = msg.to ?? '알 수 없음';
    const from = msg.from ?? '알 수 없음';
    const status = msg.statusCode ?? '?';
    const statusMsg = msg.statusMessage ?? '?';
    const type = msg.type ?? 'SMS';
    const network = msg.networkName ? ` (${msg.networkName})` : '';

    // 4000 = 수신 완료 (성공)
    if (status === '4000') {
      await sendTelegramMessage(
        `📱 <b>[SOLAPI 수신 완료]</b>\n발신: ${from}\n수신: ${to}${network}\n유형: ${type}`
      );
      continue;
    }

    // statusMessage에 실패/오류/불가 포함 시 실패 알림
    const isFailure = /실패|오류|불가|error/i.test(statusMsg);
    if (isFailure) {
      await sendTelegramMessage(
        `⚠️ <b>[SOLAPI 발송 실패]</b>\n발신: ${from}\n수신: ${to}${network}\n유형: ${type}\n상태: ${statusMsg}(${status})`
      );
    }
    // 나머지 중간 상태(접수, 발송 중 등)는 무시
  }

  return NextResponse.json({ ok: true });
}
