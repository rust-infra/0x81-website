import { Redirect } from 'expo-router';
import { useAuth } from '../lib/auth';

/**
 * 根路由。
 *
 * `navigation-contract.ts` 里写的是「这里没有首页，演练本身就是根页」，但
 * `(tabs)/rehearse.tsx` 只映射到 `/rehearse`——**没有任何文件映射 `/`**。
 * 结果就是启动时 expo-router 报 `Unmatched Route`（深链是 `rehearse:///`），
 * 用户看到的第一屏是一个 404 页。
 *
 * 这里按登录态分流，让 `/` 有确定去向：
 *   - 已登录 → 演练 Tab（根页）
 *   - 未登录 → 登录页
 *
 * 用 `/(tabs)/rehearse` 而不是 `/(tabs)`：后者指向一个没有 index 的分组，
 * 解析结果依赖 expo-router 的「选第一个 screen」行为，不如写死明确。
 */
export default function Index() {
  const { token } = useAuth();
  return <Redirect href={token ? '/(tabs)/rehearse' : '/login'} />;
}
