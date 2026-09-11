/**
 * Единственное правило склонения победителя (OOP-3).
 *
 * Раньше экран игры проверял `name.endsWith("а")`, а экран итогов — регулярное
 * выражение по окончаниям. Два правила для одной задачи давали разный текст на
 * соседних экранах («Ника победил» против «Ника победила»).
 *
 * Правило остаётся эвристикой (по имени пол определить нельзя), но теперь она
 * одна: за победителем сохраняется тот же текст на всех экранах.
 */
const FEMININE_ENDING = /(на|ла|ра|та|га)$/iu;

export function victoryVerb(name: string): string {
  return `победил${FEMININE_ENDING.test(name) ? 'а' : ''}`;
}

export function victoryTitle(name: string | undefined, draw: string = 'Ничья'): string {
  return name ? `${name} ${victoryVerb(name)}` : draw;
}
