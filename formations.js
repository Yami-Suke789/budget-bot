// formations.js — suivi des formations dispensées (maintenance, incendie, autre)
// Facturation par session réalisée ; cotisations URSSAF calculées à l'ENCAISSEMENT.
// Saisie uniquement par Telegram (le dashboard est en lecture seule).

const THEMES = ['maintenance', 'incendie', 'autre'];
const DEFAUTS = { taux_cotisations_formation: 0.256, taux_cfp_formation: 0.002, plafond_micro_bnc: 83600 };

module.exports = function creerFormations({ supabase, send, sendBtns, genAI, modele, moisEstFige, MSG_MOIS_FIGE }) {

  async function lireTaux() {
    const cles = Object.keys(DEFAUTS);
    const { data } = await supabase.from('config').select('cle,valeur').in('cle', cles);
    const out = { ...DEFAUTS };
    (data || []).forEach(r => { const v = Number(r.valeur); if (Number.isFinite(v)) out[r.cle] = v; });
    return out;
  }

  const aujourdhui = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const eur = n => `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}€`;


  // ---- Saisie guidée (/session sans argument) : état par chat ----
  const flux = {};
  const LABEL_THEME = { maintenance: 'Maintenance', incendie: 'Incendie', autre: 'Autre' };

  function boutonsSession(id) {
    return [[{ t: 'Payée', d: `frm_pay_${id}` }, { t: 'Supprimer', d: `frm_del_${id}` }]];
  }

  async function enregistrer(chatId, s) {
    const { data, error } = await supabase.from('sessions_formation')
      .insert({ ...s, chat_id: String(chatId) }).select().single();
    if (error) throw new Error(error.message);
    await sendBtns(chatId,
      `Session *#${data.id}* enregistree\n${data.intitule} — *${eur(data.montant)}*` +
      `${data.client ? ' — ' + data.client : ''}${data.nb_heures ? ' — ' + data.nb_heures + 'h' : ''}` +
      `${data.entite === 'dyneos' ? ' (Dyneos)' : ''}\n` +
      `Statut : a facturer\n\nQuand c'est paye, appuie sur *Payée*.`,
      boutonsSession(data.id));
    return data;
  }

  // Encaissement : revenu dashboard + statut payée + provision URSSAF
  async function encaisser(chatId, id, date) {
    date = date || aujourdhui();
    if (moisEstFige(date)) { await send(chatId, MSG_MOIS_FIGE); return; }
    const { data: s } = await supabase.from('sessions_formation').select('*').eq('id', id).maybeSingle();
    if (!s) { await send(chatId, 'Session introuvable.'); return; }
    if (s.statut === 'payee') { await send(chatId, 'Cette session est deja encaissee.'); return; }

    const libelle = `Formation — ${s.intitule}${s.client ? ' (' + s.client + ')' : ''}`;
    const { data: rev, error: e1 } = await supabase.from('revenus')
      .insert({ montant: s.montant, libelle, chat_id: String(chatId), created_at: `${date}T12:00:00Z` })
      .select('id').single();
    if (e1) { await send(chatId, `Echec de l'enregistrement du revenu : ${e1.message}`); return; }

    const { error: e2 } = await supabase.from('sessions_formation')
      .update({ statut: 'payee', date_paiement: date, revenu_id: rev.id }).eq('id', id);
    if (e2) {
      await supabase.from('revenus').delete().eq('id', rev.id);
      await send(chatId, `Echec de la mise a jour : ${e2.message}`);
      return;
    }
    const t = await lireTaux();
    const prov = Number(s.montant) * (t.taux_cotisations_formation + t.taux_cfp_formation);
    await send(chatId,
      `Session *#${id}* encaissee le ${date} : *+${eur(s.montant)}*\n` +
      `A mettre de cote (URSSAF) : *${eur(prov)}*\nRevenu ajoute au dashboard.`);
  }

  async function demarrerFlux(chatId) {
    flux[chatId] = { etape: 'entite' };
    await sendBtns(chatId, '*Nouvelle session de formation*\n\nPour quelle entite ?',
      [[{ t: 'Perso', d: 'frm_ent_perso' }, { t: 'Dyneos', d: 'frm_ent_dyneos' }], [{ t: 'Annuler', d: 'frm_annuler' }]]);
  }

  // Texte libre pendant la saisie guidée — true si traité
  async function handleTexte(texte, chatId) {
    const f = flux[chatId];
    if (!f) return false;
    const t = texte.trim();
    if (f.etape === 'client') {
      if (t.length < 2) { await send(chatId, 'Nom trop court. Quel client ?'); return true; }
      f.client = t; f.etape = 'theme';
      await sendBtns(chatId, `*${t}*\n\nTheme de la formation ?`,
        [[{ t: 'Maintenance', d: 'frm_th_maintenance' }, { t: 'Incendie', d: 'frm_th_incendie' }, { t: 'Autre', d: 'frm_th_autre' }]]);
      return true;
    }
    if (f.etape === 'montant') {
      const m = t.match(/(\d+(?:[.,]\d{1,2})?)/);
      const montant = m ? parseFloat(m[1].replace(',', '.')) : NaN;
      if (!Number.isFinite(montant) || montant <= 0) { await send(chatId, 'Envoie un montant valide, ex: *600*'); return true; }
      f.montant = montant; f.etape = 'details';
      await sendBtns(chatId, `*${eur(montant)}*\n\nDetails (optionnel) : heures, stagiaires, date.\n_Ex: 7h 8 stagiaires_`,
        [[{ t: 'Passer', d: 'frm_skip' }]]);
      return true;
    }
    if (f.etape === 'details') {
      const h = t.match(/(\d+(?:[.,]\d+)?)\s*h/i);
      const n = t.match(/(\d+)\s*stagiaires?/i);
      const d = t.match(/(\d{4}-\d{2}-\d{2})/);
      if (h) f.nb_heures = parseFloat(h[1].replace(',', '.'));
      if (n) f.nb_stagiaires = parseInt(n[1], 10);
      if (d) f.date_session = d[1];
      await finaliserFlux(chatId);
      return true;
    }
    return true; // étape attend un bouton : on ignore le texte
  }

  async function finaliserFlux(chatId) {
    const f = flux[chatId];
    delete flux[chatId];
    if (!f) return;
    try {
      await enregistrer(chatId, {
        entite: f.entite, client: f.client, theme: f.theme,
        intitule: `Formation ${LABEL_THEME[f.theme].toLowerCase()}`,
        montant: f.montant, nb_heures: f.nb_heures ?? null,
        nb_stagiaires: f.nb_stagiaires ?? null, date_session: f.date_session || aujourdhui(),
      });
    } catch (e) { await send(chatId, `Non enregistre : ${e.message}`); }
  }

  // Boutons frm_* — true si traité
  async function handleCallback(data, chatId) {
    if (!data.startsWith('frm_')) return false;
    if (data === 'frm_annuler') { delete flux[chatId]; await send(chatId, 'Saisie annulee.'); return true; }

    let m;
    if ((m = data.match(/^frm_pay_(\d+)$/))) { await encaisser(chatId, Number(m[1])); return true; }
    if ((m = data.match(/^frm_del_(\d+)$/))) {
      const id = Number(m[1]);
      const { data: s } = await supabase.from('sessions_formation').select('revenu_id').eq('id', id).maybeSingle();
      if (s?.revenu_id) await supabase.from('revenus').delete().eq('id', s.revenu_id);
      const { error } = await supabase.from('sessions_formation').delete().eq('id', id);
      await send(chatId, error ? `Echec : ${error.message}` : `Session #${id} supprimee.`);
      return true;
    }

    const f = flux[chatId];
    if (!f) { await send(chatId, 'Saisie expiree. Relance /session.'); return true; }
    if ((m = data.match(/^frm_ent_(perso|dyneos)$/))) {
      f.entite = m[1]; f.etape = 'client';
      await send(chatId, 'Quel client ? (ex: AFORP, entreprise Dupont)');
      return true;
    }
    if ((m = data.match(/^frm_th_(maintenance|incendie|autre)$/))) {
      f.theme = m[1]; f.etape = 'montant';
      await send(chatId, `${LABEL_THEME[f.theme]} — *${f.client}*\n\nMontant total facture (€) ?`);
      return true;
    }
    if (data === 'frm_skip') { await finaliserFlux(chatId); return true; }
    return true;
  }

  async function extraire(texte) {
    const model = genAI.getGenerativeModel({ model: modele, generationConfig: { responseMimeType: 'application/json' } });
    const prompt = `Extrais une session de formation dispensée depuis ce message : "${texte}".
Réponds en JSON strict avec les champs :
intitule (string, ex "Maintenance niveau 1"), theme ("maintenance"|"incendie"|"autre"),
client (string|null), montant (nombre en euros, total facturé), nb_heures (nombre|null),
nb_stagiaires (entier|null), entite ("perso" par défaut, "dyneos" seulement si Dyneos est mentionné),
date_session (AAAA-MM-JJ, ${aujourdhui()} si aucune date).`;
    const r = await model.generateContent(prompt);
    const j = JSON.parse(r.response.text());
    j.montant = Number(j.montant);
    if (!Number.isFinite(j.montant) || j.montant <= 0) throw new Error('montant introuvable');
    if (!j.intitule) throw new Error('intitulé introuvable');
    if (!THEMES.includes(j.theme)) j.theme = 'autre';
    if (!['perso', 'dyneos'].includes(j.entite)) j.entite = 'perso';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(j.date_session || '')) j.date_session = aujourdhui();
    return j;
  }

  // Retourne true si le message a été traité
  async function handle(texte, chatId) {
    let m;

    if (/^\//.test(texte) && flux[chatId] && !/^\/session/i.test(texte)) delete flux[chatId];

    if ((m = texte.match(/^\/session(?:@\w+)?(?:\s+([\s\S]+))?$/i))) {
      if (!m[1]) {
        await demarrerFlux(chatId);
        return true;
      }
      try {
        const s = await extraire(m[1]);
        await enregistrer(chatId, s);
      } catch (e) {
        await send(chatId, `Non enregistre : ${e.message}`);
      }
      return true;
    }

    if ((m = texte.match(/^\/facturee\s+(\d+)\s+(\S+)(?:\s+(\d{4}-\d{2}-\d{2}))?$/i))) {
      const { data, error } = await supabase.from('sessions_formation')
        .update({ statut: 'facturee', num_facture: m[2], date_echeance: m[3] || null })
        .eq('id', Number(m[1])).neq('statut', 'payee').select().maybeSingle();
      await send(chatId, error || !data
        ? 'Session introuvable (ou deja encaissee).'
        : `Session *#${data.id}* facturee (${m[2]}) — ${eur(data.montant)}`);
      return true;
    }

    if ((m = texte.match(/^\/paye\s+(\d+)(?:\s+(\d{4}-\d{2}-\d{2}))?$/i))) {
      await encaisser(chatId, Number(m[1]), m[2]);
      return true;
    }

    if ((m = texte.match(/^\/annulersession\s+(\d+)$/i))) {
      const id = Number(m[1]);
      const { data: s } = await supabase.from('sessions_formation').select('revenu_id,statut').eq('id', id).maybeSingle();
      if (!s) { await send(chatId, 'Session introuvable.'); return true; }
      if (s.revenu_id) await supabase.from('revenus').delete().eq('id', s.revenu_id);
      const { error } = await supabase.from('sessions_formation').delete().eq('id', id);
      await send(chatId, error ? `Echec : ${error.message}` : `Session #${id} supprimee${s.revenu_id ? ' (revenu associe retire)' : ''}.`);
      return true;
    }

    if (/^\/factures(?:@\w+)?$/i.test(texte)) {
      const { data } = await supabase.from('sessions_formation')
        .select('id,intitule,client,montant,statut,num_facture,date_echeance')
        .neq('statut', 'payee').order('date_session');
      if (!data?.length) { await send(chatId, 'Rien en attente de paiement.'); return true; }
      const today = aujourdhui();
      const total = data.reduce((a, s) => a + Number(s.montant), 0);
      const lignes = data.map(s => {
        const retard = s.date_echeance && s.date_echeance < today ? ' RETARD' : '';
        return `#${s.id} ${s.intitule}${s.client ? ' — ' + s.client : ''} — ${eur(s.montant)} (${s.statut === 'facturee' ? 'facturee ' + (s.num_facture || '') : 'a facturer'})${retard}`;
      });
      await send(chatId, `*En attente*\n${lignes.join('\n')}\n\nTotal : *${eur(total)}*`);
      return true;
    }

    if (/^\/formations(?:@\w+)?$/i.test(texte)) {
      const { data } = await supabase.from('sessions_formation').select('theme,montant,statut');
      if (!data?.length) { await send(chatId, 'Aucune session enregistree. Utilise /session.'); return true; }
      const agg = {};
      data.forEach(s => {
        const k = s.theme || 'autre';
        agg[k] ??= { n: 0, ca: 0, enc: 0 };
        agg[k].n++; agg[k].ca += Number(s.montant);
        if (s.statut === 'payee') agg[k].enc += Number(s.montant);
      });
      const lignes = Object.entries(agg).map(([k, a]) => `*${k}* : ${a.n} session(s) — ${eur(a.ca)} factures — ${eur(a.enc)} encaisses`);
      await send(chatId, `*Formations dispensees*\n${lignes.join('\n')}`);
      return true;
    }

    return false;
  }

  // Données du dashboard (lecture seule)
  async function donneesDashboard(moisCleCourant) {
    const { data: sessions, error } = await supabase.from('sessions_formation')
      .select('*').order('date_session', { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    const t = await lireTaux();
    const tauxTotal = t.taux_cotisations_formation + t.taux_cfp_formation;
    const annee = String(moisCleCourant).slice(0, 4);
    const payees = (sessions || []).filter(s => s.statut === 'payee' && s.date_paiement);
    const duMois = payees.filter(s => String(s.date_paiement).slice(0, 7) === moisCleCourant);
    const duAn = payees.filter(s => String(s.date_paiement).slice(0, 4) === annee);
    const somme = l => l.reduce((a, s) => a + Number(s.montant), 0);
    const attente = (sessions || []).filter(s => s.statut !== 'payee');
    const parTheme = {};
    duAn.forEach(s => {
      const k = s.theme || 'autre';
      parTheme[k] ??= { n: 0, ca: 0 };
      parTheme[k].n++; parTheme[k].ca += Number(s.montant);
    });
    return {
      sessions,
      taux: tauxTotal,
      plafond: t.plafond_micro_bnc,
      moisEncaisse: somme(duMois),
      moisProvision: somme(duMois) * tauxTotal,
      anEncaisse: somme(duAn),
      anProvision: somme(duAn) * tauxTotal,
      attente: somme(attente),
      nbAttente: attente.length,
      parTheme,
    };
  }

  return { handle, handleTexte, handleCallback, donneesDashboard };
};
