import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { embedQuery } from '@/domain/search/api/embedQuery';
import { searchRecordings, type RecordingHit, type Relevance } from '@/domain/search/search';
import { colors, radius, spacing, typography } from '@/lib/theme';

const TOP_N = 10;

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

const RELEVANCE_LABEL: Record<Relevance, string> = {
  high: '관련도 높음',
  medium: '관련도 보통',
  low: '관련도 낮음',
};

const RELEVANCE_COLOR: Record<Relevance, string> = {
  high: colors.success,
  medium: colors.brand,
  low: colors.textTertiary,
};

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<'idle' | 'embed' | 'search'>('idle');
  const [results, setResults] = useState<RecordingHit[] | null>(null);
  const isWorking = stage !== 'idle';

  const submit = async () => {
    const q = query.trim();
    if (!q) return;
    setResults(null);
    try {
      setStage('embed');
      const qVec = await embedQuery(q);
      setStage('search');
      const hits = await searchRecordings(qVec, { topN: TOP_N, query: q });
      setResults(hits);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('찾기 실패', msg);
    } finally {
      setStage('idle');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="예: 폐수처리에 대해 이야기된 내용"
          editable={!isWorking}
          onSubmitEditing={submit}
          returnKeyType="search"
        />
        <Pressable
          onPress={submit}
          disabled={isWorking || !query.trim()}
          style={[styles.btn, (isWorking || !query.trim()) && styles.btnDisabled]}
        >
          <Text style={styles.btnText}>찾기</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>내용을 분석해 유사한 녹음을 점수순으로 보여줍니다. 카드를 누르면 해당 녹음 상세로 이동합니다.</Text>

      {isWorking ? (
        <View style={styles.progressBlock}>
          <ActivityIndicator />
          <Text style={styles.progressText}>
            {stage === 'embed' ? '질의 임베딩 중...' : '유사 녹음 검색 중...'}
          </Text>
        </View>
      ) : null}

      {results ? (
        results.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>관련된 녹음을 찾지 못했습니다</Text>
            <Text style={styles.emptySubtitle}>저장된 녹음이 없거나, 내용이 일치하지 않습니다.</Text>
          </View>
        ) : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {results.map((hit, i) => (
              <Pressable
                key={hit.recordingId}
                style={styles.card}
                onPress={() => router.push({ pathname: '/recordings/[id]', params: { id: hit.recordingId } })}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{i + 1}. {hit.recordingName}</Text>
                  <View style={[styles.relevanceChip, { borderColor: RELEVANCE_COLOR[hit.relevance] }]}>
                    <Text style={[styles.relevanceText, { color: RELEVANCE_COLOR[hit.relevance] }]}>
                      {RELEVANCE_LABEL[hit.relevance]}
                    </Text>
                  </View>
                </View>
                <Text style={styles.cardSnippet} numberOfLines={3}>{hit.topChunkText}</Text>
                <Text style={styles.cardMeta}>
                  {formatDate(hit.createdAt)} · 관련 청크 {hit.matchedChunkCount}개 · 최고 청크 #{hit.topChunkIndex}
                  {hit.keywordMatched ? ' · 키워드 포함' : ''}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inputRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...typography.bodyLg,
    color: colors.text,
  },
  btn: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: colors.onBrand, ...typography.button },
  hint: { ...typography.caption, color: colors.textSecondary, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  progressBlock: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  progressText: { ...typography.bodySm, color: colors.textSecondary },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, gap: spacing.md },
  card: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { flex: 1, ...typography.h3, color: colors.text },
  relevanceChip: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1 },
  relevanceText: { fontSize: 11, fontWeight: '700' },
  cardSnippet: { ...typography.bodySm, color: colors.text },
  cardMeta: { ...typography.caption, color: colors.textTertiary },
  empty: { alignItems: 'center', paddingVertical: 60, gap: spacing.sm },
  emptyTitle: { ...typography.h2, color: colors.text },
  emptySubtitle: { ...typography.bodySm, color: colors.textSecondary },
});
