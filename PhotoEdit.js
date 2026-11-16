import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Image as ExpoImage } from 'expo-image';
import * as Sharing from 'expo-sharing'; // 사진 파일 공유 (Android)
import * as Clipboard from 'expo-clipboard'; // Android: 제목+설명을 복사해 두기

import {
  IS_WEB,
  CAN_USE_MEDIA_LIBRARY,
  usePhotos,
  getCoordsFromExif,
  coordText,
  withTimeout,
  resolveAddress,
  ensureLibraryPermission,
  readAssetInfo,
} from './App';

/* ─────────────────────────────
 * 주소 → 제목 (마지막 동/지역 이름)
 * PhotoInput.js와 함께 쓰기 위해 여기로 옮김 (PhotoInput.js에서 다시 export)
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
  parts = parts.filter((t) => t && !/^[-\d]/.test(t) && t !== '대한민국');
  if (!parts.length) return '';
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/(동|읍|면|리|\d가)$/.test(parts[i])) return parts[i];
  }
  return parts[parts.length - 1];
}

/* ─────────────────────────────
 * 사진 공유: 사진 + 제목 + 설명만 보냄 (위치·좌표·날짜는 보내지 않음)
 * ─────────────────────────────
 * - iOS : 공유 창 한 번에 사진 + 글(제목·설명)
 * - Android : 기본 공유 창은 사진과 글을 함께 못 보냄
 *             → 제목·설명을 클립보드에 복사해 두고 사진을 공유 (받는 앱에서 붙여넣기)
 * - 웹 : 브라우저가 지원하면 사진 파일 + 글, 아니면 글만
 */
const shareText = (title, description) =>
  [title?.trim(), description?.trim()].filter(Boolean).join('\n\n');

const mimeFromUri = (uri) => {
  const ext = (uri.split('?')[0].split('.').pop() || '').toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
};

async function sharePhoto({ uri, title, description }) {
  const text = shareText(title, description);

  // 웹
  if (IS_WEB) {
    try {
      if (navigator.share) {
        let files;
        try {
          const blob = await (await fetch(uri)).blob();
          const file = new File([blob], `${(title || 'photo').trim()}.${blob.type.split('/')[1] || 'jpg'}`, {
            type: blob.type || 'image/jpeg',
          });
          if (navigator.canShare?.({ files: [file] })) files = [file];
        } catch {}
        await navigator.share({ title: title || '사진', text, ...(files ? { files } : {}) });
      } else {
        window.alert('이 브라우저는 공유를 지원하지 않아요.');
      }
    } catch (e) {
      if (e?.name !== 'AbortError') window.alert(`공유 실패\n${e?.message ?? e}`);
    }
    return;
  }

  // iOS: 사진(url) + 글(message)을 한 번에
  if (Platform.OS === 'ios') {
    await Share.share({ url: uri, message: text, title: title || '사진' });
    return;
  }

  // Android: 글은 클립보드로, 사진은 파일로 공유
  if (text) await Clipboard.setStringAsync(text);
  if (!(await Sharing.isAvailableAsync())) {
    // 사진 공유가 안 되는 환경이면 글만이라도 공유
    await Share.share({ message: text, title: title || '사진' });
    return;
  }
  await Sharing.shareAsync(uri, {
    mimeType: mimeFromUri(uri),
    dialogTitle: title || '사진 공유',
  });
}

/* ─────────────────────────────
 * 수정 모듈
 * navigation.navigate('PhotoEdit', { id: item.id }) 로 열기
 * ───────────────────────────── */
export default function PhotoEditScreen({ route, navigation }) {
  const id = route.params?.id;
  const photos = usePhotos();
  const { items, deleteItem } = photos;
  const item = items.find((it) => it.id === id);

  // App.js의 usePhotos()에 updateItem이 없을 때를 대비한 대체 함수
  // (가장 좋은 해결: App.js에 updateItem 추가 → 아래 1순위가 사용됨)
  const updateItem = (itemId, patch) => {
    // 1순위: App.js가 제공하는 updateItem
    if (typeof photos.updateItem === 'function') return photos.updateItem(itemId, patch);
    // 2순위: setItems가 있으면 해당 항목만 바꿈 (id·순서 유지)
    if (typeof photos.setItems === 'function') {
      return photos.setItems((prev) =>
        prev.map((it) => (it.id === itemId ? { ...it, ...patch } : it))
      );
    }
    // 3순위: 삭제 후 다시 추가 (id·목록 순서가 바뀔 수 있음)
    if (typeof photos.addItem === 'function' && typeof deleteItem === 'function') {
      const old = items.find((it) => it.id === itemId) ?? {};
      deleteItem(itemId);
      return photos.addItem({ ...old, ...patch });
    }
    throw new Error('usePhotos()에 updateItem / setItems / addItem 이 없어요. App.js를 확인해주세요.');
  };

  const [uri, setUri] = useState(item?.uri ?? null);
  const [title, setTitle] = useState(item?.title ?? '');
  const [location, setLocation] = useState(item?.location ?? '');
  const [coords, setCoords] = useState(item?.coords ?? null);
  const [description, setDescription] = useState(item?.description ?? '');
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState(null); // { text, warn }
  const [sharing, setSharing] = useState(false); // 공유 창 여는 중
  // 주소 조회 중 다른 요청이 시작되면 이전 결과를 버리기 위한 번호
  const reqId = useRef(0);
  // 저장 후 화면을 닫을 때는 "변경 취소" 확인을 띄우지 않음
  const saved = useRef(false);
  // 저장 버튼 중복 클릭 방지
  const saving = useRef(false);

  const isDirty =
    !!item &&
    (uri !== item.uri ||
      title !== (item.title ?? '') ||
      location !== (item.location ?? '') ||
      description !== (item.description ?? '') ||
      JSON.stringify(coords ?? null) !== JSON.stringify(item.coords ?? null));

  // 저장하지 않고 뒤로 가면 확인
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (saved.current || !isDirty) return;
      e.preventDefault();
      if (IS_WEB) {
        if (window.confirm('수정한 내용을 저장하지 않고 나갈까요?')) {
          navigation.dispatch(e.data.action);
        }
        return;
      }
      Alert.alert('나가기', '수정한 내용을 저장하지 않고 나갈까요?', [
        { text: '계속 수정', style: 'cancel' },
        { text: '나가기', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
    return unsub;
  }, [navigation, isDirty]);

  if (!item) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Ionicons name="alert-circle-outline" size={40} color="#bbb" />
        <Text style={styles.missing}>항목을 찾을 수 없어요. 삭제되었을 수 있어요.</Text>
        <TouchableOpacity style={[styles.primaryBtn, { marginTop: 16 }]} onPress={() => navigation.goBack()}>
          <Text style={styles.primaryBtnText}>돌아가기</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 좌표 → 주소 (제목은 자동으로 바꾸지 않음. "주소로 제목 채우기" 버튼 사용)
  const applyCoords = async (c, source, rid = ++reqId.current) => {
    if (rid !== reqId.current) return;
    if (!c) {
      setLoading(false);
      setNote({ text: '이 사진에는 위치 정보가 없어 기존 위치를 그대로 두었어요.', warn: true });
      return;
    }
    setCoords(c);
    setLoading(true);
    setNote({ text: '주소를 찾는 중…', warn: false });

    const r = await resolveAddress(c);
    if (rid !== reqId.current) return;
    setLoading(false);
    if (r.address) {
      setLocation(r.address);
      setNote({ text: `위치 출처: ${source} · 주소: ${r.source}`, warn: false });
    } else {
      setLocation(coordText(c));
      setNote({
        text: '주소 변환에 실패해 좌표로 입력했어요. 네트워크를 확인하고 "주소 다시 찾기"를 눌러주세요.',
        warn: true,
      });
    }
  };

  // 사진 교체
  const changePhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('권한 필요', '사진을 불러오려면 앨범 접근 권한이 필요해요.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      exif: true,
      legacy: Platform.OS === 'android',
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    const rid = ++reqId.current;
    setUri(asset.uri);
    setLoading(true);
    setNote({ text: '사진의 위치 정보를 읽는 중…', warn: false });

    let c = getCoordsFromExif(asset.exif);
    let source = 'EXIF';
    if (!c && asset.assetId && CAN_USE_MEDIA_LIBRARY) {
      try {
        if (await ensureLibraryPermission()) {
          c = (await readAssetInfo(asset.assetId)).coords;
          source = '갤러리 DB';
        }
      } catch {}
    }
    await applyCoords(c, source, rid);
  };

  const fillCurrentLocation = async () => {
    const rid = ++reqId.current;
    setLoading(true);
    setNote({ text: '현재 위치를 확인하는 중…', warn: false });
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (rid !== reqId.current) return;
      if (status !== 'granted') {
        setLoading(false);
        setNote({ text: '위치 권한이 없어요. 설정에서 위치 권한을 허용해주세요.', warn: true });
        return;
      }
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
      if (rid !== reqId.current) return;
      await applyCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }, '현재 위치', rid);
    } catch {
      if (rid !== reqId.current) return;
      setLoading(false);
      setNote({ text: '현재 위치를 가져오지 못했어요. GPS가 켜져 있는지 확인해주세요.', warn: true });
    }
  };

  const fillTitleFromAddress = () => {
    const t = titleFromAddress(location);
    if (!t) {
      setNote({ text: '위치(주소)가 없어 제목을 만들 수 없어요.', warn: true });
      return;
    }
    setTitle(t);
  };

  const clearLocation = () => {
    reqId.current += 1;
    setLoading(false);
    setCoords(null);
    setLocation('');
    setNote(null);
  };

  // 저장: 사진이 바뀌었으면 파일 복사까지 끝난 뒤 닫힘 (자동 저장)
  const save = async () => {
    if (saving.current) return;
    if (!uri) return Alert.alert('알림', '사진이 없어요.');
    if (!title.trim()) return Alert.alert('알림', '제목을 입력해주세요.');
    saving.current = true;
    try {
      await updateItem(item.id, {
        uri,
        title: title.trim(),
        location: location.trim(),
        coords,
        description: description.trim(),
      });
    } catch (e) {
      saving.current = false;
      const msg = e?.message ?? String(e);
      if (IS_WEB) window.alert(`저장 실패\n${msg}`);
      else Alert.alert('저장 실패', msg);
      return;
    }
    saved.current = true;
    navigation.goBack();
  };

  // 공유: 지금 화면의 사진·제목·설명 (저장 전이라도 보이는 그대로)
  const share = async () => {
    if (sharing) return;
    if (!uri) return Alert.alert('알림', '공유할 사진이 없어요.');
    const t = title.trim();
    const d = description.trim();
    const go = async () => {
      setSharing(true);
      try {
        await sharePhoto({ uri, title: t, description: d });
      } catch (e) {
        Alert.alert('공유 실패', e?.message ?? String(e));
      } finally {
        setSharing(false);
      }
    };
    // Android는 사진과 글을 따로 보내야 하므로 먼저 안내
    if (Platform.OS === 'android' && (t || d)) {
      Alert.alert(
        '사진 공유',
        '제목과 설명을 복사해 둘게요.\n사진을 보낸 뒤 받는 앱(카카오톡 등)의 입력창에 붙여넣기 하세요.',
        [
          { text: '취소', style: 'cancel' },
          { text: '공유하기', onPress: go },
        ]
      );
      return;
    }
    go();
  };

  const remove = () => {
    const doDelete = () => {
      saved.current = true;
      deleteItem(item.id);
      navigation.goBack();
    };
    if (IS_WEB) {
      if (window.confirm('이 항목을 삭제할까요?')) doDelete();
      return;
    }
    Alert.alert('삭제', '이 항목을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: doDelete },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.picker} onPress={changePhoto} activeOpacity={0.8}>
          <ExpoImage source={{ uri }} style={styles.preview} contentFit="cover" />
          <View style={styles.changeBadge}>
            <Ionicons name="image-outline" size={14} color="#fff" />
            <Text style={styles.changeBadgeText}>사진 변경</Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.label}>제목</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="제목을 입력하세요"
          returnKeyType="done"
          selectTextOnFocus={item.title === '멀티'} // 멀티 등록 항목은 바로 덮어쓰기 쉽게
        />
        {!!location && (
          <TouchableOpacity style={styles.linkBtn} onPress={fillTitleFromAddress}>
            <Ionicons name="sparkles-outline" size={14} color="#2563eb" />
            <Text style={styles.linkText}>주소로 제목 채우기 ({titleFromAddress(location) || '—'})</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.label}>위치</Text>
        <View style={styles.locRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={location}
            onChangeText={setLocation}
            placeholder="위치를 입력하세요"
            multiline
          />
          {loading && <ActivityIndicator style={{ marginLeft: 8 }} />}
        </View>
        {coords && <Text style={styles.coords}>{coordText(coords)}</Text>}
        {note && <Text style={[styles.note, note.warn && styles.noteWarn]}>{note.text}</Text>}

        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={fillCurrentLocation}>
            <Ionicons name="locate-outline" size={16} color="#2563eb" />
            <Text style={styles.secondaryText}>현재 위치 사용</Text>
          </TouchableOpacity>
          {coords && !loading && (
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => applyCoords(coords, '이전 좌표')}>
              <Ionicons name="refresh-outline" size={16} color="#2563eb" />
              <Text style={styles.secondaryText}>주소 다시 찾기</Text>
            </TouchableOpacity>
          )}
          {(coords || !!location) && (
            <TouchableOpacity style={styles.secondaryBtn} onPress={clearLocation}>
              <Ionicons name="close-circle-outline" size={16} color="#2563eb" />
              <Text style={styles.secondaryText}>위치 지우기</Text>
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

        <TouchableOpacity
          style={[styles.primaryBtn, { marginTop: 28 }, (!isDirty || loading) && styles.disabled]}
          onPress={save}
          disabled={!isDirty || loading}>
          <Text style={styles.primaryBtnText}>저장</Text>
        </TouchableOpacity>

        {/* 공유: 사진 + 제목 + 설명 */}
        <TouchableOpacity
          style={[styles.shareBtn, sharing && styles.disabled]}
          onPress={share}
          disabled={sharing}>
          {sharing ? (
            <ActivityIndicator color="#2563eb" />
          ) : (
            <>
              <Ionicons name="share-social-outline" size={16} color="#2563eb" />
              <Text style={styles.shareText}>공유 (사진 + 제목 + 설명)</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteBtn} onPress={remove}>
          <Ionicons name="trash-outline" size={16} color="#dc2626" />
          <Text style={styles.deleteText}>삭제</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f7f9' },
  center: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  missing: { marginTop: 8, color: '#888', textAlign: 'center' },
  picker: {
    height: 240,
    borderRadius: 12,
    backgroundColor: '#e5e7eb',
    overflow: 'hidden',
  },
  preview: { width: '100%', height: '100%' },
  changeBadge: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  changeBadgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
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
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  linkText: { color: '#2563eb', fontSize: 13, fontWeight: '600' },
  locRow: { flexDirection: 'row', alignItems: 'center' },
  coords: { fontSize: 11, color: '#999', marginTop: 4 },
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
  disabled: { opacity: 0.5 },
  shareBtn: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#fff',
  },
  shareText: { color: '#2563eb', fontWeight: '600' },
  deleteBtn: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fff',
  },
  deleteText: { color: '#dc2626', fontWeight: '600' },
});