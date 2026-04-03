import { LinearGradient } from 'expo-linear-gradient';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import ZenithScrollView from '../../components/layout/ZenithScrollView';
import { useAuth } from '../context/authcontext';

export default function SignupScreen() {
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newsletterOptIn, setNewsletterOptIn] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { signup } = useAuth();

  const handleSignup = async () => {
    if (!firstName || !email || !password || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    if (password.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters');
      return;
    }

    try {
      setIsSubmitting(true);
      await signup(firstName, email, password, { marketingOptIn: newsletterOptIn });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Signup failed. Please try again.';
      Alert.alert('Error', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <ZenithScrollView
        contentContainerStyle={styles.scrollContent}
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
          <Text style={styles.zenithTitle}>ZENITH</Text>
        </View>

        <Text style={styles.welcomeText}>Create Account</Text>
        <Text style={styles.subtitleText}>Start your journey to greatness</Text>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="First Name"
            placeholderTextColor="#666"
            value={firstName}
            onChangeText={setFirstName}
            textContentType="givenName"
            autoComplete="name-given"
          />
        </View>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#666"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
          />
        </View>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#666"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="newPassword"
            autoComplete="new-password"
          />
        </View>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Confirm Password"
            placeholderTextColor="#666"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            textContentType="newPassword"
            autoComplete="new-password"
          />
        </View>

        <TouchableOpacity style={styles.newsletterContainer} onPress={() => setNewsletterOptIn(!newsletterOptIn)} disabled={isSubmitting}>
          <View style={styles.checkbox}>
            {newsletterOptIn && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <View style={styles.newsletterCopyWrap}>
            <Text style={styles.newsletterTitle}>Stay up to date</Text>
            <Text style={styles.newsletterCopy}>Product updates and rollout notes by email.</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleSignup} disabled={isSubmitting}>
          <LinearGradient
            colors={isSubmitting ? ['#5A6A7A', '#606A78'] : ['#00D9FF', '#8A2BE2']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.signupButton}
          >
            <Text style={styles.signupButtonText}>{isSubmitting ? 'Creating…' : 'Create Account'}</Text>
          </LinearGradient>
        </TouchableOpacity>

        <Text style={styles.termsText}>
          By signing up, you agree to our{' '}
          <Text style={styles.termsLink}>Terms & Privacy Policy</Text>
        </Text>

        <View style={styles.loginContainer}>
          <Text style={styles.loginText}>Already have an account? </Text>
          <Link href={'/auth/login' as any} asChild>
            <TouchableOpacity>
              <Text style={styles.loginLink}>Sign In</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ZenithScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  scrollContent: {
    padding: 24,
    paddingTop: 60,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoGradient: {
    width: 70,
    height: 70,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  logoText: {
    fontSize: 45,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  zenithTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 6,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  subtitleText: {
    fontSize: 16,
    color: '#888',
    marginBottom: 24,
  },
  inputContainer: {
    marginBottom: 14,
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
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  checkmark: {
    color: '#00D9FF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  signupButton: {
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  newsletterContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 4,
    marginBottom: 14,
  },
  newsletterCopyWrap: {
    flex: 1,
    gap: 2,
  },
  newsletterTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  newsletterCopy: {
    color: '#9AA4B2',
    fontSize: 12,
    lineHeight: 16,
  },
  signupButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  termsText: {
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
  },
  termsLink: {
    color: '#00D9FF',
  },
  loginContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
    marginBottom: 24,
  },
  loginText: {
    color: '#888',
    fontSize: 14,
  },
  loginLink: {
    color: '#00D9FF',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
