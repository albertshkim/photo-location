/* ─────────────────────────────
 * Photoshortview.js — 보기 (사진만 작게, 한 줄에 1~5장, 기본 3장)
 * ─────────────────────────────
 * - 상단 검색창: 제목·설명·위치에 검색어가 들어간 사진만 표시
 * - 상단 헤더: 프로젝트 이름 ─── [위치보기] ─── [ − 3장 + ]  (토글은 둘 사이 정가운데)
 *   [위치보기]: 위치(번지 제외)별로 묶어서
 *     📍 서울특별시 강남구 역삼동 (3)
 *     [사진][사진][사진]
 *   처럼 보여줌. 다시 누르면 [전체보기]
 * - 하단 가운데 [최신순 ⇄ 오래된순] 토글 (찍은 날짜, 없으면 저장된 날짜 기준)
 * - 사진을 누르면 슬라이드 쇼 (SlideShow.js, Home과 공용)
 *   좌우로 밀어서 넘기기 · 반투명 [수정] [확대] 버튼
 *   지금 화면에 보이는 순서대로 넘어감 (위치보기면 위치 묶음 순서)
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
import { filterItems, SearchBar, NoResult } from './Search';
import { sortByDate } from './Datesearch'; // 날짜순 정렬 (Home.js와 같은 기준)
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

// 정렬된 사진 → 위치별 묶음 [{ title, data: [...] }]
// 묶음 순서 = 정렬 순서에서 먼저 나온 묶음이 위 ("위치 정보 없음"은 맨 아래)
function groupByLocation(list) {
  const map = new Map();
  list.forEach((it) => {
    const key = locationGroup(it.location);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  });
  const groups = [...map.entries()].map(([title, data]) => ({ title, data }));
  return groups.sort((a, b) => (a.title === NO_LOCATION) - (b.title === NO_LOCATION));
}

/* ─────────────────────────────
 * 상단 헤더 (직접 만듦)
 * [프로젝트 이름 ▼] ──── [위치보기/전체보기] ──── [ − 3장 + ]
 * 토글은 왼쪽 제목과 오른쪽 장수 버튼 사이 공간의 정가운데에 위치
 * ───────────────────────────── */
function ShortViewHeader({ projectName, onProjectPress, byLocation, onToggle, columns, onColumns }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        {/* 왼쪽: 프로젝트 이름 (누르면 프로젝트 목록) */}
        <TouchableOpacity style={styles.headerTitleBtn} onPress={onProjectPress}>
          <Text style={styles.headerTitleText} numberOfLines={1}>{projectName}</Text>
          <Ionicons name="chevron-down" size={16} color="#333" />
        </TouchableOpacity>

        {/* 가운데: 위치보기 ⇄ 전체보기 토글 (글자 = 누르면 바뀔 보기) */}
        <View style={styles.headerCenter}>
          <TouchableOpacity
            style={[styles.toggleBtn, byLocation && styles.toggleBtnOn]}
            activeOpacity={0.7}
            onPress={onToggle}>
            <Ionicons
              name={byLocation ? 'grid-outline' : 'location-outline'}
              size={15}
              color={byLocation ? '#fff' : 'tomato'}
            />
            <Text style={[styles.toggleText, byLocation && { color: '#fff' }]}>
              {byLocation ? '전체보기' : '위치보기'}
            </Text>
          </TouchableOpacity>
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
  const [byLocation, setByLocation] = useState(false); // 위치보기
  const shown = useMemo(
    () => sortByDate(filterItems(items, query), order),
    [items, query, order]
  );
  const groups = useMemo(() => (byLocation ? groupByLocation(shown) : []), [byLocation, shown]);
  // 슬라이드 쇼 순서 = 지금 화면에 보이는 순서
  const slideItems = useMemo(
    () => (byLocation ? groups.flatMap((g) => g.data) : shown),
    [byLocation, groups, shown]
  );
  const slidePos = useMemo(() => {
    const m = {};
    slideItems.forEach((it, i) => (m[it.id] = i));
    return m;
  }, [slideItems]);
  const [slideIndex, setSlideIndex] = useState(null); // 슬라이드 쇼 시작 위치 (null = 닫힘)
  const { width } = useWindowDimensions();
  const [columns, setColumns] = useSavedColumns();

  // 상단 헤더: 프로젝트 이름 ─ [위치보기] ─ [ − 3장 + ]
  const projectName = currentProject?.name ?? '내 사진';
  useLayoutEffect(() => {
    navigation.setOptions({
      header: () => (
        <ShortViewHeader
          projectName={projectName}
          onProjectPress={() => navigation.navigate('ListTab', { screen: 'ProjectList' })}
          byLocation={byLocation}
          onToggle={() => setByLocation((v) => !v)}
          columns={columns}
          onColumns={setColumns}
        />
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, columns, byLocation, projectName]);

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

      {byLocation ? (
        /* 위치보기: 📍 위치(번지 제외) + 그 위치의 사진들 */
        <FlatList
          key={`loc-${columns}`}
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
                  name={group.title === NO_LOCATION ? 'help-circle-outline' : 'location'}
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
  headerTitleBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, maxWidth: 120 },
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
  // 헤더 가운데 위치보기 토글
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'tomato',
    backgroundColor: '#fff',
  },
  toggleBtnOn: { backgroundColor: 'tomato' },
  toggleText: { color: 'tomato', fontSize: 13, fontWeight: '700' },
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