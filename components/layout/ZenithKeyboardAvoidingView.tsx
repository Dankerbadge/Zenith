import React, { useEffect } from 'react';
import { KeyboardAvoidingView, type KeyboardAvoidingViewProps } from 'react-native';
import { zenithRegisterKav, zenithUnregisterKav } from '../../utils/keyboardAvoidanceRegistry';

export default function ZenithKeyboardAvoidingView(props: KeyboardAvoidingViewProps) {
  useEffect(() => {
    zenithRegisterKav();
    return () => zenithUnregisterKav();
  }, []);

  return <KeyboardAvoidingView {...props} />;
}

