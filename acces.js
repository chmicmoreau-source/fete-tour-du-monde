/* Fête « Tour du monde » — la porte et la base partagée.
   1. Personne n'entre sans un lien reçu par mail, et seules les adresses de
      la table fete_organisateurs voient quelque chose.
   2. window.FETE donne à la page trois gestes : lire une collection, écrire
      un document, être prévenu quand quelqu'un d'autre a écrit. */
(function () {
  "use strict";
  var sb = null, moi = null, monNom = null;
  var cache = {}, abonnes = [];
  function $(id) { return document.getElementById(id); }

  function garder(k, v) { try { localStorage.setItem("fete-" + k, JSON.stringify(v)); } catch (e) {} }
  function repris(k) { try { var b = localStorage.getItem("fete-" + k); return b ? JSON.parse(b) : null; } catch (e) { return null; } }

  function dire(t, genre) { var e = $("porte-mot"); if (e) { e.textContent = t; e.className = "porte-mot " + (genre || ""); } }
  function bandeau(t) { var e = $("etat"); if (e) { e.textContent = t; e.hidden = !t; } }

  function prevenir(col) { abonnes.forEach(function (f) { try { f(col); } catch (e) { console.error(e); } }); }

  function toutCharger() {
    return sb.from("fete_docs").select("collection,id,contenu,maj,par_qui").then(function (r) {
      if (r.error) { throw r.error; }
      cache = {};
      (r.data || []).forEach(function (x) {
        (cache[x.collection] = cache[x.collection] || {})[x.id] =
          Object.assign({}, x.contenu, { _id: x.id, _maj: x.maj, _par: x.par_qui });
      });
      garder("cache", cache);
    });
  }

  function ecrire(col, id, corps) {
    var propre = {};
    Object.keys(corps).forEach(function (k) { if (k.charAt(0) !== "_") { propre[k] = corps[k]; } });
    (cache[col] = cache[col] || {})[id] = Object.assign({}, propre, { _id: id, _maj: new Date().toISOString(), _par: moi });
    prevenir(col);
    return sb.from("fete_docs").upsert({ collection: col, id: id, contenu: propre,
      maj: new Date().toISOString(), par_qui: moi }).then(function (r) {
      if (r.error) { bandeau("Enregistrement refusé : " + r.error.message); throw r.error; }
      garder("cache", cache);
    }).catch(function (e) {
      bandeau("Pas de réseau ? La saisie n'a pas été enregistrée — réessaie dans un instant.");
      throw e;
    });
  }

  window.FETE = {
    lire: function (col) {
      var m = cache[col] || {};
      return Object.keys(m).map(function (k) { return m[k]; }).filter(function (d) { return !d.retire; });
    },
    un: function (col, id) { return (cache[col] || {})[id] || null; },
    ecrire: ecrire,
    nouveau: function (col, corps) {
      var id = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2));
      return ecrire(col, id, corps).then(function () { return id; });
    },
    ecouter: function (f) { abonnes.push(f); },
    moi: function () { return { email: moi, nom: monNom }; }
  };

  function direct() {
    try {
      sb.channel("fete-" + Date.now() + "-" + Math.random().toString(36).slice(2))
        .on("postgres_changes", { event: "*", schema: "public", table: "fete_docs" }, function (p) {
          var r = p.new && p.new.collection ? p.new : p.old;
          if (!r) { return; }
          if (p.eventType === "DELETE") { delete (cache[r.collection] || {})[r.id]; }
          else { (cache[r.collection] = cache[r.collection] || {})[r.id] =
            Object.assign({}, r.contenu, { _id: r.id, _maj: r.maj, _par: r.par_qui }); }
          prevenir(r.collection);
        }).subscribe();
    } catch (e) { bandeau("Le direct n'a pas pu s'établir : recharge la page pour voir les saisies des autres."); }
  }

  var entre = false;
  function entrer(session) {
    if (entre) { return; }
    entre = true;
    moi = (session.user.email || "").toLowerCase();
    sb.from("fete_organisateurs").select("*").eq("email", moi).then(function (r) {
      if (r.error) { throw r.error; }
      if (!r.data || !r.data.length) {
        $("porte").hidden = false; $("porte-forme").hidden = true; $("porte-attente").hidden = true;
        $("porte-refus").hidden = false; $("porte-refus-mail").textContent = moi;
        return;
      }
      monNom = r.data[0].nom;
      garder("moi", { email: moi, nom: monNom });
      return toutCharger().then(lancer);
    }).catch(function (e) {
      var su = repris("moi"), c = repris("cache");
      if (su && su.email === moi && c) {
        monNom = su.nom; cache = c; lancer();
        bandeau("Hors ligne — dernière version connue. Les saisies partiront au retour du réseau.");
        return;
      }
      entre = false;
      $("porte").hidden = false;
      dire("Impossible de charger les données : " + (e.message || e), "rate");
    });
  }

  function lancer() {
    $("moi-nom").textContent = monNom;
    $("moi").hidden = false;
    $("porte").hidden = true;
    direct();
    window.demarrer();
  }

  function depart() {
    sb = window.supabase.createClient(window.CONFIG.url, window.CONFIG.cle,
      { auth: { detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } });
    $("porte-forme").addEventListener("submit", function (e) {
      e.preventDefault();
      var mail = $("porte-mail").value.trim().toLowerCase();
      if (!mail) { return; }
      dire("Envoi du lien…");
      sb.auth.signInWithOtp({ email: mail, options: { emailRedirectTo: location.href.split("#")[0] } })
        .then(function (r) {
          if (r.error) { dire("L'envoi a échoué : " + r.error.message, "rate"); return; }
          $("porte-forme").hidden = true; $("porte-attente").hidden = false;
          $("porte-adresse").textContent = mail; dire("");
        });
    });
    $("deconnexion").addEventListener("click", function () {
      sb.auth.signOut().then(function () { location.reload(); });
    });
    sb.auth.getSession().then(function (r) {
      var s = r.data && r.data.session;
      if (s) { entrer(s); } else { $("porte").hidden = false; }
    });
    sb.auth.onAuthStateChange(function (evt, s) {
      if ((evt === "SIGNED_IN" || evt === "INITIAL_SESSION") && s) { entrer(s); }
    });
  }

  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", depart); }
  else { depart(); }
})();
