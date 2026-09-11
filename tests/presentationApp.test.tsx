import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { companySync, services } from "../src/app/compositionRoot";
import { clearLocalData } from "../src/infrastructure/persistence/IndexedDbRepositories";
import { createMatch } from "../src/domain/match/createMatch";
import { GameSession } from "../src/application/GameSession";
import { numberThrow } from "../src/domain/darts/DartThrow";

const at = "2026-09-07T12:00:00.000Z";
const WIPE_BUTTON = "Сбросить повреждённые данные";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
  await clearLocalData();
});

async function storeCompletedMatch(): Promise<void> {
  await services.players.save({ id: "a", name: "Михаил", createdAt: at });
  await services.players.save({ id: "b", name: "Александр", createdAt: at });
  const match = createMatch("restore", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, at);
  if (match.state.kind !== "x01") throw new Error("test setup");
  const almostWon = { ...match, state: { ...match.state, remaining: { a: 40, b: 501 } } };
  const session = new GameSession(almostWon, services.matches, () => "visit", () => at);
  await session.record(numberThrow(20, 2));
  await session.confirm();
}

describe("company failures are not storage failures (DATA-4)", () => {
  it("shows a retryable notice without offering to erase anything", async () => {
    window.history.replaceState(null, "", "/g/unknown-token");
    vi.spyOn(companySync, "open").mockRejectedValue(new Error("Не удалось связаться с компанией. Проверьте подключение."));

    render(<App />);

    expect(await screen.findByText("Не удалось связаться с компанией. Проверьте подключение.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: WIPE_BUTTON })).not.toBeInTheDocument();
    expect(document.querySelector(".fatal")).toBeNull();
  });
});

describe("erasing local data (DATA-4)", () => {
  it("requires a confirmation dialog and explains a blocked deletion", async () => {
    vi.spyOn(services.matches, "loadActive").mockRejectedValue(new Error("InvalidStateError"));
    const clear = vi.spyOn(services, "clearLocalData").mockRejectedValue(new Error("Не удалось закрыть локальную базу данных."));

    render(<App />);

    const wipe = await screen.findByRole("button", { name: WIPE_BUTTON });
    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось прочитать данные на этом устройстве.");

    fireEvent.click(wipe);
    const dialog = await screen.findByRole("dialog", { name: "Стереть все данные на этом устройстве?" });
    expect(clear).not.toHaveBeenCalled();

    fireEvent.click(dialog.querySelector("button.secondary")!);
    expect(clear).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: WIPE_BUTTON }));
    fireEvent.click((await screen.findByRole("dialog")).querySelector("button.danger-button")!);
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Закройте другие вкладки/)).toBeInTheDocument();
  });

  it("offers a raw dump of whatever is still readable before erasing", async () => {
    vi.spyOn(services.matches, "loadActive").mockRejectedValue(new Error("InvalidStateError"));
    const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:dump");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Выгрузить данные в файл" }));

    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(await screen.findByText(/Файл сохранён/)).toBeInTheDocument();
  });
});

describe("a completed match on the resume card (DATA-3)", () => {
  it("never offers to abandon a finished match", async () => {
    await storeCompletedMatch();

    render(<App />);

    expect(await screen.findByRole("button", { name: "Открыть итоги" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Прервать матч" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Показать результат" })).toBeInTheDocument();
  });
});

describe("screen history (CLI-1)", () => {
  it("returns to the previous screen instead of leaving the application", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "История" }));
    expect(await screen.findByRole("heading", { name: "История" })).toBeInTheDocument();

    window.history.back();

    expect(await screen.findByRole("heading", { name: "Новая игра" })).toBeInTheDocument();
  });
});

describe("known companies on the home screen (DATA-6)", () => {
  it("lets the device return to a company whose invite link was lost", async () => {
    vi.spyOn(services.shared, "companies").mockResolvedValue([{ token: "token-a", name: "Наша лига", createdAt: at }]);
    const open = vi.spyOn(companySync, "open").mockResolvedValue({ token: "token-a", name: "Наша лига", createdAt: at });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Открыть" }));

    await waitFor(() => expect(open).toHaveBeenCalledWith("token-a"));
    expect(window.location.pathname).toBe("/g/token-a");
  });
});
