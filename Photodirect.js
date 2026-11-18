import React, { useCallback, useRef, useState } from 'react';
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
  Switch,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library';
import { Image as ExpoImage } from 'expo-image';

import { IS_WEB, usePhotos, coordText, withTimeout, resolveAddress } from './App';
import { typeIcon, typeLabel } from './storage';

/* ─────────────────────────────
 * 사진찍기 모듈
 * 탭을 누르면 카메라가 바로 열리고, 찍은 사진에
 * 촬영 시각 + 현재 위치(주소) + 제목(동 이름)을 자동으로 채워 바로 등록
 * ───────────────────────────── */

// 웹/앱 공통 알림
const notify = (title, msg) => (IS_WEB ? window.alert(`${title}\n${msg}`) : Alert.alert(title, msg));

// 주소 → 제목 (마지막 동/지역 이름) — 목록 화면의 titleFromAddress와 같은 규칙
function titleFromAddress(address) {
  if (!address) return '';
  const text = address.replace(/\([^)]*\)/g, ' ');
  let parts = text.includes(',')
    ? text.split(',').map((t) => t.trim()).reverse()
    : text.split(/\s+/);
  parts = parts.filter((t) => t && !/^[-\d]/.test(t) && t !== '대한민국');
  if (!parts.length) return '';
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/(동|읍|면|리|\d가)$/.test(parts[i])) return parts[i];
  }
  return parts[parts.length - 1];
}

// 촬영 시각 표시: 2026.11.18 09:30
function timeText(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 현재 위치: 1분 이내 마지막 위치가 있으면 바로 사용, 없으면 새로 측정(10초 제한)
async function getPosition() {
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
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
}

export default function PhotoDirectScreen({ navigation }) {
  const { addItem, currentProject } = usePhotos();
  const [uri, setUri] = useState(null);
  const [takenAt, setTakenAt] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [coords, setCoords] = useState(null);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState(null); // { text, warn }
  const [saving, setSaving] = useState(false);
  const [saveToGallery, setSaveToGallery] = useState(true); // 휴대폰 갤러리에도 저장

  const autoTitle = useRef(''); // 자동으로 넣은 제목 (직접 고친 제목은 덮어쓰지 않음)
  const reqId = useRef(0); // 위치 조회 중 다시 찍으면 이전 결과 무시
  const opening = useRef(false); // 카메라 중복 실행 방지
  const hasPhoto = useRef(false); // 포커스 시 자동 촬영 여부 판단용

  const reset = () => {
    reqId.current += 1;
    hasPhoto.current = false;
    autoTitle.current = '';
    setUri(null);
    setTakenAt(null);
    setTitle('');
    setDescription('');
    setLocation('');
    setCoords(null);
    setLocating(false);
    setNote(null);
  };

  // 촬영 위치 → 좌표 → 주소 → 제목 자동 입력
  const locate = async (id = ++reqId.current) => {
    setLocating(true);
    setNote({ text: '촬영 위치를 확인하는 중…', warn: false });
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (id !== reqId.current) return;
      if (status !== 'granted') {
        setNote({ text: '위치 권한이 없어 위치를 저장하지 못했어요. 설정에서 위치 권한을 허용해주세요.', warn: true });
        return;
      }
      const c = await getPosition();
      if (id !== reqId.current) return;
      setCoords(c);
      setNote({ text: '주소를 찾는 중…', warn: false });

      const r = await resolveAddress(c);
      if (id !== reqId.current) return;
      if (r.address) {
        setLocation(r.address);
        const t = titleFromAddress(r.address);
        setTitle((prev) => {
          if (!t || (prev.trim() && prev !== autoTitle.current)) return prev;
          autoTitle.current = t;
          return t;
        });
        setNote({ text: `위치 출처: 촬영 위치 · 주소: ${r.source}`, warn: false });
      } else {
        setLocation(coordText(c));
        setNote({ text: '주소 변환에 실패해 좌표로 입력했어요. "위치 다시 찾기"를 눌러보세요.', warn: true });
      }
    } catch (e) {
      if (id !== reqId.current) return;
      setNote({ text: '현재 위치를 가져오지 못했어요. GPS가 켜져 있는지 확인해주세요.', warn: true });
    } finally {
      if (id === reqId.current) setLocating(false);
    }
  };

  // 카메라 열기 → 찍으면 바로 위치 찾기 시작
  const openCamera = async () => {
    if (opening.current) return;
    opening.current = true;
    try {
      const cam = await ImagePicker.requestCameraPermissionsAsync();
      if (!cam.granted) {
        notify('권한 필요', '카메라 권한이 필요해요. 설정에서 카메라 권한을 허용해주세요.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (result.canceled) return;

      const id = ++reqId.current;
      hasPhoto.current = true;
      setUri(result.assets[0].uri);
      setTakenAt(Date.now()); // 방금 촬영
      setCoords(null);
      setLocation('');
      // 다시 찍을 때: 자동 제목은 지우고, 직접 쓴 제목·설명은 유지
      setTitle((prev) => (prev === autoTitle.current ? '' : prev));
      autoTitle.current = '';
      locate(id);
    } catch (e) {
      notify('오류', `카메라를 열 수 없어요.\n${e?.message ?? e}`);
    } finally {
      opening.current = false;
    }
  };

  // 탭을 누르면(화면에 들어오면) 사진이 없을 때 카메라를 바로 엶
  // (웹은 사용자가 버튼을 눌러야 카메라를 열 수 있어 자동 실행하지 않음)
  useFocusEffect(
    useCallback(() => {
      if (!IS_WEB && !hasPhoto.current) openCamera();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  // 저장: again=true면 저장 후 바로 다음 사진 촬영
  const save = async (again = false) => {
    if (saving) return;
    if (!uri) return notify('알림', '먼저 사진을 찍어주세요.');
    // 제목을 비워두면 동 이름, 그것도 없으면 "주소정보 없음"
    const finalTitle = title.trim() || titleFromAddress(location) || '주소정보 없음';
    setSaving(true);
    try {
      // 휴대폰 갤러리에도 원본 저장 (실패해도 앱 저장은 계속)
      if (saveToGallery && !IS_WEB) {
        try {
          const p = await MediaLibrary.requestPermissionsAsync(true);
          if (p.granted) await MediaLibrary.saveToLibraryAsync(uri);
        } catch {
          // Expo Go 등에서 갤러리 저장이 막혀도 무시
        }
      }
      await addItem({
        uri,
        title: finalTitle,
        location: location.trim(),
        coords,
        description: description.trim(),
        takenAt: takenAt ?? Date.now(),
        createdAt: Date.now(),
      });
    } catch (e) {
      notify('저장 실패', e?.message ?? String(e));
      setSaving(false);
      return;
    }
    setSaving(false);
    reset();
    if (again) openCamera();
    else navigation.navigate('ListTab', { screen: 'PhotoList' });
  };

  /* ── 아직 사진이 없을 때: 큰 촬영 버튼 ── */
  if (!uri) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ProjectBanner project={currentProject} navigation={navigation} />
        <TouchableOpacity style={styles.bigCamera} onPress={openCamera} activeOpacity={0.8}>
          <Ionicons name="camera" size={56} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.bigCameraText}>눌러서 사진 찍기</Text>
        <Text style={styles.hint}>찍은 곳의 위치와 주소, 제목이 자동으로 입력돼요.</Text>
      </View>
    );
  }

  /* ── 찍은 사진 기록 ── */
  const busy = saving || locating;
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <ProjectBanner project={currentProject} navigation={navigation} />

        {/* 사진: 누르면 다시 찍기 */}
        <TouchableOpacity style={styles.previewWrap} onPress={openCamera} activeOpacity={0.85}>
          <ExpoImage source={{ uri }} style={styles.preview} contentFit="cover" />
          <View style={styles.retakeBadge}>
            <Ionicons name="camera-reverse-outline" size={14} color="#fff" />
            <Text style={styles.retakeText}>다시 찍기</Text>
          </View>
        </TouchableOpacity>
        <Text style={styles.takenAt}>🕒 촬영 {timeText(takenAt)}</Text>

        <Text style={styles.label}>제목</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="비워두면 동 이름으로 자동 입력"
          returnKeyType="done"
        />

        <Text style={styles.label}>위치</Text>
        <View style={styles.locRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={location}
            onChangeText={setLocation}
            placeholder="촬영 위치 자동 입력"
            multiline
          />
          {locating && <ActivityIndicator style={{ marginLeft: 8 }} />}
        </View>
        {coords && <Text style={styles.coords}>{coordText(coords)}</Text>}
        {note && <Text style={[styles.note, note.warn && styles.noteWarn]}>{note.text}</Text>}
        {!locating && (
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => locate()}>
            <Ionicons name="locate-outline" size={16} color="#2563eb" />
            <Text style={styles.secondaryText}>위치 다시 찾기</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.label}>설명</Text>
        <TextInput
          style={[styles.input, styles.descInput]}
          value={description}
          onChangeText={setDescription}
          placeholder="사진에 대한 설명을 입력하세요"
          multiline
          textAlignVertical="top"
        />

        {!IS_WEB && (
          <View style={styles.switchRow}>
            <Text style={styles.switchText}>휴대폰 갤러리에도 저장</Text>
            <Switch
              value={saveToGallery}
              onValueChange={setSaveToGallery}
              trackColor={{ true: '#fca5a5' }}
              thumbColor={saveToGallery ? 'tomato' : '#f4f4f5'}
            />
          </View>
        )}

        {/* 저장 버튼 (위치를 찾는 동안은 잠시 대기) */}
        <TouchableOpacity
          style={[styles.primaryBtn, { marginTop: 24 }, busy && { opacity: 0.6 }]}
          onPress={() => save(false)}
          disabled={busy}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>
              {locating ? '위치 확인 중…' : `바로 등록${currentProject ? ` (${currentProject.name})` : ''}`}
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.outlineBtn, busy && { opacity: 0.6 }]}
          onPress={() => save(true)}
          disabled={busy}>
          <Ionicons name="camera-outline" size={16} color="tomato" />
          <Text style={styles.outlineBtnText}>등록하고 한 장 더 찍기</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelBtn} onPress={reset} disabled={saving}>
          <Text style={styles.cancelText}>취소</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// 어느 프로젝트에 저장되는지 표시 (누르면 프로젝트 목록)
function ProjectBanner({ project, navigation }) {
  return (
    <TouchableOpacity
      style={styles.projectBanner}
      onPress={() => navigation.navigate('ListTab', { screen: 'ProjectList' })}>
      <Ionicons name={typeIcon(project?.type)} size={16} color="tomato" />
      <Text style={styles.projectBannerText} numberOfLines={1}>
        저장할 프로젝트: {project?.name ?? '-'} ({typeLabel(project?.type)})
      </Text>
      <Text style={styles.projectBannerLink}>변경</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f7f9' },
  center: { justifyContent: 'center', alignItems: 'center', padding: 16 },
  bigCamera: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'tomato',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  bigCameraText: { marginTop: 14, fontSize: 16, fontWeight: '700', color: '#333' },
  hint: { marginTop: 6, fontSize: 13, color: '#888', textAlign: 'center' },
  previewWrap: { height: 280, borderRadius: 12, overflow: 'hidden', backgroundColor: '#e5e7eb' },
  preview: { width: '100%', height: '100%' },
  retakeBadge: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  retakeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  takenAt: { marginTop: 8, fontSize: 13, color: '#6b7280' },
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
  locRow: { flexDirection: 'row', alignItems: 'center' },
  coords: { fontSize: 11, color: '#999', marginTop: 4 },
  note: { marginTop: 6, fontSize: 13, color: '#4b5563' },
  noteWarn: { color: '#d97706' },
  secondaryBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
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
  switchRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchText: { fontSize: 14, color: '#333' },
  primaryBtn: {
    backgroundColor: 'tomato',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  outlineBtn: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'tomato',
    backgroundColor: '#fff',
  },
  outlineBtnText: { color: 'tomato', fontWeight: '700', fontSize: 15 },
  cancelBtn: { marginTop: 10, alignItems: 'center', paddingVertical: 10 },
  cancelText: { color: '#6b7280', fontSize: 14 },
  projectBanner: {
    alignSelf: 'stretch',
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
});
