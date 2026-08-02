import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (msg: string) => {
    setMessage(msg);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setMessage(null), 2200);
  };

  return (
    <ToastContext.Provider value={show}>
      {children}
      {message ? (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.text}>{message}</Text>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function confirmAsync(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(
      typeof window !== 'undefined' ? window.confirm(message) : true
    );
  }
  return new Promise((resolve) => {
    const { Alert } = require('react-native');
    Alert.alert(title, message, [
      { text: '取消', style: 'cancel', onPress: () => resolve(false) },
      { text: '确定', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    zIndex: 1000,
    maxWidth: '80%',
  },
  text: { color: '#FFFFFF', fontSize: 14 },
});
