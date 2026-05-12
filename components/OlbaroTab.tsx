'use client';

import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase/client';
import { OlbaroCompany } from '../lib/types';
import { getErrorMessage } from '../lib/utils';

type Factory = '1공장' | '2공장';

type ParsedRow = {
  uid: string;
  date: string;
  companyName: string;
  itemName: string;
  qty: number;
  direction: 'in' | 'out';
  checked: boolean;
};

type PendingRecord = {
  id: number;
  factory: string;
  transaction_date: string;
  direction: 'in' | 'out';
  completed_at: string | null;
};

function cn(...cls: Array<string | false | null | undefined>) {
  return cls.filter(Boolean).join(' ');
}

function parseExcelDate(raw: unknown): string {
  if (typeof raw === 'number') {
    // Excel serial date (days since 1900-01-00)
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = String(raw ?? '').replace(/\./g, '-').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
}

function parseQty(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  return parseFloat(String(raw ?? '').replace(/,/g, '')) || 0;
}

function formatDateForOlbaro(dateStr: string): string {
  // "2026-05-11" → "5/11/26"
  const [y, m, d] = dateStr.split('-');
  return `${parseInt(m)}/${parseInt(d)}/${y.slice(2)}`;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysDiff(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - target.getTime()) / 86400000);
}

export default function OlbaroTab() {
  const [factory, setFactory] = useState<Factory>('1공장');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [companies, setCompanies] = useState<OlbaroCompany[]>([]);
  const [pendingRecords, setPendingRecords] = useState<PendingRecord[]>([]);
  const [errorText, setErrorText] = useState('');
  const [showMgmt, setShowMgmt] = useState(false);
  const [newCo, setNewCo] = useState<Partial<OlbaroCompany & { direction: 'in' | 'out' }>>({});
  const [editId, setEditId] = useState<number | null>(null);
  const [editCo, setEditCo] = useState<Partial<OlbaroCompany>>({});

  const inRef = useRef<HTMLInputElement>(null);
  const outRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetchCompanies();
    void fetchPending();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factory]);

  async function fetchCompanies() {
    const { data, error } = await supabase
      .from('olbaro_companies')
      .select('*')
      .eq('factory', factory)
      .order('company_name');
    if (error) { setErrorText(getErrorMessage(error)); return; }
    setCompanies((data ?? []) as OlbaroCompany[]);
  }

  async function fetchPending() {
    const { data, error } = await supabase
      .from('olbaro_records')
      .select('id, factory, transaction_date, direction, completed_at')
      .eq('factory', factory)
      .is('completed_at', null);
    if (error) { setErrorText(getErrorMessage(error)); return; }
    setPendingRecords((data ?? []) as PendingRecord[]);
  }

  function parseFile(file: File, direction: 'in' | 'out') {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const raw = e.target?.result;
        const wb = XLSX.read(raw, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const sheet = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });

        const newRows: ParsedRow[] = [];
        // row index 4 = header (row5), row index 5+ = data (row6+)
        for (let i = 5; i < sheet.length; i++) {
          const row = sheet[i] as unknown[];
          const dateRaw = row[0];
          if (!dateRaw) continue;

          const date = parseExcelDate(dateRaw);
          if (!date || date.length < 8) continue;

          const companyName = direction === 'in'
            ? String(row[6] ?? '').trim()
            : String(row[11] ?? '').trim();
          const itemName = String(row[26] ?? '').trim();
          const qty = parseQty(row[28]);

          if (!companyName) continue;

          newRows.push({
            uid: `${direction}-${i}-${Math.random()}`,
            date,
            companyName,
            itemName,
            qty,
            direction,
            checked: true,
          });
        }

        setRows((prev) => [...prev.filter((r) => r.direction !== direction), ...newRows]);
      } catch (err) {
        setErrorText(getErrorMessage(err));
      }
    };
    reader.readAsBinaryString(file);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>, direction: 'in' | 'out') {
    const file = e.target.files?.[0];
    if (!file) return;
    parseFile(file, direction);
    e.target.value = '';
  }

  function toggleRow(uid: string) {
    setRows((prev) => prev.map((r) => r.uid === uid ? { ...r, checked: !r.checked } : r));
  }

  function updateRow(uid: string, field: 'itemName' | 'qty', value: string) {
    setRows((prev) => prev.map((r) => {
      if (r.uid !== uid) return r;
      if (field === 'qty') return { ...r, qty: parseFloat(value) || 0 };
      return { ...r, itemName: value };
    }));
  }

  function getCoInfo(companyName: string, direction: 'in' | 'out'): OlbaroCompany | undefined {
    return companies.find((c) => c.company_name === companyName && c.direction === direction);
  }

  // D-day 배너: DB에 pending 기록된 항목 기준
  const banners = pendingRecords
    .map((rec) => {
      const diff = daysDiff(rec.transaction_date);
      if (diff < 7) return null;
      const label = rec.direction === 'in' ? '입고' : '출고';
      return {
        msg: `⚠️ ${rec.transaction_date} ${label} 건 아직 미작성입니다 (D+${diff})`,
        level: diff >= 10 ? 'danger' : 'warning',
      } as const;
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);

  async function downloadRecycle() {
    const checked = rows.filter((r) => r.checked);
    if (checked.length === 0) { setErrorText('선택된 항목이 없습니다.'); return; }

    const unregistered = checked.filter((r) => !getCoInfo(r.companyName, r.direction));
    if (unregistered.length > 0) {
      const names = [...new Set(unregistered.map((r) => `${r.companyName}(${r.direction === 'in' ? '매입' : '매출'})`))]
      setErrorText(`미등록 거래처: ${names.join(', ')}`);
      return;
    }

    const sorted = [...checked].sort((a, b) => a.date.localeCompare(b.date));

    // 2행 헤더
    const h1 = Array<string | number>(35).fill('');
    const h2 = Array<string | number>(35).fill('');
    h2[3] = '생산/공급일자'; h2[4] = '작성일자'; h2[5] = '폐기물종류'; h2[6] = '폐기물코드';
    h2[8] = '성상'; h2[9] = '구분'; h2[10] = '재활용제품'; h2[13] = '재활용제품코드';
    h2[15] = '생산량'; h2[16] = '단위'; h2[17] = '공급량'; h2[18] = '단위';
    h2[24] = '업체명'; h2[25] = '업체번호'; h2[26] = '대표자'; h2[28] = '주소';
    h2[29] = '상세주소'; h2[33] = '기간초과작성유무';

    const dataRows = sorted.map((r) => {
      const co = getCoInfo(r.companyName, r.direction)!;
      const row = Array<string | number>(35).fill('');
      row[3] = formatDateForOlbaro(r.date);
      row[4] = todayStr();
      row[5] = '폐합성수지류(폐염화비닐수지류는 제외한다)';
      row[6] = '510301';
      row[8] = '고상';
      row[9] = '재활용 제품/물질';
      row[10] = r.itemName;
      row[13] = '0002';
      if (r.direction === 'in') {
        row[15] = r.qty; row[16] = 'kg';
      } else {
        row[17] = r.qty; row[18] = 'kg';
      }
      row[24] = co.company_name;
      row[25] = co.company_id ?? '';
      row[26] = co.representative ?? '';
      row[28] = co.address ?? '';
      row[29] = co.address_detail ?? '';
      row[33] = 'No';
      return row;
    });

    const ws = XLSX.utils.aoa_to_sheet([h1, h2, ...dataRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '재활용제품_공급_및_보관내용');
    XLSX.writeFile(wb, '재활용제품_공급_및_보관내용.xlsx');

    await recordCompletion(checked);
  }

  async function downloadWaste() {
    const checked = rows.filter((r) => r.checked && r.direction === 'in');
    if (checked.length === 0) { setErrorText('선택된 매입 항목이 없습니다.'); return; }

    const unregistered = checked.filter((r) => !getCoInfo(r.companyName, 'in'));
    if (unregistered.length > 0) {
      const names = [...new Set(unregistered.map((r) => r.companyName))];
      setErrorText(`미등록 거래처: ${names.join(', ')}`);
      return;
    }

    const sorted = [...checked].sort((a, b) => a.date.localeCompare(b.date));

    const header = [
      '', '', '', '인수/재활용일자', '폐기물종류', '폐기물코드', '성상',
      '위탁업체식별번호', '위탁업체명', '수집량', '단위', '재활용방법',
      '폐기물재활용량', '단위', '', '자동생성여부',
    ];

    const dataRows = sorted.map((r) => {
      const co = getCoInfo(r.companyName, 'in')!;
      const row = Array<string | number>(16).fill('');
      row[3] = formatDateForOlbaro(r.date);
      row[4] = '폐합성수지류(폐염화비닐수지류는 제외한다)';
      row[5] = '510301';
      row[6] = '고상';
      row[7] = co.company_id ?? '';
      row[8] = co.company_name;
      row[9] = r.qty; row[10] = 'kg';
      row[11] = '(2010)중간가공폐기물 제조(재)(위탁)';
      row[12] = r.qty; row[13] = 'kg';
      row[15] = 'No';
      return row;
    });

    const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '폐기물_재활용내용');
    XLSX.writeFile(wb, '폐기물_재활용내용.xlsx');

    await recordCompletion(checked);
  }

  async function recordCompletion(checkedRows: ParsedRow[]) {
    const now = new Date().toISOString();
    const inserts = checkedRows.map((r) => ({
      factory,
      transaction_date: r.date,
      direction: r.direction,
      completed_at: now,
    }));
    const { error } = await supabase.from('olbaro_records').insert(inserts);
    if (error) console.error(error);
    void fetchPending();
  }

  async function addCompany() {
    if (!newCo.company_name?.trim() || !newCo.direction) return;
    const { error } = await supabase.from('olbaro_companies').insert({
      factory,
      company_name: newCo.company_name.trim(),
      company_id: newCo.company_id?.trim() || null,
      representative: newCo.representative?.trim() || null,
      address: newCo.address?.trim() || null,
      address_detail: newCo.address_detail?.trim() || null,
      direction: newCo.direction,
    });
    if (error) { setErrorText(getErrorMessage(error)); return; }
    setNewCo({});
    void fetchCompanies();
  }

  async function deleteCompany(id: number) {
    const { error } = await supabase.from('olbaro_companies').delete().eq('id', id);
    if (error) { setErrorText(getErrorMessage(error)); return; }
    void fetchCompanies();
  }

  async function saveEditCompany() {
    if (!editId) return;
    const { error } = await supabase.from('olbaro_companies').update({
      company_name: editCo.company_name?.trim(),
      company_id: editCo.company_id?.trim() || null,
      representative: editCo.representative?.trim() || null,
      address: editCo.address?.trim() || null,
      address_detail: editCo.address_detail?.trim() || null,
      direction: editCo.direction,
    }).eq('id', editId);
    if (error) { setErrorText(getErrorMessage(error)); return; }
    setEditId(null);
    setEditCo({});
    void fetchCompanies();
  }

  const inRows = rows.filter((r) => r.direction === 'in');
  const outRows = rows.filter((r) => r.direction === 'out');

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* 공장 선택 */}
      <div className="flex gap-2">
        {(['1공장', '2공장'] as Factory[]).map((f) => (
          <button
            key={f}
            onClick={() => setFactory(f)}
            className={cn(
              'rounded-full border px-4 py-1.5 text-sm font-semibold',
              factory === f
                ? 'border-blue-500 bg-blue-500 text-white'
                : 'border-neutral-300 bg-white text-neutral-700',
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* D-day 배너 */}
      {banners.map((b, i) => (
        <div
          key={i}
          className={cn(
            'rounded-lg px-4 py-2.5 text-sm font-medium',
            b.level === 'danger' ? 'bg-red-100 text-red-800' : 'bg-orange-100 text-orange-800',
          )}
        >
          {b.msg}
        </div>
      ))}

      {/* 에러 */}
      {errorText && (
        <div className="flex items-center justify-between rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">
          <span>{errorText}</span>
          <button onClick={() => setErrorText('')} className="ml-2 shrink-0 underline">닫기</button>
        </div>
      )}

      {/* 파일 업로드 */}
      <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4">
        <p className="text-xs font-semibold text-neutral-500">파일 업로드 (홈택스 .xls)</p>
        <div className="flex gap-2">
          <input ref={inRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={(e) => handleFile(e, 'in')} />
          <button
            onClick={() => inRef.current?.click()}
            className="flex-1 rounded-lg border border-neutral-300 bg-neutral-50 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
          >
            매입 계산서
            {inRows.length > 0 && <span className="ml-1 font-bold text-blue-600">({inRows.length}건)</span>}
          </button>
          <input ref={outRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={(e) => handleFile(e, 'out')} />
          <button
            onClick={() => outRef.current?.click()}
            className="flex-1 rounded-lg border border-neutral-300 bg-neutral-50 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
          >
            매출 계산서
            {outRows.length > 0 && <span className="ml-1 font-bold text-blue-600">({outRows.length}건)</span>}
          </button>
        </div>
      </div>

      {/* 파싱 목록 */}
      {rows.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-neutral-500">파싱된 목록</p>
            <button onClick={() => setRows([])} className="text-xs text-neutral-400 underline">
              전체 삭제
            </button>
          </div>

          {[
            { label: '매입', list: inRows, direction: 'in' as const },
            { label: '매출', list: outRows, direction: 'out' as const },
          ].map(({ label, list, direction }) =>
            list.length > 0 ? (
              <div key={direction}>
                <p className="mb-1.5 text-xs font-medium text-neutral-400">{label} ({list.length}건)</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-neutral-100 text-neutral-400">
                        <th className="w-5 py-1 pr-2 text-left" />
                        <th className="py-1 pr-2 text-left">날짜</th>
                        <th className="py-1 pr-2 text-left">거래처</th>
                        <th className="py-1 pr-2 text-left">품목명</th>
                        <th className="py-1 text-right">수량(kg)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => {
                        const co = getCoInfo(r.companyName, direction);
                        return (
                          <tr key={r.uid} className="border-b border-neutral-50 last:border-0">
                            <td className="py-1.5 pr-2">
                              <input
                                type="checkbox"
                                checked={r.checked}
                                onChange={() => toggleRow(r.uid)}
                                className="accent-blue-500"
                              />
                            </td>
                            <td className="py-1.5 pr-2 text-neutral-500">{r.date}</td>
                            <td className="py-1.5 pr-2">
                              <span className={cn(!co && 'font-medium text-red-500')}>
                                {r.companyName}
                              </span>
                              {!co && <span className="text-red-400"> !</span>}
                            </td>
                            <td className="py-1.5 pr-2">
                              <input
                                value={r.itemName}
                                onChange={(e) => updateRow(r.uid, 'itemName', e.target.value)}
                                className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-neutral-300 focus:border-blue-400 focus:bg-blue-50 focus:outline-none"
                              />
                            </td>
                            <td className="py-1.5">
                              <input
                                value={r.qty}
                                type="number"
                                onChange={(e) => updateRow(r.uid, 'qty', e.target.value)}
                                className="w-20 rounded border border-transparent bg-transparent px-1 py-0.5 text-right hover:border-neutral-300 focus:border-blue-400 focus:bg-blue-50 focus:outline-none"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null,
          )}

          {rows.some((r) => !getCoInfo(r.companyName, r.direction) && r.checked) && (
            <p className="text-xs text-red-500">
              ! 표시 거래처는 미등록 상태입니다. 하단 거래처 매핑에서 먼저 등록해주세요.
            </p>
          )}
        </div>
      )}

      {/* 다운로드 버튼 */}
      {rows.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => void downloadRecycle()}
            className="w-full rounded-xl bg-blue-500 py-3 text-sm font-semibold text-white hover:bg-blue-600 active:bg-blue-700"
          >
            재활용제품_공급_및_보관내용 다운로드
          </button>
          <button
            onClick={() => void downloadWaste()}
            className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-white hover:bg-emerald-600 active:bg-emerald-700"
          >
            폐기물_재활용내용 다운로드 (매입만)
          </button>
        </div>
      )}

      {/* 거래처 매핑 관리 */}
      <div className="rounded-xl border border-neutral-200 bg-white">
        <button
          onClick={() => setShowMgmt((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-neutral-700"
        >
          <span>거래처 매핑 관리 <span className="font-normal text-neutral-400">({companies.length}개)</span></span>
          <span className="text-neutral-400">{showMgmt ? '▲' : '▼'}</span>
        </button>

        {showMgmt && (
          <div className="border-t border-neutral-100 p-4">
            {/* 등록된 목록 */}
            {companies.length > 0 && (
              <div className="mb-4 flex flex-col gap-2">
                {companies.map((co) =>
                  editId === co.id ? (
                    <div key={co.id} className="flex flex-col gap-1.5 rounded-lg border border-blue-200 p-3 text-xs">
                      <div className="flex gap-2">
                        <input
                          value={editCo.company_name ?? ''}
                          onChange={(e) => setEditCo((p) => ({ ...p, company_name: e.target.value }))}
                          placeholder="거래처명"
                          className="flex-1 rounded border border-neutral-300 px-2 py-1.5"
                        />
                        <select
                          value={editCo.direction ?? 'in'}
                          onChange={(e) => setEditCo((p) => ({ ...p, direction: e.target.value as 'in' | 'out' }))}
                          className="rounded border border-neutral-300 px-2 py-1.5"
                        >
                          <option value="in">매입</option>
                          <option value="out">매출</option>
                        </select>
                      </div>
                      <input
                        value={editCo.company_id ?? ''}
                        onChange={(e) => setEditCo((p) => ({ ...p, company_id: e.target.value }))}
                        placeholder="업체식별번호"
                        className="rounded border border-neutral-300 px-2 py-1.5"
                      />
                      <input
                        value={editCo.representative ?? ''}
                        onChange={(e) => setEditCo((p) => ({ ...p, representative: e.target.value }))}
                        placeholder="대표자명"
                        className="rounded border border-neutral-300 px-2 py-1.5"
                      />
                      <input
                        value={editCo.address ?? ''}
                        onChange={(e) => setEditCo((p) => ({ ...p, address: e.target.value }))}
                        placeholder="주소"
                        className="rounded border border-neutral-300 px-2 py-1.5"
                      />
                      <input
                        value={editCo.address_detail ?? ''}
                        onChange={(e) => setEditCo((p) => ({ ...p, address_detail: e.target.value }))}
                        placeholder="상세주소"
                        className="rounded border border-neutral-300 px-2 py-1.5"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => void saveEditCompany()}
                          className="flex-1 rounded-lg bg-blue-500 py-1.5 font-semibold text-white"
                        >
                          저장
                        </button>
                        <button
                          onClick={() => { setEditId(null); setEditCo({}); }}
                          className="flex-1 rounded-lg border border-neutral-300 py-1.5 text-neutral-600"
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={co.id}
                      className="flex items-start justify-between rounded-lg border border-neutral-100 p-3 text-xs"
                    >
                      <div>
                        <p className="font-medium">
                          {co.company_name}
                          <span className="ml-1 text-neutral-400">
                            ({co.direction === 'in' ? '매입' : '매출'})
                          </span>
                        </p>
                        {co.company_id && <p className="mt-0.5 text-neutral-500">번호: {co.company_id}</p>}
                        {co.representative && <p className="text-neutral-500">대표: {co.representative}</p>}
                        {co.address && <p className="text-neutral-500">{co.address}</p>}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          onClick={() => { setEditId(co.id); setEditCo({ ...co }); }}
                          className="rounded border border-neutral-200 px-2 py-1 text-neutral-500 hover:bg-neutral-50"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => void deleteCompany(co.id)}
                          className="rounded border border-red-200 px-2 py-1 text-red-500 hover:bg-red-50"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}

            {/* 신규 등록 */}
            <div className="flex flex-col gap-1.5 text-xs">
              <p className="font-semibold text-neutral-600">신규 등록</p>
              <div className="flex gap-2">
                <input
                  value={newCo.company_name ?? ''}
                  onChange={(e) => setNewCo((p) => ({ ...p, company_name: e.target.value }))}
                  placeholder="거래처명 (홈택스 상호와 동일)"
                  className="flex-1 rounded border border-neutral-300 px-2 py-1.5"
                />
                <select
                  value={newCo.direction ?? ''}
                  onChange={(e) => setNewCo((p) => ({ ...p, direction: e.target.value as 'in' | 'out' }))}
                  className="rounded border border-neutral-300 px-2 py-1.5"
                >
                  <option value="">구분</option>
                  <option value="in">매입</option>
                  <option value="out">매출</option>
                </select>
              </div>
              <input
                value={newCo.company_id ?? ''}
                onChange={(e) => setNewCo((p) => ({ ...p, company_id: e.target.value }))}
                placeholder="업체식별번호"
                className="rounded border border-neutral-300 px-2 py-1.5"
              />
              <input
                value={newCo.representative ?? ''}
                onChange={(e) => setNewCo((p) => ({ ...p, representative: e.target.value }))}
                placeholder="대표자명"
                className="rounded border border-neutral-300 px-2 py-1.5"
              />
              <input
                value={newCo.address ?? ''}
                onChange={(e) => setNewCo((p) => ({ ...p, address: e.target.value }))}
                placeholder="주소"
                className="rounded border border-neutral-300 px-2 py-1.5"
              />
              <input
                value={newCo.address_detail ?? ''}
                onChange={(e) => setNewCo((p) => ({ ...p, address_detail: e.target.value }))}
                placeholder="상세주소"
                className="rounded border border-neutral-300 px-2 py-1.5"
              />
              <button
                onClick={() => void addCompany()}
                disabled={!newCo.company_name?.trim() || !newCo.direction}
                className="mt-1 rounded-lg bg-neutral-700 py-2 font-semibold text-white disabled:opacity-40"
              >
                등록
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
