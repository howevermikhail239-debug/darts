type Props = {
  matchInProgress: boolean;
  onUpdate: () => void;
  onDismiss: () => void;
};

/**
 * Ненавязчивая плашка «Доступна новая версия · Обновить» (REL-3).
 * Обновление применяется только по нажатию; во время матча предупреждаем честно.
 */
export function UpdateBanner({ matchInProgress, onUpdate, onDismiss }: Props) {
  return (
    <aside className="update-banner" role="status" aria-label="Обновление приложения">
      <div>
        <b>Доступна новая версия</b>
        <span>
          {matchInProgress
            ? "Идёт матч. Приложение перезагрузится: подтверждённые подходы сохранятся, но экран игры закроется, а отменить получится только последний подход."
            : "Обновление применится после перезагрузки страницы."}
        </span>
      </div>
      <button className="secondary" onClick={onUpdate}>{matchInProgress ? "Обновить и перезагрузить" : "Обновить"}</button>
      <button className="link-button" onClick={onDismiss}>Позже</button>
    </aside>
  );
}
