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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Image as ExpoImage } from 'expo-image';

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