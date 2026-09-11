const DATABASE_NAME = "dart-scorekeeper";

export type LocalDataCounts = Readonly<{
  exact: boolean;
  matches?: number;
  players?: number;
}>;

export type RawDump = Readonly<{
  format: "dart-scorekeeper-raw-dump";
  exportedAt: string;
  database: string;
  stores: Readonly<Record<string, readonly unknown[]>>;
  skipped: number;
  unreadable: boolean;
}>;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB request failed")), {
      once: true,
    });
  });
}

function openExistingDatabase(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME);
    request.addEventListener(
      "upgradeneeded",
      () => {
        // Opening a missing database creates an empty one. Abort that transaction so a
        // diagnostic export never mutates storage merely by inspecting it.
        request.transaction?.abort();
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => {
      if (request.error?.name === "AbortError") resolve(undefined);
      else reject(request.error ?? new Error("IndexedDB open failed"));
    }, { once: true });
  });
}

async function readStore(database: IDBDatabase, name: string): Promise<readonly unknown[]> {
  const transaction = database.transaction(name, "readonly");
  return requestResult(transaction.objectStore(name).getAll());
}

export async function countLocalData(): Promise<LocalDataCounts> {
  const database = await openExistingDatabase();
  if (!database) return { exact: true, matches: 0, players: 0 };
  try {
    const count = async (name: string): Promise<number> => {
      if (!database.objectStoreNames.contains(name)) return 0;
      const transaction = database.transaction(name, "readonly");
      return requestResult(transaction.objectStore(name).count());
    };
    const [matches, players] = await Promise.all([count("matches"), count("players")]);
    return { exact: true, matches, players };
  } catch {
    return { exact: false };
  } finally {
    database.close();
  }
}

export async function collectRawDump(): Promise<RawDump> {
  let database: IDBDatabase | undefined;
  try {
    database = await openExistingDatabase();
  } catch {
    return {
      format: "dart-scorekeeper-raw-dump",
      exportedAt: new Date().toISOString(),
      database: DATABASE_NAME,
      stores: {},
      skipped: 0,
      unreadable: true,
    };
  }

  if (!database) {
    return {
      format: "dart-scorekeeper-raw-dump",
      exportedAt: new Date().toISOString(),
      database: DATABASE_NAME,
      stores: {},
      skipped: 0,
      unreadable: false,
    };
  }

  const stores: Record<string, readonly unknown[]> = {};
  let skipped = 0;
  for (const name of Array.from(database.objectStoreNames)) {
    try {
      stores[name] = await readStore(database, name);
    } catch {
      skipped += 1;
    }
  }
  database.close();
  return {
    format: "dart-scorekeeper-raw-dump",
    exportedAt: new Date().toISOString(),
    database: DATABASE_NAME,
    stores,
    skipped,
    unreadable: Object.keys(stores).length === 0 && skipped > 0,
  };
}

export function downloadRawDump(dump: RawDump): void {
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `dart-scorekeeper-raw-${new Date().toISOString().replaceAll(":", "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
