import { useRef, useState } from 'react';

export function SettingsPage({ onBack, onExport, onRestore }: {
  onBack: () => void;
  onExport: () => Promise<string>;
  onRestore: (json: string) => Promise<void>;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
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
    if (!window.confirm('Текущие локальные данные будут заменены данными из резервной копии. Продолжить?')) return;
    setBusy(true);
    try { await onRestore(await selected.text()); setMessage('Данные восстановлены. Приложение будет перезагружено.'); location.reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось восстановить данные.'); }
    finally { setBusy(false); if (file.current) file.current.value = ''; }
  };
  return <main className="settings-page"><header><button className="text-icon" onClick={onBack}>‹</button><h1>Настройки</h1></header><section className="setup-form"><h2>Данные</h2><p>Сохраните игроков, историю и незавершённую игру в один JSON-файл.</p><button className="primary" disabled={busy} onClick={()=>void download()}>Экспортировать данные</button><button className="secondary" disabled={busy} onClick={()=>file.current?.click()}>Восстановить из копии</button><input ref={file} hidden type="file" accept="application/json,.json" aria-label="Файл резервной копии" onChange={event=>{const selected=event.target.files?.[0];if(selected)void restore(selected);}}/>{message?<div role="status" className="notice">{message}</div>:null}</section></main>;
}
