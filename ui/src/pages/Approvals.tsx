import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { approvalsApi } from "../api/approvals";
import { agentsApi } from "../api/agents";
import { issuesApi } from "../api/issues";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { PageTabBar } from "../components/PageTabBar";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { MessageSquare, ShieldCheck } from "lucide-react";
import { ApprovalCard } from "../components/ApprovalCard";
import { PageSkeleton } from "../components/PageSkeleton";
import { listPendingBoardDecisionItems, type BoardDecisionItem, type ThreadDecisionItem } from "../lib/boardDecisionItems";
import { timeAgo } from "../lib/timeAgo";
import type { Agent, Approval, AskUserQuestionsAnswer, AskUserQuestionsPayload, RequestConfirmationPayload } from "@paperclipai/shared";

type StatusFilter = "pending" | "all";

type DecisionItemGroup = { title: string; items: BoardDecisionItem[]; approvals?: never; empty: string };
type ApprovalGroup = { title: string; approvals: Approval[]; items?: never; empty: string };

function isDecisionItemGroup(group: DecisionItemGroup | ApprovalGroup): group is DecisionItemGroup {
  return Array.isArray(group.items);
}

function interactionLabel(item: ThreadDecisionItem) {
  return item.interaction.kind === "ask_user_questions" ? "Question" : "Confirmation";
}

function interactionTitle(item: ThreadDecisionItem) {
  return item.interaction.title ?? item.interaction.summary ?? item.issue.title;
}

function BoardDecisionItemCard({
  item,
  requesterAgent,
  onApprove,
  onReject,
  onInteractionResolved,
  isPending,
  pendingAction,
}: {
  item: BoardDecisionItem;
  requesterAgent: Agent | null;
  onApprove?: () => void;
  onReject?: () => void;
  onInteractionResolved?: () => void;
  isPending: boolean;
  pendingAction: "approve" | "reject" | null;
}) {
  if (item.kind === "approval") {
    return (
      <ApprovalCard
        approval={item.approval}
        requesterAgent={requesterAgent}
        onApprove={onApprove}
        onReject={onReject}
        detailLink={`/approvals/${item.approval.id}`}
        isPending={isPending}
        pendingAction={pendingAction}
      />
    );
  }

  const [selectedOptions, setSelectedOptions] = useState<Record<string, string[]>>({});
  const [rejectReason, setRejectReason] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmittingInteraction, setIsSubmittingInteraction] = useState(false);

  const setQuestionOption = (questionId: string, optionId: string, selectionMode: "single" | "multi") => {
    setSelectedOptions((current) => {
      const previous = current[questionId] ?? [];
      return {
        ...current,
        [questionId]: selectionMode === "single"
          ? [optionId]
          : previous.includes(optionId)
            ? previous.filter((id) => id !== optionId)
            : [...previous, optionId],
      };
    });
  };

  const submitAnswers = async () => {
    if (item.kind !== "thread_interaction" || item.interaction.kind !== "ask_user_questions") return;
    setIsSubmittingInteraction(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const answers: AskUserQuestionsAnswer[] = item.interaction.payload.questions.map((question) => ({
        questionId: question.id,
        optionIds: selectedOptions[question.id] ?? [],
      }));
      await issuesApi.respondToInteraction(item.issue.id, item.interaction.id, { version: item.interaction.payload.version, answers });
      setActionMessage("Answer submitted.");
      onInteractionResolved?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to submit answer");
    } finally {
      setIsSubmittingInteraction(false);
    }
  };

  const resolveConfirmation = async (outcome: "accept" | "reject") => {
    if (item.kind !== "thread_interaction" || item.interaction.kind !== "request_confirmation") return;
    setIsSubmittingInteraction(true);
    setActionError(null);
    setActionMessage(null);
    try {
      if (outcome === "accept") {
        await issuesApi.acceptInteraction(item.issue.id, item.interaction.id);
        setActionMessage("Confirmation approved.");
      } else {
        await issuesApi.rejectInteraction(item.issue.id, item.interaction.id, rejectReason.trim() || undefined);
        setActionMessage("Confirmation rejected.");
      }
      onInteractionResolved?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Failed to ${outcome} confirmation`);
    } finally {
      setIsSubmittingInteraction(false);
    }
  };

  const questionPayload = item.interaction.kind === "ask_user_questions"
    ? item.interaction.payload as AskUserQuestionsPayload
    : null;
  const confirmationPayload = item.interaction.kind === "request_confirmation"
    ? item.interaction.payload as RequestConfirmationPayload
    : null;

  return (
    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background/80">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-border/70 bg-background/70 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Thread {interactionLabel(item)}
                </Badge>
                <span className="text-xs text-muted-foreground">From {item.issue.identifier ?? item.issue.title}</span>
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold leading-6 text-foreground">{interactionTitle(item)}</h3>
                <p className="text-xs leading-5 text-muted-foreground">
                  Decision interaction created {timeAgo(item.interaction.createdAt)} on an open issue.
                </p>
              </div>
              {item.interaction.summary && item.interaction.summary !== interactionTitle(item) && (
                <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{item.interaction.summary}</p>
              )}
            </div>
          </div>
        </div>
        <div className="shrink-0 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-1 text-xs text-yellow-700 dark:text-yellow-400">
          Pending
        </div>
      </div>
      <div className="mt-4 space-y-4 border-t border-border/60 pt-4">
        {questionPayload && (
          <div className="space-y-4">
            {questionPayload.questions.map((question) => (
              <fieldset key={question.id} className="space-y-2">
                <legend className="text-sm font-medium text-foreground">{question.prompt}</legend>
                {question.helpText && <p className="text-xs text-muted-foreground">{question.helpText}</p>}
                <div className="space-y-2">
                  {question.options.map((option) => {
                    const selected = (selectedOptions[question.id] ?? []).includes(option.id);
                    return (
                      <label key={option.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-sm hover:bg-muted/30">
                        <input
                          className="mt-1"
                          type={question.selectionMode === "single" ? "radio" : "checkbox"}
                          name={`${item.interaction.id}-${question.id}`}
                          checked={selected}
                          onChange={() => setQuestionOption(question.id, option.id, question.selectionMode)}
                        />
                        <span>
                          <span className="block text-foreground">{option.label}</span>
                          {option.description && <span className="block text-xs text-muted-foreground">{option.description}</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
            <Button size="sm" onClick={submitAnswers} disabled={isSubmittingInteraction}>
              {isSubmittingInteraction ? "Sending..." : (questionPayload.submitLabel ?? "Send")}
            </Button>
          </div>
        )}

        {confirmationPayload && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{confirmationPayload.prompt}</p>
            {confirmationPayload.detailsMarkdown && (
              <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                {confirmationPayload.detailsMarkdown}
              </div>
            )}
            <textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder={confirmationPayload.rejectReasonLabel ?? "Reason for rejection (optional)"}
              className="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="bg-green-700 text-white hover:bg-green-600" onClick={() => resolveConfirmation("accept")} disabled={isSubmittingInteraction}>
                {confirmationPayload.acceptLabel ?? "Approve"}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => resolveConfirmation("reject")} disabled={isSubmittingInteraction}>
                {confirmationPayload.rejectLabel ?? "Reject"}
              </Button>
            </div>
          </div>
        )}

        {actionMessage && <p className="text-sm text-green-600 dark:text-green-400">{actionMessage}</p>}
        {actionError && <p className="text-sm text-destructive">{actionError}</p>}
        <div className="flex justify-end">
          <Link
            to={`/issues/${item.issue.id}`}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-auto px-2 text-xs text-muted-foreground")}
          >
            Open source issue
          </Link>
        </div>
      </div>
    </div>
  );
}

export function Approvals() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const pathSegment = location.pathname.split("/").pop() ?? "pending";
  const statusFilter: StatusFilter = pathSegment === "all" ? "all" : "pending";
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Approvals" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.approvals.list(selectedCompanyId!),
    queryFn: () => approvalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const {
    data: pendingBoardDecisionItems = [],
    isLoading: isLoadingBoardDecisionItems,
    error: boardDecisionItemsError,
  } = useQuery({
    queryKey: queryKeys.approvals.boardDecisionItems(selectedCompanyId!),
    queryFn: () => listPendingBoardDecisionItems(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.approve(id),
    onSuccess: (_approval, id) => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
      navigate(`/approvals/${id}?resolved=approved`);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to approve");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.reject(id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to reject");
    },
  });

  const approvals = data ?? [];
  const sortNewestFirst = (items: typeof approvals) =>
    [...items].sort((a, b) => {
      const aTime = new Date(a.decidedAt ?? a.updatedAt ?? a.createdAt).getTime();
      const bTime = new Date(b.decidedAt ?? b.updatedAt ?? b.createdAt).getTime();
      return bTime - aTime;
    });

  const recentDecisions = sortNewestFirst(
    approvals.filter((approval) => approval.status === "approved" || approval.status === "rejected"),
  ).slice(0, 10);
  const allApprovals = sortNewestFirst(approvals);
  const pendingCount = pendingBoardDecisionItems.length;
  const approvedCount = approvals.filter((approval) => approval.status === "approved").length;
  const rejectedCount = approvals.filter((approval) => approval.status === "rejected").length;
  const groups: Array<DecisionItemGroup | ApprovalGroup> = statusFilter === "all"
    ? [{ title: "All approvals", approvals: allApprovals, empty: "No approvals yet." }]
    : [
        { title: "Waiting on you", items: pendingBoardDecisionItems, empty: "No pending approvals." },
        { title: "Recent decisions", approvals: recentDecisions, empty: "No recent decisions yet." },
      ];
  const visibleCount = groups.reduce((count, group) => count + (isDecisionItemGroup(group) ? group.items.length : group.approvals.length), 0);

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Select a company first.</p>;
  }

  if (isLoading || isLoadingBoardDecisionItems) {
    return <PageSkeleton variant="approvals" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Tabs value={statusFilter} onValueChange={(v) => navigate(`/approvals/${v}`)}>
          <PageTabBar items={[
            { value: "pending", label: <>Pending{pendingCount > 0 && (
              <span className={cn(
                "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                "bg-yellow-500/20 text-yellow-500"
              )}>
                {pendingCount}
              </span>
            )}</> },
            { value: "all", label: "All" },
          ]} />
        </Tabs>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pending</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">{pendingCount}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Approved</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">{approvedCount}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rejected</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">{rejectedCount}</div>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {boardDecisionItemsError && <p className="text-sm text-destructive">{boardDecisionItemsError.message}</p>}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      {visibleCount === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ShieldCheck className="h-8 w-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">
            {statusFilter === "pending" ? "No approvals need your attention yet." : "No approvals yet."}
          </p>
        </div>
      )}

      {visibleCount > 0 && groups.map((group) => {
        const count = isDecisionItemGroup(group) ? group.items.length : group.approvals.length;
        return (
          <section key={group.title} className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">{group.title}</h2>
              <span className="text-xs text-muted-foreground">{count}</span>
            </div>
            {count === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                {group.empty}
              </p>
            ) : (
              <div className="grid gap-3">
                {isDecisionItemGroup(group) ? group.items.map((item) => (
                  <BoardDecisionItemCard
                    key={`${item.kind}:${item.id}`}
                    item={item}
                    requesterAgent={item.kind === "approval" && item.approval.requestedByAgentId
                      ? (agents ?? []).find((a) => a.id === item.approval.requestedByAgentId) ?? null
                      : null}
                    onApprove={item.kind === "approval" ? () => approveMutation.mutate(item.approval.id) : undefined}
                    onReject={item.kind === "approval" ? () => rejectMutation.mutate(item.approval.id) : undefined}
                    isPending={approveMutation.isPending || rejectMutation.isPending}
                    pendingAction={approveMutation.isPending ? "approve" : rejectMutation.isPending ? "reject" : null}
                    onInteractionResolved={() => {
                      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.boardDecisionItems(selectedCompanyId!) });
                      queryClient.invalidateQueries({ queryKey: queryKeys.issues.interactions(item.kind === "thread_interaction" ? item.issue.id : "") });
                    }}
                  />
                )) : group.approvals.map((approval) => (
                  <ApprovalCard
                    key={approval.id}
                    approval={approval}
                    requesterAgent={approval.requestedByAgentId ? (agents ?? []).find((a) => a.id === approval.requestedByAgentId) ?? null : null}
                    onApprove={() => approveMutation.mutate(approval.id)}
                    onReject={() => rejectMutation.mutate(approval.id)}
                    detailLink={`/approvals/${approval.id}`}
                    isPending={approveMutation.isPending || rejectMutation.isPending}
                    pendingAction={
                      approveMutation.isPending ? "approve" : rejectMutation.isPending ? "reject" : null
                    }
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
