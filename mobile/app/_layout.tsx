import { Stack, useRouter } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useRecordingsStore } from '@/domain/recording/store/useRecordingsStore';
import { inferAudioMime } from '@/lib/audioMime';
import { colors, typography } from '@/lib/theme';

/**
 * JS context 첫 진입(콜드런치 / dev reload) 시 1회만 실행.
 * - 이전 세션에서 진행 중이던 activeJob 이 디스크에만 남아 있으면 → JS 가 죽었던 것
 *   → store.hydrate() 가 failedJob 으로 승급시켜 홈 배너로 노출.
 * - 백그라운드 → 포그라운드 복귀로는 _layout 이 re-mount 되지 않으므로 hydrate 호출되지 않음(의도).
 */
function StoreHydrator() {
  useEffect(() => {
    void useRecordingsStore.getState().hydrate();
  }, []);
  return null;
}

/**
 * 외부 앱(통화 녹음, 음성 녹음 등)에서 "공유"로 보낸 오디오 파일을 받아 업로드 화면으로 진입.
 * - Android: AndroidManifest 의 intent-filter (expo-share-intent plugin 이 자동 생성)
 * - iOS: Share Extension (동일 plugin 자동 생성)
 */
function ShareIntentHandler() {
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();

  useEffect(() => {
    if (!hasShareIntent) return;
    const file = shareIntent.files?.[0];
    if (!file?.path) {
      resetShareIntent();
      return;
    }
    router.push({
      pathname: '/upload',
      params: {
        sharedUri: file.path,
        sharedName: file.fileName ?? '',
        sharedMime: file.mimeType ?? inferAudioMime(file.fileName),
      },
    });
    resetShareIntent();
  }, [hasShareIntent, shareIntent, router, resetShareIntent]);

  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreHydrator />
      <ShareIntentHandler />
      {/* status bar: 흰 배경 + 검은 텍스트(아이콘). Android는 backgroundColor/translucent 필요. */}
      <StatusBar style="dark" backgroundColor={colors.bg} translucent={false} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: typography.h3.fontWeight, fontSize: typography.h3.fontSize },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: '꾸루룽음' }} />
        <Stack.Screen name="record" options={{ title: '녹음하기' }} />
        <Stack.Screen name="upload" options={{ title: '업로드' }} />
        <Stack.Screen name="search" options={{ title: '녹음 찾기' }} />
        <Stack.Screen name="recordings/[id]" options={{ title: '녹음' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
