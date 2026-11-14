import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { consumeRateLimitWindow } from "@/lib/rate-limit";
import { runAgentTask, type AgentEvent } from "@/lib/agent/runner";

const bodySchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().optional(),
});

const CHAT_LIMIT = 40;
const CHAT_WINDOW_MS = 5 * 60 * 1000;

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Agent Workbench : streaming SSE réel de la mission (étapes, outils, sources, réponse). */
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    // Anti-abus persisté : 40 messages / 5 min par organisation+utilisateur (audit P3)
    const rl = await consumeRateLimitWindow(
      `AGENT_CHAT:${auth.organization.id}:${auth.user.id}`,
      CHAT_LIMIT,
      CHAT_WINDOW_MS
    );
    if (!rl.allowed) {
      return Response.json({ error: "trop_de_tentatives", retryAfterSeconds: rl.retryAfterSeconds }, { status: 429 });
    }
    const parsed = bodySchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new Error("message_invalide");

    let conversationId = parsed.data.conversationId;
    if (!conversationId || !(await db.conversation.findFirst({ where: { id: conversationId, organizationId: auth.organization.id } }))) {
      const conv = await db.conversation.create({
        data: { organizationId: auth.organization.id, userId: auth.user.id, channel: "WEB", title: parsed.data.message.slice(0, 60) },
      });
      conversationId = conv.id;
    }

    await db.message.create({
      data: { organizationId: auth.organization.id, conversationId, role: "user", content: parsed.data.message },
    });

    const history = await db.message.findMany({
      where: { conversationId, organizationId: auth.organization.id },
      orderBy: { createdAt: "asc" },
      take: 10,
      select: { role: true, content: true },
    });

    const conversationIdResolved = conversationId;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: AgentEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        try {
          send({ type: "etape", no: 0, label: "Mission démarrée", statut: "EN_COURS" });
          await runAgentTask({
            organizationId: auth.organization.id,
            orgSlug: auth.organization.slug,
            userId: auth.user.id,
            role: auth.role,
            locale: auth.organization.locale,
            conversationId: conversationIdResolved,
            objective: parsed.data.message,
            history: history.slice(0, -1),
            onEvent: send,
          });
        } catch (e) {
          send({ type: "erreur", message: e instanceof Error ? e.message : "erreur inconnue" });
        } finally {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "fin", conversationId: conversationIdResolved })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  });
}

export async function GET() {
  return handle(async () => {
    const auth = await requireAuth();
    const conversations = await db.conversation.findMany({
      where: { organizationId: auth.organization.id, userId: auth.user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    return {
      conversations: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        lastMessage: c.messages[0]?.content?.slice(0, 120) ?? "",
      })),
    };
  });
}
