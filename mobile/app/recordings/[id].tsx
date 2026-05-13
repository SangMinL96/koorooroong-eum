import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSWRConfig } from 'swr';
import { recordingsKeys, useRecording } from '@/domain/recording/hooks/useRecordings';
import { deleteRecording, updateRecordingSummary } from '@/domain/recording/store/fileStore';
import { askWithContexts } from '@/domain/search/api/askWithContexts';
import { embedQuery } from '@/domain/search/api/embedQuery';
import { summarizeText } from '@/domain/search/api/summarize';
import { searchTopK } from '@/domain/search/search';
import type { AskResponse } from '@/lib/types';
import { colors, radius, spacing, typography } from '@/lib/theme';

const TOP_K = 5;
const TRANSCRIPT_COLLAPSED_LINES = 6;
const TRANSCRIPT_LONG_THRESHOLD = 400;

const SUMMARY_LOADING_PHRASES = [
  '제미나이에게 요약 요청 중~',
  '무한한 데이터를 탐방하는 중~',
  '회의록이 길어서 나를 고생 시키는 중~',
  '당신의 녹음을 음미하는 중~',
  'AI 두뇌 풀가동 중!',
  '핵심만 쏙쏙 뽑아내는 중~',
  '졸지 않고 잘 듣고 있어요',
  '단어 하나하나 곱씹는 중...',
  '요점을 손수 깎아내는 중~',
  '녹음 속을 산책하는 중~',
  '메모를 차곡차곡 정리하는 중~',
  '맥락을 이해하느라 잠깐만요~',
  '긴 얘기를 짧게 줄이는 마법 중~',
  '방대한 텍스트와 격투 중~',
  '키보드 두드리는 소리가 들리시나요?',
  '요약 한 줄 한 줄 짜내는 중~',
  '정성껏 다듬고 있어요~',
  '잠시만요, 거의 다 됐어요!',
  '신중하게 골라내는 중~',
  '제미나이도 가끔 한숨을 쉬어요~',
  '문장을 또박또박 다듬는 중~',
  '잡담은 빼고 알맹이만 챙기는 중~',
];

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function SummaryLoadingPlaceholder() {
  const phrases = useMemo(() => shuffle(SUMMARY_LOADING_PHRASES), []);
  const [idx, setIdx] = useState(0);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;

    // 색상 토큰을 직접 import해서 컴포넌트 안에서도 일관 색 사용
    Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: true }).start(() => {
      if (cancelled) return;
      holdTimer = setTimeout(() => {
        if (cancelled) return;
        Animated.timing(opacity, { toValue: 0, duration: 450, useNativeDriver: true }).start(() => {
          if (cancelled) return;
          setIdx((i) => (i + 1) % phrases.length);
        });
      }, 1400);
    });

    return () => {
      cancelled = true;
      if (holdTimer) clearTimeout(holdTimer);
      opacity.stopAnimation();
    };
  }, [idx, opacity, phrases.length]);

  return (
    <View style={styles.summaryLoading}>
      <ActivityIndicator size="small" color={colors.brand} />
      <Animated.Text style={[styles.summaryLoadingText, { opacity }]}>{phrases[idx]}</Animated.Text>
    </View>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

type SearchStage = 'idle' | 'embed' | 'search' | 'ask';

export default function RecordingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading } = useRecording(id);
  const { mutate } = useSWRConfig();

  const [query, setQuery] = useState('');
  const [searchStage, setSearchStage] = useState<SearchStage>('idle');
  const [searchResult, setSearchResult] = useState<AskResponse | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);

  const isSearching = searchStage !== 'idle';
  const cachedSummary = data?.summary ?? null;
  const cachedSummaryAt = data?.summaryAt ?? null;
  const cachedSummarySources = data?.summarySources ?? null;
  const transcriptIsLong = useMemo(
    () => (data?.transcript?.length ?? 0) > TRANSCRIPT_LONG_THRESHOLD,
    [data?.transcript],
  );

  const onDelete = () => {
    if (!id) return;
    Alert.alert('삭제하시겠습니까?', '되돌릴 수 없습니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          await deleteRecording(id);
          mutate(recordingsKeys.list);
          router.back();
        },
      },
    ]);
  };

  const onSearch = async () => {
    if (!data) return;
    const q = query.trim();
    if (!q) return;
    setSearchResult(null);
    try {
      setSearchStage('embed');
      const qVec = await embedQuery(q);
      setSearchStage('search');
      const ctxs = await searchTopK(qVec, TOP_K, { recordingId: data.id });
      if (ctxs.length === 0) {
        setSearchResult({ answer: '이 녹음에서 관련 내용을 찾지 못했습니다.', sources: [] });
        return;
      }
      setSearchStage('ask');
      const res = await askWithContexts(q, ctxs);
      setSearchResult(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('검색 실패', msg);
    } finally {
      setSearchStage('idle');
    }
  };

  const onSummarize = async () => {
    if (!data) return;
    const text = data.transcript?.trim();
    if (!text) {
      Alert.alert('요약 불가', '전사 텍스트가 비어 있습니다.');
      return;
    }
    setSummarizing(true);
    try {
      const res = await summarizeText(text, data.name);
      const next = await updateRecordingSummary(data.id, res.summary, res.groundingSources);
      if (next) {
        mutate(recordingsKeys.byId(data.id), next, { revalidate: false });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('요약 실패', msg);
    } finally {
      setSummarizing(false);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom', 'left', 'right']}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }
  if (!data) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom', 'left', 'right']}>
        <Text>녹음을 찾을 수 없습니다.</Text>
      </SafeAreaView>
    );
  }

  const summarizeLabel = cachedSummary ? '다시 요약하기' : 'Gemini 요약';

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{data.name}</Text>
          <Text style={styles.meta}>{formatDate(data.createdAt)} · 청크 {data.chunks.length}</Text>
        </View>
        <Pressable onPress={onDelete} style={styles.deleteBtn}>
          <Text style={styles.deleteText}>삭제</Text>
        </Pressable>
      </View>

      <View style={styles.toolbar}>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="이 녹음에서 검색"
            editable={!isSearching}
            onSubmitEditing={onSearch}
            returnKeyType="search"
          />
          <Pressable
            onPress={onSearch}
            disabled={isSearching || !query.trim()}
            style={[styles.searchBtn, (isSearching || !query.trim()) && styles.btnDisabled]}
          >
            <Text style={styles.searchBtnText}>검색</Text>
          </Pressable>
        </View>
        <View style={styles.actionRow}>
          <Pressable
            onPress={onSummarize}
            disabled={summarizing}
            style={[styles.summarizeBtn, summarizing && styles.btnDisabled]}
          >
            {summarizing ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.summarizeBtnText}>{summarizeLabel}</Text>}
          </Pressable>
          <Pressable
            onPress={() => router.push({ pathname: '/record', params: { appendTo: data.id } })}
            disabled={summarizing}
            style={[styles.appendBtn, summarizing && styles.btnDisabled]}
          >
            <Text style={styles.appendBtnText}>이어서 녹음</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {isSearching ? (
          <View style={styles.progressBlock}>
            <ActivityIndicator />
            <Text style={styles.progressText}>
              {searchStage === 'embed' ? '질의 임베딩 중...' : searchStage === 'search' ? '로컬 유사도 검색 중...' : '답변 생성 중...'}
            </Text>
          </View>
        ) : null}

        {searchResult ? (
          <View style={styles.resultBlock}>
            <Text style={styles.sectionLabel}>검색 답변</Text>
            {searchResult.answer ? (
              <Markdown style={markdownStyles}>{searchResult.answer}</Markdown>
            ) : (
              <Text style={styles.resultBody}>(빈 답변)</Text>
            )}
            {searchResult.sources.length > 0 ? (
              <View style={styles.sourceList}>
                {searchResult.sources.map((s, i) => (
                  <Text key={`${s.chunkIndex}-${i}`} style={styles.sourceLine}>
                    [자료 {i + 1}] chunk #{s.chunkIndex} · score {s.score.toFixed(3)}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {summarizing ? (
          <View style={styles.resultBlock}>
            <Text style={styles.sectionLabel}>Gemini 요약</Text>
            <SummaryLoadingPlaceholder />
          </View>
        ) : cachedSummary ? (
          <View style={styles.resultBlock}>
            <View style={styles.summaryHeader}>
              <Text style={styles.sectionLabel}>Gemini 요약</Text>
              {cachedSummaryAt ? (
                <Text style={styles.summaryMeta}>{formatDate(cachedSummaryAt)} · 캐시됨</Text>
              ) : null}
            </View>
            <Markdown style={markdownStyles}>{cachedSummary}</Markdown>
            {cachedSummarySources && cachedSummarySources.length > 0 ? (
              <View style={styles.sourcesBlock}>
                <Text style={styles.sourcesTitle}>참고 출처 (Google 검색 기반)</Text>
                {cachedSummarySources.map((s, i) => (
                  <Pressable
                    key={`${s.uri}-${i}`}
                    onPress={() => Linking.openURL(s.uri).catch(() => undefined)}
                    style={styles.sourceItem}
                  >
                    <Text style={styles.sourceItemTitle} numberOfLines={1}>
                      {i + 1}. {s.title || s.domain || s.uri}
                    </Text>
                    <Text style={styles.sourceItemUri} numberOfLines={1}>{s.uri}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.transcriptHeader}>
          <Text style={styles.sectionLabel}>전사 텍스트</Text>
          {transcriptIsLong ? (
            <Pressable onPress={() => setTranscriptExpanded((v) => !v)} hitSlop={8}>
              <Text style={styles.toggleText}>{transcriptExpanded ? '접기' : '펼치기'}</Text>
            </Pressable>
          ) : null}
        </View>
        <Text
          style={styles.transcript}
          numberOfLines={transcriptIsLong && !transcriptExpanded ? TRANSCRIPT_COLLAPSED_LINES : undefined}
        >
          {data.transcript}
        </Text>
        {transcriptIsLong ? (
          <Pressable onPress={() => setTranscriptExpanded((v) => !v)} style={styles.toggleBtn}>
            <Text style={styles.toggleBtnText}>{transcriptExpanded ? '접기' : '더 보기'}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { ...typography.h1, color: colors.text },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  deleteBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  deleteText: { color: colors.danger, ...typography.label },
  toolbar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchRow: { flexDirection: 'row', gap: spacing.sm },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: colors.text,
  },
  searchBtn: {
    backgroundColor: colors.text,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  searchBtnText: { color: colors.textInverse, ...typography.button },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  summarizeBtn: {
    flex: 1,
    backgroundColor: colors.brand,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  summarizeBtnText: { color: colors.onBrand, ...typography.button },
  appendBtn: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  appendBtnText: { color: colors.text, ...typography.button },
  btnDisabled: { opacity: 0.4 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, gap: spacing.md },
  progressBlock: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  progressText: { ...typography.bodySm, color: colors.textSecondary },
  resultBlock: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  sectionLabel: { ...typography.label, color: colors.textSecondary },
  resultBody: { ...typography.bodyLg, color: colors.text },
  sourceList: { marginTop: spacing.xs, gap: 2 },
  sourceLine: { ...typography.caption, color: colors.textSecondary },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryMeta: { fontSize: 11, color: colors.textTertiary },
  summaryLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 40,
  },
  summaryLoadingText: { flex: 1, ...typography.label, color: colors.brand },
  sourcesBlock: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  sourcesTitle: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  sourceItem: { paddingVertical: spacing.xs },
  sourceItemTitle: { ...typography.bodySm, color: colors.textLink, fontWeight: '600' },
  sourceItemUri: { fontSize: 11, color: colors.textTertiary },
  transcriptHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleText: { ...typography.bodySm, color: colors.textLink, fontWeight: '600' },
  transcript: { ...typography.bodyLg, lineHeight: 24, color: colors.text },
  toggleBtn: {
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toggleBtnText: { ...typography.bodySm, color: colors.text, fontWeight: '600' },
});

const markdownStyles = StyleSheet.create({
  body: { ...typography.bodyLg, color: colors.text },
  heading1: { fontSize: 22, fontWeight: '800', marginTop: spacing.md, marginBottom: spacing.sm, color: colors.text, letterSpacing: -0.3 },
  heading2: { fontSize: 18, fontWeight: '800', marginTop: spacing.md, marginBottom: spacing.xs, color: colors.text, letterSpacing: -0.2 },
  heading3: { fontSize: 16, fontWeight: '700', marginTop: spacing.sm, marginBottom: 2, color: colors.text },
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  bullet_list: { marginVertical: 2 },
  ordered_list: { marginVertical: 2 },
  list_item: { marginVertical: 1 },
  bullet_list_icon: { marginRight: spacing.sm, color: colors.brand },
  code_inline: { backgroundColor: colors.surfaceAlt, color: colors.text, paddingHorizontal: spacing.xs, borderRadius: radius.sm, fontSize: 13 },
  code_block: { backgroundColor: colors.bgInverse, color: colors.textInverse, padding: spacing.md, borderRadius: radius.md, fontSize: 13 },
  fence: { backgroundColor: colors.bgInverse, color: colors.textInverse, padding: spacing.md, borderRadius: radius.md, fontSize: 13 },
  blockquote: { backgroundColor: colors.brandSubtle, borderLeftWidth: 3, borderLeftColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginVertical: spacing.xs },
  link: { color: colors.textLink, textDecorationLine: 'underline' },
  hr: { backgroundColor: colors.border, height: 1, marginVertical: spacing.sm },
  paragraph: { marginTop: 2, marginBottom: spacing.sm },
});
