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
