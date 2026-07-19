import { useState, useCallback } from 'react';
import { Volume2, Square } from 'lucide-react';
import { speak, stopAllAudio } from '../services/speechService';

interface SpeakButtonProps {
  text: string;
  size?: number;
  className?: string;
  showLabel?: boolean;
  onError?: (err: string) => void;
}

export default function SpeakButton({
  text,
  size = 18,
  className = '',
  showLabel = false,
  onError,
}: SpeakButtonProps) {
  const [isSpeaking, setIsSpeaking] = useState(false);

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (isSpeaking) {
      stopAllAudio();
      setIsSpeaking(false);
      return;
    }

    try {
      setIsSpeaking(true);
      await speak(text);
      setIsSpeaking(false);
    } catch (err: any) {
      setIsSpeaking(false);
      if (onError) onError(err.message || '语音播放失败');
    }
  }, [text, isSpeaking, onError]);

  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 rounded-full transition-all ${
        isSpeaking
          ? 'bg-[#8C3B3B]/10 text-[#8C3B3B]'
          : 'bg-white/10 text-white/60 hover:text-white hover:bg-white/20'
      } ${className}`}
      style={{ padding: showLabel ? '6px 12px' : '8px' }}
      title={isSpeaking ? '停止朗读' : '朗读'}
    >
      {isSpeaking ? (
        <Square size={size * 0.6} fill="currentColor" />
      ) : (
        <Volume2 size={size} />
      )}
      {showLabel && (
        <span className="text-xs">{isSpeaking ? '停止' : '朗读'}</span>
      )}
    </button>
  );
}
