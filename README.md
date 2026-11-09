# Orbite · Tableau de bord familial ÉcoleDirecte

Client web local écrit en TypeScript, exécuté par Node.js 22 ou supérieur. Aucune dépendance d'exécution, aucun compte externe. Les seules dépendances npm (TypeScript, types Node, Prettier) servent au développement et à la compilation.

## Lancer

Dans ce dossier, une première fois :

```sh
npm install
```

Puis à chaque lancement (la compilation vers `dist/` est automatique) :

```sh
npm start
```

Ouvrir **http://127.0.0.1:3210**. Cliquer sur **Explorer la démo** pour découvrir les trois profils fictifs du secondaire, ou **Connecter ÉcoleDirecte** pour saisir votre compte parent directement dans l’application.

Le fichier `Demarrer.command` permet également un lancement par double-clic sur macOS. Garder le terminal ouvert ; Ctrl+C arrête le serveur. Les identifiants ne doivent pas être envoyés dans une conversation.

Si le port est occupé :

```sh
PORT=3211 npm start
```

## Connexion

- Compte parent ou élève ÉcoleDirecte classique.
- Initialisation GTK et conservation des cookies de routage.
- Questions de sécurité et réponses décodées en français ; prise en charge de plusieurs questions successives, avec limite de sécurité.
- Code TOTP à six chiffres.
- Rotation des jetons et changement de contexte pour plusieurs comptes/établissements rattachés au même identifiant.
- Fin de session explicite et reconnexion en cas d’expiration.
- Pas de prise en charge des connexions SSO, EduConnect ou QR code.

Les mots de passe sont conservés en mémoire uniquement pendant la vérification, puis supprimés après connexion réussie. Les jetons, cookies de session et identités minimales des comptes sont sauvegardés chiffrés ; notes et devoirs restent en mémoire. La session locale dure au maximum huit heures, une vérification en attente dix minutes. Rien n’est écrit en localStorage. Un redémarrage restaure les sessions authentifiées non expirées, sans prolonger leur durée. Le navigateur peut proposer son propre gestionnaire de mots de passe, indépendamment de l’application.

## Tableau de bord

Vue familiale et vue individuelle, toutes les notes de l’année renvoyées par ÉcoleDirecte, filtres par période et matière, recherche d’évaluation, affichage adapté aux écrans étroits, courbes de progression, comparaison à la classe et points d’attention par matière. Les prénoms du mode démo sont fictifs : les enfants réels sont découverts depuis votre compte.

- **Moyenne indicative** : notes numériques ramenées sur 20 et pondérées par leurs coefficients. Les coefficients par matière ne sont pas appliqués ; cette moyenne n’est pas celle du bulletin.
- **Moyenne officielle** : remplace la moyenne indicative d’une fiche lorsque vous choisissez une période précise et que l’API fournit sa moyenne générale.
- **Tendance** : moyenne des 30 derniers jours moins celle des 30 jours précédents (ou 14 contre 14). Il faut des notes dans les deux fenêtres. Le filtre de période s’applique avant ce calcul. Des matières ou difficultés différentes peuvent expliquer une variation.
- **Mini-courbes individuelles** : évolution chronologique des notes sur 20 dans chaque fiche. Le graphique collectif a été retiré.
- **Écart à la classe** : différence moyenne pondérée entre l’enfant et la classe, uniquement sur les évaluations possédant les deux valeurs, ramenées sur 20.
- **À accompagner** : matière en baisse d’au moins un point entre les deux fenêtres.
- ABS, notes en lettres, notes non significatives, barèmes invalides et coefficients nuls restent hors calcul. Les données absentes ne sont jamais transformées en zéro.

Pas de classement entre frères et sœurs. Les indicateurs visent à alimenter un échange familial et à rendre les efforts visibles.

Les notes sont actualisées manuellement, avec un cache de 60 secondes pour éviter de multiplier les appels. Une erreur sur un enfant est signalée sans remplacer ses données par la démo. Les erreurs de session déclenchent une reconnexion.

## Sécurité et périmètre

Serveur attaché exclusivement à `127.0.0.1`, contrôle du Host et de l’Origin, cookie HttpOnly/SameSite=Strict, en-tête spécifique obligatoire sur les POST, protection contre les connexions répétées, taille des requêtes limitée, opérations ÉcoleDirecte sérialisées, fichiers servis sur liste blanche, CSP et absence de télémétrie/CDN. Aucun secret dans les logs ou dans les réponses au navigateur. L’application n’effectue aucune modification des notes ni envoi de message.

Les utilisateurs ayant accès à votre session macOS et à votre navigateur ouvert peuvent voir le tableau de bord. Se déconnecter après usage sur un ordinateur partagé. Ne pas exposer ce serveur sur Internet ni le placer derrière un proxy public sans revoir l’authentification locale.

## Vérification et limites

```sh
npm test        # compile puis exécute les tests TypeScript
npm run check   # contrôle de types, formatage et tests
```

21 tests automatisés réussis : protocoles de connexion simulés, QCM, TOTP, rotation des jetons, expiration, comptes multiples, données partielles, calculs et protections HTTP. Les tests HTTP invoquent le gestionnaire directement sans ouvrir de socket.

**La connexion à un vrai compte n’a pas été validée** : aucun identifiant familial n’a été utilisé. Dans l’environnement de création, l’écoute du port local a été refusée (`EPERM`) ; le rendu n’a pas pu être inspecté dans un navigateur. Il reste donc un essai de connexion et un contrôle visuel sur le Mac à effectuer.

L’API ÉcoleDirecte utilisée est privée et non officielle ; elle peut évoluer. Le comportement est fondé sur les sources communautaires consultées le 7 novembre 2026, notamment :

- https://github.com/EduWireApps/ecoledirecte-api-docs
- https://github.com/jeromeboivin/EcoleDirecteMCP/blob/main/src/ecoledirecte/auth/service.ts

Version API par défaut : `4.96.3`. Si ÉcoleDirecte refuse explicitement cette version, démarrer avec la version utilisée par son site :

```sh
ED_API_VERSION=VERSION_OBSERVEE npm start
```

Les paramètres de visibilité remontés par l’API sont pris en compte pour les principales options des notes et moyennes ; les règles particulières de publication d’un établissement peuvent nécessiter une adaptation.

## Organisation

- `src/server/server.ts` : serveur HTTP local et sessions.
- `src/server/ecoledirecte.ts` : transport, authentification, comptes et normalisation des notes.
- `src/server/openai.ts`, `src/server/session-store.ts` : IA côté serveur et coffre chiffré.
- `src/server/restart-nas.ts` : redémarrage ciblé sur le NAS.
- `src/shared/types.ts` : types du domaine partagés (notes, périodes, élèves, devoirs).
- `src/shared/metrics.ts` : calculs isolés et testables, communs au serveur et au navigateur.
- `src/client/app.ts` : interface et interactions.
- `src/client/demo.ts` : données fictives déterministes.
- `src/styles/` : thème clair pastel et responsive en SCSS, compilé vers `dist/style.css`.
- `public/` : `index.html` et favicon.
- `dist/` : JavaScript compilé, généré par `npm run build`, non suivi par Git.
- `test/` : tests TypeScript via `node:test`.

## Mise à jour : collège et lycée

Seuls les élèves du collège ou du lycée sont conservés dans le tableau de bord et les appels aux notes. Les classes de primaire, de maternelle et les niveaux non reconnus sont exclus de cette vue. Aucun compte n’est supprimé chez ÉcoleDirecte.

Les photos disponibles dans le profil ÉcoleDirecte remplacent les initiales dans les fiches, la navigation et devant le prénom dans chaque ligne des notes. Elles sont chargées en HTTPS depuis les domaines ÉcoleDirecte uniquement. Une initiale reste affichée si la photo est absente ou ne charge pas. Aucun portrait réel n’est stocké dans le projet ou l’archive.

Couleurs du tableau : vert à partir de 14/20, orange de 10 inclus à 14 exclu, rouge en dessous de 10. Le calcul tient compte du barème (7/10 est vert). Les notes non chiffrées ou exclues restent neutres. Une légende indique les seuils.

Après cette mise à jour, arrêter le processus existant avec Ctrl+C, relancer `npm start`, recharger la page et se reconnecter pour récupérer les photos. La version précédente connectée a pu être observée ; les nouvelles photos restent à vérifier après redémarrage.

## Interface claire et notes sur 20

Le graphique collectif « Les progrès prennent forme » a été supprimé. Les mini-courbes propres à chaque enfant restent dans leurs fiches. Les colonnes Note et Classe sont toutes deux converties sur 20, sans modifier les notes d’origine ni les coefficients. Les absences et valeurs indisponibles restent signalées sans conversion artificielle.

L’interface utilise désormais des fonds clairs, des cartes pastel, des chiffres plus grands et des libellés adaptés aux enfants. Le rendu a été vérifié dans la session connectée, ainsi que la conversion réelle de 5/5 en 20/20 et de la moyenne de classe 4,67/5 en 18,68/20. Une actualisation du navigateur suffit pour cette mise à jour.

## Libellés et présentation

Titres factuels : Tableau de bord, Résultats par élève, Synthèse, Baisses récentes par matière et Toutes les notes. Suppression des slogans, sous-titres décoratifs, encouragements génériques et illustration orbitale de l’accueil. Espacements réduits ; thème clair conservé.

## NAS PR2100 — accès familial

Le serveur conserve son écoute locale par défaut. HOST permet de sélectionner
une adresse d'écoute explicite, également ajoutée à la liste des hôtes autorisés.
Le contrôle d'origine reste actif.

Sur le NAS 192.168.1.53, start-nas.sh lance le serveur sur
http://192.168.1.53:3211. Le port distinct laisse fonctionner le premier serveur
local et son tunnel pendant la transition.

Lancer : nohup sh /mnt/HD/HD_a2/orbite/ed-family/start-nas.sh > /mnt/HD/HD_a2/orbite/lan.log 2>&1 &

Cet accès HTTP est destiné uniquement au réseau domestique de confiance :
le trajet navigateur-NAS n'est pas chiffré. Ne pas rediriger ce port sur Internet.
Réserver l'adresse 192.168.1.53 dans le DHCP du routeur.
Le démarrage automatique reste à raccorder au mécanisme réellement disponible
sur le NAS, puis à vérifier après redémarrage. Ne pas supposer qu'un crontab
standard persiste sous WD OS 5.

## Devoirs à faire

Chaque synthèse contient les devoirs non cochés comme faits dans le cahier de
textes, triés par échéance : matière, consigne, date complète, repères Aujourd'hui
et Demain, évaluations à préparer et noms des pièces jointes disponibles sur
ÉcoleDirecte. Tous les éléments retournés sont affichés, sans limite arbitraire.

La liste de l'API commence aujourd'hui : elle ne garantit pas l'historique des
devoirs en retard. Le statut « effectué » est déclaratif. Un statut absent est
signalé comme non renseigné. Les devoirs ne suivent pas les filtres des notes.
Les erreurs du cahier sont indépendantes de celles des notes. Les détails
indisponibles sont signalés ; une erreur ne devient jamais une liste vide.
Le HTML des consignes est converti en texte et échappé à l'affichage.
Aucune écriture ni modification de statut sur ÉcoleDirecte.
Les appels restent séquentiels pour respecter la rotation des jetons.

27 tests passent avec Node 22, dont filtrage, dates, détails incomplets,
expiration et erreurs partielles. Les devoirs réels restent à valider après
déploiement et reconnexion sur le NAS.

Pour déployer depuis le Mac, exécuter `npm run build`, copier le dossier ed-family
(au minimum `dist/`, `public/`, `start-nas.sh` et `package.json` ; `node_modules/`
est inutile sur le NAS) vers sshd@192.168.1.53:/mnt/HD/HD_a2/orbite/ puis exécuter
sur le NAS :
/mnt/HD/HD_a2/orbite/runtime/node /mnt/HD/HD_a2/orbite/ed-family/dist/server/restart-nas.js

Le redémarrage cible uniquement les processus Node du même exécutable et
dossier, exécutant server.js avec le marqueur ORBITE_NAS_INSTANCE, ou le port configuré pour les anciennes installations.
Il restaure les sessions sauvegardées non expirées et conserve le script de démarrage WD.

## Chargement progressif

La connexion et la vérification affichent immédiatement un indicateur d'attente.
Après authentification, le formulaire disparaît et le tableau affiche un loader
pendant la récupération des notes. Les devoirs sont chargés ensuite, élève par
élève, via /api/homework, avec un cache indépendant de 60 secondes et le même
verrou de session pour préserver la rotation des jetons. Seul le bloc de devoirs
est mis à jour ; la navigation, les filtres et la recherche restent utilisables.
Les réponses périmées après changement de session sont ignorées.
32 tests passent, dont attente réseau simulée, erreurs de connexion, chargement
différé, contrôle des élèves autorisés, verrou et cache.

## Devoirs : dates, progression et pagination

Chargement initial : aujourd'hui et les 29 jours suivants (calendrier de Paris).
L'index léger de l'API est nécessaire pour connaître les dates et statuts ; seules
les consignes de cette fenêtre sont demandées. Les devoirs suivants arrivent par
lots de cinq, pour l'élève sélectionné, sans recharger les notes. Les détails d'une
même journée sont réutilisés entre lots. Les compteurs journaliers utilisent tous
les statuts de la journée, y compris les devoirs cochés comme faits. Un statut
inconnu n'est pas compté comme fait et est signalé.
Séparateurs de dates et barres faits/total. Rouge : prochaine date du lundi au
vendredi, donc lundi depuis vendredi, samedi ou dimanche. Cette règle ne déduit
ni vacances ni jours fériés. Bordure de sélection portée par le conteneur complet.
36 tests passent ; bordure vérifiée dans le navigateur. Redémarrer le serveur
pour activer la nouvelle pagination côté API. Les anciennes réponses n'affichent
pas de faux compteurs de progression.


## Sessions persistantes chiffrées

Activées automatiquement au démarrage du serveur. Coffre AES-256-GCM avec nonce
aléatoire, écrit atomiquement et synchronisé avant la réponse API. Clé aléatoire
locale de 32 octets, fichiers 0600 et dossier 0700. Répertoire par défaut :
.orbite-data/PORT/ à la racine du projet (donc indépendant du dossier courant).
ORBITE_DATA_DIR permet d'utiliser un emplacement durable dédié, hors partage
public. Ne pas utiliser le même dossier pour deux serveurs simultanés.
La clé et le coffre doivent rester ensemble sur le même appareil. Ce chiffrement
ne protège pas contre une personne ayant accès au compte système ou root et à
la clé. Le coffre, la clé et les fichiers temporaires ne sont ni servis par HTTP,
ni inclus dans l'archive de sources, ni suivis par Git.

Seules les sessions authentifiées sont sauvegardées : identifiant du cookie
local, expiration absolue, jetons, cookies ÉcoleDirecte, contexte actif et champs
explicitement autorisés des comptes/élèves. Aucun mot de passe, code OTP,
question/réponse de sécurité, état de connexion en attente, notes ou devoirs.
La session expire toujours huit heures après authentification ; un redémarrage
ne prolonge rien. Un jeton révoqué par ÉcoleDirecte demande une reconnexion.
Une déconnexion ou une expiration retire la session du coffre. Si le coffre est
corrompu ou sa clé absente, le lancement échoue sans l'écraser. Une erreur de
sauvegarde renvoie une erreur explicite, jamais une réussite silencieuse.

SIGINT et SIGTERM laissent finir les requêtes actives avant l'arrêt. Chaque
réponse API sauvegarde les dernières informations d'authentification. Un arrêt
forcé au milieu d'une rotation de jeton peut nécessiter une reconnexion.
Pour la première migration seulement, redémarrer puis se reconnecter une fois :
l'ancienne version ne peut pas transmettre ses sessions en mémoire.
Les redémarrages suivants restaurent la session avec le même cookie navigateur.
La persistance ne rend pas le redémarrage sans interruption : le serveur reste
brièvement inaccessible pendant le remplacement du processus.

40 tests passent, dont chiffrement, altération, permissions, absence de secrets
de connexion, restauration avec le même cookie, rotation, déconnexion durable
et expiration. Le test de redémarrage recrée le serveur et son client depuis le
coffre sans appel à ÉcoleDirecte.

## OpenAI côté serveur

Créer un fichier `.env` à côté de `server.js` à partir de `.env.example`, puis
renseigner `OPENAI_API_KEY` et éventuellement `OPENAI_MODEL` (défaut :
`gpt-5-mini`). Restreindre les permissions avec `chmod 600 .env`, puis redémarrer
le serveur. La configuration est lue automatiquement ; les variables déjà
présentes dans l'environnement ont priorité. Ne jamais copier cette clé dans
`public/`, un dépôt ou une archive distribuée.

Le front peut appeler le même serveur, sans clé :

```ts
import { askAI } from './ai.ts'; // depuis src/client/, servi en /client/ai.js
const {text, complete, refused, usage} = await askAI(
  'Propose une méthode pour organiser une semaine de révision.'
);
// Pour afficher du texte brut : element.textContent = text;
```

Route : `POST /api/ai`, JSON `{"input":"Votre demande"}` avec cookie de session
et en-tête `X-Orbite-Client: 1` (gérés par le helper). Une session ÉcoleDirecte
entièrement authentifiée est requise. Réponse : `text`, `complete`, `refused`,
`usage.inputTokens` et `usage.outputTokens`. Les erreurs ont un champ `error`.
Le modèle et les instructions sont définis exclusivement côté serveur.

Seul le texte fourni est envoyé à OpenAI, accompagné des instructions fixes :
aucune transmission automatique des notes, devoirs ou identifiants. La requête
utilise l'API Responses avec `store: false`, sans historique ni outils. Cette
option désactive le stockage des réponses pour récupération via l'API ; elle
ne constitue pas une garantie d'absence de toute rétention chez OpenAI.
La clé et les erreurs brutes du fournisseur ne sont jamais renvoyées au front.

Limites : 8 000 caractères, corps HTTP de 16 Kio maximum, 2 048 jetons de sortie
(y compris raisonnement), délai de 45 secondes. Une requête simultanée par
session, deux par serveur ; dix demandes/minute/session et trente/minute au
total. Ces compteurs en mémoire sont réinitialisés au redémarrage. L'IA ne bloque
pas le chargement ÉcoleDirecte. La facturation API est distincte de ChatGPT.

46 tests passent, dont appels OpenAI simulés, accès authentifié, protections
CSRF, quotas, confidentialité des réponses et coexistence avec le tableau de
bord. Un appel réel nécessite une clé configurée sur le serveur.

## Conseil personnalisé par élève

Un court conseil IA apparaît sous la moyenne et la tendance, avant les devoirs.
Il se charge en différé pour les cartes visibles, sans bloquer notes, filtres ou
devoirs. Le texte est adressé à l'élève : encouragement en hausse, priorité
concrète en baisse, conseil de progression en stabilité. Une tendance inconnue
n'est jamais assimilée à une stabilité. Le seuil de stabilité est 0,05 point,
comme la flèche du tableau de bord. Affichage limité à trois lignes ; texte
complet disponible au survol et dans le contenu accessible.

Cette fonctionnalité transmet automatiquement à OpenAI les agrégats nécessaires
pour les élèves affichés : moyenne, tendance, effectifs, écarts à la classe et
résultats par matière (jusqu'à douze). Elle n'envoie ni noms, identifiants,
photos, libellés d'évaluations, devoirs ni identifiants de connexion. Les données
suivent la période scolaire et la fenêtre de tendance choisies. Il n'y a aucun
appel en démonstration ou sans note exploitable. La route générique /api/ai
continue à ne joindre aucun contexte de son propre chef.

Les demandes sont sérialisées et dédoublonnées dans un cache mémoire de l'onglet,
indexé par élève et contexte. Changer de filtre ne répète pas une demande déjà
faite pour les mêmes résultats. Les réponses obsolètes ne sont pas affichées.
Les échecs ne déclenchent aucune boucle de tentatives : recharger la page permet
de réessayer. Si l'IA est indisponible, un message discret remplace le conseil.
Le texte généré est inséré via textContent, jamais interprété comme du HTML.

49 tests passent (API simulée), dont tendances, absence d'identité dans le
contexte transmis, sérialisation, cache et abandon des demandes obsolètes.
Redémarrer Node puis recharger la page pour servir le nouveau module coaching.js.

## Graphique individuel détaillé

Dans le filtre d'un élève, la petite courbe est remplacée par un graphique dédié
sur toute la largeur : dates à l'échelle, axe des notes sur 20, points par
évaluation, moyenne pondérée quotidienne, moyenne de classe quotidienne des
évaluations disponibles et tendance glissante pondérée sur 14 ou 30 jours.
La tendance exige deux notes dans la fenêtre et ne prédit pas les résultats.
Les valeurs absentes interrompent les séries. Les notes hors calcul ou sans
date exploitable sont exclues. L'échelle inclut 0 à 20 et s'étend si des bonus
excèdent 20. Les points proposent des détails au survol et des libellés
accessibles ; le graphique défile horizontalement sur petit écran.
51 tests passent, dont normalisation des barèmes, coefficients, plusieurs notes
le même jour, classe manquante et fenêtres de tendance. Recharger la page suffit.

## Moyennes cumulées et interface simplifiée

Le graphique individuel cumule désormais toutes les notes éligibles depuis le
début de la période sélectionnée, avec leurs coefficients. La classe cumule les
moyennes disponibles des évaluations correspondantes, sans remplacer une valeur
absente par zéro. Ce n'est pas la moyenne générale officielle de la classe.
Les points de notes individuelles sont retirés ; la troisième courbe conserve
la tendance glissante sur 14 ou 30 jours. 52 tests passent.

Les quatre blocs de compteurs et la mention Session locale ont été retirés.
Le bouton de navigation en haut à gauche replie/déplie la sidebar ; son état est
mémorisé localement. Les menus de période ont une flèche dédiée, un espacement
réservé et des couleurs explicites. Courbes, filtre de période et repli vérifiés
dans le navigateur. Recharger la page suffit.

## Notes des sept derniers jours

En bas de chaque encart coloré : trois notes chiffrées au maximum, les plus
récentes entre aujourd'hui et J−6 inclus (calendrier de Paris), avec matière,
date et note sur 20. Les autres sont signalées par un compteur. La sélection
utilise les notes de l'élève indépendamment du filtre de période, afin de garder
une fenêtre fixe de sept jours. Un état vide est affiché en l'absence de notes.
54 tests passent, dont bornes inclusives, limite à trois et changement de jour
à Paris. Recharger la page suffit.

## Alignement et sous-matières

Les cartes familiales partagent leurs trois lignes via CSS subgrid : encart
coloré, conseil IA, devoirs. Les hauteurs variables dues aux trois dernières
notes ou aux noms de classe ne décalent plus le début des sections voisines.
Une disposition de repli reste disponible sans subgrid.

Les notes utilisent désormais les disciplines de la période pour résoudre la
matière parente par codeMatiere et la sous-matière par codeSousMatiere. Le libellé
composé (ex. ANGLAIS LV1 · Oral) est utilisé dans le tableau, les dernières notes,
les filtres, les alertes et le contexte IA. Sans référentiel exploitable, le code
parent est conservé plutôt qu'une matière devinée. Deux sous-matières Oral
appartenant à des langues différentes restent distinctes. 56 tests passent.
Redémarrer Node puis actualiser les données pour appliquer cette normalisation.


## Adresse du NAS configurable

Le fichier `.env` du NAS doit définir `HOST` (adresse réseau du NAS) et `PORT`
(port d'écoute, habituellement 3211). `start-nas.sh` utilise le chargeur `.env`
natif de Node, après retrait des anciennes variables HOST/PORT héritées.
`restart-nas.js` lit les mêmes valeurs avec le parseur Node, puis les utilise
pour le lancement et le contrôle de disponibilité. Aucun script de production
ne contient l'adresse IP du NAS en dur. La clé OpenAI existante reste dans le
même fichier. Le fichier `.env.example` conserve les valeurs locales par défaut.

Les nouvelles instances portent un marqueur permettant de les retrouver même
après changement d'adresse ou de port. Pour la première migration, conserver
le port actuel afin de retrouver l'ancienne instance non marquée. Le coffre de
sessions est lié au port ; changer de port peut demander une reconnexion.
Après transfert des scripts mis à jour et configuration du `.env`, lancer
`/mnt/HD/HD_a2/orbite/runtime/node /mnt/HD/HD_a2/orbite/ed-family/dist/server/restart-nas.js`.

## TypeScript

Tout le code (serveur, navigateur, tests) est écrit en TypeScript strict
(`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`,
`erasableSyntaxOnly`). Les imports relatifs utilisent l'extension `.ts`, réécrite
en `.js` à la compilation. Trois configurations :

- `tsconfig.json` : contrôle de types de `src/` et `test/`, utilisé par l'éditeur ;
- `tsconfig.build.json` : compilation de `src/` vers `dist/` ;
- `tsconfig.client.json` : vérifie que le code navigateur n'utilise aucune API Node.

Le navigateur et le NAS exécutent uniquement `dist/`, en JavaScript ES2023 : le
NAS n'a besoin ni de TypeScript ni de `node_modules`. Les tests s'exécutent
directement en TypeScript grâce au retrait des types natif de Node.

Scripts : `npm run build`, `npm start`, `npm run dev` (recompilation et
redémarrage automatiques), `npm run typecheck`, `npm test`, `npm run format`,
`npm run check`.

Les fichiers servis au navigateur deviennent `/client/*.js` et
`/shared/metrics.js`, toujours sur liste blanche. Le coffre de sessions et `.env`
restent à la racine : les sessions existantes sont conservées. `restart-nas`
retrouve aussi bien les anciennes instances (`server.js`) que les nouvelles
(`dist/server/server.js`). Après mise à jour sur le NAS, la première exécution
de `restart-nas` doit donc être celle de `dist/server/restart-nas.js`.

57 tests passent, identiques à la version JavaScript ; le mode démonstration a
été vérifié dans le navigateur à partir de la version compilée.

## Styles SCSS

La feuille de style est écrite en SCSS dans `src/styles/` et compilée par Dart
Sass (dépendance de développement) vers `dist/style.css`, toujours servie en
`/style.css`. `main.scss` charge les modules (`@use`) dans l'ordre de la cascade :

- `_variables.scss` : palette, couleurs des notes et des courbes, accents des
  cartes élèves, largeurs de la barre latérale et points de rupture ;
- `_mixins.scss` : accent de carte, requêtes média, séries de graphique ;
- `_base`, `_sidebar`, `_layout`, `_cards`, `_weekly-notes`, `_homework`,
  `_panels`, `_chart`, `_card-layouts`, `_dialog` : un module par zone ;
- `_responsive.scss` : surcharges pour écrans étroits, en dernier.

Les couleurs utilisées à l'exécution (`--accent`, `--line`, `--muted`…) restent
des propriétés CSS personnalisées. `npm run build` compile aussi les styles ;
`npm run dev` les recompile à chaque modification. Le CSS produit est identique
à la feuille d'origine (vérifié par comparaison des sorties compilées).
