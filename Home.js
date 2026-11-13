import React, { useMemo, useRef, useState } from 'react';
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
  Linking,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library';
import { Image as ExpoImage } from 'expo-image';

// App.js에 있는 공통 상태·유틸·갤러리 모달
import {
  IS_WEB,
  IS_EXPO_GO,
  CAN_USE_MEDIA_LIBRARY,
  SHOW_DEBUG,
  usePhotos,
  getCoordsFromExif,
  coordText,
  gpsDebugText,
  withTimeout,
  resolveAddress,
  ensureLibraryPermission,
  readAssetInfo,
  GalleryModal,
} from './App';
// 수정 화면
import PhotoEditScreen from './PhotoEdit';
// 프로젝트(동네·장소·주제별) 화면
import { ProjectListScreen, ProjectCreateScreen } from './Projects';
import { typeIcon, typeLabel } from './storage';
// 키워드 검색 (목록·리스트보기·보기 화면 공용)
import { SearchBar, NoResult } from './Search';
// 날짜 표시 + 날짜 포함 검색 (보기 화면과 공용)
import { ymd, photoDate, formatDate, searchItems } from './Datesearch';
export { photoDate, formatDate, searchItems };
// 보기 화면 (사진만 3장씩)
import PhotoShortViewScreen from './Photoshortview';
// 사진 슬라이드 쇼 (보기 화면과 공용)
import SlideShow from './Slideshow';

/* ─────────────────────────────
 * 리스트 모듈
 * ───────────────────────────── */
/* ─────────────────────────────
 * 삭제 기능 (확인 창 + 삭제) — 사진 목록 / 리스트보기에서 함께 사용
 * ───────────────────────────── */
function useDeleteItem() {
  const photos = usePhotos();

  // App.js에 deleteItem이 없으면 setItems로 대신 삭제
  const removeById = (id) => {
    if (typeof photos.deleteItem === 'function') return photos.deleteItem(id);
    if (typeof photos.setItems === 'function') {
      return photos.setItems((prev) => prev.filter((it) => it.id !== id));
    }
    throw new Error('usePhotos()에 deleteItem / setItems 가 없어요. App.js를 확인해주세요.');
  };

  const doDelete = async (id) => {
    try {
      await removeById(id); // 저장 + 사진 파일 삭제까지 기다림
    } catch (e) {
      notify('삭제 실패', e?.message ?? String(e));
    }
  };

  // 확인 후 삭제
  return (item) => {
    const name = item?.title ? `"${item.title}"` : '이 항목';
    const msg = `${name}을(를) 삭제할까요?`;
    if (IS_WEB) {
      // Snack 웹 미리보기에서는 Alert 버튼이 동작하지 않음
      if (window.confirm(msg)) doDelete(item.id);
      return;
    }
    Alert.alert('삭제', msg, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => doDelete(item.id) },
    ]);
  };
}

function PhotoHomeScreen({ navigation }) {
  const { items } = usePhotos();
  const confirmDelete = useDeleteItem();
  const [query, setQuery] = useState('');
  const shown = useMemo(() => searchItems(items, query), [items, query]);
  const searching = !!query.trim();
  const [slideIndex, setSlideIndex] = useState(null); // 슬라이드 쇼 시작 위치 (null = 닫힘)

  return (
    <View style={styles.screen}>
      {items.length > 0 && (
        <SearchBar value={query} onChange={setQuery} total={items.length} shown={shown.length} />
      )}
      <FlatList
        data={shown}
        keyExtractor={(it) => it.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={shown.length === 0 ? styles.emptyWrap : { padding: 16, paddingTop: 8 }}
        ListEmptyComponent={
          searching ? (
            <NoResult query={query} onClear={() => setQuery('')} />
          ) : (
          <View style={{ alignItems: 'center' }}>
            <Ionicons name="images-outline" size={48} color="#bbb" />
            <Text style={styles.empty}>아직 등록된 사진이 없어요.</Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { marginTop: 16 }]}
              onPress={() => navigation.navigate('PhotoInput')}>
              <Text style={styles.primaryBtnText}>사진 추가하기</Text>
            </TouchableOpacity>
          </View>
          )
        }
        renderItem={({ item, index }) => (
          <View style={styles.card}>
            {/* 사진: 누르면 현재 검색 결과 기준 슬라이드 쇼 */}
            <TouchableOpacity activeOpacity={0.8} onPress={() => setSlideIndex(index)}>
              <ExpoImage source={{ uri: item.uri }} style={styles.thumb} contentFit="cover" />
            </TouchableOpacity>
            {/* 글자: 누르면 수정 화면, 길게 누르면 삭제 */}
            <TouchableOpacity
              style={styles.info}
              activeOpacity={0.6}
              onPress={() => navigation.navigate('PhotoEdit', { id: item.id })}
              onLongPress={() => confirmDelete(item)}>
              <LinkText style={styles.title} numberOfLines={1}>{item.title}</LinkText>
              <LinkText style={styles.location} numberOfLines={2}>
                {`📍 ${item.location || '위치 정보 없음'}`}
              </LinkText>
              {!!item.description && (
                <LinkText style={styles.desc} numberOfLines={2}>{item.description}</LinkText>
              )}
            </TouchableOpacity>
            {/* 지도보기 버튼 (삭제 아이콘 대신) */}
            <TouchableOpacity
              style={styles.mapIconBtn}
              onPress={() => openMap(item)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="map-outline" size={20} color="#2563eb" />
              <Text style={styles.mapIconText}>지도</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      <SlideShow
        visible={slideIndex !== null}
        items={shown}
        startIndex={slideIndex ?? 0}
        onClose={() => setSlideIndex(null)}
        onEdit={(id) => {
          setSlideIndex(null);
          navigation.navigate('PhotoEdit', { id });
        }}
      />
    </View>
  );
}

/* ─────────────────────────────
 * 링크 텍스트: http:// · https:// 로 시작하는 부분을 누르면 브라우저로 이동
 * ───────────────────────────── */
const URL_RE = /(https?:\/\/[^\s<>"']+)/gi;

// 문장 끝의 . , ) 등은 링크에서 뺌 (예: "https://a.com." → "https://a.com")
function splitUrl(raw) {
  const m = raw.match(/[.,;:!?)\]}'"’”]+$/);
  return m ? [raw.slice(0, -m[0].length), m[0]] : [raw, ''];
}

export async function openUrl(url) {
  try {
    if (IS_WEB) window.open(url, '_blank');
    else await Linking.openURL(url);
  } catch {
    notify('오류', `링크를 열 수 없어요.\n${url}`);
  }
}

// <Text> 대신 사용: 글자 속 URL만 파란 밑줄 + 누르면 이동
// (카드를 누르는 동작과 겹치지 않도록 링크 부분만 따로 눌림)
export function LinkText({ children, style, numberOfLines }) {
  const text = children == null ? '' : String(children);
  const parts = text.split(URL_RE);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, i) => {
        if (i % 2 === 0) return part; // 일반 글자
        const [url, tail] = splitUrl(part);
        return (
          <React.Fragment key={i}>
            <Text style={styles.link} onPress={() => openUrl(url)} suppressHighlighting>
              {url}
            </Text>
            {tail}
          </React.Fragment>
        );
      })}
    </Text>
  );
}

/* ─────────────────────────────
 * 리스트보기(텍스트 전용) 유틸
 * ───────────────────────────── */
// 웹/앱 공통 알림
const notify = (title, msg) => (IS_WEB ? window.alert(`${title}\n${msg}`) : Alert.alert(title, msg));

// EXIF 날짜 "2026:11:13 14:05:09" → 타임스탬프(ms)
// Android는 exif.DateTimeOriginal, iOS는 exif['{Exif}'].DateTimeOriginal에 있음
export function takenAtFromExif(exif) {
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
  const ts = new Date(+y, +mo - 1, +d, +h, +mi, +se).getTime(); // EXIF 시각은 촬영지 현지 시각
  return Number.isFinite(ts) && +y > 1970 ? ts : null;
}

// 갤러리 DB(expo-media-library)의 촬영 시각 (development build에서만)
async function takenAtFromLibrary(assetOrId) {
  if (!CAN_USE_MEDIA_LIBRARY || !assetOrId) return null;
  try {
    const info =
      typeof assetOrId === 'string' ? await MediaLibrary.getAssetInfoAsync(assetOrId) : assetOrId;
    const t = info?.creationTime;
    return Number.isFinite(t) && t > 0 ? t : null;
  } catch {
    return null;
  }
}

// 주소 일부만 보이게: 앞부분 max 글자까지만 + "…"
export function shortAddress(address, max = 16) {
  if (!address) return '위치 정보 없음';
  const text = address.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// 지도 앱 열기: 좌표가 있으면 좌표로, 없으면 주소 검색으로
export async function openMap(item) {
  const c = item.coords;
  const hasCoords = !!c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude);
  const address = (item.location || '').trim();
  if (!hasCoords && !address) {
    notify('알림', '이 항목에는 위치 정보가 없어요.');
    return;
  }

  const latLng = hasCoords ? `${c.latitude},${c.longitude}` : '';
  const label = encodeURIComponent(item.title || address || '사진 위치');
  const q = encodeURIComponent(hasCoords ? latLng : address);

  let appUrl = null;
  if (Platform.OS === 'ios') {
    // Apple 지도 앱으로 바로 열림
    appUrl = hasCoords
      ? `https://maps.apple.com/?ll=${latLng}&q=${label}`
      : `https://maps.apple.com/?q=${q}`;
  } else if (Platform.OS === 'android') {
    // geo: → 설치된 지도 앱(구글/네이버/카카오 등) 선택 창
    appUrl = hasCoords ? `geo:${latLng}?q=${latLng}(${label})` : `geo:0,0?q=${q}`;
  }
  // 웹이거나 지도 앱이 없을 때: 구글 지도 웹
  const webUrl = `https://www.google.com/maps/search/?api=1&query=${q}`;

  if (appUrl) {
    try {
      await Linking.openURL(appUrl);
      return;
    } catch {
      // 지도 앱이 없으면 웹으로
    }
  }
  try {
    if (IS_WEB) window.open(webUrl, '_blank');
    else await Linking.openURL(webUrl);
  } catch {
    notify('오류', '지도를 열 수 없어요.');
  }
}

/* ─────────────────────────────
 * 리스트보기 모듈 (사진 제외, 텍스트만)
 * ───────────────────────────── */
function PhotoTextListScreen({ navigation }) {
  const { items } = usePhotos();
  const confirmDelete = useDeleteItem();
  const [query, setQuery] = useState('');
  const shown = useMemo(() => searchItems(items, query), [items, query]);

  return (
    <View style={styles.screen}>
      {items.length > 0 && (
        <SearchBar value={query} onChange={setQuery} total={items.length} shown={shown.length} />
      )}
      <FlatList
        data={shown}
        keyExtractor={(it) => it.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={shown.length === 0 ? styles.emptyWrap : { padding: 16, paddingTop: 8 }}
        ListEmptyComponent={
          query.trim() ? (
            <NoResult query={query} onClear={() => setQuery('')} />
          ) : (
            <Text style={styles.empty}>아직 등록된 사진이 없어요.</Text>
          )
        }
        ListHeaderComponent={
          shown.length > 0 ? (
            <View style={styles.rowHeader}>
              <Text style={[styles.rowHeaderText, { width: 82 }]}>촬영일</Text>
              <Text style={[styles.rowHeaderText, { flex: 1 }]}>제목 / 주소</Text>
              <Text style={styles.rowHeaderText}>지도 / 삭제</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const date = photoDate(item);
          return (
          <View style={styles.row}>
            <View style={{ width: 82 }}>
              <Text style={styles.rowDate}>{date.text}</Text>
              {/* 촬영일이 없어 등록일을 보여줄 때 표시 */}
              {!date.taken && date.text !== '날짜 없음' && (
                <Text style={styles.rowDateSub}>등록일</Text>
              )}
            </View>
            {/* 제목/주소를 누르면 수정 화면(PhotoEdit.js) */}
            <TouchableOpacity
              style={{ flex: 1, marginRight: 8 }}
              activeOpacity={0.6}
              onPress={() => navigation.navigate('PhotoEdit', { id: item.id })}>
              <LinkText style={[styles.rowTitle, styles.rowLink]} numberOfLines={1}>{item.title}</LinkText>
              <Text style={styles.rowAddr} numberOfLines={1}>
                📍 {shortAddress(item.location)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.mapBtn} onPress={() => openMap(item)}>
              <Ionicons name="map-outline" size={14} color="#2563eb" />
              <Text style={styles.mapBtnText}>지도보기</Text>
            </TouchableOpacity>
            {/* Delete 버튼 */}
            <TouchableOpacity style={styles.delBtn} onPress={() => confirmDelete(item)}>
              <Ionicons name="trash-outline" size={14} color="#dc2626" />
              <Text style={styles.delBtnText}>삭제</Text>
            </TouchableOpacity>
          </View>
          );
        }}
      />
    </View>
  );
}

/* ─────────────────────────────
 * 주소 → 제목 (마지막 동/지역 이름)
 * ─────────────────────────────
 * 예) "서울특별시 강남구 역삼동 123-45"      → "역삼동"
 *     "경기 성남시 분당구 정자동 178-1 (빌딩)" → "정자동"
 *     "서울 강남구 테헤란로 152"            → "테헤란로"
 */
export function titleFromAddress(address) {
  if (!address) return '';
  let text = address.replace(/\([^)]*\)/g, ' '); // 괄호(건물명) 제거
  let parts;
  if (text.includes(',')) {
    // OpenStreetMap display_name 형식: "152, 테헤란로, 역삼동, 강남구, ..." (작은 단위 → 큰 단위)
    parts = text.split(',').map((t) => t.trim()).reverse();
  } else {
    parts = text.split(/\s+/);
  }
  // 숫자로 시작하는 부분(번지, 건물번호, 우편번호, 좌표)은 제외
  parts = parts.filter((t) => t && !/^[-\d]/.test(t) && t !== '대한민국');
  if (!parts.length) return '';
  // 마지막에 가까운 동·읍·면·리·가를 우선, 없으면 남은 마지막 부분
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/(동|읍|면|리|\d가)$/.test(parts[i])) return parts[i];
  }
  return parts[parts.length - 1];
}

/* ─────────────────────────────
 * 입력 모듈
 * ───────────────────────────── */
function PhotoInputScreen({ navigation }) {
  const { addItem, currentProject } = usePhotos();
  const [saving, setSaving] = useState(false);
  const [uri, setUri] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // 마지막으로 자동 입력한 제목 (사용자가 직접 고친 제목은 덮어쓰지 않기 위해)
  const autoTitle = useRef('');
  const [location, setLocation] = useState('');
  const [coords, setCoords] = useState(null);
  const [takenAt, setTakenAt] = useState(null); // 사진을 찍은 시각(ms)
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
    setDescription('');
    autoTitle.current = '';
    setLocation('');
    setCoords(null);
    setTakenAt(null);
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
      const t = titleFromAddress(r.address);
      // 제목이 비어 있거나 이전에 자동으로 넣은 제목일 때만 바꿈
      setTitle((prev) => {
        if (!t || (prev.trim() && prev !== autoTitle.current)) return prev;
        autoTitle.current = t;
        return t;
      });
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
    setTakenAt(await takenAtFromLibrary(asset)); // 갤러리 DB의 촬영 시각
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

    // 촬영 시각: 1순위 EXIF, 2순위 갤러리 DB
    let t = takenAtFromExif(asset.exif);
    if (!t) t = await takenAtFromLibrary(asset.assetId);
    if (id !== reqId.current) return;
    setTakenAt(t);
    addDebug(`[촬영일] ${t ? ymd(t) : '없음'}`);

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
    setTakenAt(Date.now()); // 방금 촬영
    setDebug('[카메라 촬영] 현재 위치 사용');
    await fillCurrentLocation('촬영 위치(현재 위치)');
  };

  // 저장: 현재 프로젝트에 추가 (사진 파일 복사 + 자동 저장)
  const save = async () => {
    if (saving) return;
    if (!uri) return notify('알림', '사진을 선택해주세요.');
    if (!title.trim()) return notify('알림', '제목을 입력해주세요.');
    setSaving(true);
    try {
      await addItem({
        uri,
        title: title.trim(),
        location: location.trim(),
        coords,
        description: description.trim(),
        takenAt: takenAt ?? null, // 리스트보기의 촬영일 표시용
        createdAt: Date.now(), // 등록일 (촬영일이 없을 때 대신 표시)
      });
    } catch (e) {
      notify('저장 실패', e?.message ?? String(e));
      setSaving(false);
      return;
    }
    setSaving(false);
    reset();
    navigation.navigate('ListTab', { screen: 'PhotoList' });
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        {/* 어느 프로젝트에 저장되는지 표시 (누르면 프로젝트 목록) */}
        <TouchableOpacity
          style={styles.projectBanner}
          onPress={() => navigation.navigate('ListTab', { screen: 'ProjectList' })}>
          <Ionicons name={typeIcon(currentProject?.type)} size={16} color="tomato" />
          <Text style={styles.projectBannerText} numberOfLines={1}>
            저장할 프로젝트: {currentProject?.name ?? '-'} ({typeLabel(currentProject?.type)})
          </Text>
          <Text style={styles.projectBannerLink}>변경</Text>
        </TouchableOpacity>

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

        <Text style={styles.label}>설명</Text>
        <TextInput
          style={[styles.input, styles.descInput]}
          value={description}
          onChangeText={setDescription}
          placeholder="사진에 대한 설명을 입력하세요"
          multiline
          textAlignVertical="top"
        />

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

        <TouchableOpacity
          style={[styles.primaryBtn, { marginTop: 28 }, saving && { opacity: 0.6 }]}
          onPress={save}
          disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>
              저장{currentProject ? ` (${currentProject.name})` : ''}
            </Text>
          )}
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
      component={PhotoHomeScreen}
      options={({ navigation }) => ({
        title: '내 사진',
        // 제목 = 현재 프로젝트 이름 (누르면 프로젝트 목록)
        headerTitle: () => (
          <ProjectHeaderTitle onPress={() => navigation.navigate('ProjectList')} />
        ),
        // 왼쪽: 프로젝트 목록 버튼
        headerLeft: () => (
          <TouchableOpacity
            style={{ marginLeft: 16 }}
            onPress={() => navigation.navigate('ProjectList')}>
            <Ionicons name="folder-open-outline" size={24} color="tomato" />
          </TouchableOpacity>
        ),
        // 제목(내 사진)과 + 버튼 사이에 "리스트보기" 버튼
        headerRight: () => (
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.listBtn}
              onPress={() => navigation.navigate('PhotoTextList')}>
              <Ionicons name="list-outline" size={16} color="tomato" />
              <Text style={styles.listBtnText}>리스트보기</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('PhotoInput')}>
              <Ionicons name="add-circle" size={28} color="tomato" />
            </TouchableOpacity>
          </View>
        ),
      })}
    />
    <Stack.Screen
      name="PhotoTextList"
      component={PhotoTextListScreen}
      options={{ title: '리스트보기' }}
    />
    <Stack.Screen
      name="PhotoInput"
      component={PhotoInputScreen}
      options={{ title: '사진 등록' }}
    />
    <Stack.Screen
      name="PhotoEdit"
      component={PhotoEditScreen}
      options={{ title: '사진 수정' }}
    />
    <Stack.Screen
      name="ProjectList"
      component={ProjectListScreen}
      options={({ navigation }) => ({
        title: '프로젝트',
        headerRight: () => (
          <TouchableOpacity
            style={[styles.listBtn, { marginRight: 16 }]}
            onPress={() => navigation.navigate('ProjectCreate')}>
            <Ionicons name="add" size={16} color="tomato" />
            <Text style={styles.listBtnText}>새 프로젝트</Text>
          </TouchableOpacity>
        ),
      })}
    />
    <Stack.Screen
      name="ProjectCreate"
      component={ProjectCreateScreen}
      options={{ title: '새 프로젝트' }}
    />
  </Stack.Navigator>
);

// 헤더 제목: 현재 프로젝트 이름 + ▼
function ProjectHeaderTitle({ onPress }) {
  const { currentProject } = usePhotos();
  return (
    <TouchableOpacity style={styles.headerTitleBtn} onPress={onPress}>
      <Text style={styles.headerTitleText} numberOfLines={1}>
        {currentProject?.name ?? '내 사진'}
      </Text>
      <Ionicons name="chevron-down" size={16} color="#333" />
    </TouchableOpacity>
  );
}

const InputStack = () => (
  <Stack.Navigator>
    <Stack.Screen
      name="PhotoInputTab"
      component={PhotoInputScreen}
      options={{ title: '사진 등록' }}
    />
  </Stack.Navigator>
);

// 보기 탭: 사진만 작게 3장씩 (Photoshortview.js) → 누르면 수정 화면
const ViewStack = () => (
  <Stack.Navigator>
    <Stack.Screen
      name="PhotoShortView"
      component={PhotoShortViewScreen}
      options={({ navigation }) => ({
        title: '보기',
        // 제목 = 현재 프로젝트 이름 (누르면 목록 탭의 프로젝트 화면)
        headerTitle: () => (
          <ProjectHeaderTitle
            onPress={() => navigation.navigate('ListTab', { screen: 'ProjectList' })}
          />
        ),
      })}
    />
    <Stack.Screen
      name="PhotoEdit"
      component={PhotoEditScreen}
      options={{ title: '사진 수정' }}
    />
  </Stack.Navigator>
);

const TAB_ICONS = { ListTab: 'list', ViewTab: 'grid-outline', InputTab: 'add-circle-outline' };

// App.js가 실행되면 이 화면(Home)이 열립니다
export default function Home() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: 'tomato',
          tabBarInactiveTintColor: 'gray',
          tabBarIcon: ({ color, size }) => {
            return <Ionicons name={TAB_ICONS[route.name]} size={size} color={color} />;
          },
        })}>
        <Tab.Screen name="ListTab" component={ListStack} options={{ title: '목록' }} />
        <Tab.Screen name="ViewTab" component={ViewStack} options={{ title: '보기' }} />
        <Tab.Screen name="InputTab" component={InputStack} options={{ title: '등록' }} />
      </Tab.Navigator>
    </NavigationContainer>
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
  descInput: { minHeight: 90 },
  desc: { fontSize: 13, color: '#374151', marginTop: 4 },
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
  // 헤더 제목 (프로젝트 이름)
  headerTitleBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, maxWidth: 150 },
  headerTitleText: { fontSize: 17, fontWeight: '600', color: '#111', flexShrink: 1 },
  // 등록 화면의 "저장할 프로젝트" 표시
  projectBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 10,
    marginBottom: 12,
    borderRadius: 8,
    backgroundColor: '#fff1ee',
  },
  projectBannerText: { flex: 1, fontSize: 13, color: '#7c2d12', fontWeight: '600' },
  projectBannerLink: { fontSize: 13, color: 'tomato', fontWeight: '700' },
  // 헤더 버튼
  headerRight: { flexDirection: 'row', alignItems: 'center', marginRight: 16, gap: 10 },
  listBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'tomato',
  },
  listBtnText: { color: 'tomato', fontSize: 13, fontWeight: '600' },
  // 리스트보기 화면
  rowHeader: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    marginBottom: 6,
  },
  rowHeaderText: { fontSize: 12, fontWeight: '700', color: '#6b7280' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#eef0f3',
  },
  rowDate: { fontSize: 13, color: '#6b7280' },
  rowDateSub: { fontSize: 10, color: '#9ca3af', marginTop: 2 },
  rowLink: { color: '#1d4ed8' },
  // http/https 링크
  link: { color: '#2563eb', textDecorationLine: 'underline' }, // 누르면 수정 화면으로 간다는 표시
  rowTitle: { fontSize: 15, fontWeight: '600', color: '#111' },
  rowAddr: { fontSize: 12, color: '#555', marginTop: 3 },
  mapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  mapBtnText: { color: '#2563eb', fontSize: 12, fontWeight: '600' },
  // Delete 버튼
  // 목록 카드의 지도보기 버튼
  mapIconBtn: { justifyContent: 'center', alignItems: 'center', paddingLeft: 8 },
  mapIconText: { fontSize: 10, color: '#2563eb', marginTop: 2, fontWeight: '600' },
  delBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fff',
  },
  delBtnText: { color: '#dc2626', fontSize: 12, fontWeight: '600' },
  debugBox: { marginTop: 16, padding: 10, borderRadius: 8, backgroundColor: '#f1f5f9' },
  debugTitle: { fontSize: 11, fontWeight: '700', color: '#64748b', marginBottom: 4 },
  debugText: { fontSize: 11, color: '#334155', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});