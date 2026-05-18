import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStartUpload } from '@/domain/recording/hooks/useStartUpload';
import { useRecordingsStore } from '@/domain/recording/store/useRecordingsStore';
import { inferAudioMime } from '@/lib/audioMime';
import { colors, radius, spacing, typography } from '@/lib/theme';

const STAGE_LABEL: Record<'idle' | 'stt' | 'embed' | 'saving', string> = {
  idle: '',
  stt: '음성을 텍스트로 변환 중...',
  embed: '임베딩 생성 중...',
  saving: '저장 중...',
};

export default function UploadScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    sharedUri?: string;
    sharedName?: string;
    sharedMime?: string;
  }>();
  const [name, setName] = useState('');
  const [asset, setAsset] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [textContent, setTextContent] = useState('');
  const activeJob = useRecordingsStore((s) => s.activeJob);
  const startUpload = useStartUpload();
  const isWorking = activeJob !== null;
  const isSharedMode = typeof params.sharedUri === 'string' && params.sharedUri.length > 0;
  // 음성/텍스트 상호 배타: 한쪽이 채워지면 다른 쪽 입력은 잠금.
  const hasText = textContent.trim().length > 0;
  const hasAsset = asset !== null;
  const audioDisabled = isWorking || hasText;
  const textDisabled = isWorking || hasAsset;

  // 외부 앱에서 "공유"로 들어온 경우 파일을 자동으로 picker 결과처럼 세팅.
  // DocumentPickerAsset 의 필수 필드만 채워 cast — 후속 흐름(uploadAudio)은 uri/name/mimeType 만 사용.
  useEffect(() => {
    if (!isSharedMode || asset) return;
    const fallbackName = params.sharedName?.trim() || 'recording.m4a';
    setAsset({
      uri: params.sharedUri as string,
      name: fallbackName,
      mimeType: params.sharedMime ?? inferAudioMime(fallbackName),
      size: undefined,
    } as DocumentPicker.DocumentPickerAsset);
    if (!name.trim()) {
      setName(fallbackName.replace(/\.[^.]+$/, ''));
    }
  }, [isSharedMode, params.sharedUri, params.sharedName, params.sharedMime, asset, name]);

  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      // iOS 는 public.audio UTI, Android 는 audio/* 와일드카드로 모든 오디오 허용.
      // 서버에서 ffmpeg 디코딩 가능한 포맷은 모두 지원 (m4a/mp3/wav/aac/flac/ogg/opus/webm/3gp/amr/aiff 등).
      type: ['public.audio', 'audio/*'],
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;
    const picked = res.assets?.[0];
    if (picked) {
      setAsset(picked);
      if (!name.trim() && picked.name) {
        setName(picked.name.replace(/\.[^.]+$/, ''));
      }
    }
  };

  const submit = () => {
    if (hasAsset && hasText) {
      // UI 가 막아주지만 방어적으로.
      Alert.alert('음성 파일과 텍스트는 동시에 추가할 수 없습니다.');
      return;
    }
    if (hasText) {
      const jobName = name.trim() || '텍스트 메모';
      startUpload({ mode: 'new-text', name: jobName, text: textContent });
      router.replace('/');
      return;
    }
    if (!asset) {
      Alert.alert('파일을 선택하거나 텍스트를 입력해주세요.');
      return;
    }
    const jobName = name.trim() || asset.name || 'untitled';

    startUpload({
      mode: 'new',
      name: jobName,
      asset: { uri: asset.uri, name: asset.name ?? null, mimeType: asset.mimeType ?? null },
    });

    // 사용자는 즉시 홈으로 복귀 — 진행 상황은 홈 배너에 표시.
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <View style={styles.body}>
        {isSharedMode ? (
          <View style={styles.sharedBanner}>
            <Text style={styles.sharedBannerTitle}>외부 앱에서 파일을 받았습니다</Text>
            <Text style={styles.sharedBannerSubtitle}>이름만 확인하고 업로드를 누르세요.</Text>
          </View>
        ) : null}

        <Text style={styles.label}>녹음 이름</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          editable={!isWorking}
          placeholder="예: 회의 - 컨셉 리뷰"
          style={styles.input}
        />

        <Text style={styles.label}>음성 파일</Text>
        <View style={styles.pickerRow}>
          <Pressable
            onPress={pick}
            disabled={audioDisabled}
            style={[styles.pickerBtn, audioDisabled && styles.pickerBtnDisabled, { flex: 1 }]}
          >
            <Text style={[styles.pickerBtnText, audioDisabled && styles.pickerBtnTextDisabled]}>
              {asset ? asset.name ?? '선택됨' : '파일 선택'}
            </Text>
          </Pressable>
          {asset ? (
            <Pressable
              onPress={() => setAsset(null)}
              disabled={isWorking}
              style={styles.clearBtn}
            >
              <Text style={styles.clearBtnText}>제거</Text>
            </Pressable>
          ) : null}
        </View>
        {asset?.size ? <Text style={styles.meta}>{(asset.size / (1024 * 1024)).toFixed(1)} MB</Text> : null}

        <Text style={styles.label}>또는 텍스트로 추가</Text>
        <TextInput
          value={textContent}
          onChangeText={setTextContent}
          editable={!textDisabled}
          placeholder={hasAsset ? '음성 파일을 제거한 뒤 입력하세요.' : '회의록 / 메모 텍스트를 붙여넣으세요.'}
          multiline
          textAlignVertical="top"
          style={[styles.textArea, textDisabled && styles.textAreaDisabled]}
        />
        {hasText ? <Text style={styles.meta}>{textContent.trim().length}자</Text> : null}

        {isWorking ? (
          <View style={styles.progressBlock}>
            <ActivityIndicator />
            <Text style={styles.progressText}>{activeJob ? STAGE_LABEL[activeJob.stage] : ''}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        <Pressable
          onPress={submit}
          disabled={(!hasAsset && !hasText) || isWorking}
          style={[styles.submit, ((!hasAsset && !hasText) || isWorking) && styles.submitDisabled]}
        >
          <Text style={styles.submitText}>{isWorking ? '업로드 중...' : '업로드'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: spacing.sm },
  sharedBanner: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandSubtle,
    borderWidth: 1,
    borderColor: colors.brand,
    gap: spacing.xs,
  },
  sharedBannerTitle: { ...typography.label, color: colors.brand },
  sharedBannerSubtitle: { ...typography.caption, color: colors.textSecondary },
  label: { ...typography.label, color: colors.text, marginTop: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...typography.bodyLg,
    color: colors.text,
  },
  pickerRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  pickerBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  pickerBtnDisabled: { opacity: 0.4 },
  pickerBtnText: { ...typography.body, color: colors.text },
  pickerBtnTextDisabled: { color: colors.textSecondary },
  clearBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  clearBtnText: { ...typography.body, color: colors.textSecondary },
  textArea: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...typography.body,
    color: colors.text,
    minHeight: 140,
  },
  textAreaDisabled: { opacity: 0.4 },
  meta: { ...typography.caption, color: colors.textSecondary },
  progressBlock: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  progressText: { ...typography.bodySm, color: colors.textSecondary },
  footer: { padding: spacing.lg },
  submit: {
    backgroundColor: colors.brand,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: colors.onBrand, ...typography.button },
});
