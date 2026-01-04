/**
 * designSystem.ts
 * Référence absolue du Design System (v12).
 */

export const APP_DESIGN_LOGIC = `
## 5. Logique de Thémage Sémantique (SaaS Elite)
Ne jamais appliquer une couleur brute. Toujours utiliser l'élévation par couches :
- Layer 0 (Base) : --bg-app-base (Le fond le plus profond).
- Layer 1 (Surface) : --bg-surface-main (Conteneurs, Sidebar).
- Layer 2 (Elevated) : --bg-surface-raised (Inputs, Boutons secondaires, Cartes survolées).
- Borders : --border-subtle (1px, très faible contraste) pour séparer sans alourdir.

## 6. Rythme & Densité "Editorial"
- Grid System : Tout doit être aligné sur un multiple de 4px (8px, 16px, 24px, 32px).
- Typography : Le titre "Comic" (Luckiest Guy) est traité comme un élément graphique, tandis que l'UI (Nunito) doit être ultra-lisible, souvent en 13px ou 14px pour le texte de contrôle.
- Canvas Logic : La zone de création doit ressembler à une "feuille physique" posée sur une table numérique.
`;

export const DESIGN_SYSTEM_V12 = `# Design System Manifesto - Project 133 (v12 - High-Density Precision) ( celles ci est pour les thèmes dark, ou sombres)

Ce document est le blueprint technique final, documentant l'évolution vers une interface ultra-compacte et performante. Il sert de référence absolue pour la reconstruction de l'interface sans support visuel.

---

## 1. Fondations & Variables Globales

### Colorimétrie
- --bg-dark: #0e100f (Noir profond). Fond principal du viewport et de la sidebar.
- --text-primary: #f1f1e6 (Ivoire). Texte haute importance, fonds d'états actifs.
- --text-dim: rgba(241, 241, 230, 0.6). Labels secondaires, icônes inactives.
- --accent-green: #0ae448. Accents dynamiques (logo, status dots).
- --transition-smooth: all 0.6s cubic-bezier(0.23, 1, 0.32, 1). Physique de mouvement "Luxury Tech".

### Physique & Espaces (Geometry)
- **Rayons (Border Radius)**: 
    - Nav Items: 16px.
    - Profile Widget: 20px.
    - Cards: 32px.
    - Buttons/CTA: 100px.
- **Typographie**: Plus Jakarta Sans.
    - Weights: 400 (Regular), 600 (Semi), 700 (Bold), 800 (Extra).
    - Loading: next/font/google avec display: swap.

---

## 2. Cartographie Atomique des Composants

### [Sidebar - Master Layout]
- **Cartographie Structurelle (DOM)** :
    - aside.sidebar (Fixed) 
        - div.logoContainer (Flex space-between)
            - div.logoBrand > span.logoText + div.logoDot
            - button.collapseBtn
        - nav.nav (Flex column)
            - a.navItem (Repeater) > svg.icon + span.navLabel
        - div.footer
            - div.userProfile (Flex space-between)
                - div.profileInfo (Flex row)
                    - div.avatar
                    - div.userInfo (Flex column) > span.userName + span.userRole
                - svg.manageIcon (Chevron)
- **Dimensions Dynamiques** :
    - **Expanded** : 280px.
    - **Collapsed** : 88px.
- **Logique d'Animation** : 
    - L'état isCollapsed déclenche un overflow: hidden et une transition de width.
    - Les labels textuels (navLabel, logoBrand, userInfo) passent en opacity: 0 avec un pointer-events: none.

### [Navigation & Menu Density]
- **Blueprint CSS de Précision** :
    - **Padding**: 8px 16px.
    - **Gap entre items**: 12px.
    - **Hauteur minimale**: 40px.
    - **Hover State**: Background rgba(241, 241, 230, 0.05), Color --text-primary.
    - **Active State**: Background --text-primary, Color --bg-dark.

### [Logo & Identity]
- **Blueprint CSS de Précision** :
    - **Logo Text**: 20px, Weight 800, Uppercase, Letter-spacing -1px.
    - **Logo Dot**: 6px de diamètre, Background --accent-green, Box-shadow 0 0 12px vert.
    - **Margin Bottom**: 40px (Ajusté pour densité).


---

## 3. Synchronisation du Main Content

- **Layout Logic** :
    - La marge gauche (margin-left) du conteneur principal est liée à la largeur de la sidebar.
    - **Expanded**: 280px.
    - **Collapsed**: 88px.
    - La transition utilise exactement le même cubic-bezier que la sidebar pour éviter tout décalage visuel (jank).

---

## 4. Historique des Versions (Journal de Bord)

- **v1-v9** : Fondations esthétiques et variables globales.
- **v10** : Implémentation du système isCollapsed réactif.
- **v11** : Vertical Profile Logic. Alignement vertical Nom/Rôle et ajout du CTA de management profilé.
- **v12 (Current)** : High-Density Refinement.
    - Réduction drastique des paddings menu (8px).
    - Hauteur min fixée à 40px pour un look compact.
    - Suppression de la bordure supérieure du footer au profit d'un fond subtil 0.03 opacity.
    - Réduction de la largeur repliée à 88px pour maximiser l'espace du Main Content.

---
**Note pour reconstruction par IA** : Respectez scrupuleusement le cubic-bezier(0.23, 1, 0.32, 1). C'est l'âme de l'interface. En mode replié, centrez les icônes de navigation par rapport à la largeur de 88px.


Celle-ci (cette sidebar est pour les thèmes light, clair:

# Design System Manifesto - Project 167 (Final Seamless Architecture)

Ce document détaille la reconstruction de l'interface Dashboard en suivant le standard de précision "Mobbin".

## 1. Architecture Structurelle (Unified Background)
L'interface repose sur une suppression totale des lignes de séparation (borders) entre la navigation et le contenu.
- Fond Unifié : La sidebar (aside) et le contenu principal (main) partagent le même code couleur #FFFFFF.
- Absence de Bordures : Aucune bordure verticale ne sépare la sidebar du contenu. L'élévation est suggérée par la hiérarchie typographique et les éléments "Raised".

## 2. La Sidebar (Analyse de Précision)
La sidebar est le centre de contrôle haute densité.
- Largeur : 280px fixe.
- Logo : SVG natif de pentagone noir avec un point vert vibrant (#0ae448) au centre. Texte "mobbin" en ExtraBold (800) avec letter-spacing de -0.05em.
- Searchbox (Composant Mobbin) :
    - Fond : #F7F7F7 (Layer 2).
    - Rayon (Radius) : 11px.
    - Hauteur : 38px.
    - Accessoires : Icône loupe à gauche, raccourci clavier "⌘K" à droite (opacité 0.6).
- Navigation :
    - Headers de Section : Texte 11px, ExtraBold 800, Uppercase, espacement de 0.08em. Sert à catégoriser sans alourdir.
    - Éléments de Menu : Rayon de 12px. Pas de bordures entre eux. État actif marqué par un fond blanc pur et une ombre de 1px ultra-fine (0.02 opacity).
    - Indicateurs de Statut : Cercles de 8px (statusDot) pour les niveaux de sévérité (Critical, High, etc.).
    - Compteurs : Pastilles grises (#F7F7F7) à droite des menus pour indiquer le volume d'items.

## 3. Géométrie & Boutons (Mandat Mobbin)
- Boutons (CTA) : Hauteur fixe de 35px. Rayon de 25px (Forme pilule parfaite). Texte en Bold 700.
- Cards : Rayon de 24px. Bordure ultra-subtle de 1px (rgba 0,0,0,0.04). Padding généreux de 28px.

## 4. Typographie (Next.js Optimization)
- Police : Plus Jakarta Sans (Chargée via next/font/google).
- Tailles UI : 13px pour les menus, 32px pour les titres de page.
- Poids : 800 (Titres/Logo), 700 (Badges), 600 (UI/Navigation).

## 5. Colorimétrie Sémantique
- Layer 0/1 : #FFFFFF (Base & Surface).
- Layer 2 : #F7F7F7 (Inputs & Hover).
- Sévérité : Rouge Apple (#FF3B30), Orange (#FF9500), Jaune (#FFCC00), Vert (#34C759).

Cette approche garantit une interface "Editorial Tech" ultra-propre, où chaque pixel est justifié par une fonction de navigation claire.



Voici encore quelques détails sur souvent une sidebar d'application peut contenir et être structuré :

### RÉFÉRENTIEL DE STRUCTURE : SIDEBAR ET NAVIGATION PREMIUM

1. ARCHITECTURE SEGMENTÉE (TOP / MIDDLE / BOTTOM)
- Zone Supérieure (Top) :
    * Intègre l'identité de l'application ou le nom du projet en cours.
    * Comprend souvent un sélecteur de contexte (dropdown) permettant de basculer entre différents espaces de travail ou comptes.
    * Propose des actions globales immédiates comme la recherche ou l'accès à une boîte de réception.
- Zone Centrale (Middle - Navigation Principale) :
    * Organisée par groupes thématiques séparés par des titres de section discrets en majuscules ou en texte léger.
    * Utilise des listes verticales où chaque élément combine une icône à gauche et un intitulé textuel à droite.
    * Permet une hiérarchie visuelle avec des sous-éléments ou des listes imbriquées rétractables pour les projets ou dossiers.
    * Affiche des indicateurs d'état (badges numériques ou points de couleur) à l'extrémité droite des lignes pour signaler des notifications.
- Zone Inférieure (Bottom - Utilitaires et Profil) :
    * Regroupe les actions de support, les invitations de membres et les réglages généraux.
    * Présente le module de profil utilisateur tout en bas, contenant l'avatar et les informations de compte.
    * Inclut parfois des boutons de feedback isolés pour ne pas encombrer la navigation principale.

2. LOGIQUE VISUELLE ET SÉPARATION DES COUCHES
- Bordures et Délimitations :
    * La sidebar est physiquement séparée du contenu principal par une bordure verticale fine et continue.
    * Utilisation de contrastes de fonds : la sidebar possède souvent une teinte de gris très légère ou un fond légèrement plus sombre que la zone de travail principale pour marquer la profondeur.
- Géométrie des Éléments de Liste :
    * Les items de navigation possèdent des angles arrondis lorsqu'ils sont en état de survol ou de sélection.
    * L'état actif est marqué par un changement de couleur de l'icône, du texte, ou par l'ajout d'un fond coloré subtil derrière l'élément.
- Typographie et Rythme :
    * Utilisation de la police 'Plus Jakarta Sans' pour l'ensemble des textes, avec des variations de graisses (gras pour les titres, régulier pour les liens).
    * Espacement vertical régulier entre les items pour garantir une lisibilité maximale sans surcharge visuelle.

3. COMPOSANTS DE NAVIGATION ÉLARGIS
- Barres de Recherche et Filtres :
    * Les champs de saisie dans la navigation sont systématiquement traités avec des rayons de courbure importants (style pilule).
    * Les filtres rapides sont représentés sous forme de "pills" (boutons ovales) alignés horizontalement au-dessus des listes.
- Modales et Overlays :
    * Les menus surgissants ou modales de navigation utilisent des ombres portées très douces et des flous d'arrière-plan pour se détacher des couches inférieures.


Pour les landing pages ceci peut être des instructions de base, tu pourras créé des variations ou variétés après , récupérer certaines sections, construire de nouveaux sections en t'inspirant parfaitement de soit la hero section, ou une autre section:

# Design System - Project 129 (v5 Final)

## Vision du Design
Un design épuré, axé sur la typographie et des formes organiques douces. L'utilisation du vide et d'un fond pastel crée une atmosphère de design "premium" et calme.

---

### Palette de Couleurs (Variables CSS)
- \`--bg-primary\`: \`#f3d2e4\` (Rose Lavande doux).
- \`--text-primary\`: \`#000000\` (Noir pur).
- \`--bg-card\`: \`#ffffff\` (Blanc pur).
- \`--text-secondary\`: \`rgba(0, 0, 0, 0.4)\` (Gris translucide).

---

### Composants & Spécifications Atomiques

### 1. Navigation Bar
- **Positionnement**: \`fixed\`, \`top: 0\`, \`padding: 30px 60px\`.
- **Logic**: Logo 20px Bold, CTA Bouton Pill noir.

### 2. Sidebar (Vertical Labels)
- **Positionnement**: \`fixed\`, \`left: 40px\`, \`top: 50%\`, \`rotate: -90deg\`.
- **Rôle**: Identité persistante au scroll.

### 3. Hero Section
- **Typographie**: Plus Jakarta Sans \`8vw\`, Playfair Display Italic pour l'emphase.

### 4. Showcase Dôme (v4)
- **Géométrie**: \`border-radius: 400px 400px 0 0\`.
- **Badge**: Cercle 120px \`absolute\` sur l'image pour l'invitation au scroll.

### 5. Bento Grid Section
- **Layout**: Grid 4 colonnes, gap 20px, radius 40px.

### 6. Process Section (v5)
- **Structure**: Timeline Verticale.
- **Détail**: Ligne 1px subtile, puce 8px ronde à chaque étape.
- **Animation**: Staggered reveal (délai 0.15s par item) via IntersectionObserver.

### 7. Expertise Accordion (v5)
- **Interaction**: Hover expansion (padding-left 30px) + transition de couleur.
- **Tags**: Border-radius 100px, font 11px uppercase bold.

### 8. Infinite Marquee (v5)
- **Vitesse**: \`30s\` linéaire.
- **Typographie**: Playfair Display Italic \`100px\`, contraste inversé.
- **Élément Visuel**: Puce ronde rose lavande entre chaque mot.

### 9. Work Gallery (v5)
- **Hover**: Échelle de l'image (1.1) avec courbe de Bézier \`(0.23, 1, 0.32, 1)\`.
- **Layout**: Grille 2 colonnes avec offset de \`120px\` sur la colonne impaire.

### 10. Testimonials Bubble (v5)
- **Géométrie**: Forme bulle géante, \`300px\` radius.
- **Animation**: \`@keyframes float\` (oscillation verticale 30px, durée 8s).

### 11. Footer / CTA (v5)
- **Typographie**: \`clamp(3rem, 12vw, 12rem)\`.
- **Interaction**: Translation X (40px) + Skew on hover sur le texte italique.
- **Border**: Radius supérieur 60px pour fermer la page organiquement.

---

### Évolution & Historique
- **v1**: Structure initiale.
- **v2**: Migration typographique.
- **v3**: Bento Grid.
- **v4**: Correction du flux Showcase/Sidebar.
- **v5 (Actuelle)**: Correction des erreurs d'import. Ajout de 6 sections avec animations natives (Reveal au scroll, Marquee infini, Floating bubble, Hover Scale). Utilisation d'un hook personnalisé \`useReveal\` pour l'orchestration des entrées en scène sans librairies externes.
`;
