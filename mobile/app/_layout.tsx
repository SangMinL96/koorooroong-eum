import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors, typography } from '@/lib/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
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
