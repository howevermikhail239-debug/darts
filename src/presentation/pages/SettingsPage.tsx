import { useRef, useState } from 'react';
import { useEffect } from 'react';
import type { IdentityClaim } from '../../application/ports/companyGateway';
import { Dialog } from '../components/Dialog';
import type { Player } from '../../domain/match/models';
import { userMessage } from '../errors/userMessage';
import { PlayerIdentity } from '../components/PlayerIdentity';
import type { PersonIdentity } from '../../domain/identities/PersonIdentity';

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
  companyToken?: string;
  onImportOwnerKey?: (key: string) => Promise<void>;
  localPlayers?: readonly Player[];
  identities?: readonly PersonIdentity[];
  onClaimProfile?: (companyPlayerId: string, localPlayer: Player) => Promise<void>;
  loadOwnerClaims?: () => Promise<readonly IdentityClaim[]>;
  onResolveClaim?: (claim: IdentityClaim, action: 'approve' | 'reject' | 'revoke') => Promise<void>;
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
  companyToken,
  onImportOwnerKey,
  localPlayers = [],
  identities = [],
  onClaimProfile,
  loadOwnerClaims,
  onResolveClaim,
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
  const [ownerKey, setOwnerKey] = useState('');
  const [ownerClaims, setOwnerClaims] = useState<readonly IdentityClaim[]>();
  useEffect(() => {
    if (loadOwnerClaims)
      void loadOwnerClaims()
        .then(setOwnerClaims)
        .catch(() => setOwnerClaims(undefined));
  }, [loadOwnerClaims]);
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
        <div className="settings-section-heading">
          <div>
            <h2>Профили игроков</h2>
            <p>Имена и статистика постоянных участников</p>
          </div>
          <strong>{players.length}</strong>
        </div>
        {players.length === 0 ? (
          <p>Сохранённых игроков пока нет.</p>
        ) : (
          players.map((player) => (
            <article key={player.id} className="profile-management-card">
              <header className="profile-management-heading">
                <PlayerIdentity playerId={player.id} name={player.name} compact />
                <small>Постоянный профиль</small>
              </header>
              <div className="profile-edit">
                <label>
                  Имя
                  <input
                    maxLength={80}
                    value={nameFieldOf(player)}
                    onChange={(event) => setEdits((current) => ({ ...current, [player.id]: event.target.value }))}
                  />
                </label>
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
                  Сохранить имя
                </button>
              </div>
              <div className="profile-management-actions">
                <div>
                  <b>Статистика</b>
                  <small>История матчей при этих действиях сохраняется</small>
                </div>
                <button className="secondary" disabled={busy} onClick={() => setPending({ kind: 'reset', player })}>
                  Обнулить статистику
                </button>
                <button className="danger-quiet" disabled={busy} onClick={() => setPending({ kind: 'delete', player })}>
                  Удалить профиль
                </button>
              </div>
              {player.statsResetAt ? (
                <small className="profile-reset-note">
                  Статистика считается заново с {new Date(player.statsResetAt).toLocaleString('ru-RU')}
                </small>
              ) : null}
            </article>
          ))
        )}
      </section>
      <section className="setup-form">
        <h2>Данные</h2>
        <p>Сохраните игроков, историю и незавершённую игру в один файл.</p>
        <button className="primary" disabled={busy} onClick={() => download().catch(() => undefined)}>
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
      {companyToken && onImportOwnerKey ? (
        <section className="setup-form">
          <h2>Управление компанией</h2>
          <p>
            Добавьте ключ владельца, если он был выпущен оператором для этой компании. Ключ проверяется сервером и не
            показывается после сохранения.
          </p>
          <label>
            Ключ владельца
            <input
              type="password"
              value={ownerKey}
              onChange={(event) => setOwnerKey(event.target.value)}
              autoComplete="off"
            />
          </label>
          <button
            className="secondary"
            disabled={!ownerKey.trim() || busy}
            onClick={() => {
              setBusy(true);
              void onImportOwnerKey(ownerKey.trim())
                .then(() => {
                  setOwnerKey('');
                  setMessage('Ключ владельца сохранён на этом устройстве.');
                })
                .catch((cause) => setMessage(userMessage(cause, 'Ключ владельца не подтверждён сервером.')))
                .finally(() => setBusy(false));
            }}
          >
            Добавить ключ владельца
          </button>
        </section>
      ) : null}
      {companyToken && onClaimProfile ? (
        <section className="setup-form">
          <h2>Мои связи профилей</h2>
          <p>После подтверждения владельцем статистика будет доступна вместе. Матчи и профили не объединяются.</p>
          {players.map((companyPlayer) => {
            const link = identities
              .flatMap((identity) => identity.links.map((item) => ({ identity, item })))
              .find(({ item }) => item.companyToken === companyToken && item.companyPlayerId === companyPlayer.id);
            return (
              <article key={companyPlayer.id} className="profile-management-card">
                <b>{companyPlayer.name}</b>
                {link ? (
                  <p>
                    {link.item.verification === 'pending'
                      ? 'Ожидает подтверждения владельцем компании'
                      : link.item.verification === 'approved'
                        ? `Связан с профилем ${localPlayers.find((player) => player.id === link.identity.primaryLocalPlayerId)?.name ?? 'игроком'} · подтверждено владельцем`
                        : link.item.verification === 'rejected'
                          ? 'Владелец отклонил запрос'
                          : 'Связь была отозвана владельцем'}
                  </p>
                ) : (
                  <select
                    defaultValue=""
                    onChange={(event) => {
                      const local = localPlayers.find((player) => player.id === event.target.value);
                      if (local)
                        void onClaimProfile(companyPlayer.id, local)
                          .then(() => setMessage('Запрос отправлен владельцу.'))
                          .catch((cause) => setMessage(userMessage(cause, 'Не удалось отправить запрос.')));
                    }}
                  >
                    <option value="">Связать с моим профилем…</option>
                    {localPlayers.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name}
                      </option>
                    ))}
                  </select>
                )}
              </article>
            );
          })}
        </section>
      ) : null}
      {ownerClaims && onResolveClaim ? (
        <section className="setup-form">
          <h2>Запросы на связь профилей</h2>
          {ownerClaims.length ? (
            ownerClaims.map((claim) => (
              <article className="profile-management-card" key={claim.id}>
                <b>{players.find((player) => player.id === claim.companyPlayerId)?.name ?? 'Игрок'}</b>
                <p>
                  {claim.displayName} · {new Date(claim.createdAt).toLocaleDateString('ru-RU')} · {claim.status}
                </p>
                <div className="training-actions">
                  {claim.status === 'pending' ? (
                    <>
                      <button
                        className="primary"
                        onClick={() =>
                          void onResolveClaim(claim, 'approve')
                            .then(() => setOwnerClaims(undefined))
                            .catch((cause) => setMessage(userMessage(cause, 'Не удалось подтвердить запрос.')))
                        }
                      >
                        Подтвердить
                      </button>
                      <button
                        className="secondary"
                        onClick={() =>
                          void onResolveClaim(claim, 'reject')
                            .then(() => setOwnerClaims(undefined))
                            .catch((cause) => setMessage(userMessage(cause, 'Не удалось отклонить запрос.')))
                        }
                      >
                        Отклонить
                      </button>
                    </>
                  ) : claim.status === 'approved' ? (
                    <button
                      className="secondary"
                      onClick={() =>
                        void onResolveClaim(claim, 'revoke')
                          .then(() => setOwnerClaims(undefined))
                          .catch((cause) => setMessage(userMessage(cause, 'Не удалось отозвать связь.')))
                      }
                    >
                      Отозвать связь
                    </button>
                  ) : null}
                </div>
              </article>
            ))
          ) : (
            <p>Запросов пока нет.</p>
          )}
        </section>
      ) : null}
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
          if (selected) restore(selected).catch(() => undefined);
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
