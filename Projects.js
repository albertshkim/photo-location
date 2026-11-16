/* ─────────────────────────────
 * Projects.js — 프로젝트(동네·장소·주제별 사진 묶음) 화면
 * ─────────────────────────────
 *  ProjectListScreen   : 최근 사용 순 프로젝트 목록, 열기, 삭제, 종류별 보기, 대량 업로드 진입
 *  ProjectCreateScreen : 새 프로젝트 만들기 (이름, 종류, 저장 키 접두어(prefix))
 *  BulkUploadScreen    : 사진 대량 업로드 (위치 → "xxx동" 자동 제목, 위치 없으면 "주소정보 없음")
 */
import React, { useEffect, useRef, useState } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { Image as ExpoImage } from 'expo-image';

// App.js에 있는 공통 상태·유틸 (입력 모듈과 같은 함수 사용)
import {
  IS_WEB,
  IS_EXPO_GO,
  CAN_USE_MEDIA_LIBRARY,
  usePhotos,
  getCoordsFromExif,
  coordText,
  resolveAddress,
  ensureLibraryPermission,
  readAssetInfo,
} from './App';
import {
  PROJECT_TYPES,
  PREFIX_RE,
  PREFIX_RULE,
  typeLabel,
  typeIcon,
  itemsKey,
  suggestPrefix,
} from './storage';

const notify = (title, msg) => (IS_WEB ? window.alert(`${title}\n${msg}`) : Alert.alert(title, msg));

const confirmAsk = (title, msg, okText, onOk) => {
  if (IS_WEB) {
    if (window.confirm(`${title}\n${msg}`)) onOk();
    return;
  }
  Alert.alert(title, msg, [
    { text: '취소', style: 'cancel' },
    { text: okText, style: 'destructive', onPress: onOk },
  ]);
};

// 2026.11.13 14:05
const formatDateTime = (ts) => {
  if (!ts) return '-';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* ─────────────────────────────
 * 프로젝트 목록 (최근 사용 순)
 * ───────────────────────────── */
export function ProjectListScreen({ navigation }) {
  const { projects, currentProject, openProject, deleteProject } = usePhotos();
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);

  const data = filter === 'all' ? projects : projects.filter((p) => p.type === filter);

  const open = async (p, next = 'PhotoList') => {
    if (busyId) return;
    setBusyId(p.id);
    try {
      await openProject(p.id); // 최근 사용 시각도 갱신
      navigation.navigate(next);
    } catch (e) {
      notify('열기 실패', e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = (p) =>
    confirmAsk(
      '프로젝트 삭제',
      `"${p.name}" 프로젝트와 사진 ${p.count ?? 0}장을 모두 삭제할까요?\n되돌릴 수 없어요.`,
      '삭제',
      async () => {
        setBusyId(p.id);
        try {
          await deleteProject(p.id);
        } catch (e) {
          notify('삭제 실패', e?.message ?? String(e));
        } finally {
          setBusyId(null);
        }
      }
    );

  const chips = [{ key: 'all', label: '전체', icon: 'albums-outline' }, ...PROJECT_TYPES];

  return (
    <View style={styles.screen}>
      {/* 종류별 보기 */}
      <View style={styles.chipRow}>
        {chips.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={[styles.chip, filter === c.key && styles.chipOn]}
            onPress={() => setFilter(c.key)}>
            <Ionicons name={c.icon} size={14} color={filter === c.key ? '#fff' : '#374151'} />
            <Text style={[styles.chipText, filter === c.key && styles.chipTextOn]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={data}
        keyExtractor={(p) => p.id}
        contentContainerStyle={data.length === 0 ? styles.emptyWrap : { padding: 16, paddingTop: 4 }}
        ListHeaderComponent={
          data.length > 0 ? <Text style={styles.sectionTitle}>최근 사용 순</Text> : null
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center' }}>
            <Ionicons name="folder-open-outline" size={44} color="#bbb" />
            <Text style={styles.empty}>이 종류의 프로젝트가 없어요.</Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { marginTop: 16 }]}
              onPress={() => navigation.navigate('ProjectCreate', { type: filter === 'all' ? 'dong' : filter })}>
              <Text style={styles.primaryBtnText}>새 프로젝트 만들기</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item: p }) => {
          const isCurrent = currentProject?.id === p.id;
          return (
            <TouchableOpacity
              style={[styles.card, isCurrent && styles.cardCurrent]}
              activeOpacity={0.8}
              onPress={() => open(p)}>
              <View style={styles.typeIcon}>
                <Ionicons name={typeIcon(p.type)} size={20} color="tomato" />
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                  {isCurrent && <Text style={styles.badge}>사용 중</Text>}
                </View>
                <Text style={styles.meta}>
                  {typeLabel(p.type)} · 사진 {p.count ?? 0}장 · 접두어 {p.prefix}
                </Text>
                <Text style={styles.meta}>최근 사용 {formatDateTime(p.lastUsedAt)}</Text>
              </View>
              {busyId === p.id ? (
                <ActivityIndicator />
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {/* 사진 대량 업로드 */}
                  <TouchableOpacity
                    onPress={() => open(p, 'BulkUpload')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{ paddingLeft: 8 }}>
                    <Ionicons name="cloud-upload-outline" size={20} color="#2563eb" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => remove(p)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{ paddingLeft: 14 }}>
                    <Ionicons name="trash-outline" size={20} color="#dc2626" />
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

/* ─────────────────────────────
 * 새 프로젝트 만들기
 * ───────────────────────────── */
export function ProjectCreateScreen({ navigation, route }) {
  const { createProject, isPrefixAvailable } = usePhotos();
  const [name, setName] = useState('');
  const [type, setType] = useState(route.params?.type ?? 'dong');
  const [prefix, setPrefix] = useState('');
  const [saving, setSaving] = useState(false);
  // 사용자가 접두어를 직접 고치면 자동 추천으로 덮어쓰지 않음
  const prefixEdited = useRef(false);

  useEffect(() => {
    if (!prefixEdited.current) setPrefix(suggestPrefix(name, type, isPrefixAvailable));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, type]);

  const prefixError = !prefix
    ? '접두어를 입력해주세요.'
    : !PREFIX_RE.test(prefix)
    ? PREFIX_RULE
    : !isPrefixAvailable(prefix)
    ? '이미 다른 프로젝트가 쓰고 있는 접두어예요.'
    : null;

  const resetPrefix = () => {
    prefixEdited.current = false;
    setPrefix(suggestPrefix(name, type, isPrefixAvailable));
  };

  // next: 만든 뒤 이동할 화면 ('PhotoList' | 'BulkUpload')
  const create = async (next = 'PhotoList') => {
    if (saving) return;
    if (!name.trim()) return notify('알림', '프로젝트 이름을 입력해주세요.');
    if (prefixError) return notify('알림', prefixError);
    setSaving(true);
    try {
      await createProject({ name: name.trim(), type, prefix });
      navigation.navigate(next); // 새 프로젝트가 열린 상태로 이동
    } catch (e) {
      notify('만들기 실패', e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const placeholder = { dong: '예) 역삼동', place: '예) 한강공원', topic: '예) 맛집 기록' }[type];
  const invalid = saving || !!prefixError || !name.trim();

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>종류</Text>
        <View style={[styles.chipRow, { paddingHorizontal: 0, paddingTop: 0 }]}>
          {PROJECT_TYPES.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.chip, type === t.key && styles.chipOn]}
              onPress={() => setType(t.key)}>
              <Ionicons name={t.icon} size={14} color={type === t.key ? '#fff' : '#374151'} />
              <Text style={[styles.chipText, type === t.key && styles.chipTextOn]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>프로젝트 이름</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder={placeholder}
          returnKeyType="done"
        />

        <Text style={styles.label}>저장 키 접두어 (prefix)</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TextInput
            style={[styles.input, { flex: 1 }, !!prefixError && styles.inputError]}
            value={prefix}
            onChangeText={(t) => {
              prefixEdited.current = true;
              setPrefix(t.trim());
            }}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="예) dong_yeoksam"
          />
          <TouchableOpacity style={styles.secondaryBtn} onPress={resetPrefix}>
            <Ionicons name="refresh-outline" size={16} color="#2563eb" />
            <Text style={styles.secondaryText}>자동</Text>
          </TouchableOpacity>
        </View>
        {prefixError ? (
          <Text style={styles.error}>{prefixError}</Text>
        ) : (
          <View style={styles.previewBox}>
            <Text style={styles.previewText}>저장 키 : {itemsKey(prefix)}</Text>
            {!IS_WEB && <Text style={styles.previewText}>사진 폴더 : photos/{prefix}/</Text>}
          </View>
        )}
        <Text style={styles.help}>
          접두어는 이 프로젝트의 데이터를 저장하는 이름이에요. 만든 뒤에는 바꿀 수 없어요. ({PREFIX_RULE})
        </Text>

        <TouchableOpacity
          style={[styles.primaryBtn, { marginTop: 28 }, invalid && styles.disabled]}
          onPress={() => create('PhotoList')}
          disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>만들고 열기</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.outlineBtn, { marginTop: 10 }, invalid && styles.disabled]}
          onPress={() => create('BulkUpload')}
          disabled={saving}>
          <Ionicons name="images-outline" size={18} color="tomato" />
          <Text style={styles.outlineBtnText}>만들고 사진 대량 업로드</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ═════════════════════════════
 * 사진 대량 업로드 — 주소 → 제목 도우미
 * ═════════════════════════════ */
export const NO_ADDRESS_TITLE = '주소정보 없음';

// 주소 변환(resolveAddress)을 연달아 부를 때 최소 간격.
// OpenStreetMap(Nominatim) 등 무료 서버는 1초에 1번 제한이 있어요. 기기 지오코더만 쓴다면 0으로 줄여도 됩니다.
const GEOCODE_GAP_MS = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// EXIF 날짜 "2026:11:13 14:05:09" → 타임스탬프(ms)  (입력 모듈과 같은 규칙)
function takenAtFromExif(exif) {
  if (!exif) return null;
  const raw =
    exif.DateTimeOriginal ||
    exif['{Exif}']?.DateTimeOriginal ||
    exif.DateTimeDigitized ||
    exif['{Exif}']?.DateTimeDigitized ||
    exif.DateTime ||
    exif['{TIFF}']?.DateTime;
  const m = typeof raw === 'string' && raw.match(/^(\d{4})[:.-](\d{2})[:.-](\d{2})[ T]?(\d{2})?:?(\d{2})?:?(\d{2})?/);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', se = '0'] = m;
  const ts = new Date(+y, +mo - 1, +d, +h, +mi, +se).getTime();
  return Number.isFinite(ts) && +y > 1970 ? ts : null;
}

/**
 * 주소 → 번지수를 뺀 "동" 단위 제목
 *  "서울특별시 강남구 역삼동 123-45"                → 역삼동
 *  "서울 강남구 테헤란로 152 (역삼동, OO빌딩)"       → 역삼동   (도로명 주소의 괄호 속 동)
 *  "152, 테헤란로, 역삼1동, 강남구, 서울, 대한민국"   → 역삼1동  (OpenStreetMap 형식)
 *  "서울 중구 을지로3가 5-1"                        → 을지로3가
 *  "경기 양평군 서종면 문호리 123"                   → 서종면 문호리
 *  동을 못 찾으면 구/군/시 이름, 그것도 없으면 null
 */
export function dongTitleFromAddress(address) {
  if (!address) return null;
  const text = String(address);
  // 쉼표로 3덩어리 이상이면 OSM 형식(작은 단위 → 큰 단위), 아니면 한국식(큰 단위 → 작은 단위)
  const smallFirst = text.split(',').length >= 3;
  let tokens = text
    .replace(/[()[\]]/g, ' ')
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t && !/^[-\d]/.test(t) && t !== '대한민국' && !/(로|길)$/.test(t)); // 번지·우편번호·도로명 제외
  if (!smallFirst) tokens = tokens.reverse(); // 항상 작은 단위부터 보도록

  const dong = tokens.find((t) => /^[가-힣]+\d*(동|가)$/.test(t));
  if (dong) return dong;

  const eupMyeon = tokens.find((t) => /^[가-힣]+(읍|면)$/.test(t));
  const ri = tokens.find((t) => /^[가-힣]+\d*리$/.test(t));
  if (eupMyeon && ri) return `${eupMyeon} ${ri}`;
  if (eupMyeon || ri) return eupMyeon || ri;

  const roman = tokens.find((t) => /^[A-Za-z0-9]+-(dong|ga|eup|myeon|ri)$/i.test(t));
  if (roman) return roman;

  return tokens.find((t) => /^[가-힣]+(구|군|시)$/.test(t)) ?? null;
}

/* ─────────────────────────────
 * 해외 주소 → 제목
 *  1순위: 동네 단위 이름 (Quartier …, … District, 道玄坂 같은 丁目 앞 이름 등)
 *  2순위: 처음 나오는 번지(숫자) 앞까지의 주소
 *  예) "Eiffel Tower, 5, Avenue Anatole France, Quartier du Gros-Caillou, Paris, France" → Quartier du Gros-Caillou
 *      "東京都渋谷区道玄坂２丁目２９−１"                       → 東京都渋谷区道玄坂
 *      "미국 캘리포니아 마운틴뷰 앰피시어터 파크웨이 1600"       → 미국 캘리포니아 마운틴뷰 앰피시어터 파크웨이
 *      "Rue de Rivoli 12, 75004 Paris, France"              → Rue de Rivoli
 *      "1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA" → Amphitheatre Pkwy, Mountain View, CA
 * ───────────────────────────── */
const KOREA_RE =
  /(대한민국|South Korea|Republic of Korea)|(^|[\s,(])(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)|\b[A-Z][a-z]+-(dong|gu|eup|myeon)\b/i;
const NEIGHBORHOOD_RE =
  /\b(quartier|neighbou?rhood|district|ward|arrondissement|borough|barrio|bairro|colonia|kiez|ortsteil|stadtteil|quarter|sub-?district|kelurahan|barangay)\b|(丁目|町|街道|社区|社區|地区|地區|지구|구역)$/i;
const DIGIT_RE = /[0-9０-９]/;
const SEP_TRIM_RE = /^[\s,，、\-–−#№.:/]+|[\s,，、\-–−#№.:/]+$/g;

const beforeFirstNumber = (s) => {
  const i = s.search(DIGIT_RE);
  return (i < 0 ? s : s.slice(0, i)).replace(/\b(No|Nr|n°)\.?\s*$/i, '').replace(SEP_TRIM_RE, '');
};

// 우편번호 덩어리 (75007, 150-0043, CA 94043, 〒150-0043) — 번지로 착각하지 않도록 먼저 뺌
const POSTCODE_PART_RE = /^(〒\s*)?[A-Z]{0,3}\s?[0-9０-９][0-9０-９\-－−\s]{2,}[A-Z]{0,3}$/;

// 제목이 너무 길지 않게 앞쪽 2덩어리까지만
const firstParts = (s, n = 2) =>
  s.split(/[,，、]/).map((p) => p.trim()).filter(Boolean).slice(0, n).join(', ');

export function foreignTitleFromAddress(address) {
  const raw = String(address).replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const parts = raw
    .replace(/〒\s*[0-9０-９\-－−]+/g, ' ')
    .split(/[,，、]/)
    .map((p) => p.trim())
    .filter((p) => p && !POSTCODE_PART_RE.test(p));
  const text = parts.join(', ');

  // 1) 동네 단위 이름 (숫자 없는 부분 중 작은 단위부터)
  const hood = parts.find((p) => !DIGIT_RE.test(p) && NEIGHBORHOOD_RE.test(p));
  if (hood) return hood;

  // 2) 처음 번지(숫자) 앞까지
  const head = firstParts(beforeFirstNumber(text));
  if (head) return head;

  // 3) 주소가 번지로 시작하면("1600 Amphitheatre Pkwy, …") 앞 번지를 빼고 다음 숫자 앞까지
  const rest = firstParts(beforeFirstNumber(text.replace(/^[0-9０-９][^\s,，、]*[\s,，、]*/, '')));
  return rest || null;
}

// 한국 주소 → "xx동", 해외 주소 → 동네 이름 또는 첫 번지 앞 주소
export function titleFromAnyAddress(address) {
  if (!address) return null;
  if (KOREA_RE.test(address)) {
    const t = dongTitleFromAddress(address);
    if (t) return t;
  }
  return (
    foreignTitleFromAddress(address) ||
    // 그래도 못 만들면 주소 앞부분 (주소가 있으니 "주소정보 없음"은 쓰지 않음)
    String(address).replace(/\s+/g, ' ').trim().slice(0, 20)
  );
}

const titleFor = (coords, address) =>
  coords && address ? titleFromAnyAddress(address) || NO_ADDRESS_TITLE : NO_ADDRESS_TITLE;

// 같은 위치(약 10m)는 한 번만 조회 — 화면을 다시 열어도 유지
const addrCache = new Map();
let lastLookupAt = 0;

async function lookupAddress(c) {
  const key = `${c.latitude.toFixed(4)},${c.longitude.toFixed(4)}`;
  if (addrCache.has(key)) return addrCache.get(key);
  // 한 장씩 등록과 같은 resolveAddress 사용. 연속 호출로 실패하면 잠깐 쉬고 1번 더 시도
  for (let attempt = 0; attempt < 2; attempt++) {
    const wait = lastLookupAt + GEOCODE_GAP_MS * (attempt + 1) - Date.now();
    if (wait > 0) await sleep(wait);
    lastLookupAt = Date.now();
    try {
      const r = await resolveAddress(c); // App.js: { address, source, errors }
      if (r?.address) {
        addrCache.set(key, r.address);
        return r.address;
      }
    } catch {}
  }
  return null; // 실패는 캐시하지 않음 (다시 찾기 가능)
}

// 갤러리 DB(expo-media-library)의 촬영 시각 (development build에서만)
async function takenAtFromLibrary(assetId) {
  if (!CAN_USE_MEDIA_LIBRARY || !assetId) return null;
  try {
    const t = (await MediaLibrary.getAssetInfoAsync(assetId))?.creationTime;
    return Number.isFinite(t) && t > 0 ? t : null;
  } catch {
    return null;
  }
}

/* ─────────────────────────────
 * 사진 대량 업로드 화면
 * ───────────────────────────── */
export function BulkUploadScreen({ navigation }) {
  const photoCtx = usePhotos();
  const { currentProject } = photoCtx;
  // 업로드 반복 중에도 항상 최신 addItem을 쓰기 위해 (저장 후 다시 그려지면 함수가 바뀔 수 있음)
  const ctxRef = useRef(photoCtx);
  ctxRef.current = photoCtx;

  const [items, setItems] = useState([]);
  const [phase, setPhase] = useState('idle'); // idle | analyzing | ready | uploading | done
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const cancelRef = useRef(false);

  const patch = (key, p) => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...p } : it)));
  // 사용자가 고치지 않은 제목만 자동 제목으로 바꿈
  const patchAuto = (key, p, nextTitle) =>
    setItems((prev) =>
      prev.map((it) =>
        it.key !== key
          ? it
          : {
              ...it,
              ...p,
              title: it.title === it.autoTitle ? nextTitle : it.title,
              autoTitle: nextTitle,
            }
      )
    );
  const busy = phase === 'analyzing' || phase === 'uploading';

  /* 1) 사진 여러 장 고르기 */
  const pick = async () => {
    if (busy) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return notify('권한 필요', '사진을 불러오려면 앨범 접근 권한이 필요해요.');

    let res;
    try {
      res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 0, // 0 = 제한 없음
        orderedSelection: true,
        quality: 1, // 재압축 시 EXIF가 바뀌지 않도록 원본 품질
        exif: true, // 위치·촬영일 읽기에 필수
        // Android: 새 사진 선택기는 GPS를 지우므로 예전 방식(문서 선택기)으로 (입력 모듈과 동일)
        legacy: Platform.OS === 'android',
      });
    } catch (e) {
      return notify('사진 선택 실패', e?.message ?? String(e));
    }
    if (res.canceled || !res.assets?.length) return;

    const stamp = Date.now();
    const added = res.assets.map((a, i) => ({
      key: `${stamp}_${i}`,
      asset: a,
      uri: a.uri,
      title: '',
      autoTitle: '',
      location: '',
      coords: null,
      takenAt: null,
      addrFailed: false,
      status: 'analyzing',
    }));
    setItems((prev) => [...prev, ...added]);
    await analyze(added);
  };

  /* 2) 위치·촬영일 읽기 → 주소 → 제목 */
  const analyze = async (list) => {
    setPhase('analyzing');
    setProgress({ done: 0, total: list.length });

    let libOk = false;
    if (CAN_USE_MEDIA_LIBRARY && list.some((it) => it.asset.assetId)) {
      try {
        libOk = await ensureLibraryPermission();
      } catch {}
    }

    for (let i = 0; i < list.length; i++) {
      const { key, asset } = list[i];

      // 위치: 1순위 EXIF, 2순위 갤러리 DB
      let coords = getCoordsFromExif(asset.exif) ?? null;
      if (!coords && libOk && asset.assetId) {
        try {
          coords = (await readAssetInfo(asset.assetId))?.coords ?? null;
        } catch {}
      }
      // 촬영일: 1순위 EXIF, 2순위 갤러리 DB
      let takenAt = takenAtFromExif(asset.exif);
      if (!takenAt && libOk) takenAt = await takenAtFromLibrary(asset.assetId);

      const address = coords ? await lookupAddress(coords) : null;
      const addrFailed = !!coords && !address;
      const title = titleFor(coords, address);

      patch(key, {
        coords,
        takenAt,
        // 주소 변환 실패 시 입력 모듈처럼 좌표를 위치로 저장
        location: address ?? (coords ? coordText(coords) : ''),
        addrFailed,
        title,
        autoTitle: title,
        status: 'ready',
      });
      setProgress({ done: i + 1, total: list.length });
    }
    setPhase('ready');
  };

  /* 주소 변환에 실패했던 사진만 다시 찾기 */
  const retryAddresses = async () => {
    const targets = items.filter((it) => it.addrFailed && it.coords && it.status !== 'done');
    if (!targets.length || busy) return;
    setPhase('analyzing');
    setProgress({ done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      const it = targets[i];
      const address = await lookupAddress(it.coords);
      if (address) {
        patchAuto(it.key, { location: address, addrFailed: false }, titleFor(it.coords, address));
      }
      setProgress({ done: i + 1, total: targets.length });
    }
    setPhase('ready');
  };

  /* 3) 업로드: 현재 프로젝트에 한 장씩 addItem */
  const uploadAll = async () => {
    const targets = items.filter((it) => it.status === 'ready' || it.status === 'error');
    if (!targets.length) return;
    if (typeof ctxRef.current.addItem !== 'function') {
      return notify('설정 필요', 'usePhotos()에 addItem 함수가 없어요. App.js를 확인해주세요.');
    }

    cancelRef.current = false;
    setPhase('uploading');
    setProgress({ done: 0, total: targets.length });
    let ok = 0;
    let fail = 0;

    for (let i = 0; i < targets.length; i++) {
      if (cancelRef.current) break;
      const it = targets[i];
      patch(it.key, { status: 'saving' });
      try {
        await ctxRef.current.addItem({
          uri: it.uri,
          title: it.title.trim() || NO_ADDRESS_TITLE,
          location: it.location.trim(),
          coords: it.coords,
          description: '',
          takenAt: it.takenAt ?? null, // 리스트보기의 촬영일 표시용
          createdAt: Date.now(), // 등록일 (촬영일이 없을 때 대신 표시)
        });
        patch(it.key, { status: 'done', error: null });
        ok++;
      } catch (e) {
        patch(it.key, { status: 'error', error: e?.message ?? String(e) });
        fail++;
      }
      setProgress({ done: i + 1, total: targets.length });
      await sleep(0); // 화면이 다시 그려져 최신 addItem이 ctxRef에 들어오도록
    }

    setPhase('done');
    const stopped = cancelRef.current ? ' (중간에 멈춤)' : '';
    notify('업로드 완료', `${ok}장 추가${fail ? `, ${fail}장 실패` : ''}${stopped}`);
  };

  const removeItem = (key) => setItems((prev) => prev.filter((it) => it.key !== key));
  const clearDone = () => {
    setItems((prev) => prev.filter((it) => it.status !== 'done'));
    setPhase('ready');
  };

  if (!currentProject) {
    return (
      <View style={[styles.screen, styles.emptyWrap]}>
        <Ionicons name="folder-open-outline" size={44} color="#bbb" />
        <Text style={styles.empty}>먼저 사진을 넣을 프로젝트를 열어주세요.</Text>
        <TouchableOpacity
          style={[styles.primaryBtn, { marginTop: 16 }]}
          onPress={() => navigation.navigate('ProjectList')}>
          <Text style={styles.primaryBtnText}>프로젝트 목록</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 제목별 장수 요약 (예: 역삼동 12 · 주소정보 없음 3)
  const summary = Object.entries(
    items.reduce((acc, it) => {
      if (it.status === 'analyzing') return acc;
      const t = it.title.trim() || NO_ADDRESS_TITLE;
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]);

  const pending = items.filter((it) => it.status === 'ready' || it.status === 'error').length;
  const doneCount = items.filter((it) => it.status === 'done').length;
  const failedAddr = items.filter((it) => it.addrFailed && it.status !== 'done').length;

  return (
    <View style={styles.screen}>
      <View style={styles.bulkHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name={typeIcon(currentProject.type)} size={16} color="tomato" />
          <Text style={styles.name} numberOfLines={1}>
            {currentProject.name}
          </Text>
          <Text style={styles.meta}>({typeLabel(currentProject.type)})에 저장</Text>
        </View>

        {Platform.OS === 'android' && IS_EXPO_GO && (
          <Text style={styles.warnText}>
            Expo Go(Android)에서는 갤러리 사진의 위치를 못 읽는 경우가 많아 "{NO_ADDRESS_TITLE}"이 많을 수 있어요.
            development build에서는 정상적으로 읽혀요.
          </Text>
        )}

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <TouchableOpacity
            style={[styles.outlineBtn, { flex: 1 }, busy && styles.disabled]}
            onPress={pick}
            disabled={busy}>
            <Ionicons name="images-outline" size={18} color="tomato" />
            <Text style={styles.outlineBtnText}>{items.length ? '사진 더 고르기' : '사진 여러 장 고르기'}</Text>
          </TouchableOpacity>
          {phase === 'uploading' ? (
            <TouchableOpacity
              style={[styles.primaryBtn, { flex: 1, backgroundColor: '#6b7280' }]}
              onPress={() => (cancelRef.current = true)}>
              <Text style={styles.primaryBtnText}>멈추기</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.primaryBtn, { flex: 1 }, (busy || !pending) && styles.disabled]}
              onPress={uploadAll}
              disabled={busy || !pending}>
              <Text style={styles.primaryBtnText}>{pending ? `${pending}장 업로드` : '업로드'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {busy && (
          <View style={styles.progressWrap}>
            <View style={[styles.progressBar, { width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }]} />
            <Text style={styles.progressText}>
              {phase === 'analyzing' ? '위치·주소 확인 중' : '업로드 중'} {progress.done}/{progress.total}
            </Text>
          </View>
        )}

        {!busy && failedAddr > 0 && (
          <TouchableOpacity style={[styles.secondaryBtn, { marginTop: 10, alignSelf: 'flex-start' }]} onPress={retryAddresses}>
            <Ionicons name="refresh-outline" size={16} color="#2563eb" />
            <Text style={styles.secondaryText}>주소 못 찾은 {failedAddr}장 다시 찾기</Text>
          </TouchableOpacity>
        )}

        {summary.length > 0 && (
          <View style={[styles.chipRow, { paddingHorizontal: 0, paddingBottom: 0 }]}>
            {summary.map(([t, n]) => (
              <View key={t} style={[styles.chip, t === NO_ADDRESS_TITLE && { borderColor: '#f59e0b' }]}>
                <Ionicons
                  name={t === NO_ADDRESS_TITLE ? 'help-circle-outline' : 'location-outline'}
                  size={14}
                  color={t === NO_ADDRESS_TITLE ? '#f59e0b' : '#374151'}
                />
                <Text style={styles.chipText}>
                  {t} {n}
                </Text>
              </View>
            ))}
          </View>
        )}

        {phase === 'done' && doneCount > 0 && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <TouchableOpacity style={[styles.secondaryBtn, { flex: 1, justifyContent: 'center' }]} onPress={clearDone}>
              <Text style={styles.secondaryText}>완료된 사진 지우기</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryBtn, { flex: 1, justifyContent: 'center' }]}
              onPress={() => navigation.navigate('PhotoList')}>
              <Text style={styles.secondaryText}>사진 목록으로</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.key}
        initialNumToRender={12}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={items.length === 0 ? styles.emptyWrap : { padding: 16, paddingTop: 8 }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingHorizontal: 24 }}>
            <Ionicons name="cloud-upload-outline" size={44} color="#bbb" />
            <Text style={[styles.empty, { textAlign: 'center' }]}>
              사진을 여러 장 고르면 촬영 위치로 제목(예: 역삼동)을 자동으로 달아줘요.{'\n'}
              위치 정보가 없는 사진은 "{NO_ADDRESS_TITLE}"으로 올라가요.
            </Text>
          </View>
        }
        renderItem={({ item: it }) => (
          <View style={[styles.card, it.status === 'error' && { borderColor: '#dc2626' }]}>
            <ExpoImage source={{ uri: it.uri }} style={styles.thumb} contentFit="cover" recyclingKey={it.key} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              {it.status === 'analyzing' ? (
                <Text style={styles.meta}>위치 확인 중…</Text>
              ) : (
                <TextInput
                  style={[styles.titleInput, it.title === NO_ADDRESS_TITLE && { color: '#b45309' }]}
                  value={it.title}
                  onChangeText={(t) => patch(it.key, { title: t })}
                  editable={it.status === 'ready' || it.status === 'error'}
                  placeholder={NO_ADDRESS_TITLE}
                />
              )}
              {it.status !== 'analyzing' && (
                <Text style={[styles.meta, it.addrFailed && { color: '#b45309' }]} numberOfLines={1}>
                  📍 {it.location || '위치 정보 없음'}
                  {it.addrFailed ? ' (주소 변환 실패)' : ''}
                </Text>
              )}
              {!!it.takenAt && <Text style={styles.meta}>촬영 {formatDateTime(it.takenAt)}</Text>}
              {it.status === 'error' && (
                <Text style={styles.error} numberOfLines={2}>
                  {it.error}
                </Text>
              )}
            </View>
            <View style={{ width: 28, alignItems: 'center', marginLeft: 6 }}>
              {it.status === 'analyzing' || it.status === 'saving' ? (
                <ActivityIndicator size="small" />
              ) : it.status === 'done' ? (
                <Ionicons name="checkmark-circle" size={22} color="#16a34a" />
              ) : busy ? null : (
                <TouchableOpacity onPress={() => removeItem(it.key)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle-outline" size={22} color="#9ca3af" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f7f9' },
  emptyWrap: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { marginTop: 8, color: '#888', lineHeight: 20 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: '#6b7280', marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
  },
  chipOn: { backgroundColor: 'tomato', borderColor: 'tomato' },
  chipText: { fontSize: 13, color: '#374151', fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#eef0f3',
  },
  cardCurrent: { borderColor: 'tomato' },
  typeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff1ee',
    justifyContent: 'center',
    alignItems: 'center',
  },
  name: { fontSize: 16, fontWeight: '700', color: '#111', flexShrink: 1 },
  badge: {
    fontSize: 11,
    color: '#fff',
    backgroundColor: 'tomato',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    overflow: 'hidden',
  },
  meta: { fontSize: 12, color: '#6b7280', marginTop: 3 },
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
  inputError: { borderColor: '#dc2626' },
  error: { marginTop: 6, fontSize: 13, color: '#dc2626' },
  previewBox: { marginTop: 6, padding: 8, borderRadius: 6, backgroundColor: '#f1f5f9' },
  previewText: { fontSize: 12, color: '#334155', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  help: { marginTop: 8, fontSize: 12, color: '#6b7280', lineHeight: 18 },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  outlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'tomato',
    backgroundColor: '#fff',
  },
  outlineBtnText: { color: 'tomato', fontWeight: '700', fontSize: 15 },
  disabled: { opacity: 0.5 },

  // 대량 업로드
  warnText: { marginTop: 8, fontSize: 12, color: '#b45309', lineHeight: 17 },
  bulkHeader: {
    backgroundColor: '#fff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eef0f3',
  },
  progressWrap: {
    marginTop: 12,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#f1f5f9',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  progressBar: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#fecaca' },
  progressText: { textAlign: 'center', fontSize: 12, fontWeight: '600', color: '#374151' },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: '#e5e7eb' },
  titleInput: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111',
    paddingVertical: 4,
    paddingHorizontal: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
});
