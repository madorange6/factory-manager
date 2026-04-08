'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase/client';

function fallbackName(email?: string | null) {
  if (!email) return '이름없음';
  return email.split('@')[0] || email;
}

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void checkSession();
  }, []);

  async function checkSession() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.error(error);
    return;
  }

  if (data.session) {
    router.replace('/');
  }
}

  async function ensureProfile(user: { id: string; email?: string | null }, inputName?: string) {
    const email = user.email ?? null;
    const baseName = (inputName && inputName.trim()) || fallbackName(email);

    const { error } = await supabase.from('profiles').upsert(
      {
        id: user.id,
        email,
        name: baseName,
      },
      { onConflict: 'id' }
    );

    if (error) throw error;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!email.trim() || !password.trim()) {
      alert('이메일과 비밀번호를 입력해줘');
      return;
    }

    if (mode === 'signup' && !name.trim()) {
      alert('회원가입할 때 이름도 입력해줘');
      return;
    }

    setLoading(true);

    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: password.trim(),
          options: {
            data: {
              name: name.trim(),
            },
          },
        });

        if (error) throw error;

        if (data.user) {
          await ensureProfile(
            {
              id: data.user.id,
              email: data.user.email,
            },
            name
          );
        }

        alert('회원가입 완료. 이제 로그인해줘.');
        setMode('login');
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password.trim(),
      });

      if (error) throw error;

      if (data.user) {
        await ensureProfile({
          id: data.user.id,
          email: data.user.email,
        });
      }

      router.replace('/');
      router.refresh();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : '로그인/회원가입 중 오류가 발생했어.';
      alert(message);
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center justify-center p-4">
      <div className="w-full rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="mb-2 text-2xl font-bold">공장 재고관리</h1>
        <p className="mb-6 text-sm text-neutral-500">
          {mode === 'login' ? '로그인' : '회원가입'}
        </p>

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`flex-1 rounded-xl border px-4 py-2 ${
              mode === 'login'
                ? 'border-neutral-900 bg-neutral-900 font-bold text-white'
                : 'border-neutral-200 bg-white'
            }`}
          >
            로그인
          </button>
          <button
            type="button"
            onClick={() => setMode('signup')}
            className={`flex-1 rounded-xl border px-4 py-2 ${
              mode === 'signup'
                ? 'border-neutral-900 bg-neutral-900 font-bold text-white'
                : 'border-neutral-200 bg-white'
            }`}
          >
            회원가입
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div>
              <label className="mb-1 block text-sm">이름</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 p-3"
                placeholder="이름 입력"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm">이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 p-3"
              placeholder="example@email.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 p-3"
              placeholder="비밀번호 입력"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-neutral-900 px-4 py-3 font-semibold text-white disabled:opacity-50"
          >
            {loading ? '처리중...' : mode === 'login' ? '로그인' : '회원가입'}
          </button>
        </form>
      </div>
    </main>
  );
}