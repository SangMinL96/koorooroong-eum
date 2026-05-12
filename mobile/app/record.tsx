import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, AppState, type AppStateStatus, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSWRConfig } from 'swr';
import { appendAudio, uploadAudio } from '@/domain/recording/api/uploadAudio';
import { recordingsKeys } from '@/domain/recording/hooks/useRecordings';
import { useRecordingsStore } from '@/domain/recording/store/useRecordingsStore';
import { colors, radius, spacing, typography } from '@/lib/theme';

const STAGE_LABEL: Record<'idle' | 'stt' | 'embed' | 'saving', string> = {
  idle: '',
  stt: '음성을 텍스트로 변환 중...',
  embed: '임베딩 생성 중...',
  saving: '저장 중...',
};

type Phase = 'idle' | 'recording' | 'recorded';

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function defaultRecordingName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `녹음 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RecordScreen() {
  const router = useRouter();
  const { appendTo } = useLocalSearchParams<{ appendTo?: string }>();
  const isAppendMode = typeof appendTo === 'string' && appendTo.length > 0;
  const { mutate: globalMutate } = useSWRConfig();
  const stage = useRecordingsStore((s) => s.uploadStage);
  const setStage = useRecordingsStore((s) => s.setUploadStage);
  const isUploading = stage !== 'idle';

  const [permission, setPermission] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordedSize, setRecordedSize] = useState<number | null>(null);
  const [name, setName] = useState('');

  const recordingRef = useRef<Audio.Recording | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 백그라운드 진입 시점 기록 — 복귀했을 때 경과 시간을 보정한다.
  const lastBackgroundedAtRef = useRef<number | null>(null);

  // 저장 버튼 흔들기 + 안내 말풍선 애니메이션
  const shakeX = useRef(new Animated.Value(0)).current;
  const hintOpacity = useRef(new Animated.Value(0)).current;
  const [hintVisible, setHintVisible] = useState(false);

  const triggerNoRecordingHint = () => {
    // 좌우로 통통 흔들기 — 너무 격하지 않게 진폭 8
    Animated.sequence([
      Animated.timing(shakeX, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 8, duration: 80, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -6, duration: 80, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 6, duration: 80, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
    // 위에 안내 말풍선 — fade in → 잠시 보임 → fade out
    setHintVisible(true);
    Animated.sequence([
      Animated.timing(hintOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(1400),
      Animated.timing(hintOpacity, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) setHintVisible(false);
    });
  };

  useEffect(() => {
    (async () => {
      const { status } = await Audio.requestPermissionsAsync();
      setPermission(status === 'granted');
    })();
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      // 언마운트 시 진행 중인 녹음 중단/해제
      recordingRef.current?.stopAndUnloadAsync().catch(() => undefined);
      // 안전을 위해 keep-awake 해제
      deactivateKeepAwake().catch(() => undefined);
    };
  }, []);

  // 백그라운드/포그라운드 전환 모니터링.
  // - JS 타이머는 백그라운드에서 멈추므로, foreground 복귀 시 경과 시간을 보정해서 UI를 다시 맞춘다.
  // - 실제 녹음은 OS 레벨에서 계속 진행됨 (iOS UIBackgroundModes=audio / Android keep-awake + 권한).
  useEffect(() => {
    const handler = (state: AppStateStatus) => {
      const isRecording = recordingRef.current !== null;
      if (!isRecording) return;
      if (state === 'background' || state === 'inactive') {
        lastBackgroundedAtRef.current = Date.now();
      } else if (state === 'active' && lastBackgroundedAtRef.current !== null) {
        // 백그라운드에 있던 동안 멈춰 있던 JS 타이머의 누락 초를 한 번에 보정
        const drift = Math.floor((Date.now() - lastBackgroundedAtRef.current) / 1000);
        if (drift > 0) setElapsed((e) => e + drift);
        lastBackgroundedAtRef.current = null;
      }
    };
    const sub = AppState.addEventListener('change', handler);
    return () => sub.remove();
  }, []);

  const startRecording = async () => {
    if (permission === false) {
      Alert.alert('마이크 권한 필요', '설정 > 앱 권한에서 마이크 접근을 허용해주세요.');
      return;
    }
    try {
      // 백그라운드 녹음 지원 설정
      //  - iOS: staysActiveInBackground + UIBackgroundModes=["audio"] (app.json) 조합으로 화면 잠금/홈 이동 시에도 녹음 유지
      //  - Android: 화면 잠금 후에도 OS가 앱을 죽이지 않도록 keep-awake로 wake lock 활성화
      //    (완전히 안정적 백그라운드 녹음은 별도 foreground service 가 필요 — 현재 권한만 선언해 둠)
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      });
      await activateKeepAwakeAsync('recording');
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      recordingRef.current = rec;
      setRecordedUri(null);
      setRecordedSize(null);
      setElapsed(0);
      setPhase('recording');
      tickRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch (err) {
      // 실패 시 keep-awake 정리
      deactivateKeepAwake().catch(() => undefined);
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('녹음 시작 실패', msg);
    }
  };

  const stopRecording = async () => {
    const rec = recordingRef.current;
    if (!rec) return;
    try {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
      });
      deactivateKeepAwake().catch(() => undefined);
      const uri = rec.getURI();
      recordingRef.current = null;
      lastBackgroundedAtRef.current = null;
      if (!uri) {
        Alert.alert('녹음 실패', '저장된 파일 경로를 찾지 못했습니다.');
        setPhase('idle');
        return;
      }
      const info = await FileSystem.getInfoAsync(uri);
      setRecordedUri(uri);
      setRecordedSize(info.exists && !info.isDirectory ? info.size ?? null : null);
      setPhase('recorded');
      if (!name.trim()) setName(defaultRecordingName());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('녹음 종료 실패', msg);
      setPhase('idle');
    }
  };

  const discardAndRetry = async () => {
    if (recordedUri) {
      // 임시 파일 정리 (조용히 실패 허용)
      FileSystem.deleteAsync(recordedUri, { idempotent: true }).catch(() => undefined);
    }
    setRecordedUri(null);
    setRecordedSize(null);
    setElapsed(0);
    setPhase('idle');
  };

  const submit = async () => {
    if (!recordedUri) return;
    try {
      if (isAppendMode && appendTo) {
        await appendAudio(
          appendTo,
          { uri: recordedUri, name: 'recording.m4a', mimeType: 'audio/m4a' },
          (s) => setStage(s),
        );
        globalMutate(recordingsKeys.list);
        globalMutate(recordingsKeys.byId(appendTo));
        router.replace({ pathname: '/recordings/[id]', params: { id: appendTo } });
      } else {
        await uploadAudio(
          {
            name: name.trim() || defaultRecordingName(),
            asset: { uri: recordedUri, name: 'recording.m4a', mimeType: 'audio/m4a' },
          },
          (s) => setStage(s),
        );
        globalMutate(recordingsKeys.list);
        router.replace('/');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert(isAppendMode ? '이어 녹음 저장 실패' : '업로드 실패', msg);
    } finally {
      setStage('idle');
    }
  };

  const isRecording = phase === 'recording';
  const isRecorded = phase === 'recorded';
  const canSubmit = isRecorded && recordedUri !== null && elapsed > 0;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.body}>
        {isAppendMode ? (
          <View style={styles.appendBanner}>
            <Text style={styles.appendBannerTitle}>이어서 녹음 모드</Text>
            <Text style={styles.appendBannerSubtitle}>
              이 녹음의 기존 텍스트 뒤에 새 녹음이 자동으로 이어붙습니다. 저장된 요약은 다시 생성해야 합니다.
            </Text>
          </View>
        ) : null}

        {permission === false ? (
          <View style={styles.permBlock}>
            <Text style={styles.permTitle}>마이크 권한이 거부되어 있습니다.</Text>
            <Text style={styles.permSubtitle}>설정에서 권한을 허용한 뒤 다시 진입해주세요.</Text>
          </View>
        ) : null}

        <View style={styles.recorderArea}>
          <Text style={styles.timer}>{formatElapsed(elapsed)}</Text>

          <Pressable
            onPress={isRecording ? stopRecording : startRecording}
            disabled={isUploading || permission === false}
            style={[
              styles.recordBtn,
              isRecording && styles.recordBtnActive,
              (isUploading || permission === false) && styles.recordBtnDisabled,
            ]}
          >
            <View style={[styles.recordIcon, isRecording && styles.recordIconStop]} />
          </Pressable>
          <Text style={styles.recordHint}>
            {isRecording ? '탭하여 정지' : isRecorded ? '녹음 완료' : '탭하여 시작'}
          </Text>
        </View>

        {isRecorded ? (
          <View style={styles.recordedInfo}>
            {!isAppendMode ? (
              <>
                <Text style={styles.label}>녹음 이름</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  editable={!isUploading}
                  placeholder="예: 회의 - 컨셉 리뷰"
                  style={styles.input}
                />
              </>
            ) : null}
            <View style={styles.metaRow}>
              <Text style={styles.meta}>길이 {formatElapsed(elapsed)}</Text>
              {recordedSize ? (
                <Text style={styles.meta}>{(recordedSize / (1024 * 1024)).toFixed(2)} MB</Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {isUploading ? (
          <View style={styles.progressBlock}>
            <ActivityIndicator />
            <Text style={styles.progressText}>{STAGE_LABEL[stage]}</Text>
          </View>
        ) : null}
      </View>

      {/* 녹음 중에는 footer 숨김 (먼저 정지해야 함). idle/recorded 에서는 항상 표시. */}
      {!isRecording ? (
        <View style={styles.footer}>
          {hintVisible ? (
            <Animated.View style={[styles.hintBubble, { opacity: hintOpacity }]} pointerEvents="none">
              <Text style={styles.hintText}>먼저 녹음을 시작해주세요</Text>
              <View style={styles.hintTail} />
            </Animated.View>
          ) : null}

          <View style={styles.footerRow}>
            {isRecorded ? (
              <Pressable
                onPress={discardAndRetry}
                disabled={isUploading}
                style={[styles.secondary, isUploading && styles.btnDisabled]}
              >
                <Text style={styles.secondaryText}>다시 녹음</Text>
              </Pressable>
            ) : null}
            <Animated.View style={[styles.submitWrap, { transform: [{ translateX: shakeX }] }]}>
              <Pressable
                onPress={() => {
                  if (isUploading) return;
                  if (canSubmit) {
                    submit();
                  } else {
                    triggerNoRecordingHint();
                  }
                }}
                style={[styles.submit, !canSubmit && styles.submitInactive, isUploading && styles.btnDisabled]}
              >
                <Text style={[styles.submitText, !canSubmit && styles.submitTextInactive]}>
                  {isUploading ? '저장 중...' : isAppendMode ? '기존 녹음에 이어붙이기' : '업로드'}
                </Text>
              </Pressable>
            </Animated.View>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, padding: spacing.lg, gap: spacing.lg },
  appendBanner: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandSubtle,
    borderWidth: 1,
    borderColor: colors.brand,
    gap: spacing.xs,
  },
  appendBannerTitle: { ...typography.label, color: colors.brand },
  appendBannerSubtitle: { ...typography.caption, color: colors.textSecondary },
  permBlock: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  permTitle: { ...typography.label, color: colors.danger },
  permSubtitle: { ...typography.caption, color: colors.textSecondary },
  recorderArea: { alignItems: 'center', gap: spacing.xl, paddingVertical: spacing.xl3 },
  timer: { ...typography.displayXL, fontVariant: ['tabular-nums'], color: colors.text },
  recordBtn: {
    width: 128,
    height: 128,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    borderWidth: 4,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordBtnActive: { backgroundColor: colors.surfaceAlt },
  recordBtnDisabled: { opacity: 0.4 },
  recordIcon: { width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.danger },
  recordIconStop: { width: 36, height: 36, borderRadius: radius.sm },
  recordHint: { ...typography.bodySm, color: colors.textSecondary },
  recordedInfo: { gap: spacing.sm },
  label: { ...typography.label, color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...typography.bodyLg,
    color: colors.text,
  },
  metaRow: { flexDirection: 'row', gap: spacing.md },
  meta: { ...typography.caption, color: colors.textSecondary },
  progressBlock: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  progressText: { ...typography.bodySm, color: colors.textSecondary },
  footer: { padding: spacing.lg },
  footerRow: { flexDirection: 'row', gap: spacing.md },
  secondary: {
    flex: 1,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  secondaryText: { ...typography.button, color: colors.text },
  submitWrap: { flex: 1 },
  submit: {
    backgroundColor: colors.brand,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  submitInactive: { backgroundColor: colors.surfaceAlt },
  submitText: { color: colors.onBrand, ...typography.button },
  submitTextInactive: { color: colors.textTertiary },
  btnDisabled: { opacity: 0.4 },
  hintBubble: {
    position: 'absolute',
    bottom: 72,
    alignSelf: 'center',
    backgroundColor: colors.bgInverse,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  hintText: { color: colors.textInverse, ...typography.label },
  hintTail: {
    position: 'absolute',
    bottom: -5,
    alignSelf: 'center',
    width: 10,
    height: 10,
    backgroundColor: colors.bgInverse,
    transform: [{ rotate: '45deg' }],
  },
});
