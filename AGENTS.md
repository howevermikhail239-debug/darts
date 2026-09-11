# Памятка для продолжения разработки

Файл для того, кто продолжит работу над проектом, в том числе для ИИ-агента.
Читается первым. Всё, что написано ниже, проверено запуском кода.

## 1. Что это за проект

PWA-счётчик для очной игры в дартс. Два режима: X01 (301/501/701) и «Серия»
(фиксированное число подходов). Матчи хранятся локально в IndexedDB. Опционально
несколько устройств объединяются в «компанию» и синхронизируют завершённые матчи
через собственный Node-сервер.

Стек: React 19, TypeScript, Vite, vite-plugin-pwa, idb. Сервер — `server.mjs`,
один файл, ноль runtime-зависимостей, хранит данные в одном JSON. Развёрнут в
Yandex Cloud: API Gateway → одна VM → systemd.

Объём: около 4 тысяч строк в `src/`, 290 модульных тестов, 53 сквозных.

## 2. Команды

```bash
npm ci                 # установка
npm run dev            # разработка на vite
npm test               # модульные тесты (vitest)
npm run test:server    # тесты сервера (node --test)
npm run test:pwa       # тест service worker
npm run typecheck      # tsc -b
npm run lint           # eslint
npm run build          # tsc -b && vite build
npm run preview        # поднять production-сборку через server.mjs на :4173
```

Сквозные тесты:

```bash
npm run test:e2e
```

В песочницах и на CI-образах, где нет скачанного Playwright-браузера, укажите
существующий явно, иначе запуск падает на отсутствии исполняемого файла:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --workers=1
```

`npm run test:e2e` сам делает сборку и поднимает `server.mjs` на порту 4173.
Поэтому **нельзя одновременно** запускать e2e и что-либо, пишущее в `dist/`.

Перед push прогоняйте всё: `lint`, `typecheck`, `test`, `test:server`,
`test:pwa`, `build`, `test:e2e`. Ровно это делает CI
(`.github/workflows/ci.yml`).

## 3. Текущее состояние — прочитайте обязательно

| Проверка | Состояние |
| --- | --- |
| `npm run lint` | зелено |
| `npm run typecheck` | зелено |
| `npm test` | зелено, 290 тестов в 27 файлах |
| `npm run test:server` | зелено, 15 тестов |
| `npm run test:e2e` | **39 из 53, четырнадцать падают** |

**Ветку нельзя сливать, пока сквозные тесты не вернутся к базлайну.**
До правок было 52 из 53.

### Что именно падает

```
e2e/app.spec.ts:420   limited 501 ends immediately when zero is reached before the visit limit
e2e/app.spec.ts:471   a 0:0 limited-501 tie break stays resolvable as a separate scoring contest
e2e/app.spec.ts:579   a second match can reuse saved player ids, announces a real record and produces a trend
e2e/app.spec.ts:622   player statistics mode filter switches between 501 and scoring series
e2e/app.spec.ts:764   offline completed company match survives reload and manual retry uploads it once
e2e/app.spec.ts:788   company match keeps temporary participant out of shared player catalog        (таймаут 30 с)
e2e/app.spec.ts:816   stable local profile ids aggregate across matches and completed match opens relevant statistics
e2e/app.spec.ts:868   company persistent plus temporary match opens profile statistics...           (таймаут 30 с)
e2e/app.spec.ts:963   Stage 4.5 local rematch starts immediately with a new id, stable profiles and rotated starter
e2e/app.spec.ts:978   Stage 4.5.1 creates two persistent profiles in Setup and aggregates them through a rematch
e2e/app.spec.ts:1023  Stage 4.5 temporary rematch recreates only temporary identity...
e2e/app.spec.ts:1035  Stage 4.5 company rematch preserves three shared ids...                       (таймаут 30 с)
e2e/app.spec.ts:1125  Stage 4.6 Last Setup never replaces a missing profile by the same display name
e2e/app.spec.ts:1207  Stage 4.6 company Last Setup is isolated by company token                     (таймаут 30 с)
```

Падения делятся на две группы, и разбирать их надо по-разному.

**Группа 1 — тест устарел, поведение изменено намеренно.** Сюда точно относится
`:420`: раньше выход в ноль мгновенно завершал лимитированный матч, теперь круг
доигрывается до конца (находка DOM-4). Такие тесты надо переписать под новое
правило, а не «чинить» код.

**Группа 2 — похоже на настоящую регрессию.** Четыре сценария компании падают по
таймауту 30 секунд, и все четыре сценария переигровки падают быстро. Начинать
разбор стоит с них: скорее всего одна общая причина в
`src/presentation/hooks/useDataSource.ts` (новый хук, через который теперь идут
все операции с игроками и историей) либо в переходах экрана из
`useScreenHistory`. Смотрите трассировки: они пишутся в `test-results/` при
падении.

### Что ещё не сделано

1. **Нет стилей у новых элементов интерфейса.** Классы без CSS:
   `.update-banner`, `.known-companies`, `.known-companies-current`,
   `.invite-link`, `.invite-note`, `.company-error`, `.history-more`,
   `.history-renamed`. Плюс блок `.fatal` теперь содержит абзацы и три кнопки
   вместо одной строки, старые правила под него не рассчитаны.
2. **Форматирование.** В репозитории 83 строки длиннее 300 символов, максимум
   3110. Prettier и правило `max-len` не подключены. Делать отдельным коммитом
   «только форматирование», иначе смешается с содержательными правками.
3. **CSS-файлы называются по спринтам** (`stage3.css`, `stage4.css`,
   `stage46.css`), каскад определяется порядком импортов в `App.tsx`. Селектор
   `.x01-presets` объявлен в девяти местах.
4. **Типизированный линтинг.** Без него `@typescript-eslint/no-floating-promises`
   не работает, а именно из-за него в коде жили молчаливые сбои.
5. **Коды доменных ошибок.** Сейчас `src/presentation/errors/userMessage.ts`
   отличает пользовательские условия от внутренних сбоев по тексту сообщения.
   Нужны коды в домене, список кандидатов есть в `TECHNICAL_AUDIT.md`.
6. **Документация.** `docs/architecture.md` описывает старые правила серии и
   X01, `docs/yandex-cloud-deployment.md` не знает про новую ретенцию копий,
   логирование и заголовок `if-match`.
7. **Внешние копии бэкапов** в Object Storage — нужны облачные ключи.

## 4. Архитектура и правила, которые нельзя нарушать

```
presentation → application → domain
infrastructure реализует порты из application/ports
```

- `src/domain/**` не знает ни о React, ни о браузере, ни о хранилище.
- `src/application/**` не импортирует инфраструктуру, презентацию и React, и в
  нём запрещён `fetch`.
- `src/infrastructure/network/**` и `src/infrastructure/persistence/**` не
  импортируют друг друга. Это правило появилось после того, как сетевой адаптер
  начал валидировать ответы сервера декодером хранилища.
- Зависимости связываются в единственном месте — `src/app/compositionRoot.ts`.

Правила проверяются **исполняемым тестом** `tests/architecture.test.ts`, а не
только линтером. Если он покраснел — вы нарушили границу слоя, а не «тест
устарел».

Другие соглашения:

- `any` запрещён. Сейчас его ноль, держите так.
- Включены `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- Доменные значения неизменяемы, `Readonly<>` и `Object.freeze`.
- Классы только там, где есть идентичность и жизненный цикл: `GameSession` и
  реализации `GameRules`. Всё остальное — типы и чистые функции. Не добавляйте
  слои и классы туда, где сейчас функция.
- Интерфейс на русском. Сообщения об ошибках пользователю тоже.

## 5. Ключевые файлы

| Файл | Зачем |
| --- | --- |
| `src/domain/rules/X01Rules.ts`, `FixedVisitsRules.ts` | все правила игры |
| `src/domain/match/validation.ts` | **единственный** валидатор `Match`, используется и хранилищем, и сетью |
| `src/application/GameSession.ts` | жизненный цикл активной игры, черновик, отмена |
| `src/infrastructure/persistence/IndexedDbRepositories.ts` | схема IndexedDB, миграции, репозитории |
| `src/application/CompanySync.ts` | синхронизация с сервером |
| `src/presentation/hooks/useDataSource.ts` | единственное место, знающее про два режима: локальный и компания |
| `src/App.tsx` | выбор экрана и сборка интерфейса |
| `server.mjs` | весь сервер |
| `TECHNICAL_AUDIT.md` | полный аудит: находки, доказательства, план работ |

## 6. Что важно знать про подводные камни

**Схема IndexedDB — версия 2.** Есть миграция с версии 1, она переносит данные
компаний из общего стора `meta` в отдельные стор-ы. Миграция идемпотентна и
покрыта `tests/schemaMigration.test.ts`. Если меняете схему — обязательно пишите
миграцию и тест, у пользователей на устройствах лежат реальные матчи.

**Валидаторы фаз принимают и старую, и новую форму.** У части игроков сохранены
матчи в старом формате фаз. Не ужесточайте `isFixedVisitsPhase` и `isX01Phase`,
не проверив, что старые записи продолжают загружаться.

**Формат ответов сервера менять нельзя без оглядки на клиентов.** Старые версии
приложения остаются на устройствах. Сервер уже отвечает `201/200/409` по правилам
`if-match`; ревизия хранится рядом с матчем и наружу в списке `matches` не
отдаётся.

**Сквозные тесты бьют по настоящему серверу.** `playwright.config.ts` поднимает
`npm run build && npm run preview`, а не мок. Сценарии «два устройства»
используют два контекста браузера. Офлайн моделируется перехватом запросов.

**Service worker больше не перезагружает окна.** Обновление применяется только по
нажатию пользователя. Не возвращайте `skipWaiting` в автозапуск: из-за него
деплой выбрасывал игроков из матча.

**Токен компании — это ссылка `/g/<токен>`.** Он же единственный ключ доступа.
Не логируйте его, не выводите в тексты ошибок. На сервере хранится только
sha256. Логирование запросов на API Gateway отключено намеренно именно поэтому.

## 7. Готовые точки расширения, ещё не подключённые к интерфейсу

Инфраструктура их уже отдаёт, презентация пока не использует:

| API | Что даёт |
| --- | --- |
| `services.matches.onExternalChange(listener)` | изменения активного матча из другой вкладки |
| `isActiveMatchConflict(error)` из `application/ports/repositories` | распознать конфликт записи между вкладками |
| `services.matches.activeMatchIssue()` | вернёт `'future_version'`, если матч создан более новой версией приложения |
| `services.onStorageNotice(listener)` | база заблокирована другой вкладкой |
| `services.matches.readHistory(limit?)` | история плюс число пропущенных повреждённых записей |
| `companySync.lastSnapshotIssues()` | сколько записей компании пропущено при загрузке |

Отдельно: состояние синхронизации `rejected` (неустранимая ошибка, матч не
переотправляется) сейчас в `compositionRoot.ts` отображается в `error`, потому
что union в `useCompanySync.ts` уже. Расширьте union до
`'pending' | 'synced' | 'error' | 'rejected'` и удалите отображение — это одна
строка.

## 8. Рекомендуемый порядок работы

1. Прогнать e2e и разобрать 14 падений: отделить устаревшие тесты от регрессий.
2. Написать стили новым элементам интерфейса.
3. Довести e2e до зелёного, не хуже 52 из 53.
4. Обновить документацию под изменённые правила.
5. Отдельным коммитом — Prettier, `max-len`, типизированный линтинг.
6. Отдельно — переименование CSS по слоям каскада.

Не переписывайте архитектуру: слои, порты и доменная модель сделаны правильно.
Не добавляйте зависимости без необходимости — у сервера их ноль, и это ценно.
