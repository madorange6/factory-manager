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
  is_monthly_settlement?: boolean | null;
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
  invoice_id: number | null;
  amount: number;
  date: string;
  memo?: string | null;
  created_at: string;
  settlement_group_id?: number | null;
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
  settlement_group_id?: number | null;
};

export type SettlementGroup = {
  id: number;
  company_id: number;
  name: string;
  due_date?: string | null;
  invoice_status: string;
  created_at: string;
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

export type DeliveryNoteTemplate = {
  id: number;
  company_id: number;
  factory: string;
  template_xlsx: string; // base64
  data_start_row: number;
  col_date: number;
  col_item: number | null;
  col_qty: number;
  col_price: number;
  col_amount: number;
  col_note: number | null;
  month_cell_row: number;
  month_cell_col: number;
  category_cols: Record<string, { col: number; prefix: string }>;
  created_at: string;
};

export type OlbaroCompany = {
  id: number;
  factory: string;
  company_name: string;
  company_id: string | null;
  representative: string | null;
  address: string | null;
  address_detail: string | null;
  direction: 'in' | 'out';
};

export type OlbaroRecord = {
  id: number;
  factory: string;
  transaction_date: string;
  direction: 'in' | 'out';
  completed_at: string | null;
  created_at: string;
};

export type Vehicle = {
  id: string;
  name: string;
  plate_number: string;
  inspection_date: string;
  recipient_phone: string;
  inspection_cycle: number;
  is_inspected: boolean;
  inspected_at: string | null;
  insurance_date: string | null;
  insurance_recipient_phone: string | null;
  insurance_memo: string | null;
  is_insured: boolean;
  insured_at: string | null;
  telegram_notify: boolean;
  telegram_notify_days: number;
  created_at: string;
  updated_at: string;
};

export type Insurance = {
  id: number;
  insurance_name: string;
  insurance_type: '차량' | '화재';
  vehicle_id: string | null;
  insurance_company: string | null;
  expiry_date: string;
  premium: number | null;
  recipient_phone: string | null;
  memo: string | null;
  notify_sms: boolean;
  notify_telegram: boolean;
  created_at: string;
  updated_at: string;
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

export type TaxType = {
  id: number;
  name: string;
  created_at: string;
};

export type TaxSchedule = {
  id: number;
  tax_type_id?: number | null;
  tax_name: string;
  due_date: string;
  total_amount: number;
  memo?: string | null;
  created_at: string;
};

export type TaxPayment = {
  id: number;
  tax_schedule_id: number;
  seq: number;
  payment_date: string;
  amount: number;
  is_paid: boolean;
  is_extended: boolean;
  memo?: string | null;
  paid_at?: string | null;
  created_at: string;
};

export type Loan = {
  id: number;
  loan_name: string;
  bank_name?: string | null;
  principal: number;
  interest_rate?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  grace_period_months: number;
  memo?: string | null;
  is_active: boolean;
  created_at: string;
};

export type LoanSchedule = {
  id: number;
  loan_id: number;
  seq: number;
  payment_date: string;
  principal: number;
  interest: number;
  total_payment: number;
  remaining_principal: number;
  is_grace_period: boolean;
  is_paid: boolean;
  paid_at?: string | null;
  memo?: string | null;
  created_at: string;
};

export type VehicleInsurance = {
  id: number;
  vehicle_id: string;
  insurance_name: string;
  insurance_company?: string | null;
  expiry_date: string;
  premium?: number | null;
  memo?: string | null;
  is_active: boolean;
  created_at: string;
};

export type ChatNotification = {
  id: number;
  chat_id: number;
  notification_type: 'dday' | 'repeat';
  target_date?: string | null;
  alert_days?: number[] | null;
  repeat_type?: 'daily' | 'weekly' | 'monthly' | null;
  repeat_time: string;
  repeat_day_of_week?: number | null;
  repeat_day_of_month?: number | null;
  is_active: boolean;
  created_at: string;
};

export type TodoScheduleTask = {
  id: number;
  schedule_id: number;
  title: string;
  is_completed: boolean;
  created_at: string;
};

export type TodoSchedule = {
  id: number;
  title: string;
  start_date: string;
  end_date: string;
  color: 'yellow' | 'green' | 'blue' | 'pink';
  created_at: string;
  todo_schedule_tasks?: TodoScheduleTask[];
};

export type TodoMatrixItem = {
  id: number;
  date: string;
  quadrant: 'urgent_important' | 'urgent_not_important' | 'not_urgent_important' | 'not_urgent_not_important';
  title: string;
  estimated_minutes: number | null;
  is_completed: boolean;
  memo: string | null;
  schedule_task_id: number | null;
  is_postponed: boolean;
  postponed_from_date: string | null;
  postponed_to_date: string | null;
  notify_enabled: boolean;
  notify_hour_kst: number | null;
  created_at: string;
};

export type TodoMatrixSubtask = {
  id: number;
  matrix_item_id: number;
  title: string;
  is_completed: boolean;
  created_at: string;
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
