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
  Modal,
  SafeAreaView,
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
import PhotoEditScreen, { titleFromAddress } from './PhotoEdit';

// 여러 장을 한 번에 등록할 때 붙는 임시 제목 (PhotoEdit에서 수정)
const MULTI_TITLE = '멀티';

// 웹/앱 공통 알림
const notify = (title, msg) => (IS_WEB ? window.alert(`${title}\n${msg}`) : Alert.alert(title, msg));

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
            onPress={() => navigation.navigate('PhotoEdit', { id: item.id })}
            onLongPress={() => confirmDelete(item.id)}>
            <ExpoImage source={{ uri: item.uri }} style={styles.thumb} contentFit="cover" />
            <View style={styles.info}>
              <View style={styles.titleRow}>
                <Text style={[styles.title, { flexShrink: 1 }]} numberOfLines={1}>{item.title}</Text>
                {item.title === MULTI_TITLE && <Text style={styles.badge}>제목 수정 필요</Text>}
              </View>
              <Text style={styles.location} numberOfLines={2}>
                📍 {item.location || '위치 정보 없음'}
              </Text>
              {item.coords && <Text style={styles.coords}>{coordText(item.coords)}</Text>}
              {!!item.description && (
                <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>
              )}
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

/* ─────────────────────────────
 * 주소 → 제목: PhotoEdit.js로 옮김 (기존 import 호환을 위해 다시 export)
 * ───────────────────────────── */
export { titleFromAddress };

/* ─────────────────────────────
 * 앱 안 갤러리 (여러 장 선택)
 * 시스템 선택기가 기기에 따라 1장만 고르게 하는 문제를 피하기 위해
 * 갤러리 DB(expo-media-library)에서 직접 사진을 보여주고 체크로 여러 장 선택.
 * 위치는 갤러리 DB에서 읽으므로 GPS도 유지됨 (development build 필요)
 * ───────────────────────────── */
const PAGE_SIZE = 60;

function MultiGalleryModal({ visible, onClose, onDone }) {
  const [assets, setAssets] = useState([]);
  const [selected, setSelected] = useState([]); // 고른 순서대로 asset id
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const page = useRef({ after: undefined, hasNext: true });

  const load = async (fresh = false) => {
    if (loading || (!fresh && !page.current.hasNext)) return;
    setLoading(true);
    try {
      if (fresh) {
        const ok = await ensureLibraryPermission();
        if (!ok) throw new Error('사진 접근 권한이 없어요. 설정에서 사진 권한을 "모두 허용"으로 바꿔주세요.');
        page.current = { after: undefined, hasNext: true };
      }
      const res = await MediaLibrary.getAssetsAsync({
        first: PAGE_SIZE,
        after: page.current.after,
        mediaType: MediaLibrary.MediaType.photo,
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      });
      page.current = { after: res.endCursor, hasNext: res.hasNextPage };
      setAssets((prev) => (fresh ? res.assets : [...prev, ...res.assets]));
      setError(null);
    } catch (e) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      setSelected([]);
      setAssets([]);
      load(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggle = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const done = () => {
    const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
    onDone(selected.map((id) => byId[id]).filter(Boolean));
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={styles.galleryHeader}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.galleryCancel}>취소</Text>
          </TouchableOpacity>
          <Text style={styles.galleryTitle}>
            {selected.length ? `${selected.length}장 선택` : '사진 선택'}
          </Text>
          <TouchableOpacity onPress={done} disabled={!selected.length}>
            <Text style={[styles.galleryDone, !selected.length && { color: '#bbb' }]}>완료</Text>
          </TouchableOpacity>
        </View>
        {error ? (
          <Text style={[styles.note, styles.noteWarn, { padding: 16 }]}>{error}</Text>
        ) : (
          <FlatList
            data={assets}
            keyExtractor={(a) => a.id}
            numColumns={3}
            onEndReached={() => load(false)}
            onEndReachedThreshold={0.5}
            ListFooterComponent={loading ? <ActivityIndicator style={{ margin: 16 }} /> : null}
            renderItem={({ item }) => {
              const order = selected.indexOf(item.id);
              return (
                <TouchableOpacity
                  style={styles.galleryCell}
                  activeOpacity={0.8}
                  onPress={() => toggle(item.id)}>
                  <ExpoImage source={{ uri: item.uri }} style={styles.galleryImg} contentFit="cover" />
                  {order >= 0 && <View style={styles.gallerySelOverlay} />}
                  <View style={[styles.galleryCheck, order >= 0 && styles.galleryCheckOn]}>
                    {order >= 0 && <Text style={styles.galleryCheckText}>{order + 1}</Text>}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

/* ─────────────────────────────
 * 입력 모듈
 * ───────────────────────────── */
function PhotoInputScreen({ navigation }) {
  const { addItem, addItems } = usePhotos();
  const [uri, setUri] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // 마지막으로 자동 입력한 제목 (사용자가 직접 고친 제목은 덮어쓰지 않기 위해)
  const autoTitle = useRef('');
  const [location, setLocation] = useState('');
  const [coords, setCoords] = useState(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState(null); // { text, warn }
  const [debug, setDebug] = useState('');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [multiGalleryOpen, setMultiGalleryOpen] = useState(false); // 앱 안 여러 장 갤러리
  // "눌러서 사진 선택"에서 여러 장을 고른 경우의 목록
  // [{ key, uri, coords, location, autoTitle, loading }]
  const [batch, setBatch] = useState([]);
  const [saving, setSaving] = useState(null); // 저장 진행 상황 { done, total }
  // 요청 번호: 주소 조회 중 다른 사진을 고르면 이전 결과가 덮어쓰지 않도록 함
  const reqId = useRef(0);

  const addDebug = (line) => setDebug((d) => (d ? `${d}\n${line}` : line));

  const reset = () => {
    reqId.current += 1; // 진행 중인 조회 무효화
    setBatch([]);
    setSaving(null);
    setUri(null);
    setTitle('');
    setDescription('');
    autoTitle.current = '';
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
    setBatch([]);
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

  // 사진 1장의 위치 읽기 (1순위 EXIF → 2순위 갤러리 DB)
  // libraryState: 갤러리 DB 권한을 여러 장에서 한 번만 확인하기 위한 객체 { ok }
  const readCoords = async (asset, libraryState = { ok: null }) => {
    let c = getCoordsFromExif(asset.exif);
    let source = 'EXIF';
    if (!c && asset.assetId && CAN_USE_MEDIA_LIBRARY) {
      try {
        if (libraryState.ok === null) libraryState.ok = await ensureLibraryPermission();
        if (libraryState.ok) {
          c = (await readAssetInfo(asset.assetId)).coords;
          source = '갤러리 DB';
        }
      } catch (e) {
        addDebug(`[getAssetInfoAsync 오류] ${e.message}`);
      }
    }
    return { c, source };
  };

  // "눌러서 사진 선택"
  //  Android 시스템 선택기는 기기/선택기 앱에 따라 여러 장 선택이 안 되거나 GPS를 지우므로,
  //  갤러리 DB를 쓸 수 있으면(development build) 앱 안 갤러리를 기본으로 사용
  const pickImage = () => {
    if (Platform.OS !== 'android') return launchPicker(false);
    if (CAN_USE_MEDIA_LIBRARY) return setMultiGalleryOpen(true);
    Alert.alert('사진 선택 방식', '어떤 방식으로 고를까요?', [
      { text: '취소', style: 'cancel' },
      { text: '여러 장 (위치 없음)', onPress: () => launchPicker(false) },
      { text: '위치 유지 (파일 선택기)', onPress: () => launchPicker(true) },
    ]);
  };

  // 앱 안 갤러리에서 고른 사진들: assetId로 갤러리 DB 위치를 읽도록 형식을 맞춤
  const onMultiGalleryDone = async (mlAssets) => {
    setMultiGalleryOpen(false);
    if (!mlAssets.length) return;
    const assets = mlAssets.map((a) => ({ uri: a.uri, exif: {}, assetId: a.id }));
    if (assets.length === 1) await pickSingle(assets[0]);
    else await pickBatch(assets);
    addDebug(`[앱 갤러리] 선택 ${assets.length}장`);
  };

  // 시스템 사진 선택기로 고르기 (1장 또는 여러 장)
  const launchPicker = async (legacy) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('권한 필요', '사진을 불러오려면 앨범 접근 권한이 필요해요.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true, // 여러 장 선택 가능
      selectionLimit: 0, // 0 = 제한 없음
      orderedSelection: true, // 고른 순서 유지
      quality: 1, // 재압축 시 EXIF가 바뀌지 않도록 원본 품질
      exif: true, // 위치 정보 읽기에 필수
      legacy, // Android 전용: true = 예전 파일 선택기(GPS 유지)
    });
    if (result.canceled || !result.assets?.length) return;

    if (result.assets.length === 1) await pickSingle(result.assets[0]);
    else await pickBatch(result.assets);
    // 선택기가 실제로 몇 장을 돌려줬는지 확인용
    addDebug(`[시스템 선택기] legacy=${legacy} · 받은 사진 ${result.assets.length}장`);
  };

  // 1장 선택: 기존과 같이 화면에 채움
  const pickSingle = async (asset) => {
    const id = ++reqId.current;
    setBatch([]);
    setUri(asset.uri);
    clearLocation();
    setLoading(true);
    setNote({ text: '사진의 위치 정보를 읽는 중…', warn: false });
    setDebug(`[EXIF] ${gpsDebugText(asset.exif)}\n[assetId] ${asset.assetId ?? '없음'}`);
    const { c, source } = await readCoords(asset);
    await applyCoords(c, source, id);
  };

  // 여러 장 선택: 사진마다 위치·주소·제목을 읽어서 목록으로 보여줌 → 저장 시 모두 등록
  const pickBatch = async (assets) => {
    const id = ++reqId.current;
    const stamp = Date.now();
    const list = assets.map((a, i) => ({
      key: `${stamp}_${i}`,
      uri: a.uri,
      coords: null,
      location: '',
      autoTitle: '',
      loading: true,
    }));
    setUri(null);
    clearLocation();
    setLoading(false);
    setDebug('');
    setBatch(list);
    setNote({ text: `${list.length}장의 위치 정보를 읽는 중…`, warn: false });

    const libraryState = { ok: null };
    let withLocation = 0;
    for (let i = 0; i < assets.length; i++) {
      const { c } = await readCoords(assets[i], libraryState);
      let address = '';
      if (c) {
        withLocation += 1;
        try {
          const r = await resolveAddress(c);
          address = r.address || coordText(c);
        } catch {
          address = coordText(c);
        }
      }
      if (id !== reqId.current) return; // 그 사이 다른 사진을 고름
      const key = list[i].key;
      setBatch((prev) =>
        prev.map((b) =>
          b.key === key
            ? { ...b, coords: c, location: address, autoTitle: titleFromAddress(address), loading: false }
            : b
        )
      );
      setNote({ text: `위치 정보를 읽는 중… ${i + 1}/${assets.length}`, warn: false });
    }
    setNote({
      text: `${assets.length}장 선택됨 (위치 있음 ${withLocation}장). 저장을 누르면 모두 등록돼요.`,
      warn: false,
    });
  };

  // 여러 장 목록에서 한 장 빼기
  const removeFromBatch = (key) =>
    setBatch((prev) => {
      const next = prev.filter((b) => b.key !== key);
      if (!next.length) setNote(null);
      return next;
    });

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
    reqId.current += 1; // 여러 장 위치 읽기 중이면 중단
    setBatch([]);
    setUri(result.assets[0].uri);
    setDebug('[카메라 촬영] 현재 위치 사용');
    await fillCurrentLocation('촬영 위치(현재 위치)');
  };

  // 여러 장 저장: 제목을 입력했으면 모든 사진에 같은 제목,
  // 비워 두면 사진마다 주소에서 만든 제목(없으면 "멀티")
  const saveBatch = async () => {
    if (saving) return;
    if (batch.some((b) => b.loading)) {
      return notify('알림', '아직 위치 정보를 읽는 중이에요. 잠시 후 저장해주세요.');
    }
    const common = title.trim();
    const desc = description.trim();
    const records = batch.map((b) => ({
      uri: b.uri,
      title: common || b.autoTitle || MULTI_TITLE,
      location: b.location,
      coords: b.coords,
      description: desc,
      createdAt: Date.now(),
    }));
    setSaving({ done: 0, total: records.length });
    try {
      if (addItems) {
        await addItems(records);
      } else {
        for (let i = 0; i < records.length; i++) {
          await addItem(records[i]); // 한 장씩 순서대로 저장
          setSaving({ done: i + 1, total: records.length });
        }
      }
    } catch (e) {
      setSaving(null);
      return notify('저장 실패', e?.message ?? String(e));
    }
    const multiCount = records.filter((r) => r.title === MULTI_TITLE).length;
    notify(
      '등록 완료',
      `${records.length}장을 등록했어요.` +
        (multiCount ? `\n제목이 "${MULTI_TITLE}"인 ${multiCount}장은 목록에서 눌러 제목을 수정하세요.` : '')
    );
    reset();
    navigation.navigate('ListTab', { screen: 'PhotoList' });
  };

  const save = () => {
    if (batch.length) return saveBatch();
    if (!uri) return Alert.alert('알림', '사진을 선택해주세요.');
    if (!title.trim()) return Alert.alert('알림', '제목을 입력해주세요.');
    addItem({
      uri,
      title: title.trim(),
      location: location.trim(),
      coords,
      description: description.trim(),
    });
    reset();
    navigation.navigate('ListTab', { screen: 'PhotoList' });
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.picker} onPress={pickImage} activeOpacity={0.8}>
          {batch.length ? (
            <>
              <ExpoImage source={{ uri: batch[0].uri }} style={styles.preview} contentFit="cover" />
              <View style={styles.countBadge}>
                <Ionicons name="images" size={14} color="#fff" />
                <Text style={styles.countBadgeText}>{batch.length}장 선택 · 눌러서 다시 선택</Text>
              </View>
            </>
          ) : uri ? (
            <ExpoImage source={{ uri }} style={styles.preview} contentFit="cover" />
          ) : (
            <View style={{ alignItems: 'center' }}>
              <Ionicons name="camera-outline" size={40} color="#666" />
              <Text style={styles.pickerText}>눌러서 사진 선택</Text>
              <Text style={styles.pickerSub}>
                {Platform.OS === 'android' && !CAN_USE_MEDIA_LIBRARY
                  ? '여러 장은 "여러 장 (위치 없음)"을 고르세요'
                  : '여러 장도 선택할 수 있어요'}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <Text style={styles.label}>{batch.length ? '제목 (모든 사진에 적용)' : '제목'}</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder={batch.length ? '비워 두면 사진마다 주소로 자동 입력' : '제목을 입력하세요'}
          returnKeyType="done"
        />

        {batch.length > 0 ? (
          /* 여러 장: 사진별 위치/제목 미리보기 (✕로 빼기) */
          <>
            <Text style={styles.label}>선택한 사진 {batch.length}장</Text>
            {batch.map((b) => (
              <View key={b.key} style={styles.batchRow}>
                <ExpoImage source={{ uri: b.uri }} style={styles.batchThumb} contentFit="cover" />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.batchTitle} numberOfLines={1}>
                    {title.trim() || b.autoTitle || MULTI_TITLE}
                  </Text>
                  {b.loading ? (
                    <ActivityIndicator size="small" style={{ alignSelf: 'flex-start', marginTop: 4 }} />
                  ) : (
                    <Text style={styles.batchLoc} numberOfLines={1}>
                      📍 {b.location || '위치 정보 없음'}
                    </Text>
                  )}
                </View>
                <TouchableOpacity
                  onPress={() => removeFromBatch(b.key)}
                  disabled={!!saving}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={22} color="#9ca3af" />
                </TouchableOpacity>
              </View>
            ))}
            {note && (
              <Text style={[styles.note, note.warn && styles.noteWarn]}>{note.text}</Text>
            )}
          </>
        ) : (
        <>
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
        </>
        )}

        <Text style={styles.label}>{batch.length ? '설명 (모든 사진에 적용)' : '설명'}</Text>
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
        {CAN_USE_MEDIA_LIBRARY && (
          <MultiGalleryModal
            visible={multiGalleryOpen}
            onClose={() => setMultiGalleryOpen(false)}
            onDone={onMultiGalleryDone}
          />
        )}

        <TouchableOpacity
          style={[styles.primaryBtn, { marginTop: 28 }, !!saving && { opacity: 0.6 }]}
          onPress={save}
          disabled={!!saving}>
          {saving ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.primaryBtnText}>
                저장 중… {saving.done}/{saving.total}
              </Text>
            </View>
          ) : (
            <Text style={styles.primaryBtnText}>
              {batch.length ? `${batch.length}장 모두 저장` : '저장'}
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
    <Stack.Screen
      name="PhotoEdit"
      component={PhotoEditScreen}
      options={{ title: '사진 수정' }}
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
            const iconName = route.name === 'ListTab' ? 'list' : 'add-circle-outline';
            return <Ionicons name={iconName} size={size} color={color} />;
          },
        })}>
        <Tab.Screen name="ListTab" component={ListStack} options={{ title: '목록' }} />
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
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  badge: {
    marginLeft: 6,
    fontSize: 10,
    color: '#b45309',
    backgroundColor: '#fef3c7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
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
  pickerSub: { color: '#888', fontSize: 12, marginTop: 2 },
  // 여러 장 선택 표시
  countBadge: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  countBadgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  batchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#eef0f3',
  },
  batchThumb: { width: 52, height: 52, borderRadius: 6, backgroundColor: '#eee' },
  batchTitle: { fontSize: 14, fontWeight: '600', color: '#111' },
  batchLoc: { fontSize: 12, color: '#555', marginTop: 3 },
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
  // 앱 안 여러 장 갤러리
  galleryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  galleryTitle: { fontSize: 16, fontWeight: '700', color: '#111' },
  galleryCancel: { fontSize: 15, color: '#555' },
  galleryDone: { fontSize: 15, fontWeight: '700', color: 'tomato' },
  galleryCell: { flex: 1 / 3, aspectRatio: 1, padding: 1 },
  galleryImg: { flex: 1, backgroundColor: '#eee' },
  gallerySelOverlay: { ...StyleSheet.absoluteFillObject, margin: 1, backgroundColor: 'rgba(255,99,71,0.25)' },
  galleryCheck: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  galleryCheckOn: { backgroundColor: 'tomato' },
  galleryCheckText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  debugBox: { marginTop: 16, padding: 10, borderRadius: 8, backgroundColor: '#f1f5f9' },
  debugTitle: { fontSize: 11, fontWeight: '700', color: '#64748b', marginBottom: 4 },
  debugText: { fontSize: 11, color: '#334155', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});