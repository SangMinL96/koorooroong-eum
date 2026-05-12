import { Link, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSWRConfig } from 'swr';
import { recordingsKeys, useRecordings } from '@/domain/recording/hooks/useRecordings';

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

export default function Home() {
  const { data, isLoading, mutate } = useRecordings();
  const { mutate: globalMutate } = useSWRConfig();

  useFocusEffect(
    useCallback(() => {
      globalMutate(recordingsKeys.list);
    }, [globalMutate]),
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <Link href="/upload" asChild>
          <Pressable style={styles.actionPrimary}><Text style={styles.actionPrimaryText}>업로드</Text></Pressable>
        </Link>
        <Link href="/search" asChild>
          <Pressable style={styles.actionSecondary}><Text style={styles.actionSecondaryText}>녹음 찾기</Text></Pressable>
        </Link>
      </View>

      <FlatList
        data={data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={!!isLoading} onRefresh={() => mutate()} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>아직 녹음이 없습니다</Text>
            <Text style={styles.emptySubtitle}>위 "업로드" 버튼으로 음성 파일을 추가하세요.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Link href={{ pathname: '/recordings/[id]', params: { id: item.id } }} asChild>
            <Pressable style={styles.card}>
              <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.cardMeta}>{formatDate(item.createdAt)} · 청크 {item.chunkCount}</Text>
            </Pressable>
          </Link>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', gap: 8, padding: 16 },
  actionPrimary: { flex: 1, backgroundColor: '#111', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  actionPrimaryText: { color: '#fff', fontWeight: '600' },
  actionSecondary: { flex: 1, backgroundColor: '#f1f1f3', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  actionSecondaryText: { color: '#111', fontWeight: '600' },
  listContent: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  card: { padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#eee', backgroundColor: '#fafafa' },
  cardTitle: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  cardMeta: { fontSize: 12, color: '#666' },
  empty: { alignItems: 'center', paddingVertical: 80, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptySubtitle: { fontSize: 13, color: '#666' },
});
