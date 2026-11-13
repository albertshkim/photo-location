/* ─────────────────────────────
 * SlideShow.js — 사진 슬라이드 쇼 (Home.js · Photoshortview.js 공용)
 * ─────────────────────────────
 * 사용법:
 *   <SlideShow visible items={사진배열} startIndex={0} onClose={...} onEdit={(id) => ...} />
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
  Modal,
  StatusBar,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';

/* ─────────────────────────────
 * 슬라이드 쇼 (모달 이미지)
 * - 가로로 한 장씩 넘어감 (왼쪽으로 밀기 = 다음, 오른쪽으로 밀기 = 이전)
 * - 위: 닫기 · 순서(3 / 10) · 수정 / 아래: 제목·위치
 * - 웹에서는 손가락 대신 양옆 화살표 버튼으로도 넘김
 * ───────────────────────────── */
export default function SlideShow({ visible, items, startIndex, onClose, onEdit }) {
  const { width, height } = useWindowDimensions();
  const listRef = useRef(null);
  const [index, setIndex] = useState(startIndex);

  // 모달을 열 때마다 누른 사진부터 시작
  useEffect(() => {
    if (visible) setIndex(startIndex);
  }, [visible, startIndex]);

  const goTo = (i) => {
    if (i < 0 || i >= items.length) return;
    listRef.current?.scrollToIndex({ index: i, animated: true });
    setIndex(i);
  };

  // 스크롤 위치로 지금 보이는 사진 번호 계산
  const onScroll = (e) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index && i >= 0 && i < items.length) setIndex(i);
  };

  const current = items[index];

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      onRequestClose={onClose} // Android 뒤로가기 버튼
      supportedOrientations={['portrait', 'landscape']}>
      <StatusBar hidden={Platform.OS !== 'web'} />
      <View style={styles.slideScreen}>
        {visible && items.length > 0 && (
          <FlatList
            key={`slide-${width}`} // 화면 회전 시 폭이 바뀌면 다시 그림
            ref={listRef}
            data={items}
            keyExtractor={(it) => it.id}
            horizontal
            pagingEnabled // 한 장씩 딱 맞게 넘어감
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={Math.min(startIndex, items.length - 1)}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onScroll={onScroll}
            scrollEventThrottle={16}
            initialNumToRender={3}
            windowSize={5}
            renderItem={({ item }) => (
              <View style={{ width, height, justifyContent: 'center' }}>
                <ExpoImage
                  source={{ uri: item.uri }}
                  style={{ width, height }}
                  contentFit="contain" // 사진 전체가 보이게
                  recyclingKey={item.id}
                />
              </View>
            )}
          />
        )}

        {/* 위쪽 바: 닫기 · 순서 · 수정 */}
        <View style={styles.slideTop}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.slideCount}>
            {items.length ? `${index + 1} / ${items.length}` : ''}
          </Text>
          <TouchableOpacity
            style={styles.slideEditBtn}
            onPress={() => current && onEdit(current.id)}
            disabled={!current}>
            <Ionicons name="create-outline" size={16} color="#fff" />
            <Text style={styles.slideEditText}>수정</Text>
          </TouchableOpacity>
        </View>

        {/* 양옆 화살표 (웹·마우스용, 끝에서는 숨김) */}
        {index > 0 && (
          <TouchableOpacity style={[styles.slideArrow, { left: 8 }]} onPress={() => goTo(index - 1)}>
            <Ionicons name="chevron-back" size={30} color="#fff" />
          </TouchableOpacity>
        )}
        {index < items.length - 1 && (
          <TouchableOpacity style={[styles.slideArrow, { right: 8 }]} onPress={() => goTo(index + 1)}>
            <Ionicons name="chevron-forward" size={30} color="#fff" />
          </TouchableOpacity>
        )}

        {/* 아래쪽: 제목 · 위치 */}
        {current && (
          <View style={styles.slideBottom} pointerEvents="none">
            <Text style={styles.slideTitle} numberOfLines={1}>{current.title}</Text>
            {!!current.location && (
              <Text style={styles.slideLoc} numberOfLines={1}>📍 {current.location}</Text>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  slideScreen: { flex: 1, backgroundColor: '#000' },
  slideTop: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 20,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  slideCount: { color: '#fff', fontSize: 15, fontWeight: '700' },
  slideEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  slideEditText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  slideArrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  slideBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  slideTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  slideLoc: { color: '#e5e7eb', fontSize: 13, marginTop: 3 },
});