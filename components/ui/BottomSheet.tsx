import React, { type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

export default function BottomSheet(props: {
  visible: boolean;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} accessible={false} />
        <SafeAreaView style={styles.safe} edges={['bottom']}>
          <View style={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom + 12) }, props.contentStyle]}>
            <View style={styles.handle} />
            {props.title ? <Text style={styles.title}>{props.title}</Text> : null}
            {props.subtitle ? <Text style={styles.subtitle}>{props.subtitle}</Text> : null}

            {props.scroll ? (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.bodyScroll}>
                {props.children}
              </ScrollView>
            ) : (
              <View style={styles.body}>{props.children}</View>
            )}

            {props.footer ? <View style={styles.footer}>{props.footer}</View> : null}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' },
  safe: { width: '100%' },
  sheet: {
    backgroundColor: '#101010',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  handle: {
    width: 46,
    height: 5,
    borderRadius: 999,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 10,
  },
  title: { color: '#FFFFFF', fontWeight: '900', fontSize: 16, textAlign: 'center' },
  subtitle: { color: '#A7A7A7', marginTop: 6, fontWeight: '700', textAlign: 'center' },
  body: { marginTop: 12 },
  bodyScroll: { paddingTop: 12, paddingBottom: 2 },
  footer: { marginTop: 12 },
});

