import 'react-native-gesture-handler';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Modal,
  Dimensions,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
// 갤러리 DB에서 사진 위치를 직접 읽기 위해 사용 (웹 미지원)
// ※ SDK 58 이상에서 getAssetsAsync 관련 오류가 나면 'expo-media-library/legacy'로 바꾸세요
import * as MediaLibrary from 'expo-media-library';
import { Image as ExpoImage } from 'expo-image';
import Constants from 'expo-constants';
// 저장/불러오기 모듈 (프로젝트·사진 목록, 사진 파일)
import {
  PREFIX_RE,
  PREFIX_RULE,
  loadProjects,
  saveProjects,
  loadLastProjectId,
  saveLastProjectId,
  loadItems,
  saveItems,
  persistPhoto,
  removePhoto,
  deleteProjectData,
} from './storage';

export const IS_WEB = Platform.OS === 'web';
// Expo Go(Android)는 미디어 라이브러리 전체 접근이 거부됨 → 갤러리 DB 방식 사용 불가
export const IS_EXPO_GO = Constants.executionEnvironment === 'storeClient';
export const CAN_USE_MEDIA_LIBRARY = !IS_WEB && !(IS_EXPO_GO && Platform.OS === 'android');

// 디버그 박스 표시 여부 (원인 확인이 끝나면 false로)
export const SHOW_DEBUG = true;

/* ─────────────────────────────
 * 주소 변환 설정
 * ─────────────────────────────
 * 카카오 로컬 API(국내 주소가 가장 정확하고 빠름)를 쓰려면
 * https://developers.kakao.com 에서 앱 생성 → "REST API 키"를 넣으세요.
 * 비워두면 [기기 지오코더 → OpenStreetMap] 순서로만 시도합니다.
 */
const KAKAO_REST_API_KEY = '';
// OpenStreetMap(Nominatim) 이용 정책상 앱을 식별할 수 있는 User-Agent가 필요합니다.
const NOMINATIM_USER_AGENT = 'PhotoLocationApp/1.0 (contact: your-email@example.com)';

/* ─────────────────────────────
 * 공유 상태 (프로젝트 + 사진 목록) — 모든 변경은 자동 저장됨
 * ─────────────────────────────
 * usePhotos()가 주는 값
 *   items, addItem, updateItem, deleteItem       ← 현재 프로젝트의 사진
 *   projects (최근 사용 순), currentProject
 *   openProject(id), createProject({ name, type, prefix }), deleteProject(id)
 *   isPrefixAvailable(prefix)
 */
const PhotoContext = createContext(null);
export const usePhotos = () => useContext(PhotoContext);

// 처음 실행할 때 자동으로 만드는 기본 프로젝트
const DEFAULT_PROJECT = { name: '내 사진', type: 'topic', prefix: 'default' };

const newProject = ({ name, type, prefix }) => {
  const now = Date.now();
  return { id: `p_${now}_${Math.random().toString(36).slice(2, 6)}`, name, type, prefix, count: 0, createdAt: now, lastUsedAt: now };
};

export function PhotoProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [projects, setProjectsState] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [items, setItemsState] = useState([]);
  // 비동기 작업 중에도 항상 최신 값을 읽기 위한 ref
  const projectsRef = useRef([]);
  const itemsRef = useRef([]);
  const currentRef = useRef(null); // { id, prefix }

  const warn = (e) => console.warn('[PhotoProvider] 저장 실패', e);

  // 프로젝트 목록 변경 + 저장
  const commitProjects = (next) => {
    projectsRef.current = next;
    setProjectsState(next);
    saveProjects(next).catch(warn);
  };
  const touchProject = (id, patch = {}) =>
    commitProjects(
      projectsRef.current.map((p) => (p.id === id ? { ...p, ...patch, lastUsedAt: Date.now() } : p))
    );

  // 현재 프로젝트의 사진 목록 변경 + 저장
  const commitItems = (next) => {
    const cur = currentRef.current;
    if (!cur) return;
    itemsRef.current = next;
    setItemsState(next);
    saveItems(cur.prefix, next).catch(warn);
    touchProject(cur.id, { count: next.length });
  };

  /* ── 프로젝트 ── */
  const isPrefixAvailable = (prefix) =>
    !projectsRef.current.some((p) => p.prefix.toLowerCase() === String(prefix).toLowerCase());

  const openProject = async (id) => {
    const p = projectsRef.current.find((x) => x.id === id);
    if (!p) throw new Error('프로젝트를 찾을 수 없어요.');
    const list = await loadItems(p.prefix);
    currentRef.current = { id: p.id, prefix: p.prefix };
    itemsRef.current = list;
    setItemsState(list);
    setCurrentId(p.id);
    saveLastProjectId(p.id).catch(warn);
    touchProject(p.id, { count: list.length });
  };

  const createProject = async ({ name, type, prefix }) => {
    if (!name?.trim()) throw new Error('프로젝트 이름을 입력해주세요.');
    if (!PREFIX_RE.test(prefix)) throw new Error(`접두어 규칙: ${PREFIX_RULE}`);
    if (!isPrefixAvailable(prefix)) throw new Error('이미 사용 중인 접두어예요.');
    // 같은 접두어로 남아 있던 예전 데이터가 있으면 정리
    await deleteProjectData(prefix);
    const p = newProject({ name: name.trim(), type, prefix });
    commitProjects([p, ...projectsRef.current]);
    await openProject(p.id);
    return p;
  };

  const deleteProject = async (id) => {
    const p = projectsRef.current.find((x) => x.id === id);
    if (!p) return;
    await deleteProjectData(p.prefix);
    const rest = projectsRef.current.filter((x) => x.id !== id);
    commitProjects(rest);
    if (currentRef.current?.id === id) {
      currentRef.current = null;
      if (rest.length) {
        const recent = [...rest].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))[0];
        await openProject(recent.id);
      } else {
        await createProject(DEFAULT_PROJECT); // 프로젝트가 하나도 없으면 기본 프로젝트 생성
      }
    }
  };

  /* ── 사진 (현재 프로젝트) ── */
  const addItem = async (item) => {
    const cur = currentRef.current;
    if (!cur) throw new Error('열려 있는 프로젝트가 없어요.');
    const uri = await persistPhoto(item.uri, cur.prefix);
    const now = Date.now();
    const newItem = {
      ...item,
      uri,
      id: `${now}${Math.floor(Math.random() * 1000)}`,
      createdAt: item.createdAt ?? now,
    };
    commitItems([newItem, ...itemsRef.current]);
    return newItem;
  };

  // 수정: id·순서·createdAt 유지, 사진이 바뀌면 새 파일 복사 후 예전 파일 삭제
  const updateItem = async (id, patch) => {
    const cur = currentRef.current;
    const old = itemsRef.current.find((it) => it.id === id);
    if (!cur || !old) throw new Error('수정할 항목을 찾을 수 없어요.');
    let uri = old.uri;
    if (patch.uri && patch.uri !== old.uri) {
      uri = await persistPhoto(patch.uri, cur.prefix);
      if (uri !== old.uri) removePhoto(old.uri);
    }
    commitItems(
      itemsRef.current.map((it) =>
        it.id === id
          ? { ...it, ...patch, uri, id: it.id, createdAt: it.createdAt, updatedAt: Date.now() }
          : it
      )
    );
  };

  const deleteItem = async (id) => {
    const old = itemsRef.current.find((it) => it.id === id);
    commitItems(itemsRef.current.filter((it) => it.id !== id));
    if (old) await removePhoto(old.uri);
  };

  /* ── 앱 시작: 저장된 프로젝트 불러오기 → 마지막 프로젝트 열기 ── */
  const init = async () => {
    setLoadError(null);
    try {
      const list = await loadProjects();
      projectsRef.current = list;
      setProjectsState(list);
      if (!list.length) {
        await createProject(DEFAULT_PROJECT);
      } else {
        const lastId = await loadLastProjectId();
        const target =
          list.find((p) => p.id === lastId) ??
          [...list].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))[0];
        await openProject(target.id);
      }
      setReady(true);
    } catch (e) {
      setLoadError(e?.message ?? String(e));
    }
  };
  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 최근 사용 순으로 정렬
  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)),
    [projects]
  );
  const currentProject = projects.find((p) => p.id === currentId) ?? null;

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        {loadError ? (
          <>
            <Text style={{ color: '#b91c1c', textAlign: 'center' }}>저장된 데이터를 불러오지 못했어요.{'\n'}{loadError}</Text>
            <TouchableOpacity onPress={init} style={[galleryStyles.secondaryBtn, { marginTop: 16 }]}>
              <Text style={galleryStyles.secondaryText}>다시 시도</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <ActivityIndicator />
            <Text style={{ marginTop: 8, color: '#666' }}>최근 프로젝트를 불러오는 중…</Text>
          </>
        )}
      </View>
    );
  }

  return (
    <PhotoContext.Provider
      value={{
        items,
        addItem,
        updateItem,
        deleteItem,
        projects: sortedProjects,
        currentProject,
        openProject,
        createProject,
        deleteProject,
        isPrefixAvailable,
      }}>
      {children}
    </PhotoContext.Provider>
  );
}

/* ─────────────────────────────
 * EXIF 위치 파싱 유틸
 * ───────────────────────────── */
// 숫자 / "37/1,30/1,1234/100" / [37,30,12.3] → 십진수
function toDecimal(value, ref) {
  if (value == null) return null;
  let deg;
  if (typeof value === 'number') {
    deg = value;
  } else {
    const parts = Array.isArray(value) ? value : String(value).split(',');
    const nums = parts.map((p) => {
      const s = String(p).trim();
      if (s.includes('/')) {
        const [a, b] = s.split('/').map(Number);
        return b ? a / b : 0;
      }
      return Number(s);
    });
    deg = (nums[0] || 0) + (nums[1] || 0) / 60 + (nums[2] || 0) / 3600;
  }
  if (Number.isNaN(deg)) return null;
  if (ref === 'S' || ref === 'W') deg = -Math.abs(deg);
  return deg;
}

// iOS({GPS} 딕셔너리) / Android(GPSLatitude 등) 모두 대응
export function getCoordsFromExif(exif) {
  if (!exif) return null;
  const gps = exif['{GPS}'];
  const lat = gps
    ? toDecimal(gps.Latitude, gps.LatitudeRef)
    : toDecimal(exif.GPSLatitude, exif.GPSLatitudeRef);
  const lng = gps
    ? toDecimal(gps.Longitude, gps.LongitudeRef)
    : toDecimal(exif.GPSLongitude, exif.GPSLongitudeRef);
  if (lat == null || lng == null || (lat === 0 && lng === 0)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { latitude: lat, longitude: lng };
}

export const coordText = (c) => `${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`;

const validCoords = (loc) =>
  loc && typeof loc.latitude === 'number' && typeof loc.longitude === 'number' &&
  !(loc.latitude === 0 && loc.longitude === 0)
    ? { latitude: loc.latitude, longitude: loc.longitude }
    : null;

// 디버그용: EXIF 안의 GPS 관련 값만 추려서 문자열로
export function gpsDebugText(exif) {
  if (!exif) return 'exif 없음 (선택기가 메타데이터를 넘기지 않음)';
  const out = {};
  if (exif['{GPS}']) out['{GPS}'] = exif['{GPS}'];
  Object.keys(exif)
    .filter((k) => /gps/i.test(k))
    .forEach((k) => (out[k] = exif[k]));
  return Object.keys(out).length ? JSON.stringify(out, null, 1) : 'exif에 GPS 항목 없음';
}

/* ─────────────────────────────
 * 비동기 유틸 (타임아웃)
 * ───────────────────────────── */
// 일정 시간 안에 끝나지 않으면 실패 처리 (기기 지오코더가 멈춰 있는 경우 대비)
export function withTimeout(promise, ms, label = '작업') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 시간 초과(${ms / 1000}초)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// fetch + 타임아웃 + JSON 파싱
async function fetchJson(url, options = {}, ms = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`응답 시간 초과(${ms / 1000}초)`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────────────────────
 * 좌표 → 주소 변환
 * ───────────────────────────── */
// ★ 핵심: Android의 reverseGeocodeAsync는 위치 권한이 없으면 무조건 실패합니다.
//   APK는 Expo Go와 별개의 앱이라 권한이 처음엔 없으므로, 변환 직전에 확보합니다.
async function ensureLocationPermission() {
  let perm = await Location.getForegroundPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) {
    perm = await Location.requestForegroundPermissionsAsync();
  }
  return perm.granted;
}

/* 방법 1: 카카오 로컬 API (국내 좌표 전용, 키 필요) */
async function geocodeKakao(c) {
  const url =
    'https://dapi.kakao.com/v2/local/geo/coord2address.json' +
    `?x=${c.longitude}&y=${c.latitude}`;
  const json = await fetchJson(
    url,
    { headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` } },
    4000
  );
  const d = json?.documents?.[0];
  const addr = d?.road_address?.address_name || d?.address?.address_name;
  if (!addr) throw new Error('결과 없음(국외 좌표일 수 있음)');
  const building = d?.road_address?.building_name;
  return building ? `${addr} (${building})` : addr;
}

/* 방법 2: 기기 내장 지오코더 (Android는 Google Play 서비스 + 위치 권한 필요) */
async function geocodeNative(c) {
  if (!(await ensureLocationPermission())) throw new Error('위치 권한 없음');
  const results = await withTimeout(Location.reverseGeocodeAsync(c), 4000, '기기 지오코더');
  const a = results?.[0];
  if (!a) throw new Error('결과 없음');
  if (a.formattedAddress) return a.formattedAddress;
  const parts = [a.region, a.city, a.district, a.street, a.streetNumber, a.name].filter(Boolean);
  const unique = [...new Set(parts)];
  if (!unique.length) throw new Error('빈 주소');
  return unique.join(' ');
}

/* 방법 3: OpenStreetMap Nominatim (키 불필요, 초당 1회 제한) */
async function geocodeNominatim(c) {
  const url =
    'https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18' +
    `&accept-language=ko&lat=${c.latitude}&lon=${c.longitude}`;
  // 브라우저는 User-Agent 변경을 막으므로 네이티브에서만 지정
  const headers = IS_WEB ? {} : { 'User-Agent': NOMINATIM_USER_AGENT };
  const json = await fetchJson(url, { headers }, 6000);
  if (json?.error) throw new Error(json.error);
  const a = json?.address || {};
  const parts = [
    a.province || a.state,
    a.city || a.county,
    a.borough || a.city_district,
    a.suburb || a.quarter || a.town || a.village,
    a.road,
    a.house_number,
  ].filter(Boolean);
  const unique = [...new Set(parts)];
  if (unique.length >= 2) return unique.join(' ');
  if (json?.display_name) return json.display_name;
  throw new Error('결과 없음');
}

// 같은 장소(약 10m 이내)는 다시 조회하지 않도록 캐시
const addressCache = new Map();
const cacheKey = (c) => `${c.latitude.toFixed(4)},${c.longitude.toFixed(4)}`;

// 좌표 → { address, source, errors }
// 여러 방법을 순서대로 시도하고, 하나라도 성공하면 즉시 반환
export async function resolveAddress(c) {
  const key = cacheKey(c);
  if (addressCache.has(key)) return { address: addressCache.get(key), source: '캐시', errors: [] };

  const providers = [
    KAKAO_REST_API_KEY && ['카카오', geocodeKakao],
    !IS_WEB && ['기기', geocodeNative],
    ['OpenStreetMap', geocodeNominatim],
  ].filter(Boolean);

  const errors = [];
  for (const [name, fn] of providers) {
    try {
      const address = await fn(c);
      addressCache.set(key, address);
      return { address, source: name, errors };
    } catch (e) {
      errors.push(`${name}: ${e?.message ?? e}`);
    }
  }
  return { address: null, source: null, errors };
}

/* ─────────────────────────────
 * 갤러리 DB 유틸
 * ───────────────────────────── */
export async function ensureLibraryPermission() {
  const res = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
  return res.granted;
}

// 갤러리 asset에서 위치 + 표시용 uri 가져오기
export async function readAssetInfo(assetOrId) {
  const info = await withTimeout(
    MediaLibrary.getAssetInfoAsync(assetOrId, {
      shouldDownloadFromNetwork: true, // iCloud 원본만 있는 사진도 localUri 확보
    }),
    8000,
    '갤러리 조회'
  );
  return {
    uri: info.localUri || info.uri,
    coords: validCoords(info.location) || getCoordsFromExif(info.exif),
  };
}

/* ─────────────────────────────
 * 갤러리 직접 선택 모달 (Android 사진 선택기의 GPS 제거 우회)
 * ───────────────────────────── */
const THUMB = Math.floor((Dimensions.get('window').width - 4 * 4) / 3);

export function GalleryModal({ visible, onClose, onSelect }) {
  const [assets, setAssets] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { granted, access, total, error }
  const busyRef = useRef(false); // 중복 로드 방지 (state는 비동기라 ref 사용)

  const load = async (reset = false) => {
    if (busyRef.current || (!reset && !hasMore)) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const page = await MediaLibrary.getAssetsAsync({
        mediaType: MediaLibrary.MediaType.photo,
        first: 60,
        after: reset ? undefined : cursor || undefined,
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      });
      setAssets((prev) => (reset ? page.assets : [...prev, ...page.assets]));
      setCursor(page.endCursor);
      setHasMore(page.hasNextPage);
      setStatus((s) => ({ ...s, total: page.totalCount }));
    } catch (e) {
      setStatus((s) => ({ ...s, error: e.message }));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const init = async () => {
    setAssets([]);
    setCursor(null);
    setHasMore(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
      setStatus({ granted: perm.granted, access: perm.accessPrivileges ?? '-', total: null, error: null });
      if (perm.granted) await load(true);
    } catch (e) {
      setStatus({ granted: false, access: '-', total: null, error: e.message });
    }
  };

  useEffect(() => {
    if (visible) init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // iOS / Android 14+ "일부 사진만 허용" 상태에서 허용 사진 추가
  const addAllowedPhotos = async () => {
    try {
      await MediaLibrary.presentPermissionsPickerAsync(['photo']);
      await init();
    } catch {
      Alert.alert('알림', '설정에서 사진 접근을 "모든 사진"으로 바꿔주세요.');
    }
  };

  const limited = status?.access === 'limited';

  const Empty = () => {
    if (busy || !status) return <ActivityIndicator style={{ marginTop: 40 }} />;
    let msg;
    if (status.error) msg = `갤러리를 불러오지 못했어요.\n${status.error}`;
    else if (!status.granted) msg = '사진 접근 권한이 거부되었어요.';
    else if (limited) msg = '"일부 사진만 허용" 상태라 보여줄 사진이 없어요.';
    else
      msg =
        Platform.OS === 'android'
          ? '사진을 불러오지 못했어요.\nExpo Go(Android)는 갤러리 전체 접근이 제한될 수 있어요.\n이 경우 development build로 테스트해야 해요.'
          : '불러온 사진이 없어요.';
    return (
      <View style={{ alignItems: 'center', padding: 24 }}>
        <Ionicons name="alert-circle-outline" size={40} color="#d97706" />
        <Text style={{ textAlign: 'center', color: '#555', marginTop: 8, lineHeight: 20 }}>{msg}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
          {limited && (
            <TouchableOpacity style={galleryStyles.secondaryBtn} onPress={addAllowedPhotos}>
              <Text style={galleryStyles.secondaryText}>허용할 사진 추가</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={galleryStyles.secondaryBtn} onPress={() => Linking.openSettings()}>
            <Text style={galleryStyles.secondaryText}>설정 열기</Text>
          </TouchableOpacity>
          <TouchableOpacity style={galleryStyles.secondaryBtn} onPress={init}>
            <Text style={galleryStyles.secondaryText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={galleryStyles.modalHeader}>
        <TouchableOpacity onPress={onClose}>
          <Text style={{ fontSize: 16, color: '#666' }}>닫기</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 17, fontWeight: '700' }}>갤러리</Text>
        {limited ? (
          <TouchableOpacity onPress={addAllowedPhotos}>
            <Text style={{ fontSize: 14, color: '#2563eb' }}>사진 추가</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 32 }} />
        )}
      </View>
      {status && SHOW_DEBUG && (
        <Text style={galleryStyles.statusLine}>
          {Platform.OS} · 권한 {status.granted ? '허용' : '거부'} · 범위 {status.access} · 사진{' '}
          {status.total ?? '-'}장 · 표시 {assets.length}장
        </Text>
      )}
      <FlatList
        data={assets}
        numColumns={3}
        keyExtractor={(a) => a.id}
        onEndReached={() => load(false)}
        onEndReachedThreshold={0.5}
        contentContainerStyle={{ padding: 4, flexGrow: 1 }}
        ListEmptyComponent={Empty}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => onSelect(item)} style={{ margin: 2 }}>
            {/* expo-image는 iOS의 ph:// 주소도 표시 가능 */}
            <ExpoImage
              source={{ uri: item.uri }}
              style={{ width: THUMB, height: THUMB, backgroundColor: '#e5e7eb' }}
              contentFit="cover"
              recyclingKey={item.id}
            />
          </TouchableOpacity>
        )}
      />
    </Modal>
  );
}

// 갤러리 모달 전용 스타일 (Home.js의 styles와 별개)
const galleryStyles = StyleSheet.create({
  secondaryBtn: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  secondaryText: { color: '#2563eb', fontWeight: '600' },
  statusLine: { fontSize: 11, color: '#64748b', paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#f8fafc' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 56 : 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  },
});

/* ─────────────────────────────
 * 앱 시작점: 실행하면 Home.js를 엽니다
 * ───────────────────────────── */
export default function App() {
  // Home.js가 이 파일(App.js)의 유틸을 import하므로,
  // 맨 위에서 import하면 순환 참조가 생깁니다 → 여기서 불러와 순환을 피함
  const Home = require('./Home').default;
  return (
    <PhotoProvider>
      <Home />
    </PhotoProvider>
  );
}