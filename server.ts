import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const terminalSummarySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.enum(["disconnected", "exited", "running", "starting"]),
    initialCwd: z.string(),
    lastUserInputAt: z.number().nullable(),
  })
  .strict();

export type TerminalSummary = z.infer<typeof terminalSummarySchema>;

export const rpcContract = defineRpcContract({
  terminals_list: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z
      .object({
        sessions: z.array(terminalSummarySchema),
        showButton: z.boolean(),
      })
      .strict(),
  },
  terminal_close: {
    input: z
      .object({
        threadId: z.string().min(1),
        terminalId: z.string().min(1),
      })
      .strict(),
    output: terminalSummarySchema,
  },
});

function summarizeTerminal(session: {
  id: string;
  title: string;
  status: "disconnected" | "exited" | "running" | "starting";
  initialCwd: string;
  lastUserInputAt: number | null;
}): TerminalSummary {
  return {
    id: session.id,
    title: session.title,
    status: session.status,
    initialCwd: session.initialCwd,
    lastUserInputAt: session.lastUserInputAt,
  };
}

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    terminals_list: async ({ threadId }) => {
      const [result, thread, timeline] = await Promise.all([
        bb.sdk.terminals.list({
          scope: { kind: "thread", threadId },
        }),
        bb.sdk.threads.get({ threadId }),
        bb.sdk.threads.timeline({
          threadId,
          segmentLimit: "1",
          summaryOnly: "true",
        }),
      ]);

      const sessions = result.sessions
        .filter((session) => session.status !== "exited")
        .map(summarizeTerminal);
      const hasBackgroundActivity =
        thread.activeBackgroundAgentCount > 0 ||
        timeline.activeBackgroundCommands.length > 0;

      return {
        sessions,
        showButton: sessions.length > 0 || hasBackgroundActivity,
      };
    },

    terminal_close: async ({ threadId, terminalId }) => {
      const current = await bb.sdk.terminals.get({ terminalId });
      if (current.threadId !== threadId) {
        throw new Error("That terminal does not belong to this thread.");
      }

      const closed = await bb.sdk.terminals.close({
        terminalId,
        mode: "force",
      });
      return summarizeTerminal(closed);
    },
  });
}
