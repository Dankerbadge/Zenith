import { LinearGradient } from 'expo-linear-gradient';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ZenithScrollView from '../../components/layout/ZenithScrollView';
import { useAuth } from '../context/authcontext';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { requestPasswordReset } = useAuth();

  const handleSendReset = async () => {
    if (!email.trim()) {
      Alert.alert('Missing email', 'Enter the email tied to your Zenith account.');
      return;
    }

    try {
      setSubmitting(true);
      await requestPasswordReset(email);
      Alert.alert(
        'Check your email',
        'If this account is eligible for cloud reset, a reset link was sent. If you do not receive one, use Sign Up with the same email to repair local simulator access.'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to process password reset right now.';
      Alert.alert('Reset unavailable', message);
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
          <Text style={styles.title}>Reset Password</Text>
          <Text style={styles.subtitle}>We will send reset instructions when cloud auth is available.</Text>
        </View>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#666"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <TouchableOpacity onPress={handleSendReset} disabled={submitting}>
          <LinearGradient
            colors={['#00D9FF', '#8A2BE2']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.button, submitting && styles.disabled]}
          >
            <Text style={styles.buttonText}>{submitting ? 'Sending…' : 'Send Reset Link'}</Text>
          </LinearGradient>
        </TouchableOpacity>

        <View style={styles.helperCard}>
          <Text style={styles.helperTitle}>No reset email?</Text>
          <Text style={styles.helperBody}>
            If this is a simulator or keychain reset, tap Sign Up and use the same email to repair local password vault access.
          </Text>
        </View>

        <View style={styles.linkRow}>
          <Text style={styles.linkLabel}>Need local repair? </Text>
          <Link href={'/auth/signup' as any} asChild>
            <TouchableOpacity>
              <Text style={styles.linkText}>Sign Up</Text>
            </TouchableOpacity>
          </Link>
        </View>

        <Link href={'/auth/login' as any} asChild>
          <TouchableOpacity style={styles.backRow}>
            <Text style={styles.backText}>Back to Sign In</Text>
          </TouchableOpacity>
        </Link>
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
    marginBottom: 14,
    gap: 8,
  },
  logoGradient: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 36,
    color: '#FFF',
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
  helperCard: {
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#121212',
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  helperTitle: {
    color: '#E5F4FF',
    fontWeight: '700',
  },
  helperBody: {
    color: '#A6B4BF',
    fontSize: 12,
    lineHeight: 18,
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
  backRow: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  backText: {
    color: '#9FCFE8',
    fontWeight: '700',
  },
});
