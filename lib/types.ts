export type TabKey = 'chat' | 'calendar' | 'stock' | 'settlement' | 'finance-calendar';
export type MessageType = 'chat' | 'command' | 'system';
export type InventoryCategory = '원료' | '분쇄품' | '스크랩';
export type QuickAction = '재고' | '입고' | '출고' | '생산';
export type ProductionType = '원료생산' | '분쇄품생산';

export type InventoryItem = {
  id: number;
  name: string;
  current_stock: number;
  unit: string;
  category?: string | null;
  memo?: string | null;
};

export type MessageRow = {
  id: number;
  content: string;
  message_type: MessageType;
  created_at: string;
  user_id?: string | null;
  user_email?: string | null;
  user_name?: string | null;
  is_important?: boolean | null;
  parent_id?: number | null;
  source?: 'user' | 'system' | 'quick_input' | null;
};

export type InventoryLogRow = {
  id: number;
  item_id: number;
  action: 'in' | 'out';
  qty: number;
  created_at: string;
  date?: string | null;
  note?: string | null;
  user_id?: string | null;
  user_email?: string | null;
  user_name?: string | null;
  company_id?: number | null;
  company_name?: string | null;
  bag_count?: number | null;
  kg_weight?: number | null;
  is_settled?: boolean | null;
};

export type CompanyMemo = {
  id: string;
  company_id: number;
  content: string;
  created_at: string;
  updated_at: string;
};

export type UserProfile = {
  id: string;
  email: string | null;
  name: string | null;
};

export type Company = {
  id: number;
  name: string;
  memo?: string | null;
  is_favorite: boolean;
  created_at: string;
};

export type InvoiceItem = {
  id: number;
  invoice_id: number;
  item_name?: string | null;
  quantity: number;
  unit_price: number;
  supply_amount: number;
  tax_amount: number;
};

export type Payment = {
  id: number;
  invoice_id: number;
  amount: number;
  date: string;
  memo?: string | null;
  created_at: string;
};

export type Invoice = {
  id: number;
  company_id?: number | null;
  company_name: string;
  direction: 'receivable' | 'payable';
  date: string;
  due_date?: string | null;
  invoice_status: 'issued' | 'scheduled' | 'none';
  payment_done: boolean;
  factory?: string | null;
  note?: string | null;
  created_at: string;
  items?: InvoiceItem[];
};

export type UnitPrice = {
  id: string;
  inventory_item_id: number;
  unit_price: number;
  memo?: string | null;
  created_at: string;
  updated_at: string;
};

export type CashFlow = {
  id: number;
  date: string;
  amount: number; // 양수=수입, 음수=지출
  category?: string | null;
  memo?: string | null;
  is_recurring: boolean;
  recurring_day?: number | null;
  invoice_id?: number | null;
  status?: 'planned' | 'done' | null;
  created_at: string;
};

export type ProductionSource = {
  itemId: number | null;
  customName: string;
  bagQty: string;
};

// 입고/출고 다중 품목 한 줄
export type InOutItem = {
  itemId: number | null;
  itemName: string;
  bagQty: string;
  kgQty: string;
  itemCategory: InventoryCategory | null;
};

export type QuickPanelState = {
  isOpen: boolean;
  date: string;
  productionEndDate: string;
  companyId: number | null;
  companyName: string;
  action: QuickAction | null;
  category: InventoryCategory | null;
  memo: string;
  inoutItems: InOutItem[];
  productionType: ProductionType | null;
  sources: ProductionSource[];
  targetItemId: number | null;
  targetItemName: string;
  targetBagQty: string;
  targetKgQty: string;
};
