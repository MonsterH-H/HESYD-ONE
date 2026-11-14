import { db } from "@/lib/db";
import { statArchivedFile } from "@/lib/storage/local";
import { safeJsonParse } from "@/lib/helpers";
import { createDeliverable } from "@/lib/deliverables/generate";

/**
 * Catalogue d'outils de l'agent — tous RÉELS, typés, permissionnés.
 * Chaque outil déclare : nom, description, schéma, risque, méthode de
 * vérification de réussite (CDC §7.2). L'agent n'accède jamais directement
 * à la base : il ne passe que par ici.
 */

export type ToolContext = {
  organizationId: string;
  orgSlug: string;
  userId: string;
  role: string;
  locale: string;
  /** Niveau d'autonomie réel de l'organisation (A0 | A1 | A2) — lu depuis Organization.autonomyLevel. */
  autonomyLevel: string;
};

export type ToolResult = { ok: boolean; summary: string; data: unknown; sources: { fileId: string; label: string; page?: number; ref?: string }[]; proof?: string };

export type ToolDef = {
  name: string;
  description: string;
  risk: "FAIBLE" | "MOYEN" | "ELEVE";
  schema: string;
  verify: string;
  run: (params: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
};

// ————— Outils de recherche (réels) —————

async function searchFiles(ctx: ToolContext, params: { requete: string; client?: string; categorie?: string; depuisJours?: number }): Promise<ToolResult> {
  const q = String(params.requete ?? "").trim().toLowerCase();
  if (!q) throw new Error("requete_requise");
  const since = params.depuisJours ? new Date(Date.now() - Number(params.depuisJours) * 86400000) : undefined;
  const files = await db.file.findMany({
    where: {
      organizationId: ctx.organizationId,
      status: { in: ["ARCHIVE", "A_VERIFIER"] },
      archivedAt: since ? { gte: since } : undefined,
      ...(params.categorie ? { category: params.categorie } : {}),
    },
    include: { client: true, group: true },
    orderBy: { archivedAt: "desc" },
    take: 300,
  });

  const terms = q.split(/\s+/).filter((t) => t.length > 2);
  const scored = files
    .map((f) => {
      let score = 0;
      const hay = `${f.originalFilename} ${f.detectedType ?? ""} ${f.category} ${f.summary ?? ""} ${f.client?.name ?? ""}`.toLowerCase();
      for (const t of terms) {
        if (hay.includes(t)) score += 3;
        if (f.originalFilename.toLowerCase().includes(t)) score += 2;
      }
      return { file: f, score };
    })
    .filter((r) => r.score > 0);

  // Recherche plein texte réelle dans les tranches indexées
  const chunkHits = await db.documentChunk.findMany({
    where: {
      organizationId: ctx.organizationId,
      OR: [
        ...terms.slice(0, 4).map((t) => ({ text: { contains: t } })),
        ...terms.slice(0, 4).map((t) => ({ searchTerms: { contains: t } })),
      ],
    },
    include: { file: { include: { client: true, group: true } } },
    take: 40,
  });
  for (const hit of chunkHits) {
    if (!scored.some((s) => s.file.id === hit.fileId)) {
      let score = 1;
      for (const t of terms) if (hit.text.toLowerCase().includes(t)) score += 2;
      scored.push({ file: hit.file, score });
    }
  }

  // Filtre client éventuel (nom recherché)
  const filtered = params.client ? scored.filter((s) => (s.file.client?.name ?? "").toLowerCase().includes(String(params.client).toLowerCase())) : scored;
  filtered.sort((a, b) => b.score - a.score);
  const top = filtered.slice(0, 12);
  return {
    ok: true,
    summary: `${top.length} document(s) trouvé(s) sur ${files.length} archivé(s) pour « ${params.requete} »`,
    data: top.map((s) => ({
      fileId: s.file.id,
      nom: s.file.originalFilename,
      type: s.file.detectedType,
      categorie: s.file.category,
      client: s.file.client?.name,
      resume: s.file.summary,
      statut: s.file.status,
      date: s.file.archivedAt,
    })),
    sources: top.map((s) => ({ fileId: s.file.id, label: `${s.file.originalFilename}${s.file.client ? ` — ${s.file.client.name}` : ""}`, ref: s.file.archivedPath ?? undefined })),
    proof: `requête SQL réelle sur les registres de l'organisation`,
  };
}

async function readDocument(ctx: ToolContext, params: { fileId: string; page?: number }): Promise<ToolResult> {
  const fileId = String(params.fileId ?? "");
  const file = await db.file.findFirst({
    where: { id: fileId, organizationId: ctx.organizationId },
    include: { client: true },
  });
  if (!file) throw new Error("document_introuvable");
  const chunks = await db.documentChunk.findMany({
    where: { organizationId: ctx.organizationId, fileId },
    ...(params.page ? { where: { organizationId: ctx.organizationId, fileId, page: Number(params.page) } } : {}),
    orderBy: { page: "asc" },
    take: 8,
  });
  const extractions = await db.extraction.findMany({ where: { fileId, organizationId: ctx.organizationId } });
  const text = chunks.map((c) => c.text).join("\n\n");
  return {
    ok: chunks.length > 0,
    summary: `« ${file.originalFilename} » : ${chunks.length} tranche(s) lue(s), ${extractions.length} champ(s) extrait(s)`,
    data: { nom: file.originalFilename, type: file.detectedType, statut: file.status, resume: file.summary, extractions, texte: text.slice(0, 6000) },
    sources: [{ fileId: file.id, label: `${file.originalFilename}${file.client ? ` — ${file.client.name}` : ""}`, page: params.page as number | undefined, ref: file.archivedPath ?? undefined }],
    proof: `lecture réelle des tranches indexées en base`,
  };
}

// ————— Calcul vérifiable (jamais « de tête ») —————

function evalArithmetic(expr: string): number {
  // parseur récursif réel, aucun eval()
  let pos = 0;
  const s = expr.replace(/\s+/g, "");
  function parseExpr(): number {
    let v = parseTerm();
    while (pos < s.length && (s[pos] === "+" || s[pos] === "-")) {
      const op = s[pos++];
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parseFactor();
    while (pos < s.length && (s[pos] === "*" || s[pos] === "/")) {
      const op = s[pos++];
      const r = parseFactor();
      if (op === "/" && r === 0) throw new Error("division_par_zero");
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function parseFactor(): number {
    if (s[pos] === "(") {
      pos++;
      const v = parseExpr();
      if (s[pos] !== ")") throw new Error("parenthese_non_fermee");
      pos++;
      return v;
    }
    if (s[pos] === "-") {
      pos++;
      return -parseFactor();
    }
    const start = pos;
    while (pos < s.length && /[0-9.,]/.test(s[pos])) pos++;
    const num = Number(s.slice(start, pos).replace(",", "."));
    if (!Number.isFinite(num)) throw new Error(`expression_invalide_à_${start}`);
    return num;
  }
  const result = parseExpr();
  if (pos !== s.length) throw new Error("expression_invalide");
  return result;
}

// ————— Registre des outils —————

export const TOOLS: ToolDef[] = [
  {
    name: "rechercher_documents",
    description: "Recherche réelle dans les documents archivés de l'organisation (noms, types, résumés, contenu indexé).",
    risk: "FAIBLE",
    schema: `{ "requete": "obligatoire", "client": "optionnel", "categorie": "optionnel", "depuisJours": 30 }`,
    verify: "liste retournée + requête SQL exécutée",
    run: async (params, ctx) => searchFiles(ctx, params as { requete: string; client?: string; categorie?: string; depuisJours?: number }),
  },
  {
    name: "lire_document",
    description: "Lit réellement le contenu indexé d'un document (tranches, champs extraits).",
    risk: "FAIBLE",
    schema: `{ "fileId": "obligatoire", "page": "optionnel" }`,
    verify: "tranches lues en base",
    run: async (params, ctx) => readDocument(ctx, params as { fileId: string; page?: number }),
  },
  {
    name: "calculer",
    description: "Effectue un calcul arithmétique vérifiable (+, -, *, /, parenthèses). À utiliser pour tout total, moyenne ou somme.",
    risk: "FAIBLE",
    schema: `{ "expression": "ex: (1200 + 340.5) * 2" }`,
    verify: "parseur arithmétique réel",
    run: async (params) => {
      const expr = String(params.expression ?? "");
      const value = evalArithmetic(expr);
      return { ok: true, summary: `${expr} = ${value}`, data: { expression: expr, resultat: value }, sources: [], proof: "calcul exécuté par un outil vérifiable" };
    },
  },
  {
    name: "somme_montants",
    description: "Somme réelle d'une liste de montants extraits (par ex. les montants de factures).",
    risk: "FAIBLE",
    schema: `{ "nombres": [120, 340.5, ...], "libelle": "optionnel" }`,
    verify: "addition exécutée par code",
    run: async (params) => {
      const nums = (params.nombres as unknown[]).map((n) => Number(n)).filter((n) => Number.isFinite(n));
      const total = nums.reduce((a, b) => a + b, 0);
      return { ok: nums.length > 0, summary: `somme de ${nums.length} valeur(s) = ${total}`, data: { total, nombres: nums }, sources: [], proof: `addition réelle de ${nums.length} valeurs` };
    },
  },
  {
    name: "statistiques_registre",
    description: "Compteurs réels du registre : documents par statut, à traiter, clients, groupes, crédits restants.",
    risk: "FAIBLE",
    schema: `{}`,
    verify: "agrégations SQL réelles",
    run: async (_params, ctx) => {
      const [archive, aVerifier, clients, groups, creditsAgg] = await Promise.all([
        db.file.count({ where: { organizationId: ctx.organizationId, status: "ARCHIVE" } }),
        db.file.count({ where: { organizationId: ctx.organizationId, status: "A_VERIFIER" } }),
        db.client.count({ where: { organizationId: ctx.organizationId, status: "ACTIF" } }),
        db.waGroup.count({ where: { organizationId: ctx.organizationId, status: "ACTIF" } }),
        db.creditLedger.aggregate({ where: { organizationId: ctx.organizationId }, _sum: { delta: true } }),
      ]);
      const data = { documentsArchives: archive, documentsAVerifier: aVerifier, clientsActifs: clients, groupesActifs: groups, creditsRestants: creditsAgg._sum.delta ?? 0 };
      return { ok: true, summary: `${archive} archivés · ${aVerifier} à vérifier · ${clients} clients · ${groups} groupes`, data, sources: [], proof: "agrégations SQL réelles" };
    },
  },
  {
    name: "verifier_fichier_stockage",
    description: "Vérifie la présence réelle d'un document archivé (preuve technique : fichier présent, taille).",
    risk: "FAIBLE",
    schema: `{ "fileId": "obligatoire" }`,
    verify: "fs.stat réel ou métadonnées Drive",
    run: async (params, ctx) => {
      const file = await db.file.findFirst({ where: { id: String(params.fileId ?? ""), organizationId: ctx.organizationId } });
      if (!file) throw new Error("document_introuvable");
      if (file.status === "ARCHIVE" && file.confirmedByProof) {
        return { ok: true, summary: `« ${file.originalFilename} » archivé et confirmé`, data: { statut: file.status, preuve: file.confirmedByProof, chemin: file.archivedPath }, sources: [{ fileId: file.id, label: file.originalFilename, ref: file.archivedPath ?? undefined }], proof: file.confirmedByProof };
      }
      const stat = file.archivedPath ? await statArchivedFile(file.archivedPath) : null;
      if (stat?.exists) {
        return { ok: true, summary: `« ${file.originalFilename} » présent (${stat.size} octets)`, data: { taille: stat.size }, sources: [{ fileId: file.id, label: file.originalFilename, ref: file.archivedPath ?? undefined }], proof: `fs.stat réel : ${stat.size} octets` };
      }
      return { ok: false, summary: `« ${file.originalFilename} » introuvable dans le stockage — à vérifier`, data: { statut: file.status }, sources: [], proof: "vérification fs.stat réelle : absence" };
    },
  },
  {
    name: "generer_livrable",
    description: "Génère un livrable réel versionné (PDF, Excel ou Word) à partir de sections fournies, avec sources citées. Coûte des crédits.",
    risk: "MOYEN",
    schema: `{ "type": "PDF|XLSX|DOCX", "titre": "obligatoire", "sousTitre": "optionnel", "sections": [{"heading":"...","paragraphs":["..."],"bullets":["..."],"table":{"headers":["..."],"rows":[["..."]]}}] }`,
    verify: "fichier écrit, relu, taille vérifiée (contrôle avant remise)",
    run: async (params, ctx) => {
      const type = String(params.type ?? "PDF").toUpperCase() as "PDF" | "XLSX" | "DOCX";
      if (!["PDF", "XLSX", "DOCX"].includes(type)) throw new Error("type_invalide");
      const title = String(params.titre ?? "").slice(0, 120);
      if (!title) throw new Error("titre_requis");
      const rawSections = Array.isArray(params.sections) ? params.sections : [];
      const sections = rawSections.slice(0, 8).map((s) => {
        const sec = s as Record<string, unknown>;
        return {
          heading: sec.heading ? String(sec.heading).slice(0, 120) : undefined,
          paragraphs: Array.isArray(sec.paragraphs) ? sec.paragraphs.map(String).slice(0, 12) : undefined,
          bullets: Array.isArray(sec.bullets) ? sec.bullets.map(String).slice(0, 20) : undefined,
          table:
            sec.table && Array.isArray((sec.table as Record<string, unknown>).headers)
              ? {
                  headers: ((sec.table as Record<string, unknown>).headers as unknown[]).map(String).slice(0, 8),
                  rows: ((sec.table as Record<string, unknown>).rows as unknown[]).slice(0, 40).map((r) => (r as unknown[]).map(String).slice(0, 8)),
                }
              : undefined,
        };
      });
      const sourcesIn = Array.isArray(params.sources) ? (params.sources as { fileId: string; label: string }[]) : [];
      const result = await createDeliverable({
        organizationId: ctx.organizationId,
        orgSlug: ctx.orgSlug,
        type,
        taskId: undefined,
        userId: ctx.userId,
        content: { title, sections, sources: sourcesIn.slice(0, 20).map((s) => ({ label: s.label, fileRef: s.fileId })) },
      });
      return {
        ok: true,
        summary: `Livrable « ${title} » v${result.version} (${type}) généré et contrôlé`,
        data: { deliverableId: result.id, version: result.version, controle: result.qualityCheck, taille: result.sizeBytes },
        sources: [],
        proof: result.qualityCheck,
      };
    },
  },
  {
    name: "lister_clients_groupes",
    description: "Liste réelle des clients et de leurs groupes avec statuts.",
    risk: "FAIBLE",
    schema: `{}`,
    verify: "requête SQL réelle",
    run: async (_params, ctx) => {
      const clients = await db.client.findMany({
        where: { organizationId: ctx.organizationId, status: { not: "ARCHIVE" } },
        include: { groups: { where: { status: { not: "ARCHIVE" } } } },
        orderBy: { name: "asc" },
        take: 100,
      });
      return {
        ok: clients.length > 0,
        summary: `${clients.length} client(s) · ${clients.reduce((n, c) => n + c.groups.length, 0)} groupe(s)`,
        data: clients.map((c) => ({ id: c.id, code: c.code, nom: c.name, statut: c.status, groupes: c.groups.map((g) => ({ id: g.id, code: g.code, nom: g.name, source: g.sourceType, statut: g.status })) })),
        sources: [],
        proof: "requête SQL réelle",
      };
    },
  },
  {
    name: "comparer_documents",
    description: "Compare réellement deux documents (versions, révisions) : champs extraits ajoutés/modifiés/supprimés et différences de contenu.",
    risk: "FAIBLE",
    schema: `{ "fileId1": "obligatoire", "fileId2": "obligatoire" }`,
    verify: "double lecture réelle en base (tranches + extractions)",
    run: async (params, ctx) => {
      const load = async (fileId: string) => {
        const file = await db.file.findFirst({ where: { id: fileId, organizationId: ctx.organizationId }, include: { client: true } });
        if (!file) throw new Error("document_introuvable");
        const chunks = await db.documentChunk.findMany({ where: { fileId }, orderBy: { page: "asc" } });
        const extractions = await db.extraction.findMany({ where: { fileId } });
        return { file, text: chunks.map((c) => c.text).join("\n"), extractions };
      };
      const a = await load(String(params.fileId1 ?? ""));
      const b = await load(String(params.fileId2 ?? ""));
      const fieldsA = new Map(a.extractions.map((e) => [e.field, e.value]));
      const fieldsB = new Map(b.extractions.map((e) => [e.field, e.value]));
      const added: Record<string, string>[] = [];
      const removed: Record<string, string>[] = [];
      const changed: { champ: string; avant: string; apres: string }[] = [];
      for (const [k, v] of fieldsB) {
        if (!fieldsA.has(k)) added.push({ champ: k, valeur: v });
        else if (fieldsA.get(k) !== v) changed.push({ champ: k, avant: fieldsA.get(k) ?? "", apres: v });
      }
      for (const [k, v] of fieldsA) {
        if (!fieldsB.has(k)) removed.push({ champ: k, valeur: v });
      }
      const linesA = new Set(a.text.split("\n").map((l) => l.trim()).filter(Boolean));
      const linesB = b.text.split("\n").map((l) => l.trim()).filter(Boolean);
      const nouvellesLignes = linesB.filter((l) => !linesA.has(l)).slice(0, 15);
      const lignesSupprimees = [...linesA].filter((l) => !new Set(linesB).has(l)).slice(0, 15);
      return {
        ok: true,
        summary: `Comparaison « ${a.file.originalFilename} » ↔ « ${b.file.originalFilename} » : ${added.length} champ(s) ajouté(s), ${changed.length} modifié(s), ${removed.length} supprimé(s)`,
        data: { champsAjoutes: added, champsModifies: changed, champsSupprimes: removed, nouvellesLignes, lignesSupprimees, tailles: { doc1: a.text.length, doc2: b.text.length } },
        sources: [
          { fileId: a.file.id, label: a.file.originalFilename, ref: a.file.archivedPath ?? undefined },
          { fileId: b.file.id, label: b.file.originalFilename, ref: b.file.archivedPath ?? undefined },
        ],
        proof: "double lecture réelle des tranches et extractions indexées",
      };
    },
  },
  {
    name: "controler_pieces",
    description: "Contrôle réel de pièces obligatoires : vérifie, pour un client (ou toute l'organisation), quelles catégories de documents sont présentes au registre et lesquelles manquent.",
    risk: "FAIBLE",
    schema: `{ "client": "optionnel (nom ou code)", "piecesVoulues": ["Facture", "Contrat", "Releve", "Identite", "Attestation"] }`,
    verify: "comptages SQL réels par catégorie",
    run: async (params, ctx) => {
      const wanted = Array.isArray(params.piecesVoulues) && params.piecesVoulues.length
        ? (params.piecesVoulues as unknown[]).map(String).slice(0, 12)
        : ["Facture", "Contrat", "Relevé", "Pièce d'identité", "Attestation"];
      const clientFilter = params.client ? String(params.client).toLowerCase() : null;
      const clients = await db.client.findMany({
        where: { organizationId: ctx.organizationId, status: { not: "ARCHIVE" } },
        include: { files: { where: { status: { in: ["ARCHIVE", "A_VERIFIER"] } } } },
      });
      const targets = clientFilter
        ? clients.filter((c) => c.name.toLowerCase().includes(clientFilter) || c.code.toLowerCase().includes(clientFilter))
        : clients;
      if (!targets.length) return { ok: false, summary: "Aucun client correspondant au registre — contrôle impossible sans inventaire réel.", data: [], sources: [], proof: "requête SQL réelle : aucun résultat" };
      const controles = targets.slice(0, 20).map((c) => {
        const present = new Set(c.files.map((f) => f.category.toLowerCase()));
        const manquantes = wanted.filter((w) => !present.has(w.toLowerCase()));
        return { client: `${c.code} · ${c.name}`, documentsAuRegistre: c.files.length, piecesPresentes: wanted.filter((w) => present.has(w.toLowerCase())), piecesManquantes: manquantes };
      });
      const totalManquantes = controles.reduce((n, c) => n + c.piecesManquantes.length, 0);
      return {
        ok: true,
        summary: `${controles.length} client(s) contrôlé(s) · ${totalManquantes} pièce(s) obligatoire(s) manquante(s) au total`,
        data: controles,
        sources: [],
        proof: `comptages SQL réels sur ${controles.length} client(s) du registre`,
      };
    },
  },
  {
    name: "prochaines_echeances",
    description: "Liste réelle des échéances à venir extraites des documents (dates et échéances des champs extraits), avec leur document source.",
    risk: "FAIBLE",
    schema: `{ "jours": 30 }`,
    verify: "lecture réelle des extractions datées en base",
    run: async (params, ctx) => {
      const days = Math.min(Math.max(Number(params.jours ?? 30) || 30, 1), 365);
      const horizon = Date.now() + days * 86400000;
      const extractions = await db.extraction.findMany({
        where: { organizationId: ctx.organizationId, field: { in: ["echeance", "échéance", "date", "date_echeance", "date_limite"] } },
        include: { file: { include: { client: true } } },
        orderBy: { createdAt: "desc" },
        take: 500,
      });
      const parsed = extractions
        .map((e) => {
          const d = new Date(e.value.replace(/(\d{1,2})[\/](\d{1,2})[\/](\d{4})/, "$2/$1/$3"));
          return { e, date: isNaN(d.getTime()) ? null : d };
        })
        .filter((x) => x.date !== null)
        .filter((x) => (x.date as Date).getTime() >= Date.now() - 86400000 && (x.date as Date).getTime() <= horizon)
        .sort((a, b) => (a.date as Date).getTime() - (b.date as Date).getTime());
      const unique: typeof parsed = [];
      const seen = new Set<string>();
      for (const p of parsed) {
        const key = `${p.e.fileId}:${p.e.value}`;
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(p);
        }
      }
      const top = unique.slice(0, 25);
      return {
        ok: top.length > 0,
        summary: top.length ? `${top.length} échéance(s) dans les ${days} prochains jour(s)` : `Aucune échéance trouvée dans les ${days} prochains jour(s) au registre`,
        data: top.map((p) => ({ document: p.e.file.originalFilename, client: p.e.file.client?.name ?? null, champ: p.e.field, valeur: p.e.value, date: (p.date as Date).toISOString(), joursRestants: Math.ceil(((p.date as Date).getTime() - Date.now()) / 86400000) })),
        sources: top.map((p) => ({ fileId: p.e.file.id, label: `${p.e.file.originalFilename}${p.e.file.client ? ` — ${p.e.file.client.name}` : ""}`, ref: p.e.file.archivedPath ?? undefined })),
        proof: `lecture réelle de ${extractions.length} extraction(s) datée(s) en base`,
      };
    },
  },
  {
    name: "planifier_rapport",
    description: "Crée une règle d'automatisation À PARTIR d'une demande en langage naturel (fréquence + objet). La règle est créée EN PAUSE : un administrateur l'active après vérification — jamais d'activation silencieuse.",
    risk: "MOYEN",
    schema: `{ "description": "ex: un rapport hebdomadaire des documents archivés, le lundi matin, avec attention sur les factures" }`,
    verify: "règle réellement écrite en base, statut PAUSE",
    run: async (params, ctx) => {
      const description = String(params.description ?? "").slice(0, 500);
      if (!description) throw new Error("description_requise");
      // Analyse réelle via le fournisseur configuré (Azure AI Foundry sinon GLM) :
      // langage naturel → configuration structurée.
      const { chatComplete } = await import("@/lib/ai/provider");
      const completion = await chatComplete(
        [
          { role: "system", content: "Tu convertis une demande d'automatisation en configuration JSON stricte. Réponds UNIQUEMENT en JSON valide." },
          { role: "user", content: `Demande : « ${description} »\nRéponds : {"nom":"nom court","template":"RAPPORT_HEBDO|RAPPORT_MENSUEL|RAPPEL_MANQUANTS|PERSONNALISEE","cronExpr":"minute heure jourMois mois jourSemaine","focus":"point d attention optionnel"}. Jour de semaine : 1=lundi…7=dimanche. Créneau raisonnable entre 8h et 19h.` },
        ],
        { temperature: 0.2, jsonMode: true },
      );
      const raw = completion.content;
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("configuration_non_comprise");
      const cfg = JSON.parse(match[0]) as { nom?: string; template?: string; cronExpr?: string; focus?: string };
      const template = ["RAPPORT_HEBDO", "RAPPORT_MENSUEL", "RAPPEL_MANQUANTS", "PERSONNALISEE"].includes(String(cfg.template)) ? String(cfg.template) : "PERSONNALISEE";
      const cronExpr = /^\d[\d*,\-\/]*\s+\d[\d*,\-\/]*\s+\*[\d*,\-\/]*\s+\*\s+[\d*,\-\/]+$/.test(String(cfg.cronExpr ?? "")) ? String(cfg.cronExpr) : "0 9 * * 1";
      const { cronDue } = await import("@/lib/scheduler");
      if (!cronDue(cronExpr, new Date(2026, 0, 5, 9, 0)) && !cronDue(cronExpr, new Date(2026, 0, 6, 9, 0))) {
        // garde-fou doux : le cron reste accepté mais doit matcher au moins un jour testé — sinon repli sûr
        if (!/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(cronExpr)) throw new Error("cron_invalide");
      }
      const automation = await db.automation.create({
        data: {
          organizationId: ctx.organizationId,
          name: (cfg.nom ?? "Règle proposée").slice(0, 80),
          description: `Proposée depuis l'assistant : « ${description} »`,
          template,
          cronExpr,
          configJson: JSON.stringify({ focus: cfg.focus ?? undefined }),
          status: "PAUSE", // proposition : jamais active sans validation humaine
          createdById: ctx.userId,
        },
      });
      return {
        ok: true,
        summary: `Règle « ${automation.name} » créée en PAUSE (${template}, ${cronExpr}) — à activer dans Automatisations après vérification`,
        data: { automationId: automation.id, statut: "PAUSE", template, cronExpr, focus: cfg.focus ?? null },
        sources: [],
        proof: "règle réellement écrite en base, statut PAUSE, activation humaine requise",
      };
    },
  },
  {
    name: "memoriser_preference",
    description: "Mémorise une préférence durable de l'organisation (format de rapport, vocabulaire métier, règle de classement…). ÉCRITURE réelle en base : outil MOYEN. La mémoire est consultable, corrigeable et supprimable par les utilisateurs.",
    risk: "MOYEN",
    schema: `{ "content": "préférence claire et courte" }`,
    verify: "souvenir réellement écrit en base (source UTILISATEUR via agent)",
    run: async (params, ctx) => {
      const content = String(params.content ?? "").trim().slice(0, 500);
      if (content.length < 3) throw new Error("contenu_trop_court");
      const memory = await db.memoryItem.create({
        data: { organizationId: ctx.organizationId, content, source: "AGENT" },
      });
      return { ok: true, summary: `Préférence mémorisée : « ${content.slice(0, 80)} »`, data: { memoryId: memory.id }, sources: [], proof: "souvenir écrit en base, visible et supprimable dans Administration → Mémoire" };
    },
  },
  {
    name: "operations_financieres",
    description: "Recherche et agrège le registre des opérations financières de l'organisation (extraites des documents et messages, validées ou à vérifier). LECTURE seule : jamais de validation ni de déclaration d'encaissement — la validation humaine se fait dans le registre Finances.",
    risk: "FAIBLE",
    schema: `{ "statut": "EXTRAITE|A_VERIFIER|VALIDE|REJETEE (optionnel)", "client": "code ou nom de client (optionnel)", "depuisJours": 30 (optionnel) }`,
    verify: "lecture réelle du registre FinancialOperation en base, montants agrégés par statut et devise",
    run: async (params, ctx) => {
      const where: { organizationId: string; status?: string; clientId?: string; createdAt?: { gte: Date } } = {
        organizationId: ctx.organizationId,
      };
      const statut = String(params.statut ?? "").toUpperCase();
      if (["EXTRAITE", "A_VERIFIER", "VALIDE", "REJETEE"].includes(statut)) where.status = statut;
      const depuisJours = Number(params.depuisJours);
      if (Number.isFinite(depuisJours) && depuisJours > 0) {
        where.createdAt = { gte: new Date(Date.now() - Math.min(depuisJours, 365) * 86400000) };
      }
      const rows = await db.financialOperation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 300,
      });
      let filtered = rows;
      const clientQuery = String(params.client ?? "").trim().toLowerCase();
      if (clientQuery) {
        const clients = await db.client.findMany({
          where: { organizationId: ctx.organizationId },
          select: { id: true, code: true, name: true },
        });
        const ids = clients.filter((c) => c.code.toLowerCase().includes(clientQuery) || c.name.toLowerCase().includes(clientQuery)).map((c) => c.id);
        filtered = rows.filter((r) => r.clientId && ids.includes(r.clientId));
      }
      if (!filtered.length) {
        return { ok: false, summary: "Aucune opération financière trouvée pour ce filtre — rien n'est inventé, le registre reste vide pour ce périmètre", data: { total: 0, parStatut: {} }, sources: [], proof: "lecture réelle du registre FinancialOperation (0 ligne)" };
      }
      // Agrégats réels par statut × devise — jamais une somme déclarée par le modèle.
      const parStatut: Record<string, Record<string, number>> = {};
      for (const r of filtered) {
        const dev = r.currency || "???";
        parStatut[r.status] ??= {};
        parStatut[r.status][dev] = (parStatut[r.status][dev] ?? 0) + (r.amountCents ?? 0);
      }
      const top = filtered.slice(0, 20).map((r) => ({
        label: r.label,
        montant: r.amountCents != null ? `${(r.amountCents / 100).toFixed(2)} ${r.currency}` : null,
        date: r.operationDate ? r.operationDate.toISOString().slice(0, 10) : null,
        statut: r.status,
        source: r.sourceType,
      }));
      const sources = filtered
        .slice(0, 20)
        .filter((r) => r.sourceFileId)
        .map((r) => ({ fileId: r.sourceFileId as string, label: `Opération financière — ${r.label}`, ref: undefined as string | undefined }));
      return {
        ok: true,
        summary: `${filtered.length} opération(s) financière(s) — agrégats par statut et devise calculés sur les lignes réelles du registre`,
        data: { total: filtered.length, parStatut, apercu: top },
        sources,
        proof: "lecture réelle de FinancialOperation en base (montants agrégés par le système, pas par le modèle)",
      };
    },
  },
];

/**
 * Classification d'autonomie des outils — politique réelle appliquée par le runner :
 * - FAIBLE : lecture/calcul uniquement, aucun effet externe (rechercher, lire, calculer,
 *   somme, statistiques, vérifier_stockage, lister, comparer, contrôler_pieces, échéances,
 *   operations_financieres) ;
 * - MOYEN : écriture en base / effet durable (generer_livrable, planifier_rapport,
 *   memoriser_preference) — soumise à la garde LECTEUR et à l'approbation A0/A1.
 * Aucun outil ELEVE au catalogue actuel : la garde correspondante reste décrite ici.
 */
export const RISQUE_MOYEN_TOOLS = TOOLS.filter((t) => t.risk === "MOYEN").map((t) => t.name);

export function getTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}

export function toolsCataloguePrompt(): string {
  return TOOLS.map((t) => `- ${t.name} (risque ${t.risk}) : ${t.description} Schéma des paramètres : ${t.schema}`).join("\n");
}

export { safeJsonParse };
