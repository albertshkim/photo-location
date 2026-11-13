/* ─────────────────────────────
 * DateSearch.js — 날짜 표시 + 날짜 포함 검색 (Home.js · Photoshortview.js 공용)
 * ─────────────────────────────
 * - 날짜는 찍은 날짜(takenAt) 우선, 없으면 저장된 날짜(createdAt)
 * - 검색: Search.js의 기존 검색(제목·설명·위치 등) + 날짜
 */
import { filterItems } from './Search';

// 타임스탬프(ms) → "2026.11.13"
export function ymd(ts) {
  const d = new Date(ts);
  if (!ts || isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

// 리스트보기 날짜: 사진을 찍은 날짜(takenAt) 우선
// 촬영일이 없는 예전 항목은 등록일(createdAt, 또는 타임스탬프 id)로 대신 표시
export function photoDate(item) {
  const taken = ymd(item.takenAt);
  if (taken) return { text: taken, taken: true };
  let ts = item.createdAt;
  if (!ts && /^\d{12,}$/.test(String(item.id))) ts = Number(item.id);
  const created = ymd(ts);
  return created ? { text: created, taken: false } : { text: '날짜 없음', taken: false };
}

// 예전 코드 호환용: 날짜 문자열만 필요할 때
export function formatDate(item) {
  return photoDate(item).text;
}

/* ─────────────────────────────
 * 검색: 기존 필드(Search.js의 filterItems) + 날짜
 * ─────────────────────────────
 * 날짜는 촬영일 우선, 없으면 등록일 (리스트보기에 보이는 날짜와 같음)
 * 날짜로 인식하는 입력: 2026 / 2026.11 / 2026.11.13 / 2026-11 / 2026/11/13 / 2026년 11월 / 11.13
 * 여러 단어는 모두 맞아야 함 (예: "2026.11 역삼동")
 */

// 검색어 한 단어가 날짜면 "2026.11.13" 형식 조각으로 바꿈, 아니면 null
function dateToken(tok) {
  const isYear = /^\d{4}년?$/.test(tok);
  const hasSep = /[.\-/년월일]/.test(tok);
  if (!isYear && !hasSep) return null; // "152" 같은 번지 숫자는 날짜로 보지 않음
  const t = tok
    .replace(/[년월]/g, '.')
    .replace(/일$/, '')
    .replace(/[-/]/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '');
  if (!/^\d{1,4}(\.\d{1,2}){0,2}$/.test(t)) return null;
  return t
    .split('.')
    .map((p, i) => (i === 0 && p.length === 4 ? p : p.padStart(2, '0'))) // 2026.1 → 2026.01
    .join('.');
}

// "2026년 11월"처럼 띄어 쓴 날짜를 한 단어로 붙임
function joinDateWords(query) {
  return query.replace(/(\d{4})\s*년\s*(\d{1,2})\s*월(?:\s*(\d{1,2})\s*일)?/g, (_, y, m, d) =>
    d ? `${y}.${m}.${d}` : `${y}.${m}`
  );
}

export function searchItems(items, query) {
  const tokens = joinDateWords(query.trim()).split(/\s+/).filter(Boolean);
  if (!tokens.length) return items;
  return items.filter((it) =>
    tokens.every((tok) => {
      const dt = dateToken(tok);
      if (dt && photoDate(it).text.includes(dt)) return true;
      return filterItems([it], tok).length > 0; // 제목·주소·설명 등 기존 검색
    })
  );
}