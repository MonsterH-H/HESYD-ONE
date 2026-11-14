"use client";

import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowLeft,
  CalendarClock,
  FileOutput,
  FileSearch,
  FolderTree,
  Inbox,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useI18n } from "@/lib/i18n";
import { Cachet } from "@/components/app/cachet";
import { HesydMark } from "@/components/app/hesyd-mark";
import { AuthView, InviteAcceptView } from "@/components/auth-view";
import { Button } from "@/components/ui/button";
import { LegalDialog, type LegalDoc } from "@/components/legal/legal-dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

type Mode = "landing" | "signup" | "login";

type ApiPlan = {
  code: string;
  name: string;
  priceMonthlyCents: number;
  currency: string;
  maxUsers: number;
  monthlyDocuments: number;
  monthlyCredits: number;
};

type Step = { num: string; titleKey: string; textKey: string };
type Plan = {
  nameKey: string;
  descKey: string | null;
  /** Code du plan réel (API /api/plans) — le prix n'est JAMAIS codé en dur. */
  planCode: string;
  periodKey: string;
  marked: boolean;
  primary: boolean;
};
type Feature = { num: string; icon: LucideIcon; titleKey: string; textKey: string };
type TrustItem = { num: string; titleKey: string; textKey: string };
type FaqItem = { qKey: string; aKey: string };

const STEPS: Step[] = [
  { num: "01", titleKey: "landing.step1.title", textKey: "landing.step1.text" },
  { num: "02", titleKey: "landing.step2.title", textKey: "landing.step2.text" },
  { num: "03", titleKey: "landing.step3.title", textKey: "landing.step3.text" },
  { num: "04", titleKey: "landing.step4.title", textKey: "landing.step4.text" },
];

const FEATURES: Feature[] = [
  { num: "01", icon: Inbox, titleKey: "landing.features.1.title", textKey: "landing.features.1.text" },
  { num: "02", icon: FolderTree, titleKey: "landing.features.2.title", textKey: "landing.features.2.text" },
  { num: "03", icon: FileSearch, titleKey: "landing.features.3.title", textKey: "landing.features.3.text" },
  { num: "04", icon: MessageCircle, titleKey: "landing.features.4.title", textKey: "landing.features.4.text" },
  { num: "05", icon: FileOutput, titleKey: "landing.features.5.title", textKey: "landing.features.5.text" },
  { num: "06", icon: CalendarClock, titleKey: "landing.features.6.title", textKey: "landing.features.6.text" },
];

const TRUST: TrustItem[] = [
  { num: "01", titleKey: "landing.trust.1.title", textKey: "landing.trust.1.text" },
  { num: "02", titleKey: "landing.trust.2.title", textKey: "landing.trust.2.text" },
  { num: "03", titleKey: "landing.trust.3.title", textKey: "landing.trust.3.text" },
  { num: "04", titleKey: "landing.trust.4.title", textKey: "landing.trust.4.text" },
];

const FAQ: FaqItem[] = [1, 2, 3, 4, 5].map((n) => ({
  qKey: `landing.faq.${n}.q`,
  aKey: `landing.faq.${n}.a`,
}));

const PROOF_KEYS = ["landing.proof.speed", "landing.proof.card", "landing.proof.audit"] as const;

const PLANS: Plan[] = [
  {
    nameKey: "landing.pricing.trial",
    descKey: "landing.pricing.trial.desc",
    planCode: "TRIAL",
    periodKey: "landing.pricing.perTrial",
    marked: false,
    primary: true,
  },
  {
    nameKey: "landing.pricing.standard",
    descKey: "landing.pricing.standard.desc",
    planCode: "STANDARD",
    periodKey: "landing.pricing.perMonth",
    marked: true,
    primary: false,
  },
  {
    nameKey: "landing.pricing.enterprise",
    descKey: "landing.pricing.enterprise.desc",
    planCode: "ENTREPRISE",
    periodKey: "landing.pricing.perMonth",
    marked: false,
    primary: false,
  },
];

const LANGS: Array<"fr" | "en"> = ["fr", "en"];

const hairline: CSSProperties = { borderColor: "var(--bordure)" };
const primaryBtn =
  "h-11 px-5 bg-cachet text-primary-foreground hover:bg-cachet/90";
const outlineBtn = "h-11 px-5 border-bordure-forte";

/** Révélation au défilement — sobre (opacité + 10 px), une seule fois, désactivée si mouvement réduit.
 *  Garantie de robustesse : un minuteur force l'affichage après ~1,2 s même si l'observateur
 *  d'intersection n'a pas déclenché (impression, robots, exemples de rendu complet). */
function Reveal({
  children,
  className,
  delay = 0,
  style,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  style?: CSSProperties;
}) {
  const reduced = useReducedMotion();
  const [forced, setForced] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setForced(true), 1200 + delay * 1000);
    return () => window.clearTimeout(id);
  }, [delay]);

  if (reduced) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      animate={forced ? { opacity: 1, y: 0 } : undefined}
      viewport={{ once: true, margin: "-48px" }}
      transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

/** En-tête de section numéroté — registre éditorial, point de registre « · » implicite par l'index. */
function SectionHead({ index, titleKey, subtitleKey }: { index: string; titleKey: string; subtitleKey?: string }) {
  const { t } = useI18n();
  return (
    <Reveal>
      <div className="flex items-baseline gap-4">
        <span className="font-display tnum text-corps leading-none text-encre-3" aria-hidden="true">
          {index}
        </span>
        <h2 className="font-display text-titre leading-tight">{t(titleKey)}</h2>
      </div>
      {subtitleKey ? (
        <p className="mt-3 text-corps leading-[1.65] text-encre-2 max-w-[58ch]">{t(subtitleKey)}</p>
      ) : null}
    </Reveal>
  );
}

/** Sélecteur de langue — boutons 44 px, aria-pressed, persistance via le store existant. */
function LanguageSwitch() {
  const { t, lang, setLang } = useI18n();
  return (
    <div className="flex items-center rounded-md border overflow-hidden" style={hairline} role="group" aria-label={t("common.language")}>
      {LANGS.map((code, i) => (
        <Fragment key={code}>
          {i > 0 && <span aria-hidden="true" className="h-4 w-px" style={{ backgroundColor: "var(--bordure)" }} />}
          <button
            type="button"
            onClick={() => setLang(code)}
            aria-pressed={lang === code}
            aria-label={code === "fr" ? `${t("common.language")} : Français` : `${t("common.language")}: English`}
            className={`h-11 min-w-11 px-2.5 text-[12.5px] font-medium tracking-wide transition-colors duration-150 ${
              lang === code ? "text-encre" : "text-encre-3 hover:text-encre-2"
            }`}
          >
            {code.toUpperCase()}
          </button>
        </Fragment>
      ))}
    </div>
  );
}

/** Page publique — thème clair « papier », registre éditorial, une seule signature visuelle : le cachet. */
export default function Landing() {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<Mode>("landing");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  // Prix RÉELS des plans actifs, chargés depuis l'API publique — en cas d'échec,
  // affichage « Tarifs sur demande » : aucune valeur inventée, aucun prix en dur.
  const [plansApi, setPlansApi] = useState<ApiPlan[] | null>(null);
  // Documents légaux réels (À propos / CGU / Confidentialité) rendus in-app —
  // les trois liens « href="#" » inertes du footer sont supprimés (audit UI P2).
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null);

  useEffect(() => {
    let vivant = true;
    fetch("/api/plans", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("plans_indisponibles"))))
      .then((d: { plans?: ApiPlan[] }) => {
        if (vivant && Array.isArray(d.plans)) setPlansApi(d.plans);
      })
      .catch(() => {
        if (vivant) setPlansApi(null);
      });
    return () => {
      vivant = false;
    };
  }, []);

  /** Prix affiché : celui du plan réel si connu, sinon « Tarifs sur demande ». */
  const prixAffiche = (p: Plan): string => {
    const plan = plansApi?.find((x) => x.code === p.planCode);
    if (!plan) return t("landing.pricing.onRequest");
    return new Intl.NumberFormat(lang === "en" ? "en-IE" : "fr-FR", {
      style: "currency",
      currency: plan.currency,
      maximumFractionDigits: 0,
    }).format(plan.priceMonthlyCents / 100);
  };

  // Invitation par lien : ?invite=<token> bascule sur l'écran d'acceptation réel
  // (setState différé d'un micro-tick — évite le rendu en cascade flaggé par react-hooks)
  useEffect(() => {
    const id = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const token = params.get("invite");
      if (token) {
        params.delete("invite");
        const rest = params.toString();
        window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
        setInviteToken(token);
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  if (inviteToken) {
    return (
      <div className="min-h-screen flex flex-col bg-background text-foreground">
        <header className="border-b" style={hairline}>
          <div className="mx-auto w-full max-w-6xl px-6 md:px-10 h-14 flex items-center gap-2">
            <HesydMark className="h-7 w-7" />
            <span className="font-display text-corps font-semibold ml-2.5">HESYD ONE</span>
          </div>
        </header>
        <main className="flex-1 grid place-items-center px-6 py-14">
          <InviteAcceptView token={inviteToken} />
        </main>
      </div>
    );
  }

  if (mode !== "landing") {
    return (
      <div className="min-h-screen flex flex-col bg-background text-foreground">
        <header className="border-b" style={hairline}>
          <div className="mx-auto w-full max-w-6xl px-6 md:px-10 h-14 flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMode("landing")}
              aria-label={t("common.back")}
              className="size-10"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Button>
            <HesydMark className="h-7 w-7 ml-1" />
            <span className="font-display text-corps font-semibold ml-1">HESYD ONE</span>
          </div>
        </header>
        <main className="flex-1 grid place-items-center px-6 py-14">
          <AuthView mode={mode} onSwitch={(next) => setMode(next)} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* En-tête — mot-sceau, langue, connexion, essai. Un seul bouton primaire dans cette zone. */}
      <header className="sticky top-0 z-40 border-b bg-background" style={hairline}>
        <div className="mx-auto w-full max-w-6xl px-6 md:px-10 h-14 flex items-center gap-2 md:gap-3">
          <HesydMark className="h-7 w-7" />
          <span className="font-display text-corps font-semibold ml-2 mr-auto">HESYD ONE</span>
          <LanguageSwitch />
          <Button
            variant="ghost"
            onClick={() => setMode("login")}
            className="h-11 px-3 md:px-4 text-[13.5px] text-encre-2 hover:text-encre"
          >
            {t("landing.cta.secondary")}
          </Button>
          <Button onClick={() => setMode("signup")} className={`${primaryBtn} hidden sm:inline-flex`}>
            {t("landing.header.trial")}
          </Button>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero — asymétrique : colonne texte ~2/3, cachet à droite, ligne de preuve sous les CTA */}
        <section className="px-6 md:px-10 pt-14 md:pt-24 pb-16 md:pb-24">
          <div className="mx-auto w-full max-w-6xl grid gap-14 md:grid-cols-[minmax(0,1fr)_auto] md:gap-20 items-start">
            <div className="max-w-[38rem]">
              <Reveal>
                <span
                  className="inline-flex items-center h-7 px-3 border rounded-full text-[11px] font-medium uppercase tracking-[0.14em] text-encre-2"
                  style={{ borderColor: "var(--bordure-forte)", backgroundColor: "var(--papier-leve)" }}
                >
                  {t("landing.badge")}
                </span>
                <h1 className="font-display text-page md:text-hero leading-[1.16] mt-7">
                  {t("landing.title")}
                </h1>
              </Reveal>
              <Reveal delay={0.1}>
                <p className="mt-6 text-corps leading-[1.65] text-encre-2 max-w-[62ch]">
                  {t("landing.subtitle")}
                </p>
                <div className="mt-9 flex flex-col sm:flex-row gap-3">
                  <Button onClick={() => setMode("signup")} className={primaryBtn}>
                    {t("landing.cta.primary")}
                  </Button>
                  <Button variant="outline" onClick={() => setMode("login")} className={outlineBtn}>
                    {t("landing.cta.secondary")}
                  </Button>
                </div>
                {/* Ligne de preuve : trois faits tabulaires séparés par filets fins */}
                <ul className="mt-10 flex flex-wrap items-center">
                  {PROOF_KEYS.map((key, i) => (
                    <li
                      key={key}
                      className={`tnum text-[13.5px] leading-snug text-encre-2 ${
                        i > 0 ? "border-l pl-5 ml-5" : ""
                      }`}
                      style={i > 0 ? hairline : undefined}
                    >
                      {t(key)}
                    </li>
                  ))}
                </ul>
              </Reveal>
            </div>

            {/* Signature : le sceau de cire réel, légèrement incliné, avec sa légende */}
            <div className="justify-self-center md:justify-self-end md:pr-2 md:pt-4 flex flex-col items-center gap-5 rotate-[-2deg]">
              <img
                src="/logo-seal.png"
                alt=""
                aria-hidden="true"
                width={188}
                height={188}
                className="size-[150px] md:size-[188px] rounded-full object-cover shadow-[0_2px_6px_rgba(28,25,23,0.16),0_18px_36px_-12px_rgba(159,45,45,0.38)] select-none"
                draggable={false}
              />
              <p className="text-[12.5px] leading-snug text-encre-3 max-w-[24ch] text-center">
                {t("landing.stamp.caption")}
              </p>
            </div>
          </div>
        </section>

        {/* Ce que fait HESYD ONE — registre numéroté de six capacités réelles, icône fine à droite */}
        <section id="fonctionnalites" className="border-t px-6 md:px-10 py-14 md:py-20 scroll-mt-20" style={hairline}>
          <div className="mx-auto w-full max-w-6xl">
            <SectionHead index="01" titleKey="landing.features.title" subtitleKey="landing.features.subtitle" />
            <ol className="mt-10 md:mt-12">
              {FEATURES.map((f) => (
                <li key={f.num} className="border-t last:border-b py-7 md:py-8" style={hairline}>
                  <Reveal>
                    <div className="flex items-start gap-5 md:gap-8">
                      <span className="font-display tnum text-section md:text-titre leading-none text-encre-3 shrink-0 w-10 md:w-12 pt-0.5">
                        {f.num}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-display text-section">{t(f.titleKey)}</h3>
                        <p className="mt-2.5 text-corps leading-[1.65] text-encre-2 max-w-[56ch]">
                          {t(f.textKey)}
                        </p>
                      </div>
                      <span
                        aria-hidden="true"
                        className="flex size-10 shrink-0 items-center justify-center border rounded-[4px]"
                        style={{ borderColor: "var(--bordure-forte)", backgroundColor: "var(--papier-leve)" }}
                      >
                        <f.icon className="size-5 text-encre-2" strokeWidth={1.5} />
                      </span>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Comment ça marche — liste éditoriale dense, numéros font-display tnum, alternance d'indentation */}
        <section id="parcours" className="border-t px-6 md:px-10 py-14 md:py-20 scroll-mt-20" style={hairline}>
          <div className="mx-auto w-full max-w-6xl">
            <SectionHead index="02" titleKey="landing.how.title" />
            <ol className="mt-10">
              {STEPS.map((s, i) => (
                <li
                  key={s.num}
                  className={`border-t py-8 md:py-9 last:border-b ${i % 2 === 1 ? "md:ml-[14%]" : ""}`}
                  style={hairline}
                >
                  <Reveal>
                    <div className="flex items-baseline gap-6 md:gap-10">
                      <span className="font-display tnum text-titre md:text-page leading-none text-encre-3 shrink-0 w-12">
                        {s.num}
                      </span>
                      <div>
                        <h3 className="font-display text-section">{t(s.titleKey)}</h3>
                        <p className="mt-2.5 text-corps leading-[1.65] text-encre-2 max-w-[56ch]">
                          {t(s.textKey)}
                        </p>
                      </div>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* La confiance se prouve — quatre engagements concrets, grille 2x2 à filets fins, cachet statique */}
        <section id="confiance" className="border-t px-6 md:px-10 py-14 md:py-20 scroll-mt-20" style={hairline}>
          <div className="mx-auto w-full max-w-6xl">
            <div className="md:flex md:items-end md:justify-between md:gap-16">
              <SectionHead index="03" titleKey="landing.trust.title" subtitleKey="landing.trust.subtitle" />
              <div className="hidden md:block shrink-0 rotate-[-3deg] mr-2" aria-hidden="true">
                <Cachet size={76} label="PROUVÉ" />
              </div>
            </div>
            <Reveal className="mt-10 md:mt-12">
              <ul
                className="grid sm:grid-cols-2 gap-px border"
                style={{ ...hairline, backgroundColor: "var(--bordure)" }}
              >
                {TRUST.map((item) => (
                  <li key={item.num} className="p-6 md:p-8" style={{ backgroundColor: "var(--papier-leve)" }}>
                    <p className="tnum text-[12px] font-medium uppercase tracking-[0.14em] text-encre-3">
                      {item.num}
                    </p>
                    <h3 className="font-display text-section mt-3">{t(item.titleKey)}</h3>
                    <p className="mt-2.5 text-corps leading-[1.65] text-encre-2 max-w-[52ch]">
                      {t(item.textKey)}
                    </p>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>

        {/* Offres — lignes séparées par filets fins, chiffres tabulaires, Standard marqué par une bordure cachet */}
        <section id="tarifs" className="border-t px-6 md:px-10 py-14 md:py-20 scroll-mt-20" style={hairline}>
          <div className="mx-auto w-full max-w-6xl">
            <SectionHead index="04" titleKey="landing.pricing.title" />
            <div className="mt-10">
              {PLANS.map((p, i) => (
                <Reveal key={p.nameKey}>
                  <div
                    className={`grid grid-cols-1 gap-x-10 gap-y-3 py-7 md:py-8 border-t px-4 -mx-4 md:grid-cols-[minmax(0,9rem)_auto_auto] md:items-center ${
                      i === PLANS.length - 1 ? "border-b" : ""
                    }`}
                    style={{
                      ...hairline,
                      borderLeft: p.marked ? "2px solid var(--cachet)" : "2px solid transparent",
                    }}
                  >
                    <div>
                      <h3 className={`font-display text-section ${p.marked ? "text-cachet" : ""}`}>
                        {t(p.nameKey)}
                      </h3>
                      {p.descKey ? (
                        <p className="text-[13.5px] text-encre-2 mt-1 md:mt-0.5 max-w-[44ch]">
                          {t(p.descKey)}
                        </p>
                      ) : null}
                    </div>
                    <p className="whitespace-nowrap md:justify-self-end">
                      <span className="font-display tnum text-titre">{prixAffiche(p)}</span>{" "}
                      <span className="text-[13px] text-encre-3">{plansApi?.some((x) => x.code === p.planCode) ? t(p.periodKey) : ""}</span>
                    </p>
                    <div className="md:justify-self-end">
                      <Button
                        onClick={() => setMode("signup")}
                        variant={p.primary ? "default" : "outline"}
                        className={`h-11 px-5 w-full sm:w-auto ${
                          p.primary
                            ? "bg-cachet text-primary-foreground hover:bg-cachet/90"
                            : "border-bordure-forte"
                        }`}
                      >
                        {t("landing.pricing.cta")}
                      </Button>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Questions fréquentes — accordéon sobre, réponses honnêtes et précises */}
        <section id="faq" className="border-t px-6 md:px-10 py-14 md:py-20 scroll-mt-20" style={hairline}>
          <div className="mx-auto w-full max-w-6xl">
            <SectionHead index="05" titleKey="landing.faq.title" />
            <Reveal className="mt-8 md:mt-10">
              <Accordion type="single" collapsible className="w-full">
                {FAQ.map((item, i) => (
                  <AccordionItem key={item.qKey} value={`faq-${i + 1}`} className="border-t border-b-0 last:border-b" style={hairline}>
                    <AccordionTrigger className="min-h-11 py-5 gap-6 text-left font-display text-corps font-normal no-underline hover:no-underline hover:text-encre [&[data-state=open]>svg]:text-cachet">
                      {t(item.qKey)}
                    </AccordionTrigger>
                    <AccordionContent className="text-corps leading-[1.7] text-encre-2 max-w-[62ch] pb-5">
                      {t(item.aKey)}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </Reveal>
          </div>
        </section>

        {/* Dernière bande — encadré à filet fin, ligne display, un primaire + un secondaire */}
        <section className="border-t px-6 md:px-10 py-14 md:py-20" style={hairline}>
          <div className="mx-auto w-full max-w-6xl">
            <Reveal>
              <div
                className="border p-8 md:p-14 bg-papier-leve flex flex-col md:flex-row md:items-center md:justify-between gap-8"
                style={hairline}
              >
                <div className="max-w-[44ch]">
                  <h2 className="font-display text-titre md:text-page leading-[1.2]">{t("landing.final.title")}</h2>
                  <p className="mt-4 text-corps leading-[1.65] text-encre-2">{t("landing.final.text")}</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 shrink-0">
                  <Button onClick={() => setMode("signup")} className={primaryBtn}>
                    {t("landing.cta.primary")}
                  </Button>
                  <Button variant="outline" onClick={() => setMode("login")} className={outlineBtn}>
                    {t("landing.cta.secondary")}
                  </Button>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      {/* Pied de page riche — quatre colonnes éditoriales + ligne de droits, collé en bas (root flex-col + mt-auto) */}
      <footer className="mt-auto border-t px-6 md:px-10 py-12 md:py-14" style={hairline}>
        <div className="mx-auto w-full max-w-6xl">
          <div className="grid gap-10 md:grid-cols-[minmax(0,1.4fr)_1fr_1fr_1fr_auto]">
            <div>
              <div className="flex items-center">
                <HesydMark className="h-7 w-7" />
                <span className="font-display text-corps font-semibold ml-2.5">HESYD ONE</span>
              </div>
              <p className="mt-4 text-[13.5px] text-encre-2 max-w-[36ch]">{t("landing.footer.line1")}</p>
              <p className="mt-2 text-[13px] leading-[1.6] text-encre-3 max-w-[40ch]">{t("landing.footer.line2")}</p>
            </div>
            <nav aria-label={t("landing.footer.product")}>
              <h3 className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-encre-3">
                {t("landing.footer.product")}
              </h3>
              <ul className="mt-2">
                <li>
                  <a
                    href="#fonctionnalites"
                    className="flex items-center min-h-11 text-[13.5px] text-encre-2 hover:text-encre transition-colors duration-150"
                  >
                    {t("landing.footer.features")}
                  </a>
                </li>
                <li>
                  <a
                    href="#tarifs"
                    className="flex items-center min-h-11 text-[13.5px] text-encre-2 hover:text-encre transition-colors duration-150"
                  >
                    {t("landing.footer.pricing")}
                  </a>
                </li>
                <li>
                  <a
                    href="#faq"
                    className="flex items-center min-h-11 text-[13.5px] text-encre-2 hover:text-encre transition-colors duration-150"
                  >
                    {t("landing.footer.faq")}
                  </a>
                </li>
              </ul>
            </nav>
            <div>
              <h3 className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-encre-3">
                {t("landing.footer.company")}
              </h3>
              <ul className="mt-2">
                <li>
                  <button
                    type="button"
                    onClick={() => setLegalDoc("about")}
                    className="flex items-center min-h-11 text-left text-[13.5px] text-encre-2 hover:text-encre transition-colors duration-150"
                  >
                    {t("landing.footer.about")}
                  </button>
                </li>
                <li>
                  <a
                    href="mailto:contact@hesyd.com"
                    className="flex items-center min-h-11 text-[13.5px] text-encre-2 hover:text-encre transition-colors duration-150"
                  >
                    {t("landing.footer.contact")}
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-encre-3">
                {t("landing.footer.legal")}
              </h3>
              <ul className="mt-2">
                <li>
                  <button
                    type="button"
                    onClick={() => setLegalDoc("terms")}
                    className="flex items-center min-h-11 text-left text-[13.5px] text-encre-2 hover:text-encre transition-colors duration-150"
                  >
                    {t("landing.footer.terms")}
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => setLegalDoc("privacy")}
                    className="flex items-center min-h-11 text-left text-[13.5px] text-encre-2 hover:text-encre transition-colors duration-150"
                  >
                    {t("landing.footer.privacy")}
                  </button>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-encre-3">
                {t("common.language")}
              </h3>
              <div className="mt-2">
                <LanguageSwitch />
              </div>
            </div>
          </div>
          <div className="mt-12 pt-6 border-t flex flex-wrap items-center justify-between gap-x-8 gap-y-2" style={hairline}>
            <p className="tnum text-[13px] text-encre-2">{t("landing.footer.rights")}</p>
            <p className="text-[13px] text-encre-3">{t("landing.footer.tagline")}</p>
          </div>
        </div>
      </footer>
      {/* Documents légaux réels — À propos, CGU, Confidentialité */}
      <LegalDialog doc={legalDoc} open={legalDoc !== null} onOpenChange={(v) => setLegalDoc(v ? legalDoc : null)} />
    </div>
  );
}

export { Landing };
