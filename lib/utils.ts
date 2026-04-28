export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function formatTime(dateString: string) {
  const date = new Date(dateString);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

// 채팅용: 월/일 시:분
export function formatChatDateTime(dateString: string) {
  const date = new Date(dateString);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

export function formatDateTime(dateString: string) {
  const date = new Date(dateString);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

// YYYY-MM-DD 형식
export function formatDateOnly(dateString: string) {
  const date = new Date(dateString);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayString() {
  return formatDateOnly(new Date().toISOString());
}

export function normalizeCategory(category?: string | null): string {
  const value = (category || '').trim();
  return value || '미분류';
}

export function fallbackName(email?: string | null) {
  if (!email) return '이름없음';
  return email.split('@')[0] || email;
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;
    try { return JSON.stringify(error); } catch { return '알 수 없는 오류가 발생했어.'; }
  }
  if (typeof error === 'string') return error;
  return '알 수 없는 오류가 발생했어.';
}

export function formatCurrency(n: number) {
  return Number(n).toLocaleString('ko-KR');
}
