// Package storetest 提供一个内存版的 `store.Store`，供上层服务的单测使用。
//
// 单独一个包而不是每个测试文件各写一份：`Store` 有 7 个方法，三处服务
// （quota / settings / coach）都要用它——复制三遍的话，将来给接口加方法
// 就要改三处，而漏改一处会变成编译错误之外的静默不一致。
package storetest

import (
	"context"
	"sync"
	"time"

	"github.com/0x81/rehearse-backend/internal/store"
)

// Fake 是内存实现。
//
// 并发安全（配额路径要能并发测），但**不模拟事务**：`UsageTryConsume`
// 用互斥锁做到「检查+递增」原子，与 Postgres 那条 `ON CONFLICT ... WHERE`
// 的语义等价。真库上的并发行为由 `store` 包的集成测试覆盖。
type Fake struct {
	mu       sync.Mutex
	usage    map[string]uint32
	settings map[string]string
	// PingErr 让 `/health` 的降级路径可测。
	PingErr error
}

// New 建一个空的内存 store。
func New() *Fake {
	return &Fake{usage: map[string]uint32{}, settings: map[string]string{}}
}

var _ store.Store = (*Fake)(nil)

// Ping 实现 store.Store。
func (f *Fake) Ping(context.Context) error { return f.PingErr }

// Close 实现 store.Store。
func (f *Fake) Close() {}

// SetSetting 直接塞一个设置值，省掉走 SettingPut 的 JSON 编解码。
func (f *Fake) SetSetting(key, value string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.settings[key] = value
}

// Usage 返回某用户某日的用量，供断言。
func (f *Fake) Usage(userID string, day time.Time) uint32 {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.usage[usageKey(userID, day)]
}

func usageKey(userID string, day time.Time) string {
	return userID + "|" + day.Format("2006-01-02")
}

// UsageGet 实现 store.Store。
func (f *Fake) UsageGet(_ context.Context, userID string, day time.Time) (uint32, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.usage[usageKey(userID, day)], nil
}

// UsageTryConsume 实现 store.Store。
func (f *Fake) UsageTryConsume(
	ctx context.Context, userID string, day time.Time, limit uint32,
) (uint32, bool, error) {
	if limit == 0 {
		used, err := f.UsageIncrement(ctx, userID, day)
		return used, true, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	key := usageKey(userID, day)
	used := f.usage[key]
	if used >= limit {
		return 0, false, nil
	}
	used++
	f.usage[key] = used
	return used, true, nil
}

// UsageIncrement 实现 store.Store。
func (f *Fake) UsageIncrement(_ context.Context, userID string, day time.Time) (uint32, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	key := usageKey(userID, day)
	f.usage[key]++
	return f.usage[key], nil
}

// SettingGet 实现 store.Store。
func (f *Fake) SettingGet(_ context.Context, key string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	value, ok := f.settings[key]
	if !ok {
		return "", store.ErrSettingNotFound
	}
	return value, nil
}

// SettingPut 实现 store.Store。
func (f *Fake) SettingPut(_ context.Context, key, value string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.settings[key] = value
	return nil
}
