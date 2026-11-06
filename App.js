import 'react-native-gesture-handler';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Modal,
  Dimensions,
  Linking,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
// 갤러리 DB에서 사진 위치를 직접 읽기 위해 사용 (웹 미지원)
// ※ SDK 58 이상에서 getAssetsAsync 관련 오류가 나면 'expo-media-library/legacy'로 바꾸세요
import * as MediaLibrary from 'expo-media-library';
import { Image as ExpoImage } from 'expo-image';
import Constants from 'expo-constants';

const IS_WEB = Platform.OS === 'web';
// Expo Go(Android)는 미디어 라이브러리 전체 접근이 거부됨 → 갤러리 DB 방식 사용 불가
const IS_EXPO_GO = Constants.executionEnvironment === 'storeClient';
const CAN_USE_MEDIA_LIBRARY = !IS_WEB && !(IS_EXPO_GO && Platform.OS === 'android');

// 디버그 박스 표시 여부 (원인 확인이 끝나면 false로)
const SHOW_DEBUG = true;

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
 * 공유 상태 (사진 목록)
 * ───────────────────────────── */
const PhotoContext = createContext(null);
const usePhotos = () => useContext(PhotoContext);

function PhotoProvider({ children }) {
  const [items, setItems] = useState([]);
  const addItem = (item) =>
    setItems((prev) => [{ ...item, id: Date.now().toString() }, ...prev]);
  const deleteItem = (id) =>
    setItems((prev) => prev.filter((it) => it.id !== id));
  return (
    <PhotoContext.Provider value={{ items, addItem, deleteItem }}>
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
function getCoordsFromExif(exif) {
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

const coordText = (c) => `${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`;

const validCoords = (loc) =>
  loc && typeof loc.latitude === 'number' && typeof loc.longitude === 'number' &&
  !(loc.latitude === 0 && loc.longitude === 0)
    ? { latitude: loc.latitude, longitude: loc.longitude }
    : null;

// 디버그용: EXIF 안의 GPS 관련 값만 추려서 문자열로
function gpsDebugText(exif) {
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
function withTimeout(promise, ms, label = '작업') {
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
async function resolveAddress(c) {
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
async function ensureLibraryPermission() {
  const res = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
  return res.granted;
}

// 갤러리 asset에서 위치 + 표시용 uri 가져오기
async function readAssetInfo(assetOrId) {
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

function GalleryModal({ visible, onClose, onSelect }) {
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
            <TouchableOpacity style={styles.secondaryBtn} onPress={addAllowedPhotos}>
              <Text style={styles.secondaryText}>허용할 사진 추가</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => Linking.openSettings()}>
            <Text style={styles.secondaryText}>설정 열기</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={init}>
            <Text style={styles.secondaryText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalHeader}>
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
        <Text style={styles.statusLine}>
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

/* ─────────────────────────────
 * 리스트 모듈
 * ───────────────────────────── */
function PhotoListScreen({ navigation }) {
  const { items, deleteItem } = usePhotos();

  const confirmDelete = (id) => {
    if (IS_WEB) {
      // Snack 웹 미리보기에서는 Alert 버튼이 동작하지 않음
      if (window.confirm('이 항목을 삭제할까요?')) deleteItem(id);
      return;
    }
    Alert.alert('삭제', '이 항목을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => deleteItem(id) },
    ]);
  };

  return (
    <View style={styles.screen}>
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={items.length === 0 ? styles.emptyWrap : { padding: 16 }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center' }}>
            <Ionicons name="images-outline" size={48} color="#bbb" />
            <Text style={styles.empty}>아직 등록된 사진이 없어요.</Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { marginTop: 16 }]}
              onPress={() => navigation.navigate('PhotoInput')}>
              <Text style={styles.primaryBtnText}>사진 추가하기</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.8}
            onLongPress={() => confirmDelete(item.id)}>
            <ExpoImage source={{ uri: item.uri }} style={styles.thumb} contentFit="cover" />
            <View style={styles.info}>
              <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.location} numberOfLines={2}>
                📍 {item.location || '위치 정보 없음'}
              </Text>
              {item.coords && <Text style={styles.coords}>{coordText(item.coords)}</Text>}
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

/* ─────────────────────────────
 * 입력 모듈
 * ───────────────────────────── */
function PhotoInputScreen({ navigation }) {
  const { addItem } = usePhotos();
  const [uri, setUri] = useState(null);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [coords, setCoords] = useState(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState(null); // { text, warn }
  const [debug, setDebug] = useState('');
  const [galleryOpen, setGalleryOpen] = useState(false);
  // 요청 번호: 주소 조회 중 다른 사진을 고르면 이전 결과가 덮어쓰지 않도록 함
  const reqId = useRef(0);

  const addDebug = (line) => setDebug((d) => (d ? `${d}\n${line}` : line));

  const reset = () => {
    reqId.current += 1; // 진행 중인 조회 무효화
    setUri(null);
    setTitle('');
    setLocation('');
    setCoords(null);
    setLoading(false);
    setNote(null);
    setDebug('');
  };

  const clearLocation = () => {
    setCoords(null);
    setLocation('');
  };

  // 위치 없음 안내 문구 (환경별)
  const noLocationNote = () =>
    Platform.OS === 'android'
      ? IS_EXPO_GO
        ? 'Expo Go(Android)에서는 갤러리 사진의 위치를 읽을 수 없는 경우가 많아요. "촬영하고 위치 저장" 또는 "현재 위치 사용"을 쓰거나, development build로 테스트하세요.'
        : '사진에 위치가 없거나 선택기가 위치를 지웠어요. "갤러리에서 직접 선택"을 눌러보세요.'
      : '사진에 위치 정보가 없어요. 직접 입력하거나 현재 위치를 사용하세요.';

  // 좌표를 먼저 화면에 보여주고, 주소는 비동기로 채움
  // id: 이 요청을 시작한 요청 번호 (이미 더 새로운 요청이 있으면 결과를 버림)
  const applyCoords = async (c, source, id = ++reqId.current) => {
    if (id !== reqId.current) return;
    if (!c) {
      clearLocation();
      setLoading(false);
      setNote({ text: noLocationNote(), warn: true });
      return;
    }

    setCoords(c);
    setLocation('');
    setLoading(true);
    setNote({ text: '주소를 찾는 중…', warn: false });

    const r = await resolveAddress(c);
    if (id !== reqId.current) return; // 그 사이 다른 요청이 시작됨

    setLoading(false);
    if (r.errors.length) addDebug(`[주소 변환 실패 기록]\n${r.errors.join('\n')}`);
    if (r.address) {
      setLocation(r.address);
      setNote({ text: `위치 출처: ${source} · 주소: ${r.source}`, warn: false });
    } else {
      setLocation(coordText(c));
      setNote({
        text: `주소 변환에 실패해 좌표로 입력했어요. 네트워크를 확인하거나 "주소 다시 찾기"를 눌러주세요.\n${r.errors.join('\n')}`,
        warn: true,
      });
    }
  };

  // 갤러리 모달에서 고른 사진: 갤러리 DB의 위치 정보 사용
  const onGallerySelect = async (asset) => {
    setGalleryOpen(false);
    const id = ++reqId.current;
    setUri(asset.uri);
    clearLocation();
    setLoading(true);
    setNote({ text: '사진의 위치 정보를 읽는 중…', warn: false });
    setDebug('');
    let c = null;
    try {
      const info = await readAssetInfo(asset);
      if (id !== reqId.current) return;
      if (info.uri) setUri(info.uri);
      c = info.coords;
      addDebug(`[갤러리 DB location] ${c ? coordText(c) : '없음'}`);
    } catch (e) {
      addDebug(`[getAssetInfoAsync 오류] ${e.message}`);
    }
    await applyCoords(c, '갤러리 DB', id);
  };

  // 시스템 사진 선택기로 고르기
  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('권한 필요', '사진을 불러오려면 앨범 접근 권한이 필요해요.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1, // 재압축 시 EXIF가 바뀌지 않도록 원본 품질
      exif: true, // 위치 정보 읽기에 필수
      // Android: 새 사진 선택기는 GPS를 지우므로, 예전 방식(문서 선택기)으로 열기
      legacy: Platform.OS === 'android',
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    const id = ++reqId.current;
    setUri(asset.uri);
    clearLocation();
    setLoading(true);
    setNote({ text: '사진의 위치 정보를 읽는 중…', warn: false });
    setDebug(`[EXIF] ${gpsDebugText(asset.exif)}\n[assetId] ${asset.assetId ?? '없음'}`);

    // 1순위: 선택기가 넘겨준 EXIF
    let c = getCoordsFromExif(asset.exif);
    let source = 'EXIF';
    // 2순위: assetId가 있으면 갤러리 DB에서 위치 조회
    if (!c && asset.assetId && CAN_USE_MEDIA_LIBRARY) {
      try {
        if (await ensureLibraryPermission()) {
          c = (await readAssetInfo(asset.assetId)).coords;
          source = '갤러리 DB';
        }
      } catch (e) {
        addDebug(`[getAssetInfoAsync 오류] ${e.message}`);
      }
    }
    await applyCoords(c, source, id);
  };

  // 현재 위치를 좌표 + 주소로 채움 (촬영 직후, 또는 "현재 위치 사용" 버튼)
  // ※ 이름이 use로 시작하면 React Hook으로 오인되므로 fill...로 변경
  const fillCurrentLocation = async (source = '현재 위치') => {
    const id = ++reqId.current;
    setLoading(true);
    setNote({ text: '현재 위치를 확인하는 중…', warn: false });
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (id !== reqId.current) return;
      if (status !== 'granted') {
        clearLocation();
        setLoading(false);
        setNote({ text: '위치 권한이 없어 위치를 저장하지 못했어요. 설정에서 위치 권한을 허용해주세요.', warn: true });
        return;
      }

      // 빠른 응답: 1분 이내의 마지막 위치가 있으면 그대로 사용
      let pos = null;
      if (!IS_WEB) {
        try {
          pos = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 100 });
        } catch {
          pos = null;
        }
      }
      if (!pos) {
        pos = await withTimeout(
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          10000,
          '현재 위치'
        );
      }
      if (id !== reqId.current) return;
      await applyCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }, source, id);
    } catch (e) {
      if (id !== reqId.current) return;
      clearLocation();
      setLoading(false);
      addDebug(`[현재 위치 오류] ${e?.message ?? e}`);
      setNote({ text: '현재 위치를 가져오지 못했어요. GPS가 켜져 있는지 확인해주세요.', warn: true });
    }
  };

  // 촬영 직후 현재 위치를 저장 (Expo Go에서도 동작)
  const takePhoto = async () => {
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (!cam.granted) {
      Alert.alert('권한 필요', '카메라 권한이 필요해요.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (result.canceled) return;
    setUri(result.assets[0].uri);
    setDebug('[카메라 촬영] 현재 위치 사용');
    await fillCurrentLocation('촬영 위치(현재 위치)');
  };

  const save = () => {
    if (!uri) return Alert.alert('알림', '사진을 선택해주세요.');
    if (!title.trim()) return Alert.alert('알림', '제목을 입력해주세요.');
    addItem({ uri, title: title.trim(), location: location.trim(), coords });
    reset();
    navigation.navigate('ListTab', { screen: 'PhotoList' });
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.picker} onPress={pickImage} activeOpacity={0.8}>
          {uri ? (
            <ExpoImage source={{ uri }} style={styles.preview} contentFit="cover" />
          ) : (
            <View style={{ alignItems: 'center' }}>
              <Ionicons name="camera-outline" size={40} color="#666" />
              <Text style={styles.pickerText}>눌러서 사진 선택</Text>
            </View>
          )}
        </TouchableOpacity>

        <Text style={styles.label}>제목</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="제목을 입력하세요"
          returnKeyType="done"
        />

        <Text style={styles.label}>위치</Text>
        <View style={styles.locRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={location}
            onChangeText={setLocation}
            placeholder="사진 선택 시 자동 입력"
            multiline
          />
          {loading && <ActivityIndicator style={{ marginLeft: 8 }} />}
        </View>
        {coords && <Text style={styles.coords}>{coordText(coords)}</Text>}
        {note && (
          <Text style={[styles.note, note.warn && styles.noteWarn]}>{note.text}</Text>
        )}

        <View style={styles.btnRow}>
          {!IS_WEB && (
            <TouchableOpacity style={styles.secondaryBtn} onPress={takePhoto}>
              <Ionicons name="camera-outline" size={16} color="#2563eb" />
              <Text style={styles.secondaryText}>촬영하고 위치 저장</Text>
            </TouchableOpacity>
          )}
          {CAN_USE_MEDIA_LIBRARY && (
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setGalleryOpen(true)}>
              <Ionicons name="images-outline" size={16} color="#2563eb" />
              <Text style={styles.secondaryText}>갤러리에서 직접 선택</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => fillCurrentLocation()}>
            <Ionicons name="locate-outline" size={16} color="#2563eb" />
            <Text style={styles.secondaryText}>현재 위치 사용</Text>
          </TouchableOpacity>
          {coords && !loading && (
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => applyCoords(coords, '이전 좌표')}>
              <Ionicons name="refresh-outline" size={16} color="#2563eb" />
              <Text style={styles.secondaryText}>주소 다시 찾기</Text>
            </TouchableOpacity>
          )}
        </View>

        {SHOW_DEBUG && !!debug && (
          <View style={styles.debugBox}>
            <Text style={styles.debugTitle}>디버그 (원인 확인 후 SHOW_DEBUG = false)</Text>
            <Text style={styles.debugText}>{debug}</Text>
          </View>
        )}

        <GalleryModal
          visible={galleryOpen && CAN_USE_MEDIA_LIBRARY}
          onClose={() => setGalleryOpen(false)}
          onSelect={onGallerySelect}
        />

        <TouchableOpacity style={[styles.primaryBtn, { marginTop: 28 }]} onPress={save}>
          <Text style={styles.primaryBtnText}>저장</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ─────────────────────────────
 * 네비게이션
 * ───────────────────────────── */
const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

const ListStack = () => (
  <Stack.Navigator>
    <Stack.Screen
      name="PhotoList"
      component={PhotoListScreen}
      options={({ navigation }) => ({
        title: '내 사진',
        headerRight: () => (
          <TouchableOpacity
            style={{ marginRight: 16 }}
            onPress={() => navigation.navigate('PhotoInput')}>
            <Ionicons name="add-circle" size={28} color="tomato" />
          </TouchableOpacity>
        ),
      })}
    />
    <Stack.Screen
      name="PhotoInput"
      component={PhotoInputScreen}
      options={{ title: '사진 등록' }}
    />
  </Stack.Navigator>
);

const InputStack = () => (
  <Stack.Navigator>
    <Stack.Screen
      name="PhotoInputTab"
      component={PhotoInputScreen}
      options={{ title: '사진 등록' }}
    />
  </Stack.Navigator>
);

export default function App() {
  return (
    <PhotoProvider>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarActiveTintColor: 'tomato',
            tabBarInactiveTintColor: 'gray',
            tabBarIcon: ({ color, size }) => {
              const iconName = route.name === 'ListTab' ? 'list' : 'add-circle-outline';
              return <Ionicons name={iconName} size={size} color={color} />;
            },
          })}>
          <Tab.Screen name="ListTab" component={ListStack} options={{ title: '목록' }} />
          <Tab.Screen name="InputTab" component={InputStack} options={{ title: '등록' }} />
        </Tab.Navigator>
      </NavigationContainer>
    </PhotoProvider>
  );
}

/* ─────────────────────────────
 * 스타일
 * ───────────────────────────── */
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f7f9' },
  emptyWrap: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { marginTop: 8, color: '#888' },
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  thumb: { width: 72, height: 72, borderRadius: 8, backgroundColor: '#eee' },
  info: { flex: 1, marginLeft: 12, justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '600', color: '#111' },
  location: { fontSize: 13, color: '#555', marginTop: 4 },
  coords: { fontSize: 11, color: '#999', marginTop: 4 },
  picker: {
    height: 240,
    borderRadius: 12,
    backgroundColor: '#e5e7eb',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  pickerText: { color: '#555', fontSize: 15, marginTop: 6 },
  preview: { width: '100%', height: '100%' },
  label: { marginTop: 20, marginBottom: 6, fontWeight: '600', color: '#333' },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  locRow: { flexDirection: 'row', alignItems: 'center' },
  note: { marginTop: 6, fontSize: 13, color: '#4b5563' },
  noteWarn: { color: '#d97706' },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
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
  primaryBtn: {
    backgroundColor: 'tomato',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  statusLine: { fontSize: 11, color: '#64748b', paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#f8fafc' },
  debugBox: { marginTop: 16, padding: 10, borderRadius: 8, backgroundColor: '#f1f5f9' },
  debugTitle: { fontSize: 11, fontWeight: '700', color: '#64748b', marginBottom: 4 },
  debugText: { fontSize: 11, color: '#334155', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
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
