/* ─────────────────────────────
 * Photoshortview.js — 보기 (사진만 작게, 한 줄에 1~5장, 기본 3장)
 * ─────────────────────────────
 * - 상단 검색창: 제목·설명·위치 + 날짜로 검색 (Datesearch.js의 searchItems, Home과 공용)
 *   예) 2026 / 2026.11 / 2026.11.13 / 2026년 11월 / "2026.11 역삼동"
 *   날짜는 찍은 날짜, 없으면 저장된 날짜 기준
 * - 상단 헤더: 프로젝트 이름 ─── [전체|지역|위치] ─── [ − 3장 + ]  (보기 선택은 둘 사이 정가운데)
 *   [전체]: 사진만 격자로
 *   [지역]: 주소에서 나라 다음의 도시별로 묶어서
 *     🏙 이스탄불 (12)      🏙 강릉시 (5)
 *     (한국 주소는 도를 건너뛰고 시·군 기준: "강원특별자치도 강릉시 …" → 강릉시)
 *   [위치]: 위치(번지 제외)별로 묶어서
 *     📍 서울특별시 강남구 역삼동 (3)
 *     [사진][사진][사진]
 * - 하단 가운데 [최신순 ⇄ 오래된순] 토글 (찍은 날짜, 없으면 저장된 날짜 기준)
 * - 사진을 누르면 슬라이드 쇼 (SlideShow.js, Home과 공용)
 *   좌우로 밀어서 넘기기 · 반투명 [수정] [확대] 버튼
 *   지금 화면에 보이는 순서대로 넘어감 (지역·위치보기면 묶음 순서)
 * - 상단 제목 옆 [ − 3장 + ] 으로 한 줄에 보여줄 사진 수 조정
 *   → 마지막으로 고른 장수를 저장해 두고, 앱을 다시 실행해도 그대로 사용
 */
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePhotos } from './App';
import { SearchBar, NoResult } from './Search';
import { sortByDate, searchItems } from './Datesearch'; // 날짜순 정렬 + 날짜 포함 검색 (Home.js와 같은 기준)
import SlideShow from './Slideshow'; // 사진 슬라이드 쇼 (Home.js와 공용)

// 한 줄에 보여줄 사진 수: 1~5장, 처음 실행 시 3장 (이후에는 마지막으로 고른 장수)
const MIN_COLUMNS = 1;
const MAX_COLUMNS = 5;
const DEFAULT_COLUMNS = 3;
const COLUMNS_KEY = 'photoshortview.columns'; // 저장 키
const GAP = 4; // 사진 사이 간격
const PAD = 12; // 화면 좌우 여백
const NO_LOCATION = '위치 정보 없음';

/* ─────────────────────────────
 * 한 줄 사진 수: 저장된 값 불러오기 / 바꿀 때 저장
 * ───────────────────────────── */
function useSavedColumns() {
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);

  // 처음 열 때 저장된 장수 불러오기
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(COLUMNS_KEY)
      .then((v) => {
        const n = Number(v);
        if (alive && Number.isInteger(n) && n >= MIN_COLUMNS && n <= MAX_COLUMNS) setColumns(n);
      })
      .catch(() => {}); // 못 읽으면 기본 3장
    return () => {
      alive = false;
    };
  }, []);

  const change = (n) => {
    setColumns(n);
    AsyncStorage.setItem(COLUMNS_KEY, String(n)).catch(() => {});
  };
  return [columns, change];
}

/* ─────────────────────────────
 * 위치 → 묶음 이름 (마지막 번지 생략)
 * 예) "서울특별시 강남구 역삼동 123-45"        → "서울특별시 강남구 역삼동"
 *     "서울 강남구 테헤란로 152 (역삼동)"      → "서울 강남구 테헤란로"
 *     "152, 테헤란로, 역삼동, 강남구, 서울, 06236, 대한민국" → "서울 강남구 역삼동 테헤란로"
 *     좌표만 있거나 비어 있으면 → "위치 정보 없음"
 * ───────────────────────────── */
const isNumberPart = (t) => /^(산\s?)?\d+(-\d+)?(번지)?$/.test(t); // 123, 123-45, 산12-3, 12번지
const isCoordPart = (t) => /^-?\d+(\.\d+)?$/.test(t);

export function locationGroup(location) {
  if (!location || !location.trim()) return NO_LOCATION;
  let text = location.replace(/\([^)]*\)/g, ' ').replace(/📍/g, ' ').trim(); // 괄호(건물명) 제거
  let parts;
  if (text.includes(',')) {
    // OpenStreetMap 형식: 작은 단위 → 큰 단위 (번지·우편번호·국가 제외 후 뒤집기)
    parts = text
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t && !isNumberPart(t) && !isCoordPart(t) && !/^\d{5}$/.test(t) && t !== '대한민국')
      .reverse();
  } else {
    parts = text.split(/\s+/).filter((t) => t && t !== '대한민국');
    // 뒤쪽의 번지(숫자) 부분만 제거
    while (parts.length && isNumberPart(parts[parts.length - 1])) parts.pop();
  }
  const name = parts.join(' ').trim();
  return name || NO_LOCATION;
}

// 나라 이름 (주소 맨 앞/맨 뒤에 붙는 경우 제거)
const COUNTRIES = [
  '대한민국', '한국', 'South Korea', 'Republic of Korea', 'Korea',
  '튀르키예', '터키', 'Türkiye', 'Turkey', '일본', 'Japan', '日本', '중국', 'China', '中国',
  '미국', '미합중국', 'United States of America', 'United States', 'USA', '대만', 'Taiwan',
  '홍콩', 'Hong Kong', '베트남', 'Vietnam', 'Việt Nam', '태국', 'Thailand', '필리핀', 'Philippines',
  '싱가포르', 'Singapore', '말레이시아', 'Malaysia', '인도네시아', 'Indonesia', '인도', 'India',
  '몽골', 'Mongolia', '호주', 'Australia', '뉴질랜드', 'New Zealand', '캐나다', 'Canada',
  '멕시코', 'Mexico', '영국', 'United Kingdom', 'UK', '프랑스', 'France', '독일', 'Germany',
  'Deutschland', '이탈리아', 'Italy', 'Italia', '스페인', 'Spain', 'España', '포르투갈', 'Portugal',
  '네덜란드', 'Netherlands', '스위스', 'Switzerland', '오스트리아', 'Austria', '체코', 'Czechia',
  '헝가리', 'Hungary', '그리스', 'Greece', '러시아', 'Russia', '이집트', 'Egypt',
  '아랍에미리트', 'United Arab Emirates', 'UAE',
].sort((a, b) => b.length - a.length); // 긴 이름부터 비교 (United States of America → United States)
const KOREA = new Set(['대한민국', '한국', 'South Korea', 'Republic of Korea', 'Korea']);
const isCountry = (t) => COUNTRIES.some((c) => c.toLowerCase() === t.toLowerCase());

// 한국 주소의 도(道) → 건너뛰고 그 다음 시·군을 지역으로 사용
const KR_PROVINCE_SHORT = ['경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
const isKrProvince = (t) => (/도$/.test(t) && /[가-힣]/.test(t)) || KR_PROVINCE_SHORT.includes(t);
// 줄임말 → 정식 이름 (같은 도시가 두 묶음으로 나뉘지 않게)
const KR_CITY_FULL = {
  서울: '서울특별시', 서울시: '서울특별시', 부산: '부산광역시', 부산시: '부산광역시',
  대구: '대구광역시', 대구시: '대구광역시', 인천: '인천광역시', 인천시: '인천광역시',
  광주: '광주광역시', 대전: '대전광역시', 대전시: '대전광역시', 울산: '울산광역시', 울산시: '울산광역시',
  세종: '세종특별자치시', 세종시: '세종특별자치시',
};
// 도시보다 큰 권역 이름 (OpenStreetMap 주소에 끼어 있음, 예: "마르마라 지역", "Marmara Bölgesi")
const isAreaPart = (t) => /(지역|지방|Bölgesi|Region|Province|Prefecture)$/i.test(t);

/* ─────────────────────────────
 * 위치 → 지역(도시) 이름: 주소에서 나라 다음의 도시
 * 예) "튀르키예 이스탄불 파티흐 …"                 → "이스탄불"
 *     "대한민국 강릉시 무교동 12"                  → "강릉시"
 *     "강원특별자치도 강릉시 교동 123"             → "강릉시"   (한국의 도는 건너뜀)
 *     "서울특별시 강남구 역삼동 123-45"            → "서울특별시"
 *     "152, 테헤란로, 역삼동, 강남구, 서울, 06236, 대한민국" → "서울특별시"
 *     "Fatih, İstanbul, Marmara Bölgesi, 34000, Türkiye"   → "İstanbul"
 *     좌표만 있거나 비어 있으면 → "위치 정보 없음"
 * ───────────────────────────── */
export function regionGroup(location) {
  if (!location || !location.trim()) return NO_LOCATION;
  const text = location.replace(/\([^)]*\)/g, ' ').replace(/📍/g, ' ').replace(/\s+/g, ' ').trim();
  let country = null;
  let parts;

  if (text.includes(',')) {
    // OpenStreetMap 형식: 작은 단위 → 큰 단위 → 뒤집어서 큰 단위부터
    parts = text.split(',').map((t) => t.trim()).filter(Boolean).reverse();
  } else {
    // "나라 도시 구 …" 형식: 앞이나 뒤에 붙은 나라 이름 떼기 (두 단어 나라 이름도 처리)
    let rest = text;
    for (const c of COUNTRIES) {
      const lc = c.toLowerCase();
      if (rest.toLowerCase().startsWith(lc + ' ') || rest.toLowerCase() === lc) {
        country = c;
        rest = rest.slice(c.length).trim();
        break;
      }
      if (rest.toLowerCase().endsWith(' ' + lc)) {
        country = c;
        rest = rest.slice(0, -c.length).trim();
        break;
      }
    }
    parts = rest.split(' ');
  }

  // 번지·우편번호·좌표·나라·권역 이름 제외
  parts = parts.filter((t) => {
    if (!t || isNumberPart(t) || isCoordPart(t) || /^\d{5,6}$/.test(t)) return false;
    if (isCountry(t)) {
      country = country ?? t;
      return false;
    }
    return !isAreaPart(t);
  });
  if (!parts.length) return NO_LOCATION;

  // 한국 주소(나라가 한국이거나 나라 이름이 없는 한글 주소): 도는 건너뛰고, 줄임말은 정식 이름으로
  const korean = country ? KOREA.has(country) : /[가-힣]/.test(parts[0]);
  if (korean) {
    while (parts.length > 1 && isKrProvince(parts[0])) parts.shift();
    return KR_CITY_FULL[parts[0]] ?? parts[0];
  }
  return parts[0];
}

// 정렬된 사진 → 묶음 [{ title, data: [...] }]  (keyOf: 사진 주소 → 묶음 이름)
// 묶음 순서 = 정렬 순서에서 먼저 나온 묶음이 위 ("위치 정보 없음"은 맨 아래)
function groupBy(list, keyOf) {
  const map = new Map();
  list.forEach((it) => {
    const key = keyOf(it.location);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  });
  const groups = [...map.entries()].map(([title, data]) => ({ title, data }));
  return groups.sort((a, b) => (a.title === NO_LOCATION) - (b.title === NO_LOCATION));
}

// 보기 방식: 전체 / 지역(도시) / 위치(번지 제외)
const VIEW_MODES = [
  { key: 'all', label: '전체' },
  { key: 'region', label: '지역' },
  { key: 'location', label: '위치' },
];

/* ─────────────────────────────
 * 상단 헤더 (직접 만듦)
 * [프로젝트 이름 ▼] ──── [전체|지역|위치] ──── [ − 3장 + ]
 * 보기 선택은 왼쪽 제목과 오른쪽 장수 버튼 사이 공간의 정가운데에 위치
 * ───────────────────────────── */
function ShortViewHeader({ projectName, onProjectPress, viewMode, onViewMode, columns, onColumns }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        {/* 왼쪽: 프로젝트 이름 (누르면 프로젝트 목록) */}
        <TouchableOpacity style={styles.headerTitleBtn} onPress={onProjectPress}>
          <Text style={styles.headerTitleText} numberOfLines={1}>{projectName}</Text>
          <Ionicons name="chevron-down" size={16} color="#333" />
        </TouchableOpacity>

        {/* 가운데: 보기 선택 [전체|지역|위치] (선택된 칸이 색칠됨) */}
        <View style={styles.headerCenter}>
          <View style={styles.segment}>
            {VIEW_MODES.map((m, i) => {
              const on = viewMode === m.key;
              return (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.segBtn, i > 0 && styles.segBtnBorder, on && styles.segBtnOn]}
                  activeOpacity={0.7}
                  onPress={() => onViewMode(m.key)}>
                  <Text style={[styles.segText, on && styles.segTextOn]}>{m.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 오른쪽: 한 줄 사진 수 */}
        <ColumnControl value={columns} onChange={onColumns} />
      </View>
    </View>
  );
}

export default function PhotoShortViewScreen({ navigation }) {
  const { items, currentProject } = usePhotos();
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState('new'); // 'new' 최신순 | 'old' 오래된순
  const [viewMode, setViewMode] = useState('all'); // 'all' 전체 | 'region' 지역(도시) | 'location' 위치
  const grouped = viewMode !== 'all';
  const shown = useMemo(
    () => sortByDate(searchItems(items, query), order), // 제목·설명·위치 + 날짜 검색
    [items, query, order]
  );
  const groups = useMemo(() => {
    if (viewMode === 'region') return groupBy(shown, regionGroup);
    if (viewMode === 'location') return groupBy(shown, locationGroup);
    return [];
  }, [viewMode, shown]);
  // 슬라이드 쇼 순서 = 지금 화면에 보이는 순서
  const slideItems = useMemo(
    () => (grouped ? groups.flatMap((g) => g.data) : shown),
    [grouped, groups, shown]
  );
  const slidePos = useMemo(() => {
    const m = {};
    slideItems.forEach((it, i) => (m[it.id] = i));
    return m;
  }, [slideItems]);
  const [slideIndex, setSlideIndex] = useState(null); // 슬라이드 쇼 시작 위치 (null = 닫힘)
  const { width } = useWindowDimensions();
  const [columns, setColumns] = useSavedColumns();

  // 상단 헤더: 프로젝트 이름 ─ [전체|지역|위치] ─ [ − 3장 + ]
  const projectName = currentProject?.name ?? '내 사진';
  useLayoutEffect(() => {
    navigation.setOptions({
      header: () => (
        <ShortViewHeader
          projectName={projectName}
          onProjectPress={() => navigation.navigate('ListTab', { screen: 'ProjectList' })}
          viewMode={viewMode}
          onViewMode={setViewMode}
          columns={columns}
          onColumns={setColumns}
        />
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, columns, viewMode, projectName]);

  // 화면 폭에 맞춰 사진 크기 계산 (가로 회전·웹에서도 선택한 장수 유지)
  const size = Math.floor((width - PAD * 2 - GAP * (columns - 1)) / columns);

  // 사진 한 칸
  const renderThumb = (item, index) => (
    <TouchableOpacity
      key={item.id}
      activeOpacity={0.8}
      onPress={() => setSlideIndex(slidePos[item.id] ?? 0)} // 누르면 슬라이드 쇼
      style={{
        width: size,
        height: size,
        marginRight: index % columns === columns - 1 ? 0 : GAP,
        marginBottom: GAP,
      }}>
      <ExpoImage
        source={{ uri: item.uri }}
        style={styles.thumb}
        contentFit="cover"
        recyclingKey={item.id}
        transition={150}
      />
    </TouchableOpacity>
  );

  const empty = query.trim() ? (
    <NoResult query={query} onClear={() => setQuery('')} />
  ) : (
    <View style={{ alignItems: 'center' }}>
      <Ionicons name="grid-outline" size={44} color="#bbb" />
      <Text style={styles.empty}>아직 등록된 사진이 없어요.</Text>
    </View>
  );

  const listPadding = { padding: PAD, paddingTop: 10, paddingBottom: 90 }; // 아래 정렬 버튼 자리

  return (
    <View style={styles.screen}>
      {items.length > 0 && (
        <SearchBar value={query} onChange={setQuery} total={items.length} shown={shown.length} />
      )}

      {grouped ? (
        /* 지역보기: 🏙 도시 + 그 도시의 사진들 / 위치보기: 📍 위치(번지 제외) + 그 위치의 사진들 */
        <FlatList
          key={`${viewMode}-${columns}`}
          data={groups}
          keyExtractor={(g) => g.title}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={groups.length === 0 ? styles.emptyWrap : listPadding}
          ListEmptyComponent={empty}
          renderItem={({ item: group }) => (
            <View style={styles.group}>
              <View style={styles.groupHeader}>
                <Ionicons
                  name={
                    group.title === NO_LOCATION
                      ? 'help-circle-outline'
                      : viewMode === 'region'
                        ? 'business'
                        : 'location'
                  }
                  size={15}
                  color="tomato"
                />
                <Text style={styles.groupTitle} numberOfLines={2}>{group.title}</Text>
                <Text style={styles.groupCount}>{group.data.length}</Text>
              </View>
              <View style={styles.groupGrid}>{group.data.map((it, i) => renderThumb(it, i))}</View>
            </View>
          )}
        />
      ) : (
        /* 전체보기: 사진만 격자로 */
        <FlatList
          key={`grid-${columns}`} // 장수를 바꾸면 목록을 새로 그림 (numColumns 변경 시 필요)
          data={shown}
          numColumns={columns}
          keyExtractor={(it) => it.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={shown.length === 0 ? styles.emptyWrap : listPadding}
          ListEmptyComponent={empty}
          renderItem={({ item, index }) => renderThumb(item, index)}
        />
      )}

      {/* 사진 슬라이드 쇼: 좌우로 밀어서 넘기기, [수정]은 수정 화면, [확대]는 확대 모드 */}
      <SlideShow
        visible={slideIndex !== null}
        items={slideItems}
        startIndex={slideIndex ?? 0}
        onClose={() => setSlideIndex(null)}
        onEdit={(id) => {
          setSlideIndex(null);
          navigation.navigate('PhotoEdit', { id });
        }}
      />

      {/* 하단 가운데: 최신순 ⇄ 오래된순 토글 (글자 = 지금 정렬) */}
      {shown.length > 1 && (
        <View style={styles.sortWrap} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.sortToggle}
            activeOpacity={0.8}
            onPress={() => setOrder((o) => (o === 'new' ? 'old' : 'new'))}>
            <Ionicons name={order === 'new' ? 'arrow-down' : 'arrow-up'} size={14} color="#fff" />
            <Text style={styles.sortToggleText}>{order === 'new' ? '최신순' : '오래된순'}</Text>
            <Ionicons name="swap-vertical" size={14} color="rgba(255,255,255,0.8)" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// [ − 3장 + ] 사진 수 조절 버튼
function ColumnControl({ value, onChange }) {
  const canDec = value > MIN_COLUMNS;
  const canInc = value < MAX_COLUMNS;
  return (
    <View style={styles.colControl}>
      <TouchableOpacity
        style={[styles.colBtn, !canDec && styles.colBtnOff]}
        onPress={() => canDec && onChange(value - 1)}
        disabled={!canDec}
        hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
        <Ionicons name="remove" size={16} color={canDec ? 'tomato' : '#ccc'} />
      </TouchableOpacity>
      <Text style={styles.colText}>{value}장</Text>
      <TouchableOpacity
        style={[styles.colBtn, !canInc && styles.colBtnOff]}
        onPress={() => canInc && onChange(value + 1)}
        disabled={!canInc}
        hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
        <Ionicons name="add" size={16} color={canInc ? 'tomato' : '#ccc'} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f7f9' },
  emptyWrap: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { marginTop: 8, color: '#888' },
  colControl: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // 직접 만든 상단 헤더
  header: {
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d1d5db',
  },
  headerRow: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  headerTitleBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, maxWidth: 110 },
  headerTitleText: { fontSize: 17, fontWeight: '600', color: '#111', flexShrink: 1 },
  headerCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  colBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'tomato',
    justifyContent: 'center',
    alignItems: 'center',
  },
  colBtnOff: { borderColor: '#ddd' },
  colText: { minWidth: 30, textAlign: 'center', fontSize: 14, fontWeight: '700', color: '#333' },
  thumb: { width: '100%', height: '100%', borderRadius: 6, backgroundColor: '#e5e7eb' },
  // 헤더 가운데 보기 선택 [전체|지역|위치]
  segment: {
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'tomato',
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  segBtn: { paddingHorizontal: 9, paddingVertical: 6 },
  segBtnBorder: { borderLeftWidth: 1, borderLeftColor: 'tomato' },
  segBtnOn: { backgroundColor: 'tomato' },
  segText: { color: 'tomato', fontSize: 12, fontWeight: '700' },
  segTextOn: { color: '#fff' },
  // 위치별 묶음
  group: { marginBottom: 14 },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  groupTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: '#111' },
  groupCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9a3412',
    backgroundColor: '#ffedd5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  groupGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  // 하단 가운데 정렬 토글
  sortWrap: { position: 'absolute', left: 0, right: 0, bottom: 20, alignItems: 'center' },
  sortToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: 'tomato',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  sortToggleText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
