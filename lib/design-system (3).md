# Design System - Project 129 (v5 Final)

## Vision du Design
Un design épuré, axé sur la typographie et des formes organiques douces. L'utilisation du vide et d'un fond pastel crée une atmosphère de design "premium" et calme.

---

### Palette de Couleurs (Variables CSS)
- `--bg-primary`: `#f3d2e4` (Rose Lavande doux).
- `--text-primary`: `#000000` (Noir pur).
- `--bg-card`: `#ffffff` (Blanc pur).
- `--text-secondary`: `rgba(0, 0, 0, 0.4)` (Gris translucide).

---

### Composants & Spécifications Atomiques

### 1. Navigation Bar
- **Positionnement**: `fixed`, `top: 0`, `padding: 30px 60px`.
- **Logic**: Logo 20px Bold, CTA Bouton Pill noir.

### 2. Sidebar (Vertical Labels)
- **Positionnement**: `fixed`, `left: 40px`, `top: 50%`, `rotate: -90deg`.
- **Rôle**: Identité persistante au scroll.

### 3. Hero Section
- **Typographie**: Plus Jakarta Sans `8vw`, Playfair Display Italic pour l'emphase.

### 4. Showcase Dôme (v4)
- **Géométrie**: `border-radius: 400px 400px 0 0`.
- **Badge**: Cercle 120px `absolute` sur l'image pour l'invitation au scroll.

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
- **Vitesse**: `30s` linéaire.
- **Typographie**: Playfair Display Italic `100px`, contraste inversé.
- **Élément Visuel**: Puce ronde rose lavande entre chaque mot.

### 9. Work Gallery (v5)
- **Hover**: Échelle de l'image (1.1) avec courbe de Bézier `(0.23, 1, 0.32, 1)`.
- **Layout**: Grille 2 colonnes avec offset de `120px` sur la colonne impaire.

### 10. Testimonials Bubble (v5)
- **Géométrie**: Forme bulle géante, `300px` radius.
- **Animation**: `@keyframes float` (oscillation verticale 30px, durée 8s).

### 11. Footer / CTA (v5)
- **Typographie**: `clamp(3rem, 12vw, 12rem)`.
- **Interaction**: Translation X (40px) + Skew on hover sur le texte italique.
- **Border**: Radius supérieur 60px pour fermer la page organiquement.

---

### Évolution & Historique
- **v1**: Structure initiale.
- **v2**: Migration typographique.
- **v3**: Bento Grid.
- **v4**: Correction du flux Showcase/Sidebar.
- **v5 (Actuelle)**: Correction des erreurs d'import. Ajout de 6 sections avec animations natives (Reveal au scroll, Marquee infini, Floating bubble, Hover Scale). Utilisation d'un hook personnalisé `useReveal` pour l'orchestration des entrées en scène sans librairies externes.