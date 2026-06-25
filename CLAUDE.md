# factory-manager 프로젝트 컨텍스트

## 스택
- **프레임워크**: Next.js App Router (TypeScript)
- **DB/Auth**: Supabase (client + service role)
- **배포**: Vercel (Hobby plan, GitHub 자동배포)
- **SMS**: SOLAPI (HMAC-SHA256 인증)
- **알림봇**: Telegram (꼼꼼이)
- **스케줄러**: cron-job.org (외부 크론 - Vercel Hobby는 daily cron만 지원)

---

## 주요 파일 맵

| 경로 | 역할 |
|------|------|
| `app/api/notify/all/route.ts` | 메인 크론 엔드포인트. 세금/대출/차량검사 알림 통합 |
| `app/api/notify/vehicle-sms-test/route.ts` | 차량 SMS 테스트 발송 (관리자 전용 POST) |
| `app/api/webhook/solapi/route.ts` | SOLAPI 웹훅 수신 → 꼼꼼이 알림 |
| `app/vehicles/page.tsx` | 차량 관리 UI (SMS 시간 설정, 테스트 발송 버튼) |
| `app/page.tsx` | 메인 채팅 화면 (최신 400개 + 중요 메시지 항상 표시) |
| `lib/solapi.ts` | SOLAPI sendSms 함수 |
| `lib/telegram.ts` | Telegram sendTelegramMessage 함수 |
| `lib/types.ts` | 공통 타입 정의 |

---

## 환경변수

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY       # 서버사이드 전용
SOLAPI_API_KEY                  # IP 제한 없는 키 사용 중 (Vercel IP가 유동적)
SOLAPI_API_SECRET
SOLAPI_SENDER                   # 발신번호
TELEGRAM_BOT_TOKEN              # 꼼꼼이 봇
TELEGRAM_CHAT_ID
CRON_SECRET                     # notify/all 인증용
```

---

## 외부 서비스 설정

### cron-job.org
- `GET /api/notify/all?secret=CRON_SECRET` 를 주기적으로 호출
- Vercel Hobby plan은 `vercel.json`에서 hourly cron 불가 → 외부 크론 사용
- `vercel.json`은 현재 `{}` (cron 항목 없음)

### SOLAPI 웹훅
- 등록 URL: `https://factory-manager-pi.vercel.app/api/webhook/solapi`
- payload가 **배열**로 옴 (단일 객체 아님)
- statusCode `4000` = 수신 완료 (실제 성공)
- 중간 상태 코드(접수, 발송 중 등)는 웹훅에서 무시함

### Supabase
- 클라이언트사이드: `lib/supabase/client.ts` (ANON_KEY)
- 서버사이드 관리자 작업: `createClient(URL, SERVICE_ROLE_KEY)` 직접 생성
- 유저 인증 토큰 검증: `supabaseAdmin.auth.getUser(token)` (인자 전달 필수)

---

## 차량검사 SMS 발송 로직

`notify/all` 내에 통합됨 (별도 cron route 없음):
- D-30, D-day, D+15 시점에 발송
- 차량별 `sms_notify_hour_kst` 필드로 발송 시각 개별 설정
- `test_date`, `test_mode` 쿼리 파라미터로 수동 테스트 가능

---

## 자주 발생한 실수 & 주의사항

### 1. SOLAPI fetch 응답 파싱
```typescript
// 에러 메시지가 JSON이 아닐 수 있음
// ❌ const err = await res.json();
// ✅
const err = await res.text();
```

### 2. SOLAPI 웹훅 payload는 배열
```typescript
// ❌ const msg = await request.json() as SolapiMessage;
// ✅
const raw = await request.json();
const messages = Array.isArray(raw) ? raw : [raw];
```

### 3. Supabase auth.getUser()에 토큰 직접 전달
```typescript
// ❌ supabaseAdmin.auth.getUser()  // 헤더에서 자동으로 안 읽음
// ✅
const token = request.headers.get('authorization')?.replace('Bearer ', '');
const { data: { user } } = await supabaseAdmin.auth.getUser(token);
```

### 4. KST 오늘 날짜
```typescript
// ❌ new Date().toISOString().split('T')[0]  // UTC 기준
// ✅
new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0]
```

### 5. Vercel Hobby 크론 제한
- `vercel.json`에 hourly cron(`0 * * * *`) 넣으면 빌드 실패
- 시간별 실행이 필요하면 cron-job.org 사용

### 6. SOLAPI IP 제한
- Vercel 서버리스 함수의 IP는 유동적 (34.x.x.x 등)
- SOLAPI 키는 반드시 **IP 제한 없는 키** 사용
- IP 제한된 키로 바꾸면 `Forbidden: 허용되지 않은 IP` 에러

### 7. SOLAPI statusCode 해석
- `4000` = 수신 완료 (성공) ← `2000`이 아님에 주의
- 실패 판단: `statusMessage`에 "실패"/"오류" 포함 여부로 체크

---

## 관리자 계정
- `sj_advisory@naver.com` (ADMIN_EMAIL 하드코딩)
