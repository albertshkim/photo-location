import 'react-native-gesture-handler';
import React, { createContext, useContext, useState } from 'react';
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
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
// 선택기가 EXIF에서 GPS를 지운 경우, 갤러리 DB에서 위치를 다시 읽기 위해 사용 (웹 미지원)
// ※ SDK 58 이상에서 getAssetInfoAsync 관련 오류가 나면 'expo-media-library/legacy'로 바꾸세요
import * as MediaLibrary from 'expo-media-library';
import { Image as ExpoImage } from 'expo-image';
import Constants from 'expo-constants';

const IS_WEB = Platform.OS === 'web';
// Expo Go(Android)는 미디어 라이브러리 전체 접근이 거부됨 → 갤러리 DB 보조 조회 불가
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
 * 위치 유틸
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

// 좌표 → 주소 문자열 (실패하면 좌표 문자열로 대체)
async function resolveAddress(c) {
  if (IS_WEB) return coordText(c); // 웹은 역지오코딩 미지원
  try {
    const [a] = await Location.reverseGeocodeAsync(c);
    if (!a) return coordText(c);
    if (a.formattedAddress) return a.formattedAddress;
    const parts = [a.region, a.city, a.district, a.street, a.streetNumber, a.name]
      .filter(Boolean);
    const unique = [...new Set(parts)];
    return unique.length ? unique.join(' ') : coordText(c);
  } catch {
    return coordText(c);
  }
}

// 갤러리 DB에서 사진 위치 조회 (선택기가 EXIF의 GPS를 지웠을 때의 보조 수단)
async function readCoordsFromLibrary(assetId) {
  const perm = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
  if (!perm.granted) return null;
  const info = await MediaLibrary.getAssetInfoAsync(assetId, {
    shouldDownloadFromNetwork: true,
  });
  return validCoords(info.location) || getCoordsFromExif(info.exif);
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

  const reset = () => {
    setUri(null);
    setTitle('');
    setLocation('');
    setCoords(null);
    setNote(null);
  };

  const clearLocation = () => {
    setCoords(null);
    setLocation('');
  };

  // 현재 위치를 좌표 + 주소로 채움 (카메라 촬영 직후, 또는 "현재 위치 사용" 버튼)
  const fillCurrentLocation = async (noteText) => {
    setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        clearLocation();
        setNote({ text: '위치 권한이 없어 위치를 저장하지 못했어요.', warn: true });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setCoords(c);
      setLocation(await resolveAddress(c));
      setNote({ text: noteText, warn: false });
    } catch {
      clearLocation();
      setNote({ text: '현재 위치를 가져오지 못했어요.', warn: true });
    } finally {
      setLoading(false);
    }
  };

  /* 1) 카메라 촬영 → 촬영 시점의 현재 위치 사용 */
  const takePhoto = async () => {
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (!cam.granted) {
      Alert.alert('권한 필요', '카메라 권한이 필요해요.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (result.canceled) return;
    setUri(result.assets[0].uri);
    await fillCurrentLocation('촬영한 위치(현재 위치)를 저장했어요.');
  };

  /* 2) 갤러리 선택 → 사진 EXIF의 GPS 사용, 없으면 "위치 정보 없음" */
  const pickFromGallery = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('권한 필요', '사진을 불러오려면 앨범 접근 권한이 필요해요.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1, // 재압축으로 EXIF가 바뀌지 않도록 원본 품질
      exif: true, // GPS 읽기에 필수
      // Android: 새 사진 선택기는 GPS를 지우므로 예전 방식으로 열기
      legacy: Platform.OS === 'android',
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    setUri(asset.uri);
    setLoading(true);
    try {
      // 1순위: 사진 EXIF의 GPS
      let c = getCoordsFromExif(asset.exif);
      // 2순위: 선택기가 GPS를 지웠을 수 있으니 갤러리 DB에서 한 번 더 확인
      if (!c && asset.assetId && CAN_USE_MEDIA_LIBRARY) {
        try {
          c = await readCoordsFromLibrary(asset.assetId);
        } catch {
          c = null;
        }
      }

      if (c) {
        setCoords(c);
        setLocation(await resolveAddress(c));
        setNote({ text: '사진에 저장된 위치를 사용했어요.', warn: false });
      } else {
        clearLocation();
        setNote({
          text: '이 사진에는 위치 정보가 없어요. 비워두면 "위치 정보 없음"으로 저장돼요.',
          warn: true,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  // 미리보기 영역을 눌렀을 때: 카메라 / 갤러리 선택
  const chooseSource = () => {
    if (IS_WEB) return pickFromGallery(); // 웹은 Alert 버튼 미동작 + 카메라 미지원
    Alert.alert('사진 추가', '어떻게 추가할까요?', [
      { text: '카메라로 촬영', onPress: takePhoto },
      { text: '갤러리에서 선택', onPress: pickFromGallery },
      { text: '취소', style: 'cancel' },
    ]);
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
        <TouchableOpacity style={styles.picker} onPress={chooseSource} activeOpacity={0.8}>
          {uri ? (
            <ExpoImage source={{ uri }} style={styles.preview} contentFit="cover" />
          ) : (
            <View style={{ alignItems: 'center' }}>
              <Ionicons name="image-outline" size={40} color="#666" />
              <Text style={styles.pickerText}>눌러서 사진 추가</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* 카메라 / 갤러리 버튼 */}
        <View style={styles.sourceRow}>
          {!IS_WEB && (
            <TouchableOpacity style={styles.sourceBtn} onPress={takePhoto}>
              <Ionicons name="camera-outline" size={20} color="#2563eb" />
              <Text style={styles.sourceText}>카메라로 촬영</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.sourceBtn} onPress={pickFromGallery}>
            <Ionicons name="images-outline" size={20} color="#2563eb" />
            <Text style={styles.sourceText}>갤러리에서 선택</Text>
          </TouchableOpacity>
        </View>

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
            placeholder="위치 정보 없음"
            multiline
          />
          {loading && <ActivityIndicator style={{ marginLeft: 8 }} />}
        </View>
        {coords && <Text style={styles.coords}>{coordText(coords)}</Text>}
        {note && (
          <Text style={[styles.note, note.warn && styles.noteWarn]}>{note.text}</Text>
        )}

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => fillCurrentLocation('현재 위치로 입력했어요.')}>
          <Ionicons name="locate-outline" size={16} color="#2563eb" />
          <Text style={styles.secondaryText}>현재 위치 사용</Text>
        </TouchableOpacity>

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
  sourceRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  sourceBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2563eb',
    backgroundColor: '#fff',
  },
  sourceText: { color: '#2563eb', fontWeight: '600', fontSize: 15 },
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
});
