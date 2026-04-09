'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase/client';

type TabKey = 'chat' | 'stock' | 'logs';
type MessageType = 'chat' | 'command' | 'system';
type InventoryCategory = '원료' | '분쇄품' | '스크랩';
type QuickAction = '재고' | '입고' | '출고' | '생산';
type ProductionType = '원료생산' | '분쇄품생산';

type InventoryItem = {
  id: number;
  name: string;
  current_stock: number;
  unit: string;
  category?: string | null;
};

type MessageRow = {
  id: number;
  content: string;
  message_type: MessageType;
  created_at: string;
  user_id?: string | null;
  user_email?: string | null;
  user_name?: string | null;
};

type InventoryLogRow = {
  id: number;
  item_id: number;
  action: 'in' | 'out';
  qty: number;
  created_at: string;
  note?: string | null;
  user_id?: string | null;
  user_email?: string | null;
  user_name?: string | null;
};

type UserProfile = {
  id: string;
  email: string | null;
  name: string | null;
};

type QuickPanelState = {
  isOpen: boolean;
  action: QuickAction | null;
  category: InventoryCategory | null;
  itemName: string;
  selectedItemId: number | null;
  bagQty: string;
  kgQty: string;

  productionType: ProductionType | null;
  sourceItemId: number | null;
  targetItemId: number | null;
  targetItemName: string;
  sourceBagQty: string;
  targetBagQty: string;
  targetKgQty: string;
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function formatTime(dateString: string) {
  const date = new Date(dateString);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function formatDateTime(dateString: string) {
  const date = new Date(dateString);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

function normalizeCategory(category?: string | null): string {
  const value = (category || '').trim();
  return value || '미분류';
}

function fallbackName(email?: string | null) {
  if (!email) return '이름없음';
  return email.split('@')[0] || email;
}

function createTempMessage(
  content: string,
  messageType: MessageType,
  userId: string | null,
  userEmail: string | null,
  userName: string | null
): MessageRow {
  return {
    id: -Date.now() - Math.floor(Math.random() * 1000),
    content,
    message_type: messageType,
    created_at: new Date().toISOString(),
    user_id: userId,
    user_email: userEmail,
    user_name: userName,
  };
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;

  if (typeof error === 'object' && error !== null) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;

    try {
      return JSON.stringify(error);
    } catch {
      return '알 수 없는 오류가 발생했어.';
    }
  }

  if (typeof error === 'string') return error;

  return '알 수 없는 오류가 발생했어.';
}

const EMPTY_PANEL: QuickPanelState = {
  isOpen: false,
  action: null,
  category: null,
  itemName: '',
  selectedItemId: null,
  bagQty: '',
  kgQty: '',

  productionType: null,
  sourceItemId: null,
  targetItemId: null,
  targetItemName: '',
  sourceBagQty: '',
  targetBagQty: '',
  targetKgQty: '',
};

const CATEGORY_OPTIONS: InventoryCategory[] = ['원료', '분쇄품', '스크랩'];

export default function Page() {
  const router = useRouter();

  const ADMIN_EMAIL = 'sj_advisory@naver.com'; // 본인 이메일로 바꿔요

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>('chat');
  const [input, setInput] = useState('');

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [logs, setLogs] = useState<InventoryLogRow[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);

  const [stockSearch, setStockSearch] = useState('');
  const [stockCategory, setStockCategory] = useState('원료');

  const [logKeyword, setLogKeyword] = useState('');
  const [logFilter, setLogFilter] = useState<'all' | 'in' | 'out'>('all');

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [quickPanel, setQuickPanel] = useState<QuickPanelState>(EMPTY_PANEL);
  const [quickPanelError, setQuickPanelError] = useState('');

  const [stockManageMode, setStockManageMode] = useState(false);
  const [categoryDrafts, setCategoryDrafts] = useState<Record<number, string>>({});
  const [userNameDrafts, setUserNameDrafts] = useState<Record<string, string>>({});
  const [savingCategoryId, setSavingCategoryId] = useState<number | null>(null);
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [deletingLogId, setDeletingLogId] = useState<number | null>(null);

  const [newItemName, setNewItemName] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('kg');
  const [newItemStock, setNewItemStock] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<InventoryCategory>('원료');
  const [creatingItem, setCreatingItem] = useState(false);

  const chatScrollRef = useRef<HTMLDivElement | null>(null);
const chatBottomRef = useRef<HTMLDivElement | null>(null); // 추가


 function scrollToBottom() {
  setTimeout(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, 100);
}


  useEffect(() => {
    void checkUser();
  }, []);

  useEffect(() => {
    if (activeTab !== 'chat' || loading) return;

    const timer = setTimeout(() => {
      scrollToBottom();
    }, 30);

    return () => clearTimeout(timer);
  }, [messages.length, activeTab, loading, quickPanel.isOpen]);

  useEffect(() => {
    const nextDrafts: Record<number, string> = {};
    inventory.forEach((item) => {
      nextDrafts[item.id] = normalizeCategory(item.category);
    });
    setCategoryDrafts(nextDrafts);
  }, [inventory]);

  useEffect(() => {
    const nextNameDrafts: Record<string, string> = {};
    profiles.forEach((profile) => {
      nextNameDrafts[profile.id] = profile.name || '';
    });
    setUserNameDrafts(nextNameDrafts);
  }, [profiles]);

  async function ensureUserProfile(user: { id: string; email?: string | null }) {
  const email = user.email ?? null;

  const { data: existing } = await supabase
    .from('profiles')
    .select('id, email, name')
    .eq('id', user.id)
    .maybeSingle(); // single() 대신 maybeSingle() 로 변경

  if (existing?.name) {
    return existing as UserProfile;
  }

  const baseName = fallbackName(email);
  const { error: upsertError } = await supabase.from('profiles').upsert(
    { id: user.id, email, name: baseName },
    { onConflict: 'id' }
  );

  if (upsertError) throw upsertError;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, name')
    .eq('id', user.id)
    .maybeSingle(); // 여기도 변경

  if (error) throw error;
  return data as UserProfile | null;
}

  async function checkUser() {
    try {
      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user) {
        router.replace('/login');
        return;
      }

      const profile = await ensureUserProfile({
        id: data.user.id,
        email: data.user.email,
      });

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

  async function handleLogout() {
    try {
      setLoggingOut(true);
      await supabase.auth.signOut();
      router.replace('/login');
    } finally {
      setLoggingOut(false);
    }
  }

  async function fetchInventory() {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('id, name, current_stock, unit, category')
      .order('id', { ascending: true });

    if (error) throw error;
    setInventory((data ?? []) as InventoryItem[]);
  }

  async function fetchMessages() {
  const { data, error } = await supabase
    .from('messages')
    .select('id, content, message_type, created_at, user_id, user_email, user_name')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;
  setMessages(((data ?? []) as MessageRow[]).reverse());
}

  async function fetchLogs() {
    const { data, error } = await supabase
      .from('inventory_logs')
      .select('id, item_id, action, qty, created_at, note, user_id, user_email, user_name')
      .order('created_at', { ascending: false });

    if (error) throw error;
    setLogs((data ?? []) as InventoryLogRow[]);
  }

  async function fetchProfiles() {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, name')
      .order('email', { ascending: true });

    if (error) throw error;
    setProfiles((data ?? []) as UserProfile[]);
  }

  async function fetchAll() {
    try {
      setLoading(true);
      setErrorText('');
      await Promise.all([fetchInventory(), fetchMessages(), fetchLogs(), fetchProfiles()]);
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setLoading(false);
      setTimeout(() => {
        scrollToBottom();
      }, 80);
    }
  }

  const inventoryMap = useMemo(() => {
    return new Map(inventory.map((item) => [item.id, item]));
  }, [inventory]);

  const stockTabs = ['원료', '분쇄품', '스크랩'];

  const filteredStock = useMemo(() => {
    return inventory.filter((item) => {
      const matchesSearch =
        stockSearch.trim() === '' ||
        item.name.toLowerCase().includes(stockSearch.trim().toLowerCase());

      const itemCategory = normalizeCategory(item.category);
      const matchesCategory = stockCategory === '전체' ? true : itemCategory === stockCategory;

      return matchesSearch && matchesCategory;
    });
  }, [inventory, stockSearch, stockCategory]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const item = inventoryMap.get(log.item_id);
      const name = item?.name ?? `품목#${log.item_id}`;

      const matchesKeyword =
        logKeyword.trim() === '' ||
        name.toLowerCase().includes(logKeyword.trim().toLowerCase());

      const matchesFilter = logFilter === 'all' ? true : log.action === logFilter;

      return matchesKeyword && matchesFilter;
    });
  }, [logs, inventoryMap, logKeyword, logFilter]);

  const quickPanelItems = useMemo(() => {
    if (!quickPanel.action) return [];

    if (quickPanel.action === '재고') {
      return inventory;
    }

    if (
      (quickPanel.action === '입고' || quickPanel.action === '출고') &&
      quickPanel.category
    ) {
      return inventory.filter(
        (item) => normalizeCategory(item.category) === quickPanel.category
      );
    }

    return [];
  }, [quickPanel.action, quickPanel.category, inventory]);

  const selectedItem = useMemo(() => {
    if (quickPanel.selectedItemId == null) return null;
    return inventory.find((item) => item.id === quickPanel.selectedItemId) ?? null;
  }, [quickPanel.selectedItemId, inventory]);

  const existingMatchedItem = useMemo(() => {
    const typed = quickPanel.itemName.trim().toLowerCase();
    if (!typed) return null;

    return (
      inventory.find((item) => {
        const nameMatch = item.name.trim().toLowerCase() === typed;
        if (!nameMatch) return false;

        if (
          (quickPanel.action === '입고' || quickPanel.action === '출고') &&
          quickPanel.category
        ) {
          return normalizeCategory(item.category) === quickPanel.category;
        }

        return true;
      }) ?? null
    );
  }, [inventory, quickPanel.itemName, quickPanel.action, quickPanel.category]);

  const willCreateNewItem = useMemo(() => {
    if (!(quickPanel.action === '입고' || quickPanel.action === '출고')) return false;
    if (!quickPanel.category) return false;
    if (!quickPanel.itemName.trim()) return false;
    if (quickPanel.selectedItemId) return false;
    if (existingMatchedItem) return false;
    return true;
  }, [quickPanel, existingMatchedItem]);

  const productionSourceItems = useMemo(() => {
    if (quickPanel.productionType === '원료생산') {
      return inventory.filter(
        (item) => normalizeCategory(item.category) === '분쇄품'
      );
    }

    if (quickPanel.productionType === '분쇄품생산') {
      return inventory.filter(
        (item) => normalizeCategory(item.category) === '스크랩'
      );
    }

    return [];
  }, [quickPanel.productionType, inventory]);

  const productionTargetItems = useMemo(() => {
    if (quickPanel.productionType === '원료생산') {
      return inventory.filter(
        (item) => normalizeCategory(item.category) === '원료'
      );
    }

    if (quickPanel.productionType === '분쇄품생산') {
      return inventory.filter(
        (item) => normalizeCategory(item.category) === '분쇄품'
      );
    }

    return [];
  }, [quickPanel.productionType, inventory]);

  const existingProductionTargetItem = useMemo(() => {
    const typed = quickPanel.targetItemName.trim().toLowerCase();
    if (!typed || !quickPanel.productionType) return null;

    const targetCategory =
      quickPanel.productionType === '원료생산' ? '원료' : '분쇄품';

    return (
      inventory.find((item) => {
        return (
          item.name.trim().toLowerCase() === typed &&
          normalizeCategory(item.category) === targetCategory
        );
      }) ?? null
    );
  }, [inventory, quickPanel.targetItemName, quickPanel.productionType]);

  const willCreateProductionTargetItem = useMemo(() => {
    if (quickPanel.action !== '생산') return false;
    if (!quickPanel.productionType) return false;
    if (!quickPanel.targetItemName.trim()) return false;
    if (quickPanel.targetItemId) return false;
    if (existingProductionTargetItem) return false;
    return true;
  }, [quickPanel, existingProductionTargetItem]);

  const quickSummary = useMemo(() => {
    const parts: string[] = [];

    if (quickPanel.action) parts.push(quickPanel.action);

    if (quickPanel.action === '생산') {
      if (quickPanel.productionType) parts.push(quickPanel.productionType);

      const sourceItem =
        inventory.find((item) => item.id === quickPanel.sourceItemId) ?? null;

      const targetItem =
        inventory.find((item) => item.id === quickPanel.targetItemId) ??
        existingProductionTargetItem ??
        null;

      if (sourceItem) parts.push(`사용:${sourceItem.name}`);
      if (quickPanel.sourceBagQty.trim()) {
        parts.push(`사용량:${quickPanel.sourceBagQty.trim()}bag`);
      }

      if (targetItem) {
        parts.push(`결과:${targetItem.name}`);
      } else if (quickPanel.targetItemName.trim()) {
        parts.push(`결과:${quickPanel.targetItemName.trim()}`);
      }

      if (quickPanel.productionType === '원료생산' && quickPanel.targetKgQty.trim()) {
        parts.push(`생산량:${quickPanel.targetKgQty.trim()}kg`);
      }

      if (quickPanel.productionType === '분쇄품생산' && quickPanel.targetBagQty.trim()) {
        parts.push(`생산량:${quickPanel.targetBagQty.trim()}bag`);
      }

      return parts.join(' / ');
    }

    if (quickPanel.category) parts.push(quickPanel.category);
    if (quickPanel.itemName.trim()) parts.push(quickPanel.itemName.trim());
    if (quickPanel.bagQty.trim()) parts.push(`${quickPanel.bagQty.trim()}bag`);
    if (quickPanel.kgQty.trim()) parts.push(`${quickPanel.kgQty.trim()}kg`);

    return parts.join(' / ');
  }, [quickPanel, inventory, existingProductionTargetItem]);

  async function insertMessage(content: string, messageType: MessageType) {
    const { error } = await supabase.from('messages').insert({
      content,
      message_type: messageType,
      user_id: currentUserId,
      user_email: currentUserEmail,
      user_name: currentUserName,
    });

    if (error) throw error;
  }

  async function insertLog(
    itemId: number,
    action: 'in' | 'out',
    qty: number,
    note: string | null = null
  ) {
    const { error } = await supabase.from('inventory_logs').insert({
      item_id: itemId,
      action,
      qty,
      note,
      user_id: currentUserId,
      user_email: currentUserEmail,
      user_name: currentUserName,
    });

    if (error) throw error;
  }

  async function updateInventoryStock(itemId: number, newStock: number) {
    const { error } = await supabase
      .from('inventory_items')
      .update({ current_stock: newStock })
      .eq('id', itemId);

    if (error) throw error;
  }

  async function updateInventoryCategory(itemId: number, category: string) {
    const { error } = await supabase
      .from('inventory_items')
      .update({ category })
      .eq('id', itemId);

    if (error) throw error;
  }

  async function updateUserName(profileId: string, name: string) {
    const { error } = await supabase
      .from('profiles')
      .update({ name })
      .eq('id', profileId);

    if (error) throw error;
  }

  async function createInventoryItem(
    name: string,
    category: InventoryCategory,
    unit: string,
    initialStock: number
  ) {
    const { data, error } = await supabase
      .from('inventory_items')
      .insert({
        name,
        category,
        unit,
        current_stock: initialStock,
      })
      .select('id, name, current_stock, unit, category')
      .single();

    if (error) throw error;
    return data as InventoryItem;
  }

  async function deleteLogAndRollback(log: InventoryLogRow) {
    const item = inventory.find((x) => x.id === log.item_id);
    if (!item) throw new Error('재고 품목을 찾지 못했어.');

    const currentStock = Number(item.current_stock ?? 0);
    let restoredStock = currentStock;

    if (log.action === 'in') {
      restoredStock = currentStock - Number(log.qty);
      if (restoredStock < 0) {
        throw new Error('이 로그를 삭제하면 재고가 음수가 돼서 삭제할 수 없어.');
      }
    } else {
      restoredStock = currentStock + Number(log.qty);
    }

    await updateInventoryStock(item.id, restoredStock);

    const { error } = await supabase
      .from('inventory_logs')
      .delete()
      .eq('id', log.id);

    if (error) throw error;
  }

  function addLocalMessage(temp: MessageRow) {
    setMessages((prev) => [...prev, temp]);
    setTimeout(() => {
      scrollToBottom();
    }, 10);
  }

  async function saveUserMessage(content: string, type: MessageType = 'chat') {
    const temp = createTempMessage(
      content,
      type,
      currentUserId,
      currentUserEmail,
      currentUserName
    );
    addLocalMessage(temp);

    try {
      await insertMessage(content, type);
    } catch (error) {
      setMessages((prev) => prev.filter((msg) => msg.id !== temp.id));
      throw error;
    }
  }

  async function saveSystemMessage(content: string) {
    const temp = createTempMessage(
      content,
      'system',
      currentUserId,
      currentUserEmail,
      currentUserName
    );
    addLocalMessage(temp);

    try {
      await insertMessage(content, 'system');
    } catch (error) {
      setMessages((prev) => prev.filter((msg) => msg.id !== temp.id));
      throw error;
    }
  }

  function openQuickPanel() {
    setQuickPanel({
      ...EMPTY_PANEL,
      isOpen: true,
    });
    setQuickPanelError('');
    setTimeout(() => {
      scrollToBottom();
    }, 10);
  }

  function closeQuickPanel() {
    setQuickPanel({ ...EMPTY_PANEL });
    setQuickPanelError('');
    setTimeout(() => {
      scrollToBottom();
    }, 10);
  }

  function setQuickAction(action: QuickAction) {
    setQuickPanel((prev) => ({
      ...prev,
      action,
      category: null,
      itemName: '',
      selectedItemId: null,
      bagQty: '',
      kgQty: '',
      productionType: null,
      sourceItemId: null,
      targetItemId: null,
      targetItemName: '',
      sourceBagQty: '',
      targetBagQty: '',
      targetKgQty: '',
    }));
    setQuickPanelError('');
    setTimeout(() => {
      scrollToBottom();
    }, 10);
  }

  function setQuickCategory(category: InventoryCategory) {
    setQuickPanel((prev) => ({
      ...prev,
      category,
      itemName: '',
      selectedItemId: null,
      bagQty: '',
      kgQty: '',
    }));
    setQuickPanelError('');
  }

  function setProductionType(type: ProductionType) {
    setQuickPanel((prev) => ({
      ...prev,
      productionType: type,
      sourceItemId: null,
      targetItemId: null,
      targetItemName: '',
      sourceBagQty: '',
      targetBagQty: '',
      targetKgQty: '',
    }));
    setQuickPanelError('');
    setTimeout(() => {
      scrollToBottom();
    }, 10);
  }

  function selectQuickItem(item: InventoryItem) {
    setQuickPanel((prev) => ({
      ...prev,
      selectedItemId: item.id,
      itemName: item.name,
    }));
    setQuickPanelError('');
  }

  function getMatchedItemByName(
    itemName: string,
    category?: InventoryCategory | null
  ): InventoryItem | null {
    const normalized = itemName.trim().toLowerCase();

    return (
      inventory.find((item) => {
        const nameMatch = item.name.trim().toLowerCase() === normalized;
        const categoryMatch = category
          ? normalizeCategory(item.category) === category
          : true;
        return nameMatch && categoryMatch;
      }) ?? null
    );
  }

  async function runQuickPanelAction() {
    const action = quickPanel.action;

    if (!action) {
      setQuickPanelError('작업을 먼저 선택해줘.');
      return;
    }

    if (action === '생산') {
      const productionType = quickPanel.productionType;

      if (!productionType) {
        setQuickPanelError('생산 종류를 먼저 선택해줘.');
        return;
      }

      const sourceItem =
        inventory.find((item) => item.id === quickPanel.sourceItemId) ?? null;

      if (!sourceItem) {
        setQuickPanelError('사용 품목을 선택해줘.');
        return;
      }

      const sourceBagQty = Number(quickPanel.sourceBagQty);

      if (!Number.isFinite(sourceBagQty) || sourceBagQty <= 0) {
        setQuickPanelError('사용량 bag 수를 입력해줘.');
        return;
      }

      const sourceStock = Number(sourceItem.current_stock ?? 0);

      if (sourceStock < sourceBagQty) {
        setQuickPanelError(
          `${sourceItem.name} 재고 부족 (현재 ${sourceStock}${sourceItem.unit})`
        );
        return;
      }

      const targetCategory: InventoryCategory =
        productionType === '원료생산' ? '원료' : '분쇄품';

      let targetItem =
        inventory.find((item) => item.id === quickPanel.targetItemId) ??
        existingProductionTargetItem ??
        null;

      const typedTargetName = quickPanel.targetItemName.trim();

      if (!targetItem && !typedTargetName) {
        setQuickPanelError('결과 품목을 선택하거나 새로 입력해줘.');
        return;
      }

      if (!targetItem && typedTargetName) {
        targetItem = await createInventoryItem(
          typedTargetName,
          targetCategory,
          productionType === '원료생산' ? 'kg' : 'bag',
          0
        );
      }

      if (!targetItem) {
        setQuickPanelError('결과 품목을 확인해줘.');
        return;
      }

      if (productionType === '원료생산') {
        if (normalizeCategory(sourceItem.category) !== '분쇄품') {
          setQuickPanelError('원료 생산의 사용 품목은 분쇄품이어야 해.');
          return;
        }

        if (normalizeCategory(targetItem.category) !== '원료') {
          setQuickPanelError('원료 생산의 결과 품목은 원료여야 해.');
          return;
        }

        const targetKgQty = Number(quickPanel.targetKgQty);

        if (!Number.isFinite(targetKgQty) || targetKgQty <= 0) {
          setQuickPanelError('생산된 원료 kg를 입력해줘.');
          return;
        }

        const newSourceStock = sourceStock - sourceBagQty;
        const targetStock = Number(targetItem.current_stock ?? 0);
        const newTargetStock = targetStock + targetKgQty;

        await saveUserMessage(
          `생산 원료생산 사용:${sourceItem.name} ${sourceBagQty}bag 결과:${targetItem.name} ${targetKgQty}kg`,
          'chat'
        );

        await updateInventoryStock(sourceItem.id, newSourceStock);
        await updateInventoryStock(targetItem.id, newTargetStock);

        await insertLog(
          sourceItem.id,
          'out',
          sourceBagQty,
          `production_use:원료생산:${targetItem.name}`
        );

        await insertLog(
          targetItem.id,
          'in',
          targetKgQty,
          `production_result:원료생산:${sourceItem.name}`
        );

        await saveSystemMessage(
          `${sourceItem.name} ${sourceBagQty}bag 사용, ${targetItem.name} ${targetKgQty}kg 생산 완료.`
        );

        closeQuickPanel();
        await fetchAll();
        return;
      }

      if (productionType === '분쇄품생산') {
        if (normalizeCategory(sourceItem.category) !== '스크랩') {
          setQuickPanelError('분쇄품 생산의 사용 품목은 스크랩이어야 해.');
          return;
        }

        if (normalizeCategory(targetItem.category) !== '분쇄품') {
          setQuickPanelError('분쇄품 생산의 결과 품목은 분쇄품이어야 해.');
          return;
        }

        const targetBagQty = Number(quickPanel.targetBagQty);

        if (!Number.isFinite(targetBagQty) || targetBagQty <= 0) {
          setQuickPanelError('생산된 분쇄품 bag 수를 입력해줘.');
          return;
        }

        const newSourceStock = sourceStock - sourceBagQty;
        const targetStock = Number(targetItem.current_stock ?? 0);
        const newTargetStock = targetStock + targetBagQty;

        await saveUserMessage(
          `생산 분쇄품생산 사용:${sourceItem.name} ${sourceBagQty}bag 결과:${targetItem.name} ${targetBagQty}bag`,
          'chat'
        );

        await updateInventoryStock(sourceItem.id, newSourceStock);
        await updateInventoryStock(targetItem.id, newTargetStock);

        await insertLog(
          sourceItem.id,
          'out',
          sourceBagQty,
          `production_use:분쇄품생산:${targetItem.name}`
        );

        await insertLog(
          targetItem.id,
          'in',
          targetBagQty,
          `production_result:분쇄품생산:${sourceItem.name}`
        );

        await saveSystemMessage(
          `${sourceItem.name} ${sourceBagQty}bag 사용, ${targetItem.name} ${targetBagQty}bag 생산 완료.`
        );

        closeQuickPanel();
        await fetchAll();
        return;
      }
    }

    if (action === '재고') {
      const typedName = quickPanel.itemName.trim();
      const found = selectedItem || getMatchedItemByName(typedName, null);

      if (!found) {
        setQuickPanelError('재고 확인할 품목을 입력하거나 선택해줘.');
        return;
      }

      await saveUserMessage(`재고 ${found.name}`, 'chat');
      await saveSystemMessage(
        `${found.name} 현재 재고는 ${found.current_stock}${found.unit} 이야.`
      );
      closeQuickPanel();
      return;
    }

    if (action === '입고' || action === '출고') {
      if (!quickPanel.category) {
        setQuickPanelError('형태를 먼저 선택해줘.');
        return;
      }

      const typedName = quickPanel.itemName.trim();
      let found = selectedItem || getMatchedItemByName(typedName, quickPanel.category);

      if (!typedName && !found) {
        setQuickPanelError('품목을 입력하거나 선택해줘.');
        return;
      }

      if (quickPanel.category === '원료') {
        const kg = Number(quickPanel.kgQty);

        if (!Number.isFinite(kg) || kg <= 0) {
          setQuickPanelError('원료는 kg 수량을 입력해줘.');
          return;
        }

        if (!found) {
          if (action === '출고') {
            setQuickPanelError('없는 품목은 출고할 수 없어.');
            return;
          }

          found = await createInventoryItem(typedName, '원료', 'kg', 0);
        }

        const currentStock = Number(found.current_stock ?? 0);

        if (action === '출고' && currentStock < kg) {
          setQuickPanelError(
            `${found.name} 재고 부족 (현재 ${currentStock}${found.unit})`
          );
          return;
        }

        const newStock = action === '입고' ? currentStock + kg : currentStock - kg;

        await saveUserMessage(
          `${action} ${quickPanel.category} ${found.name} ${kg}kg`,
          'chat'
        );
        await updateInventoryStock(found.id, newStock);
        await insertLog(found.id, action === '입고' ? 'in' : 'out', kg);
        await saveSystemMessage(
          willCreateNewItem
            ? `${found.name} 새 품목 추가 후 ${kg}kg ${action} 완료.`
            : `${found.name} ${kg}kg ${action} 완료.`
        );
        closeQuickPanel();
        await fetchAll();
        return;
      }

      const bagQty = Number(quickPanel.bagQty);
      const kgQty = quickPanel.kgQty.trim() === '' ? null : Number(quickPanel.kgQty);

      if (!Number.isFinite(bagQty) || bagQty <= 0) {
        setQuickPanelError('분쇄품/스크랩은 bag 수를 입력해줘.');
        return;
      }

      if (kgQty !== null && (!Number.isFinite(kgQty) || kgQty < 0)) {
        setQuickPanelError('kg는 비워두거나 숫자로 입력해줘.');
        return;
      }

      if (!found) {
        if (action === '출고') {
          setQuickPanelError('없는 품목은 출고할 수 없어.');
          return;
        }

        found = await createInventoryItem(typedName, quickPanel.category, 'bag', 0);
      }

      const currentStock = Number(found.current_stock ?? 0);

      if (action === '출고' && currentStock < bagQty) {
        setQuickPanelError(
          `${found.name} 재고 부족 (현재 ${currentStock}${found.unit})`
        );
        return;
      }

      const newStock = action === '입고' ? currentStock + bagQty : currentStock - bagQty;
      const kgText = kgQty !== null && kgQty > 0 ? ` / ${kgQty}kg` : '';

      await saveUserMessage(
        `${action} ${quickPanel.category} ${found.name} ${bagQty}bag${kgText}`,
        'chat'
      );
      await updateInventoryStock(found.id, newStock);
      await insertLog(found.id, action === '입고' ? 'in' : 'out', bagQty);
      await saveSystemMessage(
        willCreateNewItem
          ? `${found.name} 새 품목 추가 후 ${bagQty}bag${kgText} ${action} 완료.`
          : `${found.name} ${bagQty}bag${kgText} ${action} 완료.`
      );
      closeQuickPanel();
      await fetchAll();
    }
  }

  async function handleQuickPanelExecute() {
    if (sending) return;

    try {
      setSending(true);
      setErrorText('');
      setQuickPanelError('');
      await runQuickPanelAction();
    } catch (error) {
      const message = getErrorMessage(error);
      setErrorText(message);
      setQuickPanelError(message);
    } finally {
      setSending(false);
    }
  }

  async function handleSaveCategory(itemId: number) {
    const category = categoryDrafts[itemId];
    if (!category || !CATEGORY_OPTIONS.includes(category as InventoryCategory)) {
      setErrorText('카테고리를 선택해줘.');
      return;
    }

    try {
      setSavingCategoryId(itemId);
      setErrorText('');
      await updateInventoryCategory(itemId, category);
      await fetchInventory();
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setSavingCategoryId(null);
    }
  }

  async function handleSaveProfileName(profileId: string) {
    const nextName = (userNameDrafts[profileId] || '').trim();

    if (!nextName) {
      setErrorText('직원 이름을 입력해줘.');
      return;
    }

    try {
      setSavingProfileId(profileId);
      setErrorText('');
      await updateUserName(profileId, nextName);

      if (profileId === currentUserId) {
        setCurrentUserName(nextName);
      }

      await fetchProfiles();
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setSavingProfileId(null);
    }
  }

  async function handleDeleteLog(log: InventoryLogRow) {
    try {
      setDeletingLogId(log.id);
      setErrorText('');
      await deleteLogAndRollback(log);
      await fetchAll();
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setDeletingLogId(null);
    }
  }

  async function handleClearMessages() {
  if (!window.confirm('채팅 기록을 모두 삭제할까요?')) return;
  try {
    setErrorText('');
    const { error } = await supabase.from('messages').delete().neq('id', 0);
    if (error) throw error;
    setMessages([]);
  } catch (error) {
    setErrorText(getErrorMessage(error));
  }
}



  async function handleCreateItem() {
    const name = newItemName.trim();
    const stock = newItemStock.trim() === '' ? 0 : Number(newItemStock);

    if (!name) {
      setErrorText('새 품목명을 입력해줘.');
      return;
    }

    if (!newItemUnit.trim()) {
      setErrorText('단위를 입력해줘.');
      return;
    }

    if (!Number.isFinite(stock) || stock < 0) {
      setErrorText('초기 재고는 0 이상 숫자로 입력해줘.');
      return;
    }

    try {
      setCreatingItem(true);
      setErrorText('');
      await createInventoryItem(name, newItemCategory, newItemUnit.trim(), stock);
      setNewItemName('');
      setNewItemUnit('kg');
      setNewItemStock('');
      setNewItemCategory('원료');
      await fetchInventory();
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setCreatingItem(false);
    }
  }

  async function processLegacyCommand(raw: string) {
    const text = raw.trim();
    const parts = text.split(/\s+/);
    const command = parts[0];
    const itemName = parts[1];
    const qty = Number(parts[2]);

    await saveUserMessage(text, 'command');

    if (command === '/도움말') {
      await saveSystemMessage(
        '사용 가능 명령어: / 또는 /도움말 또는 기존 /재고 /입고 /출고'
      );
      return;
    }

    if (!itemName) {
      await saveSystemMessage('품목명을 같이 입력해줘. 예: /재고 PP백색');
      return;
    }

    const normalizedItemName = itemName.trim().toLowerCase();
    const found = inventory.find(
      (item) => item.name.trim().toLowerCase() === normalizedItemName
    );

    if (!found) {
      await saveSystemMessage(`"${itemName}" 품목을 찾지 못했어.`);
      return;
    }

    if (command === '/재고') {
      await saveSystemMessage(
        `${found.name} 현재 재고는 ${found.current_stock}${found.unit} 이야.`
      );
      return;
    }

    if ((command === '/입고' || command === '/출고') && (!Number.isFinite(qty) || qty <= 0)) {
      await saveSystemMessage('수량은 숫자로 입력해줘. 예: /입고 PP백색 100');
      return;
    }

    if (command === '/입고') {
      const newStock = Number(found.current_stock) + qty;
      await updateInventoryStock(found.id, newStock);
      await insertLog(found.id, 'in', qty);
      await saveSystemMessage(`${found.name} ${qty}${found.unit} 입고 완료.`);
      await fetchAll();
      return;
    }

    if (command === '/출고') {
      if (Number(found.current_stock) < qty) {
        await saveSystemMessage(
          `${found.name} 재고 부족 (현재 ${found.current_stock}${found.unit})`
        );
        return;
      }

      const newStock = Number(found.current_stock) - qty;
      await updateInventoryStock(found.id, newStock);
      await insertLog(found.id, 'out', qty);
      await saveSystemMessage(`${found.name} ${qty}${found.unit} 출고 완료.`);
      await fetchAll();
      return;
    }

    await saveSystemMessage('알 수 없는 명령어야.');
  }
  
  async function handleImageUpload(file: File) {
  if (!currentUserId) return;

  try {
    setSending(true);
    const ext = file.name.split('.').pop();
    const fileName = `${currentUserId}_${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('chat-images')
      .upload(fileName, file);

    if (uploadError) throw uploadError;

    const { data } = supabase.storage
      .from('chat-images')
      .getPublicUrl(fileName);

    await saveUserMessage(data.publicUrl, 'chat');
  } catch (error) {
    setErrorText(getErrorMessage(error));
  } finally {
    setSending(false);
  }
}


  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    try {
      setSending(true);
      setErrorText('');
      setQuickPanelError('');

      if (trimmed === '/') {
        setInput('');
        openQuickPanel();
        return;
      }

      setInput('');

      if (trimmed.startsWith('/')) {
        await processLegacyCommand(trimmed);
        return;
      }

      await saveUserMessage(trimmed, 'chat');
      setTimeout(() => {
        scrollToBottom();
      }, 20);
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setSending(false);
    }
  }

  const chatBottomSpacerClass = quickPanel.isOpen ? 'h-[420px]' : 'h-[0px]';

  if (checkingAuth) return null;

  return (
    <main className="min-h-screen bg-neutral-100 text-neutral-900">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-neutral-50 shadow-sm">
        <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+14px)] backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-neutral-500">입출고 · 재고관리</p>
              <h1 className="text-lg font-bold tracking-tight">
                {activeTab === 'chat'
                  ? '채팅'
                  : activeTab === 'stock'
                    ? '재고'
                    : '입출고 로그'}
              </h1>
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
          <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorText}
          </div>
        )}

        <section
          className={cn(
            'flex-1',
            activeTab === 'chat' ? 'pb-[200px]' : 'overflow-y-auto pb-24'
          )}
        >
          {loading && messages.length === 0 && inventory.length === 0 && logs.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-neutral-500">
              불러오는 중…
            </div>
          ) : null}

          {!loading && activeTab === 'chat' && (
            <div ref={chatScrollRef} className="overflow-y-auto px-3 py-4" style={{ height: '100%' }}>

              <div className="mb-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3">
                <p className="text-sm font-semibold">빠른 사용법</p>
                <p className="mt-1 text-xs leading-5 text-neutral-500">
                  채팅창 왼쪽 ⚡ 버튼을 누르면 빠른입력 열림
                </p>
              </div>

              <div className="space-y-3">
                {messages.map((message) => {
                  const isUser =
                    message.message_type === 'chat' ||
                    message.message_type === 'command';
                  const isCommand = message.message_type === 'command';

                  return (
                    <div
                      key={message.id}
                      className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
                    >
                      <div className="max-w-[84%]">
                        <div
                          className={cn(
                            'rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm',
                            isUser &&
                              !isCommand &&
                              'rounded-br-md bg-neutral-900 text-white',
                            isCommand &&
                              'rounded-br-md border border-blue-200 bg-blue-50 text-blue-900',
                            !isUser &&
                              'rounded-bl-md border border-neutral-200 bg-white text-neutral-800'
                          )}
                        >
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <p
                              className={cn(
                                'text-[11px] font-semibold uppercase tracking-wide',
                                !isUser ? 'text-neutral-400' : isCommand ? 'text-blue-500' : 'text-neutral-300'
                              )}
                            >
                              {!isUser ? 'system' : isCommand ? 'command' : 'chat'}
                            </p>

                            {(message.user_name || message.user_email) && (
                              <p
                                className={cn(
                                  'truncate text-[11px]',
                                  isUser ? 'text-neutral-300' : 'text-neutral-500'
                                )}
                              >
                                {message.user_name || message.user_email}
                              </p>
                            )}
                          </div>

                          {message.content.startsWith('https://') && 
 message.content.includes('chat-images') ? (
  <img 
    src={message.content} 
    alt="uploaded" 
    className="max-w-full rounded-xl"
  />
) : (
  <p className="break-words whitespace-pre-wrap">{message.content}</p>
)}

                        </div>

                        <p
                          className={cn(
                            'mt-1 px-1 text-[11px] text-neutral-400',
                            isUser ? 'text-right' : 'text-left'
                          )}
                        >
                          {formatTime(message.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={chatBottomSpacerClass} />
<div ref={chatBottomRef} />

            </div>
          )}

          {!loading && activeTab === 'stock' && (
            <div className="px-3 py-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <button
                  onClick={() => setStockManageMode(false)}
                  className={cn(
                    'flex-1 rounded-2xl border px-3 py-3 text-sm font-medium',
                    !stockManageMode
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : 'border-neutral-200 bg-white text-neutral-600'
                  )}
                >
                  재고 보기
                </button>
                <button
                  onClick={() => setStockManageMode(true)}
                  className={cn(
                    'flex-1 rounded-2xl border px-3 py-3 text-sm font-medium',
                    stockManageMode
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : 'border-neutral-200 bg-white text-neutral-600'
                  )}
                >
                  관리
                </button>
              </div>

              {!stockManageMode && (
                <>
                  <div className="mb-3 space-y-2">
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {stockTabs.map((category) => (
                        <button
                          key={category}
                          onClick={() => setStockCategory(category)}
                          className={cn(
                            'whitespace-nowrap rounded-full border px-3 py-2 text-sm transition',
                            stockCategory === category
                              ? 'border-neutral-900 bg-neutral-900 text-white'
                              : 'border-neutral-200 bg-white text-neutral-600'
                          )}
                        >
                          {category}
                        </button>
                      ))}
                    </div>

                    <input
                      value={stockSearch}
                      onChange={(e) => setStockSearch(e.target.value)}
                      placeholder={`${stockCategory} 검색`}
                      className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                    />
                  </div>

                  <div className="space-y-3">
                    {filteredStock.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-500">
                        표시할 품목이 없어.
                      </div>
                    ) : (
                      filteredStock.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-base font-semibold">{item.name}</p>
                              <p className="mt-1 text-xs text-neutral-500">
                                {normalizeCategory(item.category)}
                              </p>
                            </div>

                            <div className="shrink-0 text-right">
                              <p className="text-lg font-bold tracking-tight">
                                {Number(item.current_stock).toLocaleString()}
                                <span className="ml-1 text-sm font-medium text-neutral-500">
                                  {item.unit}
                                </span>
                              </p>
                              <p className="mt-1 text-[11px] text-neutral-400">현재 재고</p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}

              {stockManageMode && (
                <div className="space-y-4">
                  <div className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
                    {currentUserEmail === ADMIN_EMAIL && (
  <div className="mb-4 rounded-3xl border border-red-200 bg-red-50 p-4 shadow-sm">
    <p className="mb-3 text-sm font-semibold text-red-700">관리자 메뉴</p>
    <button
      onClick={() => void handleClearMessages()}
      className="w-full rounded-2xl bg-red-600 px-4 py-3 text-sm font-semibold text-white"
    >
      채팅 기록 초기화
    </button>
  </div>
)}
                    <p className="mb-3 text-sm font-semibold">직원 이름 관리</p>
                    <div className="space-y-3">
                      {profiles.length === 0 ? (
                        <p className="text-sm text-neutral-500">직원 정보가 없어.</p>
                      ) : (
                        profiles.map((profile) => (
                          <div
                            key={profile.id}
                            className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3"
                          >
                            <p className="truncate text-xs text-neutral-500">
                              {profile.email || '이메일없음'}
                            </p>
                            <div className="mt-2 flex gap-2">
                              <input
                                value={userNameDrafts[profile.id] ?? ''}
                                onChange={(e) =>
                                  setUserNameDrafts((prev) => ({
                                    ...prev,
                                    [profile.id]: e.target.value,
                                  }))
                                }
                                placeholder="직원 이름"
                                className="flex-1 rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                              />
                              <button
                                onClick={() => void handleSaveProfileName(profile.id)}
                                disabled={savingProfileId === profile.id}
                                className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold text-neutral-700 disabled:opacity-50"
                              >
                                {savingProfileId === profile.id ? '저장중' : '저장'}
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
                    <p className="mb-3 text-sm font-semibold">새 품목 추가</p>

                    <div className="space-y-2">
                      <input
                        value={newItemName}
                        onChange={(e) => setNewItemName(e.target.value)}
                        placeholder="품목명"
                        className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                      />

                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={newItemUnit}
                          onChange={(e) => setNewItemUnit(e.target.value)}
                          placeholder="단위 (kg, bag 등)"
                          className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                        />
                        <input
                          value={newItemStock}
                          onChange={(e) => setNewItemStock(e.target.value)}
                          placeholder="초기 재고"
                          inputMode="decimal"
                          className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        {CATEGORY_OPTIONS.map((category) => (
                          <button
                            key={category}
                            onClick={() => setNewItemCategory(category)}
                            className={cn(
                              'rounded-2xl border px-3 py-3 text-sm font-medium',
                              newItemCategory === category
                                ? 'border-neutral-900 bg-neutral-900 text-white'
                                : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                            )}
                          >
                            {category}
                          </button>
                        ))}
                      </div>

                      <button
                        onClick={() => void handleCreateItem()}
                        disabled={creatingItem}
                        className="w-full rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {creatingItem ? '추가중' : '품목 추가'}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {inventory.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm"
                      >
                        <div className="mb-3">
                          <p className="text-base font-semibold">{item.name}</p>
                          <p className="mt-1 text-xs text-neutral-500">
                            현재: {Number(item.current_stock).toLocaleString()}
                            {item.unit}
                          </p>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          {CATEGORY_OPTIONS.map((category) => (
                            <button
                              key={category}
                              onClick={() =>
                                setCategoryDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: category,
                                }))
                              }
                              className={cn(
                                'rounded-2xl border px-3 py-3 text-sm font-medium',
                                categoryDrafts[item.id] === category
                                  ? 'border-neutral-900 bg-neutral-900 text-white'
                                  : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                              )}
                            >
                              {category}
                            </button>
                          ))}
                        </div>

                        <button
                          onClick={() => void handleSaveCategory(item.id)}
                          disabled={savingCategoryId === item.id}
                          className="mt-3 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold text-neutral-700 disabled:opacity-50"
                        >
                          {savingCategoryId === item.id ? '저장중' : '카테고리 저장'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!loading && activeTab === 'logs' && (
            <div className="px-3 py-4">
              <div className="mb-3 space-y-2">
                <input
                  value={logKeyword}
                  onChange={(e) => setLogKeyword(e.target.value)}
                  placeholder="품목 검색"
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                />

                <div className="flex gap-2">
                  <button
                    onClick={() => setLogFilter('all')}
                    className={cn(
                      'flex-1 rounded-2xl border px-3 py-3 text-sm font-medium',
                      logFilter === 'all'
                        ? 'border-neutral-900 bg-neutral-900 text-white'
                        : 'border-neutral-200 bg-white text-neutral-600'
                    )}
                  >
                    전체
                  </button>
                  <button
                    onClick={() => setLogFilter('in')}
                    className={cn(
                      'flex-1 rounded-2xl border px-3 py-3 text-sm font-medium',
                      logFilter === 'in'
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-neutral-200 bg-white text-neutral-600'
                    )}
                  >
                    입고
                  </button>
                  <button
                    onClick={() => setLogFilter('out')}
                    className={cn(
                      'flex-1 rounded-2xl border px-3 py-3 text-sm font-medium',
                      logFilter === 'out'
                        ? 'border-red-600 bg-red-600 text-white'
                        : 'border-neutral-200 bg-white text-neutral-600'
                    )}
                  >
                    출고
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {filteredLogs.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-500">
                    표시할 로그가 없어.
                  </div>
                ) : (
                  filteredLogs.map((log) => {
                    const isIn = log.action === 'in';
                    const item = inventoryMap.get(log.item_id);

                    return (
                      <div
                        key={log.id}
                        className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-base font-semibold">
                              {item?.name ?? `품목#${log.item_id}`}
                            </p>
                            <p className="mt-1 text-xs text-neutral-500">
                              {formatDateTime(log.created_at)}
                            </p>
                            {(log.user_name || log.user_email) && (
                              <p className="mt-1 truncate text-xs text-neutral-500">
                                작성: {log.user_name || log.user_email}
                              </p>
                            )}
                            {log.note && (
                              <p className="mt-1 text-xs text-blue-600">{log.note}</p>
                            )}
                          </div>

                          <span
                            className={cn(
                              'rounded-full px-2.5 py-1 text-xs font-semibold',
                              isIn
                                ? 'bg-emerald-50 text-emerald-600'
                                : 'bg-red-50 text-red-600'
                            )}
                          >
                            {isIn ? '입고' : '출고'}
                          </span>
                        </div>

                        <div className="mt-4">
                          <p className="text-xs text-neutral-400">수량</p>
                          <p className="mt-1 text-2xl font-bold tracking-tight">
                            {Number(log.qty).toLocaleString()}
                            <span className="ml-1 text-base font-medium text-neutral-500">
                              {item?.unit ?? ''}
                            </span>
                          </p>
                        </div>

                        <button
                          onClick={() => void handleDeleteLog(log)}
                          disabled={deletingLogId === log.id}
                          className="mt-4 w-full rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 disabled:opacity-50"
                        >
                          {deletingLogId === log.id ? '삭제중' : '로그 삭제 + 재고복구'}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </section>

        {activeTab === 'chat' && (
          <div className="fixed bottom-[72px] left-1/2 z-20 w-full max-w-md -translate-x-1/2 bg-gradient-to-t from-neutral-50 via-neutral-50 to-transparent px-3 pb-3 pt-4">
            {quickPanel.isOpen && (
              <div className="mb-2 rounded-3xl border border-neutral-200 bg-white p-3 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold text-neutral-500">빠른 입력</p>
                  <button
                    onClick={() => closeQuickPanel()}
                    className="rounded-full border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600"
                  >
                    닫기
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <p className="mb-2 text-xs text-neutral-500">작업</p>
                    <div className="grid grid-cols-4 gap-2">
                      {(['재고', '입고', '출고', '생산'] as QuickAction[]).map((action) => (
                        <button
                          key={action}
                          onClick={() => setQuickAction(action)}
                          className={cn(
                            'rounded-2xl border px-2 py-3 text-xs font-medium',
                            quickPanel.action === action
                              ? 'border-neutral-900 bg-neutral-900 text-white'
                              : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                          )}
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  </div>

                  {quickPanel.action === '생산' && (
                    <div className="space-y-3">
                      <div>
                        <p className="mb-2 text-xs text-neutral-500">생산 종류</p>
                        <div className="grid grid-cols-2 gap-2">
                          {(['원료생산', '분쇄품생산'] as ProductionType[]).map((type) => (
                            <button
                              key={type}
                              onClick={() => setProductionType(type)}
                              className={cn(
                                'rounded-2xl border px-3 py-3 text-sm font-medium',
                                quickPanel.productionType === type
                                  ? 'border-neutral-900 bg-neutral-900 text-white'
                                  : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                              )}
                            >
                              {type}
                            </button>
                          ))}
                        </div>
                      </div>

                      {quickPanel.productionType && (
                        <>
                          <div>
                            <p className="mb-2 text-xs text-neutral-500">
                              사용 품목
                              {quickPanel.productionType === '원료생산'
                                ? ' (분쇄품)'
                                : ' (스크랩)'}
                            </p>

                            <div className="max-h-24 overflow-y-auto">
                              <div className="flex flex-wrap gap-2">
                                {productionSourceItems.length === 0 ? (
                                  <p className="text-xs text-neutral-500">선택 가능한 품목이 없어.</p>
                                ) : (
                                  productionSourceItems.map((item) => (
                                    <button
                                      key={item.id}
                                      onClick={() =>
                                        setQuickPanel((prev) => ({
                                          ...prev,
                                          sourceItemId: item.id,
                                        }))
                                      }
                                      className={cn(
                                        'rounded-full border px-3 py-2 text-sm',
                                        quickPanel.sourceItemId === item.id
                                          ? 'border-neutral-900 bg-neutral-900 text-white'
                                          : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                                      )}
                                    >
                                      {item.name}
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          </div>

                          <div>
                            <p className="mb-2 text-xs text-neutral-500">사용량 bag</p>
                            <input
                              value={quickPanel.sourceBagQty}
                              onChange={(e) => {
                                setQuickPanel((prev) => ({
                                  ...prev,
                                  sourceBagQty: e.target.value,
                                }));
                                setQuickPanelError('');
                              }}
                              placeholder="사용 bag 수"
                              inputMode="numeric"
                              className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                            />
                          </div>

                          <div>
                            <p className="mb-2 text-xs text-neutral-500">
                              결과 품목
                              {quickPanel.productionType === '원료생산'
                                ? ' (원료)'
                                : ' (분쇄품)'}
                            </p>

                            <input
                              value={quickPanel.targetItemName}
                              onChange={(e) => {
                                setQuickPanel((prev) => ({
                                  ...prev,
                                  targetItemName: e.target.value,
                                  targetItemId: null,
                                }));
                                setQuickPanelError('');
                              }}
                              placeholder="결과 품목 직접 입력 가능"
                              className="mb-2 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                            />

                            <div className="max-h-24 overflow-y-auto">
                              <div className="flex flex-wrap gap-2">
                                {productionTargetItems.length === 0 ? (
                                  <p className="text-xs text-neutral-500">선택 가능한 품목이 없어.</p>
                                ) : (
                                  productionTargetItems.map((item) => (
                                    <button
                                      key={item.id}
                                      onClick={() =>
                                        setQuickPanel((prev) => ({
                                          ...prev,
                                          targetItemId: item.id,
                                          targetItemName: item.name,
                                        }))
                                      }
                                      className={cn(
                                        'rounded-full border px-3 py-2 text-sm',
                                        quickPanel.targetItemId === item.id
                                          ? 'border-neutral-900 bg-neutral-900 text-white'
                                          : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                                      )}
                                    >
                                      {item.name}
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>

                            {willCreateProductionTargetItem && (
                              <div className="mt-2 rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                                이 결과 품목은 아직 없어서 실행하면 <b>{quickPanel.productionType === '원료생산' ? '원료' : '분쇄품'}</b> 카테고리의 새 품목으로 추가돼.
                              </div>
                            )}
                          </div>

                          {quickPanel.productionType === '원료생산' && (
                            <div>
                              <p className="mb-2 text-xs text-neutral-500">생산량 kg</p>
                              <input
                                value={quickPanel.targetKgQty}
                                onChange={(e) => {
                                  setQuickPanel((prev) => ({
                                    ...prev,
                                    targetKgQty: e.target.value,
                                  }));
                                  setQuickPanelError('');
                                }}
                                placeholder="생산된 원료 kg"
                                inputMode="decimal"
                                className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                              />
                            </div>
                          )}

                          {quickPanel.productionType === '분쇄품생산' && (
                            <div>
                              <p className="mb-2 text-xs text-neutral-500">생산량 bag</p>
                              <input
                                value={quickPanel.targetBagQty}
                                onChange={(e) => {
                                  setQuickPanel((prev) => ({
                                    ...prev,
                                    targetBagQty: e.target.value,
                                  }));
                                  setQuickPanelError('');
                                }}
                                placeholder="생산된 분쇄품 bag"
                                inputMode="numeric"
                                className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                              />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {(quickPanel.action === '입고' || quickPanel.action === '출고') && (
                    <div>
                      <p className="mb-2 text-xs text-neutral-500">형태</p>
                      <div className="grid grid-cols-3 gap-2">
                        {CATEGORY_OPTIONS.map((category) => (
                          <button
                            key={category}
                            onClick={() => setQuickCategory(category)}
                            className={cn(
                              'rounded-2xl border px-3 py-3 text-sm font-medium',
                              quickPanel.category === category
                                ? 'border-neutral-900 bg-neutral-900 text-white'
                                : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                            )}
                          >
                            {category}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {quickPanel.action && quickPanel.action !== '생산' && (
                    <div>
                      <p className="mb-2 text-xs text-neutral-500">품목</p>
                      <input
                        value={quickPanel.itemName}
                        onChange={(e) => {
                          setQuickPanel((prev) => ({
                            ...prev,
                            itemName: e.target.value,
                            selectedItemId: null,
                          }));
                          setQuickPanelError('');
                        }}
                        placeholder="품목명 입력"
                        className="mb-2 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                      />

                      <div className="max-h-24 overflow-y-auto">
                        <div className="flex flex-wrap gap-2">
                          {quickPanelItems.length === 0 ? (
                            <p className="text-xs text-neutral-500">
                              선택 가능한 기존 품목이 없어. 직접 입력해도 돼.
                            </p>
                          ) : (
                            quickPanelItems.map((item) => (
                              <button
                                key={item.id}
                                onClick={() => selectQuickItem(item)}
                                className={cn(
                                  'rounded-full border px-3 py-2 text-sm',
                                  quickPanel.selectedItemId === item.id
                                    ? 'border-neutral-900 bg-neutral-900 text-white'
                                    : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                                )}
                              >
                                {item.name}
                              </button>
                            ))
                          )}
                        </div>
                      </div>

                      {willCreateNewItem && (
                        <div className="mt-2 rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                          이 품목은 아직 없어서 실행하면 <b>{quickPanel.category}</b> 카테고리의 새 품목으로 추가돼.
                        </div>
                      )}
                    </div>
                  )}

                  {(quickPanel.action === '입고' || quickPanel.action === '출고') &&
                    (quickPanel.category === '원료' ? (
                      <div>
                        <p className="mb-2 text-xs text-neutral-500">kg</p>
                        <input
                          value={quickPanel.kgQty}
                          onChange={(e) => {
                            setQuickPanel((prev) => ({ ...prev, kgQty: e.target.value }));
                            setQuickPanelError('');
                          }}
                          placeholder="kg 수량"
                          inputMode="decimal"
                          className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                        />
                      </div>
                    ) : quickPanel.category ? (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="mb-2 text-xs text-neutral-500">bag</p>
                          <input
                            value={quickPanel.bagQty}
                            onChange={(e) => {
                              setQuickPanel((prev) => ({ ...prev, bagQty: e.target.value }));
                              setQuickPanelError('');
                            }}
                            placeholder="bag 수"
                            inputMode="numeric"
                            className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                          />
                        </div>
                        <div>
                          <p className="mb-2 text-xs text-neutral-500">kg (선택)</p>
                          <input
                            value={quickPanel.kgQty}
                            onChange={(e) => {
                              setQuickPanel((prev) => ({ ...prev, kgQty: e.target.value }));
                              setQuickPanelError('');
                            }}
                            placeholder="없으면 비워둬"
                            inputMode="decimal"
                            className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                          />
                        </div>
                      </div>
                    ) : null)}

                  <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                    {quickSummary ? `선택값: ${quickSummary}` : '아직 선택된 값이 없어.'}
                  </div>

                  {quickPanelError && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {quickPanelError}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => closeQuickPanel()}
                      className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-700"
                    >
                      취소
                    </button>
                    <button
                      onClick={() => void handleQuickPanelExecute()}
                      disabled={sending}
                      className="rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {sending ? '처리중' : '실행'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-3xl border border-neutral-200 bg-white p-2 shadow-lg">
              <div className="flex items-end gap-2">
                <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-2xl border border-neutral-200 bg-neutral-50 text-lg">

  <span className="text-lg">📷</span>
  <input
    type="file"
    accept="image/*"
    className="hidden"
    onChange={(e) => {
      const file = e.target.files?.[0];
      if (file) void handleImageUpload(file);
      e.target.value = '';
    }}
  />
</label>

                <button
                  onClick={() => openQuickPanel()}
                  type="button"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-neutral-200 bg-neutral-50 text-lg"
                  aria-label="빠른입력 열기"
                  title="빠른입력"
                >
                  ⚡
                </button>

                <textarea
                  value={input}
                  onChange={(e) => {
                    const value = e.target.value;
                    setInput(value);

                    if (value.trim() === '/' && !quickPanel.isOpen) {
                      openQuickPanel();
                    }
                  }}
                  placeholder="메시지 입력 또는 ⚡로 빠른입력"
                  rows={1}
                  className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border-0 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-neutral-400 placeholder:text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                />
                <button
                  onClick={() => void handleSend()}
                  disabled={sending}
                  className="rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {sending ? '처리중' : '전송'}
                </button>
              </div>
            </div>
          </div>
        )}

        <nav className="fixed bottom-0 left-1/2 z-30 w-full max-w-md -translate-x-1/2 border-t border-neutral-200 bg-white/95 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2 backdrop-blur">
          <div className="grid grid-cols-3 gap-2 px-3">
            <TabButton
              label="채팅"
              icon="💬"
              active={activeTab === 'chat'}
              onClick={() => setActiveTab('chat')}
            />
            <TabButton
              label="재고"
              icon="📦"
              active={activeTab === 'stock'}
              onClick={() => setActiveTab('stock')}
            />
            <TabButton
              label="입출고"
              icon="🧾"
              active={activeTab === 'logs'}
              onClick={() => setActiveTab('logs')}
            />
          </div>
        </nav>
      </div>
    </main>
  );
}

function TabButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl px-3 py-2 transition',
        active ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-500'
      )}
    >
      <span className="text-base">{icon}</span>
      <span className="mt-1 text-xs font-medium">{label}</span>
    </button>
  );
}
