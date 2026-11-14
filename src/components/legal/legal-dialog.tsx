"use client";

/**
 * Espace légal — contenu réel (À propos, CGU, Confidentialité).
 *
 * Décision d'architecture respectée : le produit vit sur « / » (SPA, voir
 * next.config.ts et DECISIONS.md) — les documents légaux sont donc rendus
 * in-app plutôt que via des routes séparées. Le contenu décrit le traitement
 * réel des données par les intégrations effectivement implémentées :
 * Google Document AI (OCR), Azure AI Foundry (IA générale), Google Drive du
 * client (stockage documentaire), Polar (abonnements), Resend (e-mails),
 * WhatsApp Business Cloud API (collecte), Neon PostgreSQL (production).
 */

import { useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type LegalDoc = "about" | "terms" | "privacy";

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="font-display text-[15px] font-semibold mt-5 first:mt-0">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-muted-foreground mt-2">{children}</p>;
}

function L({ children }: { children: React.ReactNode }) {
  return <li className="text-[13px] leading-relaxed text-muted-foreground mt-1.5 ml-4 list-disc">{children}</li>;
}

function AboutFr() {
  return (
    <>
      <H>À propos de HESYD ONE</H>
      <P>
        HESYD ONE est une plateforme SaaS d&apos;exploitation documentaire pour les professionnels
        qui reçoivent des documents via WhatsApp : réception et archivage avec preuve technique,
        lecture automatique des documents par Google Document AI, classement par client et par
        groupe, registre financier avec validation humaine obligatoire, agent documentaire sourcé,
        livrables (PDF, XLSX, DOCX) et automatisations.
      </P>
      <H>Nos principes</H>
      <ul>
        <L>Vos documents restent votre propriété : l&apos;archivage définitif s&apos;effectue dans votre propre Google Drive, jamais dans un espace détenu par la plateforme.</L>
        <L>Aucune donnée n&apos;est présentée comme vérifiée sans preuve : l&apos;archivage n&apos;est confirmé qu&apos;après contrôle technique réel, une opération financière n&apos;est « valide » qu&apos;après validation humaine.</L>
        <L>Les intégrations non configurées sont affichées comme telles — jamais simulées.</L>
        <L>Chaque action sensible (correction, validation, décision d&apos;approubation, geste opérateur) est journalisée.</L>
      </ul>
      <H>Contact</H>
      <P>contact@hesyd.com — pour toute question produit, contractuelle ou de confidentialité.</P>
    </>
  );
}

function AboutEn() {
  return (
    <>
      <H>About HESYD ONE</H>
      <P>
        HESYD ONE is a document-operations SaaS for professionals who receive documents over
        WhatsApp: reception and archiving with technical proof, automatic document reading via
        Google Document AI, client and group classification, a financial register with mandatory
        human validation, a sourced document agent, deliverables (PDF, XLSX, DOCX) and
        automations.
      </P>
      <H>Our principles</H>
      <ul>
        <L>Your documents remain your property: definitive archiving happens in your own Google Drive, never in platform-owned storage.</L>
        <L>Nothing is presented as verified without proof: archiving is confirmed only after a real technical check, a financial operation is &quot;valid&quot; only after human validation.</L>
        <L>Unconfigured integrations are displayed as such — never simulated.</L>
        <L>Every sensitive action (correction, validation, approval decision, operator gesture) is logged.</L>
      </ul>
      <H>Contact</H>
      <P>contact@hesyd.com — for any product, contractual or privacy question.</P>
    </>
  );
}

function TermsFr() {
  return (
    <>
      <H>Conditions générales d&apos;utilisation</H>
      <P>Dernière mise à jour : {new Date().toLocaleDateString("fr-FR")}. L&apos;utilisation de HESYD ONE implique l&apos;acceptation des présentes conditions.</P>
      <H>1. Le service</H>
      <P>
        HESYD ONE fournit un espace d&apos;exploitation documentaire multi-organisation : collecte
        de documents (dépôt web, WhatsApp si connecté), lecture automatique (Google Document AI),
        classement, registre financier, agent documentaire, livrables et automatisations. Les
        fonctionnalités accessibles dépendent de votre offre (essai, STANDARD, ENTREPRISE) et de
        l&apos;état réel de configuration des intégrations.
      </P>
      <H>2. Comptes et organisations</H>
      <P>
        Vous créez une organisation et invitez vos collaborateurs avec des rôles (propriétaire,
        administrateur, employé, lecteur). Vous êtes responsable de la gestion de vos membres et
        de l&apos;exactitude des données que vous saisissez. Un essai de 14 jours est fourni sans
        paiement ; à son terme, l&apos;espace est suspendu puis, après 30 jours supplémentaires,
        les registres documentaires sont purgés (vos comptes, journaux d&apos;audit et factures
        sont conservés comme preuve du traitement).
      </P>
      <H>3. Abonnement et paiement</H>
      <P>
        Les abonnements et les crédits sont gérés par notre prestataire de paiement Polar. Le
        renouvellement, l&apos;échec de paiement et la résiliation suivent les événements réels
        transmis par Polar. La résiliation est demandée depuis votre espace et prend effet après
        traitement ; une attestation vous est délivrée.
      </P>
      <H>4. Vos données et vos documents</H>
      <P>
        Vous restez propriétaire de vos documents. Lorsque votre Google Drive est connecté,
        l&apos;archivage définitif s&apos;effectue dans votre Drive avec confirmation par relecture
        ; sans Drive connecté, un archivage local technique (repli explicite) est conservé et il
        est clairement indiqué que l&apos;archivage définitif dans votre espace n&apos;est pas
        réalisé. Les traitements IA sont assistés : aucune opération financière n&apos;est jamais
        validée automatiquement.
      </P>
      <H>5. WhatsApp</H>
      <P>
        La collecte par WhatsApp s&apos;appuie sur WhatsApp Business Cloud API de Meta et requiert
        votre appairage explicite par code à usage unique. Les capacités dépendent des limites
        officielles de Meta ; ce que la plateforme ne peut pas recevoir n&apos;est pas annoncé.
      </P>
      <H>6. Utilisation acceptable</H>
      <P>
        Il est interdit d&apos;utiliser HESYD ONE pour des contenus illicites, de tenter
        d&apos;accéder aux espaces d&apos;autres organisations, de contourner les quotas ou de
        solliciter les services de manière abusive. Nous pouvons suspendre un espace en cas de
        violation, après information du propriétaire lorsque la loi le permet.
      </P>
      <H>7. Disponibilité et support</H>
      <P>
        Nous visons un service fiable ; les incidents sont communiqués dans l&apos;espace
        opérateur et par notification. Le support est joignable à contact@hesyd.com.
      </P>
      <H>8. Résiliation par vous</H>
      <P>Vous pouvez demander la résiliation et l&apos;export de vos données (CSV) à tout moment depuis l&apos;espace opérateur.</P>
      <H>9. Droit applicable</H>
      <P>Les présentes conditions sont soumises au droit applicable au siège de l&apos;exploitant ; tout litige sera traité en priorité par voie amiable.</P>
    </>
  );
}

function TermsEn() {
  return (
    <>
      <H>Terms of service</H>
      <P>Last updated: {new Date().toLocaleDateString("en-GB")}. Using HESYD ONE implies acceptance of these terms.</P>
      <H>1. The service</H>
      <P>
        HESYD ONE provides a multi-organization document-operations workspace: document collection
        (web upload, WhatsApp when connected), automatic reading (Google Document AI),
        classification, a financial register, a document agent, deliverables and automations.
        Available features depend on your plan (trial, STANDARD, ENTREPRISE) and on the actual
        configuration state of the integrations.
      </P>
      <H>2. Accounts and organizations</H>
      <P>
        You create an organization and invite collaborators with roles (owner, administrator,
        employee, reader). You are responsible for member management and for the accuracy of the
        data you enter. A 14-day trial is provided without payment; after it ends, the workspace
        is suspended and, 30 days later, document registers are purged (accounts, audit logs and
        invoices are kept as proof of processing).
      </P>
      <H>3. Subscription and payment</H>
      <P>
        Subscriptions and credits are managed by our payment provider Polar. Renewal, payment
        failure and cancellation follow real events transmitted by Polar. Cancellation is
        requested from your workspace and takes effect after processing; an attestation is issued
        to you.
      </P>
      <H>4. Your data and documents</H>
      <P>
        You remain the owner of your documents. When your Google Drive is connected, definitive
        archiving happens in your Drive with confirmation by re-reading; without a connected
        Drive, an explicit technical local fallback is kept and the application clearly states
        that definitive archiving in your own space has not been performed. AI processing is
        assistive: no financial operation is ever validated automatically.
      </P>
      <H>5. WhatsApp</H>
      <P>
        WhatsApp collection relies on Meta&apos;s WhatsApp Business Cloud API and requires your
        explicit pairing through a single-use code. Capabilities follow Meta&apos;s official
        limits; what the platform cannot receive is not advertised.
      </P>
      <H>6. Acceptable use</H>
      <P>
        You must not use HESYD ONE for unlawful content, attempt to access other organizations&apos;
        workspaces, circumvent quotas, or use the service abusively. We may suspend a workspace in
        case of violation, after informing the owner where the law permits.
      </P>
      <H>7. Availability and support</H>
      <P>
        We aim for a reliable service; incidents are communicated in the operator space and by
        notification. Support: contact@hesyd.com.
      </P>
      <H>8. Cancellation by you</H>
      <P>You can request cancellation and a CSV export of your data at any time from the operator space.</P>
      <H>9. Governing law</H>
      <P>These terms are governed by the law applicable to the operator&apos;s registered office; disputes are first addressed amicably.</P>
    </>
  );
}

function PrivacyFr() {
  return (
    <>
      <H>Politique de confidentialité</H>
      <P>
        Dernière mise à jour : {new Date().toLocaleDateString("fr-FR")}. Cette politique décrit
        les données réellement traitées par HESYD ONE et les prestataires impliqués.
      </P>
      <H>Données traitées</H>
      <ul>
        <L>Comptes : nom, e-mail, mot de passe (haché scrypt), préférences, statut MFA.</L>
        <L>Organisation : nom, paramètres, membres et rôles, progression d&apos;onboarding.</L>
        <L>Documents déposés et leurs métadonnées (nom, type détecté, statut, empreinte SHA-256, chemin d&apos;archivage).</L>
        <L>Événements WhatsApp reçus (expéditeur, horodatage, contenu du message) si la collecte est connectée et appairée.</L>
        <L>Opérations financières extraites ou saisies, avec historique des corrections et validations.</L>
        <L>Journal d&apos;audit des actions sensibles, registre de crédits et d&apos;usage.</L>
      </ul>
      <H>Prestataires (sous-traitants)</H>
      <ul>
        <L>Google Document AI — lecture automatique des documents (OCR/extraction). Les documents sont transmis à l&apos;API pour traitement et ne servent pas à l&apos;entraînement de modèles Google.</L>
        <L>Azure AI Foundry — traitements IA généraux sur le texte (classification, synthèse, agent). Aucune lecture OCR par ce canal.</L>
        <L>Google Drive — archivage définitif dans VOTRE propre Drive (OAuth dédié, jeton chiffré au repos, portée drive.file).</L>
        <L>Polar — abonnements et paiements ; nous recevons les événements d&apos;abonnement signés.</L>
        <L>Resend — envoi des e-mails transactionnels (vérification d&apos;adresse, invitations, réinitialisation, alertes d&apos;abonnement).</L>
        <L>Meta — WhatsApp Business Cloud API pour la réception et l&apos;envoi de messages appairés.</L>
        <L>Neon PostgreSQL — base de données de production hébergeant les registres.</L>
      </ul>
      <H>Conservation</H>
      <P>
        Les registres documentaires d&apos;une organisation expirée et non renouvelée sont purgés
        30 jours après l&apos;expiration. Les documents archivés dans votre Drive restent dans
        votre Drive (nous ne les supprimons pas). Les comptes, journaux d&apos;audit et factures
        sont conservés comme preuve du traitement. Vous pouvez demander un export (CSV) puis la
        résiliation à tout moment.
      </P>
      <H>Sécurité</H>
      <P>
        Sessions en base avec cookies httpOnly, mots de passe hachés (scrypt), MFA TOTP optionnel,
        jetons Drive chiffrés AES-256-GCM, webhooks signés et vérifiés avant tout traitement,
        limitation du débit sur les endpoints sensibles, journal d&apos;audit.
      </P>
      <H>Vos droits</H>
      <P>contact@hesyd.com — accès, rectification, export et suppression de vos données d&apos;organisation dans les conditions ci-dessus.</P>
    </>
  );
}

function PrivacyEn() {
  return (
    <>
      <H>Privacy policy</H>
      <P>
        Last updated: {new Date().toLocaleDateString("en-GB")}. This policy describes the data
        actually processed by HESYD ONE and the providers involved.
      </P>
      <H>Data processed</H>
      <ul>
        <L>Accounts: name, e-mail, password (scrypt-hashed), preferences, MFA status.</L>
        <L>Organization: name, settings, members and roles, onboarding progress.</L>
        <L>Uploaded documents and their metadata (name, detected type, status, SHA-256 fingerprint, archive path).</L>
        <L>WhatsApp events received (sender, timestamp, message content) when collection is connected and paired.</L>
        <L>Financial operations extracted or entered, with the full correction and validation history.</L>
        <L>Audit log of sensitive actions, credit and usage ledgers.</L>
      </ul>
      <H>Providers (sub-processors)</H>
      <ul>
        <L>Google Document AI — automatic document reading (OCR/extraction). Documents are sent to the API for processing and are not used to train Google models.</L>
        <L>Azure AI Foundry — general AI processing on text (classification, summaries, agent). No OCR through this channel.</L>
        <L>Google Drive — definitive archiving in YOUR own Drive (dedicated OAuth, token encrypted at rest, drive.file scope).</L>
        <L>Polar — subscriptions and payments; we receive signed subscription events.</L>
        <L>Resend — transactional e-mail delivery (address verification, invitations, password reset, subscription alerts).</L>
        <L>Meta — WhatsApp Business Cloud API for receiving and sending paired messages.</L>
        <L>Neon PostgreSQL — production database hosting the registers.</L>
      </ul>
      <H>Retention</H>
      <P>
        Document registers of an expired, unrenewed organization are purged 30 days after
        expiration. Documents archived in your Drive remain in your Drive (we do not delete
        them). Accounts, audit logs and invoices are kept as proof of processing. You can request
        a CSV export and then cancellation at any time.
      </P>
      <H>Security</H>
      <P>
        Database-backed sessions with httpOnly cookies, scrypt password hashing, optional TOTP
        MFA, Drive tokens encrypted with AES-256-GCM, signed webhooks verified before any
        processing, rate limiting on sensitive endpoints, audit log.
      </P>
      <H>Your rights</H>
      <P>contact@hesyd.com — access, rectification, export and deletion of your organization&apos;s data under the conditions above.</P>
    </>
  );
}

const TITLES: Record<LegalDoc, { fr: string; en: string }> = {
  about: { fr: "À propos de HESYD ONE", en: "About HESYD ONE" },
  terms: { fr: "Conditions générales d'utilisation", en: "Terms of service" },
  privacy: { fr: "Politique de confidentialité", en: "Privacy policy" },
};

export function LegalDialog({ doc, open, onOpenChange }: { doc: LegalDoc | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { lang } = useI18n();

  // Échap ferme le dialogue (comportement Radix natif) — ici on garantit aussi
  // que le scroll de fond est restauré, ce que Radix fait déjà.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <Dialog open={open && doc !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto max-w-[720px]"
        aria-describedby="legal-description"
      >
        <DialogHeader>
          <DialogTitle className="font-display">
            {doc ? TITLES[doc][lang] : ""}
          </DialogTitle>
          <DialogDescription id="legal-description" className="sr-only">
            {doc ? TITLES[doc][lang] : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {doc === "about" && (lang === "en" ? <AboutEn /> : <AboutFr />)}
          {doc === "terms" && (lang === "en" ? <TermsEn /> : <TermsFr />)}
          {doc === "privacy" && (lang === "en" ? <PrivacyEn /> : <PrivacyFr />)}
        </div>
      </DialogContent>
    </Dialog>
  );
}
