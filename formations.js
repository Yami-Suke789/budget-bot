// formations.js — suivi des formations dispensées (maintenance, incendie, autre)
// Facturation par session réalisée ; cotisations URSSAF calculées à l'ENCAISSEMENT.
// Saisie uniquement par Telegram (le dashboard est en lecture seule).

const THEMES = ['maintenance', 'incendie', 'autre'];
const DEFAUTS = { taux_cotisations_formation: 0.256, taux_cfp_formation: 0.002, plafond_micro_bnc: 83600 };

module.exports = function creerFormations({ supabase, send, genAI, modele, moisEstFige, MSG_MOIS_FIGE }) {

  async function lireTaux() {
    const cles = Object.keys(DEFAUTS);
    const { data } = await supabase.from('config').select('cle,valeur').in('cle', cles);
    const out = { ...DEFAUTS };
    (data || []).forEach(r => { const v = Number(r.valeur); if (Number.isFinite(v)) out[r.cle] = v; });
    return out;
  }

  const aujourdhui = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const eur = n => `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}€`;

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

    if ((m = texte.match(/^\/session(?:@\w+)?(?:\s+([\s\S]+))?$/i))) {
      if (!m[1]) {
        await send(chatId, `*Nouvelle session de formation*\n\nEnvoie par ex :\n/session maintenance 600 AFORP 7h\n/session incendie 450 entreprise Dupont 4h 8 stagiaires`);
        return true;
      }
      try {
        const s = await extraire(m[1]);
        const { data, error } = await supabase.from('sessions_formation')
          .insert({ ...s, chat_id: String(chatId) }).select().single();
        if (error) throw new Error(error.message);
        await send(chatId,
          `Session *#${data.id}* enregistree\n${data.intitule} — *${eur(data.montant)}*` +
          `${data.client ? ' — ' + data.client : ''}${data.nb_heures ? ' — ' + data.nb_heures + 'h' : ''}\n` +
          `Statut : a facturer\n\n/facturee ${data.id} NUMERO_FACTURE\n/paye ${data.id}`);
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
      const id = Number(m[1]);
      const date = m[2] || aujourdhui();
      if (moisEstFige(date)) { await send(chatId, MSG_MOIS_FIGE); return true; }
      const { data: s } = await supabase.from('sessions_formation').select('*').eq('id', id).maybeSingle();
      if (!s) { await send(chatId, 'Session introuvable.'); return true; }
      if (s.statut === 'payee') { await send(chatId, 'Cette session est deja encaissee.'); return true; }

      // 1) revenu dans le dashboard principal (créé à la date d'encaissement)
      const libelle = `Formation — ${s.intitule}${s.client ? ' (' + s.client + ')' : ''}`;
      const { data: rev, error: e1 } = await supabase.from('revenus')
        .insert({ montant: s.montant, libelle, chat_id: String(chatId), created_at: `${date}T12:00:00Z` })
        .select('id').single();
      if (e1) { await send(chatId, `Echec de l'enregistrement du revenu : ${e1.message}`); return true; }

      // 2) statut de la session ; si ça échoue on annule le revenu pour ne pas dupliquer
      const { error: e2 } = await supabase.from('sessions_formation')
        .update({ statut: 'payee', date_paiement: date, revenu_id: rev.id }).eq('id', id);
      if (e2) {
        await supabase.from('revenus').delete().eq('id', rev.id);
        await send(chatId, `Echec de la mise a jour : ${e2.message}`);
        return true;
      }
      const t = await lireTaux();
      const prov = Number(s.montant) * (t.taux_cotisations_formation + t.taux_cfp_formation);
      await send(chatId,
        `Session *#${id}* encaissee le ${date} : *+${eur(s.montant)}*\n` +
        `A mettre de cote (URSSAF) : *${eur(prov)}*\nRevenu ajoute au dashboard.`);
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

  return { handle, donneesDashboard };
};
