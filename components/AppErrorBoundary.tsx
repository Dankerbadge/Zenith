import React, { ReactNode } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { captureException } from '../utils/crashReporter';

type State = {
  hasError: boolean;
  message: string;
};

export default class AppErrorBoundary extends React.Component<{ children: ReactNode }, State> {
  state: State = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'Unexpected error',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    void captureException(error, {
      feature: 'ui',
      op: 'root_error_boundary',
      componentStack: String(info?.componentStack || '').slice(0, 1200),
    });
  }

  private retry = () => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.card}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>The app hit an unexpected issue. Your saved data is still on device.</Text>
          <Text style={styles.meta}>{this.state.message}</Text>
          <Pressable onPress={this.retry} style={styles.button}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909', padding: 18, justifyContent: 'center' },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(20,20,20,0.9)',
    padding: 16,
  },
  title: { color: '#FFF', fontSize: 20, fontWeight: '900' },
  body: { color: '#CFCFCF', marginTop: 8, fontWeight: '600' },
  meta: { color: '#9E9E9E', marginTop: 8, fontSize: 12 },
  button: {
    marginTop: 14,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#00D9FF',
  },
  buttonText: { color: '#00222B', fontWeight: '900' },
});
