/* ─────────────────────────────
 * Photoshortview.js — 보기 (사진만 작게, 한 줄에 1~5장, 기본 3장)
 * ─────────────────────────────
 * - 상단 검색창: 제목·설명·위치 + 날짜(찍은 날짜, 없으면 저장된 날짜)로 검색
 *   예) 2026.11 → 2026년 11월 사진
 * - 사진을 누르면 현재 검색 결과로 슬라이드 쇼(전체 화면)
 *   왼쪽으로 밀면 다음 사진, 오른쪽으로 밀면 이전 사진 · [수정]으로 수정 화면 이동
 * - 상단 제목 옆 [ − 3장 + ] 으로 한 줄에 보여줄 사진 수 조정
 */
import React, { useLayoutEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';

import { usePhotos } from './App';
import { SearchBar, NoResult } from './Search';
import { searchItems } from './Datesearch'; // 기존 검색 + 날짜 검색
import SlideShow from './Slideshow'; // 사진 슬라이드 쇼 (Home.js와 공용)

// 한 줄에 보여줄 사진 수: 1~5장, 기본 3장 (화면을 다시 열면 3장으로 시작)
const MIN_COLUMNS = 1;
const MAX_COLUMNS = 5;
const DEFAULT_COLUMNS = 3;
const GAP = 4; // 사진 사이 간격
const PAD = 12; // 화면 좌우 여백

export default function PhotoShortViewScreen({ navigation }) {
  const { items } = usePhotos();
  const [query, setQuery] = useState('');
  const shown = useMemo(() => searchItems(items, query), [items, query]);
  const { width } = useWindowDimensions();
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [slideIndex, setSlideIndex] = useState(null); // 슬라이드 쇼 시작 위치 (null = 닫힘)

  // 상단 제목(내 사진) 옆에 사진 수 조절 버튼 표시
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <ColumnControl value={columns} onChange={setColumns} />,
    });
  }, [navigation, columns]);

  // 화면 폭에 맞춰 사진 크기 계산 (가로 회전·웹에서도 선택한 장수 유지)
  const size = Math.floor((width - PAD * 2 - GAP * (columns - 1)) / columns);

  return (
    <View style={styles.screen}>
      {items.length > 0 && (
        <SearchBar value={query} onChange={setQuery} total={items.length} shown={shown.length} />
      )}
      <FlatList
        key={`grid-${columns}`} // 장수를 바꾸면 목록을 새로 그림 (numColumns 변경 시 필요)
        data={shown}
        numColumns={columns}
        keyExtractor={(it) => it.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={shown.length === 0 ? styles.emptyWrap : { padding: PAD, paddingTop: 10 }}
        ListEmptyComponent={
          query.trim() ? (
            <NoResult query={query} onClear={() => setQuery('')} />
          ) : (
            <View style={{ alignItems: 'center' }}>
              <Ionicons name="grid-outline" size={44} color="#bbb" />
              <Text style={styles.empty}>아직 등록된 사진이 없어요.</Text>
            </View>
          )
        }
        renderItem={({ item, index }) => (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setSlideIndex(index)} // 현재 검색 결과 기준 슬라이드 쇼
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
  colControl: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 12 },
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
});