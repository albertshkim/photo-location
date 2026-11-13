/* ─────────────────────────────
 * storage.js — 저장/불러오기 모듈
 * ─────────────────────────────
 * 1) 프로젝트 목록과 사진 목록을 AsyncStorage에 저장 (앱을 껐다 켜도 유지)
 * 2) 사진 파일을 앱 전용 폴더로 복사 (선택기의 임시 파일은 나중에 지워질 수 있음)
 *
 * 저장 구조
 *   @photoapp:projects        → 프로젝트 목록 [{ id, name, type, prefix, count, createdAt, lastUsedAt }]
 *   @photoapp:lastProjectId   → 마지막으로 연 프로젝트 id (다음 실행 시 자동으로 열림)
 *   {prefix}:items            → 해당 프로젝트의 사진 목록
 *   (파일) documentDirectory/photos/{prefix}/  → 해당 프로젝트의 사진 파일
 *
 * 설치:  npx expo install @react-native-async-storage/async-storage expo-file-system
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
// SDK 53 이하(Snack SDK 52 포함): 'expo-file-system'
// SDK 54 이상으로 올리면 아래 줄을  import * as FileSystem from 'expo-file-system/legacy';  로 바꾸세요
import * as FileSystem from 'expo-file-system';

const IS_WEB = Platform.OS === 'web';

const KEY_PROJECTS = '@photoapp:projects';
const KEY_LAST = '@photoapp:lastProjectId';

/* ─────────────────────────────
 * 프로젝트 종류 / 접두어 규칙
 * ───────────────────────────── */
export const PROJECT_TYPES = [
  { key: 'dong', label: '동네', icon: 'home-outline' },
  { key: 'place', label: '장소', icon: 'location-outline' },
  { key: 'topic', label: '주제', icon: 'pricetag-outline' },
];
export const typeLabel = (key) => PROJECT_TYPES.find((t) => t.key === key)?.label ?? '기타';
export const typeIcon = (key) => PROJECT_TYPES.find((t) => t.key === key)?.icon ?? 'folder-outline';

// 접두어: 영문으로 시작, 영문·숫자·_·- 만, 2~30자 (저장 키·폴더 이름으로 쓰이므로)
export const PREFIX_RE = /^[A-Za-z][A-Za-z0-9_-]{1,29}$/;
export const PREFIX_RULE = '영문으로 시작하고 영문·숫자·_·- 만 2~30자';

export const itemsKey = (prefix) => `${prefix}:items`;

// 이름/종류로 접두어 추천 (예: "Yeoksam" + 동네 → dong_yeoksam, 한글 이름 → dong_20261113)
export function suggestPrefix(name, type, isAvailable = () => true) {
  const slug = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const ymd = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
  const base = slug.length >= 2 && /^[a-z]/.test(slug) ? `${type}_${slug}` : `${type}_${ymd}`;
  let prefix = base;
  let n = 2;
  while (!isAvailable(prefix)) prefix = `${base}_${n++}`;
  return prefix;
}

/* ─────────────────────────────
 * JSON 저장 유틸
 * ───────────────────────────── */
async function readJson(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) {
    console.warn(`[storage] ${key} 읽기 실패`, e);
    return fallback;
  }
}
const writeJson = (key, value) => AsyncStorage.setItem(key, JSON.stringify(value));

/* 프로젝트 목록 */
export const loadProjects = async () => {
  const list = await readJson(KEY_PROJECTS, []);
  return Array.isArray(list) ? list : [];
};
export const saveProjects = (projects) => writeJson(KEY_PROJECTS, projects);

/* 마지막으로 연 프로젝트 */
export const loadLastProjectId = () => AsyncStorage.getItem(KEY_LAST).catch(() => null);
export const saveLastProjectId = (id) => AsyncStorage.setItem(KEY_LAST, id);

/* 프로젝트별 사진 목록 */
export const loadItems = async (prefix) => {
  const list = await readJson(itemsKey(prefix), []);
  return Array.isArray(list) ? list : [];
};
export const saveItems = (prefix, items) => writeJson(itemsKey(prefix), items);

/* ─────────────────────────────
 * 사진 파일 (앱 전용 폴더로 복사)
 * ───────────────────────────── */
const photoDir = (prefix) => `${FileSystem.documentDirectory}photos/${prefix}/`;
const isOurFile = (uri) =>
  !IS_WEB && !!uri && !!FileSystem.documentDirectory && uri.startsWith(`${FileSystem.documentDirectory}photos/`);

// 선택기/카메라의 임시 사진을 앱 폴더로 복사하고 새 uri 반환
// (웹이거나 복사에 실패하면 원래 uri 그대로 반환)
export async function persistPhoto(uri, prefix) {
  if (IS_WEB || !uri || isOurFile(uri)) return uri;
  try {
    const dir = photoDir(prefix);
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const ext = (uri.split('?')[0].match(/\.([A-Za-z0-9]{3,4})$/)?.[1] ?? 'jpg').toLowerCase();
    const dest = `${dir}${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  } catch (e) {
    console.warn('[storage] 사진 복사 실패, 원본 경로 사용', e);
    return uri;
  }
}

// 앱 폴더에 복사해 둔 사진 파일 삭제 (다른 경로는 건드리지 않음)
export async function removePhoto(uri) {
  if (!isOurFile(uri)) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch (e) {
    console.warn('[storage] 사진 삭제 실패', e);
  }
}

// 프로젝트 삭제: 사진 목록 + 사진 폴더 삭제
export async function deleteProjectData(prefix) {
  await AsyncStorage.removeItem(itemsKey(prefix)).catch(() => {});
  if (IS_WEB) return;
  try {
    await FileSystem.deleteAsync(photoDir(prefix), { idempotent: true });
  } catch (e) {
    console.warn('[storage] 프로젝트 폴더 삭제 실패', e);
  }
}