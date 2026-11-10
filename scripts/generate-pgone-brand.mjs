import {mkdir,writeFile} from 'node:fs/promises';
import {markPath,markFold} from '../mobile/frontend/src/components/brand.js';
const dir='docs/branding';await mkdir(dir,{recursive:true});
const svg=(body,view='0 0 64 64')=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}" role="img" aria-label="PGOne">${body}</svg>\n`;
for(const [name,color,fold] of [['pgone-mark','#2056EF','#0B2148'],['pgone-mark-dark','#FFFFFF','#A7C8FF'],['pgone-mark-mono','#0B2148',null]]){
 const paths=`<path d="${markPath}" fill="${color}" fill-rule="evenodd"/>${fold?`<path d="${markFold}" fill="${fold}"/>`:''}`;
 await writeFile(`${dir}/${name}.svg`,svg(paths));
 const dark=name.endsWith('dark');
 await writeFile(`${dir}/${name.replace('mark','wordmark')}.svg`,svg(`${paths}<text x="76" y="49" font-family="Manrope,Inter,sans-serif" font-size="44" font-weight="750" letter-spacing="-2" fill="${dark?'#FFFFFF':'#0B2148'}">PG<tspan fill="${dark?'#A7C8FF':fold?'#2056EF':color}">One</tspan></text>`,'0 0 264 64'));
}
const root='mobile/app/src/main/res';
const vector=(body,size=64,viewport=64)=>`<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="${size}dp" android:height="${size}dp" android:viewportWidth="${viewport}" android:viewportHeight="${viewport}">${body}</vector>\n`;
const path=(color)=>`<path android:name="pgone_mark" android:fillColor="${color}" android:fillType="evenOdd" android:pathData="${markPath}"/>`;
const paint=path('#2056EF')+`<path android:fillColor="#0B2148" android:pathData="${markFold}"/>`;
await writeFile(`${root}/drawable/ic_launcher.xml`,vector(paint));
await writeFile(`${root}/drawable/splash_mark.xml`,vector(paint,108));
await writeFile(`${root}/drawable/ic_notification.xml`,vector(path('#FFFFFF'),24));
await writeFile(`${root}/drawable/pgone_icon_foreground.xml`,vector(`<group android:translateX="22" android:translateY="22">${path('#FFFFFF')}</group>`,108,108));
await writeFile(`${root}/drawable/pgone_icon_background.xml`,`<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="#2056EF"/></shape>\n`);
await writeFile(`${root}/drawable/pgone_icon_monochrome.xml`,vector(`<group android:translateX="22" android:translateY="22">${path('#FFFFFF')}</group>`,108,108));
for(const folder of ['mipmap-anydpi','mipmap-anydpi-v26','mipmap-anydpi-v33']){
 await mkdir(`${root}/${folder}`,{recursive:true});
 const content=folder==='mipmap-anydpi'?vector(`<path android:fillColor="#2056EF" android:pathData="M20 0H88Q108 0 108 20V88Q108 108 88 108H20Q0 108 0 88V20Q0 0 20 0Z"/><group android:translateX="22" android:translateY="22">${path('#FFFFFF')}</group>`,108,108):
 `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@drawable/pgone_icon_background"/><foreground android:drawable="@drawable/pgone_icon_foreground"/>${folder.endsWith('v33')?'<monochrome android:drawable="@drawable/pgone_icon_monochrome"/>':''}</adaptive-icon>\n`;
 for(const name of ['ic_launcher','ic_launcher_round'])await writeFile(`${root}/${folder}/${name}.xml`,content);
}
console.log('Generated Openframe brand variants and Android adaptive/themed assets.');

await writeFile('src/platform/brand.ts',`// Generated from the canonical editable PGOne geometry.
export const markPath=${JSON.stringify(markPath)};
export const markFold=${JSON.stringify(markFold)};
`);
