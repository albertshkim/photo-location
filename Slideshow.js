/* ─────────────────────────────
 * SlideShow.js — 사진 슬라이드 쇼 (Home.js · Photoshortview.js 공용)
 * ─────────────────────────────
 * 사용법:
 *   <SlideShow visible items={사진배열} startIndex={0} onClose={...} onEdit={(id) => ...} />
 *
 * - 평소: 손가락으로 왼쪽으로 밀면 다음 사진, 오른쪽으로 밀면 이전 사진
 * - 오른쪽 아래 반투명 [🔍 확대] 버튼을 누르면 확대 모드
 *     · 두 손가락으로 벌리기/오므리기, 한 손가락으로 끌어서 이동, 두 번 탭하면 1배 ↔ 2.5배
 *     · 아래 [ − 2.0배 + ] 로 배율 조절, [✕ 확대 끝]으로 다시 좌우 넘기기
 * - 확대 모드가 아닐 때는 사진에 터치 처리를 붙이지 않아서 좌우 넘기기가 그대로 동작함
 * (추가 라이브러리 없이 react-native의 PanResponder만 사용)
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
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';

const MIN_SCALE = 1;
const MAX_SCALE = 4; // 최대 4배
const START_SCALE = 2; // [확대] 버튼을 누르면 2배부터
const STEP = 1.5; // [+]/[−] 한 번에 1.5배씩
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 280;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const touchDist = (t) => Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);

/* ─────────────────────────────
 * 사진 1장 (확대 모드일 때만 제스처 처리)
 * active   : 이 사진이 확대 모드인지
 * zoomCmd  : 버튼으로 배율 지정 { scale, n } (n이 바뀔 때마다 적용)
 * onScale  : 손가락으로 배율이 바뀌면 부모에 알림 (배율 표시용)
 * ───────────────────────────── */
function ZoomableImage({ uri, width, height, recyclingKey, active, zoomCmd, onScale }) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const cur = useRef(view); // 제스처 중 최신 값
  const size = useRef({ width, height });
  size.current = { width, height };
  const onScaleRef = useRef(onScale);
  onScaleRef.current = onScale;
  const g = useRef({ mode: null, startDist: 1, startScale: 1, startX: 0, startY: 0, moved: false, lastTap: 0 });

  // 배율·위치 적용 (사진이 화면 밖으로 너무 나가지 않게 제한)
  const apply = (scale, x, y) => {
    const s = clamp(scale, MIN_SCALE, MAX_SCALE);
    const mx = (size.current.width * (s - 1)) / 2;
    const my = (size.current.height * (s - 1)) / 2;
    const next = { scale: s, x: clamp(x, -mx, mx), y: clamp(y, -my, my) };
    cur.current = next;
    setView(next);
    onScaleRef.current?.(s);
  };

  // 확대 모드가 끝나면 원래 크기로
  useEffect(() => {
    if (!active) {
      const reset = { scale: 1, x: 0, y: 0 };
      cur.current = reset;
      setView(reset);
    }
  }, [active]);

  // 버튼([확대], [+], [−])으로 배율 지정
  useEffect(() => {
    if (active && zoomCmd) apply(zoomCmd.scale, cur.current.x, cur.current.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, zoomCmd?.n]);

  // 화면 회전 시 위치 다시 맞춤
  useEffect(() => {
    if (active) apply(cur.current.scale, cur.current.x, cur.current.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false, // 확대 모드에서는 터치를 넘겨주지 않음
      onPanResponderGrant: () => {
        g.current.mode = null;
        g.current.moved = false;
      },
      onPanResponderMove: (e, gs) => {
        const touches = e.nativeEvent.touches;
        const st = g.current;
        if (touches.length >= 2) {
          // 두 손가락: 확대/축소
          if (st.mode !== 'pinch') {
            st.mode = 'pinch';
            st.startDist = touchDist(touches) || 1;
            st.startScale = cur.current.scale;
          }
          apply((st.startScale * touchDist(touches)) / st.startDist, cur.current.x, cur.current.y);
          st.moved = true;
        } else {
          // 한 손가락: 사진 이동
          if (st.mode !== 'pan') {
            st.mode = 'pan';
            st.startX = cur.current.x - gs.dx;
            st.startY = cur.current.y - gs.dy;
          }
          apply(cur.current.scale, st.startX + gs.dx, st.startY + gs.dy);
          if (Math.abs(gs.dx) + Math.abs(gs.dy) > 6) st.moved = true;
        }
      },
      onPanResponderRelease: () => {
        const st = g.current;
        if (!st.moved) {
          // 두 번 탭: 1배 ↔ 2.5배
          const now = Date.now();
          if (now - st.lastTap < DOUBLE_TAP_MS) {
            st.lastTap = 0;
            if (cur.current.scale > 1.01) apply(1, 0, 0);
            else apply(DOUBLE_TAP_SCALE, 0, 0);
          } else {
            st.lastTap = now;
          }
        }
        st.mode = null;
      },
      onPanResponderTerminate: () => {
        g.current.mode = null;
      },
    })
  ).current;

  return (
    <View
      style={{ width, height, overflow: 'hidden' }}
      // 확대 모드일 때만 터치 처리 → 평소에는 좌우 넘기기가 방해받지 않음
      {...(active ? responder.panHandlers : null)}>
      <View
        style={{
          width,
          height,
          transform: [{ translateX: view.x }, { translateY: view.y }, { scale: view.scale }],
        }}>
        <ExpoImage
          source={{ uri }}
          style={{ width, height }}
          contentFit="contain" // 사진 전체가 보이게
          recyclingKey={recyclingKey}
        />
      </View>
    </View>
  );
}

/* ─────────────────────────────
 * 슬라이드 쇼 (모달 이미지)
 * ───────────────────────────── */
export default function SlideShow({ visible, items, startIndex, onClose, onEdit }) {
  const { width, height } = useWindowDimensions();
  const listRef = useRef(null);
  const [index, setIndex] = useState(startIndex);
  const [zoomed, setZoomed] = useState(false); // 확대 모드 (이때는 좌우 넘기기 멈춤)
  const [zoomScale, setZoomScale] = useState(1); // 지금 배율 (표시용)
  const [zoomCmd, setZoomCmd] = useState({ scale: START_SCALE, n: 0 });

  // 모달을 열 때마다 누른 사진부터, 확대 모드는 꺼진 상태로 시작
  useEffect(() => {
    if (visible) {
      setIndex(startIndex);
      setZoomed(false);
      setZoomScale(1);
    }
  }, [visible, startIndex]);

  const startZoom = () => {
    setZoomed(true);
    setZoomCmd((c) => ({ scale: START_SCALE, n: c.n + 1 }));
  };
  const zoomBy = (factor) =>
    setZoomCmd((c) => ({ scale: clamp(zoomScale * factor, MIN_SCALE, MAX_SCALE), n: c.n + 1 }));
  const endZoom = () => {
    setZoomed(false);
    setZoomScale(1);
  };

  const close = () => {
    endZoom();
    onClose();
  };

  const goTo = (i) => {
    if (i < 0 || i >= items.length || zoomed) return;
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
      onRequestClose={zoomed ? endZoom : close} // Android 뒤로가기: 확대 중이면 확대만 끝냄
      supportedOrientations={['portrait', 'landscape']}>
      <StatusBar hidden={Platform.OS !== 'web'} />
      <View style={styles.slideScreen}>
        {visible && items.length > 0 && (
          <FlatList
            key={`slide-${width}`} // 화면 회전 시 폭이 바뀌면 다시 그림
            ref={listRef}
            data={items}
            extraData={`${zoomed}-${index}-${zoomCmd.n}`}
            keyExtractor={(it) => it.id}
            horizontal
            pagingEnabled // 한 장씩 딱 맞게 넘어감
            scrollEnabled={!zoomed} // 확대 모드에서는 넘기지 않고 사진을 움직임
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={Math.min(startIndex, items.length - 1)}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onScroll={onScroll}
            scrollEventThrottle={16}
            initialNumToRender={3}
            windowSize={5}
            renderItem={({ item, index: i }) => (
              <ZoomableImage
                uri={item.uri}
                width={width}
                height={height}
                recyclingKey={item.id}
                active={zoomed && i === index}
                zoomCmd={zoomCmd}
                onScale={setZoomScale}
              />
            )}
          />
        )}

        {/* 위쪽 바: 닫기 · 순서 · 수정 */}
        <View style={styles.slideTop}>
          <TouchableOpacity onPress={close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.slideCount}>
            {items.length ? `${index + 1} / ${items.length}` : ''}
          </Text>
          <TouchableOpacity
            style={styles.glassBtn}
            onPress={() => {
              if (!current) return;
              endZoom();
              onEdit(current.id);
            }}
            disabled={!current}>
            <Ionicons name="create-outline" size={16} color="#fff" />
            <Text style={styles.glassText}>수정</Text>
          </TouchableOpacity>
        </View>

        {/* 양옆 화살표 (웹·마우스용, 끝에서는 숨김, 확대 중에는 숨김) */}
        {!zoomed && index > 0 && (
          <TouchableOpacity style={[styles.slideArrow, { left: 8 }]} onPress={() => goTo(index - 1)}>
            <Ionicons name="chevron-back" size={30} color="#fff" />
          </TouchableOpacity>
        )}
        {!zoomed && index < items.length - 1 && (
          <TouchableOpacity style={[styles.slideArrow, { right: 8 }]} onPress={() => goTo(index + 1)}>
            <Ionicons name="chevron-forward" size={30} color="#fff" />
          </TouchableOpacity>
        )}

        {/* 아래쪽: 제목 · 위치 + 반투명 [확대] 버튼 */}
        {current && !zoomed && (
          <View style={styles.slideBottom}>
            <View style={{ flex: 1, marginRight: 10 }} pointerEvents="none">
              <Text style={styles.slideTitle} numberOfLines={1}>{current.title}</Text>
              {!!current.location && (
                <Text style={styles.slideLoc} numberOfLines={1}>📍 {current.location}</Text>
              )}
            </View>
            <TouchableOpacity style={styles.glassBtn} onPress={startZoom}>
              <Ionicons name="search-outline" size={16} color="#fff" />
              <Text style={styles.glassText}>확대</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 확대 모드: [ − 2.0배 + ]  [✕ 확대 끝] */}
        {zoomed && (
          <View style={styles.zoomBar}>
            <TouchableOpacity
              style={styles.zoomRound}
              onPress={() => zoomBy(1 / STEP)}
              disabled={zoomScale <= MIN_SCALE + 0.01}>
              <Ionicons name="remove" size={20} color={zoomScale <= MIN_SCALE + 0.01 ? '#888' : '#fff'} />
            </TouchableOpacity>
            <Text style={styles.zoomText}>{zoomScale.toFixed(1)}배</Text>
            <TouchableOpacity
              style={styles.zoomRound}
              onPress={() => zoomBy(STEP)}
              disabled={zoomScale >= MAX_SCALE - 0.01}>
              <Ionicons name="add" size={20} color={zoomScale >= MAX_SCALE - 0.01 ? '#888' : '#fff'} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.glassBtn, { marginLeft: 12 }]} onPress={endZoom}>
              <Ionicons name="close" size={16} color="#fff" />
              <Text style={styles.glassText}>확대 끝</Text>
            </TouchableOpacity>
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
  // 반투명 버튼 (수정 · 확대 · 확대 끝)
  glassBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  glassText: { color: '#fff', fontWeight: '600', fontSize: 13 },
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  slideTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  slideLoc: { color: '#e5e7eb', fontSize: 13, marginTop: 3 },
  // 확대 모드 조절 바
  zoomBar: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 40 : 24,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  zoomRound: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomText: { color: '#fff', fontWeight: '700', fontSize: 14, minWidth: 52, textAlign: 'center' },
});