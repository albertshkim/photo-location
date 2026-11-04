import React from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
} from 'react-native';

export default function PhotoList({ items, onAdd, onDelete }) {
  const confirmDelete = (id) => {
    Alert.alert('삭제', '이 항목을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => onDelete(id) },
    ]);
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      onLongPress={() => confirmDelete(item.id)}
      activeOpacity={0.8}
    >
      <Image source={{ uri: item.uri }} style={styles.thumb} />
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.location} numberOfLines={2}>
          📍 {item.location || '위치 정보 없음'}
        </Text>
        {item.coords && (
          <Text style={styles.coords}>
            {item.coords.latitude.toFixed(5)}, {item.coords.longitude.toFixed(5)}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>내 사진</Text>
        <TouchableOpacity style={styles.addBtn} onPress={onAdd}>
          <Text style={styles.addBtnText}>+ 추가</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        renderItem={renderItem}
        contentContainerStyle={items.length === 0 && styles.emptyWrap}
        ListEmptyComponent={
          <Text style={styles.empty}>
            아직 등록된 사진이 없어요.{'\n'}오른쪽 위 "+ 추가"를 눌러보세요.
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  headerText: { fontSize: 24, fontWeight: '700', color: '#111' },
  addBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addBtnText: { color: '#fff', fontWeight: '600' },
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
  coords: { fontSize: 11, color: '#999', marginTop: 2 },
  emptyWrap: { flex: 1, justifyContent: 'center' },
  empty: { textAlign: 'center', color: '#888', lineHeight: 22 },
});