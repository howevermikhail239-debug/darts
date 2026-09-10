# Dart Scorekeeper — полный код для аудита

Снимок включает весь текстовый исходный код, тесты, конфигурацию и архитектурную документацию. Исключены только генерируемые зависимости/артефакты (`node_modules`, `dist`, отчёты тестов), lockfile и бинарный концепт-рисунок.

## Состав

- `docs/architecture.md`
- `e2e/app.spec.ts`
- `eslint.config.js`
- `package.json`
- `playwright.config.ts`
- `README.md`
- `src/App.tsx`
- `src/app/compositionRoot.ts`
- `src/application/GameSession.ts`
- `src/application/ports/repositories.ts`
- `src/domain/darts/DartThrow.ts`
- `src/domain/match/createMatch.ts`
- `src/domain/match/models.ts`
- `src/domain/match/VisitDraft.ts`
- `src/domain/rules/FixedVisitsRules.ts`
- `src/domain/rules/GameRules.ts`
- `src/domain/rules/rulesFor.ts`
- `src/domain/rules/X01Rules.ts`
- `src/domain/statistics/StatisticsCalculator.ts`
- `src/infrastructure/persistence/IndexedDbRepositories.ts`
- `src/main.tsx`
- `src/presentation/active-game.css`
- `src/presentation/components/DartPad.tsx`
- `src/presentation/components/DraftPanel.tsx`
- `src/presentation/components/Scoreboard.tsx`
- `src/presentation/concept-overrides.css`
- `src/presentation/hooks/useWakeLock.ts`
- `src/presentation/pages/GamePage.tsx`
- `src/presentation/pages/HistoryPage.tsx`
- `src/presentation/pages/SetupPage.tsx`
- `src/presentation/pages/StatisticsPage.tsx`
- `src/presentation/statistics.css`
- `src/presentation/strings.ts`
- `src/presentation/styles.css`
- `src/vite-env.d.ts`
- `tests/completedRestore.test.tsx`
- `tests/domain.test.ts`
- `tests/persistence.test.ts`
- `tests/session.test.ts`
- `tests/setup.test.tsx`
- `tests/setup.ts`
- `tests/statistics.test.ts`
- `tsconfig.app.json`
- `tsconfig.json`
- `tsconfig.node.json`
- `vite.config.ts`

---

## `docs/architecture.md`

```markdown
# Архитектура приложения

## Границы и направление зависимостей

`presentation → application → domain`. Инфраструктура реализует порты `MatchRepository`, `PlayerRepository` и `SettingsRepository`; конкретные реализации соединяются только в `app/compositionRoot.ts`. ESLint запрещает обратные импорты, а domain не знает о React, браузере или хранении.

## Предметная модель и инварианты

`DartThrow` — discriminated union: сектор 1–20 с множителем 1/2/3, отдельные `outer_bull`, `bull`, `miss`. Фабрика проверяет сектор и множитель во время выполнения. `VisitDraft` — неизменяемое значение максимум из трёх бросков; MISS является элементом, пустой слот — отсутствием элемента. `Visit` — неизменяемый подтверждённый факт с бросками, raw/awarded score, контекстами до/после и результатом; массив бросков и контексты со счетами заморожены.

`Match` хранит массив идентификаторов игроков (ядро поддерживает любое количество от двух) и discriminated `ModeState`. Ход циклически переходит по массиву; интерфейс настройки ограничивает состав разумным диапазоном 2–8. 501 хранит индивидуальные остатки и явный формат: без лимита либо с одинаковым лимитом подтверждённых подходов на игрока. Серия хранит индивидуальные суммы, равное число обязательных подходов и состояние дополнительных раундов. Подтверждённая история не редактируется.

## Правила режимов

Контракт `GameRules` предоставляет `evaluateDraft` и `applyConfirmedVisit`. `X01Rules` реализует straight-out: победа наступает при точном нуле любым попаданием, а перебор — только при уходе ниже нуля. В ограниченном формате результат определяется после полного последнего круга по минимальному остатку; при равенстве дополнительные подходы получают только разделяющие минимум игроки, пока не появится единственный лидер. `FixedVisitsRules` остаётся отдельным режимом, требует ровно три физических дротика, гарантирует равное число подходов и управляет собственной ничьёй/дополнительными раундами. Реализации ничего не знают друг о друге.

## Прикладные сценарии

`GameSession` инкапсулирует жизненный цикл активной игры: редактирование черновика, полную переоценку после каждого изменения, атомарное подтверждение с guard от двойного вызова, стек контрольных точек, Undo, решение ничьей, прерывание и финализацию. При Confirm session строит неизменяемый факт визита из `DraftEvaluation`, а соответствующая `GameRules` является единственным авторитетным источником перехода `Match`; окончательный `Visit.after` берётся из уже применённого состояния. Busy публикуется синхронно до первого `await`, а все конкурирующие мутации блокируются. Match и стек Undo меняются только после успешного сохранения `current + previous` одной записью. После ошибки сохранения оперативное состояние остаётся прежним. В IndexedDB хранится одна предыдущая точка для Undo после перезагрузки; завершённый активный матч тоже восстанавливается, поэтому итоговый Undo переживает reload. В памяти хранится до 20 точек.

## Хранение и статистика

IndexedDB schema v1 содержит игроков, историю и meta-запись активного матча. Малые настройки изолированы за отдельным портом. На границе чтения выполняется структурная валидация; повреждение превращается в понятную ошибку. Неподтверждённый draft не сохраняется. Архивация/прерывание выполняются одной IndexedDB-транзакцией: запись в history и удаление active происходят вместе.

Статистика является набором чистых проекций подтверждённых Match/Visit/DartThrow; VisitDraft в расчётах не участвует. `StatisticsCalculator` агрегирует броски, игровые результаты, точные сектора, позиции дротика, cumulative-пороги, распределение и разброс, а также формирует фильтрованные ряды динамики, рекорды и сравнение игроков. Производные значения не сохраняются. Перебор даёт ноль зачётных очков, сохраняя реальные попадания; прерванный матч участвует в бросковых показателях, но исключён из win rate.

Отображаемое имя не является идентичностью игрока. Быстрые участники `Игрок N` получают новые `PlayerId` для каждой новой игры; существующий профиль переиспользуется только при явном выборе сохранённого игрока.

## Классы и функции

Класс оправдан для `GameSession`: у активной сессии есть идентичность, жизненный цикл, изменяемый черновик, guard и стек Undo. Классы правил не имеют состояния и существуют как полиморфные реализации контракта. Значения, фабрики, расчёт очков и статистика реализованы типами и чистыми функциями: у них нет собственной идентичности или жизненного цикла.

## Добавление режима

Нужно добавить новый вариант `ModeState`, реализацию `GameRules`, выбор в `rulesFor`, настройку создания и соответствующее представление счёта. Существующие X01/FixedVisits и репозитории изменять не требуется; Visit, draft, ввод и статистика бросков переиспользуются.

```

---

## `e2e/app.spec.ts`

```ts
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("e2e-storage-cleared")) return;
    sessionStorage.setItem("e2e-storage-cleared", "true");
    localStorage.clear();
    indexedDB.deleteDatabase("dart-scorekeeper");
  });
});

async function startMatch(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Начать" }).click();
  await expect(page.getByText("Текущий подход:")).toBeVisible();
}

async function startLimited501(page: import("@playwright/test").Page, players = 2, limit = 5) {
  await page.goto("/");
  const add = page.getByRole("button", { name: "+ Добавить игрока" });
  for (let count = 2; count < players; count += 1) await add.click();
  await page.getByRole("button", { name: "Ограничить количество подходов" }).click();
  await page.getByRole("button", { name: String(limit), exact: true }).click();
  await page.getByRole("button", { name: "Начать" }).click();
}

async function missVisit(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Мимо" }).click();
  await page.getByRole("button", { name: "Мимо" }).click();
  await page.getByRole("button", { name: "Мимо" }).click();
  await page.getByRole("button", { name: "Подтвердить 0" }).click();
}

async function startOneVisitSeries(page: import("@playwright/test").Page, players = 2) {
  await page.goto("/");
  const add = page.getByRole("button", { name: "+ Добавить игрока" });
  for (let count = 2; count < players; count += 1) await add.click();
  await page.getByRole("button", { name: "Серия" }).click();
  await page.getByRole("button", { name: "Другое" }).click();
  await page.getByLabel("Другое количество подходов").fill("1");
  await page.getByRole("button", { name: "Начать" }).click();
}

async function scoringVisit(page: import("@playwright/test").Page, segment: number) {
  await page.getByRole("button", { name: `Сектор ${segment}, множитель 1` }).click();
  await page.getByRole("button", { name: "Мимо" }).click();
  await page.getByRole("button", { name: "Мимо" }).click();
  await page.getByRole("button", { name: `Подтвердить ${segment}` }).click();
}

async function scoreToForty(page: import("@playwright/test").Page) {
  for (let turn = 0; turn < 2; turn += 1) {
    await page.getByRole("button", { name: "×3" }).click();
    await page.getByRole("button", { name: "Сектор 20, множитель 3" }).click();
    await page.getByRole("button", { name: "×3" }).click();
    await page.getByRole("button", { name: "Сектор 20, множитель 3" }).click();
    await page.getByRole("button", { name: "×3" }).click();
    await page.getByRole("button", { name: "Сектор 20, множитель 3" }).click();
    await page.getByRole("button", { name: "Подтвердить 180" }).click();
    await missVisit(page);
  }
  await page.getByRole("button", { name: "×3" }).click();
  await page.getByRole("button", { name: "Сектор 20, множитель 3" }).click();
  await page.getByRole("button", { name: "Сектор 1, множитель 1" }).click();
  await page.getByRole("button", { name: "×2" }).click();
  await page.getByRole("button", { name: "Сектор 20, множитель 2" }).click();
  await page.getByRole("button", { name: "Подтвердить 101" }).click();
  await missVisit(page);
  await expect(page.locator(".main-score").first()).toHaveText("40");
}

async function scoreToFifty(page: import("@playwright/test").Page) {
  for (let turn = 0; turn < 2; turn += 1) {
    for (let dart = 0; dart < 3; dart += 1) {
      await page.getByRole("button", { name: "×3" }).click();
      await page.getByRole("button", { name: "Сектор 20, множитель 3" }).click();
    }
    await page.getByRole("button", { name: "Подтвердить 180" }).click();
    await missVisit(page);
  }
  await page.getByRole("button", { name: "×3" }).click();
  await page.getByRole("button", { name: "Сектор 20, множитель 3" }).click();
  await page.getByRole("button", { name: "Сектор 11, множитель 1" }).click();
  await page.getByRole("button", { name: "×2" }).click();
  await page.getByRole("button", { name: "Сектор 10, множитель 2" }).click();
  await page.getByRole("button", { name: "Подтвердить 91" }).click();
  await missVisit(page);
  await expect(page.locator(".main-score").first()).toHaveText("50");
}

async function scoreToFourteen(page: import("@playwright/test").Page) {
  for (let turn = 0; turn < 2; turn += 1) {
    for (let dart = 0; dart < 3; dart += 1) {
      await page.getByRole("button", { name: "×3" }).click();
      await page.getByRole("button", { name: "Сектор 20, множитель 3" }).click();
    }
    await page.getByRole("button", { name: "Подтвердить 180" }).click();
    await missVisit(page);
  }
  await page.getByRole("button", { name: "×3" }).click();
  await page.getByRole("button", { name: "Сектор 20, множитель 3" }).click();
  await page.getByRole("button", { name: "×3" }).click();
  await page.getByRole("button", { name: "Сектор 19, множитель 3" }).click();
  await page.getByRole("button", { name: "Сектор 10, множитель 1" }).click();
  await page.getByRole("button", { name: "Подтвердить 127" }).click();
  await missVisit(page);
  await expect(page.locator(".main-score").first()).toHaveText("14");
}

async function scoreToOne(page: import("@playwright/test").Page) {
  for (let turn = 0; turn < 2; turn += 1) {
    for (let dart = 0; dart < 3; dart += 1) {
      await page.getByRole("button", { name: "×3" }).click();
      await page.getByRole("button", { name: "Сектор 20, множитель 3" }).click();
    }
    await page.getByRole("button", { name: "Подтвердить 180" }).click();
    await missVisit(page);
  }
  await page.getByRole("button", { name: "×3" }).click();
  await page.getByRole("button", { name: "Сектор 20, множитель 3" }).click();
  await page.getByRole("button", { name: "×3" }).click();
  await page.getByRole("button", { name: "Сектор 20, множитель 3" }).click();
  await page.getByRole("button", { name: "Сектор 20, множитель 1" }).click();
  await page.getByRole("button", { name: "Подтвердить 140" }).click();
  await missVisit(page);
  await expect(page.locator(".main-score").first()).toHaveText("1");
}

async function scoreToSixty(page: import("@playwright/test").Page) {
  for (let turn = 0; turn < 2; turn += 1) {
    for (let dart = 0; dart < 3; dart += 1) {
      await page.getByRole("button", { name: "×3" }).click();
      await page.getByRole("button", { name: "Сектор 20, множитель 3" }).click();
    }
    await page.getByRole("button", { name: "Подтвердить 180" }).click();
    await missVisit(page);
  }
  await page.getByRole("button", { name: "×3" }).click();
  await page.getByRole("button", { name: "Сектор 20, множитель 3" }).click();
  await page.getByRole("button", { name: "Сектор 1, множитель 1" }).click();
  await page.getByRole("button", { name: "Сектор 20, множитель 1" }).click();
  await page.getByRole("button", { name: "Подтвердить 81" }).click();
  await missVisit(page);
  await expect(page.locator(".main-score").first()).toHaveText("60");
}

test("501: draft can be replaced and only Confirm changes the match", async ({ page }) => {
  await startMatch(page);
  await page.getByRole("button", { name: "×3" }).click();
  await page.getByRole("button", { name: "Сектор 20, множитель 3" }).click();
  await page.getByRole("button", { name: "Сектор 5, множитель 1" }).click();
  await page.getByRole("button", { name: "×3" }).click();
  await page.getByRole("button", { name: "Сектор 17, множитель 3" }).click();

  await expect(page.getByRole("button", { name: "Дротик 1: T20, заменить" })).toBeVisible();
  await expect(page.getByText("501", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Дротик 2: S5, заменить" }).click();
  await page.getByRole("button", { name: "Сектор 1, множитель 1" }).click();
  await expect(page.getByRole("button", { name: "Дротик 2: S1, заменить" })).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить 112" }).click();
  await expect(page.getByText("Текущий подход: Игрок 2")).toBeVisible();
  await expect(page.locator(".main-score").first()).toHaveText("389");
});

test("setup supports 3, 5, and 8 players without exceeding the UI limit", async ({ page }) => {
  await page.goto("/");
  const add = page.getByRole("button", { name: "+ Добавить игрока" });
  for (let count = 2; count < 8; count += 1) await add.click();
  await expect(add).toBeHidden();
  await expect(page.getByRole("textbox")).toHaveCount(8);
  await page.getByRole("button", { name: "Начать" }).click();
  await expect(page.getByRole("region", { name: "Счёт игроков" }).locator("article")).toHaveCount(8);
  await expect(page.getByText("Текущий подход: Игрок 1")).toBeVisible();
});

test("fixed visits completes only after equal visits for both players", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Серия" }).click();
  await page.getByRole("button", { name: "5", exact: true }).click();
  await page.getByRole("button", { name: "Начать" }).click();

  for (let visit = 0; visit < 5; visit += 1) {
    await page.getByRole("button", { name: "×3" }).click();
    await page.getByRole("button", { name: "Сектор 20, множитель 3" }).click();
    await page.getByRole("button", { name: "Мимо" }).click();
    await page.getByRole("button", { name: "Мимо" }).click();
    await page.getByRole("button", { name: "Подтвердить 60" }).click();
    await page.getByRole("button", { name: "Мимо" }).click();
    await page.getByRole("button", { name: "Мимо" }).click();
    await page.getByRole("button", { name: "Мимо" }).click();
    await page.getByRole("button", { name: "Подтвердить 0" }).click();
  }

  await expect(page.getByRole("heading", { name: "Игрок 1 победил" })).toBeVisible();
  await expect(page.getByText("300", { exact: true })).toBeVisible();
});

test("501: S20 + S20 straight-out completes the match and Undo restores it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Начать" }).click();
  await scoreToForty(page);
  await page.getByRole("button", { name: "Сектор 20, множитель 1" }).click();
  await page.getByRole("button", { name: "Сектор 20, множитель 1" }).click();
  await expect(page.getByText("После подтверждения")).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить 40" }).click();
  await expect(page.getByRole("heading", { name: "Игрок 1 победил" })).toBeVisible();
  await page.getByRole("button", { name: "Отменить предыдущий подход" }).click();
  await expect(page.getByText("Текущий подход: Игрок 1")).toBeVisible();
  await expect(page.locator(".main-score").first()).toHaveText("40");
});

test("501 busts preserve the score until Confirm and hand over the turn", async ({ page }) => {
  await startMatch(page);
  await scoreToForty(page);
  await page.getByRole("button", { name: "×3" }).click();
  await page.getByRole("button", { name: "Сектор 20, множитель 3" }).click();
  await expect(page.getByText("Перебор", { exact: true })).toBeVisible();
  await expect(page.locator(".main-score").first()).toHaveText("40");
  await expect(page.getByRole("button", { name: "Мимо" })).toBeDisabled();
  await page.getByRole("button", { name: /подтвердить перебор/i }).click();
  await expect(page.locator(".main-score").first()).toHaveText("40");
  await expect(page.getByText("Текущий подход: Игрок 2")).toBeVisible();
});

test("501 accepts Bull as an ordinary one-dart straight-out", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Начать" }).click();
  await scoreToFifty(page);
  await page.getByRole("button", { name: "50" }).click();
  await expect(page.getByRole("button", { name: "Дротик 1: Bull, заменить" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Дротик 2: пусто" })).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить 50" }).click();
  await expect(page.getByRole("heading", { name: "Игрок 1 победил" })).toBeVisible();
});

test("reload restores confirmed play and Undo uses the persisted checkpoint", async ({ page }) => {
  await startMatch(page);
  await page.getByRole("button", { name: "Сектор 20, множитель 1" }).click();
  await page.getByRole("button", { name: "Мимо" }).click();
  await page.getByRole("button", { name: "Мимо" }).click();
  await page.getByRole("button", { name: "Подтвердить 20" }).click();
  await expect(page.getByText("Текущий подход: Игрок 2")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page.getByText("Текущий подход: Игрок 2")).toBeVisible();
  await page.getByRole("button", { name: "Отменить предыдущий подход" }).click();
  await expect(page.getByText("Текущий подход: Игрок 1")).toBeVisible();
  await expect(page.locator(".main-score").first()).toHaveText("501");
});

test("fixed visits tie can start an extra round and safely tie again", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Серия" }).click();
  await page.getByRole("button", { name: "5", exact: true }).click();
  await page.getByRole("button", { name: "Начать" }).click();
  for (let visit = 0; visit < 10; visit += 1) await missVisit(page);
  await expect(page.getByRole("heading", { name: /ничья/i })).toBeVisible();
  await page.getByRole("button", { name: /дополнительный подход/i }).click();
  await missVisit(page);
  await expect(page.getByText("Текущий подход: Игрок 2")).toBeVisible();
  await missVisit(page);
  await expect(page.getByRole("heading", { name: /ничья/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /дополнительный подход/i })).toBeVisible();
});

test("abandon archives confirmed play and does not offer resume after reload", async ({ page }) => {
  await startMatch(page);
  await missVisit(page);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Прервать матч" }).click();
  await page.getByRole("button", { name: "История" }).click();
  await expect(page.getByText("Матч прерван")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Продолжить" })).toHaveCount(0);
});

test("501 allows remaining 1 and closes it with S1", async ({ page }) => {
  await startMatch(page);
  await scoreToOne(page);
  await page.getByRole("button", { name: "Сектор 1, множитель 1" }).click();
  await expect(page.locator(".main-score").first()).toHaveText("1");
  await page.getByRole("button", { name: "Подтвердить 1" }).click();
  await expect(page.getByRole("heading", { name: "Игрок 1 победил" })).toBeVisible();
});

test("501 unlimited: S1 + S10 + S3 closes remaining 14", async ({ page }) => {
  await startMatch(page);
  await expect(page.getByText("501 · до победы")).toBeVisible();
  await scoreToFourteen(page);
  await page.getByRole("button", { name: "Сектор 1, множитель 1" }).click();
  await page.getByRole("button", { name: "Сектор 10, множитель 1" }).click();
  await page.getByRole("button", { name: "Сектор 3, множитель 1" }).click();
  await expect(page.locator(".main-score").first()).toHaveText("14");
  await page.getByRole("button", { name: "Подтвердить 14" }).click();
  await expect(page.getByRole("heading", { name: "Игрок 1 победил" })).toBeVisible();
});

test("finalize archives a completed match and history survives reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Начать" }).click();
  await scoreToForty(page);
  await page.getByRole("button", { name: "Сектор 20, множитель 1" }).click();
  await page.getByRole("button", { name: "Сектор 20, множитель 1" }).click();
  await page.getByRole("button", { name: "Подтвердить 40" }).click();
  await expect(page.getByRole("heading", { name: "Игрок 1 победил" })).toBeVisible();
  await page.getByRole("button", { name: "Завершить" }).click();
  await expect(page.getByRole("button", { name: "Продолжить" })).toHaveCount(0);
  await page.getByRole("button", { name: "История" }).click();
  await expect(page.getByText("Игрок 1 — Игрок 2")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Продолжить" })).toHaveCount(0);
  await page.getByRole("button", { name: "История" }).click();
  await expect(page.getByText("Игрок 1 — Игрок 2")).toBeVisible();
});

test("limited 501 picks the minimum remaining only after both players finish the final round", async ({ page }) => {
  await startLimited501(page);
  await page.getByRole("button", { name: "Сектор 20, множитель 1" }).click();
  await page.getByRole("button", { name: "Мимо" }).click();
  await page.getByRole("button", { name: "Мимо" }).click();
  await page.getByRole("button", { name: "Подтвердить 20" }).click();
  await missVisit(page);
  for (let round = 1; round < 5; round += 1) {
    await missVisit(page);
    if (round === 4) await expect(page.getByText("Текущий подход: Игрок 2")).toBeVisible();
    await missVisit(page);
  }
  await expect(page.getByRole("heading", { name: "Игрок 1 победил" })).toBeVisible();
});

test("limited 501 ends immediately when zero is reached before the visit limit", async ({ page }) => {
  await startLimited501(page, 2, 20);
  await scoreToSixty(page);
  await page.getByRole("button", { name: "×3" }).click();
  await page.getByRole("button", { name: "Сектор 20, множитель 3" }).click();
  await expect(page.getByRole("button", { name: "Дротик 2: пусто" })).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить 60" }).click();
  await expect(page.getByRole("heading", { name: "Игрок 1 победил" })).toBeVisible();
});

test("three-player limited 501 waits for the third player's final visit", async ({ page }) => {
  await startLimited501(page, 3);
  await page.getByRole("button", { name: "Сектор 20, множитель 1" }).click();
  await page.getByRole("button", { name: "Мимо" }).click();
  await page.getByRole("button", { name: "Мимо" }).click();
  await page.getByRole("button", { name: "Подтвердить 20" }).click();
  await missVisit(page);
  await missVisit(page);
  for (let round = 1; round < 5; round += 1) {
    await missVisit(page);
    if (round === 4) await expect(page.getByText("Текущий подход: Игрок 2")).toBeVisible();
    await missVisit(page);
    if (round === 4) {
      await expect(page.getByText("Текущий подход: Игрок 3")).toBeVisible();
      await expect(page.getByRole("heading", { name: /победил/ })).toHaveCount(0);
    }
    await missVisit(page);
  }
  await expect(page.getByRole("heading", { name: "Игрок 1 победил" })).toBeVisible();
});

test("limited 501 repeats a tied extra round and resolves only after every leader visits", async ({ page }) => {
  await startLimited501(page);
  for (let visit = 0; visit < 10; visit += 1) await missVisit(page);
  await expect(page.getByRole("heading", { name: "Ничья" })).toBeVisible();
  await page.getByRole("button", { name: "Сыграть дополнительный подход" }).click();
  await missVisit(page);
  await expect(page.getByText("Текущий подход: Игрок 2")).toBeVisible();
  await missVisit(page);
  await expect(page.getByRole("heading", { name: "Ничья" })).toBeVisible();
  await page.getByRole("button", { name: "Сыграть дополнительный подход" }).click();
  await page.getByRole("button", { name: "Сектор 20, множитель 1" }).click();
  await page.getByRole("button", { name: "Мимо" }).click();
  await page.getByRole("button", { name: "Мимо" }).click();
  await page.getByRole("button", { name: "Подтвердить 20" }).click();
  await expect(page.getByText("Текущий подход: Игрок 2")).toBeVisible();
  await expect(page.getByRole("heading", { name: /победил/ })).toHaveCount(0);
  await missVisit(page);
  await expect(page.getByRole("heading", { name: "Игрок 1 победил" })).toBeVisible();
});

test("active draft survives reload and remains unconfirmed until explicit Confirm", async ({ page }) => {
  await startMatch(page);
  await page.getByRole("button", { name: "×3" }).click();
  await page.getByRole("button", { name: "Сектор 20, множитель 3" }).click();
  await page.getByRole("button", { name: "Сектор 10, множитель 1" }).click();
  await expect(page.locator(".main-score").first()).toHaveText("501");

  await page.reload();
  await expect(page.getByText("Незавершённый подход · 2/3")).toBeVisible();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page.getByRole("button", { name: "Дротик 1: T20, заменить" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Дротик 2: S10, заменить" })).toBeVisible();
  await expect(page.locator(".main-score").first()).toHaveText("501");
  await page.getByRole("button", { name: "Сектор 5, множитель 1" }).click();
  await page.getByRole("button", { name: "Подтвердить 75" }).click();
  await expect(page.locator(".main-score").first()).toHaveText("426");
});

test("active draft survives navigation to home and history", async ({ page }) => {
  await startMatch(page);
  await page.getByRole("button", { name: "Сектор 20, множитель 1" }).click();
  await page.getByRole("button", { name: "На главный экран" }).click();
  await expect(page.getByText("Незавершённый подход · 1/3")).toBeVisible();
  await page.getByRole("button", { name: "История" }).click();
  await page.getByRole("button", { name: "‹" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page.getByRole("button", { name: "Дротик 1: S20, заменить" })).toBeVisible();
  await expect(page.locator(".main-score").first()).toHaveText("501");
});

test("active match and draft survive reopening in a new page", async ({ page }) => {
  await startMatch(page);
  await missVisit(page);
  await page.getByRole("button", { name: "Сектор 10, множитель 1" }).click();
  const reopened = await page.context().newPage();
  await page.close();
  await reopened.goto("/");
  await expect(reopened.getByText("Незавершённый подход · 1/3")).toBeVisible();
  await reopened.getByRole("button", { name: "Продолжить" }).click();
  await expect(reopened.getByText("Текущий подход: Игрок 2")).toBeVisible();
  await expect(reopened.getByRole("button", { name: "Дротик 1: S10, заменить" })).toBeVisible();
});

test("starting another game requires an explicit choice and preserves the active draft on cancel", async ({ page }) => {
  await startMatch(page);
  await page.getByRole("button", { name: "Сектор 20, множитель 1" }).click();
  await page.getByRole("button", { name: "На главный экран" }).click();
  await page.getByRole("button", { name: "Начать" }).click();
  const dialog = page.getByRole("dialog", { name: "У вас уже есть незавершённая игра" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Отмена" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page.getByRole("button", { name: "Дротик 1: S20, заменить" })).toBeVisible();
});

test("abandon clears an unconfirmed draft without adding it to history", async ({ page }) => {
  await startMatch(page);
  await page.getByRole("button", { name: "Сектор 20, множитель 1" }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Прервать матч" }).click();
  await page.getByRole("button", { name: "История" }).click();
  await expect(page.getByText("Матч прерван")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Продолжить" })).toHaveCount(0);
});

test("statistics shows confirmed scoring, hits, reload persistence and mobile-safe layout", async ({ page }) => {
  await startOneVisitSeries(page);
  await page.getByRole("button", { name: "×3" }).click();
  await page.getByRole("button", { name: "Сектор 20, множитель 3" }).click();
  await page.getByRole("button", { name: "Мимо" }).click();
  await page.getByRole("button", { name: "×2" }).click();
  await page.getByRole("button", { name: "Сектор 20, множитель 2" }).click();
  await page.getByRole("button", { name: "Подтвердить 100" }).click();
  await missVisit(page);
  await page.getByRole("button", { name: "Завершить" }).click();
  await page.getByRole("button", { name: "Статистика" }).click();
  await page.getByRole("button", { name: /Игрок 1.*Среднее за 3 дротика 100\.0/ }).click();
  await expect(page.getByText("100.0", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("100", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Попадания" }).click();
  await expect(page.getByText("Утроения").first()).toBeVisible();
  await expect(page.getByText("Промахи").first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Статистика" }).click();
  await expect(page.getByRole("button", { name: /Игрок 1.*100\.0/ })).toBeVisible();
});

test("a second match can reuse saved player ids, announces a real record and produces a trend", async ({ page }) => {
  await startOneVisitSeries(page);
  await scoringVisit(page, 1);
  await missVisit(page);
  await page.getByRole("button", { name: "Завершить" }).click();

  await page.getByLabel("Выбрать сохранённого игрока 1").selectOption({ label: "Игрок 1" });
  await page.getByLabel("Выбрать сохранённого игрока 2").selectOption({ label: "Игрок 2" });
  await page.getByRole("button", { name: "Серия" }).click();
  await page.getByRole("button", { name: "Другое" }).click();
  await page.getByLabel("Другое количество подходов").fill("1");
  await page.getByRole("button", { name: "Начать" }).click();
  await scoringVisit(page, 20);
  await missVisit(page);
  await expect(page.getByRole("heading", { name: "🏆 Новый личный рекорд" })).toBeVisible();
  await expect(page.getByText("Игрок 1 · Лучший подход")).toBeVisible();
  await page.getByRole("button", { name: "Завершить" }).click();
  await page.getByRole("button", { name: "Статистика" }).click();
  await page.getByRole("button", { name: /Игрок 1/ }).click();
  await page.getByRole("button", { name: "Динамика" }).click();
  await expect(page.getByLabel("Среднее за 3 дротика", { exact: true })).toBeVisible();
});

test("comparison counts a multiplayer third-player winner as an other-player result", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startOneVisitSeries(page, 3);
  await missVisit(page);
  await missVisit(page);
  await scoringVisit(page, 20);
  await page.getByRole("button", { name: "Завершить" }).click();
  await page.getByRole("button", { name: "Статистика" }).click();
  await page.getByRole("button", { name: "Сравнить игроков" }).click();
  await expect(page.getByRole("heading", { name: "Личные встречи" })).toBeVisible();
  await expect(page.getByText("Совместных матчей: 1")).toBeVisible();
  await expect(page.getByText("Победы других игроков: 1")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("player statistics mode filter switches between 501 and scoring series", async ({ page }) => {
  await startOneVisitSeries(page);
  await scoringVisit(page, 1);
  await missVisit(page);
  await page.getByRole("button", { name: "Завершить" }).click();
  await page.getByLabel("Выбрать сохранённого игрока 1").selectOption({ label: "Игрок 1" });
  await page.getByLabel("Выбрать сохранённого игрока 2").selectOption({ label: "Игрок 2" });
  await page.getByRole("button", { name: "Начать" }).click();
  await scoringVisit(page, 20);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Прервать матч" }).click();
  await page.getByRole("button", { name: "Статистика" }).click();
  await page.getByRole("button", { name: /Игрок 1/ }).click();
  const mode = page.locator(".stats-filters").getByLabel("Режим");
  await mode.selectOption("fixed_visits");
  await expect(page.getByText("Лучший подход").locator("..").getByText("1", { exact: true })).toBeVisible();
  await mode.selectOption("x01");
  await expect(page.getByText("Лучший подход").locator("..").getByText("20", { exact: true })).toBeVisible();
});

```

---

## `eslint.config.js`

```js
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'error'
    }
  },
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['**/application/**', '**/infrastructure/**', '**/presentation/**', 'react'] }] }
  },
  {
    files: ['src/application/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['**/presentation/**', '**/infrastructure/**', 'react'] }] }
  },
  {
    files: ['src/presentation/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['**/infrastructure/**'] }] }
  }
);

```

---

## `package.json`

```json
{
  "name": "dart-scorekeeper",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "preview": "vite preview --host 0.0.0.0 --port 4173 --strictPort",
    "tunnel": "cloudflared tunnel --url http://localhost:4173 --http-host-header localhost",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "typecheck": "tsc -b --pretty false",
    "test:e2e": "playwright test",
    "lint": "eslint ."
  },
  "dependencies": {
    "@vitejs/plugin-react": "latest",
    "idb": "latest",
    "react": "latest",
    "react-dom": "latest",
    "vite": "latest",
    "vite-plugin-pwa": "latest"
  },
  "devDependencies": {
    "@eslint/js": "latest",
    "@playwright/test": "^1.63.0",
    "@testing-library/jest-dom": "latest",
    "@testing-library/react": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "eslint": "latest",
    "eslint-plugin-react-hooks": "latest",
    "eslint-plugin-react-refresh": "latest",
    "fake-indexeddb": "latest",
    "globals": "latest",
    "jsdom": "latest",
    "typescript": "latest",
    "typescript-eslint": "latest",
    "vitest": "latest"
  }
}

```

---

## `playwright.config.ts`

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

```

---

## `README.md`

```markdown
# Счётчик дартса

## Удалённое тестирование с телефона

Это способ временно открыть **локальную production-сборку** на телефоне, даже если телефон и ноутбук находятся в разных сетях. Он не публикует репозиторий и не создаёт постоянный deployment.

### Один раз: установить Cloudflare Tunnel

На Windows установите `cloudflared`, например:

```powershell
winget install --id Cloudflare.cloudflared
cloudflared --version
```

После установки откройте новый терминал, если команда ещё не находится в `PATH`.

### Запуск

В первом терминале соберите приложение и запустите production preview:

```powershell
npm run build
npm run preview
```

Preview слушает порт `4173` на ноутбуке (`0.0.0.0:4173`). Во втором терминале запустите временный HTTPS-туннель:

```powershell
npm run tunnel
```

Эквивалентная команда без npm script:

```powershell
cloudflared tunnel --url http://localhost:4173 --http-host-header localhost
```

`cloudflared` напечатает адрес вида `https://<случайное-имя>.trycloudflare.com`. Откройте именно этот HTTPS-адрес на телефоне. URL временный: он прекращает работать после остановки `cloudflared` и при следующем запуске будет другим.

Чтобы завершить тестирование, нажмите `Ctrl+C` сначала в окне туннеля, затем в окне preview.

### Что проверять

HTTPS-туннель позволяет зарегистрировать Service Worker и загрузить PWA-ресурсы с внешнего хоста. Туннель передаёт Vite фиксированный `Host: localhost`, поэтому `vite preview` не разрешает произвольные внешние `Host`-заголовки.

Данные матча хранятся локально в IndexedDB конкретного браузера. Телефон и ноутбук не синхронизируют матчи друг с другом: для проверки reload и active match продолжайте тест на том же устройстве и в том же браузере.

```

---

## `src/App.tsx`

```tsx
import { useEffect, useState } from "react";
import { createMatch, type MatchSetup } from "./domain/match/createMatch";
import type { Match, Player } from "./domain/match/models";
import { GameSession, type SessionSnapshot } from "./application/GameSession";
import { services } from "./app/compositionRoot";
import { SetupPage, type SetupParticipant } from "./presentation/pages/SetupPage";
import { GamePage } from "./presentation/pages/GamePage";
import { HistoryPage } from "./presentation/pages/HistoryPage";
import { StatisticsPage } from "./presentation/pages/StatisticsPage";
import "./presentation/styles.css";
import "./presentation/concept-overrides.css";
import "./presentation/active-game.css";
import "./presentation/statistics.css";

type Screen = "loading" | "home" | "game" | "history" | "statistics";
export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [players, setPlayers] = useState<readonly Player[]>([]);
  const [history, setHistory] = useState<readonly Match[]>([]);
  const [session, setSession] = useState<GameSession>();
  const [snapshot, setSnapshot] = useState<SessionSnapshot>();
  const [resume, setResume] = useState<{
    session: GameSession;
    snapshot: SessionSnapshot;
  }>();
  const [fatal, setFatal] = useState<string>();
  const [pendingStart, setPendingStart] = useState<{
    participants: readonly SetupParticipant[];
    setup: MatchSetup;
  }>();
  useEffect(() => {
    void Promise.all([
      services.players.list(),
      services.matches.listHistory(),
      services.matches.loadActive(),
    ])
      .then(([p, h, a]) => {
        setPlayers(p);
        setHistory(h);
        if (
          a?.current.status === "in_progress" ||
          a?.current.status === "completed"
        ) {
          const s = new GameSession(
            a.current,
            services.matches,
            services.id,
            services.now,
            a.previous,
            a.draft,
            a.draftRecovery,
          );
          setResume({
            session: s,
            snapshot: s.snapshot(),
          });
        }
        setScreen("home");
      })
      .catch((e) => {
        setFatal(
          e instanceof Error ? e.message : "Ошибка локального хранилища",
        );
        setScreen("home");
      });
  }, []);
  const performStart = async (participants: readonly SetupParticipant[], setup: MatchSetup) => {
    const now = services.now();
    const resolveParticipant = async (participant: SetupParticipant) => {
      const existing = participant.playerId
        ? players.find((player) => player.id === participant.playerId)
        : undefined;
      if (existing) return existing;
      const p: Player = { id: services.id(), name: participant.name, createdAt: now };
      await services.players.save(p);
      return p;
    };
    const selectedPlayers = await Promise.all(participants.map(resolveParticipant));
    const selectedIds = new Set(selectedPlayers.map((player) => player.id));
    const all = [
      ...players.filter((player) => !selectedIds.has(player.id)),
      ...selectedPlayers,
    ];
    setPlayers(all);
    const match = createMatch(
      services.id(),
      selectedPlayers.map((player) => player.id),
      setup,
      now,
    );
    await services.matches.saveActive({
      current: match,
      draft: {
        playerId: match.players[match.currentPlayerIndex]!,
        draft: { darts: [] },
      },
    });
    const s = new GameSession(
      match,
      services.matches,
      services.id,
      services.now,
    );
    setSession(s);
    setSnapshot(s.snapshot());
    setResume(undefined);
    setScreen("game");
  };
  const start = async (participants: readonly SetupParticipant[], setup: MatchSetup) => {
    if (resume) {
      setPendingStart({ participants, setup });
      return;
    }
    await performStart(participants, setup);
  };
  const leave = async () => {
    setSession(undefined);
    setSnapshot(undefined);
    setResume(undefined);
    setHistory(await services.matches.listHistory());
    setScreen("home");
  };
  const backToHome = () => {
    if (session && snapshot) setResume({ session, snapshot });
    setSession(undefined);
    setSnapshot(undefined);
    setScreen("home");
  };
  if (screen === "loading")
    return <main className="loading">Загружаем дартс…</main>;
  if (screen === "game" && session && snapshot)
    return (
      <GamePage
        key={snapshot.match.id}
        session={session}
        initial={snapshot}
        players={players}
        previousMatches={history}
        onChange={setSnapshot}
        onBack={backToHome}
        onClosed={() => void leave()}
      />
    );
  if (screen === "history")
    return (
      <HistoryPage
        matches={history}
        players={players}
        onBack={() => setScreen("home")}
      />
    );
  if (screen === "statistics")
    return <StatisticsPage matches={history} players={players} onBack={() => setScreen("home")} />;
  return (
    <>
      {fatal ? <div className="fatal" role="alert">{fatal} <button className="secondary" onClick={()=>void services.clearLocalData().then(()=>location.reload())}>Сбросить повреждённые данные</button></div> : null}
      {resume ? (
        <aside className="resume">
          <div>
            <b>Продолжить матч</b>
            <span>
              {resume.snapshot.match.mode === "x01" ? "501" : "Серия"} ·
              {" "}{resume.snapshot.match.players.map((id) => players.find((p) => p.id === id)?.name ?? "Игрок").join(" / ")}
            </span>
            <span>
              Ход: {players.find((p) => p.id === resume.snapshot.match.players[resume.snapshot.match.currentPlayerIndex])?.name ?? "Игрок"}
              {resume.snapshot.match.state.kind === "x01" ? ` · остаток: ${resume.snapshot.match.state.remaining[resume.snapshot.match.players[resume.snapshot.match.currentPlayerIndex]!]}` : ""}
            </span>
            {resume.snapshot.draft.darts.length > 0 ? (
              <span>Незавершённый подход · {resume.snapshot.draft.darts.length}/3</span>
            ) : null}
          </div>
          <button
            className="primary"
            onClick={() => {
              setSession(resume.session);
              setSnapshot(resume.snapshot);
              setScreen("game");
            }}
          >
            Продолжить
          </button>
          <button
            className="secondary"
            onClick={() => {
              if (!window.confirm("Прервать текущий матч? Незавершённый подход не попадёт в историю.")) return;
              void resume.session.abandon().then(leave).catch((e) =>
                setFatal(e instanceof Error ? e.message : "Ошибка сохранения"),
              );
            }}
          >
            Прервать матч
          </button>
        </aside>
      ) : null}
      <SetupPage
        saved={players}
        onStart={start}
        onHistory={() => setScreen("history")}
        onStatistics={() => setScreen("statistics")}
      />
      {pendingStart && resume ? (
        <div className="dialog-backdrop">
          <section className="active-dialog" role="dialog" aria-modal="true" aria-labelledby="active-match-title">
            <h2 id="active-match-title">У вас уже есть незавершённая игра</h2>
            <p>Новая игра не заменит её без вашего явного выбора.</p>
            <button className="primary" onClick={() => {
              setPendingStart(undefined);
              setSession(resume.session);
              setSnapshot(resume.snapshot);
              setScreen("game");
            }}>Продолжить текущую</button>
            <button className="secondary" onClick={() => {
              const requested = pendingStart;
              void (resume.snapshot.match.status === "completed"
                ? resume.session.finalize()
                : resume.session.abandon())
                .then(async () => {
                  setPendingStart(undefined);
                  setResume(undefined);
                  setHistory(await services.matches.listHistory());
                  await performStart(requested.participants, requested.setup);
                })
                .catch((e) => setFatal(e instanceof Error ? e.message : "Ошибка сохранения"));
            }}>Покинуть текущую и начать новую</button>
            <button className="secondary" onClick={() => setPendingStart(undefined)}>Отмена</button>
          </section>
        </div>
      ) : null}
    </>
  );
}

```

---

## `src/app/compositionRoot.ts`

```ts
import { IndexedDbMatchRepository, IndexedDbPlayerRepository, LocalSettingsRepository, clearLocalData } from '../infrastructure/persistence/IndexedDbRepositories';
export const services = { matches:new IndexedDbMatchRepository(), players:new IndexedDbPlayerRepository(), settings:new LocalSettingsRepository(), clearLocalData, id:()=>crypto.randomUUID(), now:()=>new Date().toISOString() };

```

---

## `src/application/GameSession.ts`

```ts
import {
  addDraftThrow,
  emptyDraft,
  removeDraftThrow,
  replaceDraftThrow,
  resetDraft,
  truncateDraft,
  type VisitDraft,
} from "../domain/match/VisitDraft";
import {
  currentPlayerId,
  visitContext,
  type Match,
  type Visit,
} from "../domain/match/models";
import type { DartThrow } from "../domain/darts/DartThrow";
import type { DraftEvaluation } from "../domain/rules/GameRules";
import { rulesFor } from "../domain/rules/rulesFor";
import {
  finishAsDraw,
  startExtraRound as startFixedVisitsExtraRound,
} from "../domain/rules/FixedVisitsRules";
import { startX01ExtraRound } from "../domain/rules/X01Rules";
import type {
  ActiveMatchRecord,
  ActiveVisitDraft,
  MatchRepository,
} from "./ports/repositories";

export type IdGenerator = () => string;
export type Clock = () => string;
export type SessionSnapshot = Readonly<{
  match: Match;
  draft: VisitDraft;
  evaluation: DraftEvaluation;
  isConfirming: boolean;
  notice?: string;
}>;
export class GameSession {
  private draft: VisitDraft = emptyDraft();
  private checkpoints: Match[] = [];
  private confirming = false;
  private notice: string | undefined;
  constructor(
    private match: Match,
    private readonly repository: MatchRepository,
    private readonly id: IdGenerator,
    private readonly now: Clock,
    previous?: Match,
    restoredDraft?: ActiveVisitDraft,
    draftRecovery?: ActiveMatchRecord["draftRecovery"],
  ) {
    if (previous) this.checkpoints.push(previous);
    if (restoredDraft) {
      if (restoredDraft.playerId !== currentPlayerId(match))
        throw new Error("Сохранённый подход не соответствует текущему игроку");
      this.draft = restoredDraft.draft;
    }
    if (draftRecovery === "discarded_corrupt")
      this.notice = "Повреждённый незавершённый подход сброшен. Сам матч восстановлен.";
  }
  snapshot(): SessionSnapshot {
    const value = {
      match: this.match,
      draft: this.draft,
      evaluation: rulesFor(this.match).evaluateDraft(this.draft, this.match),
      isConfirming: this.confirming,
    };
    return this.notice ? { ...value, notice: this.notice } : value;
  }
  async record(dart: DartThrow, replaceIndex?: number): Promise<SessionSnapshot> {
    this.ensureMutable();
    this.ensureInput();
    const changed =
      replaceIndex === undefined
        ? addDraftThrow(this.draft, dart)
        : replaceDraftThrow(this.draft, replaceIndex, dart);
    const { draft, notice } = this.normalize(changed);
    return this.persistDraft(draft, notice);
  }
  async remove(index?: number): Promise<SessionSnapshot> {
    this.ensureMutable();
    this.ensureInput();
    return this.persistDraft(removeDraftThrow(this.draft, index));
  }
  async reset(): Promise<SessionSnapshot> {
    this.ensureMutable();
    return this.persistDraft(resetDraft());
  }
  private normalize(draft: VisitDraft): Readonly<{ draft: VisitDraft; notice?: string }> {
    const evaluation = rulesFor(this.match).evaluateDraft(draft, this.match);
    return evaluation.validDartCount < draft.darts.length
      ? {
          draft: truncateDraft(draft, evaluation.validDartCount),
          notice: "Поздние дротики удалены: подход завершился раньше."
        }
      : { draft };
  }
  private activeRecord(
    current: Match = this.match,
    draft: VisitDraft = this.draft,
    previous: Match | undefined = this.checkpoints.at(-1),
  ): ActiveMatchRecord {
    const base = {
      current,
      draft: { playerId: currentPlayerId(current), draft },
    };
    return previous ? { ...base, previous } : base;
  }
  private async persistDraft(draft: VisitDraft, notice?: string): Promise<SessionSnapshot> {
    this.confirming = true;
    try {
      await this.repository.saveActive(this.activeRecord(this.match, draft));
      this.draft = draft;
      this.notice = notice;
    } finally {
      this.confirming = false;
    }
    return this.snapshot();
  }
  private ensureInput(): void {
    if (this.match.status !== "in_progress") throw new Error("Матч завершён");
    if (
      (this.match.state.kind === "fixed_visits" &&
        this.match.state.awaitingTieDecision) ||
      (this.match.state.kind === "x01" &&
        this.match.state.phase.kind === "awaiting_tie_break")
    )
      throw new Error("Сначала выберите результат ничьей");
  }
  private ensureMutable(): void {
    if (this.confirming) throw new Error("Подтверждение уже выполняется");
  }
  async confirm(): Promise<SessionSnapshot> {
    if (this.confirming) return this.snapshot();
    this.ensureInput();
    const rules = rulesFor(this.match);
    const evaluation = rules.evaluateDraft(this.draft, this.match);
    if (evaluation.status === "in_progress")
      throw new Error(
        this.match.mode === "fixed_visits"
          ? "Введите ровно три дротика"
          : "Введите дротик",
      );
    this.confirming = true;
    try {
      const previous = this.match;
      const timestamp = this.now();
      const before = visitContext(previous);
      const playerId = currentPlayerId(previous);
      const provisionalResult =
        evaluation.status === "bust"
          ? "bust"
          : evaluation.status === "match_won"
              ? "match_won"
              : "scored";
      const provisionalVisit: Visit = Object.freeze({
        id: this.id(),
        matchId: previous.id,
        playerId,
        visitIndex: previous.confirmedVisits.length,
        darts: Object.freeze([...this.draft.darts]),
        physicalDartsUsed: evaluation.physicalDartsUsed,
        rawScore: evaluation.rawScore,
        awardedScore: evaluation.awardedScore,
        before,
        // `after` is replaced with the context of the authoritative rules transition below.
        after: before,
        result: provisionalResult,
        timestamp,
      });
      const applied = rules.applyConfirmedVisit(provisionalVisit, previous);
      const visit: Visit = Object.freeze({
        ...provisionalVisit,
        after: visitContext(applied),
      });
      const next: Match = {
        ...applied,
        confirmedVisits: [...applied.confirmedVisits.slice(0, -1), visit],
      };
      await this.repository.saveActive(
        this.activeRecord(next, emptyDraft(), previous),
      );
      this.checkpoints.push(previous);
      if (this.checkpoints.length > 20) this.checkpoints.shift();
      this.match = next;
      this.draft = emptyDraft();
      this.notice = undefined;
    } finally {
      this.confirming = false;
    }
    return this.snapshot();
  }
  async undo(discardDraft = false): Promise<SessionSnapshot> {
    this.ensureMutable();
    if (this.draft.darts.length > 0 && !discardDraft)
      throw new Error("Сначала сбросьте незавершённый подход");
    const previous = this.checkpoints.at(-1);
    if (!previous) throw new Error("Нет подхода для отмены");
    const fallback = this.checkpoints.at(-2);
    await this.repository.saveActive(
      this.activeRecord(previous, emptyDraft(), fallback),
    );
    this.checkpoints.pop();
    this.match = previous;
    this.draft = emptyDraft();
    this.notice = "Предыдущий подход отменён.";
    return this.snapshot();
  }
  async extraRound(): Promise<SessionSnapshot> {
    this.ensureMutable();
    const next = this.match.state.kind === "x01"
      ? startX01ExtraRound(this.match)
      : startFixedVisitsExtraRound(this.match);
    const previous = this.checkpoints.at(-1);
    await this.repository.saveActive(this.activeRecord(next, emptyDraft(), previous));
    this.match = next;
    this.draft = emptyDraft();
    return this.snapshot();
  }
  async completeDraw(): Promise<SessionSnapshot> {
    this.ensureMutable();
    const previous = this.match;
    const next = finishAsDraw(this.match, this.now());
    await this.repository.saveActive(this.activeRecord(next, emptyDraft(), previous));
    this.checkpoints.push(previous);
    this.match = next;
    this.draft = emptyDraft();
    return this.snapshot();
  }
  async abandon(): Promise<Match> {
    this.ensureMutable();
    const next: Match = {
      ...this.match,
      status: "abandoned",
      completedAt: this.now(),
    };
    await this.repository.archiveAndClearActive(next);
    this.match = next;
    return this.match;
  }
  async finalize(): Promise<Match> {
    this.ensureMutable();
    if (this.match.status !== "completed")
      throw new Error("Матч ещё не завершён");
    await this.repository.archiveAndClearActive(this.match);
    this.checkpoints = [];
    return this.match;
  }
}

```

---

## `src/application/ports/repositories.ts`

```ts
import type { VisitDraft } from '../../domain/match/VisitDraft';
import type { Match, Player, PlayerId } from '../../domain/match/models';

export type ActiveVisitDraft = Readonly<{
  playerId: PlayerId;
  draft: VisitDraft;
}>;
export type ActiveMatchRecord = Readonly<{
  current: Match;
  previous?: Match;
  draft: ActiveVisitDraft;
  draftRecovery?: "discarded_corrupt" | "missing_legacy";
}>;
export interface MatchRepository {
  saveActive(record: ActiveMatchRecord): Promise<void>;
  loadActive(): Promise<ActiveMatchRecord|undefined>;
  clearActive(): Promise<void>;
  saveToHistory(match: Match): Promise<void>;
  archiveAndClearActive(match: Match): Promise<void>;
  listHistory(): Promise<readonly Match[]>;
}
export interface PlayerRepository { list(): Promise<readonly Player[]>; save(player: Player): Promise<void>; }
export interface SettingsRepository { load(): Promise<Readonly<Record<string,string>>>; save(values: Readonly<Record<string,string>>): Promise<void>; }

```

---

## `src/domain/darts/DartThrow.ts`

```ts
export type NumberSegment = 1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20;
export type Multiplier = 1|2|3;
export type DartThrow =
  | Readonly<{ kind: 'number'; segment: NumberSegment; multiplier: Multiplier }>
  | Readonly<{ kind: 'outer_bull' }>
  | Readonly<{ kind: 'bull' }>
  | Readonly<{ kind: 'miss' }>;

export const isNumberSegment = (value: number): value is NumberSegment => Number.isInteger(value) && value >= 1 && value <= 20;
export function numberThrow(segment: number, multiplier: Multiplier): DartThrow {
  if (!isNumberSegment(segment)) throw new RangeError('Сектор должен быть от 1 до 20');
  if (![1, 2, 3].includes(multiplier))
    throw new RangeError('Множитель должен быть 1, 2 или 3');
  return Object.freeze({ kind: 'number', segment, multiplier });
}
export const outerBull = (): DartThrow => Object.freeze({ kind: 'outer_bull' });
export const bull = (): DartThrow => Object.freeze({ kind: 'bull' });
export const miss = (): DartThrow => Object.freeze({ kind: 'miss' });
export const scoreOf = (dart: DartThrow): number => dart.kind === 'number' ? dart.segment * dart.multiplier : dart.kind === 'outer_bull' ? 25 : dart.kind === 'bull' ? 50 : 0;
export const notationOf = (dart: DartThrow): string => dart.kind === 'number' ? `${dart.multiplier === 1 ? 'S' : dart.multiplier === 2 ? 'D' : 'T'}${dart.segment}` : dart.kind === 'outer_bull' ? '25' : dart.kind === 'bull' ? 'Bull' : 'MISS';
export const isDouble = (dart: DartThrow): boolean => dart.kind === 'bull' || (dart.kind === 'number' && dart.multiplier === 2);

```

---

## `src/domain/match/createMatch.ts`

```ts
import type { Match, PlayerId } from "./models";

export type MatchSetup =
  | Readonly<{
      mode: "x01";
      format:
        | Readonly<{ kind: "unlimited" }>
        | Readonly<{ kind: "limited"; visitsPerPlayer: number }>;
      startingPlayerIndex: number;
    }>
  | Readonly<{
      mode: "fixed_visits";
      visitsPerPlayer: number;
      startingPlayerIndex: number;
    }>;

export function createMatch(
  id: string,
  playerIds: readonly PlayerId[],
  setup: MatchSetup,
  now: string,
): Match {
  if (playerIds.length < 2 || new Set(playerIds).size !== playerIds.length)
    throw new Error("Матчу нужны как минимум два разных игрока");
  if (
    !Number.isInteger(setup.startingPlayerIndex) ||
    setup.startingPlayerIndex < 0 ||
    setup.startingPlayerIndex >= playerIds.length
  )
    throw new Error("Некорректный начинающий");
  if (setup.mode === "x01") {
    if (
      setup.format.kind === "limited" &&
      (!Number.isInteger(setup.format.visitsPerPlayer) ||
        setup.format.visitsPerPlayer < 1 ||
        setup.format.visitsPerPlayer > 999)
    )
      throw new Error("Количество подходов должно быть от 1 до 999");
    const state: Match["state"] = {
      kind: "x01",
      format: setup.format,
      remaining: Object.fromEntries(playerIds.map((p) => [p, 501])),
      visitsCompleted: Object.fromEntries(playerIds.map((p) => [p, 0])),
      phase: { kind: "regulation" },
    };
    return Object.freeze({
      id,
      createdAt: now,
      status: "in_progress",
      mode: "x01",
      players: [...playerIds],
      startingPlayerIndex: setup.startingPlayerIndex,
      currentPlayerIndex: setup.startingPlayerIndex,
      confirmedVisits: [],
      state,
    });
  }
  if (
    !Number.isInteger(setup.visitsPerPlayer) ||
    setup.visitsPerPlayer < 1 ||
    setup.visitsPerPlayer > 999
  )
    throw new Error("Количество подходов должно быть от 1 до 999");
  const state: Match["state"] = {
    kind: "fixed_visits",
    visitsPerPlayer: setup.visitsPerPlayer,
    totals: Object.fromEntries(playerIds.map((p) => [p, 0])),
    regulationCompleted: Object.fromEntries(playerIds.map((p) => [p, 0])),
    extraRoundsCompleted: 0,
    extraRoundInProgress: false,
    awaitingTieDecision: false,
    drawCompleted: false,
  };
  return Object.freeze({
    id,
    createdAt: now,
    status: "in_progress",
    mode: "fixed_visits",
    players: [...playerIds],
    startingPlayerIndex: setup.startingPlayerIndex,
    currentPlayerIndex: setup.startingPlayerIndex,
    confirmedVisits: [],
    state,
  });
}

```

---

## `src/domain/match/models.ts`

```ts
import type { DartThrow } from '../darts/DartThrow';

export type PlayerId = string;
export type MatchId = string;
export type MatchStatus = 'in_progress'|'completed'|'abandoned';
export type Player = Readonly<{ id: PlayerId; name: string; createdAt: string }>;
export type VisitResult = 'scored'|'bust'|'match_won'|'tie_pending';
export type VisitContext = Readonly<{ scores: Readonly<Record<PlayerId, number>>; currentPlayerIndex: number }>;
export type Visit = Readonly<{
  id: string; matchId: MatchId; playerId: PlayerId; visitIndex: number;
  darts: readonly DartThrow[]; physicalDartsUsed: number; rawScore: number; awardedScore: number;
  before: VisitContext; after: VisitContext; result: VisitResult; timestamp: string;
}>;
export type X01Format =
  | Readonly<{ kind: 'unlimited' }>
  | Readonly<{ kind: 'limited'; visitsPerPlayer: number }>;
export type X01Phase =
  | Readonly<{ kind: 'regulation' }>
  | Readonly<{ kind: 'awaiting_tie_break'; playerIds: readonly PlayerId[]; round: number }>
  | Readonly<{ kind: 'tie_break'; playerIds: readonly PlayerId[]; completedPlayerIds: readonly PlayerId[]; round: number }>;
export type X01State = Readonly<{
  kind: 'x01'; format: X01Format; remaining: Readonly<Record<PlayerId, number>>;
  visitsCompleted: Readonly<Record<PlayerId, number>>; phase: X01Phase;
}>;
export type FixedVisitsState = Readonly<{
  kind: 'fixed_visits'; visitsPerPlayer: number; totals: Readonly<Record<PlayerId, number>>;
  regulationCompleted: Readonly<Record<PlayerId, number>>; extraRoundsCompleted: number;
  extraRoundInProgress: boolean; awaitingTieDecision: boolean; drawCompleted: boolean;
}>;
export type ModeState = X01State|FixedVisitsState;
export type Match = Readonly<{
  id: MatchId; createdAt: string; completedAt?: string; status: MatchStatus; mode: ModeState['kind'];
  players: readonly PlayerId[]; startingPlayerIndex: number; currentPlayerIndex: number;
  state: ModeState; confirmedVisits: readonly Visit[]; winnerId?: PlayerId;
}>;

export const scoresOf = (match: Match): Readonly<Record<PlayerId, number>> => match.state.kind === 'x01' ? match.state.remaining : match.state.totals;
export const currentPlayerId = (match: Match): PlayerId => {
  const id = match.players[match.currentPlayerIndex];
  if (!id) throw new Error('Некорректный индекс игрока');
  return id;
};
export const visitContext = (match: Match): VisitContext => {
  const base = {
    scores: Object.freeze({ ...scoresOf(match) }),
    currentPlayerIndex: match.currentPlayerIndex,
  };
  return Object.freeze(base);
};

```

---

## `src/domain/match/VisitDraft.ts`

```ts
import type { DartThrow } from '../darts/DartThrow';

export type VisitDraft = Readonly<{ darts: readonly DartThrow[] }>;
export const emptyDraft = (): VisitDraft => Object.freeze({ darts: Object.freeze([]) });
const freeze = (darts: readonly DartThrow[]): VisitDraft => Object.freeze({ darts: Object.freeze([...darts]) });
export function addDraftThrow(draft: VisitDraft, dart: DartThrow): VisitDraft {
  if (draft.darts.length >= 3) throw new Error('В подходе не может быть больше трёх дротиков');
  return freeze([...draft.darts, dart]);
}
export function replaceDraftThrow(draft: VisitDraft, index: number, dart: DartThrow): VisitDraft {
  if (index < 0 || index >= draft.darts.length) throw new RangeError('Нельзя заменить пустой слот');
  return freeze(draft.darts.map((item, i) => i === index ? dart : item));
}
export function removeDraftThrow(draft: VisitDraft, index = draft.darts.length - 1): VisitDraft {
  if (index < 0 || index >= draft.darts.length) return draft;
  return freeze(draft.darts.filter((_, i) => i !== index));
}
export const resetDraft = (): VisitDraft => emptyDraft();
export const truncateDraft = (draft: VisitDraft, length: number): VisitDraft => freeze(draft.darts.slice(0, length));

```

---

## `src/domain/rules/FixedVisitsRules.ts`

```ts
import { scoreOf } from "../darts/DartThrow";
import type { VisitDraft } from "../match/VisitDraft";
import { currentPlayerId, type FixedVisitsState, type Match, type Visit } from "../match/models";
import type { DraftEvaluation, GameRules } from "./GameRules";

export class FixedVisitsRules implements GameRules {
  evaluateDraft(draft: VisitDraft, match: Match): DraftEvaluation {
    if (match.state.kind !== "fixed_visits")
      throw new Error("FixedVisitsRules применимы только к серии");
    const rawScore = draft.darts.reduce((sum, dart) => sum + scoreOf(dart), 0);
    return {
      status: draft.darts.length === 3 ? "ready_to_confirm" : "in_progress",
      physicalDartsUsed: draft.darts.length,
      rawScore,
      awardedScore: rawScore,
      canAddNextDart: draft.darts.length < 3,
      validDartCount: draft.darts.length,
    };
  }
  applyConfirmedVisit(visit: Visit, match: Match): Match {
    if (match.state.kind !== "fixed_visits") throw new Error("Неверный режим");
    const state = match.state;
    const id = visit.playerId;
    if (id !== currentPlayerId(match)) throw new Error("Визит принадлежит не текущему игроку");
    const totals = {
      ...state.totals,
      [id]: (state.totals[id] ?? 0) + visit.awardedScore,
    };
    const regulationCompleted = state.extraRoundInProgress
      ? state.regulationCompleted
      : {
          ...state.regulationCompleted,
          [id]: (state.regulationCompleted[id] ?? 0) + 1,
        };
    const nextIndex = (match.currentPlayerIndex + 1) % match.players.length;
    const allRegulationDone = match.players.every(
      (playerId) =>
        (regulationCompleted[playerId] ?? 0) >= state.visitsPerPlayer,
    );
    const roundEnds = nextIndex === match.startingPlayerIndex;
    let awaitingTieDecision = state.awaitingTieDecision;
    let extraRoundInProgress = state.extraRoundInProgress;
    let extraRoundsCompleted = state.extraRoundsCompleted;
    if (allRegulationDone && (!state.extraRoundInProgress || roundEnds)) {
      const values = match.players.map((playerId) => totals[playerId] ?? 0);
      const maximum = Math.max(...values);
      awaitingTieDecision =
        values.filter((value) => value === maximum).length > 1;
      if (state.extraRoundInProgress && roundEnds) {
        extraRoundsCompleted += 1;
        extraRoundInProgress = false;
      }
      if (!awaitingTieDecision) {
        const winnerIndex = values.indexOf(maximum);
        return {
          ...match,
          state: {
            ...state,
            totals,
            regulationCompleted,
            extraRoundsCompleted,
            extraRoundInProgress: false,
            awaitingTieDecision: false,
          },
          confirmedVisits: [...match.confirmedVisits, visit],
          currentPlayerIndex: nextIndex,
          status: "completed",
          completedAt: visit.timestamp,
          winnerId: match.players[winnerIndex]!,
        };
      }
    }
    return {
      ...match,
      state: {
        ...state,
        totals,
        regulationCompleted,
        extraRoundsCompleted,
        extraRoundInProgress,
        awaitingTieDecision,
      } as FixedVisitsState,
      currentPlayerIndex: nextIndex,
      confirmedVisits: [...match.confirmedVisits, visit],
    };
  }
}

export function startExtraRound(match: Match): Match {
  if (match.state.kind !== "fixed_visits" || !match.state.awaitingTieDecision)
    throw new Error("Дополнительный подход сейчас недоступен");
  return {
    ...match,
    currentPlayerIndex: match.startingPlayerIndex,
    state: {
      ...match.state,
      awaitingTieDecision: false,
      extraRoundInProgress: true,
    },
  };
}
export function finishAsDraw(match: Match, now: string): Match {
  if (match.state.kind !== "fixed_visits" || !match.state.awaitingTieDecision)
    throw new Error("Матч не ожидает решения о ничьей");
  return {
    ...match,
    status: "completed",
    completedAt: now,
    state: { ...match.state, awaitingTieDecision: false, drawCompleted: true },
  };
}

```

---

## `src/domain/rules/GameRules.ts`

```ts
import type { VisitDraft } from '../match/VisitDraft';
import type { Match, Visit } from '../match/models';

export type DraftStatus = 'in_progress'|'ready_to_confirm'|'bust'|'match_won';
export type DraftEvaluation = Readonly<{
  status: DraftStatus; physicalDartsUsed: number; rawScore: number; awardedScore: number;
  canAddNextDart: boolean; remainingAfter?: number; reason?: string; validDartCount: number;
}>;
export interface GameRules {
  evaluateDraft(draft: VisitDraft, match: Match): DraftEvaluation;
  applyConfirmedVisit(visit: Visit, match: Match): Match;
}

```

---

## `src/domain/rules/rulesFor.ts`

```ts
import type { Match } from '../match/models';
import type { GameRules } from './GameRules';
import { FixedVisitsRules } from './FixedVisitsRules';
import { X01Rules } from './X01Rules';
const x01 = new X01Rules(); const fixed = new FixedVisitsRules();
export const rulesFor = (match: Match): GameRules => match.mode === 'x01' ? x01 : fixed;

```

---

## `src/domain/rules/X01Rules.ts`

```ts
import { scoreOf } from '../darts/DartThrow';
import type { VisitDraft } from '../match/VisitDraft';
import { currentPlayerId, type Match, type PlayerId, type Visit, type X01State } from '../match/models';
import type { DraftEvaluation, GameRules } from './GameRules';

const playerIndex = (match: Match, playerId: PlayerId): number => {
  const index = match.players.indexOf(playerId);
  if (index < 0) throw new Error('Игрок отсутствует в матче');
  return index;
};

const leadersByMinimumRemaining = (
  state: X01State,
  playerIds: readonly PlayerId[],
): readonly PlayerId[] => {
  const minimum = Math.min(...playerIds.map(id => state.remaining[id] ?? 501));
  return playerIds.filter(id => (state.remaining[id] ?? 501) === minimum);
};

const orderedFromStarter = (match: Match, playerIds: readonly PlayerId[]): readonly PlayerId[] => {
  const eligible = new Set(playerIds);
  return Array.from({ length: match.players.length }, (_, offset) =>
    match.players[(match.startingPlayerIndex + offset) % match.players.length],
  ).filter((id): id is PlayerId => id !== undefined && eligible.has(id));
};

const completedMatch = (match: Match, state: X01State, visit: Visit, winnerId: PlayerId): Match => ({
  ...match,
  state,
  confirmedVisits: [...match.confirmedVisits, visit],
  currentPlayerIndex: playerIndex(match, winnerId),
  status: 'completed',
  completedAt: visit.timestamp,
  winnerId,
});

export class X01Rules implements GameRules {
  evaluateDraft(draft: VisitDraft, match: Match): DraftEvaluation {
    if (match.state.kind !== 'x01') throw new Error('X01Rules применимы только к 501');
    const playerId = currentPlayerId(match);
    const start = match.state.remaining[playerId];
    if (start === undefined) throw new Error('Нет счёта текущего игрока');
    let remaining = start;
    let rawScore = 0;
    for (let i = 0; i < draft.darts.length; i += 1) {
      const dart = draft.darts[i];
      if (!dart) continue;
      const points = scoreOf(dart); rawScore += points; remaining -= points;
      if (remaining < 0) {
        return { status: 'bust', physicalDartsUsed: i + 1, rawScore, awardedScore: 0, canAddNextDart: false, remainingAfter: start, reason: 'Счёт ниже нуля', validDartCount: i + 1 };
      }
      if (remaining === 0) {
        return { status: match.state.phase.kind === 'tie_break' ? 'ready_to_confirm' : 'match_won', physicalDartsUsed: i + 1, rawScore, awardedScore: rawScore, canAddNextDart: false, remainingAfter: 0, validDartCount: i + 1 };
      }
    }
    return { status: draft.darts.length === 3 ? 'ready_to_confirm' : 'in_progress', physicalDartsUsed: draft.darts.length, rawScore, awardedScore: rawScore, canAddNextDart: draft.darts.length < 3, remainingAfter: remaining, validDartCount: draft.darts.length };
  }

  applyConfirmedVisit(visit: Visit, match: Match): Match {
    if (match.state.kind !== 'x01') throw new Error('Неверный режим');
    const state = match.state; const playerId = visit.playerId;
    if (playerId !== currentPlayerId(match)) throw new Error('Визит принадлежит не текущему игроку');
    const remaining = visit.result === 'bust'
      ? state.remaining
      : { ...state.remaining, [playerId]: (state.remaining[playerId] ?? 501) - visit.awardedScore };
    const visitsCompleted = state.phase.kind === 'regulation'
      ? { ...state.visitsCompleted, [playerId]: (state.visitsCompleted[playerId] ?? 0) + 1 }
      : state.visitsCompleted;
    const nextState = { ...state, remaining, visitsCompleted } as X01State;

    if (visit.result === 'match_won') return completedMatch(match, nextState, visit, playerId);

    if (state.phase.kind === 'tie_break') {
      const completedPlayerIds = [...state.phase.completedPlayerIds, playerId];
      const remainingParticipants = state.phase.playerIds.filter(id => !completedPlayerIds.includes(id));
      const roundFinishedState = {
        ...nextState,
        phase: { ...state.phase, completedPlayerIds },
      } as X01State;
      if (remainingParticipants.length > 0) {
        const nextId = remainingParticipants[0]!;
        return {
          ...match,
          state: roundFinishedState,
          currentPlayerIndex: playerIndex(match, nextId),
          confirmedVisits: [...match.confirmedVisits, visit],
        };
      }
      const leaders = leadersByMinimumRemaining(roundFinishedState, state.phase.playerIds);
      if (leaders.length === 1) return completedMatch(match, roundFinishedState, visit, leaders[0]!);
      const ordered = orderedFromStarter(match, leaders);
      return {
        ...match,
        state: { ...roundFinishedState, phase: { kind: 'awaiting_tie_break', playerIds: ordered, round: state.phase.round + 1 } },
        currentPlayerIndex: playerIndex(match, ordered[0]!),
        confirmedVisits: [...match.confirmedVisits, visit],
      };
    }

    const nextIndex = (match.currentPlayerIndex + 1) % match.players.length;
    if (state.format.kind === 'limited') {
      const visitsPerPlayer = state.format.visitsPerPlayer;
      const regulationComplete = match.players.every(id =>
        (visitsCompleted[id] ?? 0) >= visitsPerPlayer,
      );
      if (regulationComplete) {
        const leaders = leadersByMinimumRemaining(nextState, match.players);
        if (leaders.length === 1) return completedMatch(match, nextState, visit, leaders[0]!);
        const ordered = orderedFromStarter(match, leaders);
        return {
          ...match,
          state: { ...nextState, phase: { kind: 'awaiting_tie_break', playerIds: ordered, round: 1 } },
          currentPlayerIndex: playerIndex(match, ordered[0]!),
          confirmedVisits: [...match.confirmedVisits, visit],
        };
      }
    }
    return { ...match, state: nextState, currentPlayerIndex: nextIndex, confirmedVisits: [...match.confirmedVisits, visit] };
  }
}

export function startX01ExtraRound(match: Match): Match {
  if (match.state.kind !== 'x01' || match.state.phase.kind !== 'awaiting_tie_break')
    throw new Error('Дополнительный подход сейчас недоступен');
  const playerIds = match.state.phase.playerIds;
  const first = playerIds[0];
  if (!first) throw new Error('Нет участников дополнительного подхода');
  return {
    ...match,
    currentPlayerIndex: playerIndex(match, first),
    state: {
      ...match.state,
      phase: { kind: 'tie_break', playerIds, completedPlayerIds: [], round: match.state.phase.round },
    },
  };
}

```

---

## `src/domain/statistics/StatisticsCalculator.ts`

```ts
import { notationOf, scoreOf } from "../darts/DartThrow";
import type { Match, PlayerId, Visit } from "../match/models";

export type ThresholdKey = "60+" | "80+" | "100+" | "120+" | "140+" | "180";
export type DistributionKey = "0–19" | "20–39" | "40–59" | "60–79" | "80–99" | "100–119" | "120–139" | "140–179" | "180";
export type StatisticsMode = "all" | "x01" | "fixed_visits";
export type StatisticsPeriod = 5 | 10 | 20 | "all";
export type DartPositionStatistics = Readonly<{ physicalDarts: number; points: number; average: number; misses: number; missPercent: number; triples: number; triplePercent: number }>;
export type PlayerStatistics = Readonly<{
  physicalDarts: number; visits: number; awardedPoints: number; rawPoints: number;
  averagePerDart: number; averagePerVisit: number; threeDartAverage: number; bestVisit: number;
  misses: number; outerBulls: number; bulls: number; singles: number; doubles: number; triples: number;
  hitCounts: Readonly<Record<string, number>>; positionScores: readonly [number, number, number];
  positions: readonly [DartPositionStatistics, DartPositionStatistics, DartPositionStatistics];
  thresholds: Readonly<Record<ThresholdKey, number>>; distribution: Readonly<Record<DistributionKey, number>>;
  resultSpread: number; winningHits: Readonly<Record<string, number>>; finishes: readonly number[];
}>;
export type PlayerHistoryStatistics = PlayerStatistics & Readonly<{ completedGames: number; wins: number; losses: number; winRate: number; matches: number }>;
export const MIN_PERCENT_RECORD_DARTS = 15;
export type PlayerRecords = Readonly<{
  bestVisit: number; bestThreeDartAverage: number; most100Plus: number; most140Plus: number;
  most180s: number; mostTriples: number; mostBulls: number; lowestMissPercent?: number;
}>;
export type RecordImprovement = Readonly<{ key: keyof PlayerRecords; label: string; value: number; percent?: boolean }>;
export type TrendMetric = "threeDartAverage" | "bestVisit" | "missPercent" | "triplePercent" | "100Plus";
export type TrendPoint = Readonly<{ matchId: string; date: string; value: number }>;

export const distributionKeys: readonly DistributionKey[] = ["0–19", "20–39", "40–59", "60–79", "80–99", "100–119", "120–139", "140–179", "180"];
const thresholdKeys: readonly ThresholdKey[] = ["60+", "80+", "100+", "120+", "140+"];
const safeRatio = (numerator: number, denominator: number): number => denominator > 0 ? numerator / denominator : 0;
export const percentage = (part: number, whole: number): number => safeRatio(part, whole) * 100;
const emptyPosition = (): DartPositionStatistics => ({ physicalDarts: 0, points: 0, average: 0, misses: 0, missPercent: 0, triples: 0, triplePercent: 0 });
function distributionKey(score: number): DistributionKey {
  if (score >= 180) return "180"; if (score >= 140) return "140–179"; if (score >= 120) return "120–139";
  if (score >= 100) return "100–119"; if (score >= 80) return "80–99"; if (score >= 60) return "60–79";
  if (score >= 40) return "40–59"; if (score >= 20) return "20–39"; return "0–19";
}
export const standardDeviation = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
};

export function statisticsForVisits(visits: readonly Visit[], playerId: PlayerId): PlayerStatistics {
  const own = visits.filter((visit) => visit.playerId === playerId);
  const hitCounts: Record<string, number> = {}, winningHits: Record<string, number> = {};
  const positions = Array.from({ length: 3 }, emptyPosition);
  const thresholds: Record<ThresholdKey, number> = { "60+": 0, "80+": 0, "100+": 0, "120+": 0, "140+": 0, "180": 0 };
  const distribution = Object.fromEntries(distributionKeys.map((key) => [key, 0])) as Record<DistributionKey, number>;
  const finishes: number[] = [], scores: number[] = [];
  let rawPoints = 0, physicalDarts = 0, awardedPoints = 0, bestVisit = 0;
  let misses = 0, outerBulls = 0, bulls = 0, singles = 0, doubles = 0, triples = 0;
  for (const visit of own) {
    physicalDarts += visit.physicalDartsUsed; rawPoints += visit.rawScore; awardedPoints += visit.awardedScore;
    bestVisit = Math.max(bestVisit, visit.rawScore); scores.push(visit.rawScore); distribution[distributionKey(visit.rawScore)] += 1;
    for (const key of thresholdKeys) if (visit.rawScore >= Number(key.slice(0, -1))) thresholds[key] += 1;
    if (visit.rawScore === 180) thresholds["180"] += 1;
    visit.darts.forEach((dart, index) => {
      const label = notationOf(dart), points = scoreOf(dart), position = positions[index];
      hitCounts[label] = (hitCounts[label] ?? 0) + 1;
      if (position) positions[index] = { ...position, physicalDarts: position.physicalDarts + 1, points: position.points + points, misses: position.misses + (dart.kind === "miss" ? 1 : 0), triples: position.triples + (dart.kind === "number" && dart.multiplier === 3 ? 1 : 0) };
      if (dart.kind === "miss") misses += 1; else if (dart.kind === "outer_bull") outerBulls += 1; else if (dart.kind === "bull") bulls += 1;
      else if (dart.multiplier === 1) singles += 1; else if (dart.multiplier === 2) doubles += 1; else triples += 1;
    });
    if (visit.result === "match_won") { const last = visit.darts.at(-1); if (last) { const label = notationOf(last); winningHits[label] = (winningHits[label] ?? 0) + 1; } finishes.push(visit.rawScore); }
  }
  const completedPositions = positions.map((position) => ({ ...position, average: safeRatio(position.points, position.physicalDarts), missPercent: percentage(position.misses, position.physicalDarts), triplePercent: percentage(position.triples, position.physicalDarts) })) as [DartPositionStatistics, DartPositionStatistics, DartPositionStatistics];
  return { physicalDarts, visits: own.length, awardedPoints, rawPoints, averagePerDart: safeRatio(awardedPoints, physicalDarts), averagePerVisit: safeRatio(awardedPoints, own.length), threeDartAverage: safeRatio(awardedPoints * 3, physicalDarts), bestVisit, misses, outerBulls, bulls, singles, doubles, triples, hitCounts, positionScores: [completedPositions[0].points, completedPositions[1].points, completedPositions[2].points], positions: completedPositions, thresholds, distribution, resultSpread: standardDeviation(scores), winningHits, finishes };
}
export const statisticsForMatch = (match: Match): Readonly<Record<PlayerId, PlayerStatistics>> => Object.fromEntries(match.players.map((id) => [id, statisticsForVisits(match.confirmedVisits, id)]));
const chronological = (matches: readonly Match[]): readonly Match[] => [...matches].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
export function filteredMatches(matches: readonly Match[], playerId: PlayerId, mode: StatisticsMode, period: StatisticsPeriod): readonly Match[] {
  const eligible = chronological(matches).filter((match) => match.players.includes(playerId) && (mode === "all" || match.mode === mode));
  return period === "all" ? eligible : eligible.slice(-period);
}
export function statisticsForPlayerHistory(matches: readonly Match[], playerId: PlayerId, mode: StatisticsMode = "all", period: StatisticsPeriod = "all"): PlayerHistoryStatistics {
  const selected = filteredMatches(matches, playerId, mode, period), base = statisticsForVisits(selected.flatMap((match) => match.confirmedVisits), playerId);
  const decided = selected.filter((match) => match.status === "completed" && match.winnerId !== undefined), wins = decided.filter((match) => match.winnerId === playerId).length;
  return { ...base, matches: selected.length, completedGames: selected.filter((match) => match.status === "completed").length, wins, losses: decided.length - wins, winRate: percentage(wins, decided.length) };
}
export function recordsForPlayer(matches: readonly Match[], playerId: PlayerId, mode: StatisticsMode = "all"): PlayerRecords {
  const perMatch = filteredMatches(matches, playerId, mode, "all").map((match) => statisticsForVisits(match.confirmedVisits, playerId));
  const missRates = perMatch.filter((stats) => stats.physicalDarts >= MIN_PERCENT_RECORD_DARTS).map((stats) => percentage(stats.misses, stats.physicalDarts));
  return { bestVisit: Math.max(0, ...perMatch.map((stats) => stats.bestVisit)), bestThreeDartAverage: Math.max(0, ...perMatch.map((stats) => stats.threeDartAverage)), most100Plus: Math.max(0, ...perMatch.map((stats) => stats.thresholds["100+"])), most140Plus: Math.max(0, ...perMatch.map((stats) => stats.thresholds["140+"])), most180s: Math.max(0, ...perMatch.map((stats) => stats.thresholds["180"])), mostTriples: Math.max(0, ...perMatch.map((stats) => stats.triples)), mostBulls: Math.max(0, ...perMatch.map((stats) => stats.bulls)), ...(missRates.length ? { lowestMissPercent: Math.min(...missRates) } : {}) };
}
const recordLabels: Record<keyof PlayerRecords, string> = { bestVisit: "Лучший подход", bestThreeDartAverage: "Лучшее среднее за 3 дротика", most100Plus: "Больше всего 100+ за матч", most140Plus: "Больше всего 140+ за матч", most180s: "Больше всего 180 за матч", mostTriples: "Больше всего утроений за матч", mostBulls: "Больше всего Bull за матч", lowestMissPercent: "Минимальная доля промахов" };
export function newRecordsForMatch(current: Match, previousMatches: readonly Match[], playerId: PlayerId): readonly RecordImprovement[] {
  const prior = previousMatches.filter((match) => match.id !== current.id && match.players.includes(playerId)); if (!prior.length) return [];
  const before = recordsForPlayer(prior, playerId), stats = statisticsForVisits(current.confirmedVisits, playerId);
  const currentRecords: PlayerRecords = { bestVisit: stats.bestVisit, bestThreeDartAverage: stats.threeDartAverage, most100Plus: stats.thresholds["100+"], most140Plus: stats.thresholds["140+"], most180s: stats.thresholds["180"], mostTriples: stats.triples, mostBulls: stats.bulls, ...(stats.physicalDarts >= MIN_PERCENT_RECORD_DARTS ? { lowestMissPercent: percentage(stats.misses, stats.physicalDarts) } : {}) };
  return (Object.keys(currentRecords) as (keyof PlayerRecords)[]).flatMap((key) => { const value = currentRecords[key], previous = before[key]; if (value === undefined || previous === undefined) return []; const improved = key === "lowestMissPercent" ? value < previous : value > previous; return improved ? [{ key, label: recordLabels[key], value, ...(key === "lowestMissPercent" ? { percent: true } : {}) }] : []; });
}
export function trendForPlayer(matches: readonly Match[], playerId: PlayerId, metric: TrendMetric, mode: StatisticsMode = "all", period: StatisticsPeriod = "all"): readonly TrendPoint[] {
  return filteredMatches(matches, playerId, mode, period).map((match) => { const stats = statisticsForVisits(match.confirmedVisits, playerId); const values: Record<TrendMetric, number> = { threeDartAverage: stats.threeDartAverage, bestVisit: stats.bestVisit, missPercent: percentage(stats.misses, stats.physicalDarts), triplePercent: percentage(stats.triples, stats.physicalDarts), "100Plus": stats.thresholds["100+"] }; return { matchId: match.id, date: match.completedAt ?? match.createdAt, value: values[metric] }; });
}
export type HeadToHeadStatistics = Readonly<{ sharedMatches: number; playerAWins: number; playerBWins: number; otherPlayerWins: number }>;
export function headToHead(matches: readonly Match[], playerA: PlayerId, playerB: PlayerId, mode: StatisticsMode = "all"): HeadToHeadStatistics {
  const shared = matches.filter((match) => match.status === "completed" && match.players.includes(playerA) && match.players.includes(playerB) && (mode === "all" || match.mode === mode));
  return { sharedMatches: shared.length, playerAWins: shared.filter((match) => match.winnerId === playerA).length, playerBWins: shared.filter((match) => match.winnerId === playerB).length, otherPlayerWins: shared.filter((match) => match.winnerId !== undefined && match.winnerId !== playerA && match.winnerId !== playerB).length };
}

```

---

## `src/infrastructure/persistence/IndexedDbRepositories.ts`

```ts
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Match, Player } from "../../domain/match/models";
import type {
  ActiveMatchRecord,
  ActiveVisitDraft,
  MatchRepository,
  PlayerRepository,
  SettingsRepository,
} from "../../application/ports/repositories";
import { emptyDraft, type VisitDraft } from "../../domain/match/VisitDraft";

interface DartsDb extends DBSchema {
  matches: { key: string; value: Match };
  players: { key: string; value: Player };
  meta: { key: string; value: unknown };
}
let database: Promise<IDBPDatabase<DartsDb>> | undefined;
const db = (): Promise<IDBPDatabase<DartsDb>> =>
  (database ??= openDB<DartsDb>("dart-scorekeeper", 1, {
    upgrade(store) {
      if (!store.objectStoreNames.contains("matches"))
        store.createObjectStore("matches", { keyPath: "id" });
      if (!store.objectStoreNames.contains("players"))
        store.createObjectStore("players", { keyPath: "id" });
      if (!store.objectStoreNames.contains("meta"))
        store.createObjectStore("meta");
    },
  }));

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
function isDart(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (["miss", "bull", "outer_bull"].includes(value.kind)) return true;
  return value.kind === "number" && typeof value.segment === "number" && Number.isInteger(value.segment) && value.segment >= 1 && value.segment <= 20 && [1,2,3].includes(Number(value.multiplier));
}
function isVisit(value: unknown): boolean { return isRecord(value) && typeof value.id === "string" && typeof value.playerId === "string" && Array.isArray(value.darts) && value.darts.length <= 3 && value.darts.every(isDart) && typeof value.awardedScore === "number"; }
function isPlayerNumberRecord(value: unknown, players: readonly string[], minimum: number): boolean {
  return isRecord(value) && players.every(playerId => {
    const score = value[playerId];
    return typeof score === "number" && Number.isInteger(score) && score >= minimum;
  });
}
function isX01Phase(value: unknown, players: readonly string[]): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "regulation") return true;
  if (value.kind !== "awaiting_tie_break" && value.kind !== "tie_break") return false;
  const playerIds = value.playerIds;
  if (!isStringArray(playerIds) || playerIds.length < 2 || new Set(playerIds).size !== playerIds.length || !playerIds.every(id => players.includes(id)) || !Number.isInteger(value.round) || Number(value.round) < 1) return false;
  return value.kind === "awaiting_tie_break" || (isStringArray(value.completedPlayerIds) && new Set(value.completedPlayerIds).size === value.completedPlayerIds.length && value.completedPlayerIds.every(id => playerIds.includes(id)));
}
function isMatch(value: unknown): value is Match {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.createdAt !== "string" || !["in_progress","completed","abandoned"].includes(String(value.status)) || !isStringArray(value.players) || value.players.length < 2 || new Set(value.players).size !== value.players.length || !Number.isInteger(value.currentPlayerIndex) || Number(value.currentPlayerIndex) < 0 || Number(value.currentPlayerIndex) >= value.players.length || !Array.isArray(value.confirmedVisits) || !value.confirmedVisits.every(isVisit) || !isRecord(value.state)) return false;
  if (value.mode === "x01") {
    if (value.state.kind !== "x01" || !isRecord(value.state.format) || !isPlayerNumberRecord(value.state.remaining, value.players, 0) || !isPlayerNumberRecord(value.state.visitsCompleted, value.players, 0) || !isX01Phase(value.state.phase, value.players)) return false;
    return value.state.format.kind === "unlimited" || (value.state.format.kind === "limited" && Number.isInteger(value.state.format.visitsPerPlayer) && Number(value.state.format.visitsPerPlayer) >= 1 && Number(value.state.format.visitsPerPlayer) <= 999);
  }
  return value.mode === "fixed_visits" && value.state.kind === "fixed_visits" && typeof value.state.visitsPerPlayer === "number" && isRecord(value.state.totals) && isRecord(value.state.regulationCompleted);
}
function isDraft(value: unknown): value is VisitDraft {
  return isRecord(value) && Array.isArray(value.darts) && value.darts.length <= 3 && value.darts.every(isDart);
}
function isActiveDraft(value: unknown, match: Match): value is ActiveVisitDraft {
  return isRecord(value) && typeof value.playerId === "string" && value.playerId === match.players[match.currentPlayerIndex] && isDraft(value.draft);
}
type StoredActive = Readonly<{
  schemaVersion?: number;
  current: Match;
  previous?: Match;
  draft?: unknown;
}>;
function isActiveMatchEnvelope(value: unknown): value is StoredActive {
  return isRecord(value) && isMatch(value.current) && (value.previous === undefined || isMatch(value.previous));
}
function emptyActiveDraft(match: Match): ActiveVisitDraft {
  return { playerId: match.players[match.currentPlayerIndex]!, draft: emptyDraft() };
}

export class IndexedDbMatchRepository implements MatchRepository {
  async saveActive(record: ActiveMatchRecord): Promise<void> {
    await (await db()).put(
      "meta",
      structuredClone({
        schemaVersion: 2,
        current: record.current,
        ...(record.previous ? { previous: record.previous } : {}),
        draft: record.draft,
      }),
      "activeMatch",
    );
  }
  async loadActive(): Promise<ActiveMatchRecord | undefined> {
    const value = await (await db()).get("meta", "activeMatch");
    if (value === undefined) return undefined;
    if (!isRecord(value) || (value.schemaVersion !== undefined && value.schemaVersion !== 1 && value.schemaVersion !== 2))
      throw new Error("Сохранённый матч имеет неподдерживаемую версию.");
    if (!isActiveMatchEnvelope(value))
      throw new Error("Сохранённый матч повреждён. Сбросьте локальные данные.");
    const base = value.previous === undefined
      ? { current: value.current }
      : { current: value.current, previous: value.previous };
    if (value.schemaVersion === 2 && isActiveDraft(value.draft, value.current))
      return { ...base, draft: value.draft };
    return {
      ...base,
      draft: emptyActiveDraft(value.current),
      draftRecovery: value.schemaVersion === 2 ? "discarded_corrupt" : "missing_legacy",
    };
  }
  async clearActive(): Promise<void> {
    await (await db()).delete("meta", "activeMatch");
  }
  async saveToHistory(match: Match): Promise<void> {
    await (await db()).put("matches", structuredClone(match));
  }
  async archiveAndClearActive(match: Match): Promise<void> {
    const database = await db();
    const transaction = database.transaction(["matches", "meta"], "readwrite");
    await transaction.objectStore("matches").put(structuredClone(match));
    await transaction.objectStore("meta").delete("activeMatch");
    await transaction.done;
  }
  async listHistory(): Promise<readonly Match[]> {
    const values = await (await db()).getAll("matches");
    return values
      .filter(isMatch)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
export class IndexedDbPlayerRepository implements PlayerRepository {
  async list(): Promise<readonly Player[]> {
    return (await (await db()).getAll("players")).sort((a, b) =>
      a.name.localeCompare(b.name, "ru"),
    );
  }
  async save(player: Player): Promise<void> {
    await (await db()).put("players", structuredClone(player));
  }
}
export class LocalSettingsRepository implements SettingsRepository {
  async load(): Promise<Readonly<Record<string, string>>> {
    try {
      return JSON.parse(
        localStorage.getItem("darts-settings-v1") ?? "{}",
      ) as Record<string, string>;
    } catch {
      return {};
    }
  }
  async save(values: Readonly<Record<string, string>>): Promise<void> {
    localStorage.setItem("darts-settings-v1", JSON.stringify(values));
  }
}
export async function clearLocalData(): Promise<void> {
  if (database) {
    (await database).close();
    database = undefined;
  }
  await indexedDB.deleteDatabase("dart-scorekeeper");
  localStorage.removeItem("darts-settings-v1");
}

```

---

## `src/main.tsx`

```tsx
import { StrictMode } from 'react';import { createRoot } from 'react-dom/client';import { registerSW } from 'virtual:pwa-register';import App from './App';
registerSW({immediate:false});
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);

```

---

## `src/presentation/active-game.css`

```css
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 20px;
  background: #000b;
}

.active-dialog {
  width: min(480px, 100%);
  display: grid;
  gap: 12px;
  padding: 20px;
  border: 1px solid var(--accent);
  border-radius: 10px;
  background: var(--surface);
}

.active-dialog h2,
.active-dialog p {
  margin: 0;
}

.active-dialog p {
  color: var(--muted);
}

```

---

## `src/presentation/components/DartPad.tsx`

```tsx
import type { Multiplier } from '../../domain/darts/DartThrow';
import { t } from '../strings';
type Props={multiplier:Multiplier;disabled:boolean;onMultiplier:(m:Multiplier)=>void;onNumber:(n:number)=>void;onBull:(kind:'outer'|'bull'|'miss')=>void};
export function DartPad({multiplier,disabled,onMultiplier,onNumber,onBull}:Props){return <section className="dart-pad" aria-label="Панель ввода попадания">
  <div className="multipliers">{([1,2,3] as const).map(m=><button key={m} className={multiplier===m?'selected':''} aria-pressed={multiplier===m} onClick={()=>onMultiplier(m)} disabled={disabled}>×{m}</button>)}</div>
  <div className="numbers">{Array.from({length:20},(_,i)=>i+1).map(n=><button key={n} onClick={()=>onNumber(n)} disabled={disabled} aria-label={`Сектор ${n}, множитель ${multiplier}`}>{n}</button>)}</div>
  <div className="special"><button onClick={()=>onBull('outer')} disabled={disabled}>25</button><button onClick={()=>onBull('bull')} disabled={disabled}>50</button><button onClick={()=>onBull('miss')} disabled={disabled}>{t.miss}</button></div>
</section>}

```

---

## `src/presentation/components/DraftPanel.tsx`

```tsx
import { notationOf, scoreOf } from '../../domain/darts/DartThrow';
import type { SessionSnapshot } from '../../application/GameSession';
import { t } from '../strings';
type Props={snapshot:SessionSnapshot;selected:number|undefined;onSelect:(index:number)=>void;onRemove:()=>void;onReset:()=>void;onConfirm:()=>void};
export function DraftPanel({snapshot,selected,onSelect,onRemove,onReset,onConfirm}:Props){const {draft,evaluation,isConfirming}=snapshot;const ready=evaluation.status!=='in_progress';return <section className="draft-panel">
  <div className="section-heading"><h2>{t.currentVisit}</h2>{selected!==undefined?<span>{t.replace} {selected+1}</span>:null}</div>
  <div className="dart-slots">{[0,1,2].map(i=>{const dart=draft.darts[i];return <button key={i} className={`${dart?'filled':''} ${selected===i?'selected':''}`} onClick={()=>dart&&onSelect(i)} disabled={isConfirming} aria-label={dart?`${t.dart} ${i+1}: ${notationOf(dart)}, заменить`:`${t.dart} ${i+1}: пусто`}><small>{t.dart} {i+1}</small><b>{dart?notationOf(dart):'—'}</b><span>{dart?scoreOf(dart):'пусто'}</span></button>})}</div>
  {snapshot.notice?<div className="notice" role="status">{snapshot.notice}</div>:null}
  <div className={`evaluation ${evaluation.status==='bust'?'danger':''}`}><div><small>{evaluation.status==='bust'?t.bust:'Сумма подхода'}</small><strong>{evaluation.status==='bust'?'0':evaluation.rawScore}</strong></div>{evaluation.remainingAfter!==undefined?<div><small>После подтверждения</small><strong>{evaluation.remainingAfter}</strong></div>:null}</div>
  {evaluation.reason?<p className="reason">{evaluation.reason}. Зачётные очки: 0.</p>:null}
  <div className="draft-actions"><button className="secondary" onClick={onRemove} disabled={!draft.darts.length||isConfirming}>Удалить последний</button><button className="secondary" onClick={onReset} disabled={!draft.darts.length||isConfirming}>{t.reset}</button><button className="primary" onClick={onConfirm} disabled={!ready||isConfirming}>{isConfirming?'Сохраняем…':evaluation.status==='bust'?`${t.confirm} перебор`:`${t.confirm} ${evaluation.awardedScore}`}</button></div>
  {!ready?<p className="hint">{snapshot.match.mode==='fixed_visits'?'Введите все три физических дротика':'Можно подтвердить после трёх дротиков или досрочного завершения'}</p>:null}
  </section>}

```

---

## `src/presentation/components/Scoreboard.tsx`

```tsx
import type { Match, Player } from "../../domain/match/models";
import { statisticsForMatch } from "../../domain/statistics/StatisticsCalculator";
type Props = { match: Match; players: readonly Player[] };
export function Scoreboard({ match, players }: Props) {
  const stats = statisticsForMatch(match);
  return (
    <section
      className={`scoreboard ${match.players.length > 2 ? "multi" : ""}`}
      aria-label="Счёт игроков"
    >
      {match.players.map((id, index) => {
        const player = players.find((p) => p.id === id);
        const active = index === match.currentPlayerIndex;
        const score =
          match.state.kind === "x01"
            ? match.state.remaining[id]
            : match.state.totals[id];
        const last = match.confirmedVisits
          .filter((v) => v.playerId === id)
          .at(-1);
        return (
          <article
            key={id}
            className={`player-score ${active ? "active" : ""}`}
            aria-current={active ? "true" : undefined}
          >
            {active ? (
              <span className="turn-mark">● ХОД</span>
            ) : (
              <span className="turn-spacer" />
            )}
            <div className="player-head">
              <h2>{player?.name ?? "Игрок"}</h2>
            </div>
            <div className="main-score">{score ?? 0}</div>
            <div className="mini-stats">
              <span>
                Среднее <b>{stats[id]?.averagePerVisit.toFixed(1) ?? "0,0"}</b>
              </span>
              <span>
                Последний <b>{last?.awardedScore ?? "—"}</b>
              </span>
            </div>
          </article>
        );
      })}
    </section>
  );
}

```

---

## `src/presentation/concept-overrides.css`

```css
:root{--accent:#b7f215;--accent2:#d9ff70;--danger:#ff655e}
.primary{color:#10150a}
.segments button.selected,.multipliers button.selected{background:#354515}
.special button:nth-child(2){background:#8b1717;border-color:#e23636;color:#fff}
.player-fields{display:grid;gap:12px}.input-row{display:flex;gap:8px}.remove-player{flex:0 0 52px;border:1px solid var(--line);border-radius:8px;background:var(--surface2);font-size:24px}.add-player{width:100%}.starter-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:6px}.starter-grid button{min-height:46px;border:1px solid var(--line);border-radius:7px;background:var(--surface);font-weight:750}.starter-grid button.selected{border-color:var(--accent);background:#354515}
.scoreboard.multi{grid-template-columns:1fr}.scoreboard.multi .player-score{display:grid;grid-template-columns:70px 1fr auto 150px;align-items:center;gap:10px}.scoreboard.multi .turn-mark,.scoreboard.multi .turn-spacer{height:auto}.scoreboard.multi .main-score{font-size:34px;margin:0}.scoreboard.multi .mini-stats{border:0;padding:0}
@media(max-width:520px){.scoreboard.multi .player-score{grid-template-columns:48px 1fr auto}.scoreboard.multi .mini-stats{display:none}.scoreboard.multi .main-score{font-size:28px}}
@media(max-width:520px){
  .game-header{margin-bottom:5px}.game-header .text-icon{height:36px}.player-score{padding-top:4px;padding-bottom:4px}
  .player-score.active{padding-top:3px;padding-bottom:3px}.turn-mark,.turn-spacer{height:15px}.main-score{font-size:44px;margin:0 0 4px}
  .mini-stats{padding-top:4px}.current-label{margin:5px 0 3px}.section-heading{display:none}.draft-panel{gap:5px}
  .dart-slots button{min-height:57px}.dart-slots b{font-size:20px}.evaluation>div{padding:4px}.evaluation strong{font-size:19px}
  .draft-actions{grid-template-columns:1fr 1fr 1.25fr}.draft-actions .primary{grid-column:auto;grid-row:auto}.draft-actions button{min-height:44px;font-size:9px}
  .hint{display:none}.numbers button{min-height:42px}.multipliers button,.special button{min-height:42px}.undo-link{margin-top:5px}
}
.player-fields label>select{min-height:42px;border:1px solid var(--line);border-radius:7px;background:var(--surface2);color:#fff;padding:0 10px}.home-links{display:flex;justify-content:center;gap:20px}.home-links .link-button{margin-inline:0}

```

---

## `src/presentation/hooks/useWakeLock.ts`

```ts
import { useEffect } from 'react';
interface WakeLockSentinelLike { release(): Promise<void>; }
type NavigatorWithWakeLock = Navigator & { wakeLock?: { request(type:'screen'):Promise<WakeLockSentinelLike> } };
export function useWakeLock(active:boolean):void{
  useEffect(()=>{if(!active)return;let sentinel:WakeLockSentinelLike|undefined;let cancelled=false;const request=async()=>{try{const api=(navigator as NavigatorWithWakeLock).wakeLock;if(api&&!cancelled)sentinel=await api.request('screen');}catch{/* Browser may deny without user gesture. */}};const onVisible=()=>{if(document.visibilityState==='visible')void request();};void request();document.addEventListener('visibilitychange',onVisible);return()=>{cancelled=true;document.removeEventListener('visibilitychange',onVisible);void sentinel?.release();};},[active]);
}

```

---

## `src/presentation/pages/GamePage.tsx`

```tsx
import { useState } from "react";
import {
  bull,
  miss,
  numberThrow,
  outerBull,
  type Multiplier,
} from "../../domain/darts/DartThrow";
import type { Match, Player } from "../../domain/match/models";
import { newRecordsForMatch } from "../../domain/statistics/StatisticsCalculator";
import type {
  GameSession,
  SessionSnapshot,
} from "../../application/GameSession";
import { useWakeLock } from "../hooks/useWakeLock";
import { Scoreboard } from "../components/Scoreboard";
import { DraftPanel } from "../components/DraftPanel";
import { DartPad } from "../components/DartPad";
import { t } from "../strings";
type Props = {
  session: GameSession;
  initial: SessionSnapshot;
  players: readonly Player[];
  previousMatches: readonly Match[];
  onChange: (s: SessionSnapshot) => void;
  onBack: () => void;
  onClosed: () => void;
};
export function GamePage({
  session,
  initial,
  players,
  previousMatches,
  onChange,
  onBack,
  onClosed,
}: Props) {
  const [snapshot, setSnapshot] = useState(initial);
  const [multiplier, setMultiplier] = useState<Multiplier>(1);
  const [selected, setSelected] = useState<number>();
  const [error, setError] = useState<string>();
  useWakeLock(snapshot.match.status === "in_progress");
  const update = (s: SessionSnapshot) => {
    setSnapshot(s);
    onChange(s);
    setError(undefined);
  };
  const enter = async (dart: ReturnType<typeof miss>) => {
    try {
      const pending = session.record(dart, selected);
      update(session.snapshot());
      update(await pending);
      setSelected(undefined);
      setMultiplier(1);
    } catch (e) {
      update(session.snapshot());
      setError(e instanceof Error ? e.message : "Ошибка ввода");
    }
  };
  const undo = async () => {
    try {
      const hasDraft = snapshot.draft.darts.length > 0;
      if (
        hasDraft &&
        !window.confirm("Текущий незавершённый подход будет сброшен. Отменить предыдущий подход?")
      )
        return;
      update(await session.undo(hasDraft));
      setSelected(undefined);
      setMultiplier(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  };
  const confirm = async () => {
    try {
      const pending = session.confirm();
      update(session.snapshot());
      update(await pending);
    } catch (e) {
      update(session.snapshot());
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    }
  };
  const m = snapshot.match;
  const currentName =
    players.find((p) => p.id === m.players[m.currentPlayerIndex])?.name ??
    "Игрок";
  const awaitingTieDecision =
    (m.state.kind === "fixed_visits" && m.state.awaitingTieDecision) ||
    (m.state.kind === "x01" && m.state.phase.kind === "awaiting_tie_break");
  if (m.status === "completed")
    return (
      <Summary
        snapshot={snapshot}
        players={players}
        previousMatches={previousMatches}
        onUndo={async () => update(await session.undo())}
        onFinish={async () => {
          await session.finalize();
          onClosed();
        }}
      />
    );
  return (
    <main className="game-page">
      <header className="game-header">
        <button
          className="text-icon"
          onClick={onBack}
          aria-label="На главный экран"
        >
          ‹
        </button>
        <div>
          <strong>
            {m.mode === "x01"
              ? m.state.kind === "x01" && m.state.format.kind === "limited"
                ? `501 · ${m.state.format.visitsPerPlayer} подходов`
                : "501 · до победы"
              : `Серия · ${m.state.kind === "fixed_visits" ? m.state.visitsPerPlayer : 0} подходов`}
          </strong>
          <span>
            {m.state.kind === "x01"
              ? m.state.phase.kind === "tie_break"
                ? `Дополнительный подход ${m.state.phase.round}`
                : m.state.phase.kind === "awaiting_tie_break"
                  ? "Ничья по минимальному остатку"
                  : m.state.format.kind === "limited"
                    ? `Подход ${Math.min(...Object.values(m.state.visitsCompleted)) + 1} из ${m.state.format.visitsPerPlayer}`
                    : "Точный выход в 0"
              : m.state.extraRoundInProgress
                ? `Дополнительный подход ${m.state.extraRoundsCompleted + 1}`
                : `Подход ${Math.min(...Object.values(m.state.regulationCompleted)) + 1} из ${m.state.visitsPerPlayer}`}
          </span>
        </div>
        <button
          className="text-icon"
          onClick={() => {
            if (!window.confirm("Прервать текущий матч? Незавершённый подход не попадёт в историю.")) return;
            void session.abandon().then(onClosed).catch((e) =>
              setError(e instanceof Error ? e.message : "Ошибка сохранения"),
            );
          }}
          aria-label={t.abandon}
        >
          ×
        </button>
      </header>
      <Scoreboard match={m} players={players} />
      <div className="current-label">
        ● {t.currentVisit}: <strong>{currentName}</strong>
      </div>
      <DraftPanel
        snapshot={snapshot}
        selected={selected}
        onSelect={(i) => setSelected(selected === i ? undefined : i)}
        onRemove={() => {
          const pending = session.remove();
          update(session.snapshot());
          void pending.then(update).catch((e) => {
            update(session.snapshot());
            setError(e instanceof Error ? e.message : "Ошибка сохранения");
          });
        }}
        onReset={() => {
          const pending = session.reset();
          update(session.snapshot());
          void pending.then((value) => {
            update(value);
            setMultiplier(1);
            setSelected(undefined);
          }).catch((e) => {
            update(session.snapshot());
            setError(e instanceof Error ? e.message : "Ошибка сохранения");
          });
        }}
        onConfirm={() => void confirm()}
      />
      {awaitingTieDecision ? (
        <div className="tie-panel">
          <h2>{t.draw}</h2>
          <button
            className="primary"
            onClick={() =>
              void session.extraRound().then(update).catch((e) =>
                setError(e instanceof Error ? e.message : "Ошибка сохранения"),
              )
            }
          >
            {t.extra}
          </button>
          {m.state.kind === "fixed_visits" ? <button
              className="secondary"
              onClick={() =>
                void session.completeDraw().then(update).catch((e) =>
                  setError(e instanceof Error ? e.message : "Ошибка сохранения"),
                )
              }
            >
              {t.finishDraw}
            </button> : null}
        </div>
      ) : (
        <DartPad
          multiplier={multiplier}
          disabled={snapshot.isConfirming || (!snapshot.evaluation.canAddNextDart && selected === undefined)}
          onMultiplier={setMultiplier}
          onNumber={(n) => void enter(numberThrow(n, multiplier))}
          onBull={(kind) =>
            void enter(
              kind === "outer"
                ? outerBull()
                : kind === "bull"
                  ? bull()
                  : miss(),
            )
          }
        />
      )}{" "}
      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}
      <button
        className="undo-link"
        onClick={() => void undo()}
      >
        {t.undo}
      </button>
    </main>
  );
}

function Summary({
  snapshot,
  players,
  previousMatches,
  onUndo,
  onFinish,
}: {
  snapshot: SessionSnapshot;
  players: readonly Player[];
  previousMatches: readonly Match[];
  onUndo: () => Promise<void>;
  onFinish: () => Promise<void>;
}) {
  const [error, setError] = useState<string>();
  const m = snapshot.match;
  const records = m.players.flatMap((playerId) => {
    const player = players.find((item) => item.id === playerId);
    return newRecordsForMatch(m, previousMatches, playerId).map((record) => ({ ...record, playerName: player?.name ?? "Игрок" }));
  });
  return (
    <main className="summary-page">
      <p className="eyeline">{m.mode === "x01" ? "501" : "Серия завершена"}</p>
      <h1>
        {m.winnerId
          ? `${players.find((p) => p.id === m.winnerId)?.name} победил${players.find((p) => p.id === m.winnerId)?.name.endsWith("а") ? "а" : ""}`
          : t.draw}
      </h1>
      <Scoreboard match={m} players={players} />
      {records.length > 0 ? <section className="new-records"><h2>🏆 Новый личный рекорд</h2>{records.map((record) => <p key={`${record.playerName}-${record.key}`}><span>{record.playerName} · {record.label}</span><strong>{record.percent ? `${record.value.toFixed(1)}%` : Number.isInteger(record.value) ? record.value : record.value.toFixed(1)}</strong></p>)}</section> : null}
      <section className="summary-actions">
        <button
          className="secondary"
          onClick={() =>
            void onUndo().catch((e) =>
              setError(e instanceof Error ? e.message : "Ошибка сохранения"),
            )
          }
        >
          {t.undo}
        </button>
        <button
          className="primary"
          onClick={() =>
            void onFinish().catch((e) =>
              setError(e instanceof Error ? e.message : "Ошибка сохранения"),
            )
          }
        >
          {t.finish}
        </button>
      </section>
      {error ? <div className="error" role="alert">{error}</div> : null}
    </main>
  );
}

```

---

## `src/presentation/pages/HistoryPage.tsx`

```tsx
import type { Match, Player } from '../../domain/match/models';import { statisticsForMatch } from '../../domain/statistics/StatisticsCalculator';import { notationOf } from '../../domain/darts/DartThrow';import { t } from '../strings';
export function HistoryPage({matches,players,onBack}:{matches:readonly Match[];players:readonly Player[];onBack:()=>void}){return <main className="history-page"><header><button className="text-icon" onClick={onBack}>‹</button><h1>{t.history}</h1></header>{matches.length===0?<p className="empty">{t.empty}</p>:matches.map(match=>{const stats=statisticsForMatch(match);return <details key={match.id} className="history-match"><summary><div><b>{match.players.map(id=>players.find(p=>p.id===id)?.name??'Игрок').join(' — ')}</b><span>{match.mode==='x01'?'501':`${match.state.kind==='fixed_visits'?match.state.visitsPerPlayer:''} подходов`} · {match.status==='abandoned'?'Матч прерван':new Date(match.createdAt).toLocaleDateString('ru-RU')}</span></div><strong>{match.players.map(id=>match.state.kind==='x01'?match.state.remaining[id]:match.state.totals[id]).join(' : ')}</strong></summary><div className="history-detail">{match.players.map(id=><p key={id}><b>{players.find(p=>p.id===id)?.name}</b>: среднее {stats[id]?.averagePerVisit.toFixed(1)}, лучший {stats[id]?.bestVisit}, дротиков {stats[id]?.physicalDarts}</p>)}<ol>{match.confirmedVisits.map(v=><li key={v.id}>{players.find(p=>p.id===v.playerId)?.name}: {v.darts.map(notationOf).join(' · ')} = {v.rawScore}{v.result==='bust'?' (перебор)':''}</li>)}</ol></div></details>})}</main>}

```

---

## `src/presentation/pages/SetupPage.tsx`

```tsx
import { useState } from "react";
import type { MatchSetup } from "../../domain/match/createMatch";
import type { Player, PlayerId } from "../../domain/match/models";
import { t } from "../strings";

export type SetupParticipant = Readonly<{ name: string; playerId?: PlayerId }>;
type ParticipantDraft = { name: string; playerId?: PlayerId };
type Props = { saved: readonly Player[]; onStart: (participants: readonly SetupParticipant[], setup: MatchSetup) => Promise<void>; onHistory: () => void; onStatistics: () => void };
const defaultParticipant = (index: number): ParticipantDraft => ({ name: `Игрок ${index + 1}` });

export function SetupPage({ saved, onStart, onHistory, onStatistics }: Props) {
  const [participants, setParticipants] = useState<ParticipantDraft[]>([defaultParticipant(0), defaultParticipant(1)]);
  const [mode, setMode] = useState<"x01" | "fixed_visits">("x01");
  const [x01Format, setX01Format] = useState<"unlimited" | "limited">("unlimited");
  const [visits, setVisits] = useState(20);
  const [custom, setCustom] = useState(false);
  const [starter, setStarter] = useState<number | "random">(0);
  const [busy, setBusy] = useState(false);
  const selectedIds = participants.flatMap((participant) => participant.playerId ? [participant.playerId] : []);
  const participantsValid = participants.every((participant) => participant.name.trim()) && new Set(selectedIds).size === selectedIds.length;
  const visitsValid = Number.isInteger(visits) && visits >= 1 && visits <= 999;
  const visitsRequired = mode === "fixed_visits" || x01Format === "limited";
  const valid = participantsValid && (!visitsRequired || visitsValid);
  const start = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const startingPlayerIndex = starter === "random" ? Math.floor(Math.random() * participants.length) : Math.min(starter, participants.length - 1);
      const clean = participants.map(({ name, playerId }) => ({ name: name.trim(), ...(playerId ? { playerId } : {}) }));
      await onStart(clean, mode === "x01" ? { mode, format: x01Format === "unlimited" ? { kind: "unlimited" } : { kind: "limited", visitsPerPlayer: visits }, startingPlayerIndex } : { mode, visitsPerPlayer: visits, startingPlayerIndex });
    } finally { setBusy(false); }
  };
  return <main className="setup-page"><header className="brand"><div className="brand-mark">◎</div><div><h1>{t.newGame}</h1><p>От двух до восьми игроков. Каждый дротик учтён.</p></div></header><section className="setup-form">
    <div className="player-fields">{participants.map((participant, index) => <label key={index}>Игрок {index + 1}<span className="input-row"><input aria-label={`Имя игрока ${index + 1}`} value={participant.name} onChange={(event) => setParticipants((current) => current.map((item, itemIndex) => itemIndex === index ? { name: event.target.value } : item))} maxLength={28}/>{participants.length > 2 ? <button type="button" className="remove-player" onClick={() => { setParticipants((current) => current.filter((_, itemIndex) => itemIndex !== index)); setStarter(0); }} aria-label={`Удалить игрока ${index + 1}`}>×</button> : null}</span>{saved.length ? <select aria-label={`Выбрать сохранённого игрока ${index + 1}`} value={participant.playerId ?? ""} onChange={(event) => { const player = saved.find((item) => item.id === event.target.value); if (player) setParticipants((current) => current.map((item, itemIndex) => itemIndex === index ? { name: player.name, playerId: player.id } : item)); }}><option value="">Временный игрок</option>{saved.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select> : null}</label>)}</div>
    {participants.length < 8 ? <button type="button" className="secondary add-player" onClick={() => setParticipants((current) => [...current, defaultParticipant(current.length)])}>+ Добавить игрока</button> : null}{!participantsValid ? <p className="reason">Имена должны быть заполнены, а сохранённый профиль нельзя выбрать дважды.</p> : null}{visitsRequired && !visitsValid ? <p className="reason">Количество подходов должно быть от 1 до 999.</p> : null}
    <fieldset><legend>{t.mode}</legend><div className="segments"><button type="button" className={mode === "x01" ? "selected" : ""} onClick={() => setMode("x01")}>501</button><button type="button" className={mode === "fixed_visits" ? "selected" : ""} onClick={() => setMode("fixed_visits")}>{t.series}</button></div></fieldset>
    {mode === "x01" ? <><fieldset><legend>Формат 501</legend><div className="segments"><button type="button" className={x01Format === "unlimited" ? "selected" : ""} onClick={() => setX01Format("unlimited")}>До победы</button><button type="button" className={x01Format === "limited" ? "selected" : ""} onClick={() => setX01Format("limited")}>Ограничить количество подходов</button></div></fieldset>{x01Format === "limited" ? <VisitsField visits={visits} custom={custom} onVisits={setVisits} onCustom={setCustom}/> : null}</> : <VisitsField visits={visits} custom={custom} onVisits={setVisits} onCustom={setCustom}/>} 
    <fieldset><legend>{t.starts}</legend><div className="starter-grid">{participants.map((participant, index) => <button type="button" key={index} className={starter === index ? "selected" : ""} onClick={() => setStarter(index)}>{participant.name || `Игрок ${index + 1}`}</button>)}<button type="button" className={starter === "random" ? "selected" : ""} onClick={() => setStarter("random")}>{t.random}</button></div></fieldset>
    <button className="primary start" onClick={() => void start()} disabled={busy || !valid}>{busy ? "Создаём…" : t.start}</button></section><nav className="home-links"><button className="link-button" onClick={onHistory}>{t.history}</button><button className="link-button" onClick={onStatistics}>Статистика</button></nav></main>;
}

function VisitsField({ visits, custom, onVisits, onCustom }: { visits: number; custom: boolean; onVisits: (value: number) => void; onCustom: (value: boolean) => void }) {
  return <fieldset><legend>{t.visits}</legend><div className="segments five">{[5, 10, 20, 30].map((value) => <button type="button" key={value} className={!custom && visits === value ? "selected" : ""} onClick={() => { onVisits(value); onCustom(false); }}>{value}</button>)}<button type="button" className={custom ? "selected" : ""} onClick={() => onCustom(true)}>{t.other}</button></div>{custom ? <input type="number" min="1" max="999" value={visits} onChange={(event) => onVisits(Number(event.target.value))} aria-label="Другое количество подходов"/> : null}</fieldset>;
}

```

---

## `src/presentation/pages/StatisticsPage.tsx`

```tsx
import { useMemo, useState } from "react";
import type { Match, Player, PlayerId } from "../../domain/match/models";
import {
  MIN_PERCENT_RECORD_DARTS,
  distributionKeys,
  headToHead,
  percentage,
  recordsForPlayer,
  statisticsForPlayerHistory,
  trendForPlayer,
  type PlayerHistoryStatistics,
  type StatisticsMode,
  type StatisticsPeriod,
  type TrendMetric,
} from "../../domain/statistics/StatisticsCalculator";

type Section = "overview" | "hits" | "distribution" | "trends" | "records";
const modeLabels: Record<StatisticsMode, string> = { all: "Все", x01: "501", fixed_visits: "Набор очков" };
const periodLabels: Record<StatisticsPeriod, string> = { 5: "Последние 5", 10: "Последние 10", 20: "Последние 20", all: "Всё время" };
const trendLabels: Record<TrendMetric, string> = { threeDartAverage: "Среднее за 3 дротика", bestVisit: "Лучший подход", missPercent: "Промахи, %", triplePercent: "Доля утроений, %", "100Plus": "100+ за игру" };
const pct = (value: number) => `${value.toFixed(1)}%`;
const number = (value: number) => value.toFixed(1);

type Props = { matches: readonly Match[]; players: readonly Player[]; onBack: () => void };
export function StatisticsPage({ matches, players, onBack }: Props) {
  const available = players.filter((player) => matches.some((match) => match.players.includes(player.id)));
  const [selectedPlayerId, setSelectedPlayerId] = useState<PlayerId>();
  const [compare, setCompare] = useState(false);
  const [mode, setMode] = useState<StatisticsMode>("all");
  const [period, setPeriod] = useState<StatisticsPeriod>("all");
  const selected = available.find((player) => player.id === selectedPlayerId);
  return <main className="statistics-page">
    <header className="stats-header"><button className="text-icon" onClick={onBack} aria-label="Назад">‹</button><div><h1>Статистика</h1><p>Только подтверждённые броски</p></div></header>
    {available.length === 0 ? <p className="empty">Пока мало данных. Сыграйте матч — здесь появятся показатели и динамика.</p>
      : compare ? <Comparison matches={matches} players={available} mode={mode} onMode={setMode} onClose={() => setCompare(false)} />
      : selected ? <PlayerDetails matches={matches} player={selected} mode={mode} period={period} onMode={setMode} onPeriod={setPeriod} onClose={() => setSelectedPlayerId(undefined)} />
      : <Overview matches={matches} players={available} onSelect={setSelectedPlayerId} onCompare={() => setCompare(true)} />}
  </main>;
}

function Overview({ matches, players, onSelect, onCompare }: { matches: readonly Match[]; players: readonly Player[]; onSelect: (id: PlayerId) => void; onCompare: () => void }) {
  return <><section className="stats-player-grid" aria-label="Игроки">{players.map((player) => { const stats = statisticsForPlayerHistory(matches, player.id); return <button key={player.id} className="stats-player-card" onClick={() => onSelect(player.id)}><strong>{player.name}</strong><Metric label="Среднее за 3 дротика" value={number(stats.threeDartAverage)} /><Metric label="Лучший подход" value={stats.bestVisit} /><Metric label="Победы" value={pct(stats.winRate)} /><Metric label="180" value={stats.thresholds["180"]} /></button>; })}</section>
    {players.length >= 2 ? <button className="primary stats-compare-action" onClick={onCompare}>Сравнить игроков</button> : null}</>;
}

function Filters({ mode, period, onMode, onPeriod }: { mode: StatisticsMode; period: StatisticsPeriod; onMode: (value: StatisticsMode) => void; onPeriod: (value: StatisticsPeriod) => void }) {
  return <section className="stats-filters" aria-label="Фильтры статистики"><label>Режим<select value={mode} onChange={(event) => onMode(event.target.value as StatisticsMode)}>{(Object.keys(modeLabels) as StatisticsMode[]).map((key) => <option key={key} value={key}>{modeLabels[key]}</option>)}</select></label><label>Период<select value={period} onChange={(event) => onPeriod(event.target.value === "all" ? "all" : Number(event.target.value) as 5 | 10 | 20)}>{([5, 10, 20, "all"] as const).map((key) => <option key={key} value={key}>{periodLabels[key]}</option>)}</select></label></section>;
}

function PlayerDetails({ matches, player, mode, period, onMode, onPeriod, onClose }: { matches: readonly Match[]; player: Player; mode: StatisticsMode; period: StatisticsPeriod; onMode: (value: StatisticsMode) => void; onPeriod: (value: StatisticsPeriod) => void; onClose: () => void }) {
  const [section, setSection] = useState<Section>("overview");
  const stats = useMemo(() => statisticsForPlayerHistory(matches, player.id, mode, period), [matches, player.id, mode, period]);
  return <><button className="stats-back" onClick={onClose}>← Все игроки</button><h2 className="stats-player-title">{player.name}</h2><Filters mode={mode} period={period} onMode={onMode} onPeriod={onPeriod} />
    <nav className="stats-tabs" aria-label="Раздел статистики">{(["overview", "hits", "distribution", "trends", "records"] as const).map((key) => <button key={key} className={section === key ? "selected" : ""} onClick={() => setSection(key)}>{({ overview: "Обзор", hits: "Попадания", distribution: "Распределение", trends: "Динамика", records: "Рекорды" } as const)[key]}</button>)}</nav>
    {section === "overview" ? <PlayerOverview stats={stats} /> : section === "hits" ? <Hits stats={stats} /> : section === "distribution" ? <Distribution stats={stats} /> : section === "trends" ? <Trends matches={matches} playerId={player.id} mode={mode} period={period} /> : <Records matches={matches} playerId={player.id} mode={mode} />}
  </>;
}

function PlayerOverview({ stats }: { stats: PlayerHistoryStatistics }) {
  return <section className="stat-section"><div className="metric-grid"><MetricCard label="Среднее за 3 дротика" value={number(stats.threeDartAverage)} /><MetricCard label="Среднее за дротик" value={number(stats.averagePerDart)} /><MetricCard label="Лучший подход" value={stats.bestVisit} /><MetricCard label="Победы / поражения" value={`${stats.wins} / ${stats.losses} · ${pct(stats.winRate)}`} /><MetricCard label="Завершённые игры" value={stats.completedGames} /><MetricCard label="Подходы / дротики" value={`${stats.visits} / ${stats.physicalDarts}`} /><MetricCard label="Raw очки" value={stats.rawPoints} /><MetricCard label="Зачётные очки" value={stats.awardedPoints} /></div><div className="thresholds" aria-label="Высокие подходы">{(["60+", "80+", "100+", "120+", "140+", "180"] as const).map((key) => <Metric key={key} label={key} value={stats.thresholds[key]} />)}</div>{stats.matches < 2 ? <p className="stats-note">Пока мало данных для динамики. Уже доступные показатели рассчитаны по сыгранным броскам.</p> : null}</section>;
}

function Hits({ stats }: { stats: PlayerHistoryStatistics }) {
  const [kind, setKind] = useState<"S" | "D" | "T">("S");
  const frequent = (prefix: "S" | "D" | "T") => { const labels = Array.from({ length: 20 }, (_, index) => `${prefix}${index + 1}`), best = labels.reduce((current, key) => (stats.hitCounts[key] ?? 0) > (stats.hitCounts[current] ?? 0) ? key : current, labels[0]!); return (stats.hitCounts[best] ?? 0) > 0 ? best : "—"; };
  return <section className="stat-section"><div className="hit-share-grid"><MetricCard label="Одиночные" value={`${stats.singles} · ${pct(percentage(stats.singles, stats.physicalDarts))}`} /><MetricCard label="Удвоения" value={`${stats.doubles} · ${pct(percentage(stats.doubles, stats.physicalDarts))}`} /><MetricCard label="Утроения" value={`${stats.triples} · ${pct(percentage(stats.triples, stats.physicalDarts))}`} /><MetricCard label="25" value={`${stats.outerBulls} · ${pct(percentage(stats.outerBulls, stats.physicalDarts))}`} /><MetricCard label="Bull" value={`${stats.bulls} · ${pct(percentage(stats.bulls, stats.physicalDarts))}`} /><MetricCard label="Промахи" value={`${stats.misses} · ${pct(percentage(stats.misses, stats.physicalDarts))}`} /></div><p className="stats-insight">Самое частое одиночное попадание: {frequent("S")}; больше всего утроений: {frequent("T")}.</p><div className="stats-tabs compact" aria-label="Тип сектора">{(["S", "D", "T"] as const).map((key) => <button key={key} className={kind === key ? "selected" : ""} onClick={() => setKind(key)}>{key === "S" ? "Одиночные" : key === "D" ? "Удвоения" : "Утроения"}</button>)}</div><div className="sector-grid">{Array.from({ length: 20 }, (_, index) => { const label = `${kind}${index + 1}`, count = stats.hitCounts[label] ?? 0; return <div key={label} className="sector-cell"><b>{label}</b><span>{count}</span></div>; })}</div><div className="position-grid">{stats.positions.map((position, index) => <article key={index}><h3>Дротик {index + 1}</h3><Metric label="Среднее" value={number(position.average)} /><Metric label="Промахи" value={pct(position.missPercent)} /><Metric label="Утроения" value={pct(position.triplePercent)} /></article>)}</div></section>;
}

function Distribution({ stats }: { stats: PlayerHistoryStatistics }) {
  const maximum = Math.max(1, ...Object.values(stats.distribution));
  return <section className="stat-section"><h3>Результаты подходов</h3><div className="bar-chart">{distributionKeys.map((key) => <div key={key} className="bar-row"><span>{key}</span><div><i style={{ width: `${stats.distribution[key] / maximum * 100}%` }} /></div><b>{stats.distribution[key]}</b></div>)}</div><p className="stats-note"><b>Разброс результатов: {number(stats.resultSpread)}</b><br />Чем меньше значение, тем стабильнее результаты подходов.</p></section>;
}

function Trends({ matches, playerId, mode, period }: { matches: readonly Match[]; playerId: PlayerId; mode: StatisticsMode; period: StatisticsPeriod }) {
  const [metric, setMetric] = useState<TrendMetric>("threeDartAverage"), points = trendForPlayer(matches, playerId, metric, mode, period), maximum = Math.max(1, ...points.map((point) => point.value));
  return <section className="stat-section"><label className="trend-select">Показатель<select value={metric} onChange={(event) => setMetric(event.target.value as TrendMetric)}>{(Object.keys(trendLabels) as TrendMetric[]).map((key) => <option key={key} value={key}>{trendLabels[key]}</option>)}</select></label>{points.length < 2 ? <p className="stats-note">Пока мало игр для динамики.</p> : <div className="trend-chart" aria-label={trendLabels[metric]}>{points.map((point, index) => <div key={point.matchId} className="trend-column"><b>{number(point.value)}</b><i style={{ height: `${Math.max(4, point.value / maximum * 100)}%` }} /><span>{index + 1}</span></div>)}</div>}</section>;
}

function Records({ matches, playerId, mode }: { matches: readonly Match[]; playerId: PlayerId; mode: StatisticsMode }) {
  const records = recordsForPlayer(matches, playerId, mode);
  return <section className="stat-section"><div className="record-list"><MetricCard label="Лучший подход" value={records.bestVisit} /><MetricCard label="Лучшее среднее за 3 дротика" value={number(records.bestThreeDartAverage)} /><MetricCard label="100+ / 140+ / 180 за матч" value={`${records.most100Plus} / ${records.most140Plus} / ${records.most180s}`} /><MetricCard label="Утроения / Bull за матч" value={`${records.mostTriples} / ${records.mostBulls}`} /><MetricCard label="Минимальная доля промахов" value={records.lowestMissPercent === undefined ? "—" : pct(records.lowestMissPercent)} /></div><p className="stats-note">Процентный рекорд учитывается минимум после {MIN_PERCENT_RECORD_DARTS} физических дротиков в матче.</p></section>;
}

function Comparison({ matches, players, mode, onMode, onClose }: { matches: readonly Match[]; players: readonly Player[]; mode: StatisticsMode; onMode: (value: StatisticsMode) => void; onClose: () => void }) {
  const [a, setA] = useState(players[0]?.id ?? ""), [b, setB] = useState(players[1]?.id ?? players[0]?.id ?? "");
  const playerA = players.find((player) => player.id === a), playerB = players.find((player) => player.id === b);
  const statsA = statisticsForPlayerHistory(matches, a, mode), statsB = statisticsForPlayerHistory(matches, b, mode), meetings = headToHead(matches, a, b, mode);
  return <section className="comparison"><button className="stats-back" onClick={onClose}>← К игрокам</button><h2>Сравнение игроков</h2><div className="comparison-selects"><label>Игрок A<select value={a} onChange={(event) => setA(event.target.value)}>{players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label><label>Игрок B<select value={b} onChange={(event) => setB(event.target.value)}>{players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label><label>Режим<select value={mode} onChange={(event) => onMode(event.target.value as StatisticsMode)}>{(Object.keys(modeLabels) as StatisticsMode[]).map((key) => <option key={key} value={key}>{modeLabels[key]}</option>)}</select></label></div>{a === b ? <p className="stats-note">Выберите двух разных игроков.</p> : <><div className="comparison-list">{[["Завершённые игры", statsA.completedGames, statsB.completedGames], ["Победы", statsA.wins, statsB.wins], ["Процент побед", statsA.winRate, statsB.winRate, true], ["Среднее за 3 дротика", statsA.threeDartAverage, statsB.threeDartAverage], ["Среднее за дротик", statsA.averagePerDart, statsB.averagePerDart], ["Лучший подход", statsA.bestVisit, statsB.bestVisit], ["100+", statsA.thresholds["100+"], statsB.thresholds["100+"]], ["140+", statsA.thresholds["140+"], statsB.thresholds["140+"]], ["180", statsA.thresholds["180"], statsB.thresholds["180"]], ["Доля утроений", percentage(statsA.triples, statsA.physicalDarts), percentage(statsB.triples, statsB.physicalDarts), true], ["Доля удвоений", percentage(statsA.doubles, statsA.physicalDarts), percentage(statsB.doubles, statsB.physicalDarts), true], ["Промахи", percentage(statsA.misses, statsA.physicalDarts), percentage(statsB.misses, statsB.physicalDarts), true, true]].map(([label, valueA, valueB, percent, lowerIsBetter]) => <ComparisonRow key={String(label)} label={String(label)} nameA={playerA?.name ?? "A"} nameB={playerB?.name ?? "B"} valueA={Number(valueA)} valueB={Number(valueB)} percent={Boolean(percent)} lowerIsBetter={Boolean(lowerIsBetter)} />)}</div><article className="head-to-head"><h3>Личные встречи</h3><strong>{playerA?.name} {meetings.playerAWins} : {meetings.playerBWins} {playerB?.name}</strong><span>Совместных матчей: {meetings.sharedMatches}</span><span>Победы других игроков: {meetings.otherPlayerWins}</span></article></>}</section>;
}

function ComparisonRow({ label, nameA, nameB, valueA, valueB, percent, lowerIsBetter }: { label: string; nameA: string; nameB: string; valueA: number; valueB: number; percent: boolean; lowerIsBetter: boolean }) { const format = (value: number) => percent ? pct(value) : Number.isInteger(value) ? String(value) : number(value); const aBetter = lowerIsBetter ? valueA < valueB : valueA > valueB, bBetter = lowerIsBetter ? valueB < valueA : valueB > valueA; return <article className="comparison-row"><h3>{label}</h3><div><span><small>{nameA}</small><b>{format(valueA)}</b>{aBetter ? <em>Лучше</em> : null}</span><span><small>{nameB}</small><b>{format(valueB)}</b>{bBetter ? <em>Лучше</em> : null}</span></div></article>; }

function Metric({ label, value }: { label: string; value: string | number }) {
  return <span className="metric"><small>{label}</small><b>{value}</b></span>;
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return <article className="metric-card"><small>{label}</small><strong>{value}</strong></article>;
}


```

---

## `src/presentation/statistics.css`

```css
.statistics-page{width:min(780px,100%);margin:auto;padding:18px 16px calc(32px + env(safe-area-inset-bottom));overflow-x:hidden}.stats-header{display:flex;align-items:center;gap:8px}.stats-header h1,.stats-header p{margin:0}.stats-header p{color:var(--muted);font-size:13px}.stats-player-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:20px 0}.stats-player-card{display:grid;gap:8px;text-align:left;padding:16px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}.stats-player-card>strong{font-size:20px;color:#fff;overflow:hidden;text-overflow:ellipsis}.metric{display:flex;justify-content:space-between;gap:8px}.metric small{color:var(--muted)}.metric b{color:#fff}.stats-compare-action{width:100%;padding:0 14px}.stats-back{min-height:44px;border:0;background:none;color:#d5dadd;padding:0}.stats-player-title,.comparison h2{margin:4px 0 14px}.stats-filters,.comparison-selects{display:grid;grid-template-columns:1fr 1fr;gap:8px}.stats-filters label,.comparison-selects label,.trend-select{display:grid;gap:5px;color:var(--muted);font-size:12px;font-weight:700}.stats-filters select,.comparison-selects select,.trend-select select{min-width:0;min-height:46px;padding:0 10px;border:1px solid var(--line);border-radius:7px;background:var(--surface);color:#fff}.stats-tabs{display:flex;gap:6px;overflow-x:auto;margin:16px -16px;padding:0 16px 6px;scrollbar-width:thin}.stats-tabs button{flex:0 0 auto;min-height:44px;padding:0 13px;border:1px solid var(--line);border-radius:22px;background:var(--surface)}.stats-tabs button.selected{border-color:var(--accent);color:var(--accent)}.stats-tabs.compact{margin:14px 0;padding:0;display:grid;grid-template-columns:repeat(3,1fr)}.stats-tabs.compact button{padding:0 6px}.stat-section{display:grid;gap:16px}.metric-grid,.hit-share-grid,.record-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.metric-card{min-width:0;display:grid;gap:5px;padding:13px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}.metric-card small{color:var(--muted)}.metric-card strong{font-size:20px;overflow-wrap:anywhere}.thresholds{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:8px;overflow:hidden}.thresholds .metric{display:grid;text-align:center;padding:10px;background:var(--surface)}.stats-note,.stats-insight{padding:13px;border-radius:8px;background:var(--surface2);color:var(--muted);margin:0}.sector-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:5px}.sector-cell{display:grid;place-items:center;min-height:52px;border:1px solid var(--line);border-radius:6px;background:var(--surface)}.sector-cell span{color:var(--muted);font-size:12px}.position-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.position-grid article{display:grid;gap:6px;padding:10px;background:var(--surface);border-radius:8px}.position-grid h3{font-size:13px;margin:0}.position-grid .metric{display:grid}.bar-chart{display:grid;gap:8px}.bar-row{display:grid;grid-template-columns:62px 1fr 28px;gap:8px;align-items:center;font-size:12px}.bar-row>div{height:18px;background:var(--surface);border-radius:4px;overflow:hidden}.bar-row i{display:block;height:100%;min-width:2px;background:var(--accent)}.trend-chart{height:230px;display:flex;align-items:end;gap:6px;padding:34px 8px 0;border-left:1px solid var(--line);border-bottom:1px solid var(--line);overflow-x:auto}.trend-column{height:100%;min-width:34px;display:flex;flex-direction:column;justify-content:end;align-items:center}.trend-column b{font-size:10px}.trend-column i{display:block;width:22px;min-height:3px;background:var(--accent);border-radius:3px 3px 0 0}.trend-column span{font-size:10px;color:var(--muted)}.comparison-selects{grid-template-columns:repeat(3,1fr)}.comparison-list{display:grid;gap:8px;margin-top:14px}.comparison-row{padding:12px;background:var(--surface);border-radius:8px}.comparison-row h3{margin:0 0 8px;font-size:13px;color:var(--muted)}.comparison-row>div{display:grid;grid-template-columns:1fr 1fr;gap:8px}.comparison-row span{display:grid}.comparison-row span+span{border-left:1px solid var(--line);padding-left:8px}.comparison-row small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.comparison-row b{font-size:20px}.comparison-row em{font-size:10px;color:var(--accent);font-style:normal;text-transform:uppercase}.head-to-head{display:grid;gap:5px;text-align:center;margin-top:16px;padding:16px;border:1px solid var(--accent);border-radius:9px}.head-to-head h3{margin:0}.head-to-head strong{font-size:20px}.head-to-head span{color:var(--muted);font-size:13px}
@media(max-width:520px){.stats-player-grid{grid-template-columns:1fr}.stats-filters,.comparison-selects{grid-template-columns:1fr}.position-grid{grid-template-columns:1fr}.position-grid article{grid-template-columns:1fr repeat(3,auto);align-items:center}.position-grid .metric{min-width:62px}.record-list{grid-template-columns:1fr}}
.new-records{display:grid;gap:8px;margin:0 0 18px;padding:14px;text-align:left;border:1px solid var(--accent);border-radius:9px;background:var(--surface)}.new-records h2{margin:0;font-size:18px}.new-records p{display:flex;justify-content:space-between;gap:10px;margin:0}.new-records span{color:var(--muted)}.new-records strong{font-size:18px}

```

---

## `src/presentation/strings.ts`

```ts
export const t = {
  app:'Дартс', newGame:'Новая игра', history:'История', continueMatch:'Продолжить матч', abandon:'Прервать матч',
  player1:'Игрок 1',player2:'Игрок 2',mode:'Режим',series:'Серия',starts:'Начинает',random:'Случайно',start:'Начать',
  visits:'Количество подходов',other:'Другое',currentVisit:'Текущий подход',dart:'Дротик',replace:'Заменить дротик',reset:'Сбросить подход',confirm:'Подтвердить',miss:'Мимо',bust:'Перебор',matchWon:'Матч завершён',remaining:'Осталось',average:'Среднее',last:'Последний подход',undo:'Отменить предыдущий подход',finish:'Завершить',again:'Сыграть ещё',draw:'Ничья',extra:'Сыграть дополнительный подход',finishDraw:'Завершить как ничью',empty:'Пока матчей нет',back:'Назад'
} as const;

```

---

## `src/presentation/styles.css`

```css
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#f4f6f7;background:#10151a;font-synthesis:none;--bg:#10151a;--surface:#181e24;--surface2:#20272e;--line:#39434c;--muted:#98a1a9;--accent:#f2574b;--accent2:#ffb454;--danger:#ffbf69}*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;min-width:320px;min-height:100vh;background:radial-gradient(circle at 50% -25%,#202831 0,#10151a 48%);overflow-x:hidden}button,input{font:inherit}button{color:inherit}button:focus-visible,input:focus-visible{outline:3px solid #fff;outline-offset:2px}.loading{min-height:100vh;display:grid;place-items:center;color:var(--muted)}.primary,.secondary{min-height:48px;border-radius:8px;border:1px solid var(--line);font-weight:800;text-transform:uppercase;letter-spacing:.02em}.primary{background:var(--accent);border-color:var(--accent);color:white}.primary:disabled{opacity:.4}.secondary{background:var(--surface2)}.setup-page,.history-page,.summary-page{width:min(720px,100%);margin:auto;padding:32px 20px calc(32px + env(safe-area-inset-bottom))}.brand{display:flex;gap:16px;align-items:center;margin:16px 0 30px}.brand-mark{display:grid;place-items:center;width:54px;height:54px;border:2px solid var(--accent);color:var(--accent);border-radius:50%;font-size:32px}.brand h1{margin:0;font-size:30px;text-transform:uppercase}.brand p{margin:4px 0;color:var(--muted)}.setup-form{display:grid;gap:20px}.setup-form label{display:grid;gap:8px;color:var(--muted);font-weight:700}.setup-form input{width:100%;min-height:52px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:white;padding:0 14px;font-size:18px}fieldset{border:0;margin:0;padding:0}legend{color:var(--muted);font-weight:700;margin-bottom:8px}.segments{display:grid;grid-template-columns:repeat(2,1fr);border:1px solid var(--line);border-radius:8px;overflow:hidden}.segments.three{grid-template-columns:repeat(3,1fr)}.segments.four{grid-template-columns:repeat(4,1fr)}.segments.five{grid-template-columns:repeat(5,1fr)}.segments button{min-height:50px;background:var(--surface);border:0;border-right:1px solid var(--line);font-weight:800}.segments button:last-child{border:0}.segments button.selected{background:#71302c;color:#fff;box-shadow:inset 0 0 0 2px var(--accent)}.start{height:58px;font-size:18px}.link-button,.undo-link{display:block;margin:22px auto 0;background:none;border:0;color:#c5cbd0;text-decoration:underline;min-height:44px}.resume{position:relative;width:min(680px,calc(100% - 32px));margin:16px auto 0;padding:16px;display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:center;border:1px solid var(--accent);background:var(--surface);border-radius:10px;z-index:2}.resume div{display:grid}.resume span{color:var(--muted);font-size:14px}.resume button{padding:0 14px}.fatal,.error,.notice{padding:12px;background:#3c2824;border-left:4px solid var(--accent2);color:#fff}.game-page{width:min(820px,100%);margin:auto;padding:10px 12px calc(20px + env(safe-area-inset-bottom))}.game-header{display:grid;grid-template-columns:48px 1fr 48px;align-items:center;text-align:center;margin-bottom:10px}.game-header div{display:grid}.game-header strong{text-transform:uppercase}.game-header span{color:var(--muted);font-size:13px}.text-icon{width:44px;height:44px;border:0;background:transparent;font-size:34px}.scoreboard{display:grid;grid-template-columns:1fr 1fr;gap:8px}.player-score{min-width:0;border:1px solid var(--line);border-radius:9px;background:var(--surface);padding:8px 10px}.player-score.active{border:2px solid var(--accent);padding:7px 9px;background:#1d1f23}.turn-mark,.turn-spacer{display:block;height:20px;font-size:11px;color:var(--accent);font-weight:900}.player-head{display:flex;gap:6px;justify-content:space-between;align-items:center}.player-head h2{font-size:14px;margin:0;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis}.player-head strong{color:var(--accent);font-size:18px}.player-head small{font-size:9px;color:var(--muted)}.main-score{text-align:center;font-size:clamp(46px,15vw,80px);font-weight:900;line-height:1.05;margin:4px 0 8px}.mini-stats{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--line);padding-top:7px;gap:4px}.mini-stats span{color:var(--muted);font-size:10px;display:grid}.mini-stats b{color:#fff;font-size:13px}.current-label{margin:10px 0 6px;color:var(--accent);font-size:13px}.draft-panel{display:grid;gap:8px}.section-heading{display:flex;justify-content:space-between;align-items:center}.section-heading h2{font-size:14px;margin:0}.section-heading span{font-size:12px;color:var(--accent2)}.dart-slots{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.dart-slots button{min-height:74px;display:grid;place-items:center;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:5px}.dart-slots button.filled{border-color:#697680}.dart-slots button.selected{border:2px solid var(--accent)}.dart-slots small{font-size:10px;color:var(--muted)}.dart-slots b{font-size:23px}.dart-slots span{font-size:11px;color:var(--muted)}.evaluation{display:grid;grid-template-columns:1fr 1fr;background:var(--surface);border:1px solid var(--line);border-radius:8px}.evaluation>div{padding:7px;text-align:center;display:grid}.evaluation>div+div{border-left:1px solid var(--line)}.evaluation small{color:var(--muted);text-transform:uppercase;font-size:9px}.evaluation strong{font-size:22px}.evaluation.danger strong,.reason{color:var(--danger)}.reason,.hint{margin:0;text-align:center;font-size:11px}.hint{color:var(--muted)}.draft-actions{display:grid;grid-template-columns:1fr 1fr 1.35fr;gap:7px}.draft-actions button{padding:5px;font-size:11px}.checkout{display:flex;gap:8px;align-items:center;overflow-x:auto;margin:8px 0;padding:8px 10px;background:var(--surface);border-radius:7px;font-size:11px}.checkout span{color:var(--muted)}.dart-pad{display:grid;gap:6px}.multipliers,.special{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.multipliers button,.special button,.numbers button{min-height:46px;border:1px solid var(--line);background:var(--surface);border-radius:6px;font-weight:850}.multipliers button.selected{background:#71302c;border-color:var(--accent)}.numbers{display:grid;grid-template-columns:repeat(5,1fr);gap:5px}.numbers button{font-size:18px}.special button{color:#fff}.special button:nth-child(-n+2){color:var(--accent);font-size:18px}.undo-link{font-size:12px}.tie-panel{display:grid;gap:8px;text-align:center}.summary-page{text-align:center}.summary-page .scoreboard{margin:28px 0}.eyeline{color:var(--accent);text-transform:uppercase;font-weight:900}.summary-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.history-page header{display:flex;align-items:center}.history-page header h1{margin-left:10px}.history-match{background:var(--surface);border:1px solid var(--line);border-radius:8px;margin:10px 0}.history-match summary{list-style:none;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:15px;cursor:pointer}.history-match summary div{display:grid}.history-match summary span{color:var(--muted);font-size:13px}.history-detail{padding:0 15px 15px;border-top:1px solid var(--line);font-size:13px}.history-detail ol{padding-left:24px;max-height:260px;overflow:auto}.empty{text-align:center;color:var(--muted);margin-top:80px}@media(max-width:520px){.setup-page{padding-top:14px}.brand{margin-top:4px}.brand p{font-size:13px}.resume{grid-template-columns:1fr 1fr}.resume div{grid-column:1/-1}.segments.three button{font-size:12px}.game-page{min-height:100svh}.main-score{font-size:52px}.draft-actions{grid-template-columns:1fr 1fr}.draft-actions .primary{grid-column:1/-1;grid-row:1}.numbers button{min-height:44px}.multipliers button,.special button{min-height:45px}}@media(min-width:700px){.game-page{padding-top:20px}.scoreboard{gap:14px}.player-score{padding:14px}.dart-slots button{min-height:94px}.numbers button{min-height:54px}.game-page .dart-pad{max-width:650px;margin:0 auto}.draft-actions button{font-size:13px}}@media(prefers-reduced-motion:no-preference){button{transition:background-color .12s,border-color .12s,transform .08s}button:active{transform:scale(.98)}.player-score.active{animation:turn .2s ease-out}@keyframes turn{from{opacity:.65;transform:translateY(-2px)}}}

```

---

## `src/vite-env.d.ts`

```ts
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

```

---

## `tests/completedRestore.test.tsx`

```tsx
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "../src/App";
import { services } from "../src/app/compositionRoot";
import { clearLocalData } from "../src/infrastructure/persistence/IndexedDbRepositories";
import { createMatch } from "../src/domain/match/createMatch";
import { GameSession } from "../src/application/GameSession";
import { numberThrow } from "../src/domain/darts/DartThrow";

afterEach(async () => { cleanup(); await clearLocalData(); });
describe("completed active match restore", () => {
  it("restores the result screen after reload and keeps final Undo", async () => {
    const createdAt = "2026-09-07T12:00:00.000Z";
    await services.players.save({ id: "a", name: "Михаил", createdAt });
    await services.players.save({ id: "b", name: "Александр", createdAt });
    const match = createMatch("restore", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, createdAt);
    if (match.state.kind !== "x01") throw new Error("test setup");
    const near = { ...match, state: { ...match.state, remaining: { a: 40, b: 501 } } };
    const session = new GameSession(near, services.matches, () => "visit", () => "2026-09-07T12:01:00.000Z");
    await session.record(numberThrow(20, 2)); await session.confirm();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Продолжить" }));
    expect(await screen.findByRole("heading", { name: "Михаил победил" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отменить предыдущий подход" }));
    expect(await screen.findByText("Предыдущий подход отменён.")).toBeInTheDocument();
    expect(screen.getByText("40", { selector: ".main-score" })).toBeInTheDocument();
  });
});

```

---

## `tests/domain.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  bull,
  miss,
  numberThrow,
  outerBull,
  scoreOf,
} from "../src/domain/darts/DartThrow";
import {
  addDraftThrow,
  emptyDraft,
  removeDraftThrow,
  replaceDraftThrow,
  resetDraft,
} from "../src/domain/match/VisitDraft";
import { createMatch } from "../src/domain/match/createMatch";
import { X01Rules } from "../src/domain/rules/X01Rules";
import { FixedVisitsRules } from "../src/domain/rules/FixedVisitsRules";
import type { Match } from "../src/domain/match/models";
const now = "2026-09-07T12:00:00.000Z";
const xmatch = (remaining = 501): Match => {
  const m = createMatch(
    "m",
    ["a", "b"],
    { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 },
    now,
  );
  if (m.state.kind !== "x01") throw new Error("test setup");
  return { ...m, state: { ...m.state, remaining: { a: remaining, b: 501 } } };
};
const draft = (...darts: ReturnType<typeof miss>[]) =>
  darts.reduce(addDraftThrow, emptyDraft());
describe("DartThrow", () => {
  it("scores every category", () => {
    expect([
      scoreOf(numberThrow(20, 1)),
      scoreOf(numberThrow(20, 2)),
      scoreOf(numberThrow(20, 3)),
      scoreOf(outerBull()),
      scoreOf(bull()),
      scoreOf(miss()),
    ]).toEqual([20, 40, 60, 25, 50, 0]);
  });
  it("rejects invalid sectors", () =>
    expect(() => numberThrow(21, 3)).toThrow());
  it("rejects an invalid multiplier at the runtime boundary", () =>
    expect(() => numberThrow(20, 4 as never)).toThrow());
});
describe("VisitDraft", () => {
  it("adds, replaces, removes and resets immutably", () => {
    const base = emptyDraft();
    const one = addDraftThrow(base, miss());
    const three = addDraftThrow(addDraftThrow(one, numberThrow(20, 3)), bull());
    expect(base.darts).toHaveLength(0);
    expect(three.darts).toHaveLength(3);
    expect(() => addDraftThrow(three, miss())).toThrow();
    expect(replaceDraftThrow(three, 0, outerBull()).darts[0]?.kind).toBe(
      "outer_bull",
    );
    expect(removeDraftThrow(three).darts).toHaveLength(2);
    expect(resetDraft().darts).toHaveLength(0);
  });
  it("MISS occupies a physical slot", () =>
    expect(addDraftThrow(emptyDraft(), miss()).darts).toHaveLength(1));
});
describe("X01Rules", () => {
  const rules = new X01Rules();
  it("evaluates normal score and 180", () => {
    expect(
      rules.evaluateDraft(
        draft(numberThrow(20, 3), numberThrow(20, 3), numberThrow(20, 3)),
        xmatch(),
      ),
    ).toMatchObject({
      status: "ready_to_confirm",
      rawScore: 180,
      remainingAfter: 321,
    });
  });
  it.each([
    [14, [numberThrow(20, 3)], "bust"],
  ] as const)("detects bust from %s", (remaining, darts, status) =>
    expect(
      rules.evaluateDraft(draft(...darts), xmatch(remaining)),
    ).toMatchObject({
      status,
      awardedScore: 0,
      remainingAfter: remaining,
      canAddNextDart: false,
    }),
  );
  it("allows straight-out with singles, triples, and Bull", () => {
    expect(
      rules.evaluateDraft(draft(numberThrow(1, 1), numberThrow(10, 1), numberThrow(3, 1)), xmatch(14)),
    ).toMatchObject({ status: "match_won", remainingAfter: 0 });
    expect(rules.evaluateDraft(draft(numberThrow(20, 1), numberThrow(20, 1)), xmatch(40))).toMatchObject({ status: "match_won", remainingAfter: 0 });
    expect(rules.evaluateDraft(draft(numberThrow(20, 3)), xmatch(60))).toMatchObject({ status: "match_won", remainingAfter: 0, physicalDartsUsed: 1 });
    expect(rules.evaluateDraft(draft(numberThrow(1, 1)), xmatch(1))).toMatchObject({ status: "match_won", remainingAfter: 0 });
    expect(rules.evaluateDraft(draft(bull()), xmatch(50))).toMatchObject({
      status: "match_won",
      remainingAfter: 0,
    });
  });
  it("allows remaining 1 and only busts below zero", () => {
    expect(rules.evaluateDraft(draft(numberThrow(13, 1)), xmatch(14))).toMatchObject({ status: "in_progress", remainingAfter: 1, awardedScore: 13 });
    expect(rules.evaluateDraft(draft(numberThrow(13, 1), numberThrow(1, 1)), xmatch(14))).toMatchObject({ status: "match_won", remainingAfter: 0 });
  });
  it.each([5, 10, 20, 30, 37])("accepts a limited 501 format with %i visits", (visitsPerPlayer) =>
    expect(createMatch("limited", ["a", "b"], { mode: "x01", format: { kind: "limited", visitsPerPlayer }, startingPlayerIndex: 0 }, now).state)
      .toMatchObject({ format: { kind: "limited", visitsPerPlayer } }));
});
describe("FixedVisitsRules", () => {
  it("requires exactly three darts and sums misses", () => {
    const rules = new FixedVisitsRules(),
      m = createMatch(
        "m",
        ["a", "b"],
        { mode: "fixed_visits", visitsPerPlayer: 5, startingPlayerIndex: 0 },
        now,
      );
    expect(
      rules.evaluateDraft(draft(numberThrow(20, 3), miss()), m).status,
    ).toBe("in_progress");
    expect(
      rules.evaluateDraft(
        draft(numberThrow(20, 3), miss(), numberThrow(20, 1)),
        m,
      ),
    ).toMatchObject({ status: "ready_to_confirm", rawScore: 80 });
  });
  it.each([5, 10, 20, 30, 37])("accepts %i visits", (n) =>
    expect(
      createMatch(
        "m",
        ["a", "b"],
        { mode: "fixed_visits", visitsPerPlayer: n, startingPlayerIndex: 0 },
        now,
      ).state,
    ).toMatchObject({ visitsPerPlayer: n }),
  );
});

```

---

## `tests/persistence.test.ts`

```ts
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  IndexedDbMatchRepository,
  clearLocalData,
} from "../src/infrastructure/persistence/IndexedDbRepositories";
import { createMatch } from "../src/domain/match/createMatch";
import { emptyDraft } from "../src/domain/match/VisitDraft";
import { numberThrow } from "../src/domain/darts/DartThrow";

async function putRawActive(value: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("dart-scorekeeper", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("meta", "readwrite");
      transaction.objectStore("meta").put(value, "activeMatch");
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}
describe("IndexedDB repository", () => {
  afterEach(() => clearLocalData());
  it("persists current and previous checkpoint", async () => {
    const repo = new IndexedDbMatchRepository(),
      m = createMatch(
        "m",
        ["a", "b"],
        { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 },
        new Date().toISOString(),
      );
    const draft = { playerId: "a", draft: emptyDraft() };
    await repo.saveActive({ current: m, previous: m, draft });
    expect(await repo.loadActive()).toEqual({ current: m, previous: m, draft });
  });
  it("rejects the obsolete X01 leg format instead of silently changing its rules", async () => {
    const repo = new IndexedDbMatchRepository();
    const valid = createMatch(
      "old",
      ["a", "b"],
      { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 },
      new Date().toISOString(),
    );
    const obsolete = {
      ...valid,
      state: {
        kind: "x01",
        targetLegWins: 1,
        remaining: { a: 501, b: 501 },
        legsWon: { a: 0, b: 0 },
        currentLeg: 1,
        legStarterIndex: 0,
      },
    };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("dart-scorekeeper", 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore("matches", { keyPath: "id" });
        database.createObjectStore("players", { keyPath: "id" });
        database.createObjectStore("meta");
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("meta", "readwrite");
        transaction.objectStore("meta").put({ schemaVersion: 1, current: obsolete }, "activeMatch");
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    await expect(repo.loadActive()).rejects.toThrow("Сохранённый матч повреждён");
  });
  it("persists a player-bound draft with physical darts", async () => {
    const repo = new IndexedDbMatchRepository();
    const match = createMatch("draft", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, new Date().toISOString());
    const draft = { playerId: "a", draft: { darts: [numberThrow(20, 3), numberThrow(10, 1)] } };
    await repo.saveActive({ current: match, draft });
    expect(await repo.loadActive()).toEqual({ current: match, draft });
  });
  it.each([
    ["invalid dart", { playerId: "a", draft: { darts: [{ kind: "number", segment: 21, multiplier: 3 }] } }],
    ["wrong player", { playerId: "b", draft: { darts: [numberThrow(20, 1)] } }],
    ["too many darts", { playerId: "a", draft: { darts: [numberThrow(1, 1), numberThrow(2, 1), numberThrow(3, 1), numberThrow(4, 1)] } }],
  ])("keeps a valid match and discards a corrupt draft: %s", async (_label, corruptDraft) => {
    const repo = new IndexedDbMatchRepository();
    const match = createMatch("recover", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, new Date().toISOString());
    await repo.saveActive({ current: match, draft: { playerId: "a", draft: emptyDraft() } });
    await putRawActive({ schemaVersion: 2, current: match, draft: corruptDraft });
    expect(await repo.loadActive()).toEqual({
      current: match,
      draft: { playerId: "a", draft: emptyDraft() },
      draftRecovery: "discarded_corrupt",
    });
  });
  it("rejects an unsupported future active-record version", async () => {
    const repo = new IndexedDbMatchRepository();
    const match = createMatch("future", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, new Date().toISOString());
    await repo.saveActive({ current: match, draft: { playerId: "a", draft: emptyDraft() } });
    await putRawActive({ schemaVersion: 99, current: match, draft: { playerId: "a", draft: emptyDraft() } });
    await expect(repo.loadActive()).rejects.toThrow("неподдерживаемую версию");
  });
});

```

---

## `tests/session.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { GameSession } from "../src/application/GameSession";
import type {
  ActiveMatchRecord,
  MatchRepository,
} from "../src/application/ports/repositories";
import { createMatch } from "../src/domain/match/createMatch";
import { bull, miss, numberThrow } from "../src/domain/darts/DartThrow";
import { statisticsForMatch } from "../src/domain/statistics/StatisticsCalculator";
class MemoryRepo implements MatchRepository {
  active: ActiveMatchRecord | undefined;
  history: import("../src/domain/match/models").Match[] = [];
  async saveActive(r: ActiveMatchRecord) {
    this.active = structuredClone(r);
  }
  async loadActive() {
    return this.active;
  }
  async clearActive() {
    this.active = undefined;
  }
  async saveToHistory(m: import("../src/domain/match/models").Match) {
    this.history.push(m);
  }
  async archiveAndClearActive(m: import("../src/domain/match/models").Match) {
    this.history.push(m);
    this.active = undefined;
  }
  async listHistory() {
    return this.history;
  }
}
class DeferredRepo extends MemoryRepo {
  release: (() => void) | undefined;
  defer = false;
  override async saveActive(record: ActiveMatchRecord) {
    if (this.defer)
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
    await super.saveActive(record);
  }
}
class RejectNextRepo extends MemoryRepo {
  rejectNext = false;
  override async saveActive(record: ActiveMatchRecord) {
    if (this.rejectNext) {
      this.rejectNext = false;
      throw new Error("storage unavailable");
    }
    await super.saveActive(record);
  }
}
let seq = 0;
const id = () => `id-${++seq}`,
  clock = () => `2026-09-07T12:00:0${seq}.000Z`;
const withRemaining = (
  m: import("../src/domain/match/models").Match,
  a: number,
) => {
  if (m.state.kind !== "x01") throw new Error("test setup");
  return {
    ...m,
    state: { ...m.state, remaining: { a, b: 501 } },
  } as import("../src/domain/match/models").Match;
};
describe("GameSession", () => {
  it("creates a deeply immutable confirmed visit", async () => {
    const repo = new MemoryRepo();
    const match = createMatch("immutable", ["a", "b"], { mode: "fixed_visits", visitsPerPlayer: 1, startingPlayerIndex: 0 }, clock());
    const session = new GameSession(match, repo, id, clock);
    await session.record(miss()); await session.record(miss()); await session.record(miss());
    await session.confirm();
    const visit = session.snapshot().match.confirmedVisits[0]!;
    expect(Object.isFrozen(visit.darts)).toBe(true);
    expect(Object.isFrozen(visit.before)).toBe(true);
    expect(Object.isFrozen(visit.before.scores)).toBe(true);
    expect(Object.isFrozen(visit.after)).toBe(true);
    expect(Object.isFrozen(visit.after.scores)).toBe(true);
  });
  it("draft cannot mutate match and confirmation is atomic", async () => {
    const repo = new MemoryRepo(),
      m = createMatch(
        "m",
        ["a", "b"],
        { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 },
        clock(),
      );
    const s = new GameSession(m, repo, id, clock);
    await s.record(numberThrow(20, 3));
    expect(s.snapshot().match.state).toEqual(m.state);
    await s.record(numberThrow(20, 3));
    await s.record(numberThrow(20, 3));
    await Promise.all([s.confirm(), s.confirm()]);
    expect(s.snapshot().match.confirmedVisits).toHaveLength(1);
    expect(repo.active?.current.confirmedVisits).toHaveLength(1);
    expect(s.snapshot().match.currentPlayerIndex).toBe(1);
  });
  it("undo fully restores bust and survives reload", async () => {
    const repo = new MemoryRepo(),
      m = createMatch(
        "m",
        ["a", "b"],
        { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 },
        clock(),
      );
    const near = withRemaining(m, 32);
    const s = new GameSession(near, repo, id, clock);
    await s.record(numberThrow(20, 3));
    await s.confirm();
    expect(s.snapshot().match.confirmedVisits[0]?.result).toBe("bust");
    const persisted = await repo.loadActive();
    const reloaded = new GameSession(
      persisted!.current,
      repo,
      id,
      clock,
      persisted!.previous,
      persisted!.draft,
    );
    await reloaded.undo();
    expect(reloaded.snapshot().match).toEqual(near);
  });
  it("undo reopens a completed match", async () => {
    const repo = new MemoryRepo(),
      m = createMatch(
        "m",
        ["a", "b"],
        { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 },
        clock(),
      );
    const near = withRemaining(m, 50);
    const s = new GameSession(near, repo, id, clock);
    await s.record(bull());
    await s.confirm();
    expect(s.snapshot().match.status).toBe("completed");
    await s.undo();
    expect(s.snapshot().match.status).toBe("in_progress");
  });
  it("fixed series gives equal visits then handles tie and extra round", async () => {
    const repo = new MemoryRepo(),
      m = createMatch(
        "m",
        ["a", "b"],
        { mode: "fixed_visits", visitsPerPlayer: 1, startingPlayerIndex: 0 },
        clock(),
      );
    const s = new GameSession(m, repo, id, clock);
    for (let p = 0; p < 2; p++) {
      await s.record(miss());
      await s.record(miss());
      await s.record(miss());
      await s.confirm();
    }
    expect(s.snapshot().match.state).toMatchObject({
      awaitingTieDecision: true,
      regulationCompleted: { a: 1, b: 1 },
    });
    await s.extraRound();
    for (let p = 0; p < 2; p++) {
      await s.record(p === 0 ? numberThrow(20, 3) : miss());
      await s.record(miss());
      await s.record(miss());
      await s.confirm();
    }
    expect(s.snapshot().match).toMatchObject({
      status: "completed",
      winnerId: "a",
    });
  });
  it("statistics derive raw hits and awarded bust points", async () => {
    const repo = new MemoryRepo(),
      m = createMatch(
        "m",
        ["a", "b"],
        { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 },
        clock(),
      );
    const near = withRemaining(m, 32);
    const s = new GameSession(near, repo, id, clock);
    await s.record(numberThrow(20, 3));
    await s.confirm();
    const stat = statisticsForMatch(s.snapshot().match).a!;
    expect(stat).toMatchObject({
      physicalDarts: 1,
      rawPoints: 60,
      awardedPoints: 0,
      triples: 1,
    });
  });
  it("statistics treat a winning single as a normal awarded finish", async () => {
    const repo = new MemoryRepo();
    const match = createMatch("single-finish", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, clock());
    const session = new GameSession(withRemaining(match, 1), repo, id, clock);
    await session.record(numberThrow(1, 1));
    await session.confirm();
    expect(statisticsForMatch(session.snapshot().match).a).toMatchObject({
      physicalDarts: 1,
      rawPoints: 1,
      awardedPoints: 1,
      singles: 1,
      winningHits: { S1: 1 },
      finishes: [1],
    });
  });
  it("publishes busy synchronously and rejects every competing mutation", async () => {
    const repo = new DeferredRepo();
    const match = createMatch(
      "busy",
      ["a", "b"],
      { mode: "fixed_visits", visitsPerPlayer: 5, startingPlayerIndex: 0 },
      clock(),
    );
    const session = new GameSession(match, repo, id, clock);
    await session.record(miss()); await session.record(miss()); await session.record(miss());
    repo.defer = true;
    const pending = session.confirm();
    expect(session.snapshot().isConfirming).toBe(true);
    await expect(session.record(miss())).rejects.toThrow("Подтверждение уже выполняется");
    await expect(session.reset()).rejects.toThrow("Подтверждение уже выполняется");
    await expect(session.undo()).rejects.toThrow("Подтверждение уже выполняется");
    repo.release?.();
    await pending;
    expect(session.snapshot().match.confirmedVisits).toHaveLength(1);
  });
  it.each([2, 3, 5, 8])("cycles turns across %i players", async (count) => {
    const ids = Array.from({ length: count }, (_, index) => `p${index}`);
    const repo = new MemoryRepo();
    const match = createMatch("many", ids, { mode: "fixed_visits", visitsPerPlayer: 1, startingPlayerIndex: count - 1 }, clock());
    const session = new GameSession(match, repo, id, clock);
    const seen: string[] = [];
    for (let turn = 0; turn < count; turn += 1) {
      seen.push(session.snapshot().match.players[session.snapshot().match.currentPlayerIndex]!);
      await session.record(miss()); await session.record(miss()); await session.record(miss());
      await session.confirm();
    }
    expect(seen).toEqual([ids.at(-1), ...ids.slice(0, -1)]);
    expect(session.snapshot().match.state).toMatchObject({ regulationCompleted: Object.fromEntries(ids.map((playerId) => [playerId, 1])), awaitingTieDecision: true });
  });
  it.each([2, 3, 5])("limited 501 waits for the full final round across %i players", async (count) => {
    const ids = Array.from({ length: count }, (_, index) => `p${index}`);
    const repo = new MemoryRepo();
    const match = createMatch("limited", ids, { mode: "x01", format: { kind: "limited", visitsPerPlayer: 1 }, startingPlayerIndex: 0 }, clock());
    const session = new GameSession(match, repo, id, clock);
    for (let index = 0; index < count; index += 1) {
      await session.record(index === 0 ? numberThrow(20, 1) : miss()); await session.record(miss()); await session.record(miss());
      await session.confirm();
      expect(session.snapshot().match.status).toBe(index === count - 1 ? "completed" : "in_progress");
    }
    expect(session.snapshot().match.winnerId).toBe("p0");
  });
  it("limited 501 ends immediately when a player reaches zero", async () => {
    const repo = new MemoryRepo();
    const base = createMatch("early", ["a", "b"], { mode: "x01", format: { kind: "limited", visitsPerPlayer: 20 }, startingPlayerIndex: 0 }, clock());
    const session = new GameSession(withRemaining(base, 60), repo, id, clock);
    await session.record(numberThrow(20, 3));
    await session.confirm();
    expect(session.snapshot().match).toMatchObject({ status: "completed", winnerId: "a" });
  });
  it("limited 501 tie-break includes only minimum-remaining leaders and resolves after their full round", async () => {
    const repo = new MemoryRepo();
    const match = createMatch("tie", ["a", "b", "c"], { mode: "x01", format: { kind: "limited", visitsPerPlayer: 1 }, startingPlayerIndex: 0 }, clock());
    const session = new GameSession(match, repo, id, clock);
    for (const first of [numberThrow(10, 1), numberThrow(10, 1), miss()]) {
      await session.record(first); await session.record(miss()); await session.record(miss()); await session.confirm();
    }
    expect(session.snapshot().match.state).toMatchObject({ phase: { kind: "awaiting_tie_break", playerIds: ["a", "b"], round: 1 } });
    await session.extraRound();
    await session.record(numberThrow(20, 1)); await session.record(miss()); await session.record(miss()); await session.confirm();
    expect(session.snapshot().match.status).toBe("in_progress");
    expect(session.snapshot().match.currentPlayerIndex).toBe(1);
    await session.record(numberThrow(10, 1)); await session.record(miss()); await session.record(miss()); await session.confirm();
    expect(session.snapshot().match).toMatchObject({ status: "completed", winnerId: "a" });
  });
  it("does not award a tie-break before every tied leader completes the round", async () => {
    const repo = new MemoryRepo();
    const base = createMatch("tie-zero", ["a", "b"], { mode: "x01", format: { kind: "limited", visitsPerPlayer: 1 }, startingPlayerIndex: 0 }, clock());
    if (base.state.kind !== "x01") throw new Error("test setup");
    const awaiting = {
      ...base,
      state: {
        ...base.state,
        remaining: { a: 1, b: 2 },
        visitsCompleted: { a: 1, b: 1 },
        phase: { kind: "awaiting_tie_break" as const, playerIds: ["a", "b"], round: 1 },
      },
    };
    const session = new GameSession(awaiting, repo, id, clock);
    await session.extraRound();
    await session.record(numberThrow(1, 1));
    await session.confirm();
    expect(session.snapshot().match).toMatchObject({ status: "in_progress", currentPlayerIndex: 1 });
    await session.record(miss()); await session.record(miss()); await session.record(miss());
    await session.confirm();
    expect(session.snapshot().match).toMatchObject({ status: "completed", winnerId: "a" });
  });
  it("persists every add, replace, remove, and reset of the active draft", async () => {
    const repo = new MemoryRepo();
    const match = createMatch("draft-commands", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, clock());
    const session = new GameSession(match, repo, id, clock);

    await session.record(numberThrow(20, 3));
    expect(repo.active?.draft).toMatchObject({ playerId: "a", draft: { darts: [numberThrow(20, 3)] } });
    await session.record(numberThrow(10, 1));
    expect(repo.active?.draft.draft.darts).toEqual([numberThrow(20, 3), numberThrow(10, 1)]);
    await session.record(numberThrow(5, 1), 0);
    expect(repo.active?.draft.draft.darts).toEqual([numberThrow(5, 1), numberThrow(10, 1)]);
    await session.remove();
    expect(repo.active?.draft.draft.darts).toEqual([numberThrow(5, 1)]);
    await session.reset();
    expect(repo.active?.draft.draft.darts).toEqual([]);
    expect(session.snapshot().match).toEqual(match);
  });
  it("does not publish a draft mutation when persistence fails and allows retry", async () => {
    const repo = new RejectNextRepo();
    const match = createMatch("draft-failure", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, clock());
    const session = new GameSession(match, repo, id, clock);
    repo.rejectNext = true;
    await expect(session.record(numberThrow(20, 1))).rejects.toThrow("storage unavailable");
    expect(session.snapshot()).toMatchObject({ match, draft: { darts: [] }, isConfirming: false });
    await session.record(numberThrow(20, 1));
    expect(session.snapshot().draft.darts).toEqual([numberThrow(20, 1)]);
    expect(repo.active?.draft.draft.darts).toEqual([numberThrow(20, 1)]);
  });
  it("restores a two-dart draft without applying it and can confirm it", async () => {
    const repo = new MemoryRepo();
    const match = createMatch("restored-draft", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, clock());
    const first = new GameSession(match, repo, id, clock);
    await first.record(numberThrow(20, 3));
    await first.record(numberThrow(10, 1));
    const active = (await repo.loadActive())!;

    const restored = new GameSession(active.current, repo, id, clock, active.previous, active.draft);
    expect(restored.snapshot().match).toEqual(match);
    expect(restored.snapshot().draft.darts).toEqual([numberThrow(20, 3), numberThrow(10, 1)]);
    await restored.record(numberThrow(5, 1));
    await restored.confirm();
    expect(restored.snapshot().match.state).toMatchObject({ remaining: { a: 426, b: 501 } });
    expect(restored.snapshot().match.confirmedVisits).toHaveLength(1);
  });
  it("restores and confirms early finishes and busts", async () => {
    const finishRepo = new MemoryRepo();
    const base = createMatch("restored-finish", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, clock());
    const finishMatch = withRemaining(base, 60);
    const finish = new GameSession(finishMatch, finishRepo, id, clock);
    await finish.record(numberThrow(20, 3));
    const finishActive = (await finishRepo.loadActive())!;
    const restoredFinish = new GameSession(finishActive.current, finishRepo, id, clock, finishActive.previous, finishActive.draft);
    expect(restoredFinish.snapshot().evaluation.status).toBe("match_won");
    await restoredFinish.confirm();
    expect(restoredFinish.snapshot().match.status).toBe("completed");

    const bustRepo = new MemoryRepo();
    const bustMatch = withRemaining(base, 32);
    const bust = new GameSession(bustMatch, bustRepo, id, clock);
    await bust.record(numberThrow(20, 3));
    const bustActive = (await bustRepo.loadActive())!;
    const restoredBust = new GameSession(bustActive.current, bustRepo, id, clock, bustActive.previous, bustActive.draft);
    expect(restoredBust.snapshot().evaluation.status).toBe("bust");
    await restoredBust.confirm();
    expect(restoredBust.snapshot().match).toMatchObject({ currentPlayerIndex: 1, state: { remaining: { a: 32, b: 501 } } });
  });
  it("does not silently discard a current draft during Undo", async () => {
    const repo = new MemoryRepo();
    const match = createMatch("draft-undo", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, clock());
    const session = new GameSession(match, repo, id, clock);
    await session.record(miss()); await session.record(miss()); await session.record(miss()); await session.confirm();
    await session.record(numberThrow(20, 1));
    await expect(session.undo()).rejects.toThrow("Сначала сбросьте незавершённый подход");
    expect(session.snapshot().draft.darts).toEqual([numberThrow(20, 1)]);
    await session.undo(true);
    expect(session.snapshot().draft.darts).toEqual([]);
    expect(session.snapshot().match).toEqual(match);
  });
  it("removes an unconfirmed draft when abandoning or finalizing", async () => {
    const abandonRepo = new MemoryRepo();
    const match = createMatch("draft-abandon", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, clock());
    const abandoned = new GameSession(match, abandonRepo, id, clock);
    await abandoned.record(numberThrow(20, 1));
    await abandoned.abandon();
    expect(abandonRepo.active).toBeUndefined();
    expect(abandonRepo.history[0]?.confirmedVisits).toHaveLength(0);

    const finishRepo = new MemoryRepo();
    const finish = new GameSession(withRemaining(match, 1), finishRepo, id, clock);
    await finish.record(numberThrow(1, 1));
    await finish.confirm();
    await finish.finalize();
    expect(finishRepo.active).toBeUndefined();
    expect(finishRepo.history[0]?.confirmedVisits).toHaveLength(1);
  });
});

```

---

## `tests/setup.test.tsx`

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupPage } from "../src/presentation/pages/SetupPage";

describe("SetupPage participants", () => {
  afterEach(cleanup);
  it("starts immediately with temporary default players and allows duplicate display names", async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    render(<SetupPage saved={[]} onStart={onStart} onHistory={() => undefined} onStatistics={() => undefined} />);
    expect(screen.getByLabelText("Имя игрока 1")).toHaveValue("Игрок 1");
    expect(screen.getByLabelText("Имя игрока 2")).toHaveValue("Игрок 2");
    fireEvent.change(screen.getByLabelText("Имя игрока 1"), { target: { value: "Миша" } });
    fireEvent.change(screen.getByLabelText("Имя игрока 2"), { target: { value: "Миша" } });
    fireEvent.click(screen.getByRole("button", { name: "Начать" }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith([{ name: "Миша" }, { name: "Миша" }], expect.objectContaining({ mode: "x01" })));
  });

  it("selects a saved player by stable id instead of matching by name", async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    render(<SetupPage saved={[{ id: "saved-id", name: "Миша", createdAt: "2026-01-01" }]} onStart={onStart} onHistory={() => undefined} onStatistics={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Выбрать сохранённого игрока 1"), { target: { value: "saved-id" } });
    fireEvent.click(screen.getByRole("button", { name: "Начать" }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith([{ name: "Миша", playerId: "saved-id" }, { name: "Игрок 2" }], expect.anything()));
  });
});

```

---

## `tests/setup.ts`

```ts
import '@testing-library/jest-dom/vitest';

```

---

## `tests/statistics.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { bull, miss, numberThrow, outerBull, scoreOf, type DartThrow } from "../src/domain/darts/DartThrow";
import { createMatch } from "../src/domain/match/createMatch";
import type { Match, PlayerId, Visit, VisitResult } from "../src/domain/match/models";
import { MIN_PERCENT_RECORD_DARTS, filteredMatches, headToHead, newRecordsForMatch, recordsForPlayer, standardDeviation, statisticsForPlayerHistory, statisticsForVisits, trendForPlayer } from "../src/domain/statistics/StatisticsCalculator";

const at = (day: number) => `2026-01-${String(day).padStart(2, "0")}T12:00:00.000Z`;
function visit(id: string, playerId: PlayerId, darts: readonly DartThrow[], options: { awarded?: number; result?: VisitResult } = {}): Visit {
  const rawScore = darts.reduce((sum, dart) => sum + scoreOf(dart), 0);
  return { id, matchId: "match", playerId, visitIndex: Number(id.replace(/\D/g, "")) || 0, darts, physicalDartsUsed: darts.length, rawScore, awardedScore: options.awarded ?? rawScore, before: { scores: { a: 501, b: 501, c: 501 }, currentPlayerIndex: 0 }, after: { scores: { a: 501, b: 501, c: 501 }, currentPlayerIndex: 1 }, result: options.result ?? "scored", timestamp: at(1) };
}
function match(id: string, day: number, mode: "x01" | "fixed_visits", visits: readonly Visit[], winnerId?: string, players: readonly string[] = ["a", "b"], status: Match["status"] = "completed"): Match {
  const base = createMatch(id, players, mode === "x01" ? { mode, format: { kind: "unlimited" }, startingPlayerIndex: 0 } : { mode, visitsPerPlayer: 1, startingPlayerIndex: 0 }, at(day));
  return { ...base, id, createdAt: at(day), ...(status === "completed" ? { completedAt: at(day) } : {}), status, confirmedVisits: visits.map((item) => ({ ...item, matchId: id })), ...(winnerId ? { winnerId } : {}) };
}

describe("statistics projections", () => {
  it("counts physical hits, exact sectors, positions and early finish without invented misses", () => {
    const visits = [
      visit("v1", "a", [numberThrow(1, 1), numberThrow(10, 2), numberThrow(20, 3)]),
      visit("v2", "a", [outerBull(), bull(), miss()]),
      visit("v3", "a", [numberThrow(20, 3)], { result: "match_won" }),
    ];
    const stats = statisticsForVisits(visits, "a");
    expect(stats).toMatchObject({ physicalDarts: 7, visits: 3, singles: 1, doubles: 1, triples: 2, outerBulls: 1, bulls: 1, misses: 1, rawPoints: 216, awardedPoints: 216, bestVisit: 81 });
    expect(stats.hitCounts).toMatchObject({ S1: 1, D10: 1, T20: 2, "25": 1, Bull: 1, MISS: 1 });
    expect(stats.positions.map((position) => position.physicalDarts)).toEqual([3, 2, 2]);
    expect(stats.positions[0].average).toBeCloseTo(86 / 3);
    expect(stats.positions[2]).toMatchObject({ missPercent: 50, triplePercent: 50 });
    expect(stats.averagePerVisit).toBe(72);
    expect(stats.threeDartAverage).toBeCloseTo(216 * 3 / 7);
  });

  it("uses cumulative thresholds, exact buckets and a transparent standard deviation", () => {
    const scores = [0, 20, 40, 60, 80, 100, 120, 140, 180];
    const visits = scores.map((score, index) => visit(`v${index}`, "a", score === 0 ? [miss()] : score === 180 ? [numberThrow(20, 3), numberThrow(20, 3), numberThrow(20, 3)] : [numberThrow(Math.min(20, score), 1)], { awarded: score }));
    // The explicit score is what a confirmed visit stores; physical darts remain real facts.
    const confirmed = visits.map((item, index) => ({ ...item, rawScore: scores[index]!, awardedScore: scores[index]! }));
    const stats = statisticsForVisits(confirmed, "a");
    expect(stats.thresholds).toEqual({ "60+": 6, "80+": 5, "100+": 4, "120+": 3, "140+": 2, "180": 1 });
    expect(Object.values(stats.distribution)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(stats.resultSpread).toBeCloseTo(standardDeviation(scores));
  });

  it("keeps bust hits raw while awarded scoring remains zero", () => {
    const stats = statisticsForVisits([visit("v1", "a", [numberThrow(20, 3)], { awarded: 0, result: "bust" })], "a");
    expect(stats).toMatchObject({ physicalDarts: 1, rawPoints: 60, awardedPoints: 0, averagePerDart: 0, triples: 1 });
    expect(stats.hitCounts.T20).toBe(1);
  });

  it("returns finite zeroes with no physical darts", () => {
    const stats = statisticsForVisits([], "a");
    expect([stats.averagePerDart, stats.averagePerVisit, stats.threeDartAverage, stats.resultSpread, ...stats.positions.flatMap((position) => [position.average, position.missPercent, position.triplePercent])].every(Number.isFinite)).toBe(true);
  });

  it("excludes abandoned matches from win rate but retains their confirmed darts", () => {
    const won = match("won", 1, "x01", [visit("v1", "a", [numberThrow(20, 3)])], "a");
    const lost = match("lost", 2, "x01", [visit("v2", "a", [numberThrow(20, 1)])], "b");
    const abandoned = match("abandoned", 3, "x01", [visit("v3", "a", [miss()])], undefined, ["a", "b"], "abandoned");
    const stats = statisticsForPlayerHistory([won, lost, abandoned], "a");
    expect(stats).toMatchObject({ matches: 3, completedGames: 2, wins: 1, losses: 1, winRate: 50, physicalDarts: 3, misses: 1 });
  });

  it("filters mode and last 5/10/20 without changing chronological trend order", () => {
    const matches = Array.from({ length: 24 }, (_, index) => match(`m${index}`, index + 1, index % 2 ? "x01" : "fixed_visits", [visit(`v${index}`, "a", [numberThrow(1, 1)])], "a"));
    expect(filteredMatches(matches, "a", "x01", 5)).toHaveLength(5);
    expect(statisticsForPlayerHistory(matches, "a", "fixed_visits", 10).matches).toBe(10);
    expect(filteredMatches(matches, "a", "all", 20)).toHaveLength(20);
    expect(trendForPlayer(matches, "a", "bestVisit", "x01", 5).map((point) => point.matchId)).toEqual(["m15", "m17", "m19", "m21", "m23"]);
  });

  it("calculates records and applies the named percentage minimum sample", () => {
    const tooShort = match("short", 1, "x01", [visit("v1", "a", [numberThrow(20, 3)])], "a");
    const enoughDarts = Array.from({ length: MIN_PERCENT_RECORD_DARTS / 3 }, (_, index) => visit(`e${index}`, "a", [miss(), numberThrow(20, 3), numberThrow(20, 3)]));
    const records = recordsForPlayer([tooShort, match("enough", 2, "x01", enoughDarts, "a")], "a");
    expect(records).toMatchObject({ bestVisit: 120, mostTriples: 10 });
    expect(records.lowestMissPercent).toBeCloseTo(100 / 3);
  });

  it("does not celebrate the first baseline match and detects a later real record", () => {
    const first = match("first", 1, "x01", [visit("v1", "a", [numberThrow(20, 1)])], "a");
    const better = match("better", 2, "x01", [visit("v2", "a", [numberThrow(20, 3), numberThrow(20, 3)])], "a");
    expect(newRecordsForMatch(first, [], "a")).toEqual([]);
    expect(newRecordsForMatch(better, [first], "a").map((record) => record.key)).toEqual(expect.arrayContaining(["bestVisit", "bestThreeDartAverage", "mostTriples", "most100Plus"]));
  });

  it("counts multiplayer head-to-head without turning a third-player win into a duel win", () => {
    const shared = [match("a", 1, "x01", [], "a", ["a", "b", "c"]), match("b", 2, "fixed_visits", [], "b", ["a", "b", "c"]), match("c", 3, "x01", [], "c", ["a", "b", "c"])];
    expect(headToHead(shared, "a", "b")).toEqual({ sharedMatches: 3, playerAWins: 1, playerBWins: 1, otherPlayerWins: 1 });
    expect(headToHead(shared, "a", "b", "x01")).toEqual({ sharedMatches: 2, playerAWins: 1, playerBWins: 0, otherPlayerWins: 1 });
  });
});

```

---

## `tsconfig.app.json`

```json
{
  "compilerOptions": {
    "target": "ES2022", "useDefineForClassFields": true, "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false, "skipLibCheck": true, "esModuleInterop": true, "allowSyntheticDefaultImports": true,
    "strict": true, "forceConsistentCasingInFileNames": true, "module": "ESNext", "moduleResolution": "Bundler",
    "resolveJsonModule": true, "isolatedModules": true, "noEmit": true, "jsx": "react-jsx",
    "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true
  },
  "include": ["src", "tests"]
}

```

---

## `tsconfig.json`

```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]
}

```

---

## `tsconfig.node.json`

```json
{
  "compilerOptions": { "composite": true, "skipLibCheck": true, "module": "ESNext", "moduleResolution": "Bundler", "allowImportingTsExtensions": true, "noEmit": true },
  "include": ["vite.config.ts", "eslint.config.js"]
}

```

---

## `vite.config.ts`

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['icon-192.svg', 'icon-512.svg'],
    manifest: {
      name: 'Счётчик дартса', short_name: 'Дартс', description: 'Локальный счёт и статистика дартса',
      theme_color: '#11161b', background_color: '#11161b', display: 'standalone', lang: 'ru',
      icons: [
        { src: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
        { src: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }
      ]
    },
    workbox: { cleanupOutdatedCaches: true, navigateFallback: '/index.html' }
  })],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['./tests/**/*.test.{ts,tsx}'],
  },
  preview: {
    allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
  },
});

```
