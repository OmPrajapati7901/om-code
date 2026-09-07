import type { JournalSink } from "@om-code/kernel";
import type { JournalRecord, SessionMode } from "@om-code/protocol";
import { materialize, type SessionView } from "@om-code/session";
import { type JournalLocation, JournalWriter, type RuntimeSettings } from "@om-code/storage";

export type SessionBootstrapInput = {
  readonly settings: RuntimeSettings;
  readonly location: JournalLocation;
  readonly sessionId: string;
  readonly cwd: string;
  readonly mode: SessionMode;
  readonly startedAt: Date;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly onRecord: (record: JournalRecord) => void;
};

export type BootstrappedSession = {
  readonly writer: JournalWriter;
  readonly journal: JournalSink;
  readonly view: SessionView;
};

export async function bootstrapSession(input: SessionBootstrapInput): Promise<BootstrappedSession> {
  const writer = await JournalWriter.open({
    ...input.location,
    sessionId: input.sessionId,
    now: input.now,
    newId: input.newId,
  });
  const journal: JournalSink = {
    append: async (entry, context) => {
      const record = await writer.append(entry, context);
      input.onRecord(record);
      return record;
    },
  };
  try {
    const timestamp = input.startedAt.toISOString();
    const start = await journal.append(
      {
        kind: "session_start",
        schemaVersion: 1,
        meta: {
          id: input.sessionId,
          project_root: input.location.projectRoot,
          cwd: input.cwd,
          created_at: timestamp,
          updated_at: timestamp,
          status: "active",
          mode: input.mode,
          model: { id: input.settings.model, base_url: input.settings.baseUrl },
          tags: [],
        },
      },
      { by: "system" },
    );
    return { writer, journal, view: materialize([start]) };
  } catch (error) {
    await writer.close();
    throw error;
  }
}
