import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";
import { safeJsonParse } from "@/lib/helpers";

/** Historique réel d'une conversation : messages, sources, missions liées. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth();
    const { id } = await ctx.params;
    const conversation = await db.conversation.findFirst({ where: { id, organizationId: auth.organization.id } });
    if (!conversation) throw new Error("conversation_introuvable");
    const messages = await db.message.findMany({
      where: { conversationId: id, organizationId: auth.organization.id },
      orderBy: { createdAt: "asc" },
    });
    const taskIds = messages.map((m) => m.taskId).filter(Boolean) as string[];
    const tasks = taskIds.length
      ? await db.agentTask.findMany({ where: { id: { in: taskIds }, organizationId: auth.organization.id } })
      : [];
    return {
      conversation,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sources: safeJsonParse(m.sourcesJson ?? "[]", []),
        taskId: m.taskId,
        createdAt: m.createdAt,
      })),
      tasks: tasks.map((t) => ({
        id: t.id,
        objectif: t.objective,
        statut: t.status,
        steps: safeJsonParse(t.stepsJson, []),
        toolCalls: safeJsonParse(t.toolCallsJson, []),
        sources: safeJsonParse(t.sourcesJson, []),
        finishedAt: t.finishedAt,
      })),
    };
  });
}
