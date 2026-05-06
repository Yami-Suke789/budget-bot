const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);
const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const MODELE = 'gemini-2.0-flash';

const SALAIRE_LGM_DEFAULT = 2500;
const BEAU_FRERE = 320;
const OBJECTIF_COMPLETUDE = 1500;
const EPARGNE_DEPART = 9000;

const CHARGES_FIXES = {
  'Loyer': 832.46, 'Tontine 1': 500, 'Tontine 2': 500,
  'Virement m\u00e8re': 150, 'Place parking': 50, 'Malakoff mutuelle': 57.03,
  'ENI \u00e9nergie': 39.40, 'Bouygues mobile': 17.99, 'Bouygues box': 24,
  'Basic Fit': 22.99, 'Assurance habitation': 8.46, 'Assurance auto': 64.24,
  'Salle sport femme': 44, 'Canal+ fr\u00e8re': 13, 'Cours arabe': 31,
  'Claude.ai': 21.60, 'Helloasso': 12.55, 'Stripe asso': 10,
  'Disney+': 6.99, 'Crunchyroll': 8.99, 'Cotisation bancaire': 18.30,
};
const TOTAL_CHARGES_FIXES = Object.values(CHARGES_FIXES).reduce((a, b) => a + b, 0);

const PRELEVEMENTS_DATES = [
  { nom: 'Loyer',               montant: 832.46, jour: 1  },
  { nom: 'Tontine 1',           montant: 500.00, jour: 1  },
  { nom: 'Helloasso',           montant: 12.55,  jour: 1  },
  { nom: 'Place parking',       montant: 50.00,  jour: 1  },
  { nom: 'Salle sport femme',   montant: 44.00,  jour: 1  },
  { nom: 'Cours arabe',         montant: 31.00,  jour: 3  },
  { nom: 'Virement m\u00e8re', montant: 150.00, jour: 5  },
  { nom: 'Assurance habitation',montant: 8.46,   jour: 7  },
  { nom: 'ENI \u00e9nergie',   montant: 39.40,  jour: 7  },
  { nom: 'Basic Fit',           montant: 22.99,  jour: 7  },
  { nom: 'Malakoff mutuelle',   montant: 57.03,  jour: 9  },
  { nom: 'Crunchyroll',         montant: 8.99,   jour: 13 },
  { nom: 'Stripe asso',         montant: 10.00,  jour: 13 },
  { nom: 'Tontine 2',           montant: 500.00, jour: 15 },
  { nom: 'Bouygues mobile',     montant: 17.99,  jour: 17 },
  { nom: 'Assurance auto',      montant: 64.24,  jour: 20 },
  { nom: 'Disney+',             montant: 6.99,   jour: 22 },
  { nom: 'Canal+ fr\u00e8re',  montant: 13.00,  jour: 24 },
  { nom: 'Claude.ai',           montant: 21.60,  jour: 27 },
  { nom: 'Bouygues box',        montant: 24.00,  jour: 30 },
  { nom: 'Cotisation bancaire', montant: 18.30,  jour: null, frequence: 'trimestriel' },
];

const BUDGETS = {
  essence:  { label: '\u26fd Essence',  max: 300 },
  courses:  { label: '\ud83d\udecd Courses',  max: 500 },
  restos:   { label: '\ud83c\udf7d\ufe0f Restos',   max: 80  },
  sante:    { label: '\ud83c\udfe5 Sant\u00e9',    max: 60  },
  maison:   { label: '\ud83c\udfe0 Maison',   max: 50  },
  voiture:  { label: '\ud83d\ude97 Voiture',  max: 50  },
  shopping: { label: '\ud83d\udc57 Shopping', max: 50  },
  loisirs:  { label: '\ud83c\udf89 Loisirs',  max: 50  },
  divers:   { label: '\ud83d\udce6 Divers',   max: 50  },
};

const OBJECTIFS = [
  { label: 'Fin juin 2026', montant: 12500 },
  { label: 'Fin ao\u00fbt 2026', montant: 15000 },
  { label: 'Janvier 2027',  montant: 20000 },
];

let ELEVES = {
  'Amel':        { niveau: '5e',  taux: 21.04, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 1, heure: 17, minute: 0  },
  'Benjamin':    { niveau: '5e',  taux: 24.30, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 2, heure: 18, minute: 0  },
  'Guillaume':   { niveau: '5e',  taux: 23.88, duree: 1.5, tda: true,  ficheHebdo: false, question2h: true,  fiche: true,  jour: 3, heure: 17, minute: 30 },
  'Margaux':     { niveau: '3e',  taux: 26.60, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 4, heure: 16, minute: 0  },
  'N\u00e9lia': { niveau: '3e',  taux: 26.60, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 4, heure: 17, minute: 30 },
  'H\u00e9l\u00e8ne': { niveau: '5e', taux: 24.30, duree: 1.5, tda: false, ficheHebdo: false, question2h: true, fiche: true, jour: 6, heure: 8, minute: 0 },
  'No\u00e9lie': { niveau: 'CE2', taux: 25.78, duree: 1.0, tda: false, ficheHebdo: false, question2h: false, fiche: false, jour: 6, heure: 10, minute: 0 },
  'Math\u00e9o': { niveau: '3e', taux: 23.66, duree: 1.5, tda: false, ficheHebdo: true,  question2h: true,  fiche: true,  jour: 6, heure: 11, minute: 30 },
  'Anne-Ga\u00eblle': { niveau: '3e', taux: 24.08, duree: 1.5, tda: false, ficheHebdo: false, question2h: true, fiche: true, jour: 6, heure: 13, minute: 0 },
  'Sa\u00efda': { niveau: '5e',  taux: 25.56, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 6, heure: 15, minute: 0  },
  'Serena':      { niveau: '5e',  taux: 23.04, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 0, heure: 13, minute: 0, uneSemaineSurDeux: true },
};

async function chargerElevesCustom() {
  try {
    const { data } = await supabase.from('eleves_custom').select('*').eq('actif', true);
    if (data && data.length > 0) {
      data.forEach(e => {
        ELEVES[e.nom] = { niveau: e.niveau, taux: e.taux, duree: e.duree, tda: e.tda || false, ficheHebdo: e.fiche_hebdo || false, question2h: e.question_2h !== false, fiche: e.fiche !== false, jour: e.jour, heure: e.heure, minute: e.minute || 0, uneSemaineSurDeux: e.une_semaine_sur_deux || false };
      });
      console.log(data.length + ' \u00e9l\u00e8ves custom charg\u00e9s');
    }
  } catch (err) { console.error('Erreur chargement \u00e9l\u00e8ves custom:', err.message); }
}

const sessions = {}, sessionsFiches = {}, sessionsAnnuler = {}, sessionsModifier = {}, sessionsAjoutEleve = {}, sessionsRevenu = {};

async function send(chatId, text) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const MAX = 3800;
  const post = async (t) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: t, parse_mode: 'Markdown' }) }); const j = await r.json(); if (!j.ok) await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: t }) }); };
  if (text.length <= MAX) { await post(text); return; }
  let reste = text;
  while (reste.length > 0) { let c = reste.length > MAX ? reste.lastIndexOf('\n', MAX) : reste.length; if (c < MAX / 2) c = Math.min(MAX, reste.length); await post(reste.slice(0, c)); reste = reste.slice(c).trim(); if (reste) await new Promise(r => setTimeout(r, 500)); }
}
async function sendBtns(chatId, text, buttons) { await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons.map(row => row.map(b => ({ text: b.t, callback_data: b.d }))) } }) }); }
async function answerCB(id) { await fetch(`https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id: id }) }); }
async function removeBtns(chatId, msgId) { await fetch(`https://api.telegram.org/bot${TOKEN}/editMessageReplyMarkup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }) }); }

function getDebutMois(moisOffset = 0) { const d = new Date(); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); if (moisOffset !== 0) d.setUTCMonth(d.getUTCMonth() + moisOffset); return d.toISOString(); }
function getFinMois(moisOffset = 0) { const d = new Date(); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); d.setUTCMonth(d.getUTCMonth() + moisOffset + 1); return d.toISOString(); }

async function getData(moisOffset = 0) {
  const debut = getDebutMois(moisOffset), fin = getFinMois(moisOffset);
  const [d1,d2,d3,d4,d5,d6] = await Promise.all([supabase.from('depenses').select('*').gte('created_at',debut).lt('created_at',fin),supabase.from('cours').select('*').gte('created_at',debut).lt('created_at',fin),supabase.from('cours_manques').select('*').gte('created_at',debut).lt('created_at',fin),supabase.from('revenus').select('*').gte('created_at',debut).lt('created_at',fin),supabase.from('salaires').select('*').gte('created_at',debut).lt('created_at',fin).order('created_at',{ascending:false}).limit(1),supabase.from('epargne').select('*').order('created_at',{ascending:false}).limit(1)]);
  const depenses=d1.data||[],cours=d2.data||[],coursManques=d3.data||[],revenus=d4.data||[];
  const salaire=d5.data?.length>0?d5.data[0].montant:SALAIRE_LGM_DEFAULT;
  const epargneBase=d6.data?.length>0?d6.data[0].montant:EPARGNE_DEPART;
  const totaux={};Object.keys(BUDGETS).forEach(k=>totaux[k]=0);depenses.forEach(d=>{if(totaux[d.categorie]!==undefined)totaux[d.categorie]+=d.montant;});
  const detail={};Object.keys(BUDGETS).forEach(k=>detail[k]=[]);depenses.forEach(d=>{if(detail[d.categorie]!==undefined)detail[d.categorie].push(d);});
  const totalDep=Object.values(totaux).reduce((a,b)=>a+b,0),completude=cours.reduce((s,c)=>s+c.gain,0),totalManque=coursManques.reduce((s,c)=>s+c.gain_manque,0),revenusSupp=revenus.reduce((s,r)=>s+r.montant,0),totalRevenus=salaire+BEAU_FRERE+completude+revenusSupp,solde=totalRevenus-TOTAL_CHARGES_FIXES-totalDep,epargneEstimee=epargneBase+solde;
  return {depenses,cours,coursManques,revenus,totaux,detail,totalDep,completude,totalManque,revenusSupp,totalRevenus,solde,epargneEstimee,salaire,epargneBase,moisOffset};
}

async function saveCours(chatId,eleve,heures,rattrapage){const p=ELEVES[eleve];const gain=p.taux*heures;const{error}=await supabase.from('cours').insert({eleve,duree:p.duree,taux:p.taux,gain,chat_id:String(chatId),rattrapage});if(error)console.error('saveCours error:',error);return gain;}
async function saveCoursManque(chatId,eleve){const gain_manque=ELEVES[eleve].taux*ELEVES[eleve].duree;const{error}=await supabase.from('cours_manques').insert({eleve,gain_manque,chat_id:String(chatId)});if(error)console.error('saveCoursManque error:',error);return gain_manque;}
async function saveDepense(chatId,montant,categorie,libelle){const{error}=await supabase.from('depenses').insert({montant,categorie,libelle,chat_id:String(chatId)});if(error)console.error('saveDepense error:',error);}
async function saveSalaire(chatId,montant){const{error}=await supabase.from('salaires').insert({montant,libelle:'Salaire LGM',chat_id:String(chatId)});if(error)console.error('saveSalaire error:',error);}
async function saveEpargne(chatId,montant){const{error}=await supabase.from('epargne').insert({montant,libelle:'Epargne',chat_id:String(chatId)});if(error)console.error('saveEpargne error:',error);}
async function saveRevenu(chatId,montant,libelle){const{error}=await supabase.from('revenus').insert({montant,libelle,chat_id:String(chatId)});if(error)console.error('saveRevenu error:',error);}
async function saveEleveCustom(chatId,eleveData){const{error}=await supabase.from('eleves_custom').insert({nom:eleveData.nom,niveau:eleveData.niveau,taux:eleveData.taux,duree:eleveData.duree,tda:eleveData.tda||false,fiche_hebdo:eleveData.ficheHebdo||false,question_2h:eleveData.question2h!==false,fiche:eleveData.fiche!==false,jour:eleveData.jour,heure:eleveData.heure,minute:eleveData.minute||0,une_semaine_sur_deux:eleveData.uneSemaineSurDeux||false,actif:true,chat_id:String(chatId)});if(error)console.error('saveEleveCustom error:',error);return!error;}

function getPrelEvementsAVenir(joursAvance=7){const now=new Date(new Date().toLocaleString('en-US',{timeZone:'Europe/Paris'}));const aujourdhui=now.getDate();const finPeriode=aujourdhui+joursAvance;const dernierJour=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();const aVenir=[];PRELEVEMENTS_DATES.forEach(p=>{if(!p.jour)return;let j=p.jour;if(j>dernierJour)j=dernierJour;if(j>=aujourdhui&&j<=Math.min(finPeriode,dernierJour))aVenir.push({...p,jourEffectif:j,dansJours:j-aujourdhui});});return aVenir.sort((a,b)=>a.jourEffectif-b.jourEffectif);}
function getTotalPrelevementsRestants(){const now=new Date(new Date().toLocaleString('en-US',{timeZone:'Europe/Paris'}));const aujourdhui=now.getDate();const dernierJour=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();let total=0;PRELEVEMENTS_DATES.forEach(p=>{if(!p.jour)return;let j=p.jour>dernierJour?dernierJour:p.jour;if(j>=aujourdhui)total+=p.montant;});return total;}

async function geminiParle(chatId,message,data){const model=genAI.getGenerativeModel({model:MODELE});const ctx=`Tu es L'Agent, assistant personnel de Nour-Dine. Naturel, direct, bienveillant. Max 4 lignes.\nFinances: LGM ${data.salaire}\u20ac, Completude ${data.completude.toFixed(0)}\u20ac/${OBJECTIF_COMPLETUDE}\u20ac, Solde ${data.solde.toFixed(0)}\u20ac\nReponds naturellement en francais. Jamais de JSON ni de balises.`;const result=await model.generateContent(ctx+'\n\nMessage: '+message);return result.response.text();}

const PROFILS_FICHES={'Amel':{niveau:'5e',format:'standard'},'Benjamin':{niveau:'5e',format:'standard',note:'Impatient, erreurs attention'},'Guillaume':{niveau:'5e',format:'tda',note:'TDA - consignes ultra courtes, max 4 exos'},'Margaux':{niveau:'3e',format:'standard'},'N\u00e9lia':{niveau:'3e',format:'standard'},'H\u00e9l\u00e8ne':{niveau:'5e',format:'standard'},'Math\u00e9o':{niveau:'3e',format:'hebdo',note:'Fiche lundi-vendredi, 2 exos courts par jour'},'Anne-Ga\u00eblle':{niveau:'3e',format:'standard'},'Sa\u00efda':{niveau:'5e',format:'standard'},'Serena':{niveau:'5e',format:'standard'}};

async function genererContenuFiche(eleve,chapitre){const profil=PROFILS_FICHES[eleve]||{niveau:ELEVES[eleve]?.niveau||'5e',format:'standard'};const model=genAI.getGenerativeModel({model:MODELE});const regles=`REGLES ABSOLUES:\n- Texte brut uniquement, ZERO LaTeX\n- Fractions: "3/4", puissances: "x^2"\n- Corrige complet apres "=== CORRIGE ==="\n- Adapte au programme officiel de ${profil.niveau} en France`;let prompt='';if(profil.format==='hebdo')prompt=`Tu es professeur de mathematiques. Fiche hebdo pour ${eleve} (${profil.niveau}). Chapitre: ${chapitre}. ${regles}${profil.note?'\nNote: '+profil.note:''}\nFORMAT: LUNDI/MARDI/MERCREDI/JEUDI/VENDREDI avec 2 exercices chacun.\n=== CORRIGE ===\n[Corrige]`;else if(profil.format==='tda')prompt=`Professeur TDA. Fiche pour ${eleve} (${profil.niveau}). Chapitre: ${chapitre}. ${regles}${profil.note?'\nNote: '+profil.note:''}\nMax 4 exercices.\n=== CORRIGE ===\n[Corrige]`;else prompt=`Professeur maths. Fiche pour ${eleve} (${profil.niveau}). Chapitre: ${chapitre}. ${regles}${profil.note?'\nNote: '+profil.note:''}\n4 exercices progressifs.\n=== CORRIGE ===\n[Corrige detaille]`;const result=await model.generateContent(prompt);return result.response.text();}

async function creerPDF(eleve,chapitre,contenu){const profil=PROFILS_FICHES[eleve]||{niveau:ELEVES[eleve]?.niveau||'5e'};const tmpPath=path.join('/tmp',`fiche_${eleve}_${Date.now()}.pdf`);return new Promise((resolve,reject)=>{const doc=new PDFDocument({margin:40,size:'A4'});const stream=fs.createWriteStream(tmpPath);doc.pipe(stream);doc.rect(0,0,doc.page.width,80).fill('#0D1B2A');doc.fillColor('white').fontSize(18).font('Helvetica-Bold').text("L'Agent \u2014 Fiche d'exercices",40,20);doc.fontSize(11).font('Helvetica').text(`${eleve} \u2014 ${profil.niveau} \u2014 ${chapitre}`,40,48);doc.text(new Date().toLocaleDateString('fr-FR'),40,62);doc.fillColor('#333333').moveDown(3);const lignes=contenu.split('\n');let dansCorrige=false;for(const ligne of lignes){if(ligne.trim()===''){doc.moveDown(0.4);continue;}if(ligne.startsWith('=== CORRIGE ===')){doc.moveDown(1).rect(40,doc.y,doc.page.width-80,1).fill('#F26419').moveDown(0.5);doc.fillColor('#F26419').fontSize(13).font('Helvetica-Bold').text('CORRIG\u00c9',40,doc.y);doc.fillColor('#333333');dansCorrige=true;doc.moveDown(0.5);continue;}if(/^(LUNDI|MARDI|MERCREDI|JEUDI|VENDREDI)$/i.test(ligne.trim())){doc.moveDown(0.5).fillColor('#0D1B2A').fontSize(12).font('Helvetica-Bold').text(ligne.trim(),40,doc.y);doc.fillColor('#333333');continue;}if(/^exercice\s*\d+/i.test(ligne.trim())){doc.moveDown(0.3);doc.fillColor(dansCorrige?'#2E7D32':'#0D1B2A').fontSize(11).font('Helvetica-Bold').text(ligne.trim(),40,doc.y,{width:doc.page.width-80});doc.fillColor('#333333');continue;}doc.fontSize(10).font('Helvetica').text(ligne,40,doc.y,{width:doc.page.width-80});}const pb=doc.page.height-30;doc.rect(0,pb-10,doc.page.width,40).fill('#0D1B2A');doc.fillColor('white').fontSize(8).font('Helvetica').text("G\u00e9n\u00e9r\u00e9 par L'Agent \u2022 Compl\u00e9tude",40,pb,{align:'center',width:doc.page.width-80});doc.end();stream.on('finish',()=>resolve(tmpPath));stream.on('error',reject);});}

function trouverEleve(texte){const t=texte.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');for(const nom of Object.keys(ELEVES)){if(t.includes(nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')))return nom;}return null;}
function trouverTousLesEleves(texte){const t=texte.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');return Object.keys(ELEVES).filter(nom=>t.includes(nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')));}
function trouverMontant(texte){const m=texte.match(/(\d+([.,]\d{1,2})?)\s*\u20ac?/);return m?parseFloat(m[1].replace(',','.')):null;}
function trouverCategorie(texte){const t=texte.toLowerCase();if(/essence|plein|carburant|station|total|esso/.test(t))return'essence';if(/leclerc|courses|carrefour|lidl|cora|supermarche|aldi/.test(t))return'courses';if(/resto|restaurant|mcdo|burger|pizza|kebab|sushi/.test(t))return'restos';if(/medecin|pharmacie|docteur|sante|doctolib/.test(t))return'sante';if(/ikea|maison|bricolage|castorama/.test(t))return'maison';if(/garage|voiture|reparation|pneu|peage/.test(t))return'voiture';if(/vetement|zara|shopping|coiffeur|hm/.test(t))return'shopping';if(/cinema|loisir|concert|sport|sortie/.test(t))return'loisirs';return null;}

const JOURS_NOMS=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
const NIVEAUX_VALIDES=['CP','CE1','CE2','CM1','CM2','6e','5e','4e','3e','2nde','1\u00e8re','Terminale'];

async function resumeCompletude(chatId){const data=await getData();const manque=Math.max(0,OBJECTIF_COMPLETUDE-data.completude);const pct=Math.min(100,Math.round((data.completude/OBJECTIF_COMPLETUDE)*100));const emoji=data.completude>=OBJECTIF_COMPLETUDE?'\ud83d\udfe2':data.completude>=1000?'\ud83d\udfe1':'\ud83d\udd34';await send(chatId,`${emoji} Completude: *${data.completude.toFixed(0)}\u20ac* / ${OBJECTIF_COMPLETUDE}\u20ac (${pct}%)\n${manque>0?`\u26a0\ufe0f Il manque: *${manque.toFixed(0)}\u20ac*`:'\ud83c\udf89 Objectif atteint !'}`);}

async function demarrerAjoutEleve(chatId){sessionsAjoutEleve[chatId]={etape:'nom'};await send(chatId,'\ud83d\udc64 *Ajouter un nouvel \u00e9l\u00e8ve*\n\n\u00c9tape 1/7 \u2014 Quel est son pr\u00e9nom ?\n_Ex: Thomas, Marie..._');}
async function traiterAjoutEleve(chatId,texte){const sess=sessionsAjoutEleve[chatId];if(!sess)return false;switch(sess.etape){case'nom':{const nom=texte.trim();if(nom.length<2||nom.length>30){await send(chatId,'Pr\u00e9nom invalide.');return true;}if(ELEVES[nom]){await send(chatId,`*${nom}* existe d\u00e9j\u00e0 !`);delete sessionsAjoutEleve[chatId];return true;}sess.nom=nom;sess.etape='niveau';const rows=[];for(let i=0;i<NIVEAUX_VALIDES.length;i+=4)rows.push(NIVEAUX_VALIDES.slice(i,i+4).map(n=>({t:n,d:'ae_niv_'+n})));rows.push([{t:'Annuler',d:'ae_annuler'}]);await sendBtns(chatId,`\ud83d\udc64 *${nom}*\n\n\u00c9tape 2/7 \u2014 Niveau ?`,rows);return true;}case'taux':{const taux=parseFloat(texte.replace(',','.'));if(isNaN(taux)||taux<10||taux>100){await send(chatId,'Taux invalide. Ex: *24.50*');return true;}sess.taux=taux;sess.etape='duree';await sendBtns(chatId,`\u00c9tape 4/7 \u2014 Dur\u00e9e ?`,[[{t:'1h',d:'ae_dur_1'},{t:'1h30',d:'ae_dur_1.5'},{t:'2h',d:'ae_dur_2'}],[{t:'Annuler',d:'ae_annuler'}]]);return true;}case'heure':{const m=texte.match(/^(\d{1,2})h(\d{0,2})$/i);if(!m){await send(chatId,'Format invalide. Ex: *17h00*');return true;}const h=parseInt(m[1]),min=parseInt(m[2]||'0');if(h<7||h>21||min%15!==0){await send(chatId,'Heure invalide.');return true;}sess.heure=h;sess.minute=min;sess.etape='options';await sendBtns(chatId,'\u00c9tape 7/7 \u2014 Options ?',[[{t:'TDA/TDAH',d:'ae_opt_tda'},{t:'Fiche hebdo',d:'ae_opt_hebdo'}],[{t:'1 semaine/2',d:'ae_opt_2sem'},{t:'Aucune',d:'ae_opt_none'}],[{t:'Annuler',d:'ae_annuler'}]]);return true;}}return false;}

async function annulerDernierCours(eleve){const debut=new Date();debut.setUTCDate(1);debut.setUTCHours(0,0,0,0);const{data}=await supabase.from('cours').select('id').eq('eleve',eleve).gte('created_at',debut.toISOString()).order('created_at',{ascending:false}).limit(1);if(!data||data.length===0)return false;const{error}=await supabase.from('cours').delete().eq('id',data[0].id);return!error;}
async function annulerDernierCoursManque(eleve){const debut=new Date();debut.setUTCDate(1);debut.setUTCHours(0,0,0,0);const{data}=await supabase.from('cours_manques').select('id').eq('eleve',eleve).gte('created_at',debut.toISOString()).order('created_at',{ascending:false}).limit(1);if(!data||data.length===0)return false;const{error}=await supabase.from('cours_manques').delete().eq('id',data[0].id);return!error;}
async function annulerDerniereDepense(categorie){const debut=new Date();debut.setUTCDate(1);debut.setUTCHours(0,0,0,0);const{data}=await supabase.from('depenses').select('id,montant,libelle').eq('categorie',categorie).gte('created_at',debut.toISOString()).order('created_at',{ascending:false}).limit(1);if(!data||data.length===0)return null;const item=data[0];await supabase.from('depenses').delete().eq('id',item.id);return item;}
async function demarrerFiche(chatId){const elevesDispo=Object.keys(ELEVES);const rows=[];for(let i=0;i<elevesDispo.length;i+=3)rows.push(elevesDispo.slice(i,i+3).map(n=>({t:n,d:'fiche_eleve_'+n})));rows.push([{t:'Annuler',d:'fiche_annuler'}]);await sendBtns(chatId,'\ud83d\udcda *G\u00e9n\u00e9ration de fiche*\n\nPour quel \u00e9l\u00e8ve ?',rows);}

async function traiterCallback(cb){
  const chatId=cb.message.chat.id,msgId=cb.message.message_id,data=cb.data;
  await answerCB(cb.id);await removeBtns(chatId,msgId);
  const session=sessions[chatId]||{};
  if(data==='ae_annuler'){delete sessionsAjoutEleve[chatId];await send(chatId,'Ajout annul\u00e9.');return;}
  if(data.startsWith('ae_niv_')){const sess=sessionsAjoutEleve[chatId];if(!sess)return;sess.niveau=data.replace('ae_niv_','');sess.etape='taux';await send(chatId,'\u00c9tape 3/7 \u2014 Taux horaire ? Ex: *24.50*');return;}
  if(data.startsWith('ae_dur_')){const sess=sessionsAjoutEleve[chatId];if(!sess)return;sess.duree=parseFloat(data.replace('ae_dur_',''));sess.etape='jour';const rows=JOURS_NOMS.map((j,i)=>[{t:j,d:'ae_jour_'+i}]);rows.push([{t:'Annuler',d:'ae_annuler'}]);await sendBtns(chatId,'\u00c9tape 5/7 \u2014 Jour ?',rows);return;}
  if(data.startsWith('ae_jour_')){const sess=sessionsAjoutEleve[chatId];if(!sess)return;sess.jour=parseInt(data.replace('ae_jour_',''));sess.etape='heure';await send(chatId,'\u00c9tape 6/7 \u2014 Heure ? Ex: *17h00*');return;}
  if(data.startsWith('ae_opt_')){const sess=sessionsAjoutEleve[chatId];if(!sess)return;const opt=data.replace('ae_opt_','');if(!sess.options)sess.options={};if(opt==='tda')sess.options.tda=true;else if(opt==='hebdo')sess.options.ficheHebdo=true;else if(opt==='2sem')sess.options.uneSemaineSurDeux=true;const eleveData={nom:sess.nom,niveau:sess.niveau,taux:sess.taux,duree:sess.duree,jour:sess.jour,heure:sess.heure,minute:sess.minute||0,tda:sess.options?.tda||false,ficheHebdo:sess.options?.ficheHebdo||false,uneSemaineSurDeux:sess.options?.uneSemaineSurDeux||false,question2h:true,fiche:true};const ok=await saveEleveCustom(chatId,eleveData);if(ok){ELEVES[eleveData.nom]=eleveData;await send(chatId,`\u2705 *${eleveData.nom}* ajout\u00e9 !`);}else{await send(chatId,'Erreur lors de l\'ajout.');}delete sessionsAjoutEleve[chatId];return;}
  if(data==='cours_oui'||data==='cours_non'){const eleve=session.eleve;if(!eleve)return;if(data==='cours_non'){const gm=await saveCoursManque(chatId,eleve);await send(chatId,`\u274c Cours ${eleve} non effectu\u00e9\n\ud83d\udcb8 Manque: *-${gm.toFixed(2)}\u20ac*`);if(session.fileAttente?.length>0){const next=session.fileAttente[0];sessions[chatId]={eleve:next,rattrapage:session.rattrapage,etape:'confirmation',fileAttente:session.fileAttente.slice(1)};await sendBtns(chatId,`\ud83d\udcda *${next}* \u2014 effectu\u00e9 ?`,[[{t:'\u2705 Oui',d:'cours_oui'},{t:'\u274c Non',d:'cours_non'}],[{t:'Annuler',d:'annuler'}]]);}else{delete sessions[chatId];}return;}if(ELEVES[eleve].question2h){sessions[chatId]={...session,etape:'question2h'};await sendBtns(chatId,`\u2705 Cours *${eleve}*\n\nC'\u00e9tait la s\u00e9ance \u00e0 2h ?`,[[{t:'2h (1\u00e8re s\u00e9ance)',d:'h2'},{t:'1h (suivante)',d:'h1'}],[{t:'Annuler',d:'annuler'}]]);}else{const gain=await saveCours(chatId,eleve,ELEVES[eleve].duree,session.rattrapage||false);await send(chatId,`\u2705 Cours ${eleve} enregistr\u00e9 ! *+${gain.toFixed(2)}\u20ac*`);await resumeCompletude(chatId);if(session.fileAttente?.length>0){const next=session.fileAttente[0];sessions[chatId]={eleve:next,rattrapage:session.rattrapage,etape:'confirmation',fileAttente:session.fileAttente.slice(1)};await sendBtns(chatId,`\ud83d\udcda *${next}* \u2014 effectu\u00e9 ?`,[[{t:'\u2705 Oui',d:'cours_oui'},{t:'\u274c Non',d:'cours_non'}],[{t:'Annuler',d:'annuler'}]]);}else{delete sessions[chatId];}}return;}
  if(data==='h2'||data==='h1'){const eleve=session.eleve;if(!eleve)return;const heures=data==='h2'?2:1;const gain=await saveCours(chatId,eleve,heures,session.rattrapage||false);await send(chatId,`\u2705 Cours ${eleve} enregistr\u00e9 ! *+${gain.toFixed(2)}\u20ac*`);await resumeCompletude(chatId);if(session.fileAttente?.length>0){const next=session.fileAttente[0];sessions[chatId]={eleve:next,rattrapage:session.rattrapage,etape:'confirmation',fileAttente:session.fileAttente.slice(1)};await sendBtns(chatId,`\ud83d\udcda *${next}* \u2014 effectu\u00e9 ?`,[[{t:'\u2705 Oui',d:'cours_oui'},{t:'\u274c Non',d:'cours_non'}],[{t:'Annuler',d:'annuler'}]]);}else{delete sessions[chatId];}return;}
  if(data.startsWith('cat_')){const cat=data.replace('cat_','');const montant=session.montant;if(!montant)return;await saveDepense(chatId,montant,cat,session.libelle||'');const nd=await getData();const restant=BUDGETS[cat].max-nd.totaux[cat];const emoji=restant<0?'\ud83d\udd34':restant<BUDGETS[cat].max*0.2?'\ud83d\udfe1':'\ud83d\udfe2';delete sessions[chatId];await send(chatId,`\u2705 *${montant}\u20ac* \u2014 ${BUDGETS[cat].label}\n${emoji} Restant: *${restant.toFixed(0)}\u20ac* / ${BUDGETS[cat].max}\u20ac`);return;}
  if(data==='annuler'){delete sessions[chatId];await send(chatId,'\u274c Action annul\u00e9e.');return;}
  if(data.startsWith('fiche_eleve_')){const eleve=data.replace('fiche_eleve_','');sessionsFiches[chatId]={eleve,etape:'attente_chapitre'};await send(chatId,`\ud83d\udcda Fiche pour *${eleve}*\n\nQuel chapitre ?`);return;}
  if(data==='fiche_annuler'){delete sessionsFiches[chatId];await send(chatId,'Fiche annul\u00e9e.');return;}
  if(data==='ann_cours_fait'){const rows=[];const noms=Object.keys(ELEVES);for(let i=0;i<noms.length;i+=3)rows.push(noms.slice(i,i+3).map(n=>({t:n,d:'ann_cf_'+n})));rows.push([{t:'Retour',d:'annuler'}]);sessionsAnnuler[chatId]={type:'cours_fait'};await sendBtns(chatId,'Quel cours annuler ?',rows);return;}
  if(data==='ann_cours_manque'){const rows=[];const noms=Object.keys(ELEVES);for(let i=0;i<noms.length;i+=3)rows.push(noms.slice(i,i+3).map(n=>({t:n,d:'ann_cm_'+n})));rows.push([{t:'Retour',d:'annuler'}]);await sendBtns(chatId,'Quel cours manqu\u00e9 annuler ?',rows);return;}
  if(data==='ann_depense'){const cats=Object.entries(BUDGETS);const rows=[];for(let i=0;i<cats.length;i+=3)rows.push(cats.slice(i,i+3).map(([k,b])=>({t:b.label,d:'ann_dep_'+k})));rows.push([{t:'Retour',d:'annuler'}]);await sendBtns(chatId,'Quelle d\u00e9pense annuler ?',rows);return;}
  if(data.startsWith('ann_cf_')){const eleve=data.replace('ann_cf_','');const ok=await annulerDernierCours(eleve);delete sessionsAnnuler[chatId];if(ok){await send(chatId,`\u2705 Cours *${eleve}* annul\u00e9 !`);await resumeCompletude(chatId);}else{await send(chatId,`Aucun cours trouv\u00e9 pour *${eleve}*.`);}return;}
  if(data.startsWith('ann_cm_')){const eleve=data.replace('ann_cm_','');const ok=await annulerDernierCoursManque(eleve);delete sessionsAnnuler[chatId];if(ok)await send(chatId,`\u2705 Cours manqu\u00e9 *${eleve}* annul\u00e9 !`);else await send(chatId,'Aucun cours manqu\u00e9 trouv\u00e9.');return;}
  if(data.startsWith('ann_dep_')){const cat=data.replace('ann_dep_','');const item=await annulerDerniereDepense(cat);if(item)await send(chatId,`\u2705 D\u00e9pense annul\u00e9e : *${item.montant} \u20ac* \u2014 ${BUDGETS[cat].label}`);else await send(chatId,'Aucune d\u00e9pense trouv\u00e9e.');return;}
  if(data==='mod_budget'){const cats=Object.entries(BUDGETS);const rows=[];for(let i=0;i<cats.length;i+=3)rows.push(cats.slice(i,i+3).map(([k,b])=>({t:b.label+' ('+b.max+'\u20ac)',d:'mod_bud_'+k})));rows.push([{t:'Retour',d:'annuler'}]);await sendBtns(chatId,'Quel budget modifier ?',rows);return;}
  if(data==='mod_depense'){const cats=Object.entries(BUDGETS);const rows=[];for(let i=0;i<cats.length;i+=3)rows.push(cats.slice(i,i+3).map(([k,b])=>({t:b.label,d:'mod_dep_'+k})));rows.push([{t:'Retour',d:'annuler'}]);await sendBtns(chatId,'Rectifier quelle d\u00e9pense ?',rows);return;}
  if(data.startsWith('mod_bud_')){const cat=data.replace('mod_bud_','');sessionsModifier[chatId]={etape:'attente_montant_budget',categorie:cat};await send(chatId,`Budget *${BUDGETS[cat].label}* actuel : *${BUDGETS[cat].max} \u20ac*\n\nNouveau plafond mensuel ?`);return;}
  if(data.startsWith('mod_dep_')){const cat=data.replace('mod_dep_','');sessionsModifier[chatId]={etape:'attente_rectif_depense',categorie:cat};await send(chatId,`Rectifier la derni\u00e8re d\u00e9pense *${BUDGETS[cat].label}*\n\nMontant correct ?`);return;}
  if(data.startsWith('rev_type_')){const type=data.replace('rev_type_','');sessionsRevenu[chatId]={type,etape:'montant'};await send(chatId,`\ud83d\udcb0 *${type}*\n\nMontant re\u00e7u ?`);return;}
}

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const body=req.body;
  if(body.callback_query){await traiterCallback(body.callback_query).catch(e=>console.error('CB error:',e.message));return;}
  const msg=body.message;if(!msg||!msg.text)return;
  const chatId=msg.chat.id,texte=msg.text.trim(),session=sessions[chatId]||{};
  try {
    if(texte==='/start'){delete sessions[chatId];await send(chatId,`\ud83d\udc4b Salut Nour-Dine ! Je suis *L'Agent*.\n\n\ud83d\udcda _"cours avec Margaux"_ \u2192 signaler un cours\n\ud83d\udcb8 _"Leclerc 45\u20ac"_ \u2192 d\u00e9pense\n\ud83d\udc64 /ajouteleve \u2192 nouvel \u00e9l\u00e8ve\n\ud83d\udcb0 /revenu \u2192 enregistrer une rentr\u00e9e\n\ud83d\udcc5 /prelevements \u2192 voir ce qui arrive\n\ud83c\udf10 Dashboard: https://budget-bot-production-eaaf.up.railway.app/dashboard`);return;}
    if(texte==='/reset'){delete sessions[chatId];await send(chatId,'\ud83d\udd04 R\u00e9initialis\u00e9 !');return;}
    if(texte==='/fiche'){await demarrerFiche(chatId);return;}
    if(texte==='/ajouteleve'||texte==='/ajouter'||/ajouter?\s+[\u00e9e]l[\u00e8e]ve/i.test(texte)){await demarrerAjoutEleve(chatId);return;}
    if(texte==='/revenu'||texte==='/revenus'){await sendBtns(chatId,'\ud83d\udcb0 *Quel type de rentr\u00e9e ?*',[[{t:'\ud83d\udcbc Vinted / vente',d:'rev_type_Vente Vinted'},{t:'\ud83d\udd04 Remboursement',d:'rev_type_Remboursement'}],[{t:'\ud83c\udf81 Cadeau / don',d:'rev_type_Cadeau'},{t:'\ud83d\udce6 Autre',d:'rev_type_Autre revenu'}],[{t:'Annuler',d:'annuler'}]]);return;}
    if(texte==='/prelevements'||texte==='\/pr\u00e9l\u00e8vements'){const now=new Date(new Date().toLocaleString('en-US',{timeZone:'Europe/Paris'}));const auj=now.getDate();const av=getPrelEvementsAVenir(7);const tot=getTotalPrelevementsRestants();let m=`\ud83d\udcc5 *Pr\u00e9l\u00e8vements \u2014 Suivi du mois*\n\n\ud83d\udccd Nous sommes le *${auj}*\n\ud83d\udcb0 Total restant ce mois: *${tot.toFixed(2)}\u20ac*\n\n`;if(av.length>0){m+='\u26a0\ufe0f *Dans les 7 prochains jours:*\n';av.forEach(p=>{const q=p.dansJours===0?'Aujourd\'hui':p.dansJours===1?'Demain':'Dans '+p.dansJours+'j';m+='\u2022 '+q+' ('+p.jourEffectif+') \u2014 '+p.nom+': *'+p.montant.toFixed(2)+'\u20ac*\n';});const ts=av.reduce((s,p)=>s+p.montant,0);m+='\n\ud83d\udcb8 Total cette semaine: *'+ts.toFixed(2)+'\u20ac*\n';}else{m+='\u2705 Aucun pr\u00e9l\u00e8vement dans les 7 prochains jours\n';}await send(chatId,m);return;}
    if(texte==='/annuler'){await sendBtns(chatId,'\ud83d\udd04 *Que veux-tu annuler ?*',[[{t:'\ud83d\udcda Un cours effectu\u00e9',d:'ann_cours_fait'},{t:'\u274c Un cours manqu\u00e9',d:'ann_cours_manque'}],[{t:'\ud83d\udcb8 Une d\u00e9pense',d:'ann_depense'}],[{t:'Annuler',d:'annuler'}]]);return;}
    if(texte==='/modifier'){await sendBtns(chatId,'\u270f\ufe0f *Que veux-tu modifier ?*',[[{t:'\ud83d\udcca Un budget cat\u00e9gorie',d:'mod_budget'}],[{t:'\ud83d\udcb8 Rectifier une d\u00e9pense',d:'mod_depense'}],[{t:'Annuler',d:'annuler'}]]);return;}
    if(sessionsAjoutEleve[chatId]){const handled=await traiterAjoutEleve(chatId,texte);if(handled)return;}
    if(sessionsRevenu[chatId]?.etape==='montant'){const m=trouverMontant(texte);if(m&&m>0){const type=sessionsRevenu[chatId].type;delete sessionsRevenu[chatId];await saveRevenu(chatId,m,type);await send(chatId,`\u2705 Rentr\u00e9e *+${m}\u20ac* enregistr\u00e9e !`);}else{await send(chatId,'Envoie un montant valide, ex: *150*');}return;}
    if(sessionsModifier[chatId]?.etape==='attente_montant_budget'){const cat=sessionsModifier[chatId].categorie;const m=trouverMontant(texte);if(m&&m>0){BUDGETS[cat].max=m;delete sessionsModifier[chatId];await send(chatId,`\u2705 Budget *${BUDGETS[cat].label}* mis \u00e0 jour : *${m} \u20ac/mois*`);}else{await send(chatId,'Envoie un montant valide, ex: *400*');}return;}
    if(sessionsModifier[chatId]?.etape==='attente_rectif_depense'){const cat=sessionsModifier[chatId].categorie;const m=trouverMontant(texte);if(m&&m>0){const item=await annulerDerniereDepense(cat);if(item){await saveDepense(chatId,m,cat,item.libelle||texte);delete sessionsModifier[chatId];await send(chatId,`\u2705 D\u00e9pense rectifi\u00e9e : *${m} \u20ac* \u2014 ${BUDGETS[cat].label}`);}else{await send(chatId,'Aucune d\u00e9pense trouv\u00e9e.');delete sessionsModifier[chatId];}}else{await send(chatId,'Envoie le nouveau montant, ex: *45*');}return;}
    if(sessionsFiches[chatId]?.etape==='attente_chapitre'){const eleve=sessionsFiches[chatId].eleve;delete sessionsFiches[chatId];await send(chatId,`\ud83d\udcdd G\u00e9n\u00e9ration de la fiche pour *${eleve}*...`);try{const contenu=await genererContenuFiche(eleve,texte);const pdfPath=await creerPDF(eleve,texte,contenu);await sendDocument(chatId,pdfPath,`fiche_${eleve}_${texte.replace(/ /g,'_')}.pdf`);fs.unlinkSync(pdfPath);}catch(err){console.error('Erreur fiche PDF:',err.message);await send(chatId,'Erreur g\u00e9n\u00e9ration fiche.');}return;}
    if(texte==='/bilan'){const data=await getData();let m=`\ud83d\udcca *Bilan ${new Date().toLocaleString('fr-FR',{month:'long',year:'numeric'})}*\n\n`;Object.entries(data.totaux).forEach(([k,v])=>{const e=v>BUDGETS[k].max?'\ud83d\udd34':v>BUDGETS[k].max*0.8?'\ud83d\udfe1':'\ud83d\udfe2';m+=e+' '+BUDGETS[k].label+': '+v.toFixed(0)+'\u20ac / '+BUDGETS[k].max+'\u20ac\n';});m+='\n\ud83d\udcb0 *Solde: '+(data.solde>=0?'+':'')+data.solde.toFixed(0)+'\u20ac*';await send(chatId,m);return;}
    if(texte==='/completude'){const data=await getData();let m='\ud83d\udcda *Compl\u00e9tude '+new Date().toLocaleString('fr-FR',{month:'long',year:'numeric'})+'*\n\n\ud83d\udfe2 *'+data.completude.toFixed(2)+'\u20ac* / '+OBJECTIF_COMPLETUDE+'\u20ac\nCours: '+data.cours.length+'\n';if(data.cours.length>0){m+='\n*D\u00e9tail:*\n';data.cours.forEach(c=>{m+='\u2022 '+c.eleve+(c.rattrapage?' (rattrapage)':'')+': +'+c.gain.toFixed(2)+'\u20ac\n';});}if(data.coursManques.length>0){m+='\n\u274c *Manques:*\n';data.coursManques.forEach(c=>{m+='\u2022 '+c.eleve+': -'+c.gain_manque.toFixed(2)+'\u20ac\n';});}await send(chatId,m);return;}
    if(texte==='/objectifs'){const data=await getData();let m='\ud83c\udfaf *Objectifs \u00e9pargne*\n\n\ud83d\udcbc Actuelle: *'+data.epargneBase.toLocaleString()+'\u20ac*\n\ud83d\udcc8 Projection: *'+data.epargneEstimee.toFixed(0)+'\u20ac*\n\n';OBJECTIFS.forEach(o=>{const delta=data.epargneEstimee-o.montant;const pct=Math.min(100,Math.round((data.epargneEstimee/o.montant)*100));m+=(delta>=0?'\u2705':'\u26a0\ufe0f')+' *'+o.label+'*: '+o.montant.toLocaleString()+'\u20ac \u2014 '+pct+'%\n';});await send(chatId,m);return;}
    const tousEleves=trouverTousLesEleves(texte),eleve=tousEleves[0]||null;
    const isCours=/cours|rattrapage|seance/i.test(texte),isPasFait=/pas fait|absent|annule|pas pu|rate/i.test(texte);
    if(eleve&&isCours){const rattrapage=/rattrapage/i.test(texte);const fileAttente=tousEleves.slice(1);if(isPasFait){for(const el of tousEleves){const gm=await saveCoursManque(chatId,el);await send(chatId,`\u274c Cours ${el} non effectu\u00e9\n\ud83d\udcb8 Manque: *-${gm.toFixed(2)}\u20ac*`);}return;}sessions[chatId]={eleve,rattrapage,etape:'confirmation',fileAttente};await sendBtns(chatId,`\ud83d\udcda Cours avec *${eleve}*${rattrapage?' _(rattrapage)_':''} \u2014 effectu\u00e9 ?`,[[{t:'\u2705 Oui',d:'cours_oui'},{t:'\u274c Non',d:'cours_non'}],[{t:'Annuler',d:'annuler'}]]);return;}
    const montant=trouverMontant(texte),cat=trouverCategorie(texte);
    if(montant&&montant>0&&montant<5000&&!isCours){if(cat){await saveDepense(chatId,montant,cat,texte);const nd=await getData();const restant=BUDGETS[cat].max-nd.totaux[cat];const emoji=restant<0?'\ud83d\udd34':restant<BUDGETS[cat].max*0.2?'\ud83d\udfe1':'\ud83d\udfe2';await send(chatId,`\u2705 *${montant}\u20ac* \u2014 ${BUDGETS[cat].label}\n${emoji} Restant: *${restant.toFixed(0)}\u20ac* / ${BUDGETS[cat].max}\u20ac`);}else{sessions[chatId]={montant,libelle:texte,etape:'choix_cat'};const cats=Object.entries(BUDGETS);const rows=[];for(let i=0;i<cats.length;i+=3)rows.push(cats.slice(i,i+3).map(([k,b])=>({t:b.label,d:'cat_'+k})));rows.push([{t:'Annuler',d:'annuler'}]);await sendBtns(chatId,`\ud83d\udcb8 *${montant}\u20ac* \u2014 Quelle cat\u00e9gorie ?`,rows);}return;}
    if(/salaire|lgm|paie/i.test(texte)&&montant&&montant>1000){await saveSalaire(chatId,montant);await send(chatId,`\u2705 Salaire LGM enregistr\u00e9: *${montant}\u20ac*`);return;}
    if(/epargne|\u00e9pargne|economies/i.test(texte)&&montant&&montant>1000){await saveEpargne(chatId,montant);await send(chatId,`\u2705 \u00c9pargne mise \u00e0 jour: *${montant.toLocaleString()}\u20ac*`);return;}
    if(/recu|vinted|remboursement|rentree|participation/i.test(texte)&&montant){await saveRevenu(chatId,montant,texte);await send(chatId,`\u2705 Rentr\u00e9e *+${montant}\u20ac* enregistr\u00e9e !`);return;}
    const data=await getData();const reponse=await geminiParle(chatId,texte,data);await send(chatId,reponse);
  } catch(err){console.error('Erreur webhook:',err.message);await send(chatId,'Erreur technique, r\u00e9essaie.');}
});

async function envoyerRappelBiHebdo(){const data=await getData();const mois=new Date().toLocaleString('fr-FR',{month:'long',year:'numeric'});const aVenir=getPrelEvementsAVenir(5);let m=`\ud83d\udccb *Rappel bi-hebdo \u2014 ${mois}*\n\n\ud83d\udcb0 LGM: ${data.salaire}\u20ac | Compl\u00e9tude: ${data.completude.toFixed(0)}\u20ac/${OBJECTIF_COMPLETUDE}\u20ac\n\n\ud83d\udcb8 *D\u00e9penses:*\n`;Object.entries(data.totaux).forEach(([k,v])=>{if(v>0){const e=v>BUDGETS[k].max?'\ud83d\udd34':v>BUDGETS[k].max*0.8?'\ud83d\udfe1':'\ud83d\udfe2';m+=e+' '+BUDGETS[k].label+': '+v.toFixed(0)+'\u20ac/'+BUDGETS[k].max+'\u20ac\n';}});m+='\n\ud83d\udcca Solde: *'+(data.solde>=0?'+':'')+data.solde.toFixed(0)+'\u20ac*';if(data.totalManque>0)m+='\n\ud83d\udcb8 Manques: *-'+data.totalManque.toFixed(0)+'\u20ac*';if(aVenir.length>0){const ts=aVenir.reduce((s,p)=>s+p.montant,0);m+='\n\n\u26a0\ufe0f *Pr\u00e9l\u00e8vements dans 5j: -'+ts.toFixed(0)+'\u20ac*\n';aVenir.forEach(p=>m+='\u2022 '+p.nom+': '+p.montant.toFixed(0)+'\u20ac (le '+p.jourEffectif+')\n');}await send(CHAT_ID,m);}
async function envoyerSyntheseMensuelle(){const data=await getData();const mois=new Date().toLocaleString('fr-FR',{month:'long',year:'numeric'}).toUpperCase();let m='\ud83d\uddd3\ufe0f *SYNTH\u00c8SE '+mois+'*\n\n\u2705 *REVENUS: '+data.totalRevenus.toFixed(0)+'\u20ac*\n\u2022 LGM: '+data.salaire+'\u20ac\n\u2022 Compl\u00e9tude: '+data.completude.toFixed(0)+'\u20ac\n';if(data.revenusSupp>0)m+='\u2022 Divers: '+data.revenusSupp.toFixed(0)+'\u20ac\n';m+='\n\ud83d\udd12 *CHARGES: -'+TOTAL_CHARGES_FIXES.toFixed(0)+'\u20ac*\n\n\ud83d\udcb8 *D\u00c9PENSES: -'+data.totalDep.toFixed(0)+'\u20ac*\n';Object.entries(data.totaux).forEach(([k,v])=>{const e=v>BUDGETS[k].max?'\ud83d\udd34':v>BUDGETS[k].max*0.8?'\ud83d\udfe1':'\ud83d\udfe2';m+=e+' '+BUDGETS[k].label+': '+v.toFixed(0)+'\u20ac/'+BUDGETS[k].max+'\u20ac\n';});m+='\n\ud83d\udcb0 *SOLDE: '+(data.solde>=0?'+':'')+data.solde.toFixed(0)+'\u20ac*\n\n\ud83c\udfaf *OBJECTIFS:*\n';OBJECTIFS.forEach(o=>{const delta=data.epargneEstimee-o.montant;m+=(delta>=0?'\u2705':'\u26a0\ufe0f')+' '+o.label+': '+o.montant.toLocaleString()+'\u20ac ('+(delta>=0?'+':'')+delta.toFixed(0)+'\u20ac)\n';});await send(CHAT_ID,m);}

function estSemaineSerena(){const debut=new Date('2026-05-10');return Math.floor((new Date()-debut)/(7*24*60*60*1000))%2===0;}

function demarrerScheduler(){
  setInterval(()=>{fetch('https://budget-bot-production-eaaf.up.railway.app/').catch(()=>{});},4*60*1000);
  setInterval(async()=>{
    const now=new Date(new Date().toLocaleString('en-US',{timeZone:'Europe/Paris'}));
    const jour=now.getDay(),heure=now.getHours(),minute=now.getMinutes();
    if((jour===3||jour===0)&&heure===20&&minute===0)await envoyerRappelBiHebdo();
    if(now.getDate()===30&&heure===20&&minute===0)await envoyerSyntheseMensuelle();
    const demain=now.getDate()+1;
    if(heure===9&&minute===0){const alertes=PRELEVEMENTS_DATES.filter(p=>p.jour===demain);if(alertes.length>0){const total=alertes.reduce((s,p)=>s+p.montant,0);let m='\u26a0\ufe0f *Pr\u00e9l\u00e8vements demain ('+demain+')*\n\n';alertes.forEach(p=>m+='\u2022 '+p.nom+': *'+p.montant.toFixed(2)+'\u20ac*\n');m+='\n\ud83d\udcb8 Total: *'+total.toFixed(2)+'\u20ac*';await send(CHAT_ID,m);}}
    for(const[nomEleve,profil]of Object.entries(ELEVES)){if(profil.jour!==jour)continue;if(profil.uneSemaineSurDeux&&!estSemaineSerena())continue;const totalMin=profil.minute+Math.floor(profil.duree*60);const heureFin=profil.heure+Math.floor(totalMin/60);const minuteFin=totalMin%60;if(heure===heureFin&&minute===minuteFin){sessions[CHAT_ID]={eleve:nomEleve,rattrapage:false,etape:'confirmation'};await sendBtns(CHAT_ID,`\ud83d\udcda *Fin de cours !*\n\nAs-tu fait cours avec *${nomEleve}* ?`,[[{t:'\u2705 Oui',d:'cours_oui'},{t:'\u274c Non',d:'cours_non'}],[{t:'Annuler',d:'annuler'}]]);}}
  },60000);
}

async function sendDocument(chatId,filePath,filename){const FormData=require('form-data');const form=new FormData();form.append('chat_id',String(chatId));form.append('document',fs.createReadStream(filePath),{filename});await fetch(`https://api.telegram.org/bot${TOKEN}/sendDocument`,{method:'POST',body:form,headers:form.getHeaders()});}

app.get('/api/dashboard', async (req, res) => {
  try {
    const moisOffset=parseInt(req.query.mois||'0');
    const data=await getData(moisOffset);
    const aVenir=getPrelEvementsAVenir(7);
    const totalRestant=getTotalPrelevementsRestants();
    const moisDisponibles=[];
    for(let i=-5;i<=0;i++){const d=new Date();d.setUTCMonth(d.getUTCMonth()+i);moisDisponibles.push({offset:i,label:d.toLocaleString('fr-FR',{month:'long',year:'numeric'}),isCurrent:i===0});}
    res.json({salaire:data.salaire,beau_frere:BEAU_FRERE,completude:data.completude,objectif_completude:OBJECTIF_COMPLETUDE,total_revenus:data.totalRevenus,charges_fixes:TOTAL_CHARGES_FIXES,total_dep:data.totalDep,solde:data.solde,epargne_base:data.epargneBase,epargne_estimee:data.epargneEstimee,total_manque:data.totalManque,nb_cours:data.cours.length,nb_cours_manques:data.coursManques.length,cours:data.cours,cours_manques:data.coursManques,totaux:data.totaux,detail:data.detail,budgets:BUDGETS,objectifs:OBJECTIFS,revenus_supp:data.revenus,prelevements_a_venir:aVenir,total_prelevements_restants:totalRestant,prelevements_tous:PRELEVEMENTS_DATES,mois_offset:moisOffset,mois_disponibles:moisDisponibles});
  } catch(err){res.status(500).json({error:err.message});}
});

// ============================================================
// DASHBOARD — remplace app.get('/dashboard', ...) dans index.js
// ============================================================
app.get('/dashboard', (req, res) => {
  const BG = 'data:image/jpeg;base64,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';
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0a0f1e">
<title>Comptable</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Sora:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{
  --or:#F26419;--amber:#FFAA44;
  --g:#4ade80;--r:#f87171;--b:#60a5fa;
  --tx:#e8ecf0;--mu:#5a6a7a;
  --card:rgba(8,16,30,0.70);
  --bord:rgba(255,255,255,0.08);
  --mono:'DM Mono',monospace;
}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%;font-family:'Sora',sans-serif;color:var(--tx);overflow-x:hidden}
body{
  padding-bottom:env(safe-area-inset-bottom,20px);
  padding-bottom:calc(env(safe-area-inset-bottom,20px) + 20px);
  background:#060c18;
}

/* ── BG IMAGE ── */
.bg{
  position:fixed;inset:0;z-index:0;
  background:url('${BG}') center/cover no-repeat;
}
.bg-ov{
  position:fixed;inset:0;z-index:1;
  background:linear-gradient(
    180deg,
    rgba(4,8,20,0.88) 0%,
    rgba(6,12,28,0.72) 35%,
    rgba(6,12,28,0.72) 65%,
    rgba(4,8,20,0.95) 100%
  );
}

/* ── SAFE AREA STATUS BAR ── */
.safe-top{
  position:fixed;top:0;left:0;right:0;z-index:100;
  height:env(safe-area-inset-top,47px);
  background:rgba(4,8,20,0.88);
  backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
}

/* ── CONTENU ── */
.wrap{
  position:relative;z-index:10;
  max-width:430px;margin:0 auto;
  padding-top:calc(env(safe-area-inset-top,47px) + 0px);
}

/* ── HEADER ── */
.header{
  padding:.9rem 1rem .6rem;
  background:rgba(4,8,20,0.60);
  backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
  border-bottom:1px solid var(--bord);
  position:sticky;
  top:env(safe-area-inset-top,47px);
  z-index:50;
}
.header-row{display:flex;justify-content:space-between;align-items:center}
.brand{display:flex;align-items:center;gap:10px}
.brand-ico{
  width:34px;height:34px;border-radius:10px;
  background:linear-gradient(135deg,var(--or),var(--amber));
  display:grid;place-items:center;font-size:.95rem;
  box-shadow:0 3px 12px rgba(242,100,25,.4);
  flex-shrink:0;
}
.brand-name{font-size:1rem;font-weight:700;letter-spacing:-.02em}
.brand-sub{font-size:.58rem;color:var(--mu);letter-spacing:.07em;text-transform:uppercase;margin-top:1px}
.hsolde-lbl{font-size:.55rem;color:var(--mu);text-transform:uppercase;letter-spacing:.07em;text-align:right}
.hsolde-val{font-size:1.05rem;font-weight:700;font-family:var(--mono);text-align:right}

/* mois nav */
.mois-nav{
  display:flex;align-items:center;justify-content:space-between;
  margin:.5rem 0 0;
  background:rgba(255,255,255,0.04);border-radius:9px;padding:4px 8px;
}
.mbtn{background:none;border:none;color:var(--mu);font-size:.95rem;cursor:pointer;padding:2px 10px;border-radius:6px;transition:.15s}
.mbtn:hover:not(:disabled){color:var(--tx);background:rgba(255,255,255,.07)}
.mbtn:disabled{opacity:.2;cursor:default}
.mlbl{font-size:.76rem;font-weight:600;text-align:center}
.mbadge{font-size:.56rem;color:var(--or);text-align:center;letter-spacing:.06em;text-transform:uppercase}

/* ── TABS ── */
.tabs{
  display:flex;gap:2px;
  padding:.5rem .75rem .25rem;
  overflow-x:auto;
  -webkit-overflow-scrolling:touch;
  scrollbar-width:none;
}
.tabs::-webkit-scrollbar{display:none}
.tab{
  flex:0 0 auto;
  padding:6px 11px;font-size:.58rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
  border-radius:7px;cursor:pointer;
  color:rgba(255,255,255,.38);border:1px solid transparent;
  transition:.18s;white-space:nowrap;
}
.tab.active{
  background:rgba(242,100,25,.18);color:var(--or);
  border-color:rgba(242,100,25,.35);
}

/* ── SECTIONS ── */
.sec{display:none;padding:.5rem .75rem 0}
.sec.on{display:block}

/* ── GRID ── */
.grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:.5rem}
.full{grid-column:1/-1}

/* ── CARD ── */
.card{
  background:var(--card);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  border-radius:14px;padding:.8rem;
  border:1px solid var(--bord);
}
.clbl{font-size:.56rem;text-transform:uppercase;letter-spacing:.08em;color:var(--mu);margin-bottom:.3rem}
.cval{font-size:1.4rem;font-weight:700;font-family:var(--mono);letter-spacing:-.02em;line-height:1.1}
.csub{font-size:.6rem;color:var(--mu);margin-top:.25rem;line-height:1.4}

/* ── BAR ── */
.bar{height:3px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden;margin:.45rem 0 .2rem}
.fill{height:100%;border-radius:2px;transition:width .6s cubic-bezier(.4,0,.2,1)}

/* ── ROWS ── */
.row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:.74rem}
.row:last-child{border-bottom:none}
.row-left{display:flex;align-items:center;gap:8px}
.row-ico{font-size:.9rem;width:22px;text-align:center}
.row-meta{display:flex;flex-direction:column;gap:1px}
.row-name{font-size:.74rem}
.row-sub{font-size:.58rem;color:var(--mu)}
.row-right{text-align:right;flex-shrink:0}
.row-val{font-family:var(--mono);font-size:.78rem}
.row-pct{font-size:.56rem;color:var(--mu)}

/* ── BADGES ── */
.badge{display:inline-block;font-size:.56rem;padding:2px 7px;border-radius:5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.b-hist{background:#1a1a30;color:#6366f1;border:1px solid #2a2a50}
.b-ok{background:rgba(74,222,128,.12);color:var(--g)}
.b-warn{background:rgba(251,191,36,.12);color:var(--amber)}
.b-err{background:rgba(248,113,113,.12);color:var(--r)}
.b-or{background:rgba(242,100,25,.12);color:var(--or)}

/* ── PREL BADGES ── */
.pb{font-size:.56rem;padding:2px 7px;border-radius:5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.pb-u{background:#2d0a0a;color:var(--r)}
.pb-s{background:#2d1f04;color:var(--amber)}
.pb-o{background:#0a1e0f;color:var(--g)}
.prel-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:.74rem}
.prel-row:last-child{border-bottom:none}
.prel-row.past{opacity:.32}
.stitle{font-size:.55rem;color:var(--mu);text-transform:uppercase;letter-spacing:.07em;padding:8px 0 3px}

/* ── ALERT BOX ── */
.abox{
  background:rgba(22,14,6,.85);border:1px solid rgba(255,170,68,.22);
  border-radius:11px;padding:.7rem .8rem;margin-bottom:.5rem;
}
.abox-title{color:var(--amber);font-weight:700;font-size:.76rem;margin-bottom:.35rem}

/* ── OBJECTIFS ── */
.obj{padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.obj:last-child{border-bottom:none}
.obj-h{display:flex;justify-content:space-between;font-size:.76rem;margin-bottom:.35rem}

/* ── COURS ── */
.crow{display:flex;justify-content:space-between;font-size:.72rem;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.crow:last-child{border-bottom:none}

/* ── BUDGET CATEGORY ── */
.ccat{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;transition:opacity .15s}
.ccat:last-of-type{border-bottom:none}
.ccat:hover{opacity:.72}
.ccat .chev{color:var(--mu);font-size:.7rem;transition:transform .2s;margin-left:4px}
.ccat.open .chev{transform:rotate(90deg)}
.cdet{display:none;background:rgba(0,0,0,.35);border-radius:9px;padding:6px 10px;margin:3px 0 6px}
.cdet.open{display:block}
.dep-i{display:flex;justify-content:space-between;font-size:.68rem;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04);color:#8a9ab0}
.dep-i:last-child{border-bottom:none}
.minibar{width:40px;height:3px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden;flex-shrink:0}
.minifill{height:100%;border-radius:2px}

/* ── TOTAL DEP ── */
.dep-total{
  display:flex;justify-content:space-between;align-items:center;
  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);
  border-radius:10px;padding:.6rem .75rem;margin-top:.55rem;
}

/* ── REFRESH ── */
.refresh{
  position:fixed;
  bottom:calc(env(safe-area-inset-bottom,20px) + 1rem);
  right:1.1rem;z-index:200;
  background:linear-gradient(135deg,var(--or),var(--amber));
  color:#fff;border:none;border-radius:50%;
  width:44px;height:44px;font-size:1.1rem;
  cursor:pointer;box-shadow:0 4px 16px rgba(242,100,25,.45);
  transition:transform .2s;
}
.refresh:active{transform:scale(.92) rotate(30deg)}
.upd{text-align:center;font-size:.58rem;color:#2a3545;padding:.8rem 0 1rem}

.green{color:var(--g)}.amber{color:var(--amber)}.red{color:var(--r)}.orange{color:var(--or)}
</style>
</head>
<body>

<div class="bg"></div>
<div class="bg-ov"></div>
<div class="safe-top"></div>

<div class="wrap">

  <!-- HEADER -->
  <div class="header">
    <div class="header-row">
      <div class="brand">
        <div class="brand-ico">💼</div>
        <div>
          <div class="brand-name">Comptable</div>
          <div class="brand-sub">Tableau de bord</div>
        </div>
      </div>
      <div>
        <div class="hsolde-lbl">Solde mois</div>
        <div class="hsolde-val" id="h-solde">—</div>
      </div>
    </div>
    <div class="mois-nav">
      <button class="mbtn" onclick="changerMois(-1)">◀</button>
      <div>
        <div class="mlbl" id="mois-label">—</div>
        <div class="mbadge" id="mois-badge"></div>
      </div>
      <button class="mbtn" id="btn-next" onclick="changerMois(1)">▶</button>
    </div>
  </div>

  <!-- TABS -->
  <div class="tabs">
    <div class="tab active" onclick="setTab('apercu')">Aperçu</div>
    <div class="tab" onclick="setTab('cours')">Cours</div>
    <div class="tab" onclick="setTab('revenus')">Revenus</div>
    <div class="tab" onclick="setTab('depenses')">Dépenses</div>
    <div class="tab" onclick="setTab('prelevements')">Prélèv.</div>
    <div class="tab" onclick="setTab('objectifs')">Objectifs</div>
  </div>

  <!-- ── APERÇU ── -->
  <div class="sec on" id="tab-apercu">
    <div class="grid">
      <div class="card">
        <div class="clbl">Épargne actuelle</div>
        <div class="cval green" id="a-ep">—</div>
      </div>
      <div class="card">
        <div class="clbl">Projection fin mois</div>
        <div class="cval" id="a-pr">—</div>
      </div>
      <div class="card">
        <div class="clbl">Revenus</div>
        <div class="cval green" id="a-rv">—</div>
        <div class="csub" id="a-rv-sub">—</div>
      </div>
      <div class="card">
        <div class="clbl">Charges fixes</div>
        <div class="cval orange" id="a-cf">—</div>
        <div class="csub red" id="a-dp-sub">—</div>
      </div>
      <div class="card">
        <div class="clbl">Solde estimé</div>
        <div class="cval" id="a-sl">—</div>
        <div class="bar"><div class="fill" id="a-sl-b"></div></div>
      </div>
      <div class="card">
        <div class="clbl">Complétude</div>
        <div class="cval" id="a-co">—</div>
        <div class="bar"><div class="fill" id="a-co-b"></div></div>
        <div class="csub" id="a-co-s">—</div>
      </div>
    </div>
  </div>

  <!-- ── COURS ── -->
  <div class="sec" id="tab-cours">
    <div class="grid">
      <div class="card">
        <div class="clbl">Effectués</div>
        <div class="cval green" id="c-nb">—</div>
      </div>
      <div class="card">
        <div class="clbl">Manqués</div>
        <div class="cval red" id="c-mn">—</div>
        <div class="csub" id="c-mv">—</div>
      </div>
      <div class="card full">
        <div class="clbl" style="margin-bottom:.5rem">Détail cours effectués</div>
        <div id="c-ls"><span style="color:var(--mu);font-size:.72rem">—</span></div>
      </div>
      <div class="card full" id="c-mc" style="display:none">
        <div class="clbl" style="margin-bottom:.5rem">Cours manqués</div>
        <div id="c-ml"></div>
      </div>
    </div>
  </div>

  <!-- ── REVENUS ── -->
  <div class="sec" id="tab-revenus">
    <div class="grid">
      <div class="card">
        <div class="clbl">Total revenus</div>
        <div class="cval green" id="r-total">—</div>
      </div>
      <div class="card">
        <div class="clbl">Complétude</div>
        <div class="cval" id="r-co">—</div>
        <div class="csub" id="r-co-s">—</div>
      </div>
      <div class="card full" id="r-sources">
        <div class="clbl" style="margin-bottom:.5rem">Sources</div>
      </div>
      <div class="card full" id="r-supp" style="display:none"></div>
    </div>
  </div>

  <!-- ── DÉPENSES ── -->
  <div class="sec" id="tab-depenses">
    <div class="grid">
      <div class="card full" id="b-ls">
        <div class="clbl">Dépenses variables</div>
      </div>
    </div>
  </div>

  <!-- ── PRÉLÈVEMENTS ── -->
  <div class="sec" id="tab-prelevements">
    <div class="grid">
      <div class="card full" id="p-alert" style="display:none"></div>
      <div class="card full" id="p-ls">Chargement...</div>
    </div>
  </div>

  <!-- ── OBJECTIFS ── -->
  <div class="sec" id="tab-objectifs">
    <div class="grid">
      <div class="card full" id="o-ls">Chargement...</div>
    </div>
  </div>

</div><!-- /wrap -->

<button class="refresh" onclick="charger()" title="Actualiser">↻</button>
<div class="upd" id="upd">—</div>

<script>
let moisOffset=0;

/* helpers */
function fmt(n){return Math.round(n).toLocaleString('fr-FR')+'\u202f€'}
function fmt2(n){return n.toFixed(2)+'\u202f€'}
function pct(v,m){return Math.min(100,Math.max(0,Math.round(v/m*100)))}
function colP(p){return p>=100?'var(--r)':p>=80?'var(--amber)':'var(--g)'}
function colS(v){return v>=500?'var(--g)':v>=0?'var(--amber)':'var(--r)'}
function el(id){return document.getElementById(id)}

function setTab(t){
  const names=['apercu','cours','revenus','depenses','prelevements','objectifs'];
  document.querySelectorAll('.tab').forEach((e,i)=>e.classList.toggle('active',names[i]===t));
  document.querySelectorAll('.sec').forEach(e=>e.classList.remove('on'));
  el('tab-'+t).classList.add('on');
}
function changerMois(d){const n=moisOffset+d;if(n>0)return;moisOffset=n;charger()}
function toggleCat(k){
  el('cat-btn-'+k).classList.toggle('open');
  el('cat-det-'+k).classList.toggle('open');
}

/* ── RENDER APERÇU ── */
function renderApercu(d){
  el('a-ep').textContent=fmt(d.epargne_base);
  const pr=el('a-pr');
  pr.textContent=fmt(d.epargne_estimee);
  pr.style.color=d.epargne_estimee>=12500?'var(--g)':d.epargne_estimee>=10000?'var(--amber)':'var(--r)';

  el('a-rv').textContent=fmt(d.total_revenus);
  const parts=[];
  if(d.salaire)parts.push('LGM '+Math.round(d.salaire)+'€');
  if(d.completude)parts.push('Cours '+Math.round(d.completude)+'€');
  if((d.revenus_supp||[]).length)parts.push('+divers');
  el('a-rv-sub').textContent=parts.join(' · ');

  el('a-cf').textContent=fmt(d.charges_fixes);
  el('a-dp-sub').textContent='Variables : -'+Math.round(d.total_dep)+'\u202f€';

  const sl=el('a-sl');
  sl.textContent=(d.solde>=0?'+':'')+fmt(d.solde);
  sl.style.color=colS(d.solde);
  el('a-sl-b').style.cssText='width:'+Math.min(100,Math.max(0,(d.solde/1500)*100))+'%;background:'+colS(d.solde);

  const cp=pct(d.completude,d.objectif_completude);
  const co=el('a-co');
  co.textContent=fmt(d.completude);
  co.style.color=colP(cp);
  el('a-co-b').style.cssText='width:'+cp+'%;background:'+colP(cp);
  el('a-co-s').textContent=Math.round(d.completude)+' / '+d.objectif_completude+'\u202f€ ('+cp+'%)';
}

/* ── RENDER COURS ── */
function renderCours(d){
  el('c-nb').textContent=d.nb_cours;
  el('c-mn').textContent=d.nb_cours_manques;
  el('c-mv').textContent=d.total_manque>0?'-'+fmt(d.total_manque)+' manqués':'Aucun';
  el('c-ls').innerHTML=d.cours.length===0
    ?'<span style="color:var(--mu);font-size:.72rem">Aucun cours ce mois</span>'
    :d.cours.map(c=>'<div class="crow"><span>'+c.eleve+(c.rattrapage?' <span style="color:var(--mu)">(rattrapage)</span>':'')+'</span><span class="green" style="font-family:var(--mono)">+'+c.gain.toFixed(2)+'\u202f€</span></div>').join('');
  const mc=el('c-mc');
  if(d.nb_cours_manques>0){
    mc.style.display='block';
    el('c-ml').innerHTML=d.cours_manques.map(c=>'<div class="crow"><span>'+c.eleve+'</span><span class="red" style="font-family:var(--mono)">-'+c.gain_manque.toFixed(2)+'\u202f€</span></div>').join('');
  }else{mc.style.display='none'}
}

/* ── RENDER REVENUS ── */
function renderRevenus(d){
  el('r-total').textContent=fmt(d.total_revenus);
  const cp=pct(d.completude,d.objectif_completude);
  const rco=el('r-co');
  rco.textContent=fmt(d.completude);
  rco.style.color=colP(cp);
  el('r-co-s').textContent=cp+'% de l\'objectif '+d.objectif_completude+'\u202f€';

  const sources=[
    {ico:'💼',nom:'Salaire LGM',val:d.salaire,sub:'Mensuel net'},
    {ico:'👤',nom:'Beau-frère',val:d.beau_frere,sub:'Mensuel fixe'},
    {ico:'📚',nom:'Complétude',val:d.completude,sub:d.nb_cours+' cours effectués'},
  ];
  const rs=el('r-sources');
  rs.innerHTML='<div class="clbl" style="margin-bottom:.5rem">Sources de revenus</div>';
  sources.forEach(s=>{
    const w=d.total_revenus>0?Math.round((s.val/d.total_revenus)*100):0;
    rs.innerHTML+='<div class="row">'+
      '<div class="row-left">'+
        '<span class="row-ico">'+s.ico+'</span>'+
        '<div class="row-meta"><span class="row-name">'+s.nom+'</span><span class="row-sub">'+s.sub+'</span></div>'+
      '</div>'+
      '<div class="row-right">'+
        '<div class="row-val green">'+Math.round(s.val).toLocaleString('fr-FR')+'\u202f€</div>'+
        '<div class="row-pct">'+w+'%</div>'+
      '</div>'+
    '</div>'+
    '<div class="bar" style="margin:.25rem 0 .4rem"><div class="fill" style="width:'+w+'%;background:var(--g)"></div></div>';
  });

  const supp=d.revenus_supp||[];
  const rsupp=el('r-supp');
  if(supp.length>0){
    rsupp.style.display='block';
    const tot=supp.reduce((s,r)=>s+r.montant,0);
    rsupp.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">'+
      '<div class="clbl" style="margin:0">Rentrées supplémentaires</div>'+
      '<span style="font-family:var(--mono);font-size:.78rem;color:var(--g)">+'+Math.round(tot).toLocaleString('fr-FR')+'\u202f€</span>'+
    '</div>';
    supp.forEach(r=>{
      const date=r.created_at?new Date(r.created_at).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}):'—';
      rsupp.innerHTML+='<div class="row">'+
        '<span>'+( r.libelle||'Divers')+'</span>'+
        '<div style="text-align:right">'+
          '<span style="font-family:var(--mono);color:var(--g)">+'+r.montant.toFixed(2)+'\u202f€</span>'+
          '<br><span style="font-size:.58rem;color:var(--mu)">'+date+'</span>'+
        '</div>'+
      '</div>';
    });
  }else{rsupp.style.display='none'}
}

/* ── RENDER DÉPENSES ── */
function renderDepenses(d){
  const bl=el('b-ls');
  const isCurrent=d.mois_offset===0;
  const totalDep=d.total_dep||0;
  const totalMax=Object.values(d.budgets).reduce((s,b)=>s+b.max,0);
  const tPct=pct(totalDep,totalMax);
  const tCol=colP(tPct);

  bl.innerHTML='<div class="clbl" style="margin-bottom:.55rem">Dépenses variables'+(isCurrent?'':' <span class="badge b-hist">Archivé</span>')+'</div>';

  Object.entries(d.totaux).forEach(([k,v])=>{
    const b=d.budgets[k];
    const p=pct(v,b.max);
    const c=colP(p);
    const items=(d.detail||{})[k]||[];
    const hasItems=items.length>0;
    bl.innerHTML+=
      '<div class="ccat'+(hasItems?' ':'')+'\" id="cat-btn-'+k+'"'+(hasItems?' onclick="toggleCat(\''+k+'\')"':' style="cursor:default"')+'>'+
        '<span style="font-size:.75rem">'+b.label+'</span>'+
        '<div style="display:flex;align-items:center;gap:7px">'+
          '<div class="minibar"><div class="minifill" style="width:'+p+'%;background:'+c+'"></div></div>'+
          '<span style="color:'+c+';font-family:var(--mono);font-size:.7rem;min-width:80px;text-align:right">'+v.toFixed(0)+'€ / '+b.max+'€</span>'+
          (hasItems?'<span class="chev">›</span>':'')+
        '</div>'+
      '</div>'+
      '<div class="cdet" id="cat-det-'+k+'">'+
        (items.length===0
          ?'<div style="color:var(--mu);font-size:.68rem;padding:3px 0">Aucune dépense</div>'
          :items.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(dep=>{
              const date=dep.created_at?new Date(dep.created_at).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}):'—';
              return '<div class="dep-i"><span>'+(dep.libelle||'—')+'</span><div style="text-align:right"><span style="color:var(--tx)">'+dep.montant.toFixed(2)+'€</span><br><span style="font-size:.6rem;color:var(--mu)">'+date+'</span></div></div>';
            }).join('')
        )+
      '</div>';
  });

  bl.innerHTML+=
    '<div class="dep-total">'+
      '<div>'+
        '<div style="font-size:.6rem;color:var(--mu);text-transform:uppercase;letter-spacing:.06em">Total dépenses</div>'+
        '<div style="font-size:.58rem;color:var(--mu);margin-top:1px">Budget max : '+totalMax+'€</div>'+
      '</div>'+
      '<div style="text-align:right">'+
        '<div style="font-family:var(--mono);font-size:.95rem;color:'+tCol+'">'+totalDep.toFixed(0)+'€</div>'+
        '<div style="font-size:.58rem;color:var(--mu)">'+tPct+'%</div>'+
      '</div>'+
    '</div>';
}

/* ── RENDER PRÉLÈVEMENTS ── */
function renderPrelevements(d){
  const isCurrent=d.mois_offset===0;
  const pa=el('p-alert');
  const av=d.prelevements_a_venir||[];

  if(isCurrent&&av.length>0){
    const totS=av.reduce((s,p)=>s+p.montant,0);
    pa.style.display='block';
    pa.innerHTML='<div class="abox"><div class="abox-title">⚠️ Dans les 7 prochains jours — '+totS.toFixed(0)+'€</div>'+
      av.map(p=>{
        const q=p.dansJours===0?'Aujourd\'hui':p.dansJours===1?'Demain':'Dans '+p.dansJours+'j';
        return '<div style="display:flex;justify-content:space-between;margin-top:4px;font-size:.71rem"><span style="color:var(--mu)">'+q+' · '+p.nom+'</span><span style="color:var(--amber);font-family:var(--mono)">'+p.montant.toFixed(2)+'€</span></div>';
      }).join('')+'</div>';
  }else{pa.style.display='none'}

  const pl=el('p-ls');
  const now=new Date();
  const auj=now.getDate();

  pl.innerHTML='<div class="clbl" style="margin-bottom:.4rem">Prélèvements du mois'+(isCurrent?'':' <span class="badge b-hist">Archivé</span>')+'</div>'+
    '<div class="prel-row"><span style="color:var(--mu);font-size:.65rem">Restant ce mois</span><span style="color:var(--r);font-family:var(--mono);font-weight:700">-'+(d.total_prelevements_restants||0).toFixed(0)+'€</span></div>';

  if(!isCurrent){
    (d.prelevements_tous||[]).filter(p=>p.frequence!=='trimestriel').forEach(p=>{
      pl.innerHTML+='<div class="prel-row"><span>'+p.nom+'</span><div style="display:flex;gap:7px;align-items:center"><span style="color:var(--mu)">le '+(p.jour||'—')+'</span><span style="font-family:var(--mono)">'+p.montant.toFixed(2)+'€</span></div></div>';
    });
    return;
  }

  const all=d.prelevements_tous||[];
  const restants=all.filter(p=>p.jour&&p.jour>=auj&&p.frequence!=='trimestriel');
  const passes=all.filter(p=>p.jour&&p.jour<auj&&p.frequence!=='trimestriel');
  const trim=all.filter(p=>p.frequence==='trimestriel');

  if(restants.length>0){
    pl.innerHTML+='<div class="stitle">À venir</div>';
    restants.forEach(p=>{
      const diff=p.jour-auj;
      let bc='pb-o',bt='le '+p.jour;
      if(diff===0){bc='pb-u';bt='Aujourd\'hui';}
      else if(diff<=2){bc='pb-u';bt='Dans '+diff+'j';}
      else if(diff<=5){bc='pb-s';bt='Dans '+diff+'j';}
      pl.innerHTML+='<div class="prel-row"><span>'+p.nom+'</span><div style="display:flex;gap:7px;align-items:center"><span class="pb '+bc+'">'+bt+'</span><span style="font-family:var(--mono)">'+p.montant.toFixed(2)+'€</span></div></div>';
    });
  }
  if(passes.length>0){
    pl.innerHTML+='<div class="stitle">Déjà passés</div>';
    passes.forEach(p=>{
      pl.innerHTML+='<div class="prel-row past"><span>'+p.nom+'</span><span style="color:var(--mu);font-family:var(--mono)">'+p.montant.toFixed(2)+'€</span></div>';
    });
  }
  if(trim.length>0){
    pl.innerHTML+='<div class="stitle">Trimestriels</div>';
    trim.forEach(p=>{
      pl.innerHTML+='<div class="prel-row"><span>'+p.nom+'</span><span style="color:var(--mu);font-family:var(--mono)">'+p.montant.toFixed(2)+'€/trim</span></div>';
    });
  }
}

/* ── RENDER OBJECTIFS ── */
function renderObjectifs(d){
  const ol=el('o-ls');
  ol.innerHTML='<div class="clbl" style="margin-bottom:.55rem">Progression épargne</div>';
  (d.objectifs||[]).forEach(o=>{
    const p=pct(d.epargne_estimee,o.montant);
    const c=colP(p);
    const delta=Math.round(d.epargne_estimee-o.montant);
    ol.innerHTML+='<div class="obj">'+
      '<div class="obj-h">'+
        '<span>'+(delta>=0?'✅':'⚠️')+' '+o.label+'</span>'+
        '<span style="color:'+c+';font-family:var(--mono)">'+(delta>=0?'+':'')+delta.toLocaleString('fr-FR')+'€</span>'+
      '</div>'+
      '<div class="bar"><div class="fill" style="width:'+p+'%;background:'+c+'"></div></div>'+
      '<div style="display:flex;justify-content:space-between;font-size:.58rem;color:var(--mu);margin-top:3px">'+
        '<span>'+Math.round(d.epargne_estimee).toLocaleString('fr-FR')+'€</span>'+
        '<span>'+o.montant.toLocaleString('fr-FR')+'€</span>'+
      '</div>'+
    '</div>';
  });
}

/* ── MAIN ── */
async function charger(){
  try{
    const resp=await fetch('/api/dashboard?mois='+moisOffset);
    if(!resp.ok)throw new Error('HTTP '+resp.status);
    const d=await resp.json();

    /* header solde */
    const hs=el('h-solde');
    hs.textContent=(d.solde>=0?'+':'')+Math.round(d.solde).toLocaleString('fr-FR')+'\u202f€';
    hs.style.color=colS(d.solde);

    /* mois nav */
    const mc=(d.mois_disponibles||[]).find(m=>m.offset===moisOffset);
    const lbl=mc?(mc.label.charAt(0).toUpperCase()+mc.label.slice(1)):'—';
    el('mois-label').textContent=lbl;
    el('mois-badge').textContent=moisOffset===0?'Mois en cours':'Historique';
    el('btn-next').disabled=moisOffset>=0;

    renderApercu(d);
    renderCours(d);
    renderRevenus(d);
    renderDepenses(d);
    renderPrelevements(d);
    renderObjectifs(d);

    el('upd').textContent='Actualisé à '+new Date().toLocaleTimeString('fr-FR');
  }catch(e){
    el('upd').textContent='Erreur : '+e.message;
    console.error(e);
  }
}

charger();
setInterval(charger,30000);
</script>
</body>
</html>`);
});


app.get('/', (req, res) => res.send("L'Agent est en ligne ! 🤖"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`L'Agent écoute sur le port ${PORT}`);
  await chargerElevesCustom();
  demarrerScheduler();
});

module.exports = app;
