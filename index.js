const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);
const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const MODELE = 'gemini-3-flash-preview';

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

// Historique conversations par chat
const historiques = {};

// ============================================================
// TELEGRAM
// ============================================================
async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const MAX = 3800;

  const envoyer = async (t) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: t, parse_mode: 'Markdown' })
    });
    const json = await res.json();
    // Si erreur de parsing Markdown, renvoyer sans formatage
    if (!json.ok && json.description && json.description.includes('parse')) {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: t })
      });
    }
  };

  if (text.length <= MAX) { await envoyer(text); return; }

  let reste = text;
  while (reste.length > 0) {
    let coupe = reste.length > MAX ? reste.lastIndexOf('\n', MAX) : reste.length;
    if (coupe < MAX / 2) coupe = Math.min(MAX, reste.length);
    await envoyer(reste.slice(0, coupe));
    reste = reste.slice(coupe).trim();
    if (reste) await new Promise(r => setTimeout(r, 500));
  }
}

// ============================================================
// SUPABASE
// ============================================================
async function getData() {
  const debut = new Date();
  debut.setDate(1);
  debut.setUTCHours(0, 0, 0, 0);
  const iso = debut.toISOString();

  const [d1, d2, d3, d4, d5, d6] = await Promise.all([
    supabase.from('depenses').select('*').gte('created_at', iso),
    supabase.from('cours').select('*').gte('created_at', iso),
    supabase.from('cours_manques').select('*').gte('created_at', iso),
    supabase.from('revenus').select('*').gte('created_at', iso),
    supabase.from('salaires').select('*').gte('created_at', iso).order('created_at', { ascending: false }).limit(1),
    supabase.from('epargne').select('*').order('created_at', { ascending: false }).limit(1),
  ]);

  const depenses = d1.data || [];
  const cours = d2.data || [];
  const coursManques = d3.data || [];
  const revenus = d4.data || [];
  const salaire = d5.data?.length > 0 ? d5.data[0].montant : SALAIRE_LGM_DEFAULT;
  const epargneBase = d6.data?.length > 0 ? d6.data[0].montant : EPARGNE_DEPART;

  const totaux = {};
  Object.keys(BUDGETS).forEach(k => totaux[k] = 0);
  depenses.forEach(d => { if (totaux[d.categorie] !== undefined) totaux[d.categorie] += d.montant; });

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
// GÉNÉRATION FICHE D'EXERCICES
// ============================================================
async function genererFiche(nomEleve, chapitre) {
  const p = ELEVES[nomEleve];
  const model = genAI.getGenerativeModel({ model: MODELE });

  const regles = `REGLES IMPORTANTES:
- Texte brut uniquement, ZERO LaTeX ou symboles speciaux
- Fractions: ecrire "3/4", puissances: "x au carre", racines: "racine de 9"
- Maximum 600 mots total
- Exercices numerotes clairement: Exercice 1, Exercice 2...
- Corrige complet apres la ligne separatrice: === CORRIGE ===`;

  let prompt;

  if (p.ficheHebdo) {
    prompt = `Tu es professeur de mathematiques. Cree une fiche hebdomadaire pour ${nomEleve}, eleve de ${p.niveau}.
Chapitre travaille: ${chapitre}

${regles}

FORMAT:
LUNDI - Exercice 1: [enonce] / Exercice 2: [enonce]
MARDI - Exercice 3: [enonce] / Exercice 4: [enonce]
MERCREDI - Exercice 5: [enonce] / Exercice 6: [enonce]
JEUDI - Exercice 7: [enonce] / Exercice 8: [enonce]
VENDREDI - Exercice 9: [enonce] / Exercice 10: [enonce]

Puis: === CORRIGE === avec toutes les reponses.

Commence par: FICHE HEBDOMADAIRE - ${nomEleve} - ${chapitre}`;

  } else if (p.tda) {
    prompt = `Tu es professeur specialise dans l'accompagnement des eleves avec TDA/TDAH. Cree une fiche pour ${nomEleve}, eleve de ${p.niveau}.
Chapitre travaille: ${chapitre}

${regles}

CONSIGNES SPECIALES TDA:
- Maximum 4 exercices courts
- 1 seule consigne par exercice (1 phrase maximum)
- Beaucoup d'espace entre les exercices
- Enonces tres simples et directs

Commence par: FICHE TDA - ${nomEleve} - ${chapitre}`;

  } else {
    prompt = `Tu es professeur de mathematiques. Cree une fiche d'exercices pour ${nomEleve}, eleve de ${p.niveau}.
Chapitre travaille: ${chapitre}

${regles}

FORMAT:
- 4 exercices de difficulte progressive
- Adaptes au niveau ${p.niveau}
- Enonces clairs et precis

Commence par: FICHE - ${nomEleve} - ${chapitre}`;
  }

  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ============================================================
// CERVEAU IA — GEMINI GERE TOUT LE DIALOGUE
// ============================================================
async function cerveauIA(chatId, messageUtilisateur) {
  const data = await getData();

  if (!historiques[chatId]) historiques[chatId] = [];
  const histo = historiques[chatId];

  // Contexte financier complet
  const coursDetail = data.cours.map(c => `${c.eleve}: +${c.gain.toFixed(2)}€${c.rattrapage ? ' (rattrapage)' : ''}`).join(', ') || 'aucun';
  const manquesDetail = data.coursManques.map(c => `${c.eleve}: -${c.gain_manque.toFixed(2)}€`).join(', ') || 'aucun';
  const budgetDetail = Object.entries(data.totaux).map(([k, v]) => `${BUDGETS[k].label}: ${v.toFixed(0)}/${BUDGETS[k].max}€`).join(' | ');

  const systemPrompt = `Tu es L'Agent, l'assistant personnel intelligent de Nour-Dine. Tu es comme un ami proche : naturel, direct, bienveillant.

REGLES ABSOLUES:
1. Tu comprends TOUJOURS meme avec des fautes d'orthographe ou formulations approximatives
2. Tu poses UNE seule question a la fois quand tu as besoin d'info
3. Tu agis directement quand le contexte est clair sans demander de confirmation inutile
4. Tu es concis (3-5 lignes max) sauf si question complexe
5. Tu peux repondre a TOUT: finances, achats, prix marche francais, conseils de vie, formations
6. Tu ne mentionnes JAMAIS les balises action dans tes messages texte
7. Quand tu enregistres quelque chose, confirme-le naturellement dans ta reponse

PROFIL NOUR-DINE:
- Ingenieur cadre LGM (mission Thales), depart aout 2026 via rupture conventionnelle
- Co-fondateur Dyneos SAS (CFA formations pro)
- Tuteur Completude (11 eleves actifs)
- Formation formateur incendie: Fo.EPI juin 2026, SSIAP 1 juillet 2026
- Vit en Ile-de-France (Carrieres-sous-Poissy), en PACS
- Objectif independance via formation incendie + Completude + Dyneos

SITUATION FINANCIERE TEMPS REEL:
- Salaire LGM: ${data.salaire}€/mois${data.salaire === SALAIRE_LGM_DEFAULT ? ' (valeur par defaut, pas encore saisi ce mois)' : ''}
- Beau-frere: ${BEAU_FRERE}€/mois (jusquen novembre 2026)
- Completude ce mois: ${data.completude.toFixed(2)}€ / ${OBJECTIF_COMPLETUDE}€ objectif
- Total revenus: ${data.totalRevenus.toFixed(2)}€
- Charges fixes: ${TOTAL_CHARGES_FIXES.toFixed(2)}€/mois
- Depenses variables: ${data.totalDep.toFixed(2)}€
- Solde estime ce mois: ${data.solde.toFixed(2)}€
- Epargne actuelle: ${data.epargneBase.toLocaleString()}€
- Epargne projetee fin de mois: ${data.epargneEstimee.toFixed(2)}€
- Cours manques ce mois: ${data.coursManques.length} cours — -${data.totalManque.toFixed(2)}€

BUDGETS: ${budgetDetail}
COURS CE MOIS: ${coursDetail}
COURS MANQUES: ${manquesDetail}

ELEVES COMPLETUDE:
${Object.entries(ELEVES).map(([n, e]) => `- ${n}: ${e.taux}€/h, ${e.niveau}${e.tda ? ', TDA' : ''}${e.ficheHebdo ? ', fiche hebdo' : ''}${e.question2h ? ', seance 2h possible' : ', 1h fixe'}${!e.fiche ? ', pas de fiche' : ''}`).join('\n')}

ACTIONS QUE TU PEUX DECLENCER:
A la FIN de ta reponse texte, tu peux inclure UN bloc action entre balises si necessaire:

Pour enregistrer un cours fait:
<action>{"type":"cours_fait","eleve":"NomExact","heures":1,"rattrapage":false}</action>

Pour enregistrer un cours manque:
<action>{"type":"cours_manque","eleve":"NomExact"}</action>

Pour enregistrer une depense:
<action>{"type":"depense","montant":45.50,"categorie":"courses","libelle":"Leclerc"}</action>

Pour enregistrer le salaire:
<action>{"type":"salaire","montant":2625}</action>

Pour mettre a jour l'epargne:
<action>{"type":"epargne","montant":9500}</action>

Pour enregistrer une rentree d'argent:
<action>{"type":"revenu","montant":50,"libelle":"Vinted"}</action>

Pour generer une fiche d'exercices:
<action>{"type":"fiche","eleve":"NomExact","chapitre":"Fractions"}</action>

EXEMPLES DE COMPORTEMENT ATTENDU:
- "cours margaux" -> Tu demandes: fait ou pas? 
- "oui" -> Tu demandes: seance a 2h?
- "non 1h" -> Tu enregistres 1h et tu demandes ce qu'ils ont vu
- "fractions" -> Tu generes la fiche automatiquement
- "j'ai fait le plein 60€" -> Tu enregistres directement en essence
- "leclerc 45" -> Tu enregistres en courses
- "est ce que je peux m'offrir un velo?" -> Tu analyses le budget et tu conseilles`;

  // Construire messages pour l'API
  const messages = [];

  // Ajouter historique (max 15 echanges)
  const histoRecent = histo.slice(-15);
  for (const h of histoRecent) {
    messages.push({ role: h.role, parts: [{ text: h.content }] });
  }

  // Ajouter message actuel
  messages.push({ role: 'user', parts: [{ text: messageUtilisateur }] });

  // Appel Gemini avec startChat
  const model = genAI.getGenerativeModel({
    model: MODELE,
    systemInstruction: systemPrompt,
  });

  const chat = model.startChat({
    history: messages.slice(0, -1),
  });

  const result = await chat.sendMessage(messageUtilisateur);
  const reponseComplete = result.response.text();

  // Sauvegarder dans historique
  histo.push({ role: 'user', content: messageUtilisateur });
  histo.push({ role: 'model', content: reponseComplete });

  // Extraire action JSON
  const actionMatch = reponseComplete.match(/<action>([\s\S]*?)<\/action>/);
  const texteReponse = reponseComplete.replace(/<action>[\s\S]*?<\/action>/g, '').trim();

  let action = null;
  if (actionMatch) {
    try {
      action = JSON.parse(actionMatch[1].trim());
    } catch (e) {
      console.error('Erreur parsing action:', e.message);
    }
  }

  return { texteReponse, action, data };
}

// ============================================================
// TRAITER ACTION
// ============================================================
async function traiterAction(chatId, action, data) {
  if (!action) return;

  try {
    switch (action.type) {

      case 'cours_fait': {
        const eleve = action.eleve;
        if (!ELEVES[eleve]) {
          console.error('Eleve inconnu:', eleve);
          break;
        }
        const heures = action.heures || 1;
        const gain = await saveCours(chatId, eleve, heures, action.rattrapage || false);
        const newData = await getData();
        const manque = Math.max(0, OBJECTIF_COMPLETUDE - newData.completude);
        const pct = Math.min(100, Math.round((newData.completude / OBJECTIF_COMPLETUDE) * 100));
        const emoji = newData.completude >= OBJECTIF_COMPLETUDE ? '🟢' : newData.completude >= 1000 ? '🟡' : '🔴';
        await sendMessage(chatId,
          `✅ Cours ${eleve} enregistre !\n` +
          `💰 +${gain.toFixed(2)} €\n\n` +
          `${emoji} Completude: ${newData.completude.toFixed(0)}€ / ${OBJECTIF_COMPLETUDE}€ (${pct}%)\n` +
          `${manque > 0 ? `⚠️ Il manque: ${manque.toFixed(0)}€` : '🎉 Objectif atteint !'}`
        );
        break;
      }

      case 'cours_manque': {
        const eleve = action.eleve;
        if (!ELEVES[eleve]) break;
        const gain_manque = await saveCoursManque(chatId, eleve);
        const newData = await getData();
        await sendMessage(chatId,
          `❌ Cours ${eleve} non effectue\n` +
          `💸 Manque: -${gain_manque.toFixed(2)}€\n` +
          `📉 Total manque ce mois: -${newData.totalManque.toFixed(0)}€ (${newData.coursManques.length} cours)`
        );
        break;
      }

      case 'depense': {
        const cat = action.categorie || 'divers';
        if (!BUDGETS[cat]) break;
        await saveDepense(chatId, action.montant, cat, action.libelle || '');
        const newData = await getData();
        const restant = BUDGETS[cat].max - newData.totaux[cat];
        const emoji = restant < 0 ? '🔴' : restant < BUDGETS[cat].max * 0.2 ? '🟡' : '🟢';
        await sendMessage(chatId,
          `✅ ${action.montant}€ — ${BUDGETS[cat].label}\n` +
          `${emoji} Budget restant: ${restant.toFixed(0)}€ / ${BUDGETS[cat].max}€`
        );
        break;
      }

      case 'salaire': {
        await saveSalaire(chatId, action.montant);
        await sendMessage(chatId, `✅ Salaire LGM enregistre: ${action.montant}€ 📊`);
        break;
      }

      case 'epargne': {
        await saveEpargne(chatId, action.montant);
        await sendMessage(chatId, `✅ Epargne mise a jour: ${action.montant.toLocaleString()}€ 💎`);
        break;
      }

      case 'revenu': {
        await saveRevenu(chatId, action.montant, action.libelle || '');
        await sendMessage(chatId, `✅ Rentree +${action.montant}€ enregistree !`);
        break;
      }

      case 'fiche': {
        const eleve = action.eleve;
        if (!ELEVES[eleve]) break;
        if (!ELEVES[eleve].fiche) {
          await sendMessage(chatId, `Pas de fiche pour ${eleve}.`);
          break;
        }
        await sendMessage(chatId, `📝 Generation de la fiche pour ${eleve}...`);
        const fiche = await genererFiche(eleve, action.chapitre || 'Revision generale');
        await sendMessage(chatId, fiche);
        break;
      }

      default:
        console.log('Action inconnue:', action.type);
    }
  } catch (err) {
    console.error('Erreur traiterAction:', err.message);
  }
}

// ============================================================
// FONCTIONS SUPABASE
// ============================================================
async function saveCours(chatId, nomEleve, heures, rattrapage) {
  const p = ELEVES[nomEleve];
  const gain = p.taux * heures;
  await supabase.from('cours').insert({ eleve: nomEleve, duree: p.duree, taux: p.taux, gain, chat_id: chatId, rattrapage });
  return gain;
}

async function saveCoursManque(chatId, nomEleve) {
  const gain_manque = ELEVES[nomEleve].taux;
  await supabase.from('cours_manques').insert({ eleve: nomEleve, gain_manque, chat_id: chatId });
  return gain_manque;
}

async function saveDepense(chatId, montant, categorie, libelle) {
  await supabase.from('depenses').insert({ montant, categorie, libelle, chat_id: chatId });
}

async function saveSalaire(chatId, montant) {
  await supabase.from('salaires').insert({ montant, libelle: 'Salaire LGM', chat_id: chatId });
}

async function saveEpargne(chatId, montant) {
  await supabase.from('epargne').insert({ montant, libelle: 'Mise a jour epargne', chat_id: chatId });
}

async function saveRevenu(chatId, montant, libelle) {
  await supabase.from('revenus').insert({ montant, libelle, chat_id: chatId });
}

// ============================================================
// MESSAGES AUTOMATIQUES
// ============================================================
async function envoyerRappelBiHebdo() {
  const data = await getData();
  const mois = new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
  let msg = `📋 Rappel bi-hebdo — ${mois}\n\n`;
  msg += `💰 Revenus:\n• LGM: ${data.salaire}€\n• Beau-frere: ${BEAU_FRERE}€\n• Completude: ${data.completude.toFixed(0)}€ / ${OBJECTIF_COMPLETUDE}€\n\n`;
  msg += `💸 Depenses:\n`;
  Object.entries(data.totaux).forEach(([k, v]) => {
    if (v > 0) {
      const e = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
      msg += `${e} ${BUDGETS[k].label}: ${v.toFixed(0)}€ / ${BUDGETS[k].max}€\n`;
    }
  });
  msg += `\n📊 Solde estime: ${data.solde >= 0 ? '+' : ''}${data.solde.toFixed(0)}€`;
  if (data.totalManque > 0) msg += `\n💸 Cours manques: -${data.totalManque.toFixed(0)}€`;
  msg += `\n\nDes depenses ou rentrees a enregistrer ?`;
  await sendMessage(CHAT_ID, msg);
}

async function envoyerSyntheseMensuelle() {
  const data = await getData();
  const mois = new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' }).toUpperCase();
  let msg = `🗓️ SYNTHESE ${mois}\n\n`;
  msg += `✅ REVENUS: ${data.totalRevenus.toFixed(0)}€\n• LGM: ${data.salaire}€\n• Beau-frere: ${BEAU_FRERE}€\n• Completude: ${data.completude.toFixed(0)}€ (${data.cours.length} cours)\n`;
  if (data.revenusSupp > 0) msg += `• Autres: ${data.revenusSupp.toFixed(0)}€\n`;
  msg += `\n🔒 CHARGES: -${TOTAL_CHARGES_FIXES.toFixed(0)}€\n\n💸 DEPENSES: -${data.totalDep.toFixed(0)}€\n`;
  Object.entries(data.totaux).forEach(([k, v]) => {
    const e = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
    msg += `${e} ${BUDGETS[k].label}: ${v.toFixed(0)}€/${BUDGETS[k].max}€\n`;
  });
  if (data.coursManques.length > 0) {
    msg += `\n📉 COURS MANQUES: ${data.coursManques.length} cours — -${data.totalManque.toFixed(0)}€\n`;
    data.coursManques.forEach(c => { msg += `• ${c.eleve}: -${c.gain_manque.toFixed(2)}€\n`; });
  }
  msg += `\n💰 SOLDE NET: ${data.solde >= 0 ? '+' : ''}${data.solde.toFixed(0)}€\n\n🎯 OBJECTIFS EPARGNE:\n`;
  OBJECTIFS.forEach(o => {
    const delta = data.epargneEstimee - o.montant;
    const pct = Math.min(100, Math.round((data.epargneEstimee / o.montant) * 100));
    msg += `${delta >= 0 ? '✅' : '⚠️'} ${o.label}: ${o.montant.toLocaleString()}€ — ${pct}% (${delta >= 0 ? '+' : ''}${delta.toFixed(0)}€)\n`;
  });
  await sendMessage(CHAT_ID, msg);
}

// ============================================================
// SCHEDULER
// ============================================================
function estSemaineSerena() {
  const debut = new Date('2026-05-10');
  return Math.floor((new Date() - debut) / (7 * 24 * 60 * 60 * 1000)) % 2 === 0;
}

function demarrerScheduler() {
  // Keep-alive
  setInterval(() => {
    fetch(`https://budget-bot-production-eaaf.up.railway.app/`).catch(() => {});
  }, 4 * 60 * 1000);

  setInterval(async () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const jour = now.getDay();
    const heure = now.getHours();
    const minute = now.getMinutes();

    // Rappels mercredi et dimanche a 20h
    if ((jour === 3 || jour === 0) && heure === 20 && minute === 0) {
      await envoyerRappelBiHebdo();
    }

    // Synthese le 30 a 20h
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
        // L'IA demarre la conversation naturellement
        const { texteReponse, action, data } = await cerveauIA(
          CHAT_ID,
          `[SYSTEME] Le cours de ${nomEleve} vient de se terminer a l'instant. Demande naturellement a Nour-Dine s'il a bien fait ce cours aujourd'hui.`
        );
        await sendMessage(CHAT_ID, texteReponse);
        if (action) await traiterAction(CHAT_ID, action, data);
      }
    }
  }, 60000);
}

// ============================================================
// API DASHBOARD
// ============================================================
app.get('/api/dashboard', async (req, res) => {
  try {
    const data = await getData();
    res.json({
      salaire: data.salaire,
      beau_frere: BEAU_FRERE,
      completude: data.completude,
      objectif_completude: OBJECTIF_COMPLETUDE,
      total_revenus: data.totalRevenus,
      charges_fixes: TOTAL_CHARGES_FIXES,
      total_dep: data.totalDep,
      solde: data.solde,
      epargne_base: data.epargneBase,
      epargne_estimee: data.epargneEstimee,
      total_manque: data.totalManque,
      nb_cours: data.cours.length,
      nb_cours_manques: data.coursManques.length,
      cours: data.cours,
      cours_manques: data.coursManques,
      totaux: data.totaux,
      budgets: BUDGETS,
      objectifs: OBJECTIFS,
      charges_detail: CHARGES_FIXES,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DASHBOARD HTML
// ============================================================
app.get('/dashboard', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>L'Agent — Dashboard</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#0f0f13; color:#e8e8f0; min-height:100vh; padding:1rem; }
.header { text-align:center; padding:1.2rem 0 0.8rem; }
.header h1 { font-size:1.3rem; font-weight:700; color:#fff; }
.header p { font-size:0.7rem; color:#555; margin-top:3px; }
.tabs { display:flex; gap:4px; max-width:420px; margin:0.8rem auto; background:#1a1a22; border-radius:12px; padding:4px; }
.tab { flex:1; text-align:center; padding:6px 4px; font-size:0.68rem; border-radius:8px; cursor:pointer; color:#555; transition:all 0.2s; }
.tab.active { background:#2a2a36; color:#fff; font-weight:600; }
.section { display:none; max-width:420px; margin:0 auto; }
.section.active { display:block; }
.grid { display:grid; grid-template-columns:1fr 1fr; gap:0.6rem; }
.card { background:#1a1a22; border-radius:14px; padding:0.9rem; border:1px solid #22222e; }
.card.full { grid-column:1/-1; }
.label { font-size:0.62rem; text-transform:uppercase; letter-spacing:0.07em; color:#555; margin-bottom:5px; }
.value { font-size:1.5rem; font-weight:700; }
.sub { font-size:0.65rem; color:#555; margin-top:3px; }
.green { color:#4ade80; }
.amber { color:#fbbf24; }
.red { color:#f87171; }
.bar { height:5px; background:#22222e; border-radius:3px; overflow:hidden; margin:7px 0 3px; }
.fill { height:100%; border-radius:3px; transition:width 0.5s; }
.row { display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid #22222e; font-size:0.78rem; }
.row:last-child { border-bottom:none; }
.mini-bar { width:50px; height:4px; background:#22222e; border-radius:2px; overflow:hidden; }
.mini-fill { height:100%; border-radius:2px; }
.obj { padding:9px 0; border-bottom:1px solid #22222e; }
.obj:last-child { border-bottom:none; }
.obj-header { display:flex; justify-content:space-between; font-size:0.78rem; margin-bottom:5px; }
.cours-row { display:flex; justify-content:space-between; font-size:0.72rem; padding:4px 0; border-bottom:1px solid #22222e; }
.cours-row:last-child { border-bottom:none; }
.refresh { position:fixed; bottom:1.2rem; right:1.2rem; background:#6366f1; color:#fff; border:none; border-radius:50%; width:44px; height:44px; font-size:1.1rem; cursor:pointer; box-shadow:0 3px 10px rgba(99,102,241,0.4); }
.updated { text-align:center; font-size:0.62rem; color:#333; padding:1rem 0 4rem; }
</style>
</head>
<body>
<div class="header">
  <h1>🤖 L'Agent</h1>
  <p id="mois">Chargement...</p>
</div>

<div class="tabs">
  <div class="tab active" onclick="setTab('apercu')">Apercu</div>
  <div class="tab" onclick="setTab('completude')">Completude</div>
  <div class="tab" onclick="setTab('budgets')">Budgets</div>
  <div class="tab" onclick="setTab('objectifs')">Objectifs</div>
</div>

<div class="section active" id="tab-apercu">
  <div class="grid">
    <div class="card"><div class="label">Epargne actuelle</div><div class="value green" id="a-epargne">—</div><div class="sub">Sur le compte</div></div>
    <div class="card"><div class="label">Projection fin mois</div><div class="value" id="a-proj">—</div><div class="sub">Avec solde estimé</div></div>
    <div class="card"><div class="label">Revenus ce mois</div><div class="value green" id="a-rev">—</div></div>
    <div class="card"><div class="label">Depenses variables</div><div class="value red" id="a-dep">—</div></div>
    <div class="card full">
      <div class="label">Solde estime ce mois</div>
      <div class="value" id="a-solde">—</div>
      <div class="bar"><div class="fill" id="a-solde-bar" style="width:0%"></div></div>
      <div class="sub" id="a-solde-detail">—</div>
    </div>
    <div class="card full">
      <div class="label">Completude ce mois</div>
      <div class="value" id="a-comp">—</div>
      <div class="bar"><div class="fill" id="a-comp-bar" style="width:0%"></div></div>
      <div class="sub" id="a-comp-sub">—</div>
    </div>
  </div>
</div>

<div class="section" id="tab-completude">
  <div class="grid">
    <div class="card"><div class="label">Cours effectues</div><div class="value green" id="c-nb">—</div></div>
    <div class="card"><div class="label">Cours manques</div><div class="value red" id="c-manq">—</div><div class="sub" id="c-manq-val">—</div></div>
    <div class="card full" id="c-cours-card">
      <div class="label" style="margin-bottom:10px">Detail des cours</div>
      <div id="c-cours">—</div>
    </div>
    <div class="card full" id="c-manques-card" style="display:none">
      <div class="label" style="margin-bottom:10px">Cours manques</div>
      <div id="c-manques-list">—</div>
    </div>
  </div>
</div>

<div class="section" id="tab-budgets">
  <div class="grid">
    <div class="card full" id="b-list"><div class="label">Chargement...</div></div>
  </div>
</div>

<div class="section" id="tab-objectifs">
  <div class="grid">
    <div class="card full" id="o-list"><div class="label">Chargement...</div></div>
  </div>
</div>

<button class="refresh" onclick="charger()">↻</button>
<div class="updated" id="updated">—</div>

<script>
function setTab(t) {
  document.querySelectorAll('.tab').forEach((el,i)=>el.classList.toggle('active',['apercu','completude','budgets','objectifs'][i]===t));
  document.querySelectorAll('.section').forEach(el=>el.classList.remove('active'));
  document.getElementById('tab-'+t).classList.add('active');
}

function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' €'; }
function pct(v,m) { return Math.min(100,Math.round(v/m*100)); }
function col(p) { return p>=100?'#f87171':p>=80?'#fbbf24':'#4ade80'; }
function colSolde(v) { return v>=500?'#4ade80':v>=0?'#fbbf24':'#f87171'; }

async function charger() {
  try {
    const r = await fetch('/api/dashboard');
    const d = await r.json();

    const mois = new Date().toLocaleString('fr-FR',{month:'long',year:'numeric'});
    document.getElementById('mois').textContent = mois.charAt(0).toUpperCase()+mois.slice(1);

    // APERCU
    document.getElementById('a-epargne').textContent = fmt(d.epargne_base);
    const proj = document.getElementById('a-proj');
    proj.textContent = fmt(d.epargne_estimee);
    proj.className = 'value ' + (d.epargne_estimee>=12500?'green':d.epargne_estimee>=10000?'amber':'red');
    document.getElementById('a-rev').textContent = fmt(d.total_revenus);
    document.getElementById('a-dep').textContent = '-'+fmt(d.total_dep);

    const soldeEl = document.getElementById('a-solde');
    soldeEl.textContent = (d.solde>=0?'+':'')+fmt(d.solde);
    soldeEl.className = 'value';
    soldeEl.style.color = colSolde(d.solde);
    const sp = Math.min(100,Math.max(0,(d.solde/1500)*100));
    document.getElementById('a-solde-bar').style.cssText = 'width:'+sp+'%;background:'+colSolde(d.solde);
    document.getElementById('a-solde-detail').textContent = fmt(d.total_revenus)+' - '+fmt(d.charges_fixes)+' - '+fmt(d.total_dep);

    const cp = pct(d.completude, d.objectif_completude);
    const compEl = document.getElementById('a-comp');
    compEl.textContent = fmt(d.completude);
    compEl.style.color = col(cp);
    document.getElementById('a-comp-bar').style.cssText = 'width:'+cp+'%;background:'+col(cp);
    document.getElementById('a-comp-sub').textContent = fmt(d.completude)+' / '+fmt(d.objectif_completude)+' ('+cp+'%)';

    // COMPLETUDE
    document.getElementById('c-nb').textContent = d.nb_cours;
    document.getElementById('c-manq').textContent = d.nb_cours_manques;
    document.getElementById('c-manq-val').textContent = '-'+fmt(d.total_manque)+' manques';

    const coursList = document.getElementById('c-cours');
    coursList.innerHTML = d.cours.length===0
      ? '<div style="color:#555;font-size:0.72rem;padding:6px 0">Aucun cours ce mois</div>'
      : d.cours.map(c=>'<div class="cours-row"><span>'+c.eleve+(c.rattrapage?' <span style="color:#555">(rattrapage)</span>':'')+'</span><span class="green">+'+c.gain.toFixed(2)+' €</span></div>').join('');

    if(d.nb_cours_manques>0){
      document.getElementById('c-manques-card').style.display='block';
      document.getElementById('c-manques-list').innerHTML = d.cours_manques.map(c=>'<div class="cours-row"><span>'+c.eleve+'</span><span class="red">-'+c.gain_manque.toFixed(2)+' €</span></div>').join('');
    }

    // BUDGETS
    const bl = document.getElementById('b-list');
    bl.innerHTML = '<div class="label" style="margin-bottom:10px">Depenses variables</div>';
    Object.entries(d.totaux).forEach(([k,v])=>{
      const b=d.budgets[k]; const p=pct(v,b.max); const c=col(p);
      bl.innerHTML+='<div class="row"><span>'+b.label+'</span><div style="display:flex;align-items:center;gap:8px"><div class="mini-bar"><div class="mini-fill" style="width:'+p+'%;background:'+c+'"></div></div><span style="color:'+c+';min-width:75px;text-align:right">'+v.toFixed(0)+'€ / '+b.max+'€</span></div></div>';
    });

    // OBJECTIFS
    const ol = document.getElementById('o-list');
    ol.innerHTML = '<div class="label" style="margin-bottom:10px">Progression epargne</div>';
    d.objectifs.forEach(o=>{
      const p=pct(d.epargne_estimee,o.montant); const c=col(p);
      const delta=Math.round(d.epargne_estimee-o.montant);
      ol.innerHTML+='<div class="obj"><div class="obj-header"><span>'+(delta>=0?'✅':'⚠️')+' '+o.label+'</span><span style="color:'+c+'">'+(delta>=0?'+':'')+delta.toLocaleString()+' €</span></div><div class="bar"><div class="fill" style="width:'+p+'%;background:'+c+'"></div></div><div style="display:flex;justify-content:space-between;font-size:0.62rem;color:#555;margin-top:3px"><span>'+Math.round(d.epargne_estimee).toLocaleString()+' €</span><span>'+o.montant.toLocaleString()+' €</span></div></div>';
    });

    document.getElementById('updated').textContent = 'Actualise a '+new Date().toLocaleTimeString('fr-FR');
  } catch(e) {
    console.error(e);
    document.getElementById('updated').textContent = 'Erreur de chargement';
  }
}

charger();
setInterval(charger, 30000);
</script>
</body>
</html>`);
});

// ============================================================
// ROUTES
// ============================================================
app.get('/', (req, res) => res.send("L'Agent est en ligne ! 🤖"));

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const body = req.body;
  const msg = body.message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const texte = msg.text.trim();

  try {
    // Reset conversation
    if (texte === '/reset') {
      historiques[chatId] = [];
      await sendMessage(chatId, 'Conversation reinitialisee !');
      return;
    }

    // Start
    if (texte === '/start') {
      historiques[chatId] = [];
      await sendMessage(chatId,
        'Salut Nour-Dine ! Je suis L\'Agent, ton assistant personnel.\n\n' +
        'Parle-moi naturellement — je comprends tout !\n\n' +
        'Exemples:\n' +
        'J\'ai fait le plein 60€\n' +
        'Cours avec Margaux ce matin\n' +
        'Est-ce que je peux m\'offrir un velo ?\n' +
        'Montre-moi mon bilan\n\n' +
        'Dashboard temps reel:\nhttps://budget-bot-production-eaaf.up.railway.app/dashboard\n\n' +
        '/reset pour reinitialiser la conversation'
      );
      return;
    }

    // Tout passe par Gemini
    const { texteReponse, action, data } = await cerveauIA(chatId, texte);
    if (texteReponse) await sendMessage(chatId, texteReponse);
    if (action) await traiterAction(chatId, action, data);

  } catch (err) {
    console.error('Erreur webhook:', err.message, err.stack);
    await sendMessage(chatId, 'Erreur technique, reessaie dans quelques secondes.');
  }
});

// ============================================================
// DEMARRAGE
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`L'Agent ecoute sur le port ${PORT}`);
  demarrerScheduler();
});

module.exports = app;
