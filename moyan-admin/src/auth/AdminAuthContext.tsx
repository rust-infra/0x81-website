import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearAdminToken,
  getAdminToken,
  setAdminToken,
} from "@/api/client";

type AdminAuthContextValue = {
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
};

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getAdminToken());

  const login = useCallback((nextToken: string) => {
    setAdminToken(nextToken);
    setToken(nextToken);
  }, []);

  const logout = useCallback(() => {
    clearAdminToken();
    setToken(null);
  }, []);

  const value = useMemo(
    () => ({ token, login, logout }),
    [token, login, logout],
  );

  return (
    <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthContextValue {
  const context = useContext(AdminAuthContext);
  if (!context) {
    throw new Error("useAdminAuth must be used within AdminAuthProvider");
  }
  return context;
}
