import { useEffect, useState } from 'react';
import { useApp } from '../../state/appState.jsx';
import { Icon, Segmented } from '../shared/ui.jsx';

const TEXT_SIZE_SAMPLE = { small: 'text-[15px]', medium: 'text-[16px]', large: 'text-[17px]' };

export default function SettingsScreen() {
  const { preferences, updatePreferences } = useApp();
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (!savedFlash) return undefined;
    const timer = setTimeout(() => setSavedFlash(false), 1600);
    return () => clearTimeout(timer);
  }, [savedFlash]);

  /* Settings apply immediately . no separate save step to forget. */
  const select = async (key, value) => {
    await updatePreferences({ [key]: value });
    setSavedFlash(true);
  };

  const size = preferences.textSize || 'medium';

  return (
    <div className="max-w-[560px] mx-auto px-4 sm:px-6 py-8 sm:py-12 anim-slide">
      <div className="bg-card border border-sep rounded-[24px] shadow-card p-6 sm:p-8">
        <div className="flex items-center justify-between">
          <h1 className="text-[26px] font-semibold text-ink tracking-tight">Settings</h1>
          <span
            data-testid="saved-flash"
            className={`flex items-center gap-1.5 text-[13px] font-medium text-green transition-opacity duration-300 ${
              savedFlash ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <Icon name="check" className="w-4 h-4" />
            Saved
          </span>
        </div>

        <div className="mt-6 flex flex-col gap-6">
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="text-size-segment" className="text-[15px] font-medium text-ink">
                Text size
              </label>
              <span className="text-[12px] text-ink3">Applies to reading text</span>
            </div>
            <div className="mt-2.5">
              <Segmented
                id="text-size-segment"
                ariaLabel="Text size"
                value={size}
                onChange={(value) => select('textSize', value)}
                options={[
                  { value: 'small', label: 'Small' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'large', label: 'Large' },
                ]}
              />
            </div>
            <p className={`mt-3 font-serif ${TEXT_SIZE_SAMPLE[size] || TEXT_SIZE_SAMPLE.medium} text-ink2 leading-relaxed`}>
              The quick brown fox jumps over the lazy dog . sample of your reading size.
            </p>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="reading-font-segment" className="text-[15px] font-medium text-ink">
                Reading font
              </label>
              <span className="text-[12px] text-ink3">Comfort while reading</span>
            </div>
            <div className="mt-2.5">
              <Segmented
                id="reading-font-segment"
                ariaLabel="Reading font"
                value={preferences.readingFont === 'sans' ? 'sans' : 'serif'}
                onChange={(value) => select('readingFont', value)}
                options={[
                  { value: 'serif', label: 'Serif' },
                  { value: 'sans', label: 'Sans' },
                ]}
              />
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="theme-segment" className="text-[15px] font-medium text-ink">
                Appearance
              </label>
              <span className="text-[12px] text-ink3">Follows your system by default</span>
            </div>
            <div className="mt-2.5">
              <Segmented
                id="theme-segment"
                ariaLabel="Appearance"
                value={preferences.theme === 'light' || preferences.theme === 'dark' ? preferences.theme : 'system'}
                onChange={(value) => select('theme', value)}
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'system', label: 'Auto' },
                ]}
              />
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="checkpoint-segment" className="text-[15px] font-medium text-ink">
                Check-in frequency
              </label>
              <span className="text-[12px] text-ink3">Recall questions</span>
            </div>
            <div className="mt-2.5">
              <Segmented
                id="checkpoint-segment"
                ariaLabel="Check-in frequency"
                value={Number(preferences.checkpointFrequency) || 5}
                onChange={(value) => select('checkpointFrequency', Number(value))}
                options={[
                  { value: 3, label: 'Every 3' },
                  { value: 5, label: 'Every 5' },
                  { value: 8, label: 'Every 8' },
                ]}
              />
            </div>
          </div>
        </div>

        <p className="mt-8 pt-5 border-t border-sep text-[12px] text-ink3">
          Preferences are saved on this device only, and take effect instantly.
        </p>
      </div>
    </div>
  );
}
