import { useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';

type Props = {
  onBack: () => void;
  onExport: () => Promise<string>;
  onRestore: (json: string) => Promise<void>;
  hapticsSupported: boolean;
  hapticsEnabled: boolean;
  onHaptics: (enabled: boolean) => Promise<void>;
};

export function SettingsPage({ onBack, onExport, onRestore, hapticsSupported, hapticsEnabled, onHaptics }: Props) {
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File>();
  const download = async () => {
    setBusy(true);
    try {
      const json = await onExport();
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `darts-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click(); URL.revokeObjectURL(url);
      setMessage('Резервная копия сохранена.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось экспортировать данные.'); }
    finally { setBusy(false); }
  };
  const restore = async (selected: File) => {
    setBusy(true);
    try { await onRestore(await selected.text()); setMessage('Данные восстановлены. Приложение будет перезагружено.'); location.reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось восстановить данные.'); }
    finally { setBusy(false); if (file.current) file.current.value = ''; }
  };
  const changeHaptics = (enabled: boolean) => {
    setPreferenceBusy(true);
    setMessage(undefined);
    void onHaptics(enabled).catch(() => setMessage('Не удалось сохранить настройку.')).finally(() => setPreferenceBusy(false));
  };
  return <main className="settings-page">
    <header><button className="text-icon" onClick={onBack} aria-label="Назад">‹</button><h1>Настройки</h1></header>
    {hapticsSupported ? <section className="setup-form preference-section"><h2>Во время игры</h2><label className="preference-toggle"><span><b>Виброотклик</b><small>Короткий сигнал для важных событий</small></span><input type="checkbox" checked={hapticsEnabled} disabled={preferenceBusy} onChange={(event) => changeHaptics(event.target.checked)} /></label></section> : null}
    <section className="setup-form"><h2>Данные</h2><p>Сохраните игроков, историю и незавершённую игру в один файл.</p><button className="primary" disabled={busy} onClick={() => void download()}>Экспортировать данные</button><button className="secondary" disabled={busy} onClick={() => file.current?.click()}>Восстановить из копии</button><input ref={file} hidden type="file" accept="application/json,.json" aria-label="Файл резервной копии" onChange={event => { const selected = event.target.files?.[0]; if (selected) setRestoreFile(selected); }} />{message ? <div role="status" className="notice">{message}</div> : null}</section>
    <Dialog open={Boolean(restoreFile)} title="Восстановить данные?" description="Текущие локальные игроки, история и незавершённый матч будут заменены данными из выбранной копии." confirmLabel="Восстановить" destructive onCancel={() => { setRestoreFile(undefined); if (file.current) file.current.value = ''; }} onConfirm={() => { const selected = restoreFile; setRestoreFile(undefined); if (selected) void restore(selected); }} />
  </main>;
}
