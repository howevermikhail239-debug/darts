import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('e2e-storage-cleared')) return;
    sessionStorage.setItem('e2e-storage-cleared', 'true');
    localStorage.clear();
    indexedDB.deleteDatabase('dart-scorekeeper');
  });
});

async function startMatch(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.getByText('Текущий подход:')).toBeVisible();
}

async function startLimited501(page: import('@playwright/test').Page, players = 2, limit = 5) {
  await page.goto('/');
  const add = page.getByRole('button', { name: '+ Добавить игрока' });
  for (let count = 2; count < players; count += 1) await add.click();
  await page.getByRole('button', { name: 'Ограничить количество подходов' }).click();
  await page.getByRole('button', { name: String(limit), exact: true }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
}

async function installZeroTieBreakFixture(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const record = {
      schemaVersion: 2,
      current: {
        id: 'zero-tie-break',
        createdAt: '2026-09-08T12:00:00.000Z',
        status: 'in_progress',
        players: ['a', 'b'],
        participantNames: { a: 'Игрок A', b: 'Игрок B' },
        startingPlayerIndex: 0,
        currentPlayerIndex: 0,
        confirmedVisits: [],
        state: {
          kind: 'x01',
          format: { kind: 'limited', visitsPerPlayer: 1 },
          remaining: { a: 0, b: 0 },
          visitsCompleted: { a: 1, b: 1 },
          phase: { kind: 'awaiting_tie_break', playerIds: ['a', 'b'], round: 1 },
        },
      },
      draft: { playerId: 'a', draft: { darts: [] } },
    };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('dart-scorekeeper');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('meta', 'readwrite');
        transaction.objectStore('meta').put(record, 'activeMatch');
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Продолжить' }).click();
}

async function installSavedProfiles(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const profiles = [
      { id: 'saved-player-1', name: 'Игрок 1', createdAt: '2026-09-08T12:00:00.000Z' },
      { id: 'saved-player-2', name: 'Игрок 2', createdAt: '2026-09-08T12:00:00.000Z' },
    ];
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('dart-scorekeeper');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('players', 'readwrite');
        profiles.forEach((profile) => transaction.objectStore('players').put(profile));
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  });
  await page.reload();
}

async function createLocalProfile(page: import('@playwright/test').Page, name: string) {
  const temporary = page.locator('.participant-card.temporary').first();
  const card = (await temporary.count()) ? temporary : page.locator('.participant-card').first();
  await card.getByRole('button', { name: /Создать профиль|Создать другой профиль|Сохранить как профиль/ }).click();
  await card.getByLabel('Имя профиля').fill(name);
  await card.getByRole('button', { name: 'Создать и выбрать' }).click();
  await expect(page.getByLabel('Выбрать сохранённого игрока 1').locator('option', { hasText: name })).toHaveCount(1);
}

async function startOneVisitSeriesWithProfiles(page: import('@playwright/test').Page, names: readonly string[]) {
  await page.goto('/');
  for (let count = 2; count < names.length; count += 1)
    await page.getByRole('button', { name: '+ Добавить игрока' }).click();
  for (let index = 0; index < names.length; index += 1) {
    await page.getByLabel(`Выбрать сохранённого игрока ${index + 1}`).selectOption({ label: names[index]! });
  }
  await page.getByRole('button', { name: 'Серия' }).click();
  await page.getByRole('button', { name: 'Другое' }).click();
  await page.getByLabel('Другое количество подходов').fill('1');
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.getByText('Текущий подход:')).toBeVisible();
}

async function missVisit(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Мимо' }).click();
  await page.getByRole('button', { name: 'Мимо' }).click();
  await page.getByRole('button', { name: 'Мимо' }).click();
  await page.getByRole('button', { name: 'Подтвердить 0' }).click();
}

async function startOneVisitSeries(page: import('@playwright/test').Page, players = 2, useSavedProfiles = false) {
  await page.goto('/');
  const add = page.getByRole('button', { name: '+ Добавить игрока' });
  for (let count = 2; count < players; count += 1) await add.click();
  if (useSavedProfiles) {
    await page.getByLabel('Выбрать сохранённого игрока 1').selectOption('saved-player-1');
    await page.getByLabel('Выбрать сохранённого игрока 2').selectOption('saved-player-2');
  }
  await page.getByRole('button', { name: 'Серия' }).click();
  await page.getByRole('button', { name: 'Другое' }).click();
  await page.getByLabel('Другое количество подходов').fill('1');
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.getByText('Текущий подход:')).toBeVisible();
}

async function scoringVisit(page: import('@playwright/test').Page, segment: number) {
  await page.getByRole('button', { name: `Сектор ${segment}, множитель 1` }).click();
  await page.getByRole('button', { name: 'Мимо' }).click();
  await page.getByRole('button', { name: 'Мимо' }).click();
  await page.getByRole('button', { name: `Подтвердить ${segment}` }).click();
}

async function scoreToForty(page: import('@playwright/test').Page) {
  for (let turn = 0; turn < 2; turn += 1) {
    await page.getByRole('button', { name: '×3' }).click();
    await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
    await page.getByRole('button', { name: '×3' }).click();
    await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
    await page.getByRole('button', { name: '×3' }).click();
    await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
    await page.getByRole('button', { name: 'Подтвердить 180' }).click();
    await missVisit(page);
  }
  await page.getByRole('button', { name: '×3' }).click();
  await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
  await page.getByRole('button', { name: 'Сектор 1, множитель 1' }).click();
  await page.getByRole('button', { name: '×2' }).click();
  await page.getByRole('button', { name: 'Сектор 20, множитель 2' }).click();
  await page.getByRole('button', { name: 'Подтвердить 101' }).click();
  await missVisit(page);
  await expect(page.locator('.main-score').first()).toHaveText('40');
}

async function scoreToFifty(page: import('@playwright/test').Page) {
  for (let turn = 0; turn < 2; turn += 1) {
    for (let dart = 0; dart < 3; dart += 1) {
      await page.getByRole('button', { name: '×3' }).click();
      await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
    }
    await page.getByRole('button', { name: 'Подтвердить 180' }).click();
    await missVisit(page);
  }
  await page.getByRole('button', { name: '×3' }).click();
  await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
  await page.getByRole('button', { name: 'Сектор 11, множитель 1' }).click();
  await page.getByRole('button', { name: '×2' }).click();
  await page.getByRole('button', { name: 'Сектор 10, множитель 2' }).click();
  await page.getByRole('button', { name: 'Подтвердить 91' }).click();
  await missVisit(page);
  await expect(page.locator('.main-score').first()).toHaveText('50');
}

async function scoreToFourteen(page: import('@playwright/test').Page) {
  for (let turn = 0; turn < 2; turn += 1) {
    for (let dart = 0; dart < 3; dart += 1) {
      await page.getByRole('button', { name: '×3' }).click();
      await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
    }
    await page.getByRole('button', { name: 'Подтвердить 180' }).click();
    await missVisit(page);
  }
  await page.getByRole('button', { name: '×3' }).click();
  await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
  await page.getByRole('button', { name: '×3' }).click();
  await page.getByRole('button', { name: 'Сектор 19, множитель 3' }).click();
  await page.getByRole('button', { name: 'Сектор 10, множитель 1' }).click();
  await page.getByRole('button', { name: 'Подтвердить 127' }).click();
  await missVisit(page);
  await expect(page.locator('.main-score').first()).toHaveText('14');
}

async function scoreToOne(page: import('@playwright/test').Page) {
  for (let turn = 0; turn < 2; turn += 1) {
    for (let dart = 0; dart < 3; dart += 1) {
      await page.getByRole('button', { name: '×3' }).click();
      await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
    }
    await page.getByRole('button', { name: 'Подтвердить 180' }).click();
    await missVisit(page);
  }
  await page.getByRole('button', { name: '×3' }).click();
  await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
  await page.getByRole('button', { name: '×3' }).click();
  await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
  await page.getByRole('button', { name: 'Сектор 20, множитель 1' }).click();
  await page.getByRole('button', { name: 'Подтвердить 140' }).click();
  await missVisit(page);
  await expect(page.locator('.main-score').first()).toHaveText('1');
}

async function scoreToSixty(page: import('@playwright/test').Page) {
  for (let turn = 0; turn < 2; turn += 1) {
    for (let dart = 0; dart < 3; dart += 1) {
      await page.getByRole('button', { name: '×3' }).click();
      await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
    }
    await page.getByRole('button', { name: 'Подтвердить 180' }).click();
    await missVisit(page);
  }
  await page.getByRole('button', { name: '×3' }).click();
  await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
  await page.getByRole('button', { name: 'Сектор 1, множитель 1' }).click();
  await page.getByRole('button', { name: 'Сектор 20, множитель 1' }).click();
  await page.getByRole('button', { name: 'Подтвердить 81' }).click();
  await missVisit(page);
  await expect(page.locator('.main-score').first()).toHaveText('60');
}

test('501: draft can be replaced and only Confirm changes the match', async ({ page }) => {
  await startMatch(page);
  await page.getByRole('button', { name: '×3' }).click();
  await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
  await page.getByRole('button', { name: 'Сектор 5, множитель 1' }).click();
  await page.getByRole('button', { name: '×3' }).click();
  await page.getByRole('button', { name: 'Сектор 17, множитель 3' }).click();

  await expect(page.getByRole('button', { name: 'Дротик 1: T20, заменить' })).toBeVisible();
  await expect(page.getByText('501', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Дротик 2: S5, заменить' }).click();
  await page.getByRole('button', { name: 'Сектор 1, множитель 1' }).click();
  await expect(page.getByRole('button', { name: 'Дротик 2: S1, заменить' })).toBeVisible();
  await page.getByRole('button', { name: 'Подтвердить 112' }).click();
  await expect(page.getByText('Текущий подход: Игрок 2')).toBeVisible();
  await expect(page.locator('.main-score').first()).toHaveText('389');
});

test('setup supports 3, 5, and 8 players without exceeding the UI limit', async ({ page }) => {
  await page.goto('/');
  const add = page.getByRole('button', { name: '+ Добавить игрока' });
  for (let count = 2; count < 8; count += 1) await add.click();
  await expect(add).toBeHidden();
  await expect(page.getByRole('textbox')).toHaveCount(8);
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.getByRole('region', { name: 'Счёт игроков' }).locator('article')).toHaveCount(8);
  await expect(page.getByText('Текущий подход: Игрок 1')).toBeVisible();
});

test('fixed visits completes only after equal visits for both players', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Серия' }).click();
  await page.getByRole('button', { name: '5', exact: true }).click();
  await page.getByRole('button', { name: 'Начать' }).click();

  for (let visit = 0; visit < 5; visit += 1) {
    await page.getByRole('button', { name: '×3' }).click();
    await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
    await page.getByRole('button', { name: 'Мимо' }).click();
    await page.getByRole('button', { name: 'Мимо' }).click();
    await page.getByRole('button', { name: 'Подтвердить 60' }).click();
    await page.getByRole('button', { name: 'Мимо' }).click();
    await page.getByRole('button', { name: 'Мимо' }).click();
    await page.getByRole('button', { name: 'Мимо' }).click();
    await page.getByRole('button', { name: 'Подтвердить 0' }).click();
  }

  await expect(page.getByRole('heading', { name: 'Игрок 1 победил' })).toBeVisible();
  await expect(page.getByText('300', { exact: true })).toBeVisible();
});

test('501: S20 + S20 straight-out completes the match and Undo restores it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Начать' }).click();
  await scoreToForty(page);
  await page.getByRole('button', { name: 'Сектор 20, множитель 1' }).click();
  await page.getByRole('button', { name: 'Сектор 20, множитель 1' }).click();
  await expect(page.getByText('После подтверждения')).toBeVisible();
  await page.getByRole('button', { name: 'Подтвердить 40' }).click();
  await expect(page.getByRole('heading', { name: 'Игрок 1 победил' })).toBeVisible();
  await page.getByRole('button', { name: 'Отменить предыдущий подход' }).click();
  await expect(page.getByText('Текущий подход: Игрок 1')).toBeVisible();
  await expect(page.locator('.main-score').first()).toHaveText('40');
});

test('501 busts preserve the score until Confirm and hand over the turn', async ({ page }) => {
  await startMatch(page);
  await scoreToForty(page);
  await page.getByRole('button', { name: '×3' }).click();
  await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
  await expect(page.getByText('Перебор', { exact: true })).toBeVisible();
  await expect(page.locator('.main-score').first()).toHaveText('40');
  await expect(page.getByRole('button', { name: 'Мимо' })).toBeDisabled();
  await page.getByRole('button', { name: /подтвердить перебор/i }).click();
  await expect(page.locator('.main-score').first()).toHaveText('40');
  await expect(page.getByText('Текущий подход: Игрок 2')).toBeVisible();
});

test('501 accepts Bull as an ordinary one-dart straight-out', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Начать' }).click();
  await scoreToFifty(page);
  await page.getByRole('button', { name: '50' }).click();
  await expect(page.getByRole('button', { name: 'Дротик 1: Bull, заменить' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Дротик 2: пусто' })).toBeVisible();
  await page.getByRole('button', { name: 'Подтвердить 50' }).click();
  await expect(page.getByRole('heading', { name: 'Игрок 1 победил' })).toBeVisible();
});

test('reload restores confirmed play and Undo uses the persisted checkpoint', async ({ page }) => {
  await startMatch(page);
  await page.getByRole('button', { name: 'Сектор 20, множитель 1' }).click();
  await page.getByRole('button', { name: 'Мимо' }).click();
  await page.getByRole('button', { name: 'Мимо' }).click();
  await page.getByRole('button', { name: 'Подтвердить 20' }).click();
  await expect(page.getByText('Текущий подход: Игрок 2')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByText('Текущий подход: Игрок 2')).toBeVisible();
  await page.getByRole('button', { name: 'Отменить предыдущий подход' }).click();
  await expect(page.getByText('Текущий подход: Игрок 1')).toBeVisible();
  await expect(page.locator('.main-score').first()).toHaveText('501');
});

test('fixed visits tie can start an extra round and safely tie again', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Серия' }).click();
  await page.getByRole('button', { name: '5', exact: true }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  for (let visit = 0; visit < 10; visit += 1) await missVisit(page);
  await expect(page.getByRole('heading', { name: /ничья/i })).toBeVisible();
  await page.getByRole('button', { name: /дополнительный подход/i }).click();
  await missVisit(page);
  await expect(page.getByText('Текущий подход: Игрок 2')).toBeVisible();
  await missVisit(page);
  await expect(page.getByRole('heading', { name: /ничья/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /дополнительный подход/i })).toBeVisible();
});

test('abandon archives confirmed play and does not offer resume after reload', async ({ page }) => {
  await startMatch(page);
  await missVisit(page);
  await page.getByRole('button', { name: 'Прервать матч' }).click();
  await page.getByRole('dialog', { name: 'Прервать матч?' }).getByRole('button', { name: 'Прервать матч' }).click();
  await page.getByRole('button', { name: 'История' }).click();
  await expect(page.getByText('Матч прерван')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Продолжить' })).toHaveCount(0);
});

test('501 allows remaining 1 and closes it with S1', async ({ page }) => {
  await startMatch(page);
  await scoreToOne(page);
  await page.getByRole('button', { name: 'Сектор 1, множитель 1' }).click();
  await expect(page.locator('.main-score').first()).toHaveText('1');
  await page.getByRole('button', { name: 'Подтвердить 1' }).click();
  await expect(page.getByRole('heading', { name: 'Игрок 1 победил' })).toBeVisible();
});

test('501 unlimited: S1 + S10 + S3 closes remaining 14', async ({ page }) => {
  await startMatch(page);
  await expect(page.getByText('501 · до победы')).toBeVisible();
  await scoreToFourteen(page);
  await page.getByRole('button', { name: 'Сектор 1, множитель 1' }).click();
  await page.getByRole('button', { name: 'Сектор 10, множитель 1' }).click();
  await page.getByRole('button', { name: 'Сектор 3, множитель 1' }).click();
  await expect(page.locator('.main-score').first()).toHaveText('14');
  await page.getByRole('button', { name: 'Подтвердить 14' }).click();
  await expect(page.getByRole('heading', { name: 'Игрок 1 победил' })).toBeVisible();
});

test('finalize archives a completed match and history survives reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Начать' }).click();
  await scoreToForty(page);
  await page.getByRole('button', { name: 'Сектор 20, множитель 1' }).click();
  await page.getByRole('button', { name: 'Сектор 20, множитель 1' }).click();
  await page.getByRole('button', { name: 'Подтвердить 40' }).click();
  await expect(page.getByRole('heading', { name: 'Игрок 1 победил' })).toBeVisible();
  await page.getByRole('button', { name: 'На главную' }).click();
  await expect(page.getByRole('button', { name: 'Продолжить' })).toHaveCount(0);
  await page.getByRole('button', { name: 'История' }).click();
  await expect(page.getByText('Игрок 1 — Игрок 2')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Продолжить' })).toHaveCount(0);
  await page.getByRole('button', { name: 'История' }).click();
  await expect(page.getByText('Игрок 1 — Игрок 2')).toBeVisible();
});

test('limited 501 picks the minimum remaining only after both players finish the final round', async ({ page }) => {
  await startLimited501(page);
  await page.getByRole('button', { name: 'Сектор 20, множитель 1' }).click();
  await page.getByRole('button', { name: 'Мимо' }).click();
  await page.getByRole('button', { name: 'Мимо' }).click();
  await page.getByRole('button', { name: 'Подтвердить 20' }).click();
  await missVisit(page);
  for (let round = 1; round < 5; round += 1) {
    await missVisit(page);
    if (round === 4) await expect(page.getByText('Текущий подход: Игрок 2')).toBeVisible();
    await missVisit(page);
  }
  await expect(page.getByRole('heading', { name: 'Игрок 1 победил' })).toBeVisible();
});

test('limited 501 finishes the round when zero is reached before the visit limit', async ({ page }) => {
  await startLimited501(page, 2, 20);
  await scoreToSixty(page);
  await page.getByRole('button', { name: '×3' }).click();
  await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
  await expect(page.getByRole('button', { name: 'Дротик 2: пусто' })).toBeVisible();
  await page.getByRole('button', { name: 'Подтвердить 60' }).click();
  await expect(page.getByRole('heading', { name: /победил/ })).toHaveCount(0);
  await expect(page.getByText('Текущий подход: Игрок 2')).toBeVisible();
  await missVisit(page);
  await expect(page.getByRole('heading', { name: 'Игрок 1 победил' })).toBeVisible();
});

test("three-player limited 501 waits for the third player's final visit", async ({ page }) => {
  await startLimited501(page, 3);
  await page.getByRole('button', { name: 'Сектор 20, множитель 1' }).click();
  await page.getByRole('button', { name: 'Мимо' }).click();
  await page.getByRole('button', { name: 'Мимо' }).click();
  await page.getByRole('button', { name: 'Подтвердить 20' }).click();
  await missVisit(page);
  await missVisit(page);
  for (let round = 1; round < 5; round += 1) {
    await missVisit(page);
    if (round === 4) await expect(page.getByText('Текущий подход: Игрок 2')).toBeVisible();
    await missVisit(page);
    if (round === 4) {
      await expect(page.getByText('Текущий подход: Игрок 3')).toBeVisible();
      await expect(page.getByRole('heading', { name: /победил/ })).toHaveCount(0);
    }
    await missVisit(page);
  }
  await expect(page.getByRole('heading', { name: 'Игрок 1 победил' })).toBeVisible();
});

test('limited 501 repeats a tied extra round and resolves only after every leader visits', async ({ page }) => {
  await startLimited501(page);
  for (let visit = 0; visit < 10; visit += 1) await missVisit(page);
  await expect(page.getByRole('heading', { name: 'Ничья' })).toBeVisible();
  await page.getByRole('button', { name: 'Сыграть дополнительный подход' }).click();
  await missVisit(page);
  await expect(page.getByText('Текущий подход: Игрок 2')).toBeVisible();
  await missVisit(page);
  await expect(page.getByRole('heading', { name: 'Ничья' })).toBeVisible();
  await page.getByRole('button', { name: 'Сыграть дополнительный подход' }).click();
  await page.getByRole('button', { name: 'Сектор 20, множитель 1' }).click();
  await page.getByRole('button', { name: 'Мимо' }).click();
  await page.getByRole('button', { name: 'Мимо' }).click();
  await page.getByRole('button', { name: 'Подтвердить 20' }).click();
  await expect(page.getByText('Текущий подход: Игрок 2')).toBeVisible();
  await expect(page.getByRole('heading', { name: /победил/ })).toHaveCount(0);
  await missVisit(page);
  await expect(page.getByRole('heading', { name: 'Игрок 1 победил' })).toBeVisible();
});

test('a 0:0 limited-501 tie break stays resolvable as a separate scoring contest', async ({ page }) => {
  await installZeroTieBreakFixture(page);
  await expect(page.getByRole('heading', { name: 'Ничья' })).toBeVisible();
  await page.getByRole('button', { name: 'Сыграть дополнительный подход' }).click();
  await scoringVisit(page, 20);
  await expect(page.getByText('Текущий подход: Игрок')).toBeVisible();
  await scoringVisit(page, 20);
  await expect(page.getByRole('heading', { name: 'Ничья' })).toBeVisible();
  await page.getByRole('button', { name: 'Сыграть дополнительный подход' }).click();
  await scoringVisit(page, 20);
  await scoringVisit(page, 1);
  await expect(page.getByRole('heading', { name: /победил/ })).toBeVisible();
});

test('active draft survives reload and remains unconfirmed until explicit Confirm', async ({ page }) => {
  await startMatch(page);
  await page.getByRole('button', { name: '×3' }).click();
  await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
  await page.getByRole('button', { name: 'Сектор 10, множитель 1' }).click();
  await expect(page.locator('.main-score').first()).toHaveText('501');

  await page.reload();
  await expect(page.getByText('Незавершённый подход · 2/3')).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByRole('button', { name: 'Дротик 1: T20, заменить' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Дротик 2: S10, заменить' })).toBeVisible();
  await expect(page.locator('.main-score').first()).toHaveText('501');
  await page.getByRole('button', { name: 'Сектор 5, множитель 1' }).click();
  await page.getByRole('button', { name: 'Подтвердить 75' }).click();
  await expect(page.locator('.main-score').first()).toHaveText('426');
});

test('active draft survives navigation to home and history', async ({ page }) => {
  await startMatch(page);
  await page.getByRole('button', { name: 'Сектор 20, множитель 1' }).click();
  await page.getByRole('button', { name: 'На главный экран' }).click();
  await expect(page.getByText('Незавершённый подход · 1/3')).toBeVisible();
  await page.getByRole('button', { name: 'История' }).click();
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByRole('button', { name: 'Дротик 1: S20, заменить' })).toBeVisible();
  await expect(page.locator('.main-score').first()).toHaveText('501');
});

test('active match and draft survive reopening in a new page', async ({ page }) => {
  await startMatch(page);
  await missVisit(page);
  await page.getByRole('button', { name: 'Сектор 10, множитель 1' }).click();
  const reopened = await page.context().newPage();
  await page.close();
  await reopened.goto('/');
  await expect(reopened.getByText('Незавершённый подход · 1/3')).toBeVisible();
  await reopened.getByRole('button', { name: 'Продолжить' }).click();
  await expect(reopened.getByText('Текущий подход: Игрок 2')).toBeVisible();
  await expect(reopened.getByRole('button', { name: 'Дротик 1: S10, заменить' })).toBeVisible();
});

test('starting another game requires an explicit choice and preserves the active draft on cancel', async ({ page }) => {
  await startMatch(page);
  await page.getByRole('button', { name: 'Сектор 20, множитель 1' }).click();
  await page.getByRole('button', { name: 'На главный экран' }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  const dialog = page.getByRole('dialog', { name: 'У вас уже есть незавершённая игра' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByRole('button', { name: 'Дротик 1: S20, заменить' })).toBeVisible();
});

test('abandon clears an unconfirmed draft without adding it to history', async ({ page }) => {
  await startMatch(page);
  await page.getByRole('button', { name: 'Сектор 20, множитель 1' }).click();
  await page.getByRole('button', { name: 'Прервать матч' }).click();
  await page.getByRole('dialog', { name: 'Прервать матч?' }).getByRole('button', { name: 'Прервать матч' }).click();
  await page.getByRole('button', { name: 'История' }).click();
  await expect(page.getByText('Матч прерван')).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Продолжить' })).toHaveCount(0);
});

test('statistics shows confirmed scoring, hits, reload persistence and mobile-safe layout', async ({ page }) => {
  await page.goto('/');
  await createLocalProfile(page, 'Игрок 1');
  await createLocalProfile(page, 'Игрок 2');
  await startOneVisitSeriesWithProfiles(page, ['Игрок 1', 'Игрок 2']);
  await page.getByRole('button', { name: '×3' }).click();
  await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
  await page.getByRole('button', { name: 'Мимо' }).click();
  await page.getByRole('button', { name: '×2' }).click();
  await page.getByRole('button', { name: 'Сектор 20, множитель 2' }).click();
  await page.getByRole('button', { name: 'Подтвердить 100' }).click();
  await missVisit(page);
  await page.getByRole('button', { name: 'На главную' }).click();
  await page.getByRole('button', { name: 'Статистика' }).click();
  await page.getByRole('button', { name: /Игрок 1.*Среднее за 3 дротика 100\.0/ }).click();
  await expect(page.getByText('100.0', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('100', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Попадания' }).click();
  await expect(page.getByText('Утроения').first()).toBeVisible();
  await expect(page.getByText('Промахи').first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true,
  );
  await page.reload();
  await page.getByRole('button', { name: 'Статистика' }).click();
  await expect(page.getByRole('button', { name: /Игрок 1.*100\.0/ })).toBeVisible();
});

test('a second match can reuse saved player ids, announces a real record and produces a trend', async ({ page }) => {
  await installSavedProfiles(page);
  await startOneVisitSeries(page, 2, true);
  await scoringVisit(page, 1);
  await missVisit(page);
  await page.getByRole('button', { name: 'На главную' }).click();

  await page.getByLabel('Выбрать сохранённого игрока 1').selectOption({ label: 'Игрок 1' });
  await page.getByLabel('Выбрать сохранённого игрока 2').selectOption({ label: 'Игрок 2' });
  await page.getByRole('button', { name: 'Серия' }).click();
  await page.getByRole('button', { name: 'Другое' }).click();
  await page.getByLabel('Другое количество подходов').fill('1');
  await page.getByRole('button', { name: 'Начать' }).click();
  await scoringVisit(page, 20);
  await missVisit(page);
  await expect(page.getByRole('heading', { name: 'Новый личный рекорд' })).toBeVisible();
  await expect(page.getByText('Игрок 1 · Лучший подход')).toBeVisible();
  await page.getByRole('button', { name: 'На главную' }).click();
  await page.getByRole('button', { name: 'Статистика' }).click();
  await page.getByRole('button', { name: /Игрок 1/ }).click();
  await page.getByRole('button', { name: 'Динамика' }).click();
  await expect(page.getByLabel('Среднее за 3 дротика', { exact: true })).toBeVisible();
});

test('comparison counts a multiplayer third-player winner as an other-player result', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await createLocalProfile(page, 'Игрок 1');
  await createLocalProfile(page, 'Игрок 2');
  await createLocalProfile(page, 'Игрок 3');
  await startOneVisitSeriesWithProfiles(page, ['Игрок 1', 'Игрок 2', 'Игрок 3']);
  await missVisit(page);
  await missVisit(page);
  await scoringVisit(page, 20);
  await page.getByRole('button', { name: 'На главную' }).click();
  await page.getByRole('button', { name: 'Статистика' }).click();
  await page.getByRole('button', { name: 'Сравнить игроков' }).click();
  await expect(page.getByRole('heading', { name: 'Личные встречи' })).toBeVisible();
  await expect(page.getByText('Совместных матчей: 1')).toBeVisible();
  await expect(page.getByText('Победы других игроков: 1')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true,
  );
});

test('player statistics mode filter switches between 501 and scoring series', async ({ page }) => {
  await installSavedProfiles(page);
  await startOneVisitSeries(page, 2, true);
  await scoringVisit(page, 1);
  await missVisit(page);
  await page.getByRole('button', { name: 'На главную' }).click();
  await page.getByLabel('Выбрать сохранённого игрока 1').selectOption({ label: 'Игрок 1' });
  await page.getByLabel('Выбрать сохранённого игрока 2').selectOption({ label: 'Игрок 2' });
  const x01Mode = page.getByRole('button', { name: 'X01' });
  await x01Mode.click();
  await expect(x01Mode).toHaveClass(/selected/);
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.getByText('501 · до победы')).toBeVisible();
  await scoringVisit(page, 20);
  await page.getByRole('button', { name: 'Прервать матч' }).click();
  await page.getByRole('dialog', { name: 'Прервать матч?' }).getByRole('button', { name: 'Прервать матч' }).click();
  await page.getByRole('button', { name: 'Статистика' }).click();
  await page.getByRole('button', { name: /Игрок 1/ }).click();
  const mode = page.locator('.stats-filters').getByLabel('Режим');
  await mode.selectOption('fixed_visits');
  await expect(page.getByText('Лучший подход').locator('..').getByText('1', { exact: true })).toBeVisible();
  await mode.selectOption('x01');
  await expect(page.getByText('Лучший подход').locator('..').getByText('20', { exact: true })).toBeVisible();
});

test('X01 setup starts a 701 straight-out match', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: /^701/ }).check();
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.locator('.main-score').first()).toHaveText('701');
});

test('aggregate input confirms a full 100-point visit without fabricated dart details', async ({ page }) => {
  await startMatch(page);
  await page.getByRole('button', { name: 'Суммой за подход' }).click();
  await page.getByLabel('Сумма за подход').fill('100');
  await page.getByRole('button', { name: 'Подтвердить 100' }).click();
  await expect(page.locator('.main-score').first()).toHaveText('401');
});

test('company creation through UI is visible, survives reload, and exists on a second device', async ({ browser }) => {
  const creatorContext = await browser.newContext();
  const invitedContext = await browser.newContext();
  const name = `UI-лига-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const creator = await creatorContext.newPage();
    await creator.goto('/');
    await creator.getByRole('button', { name: 'Создать компанию' }).click();
    await creator.getByLabel('Название компании (необязательно)').fill(name);
    await creator.getByRole('button', { name: 'Создать', exact: true }).click();

    await expect(creator.getByText(`Компания · ${name}`)).toBeVisible();
    await expect(
      creator.getByText('Добавьте постоянных игроков ниже или сразу настройте и начните матч.'),
    ).toBeVisible();
    await expect(creator.getByRole('button', { name: 'Начать' })).toBeVisible();
    const companyUrl = creator.url();
    expect(new URL(companyUrl).pathname).toMatch(/^\/g\/[^/]+$/);

    await creator.reload();
    await expect(creator.getByText(`Компания · ${name}`)).toBeVisible();

    const invited = await invitedContext.newPage();
    await invited.goto(companyUrl);
    await expect(invited.getByText(`Компания · ${name}`)).toBeVisible();
  } finally {
    await creatorContext.close();
    await invitedContext.close();
  }
});

test('two isolated devices share a company player through its secret link', async ({ browser }) => {
  const deviceA = await browser.newContext();
  const deviceB = await browser.newContext();
  try {
    const a = await deviceA.newPage();
    await a.goto('/');
    await a.getByRole('button', { name: 'Создать компанию' }).click();
    await a.getByLabel('Название компании (необязательно)').fill('Наша лига');
    await a.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(a.getByText('Компания · Наша лига')).toBeVisible();
    await a.getByLabel('Добавить игрока компании').fill('Миша');
    await a.getByRole('button', { name: 'Добавить игрока', exact: true }).click();
    await expect(a.getByLabel('Выбрать сохранённого игрока 1').locator('option', { hasText: 'Миша' })).toHaveCount(1);
    const url = a.url();
    const b = await deviceB.newPage();
    await b.goto(url);
    await expect(b.getByText('Компания · Наша лига')).toBeVisible();
    await expect(b.getByLabel('Выбрать сохранённого игрока 1').locator('option', { hasText: 'Миша' })).toHaveCount(1);
  } finally {
    await deviceA.close();
    await deviceB.close();
  }
});

test('company match is finalized on device A and contributes to device B history and statistics', async ({
  browser,
}) => {
  const deviceA = await browser.newContext();
  const deviceB = await browser.newContext();
  try {
    const a = await deviceA.newPage();
    await a.goto('/');
    await a.getByRole('button', { name: 'Создать компанию' }).click();
    await a.getByLabel('Название компании (необязательно)').fill('Лига матчей');
    await a.getByRole('button', { name: 'Создать', exact: true }).click();
    for (const name of ['Миша', 'Саша']) {
      const field = a.getByLabel('Добавить игрока компании');
      await field.fill(name);
      await a.getByRole('button', { name: 'Добавить игрока', exact: true }).click();
      await expect(field).toHaveValue('');
      await expect(a.getByLabel('Выбрать сохранённого игрока 1').locator('option', { hasText: name })).toHaveCount(1);
    }
    await a.getByLabel('Выбрать сохранённого игрока 1').selectOption({ label: 'Миша' });
    await a.getByLabel('Выбрать сохранённого игрока 2').selectOption({ label: 'Саша' });
    await a.getByRole('button', { name: 'Серия' }).click();
    await a.getByRole('button', { name: 'Другое' }).click();
    await a.getByLabel('Другое количество подходов').fill('1');
    await a.getByRole('button', { name: 'Начать' }).click();
    await a.getByRole('button', { name: 'Сектор 20, множитель 1' }).click();
    await a.getByRole('button', { name: 'Мимо' }).click();
    await a.getByRole('button', { name: 'Мимо' }).click();
    await a.getByRole('button', { name: 'Подтвердить 20' }).click();
    for (let dart = 0; dart < 3; dart += 1) await a.getByRole('button', { name: 'Мимо' }).click();
    await a.getByRole('button', { name: 'Подтвердить 0' }).click();
    await a.getByRole('button', { name: 'На главную' }).click();
    const b = await deviceB.newPage();
    await b.goto(a.url());
    await b.getByRole('button', { name: 'История' }).click();
    await expect(b.getByText('Миша — Саша')).toBeVisible();
    await b.getByRole('button', { name: 'Назад' }).click();
    await b.getByRole('button', { name: 'Статистика' }).click();
    await expect(b.getByRole('button', { name: /Миша.*20\.0/ })).toBeVisible();
    await expect(b.getByRole('button', { name: /Саша.*0\.0/ })).toBeVisible();
    await b.getByRole('button', { name: 'Назад' }).click();
    await b.getByLabel('Выбрать сохранённого игрока 1').selectOption({ label: 'Миша' });
    await b.getByLabel('Выбрать сохранённого игрока 2').selectOption({ label: 'Саша' });
    await b.getByRole('button', { name: 'Серия' }).click();
    await b.getByRole('button', { name: 'Другое' }).click();
    await b.getByLabel('Другое количество подходов').fill('1');
    await b.getByRole('button', { name: 'Начать' }).click();
    for (let dart = 0; dart < 3; dart += 1) await b.getByRole('button', { name: 'Мимо' }).click();
    await b.getByRole('button', { name: 'Подтвердить 0' }).click();
    await b.getByRole('button', { name: 'Сектор 20, множитель 1' }).click();
    await b.getByRole('button', { name: 'Мимо' }).click();
    await b.getByRole('button', { name: 'Мимо' }).click();
    await b.getByRole('button', { name: 'Подтвердить 20' }).click();
    await b.getByRole('button', { name: 'На главную' }).click();
    await a.reload();
    await a.getByRole('button', { name: 'История' }).click();
    await expect(a.locator('.history-match')).toHaveCount(2);
    await a.getByRole('button', { name: 'Назад' }).click();
    await a.getByRole('button', { name: 'Статистика' }).click();
    await expect(a.getByRole('button', { name: /Миша.*10\.0/ })).toBeVisible();
    await expect(a.getByRole('button', { name: /Саша.*10\.0/ })).toBeVisible();
  } finally {
    await deviceA.close();
    await deviceB.close();
  }
});

async function createCompanyWithPlayers(
  page: import('@playwright/test').Page,
  name: string,
  players: readonly string[],
) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Создать компанию' }).click();
  await page.getByLabel('Название компании (необязательно)').fill(name);
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  for (const player of players) {
    const field = page.getByLabel('Добавить игрока компании');
    await field.fill(player);
    await page.getByRole('button', { name: 'Добавить игрока', exact: true }).click();
    await expect(field).toHaveValue('');
  }
}
async function oneVisitSeries(page: import('@playwright/test').Page, firstScore: number = 0, secondScore = 0) {
  await page.getByRole('button', { name: 'Серия' }).click();
  await page.getByRole('button', { name: 'Другое' }).click();
  await page.getByLabel('Другое количество подходов').fill('1');
  await page.getByRole('button', { name: 'Начать' }).click();
  for (const score of [firstScore, secondScore]) {
    if (score) await page.getByRole('button', { name: 'Сектор 20, множитель 1' }).click();
    for (let dart = score ? 1 : 0; dart < 3; dart += 1) await page.getByRole('button', { name: 'Мимо' }).click();
    await page.getByRole('button', { name: `Подтвердить ${score}` }).click();
  }
}

test('offline completed company match survives reload and manual retry uploads it once', async ({ browser }) => {
  const aContext = await browser.newContext();
  const bContext = await browser.newContext();
  try {
    const a = await aContext.newPage();
    await createCompanyWithPlayers(a, 'Оффлайн лига', ['Миша', 'Саша']);
    const url = a.url();
    await a.getByLabel('Выбрать сохранённого игрока 1').selectOption({ label: 'Миша' });
    await a.getByLabel('Выбрать сохранённого игрока 2').selectOption({ label: 'Саша' });
    await a.route('**/api/**', (route) => route.abort());
    await oneVisitSeries(a, 20, 0);
    await a.getByRole('button', { name: 'На главную' }).click();
    await expect(a.locator('.sync-state')).toContainText('Нет связи');
    await a.reload();
    await expect(a.getByText('Компания · Оффлайн лига')).toBeVisible();
    await expect(a.locator('.sync-state')).toContainText('Нет связи');
    await a.unroute('**/api/**');
    await a.getByRole('button', { name: 'Повторить' }).click();
    await expect(a.locator('.sync-state')).toContainText('Все матчи синхронизированы');
    const b = await bContext.newPage();
    await b.goto(url);
    await b.getByRole('button', { name: 'История' }).click();
    await expect(b.locator('.history-match')).toHaveCount(1);
    await a.getByRole('button', { name: 'История' }).click();
    await expect(a.locator('.history-match')).toHaveCount(1);
  } finally {
    await aContext.close();
    await bContext.close();
  }
});

test('abandoned shared match is propagated without becoming a completed result', async ({ browser }) => {
  const aContext = await browser.newContext();
  const bContext = await browser.newContext();
  try {
    const a = await aContext.newPage();
    await createCompanyWithPlayers(a, 'Прерванная лига', ['Миша', 'Саша']);
    const url = a.url();
    await a.getByLabel('Выбрать сохранённого игрока 1').selectOption({ label: 'Миша' });
    await a.getByLabel('Выбрать сохранённого игрока 2').selectOption({ label: 'Саша' });
    await a.getByRole('button', { name: 'Начать' }).click();
    await a.getByRole('button', { name: 'Прервать матч' }).click();
    await a.getByRole('dialog', { name: 'Прервать матч?' }).getByRole('button', { name: 'Прервать матч' }).click();
    const b = await bContext.newPage();
    await b.goto(url);
    await b.getByRole('button', { name: 'История' }).click();
    await expect(b.getByText('Матч прерван')).toBeVisible();
    await b.getByRole('button', { name: 'Назад' }).click();
    await b.getByRole('button', { name: 'Статистика' }).click();
    await b.getByRole('button', { name: /Миша/ }).click();
    await expect(b.getByText('Завершённые игры').locator('..').getByText('0', { exact: true })).toBeVisible();
  } finally {
    await aContext.close();
    await bContext.close();
  }
});

test('company match keeps temporary participant out of shared player catalog', async ({ browser }) => {
  const aContext = await browser.newContext();
  const bContext = await browser.newContext();
  try {
    const a = await aContext.newPage();
    await createCompanyWithPlayers(a, 'Временные', ['Миша']);
    const url = a.url();
    await a.getByLabel('Выбрать сохранённого игрока 1').selectOption({ label: 'Миша' });
    await oneVisitSeries(a, 20, 0);
    await a.getByRole('button', { name: 'На главную' }).click();
    const b = await bContext.newPage();
    await b.goto(url);
    await expect(b.getByLabel('Выбрать сохранённого игрока 1').locator('option')).toHaveCount(2);
    await b.getByRole('button', { name: 'История' }).click();
    await expect(b.getByText('Миша — Игрок 2')).toBeVisible();
  } finally {
    await aContext.close();
    await bContext.close();
  }
});

test('repeated temporary matches stay readable without creating statistics profiles', async ({ page }) => {
  for (let matchIndex = 0; matchIndex < 2; matchIndex += 1) {
    await startOneVisitSeries(page);
    await scoringVisit(page, 20);
    await missVisit(page);
    await expect(page.getByRole('heading', { name: 'Игрок 1 победил' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Статистика' })).toHaveCount(0);
    await page.getByRole('button', { name: 'На главную' }).click();
    await expect(page.getByRole('heading', { name: 'Новая игра' })).toBeVisible();
  }

  await page.getByRole('button', { name: 'История' }).click();
  await expect(page.locator('.history-match')).toHaveCount(2);
  await expect(page.getByText('Игрок 1 — Игрок 2')).toHaveCount(2);
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('button', { name: 'Статистика' }).click();
  await expect(page.getByRole('button', { name: /Игрок [12]/ })).toHaveCount(0);
});

test('stable local profile ids aggregate across matches and completed match opens relevant statistics', async ({
  page,
}) => {
  await page.goto('/');
  await createLocalProfile(page, 'Миша');
  await createLocalProfile(page, 'Саша');
  for (let matchIndex = 0; matchIndex < 2; matchIndex += 1) {
    await page.getByLabel('Выбрать сохранённого игрока 1').selectOption({ label: 'Миша' });
    await page.getByLabel('Выбрать сохранённого игрока 2').selectOption({ label: 'Саша' });
    await page.getByRole('button', { name: 'Серия' }).click();
    await page.getByRole('button', { name: 'Другое' }).click();
    await page.getByLabel('Другое количество подходов').fill('1');
    await page.getByRole('button', { name: 'Начать' }).click();
    await scoringVisit(page, matchIndex === 0 ? 20 : 19);
    await missVisit(page);
    await page.getByRole('button', { name: 'Статистика' }).click();
    await expect(page.getByRole('heading', { name: 'Личные встречи' })).toBeVisible();
    if (matchIndex === 0) {
      await page.getByRole('button', { name: 'Назад' }).click();
    }
  }

  await expect(page.getByText('Совместных матчей: 2')).toBeVisible();
  await page.getByRole('button', { name: 'К игрокам' }).click();
  await expect(page.getByRole('button', { name: /Миша/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Саша/ })).toHaveCount(1);
  await page.getByRole('button', { name: /Миша/ }).click();
  await page.getByRole('button', { name: 'Динамика' }).click();
  await expect(page.getByLabel('Среднее за 3 дротика', { exact: true })).toBeVisible();

  const playerIdsByMatch = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dart-scorekeeper');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const matches = await new Promise<Array<{ players: string[] }>>((resolve, reject) => {
      const request = database.transaction('matches').objectStore('matches').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return matches.map((match) => match.players);
  });
  expect(playerIdsByMatch).toHaveLength(2);
  expect(playerIdsByMatch[0]).toEqual(playerIdsByMatch[1]);
  expect(new Set(playerIdsByMatch.flat()).size).toBe(2);

  await page.reload();
  await expect(page.getByText('Продолжить матч')).toHaveCount(0);
  await page.getByRole('button', { name: 'История' }).click();
  await expect(page.locator('.history-match')).toHaveCount(2);
});

test('company persistent plus temporary match opens profile statistics without inventing a shared profile', async ({
  browser,
}) => {
  const deviceA = await browser.newContext();
  const deviceB = await browser.newContext();
  try {
    const a = await deviceA.newPage();
    await createCompanyWithPlayers(a, 'Смешанная лига', ['Миша']);
    const companyUrl = a.url();
    await a.getByLabel('Выбрать сохранённого игрока 1').selectOption({ label: 'Миша' });
    await oneVisitSeries(a, 20, 0);
    await expect(a.getByRole('heading', { name: 'Миша победил' })).toBeVisible();
    await a.getByRole('button', { name: 'Статистика' }).click();
    await expect(a.getByRole('heading', { name: 'Миша', exact: true })).toBeVisible();
    await expect(a.getByText('Завершённые игры').locator('..').getByText('1', { exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'Все игроки' }).click();
    await expect(a.getByRole('button', { name: /Миша/ })).toHaveCount(1);
    await expect(a.getByRole('button', { name: /Игрок 2/ })).toHaveCount(0);

    const b = await deviceB.newPage();
    await b.goto(companyUrl);
    await expect(b.getByLabel('Выбрать сохранённого игрока 1').locator('option')).toHaveCount(2);
    await b.getByRole('button', { name: 'История' }).click();
    await expect(b.getByText('Миша — Игрок 2')).toBeVisible();
    await b.getByRole('button', { name: 'Назад' }).click();
    await b.getByRole('button', { name: 'Статистика' }).click();
    await expect(b.getByRole('button', { name: /Миша/ })).toHaveCount(1);
    await expect(b.getByRole('button', { name: /Игрок 2/ })).toHaveCount(0);
  } finally {
    await deviceA.close();
    await deviceB.close();
  }
});

test('stage 4 viewport matrix has no page overflow or clipped primary controls', async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Начать' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
    const startBox = await page.getByRole('button', { name: 'Начать' }).boundingBox();
    expect(startBox?.width).toBeGreaterThanOrEqual(44);
    expect(startBox?.height).toBeGreaterThanOrEqual(44);
  }
});

test('stage 4 destructive dialog traps focus, closes on Escape and restores focus', async ({ page }) => {
  await startMatch(page);
  const abandon = page.getByRole('button', { name: 'Прервать матч' });
  await abandon.focus();
  await abandon.click();
  const dialog = page.getByRole('dialog', { name: 'Прервать матч?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Прервать матч' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(abandon).toBeFocused();
});

test('stage 4 eight-player round keeps active player readable in an internal rail', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  for (let count = 2; count < 8; count += 1) await page.getByRole('button', { name: '+ Добавить игрока' }).click();
  for (let index = 1; index <= 8; index += 1)
    await page
      .getByLabel(`Имя игрока ${index}`)
      .fill(index % 2 ? `Игрок ${index}` : `Очень длинное имя игрока ${index}`);
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.locator('.player-score')).toHaveCount(8);
  const originalOrder = await page.locator('.player-score .player-identity-name').allTextContents();
  await expect(page.getByText('Текущий подход: Игрок 1')).toBeVisible();
  for (let player = 2; player <= 8; player += 1) {
    await missVisit(page);
    await expect(
      page.getByText(`Текущий подход: ${player % 2 ? `Игрок ${player}` : `Очень длинное имя игрока ${player}`}`),
    ).toBeVisible();
    expect(await page.locator('.player-score .player-identity-name').allTextContents()).toEqual(originalOrder);
    await expect
      .poll(async () => {
        const rail = await page.locator('.scoreboard').boundingBox(),
          active = await page.locator('.player-score.active').boundingBox();
        return Boolean(active && rail && active.x >= rail.x - 1 && active.x + active.width <= rail.x + rail.width + 1);
      })
      .toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
  }
  expect(await page.locator('.scoreboard').evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  expect(await page.locator('.scoreboard').evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  for (const name of ['×1', '×2', '×3', 'Мимо']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});

async function activeMatchIdentity(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dart-scorekeeper');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const active = await new Promise<{ current: { id: string; players: string[]; startingPlayerIndex: number } }>(
      (resolve, reject) => {
        const request = database.transaction('meta').objectStore('meta').get('activeMatch');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      },
    );
    database.close();
    return { id: active.current.id, players: active.current.players, starter: active.current.startingPlayerIndex };
  });
}

test('Stage 4.5 local rematch starts immediately with a new id, stable profiles and rotated starter', async ({
  page,
}) => {
  await page.goto('/');
  await createLocalProfile(page, 'Миша');
  await createLocalProfile(page, 'Саша');
  await startOneVisitSeriesWithProfiles(page, ['Миша', 'Саша']);
  const first = await activeMatchIdentity(page);
  await scoringVisit(page, 20);
  await missVisit(page);
  await expect(page.getByRole('heading', { name: 'Миша победил' })).toBeVisible();
  await page.getByRole('button', { name: 'Сыграть ещё раз' }).click();
  await expect(page.getByText('Текущий подход: Саша')).toBeVisible();
  const second = await activeMatchIdentity(page);
  expect(second.id).not.toBe(first.id);
  expect(second.players).toEqual(first.players);
  expect(second.starter).toBe(1);
  await page.getByRole('button', { name: 'На главный экран' }).click();
  await page.getByRole('button', { name: 'История' }).click();
  await expect(page.locator('.history-match')).toHaveCount(1);
});

test('Stage 4.5.1 creates two persistent profiles in Setup and aggregates them through a rematch', async ({ page }) => {
  await page.goto('/');

  await createLocalProfile(page, 'Миша');
  await createLocalProfile(page, 'Саша');
  await expect(page.locator('.participant-card.profile')).toHaveCount(2);
  await expect(page.getByText('Профиль игрока · статистика сохраняется')).toHaveCount(2);
  await expect(page.getByLabel('Выбрать сохранённого игрока 1')).toHaveValue(/.+/);
  await expect(page.getByLabel('Выбрать сохранённого игрока 2')).toHaveValue(/.+/);

  await page.getByRole('button', { name: 'Серия' }).click();
  await page.getByRole('button', { name: 'Другое' }).click();
  await page.getByLabel('Другое количество подходов').fill('1');
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.getByText('Текущий подход:')).toBeVisible();
  const first = await activeMatchIdentity(page);
  await scoringVisit(page, 20);
  await missVisit(page);
  await expect(page.getByRole('heading', { name: 'Миша победил' })).toBeVisible();

  await page.getByRole('button', { name: 'Статистика' }).click();
  await expect(page.getByText('Совместных матчей: 1')).toBeVisible();
  await page.getByRole('button', { name: 'К игрокам' }).click();
  await expect(page.getByRole('button', { name: /Миша/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Саша/ })).toHaveCount(1);

  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('button', { name: 'История' }).click();
  await page.locator('.history-match').first().getByText('Миша — Саша').click();
  await page.getByRole('button', { name: 'Сыграть ещё раз' }).click();
  await expect(page.getByText('Текущий подход: Саша')).toBeVisible();
  const second = await activeMatchIdentity(page);
  expect(second.id).not.toBe(first.id);
  expect(second.players).toEqual(first.players);

  await scoringVisit(page, 19);
  await missVisit(page);
  await expect(page.getByRole('heading', { name: 'Саша победил' })).toBeVisible();
  await page.getByRole('button', { name: 'Статистика' }).click();
  await expect(page.getByText('Совместных матчей: 2')).toBeVisible();
  await page.getByRole('button', { name: 'К игрокам' }).click();
  await expect(page.getByRole('button', { name: /Миша/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Саша/ })).toHaveCount(1);
});

test('Stage 4.5 temporary rematch recreates only temporary identity and never creates a statistics profile', async ({
  page,
}) => {
  await page.goto('/');
  await createLocalProfile(page, 'Миша');
  await page.getByLabel('Выбрать сохранённого игрока 1').selectOption({ label: 'Миша' });
  await oneVisitSeries(page, 20, 0);
  const first = await activeMatchIdentity(page);
  await page.getByRole('button', { name: 'Сыграть ещё раз' }).click();
  await expect(page.getByText('Текущий подход: Игрок 2')).toBeVisible();
  const second = await activeMatchIdentity(page);
  expect(second.players[0]).toBe(first.players[0]);
  expect(second.players[1]).not.toBe(first.players[1]);
  await scoringVisit(page, 20);
  await missVisit(page);
  await page.getByRole('button', { name: 'Статистика' }).click();
  await expect(page.getByRole('heading', { name: 'Миша', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Игрок 2/ })).toHaveCount(0);
});

test('Stage 4.5 company rematch preserves three shared ids and History can start another rematch', async ({ page }) => {
  await createCompanyWithPlayers(page, 'Серия клуба', ['Миша', 'Саша', 'Женя']);
  await page.getByRole('button', { name: '+ Добавить игрока' }).click();
  for (let index = 1; index <= 3; index += 1)
    await page
      .getByLabel(`Выбрать сохранённого игрока ${index}`)
      .selectOption({ label: ['Миша', 'Саша', 'Женя'][index - 1]! });
  await page.getByRole('button', { name: 'Серия' }).click();
  await page.getByRole('button', { name: 'Другое' }).click();
  await page.getByLabel('Другое количество подходов').fill('1');
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.getByText('Текущий подход:')).toBeVisible();
  const first = await activeMatchIdentity(page);
  await scoringVisit(page, 20);
  await missVisit(page);
  await missVisit(page);
  await page.getByRole('button', { name: 'На главную' }).click();
  await page.getByRole('button', { name: 'История' }).click();
  await page.locator('.history-match').first().getByText('Миша — Саша — Женя').click();
  await page.getByRole('button', { name: 'Сыграть ещё раз' }).click();
  await expect(page.getByText('Текущий подход: Саша')).toBeVisible();
  const second = await activeMatchIdentity(page);
  expect(second.players).toEqual(first.players);
  expect(second.starter).toBe(1);
});

test('Stage 4.5 multiplier preview, confirmed 180 celebration, reduced motion and haptics are progressive', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const calls: VibratePattern[] = [];
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (pattern: VibratePattern) => {
        calls.push(pattern);
        return true;
      },
    });
    Object.defineProperty(window, '__vibrationCalls', { value: calls });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Настройки' }).click();
  const haptics = page.getByRole('checkbox', { name: /Виброотклик/ });
  await expect(haptics).toBeChecked();
  await haptics.uncheck();
  await expect(haptics).not.toBeChecked();
  await expect(haptics).toBeEnabled();
  await page.reload();
  await page.getByRole('button', { name: 'Настройки' }).click();
  const restoredHaptics = page.getByRole('checkbox', { name: /Виброотклик/ });
  await expect(restoredHaptics).not.toBeChecked();
  await restoredHaptics.check();
  await expect(restoredHaptics).toBeChecked();
  await expect(restoredHaptics).toBeEnabled();
  await startOneVisitSeries(page);
  const sector20 = page.getByRole('button', { name: 'Сектор 20, множитель 1' });
  await expect(sector20).toHaveText('20');
  await page.getByRole('button', { name: '×2' }).click();
  await expect(page.getByRole('button', { name: 'Сектор 20, множитель 2' })).toContainText('40');
  await page.getByRole('button', { name: '×3' }).click();
  const triple20 = page.getByRole('button', { name: 'Сектор 20, множитель 3' });
  await expect(triple20).toContainText('60');
  const box = await triple20.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await triple20.click();
  await page.getByRole('button', { name: '×3' }).click();
  await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
  await page.getByRole('button', { name: '×3' }).click();
  await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
  await expect(page.getByText('МАКСИМУМ', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Подтвердить 180' }).click();
  await expect(page.getByText(/МАКСИМУМ/)).toBeVisible();
  await expect(page.getByText('Текущий подход: Игрок 2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Мимо' })).toBeEnabled();
  expect(
    await page.evaluate(() => (window as unknown as { __vibrationCalls: VibratePattern[] }).__vibrationCalls),
  ).toContainEqual([24, 28, 45]);
  await expect(page.getByText(/МАКСИМУМ/)).toHaveCount(0, { timeout: 2000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Мимо' }).click();
  expect(await page.locator('.particles').count()).toBe(0);
});

async function finishOneVisitSeriesFromSetup(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Серия' }).click();
  await page.getByRole('button', { name: 'Другое' }).click();
  await page.getByLabel('Другое количество подходов').fill('1');
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.getByText('Текущий подход:')).toBeVisible();
  await scoringVisit(page, 20);
  await missVisit(page);
}

async function finish301WithAggregateInput(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Суммой за подход' }).click();
  const score = page.getByLabel('Сумма за подход');
  const activeName = page.locator('.current-label strong');
  const firstPlayer = await activeName.textContent();
  await score.fill('180');
  await page.getByRole('button', { name: 'Подтвердить 180' }).click();
  await expect(activeName).not.toHaveText(firstPlayer ?? '');
  await score.fill('60');
  await page.getByRole('button', { name: 'Подтвердить 60' }).click();
  await expect(activeName).toHaveText(firstPlayer ?? '');
  await page.getByRole('button', { name: 'По дротикам' }).click();
  for (let dart = 0; dart < 2; dart += 1) {
    await page.getByRole('button', { name: '×3' }).click();
    await page.getByRole('button', { name: 'Сектор 20, множитель 3' }).click();
  }
  await page.getByRole('button', { name: 'Сектор 1, множитель 1' }).click();
  await page.getByRole('button', { name: 'Подтвердить 121' }).click();
}

test('Stage 4.6 Last Setup restores local stable ids, X01 options, and reload', async ({ page }) => {
  await page.goto('/');
  await createLocalProfile(page, 'Миша');
  await createLocalProfile(page, 'Саша');
  await page.getByLabel('Выбрать сохранённого игрока 1').selectOption({ label: 'Миша' });
  await page.getByLabel('Выбрать сохранённого игрока 2').selectOption({ label: 'Саша' });
  const ids = await Promise.all(
    [1, 2].map((index) => page.getByLabel(`Выбрать сохранённого игрока ${index}`).inputValue()),
  );
  await page.getByRole('radio', { name: /^301/ }).check();
  await page.getByRole('button', { name: 'Удвоением' }).click();
  await page.getByRole('button', { name: 'Любым попаданием' }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  await finish301WithAggregateInput(page);
  await expect(page.getByRole('heading', { name: /Миша победил/ })).toBeVisible();
  await page.getByRole('button', { name: 'На главную' }).click();
  await expect(page.getByRole('radio', { name: /^301/ })).toBeChecked();
  await expect(page.getByLabel('Выбрать сохранённого игрока 1')).toHaveValue(ids[0]!);
  await expect(page.getByLabel('Выбрать сохранённого игрока 2')).toHaveValue(ids[1]!);
  await page.reload();
  await expect(page.getByRole('radio', { name: /^301/ })).toBeChecked();
  await expect(page.getByLabel('Выбрать сохранённого игрока 1')).toHaveValue(ids[0]!);
  await expect(page.getByLabel('Выбрать сохранённого игрока 2')).toHaveValue(ids[1]!);
});

test('Stage 4.6 Last Setup keeps a temporary participant temporary', async ({ page }) => {
  await page.goto('/');
  await createLocalProfile(page, 'Миша');
  await page.getByLabel('Выбрать сохранённого игрока 1').selectOption({ label: 'Миша' });
  await page.getByLabel('Имя игрока 2').fill('Дима');
  await finishOneVisitSeriesFromSetup(page);
  await page.getByRole('button', { name: 'На главную' }).click();
  await expect(page.getByLabel('Выбрать сохранённого игрока 1')).not.toHaveValue('');
  await expect(page.getByLabel('Имя игрока 2')).toHaveValue('Дима');
  await expect(page.locator('.participant-card.temporary')).toHaveCount(1);
});

test('Stage 4.6 Last Setup never replaces a missing profile by the same display name', async ({ page }) => {
  await page.goto('/');
  await createLocalProfile(page, 'Миша');
  await page.evaluate(async () => {
    const request = indexedDB.open('dart-scorekeeper');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('meta', 'readwrite');
    transaction
      .objectStore('meta')
      .put(
        {
          participants: [{ playerId: 'deleted-profile-id', name: 'Миша' }, { name: 'Гость' }],
          setup: { mode: 'fixed_visits', visitsPerPlayer: 5, startingPlayerIndex: 0 },
        },
        'lastSetup:local',
      );
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload();
  await expect(page.getByText('Этот профиль больше недоступен.')).toBeVisible();
  await expect(page.getByLabel('Выбрать сохранённого игрока 1')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Начать' })).toBeDisabled();
  await page.getByRole('button', { name: 'Оставить временным' }).click();
  await expect(page.getByLabel('Имя игрока 1')).toHaveValue('Миша');
  await expect(page.getByRole('button', { name: 'Начать' })).toBeEnabled();
});

test('Stage 4.6 post-match Statistics drills from comparison to each full player view and back', async ({ page }) => {
  await page.goto('/');
  await createLocalProfile(page, 'Миша');
  await createLocalProfile(page, 'Саша');
  await page.getByLabel('Выбрать сохранённого игрока 1').selectOption({ label: 'Миша' });
  await page.getByLabel('Выбрать сохранённого игрока 2').selectOption({ label: 'Саша' });
  await finishOneVisitSeriesFromSetup(page);
  await page.getByRole('button', { name: 'Статистика' }).click();
  await expect(page.getByRole('heading', { name: 'Сравнение игроков' })).toBeVisible();
  const switcher = page.getByRole('navigation', { name: 'Статистика участников матча' });
  await switcher.getByRole('button', { name: /Миша/ }).click();
  await expect(page.getByRole('tab', { name: 'Обзор' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Попадания' })).toBeVisible();
  await expect(page.getByText('Среднее за 3 дротика', { exact: true }).first()).toBeVisible();
  await switcher.getByRole('button', { name: /Саша/ }).click();
  await expect(page.getByText('Последние матчи')).toBeVisible();
  await switcher.getByRole('button', { name: 'Сравнение' }).click();
  await expect(page.getByRole('heading', { name: 'Сравнение игроков' })).toBeVisible();
});

test('Stage 4.6 X01 presets are accessible, keyboard-selectable, and preserved by rematch', async ({ page }) => {
  await page.goto('/');
  const score301 = page.getByRole('radio', { name: /^301/ }),
    score501 = page.getByRole('radio', { name: /^501/ }),
    score701 = page.getByRole('radio', { name: /^701/ });
  await expect(score501).toBeChecked();
  await score301.check();
  await expect(score301).toBeChecked();
  await score301.focus();
  await page.keyboard.press('ArrowRight');
  await expect(score501).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(score701).toBeChecked();
  await score301.check();
  await page.getByRole('button', { name: 'Начать' }).click();
  await finish301WithAggregateInput(page);
  await page.getByRole('button', { name: 'Сыграть ещё раз' }).click();
  await expect(page.getByText('301 · до победы')).toBeVisible();
  await expect(page.locator('.main-score').first()).toHaveText('301');
});

test('Stage 4.6 Today appears after completed matches and ignores abandoned results', async ({ page }) => {
  await page.goto('/');
  await finishOneVisitSeriesFromSetup(page);
  await page.getByRole('button', { name: 'На главную' }).click();
  const today = page.getByRole('region', { name: 'Сегодня' });
  await expect(today).toContainText('1');
  await expect(today).toContainText('Лучший подход');
  await page.getByRole('button', { name: 'Начать' }).click();
  await page.getByRole('button', { name: 'Прервать матч' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Прервать матч' }).click();
  await expect(today).toContainText('1');
});

test('Stage 4.6 share creates a private PNG through Web Share without navigation', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        const file = data.files?.[0];
        Object.defineProperty(window, '__sharedResult', {
          configurable: true,
          value: file ? { type: file.type, size: file.size, name: file.name, title: data.title } : undefined,
        });
      },
    });
  });
  await page.goto('/');
  await finishOneVisitSeriesFromSetup(page);
  await page.getByRole('button', { name: 'Поделиться' }).click();
  await expect(page.getByRole('status')).toContainText('Карточка передана');
  const shared = await page.evaluate(
    () =>
      (window as unknown as { __sharedResult: { type: string; size: number; name: string; title: string } })
        .__sharedResult,
  );
  expect(shared.type).toBe('image/png');
  expect(shared.size).toBeGreaterThan(1000);
  expect(shared.name).toMatch(/\.png$/);
  expect(shared.title).not.toContain('/g/');
  await expect(page.getByRole('heading', { name: /Игрок 1 победил/ })).toBeVisible();
});

test('Stage 4.6 company Last Setup is isolated by company token', async ({ page }) => {
  await createCompanyWithPlayers(page, `Клуб A ${Date.now()}`, ['Миша', 'Саша']);
  const companyA = page.url();
  await page.getByLabel('Выбрать сохранённого игрока 1').selectOption({ label: 'Миша' });
  await page.getByLabel('Выбрать сохранённого игрока 2').selectOption({ label: 'Саша' });
  await finishOneVisitSeriesFromSetup(page);
  await page.getByRole('button', { name: 'На главную' }).click();
  await page.getByRole('button', { name: 'Выйти из компании' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Выйти из компании' }).click();
  await createCompanyWithPlayers(page, `Клуб B ${Date.now()}`, ['Оля', 'Ира']);
  await page.getByLabel('Выбрать сохранённого игрока 1').selectOption({ label: 'Оля' });
  await page.getByLabel('Выбрать сохранённого игрока 2').selectOption({ label: 'Ира' });
  await finishOneVisitSeriesFromSetup(page);
  await page.getByRole('button', { name: 'На главную' }).click();
  await expect(page.getByLabel('Выбрать сохранённого игрока 1')).toHaveValue(/.+/);
  await page.goto(companyA);
  await expect(page.getByLabel('Выбрать сохранённого игрока 1')).toHaveValue(/.+/);
  await expect(page.locator('.participant-card.profile')).toContainText(['Миша', 'Саша']);
  await expect(page.locator('.participant-card.profile')).not.toContainText(['Оля', 'Ира']);
});
