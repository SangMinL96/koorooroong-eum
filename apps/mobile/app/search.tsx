import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AskResponse } from '@koorooroong-eum/shared-types';
import { askWithContexts } from '@/domain/search/api/askWithContexts';
import { embedQuery } from '@/domain/search/api/embedQuery';
import { searchTopK } from '@/domain/search/search';

const TOP_K = 5;

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<'idle' | 'embed' | 'search' | 'ask'>('idle');
  const [result, setResult] = useState<AskResponse | null>(null);
  const isWorking = stage !== 'idle';

  const submit = async () => {
    const q = query.trim();
    if (!q) return;
    setResult(null);
    try {
      setStage('embed');
      const qVec = await embedQuery(q);
      setStage('search');
      const ctxs = await searchTopK(qVec, TOP_K);
      if (ctxs.length === 0) {
        setResult({ answer: '저장된 녹음이 없습니다. 먼저 음성 파일을 업로드하세요.', sources: [] });
        return;
      }
      setStage('ask');
      const res = await askWithContexts(q, ctxs);
      setResult(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('검색 실패', msg);
    } finally {
      setStage('idle');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="질문을 입력하세요"
          editable={!isWorking}
          onSubmitEditing={submit}
          returnKeyType="search"
        />
        <Pressable onPress={submit} disabled={isWorking || !query.trim()} style={[styles.askBtn, (isWorking || !query.trim()) && styles.askBtnDisabled]}>
          <Text style={styles.askBtnText}>검색</Text>
        </Pressable>
      </View>

      {isWorking ? (
        <View style={styles.progressBlock}>
          <ActivityIndicator />
          <Text style={styles.progressText}>
            {stage === 'embed' ? '질의 임베딩 중...' : stage === 'search' ? '로컬 유사도 검색 중...' : '답변 생성 중...'}
          </Text>
        </View>
      ) : null}

      {result ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.answerLabel}>답변</Text>
          <Text style={styles.answer}>{result.answer || '(빈 답변)'}</Text>

          {result.sources.length > 0 ? (
            <>
              <Text style={styles.sourcesLabel}>출처</Text>
              {result.sources.map((s, i) => (
                <Pressable
                  key={`${s.recordingId}-${s.chunkIndex}-${i}`}
                  style={styles.sourceCard}
                  onPress={() => router.push({ pathname: '/recordings/[id]', params: { id: s.recordingId } })}
                >
                  <Text style={styles.sourceTitle}>[자료 {i + 1}] {s.recordingName}</Text>
                  <Text style={styles.sourceMeta}>chunk #{s.chunkIndex} · score {s.score.toFixed(3)}</Text>
                </Pressable>
              ))}
            </>
          ) : null}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inputRow: { flexDirection: 'row', gap: 8, padding: 16 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 },
  askBtn: { backgroundColor: '#111', paddingHorizontal: 16, justifyContent: 'center', borderRadius: 10 },
  askBtnDisabled: { opacity: 0.4 },
  askBtnText: { color: '#fff', fontWeight: '600' },
  progressBlock: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  progressText: { fontSize: 13, color: '#444' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 10 },
  answerLabel: { fontSize: 13, color: '#666', fontWeight: '600' },
  answer: { fontSize: 15, lineHeight: 22, color: '#111' },
  sourcesLabel: { marginTop: 12, fontSize: 13, color: '#666', fontWeight: '600' },
  sourceCard: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#eee', backgroundColor: '#fafafa' },
  sourceTitle: { fontSize: 14, fontWeight: '600' },
  sourceMeta: { fontSize: 12, color: '#666', marginTop: 2 },
});
