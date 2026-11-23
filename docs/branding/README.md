# PGOne identity and illustration system

The PGOne logo uses the blue house and bed with a gold accent supplied in the approved artwork. The cropped original is stored in `mobile/frontend/src/assets/brand/pgone-logo.png`. The compact mark is stored beside it and is reused in app headers, billing, and the monthly access receipt. Android uses a padded mark for the adaptive launcher and an alpha-only version for the themed launcher and notification.

White and neutral surfaces carry most app screens. Blue identifies key actions, while gold supports the logo and highlights. Manrope and Inter remain bundled for headings and body text.


Three original transparent raster illustrations are reused purposefully: residence for entry/property setup, room for unassigned residency, and records for empty payment history. Optimized WebP files and hashes are in `mobile/frontend/src/assets/illustrations/manifest.json`. Full image-generation prompts/provenance are recorded in `ASSET-PROMPTS.md`. No stock imagery, image hotlinks, generated UI text or reference-screen screenshots ship as UI.

Motion is code-native: three fixed circular dots translate vertically with staggered timing; buttons preserve their existing nodes and dimensions while busy; the green check is an SVG stroke animation. System reduced-motion settings replace bounce with opacity changes. The native app-picker discovery uses the same three-dot pattern. No paid access is granted by animation or a native app return.

The technical SafeHouse namespaces, API domain, session storage, Firebase and Android package contracts are retained. Application label is PGOne. Original production signing credentials remain a separate release requirement. Testing builds never claim production upgrade compatibility.
