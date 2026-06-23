/* ==========================================================================
   CORRECTIF MYF — SCHÉMAS EN TEXTE + MESSAGE LIMITE IMAGE
   À COLLER TOUT EN BAS DE app_v18.js
   ========================================================================== */

/**
 * Détecte toutes les demandes de schéma/croquis/diagramme.
 * Ces demandes NE DOIVENT JAMAIS appeler /api/generate-image.
 */
function isSketchLikeRequest(msg) {
  var low = String(msg || "").toLowerCase();

  return /(\bschéma\b|\bschema\b|\bcroquis\b|\bdiagramme\b|\bunifilaire\b|\bsynoptique\b|\borganigramme\b|\bflowchart\b|\bascii\b|plan\s+(?:de\s+)?(?:câblage|cablage|raccordement|électrique|electrique)|réaction chimique|reaction chimique|mécanisme réactionnel|mecanisme reactionnel|molécule|molecule|dessine\s+(?:moi\s+)?(?:un|une|le|la)?\s*(?:schéma|schema|croquis|diagramme)|fais\s+(?:moi\s+)?(?:un|une|le|la)?\s*(?:schéma|schema|croquis|diagramme))/i.test(low);
}

/**
 * Détecte les vraies demandes d'image.
 * Si la demande contient un schéma/croquis/diagramme, on retourne false.
 */
function isImageGenerationRequest(msg) {
  var low = String(msg || "").toLowerCase();

  // Sécurité absolue : les schémas/croquis restent dans le chat texte.
  if (isSketchLikeRequest(low)) return false;

  var hasImageWord =
    /(image|photo|illustration|visuel|logo|affiche|poster|bannière|banniere|banner|avatar|icône|icone|image ia|image générée|image generee)/i.test(low);

  var hasCreateVerb =
    /(génère|genere|générer|generer|crée|cree|créer|creer|fabrique|produis|conçois|concois|imagine|make|create|generate|réalise|realise)/i.test(low);

  return hasImageWord && hasCreateVerb;
}

/**
 * Instruction spéciale envoyée au modèle quand l'utilisateur demande un schéma.
 * Le modèle doit dessiner en texte/ASCII, pas générer une image.
 */
function diagramInstructionForChat(msg) {
  if (!isSketchLikeRequest(msg)) return "";

  var pv =
    /(pv|photovolta|photovoltaïque|photovoltaique|solaire|onduleur|unifilaire|autoconsommation|enedis|tableau|coffret|tgbt|câblage|cablage|raccordement|terre|sectionneur|parafoudre|disjoncteur)/i.test(msg);

  var chimie =
    /(réaction chimique|reaction chimique|mécanisme réactionnel|mecanisme reactionnel|molécule|molecule|chimie|réactif|reactif|produit|catalyseur|liaison)/i.test(msg);

  var instruction = "\n\n[INSTRUCTION DESSIN TEXTE] " +
    "L'utilisateur demande un croquis, schéma ou diagramme. " +
    "Ne génère jamais d'image. N'appelle jamais la génération d'image. " +
    "Réponds directement dans le chat avec un dessin texte propre, aligné et lisible. " +
    "Utilise un rendu monospace avec des caractères comme : ┌ ┐ └ ┘ ─ │ ├ ┤ ┬ ┴ ┼ → ← ↑ ↓. " +
    "Fais des boîtes alignées, des flèches propres, des libellés courts, puis ajoute une légende claire sous le dessin. " +
    "Le dessin doit être bien organisé, large, lisible et professionnel. ";

  if (pv) {
    instruction +=
      "Pour un schéma unifilaire photovoltaïque, représente au minimum : champ PV / strings, coffret DC, fusibles ou protections DC si nécessaires, sectionneur DC, parafoudre DC si pertinent, onduleur, protection AC, tableau AC/TGBT, compteur, réseau, terre/PE et sens des flux. " +
      "Ajoute une note indiquant que le croquis est une base à valider selon les normes applicables, le site, les sections de câbles, le régime de neutre et les protections réelles. ";
  }

  if (chimie) {
    instruction +=
      "Pour une réaction chimique, représente les réactifs, les produits, les flèches, les conditions, les catalyseurs éventuels, les charges et les liaisons importantes. ";
  }

  return instruction;
}

/**
 * Nettoie les messages d'erreur image.
 */
function cleanImageErrorMessage(message) {
  var msg = String(message || "").trim();

  msg = msg.replace(/^(Erreur\s+génération\s+image\s*:\s*)+/i, "");
  msg = msg.replace(/^(Erreur\s+image\s*:\s*)+/i, "");
  msg = msg.replace(/Vérifiez que votre serveur Render[\s\S]*$/i, "");
  msg = msg.trim();

  if (isImageRateLimitError(msg)) {
    return "Limite génération image atteint";
  }

  return msg || "Erreur inconnue.";
}

/**
 * Détecte une limite de génération image.
 */
function isImageRateLimitError(message) {
  return /(rate\s*limit|quota|too\s*many\s*requests|429|limite|limit reached|image_generation rate limit reached)/i.test(
    String(message || "")
  );
}

/**
 * Message affiché à l'utilisateur si limite image atteinte.
 */
function imageRateLimitFriendlyMessage(message) {
  var clean = cleanImageErrorMessage(message);

  if (isImageRateLimitError(clean) || clean === "Limite génération image atteint") {
    setImageRateLimitCooldown();
    return "Limite génération image atteint";
  }

  return clean;
}

/**
 * Bloque temporairement le bouton image quand la limite est atteinte.
 */
var IMAGE_RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;

function setImageRateLimitCooldown() {
  try {
    localStorage.setItem(
      "myf_image_quota_until",
      String(Date.now() + IMAGE_RATE_LIMIT_COOLDOWN_MS)
    );
  } catch (e) {}

  updateImageQuotaStatus();
}

function getImageRateLimitRemainingMs() {
  try {
    var until = parseInt(localStorage.getItem("myf_image_quota_until") || "0", 10);
    var remaining = until - Date.now();
    return remaining > 0 ? remaining : 0;
  } catch (e) {
    return 0;
  }
}

function formatRemaining(ms) {
  var min = Math.ceil(ms / 60000);
  if (min <= 1) return "moins d'une minute";
  return min + " minutes";
}

function updateImageQuotaStatus() {
  var btn = document.getElementById("chatImageBtn");
  var status = document.getElementById("chatImageStatus");
  var remaining = getImageRateLimitRemainingMs();

  if (btn) {
    btn.classList.toggle("disabled-soft", remaining > 0);
    btn.title =
      remaining > 0
        ? "Limite génération image atteint"
        : "Générer une image IA";
  }

  if (status) {
    if (remaining > 0) {
      status.classList.add("show");
      status.textContent = "Limite génération image atteint";
    } else {
      status.classList.remove("show");
      status.textContent = "";
    }
  }
}

/**
 * Génération image.
 * Si quota atteint, affiche uniquement : Limite génération image atteint.
 */
async function generateImageFromBackend(prompt, options) {
  updateImageQuotaStatus();

  var remaining = getImageRateLimitRemainingMs();
  if (remaining > 0) {
    throw new Error("Limite génération image atteint");
  }

  var modelEl = document.getElementById("chatModel");
  var model =
    options && options.model
      ? options.model
      : modelEl
      ? modelEl.value
      : "mistral-medium-latest";

  var response = await fetch(BASE + "/api/generate-image", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": API_KEY,
    },
    body: JSON.stringify({
      prompt: enhanceImagePrompt(prompt, "generate"),
      model: model,
      output_format: "png",
      size: "auto",
      quality: "auto",
      background: "auto",
    }),
  });

  var data = await response.json().catch(function () {
    return null;
  });

  if (!response.ok || !data || !data.success) {
    var msg = (data && data.message) || "Erreur image HTTP " + response.status;

    if (response.status === 429 || isImageRateLimitError(msg)) {
      setImageRateLimitCooldown();
      throw new Error("Limite génération image atteint");
    }

    throw new Error(cleanImageErrorMessage(msg));
  }

  updateImageQuotaStatus();
  return data.data || {};
}

/**
 * Remplace complètement sendChat pour être sûr que les croquis/schémas
 * ne passent jamais par la génération image.
 */
async function sendChat() {
  var input = document.getElementById("chatInput");
  var msg = input.value.trim();

  if (!msg) return;

  if (!API_KEY) {
    alert("Vous devez être connecté pour utiliser le chat.");
    return;
  }

  var model = document.getElementById("chatModel").value;

  input.value = "";
  input.style.height = "auto";
  document.getElementById("chatSendBtn").disabled = true;

  var displayMsg = msg;
  if (chatPdfName) displayMsg += "\n📎 " + chatPdfName;

  addBubble("user", displayMsg);

  var typing = document.getElementById("chatTyping");
  typing.classList.add("show");

  document.getElementById("chatMsgs").scrollTop =
    document.getElementById("chatMsgs").scrollHeight;

  // Très important :
  // On ne génère une image que si ce n'est PAS un schéma/croquis/diagramme.
  if (!isSketchLikeRequest(msg) && isImageGenerationRequest(msg)) {
    try {
      var imagePrompt = imagePromptFromMessage(msg);

      setWebStatus("Génération de l’image IA avec Mistral…");

      var imageData = await generateImageFromBackend(imagePrompt);

      hideWebStatus();
      typing.classList.remove("show");

      addGeneratedImageBubble(imageData, imagePrompt, "generate");

      chatHistory.push({
        role: "user",
        content: msg,
      });

      chatHistory.push({
        role: "assistant",
        content:
          "Image IA générée : " +
          (imageData.image_url || imageData.download_url || ""),
      });

      if (chatPdfText) clearChatFile();
    } catch (imgErr) {
      hideWebStatus();
      typing.classList.remove("show");
      addBubble("ai", imageRateLimitFriendlyMessage(imgErr.message));
    } finally {
      document.getElementById("chatSendBtn").disabled = false;
      input.focus();
    }

    return;
  }

  var urlContext = "";
  var urlNote = "";
  var urls = extractUrls(msg);

  try {
    if (urls.length) {
      setWebStatus("Lecture du lien…");

      var urlTexts = [];

      for (var u = 0; u < Math.min(urls.length, 3); u++) {
        var uc = await fetchUrlContent(urls[u]);
        if (uc) {
          urlTexts.push(
            "[CONTENU DE " +
              urls[u] +
              "]\n" +
              uc.slice(0, 7000) +
              "\n[FIN]"
          );
        }
      }

      hideWebStatus();

      if (urlTexts.length) {
        urlContext = "\n\n" + urlTexts.join("\n\n");
        urlNote = "🔗 " + urlTexts.length + " lien(s) lu(s)";
      }
    }

    var weatherContext = "";
    var weatherNote = "";

    if (extractWeatherLocation(msg)) {
      setWebStatus("Récupération météo…");

      var wc = await getWeatherContext(msg);

      hideWebStatus();

      if (wc) {
        weatherContext =
          "\n\n[CONTEXTE MÉTÉO EN TEMPS RÉEL]\n" +
          wc +
          "\n[FIN MÉTÉO]";
        weatherNote = "🌦️ Météo temps réel";
      }
    }

    var webContext = "";
    var webNote = "";

    if (webSearchEnabled || needsWeb(msg)) {
      setWebStatus(
        isNewsLikeQuery(msg)
          ? "Recherche d’actualités…"
          : "Recherche sur le web…"
      );

      var sn = await doWebSearch(msg);

      hideWebStatus();

      if (sn) {
        webContext =
          "\n\n[CONTEXTE WEB RÉCUPÉRÉ — synthétise et cite les sources/URL quand elles sont présentes]\n" +
          sn.slice(0, 9000) +
          "\n[FIN WEB]";
        webNote = "🌐 Recherche web";
      }
    }

    var pdfContext = "";
    var pdfNote = "";

    if (chatPdfText) {
      var extract = chatPdfText.slice(0, 8000);

      pdfContext =
        "\n\n[CONTENU DU FICHIER JOINT « " +
        chatPdfName +
        " »]\n" +
        extract +
        "\n[FIN PDF]";

      pdfNote = "📎 Basé sur le fichier " + chatPdfName;
    }

    var artifactType = detectArtifactRequest(msg);

    var artifactRule = artifactType
      ? "L'utilisateur demande un fichier téléchargeable de type " +
        artifactType +
        ". Génère un contenu complet, propre et directement exploitable. Pour les fichiers de code ou données, mets idéalement le contenu dans un seul bloc de code adapté au format demandé. "
      : "";

    var diagramRule = diagramInstructionForChat(msg);

    var sysChat =
      "Tu es un assistant IA polyvalent, intelligent et bienveillant, intégré dans l'Agent IA de MYF. " +
      "Tu réponds en français par défaut sauf si l'utilisateur écrit dans une autre langue. " +
      "Tu es expert en énergie solaire, actualités, météo, analyse de pages web, rédaction professionnelle, programmation et création de fichiers. " +
      "IMPORTANT : quand un contexte web, météo, URL ou fichier joint est fourni, fonde ta réponse dessus et indique clairement les limites si les données sont insuffisantes. " +
      "Pour les nouveautés ou actualités, fais une synthèse courte avec les points clés, les dates/sources disponibles et ce qu'il faut retenir. " +
      "N'invente pas de sources. " +
      "N'utilise pas de caractères superflus de style markdown comme **, ***, __ ou ## dans tes réponses finales. " +
      artifactRule +
      "Rédige de manière claire et structurée. Pour le code uniquement, tu peux utiliser des blocs ```...```. " +
      diagramRule +
      urlContext +
      weatherContext +
      webContext +
      pdfContext;

    var histMsg = msg;

    if (chatPdfText) {
      histMsg = msg + "\n\n(voir le fichier joint dans le contexte système)";
    }

    chatHistory.push({
      role: "user",
      content: histMsg,
    });

    var sourceNote = [urlNote, weatherNote, webNote, pdfNote]
      .filter(Boolean)
      .join(" · ");

    typing.classList.remove("show");

    var aiInner = addBubble("ai", "", true, sourceNote);

    if (isSketchLikeRequest(msg)) {
      aiInner.classList.add("diagram-mode");
    }

    var full = await streamMistralChat(model, sysChat, chatHistory, function (t) {
      aiInner.textContent = t;
      document.getElementById("chatMsgs").scrollTop =
        document.getElementById("chatMsgs").scrollHeight;
    });

    var finalText = cleanMarkdown(full);

    aiInner.textContent = finalText;

    chatHistory.push({
      role: "assistant",
      content: finalText,
    });

    await createDownloadFromChat(msg, finalText);

    if (chatPdfText) clearChatFile();
  } catch (err) {
    hideWebStatus();
    typing.classList.remove("show");
    addBubble("ai", "Erreur : " + err.message);
  } finally {
    document.getElementById("chatSendBtn").disabled = false;
    input.focus();
  }
}

// Mise à jour visuelle du quota image Mistral
document.addEventListener("DOMContentLoaded", function () {
  updateImageQuotaStatus();
  setInterval(updateImageQuotaStatus, 30000);
});
