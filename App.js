import 'react-native-gesture-handler';
import React, { createContext, useContext, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
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
import { Ionicons } from '@expo/vector-icons'; // Snack에서는 react-native-vector-icons 대신 사용
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
// 갤러리 DB에서 사진 위치를 직접 읽기 위해 사용 (웹 미지원)
// ※ SDK 58 이상에서 getAssetsAsync 관련 오류가 나면 'expo-media-library/legacy'로 바꾸세요
import * as MediaLibrary from 'expo-media-library';
import { Image as ExpoImage } from 'expo-image';
import Constants from 'expo-constants';

const IS_WEB = Platform.OS === 'web';
// Expo Go(Android)는 미디어 라이브러리 권한 요청이 거부됨 → 갤러리 DB 방식 사용 불가
const IS_EXPO_GO = Constants.executionEnvironment === 'storeClient';
const CAN_USE_MEDIA_LIBRARY = !IS_WEB && !(IS_EXPO_GO && Platform.OS === 'android');

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

async function ensureLibraryPermission() {
  const res = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
  return res.granted;
}

// 갤러리 asset에서 위치 + 표시용 uri 가져오기
async function readAssetInfo(assetOrId) {
  const info = await MediaLibrary.getAssetInfoAsync(assetOrId, {
    shouldDownloadFromNetwork: true, // iCloud 원본만 있는 사진도 localUri 확보
  });
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

  const load = async (reset = false) => {
    if (busy || (!reset && !hasMore)) return;
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

  React.useEffect(() => {
    if (visible) init();
  }, [visible]);

  // iOS / Android 14+ "일부 사진만 허용" 상태에서 허용 사진 추가
  const addAllowedPhotos = async () => {
    try {
      await MediaLibrary.presentPermissionsPickerAsync(['photo']);
      await init();
    } catch (e) {
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
      {status && (
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
    if (Platform.OS === 'web') {
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
  const [note, setNote] = useState('');
  const [debug, setDebug] = useState('');
  const [galleryOpen, setGalleryOpen] = useState(false);

  const reset = () => {
    setUri(null);
    setTitle('');
    setLocation('');
    setCoords(null);
    setNote('');
    setDebug('');
  };

  const applyCoords = async (c, source) => {
    if (c) {
      setCoords(c);
      setLocation(await resolveAddress(c));
      setNote(`위치 출처: ${source}`);
    } else {
      setCoords(null);
      setLocation('');
      setNote(
        Platform.OS === 'android'
          ? IS_EXPO_GO
            ? 'Expo Go(Android)에서는 갤러리 사진의 위치를 읽을 수 없는 경우가 많아요. "촬영하고 위치 저장" 또는 "현재 위치 사용"을 쓰거나, development build로 테스트하세요.'
            : 'Android 사진 선택기가 위치를 지웠을 수 있어요. "갤러리에서 직접 선택"을 눌러보세요.'
          : '사진에 위치 정보가 없어요. 직접 입력하거나 현재 위치를 사용하세요.'
      );
    }
  };

  // 갤러리 모달에서 고른 사진: 갤러리 DB의 위치 정보 사용
  const onGallerySelect = async (asset) => {
    setGalleryOpen(false);
    setUri(asset.uri);
    setLoading(true);
    try {
      const info = await readAssetInfo(asset);
      if (info.uri) setUri(info.uri);
      setDebug(`갤러리 DB location: ${info.coords ? coordText(info.coords) : '없음'}`);
      await applyCoords(info.coords, '갤러리 DB');
    } catch (e) {
      setDebug(`getAssetInfoAsync 오류: ${e.message}`);
      await applyCoords(null);
    } finally {
      setLoading(false);
    }
  };

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
    setUri(asset.uri);
    setLoading(true);
    setNote('');
    setDebug(`[EXIF] ${gpsDebugText(asset.exif)}\n[assetId] ${asset.assetId ?? '없음'}`);
    try {
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
          setDebug((d) => `${d}\n[getAssetInfoAsync 오류] ${e.message}`);
        }
      }
      await applyCoords(c, source);
    } finally {
      setLoading(false);
    }
  };

  // Expo Go에서도 확실히 동작: 촬영 직후 현재 위치를 저장
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
    await useCurrentLocation();
  };

  const useCurrentLocation = async () => {
    setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('권한 필요', '위치 권한이 필요해요.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setCoords(c);
      setLocation(await resolveAddress(c));
      setNote('');
    } catch {
      Alert.alert('오류', '현재 위치를 가져오지 못했어요.');
    } finally {
      setLoading(false);
    }
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
        {!!note && <Text style={styles.note}>{note}</Text>}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
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
          <TouchableOpacity style={styles.secondaryBtn} onPress={useCurrentLocation}>
            <Ionicons name="locate-outline" size={16} color="#2563eb" />
            <Text style={styles.secondaryText}>현재 위치 사용</Text>
          </TouchableOpacity>
        </View>

        {!!debug && (
          <View style={styles.debugBox}>
            <Text style={styles.debugTitle}>디버그 (원인 확인 후 삭제하세요)</Text>
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
 * 네비게이션 (샘플 구조 참고)
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
            // v6 이상에서는 tabBarOptions 대신 screenOptions에 지정
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
  note: { marginTop: 6, fontSize: 13, color: '#d97706' },
  secondaryBtn: {
    marginTop: 12,
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