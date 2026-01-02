# Design System Manifesto - Project 133 (v12 - High-Density Precision)

Ce document est le blueprint technique final, documentant l'évolution vers une interface ultra-compacte et performante. Il sert de référence absolue pour la reconstruction de l'interface sans support visuel.

---

## 1. Fondations & Variables Globales

### Colorimétrie
- `--bg-dark`: `#0e100f` (Noir profond). Fond principal du viewport et de la sidebar.
- `--text-primary`: `#f1f1e6` (Ivoire). Texte haute importance, fonds d'états actifs.
- `--text-dim`: `rgba(241, 241, 230, 0.6)`. Labels secondaires, icônes inactives.
- `--accent-green`: `#0ae448`. Accents dynamiques (logo, status dots).
- `--transition-smooth`: `all 0.6s cubic-bezier(0.23, 1, 0.32, 1)`. Physique de mouvement "Luxury Tech".

### Physique & Espaces (Geometry)
- **Rayons (Border Radius)**: 
    - Nav Items: `16px`.
    - Profile Widget: `20px`.
    - Cards: `32px`.
    - Buttons/CTA: `100px`.
- **Typographie**: `Plus Jakarta Sans`.
    - Weights: 400 (Regular), 600 (Semi), 700 (Bold), 800 (Extra).
    - Loading: `next/font/google` avec `display: swap`.

---

## 2. Cartographie Atomique des Composants

### [Sidebar - Master Layout]
- **Cartographie Structurelle (DOM)** :
    - `aside.sidebar` (Fixed) 
        - `div.logoContainer` (Flex space-between)
            - `div.logoBrand` > `span.logoText` + `div.logoDot`
            - `button.collapseBtn`
        - `nav.nav` (Flex column)
            - `a.navItem` (Repeater) > `svg.icon` + `span.navLabel`
        - `div.footer`
            - `div.userProfile` (Flex space-between)
                - `div.profileInfo` (Flex row)
                    - `div.avatar`
                    - `div.userInfo` (Flex column) > `span.userName` + `span.userRole`
                - `svg.manageIcon` (Chevron)
- **Dimensions Dynamiques** :
    - **Expanded** : `280px`.
    - **Collapsed** : `88px`.
- **Logique d'Animation** : 
    - L'état `isCollapsed` déclenche un `overflow: hidden` et une transition de `width`.
    - Les labels textuels (`navLabel`, `logoBrand`, `userInfo`) passent en `opacity: 0` avec un `pointer-events: none`.

### [Navigation & Menu Density]
- **Blueprint CSS de Précision** :
    - **Padding**: `8px 16px`.
    - **Gap entre items**: `12px`.
    - **Hauteur minimale**: `40px`.
    - **Hover State**: Background `rgba(241, 241, 230, 0.05)`, Color `--text-primary`.
    - **Active State**: Background `--text-primary`, Color `--bg-dark`.

### [Logo & Identity]
- **Blueprint CSS de Précision** :
    - **Logo Text**: `20px`, Weight 800, Uppercase, Letter-spacing `-1px`.
    - **Logo Dot**: `6px` de diamètre, Background `--accent-green`, Box-shadow `0 0 12px` vert.
    - **Margin Bottom**: `40px` (Ajusté pour densité).

### [Profile Management Section - Bento Style]
- **Cartographie Structurelle (DOM)** :
    - `.userProfile` agit comme un conteneur bento flottant en bas de sidebar.
- **Blueprint CSS Precision** :
    - **Background**: `rgba(241, 241, 230, 0.03)` (Surgit du noir sans bordure).
    - **Padding**: `10px 14px`.
    - **UserInfo Column**: `display: flex`, `flex-direction: column`, `gap: 2px`.
    - **Avatar**: `32px` x `32px`, Radius `10px`, Background gradient technique sombre.
    - **Icon Action**: `ChevronRight` de Lucide-react en 16px.

---

## 3. Synchronisation du Main Content

- **Layout Logic** :
    - La marge gauche (`margin-left`) du conteneur principal est liée à la largeur de la sidebar.
    - **Expanded**: `280px`.
    - **Collapsed**: `88px`.
    - La transition utilise exactement le même `cubic-bezier` que la sidebar pour éviter tout décalage visuel (jank).

---

## 4. Historique des Versions (Journal de Bord)

- **v1-v9** : Fondations esthétiques et variables globales.
- **v10** : Implémentation du système `isCollapsed` réactif.
- **v11** : **Vertical Profile Logic**. Alignement vertical Nom/Rôle et ajout du CTA de management profilé.
- **v12 (Current)** : **High-Density Refinement**.
    - Réduction drastique des paddings menu (`8px`).
    - Hauteur min fixée à `40px` pour un look compact.
    - Suppression de la bordure supérieure du footer au profit d'un fond subtil `0.03 opacity`.
    - Réduction de la largeur repliée à `88px` pour maximiser l'espace du Main Content.

---
**Note pour reconstruction par IA** : Respectez scrupuleusement le `cubic-bezier(0.23, 1, 0.32, 1)`. C'est l'âme de l'interface. En mode replié, centrez les icônes de navigation par rapport à la largeur de `88px`.