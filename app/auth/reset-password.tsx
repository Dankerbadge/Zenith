import { LinearGradient } from 'expo-linear-gradient';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Linking from 'expo-linking';
import { SafeAreaView } from 'react-native-safe-area-context';
import ZenithScrollView from '../../components/layout/ZenithScrollView';
import { useAuth } from '../context/authcontext';

function getParamValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function parseParamsFromUrl(url: string | null) {
  if (!url) return {} as Record<string, string>;
  const output: Record<string, string> = {};
  const [base, hash] = url.split('#');
  try {
    const query = base?.includes('?') ? base.split('?')[1] : '';
    if (query) {
      const qs = new URLSearchParams(query);
      qs.forEach((value, key) => {
        output[key] = value;
      });
    }
  } catch {}
  try {
    if (hash) {
      const hs = new URLSearchParams(hash);
      hs.forEach((value, key) => {
        output[key] = value;
      });
    }
  } catch {}
  return output;
}

export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<{
    code?: string;
    token_hash?: string;
    access_token?: string;
    refresh_token?: string;
    type?: string;
  }>();
  const liveUrl = Linking.useURL();
  const { completePasswordReset } = useAuth();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const recoveryContext = useMemo(() => {
    const parsedFromUrl = parseParamsFromUrl(liveUrl);
    const code = getParamValue(params.code) || parsedFromUrl.code || '';
    const tokenHash = getParamValue(params.token_hash) || parsedFromUrl.token_hash || '';
    const accessToken = getParamValue(params.access_token) || parsedFromUrl.access_token || '';
    const refreshToken = getParamValue(params.refresh_token) || parsedFromUrl.refresh_token || '';
    const hasRecoveryLink = Boolean(code || tokenHash || (accessToken && refreshToken));
    return {
      code,
      tokenHash,
      accessToken,
      refreshToken,
      hasRecoveryLink,
    };
  }, [liveUrl, params.access_token, params.code, params.refresh_token, params.token_hash]);

  const handleReset = async () => {
    if (!newPassword || !confirmPassword) {
      Alert.alert('Missing fields', 'Enter and confirm your new password.');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('Weak password', 'Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Mismatch', 'Passwords do not match.');
      return;
    }

    try {
      setSubmitting(true);
      await completePasswordReset({
        newPassword,
        code: recoveryContext.code || null,
        tokenHash: recoveryContext.tokenHash || null,
        accessToken: recoveryContext.accessToken || null,
        refreshToken: recoveryContext.refreshToken || null,
      });
      Alert.alert('Password updated', 'Your password has been reset. Sign in with your new password.', [
        {
          text: 'Continue',
          onPress: () => router.replace('/auth/login'),
        },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not reset password right now.';
      Alert.alert('Reset failed', message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ZenithScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      >
        <View style={styles.logoContainer}>
          <LinearGradient
            colors={['#00E5FF', '#8A2BE2', '#FF9800']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.logoGradient}
          >
            <Text style={styles.logoText}>Z</Text>
          </LinearGradient>
          <Text style={styles.title}>Set New Password</Text>
          <Text style={styles.subtitle}>
            {recoveryContext.hasRecoveryLink
              ? 'Create a new password for your Zenith account.'
              : 'Open the reset link from your email on this device, then return here.'}
          </Text>
        </View>

        <TextInput
          style={styles.input}
          placeholder="New Password"
          placeholderTextColor="#666"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
        />

        <TextInput
          style={styles.input}
          placeholder="Confirm New Password"
          placeholderTextColor="#666"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
        />

        <TouchableOpacity onPress={handleReset} disabled={submitting}>
          <LinearGradient
            colors={['#00D9FF', '#8A2BE2']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.button, submitting && styles.disabled]}
          >
            <Text style={styles.buttonText}>{submitting ? 'Updating…' : 'Update Password'}</Text>
          </LinearGradient>
        </TouchableOpacity>

        <View style={styles.linkRow}>
          <Text style={styles.linkLabel}>Need a new reset link? </Text>
          <Link href={'/auth/forgot-password' as any} asChild>
            <TouchableOpacity>
              <Text style={styles.linkText}>Request one</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ZenithScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  content: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'center',
    gap: 14,
  },
  logoContainer: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  logoGradient: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    color: '#FFF',
    fontSize: 36,
    fontWeight: '800',
  },
  title: {
    color: '#FFF',
    fontSize: 26,
    fontWeight: '800',
  },
  subtitle: {
    color: '#9EA9B8',
    textAlign: 'center',
    lineHeight: 20,
  },
  input: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  button: {
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.6,
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  linkLabel: {
    color: '#8F9CAA',
  },
  linkText: {
    color: '#00D9FF',
    fontWeight: '700',
  },
});
