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
      <ActivityIndicator size="small" color="#3367d6" />
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
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }
  if (!data) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Text>녹음을 찾을 수 없습니다.</Text>
      </SafeAreaView>
    );
  }

  const summarizeLabel = cachedSummary ? '다시 요약하기' : 'Gemini 요약';

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
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
        <Pressable
          onPress={onSummarize}
          disabled={summarizing}
          style={[styles.summarizeBtn, summarizing && styles.btnDisabled]}
        >
          {summarizing ? <ActivityIndicator color="#fff" /> : <Text style={styles.summarizeBtnText}>{summarizeLabel}</Text>}
        </Pressable>
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
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  title: { fontSize: 18, fontWeight: '700' },
  meta: { fontSize: 12, color: '#666', marginTop: 2 },
  deleteBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#e53935' },
  deleteText: { color: '#e53935', fontWeight: '600' },
  toolbar: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 8, borderBottomWidth: 1, borderBottomColor: '#f1f1f3' },
  searchRow: { flexDirection: 'row', gap: 8 },
  searchInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15 },
  searchBtn: { backgroundColor: '#111', paddingHorizontal: 16, justifyContent: 'center', borderRadius: 10 },
  searchBtnText: { color: '#fff', fontWeight: '600' },
  summarizeBtn: { backgroundColor: '#3367d6', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  summarizeBtnText: { color: '#fff', fontWeight: '600' },
  btnDisabled: { opacity: 0.4 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 12 },
  progressBlock: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressText: { fontSize: 13, color: '#444' },
  resultBlock: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e6e8ef', backgroundColor: '#f7f9ff', gap: 6 },
  sectionLabel: { fontSize: 13, color: '#666', fontWeight: '600' },
  resultBody: { fontSize: 15, lineHeight: 22, color: '#111' },
  sourceList: { marginTop: 4, gap: 2 },
  sourceLine: { fontSize: 12, color: '#666' },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryMeta: { fontSize: 11, color: '#888' },
  summaryLoading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, minHeight: 40 },
  summaryLoadingText: { flex: 1, fontSize: 14, color: '#3367d6', fontWeight: '600' },
  sourcesBlock: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#e6e8ef', gap: 6 },
  sourcesTitle: { fontSize: 12, fontWeight: '700', color: '#555' },
  sourceItem: { paddingVertical: 4 },
  sourceItemTitle: { fontSize: 13, color: '#3367d6', fontWeight: '600' },
  sourceItemUri: { fontSize: 11, color: '#888' },
  transcriptHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleText: { fontSize: 13, color: '#3367d6', fontWeight: '600' },
  transcript: { fontSize: 15, lineHeight: 24, color: '#111' },
  toggleBtn: { alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#ddd' },
  toggleBtnText: { fontSize: 13, color: '#333', fontWeight: '600' },
});

const markdownStyles = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 22, color: '#111' },
  heading1: { fontSize: 19, fontWeight: '700', marginTop: 8, marginBottom: 6, color: '#111' },
  heading2: { fontSize: 17, fontWeight: '700', marginTop: 10, marginBottom: 4, color: '#111' },
  heading3: { fontSize: 15, fontWeight: '700', marginTop: 8, marginBottom: 2, color: '#222' },
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  bullet_list: { marginVertical: 2 },
  ordered_list: { marginVertical: 2 },
  list_item: { marginVertical: 1 },
  bullet_list_icon: { marginRight: 6, color: '#3367d6' },
  code_inline: { backgroundColor: '#eef1f7', color: '#1f3a8a', paddingHorizontal: 4, borderRadius: 4, fontSize: 13 },
  code_block: { backgroundColor: '#0f172a', color: '#e2e8f0', padding: 10, borderRadius: 8, fontSize: 13 },
  fence: { backgroundColor: '#0f172a', color: '#e2e8f0', padding: 10, borderRadius: 8, fontSize: 13 },
  blockquote: { backgroundColor: '#eef2ff', borderLeftWidth: 3, borderLeftColor: '#3367d6', paddingHorizontal: 10, paddingVertical: 6, marginVertical: 4 },
  link: { color: '#3367d6', textDecorationLine: 'underline' },
  hr: { backgroundColor: '#e6e8ef', height: 1, marginVertical: 8 },
  paragraph: { marginTop: 2, marginBottom: 6 },
});
