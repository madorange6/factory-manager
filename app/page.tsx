'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase/client';
import { Company, InventoryItem, InventoryLogRow, MessageRow, QuickPanelState, TabKey, UserProfile } from '../lib/types';
import { fallbackName, getErrorMessage, todayString } from '../lib/utils';

import ChatTab from '../components/ChatTab';
import CalendarTab from '../components/CalendarTab';
import StockTab from '../components/StockTab';
import SettlementTab from '../components/SettlementTab';
import FinanceCalendarTab from '../components/FinanceCalendarTab';
import QuickPanel, { EMPTY_PANEL } from '../components/QuickPanel';

const ADMIN_EMAIL = 'sj_advisory@naver.com';
const ALLOWED_FINANCE_EMAILS = ['sj_advisory@naver.com', 'kim525253@naver.com'];

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export default function Page() {
  const router = useRouter();

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>('chat');
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [logs, setLogs] = useState<InventoryLogRow[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);

  const [quickPanel, setQuickPanel] = useState<QuickPanelState>({ ...EMPTY_PANEL, date: todayString() });

  useEffect(() => { void checkUser(); }, []);

  async function ensureUserProfile(user: { id: string; email?: string | null }) {
    const email = user.email ?? null;
    const { data: existing } = await supabase.from('profiles').select('id, email, name').eq('id', user.id).maybeSingle();
    if (existing?.name) return existing as UserProfile;
    const baseName = fallbackName(email);
    await supabase.from('profiles').upsert({ id: user.id, email, name: baseName }, { onConflict: 'id' });
    const { data } = await supabase.from('profiles').select('id, email, name').eq('id', user.id).maybeSingle();
    return data as UserProfile | null;
  }

  async function checkUser() {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) { router.replace('/login'); return; }
      const profile = await ensureUserProfile({ id: data.user.id, email: data.user.email });
      setCurrentUserId(data.user.id);
      setCurrentUserEmail(data.user.email ?? null);
      setCurrentUserName(profile?.name || fallbackName(data.user.email));
      setCheckingAuth(false);
      await fetchAll();
    } catch (error) {
      console.error(error);
      setErrorText(getErrorMessage(error));
      setCheckingAuth(false);
      router.replace('/login');
    }
  }

  async function fetchInventory() {
    const { data, error } = await supabase.from('inventory_items').select('id, name, current_stock, unit, category, memo').order('name');
    if (error) throw error;
    setInventory((data ?? []) as InventoryItem[]);
  }

  async function fetchMessages() {
    const { data, error } = await supabase.from('messages').select('id, content, message_type, created_at, user_id, user_email, user_name').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    setMessages(((data ?? []) as MessageRow[]).reverse());
  }

  async function fetchLogs() {
    const { data, error } = await supabase
      .from('inventory_logs')
      .select('id, item_id, action, qty, created_at, date, note, user_id, user_email, user_name, company_id, company_name')
      .order('created_at', { ascending: false });
    if (error) throw error;
    setLogs((data ?? []) as InventoryLogRow[]);
  }

  async function fetchProfiles() {
    const { data, error } = await supabase.from('profiles').select('id, email, name').order('email');
    if (error) throw error;
    setProfiles((data ?? []) as UserProfile[]);
  }

  async function fetchCompanies() {
    const { data, error } = await supabase.from('companies').select('id, name, memo, is_favorite, created_at').order('name');
    if (error) throw error;
    setCompanies((data ?? []) as Company[]);
  }

  async function fetchAll() {
    try {
      setLoading(true);
      setErrorText('');
      await Promise.all([fetchInventory(), fetchMessages(), fetchLogs(), fetchProfiles(), fetchCompanies()]);
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      setLoggingOut(true);
      await supabase.auth.signOut();
      router.replace('/login');
    } finally {
      setLoggingOut(false);
    }
  }

  function openQuickPanel() {
    setQuickPanel({ ...EMPTY_PANEL, isOpen: true, date: todayString() });
  }

  function closeQuickPanel() {
    setQuickPanel({ ...EMPTY_PANEL, date: todayString() });
  }

  const isAdmin = currentUserEmail === ADMIN_EMAIL;
  const canViewFinance = currentUserEmail !== null && ALLOWED_FINANCE_EMAILS.includes(currentUserEmail);

  const TAB_ITEMS: { key: TabKey; icon: string; label: string }[] = [
    { key: 'chat', icon: '💬', label: '채팅' },
    { key: 'calendar', icon: '📦', label: '입출고' },
    { key: 'stock', icon: '📊', label: '재고' },
    ...(canViewFinance ? [{ key: 'settlement' as TabKey, icon: '🧾', label: '정산' }] : []),
    ...(canViewFinance ? [{ key: 'finance-calendar' as TabKey, icon: '📅', label: '정산달력' }] : []),
  ];

  const TAB_TITLE: Record<TabKey, string> = {
    chat: '채팅',
    calendar: '입출고',
    stock: '재고',
    settlement: '정산',
    'finance-calendar': '정산달력',
  };

  if (checkingAuth) return null;

  return (
    <main className="min-h-screen bg-neutral-100 text-neutral-900">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-neutral-50 shadow-sm">
        {/* 헤더 */}
        <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+14px)] backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-neutral-500">입출고 · 재고관리</p>
              <h1 className="text-lg font-bold tracking-tight">{TAB_TITLE[activeTab]}</h1>
            </div>
            <button
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 disabled:opacity-50"
            >
              {loggingOut ? '로그아웃중' : '로그아웃'}
            </button>
          </div>
        </header>

        {errorText && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorText}</div>
        )}

        {/* 컨텐츠 */}
        <section className="flex-1 overflow-y-auto pb-24">
          {loading ? (
            <div className="px-4 py-10 text-center text-sm text-neutral-500">불러오는 중…</div>
          ) : (
            <>
              {activeTab === 'chat' && (
                <ChatTab
                  messages={messages}
                  setMessages={setMessages}
                  currentUserId={currentUserId}
                  currentUserEmail={currentUserEmail}
                  currentUserName={currentUserName}
                  onOpenQuickPanel={openQuickPanel}
                  companies={companies}
                  inventory={inventory}
                />
              )}
              {activeTab === 'calendar' && (
                <CalendarTab
                  logs={logs}
                  inventory={inventory}
                  companies={companies}
                  onRefreshLogs={fetchLogs}
                  onRefreshInventory={fetchInventory}
                />
              )}
              {activeTab === 'stock' && (
                <StockTab
                  inventory={inventory}
                  profiles={profiles}
                  companies={companies}
                  currentUserId={currentUserId}
                  currentUserEmail={currentUserEmail}
                  setCurrentUserName={setCurrentUserName}
                  onRefreshInventory={fetchInventory}
                  onRefreshProfiles={fetchProfiles}
                  onCompanyAdded={fetchCompanies}
                />
              )}
              {activeTab === 'settlement' && canViewFinance && (
                <SettlementTab companies={companies} inventory={inventory} onCompanyAdded={fetchCompanies} />
              )}
              {activeTab === 'finance-calendar' && canViewFinance && (
                <FinanceCalendarTab />
              )}
            </>
          )}
        </section>

        {/* 채팅 탭일 때 QuickPanel 오버레이 */}
        {activeTab === 'chat' && quickPanel.isOpen && (
          <div className="fixed bottom-[72px] left-1/2 z-20 w-full max-w-md -translate-x-1/2 bg-gradient-to-t from-neutral-50 via-neutral-50 to-transparent px-3 pb-3 pt-4">
            <div className="max-h-[70vh] overflow-y-auto rounded-3xl">
              <QuickPanel
                quickPanel={quickPanel}
                setQuickPanel={setQuickPanel}
                inventory={inventory}
                companies={companies}
                currentUserId={currentUserId}
                currentUserEmail={currentUserEmail}
                currentUserName={currentUserName}
                onClose={closeQuickPanel}
                onDone={fetchAll}
                onCompanyAdded={fetchCompanies}
                setMessages={setMessages}
              />
            </div>
          </div>
        )}

        {/* 하단 탭 네비게이션 */}
        <nav className="fixed bottom-0 left-1/2 z-30 w-full max-w-md -translate-x-1/2 border-t border-neutral-200 bg-white/95 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2 backdrop-blur">
          <div className={cn('grid gap-1 px-2', TAB_ITEMS.length === 5 ? 'grid-cols-5' : TAB_ITEMS.length === 4 ? 'grid-cols-4' : 'grid-cols-3')}>
            {TAB_ITEMS.map(({ key, icon, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={cn(
                  'flex flex-col items-center justify-center rounded-2xl px-1 py-2 transition',
                  activeTab === key ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-500',
                )}
              >
                <span className="text-base">{icon}</span>
                <span className="mt-0.5 text-[10px] font-medium">{label}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>
    </main>
  );
}
