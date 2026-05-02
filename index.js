const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);
const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

// ============================================================
// CONSTANTES
// ============================================================
const SALAIRE_LGM_DEFAULT = 2500;
const BEAU_FRERE = 320;
const OBJECTIF_COMPLETUDE = 1500;
const EPARGNE_DEPART = 9000;

const CHARGES_FIXES = {
  'Loyer': 832.46, 'Tontine 1': 500, 'Tontine 2': 500,
  'Virement mère': 150, 'Place parking': 50, 'Malakoff mutuelle': 57.03,
  'ENI énergie': 39.40, 'Bouygues mobile': 17.99, 'Bouygues box': 24,
  'Basic Fit': 22.99, 'Assurance habitation': 8.46, 'Assurance auto': 64.24,
  'Salle sport femme': 44, 'Canal+ frère': 13, 'Cours arabe': 31,
  'Claude.ai': 21.60, 'Helloasso': 12.55, 'Stripe asso': 10,
  'Disney+': 6.99, 'Crunchyroll': 8.99, 'Cotisation bancaire': 18.30,
};
const TOTAL_CHARGES_FIXES = Object.values(CHARGES_FIXES).reduce((a, b) => a + b, 0);

const BUDGETS = {
  essence:  { label: '⛽ Essence',  max: 300 },
  courses:  { label: '🛒 Courses',  max: 650 },
  restos:   { label: '🍽️ Restos',   max: 80  },
  sante:    { label: '🏥 Santé',    max: 60  },
  maison:   { label: '🏠 Maison',   max: 50  },
  voiture:  { label: '🚗 Voiture',  max: 50  },
  shopping: { label: '👗 Shopping', max: 50  },
  loisirs:  { label: '🎉 Loisirs',  max: 50  },
  divers:   { label: '📦 Divers',   max: 50  },
};
const TOTAL_BUDGETS_MAX = Object.values(BUDGETS).reduce((a, b) => a + b.max, 0);

const OBJECTIFS = [
  { label: 'Fin juin 2026', montant: 12500 },
  { label: 'Fin août 2026', montant: 15000 },
  { label: 'Janvier 2027',  montant: 20000 },
];

const ELEVES = {
  'Amel':        { niveau: '5e',  taux: 21.04, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 1, heure: 17, minute: 0  },
  'Benjamin':    { niveau: '5e',  taux: 24.30, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 2, heure: 18, minute: 0  },
  'Guillaume':   { niveau: '5e',  taux: 23.88, duree: 1.5, tda: true,  ficheHebdo: false, question2h: true,  fiche: true,  jour: 3, heure: 17, minute: 30 },
  'Margaux':     { niveau: '3e',  taux: 26.60, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 4, heure: 16, minute: 0  },
  'Nélia':       { niveau: '3e',  taux: 26.60, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 4, heure: 17, minute: 30 },
  'Hélène':      { niveau: '5e',  taux: 24.30, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 6, heure: 8,  minute: 0  },
  'Noélie':      { niveau: 'CE2', taux: 25.78, duree: 1.0, tda: false, ficheHebdo: false, question2h: false, fiche: false, jour: 6, heure: 10, minute: 0  },
  'Mathéo':      { niveau: '3e',  taux: 23.66, duree: 1.5, tda: false, ficheHebdo: true,  question2h: true,  fiche: true,  jour: 6, heure: 11, minute: 30 },
  'Anne-Gaëlle': { niveau: '3e',  taux: 24.08, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 6, heure: 13, minute: 0  },
  'Saïda':       { niveau: '5e',  taux: 25.56, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 6, heure: 15, minute: 0  },
  'Serena':      { niveau: '5e',  taux: 23.04, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 0, heure: 13, minute: 0, uneSemaineSurDeux: true },
};

let etatConversation = null;

// ============================================================
// HELPERS
// ============================================================

// FIX 3 : Progression avec emojis (compatible tous téléphones)
function barreProgression(valeur, max) {
  const pct = Math.min(100, Math.round((valeur / max) * 100));
  const emoji = pct >= 100 ? '✅' : pct >= 75 ? '🟢' : pct >= 50 ? '🟡' : '🔴';
  return `${emoji} ${pct}% (${Math.round(valeur)}€ / ${max.toLocaleString()}€)`;
}

// Découpage messages longs Telegram (limite 4096 chars)
async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const MAX = 3800;
  if (text.length <= MAX) {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
    return;
  }
  const parties = [];
  let reste = text;
  while (reste.length > MAX) {
    let coupe = reste.lastIndexOf('\n', MAX);
    if (coupe < MAX / 2) coupe = MAX;
    parties.push(reste.slice(0, coupe));
    reste = reste.slice(coupe).trim();
  }
  if (reste) parties.push(reste);
  for (const partie of parties) {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: partie, parse_mode: 'Markdown' })
    });
    await new Promise(r => setTimeout(r, 400));
  }
}

// FIX 1 : Heure Paris correcte
function heureParis() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
}

function estSemaineSerena() {
  const debut = new Date('2026-05-10');
  return Math.floor((new Date() - debut) / (7 * 24 * 60 * 60 * 1000)) % 2 === 0;
}

function nomMois(date) {
  return date.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
}

// ============================================================
// SUPABASE
// ============================================================
async function getDepensesMois() {
  const debut = new Date(); debut.setDate(1); debut.setHours(0, 0, 0, 0);
  const { data } = await supabase.from('depenses').select('*').gte('created_at', debut.toISOString());
  return data || [];
}

async function getCoursMois() {
  const debut = new Date(); debut.setDate(1); debut.setHours(0, 0, 0, 0);
  const { data } = await supabase.from('cours').select('*').gte('created_at', debut.toISOString());
  return data || [];
}

async function getCoursManquesMois() {
  const debut = new Date(); debut.setDate(1); debut.setHours(0, 0, 0, 0);
  const { data } = await supabase.from('cours_manques').select('*').gte('created_at', debut.toISOString());
  return data || [];
}

async function getRevenusSupplementaires() {
  const debut = new Date(); debut.setDate(1); debut.setHours(0, 0, 0, 0);
  const { data } = await supabase.from('revenus').select('*').gte('created_at', debut.toISOString());
  return data || [];
}

async function getSalaireMois() {
  const debut = new Date(); debut.setDate(1); debut.setHours(0, 0, 0, 0);
  const { data } = await supabase.from('salaires').select('*').gte('created_at', debut.toISOString()).order('created_at', { ascending: false }).limit(1);
  return data && data.length > 0 ? data[0].montant : SALAIRE_LGM_DEFAULT;
}

async function getEpargne() {
  const { data } = await supabase.from('epargne').select('*').order('created_at', { ascending: false }).limit(1);
  return data && data.length > 0 ? data[0].montant : EPARGNE_DEPART;
}

async function getTotauxParCat(depenses) {
  const totaux = {};
  Object.keys(BUDGETS).forEach(k => totaux[k] = 0);
  depenses.forEach(d => { if (totaux[d.categorie] !== undefined) totaux[d.categorie] += d.montant; });
  return totaux;
}

async function getContextFinancier() {
  const [depenses, cours, coursManques, revenus, salaire, epargneBase] = await Promise.all([
    getDepensesMois(), getCoursMois(), getCoursManquesMois(),
    getRevenusSupplementaires(), getSalaireMois(), getEpargne()
  ]);
  const totaux = await getTotauxParCat(depenses);
  const totalDep = Object.values(totaux).reduce((a, b) => a + b, 0);
  const completude = cours.reduce((s, c) => s + c.gain, 0);
  const totalManque = coursManques.reduce((s, c) => s + c.gain_manque, 0);
  const revenusSupp = revenus.reduce((s, r) => s + r.montant, 0);
  const totalRevenus = salaire + BEAU_FRERE + completude + revenusSupp;
  const solde = totalRevenus - TOTAL_CHARGES_FIXES - totalDep;
  const epargneEstimee = epargneBase + solde;
  return { depenses, cours, coursManques, revenus, totaux, totalDep, completude, totalManque, revenusSupp, totalRevenus, solde, epargneEstimee, salaire, epargneBase };
}

// ============================================================
// MINI DASHBOARD
// ============================================================
async function envoyerMiniDashboard(chatId, ctx) {
  let msg = `\n📊 *Dashboard*\n━━━━━━━━━━━━━━\n`;
  msg += `🎓 Complétude : ${barreProgression(ctx.completude, OBJECTIF_COMPLETUDE)}\n\n`;

  const prochainObj = OBJECTIFS.find(o => ctx.epargneEstimee < o.montant);
  if (prochainObj) {
    msg += `🎯 Épargne → ${prochainObj.label} :\n${barreProgression(ctx.epargneEstimee, prochainObj.montant)}\n\n`;
  } else {
    msg += `✅ Tous les objectifs épargne atteints ! 🎉\n\n`;
  }

  const alertes = Object.entries(ctx.totaux)
    .filter(([k, v]) => v > BUDGETS[k].max * 0.7)
    .map(([k, v]) => {
      const restant = BUDGETS[k].max - v;
      return `${restant < 0 ? '🔴' : '🟡'} ${BUDGETS[k].label} : ${v.toFixed(0)}€ / ${BUDGETS[k].max}€`;
    });

  if (alertes.length > 0) msg += `⚠️ *Budgets à surveiller :*\n${alertes.join('\n')}\n\n`;

  const soldeCouleur = ctx.solde >= 0 ? '🟢' : '🔴';
  msg += `${soldeCouleur} Solde estimé : *${ctx.solde >= 0 ? '+' : ''}${ctx.solde.toFixed(0)} €*`;
  await sendMessage(chatId, msg);
}

// ============================================================
// ENREGISTRER COURS FAIT
// ============================================================
async function enregistrerCoursFait(chatId, nomEleve, gain, rattrapages = false) {
  await supabase.from('cours').insert({
    eleve: nomEleve, duree: ELEVES[nomEleve].duree,
    taux: ELEVES[nomEleve].taux, gain, chat_id: chatId, rattrapage: rattrapages
  });
  const ctx = await getContextFinancier();
  const manque = Math.max(0, OBJECTIF_COMPLETUDE - ctx.completude);
  const emoji = ctx.completude >= OBJECTIF_COMPLETUDE ? '🟢' : ctx.completude >= 1000 ? '🟡' : '🔴';
  let msg = `✅ Cours avec *${nomEleve}* enregistré${rattrapages ? ' _(rattrapage)_' : ''} !\n`;
  msg += `💰 Gain : *+${gain.toFixed(2)} €*\n\n`;
  msg += `${emoji} Complétude : *${ctx.completude.toFixed(0)} €* / ${OBJECTIF_COMPLETUDE} €\n`;
  msg += `${barreProgression(ctx.completude, OBJECTIF_COMPLETUDE)}\n`;
  msg += manque > 0 ? `⚠️ Il manque : *${manque.toFixed(0)} €*` : `🎉 Objectif atteint !`;
  await sendMessage(chatId, msg);
  await envoyerMiniDashboard(chatId, ctx);
}

// ============================================================
// ENREGISTRER COURS MANQUÉ
// ============================================================
async function enregistrerCoursManque(chatId, nomEleve, gainManque) {
  await supabase.from('cours_manques').insert({ eleve: nomEleve, gain_manque: gainManque, chat_id: chatId });
  const ctx = await getContextFinancier();
  let msg = `❌ Cours avec *${nomEleve}* non effectué\n`;
  msg += `💸 Manque à gagner : *-${gainManque.toFixed(2)} €*\n\n`;
  msg += `📉 Total manqué ce mois : *-${ctx.totalManque.toFixed(0)} €* (${ctx.coursManques.length} cours)`;
  await sendMessage(chatId, msg);
}

// ============================================================
// FIX 4 : GÉNÉRATION FICHE — prompts concis + texte brut
// ============================================================
async function genererFiche(nomEleve, chapitre) {
  const profil = ELEVES[nomEleve];
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const baseInstructions = `
RÈGLES ABSOLUES :
- Texte brut UNIQUEMENT, pas de LaTeX ni de symboles mathématiques spéciaux
- Fractions : écrire "3/4", puissances : "x^2", racines : "sqrt(9)"
- Maximum 600 mots au total
- Corrigé séparé par une ligne "=== CORRIGÉ ==="
- Exercices numérotés clairement
- Concis et pédagogique`;

  let prompt = '';

  if (profil.ficheHebdo) {
    prompt = `Tu es un professeur de maths. Génère une fiche hebdomadaire COURTE pour ${nomEleve} (${profil.niveau}).
Chapitre : ${chapitre}
${baseInstructions}
FORMAT : Lundi à Vendredi, 2 exercices/jour simples, corrigé à la fin.
Titre : "FICHE HEBDO — ${nomEleve} — ${chapitre}"`;
  } else if (profil.tda) {
    prompt = `Tu es un professeur spécialisé TDA. Fiche pour ${nomEleve} (${profil.niveau}).
Chapitre : ${chapitre}
${baseInstructions}
CONSIGNES TDA : max 4 exercices, 1 consigne courte par exercice, beaucoup d'espace.
Titre : "FICHE TDA — ${nomEleve} — ${chapitre}"`;
  } else {
    prompt = `Tu es un professeur de maths. Fiche pour ${nomEleve} (${profil.niveau}).
Chapitre : ${chapitre}
${baseInstructions}
FORMAT : 4 exercices progressifs adaptés au niveau ${profil.niveau}, corrigé à la fin.
Titre : "FICHE — ${nomEleve} — ${chapitre}"`;
  }

  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ============================================================
// FIX 2 : DÉTECTION INTENTION IA — analyse TOUS les messages
// ============================================================
async function detecterIntentionIA(texte, ctx) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = `Tu es le cerveau d'un assistant Telegram personnel appelé L'Agent pour Nour-Dine.
Analyse ce message et retourne UNIQUEMENT un objet JSON valide (sans markdown ni backtick).

Liste des élèves : ${Object.keys(ELEVES).join(', ')}
Catégories dépenses : essence, courses, restos, sante, maison, voiture, shopping, loisirs, divers

IMPORTANT : Sois TRÈS tolérant aux fautes d'orthographe et formulations imparfaites.
Exemples :
- "ajoute un cours a margaux" = cours_fait avec eleve Margaux
- "jai pa pu faire cours avec helene" = cours_manque avec eleve Hélène  
- "jai fait le plein 60e" = depense essence 60€
- "cb je gagne avec amel" = question sur Amel
- "leclerc 45" = depense courses 45€

Retourne ce JSON :
{
  "intention": "depense" | "cours_fait" | "cours_manque" | "salaire" | "epargne" | "revenu" | "question" | "inconnu",
  "eleve": "prénom exact de la liste ou null",
  "montant": nombre ou null,
  "categorie_depense": "essence|courses|restos|sante|maison|voiture|shopping|loisirs|divers" ou null,
  "est_rattrapage": true ou false,
  "reponse_directe": "réponse courte en français si c'est une question simple, sinon null"
}

Contexte : solde ${ctx.solde.toFixed(0)}€, épargne ${ctx.epargneBase}€, complétude ${ctx.completude.toFixed(0)}€/${OBJECTIF_COMPLETUDE}€
Taux élèves : ${Object.entries(ELEVES).map(([n,e]) => `${n} ${e.taux}€/h`).join(', ')}

Message : "${texte}"`;

  try {
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim().replace(/```json|```/g, '').trim();
    return JSON.parse(raw);
  } catch {
    return { intention: 'inconnu' };
  }
}

// ============================================================
// MESSAGES AUTOMATIQUES
// ============================================================
async function envoyerRappelBiHebdo() {
  const ctx = await getContextFinancier();
  let msg = `📋 *Rappel bi-hebdo — ${nomMois(new Date())}*\n\n`;
  msg += `💰 *Revenus :*\n`;
  msg += `• LGM : ${ctx.salaire} €${ctx.salaire === SALAIRE_LGM_DEFAULT ? ' _(par défaut)_' : ''}\n`;
  msg += `• Beau-frère : ${BEAU_FRERE} €\n`;
  msg += `• Complétude : ${ctx.completude.toFixed(0)} € / ${OBJECTIF_COMPLETUDE} €\n`;
  msg += `${barreProgression(ctx.completude, OBJECTIF_COMPLETUDE)}\n`;
  if (ctx.revenusSupp > 0) msg += `• Autres : ${ctx.revenusSupp.toFixed(0)} €\n`;
  msg += `\n💸 *Dépenses :*\n`;
  Object.entries(ctx.totaux).forEach(([k, v]) => {
    if (v > 0) {
      const emoji = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
      msg += `${emoji} ${BUDGETS[k].label} : ${v.toFixed(0)}€ / ${BUDGETS[k].max}€\n`;
    }
  });
  msg += `\n📊 Solde estimé : *${ctx.solde >= 0 ? '+' : ''}${ctx.solde.toFixed(0)} €*\n`;
  if (ctx.totalManque > 0) msg += `💸 Cours manqués ce mois : *-${ctx.totalManque.toFixed(0)} €*\n`;
  msg += `\n_Des dépenses ou rentrées à enregistrer ?_`;
  await sendMessage(CHAT_ID, msg);
}

async function envoyerSyntheseMensuelle() {
  const ctx = await getContextFinancier();
  const potentielMax = ctx.completude + ctx.totalManque;
  let msg = `🗓️ *SYNTHÈSE ${nomMois(new Date()).toUpperCase()}*\n\n`;
  msg += `✅ *REVENUS : ${ctx.totalRevenus.toFixed(0)} €*\n`;
  msg += `• LGM : ${ctx.salaire} €\n• Beau-frère : ${BEAU_FRERE} €\n`;
  msg += `• Complétude : ${ctx.completude.toFixed(0)} € (${ctx.cours.length} cours)\n`;
  if (ctx.revenusSupp > 0) msg += `• Autres : ${ctx.revenusSupp.toFixed(0)} €\n`;
  msg += `\n🔒 *CHARGES FIXES : -${TOTAL_CHARGES_FIXES.toFixed(0)} €*\n`;
  msg += `\n💸 *DÉPENSES : -${ctx.totalDep.toFixed(0)} €*\n`;
  Object.entries(ctx.totaux).forEach(([k, v]) => {
    const emoji = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
    msg += `${emoji} ${BUDGETS[k].label} : ${v.toFixed(0)}€ / ${BUDGETS[k].max}€\n`;
  });
  if (ctx.coursManques.length > 0) {
    msg += `\n📉 *COURS MANQUÉS : ${ctx.coursManques.length} — -${ctx.totalManque.toFixed(0)} €*\n`;
    ctx.coursManques.forEach(c => { msg += `• ${c.eleve} : -${c.gain_manque.toFixed(2)} €\n`; });
    msg += `_Potentiel : ${potentielMax.toFixed(0)} € | Réalisé : ${ctx.completude.toFixed(0)} €_\n`;
  }
  msg += `\n💰 *SOLDE NET : ${ctx.solde >= 0 ? '+' : ''}${ctx.solde.toFixed(0)} €*\n\n`;
  msg += `🎯 *OBJECTIFS ÉPARGNE :*\n`;
  OBJECTIFS.forEach(o => {
    const delta = ctx.epargneEstimee - o.montant;
    msg += `${delta >= 0 ? '✅' : '⚠️'} *${o.label}* : ${o.montant.toLocaleString()} €\n`;
    msg += `${barreProgression(ctx.epargneEstimee, o.montant)} (${delta >= 0 ? '+' : ''}${delta.toFixed(0)} €)\n\n`;
  });
  await sendMessage(CHAT_ID, msg);
}

// ============================================================
// SCHEDULER — FIX 1 : TZ gérée par variable Railway TZ=Europe/Paris
// ============================================================
function demarrerScheduler() {
  // Keep-alive toutes les 4 minutes
  setInterval(() => {
    fetch(`https://budget-bot-production-eaaf.up.railway.app/`).catch(() => {});
  }, 4 * 60 * 1000);

  setInterval(async () => {
    const now = heureParis();
    const jour = now.getDay();
    const heure = now.getHours();
    const minute = now.getMinutes();

    // Rappels mercredi (3) et dimanche (0) à 20h
    if ((jour === 3 || jour === 0) && heure === 20 && minute === 0) {
      await envoyerRappelBiHebdo();
    }

    // Synthèse le 30 à 20h
    if (now.getDate() === 30 && heure === 20 && minute === 0) {
      await envoyerSyntheseMensuelle();
    }

    // Notifications fin de cours
    for (const [nomEleve, profil] of Object.entries(ELEVES)) {
      if (profil.jour !== jour) continue;
      if (profil.uneSemaineSurDeux && !estSemaineSerena()) continue;
      const totalMin = profil.minute + Math.floor(profil.duree * 60);
      const heureFin = profil.heure + Math.floor(totalMin / 60);
      const minuteFin = totalMin % 60;
      if (heure === heureFin && minute === minuteFin) {
        etatConversation = { etape: 'confirmation', nomEleve, source: 'auto' };
        await sendMessage(CHAT_ID,
          `📚 *Fin de cours !*\n\nAs-tu fait cours avec *${nomEleve}* ?\n\nRéponds *oui* ou *non*`
        );
      }
    }
  }, 60000);
}

// ============================================================
// WEBHOOK
// ============================================================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const msg = req.body.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const texte = msg.text.trim();
  const texteLower = texte.toLowerCase();

  try {

    // ── GESTION ÉTATS CONVERSATION ──────────────────────────
    if (etatConversation) {
      const { etape, nomEleve, source } = etatConversation;
      const profil = nomEleve ? ELEVES[nomEleve] : null;

      if (etape === 'confirmation') {
        const estOui = /^(oui|yes|ok|ouais|yep|yop|fait|c'est fait|✅|👍|1)$/i.test(texteLower);
        const estNon = /^(non|no|pas fait|absent|annulé|annule|nope|nan|❌|👎|0)$/i.test(texteLower);
        if (estOui) {
          if (profil.question2h) {
            etatConversation = { etape: 'question2h', nomEleve, source };
            await sendMessage(chatId, `✅ Super !\n\n*C'est la séance à 2h ?*\n\nRéponds *oui* ou *non*`);
          } else {
            const gain = profil.taux * profil.duree;
            await enregistrerCoursFait(chatId, nomEleve, gain, source !== 'auto');
            etatConversation = null;
          }
          return;
        }
        if (estNon) {
          const gainManque = profil.taux * 1;
          await enregistrerCoursManque(chatId, nomEleve, gainManque);
          etatConversation = null;
          return;
        }
        await sendMessage(chatId, `Je n'ai pas compris 😅 Réponds *oui* ou *non* — as-tu fait cours avec *${nomEleve}* ?`);
        return;
      }

      if (etape === 'question2h') {
        const estOui = /^(oui|yes|ok|ouais|2h|deux|✅|👍|1)$/i.test(texteLower);
        const estNon = /^(non|no|1h|une|nope|nan|❌|👎|0)$/i.test(texteLower);
        if (estOui || estNon) {
          const heuresPay = estOui ? 2 : 1;
          const gain = profil.taux * heuresPay;
          await enregistrerCoursFait(chatId, nomEleve, gain, source !== 'auto');
          if (profil.fiche) {
            etatConversation = { etape: 'chapitre', nomEleve, gain, source };
            await sendMessage(chatId, `📝 *Qu'avez-vous vu aujourd'hui avec ${nomEleve} ?*\n_Ex: Fractions, Pythagore, Calcul littéral..._`);
          } else {
            etatConversation = null;
          }
          return;
        }
        await sendMessage(chatId, `Réponds *oui* (2h) ou *non* (1h) 🙂`);
        return;
      }

      if (etape === 'chapitre') {
        await sendMessage(chatId, `📝 *Génération de la fiche...*\n_Quelques secondes..._`);
        try {
          const fiche = await genererFiche(nomEleve, texte);
          await sendMessage(chatId, fiche);
        } catch (err) {
          console.error('Erreur fiche:', err);
          await sendMessage(chatId, `❌ Erreur génération fiche. Réessaie avec /fiche`);
        }
        etatConversation = null;
        return;
      }

      if (etape === 'cours_manuel_nom') {
        // Utilise l'IA pour trouver l'élève même avec fautes
        const ctx = await getContextFinancier();
        const intention = await detecterIntentionIA(texte, ctx);
        const eleve = intention.eleve;
        if (eleve && ELEVES[eleve]) {
          etatConversation = { etape: 'cours_manuel_type', nomEleve: eleve, source: 'manuel' };
          await sendMessage(chatId, `📚 Cours avec *${eleve}*\n\nRattrapage ou cours normal ?\n\nRéponds *rattrapage* ou *normal*`);
        } else {
          await sendMessage(chatId, `❓ Prénom non reconnu.\nMes élèves : ${Object.keys(ELEVES).join(', ')}`);
        }
        return;
      }

      if (etape === 'cours_manuel_type') {
        const estRattrapage = /rattrapage/i.test(texte);
        if (profil.question2h) {
          etatConversation = { etape: 'question2h', nomEleve, source: estRattrapage ? 'rattrapage' : 'manuel' };
          await sendMessage(chatId, `*C'est la séance à 2h ?*\n\nRéponds *oui* ou *non*`);
        } else {
          const gain = profil.taux * profil.duree;
          await enregistrerCoursFait(chatId, nomEleve, gain, true);
          if (profil.fiche) {
            etatConversation = { etape: 'chapitre', nomEleve, gain, source: 'manuel' };
            await sendMessage(chatId, `📝 *Qu'avez-vous vu avec ${nomEleve} ?*`);
          } else {
            etatConversation = null;
          }
        }
        return;
      }
    }

    // ── COMMANDES ───────────────────────────────────────────
    if (texte === '/start') {
      await sendMessage(chatId,
        `👋 Salut Nour-Dine ! Je suis *L'Agent*.\n\n` +
        `*📚 Complétude :*\n/cours — signaler un cours\n/completude — revenus du mois\n/manques — cours ratés\n\n` +
        `*💰 Finances :*\n/bilan — dépenses\n/objectifs — épargne\n/synthese — bilan complet\n/charges — charges fixes\n/dashboard — vue rapide\n\n` +
        `*Parle-moi naturellement :*\n💸 "Leclerc 45€" → dépense\n📚 "Cours avec Margaux" → signaler\n❓ N'importe quelle question !`
      );
      return;
    }

    if (texte === '/dashboard') {
      const ctx = await getContextFinancier();
      await envoyerMiniDashboard(chatId, ctx);
      return;
    }

    if (texte === '/cours') {
      etatConversation = { etape: 'cours_manuel_nom' };
      await sendMessage(chatId, `📚 *Quel élève ?*\n${Object.keys(ELEVES).join(', ')}`);
      return;
    }

    if (texte === '/bilan') {
      const ctx = await getContextFinancier();
      let message = `📊 *Bilan ${nomMois(new Date())}*\n\n`;
      Object.entries(ctx.totaux).forEach(([k, v]) => {
        const emoji = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
        message += `${emoji} ${BUDGETS[k].label} : ${v.toFixed(0)}€ / ${BUDGETS[k].max}€\n`;
      });
      message += `\n💰 *Solde estimé : ${ctx.solde >= 0 ? '+' : ''}${ctx.solde.toFixed(0)} €*`;
      await sendMessage(chatId, message);
      return;
    }

    if (texte === '/completude') {
      const ctx = await getContextFinancier();
      const manque = Math.max(0, OBJECTIF_COMPLETUDE - ctx.completude);
      const emoji = ctx.completude >= OBJECTIF_COMPLETUDE ? '🟢' : ctx.completude >= 1000 ? '🟡' : '🔴';
      let msg = `📚 *Complétude ${nomMois(new Date())}*\n\n`;
      msg += `${emoji} *${ctx.completude.toFixed(2)} €* / ${OBJECTIF_COMPLETUDE} €\n`;
      msg += `${barreProgression(ctx.completude, OBJECTIF_COMPLETUDE)}\n`;
      msg += `Cours effectués : *${ctx.cours.length}*\n`;
      msg += manque > 0 ? `⚠️ Il manque : *${manque.toFixed(0)} €*\n` : `🎉 Objectif atteint !\n`;
      if (ctx.cours.length > 0) {
        msg += `\n*Détail :*\n`;
        ctx.cours.forEach(c => { msg += `• ${c.eleve}${c.rattrapage ? ' _(rattrapage)_' : ''} : +${c.gain.toFixed(2)} €\n`; });
      }
      await sendMessage(chatId, msg);
      return;
    }

    if (texte === '/manques') {
      const ctx = await getContextFinancier();
      if (ctx.coursManques.length === 0) {
        await sendMessage(chatId, `✅ *Aucun cours manqué ce mois !* 🎉`);
        return;
      }
      let msg = `📉 *Cours manqués — ${nomMois(new Date())}*\n\n`;
      ctx.coursManques.forEach(c => { msg += `❌ *${c.eleve}* → -${c.gain_manque.toFixed(2)} €\n`; });
      msg += `\n💸 *Total manqué : -${ctx.totalManque.toFixed(0)} €*\n`;
      msg += `✅ Gagné : ${ctx.completude.toFixed(0)} €\n`;
      msg += `🎯 Potentiel max : ${(ctx.completude + ctx.totalManque).toFixed(0)} €`;
      await sendMessage(chatId, msg);
      return;
    }

    if (texte === '/objectifs') {
      const ctx = await getContextFinancier();
      let msg = `🎯 *Objectifs épargne*\n\n`;
      msg += `💼 Épargne actuelle : *${ctx.epargneBase.toLocaleString()} €*\n`;
      msg += `📈 Projection : *${ctx.epargneEstimee.toFixed(0)} €*\n\n`;
      OBJECTIFS.forEach(o => {
        const delta = ctx.epargneEstimee - o.montant;
        msg += `${delta >= 0 ? '✅' : '⚠️'} *${o.label}* : ${o.montant.toLocaleString()} €\n`;
        msg += `${barreProgression(ctx.epargneEstimee, o.montant)} (${delta >= 0 ? '+' : ''}${delta.toFixed(0)} €)\n\n`;
      });
      msg += `_Hors tontine 13 000 € — c'est du bonus !_ 🎁`;
      await sendMessage(chatId, msg);
      return;
    }

    if (texte === '/synthese') { await envoyerSyntheseMensuelle(); return; }

    if (texte === '/charges') {
      let msg = `🔒 *Charges fixes — ${TOTAL_CHARGES_FIXES.toFixed(0)} €/mois*\n\n`;
      Object.entries(CHARGES_FIXES).forEach(([k, v]) => { msg += `• ${k} : ${v.toFixed(2)} €\n`; });
      await sendMessage(chatId, msg);
      return;
    }

    // ── FIX 2 : IA ANALYSE TOUS LES MESSAGES EN PREMIER ────
    const ctx = await getContextFinancier();
    const intention = await detecterIntentionIA(texte, ctx);

    if (intention.intention === 'cours_fait' && intention.eleve && ELEVES[intention.eleve]) {
      const eleve = intention.eleve;
      const profil = ELEVES[eleve];
      if (profil.question2h) {
        etatConversation = { etape: 'question2h', nomEleve: eleve, source: intention.est_rattrapage ? 'rattrapage' : 'manuel' };
        await sendMessage(chatId, `📚 Cours avec *${eleve}*${intention.est_rattrapage ? ' _(rattrapage)_' : ''} !\n\n*C'est la séance à 2h ?*\n\nRéponds *oui* ou *non*`);
      } else {
        const gain = profil.taux * profil.duree;
        await enregistrerCoursFait(chatId, eleve, gain, intention.est_rattrapage);
        if (profil.fiche) {
          etatConversation = { etape: 'chapitre', nomEleve: eleve, gain, source: 'manuel' };
          await sendMessage(chatId, `📝 *Qu'avez-vous vu avec ${eleve} ?*`);
        }
      }
      return;
    }

    if (intention.intention === 'cours_manque' && intention.eleve && ELEVES[intention.eleve]) {
      const gainManque = ELEVES[intention.eleve].taux * 1;
      await enregistrerCoursManque(chatId, intention.eleve, gainManque);
      return;
    }

    if (intention.intention === 'depense' && intention.montant) {
      const cat = intention.categorie_depense || 'divers';
      await supabase.from('depenses').insert({ montant: intention.montant, categorie: cat, libelle: texte, chat_id: chatId });
      const depenses = await getDepensesMois();
      const totaux = await getTotauxParCat(depenses);
      const restant = BUDGETS[cat].max - totaux[cat];
      const emoji = restant < 0 ? '🔴' : restant < BUDGETS[cat].max * 0.2 ? '🟡' : '🟢';
      await sendMessage(chatId, `✅ *${intention.montant} €* — _${BUDGETS[cat].label}_\n${emoji} Restant : *${restant.toFixed(0)} €* / ${BUDGETS[cat].max} €`);
      await envoyerMiniDashboard(chatId, ctx);
      return;
    }

    if (intention.intention === 'salaire' && intention.montant) {
      await supabase.from('salaires').insert({ montant: intention.montant, libelle: texte, chat_id: chatId });
      await sendMessage(chatId, `✅ Salaire LGM : *${intention.montant} €* 📊`);
      await envoyerMiniDashboard(chatId, ctx);
      return;
    }

    if (intention.intention === 'epargne' && intention.montant) {
      await supabase.from('epargne').insert({ montant: intention.montant, libelle: texte, chat_id: chatId });
      await sendMessage(chatId, `✅ Épargne : *${intention.montant.toLocaleString()} €* 💎`);
      await envoyerMiniDashboard(chatId, ctx);
      return;
    }

    if (intention.intention === 'revenu' && intention.montant) {
      await supabase.from('revenus').insert({ montant: intention.montant, libelle: texte, chat_id: chatId });
      await sendMessage(chatId, `✅ Rentrée *+${intention.montant} €* enregistrée !`);
      await envoyerMiniDashboard(chatId, ctx);
      return;
    }

    // Réponse directe courte de l'IA
    if (intention.reponse_directe) {
      await sendMessage(chatId, intention.reponse_directe);
      return;
    }

    // ── RÉPONSE IA GÉNÉRALE ─────────────────────────────────
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const coursParEleve = {};
    ctx.cours.forEach(c => {
      if (!coursParEleve[c.eleve]) coursParEleve[c.eleve] = { nb: 0, gain: 0 };
      coursParEleve[c.eleve].nb++;
      coursParEleve[c.eleve].gain += c.gain;
    });

    const contextIA = `Tu es L'Agent, assistant personnel de Nour-Dine. Tu es direct, bienveillant et naturel.
Tu réponds TOUJOURS en français conversationnel. Tu es comme un ami conseiller intelligent.
Tu es TRÈS tolérant aux fautes d'orthographe — tu comprends le sens même si c'est mal écrit.
Tu peux répondre à tout : finances, achats, prix marché français, conseils de vie, formations.
Garde tes réponses concises (4-6 lignes) sauf si la question est complexe.

=== PROFIL ===
Ingénieur LGM (mission Thales), départ août 2026. Co-fondateur Dyneos. Tuteur Complétude (11 élèves).
Certification formateur incendie en cours (Fo.EPI juin, SSIAP juillet). Île-de-France, en PACS.

=== FINANCES CE MOIS ===
LGM: ${ctx.salaire}€ | Beau-frère: ${BEAU_FRERE}€ | Complétude: ${ctx.completude.toFixed(0)}€/${OBJECTIF_COMPLETUDE}€
Total revenus: ${ctx.totalRevenus.toFixed(0)}€ | Charges: ${TOTAL_CHARGES_FIXES.toFixed(0)}€ | Dépenses: ${ctx.totalDep.toFixed(0)}€
Solde: ${ctx.solde.toFixed(0)}€ | Épargne: ${ctx.epargneBase.toLocaleString()}€ | Projection: ${ctx.epargneEstimee.toFixed(0)}€

=== ÉLÈVES ===
${Object.entries(ELEVES).map(([n,e]) => `${n} ${e.taux}€/h (${e.niveau})`).join(' | ')}
Ce mois: ${Object.entries(coursParEleve).map(([e,d]) => `${e} ${d.nb}cours +${d.gain.toFixed(0)}€`).join(', ') || 'aucun enregistré'}

Message: "${texte}"`;

    await sendMessage(chatId, '🤔');
    const result = await model.generateContent(contextIA);
    await sendMessage(chatId, result.response.text());

  } catch (err) {
    console.error('Erreur:', err.message);
    await sendMessage(chatId, "❌ Erreur, réessaie dans quelques secondes.");
  }
});

app.get('/', (req, res) => res.send("L'Agent est en ligne ! 🤖"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`L'Agent écoute sur le port ${PORT}`);
  demarrerScheduler();
});

module.exports = app;
