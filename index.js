const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);
const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const MODELE = 'gemini-3-flash-preview';

const SALAIRE_LGM_DEFAULT = 2500;
const BEAU_FRERE = 320;
const OBJECTIF_COMPLETUDE = 1500;
const EPARGNE_DEPART = 7000;

const BUDGETS = {
  essence:  { label: 'Essence',  max: 300 },
  courses:  { label: 'Courses',  max: 500 },
  restos:   { label: 'Restos',   max: 80  },
  sante:    { label: 'Sante',    max: 60  },
  maison:   { label: 'Maison',   max: 50  },
  voiture:  { label: 'Voiture',  max: 50  },
  shopping: { label: 'Shopping', max: 50  },
  loisirs:  { label: 'Loisirs',  max: 50  },
  divers:   { label: 'Divers',   max: 50  },
};

const OBJECTIFS = [
  { label: 'Fin juin 2026', montant: 12500 },
  { label: 'Fin aout 2026', montant: 15000 },
  { label: 'Janvier 2027',  montant: 20000 },
];

const JOURS_NOM = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];

const sessions = {};
const sessionsFiches = {};
const sessionsEleves = {};

async function send(chatId, text) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const MAX = 3800;
  const post = async (t) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: String(chatId), text: t, parse_mode: 'Markdown' })
    });
    const j = await r.json();
    if (!j.ok) {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: String(chatId), text: t })
      });
    }
  };
  if (text.length <= MAX) { await post(text); return; }
  let reste = text;
  while (reste.length > 0) {
    let c = reste.length > MAX ? reste.lastIndexOf('\n', MAX) : reste.length;
    if (c < MAX / 2) c = Math.min(MAX, reste.length);
    await post(reste.slice(0, c));
    reste = reste.slice(c).trim();
    if (reste) await new Promise(r => setTimeout(r, 500));
  }
}

async function sendBtns(chatId, text, buttons) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: String(chatId), text, parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons.map(row => row.map(b => ({ text: b.t, callback_data: b.d }))) }
    })
  });
}

async function answerCB(id) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: id })
  });
}

async function removeBtns(chatId, msgId) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: String(chatId), message_id: msgId, reply_markup: { inline_keyboard: [] } })
  });
}

async function sendDoc(chatId, filePath, filename) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', fs.createReadStream(filePath), { filename });
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendDocument`, {
    method: 'POST', body: form, headers: form.getHeaders()
  });
}

async function getEleves() {
  const { data } = await supabase.from('eleves').select('*').eq('actif', true).order('jour').order('heure');
  return data || [];
}

async function getData(mois, annee) {
  const now = new Date();
  const m = mois !== undefined ? mois : now.getMonth();
  const y = annee !== undefined ? annee : now.getFullYear();
  const debut = new Date(y, m, 1, 0, 0, 0, 0);
  const fin = new Date(y, m + 1, 1, 0, 0, 0, 0);

  const [d1, d2, d3, d4, d5, d6, d7] = await Promise.all([
    supabase.from('depenses').select('*').gte('created_at', debut.toISOString()).lt('created_at', fin.toISOString()),
    supabase.from('cours').select('*').gte('created_at', debut.toISOString()).lt('created_at', fin.toISOString()),
    supabase.from('cours_manques').select('*').gte('created_at', debut.toISOString()).lt('created_at', fin.toISOString()),
    supabase.from('revenus').select('*').gte('created_at', debut.toISOString()).lt('created_at', fin.toISOString()),
    supabase.from('salaires').select('*').gte('created_at', debut.toISOString()).lt('created_at', fin.toISOString()).order('created_at', { ascending: false }).limit(1),
    supabase.from('epargne').select('*').order('created_at', { ascending: false }).limit(1),
    supabase.from('prelevements').select('*').eq('actif', true).order('jour_mois'),
  ]);

  const depenses = d1.data || [];
  const cours = d2.data || [];
  const coursManques = d3.data || [];
  const revenus = d4.data || [];
  const salaire = d5.data?.length > 0 ? d5.data[0].montant : SALAIRE_LGM_DEFAULT;
  const epargneBase = d6.data?.length > 0 ? d6.data[0].montant : EPARGNE_DEPART;
  const prelevements = d7.data || [];
  const totalCharges = prelevements.filter(p => p.frequence === 'mensuel').reduce((s, p) => s + p.montant, 0);

  const totaux = {};
  Object.keys(BUDGETS).forEach(k => totaux[k] = 0);
  depenses.forEach(d => { if (totaux[d.categorie] !== undefined) totaux[d.categorie] += d.montant; });

  const totalDep = Object.values(totaux).reduce((a, b) => a + b, 0);
  const completude = cours.reduce((s, c) => s + c.gain, 0);
  const totalManque = coursManques.reduce((s, c) => s + c.gain_manque, 0);
  const revenusSupp = revenus.reduce((s, r) => s + r.montant, 0);
  const totalRevenus = salaire + BEAU_FRERE + completude + revenusSupp;
  const solde = totalRevenus - totalCharges - totalDep;
  const epargneEstimee = epargneBase + solde;

  return { depenses, cours, coursManques, revenus, totaux, totalDep, completude, totalManque, revenusSupp, totalRevenus, solde, epargneEstimee, salaire, epargneBase, prelevements, totalCharges, mois: m, annee: y };
}

async function saveCours(chatId, eleve, heures, rattrapage) {
  const gain = eleve.taux * heures;
  const { error } = await supabase.from('cours').insert({ eleve: eleve.nom, duree: eleve.duree, taux: eleve.taux, gain, chat_id: String(chatId), rattrapage });
  if (error) console.error('saveCours:', error.message);
  return gain;
}

async function saveCoursManque(chatId, eleve) {
  const gain_manque = eleve.taux * eleve.duree;
  const { error } = await supabase.from('cours_manques').insert({ eleve: eleve.nom, gain_manque, chat_id: String(chatId) });
  if (error) console.error('saveCoursManque:', error.message);
  return gain_manque;
}

async function saveDepense(chatId, montant, categorie, libelle) {
  const { error } = await supabase.from('depenses').insert({ montant, categorie, libelle, chat_id: String(chatId) });
  if (error) console.error('saveDepense:', error.message);
}

async function saveSalaire(chatId, montant) {
  const { error } = await supabase.from('salaires').insert({ montant, libelle: 'Salaire LGM', chat_id: String(chatId) });
  if (error) console.error('saveSalaire:', error.message);
}

async function saveEpargne(chatId, montant) {
  const { error } = await supabase.from('epargne').insert({ montant, libelle: 'Epargne', chat_id: String(chatId) });
  if (error) console.error('saveEpargne:', error.message);
}

async function saveRevenu(chatId, montant, libelle) {
  const { error } = await supabase.from('revenus').insert({ montant, libelle, chat_id: String(chatId) });
  if (error) console.error('saveRevenu:', error.message);
}

async function annulerDernierCours(nom) {
  const debut = new Date(); debut.setDate(1); debut.setHours(0,0,0,0);
  const { data } = await supabase.from('cours').select('id').eq('eleve', nom).gte('created_at', debut.toISOString()).order('created_at', { ascending: false }).limit(1);
  if (data?.length > 0) { await supabase.from('cours').delete().eq('id', data[0].id); return true; }
  return false;
}

async function annulerDernierCoursManque(nom) {
  const debut = new Date(); debut.setDate(1); debut.setHours(0,0,0,0);
  const { data } = await supabase.from('cours_manques').select('id').eq('eleve', nom).gte('created_at', debut.toISOString()).order('created_at', { ascending: false }).limit(1);
  if (data?.length > 0) { await supabase.from('cours_manques').delete().eq('id', data[0].id); return true; }
  return false;
}

async function annulerDerniereDepense(cat) {
  const debut = new Date(); debut.setDate(1); debut.setHours(0,0,0,0);
  const { data } = await supabase.from('depenses').select('id,montant,libelle').eq('categorie', cat).gte('created_at', debut.toISOString()).order('created_at', { ascending: false }).limit(1);
  if (data?.length > 0) { await supabase.from('depenses').delete().eq('id', data[0].id); return data[0]; }
  return null;
}

async function resumeCompletude(chatId) {
  const data = await getData();
  const manque = Math.max(0, OBJECTIF_COMPLETUDE - data.completude);
  const pct = Math.min(100, Math.round((data.completude / OBJECTIF_COMPLETUDE) * 100));
  const emoji = data.completude >= OBJECTIF_COMPLETUDE ? 'OK' : data.completude >= 1000 ? 'Bien' : 'Attention';
  await send(chatId, `Completude: *${data.completude.toFixed(0)} EUR* / ${OBJECTIF_COMPLETUDE} EUR (${pct}%) - ${emoji}\n${manque > 0 ? `Il manque: *${manque.toFixed(0)} EUR*` : 'Objectif atteint!'}`);
}

function trouverMontant(texte) {
  const m = texte.match(/(\d+([.,]\d{1,2})?)\s*EUR?/i) || texte.match(/(\d+([.,]\d{1,2})?)/);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

function trouverCategorie(texte) {
  const t = texte.toLowerCase();
  if (/essence|plein|carburant|station|total|esso/.test(t)) return 'essence';
  if (/leclerc|courses|carrefour|lidl|cora|supermarche|aldi|marche/.test(t)) return 'courses';
  if (/resto|restaurant|mcdo|burger|pizza|kebab|sushi/.test(t)) return 'restos';
  if (/medecin|pharmacie|docteur|sante|doctolib|kine/.test(t)) return 'sante';
  if (/ikea|maison|bricolage|castorama|leroy/.test(t)) return 'maison';
  if (/garage|voiture|reparation|pneu|peage/.test(t)) return 'voiture';
  if (/vetement|zara|shopping|coiffeur|hm/.test(t)) return 'shopping';
  if (/cinema|loisir|concert|sport|sortie/.test(t)) return 'loisirs';
  return null;
}

async function trouverEleves(texte) {
  const eleves = await getEleves();
  const t = texte.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return eleves.filter(e => t.includes(e.nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
}

async function genererContenuFiche(eleve, chapitre) {
  const model = genAI.getGenerativeModel({ model: MODELE });
  const regles = 'REGLES: texte brut, fractions 3/4, puissances x^2, max 600 mots, corrige apres === CORRIGE ===';
  let prompt = '';
  if (eleve.fiche_hebdo) {
    prompt = `Professeur maths. Fiche hebdo pour ${eleve.nom} (${eleve.niveau}). Chapitre: ${chapitre}. ${regles}. Lundi-Vendredi 2 exos/jour.`;
  } else if (eleve.tda) {
    prompt = `Professeur TDA. Fiche pour ${eleve.nom} (${eleve.niveau}). Chapitre: ${chapitre}. ${regles}. Max 4 exos courts.`;
  } else {
    prompt = `Professeur maths. Fiche pour ${eleve.nom} (${eleve.niveau}). Chapitre: ${chapitre}. ${regles}. 4 exos progressifs niveau ${eleve.niveau}.`;
  }
  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function creerPDF(eleve, chapitre, contenu) {
  const tmpPath = path.join('/tmp', `fiche_${eleve.nom}_${Date.now()}.pdf`);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(tmpPath);
    doc.pipe(stream);
    doc.rect(0, 0, doc.page.width, 80).fill('#0D1B2A');
    doc.fillColor('white').fontSize(18).font('Helvetica-Bold').text("L'Agent - Fiche d'exercices", 40, 20);
    doc.fontSize(11).font('Helvetica').text(`${eleve.nom} - ${eleve.niveau} - ${chapitre}`, 40, 48).text(new Date().toLocaleDateString('fr-FR'), 40, 62);
    doc.fillColor('#333333').moveDown(3);
    const lignes = contenu.split('\n');
    let dansCorrige = false;
    for (const ligne of lignes) {
      if (ligne.trim() === '') { doc.moveDown(0.4); continue; }
      if (ligne.startsWith('=== CORRIGE ===')) {
        doc.moveDown(1);
        doc.rect(40, doc.y, doc.page.width - 80, 1).fill('#F26419');
        doc.moveDown(0.5);
        doc.fillColor('#F26419').fontSize(13).font('Helvetica-Bold').text('CORRIGE', 40, doc.y);
        doc.fillColor('#333333'); dansCorrige = true; doc.moveDown(0.5); continue;
      }
      if (/^(LUNDI|MARDI|MERCREDI|JEUDI|VENDREDI)$/i.test(ligne.trim())) {
        doc.moveDown(0.5);
        doc.fillColor('#0D1B2A').fontSize(12).font('Helvetica-Bold').text(ligne.trim(), 40, doc.y);
        doc.fillColor('#333333'); continue;
      }
      if (/^exercice\s*\d+/i.test(ligne.trim())) {
        doc.moveDown(0.3);
        doc.fillColor(dansCorrige ? '#2E7D32' : '#0D1B2A').fontSize(11).font('Helvetica-Bold').text(ligne.trim(), 40, doc.y, { width: doc.page.width - 80 });
        doc.fillColor('#333333'); continue;
      }
      doc.fontSize(10).font('Helvetica').text(ligne, 40, doc.y, { width: doc.page.width - 80 });
    }
    const pageBottom = doc.page.height - 30;
    doc.rect(0, pageBottom - 10, doc.page.width, 40).fill('#0D1B2A');
    doc.fillColor('white').fontSize(8).font('Helvetica').text("Genere par L'Agent - Completude", 40, pageBottom, { align: 'center', width: doc.page.width - 80 });
    doc.end();
    stream.on('finish', () => resolve(tmpPath));
    stream.on('error', reject);
  });
}

async function envoyerRappelBiHebdo() {
  const data = await getData();
  const mois = new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
  let msg = `Rappel bi-hebdo - ${mois}\n\nLGM: ${data.salaire}EUR | Beau-frere: ${BEAU_FRERE}EUR | Completude: ${data.completude.toFixed(0)}EUR/${OBJECTIF_COMPLETUDE}EUR\n\nDepenses:\n`;
  Object.entries(data.totaux).forEach(([k, v]) => {
    if (v > 0) {
      const e = v > BUDGETS[k].max ? '[DEPASSE]' : v > BUDGETS[k].max * 0.8 ? '[Attention]' : '[OK]';
      msg += `${e} ${BUDGETS[k].label}: ${v.toFixed(0)}/${BUDGETS[k].max}EUR\n`;
    }
  });
  msg += `\nSolde: *${data.solde >= 0 ? '+' : ''}${data.solde.toFixed(0)}EUR*`;
  if (data.totalManque > 0) msg += `\nManques: *-${data.totalManque.toFixed(0)}EUR*`;
  msg += '\n\nDes depenses a enregistrer?';
  await send(CHAT_ID, msg);
}

async function envoyerSyntheseMensuelle() {
  const data = await getData();
  const mois = new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' }).toUpperCase();
  let msg = `SYNTHESE ${mois}\n\nREVENUS: ${data.totalRevenus.toFixed(0)}EUR\n- LGM: ${data.salaire}EUR\n- Beau-frere: ${BEAU_FRERE}EUR\n- Completude: ${data.completude.toFixed(0)}EUR\n`;
  msg += `\nCHARGES: -${data.totalCharges.toFixed(0)}EUR\n\nDEPENSES: -${data.totalDep.toFixed(0)}EUR\n`;
  Object.entries(data.totaux).forEach(([k, v]) => {
    msg += `${BUDGETS[k].label}: ${v.toFixed(0)}/${BUDGETS[k].max}EUR\n`;
  });
  msg += `\nSOLDE: ${data.solde >= 0 ? '+' : ''}${data.solde.toFixed(0)}EUR\n\nOBJECTIFS:\n`;
  OBJECTIFS.forEach(o => {
    const delta = data.epargneEstimee - o.montant;
    msg += `${delta >= 0 ? 'OK' : 'PAS OK'} ${o.label}: ${o.montant.toLocaleString()}EUR (${delta >= 0 ? '+' : ''}${delta.toFixed(0)}EUR)\n`;
  });
  await send(CHAT_ID, msg);
}

function estSemaineSerena() {
  const debut = new Date('2026-05-10');
  return Math.floor((new Date() - debut) / (7 * 24 * 60 * 60 * 1000)) % 2 === 0;
}

async function demarrerScheduler() {
  setInterval(() => {
    fetch('https://budget-bot-production-eaaf.up.railway.app/').catch(() => {});
  }, 4 * 60 * 1000);

  setInterval(async () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const jour = now.getDay(), heure = now.getHours(), minute = now.getMinutes();
    if ((jour === 3 || jour === 0) && heure === 20 && minute === 0) await envoyerRappelBiHebdo();
    if (now.getDate() === 30 && heure === 20 && minute === 0) await envoyerSyntheseMensuelle();
    const eleves = await getEleves();
    for (const eleve of eleves) {
      if (eleve.jour !== jour) continue;
      if (eleve.une_semaine_sur_deux && !estSemaineSerena()) continue;
      const totalMin = eleve.minute + Math.floor(eleve.duree * 60);
      const heureFin = eleve.heure + Math.floor(totalMin / 60);
      const minuteFin = totalMin % 60;
      if (heure === heureFin && minute === minuteFin) {
        sessions[CHAT_ID] = { eleve, rattrapage: false, etape: 'confirmation', fileAttente: [] };
        await sendBtns(CHAT_ID, `Fin de cours!\n\nAs-tu fait cours avec *${eleve.nom}* ?`,
          [[{ t: 'Oui', d: 'cours_oui' }, { t: 'Non', d: 'cours_non' }], [{ t: 'Annuler', d: 'annuler' }]]
        );
      }
    }
  }, 60000);
}

async function traiterCallback(cb) {
  const chatId = cb.message.chat.id;
  const msgId = cb.message.message_id;
  const data = cb.data;
  await answerCB(cb.id);
  await removeBtns(chatId, msgId);
  const session = sessions[chatId] || {};

  if (data === 'annuler') { delete sessions[chatId]; await send(chatId, 'Action annulee.'); return; }

  if (data === 'cours_oui' || data === 'cours_non') {
    const eleve = session.eleve;
    if (!eleve) return;
    if (data === 'cours_non') {
      const gainManque = await saveCoursManque(chatId, eleve);
      await send(chatId, `Cours ${eleve.nom} non effectue - Manque: -${gainManque.toFixed(2)}EUR`);
      if (session.fileAttente?.length > 0) {
        const next = session.fileAttente[0];
        sessions[chatId] = { eleve: next, rattrapage: false, etape: 'confirmation', fileAttente: session.fileAttente.slice(1) };
        await sendBtns(chatId, `Cours suivant - *${next.nom}* - effectue?`, [[{ t: 'Oui', d: 'cours_oui' }, { t: 'Non', d: 'cours_non' }], [{ t: 'Annuler', d: 'annuler' }]]);
      } else { delete sessions[chatId]; }
      return;
    }
    if (eleve.question_2h) {
      sessions[chatId] = { ...session, etape: 'question2h' };
      await sendBtns(chatId, `Cours avec *${eleve.nom}* - C etait la seance a 2h?`, [[{ t: '2h (1ere seance)', d: 'h2' }, { t: '1h (suivante)', d: 'h1' }], [{ t: 'Annuler', d: 'annuler' }]]);
    } else {
      const gain = await saveCours(chatId, eleve, eleve.duree, session.rattrapage || false);
      await send(chatId, `Cours ${eleve.nom} enregistre! +${gain.toFixed(2)}EUR`);
      await resumeCompletude(chatId);
      if (session.fileAttente?.length > 0) {
        const next = session.fileAttente[0];
        sessions[chatId] = { eleve: next, rattrapage: false, etape: 'confirmation', fileAttente: session.fileAttente.slice(1) };
        await sendBtns(chatId, `Cours suivant - *${next.nom}* - effectue?`, [[{ t: 'Oui', d: 'cours_oui' }, { t: 'Non', d: 'cours_non' }], [{ t: 'Annuler', d: 'annuler' }]]);
      } else { delete sessions[chatId]; }
    }
    return;
  }

  if (data === 'h2' || data === 'h1') {
    const eleve = session.eleve;
    if (!eleve) return;
    const heures = data === 'h2' ? 2 : 1;
    const gain = await saveCours(chatId, eleve, heures, session.rattrapage || false);
    await send(chatId, `Cours ${eleve.nom} enregistre! +${gain.toFixed(2)}EUR`);
    await resumeCompletude(chatId);
    if (session.fileAttente?.length > 0) {
      const next = session.fileAttente[0];
      sessions[chatId] = { eleve: next, rattrapage: false, etape: 'confirmation', fileAttente: session.fileAttente.slice(1) };
      await sendBtns(chatId, `Cours suivant - *${next.nom}* - effectue?`, [[{ t: 'Oui', d: 'cours_oui' }, { t: 'Non', d: 'cours_non' }], [{ t: 'Annuler', d: 'annuler' }]]);
    } else { delete sessions[chatId]; }
    return;
  }

  if (data.startsWith('sel_eleve_')) {
    const elevId = parseInt(data.replace('sel_eleve_', ''));
    const eleves = await getEleves();
    const eleve = eleves.find(e => e.id === elevId);
    if (eleve) {
      sessions[chatId] = { eleve, rattrapage: false, etape: 'confirmation', fileAttente: [] };
      await sendBtns(chatId, `Cours avec *${eleve.nom}* - effectue?`, [[{ t: 'Oui', d: 'cours_oui' }, { t: 'Non', d: 'cours_non' }], [{ t: 'Annuler', d: 'annuler' }]]);
    }
    return;
  }

  if (data.startsWith('cat_')) {
    const cat = data.replace('cat_', '');
    const montant = session.montant;
    if (!montant) return;
    await saveDepense(chatId, montant, cat, session.libelle || '');
    const newData = await getData();
    const restant = BUDGETS[cat].max - newData.totaux[cat];
    const emoji = restant < 0 ? 'DEPASSE' : 'OK';
    delete sessions[chatId];
    await send(chatId, `${montant}EUR - ${BUDGETS[cat].label} [${emoji}]\nRestant: ${restant.toFixed(0)}EUR / ${BUDGETS[cat].max}EUR`);
    return;
  }

  if (data.startsWith('annul_cours_')) {
    const nom = data.replace('annul_cours_', '');
    const ok = await annulerDernierCours(nom);
    await send(chatId, ok ? `Dernier cours de *${nom}* annule!` : `Aucun cours de ${nom} ce mois.`);
    return;
  }
  if (data.startsWith('annul_manque_')) {
    const nom = data.replace('annul_manque_', '');
    const ok = await annulerDernierCoursManque(nom);
    await send(chatId, ok ? `Dernier cours manque de *${nom}* annule!` : `Aucun cours manque de ${nom} ce mois.`);
    return;
  }
  if (data.startsWith('annul_dep_')) {
    const cat = data.replace('annul_dep_', '');
    const item = await annulerDerniereDepense(cat);
    await send(chatId, item ? `Derniere depense ${BUDGETS[cat].label} annulee! (${item.libelle} - ${item.montant.toFixed(2)}EUR)` : `Aucune depense ${BUDGETS[cat].label} ce mois.`);
    return;
  }

  if (data === 'annul_type_cours') {
    const eleves = await getEleves();
    const rows = [];
    for (let i = 0; i < eleves.length; i += 3) rows.push(eleves.slice(i, i+3).map(e => ({ t: e.nom, d: `annul_cours_${e.nom}` })));
    rows.push([{ t: 'Retour', d: 'annuler' }]);
    await sendBtns(chatId, 'Annuler cours de quel eleve?', rows);
    return;
  }
  if (data === 'annul_type_manque') {
    const eleves = await getEleves();
    const rows = [];
    for (let i = 0; i < eleves.length; i += 3) rows.push(eleves.slice(i, i+3).map(e => ({ t: e.nom, d: `annul_manque_${e.nom}` })));
    rows.push([{ t: 'Retour', d: 'annuler' }]);
    await sendBtns(chatId, 'Annuler cours manque de quel eleve?', rows);
    return;
  }
  if (data === 'annul_type_depense') {
    const cats = Object.entries(BUDGETS);
    const rows = [];
    for (let i = 0; i < cats.length; i += 3) rows.push(cats.slice(i, i+3).map(([k, b]) => ({ t: b.label, d: `annul_dep_${k}` })));
    rows.push([{ t: 'Retour', d: 'annuler' }]);
    await sendBtns(chatId, 'Annuler quelle depense?', rows);
    return;
  }

  if (data.startsWith('fiche_eleve_')) {
    const elevId = parseInt(data.replace('fiche_eleve_', ''));
    const eleves = await getEleves();
    const eleve = eleves.find(e => e.id === elevId);
    if (eleve) {
      sessionsFiches[chatId] = { eleve, etape: 'attente_chapitre' };
      await send(chatId, `Fiche pour *${eleve.nom}* (${eleve.niveau})\n\nQuel chapitre as-tu vu?\n_Ex: Fractions, Pythagore, Equations..._`);
    }
    return;
  }
  if (data === 'fiche_annuler') { delete sessionsFiches[chatId]; await send(chatId, 'Generation annulee.'); return; }

  if (data.startsWith('ne_niveau_')) {
    const niveau = data.replace('ne_niveau_', '');
    sessionsEleves[chatId] = { ...sessionsEleves[chatId], niveau, etape: 'taux' };
    await send(chatId, `Niveau *${niveau}* OK\n\nQuel est son taux horaire Completude? (ex: 24.50)`);
    return;
  }
  if (data.startsWith('ne_jour_')) {
    const jour = parseInt(data.replace('ne_jour_', ''));
    sessionsEleves[chatId] = { ...sessionsEleves[chatId], jour, etape: 'heure' };
    await send(chatId, `Jour *${JOURS_NOM[jour]}* OK\n\nHeure de debut? (ex: 14h30 ou 17h)`);
    return;
  }
  if (data.startsWith('ne_duree_')) {
    const duree = parseFloat(data.replace('ne_duree_', ''));
    sessionsEleves[chatId] = { ...sessionsEleves[chatId], duree, etape: 'tda' };
    await sendBtns(chatId, `Duree *${duree}h* OK\n\nEleve avec TDA?`, [[{ t: 'Oui TDA', d: 'ne_tda_true' }, { t: 'Non', d: 'ne_tda_false' }]]);
    return;
  }
  if (data === 'ne_tda_true' || data === 'ne_tda_false') {
    const tda = data === 'ne_tda_true';
    sessionsEleves[chatId] = { ...sessionsEleves[chatId], tda, etape: 'fiche_hebdo' };
    await sendBtns(chatId, `TDA: *${tda ? 'Oui' : 'Non'}* OK\n\nFiche hebdomadaire (lundi-vendredi)?`, [[{ t: 'Oui hebdo', d: 'ne_hebdo_true' }, { t: 'Non standard', d: 'ne_hebdo_false' }]]);
    return;
  }
  if (data === 'ne_hebdo_true' || data === 'ne_hebdo_false') {
    const ficheHebdo = data === 'ne_hebdo_true';
    sessionsEleves[chatId] = { ...sessionsEleves[chatId], ficheHebdo, etape: 'question2h' };
    await sendBtns(chatId, `Format: *${ficheHebdo ? 'Hebdo' : 'Standard'}* OK\n\nSeance a 2h possible?`, [[{ t: 'Oui 2h', d: 'ne_2h_true' }, { t: 'Non fixe', d: 'ne_2h_false' }]]);
    return;
  }
  if (data === 'ne_2h_true' || data === 'ne_2h_false') {
    const q2h = data === 'ne_2h_true';
    const s = sessionsEleves[chatId];
    const { error } = await supabase.from('eleves').insert({
      nom: s.nom, niveau: s.niveau, taux: s.taux, duree: s.duree,
      tda: s.tda, fiche_hebdo: s.ficheHebdo, question_2h: q2h,
      fiche: true, jour: s.jour, heure: s.heure, minute: s.minute,
      une_semaine_sur_deux: false, actif: true
    });
    delete sessionsEleves[chatId];
    if (error) { await send(chatId, `Erreur: ${error.message}`); }
    else { await send(chatId, `*${s.nom}* ajoute! Niveau: ${s.niveau} | ${s.taux}EUR/h | ${JOURS_NOM[s.jour]} ${s.heure}h${s.minute > 0 ? s.minute : ''}`); }
    return;
  }

  if (data.startsWith('prel_del_')) {
    const id = parseInt(data.replace('prel_del_', ''));
    await supabase.from('prelevements').update({ actif: false }).eq('id', id);
    await send(chatId, 'Prelevement desactive!');
    return;
  }

  if (data === 'prel_ajouter') {
    sessions[chatId] = { etape: 'prel_nom' };
    await send(chatId, 'Nom du prelevement?');
    return;
  }
}

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const body = req.body;
  if (body.callback_query) {
    await traiterCallback(body.callback_query).catch(e => console.error('CB:', e.message));
    return;
  }
  const msg = body.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const texte = msg.text.trim();
  const session = sessions[chatId] || {};

  try {
    if (sessionsFiches[chatId]?.etape === 'attente_chapitre') {
      const eleve = sessionsFiches[chatId].eleve;
      delete sessionsFiches[chatId];
      await send(chatId, `Generation fiche pour *${eleve.nom}*...`);
      const contenu = await genererContenuFiche(eleve, texte);
      const pdfPath = await creerPDF(eleve, texte, contenu);
      await sendDoc(chatId, pdfPath, `fiche_${eleve.nom}_${texte.replace(/ /g,'_')}.pdf`);
      fs.unlinkSync(pdfPath);
      return;
    }

    if (sessionsEleves[chatId]?.etape === 'taux') {
      const taux = parseFloat(texte.replace(',', '.'));
      if (taux > 0) {
        sessionsEleves[chatId] = { ...sessionsEleves[chatId], taux, etape: 'jour' };
        await sendBtns(chatId, `Taux *${taux}EUR/h* OK\n\nJour du cours?`, [
          [{ t: 'Lundi', d: 'ne_jour_1' }, { t: 'Mardi', d: 'ne_jour_2' }, { t: 'Mercredi', d: 'ne_jour_3' }],
          [{ t: 'Jeudi', d: 'ne_jour_4' }, { t: 'Vendredi', d: 'ne_jour_5' }],
          [{ t: 'Samedi', d: 'ne_jour_6' }, { t: 'Dimanche', d: 'ne_jour_0' }],
        ]);
      } else { await send(chatId, 'Envoie un nombre valide ex: 24.50'); }
      return;
    }

    if (sessionsEleves[chatId]?.etape === 'heure') {
      const match = texte.match(/(\d{1,2})[h:\s]?(\d{0,2})/);
      if (match) {
        const heure = parseInt(match[1]);
        const minute = match[2] ? parseInt(match[2]) : 0;
        sessionsEleves[chatId] = { ...sessionsEleves[chatId], heure, minute, etape: 'duree' };
        await sendBtns(chatId, `Heure *${heure}h${minute > 0 ? minute : ''}* OK\n\nDuree?`, [[{ t: '1h', d: 'ne_duree_1' }, { t: '1h30', d: 'ne_duree_1.5' }, { t: '2h', d: 'ne_duree_2' }]]);
      } else { await send(chatId, 'Format invalide. Ex: 14h30 ou 17h'); }
      return;
    }

    if (sessionsEleves[chatId]?.etape === 'nom') {
      sessionsEleves[chatId] = { nom: texte.trim(), etape: 'niveau' };
      await sendBtns(chatId, `Prenom *${texte.trim()}* OK\n\nQuel niveau?`, [
        [{ t: 'CE2', d: 'ne_niveau_CE2' }, { t: 'CM1', d: 'ne_niveau_CM1' }, { t: 'CM2', d: 'ne_niveau_CM2' }],
        [{ t: '6e', d: 'ne_niveau_6e' }, { t: '5e', d: 'ne_niveau_5e' }, { t: '4e', d: 'ne_niveau_4e' }],
        [{ t: '3e', d: 'ne_niveau_3e' }, { t: '2de', d: 'ne_niveau_2de' }, { t: '1re', d: 'ne_niveau_1re' }],
        [{ t: 'Term', d: 'ne_niveau_Term' }, { t: 'Sup', d: 'ne_niveau_Sup' }],
      ]);
      return;
    }

    if (session.etape === 'prel_nom') {
      sessions[chatId] = { ...session, prel_nom: texte, etape: 'prel_montant' };
      await send(chatId, `Prelevement *${texte}* - Quel montant?`);
      return;
    }
    if (session.etape === 'prel_montant') {
      const montant = parseFloat(texte.replace(',', '.'));
      if (montant > 0) {
        sessions[chatId] = { ...session, prel_montant: montant, etape: 'prel_jour' };
        await send(chatId, `Montant *${montant}EUR* OK - Quel jour du mois? (1-31, ou "?" si inconnu)`);
      } else { await send(chatId, 'Montant invalide'); }
      return;
    }
    if (session.etape === 'prel_jour') {
      const jour = texte === '?' ? null : parseInt(texte);
      await supabase.from('prelevements').insert({ nom: session.prel_nom, montant: session.prel_montant, jour_mois: jour, frequence: 'mensuel', actif: true });
      delete sessions[chatId];
      await send(chatId, `Prelevement *${session.prel_nom}* ajoute! ${session.prel_montant}EUR${jour ? ' le ' + jour : ''}`);
      return;
    }

    if (session.etape === 'attente_montant' && session.cat) {
      const montant = trouverMontant(texte);
      if (montant) {
        await saveDepense(chatId, montant, session.cat, texte);
        const newData = await getData();
        const restant = BUDGETS[session.cat].max - newData.totaux[session.cat];
        delete sessions[chatId];
        await send(chatId, `${montant}EUR - ${BUDGETS[session.cat].label}\nRestant: ${restant.toFixed(0)}EUR / ${BUDGETS[session.cat].max}EUR`);
      } else { await send(chatId, 'Envoie juste le montant ex: 45'); }
      return;
    }

    if (texte === '/start') {
      delete sessions[chatId];
      await send(chatId,
        `Salut Nour-Dine! Je suis L'Agent.\n\n` +
        `/cours - signaler un cours\n` +
        `/depense - saisir une depense\n` +
        `/revenus - voir/ajouter revenus\n` +
        `/prelevements - gerer prelevements\n` +
        `/nouvel_eleve - ajouter un eleve\n` +
        `/fiche - generer une fiche PDF\n` +
        `/annuler - annuler une action\n` +
        `/objectifs - progression epargne\n` +
        `/bilan - depenses du mois\n` +
        `/completude - revenus Completude\n` +
        `/synthese - bilan complet\n\n` +
        `Dashboard: https://budget-bot-production-eaaf.up.railway.app/dashboard\n\n` +
        `Ou parle-moi naturellement!`
      );
      return;
    }

    if (texte === '/reset') { delete sessions[chatId]; await send(chatId, 'Conversation reinitialisee!'); return; }

    if (texte === '/bilan') {
      const data = await getData();
      let msg = `Bilan ${new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' })}\n\n`;
      Object.entries(data.totaux).forEach(([k, v]) => {
        const e = v > BUDGETS[k].max ? '[DEPASSE]' : v > BUDGETS[k].max * 0.8 ? '[Attention]' : '[OK]';
        msg += `${e} ${BUDGETS[k].label}: ${v.toFixed(0)}/${BUDGETS[k].max}EUR\n`;
      });
      msg += `\nSolde: *${data.solde >= 0 ? '+' : ''}${data.solde.toFixed(0)}EUR*`;
      await send(chatId, msg);
      return;
    }

    if (texte === '/completude') {
      const data = await getData();
      const manque = Math.max(0, OBJECTIF_COMPLETUDE - data.completude);
      const pct = Math.min(100, Math.round((data.completude / OBJECTIF_COMPLETUDE) * 100));
      let msg = `Completude ${new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' })}\n\n`;
      msg += `*${data.completude.toFixed(2)}EUR* / ${OBJECTIF_COMPLETUDE}EUR (${pct}%)\n`;
      msg += manque > 0 ? `Il manque: *${manque.toFixed(0)}EUR*\n` : `Objectif atteint!\n`;
      if (data.cours.length > 0) {
        msg += '\nDetail:\n';
        data.cours.forEach(c => { msg += `- ${c.eleve}${c.rattrapage ? ' (rattrapage)' : ''}: +${c.gain.toFixed(2)}EUR\n`; });
      }
      if (data.coursManques.length > 0) {
        msg += '\nManques:\n';
        data.coursManques.forEach(c => { msg += `- ${c.eleve}: -${c.gain_manque.toFixed(2)}EUR\n`; });
      }
      await send(chatId, msg);
      return;
    }

    if (texte === '/objectifs') {
      const data = await getData();
      let msg = `Objectifs epargne\n\nActuelle: *${data.epargneBase.toLocaleString()}EUR*\nProjection: *${data.epargneEstimee.toFixed(0)}EUR*\n\n`;
      OBJECTIFS.forEach(o => {
        const delta = data.epargneEstimee - o.montant;
        const pct = Math.min(100, Math.round((data.epargneEstimee / o.montant) * 100));
        msg += `${delta >= 0 ? 'OK' : 'PAS OK'} *${o.label}*: ${o.montant.toLocaleString()}EUR - ${pct}%\n`;
      });
      await send(chatId, msg);
      return;
    }

    if (texte === '/synthese') { await envoyerSyntheseMensuelle(); return; }

    if (texte === '/cours') {
      const eleves = await getEleves();
      const rows = [];
      for (let i = 0; i < eleves.length; i += 3) rows.push(eleves.slice(i, i+3).map(e => ({ t: e.nom, d: `sel_eleve_${e.id}` })));
      rows.push([{ t: 'Annuler', d: 'annuler' }]);
      await sendBtns(chatId, 'Quel eleve?', rows);
      return;
    }

    if (texte === '/depense') {
      const cats = Object.entries(BUDGETS);
      const rows = [];
      for (let i = 0; i < cats.length; i += 3) rows.push(cats.slice(i, i+3).map(([k, b]) => ({ t: b.label, d: `cat_${k}` })));
      rows.push([{ t: 'Annuler', d: 'annuler' }]);
      sessions[chatId] = { etape: 'choix_cat' };
      await sendBtns(chatId, 'Quelle categorie?', rows);
      return;
    }

    if (texte === '/revenus') {
      const data = await getData();
      let msg = `Revenus - ${new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' })}\n\n`;
      msg += `- Salaire LGM: *${data.salaire}EUR*${data.salaire === SALAIRE_LGM_DEFAULT ? ' (par defaut)' : ''}\n`;
      msg += `- Beau-frere: *${BEAU_FRERE}EUR*\n`;
      msg += `- Completude: *${data.completude.toFixed(0)}EUR*\n`;
      if (data.revenus.length > 0) {
        msg += '\nAutres rentrees:\n';
        data.revenus.forEach(r => { msg += `- ${r.libelle}: +${r.montant.toFixed(2)}EUR\n`; });
      }
      msg += `\n*Total: ${data.totalRevenus.toFixed(0)}EUR*\n\nPour ajouter: "Remboursement mutuelle 35EUR"`;
      await send(chatId, msg);
      return;
    }

    if (texte === '/annuler') {
      await sendBtns(chatId, 'Que veux-tu annuler?', [
        [{ t: 'Cours effectue', d: 'annul_type_cours' }],
        [{ t: 'Cours manque', d: 'annul_type_manque' }],
        [{ t: 'Depense', d: 'annul_type_depense' }],
        [{ t: 'Fermer', d: 'annuler' }]
      ]);
      return;
    }

    if (texte === '/prelevements') {
      const data = await getData();
      const today = new Date().getDate();
      let msg = `Prelevements - ${new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' })}\n\n`;
      const passes = data.prelevements.filter(p => p.jour_mois && p.jour_mois <= today);
      const avenir = data.prelevements.filter(p => p.jour_mois && p.jour_mois > today);
      const sansDate = data.prelevements.filter(p => !p.jour_mois);
      if (passes.length > 0) { msg += 'Passes:\n'; passes.forEach(p => { msg += `- ${p.nom}: ${p.montant.toFixed(2)}EUR (le ${p.jour_mois})\n`; }); }
      if (avenir.length > 0) { msg += '\nA venir:\n'; avenir.forEach(p => { msg += `- ${p.nom}: ${p.montant.toFixed(2)}EUR - le ${p.jour_mois}\n`; }); }
      if (sansDate.length > 0) { msg += '\nDate inconnue:\n'; sansDate.forEach(p => { msg += `- ${p.nom}: ${p.montant.toFixed(2)}EUR\n`; }); }
      const totalMensuel = data.prelevements.filter(p => p.frequence === 'mensuel').reduce((s, p) => s + p.montant, 0);
      const montantAvenir = avenir.reduce((s, p) => s + p.montant, 0);
      msg += `\n*Total mensuel: ${totalMensuel.toFixed(0)}EUR*`;
      msg += `\nSolde apres prelevements a venir: *${(data.solde - montantAvenir).toFixed(0)}EUR*`;
      await sendBtns(chatId, msg, [[{ t: 'Ajouter un prelevement', d: 'prel_ajouter' }, { t: 'Fermer', d: 'annuler' }]]);
      return;
    }

    if (texte === '/nouvel_eleve') {
      sessionsEleves[chatId] = { etape: 'nom' };
      await send(chatId, 'Nouvel eleve\n\nQuel est son prenom?');
      return;
    }

    if (texte === '/fiche') {
      const eleves = await getEleves();
      const elevesAvecFiche = eleves.filter(e => e.fiche);
      const rows = [];
      for (let i = 0; i < elevesAvecFiche.length; i += 3) rows.push(elevesAvecFiche.slice(i, i+3).map(e => ({ t: e.nom, d: `fiche_eleve_${e.id}` })));
      rows.push([{ t: 'Annuler', d: 'fiche_annuler' }]);
      await sendBtns(chatId, 'Fiche pour quel eleve?', rows);
      return;
    }

    const elevesDetectes = await trouverEleves(texte);
    const isCours = /cours|rattrapage|seance/i.test(texte);
    const isPasFait = /pas fait|absent|annule|pas pu|rate|manque/i.test(texte);

    if (elevesDetectes.length > 0 && isCours) {
      const rattrapage = /rattrapage/i.test(texte);
      const premier = elevesDetectes[0];
      const fileAttente = elevesDetectes.slice(1);
      if (isPasFait) {
        for (const el of elevesDetectes) {
          const gm = await saveCoursManque(chatId, el);
          await send(chatId, `Cours ${el.nom} non effectue - Manque: -${gm.toFixed(2)}EUR`);
        }
        return;
      }
      sessions[chatId] = { eleve: premier, rattrapage, etape: 'confirmation', fileAttente };
      await sendBtns(chatId, `Cours avec *${premier.nom}*${rattrapage ? ' (rattrapage)' : ''} - effectue?`, [[{ t: 'Oui', d: 'cours_oui' }, { t: 'Non', d: 'cours_non' }], [{ t: 'Annuler', d: 'annuler' }]]);
      return;
    }

    const montant = trouverMontant(texte);
    const cat = trouverCategorie(texte);

    if (montant && montant > 0 && montant < 5000 && !isCours) {
      if (cat) {
        await saveDepense(chatId, montant, cat, texte);
        const newData = await getData();
        const restant = BUDGETS[cat].max - newData.totaux[cat];
        await send(chatId, `${montant}EUR - ${BUDGETS[cat].label}\nRestant: ${restant.toFixed(0)}EUR / ${BUDGETS[cat].max}EUR`);
      } else {
        sessions[chatId] = { montant, libelle: texte, etape: 'choix_cat' };
        const cats = Object.entries(BUDGETS);
        const rows = [];
        for (let i = 0; i < cats.length; i += 3) rows.push(cats.slice(i, i+3).map(([k, b]) => ({ t: b.label, d: `cat_${k}` })));
        rows.push([{ t: 'Annuler', d: 'annuler' }]);
        await sendBtns(chatId, `${montant}EUR - Quelle categorie?`, rows);
      }
      return;
    }

    if (/salaire|lgm|paie/i.test(texte) && montant && montant > 1000) { await saveSalaire(chatId, montant); await send(chatId, `Salaire LGM: *${montant}EUR*`); return; }
    if (/epargne|economies/i.test(texte) && montant && montant > 100) { await saveEpargne(chatId, montant); await send(chatId, `Epargne mise a jour: *${montant.toLocaleString()}EUR*`); return; }
    if (/recu|remboursement|rentree|virement|mutuelle|participation/i.test(texte) && montant) { await saveRevenu(chatId, montant, texte); await send(chatId, `Rentree *+${montant}EUR* enregistree!`); return; }

    const data = await getData();
    const model = genAI.getGenerativeModel({ model: MODELE });
    const ctx = `Tu es L'Agent, assistant de Nour-Dine. Naturel, direct, 4 lignes max en francais.\nFinances: LGM ${data.salaire}EUR, Completude ${data.completude.toFixed(0)}EUR/${OBJECTIF_COMPLETUDE}EUR, Solde ${data.solde.toFixed(0)}EUR, Epargne ${data.epargneBase}EUR`;
    const result = await model.generateContent(ctx + '\n\nMessage: ' + texte);
    await send(chatId, result.response.text());

  } catch (err) {
    console.error('Webhook error:', err.message);
    await send(chatId, 'Erreur technique, reessaie.');
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const mois = req.query.mois !== undefined ? parseInt(req.query.mois) : undefined;
    const annee = req.query.annee !== undefined ? parseInt(req.query.annee) : undefined;
    const data = await getData(mois, annee);
    const eleves = await getEleves();
    res.json({
      salaire: data.salaire, beau_frere: BEAU_FRERE,
      completude: data.completude, objectif_completude: OBJECTIF_COMPLETUDE,
      total_revenus: data.totalRevenus, charges_fixes: data.totalCharges,
      total_dep: data.totalDep, solde: data.solde,
      epargne_base: data.epargneBase, epargne_estimee: data.epargneEstimee,
      total_manque: data.totalManque, nb_cours: data.cours.length,
      nb_cours_manques: data.coursManques.length,
      cours: data.cours, cours_manques: data.coursManques,
      totaux: data.totaux, budgets: BUDGETS, objectifs: OBJECTIFS,
      prelevements: data.prelevements, revenus: data.revenus,
      eleves, depenses: data.depenses, mois: data.mois, annee: data.annee
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/dashboard', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>L'Agent</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#080810;color:#e0e0f0;min-height:100vh;padding:0.75rem}
.hdr{display:flex;align-items:center;justify-content:space-between;padding:0.8rem 0 1rem}
.hdr h1{font-size:1.1rem;font-weight:600;color:#fff;letter-spacing:-0.3px}
.hdr p{font-size:0.62rem;color:#444;margin-top:2px}
.nav{display:flex;align-items:center;gap:6px}
.nb{background:#13131f;border:0.5px solid #222235;border-radius:8px;color:#888;padding:5px 10px;cursor:pointer;font-size:12px;transition:all 0.15s}
.nb:hover{background:#1a1a2e;color:#aaa}
.ml{font-size:11px;font-weight:500;color:#c0c0e0;min-width:95px;text-align:center}
.tabs{display:flex;gap:3px;background:#0d0d18;border-radius:10px;padding:3px;margin-bottom:12px;border:0.5px solid #181828}
.tab{flex:1;text-align:center;padding:6px 2px;font-size:10px;border-radius:7px;cursor:pointer;color:#444;transition:all 0.15s;border:none;background:transparent;font-weight:500}
.tab.active{background:#1a1a2e;color:#a0a0ff;border:0.5px solid #282850}
.sec{display:none}.sec.active{display:block}
.g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:8px}
.card{background:#0e0e1a;border:0.5px solid #1a1a2e;border-radius:12px;padding:12px;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px}
.ct::before{background:#1D9E75}.cb::before{background:#378ADD}
.ca::before{background:#EF9F27}.cr::before{background:#E24B4A}
.cp::before{background:#7F77DD}.cg::before{background:#888}
.full{grid-column:1/-1}
.lbl{font-size:10px;text-transform:uppercase;letter-spacing:0.07em;color:#444;margin-bottom:5px;font-weight:500}
.val{font-size:1.3rem;font-weight:600}
.sub{font-size:10px;color:#333;margin-top:3px}
.pill{display:inline-flex;align-items:center;font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px}
.pg{background:#0a2a1a;color:#5DCAA5}.pa{background:#2a1800;color:#EF9F27}
.pr{background:#2a0808;color:#E24B4A}.pb{background:#081a2a;color:#378ADD}
.bar{height:4px;background:#151525;border-radius:2px;overflow:hidden;margin:8px 0 3px}
.fill{height:100%;border-radius:2px;transition:width 0.6s ease}
.row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:0.5px solid #131320;font-size:11px;cursor:pointer;transition:all 0.1s;border-radius:0}
.row:hover{background:#111120;padding:7px 4px;border-radius:5px}
.row:last-child{border-bottom:none}
.mb{width:42px;height:3px;background:#151525;border-radius:2px;overflow:hidden}
.mf{height:100%;border-radius:2px}
.obj{padding:10px 0;border-bottom:0.5px solid #131320}
.obj:last-child{border-bottom:none}
.ot{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;font-size:12px}
.cr2{display:flex;justify-content:space-between;font-size:11px;padding:5px 0;border-bottom:0.5px solid #131320}
.cr2:last-child{border-bottom:none}
.pr2{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:0.5px solid #131320;font-size:11px}
.pr2:last-child{border-bottom:none}
.dot{width:6px;height:6px;border-radius:50%;display:inline-block;margin-right:5px;flex-shrink:0}
.dp{display:none;background:#0a0a15;border:0.5px solid #1a1a30;border-radius:6px;padding:8px;margin-top:5px;font-size:10px}
.dp.open{display:block}
.dr{display:flex;justify-content:space-between;padding:3px 0;border-bottom:0.5px solid #111120;color:#888}
.dr:last-child{border-bottom:none}
.upd{text-align:center;font-size:10px;color:#1e1e30;padding:10px 0 4rem}
.btn{display:block;width:100%;padding:10px;background:#0e0e1a;border:0.5px solid #202035;border-radius:10px;font-size:11px;color:#666;cursor:pointer;margin-top:10px;text-align:center;transition:all 0.15s}
.btn:hover{background:#131325;color:#888}
.stl{font-size:10px;font-weight:600;color:#333;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:10px}
.big{font-size:1.7rem;font-weight:600}
.cw{height:160px;position:relative;margin-top:10px}
.cw2{height:180px;position:relative;margin-top:10px}
</style>
</head>
<body>
<div class="hdr">
  <div><h1>L'Agent</h1><p id="mois-lbl">Chargement...</p></div>
  <div class="nav">
    <button class="nb" onclick="chgMois(-1)">&#8249;</button>
    <div class="ml" id="nav-m">—</div>
    <button class="nb" onclick="chgMois(1)">&#8250;</button>
  </div>
</div>
<div class="tabs">
  <button class="tab active" onclick="setTab('a')">Apercu</button>
  <button class="tab" onclick="setTab('c')">Completude</button>
  <button class="tab" onclick="setTab('b')">Budgets</button>
  <button class="tab" onclick="setTab('o')">Objectifs</button>
  <button class="tab" onclick="setTab('p')">Prelev.</button>
</div>

<div class="sec active" id="tab-a">
  <div class="g2">
    <div class="card full ct">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div><div class="lbl">Epargne actuelle</div><div class="big" id="a-ep" style="color:#5DCAA5">—</div><div class="sub">Sur le compte</div></div>
        <span class="pill" id="a-ep-p">—</span>
      </div>
      <div class="bar"><div class="fill" id="a-ep-b" style="width:0%"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:#333"><span>0</span><span id="a-obj-l">—</span></div>
    </div>
    <div class="card cb"><div class="lbl">Revenus</div><div class="val" id="a-rv" style="color:#378ADD">—</div><div class="sub" id="a-rv-s">—</div></div>
    <div class="card cr"><div class="lbl">Depenses</div><div class="val" id="a-dp" style="color:#E24B4A">—</div><div class="sub" id="a-dp-s">—</div></div>
    <div class="card full ca">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div class="lbl" style="margin:0">Solde estime</div><span class="pill" id="a-sl-p">—</span></div>
      <div class="val" id="a-sl">—</div><div class="bar"><div class="fill" id="a-sl-b" style="width:0%"></div></div><div class="sub" id="a-sl-s">—</div>
    </div>
    <div class="card full cp">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div class="lbl" style="margin:0">Completude</div><span class="pill" id="a-co-p">—</span></div>
      <div class="val" id="a-co" style="color:#7F77DD">—</div><div class="bar"><div class="fill" id="a-co-b" style="width:0%;background:#7F77DD"></div></div><div class="sub" id="a-co-s">—</div>
    </div>
  </div>
  <div class="cw"><canvas id="rc" role="img" aria-label="Repartition revenus">Revenus</canvas></div>
</div>

<div class="sec" id="tab-c">
  <div class="g2">
    <div class="card ct"><div class="lbl">Cours effectues</div><div class="val" id="c-nb" style="color:#5DCAA5">—</div></div>
    <div class="card cr"><div class="lbl">Cours manques</div><div class="val" id="c-mn" style="color:#E24B4A">—</div><div class="sub" id="c-mv">—</div></div>
    <div class="card full ct"><div class="lbl">Total gagne</div><div class="big" id="c-tot" style="color:#5DCAA5">—</div><div class="bar"><div class="fill" id="c-b" style="width:0%;background:#5DCAA5"></div></div><div class="sub" id="c-s">—</div></div>
    <div class="card full"><div class="stl">Detail des cours</div><div id="c-ls"><div style="font-size:11px;color:#333;padding:6px 0">Aucun cours ce mois</div></div></div>
    <div class="card full cr" id="c-mc" style="display:none"><div class="stl" style="color:#E24B4A">Cours manques</div><div id="c-ml"></div></div>
  </div>
</div>

<div class="sec" id="tab-b">
  <div class="card full"><div class="stl">Depenses par categorie — clic pour detail</div><div id="b-ls"></div></div>
  <div class="cw2"><canvas id="bc" role="img" aria-label="Depenses">Budgets</canvas></div>
</div>

<div class="sec" id="tab-o">
  <div class="card full"><div class="stl">Progression epargne</div><div id="o-ls"></div></div>
  <div class="cw" style="height:150px"><canvas id="oc" role="img" aria-label="Objectifs">Objectifs</canvas></div>
</div>

<div class="sec" id="tab-p">
  <div class="g2">
    <div class="card cr"><div class="lbl">Total mensuel</div><div class="val" id="p-tot" style="color:#E24B4A">—</div></div>
    <div class="card ca"><div class="lbl">Solde apres</div><div class="val" id="p-sl">—</div></div>
  </div>
  <div class="card full" style="margin-bottom:8px"><div class="stl" style="color:#5DCAA5">Passes ce mois</div><div id="p-pas"></div></div>
  <div class="card full" style="margin-bottom:8px"><div class="stl" style="color:#EF9F27">A venir</div><div id="p-av"></div></div>
  <div class="card full" id="p-nd-c" style="display:none"><div class="stl">Date inconnue</div><div id="p-nd"></div></div>
</div>

<button class="btn" onclick="charger()">Actualiser</button>
<div class="upd" id="upd">—</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
<script>
const API='https://budget-bot-production-eaaf.up.railway.app/api/dashboard';
let rC,bC,oC;
const MF=['Janvier','Fevrier','Mars','Avril','Mai','Juin','Juillet','Aout','Septembre','Octobre','Novembre','Decembre'];
let cm=new Date().getMonth(),cy=new Date().getFullYear();

function chgMois(d){cm+=d;if(cm>11){cm=0;cy++;}if(cm<0){cm=11;cy--;}charger();}
function setTab(t){document.querySelectorAll('.tab').forEach((el,i)=>el.classList.toggle('active',['a','c','b','o','p'][i]===t));document.querySelectorAll('.sec').forEach(el=>el.classList.remove('active'));document.getElementById('tab-'+t).classList.add('active');}
function fmt(n){return Math.round(n).toLocaleString('fr-FR')+' EUR';}
function pct(v,m){return Math.min(100,Math.round(v/m*100));}
function col(p){return p>=100?'#E24B4A':p>=80?'#EF9F27':'#1D9E75';}
function colS(v){return v>=500?'#5DCAA5':v>=0?'#EF9F27':'#E24B4A';}
function pillC(p){return'pill '+(p>=100?'pr':p>=80?'pa':'pg');}
function tglD(k){const el=document.getElementById('dp-'+k);if(el)el.classList.toggle('open');}

async function charger(){
  try{
    document.getElementById('nav-m').textContent=MF[cm]+' '+cy;
    const r=await fetch(API+'?mois='+cm+'&annee='+cy);
    const d=await r.json();
    document.getElementById('mois-lbl').textContent=MF[cm]+' '+cy;

    const prO=d.objectifs.find(o=>d.epargne_estimee<o.montant)||d.objectifs[d.objectifs.length-1];
    const epP=pct(d.epargne_base,prO.montant);
    document.getElementById('a-ep').textContent=fmt(d.epargne_base);
    const epPEl=document.getElementById('a-ep-p');epPEl.textContent=epP+'%';epPEl.className=pillC(epP);
    document.getElementById('a-ep-b').style.cssText='width:'+epP+'%;background:#5DCAA5';
    document.getElementById('a-obj-l').textContent=prO.label+' : '+prO.montant.toLocaleString()+' EUR';
    document.getElementById('a-rv').textContent=fmt(d.total_revenus);
    document.getElementById('a-rv-s').textContent='LGM '+fmt(d.salaire)+' + Comp. '+fmt(d.completude);
    document.getElementById('a-dp').textContent='-'+fmt(d.total_dep);
    document.getElementById('a-dp-s').textContent='Budget max : '+Object.values(d.budgets).reduce((s,b)=>s+b.max,0)+' EUR';
    const slEl=document.getElementById('a-sl');slEl.textContent=(d.solde>=0?'+':'')+fmt(d.solde);slEl.style.color=colS(d.solde);
    const sp=Math.min(100,Math.max(0,(d.solde/1500)*100));
    document.getElementById('a-sl-b').style.cssText='width:'+sp+'%;background:'+colS(d.solde);
    document.getElementById('a-sl-s').textContent=fmt(d.total_revenus)+' - '+fmt(d.charges_fixes)+' - '+fmt(d.total_dep);
    const slP=document.getElementById('a-sl-p');slP.textContent=d.solde>=500?'Positif':d.solde>=0?'Attention':'Negatif';slP.className='pill '+(d.solde>=500?'pg':d.solde>=0?'pa':'pr');
    const cp=pct(d.completude,d.objectif_completude);
    document.getElementById('a-co').textContent=fmt(d.completude);
    document.getElementById('a-co-b').style.width=cp+'%';
    document.getElementById('a-co-s').textContent=fmt(d.completude)+' / '+fmt(d.objectif_completude)+' ('+cp+'%)';
    const coP=document.getElementById('a-co-p');coP.textContent=cp+'%';coP.className=pillC(cp);

    if(rC)rC.destroy();
    rC=new Chart(document.getElementById('rc'),{type:'doughnut',data:{labels:['Salaire LGM','Beau-frere','Completude'],datasets:[{data:[d.salaire,d.beau_frere,d.completude],backgroundColor:['#185FA5','#1D9E75','#534AB7'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'68%',plugins:{legend:{position:'bottom',labels:{font:{size:10},color:'#555',boxWidth:8,padding:10}},tooltip:{callbacks:{label:ctx=>' '+Math.round(ctx.raw).toLocaleString('fr-FR')+' EUR'}}}}});

    document.getElementById('c-nb').textContent=d.nb_cours;
    document.getElementById('c-mn').textContent=d.nb_cours_manques;
    document.getElementById('c-mv').textContent='-'+fmt(d.total_manque)+' manques';
    document.getElementById('c-tot').textContent=fmt(d.completude);
    document.getElementById('c-b').style.cssText='width:'+cp+'%;background:#5DCAA5';
    document.getElementById('c-s').textContent=fmt(d.completude)+' / '+fmt(d.objectif_completude)+' ('+cp+'%)';
    const cl=document.getElementById('c-ls');
    cl.innerHTML=d.cours.length===0?'<div style="font-size:11px;color:#333;padding:6px 0">Aucun cours ce mois</div>':d.cours.map(c=>'<div class="cr2"><div style="display:flex;align-items:center"><span class="dot" style="background:#378ADD"></span>'+c.eleve+(c.rattrapage?' <span style="color:#333;font-size:10px">(ratt.)</span>':'')+'</div><span style="color:#5DCAA5;font-weight:600">+'+c.gain.toFixed(2)+' EUR</span></div>').join('');
    if(d.nb_cours_manques>0){document.getElementById('c-mc').style.display='block';document.getElementById('c-ml').innerHTML=d.cours_manques.map(c=>'<div class="cr2"><div style="display:flex;align-items:center"><span class="dot" style="background:#E24B4A"></span>'+c.eleve+'</div><span style="color:#E24B4A;font-weight:600">-'+c.gain_manque.toFixed(2)+' EUR</span></div>').join('');}

    const bl=document.getElementById('b-ls');bl.innerHTML='';
    const bL=[],bV=[],bC2=[];
    Object.entries(d.totaux).forEach(([k,v])=>{
      const b=d.budgets[k];const p=pct(v,b.max);const c=col(p);
      bL.push(b.label);bV.push(v);bC2.push(c);
      const deps=d.depenses?d.depenses.filter(dep=>dep.categorie===k):[];
      bl.innerHTML+='<div class="row" onclick="tglD(\''+k+'\')"><span>'+b.label+'</span><div style="display:flex;align-items:center;gap:8px"><div class="mb"><div class="mf" style="width:'+p+'%;background:'+c+'"></div></div><span style="color:'+c+';min-width:70px;text-align:right;font-size:11px;font-weight:600">'+v.toFixed(0)+' / '+b.max+' EUR</span></div></div><div class="dp" id="dp-'+k+'">'+(deps.length===0?'<div style="color:#333">Aucune depense</div>':deps.map(dep=>'<div class="dr"><span>'+dep.libelle+'</span><span style="color:#E24B4A">-'+dep.montant.toFixed(2)+' EUR</span></div>').join(''))+'</div>';
    });
    if(bC)bC.destroy();
    bC=new Chart(document.getElementById('bc'),{type:'bar',indexAxis:'y',data:{labels:bL,datasets:[{data:bV,backgroundColor:bC2,borderRadius:3,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:'rgba(255,255,255,0.02)'},ticks:{font:{size:9},color:'#444',callback:v=>v+' EUR'}},y:{grid:{display:false},ticks:{font:{size:9},color:'#555'}}}}});

    const ol=document.getElementById('o-ls');ol.innerHTML='';
    const oL=[],oP=[],oC2=[];
    d.objectifs.forEach(o=>{
      const p=pct(d.epargne_estimee,o.montant);const c=col(p);const delta=Math.round(d.epargne_estimee-o.montant);
      oL.push(o.label);oP.push(p);oC2.push(c);
      ol.innerHTML+='<div class="obj"><div class="ot"><span style="font-size:12px">'+(delta>=0?'OK ':'... ')+o.label+'</span><span style="color:'+c+';font-size:11px;font-weight:600">'+(delta>=0?'+':'')+delta.toLocaleString()+' EUR</span></div><div class="bar"><div class="fill" style="width:'+p+'%;background:'+c+'"></div></div><div style="display:flex;justify-content:space-between;font-size:10px;color:#333;margin-top:2px"><span>'+Math.round(d.epargne_estimee).toLocaleString()+' EUR</span><span>'+o.montant.toLocaleString()+' EUR</span></div></div>';
    });
    if(oC)oC.destroy();
    oC=new Chart(document.getElementById('oc'),{type:'bar',data:{labels:oL,datasets:[{data:oP,backgroundColor:oC2,borderRadius:4,borderWidth:0},{data:[100,100,100],backgroundColor:'rgba(255,255,255,0.02)',borderRadius:4,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{size:9},color:'#555'}},y:{max:110,grid:{color:'rgba(255,255,255,0.02)'},ticks:{font:{size:9},color:'#444',callback:v=>v+'%'}}}}});

    const today=new Date().getDate();const isCur=cm===new Date().getMonth()&&cy===new Date().getFullYear();
    const todayCheck=isCur?today:32;
    const pas=d.prelevements.filter(p=>p.jour_mois&&p.jour_mois<=todayCheck);
    const av=d.prelevements.filter(p=>p.jour_mois&&p.jour_mois>todayCheck);
    const nd=d.prelevements.filter(p=>!p.jour_mois);
    const totM=d.prelevements.filter(p=>p.frequence==='mensuel').reduce((s,p)=>s+p.montant,0);
    const mAv=av.reduce((s,p)=>s+p.montant,0);const sAp=d.solde-mAv;
    document.getElementById('p-tot').textContent='-'+fmt(totM);
    const pSl=document.getElementById('p-sl');pSl.textContent=(sAp>=0?'+':'')+fmt(sAp);pSl.style.color=colS(sAp);
    document.getElementById('p-pas').innerHTML=pas.length===0?'<div style="font-size:11px;color:#333;padding:6px 0">Aucun</div>':pas.map(p=>'<div class="pr2"><span style="display:flex;align-items:center"><span class="dot" style="background:#5DCAA5"></span>'+p.nom+'</span><span style="color:#5DCAA5;font-weight:600">-'+p.montant.toFixed(2)+' EUR</span></div>').join('');
    document.getElementById('p-av').innerHTML=av.length===0?'<div style="font-size:11px;color:#333;padding:6px 0">Aucun</div>':av.map(p=>'<div class="pr2"><span style="display:flex;align-items:center"><span class="dot" style="background:#EF9F27"></span>'+p.nom+' <span style="color:#333;margin-left:4px;font-size:10px">le '+p.jour_mois+'</span></span><span style="color:#EF9F27;font-weight:600">-'+p.montant.toFixed(2)+' EUR</span></div>').join('');
    if(nd.length>0){document.getElementById('p-nd-c').style.display='block';document.getElementById('p-nd').innerHTML=nd.map(p=>'<div class="pr2"><span>'+p.nom+'</span><span style="color:#555">-'+p.montant.toFixed(2)+' EUR</span></div>').join('');}

    document.getElementById('upd').textContent='Actualise a '+new Date().toLocaleTimeString('fr-FR');
  }catch(e){console.error(e);document.getElementById('upd').textContent='Erreur de chargement';}
}
charger();setInterval(charger,30000);
</script>
</body>
</html>`);
});

app.get('/', (req, res) => res.send("L'Agent est en ligne!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`L'Agent ecoute sur le port ${PORT}`);
  demarrerScheduler();
});

module.exports = app;
