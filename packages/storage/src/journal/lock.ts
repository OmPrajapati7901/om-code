/**
 * LRN-06: BSD advisory lock via fs-native-extensions on macOS. The permanent
 * lock inode MUST NOT be renamed or unlinked, including during repair.
 * OS close/process death releases ownership; holder JSON is advisory only.
 * No heartbeat, PID-based reclaim, process hooks, or signal handlers.
 */
import { constants } from "node:fs";
import { hostname } from "node:os";
import { tryLock, unlock } from "fs-native-extensions";
import { JournalError } from "./errors.js";
import { openRegular, readExtent } from "./files.js";

export async function acquireJournalLock(path: string): Promise<() => Promise<void>> {
  const handle = await openRegular(path, constants.O_RDWR | constants.O_CREAT, true);
  let acquired = false;
  try {
    acquired = tryLock(handle.fd);
    if (!acquired) {
      let holder: Record<string, unknown> = {};
      try {
        const raw: unknown = JSON.parse((await readExtent(handle)).toString("utf8"));
        if (typeof raw === "object" && raw !== null && !Array.isArray(raw))
          holder = raw as Record<string, unknown>;
      } catch {
        /* Metadata publication is not the locking mechanism. */
      }
      const pid =
        typeof holder.pid === "number" && Number.isSafeInteger(holder.pid) ? holder.pid : undefined;
      throw new JournalError(
        "locked",
        pid === undefined
          ? `session writer is initializing (lock: ${path})`
          : `session is locked; recorded holder pid ${pid} (lock: ${path})`,
        { ...holder, path },
      );
    }
    await handle.truncate(0);
    await handle.writeFile(
      JSON.stringify({
        pid: process.pid,
        hostname: hostname(),
        started_at: new Date().toISOString(),
      }),
    );
    await handle.sync();
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      try {
        unlock(handle.fd);
      } finally {
        await handle.close();
      }
    };
  } catch (error) {
    try {
      if (acquired) unlock(handle.fd);
    } finally {
      await handle.close();
    }
    throw error;
  }
}
