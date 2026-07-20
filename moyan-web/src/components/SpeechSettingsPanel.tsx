import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Volume2, VolumeX, RotateCcw, ExternalLink, AlertCircle, Check, Zap, Cloud, CloudCog, Trash2 } from 'lucide-react';
import {
  getSpeechSettings,
  saveSpeechSettings,
  resetSpeechSettings,
  ELEVENLABS_VOICES,
  GOOGLE_VOICES,
  GOOGLE_ZH_VOICES,
  ALIYUN_VOICES,
  speak,
  clearAudioCache,
  getProviderLabel,
  type SpeechProvider,
} from '../services/speechService';
import { t } from '../i18n/translations';

export default function SpeechSettingsPanel() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState(getSpeechSettings());
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

  const updateSetting = <K extends keyof typeof settings>(key: K, value: typeof settings[K]) => {
    setSettings(prev => {
      const newSettings = { ...prev, [key]: value };
      saveSpeechSettings(newSettings);
      return newSettings;
    });
  };

  const updateSettings = (partial: Partial<typeof settings>) => {
    setSettings(prev => {
      const newSettings = { ...prev, ...partial };
      saveSpeechSettings(newSettings);
      return newSettings;
    });
  };

  const handleTest = async () => {
    setTestResult(null);
    try {
      await speak('Hello, welcome to learning English vocabulary.');
      setTestResult('success');
    } catch {
      setTestResult('error');
    }
  };

  const handleReset = () => {
    if (window.confirm(t('settings.voice.reset') + '?')) {
      resetSpeechSettings();
      setSettings(getSpeechSettings());
      clearAudioCache();
    }
  };

  return (
    <div className="space-y-6">
      {/* 语音源选择 */}
      <section>
        <h3 className="text-xs uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--ink-muted)' }}>{t('settings.voice.title')}</h3>
        <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--card)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          {(['webspeech', 'google', 'elevenlabs', 'aliyun'] as SpeechProvider[]).map((provider, i, arr) => (
            <button
              key={provider}
              onClick={() => updateSetting('provider', provider)}
              className="w-full text-left flex items-center gap-3 px-4 py-3.5 transition hover:opacity-80"
              style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--divider)' : 'none' }}
            >
              <div
                className="w-5 h-5 rounded-full border-2 flex items-center justify-center transition"
                style={{
                  borderColor: settings.provider === provider ? 'var(--accent)' : 'var(--border)',
                }}
              >
                {settings.provider === provider && (
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm" style={{ color: 'var(--ink)' }}>{getProviderLabel(provider)}</p>
                <p className="text-[11px]" style={{ color: 'var(--ink-light)' }}>
                  {provider === 'webspeech'
                    ? t('settings.voice.provider.webspeech.desc')
                    : provider === 'google'
                    ? t('settings.voice.provider.google.desc')
                    : provider === 'aliyun'
                    ? t('settings.voice.provider.aliyun.desc')
                    : t('settings.voice.provider.elevenlabs.desc')}
                </p>
              </div>
              {provider === 'elevenlabs' && (
                <Zap size={14} style={{ color: 'var(--accent)' }} className="shrink-0" />
              )}
              {provider === 'google' && (
                <Cloud size={14} style={{ color: '#4285F4' }} className="shrink-0" />
              )}
              {provider === 'aliyun' && (
                <CloudCog size={14} style={{ color: '#FF6A00' }} className="shrink-0" />
              )}
            </button>
          ))}
        </div>
      </section>

      {/* ElevenLabs 配置 */}
      {settings.provider === 'elevenlabs' && (
        <section className="animate-fade-in-up">
          <h3 className="text-xs uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--ink-muted)' }}>ElevenLabs</h3>
          <div className="rounded-2xl p-4 space-y-4" style={{ backgroundColor: 'var(--card)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            {/* API Key */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm" style={{ color: 'var(--ink)' }}>API Key</label>
                <a
                  href="https://elevenlabs.io/app/settings/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] flex items-center gap-0.5 hover:underline"
                  style={{ color: 'var(--accent)' }}
                >
                  Get API Key <ExternalLink size={10} />
                </a>
              </div>
              <input
                type="password"
                value={settings.elevenLabsKey}
                onChange={e => updateSetting('elevenLabsKey', e.target.value)}
                placeholder="Paste your ElevenLabs API Key"
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none focus:ring-2 font-mono"
                style={{
                  backgroundColor: 'var(--input-bg)',
                  color: 'var(--ink)',
                }}
              />
              <p className="text-[10px] mt-1" style={{ color: 'var(--ink-muted)' }}>
                {t('settings.voice.apikey.desc')}
              </p>
            </div>

            {/* 语音选择 */}
            <div>
              <label className="text-sm mb-1 block" style={{ color: 'var(--ink)' }}>{t('settings.voice.voice.select')}</label>
              <div className="grid grid-cols-1 gap-1.5 max-h-52 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
                {ELEVENLABS_VOICES.map(voice => (
                  <button
                    key={voice.id}
                    onClick={() => updateSetting('elevenLabsVoiceId', voice.id)}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm transition"
                    style={
                      settings.elevenLabsVoiceId === voice.id
                        ? { backgroundColor: 'var(--accent)', color: '#fff' }
                        : { backgroundColor: 'var(--paper)', color: 'var(--ink)' }
                    }
                  >
                    <span className="font-medium">{voice.name}</span>
                    <span className="text-[10px] opacity-60 ml-2">{voice.language}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 模型 */}
            <div>
              <label className="text-sm mb-1 block" style={{ color: 'var(--ink)' }}>{t('settings.voice.model')}</label>
              <select
                value={settings.elevenLabsModel}
                onChange={e => updateSetting('elevenLabsModel', e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none appearance-none"
                style={{ backgroundColor: 'var(--input-bg)', color: 'var(--ink)' }}
              >
                <option value="eleven_turbo_v2_5">Turbo v2.5 (Fast)</option>
                <option value="eleven_multilingual_v2">Multilingual v2</option>
                <option value="eleven_monolingual_v1">Monolingual v1</option>
              </select>
            </div>
          </div>
        </section>
      )}

      {/* Google Cloud 配置 */}
      {settings.provider === 'google' && (
        <section className="animate-fade-in-up">
          <h3 className="text-xs uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--ink-muted)' }}>Google Cloud</h3>
          <div className="rounded-2xl p-4 space-y-4" style={{ backgroundColor: 'var(--card)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm" style={{ color: 'var(--ink)' }}>API Key</label>
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] flex items-center gap-0.5 hover:underline"
                  style={{ color: '#4285F4' }}
                >
                  Get API Key <ExternalLink size={10} />
                </a>
              </div>
              <input
                type="password"
                value={settings.googleKey}
                onChange={e => updateSetting('googleKey', e.target.value)}
                placeholder="Paste your Google Cloud API Key"
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none focus:ring-2 font-mono"
                style={{
                  backgroundColor: 'var(--input-bg)',
                  color: 'var(--ink)',
                }}
              />
              <p className="text-[10px] mt-1" style={{ color: 'var(--ink-muted)' }}>
                Cloud Text-to-Speech API. {t('settings.voice.apikey.desc')}
              </p>
            </div>

            <div>
              <label className="text-sm mb-1 block" style={{ color: 'var(--ink)' }}>{t('settings.voice.voice.select')}</label>
              <div className="grid grid-cols-1 gap-1.5 max-h-52 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
                {GOOGLE_VOICES.map(voice => (
                  <button
                    key={voice.id}
                    onClick={() => updateSettings({ googleVoice: voice.id, googleLanguage: voice.language })}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm transition"
                    style={
                      settings.googleVoice === voice.id
                        ? { backgroundColor: '#4285F4', color: '#fff' }
                        : { backgroundColor: 'var(--paper)', color: 'var(--ink)' }
                    }
                  >
                    <span className="font-medium">{voice.name}</span>
                    <span className="text-[10px] opacity-60 ml-2">{voice.language}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Chinese voice selection */}
            <div>
              <label className="text-sm mb-1 block" style={{ color: 'var(--ink)' }}>{t('settings.voice.voice.select.zh')}</label>
              <div className="grid grid-cols-1 gap-1.5 max-h-40 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
                {GOOGLE_ZH_VOICES.map(voice => (
                  <button
                    key={voice.id}
                    onClick={() => updateSetting('googleZhVoice', voice.id)}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm transition"
                    style={
                      settings.googleZhVoice === voice.id
                        ? { backgroundColor: '#4285F4', color: '#fff' }
                        : { backgroundColor: 'var(--paper)', color: 'var(--ink)' }
                    }
                  >
                    <span className="font-medium">{voice.name}</span>
                    <span className="text-[10px] opacity-60 ml-2">{voice.language}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 阿里云百炼 TTS 配置 */}
      {settings.provider === 'aliyun' && (
        <section className="animate-fade-in-up">
          <h3 className="text-xs uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--ink-muted)' }}>阿里云百炼</h3>
          <div className="rounded-2xl p-4 space-y-4" style={{ backgroundColor: 'var(--card)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm" style={{ color: 'var(--ink)' }}>API Key</label>
                <a
                  href="https://bailian.console.aliyun.com/?apiKey=1#/api-key"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] flex items-center gap-0.5 hover:underline"
                  style={{ color: '#FF6A00' }}
                >
                  Get API Key <ExternalLink size={10} />
                </a>
              </div>
              <input
                type="password"
                value={settings.aliyunKey}
                onChange={e => updateSetting('aliyunKey', e.target.value)}
                placeholder="sk-xxx"
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none focus:ring-2 font-mono"
                style={{
                  backgroundColor: 'var(--input-bg)',
                  color: 'var(--ink)',
                }}
              />
              <p className="text-[10px] mt-1" style={{ color: 'var(--ink-muted)' }}>
                {t('settings.voice.apikey.desc')} · {t('settings.voice.provider.aliyun.free')}
              </p>
            </div>

            <div>
              <label className="text-sm mb-1 block" style={{ color: 'var(--ink)' }}>{t('settings.voice.voice.select')}</label>
              <div className="grid grid-cols-1 gap-1.5 max-h-52 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
                {ALIYUN_VOICES.map(voice => (
                  <button
                    key={voice.id}
                    onClick={() => updateSetting('aliyunVoice', voice.id)}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm transition"
                    style={
                      settings.aliyunVoice === voice.id
                        ? { backgroundColor: '#FF6A00', color: '#fff' }
                        : { backgroundColor: 'var(--paper)', color: 'var(--ink)' }
                    }
                  >
                    <span className="font-medium">{voice.name}</span>
                    <span className="text-[10px] opacity-60 ml-2">{voice.id}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm mb-1 block" style={{ color: 'var(--ink)' }}>{t('settings.voice.model')}</label>
              <select
                value={settings.aliyunModel}
                onChange={e => updateSetting('aliyunModel', e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none appearance-none"
                style={{ backgroundColor: 'var(--input-bg)', color: 'var(--ink)' }}
              >
                <option value="qwen-tts">qwen-tts (标准版)</option>
                <option value="qwen3-tts-flash">qwen3-tts-flash (极速版)</option>
                <option value="qwen3-tts-instruct-flash">qwen3-tts-instruct-flash (指令版)</option>
              </select>
            </div>
          </div>
        </section>
      )}

      {/* 语速调节 */}
      <section>
        <h3 className="text-xs uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--ink-muted)' }}>{t('settings.voice.speed')}</h3>
        <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--card)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: 'var(--ink-light)' }}>{t('settings.voice.speed.slow')}</span>
            <input
              type="range"
              min="0.3"
              max="1.5"
              step="0.1"
              value={settings.rate}
              onChange={e => updateSetting('rate', parseFloat(e.target.value))}
              className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                backgroundColor: 'var(--divider)',
                accentColor: 'var(--accent)',
              }}
            />
            <span className="text-xs" style={{ color: 'var(--ink-light)' }}>{t('settings.voice.speed.fast')}</span>
          </div>
          <p className="text-center text-xs mt-2 font-medium" style={{ color: 'var(--ink)' }}>{settings.rate.toFixed(1)}x</p>
        </div>
      </section>

      {/* 缓存设置 */}
      <section>
        <h3 className="text-xs uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--ink-muted)' }}>{t('settings.voice.cache.title')}</h3>
        <div className="rounded-2xl p-4 space-y-3" style={{ backgroundColor: 'var(--card)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          {/* 缓存开关 */}
          <button
            onClick={() => updateSetting('cacheEnabled', !settings.cacheEnabled)}
            className="w-full text-left flex items-center justify-between px-3 py-3 rounded-xl transition"
            style={{ backgroundColor: 'var(--paper)' }}
          >
            <div className="flex items-center gap-3">
              {settings.cacheEnabled ? (
                <Volume2 size={18} style={{ color: 'var(--accent)' }} />
              ) : (
                <VolumeX size={18} style={{ color: 'var(--ink-muted)' }} />
              )}
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                  {settings.cacheEnabled ? t('settings.voice.cache.on') : t('settings.voice.cache.off')}
                </p>
                <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  {settings.cacheEnabled ? t('settings.voice.cache.on.desc') : t('settings.voice.cache.off.desc')}
                </p>
              </div>
            </div>
            <div
              className="w-11 h-6 rounded-full relative transition"
              style={{ backgroundColor: settings.cacheEnabled ? 'var(--accent)' : 'var(--divider)' }}
            >
              <div
                className="absolute top-0.5 w-5 h-5 rounded-full transition-all shadow-sm"
                style={{
                  backgroundColor: '#fff',
                  left: settings.cacheEnabled ? '22px' : '2px',
                }}
              />
            </div>
          </button>

          {/* 一键清理缓存 */}
          <button
            onClick={() => {
              if (window.confirm(t('settings.voice.cache.clear.confirm'))) {
                clearAudioCache();
                setTestResult('success');
                setTimeout(() => setTestResult(null), 1500);
              }
            }}
            className="w-full py-2.5 rounded-xl text-sm transition hover:opacity-80 flex items-center justify-center gap-1.5"
            style={{ backgroundColor: 'var(--paper)', color: 'var(--ink-light)' }}
          >
            <Trash2 size={14} />
            {t('settings.voice.cache.clear')}
          </button>
        </div>
      </section>

      {/* 测试与重置 */}
      <section>
        <h3 className="text-xs uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--ink-muted)' }}>{t('settings.voice.test')} & {t('settings.voice.reset')}</h3>
        <div className="rounded-2xl p-4 space-y-3" style={{ backgroundColor: 'var(--card)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div className="flex items-center gap-3">
            <button
              onClick={handleTest}
              className="flex-1 py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition hover:opacity-90"
              style={{ backgroundColor: 'var(--btn-bg)', color: 'var(--btn-text)' }}
            >
              <Volume2 size={16} />
              {t('settings.voice.test')}
            </button>
            {testResult && (
              <div
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs"
                style={{
                  backgroundColor: testResult === 'success' ? 'var(--tag-bg)' : 'var(--accent-light)',
                  color: testResult === 'success' ? 'var(--tag-text)' : 'var(--accent)',
                }}
              >
                {testResult === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
                {testResult === 'success' ? 'OK' : 'Error'}
              </div>
            )}
          </div>
          <button
            onClick={handleReset}
            className="w-full py-2.5 rounded-xl text-sm transition hover:opacity-80 flex items-center justify-center gap-1.5"
            style={{ backgroundColor: 'var(--paper)', color: 'var(--ink-light)' }}
          >
            <RotateCcw size={14} />
            {t('settings.voice.reset')}
          </button>
        </div>
      </section>

      {/* 说明 */}
      {settings.provider === 'elevenlabs' && (
        <div className="rounded-2xl p-4 text-xs leading-relaxed space-y-1.5" style={{ backgroundColor: 'var(--accent-light)', color: 'var(--ink-light)' }}>
          <p className="font-semibold" style={{ color: 'var(--ink)' }}>{t('settings.voice.elevenlabs.about')}</p>
          <p>{t('settings.voice.elevenlabs.desc1')}</p>
          <p>{t('settings.voice.elevenlabs.desc2')}</p>
          <p>{t('settings.voice.elevenlabs.desc3')}</p>
        </div>
      )}
      {settings.provider === 'google' && (
        <div className="rounded-2xl p-4 text-xs leading-relaxed space-y-1.5" style={{ backgroundColor: 'rgba(66,133,244,0.08)', color: 'var(--ink-light)' }}>
          <p className="font-semibold" style={{ color: 'var(--ink)' }}>{t('settings.voice.google.about')}</p>
          <p>{t('settings.voice.google.desc1')}</p>
          <p>{t('settings.voice.google.desc2')}</p>
          <p>{t('settings.voice.google.desc3')}</p>
        </div>
      )}
      {settings.provider === 'aliyun' && (
        <div className="rounded-2xl p-4 text-xs leading-relaxed space-y-1.5" style={{ backgroundColor: 'rgba(255,106,0,0.08)', color: 'var(--ink-light)' }}>
          <p className="font-semibold" style={{ color: 'var(--ink)' }}>{t('settings.voice.aliyun.about')}</p>
          <p>{t('settings.voice.aliyun.desc1')}</p>
          <p>{t('settings.voice.aliyun.desc2')}</p>
          <p>{t('settings.voice.aliyun.desc3')}</p>
        </div>
      )}
    </div>
  );
}
