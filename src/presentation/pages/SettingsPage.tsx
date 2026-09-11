import { useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import type { Player } from '../../domain/match/models';
import { userMessage } from '../errors/userMessage';

type Props = {
  players: readonly Player[];
  onRename: (playerId: string, name: string) => Promise<unknown>;
  onResetStatistics: (playerId: string) => Promise<unknown>;
  onDeletePlayer: (playerId: string) => Promise<unknown>;
  onBack: () => void;
  onExport: () => Promise<string>;
  onRestore: (json: string) => Promise<void>;
  hapticsSupported: boolean;
  hapticsEnabled: boolean;
  onHaptics: (enabled: boolean) => Promise<void>;
};

export function SettingsPage({
  players,
  onRename,
  onResetStatistics,
  onDeletePlayer,
  onBack,
  onExport,
  onRestore,
  hapticsSupported,
  hapticsEnabled,
  onHaptics,
}: Props) {
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File>();
  /**
   * UI-2: поле имени показывает актуальное имя из props и переключается на
   * правку пользователя только пока она не сохранена. Раньше состояние
   * инициализировалось один раз, и синхронизация компании не доходила до полей.
   */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const nameFieldOf = (player: Player) => edits[player.id] ?? player.name;
  const forgetEdit = (playerId: string) =>
    setEdits((current) => {
      if (!(playerId in current)) return current;
      const next = { ...current };
      delete next[playerId];
      return next;
    });
  const [pending, setPending] = useState<{ kind: 'reset' | 'delete'; player: Player }>();
  const download = async () => {
    setBusy(true);
    try {
      const json = await onExport();
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `darts-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage('Резервная копия сохранена.');
    } catch (cause) {
      setMessage(userMessage(cause, 'Не удалось экспортировать данные.'));
    } finally {
      setBusy(false);
    }
  };
  const restore = async (selected: File) => {
    setBusy(true);
    try {
      await onRestore(await selected.text());
      setMessage('Данные восстановлены. Приложение будет перезагружено.');
      location.reload();
    } catch (cause) {
      setMessage(userMessage(cause, 'Не удалось восстановить данные.'));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };
  const changeHaptics = (enabled: boolean) => {
    setPreferenceBusy(true);
    setMessage(undefined);
    void onHaptics(enabled)
      .catch(() => setMessage('Не удалось сохранить настройку.'))
      .finally(() => setPreferenceBusy(false));
  };
  return (
    <main className="settings-page">
      <header>
        <button className="text-icon" onClick={onBack} aria-label="Назад">
          ‹
        </button>
        <h1>Настройки</h1>
      </header>
      {hapticsSupported ? (
        <section className="setup-form preference-section">
          <h2>Во время игры</h2>
          <label className="preference-toggle">
            <span>
              <b>Виброотклик</b>
              <small>Короткий сигнал для важных событий</small>
            </span>
            <input
              type="checkbox"
              checked={hapticsEnabled}
              disabled={preferenceBusy}
              onChange={(event) => changeHaptics(event.target.checked)}
            />
          </label>
        </section>
      ) : null}
      <section className="setup-form player-management">
        <h2>Игроки</h2>
        {players.length === 0 ? (
          <p>Сохранённых игроков пока нет.</p>
        ) : (
          players.map((player) => (
            <article key={player.id}>
              <label>
                Имя
                <input
                  maxLength={80}
                  value={nameFieldOf(player)}
                  onChange={(event) => setEdits((current) => ({ ...current, [player.id]: event.target.value }))}
                />
              </label>
              <div>
                <button
                  className="secondary"
                  disabled={busy || !nameFieldOf(player).trim() || nameFieldOf(player).trim() === player.name}
                  onClick={() => {
                    setBusy(true);
                    setMessage(undefined);
                    void onRename(player.id, nameFieldOf(player))
                      .then(() => {
                        forgetEdit(player.id);
                        setMessage('Имя игрока сохранено.');
                      })
                      .catch((cause: unknown) => setMessage(userMessage(cause, 'Не удалось переименовать игрока.')))
                      .finally(() => setBusy(false));
                  }}
                >
                  Переименовать
                </button>
                <button className="secondary" disabled={busy} onClick={() => setPending({ kind: 'reset', player })}>
                  Обнулить статистику
                </button>
                <button
                  className="danger-button"
                  disabled={busy}
                  onClick={() => setPending({ kind: 'delete', player })}
                >
                  Удалить профиль
                </button>
              </div>
              {player.statsResetAt ? (
                <small>Статистика считается заново с {new Date(player.statsResetAt).toLocaleString('ru-RU')}</small>
              ) : null}
            </article>
          ))
        )}
      </section>
      <section className="setup-form">
        <h2>Данные</h2>
        <p>Сохраните игроков, историю и незавершённую игру в один файл.</p>
        <button className="primary" disabled={busy} onClick={() => void download()}>
          Экспортировать данные
        </button>
        <button className="secondary" disabled={busy} onClick={() => file.current?.click()}>
          Восстановить из копии
        </button>
        <input
          ref={file}
          hidden
          type="file"
          accept="application/json,.json"
          aria-label="Файл резервной копии"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) setRestoreFile(selected);
          }}
        />
        {message ? (
          <div role="status" className="notice">
            {message}
          </div>
        ) : null}
      </section>
      <Dialog
        open={Boolean(restoreFile)}
        title="Восстановить данные?"
        description="Текущие локальные игроки, история и незавершённый матч будут заменены данными из выбранной копии."
        confirmLabel="Восстановить"
        destructive
        onCancel={() => {
          setRestoreFile(undefined);
          if (file.current) file.current.value = '';
        }}
        onConfirm={() => {
          const selected = restoreFile;
          setRestoreFile(undefined);
          if (selected) void restore(selected);
        }}
      />
      <Dialog
        open={Boolean(pending)}
        title={
          pending?.kind === 'delete'
            ? `Удалить игрока «${pending.player.name}»?`
            : `Обнулить статистику игрока «${pending?.player.name}»?`
        }
        description={
          pending?.kind === 'delete'
            ? 'Он исчезнет из списка игроков. Уже сыгранные матчи останутся в истории.'
            : 'История матчей сохранится, но статистика игрока начнёт считаться заново.'
        }
        confirmLabel={pending?.kind === 'delete' ? 'Удалить игрока' : 'Обнулить статистику'}
        destructive
        onCancel={() => setPending(undefined)}
        onConfirm={() => {
          const action = pending;
          setPending(undefined);
          if (!action) return;
          setBusy(true);
          setMessage(undefined);
          const task =
            action.kind === 'delete' ? onDeletePlayer(action.player.id) : onResetStatistics(action.player.id);
          void task
            .then(() =>
              setMessage(action.kind === 'delete' ? 'Профиль удалён. История сохранена.' : 'Статистика обнулена.'),
            )
            .catch((cause: unknown) => setMessage(userMessage(cause, 'Операция не выполнена.')))
            .finally(() => setBusy(false));
        }}
      />
    </main>
  );
}
