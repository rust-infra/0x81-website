import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import { setUnauthorizedHandler, telegramLogin, TOKEN_KEY } from './api';
import { getTelegramInitData } from './telegram';
import type { User } from './types';

const USER_KEY = 'rehearse_user';

interface AuthContextValue {
  token: string | null;
  user: User | null;
  ready: boolean;
  signIn: (token: string, user: User) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  token: null,
  user: null,
  ready: false,
  signIn: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [storedToken, storedUser] = await Promise.all([
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(USER_KEY),
        ]);
        setToken(storedToken);
        setUser(storedUser ? JSON.parse(storedUser) : null);
      } catch {
        // ignore
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const signIn = useCallback(async (nextToken: string, nextUser: User) => {
    await AsyncStorage.multiSet([
      [TOKEN_KEY, nextToken],
      [USER_KEY, JSON.stringify(nextUser)],
    ]);
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  // Telegram Mini App：打开即登录。initData 只有 Telegram 会注入，普通浏览器
  // 里为空，所以这里对其他入口没有影响；验签失败就留在登录页，不打断用户。
  const telegramAttempted = useRef(false);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    // 即使已经登录也调用一次：ready/expand 是 SDK 握手，不是登录动作。
    const initData = getTelegramInitData();
    if (!ready || token || telegramAttempted.current || !initData) return;
    telegramAttempted.current = true;
    void (async () => {
      try {
        const login = await telegramLogin(initData);
        await signIn(login.token, login.user);
      } catch {
        // bot token 没配 / initData 过期 / 不在 Mini App 里：交给登录页。
      }
    })();
  }, [ready, token, signIn]);

  const signOut = useCallback(async () => {
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
    setToken(null);
    setUser(null);
  }, []);

  // token 过期或被吊销时，服务端回 401，请求层从这里把状态清掉，
  // 根路由随即退回登录页。没有这条，用户会卡在「已登录但每个请求都失败」。
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void signOut();
    });
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  return (
    <AuthContext.Provider value={{ token, user, ready, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
