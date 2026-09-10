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

  it("protects company creation from duplicate submits and keeps the name for a retry", async () => {
    let rejectCreation: ((cause: Error) => void) | undefined;
    const onCreateCompany = vi.fn(() => new Promise<void>((_, reject) => { rejectCreation = reject; }));
    render(<SetupPage saved={[]} onStart={vi.fn()} onHistory={() => undefined} onStatistics={() => undefined} onCreateCompany={onCreateCompany} />);

    fireEvent.click(screen.getByRole("button", { name: "Создать компанию" }));
    fireEvent.change(screen.getByLabelText("Название компании (необязательно)"), { target: { value: "Наша лига" } });
    fireEvent.click(screen.getByRole("button", { name: /^Создать$/ }));

    const busy = await screen.findByRole("button", { name: "Создаём компанию…" });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(onCreateCompany).toHaveBeenCalledTimes(1);
    rejectCreation?.(new Error("technical details"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось создать компанию. Проверьте подключение и попробуйте ещё раз.");
    expect(screen.queryByText("technical details")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Название компании (необязательно)")).toHaveValue("Наша лига");
    expect(screen.getByRole("button", { name: /^Создать$/ })).toBeEnabled();
  });
});
