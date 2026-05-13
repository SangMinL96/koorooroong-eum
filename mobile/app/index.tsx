import { Link, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSWRConfig } from 'swr';
import { recordingsKeys, useRecordings } from '@/domain/recording/hooks/useRecordings';
import { useRecordingsStore } from '@/domain/recording/store/useRecordingsStore';
import { colors, radius, spacing, typography } from '@/lib/theme';

const STAGE_LABEL: Record<'stt' | 'embed' | 'saving', string> = {
  stt: '음성을 텍스트로 변환 중...',
  embed: '임베딩 생성 중...',
  saving: '저장 중...',
};

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
  const activeJob = useRecordingsStore((s) => s.activeJob);

  useFocusEffect(
    useCallback(() => {
      globalMutate(recordingsKeys.list);
    }, [globalMutate]),
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <View style={styles.header}>
        <Link href="/record" asChild>
          <Pressable style={styles.actionPrimary}><Text style={styles.actionPrimaryText}>녹음</Text></Pressable>
        </Link>
        <Link href="/upload" asChild>
          <Pressable style={styles.actionSecondary}><Text style={styles.actionSecondaryText}>업로드</Text></Pressable>
        </Link>
        <Link href="/search" asChild>
          <Pressable style={styles.actionSecondary}><Text style={styles.actionSecondaryText}>찾기</Text></Pressable>
        </Link>
      </View>

      {activeJob ? (
        <View style={styles.jobBanner}>
          <ActivityIndicator size="small" color={colors.brand} />
          <View style={{ flex: 1 }}>
            <Text style={styles.jobBannerTitle} numberOfLines={1}>
              {activeJob.appendTo ? '이어 녹음 처리 중' : `"${activeJob.name}" 처리 중`}
            </Text>
            <Text style={styles.jobBannerSubtitle}>{STAGE_LABEL[activeJob.stage]}</Text>
          </View>
        </View>
      ) : null}

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
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg },
  actionPrimary: {
    flex: 1,
    backgroundColor: colors.brand,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  actionPrimaryText: { color: colors.onBrand, ...typography.button },
  actionSecondary: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  actionSecondaryText: { color: colors.text, ...typography.button },
  jobBanner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.brandSubtle,
    borderWidth: 1,
    borderColor: colors.brand,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  jobBannerTitle: { ...typography.label, color: colors.text },
  jobBannerSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl2, gap: spacing.md },
  card: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.xs },
  cardMeta: { ...typography.caption, color: colors.textSecondary },
  empty: { alignItems: 'center', paddingVertical: 80, gap: spacing.sm },
  emptyTitle: { ...typography.h2, color: colors.text },
  emptySubtitle: { ...typography.bodySm, color: colors.textSecondary },
});
