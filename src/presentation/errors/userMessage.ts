import { DomainError, type DomainErrorCode } from '../../domain/errors';

/** Единая точка превращения исключения в текст для пользователя (OOP-1, DATA-4). */

export const GENERIC_FAILURE = 'Что-то пошло не так, попробуйте ещё раз.';
export const NETWORK_FAILURE = 'Нет связи с сервером. Проверьте подключение и попробуйте ещё раз.';
export const SERVER_FAILURE = 'Сервер ответил неожиданным образом. Попробуйте ещё раз позже.';
export const STORAGE_FAILURE = 'Не удалось прочитать данные на этом устройстве.';

const DOMAIN_MESSAGES: Partial<Record<DomainErrorCode, string>> = {
  draft_not_reset: 'Сначала сбросьте незавершённый подход',
  busy_confirming: 'Подтверждение уже выполняется',
  busy_persisting: 'Идёт сохранение подхода',
  nothing_to_undo: 'Нет подхода для отмены',
  match_finished: 'Матч завершён',
  draw_not_pending: 'Сначала выберите результат ничьей',
  draw_too_early: 'Ничью можно зафиксировать только со второго дополнительного круга',
  extra_round_unavailable: 'Дополнительный подход сейчас недоступен',
  player_limits: 'Проверьте количество и уникальность игроков',
  visits_range: 'Количество подходов должно быть от 1 до 999',
  profile_missing: 'Сохранённый профиль игрока не найден',
  rematch_requires_completed: 'Повторить можно только завершённый матч',
};

/** Legacy adapter/application conditions are kept explicit while their ports migrate to codes. */
const USER_CONDITIONS: readonly RegExp[] = [
  /^Сначала сбросьте незавершённый подход/u,
  /^Сначала переключитесь на /u,
  /^Сначала выберите результат ничьей/u,
  /^Подтверждение уже выполняется/u,
  /^Идёт сохранение подхода/u,
  /^Нет подхода для отмены/u,
  /^Матч (завершён|ещё не завершён)/u,
  /^Ничью можно зафиксировать/u,
  /^Дополнительный подход сейчас недоступен/u,
  /^Количество подходов должно быть/u,
  /^Матчу нужны как минимум/u,
  /^В матче не может быть больше/u,
  /^Повторить можно только завершённый матч/u,
  /^Поделиться можно только завершённым матчем/u,
  /^В подходе не может быть больше трёх дротиков/u,
  /^Сохранённый профиль игрока не найден/u,
  /^Нельзя удалить игрока из незавершённого матча/u,
  /^Удаление (профиля|матча) недоступно/u,
  /^Для (изменения данных|удаления) требуется подключение/u,
  /^Имя должно содержать/u,
  /^Введите имя игрока/u,
  /^Игрок не найден/u,
  /^Компания не выбрана/u,
  // Сетевой адаптер компании уже формулирует эти сообщения по-человечески.
  /^Не удалось связаться с компанией/u,
  /^Не удалось прочитать ответ сервера компании/u,
  /^Сервер компании/u,
  /^Компания не найдена/u,
  /^Нет доступа к этой компании/u,
  /^Данные компании изменились/u,
  /^Матч слишком большой/u,
  /^Слишком много запросов/u,
  // Многовкладочность: сообщения хранилища объясняют, что делать.
  /^Закройте другие вкладки/u,
  /вкладке приложения/u,
  /резервной копии/u,
  /^Файл не является корректным JSON/u,
  /^Это не резервная копия/u,
];

const isNetworkFailure = (cause: unknown): boolean => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (!(cause instanceof Error)) return false;
  if (cause.name === 'TypeError' && /fetch|network|load failed/iu.test(cause.message)) return true;
  return cause.name === 'AbortError' || /NetworkError|ERR_INTERNET_DISCONNECTED/iu.test(cause.message);
};

const isMalformedResponse = (cause: unknown): boolean =>
  cause instanceof Error && (cause.name === 'SyntaxError' || /не удалось разобрать ответ/iu.test(cause.message));

const isKnownUserCondition = (message: string): boolean => USER_CONDITIONS.some((pattern) => pattern.test(message));

/**
 * Текст для пользователя по любому исключению.
 * Технические подробности не доходят до интерфейса, но попадают в консоль.
 */
export function userMessage(cause: unknown, fallback: string = GENERIC_FAILURE): string {
  if (cause instanceof DomainError) {
    const message = DOMAIN_MESSAGES[cause.code];
    if (message) return message;
    console.error('Нарушение доменного инварианта:', cause);
    return fallback;
  }
  if (cause instanceof Error && cause.name === 'ActiveMatchConflictError')
    return 'Матч уже изменён в другой вкладке. Прогресс обновлён; проверьте текущий подход.';
  if (cause instanceof Error && isKnownUserCondition(cause.message)) return cause.message;
  console.error('Необработанная ошибка интерфейса:', cause);
  return fallback;
}

/**
 * Текст для сетевых операций (компания, синхронизация): сырые `Failed to fetch`
 * и `SyntaxError: Unexpected token '<'` до пользователя доходить не должны.
 */
export function networkMessage(cause: unknown, fallback: string = GENERIC_FAILURE): string {
  if (isNetworkFailure(cause)) return NETWORK_FAILURE;
  if (isMalformedResponse(cause)) return SERVER_FAILURE;
  return userMessage(cause, fallback);
}
