import type { Approval, Issue, IssueThreadInteraction } from "@paperclipai/shared";
import { approvalsApi } from "../api/approvals";
import { issuesApi } from "../api/issues";

const OPEN_ISSUE_STATUSES = "todo,backlog,in_progress,in_review,blocked";
const BOARD_DECISION_INTERACTION_KINDS = new Set([
  "request_confirmation",
  "ask_user_questions",
]);

export type FormalApprovalDecisionItem = {
  id: string;
  kind: "approval";
  createdAt: string | Date;
  updatedAt: string | Date;
  approval: Approval;
};

export type ThreadDecisionItem = {
  id: string;
  kind: "thread_interaction";
  createdAt: string | Date;
  updatedAt: string | Date;
  issue: Issue;
  interaction: IssueThreadInteraction;
};

export type BoardDecisionItem = FormalApprovalDecisionItem | ThreadDecisionItem;

function newestTimestamp(item: Pick<BoardDecisionItem, "createdAt" | "updatedAt">) {
  return new Date(item.updatedAt ?? item.createdAt).getTime();
}

function sortNewestFirst(items: BoardDecisionItem[]) {
  return [...items].sort((a, b) => newestTimestamp(b) - newestTimestamp(a));
}

function dedupeBoardDecisionItems(items: BoardDecisionItem[]) {
  const seen = new Set<string>();
  const deduped: BoardDecisionItem[] = [];
  for (const item of items) {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

export function isBoardDecisionInteraction(interaction: IssueThreadInteraction) {
  return interaction.status === "pending" && BOARD_DECISION_INTERACTION_KINDS.has(interaction.kind);
}

export async function listPendingBoardDecisionItems(companyId: string): Promise<BoardDecisionItem[]> {
  const [formalApprovals, openIssues] = await Promise.all([
    approvalsApi.list(companyId, "pending"),
    issuesApi.list(companyId, { status: OPEN_ISSUE_STATUSES, limit: 1000 }),
  ]);

  const interactionGroups = await Promise.all(
    openIssues.map(async (issue) => ({
      issue,
      interactions: await issuesApi.listInteractions(issue.id),
    })),
  );

  const items: BoardDecisionItem[] = [
    ...formalApprovals.map((approval): FormalApprovalDecisionItem => ({
      id: approval.id,
      kind: "approval",
      createdAt: approval.createdAt,
      updatedAt: approval.updatedAt,
      approval,
    })),
    ...interactionGroups.flatMap(({ issue, interactions }) =>
      interactions
        .filter(isBoardDecisionInteraction)
        .map((interaction): ThreadDecisionItem => ({
          id: interaction.id,
          kind: "thread_interaction",
          createdAt: interaction.createdAt,
          updatedAt: interaction.updatedAt,
          issue,
          interaction,
        })),
    ),
  ];

  return sortNewestFirst(dedupeBoardDecisionItems(items));
}
