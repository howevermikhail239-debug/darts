import { IndexedDbMatchRepository, IndexedDbPlayerRepository, LocalSettingsRepository, IndexedDbBackupRepository, IndexedDbSharedRepository, clearLocalData } from '../infrastructure/persistence/IndexedDbRepositories';
import { startMatch } from '../application/StartMatch';
import { exportBackup, restoreBackup } from '../application/BackupService';
import { CompanySync } from '../application/CompanySync';

const matches = new IndexedDbMatchRepository();
const players = new IndexedDbPlayerRepository();
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const backups = new IndexedDbBackupRepository();

export const services = {
  matches,
  players,
  shared: new IndexedDbSharedRepository(),
  settings: new LocalSettingsRepository(),
  clearLocalData,
  id,
  now,
  exportBackup: () => exportBackup(backups, now),
  restoreBackup: (json: string) => restoreBackup(backups, json),
  startMatch: async (participants: Parameters<typeof startMatch>[1], setup: Parameters<typeof startMatch>[2], companyToken?: string) => {
    const participantCatalog = companyToken
      ? { list: () => services.shared.players(companyToken), save: (player: Parameters<typeof players.save>[0]) => players.save(player) }
      : players;
    return startMatch({ matches, players: participantCatalog, id, now, ...(companyToken ? { companyToken } : {}) }, participants, setup);
  },
};
export const companySync = new CompanySync(services.shared);
