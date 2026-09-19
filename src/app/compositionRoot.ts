import {
  IndexedDbMatchRepository,
  IndexedDbPlayerRepository,
  LocalSettingsRepository,
  IndexedDbBackupRepository,
  IndexedDbSharedRepository,
  IndexedDbLastSetupRepository,
  IndexedDbCompetitiveRepository,
  IndexedDbIdentityRepository,
  clearLocalData,
  onStorageNotice,
} from '../infrastructure/persistence/IndexedDbRepositories';
import { startMatch } from '../application/StartMatch';
import { exportBackup, restoreBackup } from '../application/BackupService';
import { CompanySync } from '../application/CompanySync';
import { HttpCompanyGateway } from '../infrastructure/network/HttpCompanyGateway';

const matches = new IndexedDbMatchRepository();
const players = new IndexedDbPlayerRepository();
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const backups = new IndexedDbBackupRepository();
const sharedRepository = new IndexedDbSharedRepository();
const competitive = new IndexedDbCompetitiveRepository();
const identities = new IndexedDbIdentityRepository();

const sharedForUi = {
  companies: () => sharedRepository.companies(),
  players: (token: string) => sharedRepository.players(token),
  matches: async (token: string) =>
    (await sharedRepository.matches(token)).map((item) => ({
      match: item.match,
      state: item.state,
      ...(item.reason !== undefined ? { reason: item.reason } : {}),
    })),
};

export const services = {
  matches,
  players,
  shared: sharedForUi,
  settings: new LocalSettingsRepository(),
  lastSetups: new IndexedDbLastSetupRepository(),
  competitive,
  identities,
  clearLocalData,
  onStorageNotice,
  id,
  now,
  exportBackup: () => exportBackup(backups, now),
  restoreBackup: (json: string) => restoreBackup(backups, json),
  startMatch: async (
    participants: Parameters<typeof startMatch>[1],
    setup: Parameters<typeof startMatch>[2],
    companyToken?: string,
  ) => {
    const participantCatalog = companyToken
      ? {
          list: () => sharedRepository.players(companyToken),
          save: (player: Parameters<typeof players.save>[0]) => players.save(player),
        }
      : players;
    return startMatch(
      { matches, players: participantCatalog, id, now, ...(companyToken ? { companyToken } : {}) },
      participants,
      setup,
    );
  },
};
const companyGateway = new HttpCompanyGateway();
export const companySync = new CompanySync(sharedRepository, companyGateway);
export { companyGateway };
