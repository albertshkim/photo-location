/* ─────────────────────────────
 * Search.js — 키워드 검색 (제목·설명·위치)
 * ─────────────────────────────
 * Home.js(목록, 리스트보기)와 Photoshortview.js(보기)에서 함께 사용
 * - 대소문자 구분 없음
 * - 띄어쓰기로 여러 단어를 넣으면 모두 포함된 항목만 (예: "영등 카페")
 */
import React from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const normalize = (s) => {
  const t = String(s ?? '').toLowerCase();
  return typeof t.normalize === 'function' ? t.normalize('NFC') : t; // iOS 한글 자모 분리 대비
};

export function filterItems(items, query) {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((it) => {
    const text = normalize([it.title, it.description, it.location].filter(Boolean).join(' '));
    return words.every((w) => text.includes(w));
  });
}

// 검색창 (입력 + 지우기 버튼 + 결과 개수)
export function SearchBar({ value, onChange, total, shown }) {
  return (
    <View style={styles.searchWrap}>
      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={18} color="#9ca3af" />
        <TextInput
          style={styles.searchInput}
          value={value}
          onChangeText={onChange}
          placeholder="제목, 설명, 위치로 검색 (예: 영등)"
          placeholderTextColor="#9ca3af"
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="never"
        />
        {!!value && (
          <TouchableOpacity onPress={() => onChange('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color="#9ca3af" />
          </TouchableOpacity>
        )}
      </View>
      {!!value.trim() && (
        <Text style={styles.searchCount}>
          검색 결과 {shown}건 / 전체 {total}건
        </Text>
      )}
    </View>
  );
}

// 검색 결과가 없을 때
export const NoResult = ({ query, onClear }) => (
  <View style={{ alignItems: 'center' }}>
    <Ionicons name="search-outline" size={44} color="#bbb" />
    <Text style={styles.empty}>"{query.trim()}"에 해당하는 사진이 없어요.</Text>
    <TouchableOpacity style={styles.clearBtn} onPress={onClear}>
      <Text style={styles.clearText}>검색어 지우기</Text>
    </TouchableOpacity>
  </View>
);

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 16, paddingTop: 12 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, paddingVertical: Platform.OS === 'ios' ? 10 : 8, fontSize: 15, color: '#111' },
  searchCount: { marginTop: 6, fontSize: 12, color: '#6b7280' },
  empty: { marginTop: 8, color: '#888' },
  clearBtn: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  clearText: { color: '#2563eb', fontWeight: '600' },
});