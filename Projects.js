/* ─────────────────────────────
 * Projects.js — 프로젝트(동네·장소·주제별 사진 묶음) 화면
 * ─────────────────────────────
 *  ProjectListScreen   : 최근 사용 순 프로젝트 목록, 열기, 삭제, 종류별 보기
 *  ProjectCreateScreen : 새 프로젝트 만들기 (이름, 종류, 저장 키 접두어(prefix))
 */
import React, { useEffect, useRef, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';

import { IS_WEB, usePhotos } from './App';
import {
  PROJECT_TYPES,
  PREFIX_RE,
  PREFIX_RULE,
  typeLabel,
  typeIcon,
  itemsKey,
  suggestPrefix,
} from './storage';

const notify = (title, msg) => (IS_WEB ? window.alert(`${title}\n${msg}`) : Alert.alert(title, msg));

const confirmAsk = (title, msg, okText, onOk) => {
  if (IS_WEB) {
    if (window.confirm(`${title}\n${msg}`)) onOk();
    return;
  }
  Alert.alert(title, msg, [
    { text: '취소', style: 'cancel' },
    { text: okText, style: 'destructive', onPress: onOk },
  ]);
};

// 2026.11.13 14:05
const formatDateTime = (ts) => {
  if (!ts) return '-';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* ─────────────────────────────
 * 프로젝트 목록 (최근 사용 순)
 * ───────────────────────────── */
export function ProjectListScreen({ navigation }) {
  const { projects, currentProject, openProject, deleteProject } = usePhotos();
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);

  const data = filter === 'all' ? projects : projects.filter((p) => p.type === filter);

  const open = async (p) => {
    if (busyId) return;
    setBusyId(p.id);
    try {
      await openProject(p.id);
      navigation.navigate('PhotoList');
    } catch (e) {
      notify('열기 실패', e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = (p) =>
    confirmAsk(
      '프로젝트 삭제',
      `"${p.name}" 프로젝트와 사진 ${p.count ?? 0}장을 모두 삭제할까요?\n되돌릴 수 없어요.`,
      '삭제',
      async () => {
        setBusyId(p.id);
        try {
          await deleteProject(p.id);
        } catch (e) {
          notify('삭제 실패', e?.message ?? String(e));
        } finally {
          setBusyId(null);
        }
      }
    );

  const chips = [{ key: 'all', label: '전체', icon: 'albums-outline' }, ...PROJECT_TYPES];

  return (
    <View style={styles.screen}>
      {/* 종류별 보기 */}
      <View style={styles.chipRow}>
        {chips.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={[styles.chip, filter === c.key && styles.chipOn]}
            onPress={() => setFilter(c.key)}>
            <Ionicons name={c.icon} size={14} color={filter === c.key ? '#fff' : '#374151'} />
            <Text style={[styles.chipText, filter === c.key && styles.chipTextOn]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={data}
        keyExtractor={(p) => p.id}
        contentContainerStyle={data.length === 0 ? styles.emptyWrap : { padding: 16, paddingTop: 4 }}
        ListHeaderComponent={
          data.length > 0 ? <Text style={styles.sectionTitle}>최근 사용 순</Text> : null
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center' }}>
            <Ionicons name="folder-open-outline" size={44} color="#bbb" />
            <Text style={styles.empty}>이 종류의 프로젝트가 없어요.</Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { marginTop: 16 }]}
              onPress={() => navigation.navigate('ProjectCreate', { type: filter === 'all' ? 'dong' : filter })}>
              <Text style={styles.primaryBtnText}>새 프로젝트 만들기</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item: p }) => {
          const isCurrent = currentProject?.id === p.id;
          return (
            <TouchableOpacity
              style={[styles.card, isCurrent && styles.cardCurrent]}
              activeOpacity={0.8}
              onPress={() => open(p)}>
              <View style={styles.typeIcon}>
                <Ionicons name={typeIcon(p.type)} size={20} color="tomato" />
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                  {isCurrent && <Text style={styles.badge}>사용 중</Text>}
                </View>
                <Text style={styles.meta}>
                  {typeLabel(p.type)} · 사진 {p.count ?? 0}장 · 접두어 {p.prefix}
                </Text>
                <Text style={styles.meta}>최근 사용 {formatDateTime(p.lastUsedAt)}</Text>
              </View>
              {busyId === p.id ? (
                <ActivityIndicator />
              ) : (
                <TouchableOpacity
                  onPress={() => remove(p)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ paddingLeft: 8 }}>
                  <Ionicons name="trash-outline" size={20} color="#dc2626" />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

/* ─────────────────────────────
 * 새 프로젝트 만들기
 * ───────────────────────────── */
export function ProjectCreateScreen({ navigation, route }) {
  const { createProject, isPrefixAvailable } = usePhotos();
  const [name, setName] = useState('');
  const [type, setType] = useState(route.params?.type ?? 'dong');
  const [prefix, setPrefix] = useState('');
  const [saving, setSaving] = useState(false);
  // 사용자가 접두어를 직접 고치면 자동 추천으로 덮어쓰지 않음
  const prefixEdited = useRef(false);

  useEffect(() => {
    if (!prefixEdited.current) setPrefix(suggestPrefix(name, type, isPrefixAvailable));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, type]);

  const prefixError = !prefix
    ? '접두어를 입력해주세요.'
    : !PREFIX_RE.test(prefix)
    ? PREFIX_RULE
    : !isPrefixAvailable(prefix)
    ? '이미 다른 프로젝트가 쓰고 있는 접두어예요.'
    : null;

  const resetPrefix = () => {
    prefixEdited.current = false;
    setPrefix(suggestPrefix(name, type, isPrefixAvailable));
  };

  const create = async () => {
    if (!name.trim()) return notify('알림', '프로젝트 이름을 입력해주세요.');
    if (prefixError) return notify('알림', prefixError);
    setSaving(true);
    try {
      await createProject({ name: name.trim(), type, prefix });
      navigation.navigate('PhotoList'); // 새 프로젝트가 열린 사진 목록으로
    } catch (e) {
      notify('만들기 실패', e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const placeholder = { dong: '예) 역삼동', place: '예) 한강공원', topic: '예) 맛집 기록' }[type];

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>종류</Text>
        <View style={[styles.chipRow, { paddingHorizontal: 0, paddingTop: 0 }]}>
          {PROJECT_TYPES.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.chip, type === t.key && styles.chipOn]}
              onPress={() => setType(t.key)}>
              <Ionicons name={t.icon} size={14} color={type === t.key ? '#fff' : '#374151'} />
              <Text style={[styles.chipText, type === t.key && styles.chipTextOn]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>프로젝트 이름</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder={placeholder}
          returnKeyType="done"
        />

        <Text style={styles.label}>저장 키 접두어 (prefix)</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TextInput
            style={[styles.input, { flex: 1 }, !!prefixError && styles.inputError]}
            value={prefix}
            onChangeText={(t) => {
              prefixEdited.current = true;
              setPrefix(t.trim());
            }}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="예) dong_yeoksam"
          />
          <TouchableOpacity style={styles.secondaryBtn} onPress={resetPrefix}>
            <Ionicons name="refresh-outline" size={16} color="#2563eb" />
            <Text style={styles.secondaryText}>자동</Text>
          </TouchableOpacity>
        </View>
        {prefixError ? (
          <Text style={styles.error}>{prefixError}</Text>
        ) : (
          <View style={styles.previewBox}>
            <Text style={styles.previewText}>저장 키 : {itemsKey(prefix)}</Text>
            {!IS_WEB && <Text style={styles.previewText}>사진 폴더 : photos/{prefix}/</Text>}
          </View>
        )}
        <Text style={styles.help}>
          접두어는 이 프로젝트의 데이터를 저장하는 이름이에요. 만든 뒤에는 바꿀 수 없어요. ({PREFIX_RULE})
        </Text>

        <TouchableOpacity
          style={[styles.primaryBtn, { marginTop: 28 }, (saving || !!prefixError || !name.trim()) && styles.disabled]}
          onPress={create}
          disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>만들고 열기</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f7f9' },
  emptyWrap: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { marginTop: 8, color: '#888' },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: '#6b7280', marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
  },
  chipOn: { backgroundColor: 'tomato', borderColor: 'tomato' },
  chipText: { fontSize: 13, color: '#374151', fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#eef0f3',
  },
  cardCurrent: { borderColor: 'tomato' },
  typeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff1ee',
    justifyContent: 'center',
    alignItems: 'center',
  },
  name: { fontSize: 16, fontWeight: '700', color: '#111', flexShrink: 1 },
  badge: {
    fontSize: 11,
    color: '#fff',
    backgroundColor: 'tomato',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    overflow: 'hidden',
  },
  meta: { fontSize: 12, color: '#6b7280', marginTop: 3 },
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
  inputError: { borderColor: '#dc2626' },
  error: { marginTop: 6, fontSize: 13, color: '#dc2626' },
  previewBox: { marginTop: 6, padding: 8, borderRadius: 6, backgroundColor: '#f1f5f9' },
  previewText: { fontSize: 12, color: '#334155', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  help: { marginTop: 8, fontSize: 12, color: '#6b7280', lineHeight: 18 },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
  disabled: { opacity: 0.5 },
});