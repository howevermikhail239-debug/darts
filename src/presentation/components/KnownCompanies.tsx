import type { SharedCompany } from "../../application/CompanySync";

type Props = {
  companies: readonly SharedCompany[];
  currentToken?: string | undefined;
  onOpen: (token: string) => void;
};

/**
 * Список компаний, которые устройство уже открывало (DATA-6).
 *
 * До этого токен компании существовал только в адресной строке, которой в
 * установленном PWA нет: выход из компании был необратим. Записи в базе
 * оставались, но интерфейс их не показывал нигде.
 */
export function KnownCompanies({ companies, currentToken, onOpen }: Props) {
  if (companies.length === 0) return null;
  return (
    <section className="known-companies" aria-label="Компании этого устройства">
      <h2>Компании этого устройства</h2>
      <ul>
        {companies.map((company) => {
          const current = company.token === currentToken;
          return (
            <li key={company.token}>
              <span>
                <b>{company.name || "Компания без названия"}</b>
                <small>{current ? "Открыта сейчас" : `Открывали ${new Date(company.createdAt).toLocaleDateString("ru-RU")}`}</small>
              </span>
              {current
                ? <span className="known-companies-current" role="status">Текущая</span>
                : <button className="secondary" onClick={() => onOpen(company.token)}>Открыть</button>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
