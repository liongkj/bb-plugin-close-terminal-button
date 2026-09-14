import { useCallback, useEffect, useRef, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import type { rpcContract, TerminalSummary } from "./server";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { toast } from "sonner";

function formatStatus(status: TerminalSummary["status"]): string {
  switch (status) {
    case "starting":
      return "starting";
    case "disconnected":
      return "disconnected";
    case "exited":
      return "exited";
    case "running":
      return "running";
  }
}

function TerminalRow({
  session,
  confirming,
  closing,
  onConfirm,
  onCancel,
  onRequestClose,
}: {
  session: TerminalSummary;
  confirming: boolean;
  closing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onRequestClose: () => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
      <Icon name="Terminal" className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{session.title || "Terminal"}</p>
        <p className="truncate text-xs text-muted-foreground">
          {formatStatus(session.status)} · {session.initialCwd}
        </p>
      </div>
      {confirming ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="destructive"
            size="sm"
            disabled={closing}
            onClick={onConfirm}
          >
            {closing ? "Closing…" : "Confirm"}
          </Button>
          <Button variant="ghost" size="sm" disabled={closing} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={closing}
          onClick={onRequestClose}
          aria-label={`Close ${session.title || "terminal"}`}
        >
          Close
        </Button>
      )}
    </li>
  );
}

function CloseTerminalButton({
  threadId,
}: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<TerminalSummary[] | null>(null);
  const [showButton, setShowButton] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  const loadSessions = useCallback(
    async ({ showLoading = false }: { showLoading?: boolean } = {}) => {
      const requestId = ++requestGeneration.current;
      setError(null);
      if (showLoading) {
        setSessions(null);
      }
      try {
        const result = await rpc.call("terminals_list", { threadId });
        if (requestId !== requestGeneration.current) {
          return;
        }
        setSessions(result.sessions);
        setShowButton(result.showButton);
      } catch (cause) {
        if (requestId !== requestGeneration.current) {
          return;
        }
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [rpc, threadId],
  );

  useEffect(() => {
    setSessions(null);
    setShowButton(false);
    setError(null);
    setConfirmingId(null);
    setClosingId(null);
  }, [threadId]);

  useEffect(() => {
    void loadSessions();
    const refreshTimer = window.setInterval(() => {
      void loadSessions();
    }, 5000);
    return () => {
      window.clearInterval(refreshTimer);
      requestGeneration.current += 1;
    };
  }, [loadSessions]);

  const closeTerminal = useCallback(
    async (terminalId: string) => {
      setClosingId(terminalId);
      setError(null);
      try {
        const closed = await rpc.call("terminal_close", {
          threadId,
          terminalId,
        });
        setSessions((current) =>
          current?.filter((session) => session.id !== closed.id) ?? [],
        );
        void loadSessions();
        setConfirmingId(null);
        toast.success(`Closed ${closed.title || "terminal"}`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setClosingId(null);
      }
    },
    [loadSessions, rpc, threadId],
  );

  const openDialog = () => {
    setOpen(true);
    setConfirmingId(null);
    void loadSessions({ showLoading: true });
  };

  if (!showButton && !open) {
    return null;
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label="Close terminal"
        onClick={openDialog}
      >
        <Icon name="X" className="size-4" />
        <span className="sr-only">Close terminal</span>
      </Button>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setConfirmingId(null);
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Close terminal</DialogTitle>
            <DialogDescription>
              Closing a terminal stops its shell and any process running in it.
            </DialogDescription>
          </DialogHeader>
          {error === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {sessions === null ? (
            <p className="text-sm text-muted-foreground">Loading terminals…</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active terminal sessions belong to this thread.
            </p>
          ) : (
            <ul className="grid gap-2">
              {sessions.map((session) => (
                <TerminalRow
                  key={session.id}
                  session={session}
                  confirming={confirmingId === session.id}
                  closing={closingId === session.id}
                  onRequestClose={() => setConfirmingId(session.id)}
                  onCancel={() => setConfirmingId(null)}
                  onConfirm={() => void closeTerminal(session.id)}
                />
              ))}
            </ul>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Done</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "close-terminal",
    title: "Close terminal",
    component: CloseTerminalButton,
  });
});
