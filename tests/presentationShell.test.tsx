import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupPage } from "../src/presentation/pages/SetupPage";
import { KnownCompanies } from "../src/presentation/components/KnownCompanies";
import { UpdateBanner } from "../src/presentation/components/UpdateBanner";
import { userMessage, networkMessage, GENERIC_FAILURE, NETWORK_FAILURE } from "../src/presentation/errors/userMessage";
import { victoryTitle } from "../src/presentation/players/victoryTitle";

const company = { token: "token-a", name: "Наша лига", createdAt: "2026-09-01T10:00:00.000Z" };

describe("company membership is reversible and explicit (DATA-6)", () => {
  afterEach(cleanup);

  it("asks for confirmation before leaving a company and shows the invite link as text", () => {
    const onLeaveCompany = vi.fn();
    render(<SetupPage saved={[]} onStart={vi.fn()} onHistory={vi.fn()} onStatistics={vi.fn()} company={company} onLeaveCompany={onLeaveCompany} inviteLink="https://darts.example/g/token-a" />);

    expect(screen.getByText("https://darts.example/g/token-a")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Выйти из компании" }));
    expect(onLeaveCompany).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog", { name: "Выйти из компании?" });
    fireEvent.click(dialog.querySelector("button.secondary")!);
    expect(onLeaveCompany).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Выйти из компании" }));
    fireEvent.click(screen.getByRole("dialog").querySelector("button.danger-button")!);
    expect(onLeaveCompany).toHaveBeenCalledTimes(1);
  });

  it("lists the companies this device already knows and offers to return to them", () => {
    const onOpen = vi.fn();
    render(<KnownCompanies companies={[company, { token: "token-b", name: "Соседи", createdAt: "2026-08-01T10:00:00.000Z" }]} currentToken="token-a" onOpen={onOpen} />);

    expect(screen.getByText("Наша лига")).toBeInTheDocument();
    expect(screen.getByText("Текущая")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));
    expect(onOpen).toHaveBeenCalledWith("token-b");
  });
});

describe("setup page reports failures instead of swallowing them (CLI-2)", () => {
  afterEach(cleanup);

  it("shows why the match could not be started", async () => {
    const onStart = vi.fn().mockRejectedValue(new DOMException("quota", "QuotaExceededError"));
    render(<SetupPage saved={[]} onStart={onStart} onHistory={vi.fn()} onStatistics={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Начать" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось начать матч. Попробуйте ещё раз.");
    expect(screen.getByRole("button", { name: "Начать" })).toBeEnabled();
  });

  it("shows why a company player could not be added", async () => {
    const onAddSharedPlayer = vi.fn().mockRejectedValue(new Error("Не удалось связаться с компанией. Проверьте подключение."));
    render(<SetupPage saved={[]} onStart={vi.fn()} onHistory={vi.fn()} onStatistics={vi.fn()} company={company} onAddSharedPlayer={onAddSharedPlayer} />);

    fireEvent.change(screen.getByLabelText("Добавить игрока компании"), { target: { value: "Миша" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить игрока" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Не удалось связаться с компанией. Проверьте подключение."));
    expect(screen.getByLabelText("Добавить игрока компании")).toHaveValue("Миша");
  });
});

describe("user-facing error texts (OOP-1)", () => {
  it("passes through known user conditions and hides unknown invariant violations", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(userMessage(new Error("Сначала сбросьте незавершённый подход"))).toBe("Сначала сбросьте незавершённый подход");
    expect(userMessage(new Error("Некорректный остаток игрока"))).toBe(GENERIC_FAILURE);
    expect(logged).toHaveBeenCalled();

    expect(networkMessage(new TypeError("Failed to fetch"))).toBe(NETWORK_FAILURE);
    expect(networkMessage(new SyntaxError("Unexpected token '<'"))).not.toContain("Unexpected token");

    logged.mockRestore();
  });
});

describe("winner declension is one rule (OOP-3)", () => {
  it("keeps the game and summary screens in agreement", () => {
    expect(victoryTitle("Миша")).toBe("Миша победил");
    expect(victoryTitle("Анна")).toBe("Анна победила");
    expect(victoryTitle(undefined)).toBe("Ничья");
  });
});

describe("update banner (REL-3)", () => {
  afterEach(cleanup);

  it("warns honestly during a match and updates only on an explicit press", () => {
    const onUpdate = vi.fn();
    render(<UpdateBanner matchInProgress onUpdate={onUpdate} onDismiss={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("Идёт матч");
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Обновить и перезагрузить" }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});
