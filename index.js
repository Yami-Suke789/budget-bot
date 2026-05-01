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
// REVENUS
// ============================================================
const SALAIRE_LGM_DEFAULT = 2500;
const BEAU_FRERE = 320;
const OBJECTIF_COMPLETUDE = 1500;

// ============================================================
// CHARGES FIXES
// ============================================================
const CHARGES_FIXES = {
  'Loyer':                832.46,
  'Tontine 1':            500.00,
  'Tontine 2':            500.00,
  'Virement mère':        150.00,
  'Place parking':         50.00,
  'Malakoff mutuelle':     57.03,
  'ENI énergie':           39.40,
  'Bouygues mobile':       17.99,
  'Bouygues box':          24.00,
  'Basic Fit':             22.99,
  'Assurance habitation':   8.46,
  'Assurance auto':        64.24,
  'Salle sport femme':     44.00,
  'Canal+ frère':          13.00,
  'Cours arabe':           31.00,
  'Claude.ai':             21.60,
  'Helloasso':             12.55,
  'Stripe asso':           10.00,
  'Disney+':                6.99,
  'Crunchyroll':            8.99,
  'Cotisation bancaire':   18.30,
};
const TOTAL_CHARGES_FIXES = Object.values(CHARGES_FIXES).reduce((a, b) => a + b, 0);

// ============================================================
// BUDGETS VARIABLES
// ============================================================
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

// ============================================================
// OBJECTIFS ÉPARGNE
// ============================================================
const EPARGNE_DEPART = 9000;
const OBJECTIFS = [
  { label: 'Fin juin 2026', montant: 12500 },
  { label: 'Fin août 2026', montant: 15000 },
  { label: 'Janvier 2027',  montant: 20000 },
];

// ============================================================
// PROFILS ÉLÈVES
// ============================================================
const ELEVES_PROFILS = {
  'Amel':        { niveau: '5e',  tda: false, ficheHebdo: false, question2h: true  },
  'Benjamin':    { niveau: '5e',  tda: false, ficheHebdo: false, question2h: true  },
  'Guillaume':   { niveau: '5e',  tda: true,  ficheHebdo: false, question2h: true  },
  'Margaux':     { niveau: '3e',  tda: false, ficheHebdo: false, question2h: true  },
  'Nélia':       { niveau: '3e',  tda: false, ficheHebdo: false, question2h: true  },
  'Hélène':      { niveau: '5e',  tda: false, ficheHebdo: false, question2h: true  },
  'Noélie':      { niveau: 'CE2', tda: false, ficheHebdo: false, question2h: false, fiche: false },
  'Mathéo':      { niveau: '3e',  tda: false, ficheHebdo: true,  question2h: true  },
  'Anne-Gaëlle': { niveau: '3e',  tda: false, ficheHebdo: false, question2h: true  },
  'Saïda':       { niveau: '5e',  tda: false, ficheHebdo: false, question2h: true  },
  'Serena':      { niveau: '5e',  tda: false, ficheHebdo: false, question2h: true  },
};

// ============================================================
// PLANNING COMPLÉTUDE
// ============================================================
const PLANNING = [
  { nom: 'Amel',        jour: 1, heure: 17, minute: 0,  duree: 1.5, taux: 21.04 },
  { nom: 'Benjamin',    jour: 2, heure: 18, minute: 0,  duree: 1.5, taux: 24.30 },
  { nom: 'Guillaume',   jour: 3, heure: 17, minute: 30, duree: 1.5, taux: 23.88 },
  { nom: 'Margaux',     jour: 4, heure: 16, minute: 0,  duree: 1.5, taux: 26.60 },
  { nom: 'Nélia',       jour: 4, heure: 17, minute: 30, duree: 1.5, taux: 26.60 },
  { nom: 'Hélène',      jour: 6, heure: 8,  minute: 0,  duree: 1.5, taux: 24.30 },
  { nom: 'Noélie',      jour: 6, heure: 10, minute: 0,  duree: 1.0, taux: 25.78 },
  { nom: 'Mathéo',      jour: 6, heure: 11, minute: 30, duree: 1.5, taux: 23.66 },
  { nom: 'Anne-Gaëlle', jour: 6, heure: 13, minute: 0,  duree: 1.5, taux: 24.08 },
  { nom: 'Saïda',       jour: 6, heure: 15, minute: 0,  duree: 1.5, taux: 25.56 },
  { nom: 'Serena',      jour: 0, heure: 13, minute: 0,  duree: 1.5, taux: 23.04, uneSemaineSurDeux: true },
];

// État conversations en cours
let etatConversation = null;
// { etape: 'confirmation'|'question2h'|'chapitre', cours: {...} }

// ============================================================
// HELPERS
// ============================================================
async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
}

function heureParis() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
}

function estSemaineSerena() {
  const debut = new Date('2026-05-10');
  const diff = Math.floor((new Date() - debut) / (7 * 24 * 60 * 60 * 1000));
  return diff % 2 === 0;
}

function nomMois(date) {
  return date.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
}

function detectCategorie(texte) {
  const t = texte.toLowerCase();
  if (t.includes('essence') || t.includes('esso') || t.includes('total') || t.includes('station') || t.includes('dlg') || t.includes('arcycom') || t.includes('certas') || t.includes('relais') || t.includes('carburant')) return 'essence';
  if (t.includes('leclerc') || t.includes('courses') || t.includes('carrefour') || t.includes('lidl') || t.includes('aldi') || t.includes('cora') || t.includes('supermarché')) return 'courses';
  if (t.includes('resto') || t.includes('restaurant') || t.includes('mcdonald') || t.includes('burger') || t.includes('pizza') || t.includes('panda') || t.includes('quick') || t.includes('kebab')) return 'restos';
  if (t.includes('médecin') || t.includes('pharmacie') || t.includes('doctolib') || t.includes('santé') || t.includes('docteur')) return 'sante';
  if (t.includes('ikea') || t.includes('maison') || t.includes('bricolage') || t.includes('castorama')) return 'maison';
  if (t.includes('garage') || t.includes('voiture') || t.includes('réparation') || t.includes('contrôle technique')) return 'voiture';
  if (t.includes('vêtement') || t.includes('zara') || t.includes('shopping') || t.includes('coiffeur')) return 'shopping';
  if (t.includes('cinéma') || t.includes('loisir') || t.includes('sport') || t.includes('concert')) return 'loisirs';
  return 'divers';
}

function parseDepense(texte) {
  const match = texte.match(/(\d+([.,]\d{1,2})?)\s*€?/);
  if (!match) return null;
  const montant = parseFloat(match[1].replace(',', '.'));
  if (montant <= 0 || montant >= 5000) return null;
  return { montant, cat: detectCategorie(texte) };
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
  const [depenses, cours, revenus, salaire, epargneBase] = await Promise.all([
    getDepensesMois(), getCoursMois(), getRevenusSupplementaires(), getSalaireMois(), getEpargne()
  ]);
  const totaux = await getTotauxParCat(depenses);
  const totalDep = Object.values(totaux).reduce((a, b) => a + b, 0);
  const completude = cours.reduce((s, c) => s + c.gain, 0);
  const revenusSupp = revenus.reduce((s, r) => s + r.montant, 0);
  const totalRevenus = salaire + BEAU_FRERE + completude + revenusSupp;
  const solde = totalRevenus - TOTAL_CHARGES_FIXES - totalDep;
  const epargneEstimee = epargneBase + solde;
  return { depenses, cours, revenus, totaux, totalDep, completude, revenusSupp, totalRevenus, solde, epargneEstimee, salaire, epargneBase };
}

// ============================================================
// GÉNÉRATION FICHE D'EXERCICES
// ============================================================
async function genererFiche(eleve, chapitre) {
  const profil = ELEVES_PROFILS[eleve];
  const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

  let prompt = '';

  if (profil.ficheHebdo) {
    // Format spécial Mathéo : fiche hebdo lundi-vendredi
    prompt = `Tu es un professeur de maths expert. Génère une fiche d'exercices hebdomadaire pour ${eleve}, élève de ${profil.niveau}.
Chapitre vu en cours : ${chapitre}

FORMAT OBLIGATOIRE :
- 5 jours : Lundi, Mardi, Mercredi, Jeudi, Vendredi
- 2 exercices par jour
- Progression de difficulté croissante dans la semaine
- Exercices variés (calcul, problème, géométrie selon le chapitre)
- AUCUN indice ni aide dans les exercices
- Corrigé complet à la fin pour chaque exercice

Commence par : "📚 FICHE HEBDOMADAIRE — ${eleve} — ${chapitre}"`;

  } else if (profil.tda) {
    // Format spécial Guillaume : TDA
    prompt = `Tu es un professeur de maths expert spécialisé dans l'accompagnement des élèves TDA. Génère une fiche d'exercices pour ${eleve}, élève de ${profil.niveau}.
Chapitre vu en cours : ${chapitre}

CONSIGNES IMPORTANTES (élève TDA) :
- Exercices COURTS et bien espacés
- Consignes très simples et claires (1-2 phrases max)
- Maximum 4 exercices
- Énoncés épurés sans texte superflu
- Police grande (utilise des sauts de ligne)
- Corrigé complet à la fin
- AUCUN indice dans les exercices

Commence par : "📚 FICHE D'EXERCICES — ${eleve} — ${chapitre}"`;

  } else {
    // Format standard
    prompt = `Tu es un professeur de maths expert. Génère une fiche d'exercices pour ${eleve}, élève de ${profil.niveau}.
Chapitre vu en cours : ${chapitre}

FORMAT :
- 4 à 5 exercices progressifs
- Exercices variés adaptés au niveau ${profil.niveau}
- AUCUN indice ni scaffolding dans les exercices
- Corrigé complet à la fin
- Présentation claire et aérée

Commence par : "📚 FICHE D'EXERCICES — ${eleve} — ${chapitre}"`;
  }

  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ============================================================
// MESSAGES RÉCURRENTS
// ============================================================
async function envoyerRappelBiHebdo() {
  const ctx = await getContextFinancier();
  let msg = `📋 *Rappel bi-hebdo — ${nomMois(new Date())}*\n\n`;
  msg += `💰 *Revenus enregistrés :*\n`;
  msg += `• Salaire LGM : ${ctx.salaire} €${ctx.salaire === SALAIRE_LGM_DEFAULT ? ' _(par défaut)_' : ''}\n`;
  msg += `• Beau-frère : ${BEAU_FRERE} €\n`;
  msg += `• Complétude : ${ctx.completude.toFixed(0)} € / ${OBJECTIF_COMPLETUDE} €\n`;
  if (ctx.revenusSupp > 0) msg += `• Autres : ${ctx.revenusSupp.toFixed(0)} €\n`;
  msg += `\n💸 *Dépenses variables :*\n`;
  Object.entries(ctx.totaux).forEach(([k, v]) => {
    if (v > 0) {
      const emoji = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
      msg += `${emoji} ${BUDGETS[k].label} : ${v.toFixed(0)}€ / ${BUDGETS[k].max}€\n`;
    }
  });
  msg += `\n📊 *Solde estimé : ${ctx.solde >= 0 ? '+' : ''}${ctx.solde.toFixed(0)} €*\n\n`;
  msg += `_As-tu des dépenses ou rentrées à enregistrer ?_`;
  await sendMessage(CHAT_ID, msg);
}

async function envoyerSyntheseMensuelle() {
  const ctx = await getContextFinancier();
  const economiesPossibles = TOTAL_BUDGETS_MAX - ctx.totalDep;
  let msg = `🗓️ *SYNTHÈSE ${nomMois(new Date()).toUpperCase()}*\n\n`;
  msg += `✅ *REVENUS TOTAUX : ${ctx.totalRevenus.toFixed(0)} €*\n`;
  msg += `• Salaire LGM : ${ctx.salaire} €\n`;
  msg += `• Beau-frère : ${BEAU_FRERE} €\n`;
  msg += `• Complétude : ${ctx.completude.toFixed(0)} € (${ctx.cours.length} cours)\n`;
  if (ctx.revenusSupp > 0) msg += `• Autres : ${ctx.revenusSupp.toFixed(0)} €\n`;
  msg += `\n🔒 *CHARGES FIXES : -${TOTAL_CHARGES_FIXES.toFixed(0)} €*\n`;
  msg += `\n💸 *DÉPENSES VARIABLES : -${ctx.totalDep.toFixed(0)} €*\n`;
  Object.entries(ctx.totaux).forEach(([k, v]) => {
    const emoji = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
    msg += `${emoji} ${BUDGETS[k].label} : ${v.toFixed(0)}€ / ${BUDGETS[k].max}€\n`;
  });
  msg += `\n💰 *SOLDE NET : ${ctx.solde >= 0 ? '+' : ''}${ctx.solde.toFixed(0)} €*\n`;
  if (economiesPossibles > 0) msg += `\n💡 Tu aurais pu économiser *${economiesPossibles.toFixed(0)} €* de plus.\n`;
  msg += `\n🎯 *OBJECTIFS ÉPARGNE :*\n`;
  OBJECTIFS.forEach(o => {
    const delta = ctx.epargneEstimee - o.montant;
    const emoji = delta >= 0 ? '✅' : '⚠️';
    msg += `${emoji} ${o.label} : ${o.montant.toLocaleString()} € (${delta >= 0 ? '+' : ''}${delta.toFixed(0)} €)\n`;
  });
  await sendMessage(CHAT_ID, msg);
}

// ============================================================
// SCHEDULER
// ============================================================
function demarrerScheduler() {
  setInterval(async () => {
    const now = heureParis();
    const jour = now.getDay();
    const heure = now.getHours();
    const minute = now.getMinutes();

    if ((jour === 3 || jour === 0) && heure === 20 && minute === 0) {
      await envoyerRappelBiHebdo();
    }

    if (now.getDate() === 30 && heure === 20 && minute === 0) {
      await envoyerSyntheseMensuelle();
    }

    for (const cours of PLANNING) {
      if (cours.jour !== jour) continue;
      if (cours.uneSemaineSurDeux && !estSemaineSerena()) continue;
      const totalMin = cours.minute + Math.floor(cours.duree * 60);
      const heureFin = cours.heure + Math.floor(totalMin / 60);
      const minuteFin = totalMin % 60;
      if (heure === heureFin && minute === minuteFin) {
        etatConversation = { etape: 'confirmation', cours };
        await sendMessage(CHAT_ID, `📚 *Fin de cours !*\n\nAs-tu fait cours avec *${cours.nom}* ?\n\nRéponds *oui* ou *non*`);
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

    // ── Gestion états conversation cours ────────────────────
    if (etatConversation) {
      const { etape, cours } = etatConversation;
      const profil = ELEVES_PROFILS[cours.nom];

      // ÉTAPE 1 : Confirmation cours
      if (etape === 'confirmation') {
        if (texteLower === 'oui') {
          if (profil.question2h) {
            etatConversation = { etape: 'question2h', cours };
            await sendMessage(chatId, `✅ Super !\n\n*C'est la séance à 2h ?*\n\nRéponds *oui* ou *non*`);
          } else {
            // Noélie : pas de question 2h, pas de fiche
            const gain = cours.taux * cours.duree;
            await enregistrerCours(chatId, cours, gain);
            etatConversation = null;
          }
          return;
        }
        if (texteLower === 'non') {
          etatConversation = null;
          await sendMessage(chatId, `❌ Cours avec *${cours.nom}* non effectué — rien enregistré.`);
          return;
        }
      }

      // ÉTAPE 2 : Question 2h
      if (etape === 'question2h') {
        if (texteLower === 'oui' || texteLower === 'non') {
          const heuresPay = texteLower === 'oui' ? 2 : 1;
          const gain = cours.taux * heuresPay;
          await enregistrerCours(chatId, cours, gain);

          // Demander le chapitre pour la fiche
          if (profil.fiche !== false) {
            etatConversation = { etape: 'chapitre', cours, gain };
            await sendMessage(chatId, `📝 *Qu'avez-vous vu aujourd'hui avec ${cours.nom} ?*\n\n_Ex: Fractions, Théorème de Pythagore, Équations..._`);
          } else {
            etatConversation = null;
          }
          return;
        }
      }

      // ÉTAPE 3 : Chapitre pour fiche
      if (etape === 'chapitre') {
        await sendMessage(chatId, `🤔 *Génération de la fiche en cours...*`);
        const fiche = await genererFiche(cours.nom, texte);
        await sendMessage(chatId, fiche);
        etatConversation = null;
        return;
      }
    }

    // ── Commandes ───────────────────────────────────────────
    if (texte === '/start') {
      await sendMessage(chatId,
        `👋 Salut ! Je suis *L'Agent*, ton assistant comptable.\n\n` +
        `*Commandes :*\n` +
        `📊 /bilan — dépenses du mois\n` +
        `📚 /completude — revenus Complétude\n` +
        `💰 /salaire — enregistrer ton salaire LGM\n` +
        `💎 /epargne — mettre à jour ton épargne\n` +
        `🎯 /objectifs — progression épargne\n` +
        `🗓️ /synthese — synthèse complète\n` +
        `📋 /charges — charges fixes\n\n` +
        `*Saisie rapide :*\n` +
        `💸 _"Leclerc 45€"_ — dépense\n` +
        `💰 _"Salaire 2630€"_ — salaire\n` +
        `💎 _"Épargne 10500€"_ — épargne\n` +
        `❓ _"Est-ce que je peux acheter X ?"_ — conseil IA`
      );
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
      const cours = await getCoursMois();
      const total = cours.reduce((s, c) => s + c.gain, 0);
      const manque = Math.max(0, OBJECTIF_COMPLETUDE - total);
      const emoji = total >= OBJECTIF_COMPLETUDE ? '🟢' : total >= 1000 ? '🟡' : '🔴';
      let msg = `📚 *Complétude ${nomMois(new Date())}*\n\n`;
      msg += `Cours effectués : *${cours.length}*\n`;
      msg += `${emoji} Total : *${total.toFixed(2)} €* / ${OBJECTIF_COMPLETUDE} €\n`;
      msg += manque > 0 ? `⚠️ Il manque : *${manque.toFixed(0)} €*` : `🎉 Objectif atteint !`;
      if (cours.length > 0) {
        msg += `\n\n*Détail :*\n`;
        cours.forEach(c => { msg += `• ${c.eleve} : +${c.gain.toFixed(2)} €\n`; });
      }
      await sendMessage(chatId, msg);
      return;
    }

    if (texte === '/salaire') {
      const salaire = await getSalaireMois();
      await sendMessage(chatId,
        `💰 *Salaire LGM ce mois*\n\nActuel : *${salaire} €*\n\nPour mettre à jour : _"Salaire 2630€"_`
      );
      return;
    }

    if (texte === '/epargne') {
      const epargne = await getEpargne();
      await sendMessage(chatId,
        `💎 *Épargne actuelle*\n\n*${epargne.toLocaleString()} €*\n\nPour mettre à jour : _"Épargne 10500€"_`
      );
      return;
    }

    if (texte === '/objectifs') {
      const ctx = await getContextFinancier();
      let msg = `🎯 *Objectifs épargne*\n\n`;
      msg += `💼 Épargne actuelle : *${ctx.epargneBase.toLocaleString()} €*\n`;
      msg += `📈 Projection fin de mois : *${ctx.epargneEstimee.toFixed(0)} €*\n\n`;
      OBJECTIFS.forEach(o => {
        const delta = ctx.epargneEstimee - o.montant;
        const pct = Math.min(100, Math.round((ctx.epargneEstimee / o.montant) * 100));
        const emoji = delta >= 0 ? '✅' : '⚠️';
        msg += `${emoji} *${o.label}* : ${o.montant.toLocaleString()} €\n`;
        msg += `   → ${delta >= 0 ? '+' : ''}${delta.toFixed(0)} € (${pct}%)\n\n`;
      });
      msg += `_Hors tontine 13 000 €, RC et ARE — c'est du bonus !_ 🎁`;
      await sendMessage(chatId, msg);
      return;
    }

    if (texte === '/synthese') {
      await envoyerSyntheseMensuelle();
      return;
    }

    if (texte === '/charges') {
      let msg = `🔒 *Charges fixes mensuelles*\n\n`;
      Object.entries(CHARGES_FIXES).forEach(([k, v]) => {
        msg += `• ${k} : ${v.toFixed(2)} €\n`;
      });
      msg += `\n💸 *Total : ${TOTAL_CHARGES_FIXES.toFixed(0)} €/mois*`;
      await sendMessage(chatId, msg);
      return;
    }

    // ── Mise à jour épargne ──────────────────────────────────
    if (texteLower.includes('épargne') || texteLower.includes('epargne') || texteLower.includes('économies')) {
      const match = texte.match(/(\d+([.,]\d{1,2})?)\s*€?/);
      if (match) {
        const montant = parseFloat(match[1].replace(',', '.'));
        if (montant > 1000) {
          await supabase.from('epargne').insert({ montant, libelle: texte, chat_id: chatId });
          await sendMessage(chatId, `✅ Épargne mise à jour : *${montant.toLocaleString()} €* 💎`);
          return;
        }
      }
    }

    // ── Saisie salaire LGM ───────────────────────────────────
    if (texteLower.includes('salaire') || texteLower.includes('lgm') || texteLower.includes('paie')) {
      const match = texte.match(/(\d+([.,]\d{1,2})?)\s*€?/);
      if (match) {
        const montant = parseFloat(match[1].replace(',', '.'));
        if (montant > 1000 && montant < 10000) {
          await supabase.from('salaires').insert({ montant, libelle: texte, chat_id: chatId });
          await sendMessage(chatId, `✅ Salaire LGM enregistré : *${montant} €* 📊`);
          return;
        }
      }
    }

    // ── Rentrée d'argent ─────────────────────────────────────
    if (texteLower.includes('reçu') || texteLower.includes('vinted') || texteLower.includes('remboursement') || texteLower.includes('rentrée') || texteLower.includes('participation')) {
      const match = texte.match(/(\d+([.,]\d{1,2})?)\s*€?/);
      if (match) {
        const montant = parseFloat(match[1].replace(',', '.'));
        await supabase.from('revenus').insert({ montant, libelle: texte, chat_id: chatId });
        await sendMessage(chatId, `✅ Rentrée de *+${montant} €* enregistrée !`);
        return;
      }
    }

    // ── Dépense ──────────────────────────────────────────────
    const depense = parseDepense(texte);
    if (depense) {
      await supabase.from('depenses').insert({ montant: depense.montant, categorie: depense.cat, libelle: texte, chat_id: chatId });
      const depenses = await getDepensesMois();
      const totaux = await getTotauxParCat(depenses);
      const restant = BUDGETS[depense.cat].max - totaux[depense.cat];
      const emoji = restant < 0 ? '🔴' : restant < BUDGETS[depense.cat].max * 0.2 ? '🟡' : '🟢';
      await sendMessage(chatId,
        `✅ *${depense.montant} €* — _${BUDGETS[depense.cat].label}_\n` +
        `${emoji} Restant : *${restant.toFixed(0)} €* / ${BUDGETS[depense.cat].max} €`
      );
      return;
    }

    // ── Question IA ──────────────────────────────────────────
    const ctx = await getContextFinancier();
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    const context =
      `Tu es L'Agent, assistant comptable personnel de Nour-Dine. Réponds en français, direct, bienveillant, 3-4 lignes max.\n` +
      `Situation ce mois :\n` +
      `- Salaire LGM : ${ctx.salaire} €\n` +
      `- Beau-frère : ${BEAU_FRERE} €\n` +
      `- Complétude : ${ctx.completude.toFixed(0)} € / ${OBJECTIF_COMPLETUDE} €\n` +
      `- Total revenus : ${ctx.totalRevenus.toFixed(0)} €\n` +
      `- Charges fixes : ${TOTAL_CHARGES_FIXES.toFixed(0)} €\n` +
      `- Dépenses variables : ${ctx.totalDep.toFixed(0)} €\n` +
      `- Solde estimé : ${ctx.solde.toFixed(0)} €\n` +
      `- Épargne actuelle : ${ctx.epargneBase.toLocaleString()} €\n` +
      `- Épargne estimée fin de mois : ${ctx.epargneEstimee.toFixed(0)} €\n` +
      `Budgets : ${Object.entries(ctx.totaux).map(([k,v]) => `${k}: ${v.toFixed(0)}€/${BUDGETS[k].max}€`).join(', ')}.\n` +
      `Objectifs : juin 12500€, août 15000€, jan2027 20000€.\n` +
      `Si on te demande si une dépense est possible, analyse le solde et les objectifs pour donner un conseil clair.`;

    await sendMessage(chatId, '🤔 *Analyse en cours...*');
    const result = await model.generateContent(context + '\n\nQuestion : ' + texte);
    await sendMessage(chatId, result.response.text());

  } catch (err) {
    console.error('Erreur:', err);
    await sendMessage(chatId, "❌ Une erreur s'est produite, réessaie dans quelques secondes.");
  }
});

// ============================================================
// FONCTION ENREGISTRER COURS
// ============================================================
async function enregistrerCours(chatId, cours, gain) {
  await supabase.from('cours').insert({ eleve: cours.nom, duree: cours.duree, taux: cours.taux, gain, chat_id: chatId });
  const coursMois = await getCoursMois();
  const totalCompletude = coursMois.reduce((s, c) => s + c.gain, 0);
  const manque = Math.max(0, OBJECTIF_COMPLETUDE - totalCompletude);
  const emoji = totalCompletude >= OBJECTIF_COMPLETUDE ? '🟢' : totalCompletude >= 1000 ? '🟡' : '🔴';
  await sendMessage(chatId,
    `✅ Cours avec *${cours.nom}* enregistré !\n` +
    `💰 Gain : *+${gain.toFixed(2)} €*\n\n` +
    `${emoji} Complétude ce mois : *${totalCompletude.toFixed(0)} €* / ${OBJECTIF_COMPLETUDE} €\n` +
    `${manque > 0 ? `⚠️ Il manque : *${manque.toFixed(0)} €*` : '🎉 Objectif atteint !'}`
  );
}

app.get('/', (req, res) => res.send("L'Agent est en ligne ! 🤖"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`L'Agent écoute sur le port ${PORT}`);
  demarrerScheduler();
});

module.exports = app;
