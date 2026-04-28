export type TabKey = 'chat' | 'calendar' | 'stock' | 'settlement';
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

export type Invoice = {
  id: number;
  company_id?: number | null;
  company_name: string;
  direction: 'receivable' | 'payable';
  date: string;
  invoice_issued: boolean;
  payment_done: boolean;
  factory?: string | null;
  note?: string | null;
  created_at: string;
  items?: InvoiceItem[];
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
};

export type QuickPanelState = {
  isOpen: boolean;
  date: string;
  productionEndDate: string;
  companyId: number | null;
  companyName: string;
  action: QuickAction | null;
  category: InventoryCategory | null;
  // 입고/출고 다중 품목
  inoutItems: InOutItem[];
  productionType: ProductionType | null;
  sources: ProductionSource[];
  targetItemId: number | null;
  targetItemName: string;
  targetBagQty: string;
  targetKgQty: string;
};
