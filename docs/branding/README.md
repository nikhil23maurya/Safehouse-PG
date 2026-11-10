# PGOne identity and illustration system

PGOne uses an original structural P mark, with an open lower counter and a folded inner plane. It is not a roof or house-window icon. The canonical editable geometry lives in `mobile/frontend/src/components/brand.js`; run `node scripts/generate-pgone-brand.mjs` to regenerate SVG variants, the backend receipt paths, Android launcher/adaptive/themed notification and splash resources. Do not redraw alternate marks.

Palette: royal blue #2056EF, navy #0B2148, white #FFFFFF, pale blue #EAF0FF. Green is reserved for confirmed or successful states. White type belongs on blue surfaces. Typography: bundled licensed Manrope for identity/headings and Inter for body/data. Primary, reverse and monochrome SVG mark/wordmark files are supplied. Preserve clear space of at least one stem width. Minimum standalone mark size: 24px. Adaptive Android foreground fits the central 66dp safe circle in the 108dp canvas; the launcher remains identifiable under circle and rounded-square masks.

Three original transparent raster illustrations are reused purposefully: residence for entry/property setup, room for unassigned residency, and records for empty payment history. Optimized WebP files and hashes are in `mobile/frontend/src/assets/illustrations/manifest.json`. Full image-generation prompts/provenance are recorded in `ASSET-PROMPTS.md`. No stock imagery, image hotlinks, generated UI text or reference-screen screenshots ship as UI.

Motion is code-native: three fixed circular dots translate vertically with staggered timing; buttons preserve their existing nodes and dimensions while busy; the green check is an SVG stroke animation. System reduced-motion settings stop these animations. The native app-picker discovery uses the same three-dot pattern. No paid access is granted by animation or a native app return.

The technical SafeHouse namespaces, API domain, session storage, Firebase and Android package contracts are retained. Application label is PGOne. Original production signing credentials remain a separate release requirement. Testing builds never claim production upgrade compatibility.
