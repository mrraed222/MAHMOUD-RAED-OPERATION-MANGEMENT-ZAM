---
name: Artisanal Operations
colors:
  surface: '#fcf9f8'
  surface-dim: '#dcd9d9'
  surface-bright: '#fcf9f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f2'
  surface-container: '#f0eded'
  surface-container-high: '#eae7e7'
  surface-container-highest: '#e4e2e1'
  on-surface: '#1b1c1c'
  on-surface-variant: '#4e453d'
  inverse-surface: '#303030'
  inverse-on-surface: '#f3f0f0'
  outline: '#80756c'
  outline-variant: '#d2c4ba'
  surface-tint: '#725a42'
  primary: '#33210d'
  on-primary: '#ffffff'
  primary-container: '#4b3621'
  on-primary-container: '#bd9f83'
  inverse-primary: '#e1c1a4'
  secondary: '#5e604d'
  on-secondary: '#ffffff'
  secondary-container: '#e1e1c9'
  on-secondary-container: '#636451'
  tertiary: '#002c06'
  on-tertiary: '#ffffff'
  tertiary-container: '#00450e'
  on-tertiary-container: '#56b958'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#fedcbe'
  primary-fixed-dim: '#e1c1a4'
  on-primary-fixed: '#291806'
  on-primary-fixed-variant: '#59422c'
  secondary-fixed: '#e4e4cc'
  secondary-fixed-dim: '#c8c8b0'
  on-secondary-fixed: '#1b1d0e'
  on-secondary-fixed-variant: '#474836'
  tertiary-fixed: '#94f990'
  tertiary-fixed-dim: '#78dc77'
  on-tertiary-fixed: '#002204'
  on-tertiary-fixed-variant: '#005313'
  background: '#fcf9f8'
  on-background: '#1b1c1c'
  surface-variant: '#e4e2e1'
typography:
  display-lg:
    fontFamily: Montserrat
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Montserrat
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Montserrat
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  title-md:
    fontFamily: Montserrat
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Montserrat
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Montserrat
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-bold:
    fontFamily: Montserrat
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 12px
  md: 24px
  lg: 40px
  xl: 64px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 32px
---

## Brand & Style

The design system is engineered for high-efficiency operations within a premium hospitality context. It balances the warmth of a boutique cafe experience with the rigorous clarity required for industrial-grade management. The aesthetic is **Corporate Modern** with **Minimalist** influences, prioritizing data density without sacrificing visual breathing room.

The target audience includes floor supervisors and baristas who require instant legibility under fast-paced lighting conditions. The emotional response is one of **composed control**—a digital extension of a clean, well-organized workstation. High-quality finishes, such as subtle borders and soft shadows, evoke the precision of artisanal coffee brewing.

## Colors

The palette is rooted in the organic tones of the coffee industry. 
- **Primary (Coffee Brown):** Used for critical branding moments, primary action buttons, and active navigation states. 
- **Secondary (Soft Cream):** Utilized as a sophisticated alternative to pure white for large surface areas and card backgrounds, reducing eye strain.
- **Accent (Fresh Green):** Reserved exclusively for "Success," "Completed," and "In-Stock" states.
- **Alert (Amber):** High-visibility tone for "Pending," "Warning," or "Low Stock" indicators.
- **Neutral (Deep Charcoal):** Provides the structural framework for text, iconography, and borders, ensuring high contrast against cream backgrounds.

## Typography

This design system utilizes **Montserrat** for its geometric clarity and professional weight distribution. For Arabic localization, it is paired with **Almarai** to maintain a consistent x-height and stroke weight.

**Hierarchy Rules:**
- Use `display-lg` for dashboard overviews and key metrics.
- `label-bold` is strictly for status tags and category headers to ensure clear distinction from body content.
- Paragraph text should always utilize `body-lg` for checklists to ensure readability on mobile tablets used by floor staff.

## Layout & Spacing

The system follows a **Fluid Grid** model with a strictly enforced 8px baseline grid to ensure alignment across complex data tables and checklists.

- **Desktop (1440px+):** 12-column grid with 24px gutters. Side navigation is fixed at 280px.
- **Tablet (768px - 1024px):** 8-column grid. Content utilizes the full width with margins reduced to 24px. Navigation collapses into a rail.
- **Mobile (<768px):** 4-column grid with 16px side margins. Cards stack vertically, and complex tables transition into list-item cards.

Internal card padding should default to `md` (24px) to maintain a premium, spacious feel.

## Elevation & Depth

Hierarchy is established through **Tonal Layers** and **Ambient Shadows**. This design system avoids harsh blacks, opting for shadows tinted with the Primary Coffee Brown to maintain warmth.

- **Level 0 (Background):** Flat `#FAFAFA`.
- **Level 1 (Cards/Surface):** Soft Cream `#F5F5DC` with a 1px solid border in `#E5E5D0`.
- **Level 2 (Hover/Active):** Shadow: `0px 4px 12px rgba(75, 54, 33, 0.08)`.
- **Level 3 (Modals/Popovers):** Shadow: `0px 12px 32px rgba(75, 54, 33, 0.12)`.

Interactive elements use a subtle 1px inset border when pressed to simulate physical tactility.

## Shapes

The shape language is **Soft**, utilizing a consistent 0.25rem (4px) corner radius. This choice reflects professional precision—avoiding the "playfulness" of highly rounded corners while remaining more approachable than sharp 90-degree angles.

- **Standard Elements:** 4px (Checkboxes, Input Fields, Small Buttons).
- **Cards & Containers:** 8px (`rounded-lg`) to provide a clear structural container.
- **Status Tags:** 12px (`rounded-xl`) to distinguish functional labels from interactive buttons.

## Components

### Buttons
- **Primary:** Solid Coffee Brown with White text. High-emphasis actions (e.g., "Submit Checklist").
- **Secondary:** Outline in Coffee Brown with transparent background.
- **Ghost:** No border, Primary text. Used for "Cancel" or low-priority utility actions.

### Status Indicators (Chips)
- **Completed:** Fresh Green background (15% opacity) with dark Green text.
- **Pending:** Amber background (15% opacity) with dark Amber text.
- **Staff Roles:** Small circular avatars with an icon (e.g., a portafilter for Baristas, a toque for Kitchen) in the top-right corner of employee cards.

### Input Fields
- Understated style: 1px border in Neutral-Light. On focus, the border thickens to 2px in Primary Coffee Brown. Labels always sit above the field in `label-bold`.

### Cards
- The primary container for the "Operations Dashboard." Every card must have a consistent header containing a title and an optional "Action Overflow" (three dots). Card footers are reserved for timestamps or "Last updated by" metadata.

### Checklists
- List items feature a 48px minimum hit area. Completed items should transition to a 10% opacity of the Accent Green background with a strikethrough on the text to provide immediate visual satisfaction.